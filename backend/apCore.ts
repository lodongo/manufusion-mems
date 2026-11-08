// Accounts payable: pure rules shared by goods receipts, supplier invoices, payments and receipt adjustments.
// No database access here, so every rule can be tested on its own.
//
// Numbers: REC_ (goods and service receipts), INV_ (supplier invoices), PAY_ (supplier payments) and RAD_ (receipt
// adjustment requests), each followed by eight digits from a database counter.

export type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export const DOC_KINDS = ['REC', 'INV', 'PAY', 'RAD'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const docNo = (kind: DocKind, n: number) => {
    if (!Number.isInteger(n) || n < 1 || n > 99_999_999) throw new Error('The number is out of range.');
    return `${kind}_${String(n).padStart(8, '0')}`;
};
export const DOC_NO = { REC: /^REC_\d{8}$/, INV: /^INV_\d{8}$/, PAY: /^PAY_\d{8}$/, RAD: /^RAD_\d{8}$/ } as const;

export const INVOICE_STATUS: Record<string, string> = {
    on_hold: 'On hold: matching failed',
    pending_approval: 'In approval',
    posted: 'Approved and posted to payables',
    part_paid: 'Partly paid',
    paid: 'Paid',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
};
/** Invoices that hold their receipts (a receipt can carry one live invoice). */
export const LIVE_INVOICE = ['on_hold', 'pending_approval', 'posted', 'part_paid', 'paid'];
export const PAYABLE_INVOICE = ['posted', 'part_paid'];
export const PAYMENT_STATUS: Record<string, string> = { pending_approval: 'In approval', paid: 'Paid and posted', rejected: 'Rejected' };
export const ADJUST_STATUS: Record<string, string> = { pending_approval: 'In approval', done: 'Approved and posted', rejected: 'Rejected', withdrawn: 'Withdrawn' };
export const PAY_METHODS: Record<string, string> = { bank_transfer: 'Bank transfer (EFT)', rtgs: 'RTGS', cheque: 'Cheque', mobile_money: 'Mobile money' };

/** What one receipt (delivery) contributes to an invoice: quantity and value per order line, at the order's net price. */
export function receiptValue(delivery: Obj, poLines: Obj[]): { lines: Array<{ no: number; qty: number; value: number }>; goods: number } {
    const lines = objs(delivery.lines)
        .map((l) => {
            const no = Number(l.no);
            const qty = Math.max(0, (Number(l.qty) || 0) - (Number(l.reversedQty) || 0));
            const pl = poLines.find((x) => Number(x.no) === no);
            return { no, qty: r4(qty), value: r2(qty * (Number(pl?.netUnitPrice) || 0)) };
        })
        .filter((l) => l.qty > 0);
    return { lines, goods: r2(lines.reduce((s, l) => s + l.value, 0)) };
}

/** The receipt is still in force (not fully reversed). */
export const receiptLive = (delivery: Obj) => str(delivery.status) !== 'reversed' && objs(delivery.lines).some((l) => (Number(l.qty) || 0) - (Number(l.reversedQty) || 0) > 0);

/**
 * The value expected on a supplier invoice for some receipts: goods at the order price plus the receipts' share of
 * the order's taxes and charges, and the share of the taxes alone (for the VAT check).
 */
export function expectedFor(goods: number, orderGoods: number, chargesTotal: number, taxesTotal: number) {
    const share = orderGoods > 0 ? goods / orderGoods : 0;
    return { goods: r2(goods), charges: r2(chargesTotal * share), tax: r2(taxesTotal * share), total: r2(goods + chargesTotal * share) };
}

export const variancePct = (amount: number, expected: number) => (expected > 0 ? r2(((amount - expected) / expected) * 100) : 0);

export interface Check {
    code: string;
    label: string;
    result: 'pass' | 'warn' | 'fail';
    detail: string;
}

export interface MatchInput {
    requirements: Array<{ id: string; status: string }>;
    requisitions: Array<{ id: string; status: string }>;
    poStatus: string;
    poNumber: string;
    receipts: Array<{ id: string; recNo: string; live: boolean; otherInvoice: string; date: string }>;
    linesOver: number[];
    amount: number;
    tax: number;
    expected: { total: number; tax: number };
    tolerancePct: number;
    varianceReason: string;
    duplicateOf: string;
    vendorStatus: string;
    invoiceDate: string;
    legalEntities: number;
    financeProblem: string;
}

/**
 * Due diligence before an invoice goes for approval: the purchase requirement, requisition, order and receipts behind
 * it, quantities, price and tax against the order, duplicates, the supplier and whether finance can post it.
 * A fail keeps the invoice on hold; warnings go to the approvers with the invoice.
 */
export function matchChecks(m: MatchInput): Check[] {
    const out: Check[] = [];
    const add = (code: string, label: string, result: Check['result'], detail: string) => out.push({ code, label, result, detail });
    const badReq = m.requirements.filter((r) => ['rejected', 'cancelled', 'draft', 'returned'].includes(r.status));
    add('match.requirement', 'Purchase requirement', !m.requirements.length ? 'warn' : badReq.length ? 'fail' : 'pass', !m.requirements.length ? 'No purchase requirement is linked to these lines.' : badReq.length ? `Requirement ${badReq.map((r) => r.id).join(', ')} is ${badReq[0].status}.` : `${m.requirements.length} approved requirement(s).`);
    const badRq = m.requisitions.filter((r) => r.status !== 'converted');
    add('match.requisition', 'Purchase requisition', !m.requisitions.length ? 'warn' : badRq.length ? 'fail' : 'pass', !m.requisitions.length ? 'No requisition is linked to these lines.' : badRq.length ? `Requisition ${badRq.map((r) => r.id).join(', ')} is not on the order any more.` : `${m.requisitions.length} requisition(s) on the order.`);
    add('match.order', 'Purchase order', ['open', 'sent', 'partial', 'full'].includes(m.poStatus) ? 'pass' : 'fail', `${m.poNumber} is ${m.poStatus}.`);
    const dead = m.receipts.filter((r) => !r.live);
    const taken = m.receipts.filter((r) => r.otherInvoice);
    add('match.receipt', 'Goods or service receipt', !m.receipts.length || dead.length || taken.length ? 'fail' : 'pass', !m.receipts.length ? 'No receipt is selected.' : dead.length ? `${dead.map((r) => r.recNo).join(', ')} is reversed.` : taken.length ? `${taken.map((r) => `${r.recNo} (${r.otherInvoice})`).join(', ')} is already on another invoice.` : `${m.receipts.map((r) => r.recNo).join(', ')}.`);
    add('match.quantity', 'Quantity: invoiced against received', m.linesOver.length ? 'fail' : 'pass', m.linesOver.length ? `Line ${m.linesOver.join(', ')} would be invoiced beyond what was received.` : 'Every quantity is received.');
    const v = variancePct(m.amount, m.expected.total);
    const priceOut = Math.abs(v) > m.tolerancePct;
    add('match.price', 'Amount against the order', priceOut ? (m.varianceReason.length >= 20 ? 'warn' : 'fail') : 'pass', `Invoice ${r2(m.amount)} against ${r2(m.expected.total)} expected (${v}%, tolerance ${m.tolerancePct}%).${priceOut ? (m.varianceReason.length >= 20 ? ` Reason: ${m.varianceReason}` : ' A reason of at least 20 characters is needed.') : ''}`);
    const tv = m.expected.tax > 0 ? variancePct(m.tax, m.expected.tax) : m.tax > 0 ? 100 : 0;
    add('match.tax', 'Tax against the order', Math.abs(tv) > m.tolerancePct ? 'warn' : 'pass', `Tax ${r2(m.tax)} against ${r2(m.expected.tax)} from the taxes on the order.`);
    add('match.duplicate', 'Duplicate invoice number', m.duplicateOf ? 'fail' : 'pass', m.duplicateOf ? `The supplier's invoice number is already on ${m.duplicateOf}.` : 'Not recorded before for this supplier.');
    add('match.vendor', 'Supplier', ['blocked', 'suspended', 'rejected', 'inactive'].includes(m.vendorStatus) ? 'fail' : 'pass', `Supplier status: ${m.vendorStatus || 'unknown'}.`);
    const early = m.receipts.filter((r) => r.date && m.invoiceDate && m.invoiceDate < r.date);
    add('match.date', 'Invoice date', early.length ? 'warn' : 'pass', early.length ? `Dated before receipt ${early.map((r) => r.recNo).join(', ')}.` : 'On or after the receipts.');
    add('match.entity', 'One legal entity', m.legalEntities === 1 ? 'pass' : 'fail', m.legalEntities === 1 ? 'All lines post in one legal entity.' : 'Invoice the receipts of each legal entity separately.');
    add('match.finance', 'Finance can post', m.financeProblem ? 'fail' : 'pass', m.financeProblem || 'Payables, GR/IR and VAT accounts are mapped and the period is open.');
    return out;
}

/**
 * The AP invoice journal for one legal entity: Dr GR/IR for the goods at the receipt value, Dr input VAT for the tax,
 * Dr or Cr purchase price and charges variance for the rest, Cr supplier payables for the whole invoice.
 */
export function apInvoiceLines(a: { grir: Array<{ ccId: string; amount: number; docAmount: number }>; amount: number; tax: number; rate: number; varianceCc: string; accounts: { grir: string; vat: string; payable: string; variance: string }; ref: string }) {
    type L = { side: 'D' | 'C'; glCode: string; ccId?: string; amount: number; docAmount: number; description: string; ref: string };
    const lines: L[] = [];
    let grirTotal = 0;
    for (const g of a.grir) {
        if (!(g.amount > 0)) continue;
        lines.push({ side: 'D', glCode: a.accounts.grir, ccId: g.ccId, amount: r2(g.amount), docAmount: r2(g.docAmount), description: `GR/IR cleared by ${a.ref}`, ref: a.ref });
        grirTotal = r2(grirTotal + g.amount);
    }
    const payable = r2(a.amount * a.rate);
    const vat = r2(a.tax * a.rate);
    if (vat > 0) lines.push({ side: 'D', glCode: a.accounts.vat, amount: vat, docAmount: r2(a.tax), description: `Input VAT on ${a.ref}`, ref: a.ref });
    const diff = r2(payable - vat - grirTotal);
    if (Math.abs(diff) >= 0.01) lines.push({ side: diff > 0 ? 'D' : 'C', glCode: a.accounts.variance, ccId: a.varianceCc, amount: Math.abs(diff), docAmount: r2(Math.abs(diff) / (a.rate || 1)), description: `Charges and price variance on ${a.ref}`, ref: a.ref });
    lines.push({ side: 'C', glCode: a.accounts.payable, amount: payable, docAmount: r2(a.amount), description: `Supplier payable ${a.ref}`, ref: a.ref });
    return lines;
}

/** The AP payment journal: Dr supplier payables (gross), Cr bank (net), Cr withholding tax payable. */
export function apPaymentLines(a: { gross: number; wht: number; rate: number; accounts: { payable: string; bank: string; wht: string }; ref: string }) {
    const gross = r2(a.gross * a.rate);
    const wht = r2(a.wht * a.rate);
    const lines: Array<{ side: 'D' | 'C'; glCode: string; amount: number; docAmount: number; description: string; ref: string }> = [{ side: 'D', glCode: a.accounts.payable, amount: gross, docAmount: r2(a.gross), description: `Supplier payment ${a.ref}`, ref: a.ref }];
    if (wht > 0) lines.push({ side: 'C', glCode: a.accounts.wht, amount: wht, docAmount: r2(a.wht), description: `Withholding tax on ${a.ref}`, ref: a.ref });
    lines.push({ side: 'C', glCode: a.accounts.bank, amount: r2(gross - wht), docAmount: r2(a.gross - a.wht), description: `Paid from bank ${a.ref}`, ref: a.ref });
    return lines;
}

/** Invoice status after a payment allocation. */
export function invoiceAfterPayment(amount: number, paid: number) {
    const out = r2(amount - paid);
    if (out < -0.005) throw new Error('The payment is more than the invoice outstanding.');
    return { paid: r2(paid), outstanding: Math.max(0, out), status: out <= 0.005 ? 'paid' : 'part_paid' };
}

/** Delivery progress of an order: per line ordered, received and pending, and the whole order. */
export function deliveryProgress(lines: Obj[]) {
    const rows = lines.map((l) => {
        const ordered = Number(l.quantity) || 0;
        const received = Number(l.receivedQty) || 0;
        return { no: Number(l.no), item: str(l.itemName) || str(l.requirement), unit: str(l.unit), ordered, received: r4(received), pending: r4(Math.max(0, ordered - received)), pct: ordered > 0 ? Math.min(100, Math.round((received / ordered) * 100)) : 0 };
    });
    const ordered = rows.reduce((s, r) => s + r.ordered, 0);
    const received = rows.reduce((s, r) => s + Math.min(r.received, r.ordered), 0);
    return { rows, pct: ordered > 0 ? Math.round((received / ordered) * 100) : 0, pending: rows.some((r) => r.pending > 0) };
}
