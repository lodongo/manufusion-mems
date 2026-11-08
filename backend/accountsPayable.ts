import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { record } from './org';
import { bypass } from './testModeCore';
import { getAuthority } from './procurementPolicy';
import {
    approvalRoute, baseOf, ccOf, cleanText, DELIVERING, invoiceStatusOf, myPositions, mutate, nameOfUser, o, objs, oneLine, ordersPath, outstanding, PLACED, recordDelivery, reqsPath, resolvePo, round, steps as stepsOf, today, type Step,
} from './purchaseOrders';
import { checkChosenGl, entityOf, financeState, fxRate, leOf, mappingOf, nextCounter, permAt, post, roleAccount, scopeOf, unitsOf, withLock, type PostLine, type Unit } from './finCore';
import { chargesTotal, taxesTotal } from '../src/shared/procurementCharges';
import { ADJUST_STATUS, apInvoiceLines, apPaymentLines, deliveryProgress, docNo, DOC_NO, expectedFor, INVOICE_STATUS, invoiceAfterPayment, LIVE_INVOICE, matchChecks, PAY_METHODS, PAYABLE_INVOICE, PAYMENT_STATUS, receiptLive, receiptValue, variancePct, type Check, type DocKind } from './apCore';
import { repostGoods, reverseGoods, receiptPlan, type PostedLine } from './finOps';
import { requirementsPath } from './procurementSetup';
import { vendorsPath } from './vendors';

// ---------------------------------------------------------------------------
// Goods receipts, supplier invoices, payments and receipt adjustments.
//
//   organizations/{org}/goods_receipts/REC_########     register of every goods receipt (a copy of the PO delivery)
//   organizations/{org}/ap_invoices/INV_########        supplier invoices: matched, approved, posted, paid
//   organizations/{org}/ap_payments/PAY_########        supplier payments: approved and posted
//   organizations/{org}/receipt_adjustments/RAD_######## requests to reverse a receipt or change where it posted
//
// Receiving posts (Dr inventory / line account / asset clearing, Cr GR/IR). The invoice is then checked against the
// requirement, requisition, order and receipts, approved under the chart of authority, and only on final approval
// posted to accounts payable (Dr GR/IR + input VAT ± variance, Cr supplier payables). Payments are approved the same
// way and post Dr payables, Cr bank and withholding tax. Before a receipt is paid it can be reversed or re-posted only
// through an approved request. Every step is audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const P = (orgId: string) => ({
    receipts: `organizations/${orgId}/goods_receipts`,
    invoices: `organizations/${orgId}/ap_invoices`,
    payments: `organizations/${orgId}/ap_payments`,
    adjust: `organizations/${orgId}/receipt_adjustments`,
    files: `organizations/${orgId}/procurement_files`,
});
const can = (ctx: OrgContext, perm: string) => ctx.role === 'org_super_admin' || (Array.isArray(ctx.permissions) && (ctx.permissions.includes('*') || ctx.permissions.includes(perm)));
const r2 = (n: number) => round(n, 2);
const fmt = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 2 });

/** The next REC_, INV_, PAY_ or RAD_ number from the organization's database counter. */
export async function docNoFor(orgId: string, kind: DocKind) {
    return docNo(kind, await nextCounter(orgId, 'ap_numbers', kind));
}

/** Writes a goods receipt into the register (once) and audits it. */
export async function writeReceipt(ctx: OrgContext, reg: Obj) {
    const recNo = str(reg.recNo);
    await writeDoc(`${P(ctx.orgId).receipts}/${recNo}`, { ...reg, version: 1 }, { exists: false });
    await record(ctx, 'org.ap.receipt.post', recNo, `${str(reg.poId)} delivery note ${str(reg.ref)} (${str(reg.via)})`.slice(0, 300));
}

// ----- Shared pieces -----

async function loadOrder(orgId: string, id: string): Promise<Doc> {
    const doc = await resolvePo(orgId, id);
    if (!doc) throw new HttpError(404, 'Purchase order not found.');
    return doc;
}

/** What a delivery posted, per line and legal entity (older deliveries are worked out from the order). */
async function postedOf(orgId: string, po: Obj, delivery: Obj, units: Map<string, Unit>): Promise<{ posted: PostedLine[]; rates: Record<string, number> }> {
    const saved = objs(delivery.posted);
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(o(delivery.rates))) if (Number(v) > 0) rates[k] = Number(v);
    if (saved.length) return { posted: saved.map((x) => ({ no: Number(x.no), leId: str(x.leId), costCenterId: str(x.costCenterId), glCode: str(x.glCode), type: str(x.type), warehouse: x.warehouse === true, materialId: str(x.materialId), qty: Number(x.qty) || 0, value: Number(x.value) || 0, docValue: Number(x.docValue) || 0 })), rates };
    const out: PostedLine[] = [];
    for (const g of objs(delivery.lines)) {
        const l = objs(po.lines).find((x) => Number(x.no) === Number(g.no));
        if (!l) continue;
        const cc = str(g.costCenterId) || ccOf(l);
        const le = leOf(units, cc);
        const wh = str(l.type) === 'material' && !!(await getDoc(`organizations/${orgId}/warehouses/${cc}`));
        const docValue = r2((Number(g.qty) || 0) * (Number(l.netUnitPrice) || 0));
        if (le && !rates[le.id]) {
            const cur = (await entityOf(orgId, le.id)).functionalCurrency || str(o(o((le as unknown as Obj).attributes)).currencyCode);
            rates[le.id] = cur ? await fxRate(str(po.currency), cur).catch(() => 1) : 1;
        }
        out.push({ no: Number(g.no), leId: le?.id ?? '', costCenterId: cc, glCode: str(g.glCode) || str(l.glCode), type: str(l.type), warehouse: wh, materialId: str(g.materialId), qty: Number(g.qty) || 0, value: r2(docValue * (le ? rates[le.id] : 1)), docValue });
    }
    return { posted: out, rates };
}

const recNoOf = (dv: Obj) => str(dv.recNo) || str(dv.id);

/** Chart of authority approval: who may act on the current level now, and why not. */
function decider(ctx: OrgContext, d: Obj, perm: string): { ok: boolean; why: string; testMode?: boolean } {
    if (str(d.status) !== 'pending_approval') return { ok: false, why: '' };
    const step = stepsOf(d).find((s) => s.status === 'pending');
    if (!step || !can(ctx, perm)) return { ok: false, why: '' };
    const conflict = (Array.isArray(d.conflictUids) ? (d.conflictUids as unknown[]).map(str) : []).includes(ctx.uid) || str(d.createdBy) === ctx.uid;
    const strict = !myPositions(ctx.me).includes(step.positionCode)
        ? { ok: false, why: `Level ${step.level} is approved by ${step.positionTitle}.` }
        : conflict
          ? { ok: false, why: 'You prepared or took part in this, so someone else must approve it.' }
          : stepsOf(d).some((s) => s.status === 'approved' && s.by === ctx.uid)
            ? { ok: false, why: 'You approved an earlier level, so a different person must approve this one.' }
            : { ok: true, why: '' };
    if (!strict.ok && ctx.testMode === true && bypass(ctx, 'ap.coa_approver')) return { ok: true, why: '', testMode: true };
    return strict;
}

/** One approval decision on a document under a lock. Returns the new document and whether this was the last level. */
async function decide(ctx: OrgContext, path: string, perm: string, onFinal: (d: Obj) => Promise<Obj>, onReject: (d: Obj, reason: string) => Promise<Obj>, label: string) {
    const action = str(ctx.body.action);
    if (!['approve', 'reject'].includes(action)) throw new HttpError(400, 'Approve or reject.');
    const reason = cleanText(ctx.body.reason).slice(0, 400);
    if (action === 'reject' && reason.length < 10) throw new HttpError(400, 'Give the reason for rejecting (at least 10 characters).');
    return withLock(ctx.orgId, path.replace(/\//g, '_'), async () => {
        const doc = await getDoc(path);
        if (!doc) throw new HttpError(404, `${label} not found.`);
        const d = doc.data;
        const who = decider(ctx, d, perm);
        if (!who.ok) throw new HttpError(403, who.why || 'You cannot approve this now.');
        const at = nowIso();
        const all = stepsOf(d);
        const idx = all.findIndex((s) => s.status === 'pending');
        const hist = (what: string, note: string) => [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: what, note: note.slice(0, 300) }];
        let next: Obj;
        if (action === 'reject') {
            next = { ...d, ...(await onReject(d, reason)), status: 'rejected', rejectReason: reason, decidedAt: at, history: hist('rejected', reason), updatedAt: at };
        } else {
            const nextSteps = all.map((s, i) => (i === idx ? { ...s, status: 'approved', by: ctx.uid, byName: nameOfUser(ctx.me), at, note: reason + (who.testMode ? ' (test mode)' : '') } : s)) as Step[];
            const last = nextSteps.every((s) => s.status === 'approved');
            next = { ...d, approval: { ...o(d.approval), steps: nextSteps }, history: hist(`approved level ${all[idx].level}`, reason), updatedAt: at };
            if (last) next = { ...next, ...(await onFinal(next)) };
        }
        await writeDoc(path, next);
        await record(ctx, `org.ap.${label.toLowerCase().replace(/\s+/g, '_')}.${action}`, doc.id, `${action === 'approve' ? `Approved level ${all[idx].level}` : `Rejected: ${reason}`}${str(next.status) !== str(d.status) ? `; now ${str(next.status)}` : ''}`.slice(0, 400));
        return { ok: true, id: doc.id, status: str(next.status) };
    });
}

async function routeApproval(ctx: OrgContext, amountBase: number) {
    const authority = await getAuthority(ctx.orgId);
    return approvalRoute(ctx.orgId, ctx.me, amountBase, authority, ctx.testMode === true);
}

async function toOrgCurrency(ctx: OrgContext, amount: number, currency: string) {
    const orgCurrency = str(ctx.org.data.currencyCode);
    if (!orgCurrency || currency === orgCurrency) return r2(amount);
    return r2(amount * (await fxRate(currency, orgCurrency)));
}

async function invoicesOfPo(orgId: string, poId: string) {
    return runQuery({ from: [{ collectionId: 'ap_invoices' }], where: fieldEq('poId', poId) }, `organizations/${orgId}`);
}

// ----- Invoice matching -----

interface Draft {
    po: Doc;
    deliveries: Obj[];
    leId: string;
    goods: number;
    expected: { goods: number; charges: number; tax: number; total: number };
    lines: Array<{ no: number; qty: number; value: number }>;
    checks: Check[];
    grir: Array<{ ccId: string; amount: number; docAmount: number }>;
    varianceCc: string;
    rate: number;
}

async function draftInvoice(ctx: OrgContext, po: Doc, v: { scope: string; deliveryId: string; number: string; amount: number; tax: number; date: string; reason: string }, selfId = ''): Promise<Draft> {
    const d = po.data;
    const units = await unitsOf(ctx.orgId);
    const all = objs(d.deliveries);
    let chosen: Obj[];
    if (v.scope === 'order') {
        if (str(d.status) !== 'full') throw new HttpError(409, 'An invoice for the whole order needs the order to be delivered in full. Invoice this receipt instead.');
        chosen = all.filter((x) => receiptLive(x) && (!str(x.invoiceId) || str(x.invoiceId) === selfId));
        if (!chosen.length) throw new HttpError(409, 'Every receipt of this order is already invoiced.');
    } else {
        const one = all.find((x) => str(x.id) === v.deliveryId);
        if (!one) throw new HttpError(404, 'Receipt not found on this order.');
        chosen = [one];
    }
    const invoiceDocs = new Map((await invoicesOfPo(ctx.orgId, po.id)).map((x) => [x.id, x.data]));
    const otherInvoice = (dv: Obj) => {
        const id = str(dv.invoiceId);
        if (!id || id === selfId) return '';
        const inv = invoiceDocs.get(id);
        if (inv && !LIVE_INVOICE.includes(str(inv.status))) return '';
        return id;
    };
    const lines = new Map<number, { no: number; qty: number; value: number }>();
    const grir = new Map<string, { ccId: string; amount: number; docAmount: number }>();
    const les = new Set<string>();
    let rate = 0;
    let varianceCc = '';
    for (const dv of chosen) {
        const rv = receiptValue(dv, objs(d.lines));
        const { posted, rates } = await postedOf(ctx.orgId, d, dv, units);
        for (const l of rv.lines) {
            const cur = lines.get(l.no) ?? { no: l.no, qty: 0, value: 0 };
            lines.set(l.no, { no: l.no, qty: round(cur.qty + l.qty, 4), value: r2(cur.value + l.value) });
            const p = posted.find((x) => x.no === l.no);
            if (!p) continue;
            les.add(p.leId);
            rate = rates[p.leId] || rate || 1;
            varianceCc = varianceCc || p.costCenterId;
            const g = grir.get(p.costCenterId) ?? { ccId: p.costCenterId, amount: 0, docAmount: 0 };
            grir.set(p.costCenterId, { ccId: p.costCenterId, amount: r2(g.amount + l.value * (rates[p.leId] || 1)), docAmount: r2(g.docAmount + l.value) });
        }
    }
    const goods = r2(Array.from(lines.values()).reduce((s, l) => s + l.value, 0));
    const live = objs(d.charges).filter((c) => objs(d.lines).some((l) => str(l.requisitionId) === str(c.requisitionId)));
    const expected = expectedFor(goods, Number(d.total) || 0, chargesTotal(live), taxesTotal(live));
    // Invoiced quantities never exceed what was received, counting every other live invoice of the order.
    const others = Array.from(invoiceDocs.entries()).filter(([id, x]) => id !== selfId && LIVE_INVOICE.includes(str(x.status)));
    const linesOver: number[] = [];
    for (const l of lines.values()) {
        const pl = objs(d.lines).find((x) => Number(x.no) === l.no);
        const already = others.reduce((s, [, x]) => s + (objs(x.lines).find((y) => Number(y.no) === l.no) ? Number(objs(x.lines).find((y) => Number(y.no) === l.no)!.qty) || 0 : 0), 0);
        if (already + l.qty > (Number(pl?.receivedQty) || 0) + 1e-9) linesOver.push(l.no);
    }
    const reqIds = Array.from(new Set(objs(d.lines).map((l) => str(l.requirementId)).filter(Boolean)));
    const rqIds = Array.from(new Set(objs(d.lines).map((l) => str(l.requisitionId)).filter(Boolean)));
    const [reqs, rqs, vendor, authority] = await Promise.all([
        Promise.all(reqIds.map(async (id) => ({ id, status: str((await getDoc(`${requirementsPath(ctx.orgId)}/${id}`))?.data.status) || 'missing' }))),
        Promise.all(rqIds.map(async (id) => ({ id, status: str((await getDoc(`${reqsPath(ctx.orgId)}/${id}`))?.data.status) || 'missing' }))),
        getDoc(`${vendorsPath(ctx.orgId)}/${str(d.vendorId)}`),
        getAuthority(ctx.orgId),
    ]);
    // Duplicate supplier invoice number across every invoice of this supplier.
    const dupe = v.number ? (await runQuery({ from: [{ collectionId: 'ap_invoices' }], where: fieldEq('vendorId', str(d.vendorId)) }, `organizations/${ctx.orgId}`)).find((x) => x.id !== selfId && LIVE_INVOICE.includes(str(x.data.status)) && str(x.data.supplierInvoiceNo).toLowerCase() === v.number.toLowerCase()) : undefined;
    let financeProblem = '';
    const leId = Array.from(les)[0] ?? '';
    if (les.size === 1) {
        const state = await financeState(ctx.orgId, leId);
        if (state !== 'live') financeProblem = `Finance is ${state === 'blocked' ? 'blocked' : 'not live'} for ${units.get(leId)?.code ?? leId}, so the invoice cannot be posted to payables.`;
        else {
            const map = await mappingOf(ctx.orgId, leId);
            const need = ['GRIR', 'SUPPLIER_PAYABLE', ...(v.tax > 0 ? ['VAT_INPUT'] : []), ...(Math.abs(v.amount - v.tax - goods) >= 0.01 ? ['PRICE_VARIANCE'] : [])];
            for (const role of need) {
                try {
                    roleAccount(map, role, '', { event: 'AP_INVOICE' });
                } catch (e) {
                    financeProblem = e instanceof Error ? e.message : `The ${role} account is not mapped.`;
                    break;
                }
            }
        }
    }
    const checks = matchChecks({
        requirements: reqs,
        requisitions: rqs,
        poStatus: str(d.status),
        poNumber: str(d.number) || po.id,
        receipts: chosen.map((x) => ({ id: str(x.id), recNo: recNoOf(x), live: receiptLive(x), otherInvoice: otherInvoice(x), date: str(x.date) })),
        linesOver,
        amount: v.amount,
        tax: v.tax,
        expected,
        tolerancePct: authority.controls.matchTolerancePct,
        varianceReason: v.reason,
        duplicateOf: dupe ? dupe.id : '',
        vendorStatus: str(vendor?.data.status),
        invoiceDate: v.date,
        legalEntities: les.size,
        financeProblem,
    });
    return { po, deliveries: chosen, leId, goods, expected, lines: Array.from(lines.values()), checks, grir: Array.from(grir.values()), varianceCc, rate: rate || 1 };
}

function readInvoiceBody(b: Obj) {
    const number = oneLine(b.number, 40);
    if (number.length < 2) throw new HttpError(400, "Enter the supplier's invoice number.");
    const date = str(b.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new HttpError(400, 'Enter the invoice date. It cannot be in the future.');
    const amount = Number(b.amount);
    const tax = Number(b.taxAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) throw new HttpError(400, 'Enter the invoice amount including tax.');
    if (!Number.isFinite(tax) || tax < 0 || tax >= amount) throw new HttpError(400, 'The tax must be zero or more and less than the invoice amount.');
    const scope = str(b.scope) === 'order' ? 'order' : 'receipt';
    return { number, date, amount: r2(amount), tax: r2(tax), scope, deliveryId: str(b.deliveryId), reason: cleanText(b.varianceReason).slice(0, 300), note: cleanText(b.note).slice(0, 300) };
}

/** Marks the receipts of an invoice (or frees them) on the order and in the register. */
async function claimReceipts(ctx: OrgContext, poId: string, invoiceId: string, deliveryIds: string[], lines: Array<{ no: number; qty: number }>, claim: boolean) {
    await mutate(ctx, 'po', poId, claim ? 'invoice' : 'invoice.release', async (d) => {
        const deliveries = objs(d.deliveries).map((x) => (deliveryIds.includes(str(x.id)) ? { ...x, invoiceId: claim ? invoiceId : str(x.invoiceId) === invoiceId ? '' : str(x.invoiceId) } : x));
        const poLines = objs(d.lines).map((l) => {
            const g = lines.find((x) => x.no === Number(l.no));
            return g ? { ...l, invoicedQty: Math.max(0, round((Number(l.invoicedQty) || 0) + (claim ? g.qty : -g.qty), 4)) } : l;
        });
        return { patch: { deliveries, lines: poLines, invoiceStatus: invoiceStatusOf(poLines) }, event: claim ? 'invoiced' : 'invoice released', note: `${invoiceId}: ${deliveryIds.length} receipt(s)`, label: claim ? `Invoice ${invoiceId} recorded` : `Invoice ${invoiceId} released its receipts` };
    });
    for (const dv of deliveryIds) {
        const reg = (await runQuery({ from: [{ collectionId: 'goods_receipts' }], where: fieldEq('deliveryId', dv) }, `organizations/${ctx.orgId}`))[0];
        if (reg) await writeDoc(`${P(ctx.orgId).receipts}/${reg.id}`, { ...reg.data, invoiceId: claim ? invoiceId : '', updatedAt: nowIso() });
    }
}

async function leAllowed(ctx: OrgContext, perm: string, leId: string) {
    if (ctx.role === 'org_super_admin') return true;
    const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
    return !leId || permAt(ctx, perm, leId, units, scope);
}

function invoiceRow(id: string, d: Obj) {
    return {
        id,
        supplierInvoiceNo: str(d.supplierInvoiceNo),
        poId: str(d.poId),
        poNumber: str(d.poNumber),
        vendorName: str(d.vendorName),
        currency: str(d.currency),
        amount: Number(d.amount) || 0,
        taxAmount: Number(d.taxAmount) || 0,
        expected: Number(o(d.expected).total) || 0,
        variancePct: Number(d.variancePct) || 0,
        outstanding: Number(d.outstanding) || 0,
        paid: Number(d.paid) || 0,
        date: str(d.date),
        dueDate: str(d.dueDate),
        recNos: Array.isArray(d.recNos) ? (d.recNos as unknown[]).map(str) : [],
        scope: str(d.scope),
        status: str(d.status),
        statusLabel: INVOICE_STATUS[str(d.status)] ?? str(d.status),
        fails: objs(d.checks).filter((c) => str(c.result) === 'fail').length,
        warns: objs(d.checks).filter((c) => str(c.result) === 'warn').length,
        createdByName: str(d.createdByName),
        createdAt: str(d.createdAt),
        journalId: str(d.journalId),
    };
}

async function finalPostInvoice(ctx: OrgContext, id: string, d: Obj): Promise<Obj> {
    const leId = str(d.legalEntityId);
    const map = await mappingOf(ctx.orgId, leId);
    const acc = (role: string) => roleAccount(map, role, '', { event: 'AP_INVOICE' });
    const rate = await fxRate(str(d.currency), str(d.leCurrency) || str(d.currency)).catch(() => Number(d.rate) || 1);
    const grir = objs(d.grir).map((g) => ({ ccId: str(g.ccId), amount: Number(g.amount) || 0, docAmount: Number(g.docAmount) || 0 }));
    const needVariance = Math.abs(r2((Number(d.amount) || 0) * rate - (Number(d.taxAmount) || 0) * rate - grir.reduce((s, g) => s + g.amount, 0))) >= 0.01;
    const lines = apInvoiceLines({ grir, amount: Number(d.amount) || 0, tax: Number(d.taxAmount) || 0, rate, varianceCc: str(d.varianceCc), accounts: { grir: acc('GRIR'), vat: Number(d.taxAmount) > 0 ? acc('VAT_INPUT') : '', payable: acc('SUPPLIER_PAYABLE'), variance: needVariance ? acc('PRICE_VARIANCE') : '' }, ref: id });
    const posted = await post(ctx, {
        leId,
        type: 'AP_INVOICE',
        date: today(),
        docCurrency: str(d.currency),
        fxRate: rate,
        lines: lines.map((l) => ({ ...l, ccId: l.ccId ?? '' })) as PostLine[],
        narrative: `Supplier invoice ${str(d.supplierInvoiceNo)} from ${str(d.vendorName)} (${id}) on ${str(d.poId)}`,
        source: { kind: 'ap_invoice', id, ref: str(d.supplierInvoiceNo), route: `organization_home/fin_ap/invoices/${id}` },
        trace: { poId: str(d.poId), invoiceId: id, receiptNos: d.recNos, vendorId: str(d.vendorId) },
        sourceKey: `APINV_${id}`,
        approvalRef: id,
    });
    return { status: 'posted', journalId: posted.id, postedAt: nowIso(), postedLines: lines, postedRate: rate, outstanding: Number(d.amount) || 0, paid: 0 };
}

// ----- Receipt adjustment -----

function adjustRow(id: string, d: Obj) {
    return { id, kind: str(d.kind), kindLabel: str(d.kind) === 'reverse' ? 'Reverse receipt' : 'Change cost center / GL', poId: str(d.poId), poNumber: str(d.poNumber), recNo: str(d.recNo), vendorName: str(d.vendorName), value: Number(d.valueBase) || 0, status: str(d.status), statusLabel: ADJUST_STATUS[str(d.status)] ?? str(d.status), reason: str(d.reason), createdByName: str(d.createdByName), createdAt: str(d.createdAt), lines: objs(d.lines), journals: Array.isArray(d.journals) ? d.journals : [] };
}

// ----- Inventory: purchase orders waiting for the warehouses a person receives into -----

async function receivingWarehouses(ctx: OrgContext) {
    const [units, scope, whs] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(`organizations/${ctx.orgId}/warehouses`)]);
    const mine = whs.filter((w) => units.get(w.id) && permAt(ctx, 'INV.receive', w.id, units, scope));
    return {
        units,
        list: mine.map((w) => ({ id: w.id, code: units.get(w.id)!.code, name: units.get(w.id)!.name || str(w.data.name), leId: leOf(units, w.id)?.id ?? '', categories: Array.isArray(w.data.materialCategoryCodes) ? (w.data.materialCategoryCodes as unknown[]).map(str) : str(w.data.materialCategoryCode) ? [str(w.data.materialCategoryCode)] : [] })),
    };
}

/** Lines of an order a warehouse receives: stock for that warehouse, or non-stock materials and assets of a category the warehouse is mapped to (same legal entity). */
function linesForWarehouses(po: Obj, whs: Array<{ id: string; leId: string; categories: string[] }>, units: Map<string, Unit>, isWh: Set<string>) {
    const out: Array<{ no: number; warehouseId: string; kind: string }> = [];
    for (const l of objs(po.lines)) {
        const cc = ccOf(l);
        const type = str(l.type);
        if (type === 'service') continue;
        if (type === 'material' && isWh.has(cc)) {
            const w = whs.find((x) => x.id === cc);
            if (w) out.push({ no: Number(l.no), warehouseId: w.id, kind: 'stock' });
            continue;
        }
        const le = leOf(units, cc)?.id ?? '';
        const w = whs.find((x) => x.leId === le && x.categories.includes(str(l.categoryCode)));
        if (w) out.push({ no: Number(l.no), warehouseId: w.id, kind: type === 'asset' ? 'asset' : 'direct' });
    }
    return out;
}

async function pendingFor(ctx: OrgContext) {
    const { units, list } = await receivingWarehouses(ctx);
    const allWh = new Set((await listDocs(`organizations/${ctx.orgId}/warehouses`)).map((w) => w.id));
    const orders = (await listDocs(ordersPath(ctx.orgId))).filter((p) => PLACED.includes(str(p.data.status)));
    return { units, list, allWh, orders };
}

// ----- Routes -----

export const apRoutes = {
    // ===== Inventory > Pending POs (a mirror of receiving for the warehouse; no prices, no procurement or finance access) =====
    'POST /api/org/inventory/receipts/pending': [
        orgRoute('org.inventory.receipts.pending', 'INV.receive', async (ctx) => {
            const { units, list, allWh, orders } = await pendingFor(ctx);
            const rows: Obj[] = [];
            for (const p of orders) {
                const mine = linesForWarehouses(p.data, list, units, allWh);
                if (!mine.length) continue;
                const lines = objs(p.data.lines).filter((l) => mine.some((m) => m.no === Number(l.no)));
                const pending = lines.filter((l) => outstanding(l) > 0);
                const showDone = ctx.body.includeDone === true;
                if (!pending.length && !showDone) continue;
                const due = lines.map((l) => str(l.dateRequired)).filter(Boolean).sort()[0] ?? '';
                rows.push({
                    poId: p.id,
                    poNumber: str(p.data.number) || p.id,
                    vendorName: str(p.data.vendorName),
                    status: str(p.data.status),
                    approvedAt: str(p.data.approvedAt),
                    warehouses: Array.from(new Set(mine.map((m) => list.find((w) => w.id === m.warehouseId)?.code ?? m.warehouseId))).join(', '),
                    lines: lines.length,
                    pendingLines: pending.length,
                    progressPct: deliveryProgress(lines).pct,
                    dueDate: due,
                    overdue: !!due && due < today() && pending.length > 0,
                    receipts: objs(p.data.deliveries).filter((x) => objs(x.lines).some((y) => mine.some((m) => m.no === Number(y.no)))).length,
                });
            }
            return { rows: rows.sort((a, b) => str(a.dueDate || '9').localeCompare(str(b.dueDate || '9'))), warehouses: list.map((w) => ({ id: w.id, code: w.code, name: w.name })) };
        }),
    ],
    'POST /api/org/inventory/receipts/po': [
        orgRoute('org.inventory.receipts.po', 'INV.receive', async (ctx) => {
            const { units, list, allWh } = await pendingFor(ctx);
            const doc = await loadOrder(ctx.orgId, str(ctx.body.poId));
            const mine = linesForWarehouses(doc.data, list, units, allWh);
            if (!mine.length) throw new HttpError(404, 'Purchase order not found.');
            const plan = await receiptPlan(ctx.orgId, doc.data);
            const lines = objs(doc.data.lines)
                .filter((l) => mine.some((m) => m.no === Number(l.no)))
                .map((l) => {
                    const m = mine.find((x) => x.no === Number(l.no))!;
                    const p = plan.find((x) => Number(x.no) === Number(l.no)) ?? {};
                    return { no: Number(l.no), item: str(l.itemName) || str(l.requirement), itemCode: str(l.itemCode), unit: str(l.unit), ordered: Number(l.quantity) || 0, received: Number(l.receivedQty) || 0, outstanding: outstanding(l), dateRequired: str(l.dateRequired), kind: m.kind, warehouseId: m.warehouseId, warehouseCode: list.find((w) => w.id === m.warehouseId)?.code ?? '', materialId: str(p.materialId), materialNumber: str(p.materialNumber), materialName: str(p.materialName), options: objs(p.options).map((x) => ({ id: str(x.id), number: str(x.number), name: str(x.name) })), finance: str(p.finance), costCenterCode: str(p.costCenterCode) };
                });
            const nos = new Set(lines.map((l) => l.no));
            const receipts = objs(doc.data.deliveries)
                .filter((x) => objs(x.lines).some((y) => nos.has(Number(y.no))))
                .map((x) => ({ id: str(x.id), recNo: recNoOf(x), date: str(x.date), ref: str(x.ref), byName: str(x.byName), status: receiptLive(x) ? 'posted' : 'reversed', via: str(x.via), lines: objs(x.lines).filter((y) => nos.has(Number(y.no))).map((y) => ({ no: Number(y.no), qty: Number(y.qty) || 0, reversedQty: Number(y.reversedQty) || 0 })) }));
            await record(ctx, 'org.inventory.receipts.view', doc.id, `${lines.length} line(s) for the warehouse`);
            return { poId: doc.id, poNumber: str(doc.data.number) || doc.id, vendorName: str(doc.data.vendorName), status: str(doc.data.status), receivable: DELIVERING.includes(str(doc.data.status)), lines, receipts, progress: deliveryProgress(objs(doc.data.lines).filter((l) => nos.has(Number(l.no)))) };
        }),
    ],
    'POST /api/org/inventory/receipts/receive': [
        orgRoute('org.inventory.receipts.receive', 'INV.receive', async (ctx) => {
            const { units, list, allWh } = await pendingFor(ctx);
            const doc = await loadOrder(ctx.orgId, str(ctx.body.poId));
            const mine = linesForWarehouses(doc.data, list, units, allWh);
            if (!mine.length) throw new HttpError(404, 'Purchase order not found.');
            return recordDelivery(ctx, doc, ctx.body, 'inventory', new Set(mine.map((m) => m.no)));
        }),
    ],

    // ===== Supplier invoices =====
    'POST /api/org/fin/ap/invoices/prepare': [
        orgRoute('org.fin.ap.invoices.prepare', 'FIN.ap.capture', async (ctx) => {
            const po = await loadOrder(ctx.orgId, str(ctx.body.poId));
            const scope = str(ctx.body.scope) === 'order' ? 'order' : 'receipt';
            const draft = await draftInvoice(ctx, po, { scope, deliveryId: str(ctx.body.deliveryId), number: '', amount: 0, tax: 0, date: today(), reason: '' });
            if (!(await leAllowed(ctx, 'FIN.ap.capture', draft.leId))) throw new HttpError(403, 'You do not capture invoices for this legal entity.');
            const authority = await getAuthority(ctx.orgId);
            return { poId: po.id, poNumber: str(po.data.number) || po.id, vendorName: str(po.data.vendorName), currency: str(po.data.currency), scope, orderScopeAllowed: str(po.data.status) === 'full', expected: draft.expected, lines: draft.lines, recNos: draft.deliveries.map(recNoOf), tolerancePct: authority.controls.matchTolerancePct, blocking: draft.checks.filter((c) => c.result === 'fail' && ['match.receipt', 'match.entity', 'match.order'].includes(c.code)) };
        }),
    ],
    'POST /api/org/fin/ap/invoices/create': [
        orgRoute('org.fin.ap.invoices.create', 'FIN.ap.capture', async (ctx) => {
            const v = readInvoiceBody(ctx.body);
            const { cleanFile, storeFiles } = await import('./poFinance');
            if (!ctx.body.file) throw new HttpError(400, "Attach the supplier's invoice (PDF, JPEG or PNG).");
            const file = cleanFile({ ...o(ctx.body.file), kind: 'invoice' }, ['invoice']);
            const po = await loadOrder(ctx.orgId, str(ctx.body.poId));
            return withLock(ctx.orgId, `ap_invoice_${baseOf(po.id)}`, async () => {
                const fresh = await loadOrder(ctx.orgId, po.id);
                const draft = await draftInvoice(ctx, fresh, v);
                if (!(await leAllowed(ctx, 'FIN.ap.capture', draft.leId))) throw new HttpError(403, 'You do not capture invoices for this legal entity.');
                const hard = draft.checks.filter((c) => c.result === 'fail' && ['match.receipt', 'match.entity', 'match.order', 'match.duplicate'].includes(c.code));
                if (hard.length) throw new HttpError(409, hard.map((c) => c.detail).join(' '));
                const id = await docNoFor(ctx.orgId, 'INV');
                const [stored] = await storeFiles(ctx, fresh.id, [file], v.number);
                const fails = draft.checks.filter((c) => c.result === 'fail');
                const base = await toOrgCurrency(ctx, v.amount, str(fresh.data.currency));
                const route = fails.length ? null : await routeApproval(ctx, base);
                const routeFail = route && route.problems.length && ctx.testMode !== true ? route.problems.join(' ') : '';
                const checks = routeFail ? [...draft.checks, { code: 'match.route', label: 'Approval route', result: 'fail' as const, detail: routeFail }] : draft.checks;
                const status = fails.length || routeFail ? 'on_hold' : 'pending_approval';
                const at = nowIso();
                const terms = Number(fresh.data.paymentTermsDays) || Number((`${str(fresh.data.paymentTermsLabel)} ${str(fresh.data.paymentTermsCode)}`.match(/(\d{1,3})\s*(day|d\b)/i) ?? [])[1]) || Number((str(fresh.data.paymentTermsLabel).match(/net\s*(\d{1,3})/i) ?? [])[1]) || 0;
                const entity = draft.leId ? await entityOf(ctx.orgId, draft.leId) : null;
                const inv: Obj = {
                    id, supplierInvoiceNo: v.number, poId: fresh.id, poBase: baseOf(fresh.id), poNumber: str(fresh.data.number) || fresh.id, vendorId: str(fresh.data.vendorId), vendorName: str(fresh.data.vendorName), currency: str(fresh.data.currency),
                    legalEntityId: draft.leId, leCurrency: str(entity?.functionalCurrency), scope: v.scope, deliveryIds: draft.deliveries.map((x) => str(x.id)), recNos: draft.deliveries.map(recNoOf), lines: draft.lines, goods: draft.goods, expected: draft.expected,
                    amount: v.amount, taxAmount: v.tax, variancePct: variancePct(v.amount, draft.expected.total), varianceReason: v.reason, date: v.date, dueDate: terms ? addDays(v.date, terms) : '', note: v.note, file: { id: str(stored.id), name: str(stored.name) },
                    checks, status, grir: draft.grir, varianceCc: draft.varianceCc, rate: draft.rate, amountBase: base,
                    approval: route ? { amount: base, steps: route.steps, authorityVersion: route.authorityVersion, problems: route.problems } : { amount: base, steps: [], problems: [] },
                    conflictUids: Array.from(new Set(draft.deliveries.map((x) => str(x.by)).filter(Boolean))),
                    createdBy: ctx.uid, createdByName: nameOfUser(ctx.me), createdAt: at, updatedAt: at, paid: 0, outstanding: 0, payments: [],
                    history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: status === 'on_hold' ? 'recorded: on hold' : 'recorded and sent for approval', note: fails.map((c) => c.label).join(', ') }],
                };
                if (!(await writeDoc(`${P(ctx.orgId).invoices}/${id}`, inv, { exists: false }))) throw new HttpError(409, 'Could not record the invoice. Try again.');
                await claimReceipts(ctx, fresh.id, id, draft.deliveries.map((x) => str(x.id)), draft.lines, true);
                await record(ctx, 'org.ap.invoice.create', id, `${v.number} ${str(fresh.data.currency)} ${fmt(v.amount)} on ${fresh.id} (${inv.recNos}); ${status}${fails.length ? `: ${fails.map((c) => c.label).join(', ')}` : ''}`.slice(0, 400));
                return { ok: true, id, status, checks };
            });
        }),
    ],
    'POST /api/org/fin/ap/invoices/recheck': [
        orgRoute('org.fin.ap.invoices.recheck', 'FIN.ap.capture', async (ctx) => {
            const id = str(ctx.body.id);
            if (!DOC_NO.INV.test(id)) throw new HttpError(404, 'Invoice not found.');
            const path = `${P(ctx.orgId).invoices}/${id}`;
            return withLock(ctx.orgId, `ap_${id}`, async () => {
                const doc = await getDoc(path);
                if (!doc || str(doc.data.status) !== 'on_hold') throw new HttpError(409, 'Only an invoice on hold is checked again.');
                const d = doc.data;
                const reason = cleanText(ctx.body.varianceReason).slice(0, 300) || str(d.varianceReason);
                const po = await loadOrder(ctx.orgId, str(d.poId));
                const draft = await draftInvoice(ctx, po, { scope: str(d.scope), deliveryId: str((d.deliveryIds as unknown[])?.[0]), number: str(d.supplierInvoiceNo), amount: Number(d.amount), tax: Number(d.taxAmount), date: str(d.date), reason }, id);
                const fails = draft.checks.filter((c) => c.result === 'fail');
                const route = fails.length ? null : await routeApproval(ctx, Number(d.amountBase) || 0);
                const routeFail = route && route.problems.length && ctx.testMode !== true ? route.problems.join(' ') : '';
                const status = fails.length || routeFail ? 'on_hold' : 'pending_approval';
                const at = nowIso();
                await writeDoc(path, { ...d, varianceReason: reason, checks: routeFail ? [...draft.checks, { code: 'match.route', label: 'Approval route', result: 'fail', detail: routeFail }] : draft.checks, status, approval: route ? { amount: Number(d.amountBase) || 0, steps: route.steps, authorityVersion: route.authorityVersion, problems: route.problems } : d.approval, updatedAt: at, history: [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'checked again', note: status }] });
                await record(ctx, 'org.ap.invoice.recheck', id, status);
                return { ok: true, id, status };
            });
        }),
    ],
    'POST /api/org/fin/ap/invoices/withdraw': [
        orgRoute('org.fin.ap.invoices.withdraw', 'FIN.ap.capture', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = cleanText(ctx.body.reason).slice(0, 300);
            if (reason.length < 10) throw new HttpError(400, 'Give the reason (at least 10 characters).');
            const path = `${P(ctx.orgId).invoices}/${id}`;
            const doc = await getDoc(path);
            if (!doc || !DOC_NO.INV.test(id)) throw new HttpError(404, 'Invoice not found.');
            if (!['on_hold', 'pending_approval'].includes(str(doc.data.status))) throw new HttpError(409, 'Only an invoice not yet posted can be withdrawn. A posted invoice is reversed by an approver.');
            const at = nowIso();
            await writeDoc(path, { ...doc.data, status: 'cancelled', cancelReason: reason, updatedAt: at, history: [...objs(doc.data.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'withdrawn', note: reason }] });
            await claimReceipts(ctx, str(doc.data.poId), id, (doc.data.deliveryIds as string[]) ?? [], objs(doc.data.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) || 0 })), false);
            await record(ctx, 'org.ap.invoice.withdraw', id, reason);
            return { ok: true, id, status: 'cancelled' };
        }),
    ],
    'POST /api/org/fin/ap/invoices/reverse': [
        orgRoute('org.fin.ap.invoices.reverse', 'FIN.ap.approve', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = cleanText(ctx.body.reason).slice(0, 300);
            if (reason.length < 20) throw new HttpError(400, 'Give the reason for reversing a posted invoice (at least 20 characters).');
            const path = `${P(ctx.orgId).invoices}/${id}`;
            return withLock(ctx.orgId, `ap_${id}`, async () => {
                const doc = await getDoc(path);
                if (!doc || !DOC_NO.INV.test(id)) throw new HttpError(404, 'Invoice not found.');
                const d = doc.data;
                if (str(d.status) !== 'posted' || (Number(d.paid) || 0) > 0) throw new HttpError(409, 'Only a posted invoice with nothing paid can be reversed.');
                if (objs(d.payments).some((p) => str(p.status) === 'pending_approval') || (Number(d.reserved) || 0) > 0) throw new HttpError(409, 'A payment of this invoice is in approval. It must be decided first.');
                if (str(d.createdBy) === ctx.uid && !bypass(ctx, 'ap.reverse_independence')) throw new HttpError(403, 'You recorded this invoice, so someone else must reverse it.');
                const lines = objs(d.postedLines).map((l) => ({ side: (str(l.side) === 'D' ? 'C' : 'D') as 'D' | 'C', glCode: str(l.glCode), ccId: str(l.ccId), amount: Number(l.amount) || 0, docAmount: Number(l.docAmount) || 0, description: `Reversal of ${id}`, ref: id }));
                const posted = await post(ctx, { leId: str(d.legalEntityId), type: 'AP_INVOICE', date: today(), docCurrency: str(d.currency), fxRate: Number(d.postedRate) || 1, lines, narrative: `Reversal of supplier invoice ${str(d.supplierInvoiceNo)} (${id}): ${reason}`.slice(0, 300), source: { kind: 'ap_invoice', id, ref: `REV ${str(d.supplierInvoiceNo)}`, route: `organization_home/fin_ap/invoices/${id}` }, trace: { invoiceId: id, poId: str(d.poId) }, sourceKey: `APINVX_${id}`, approvalRef: id });
                const at = nowIso();
                await writeDoc(path, { ...d, status: 'cancelled', cancelReason: reason, reversalJournalId: posted.id, outstanding: 0, updatedAt: at, history: [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'reversed', note: `${reason}; journal ${posted.id}` }] });
                await claimReceipts(ctx, str(d.poId), id, (d.deliveryIds as string[]) ?? [], objs(d.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) || 0 })), false);
                await record(ctx, 'org.ap.invoice.reverse', id, `${reason}; journal ${posted.id}`.slice(0, 400));
                return { ok: true, id, status: 'cancelled', journalId: posted.id };
            });
        }),
    ],
    'POST /api/org/fin/ap/invoices/decide': [
        orgRoute('org.fin.ap.invoices.decide', 'FIN.ap.approve', async (ctx) => {
            const id = str(ctx.body.id);
            if (!DOC_NO.INV.test(id)) throw new HttpError(404, 'Invoice not found.');
            const out = await decide(ctx, `${P(ctx.orgId).invoices}/${id}`, 'FIN.ap.approve', (d) => finalPostInvoice(ctx, id, d), async () => ({}), 'Invoice');
            if (out.status === 'rejected') {
                const d = (await getDoc(`${P(ctx.orgId).invoices}/${id}`))!.data;
                await claimReceipts(ctx, str(d.poId), id, (d.deliveryIds as string[]) ?? [], objs(d.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) || 0 })), false);
            }
            return out;
        }),
    ],
    'POST /api/org/fin/ap/invoices/list': [
        orgRoute('org.fin.ap.invoices.list', 'FIN.ap.view', async (ctx) => {
            const [units, scope, docs] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(P(ctx.orgId).invoices)]);
            const rows = docs.filter((x) => ctx.role === 'org_super_admin' || permAt(ctx, 'FIN.ap.view', str(x.data.legalEntityId), units, scope)).map((x) => ({ ...invoiceRow(x.id, x.data), canDecide: decider(ctx, x.data, 'FIN.ap.approve').ok }));
            return { rows: rows.sort((a, b) => b.id.localeCompare(a.id)) };
        }),
    ],
    'POST /api/org/fin/ap/invoices/get': [
        orgRoute('org.fin.ap.invoices.get', 'FIN.ap.view', async (ctx) => {
            const id = str(ctx.body.id);
            const doc = DOC_NO.INV.test(id) ? await getDoc(`${P(ctx.orgId).invoices}/${id}`) : null;
            if (!doc || !(await leAllowed(ctx, 'FIN.ap.view', str(doc.data.legalEntityId)))) throw new HttpError(404, 'Invoice not found.');
            const d = doc.data;
            const who = decider(ctx, d, 'FIN.ap.approve');
            await record(ctx, 'org.ap.invoice.view', id, '');
            return {
                ...invoiceRow(id, d),
                lines: objs(d.lines),
                expectedDetail: o(d.expected),
                varianceReason: str(d.varianceReason),
                note: str(d.note),
                file: o(d.file),
                checks: objs(d.checks),
                steps: stepsOf(d),
                approvalAmount: Number(o(d.approval).amount) || 0,
                orgCurrency: str(ctx.org.data.currencyCode),
                history: objs(d.history),
                payments: objs(d.payments),
                rejectReason: str(d.rejectReason),
                cancelReason: str(d.cancelReason),
                can: { decide: who.ok, why: who.why, recheck: str(d.status) === 'on_hold' && can(ctx, 'FIN.ap.capture'), withdraw: ['on_hold', 'pending_approval'].includes(str(d.status)) && can(ctx, 'FIN.ap.capture'), reverse: str(d.status) === 'posted' && !(Number(d.paid) > 0) && can(ctx, 'FIN.ap.approve') && str(d.createdBy) !== ctx.uid },
            };
        }),
    ],
    'POST /api/org/fin/ap/file': [
        orgRoute('org.fin.ap.file', 'FIN.ap.view', async (ctx) => {
            const f = await getDoc(`${P(ctx.orgId).files}/${str(ctx.body.fileId)}`);
            if (!f || !['invoice', 'delivery_note', 'payment_proof'].includes(str(f.data.kind))) throw new HttpError(404, 'File not found.');
            await record(ctx, 'org.ap.file.view', str(f.data.poId), `${str(f.data.kind)}: ${str(f.data.name)}`.slice(0, 200));
            return { name: str(f.data.name), type: str(f.data.type), data: str(f.data.data), kind: str(f.data.kind) };
        }),
    ],

    // ===== Payments =====
    'POST /api/org/fin/ap/payments/options': [
        orgRoute('org.fin.ap.payments.options', 'FIN.ap.pay', async (ctx) => {
            const [units, scope, docs] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(P(ctx.orgId).invoices)]);
            const open = docs.filter((x) => PAYABLE_INVOICE.includes(str(x.data.status)) && (ctx.role === 'org_super_admin' || permAt(ctx, 'FIN.ap.pay', str(x.data.legalEntityId), units, scope)));
            return {
                methods: Object.entries(PAY_METHODS).map(([value, label]) => ({ value, label })),
                invoices: open.map((x) => ({ ...invoiceRow(x.id, x.data), vendorId: str(x.data.vendorId), legalEntityId: str(x.data.legalEntityId), legalEntityCode: units.get(str(x.data.legalEntityId))?.code ?? '', available: r2((Number(x.data.outstanding) || 0) - (Number(x.data.reserved) || 0)) })).filter((x) => x.available > 0),
            };
        }),
    ],
    'POST /api/org/fin/ap/payments/create': [
        orgRoute('org.fin.ap.payments.create', 'FIN.ap.pay', async (ctx) => {
            const alloc = objs(ctx.body.invoices).map((x) => ({ id: str(x.id), amount: r2(Number(x.amount)) }));
            if (!alloc.length || alloc.length > 50) throw new HttpError(400, 'Choose one to 50 invoices to pay.');
            if (alloc.some((a) => !DOC_NO.INV.test(a.id) || !(a.amount > 0))) throw new HttpError(400, 'Enter an amount above zero for every invoice.');
            if (new Set(alloc.map((a) => a.id)).size !== alloc.length) throw new HttpError(400, 'An invoice is listed twice.');
            const date = str(ctx.body.date);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today()) throw new HttpError(400, 'Enter the payment date, today or later.');
            const method = str(ctx.body.method);
            if (!PAY_METHODS[method]) throw new HttpError(400, 'Choose how the supplier is paid.');
            const wht = r2(Number(ctx.body.whtAmount ?? 0));
            const note = cleanText(ctx.body.note).slice(0, 300);
            const reference = oneLine(ctx.body.reference, 60);
            return withLock(ctx.orgId, 'ap_payments', async () => {
                const docs = await Promise.all(alloc.map(async (a) => ({ a, doc: await getDoc(`${P(ctx.orgId).invoices}/${a.id}`) })));
                for (const { a, doc } of docs) {
                    if (!doc || !PAYABLE_INVOICE.includes(str(doc.data.status))) throw new HttpError(409, `${a.id} is not approved and posted, so it cannot be paid.`);
                    const available = r2((Number(doc.data.outstanding) || 0) - (Number(doc.data.reserved) || 0));
                    if (a.amount > available + 0.005) throw new HttpError(409, `${a.id}: only ${fmt(available)} is open for payment.`);
                }
                const first = docs[0].doc!.data;
                if (docs.some(({ doc }) => str(doc!.data.vendorId) !== str(first.vendorId) || str(doc!.data.currency) !== str(first.currency) || str(doc!.data.legalEntityId) !== str(first.legalEntityId))) throw new HttpError(400, 'A payment is for one supplier, in one currency and from one legal entity.');
                const leId = str(first.legalEntityId);
                if (!(await leAllowed(ctx, 'FIN.ap.pay', leId))) throw new HttpError(403, 'You do not prepare payments for this legal entity.');
                const gross = r2(alloc.reduce((s, a) => s + a.amount, 0));
                if (!(wht >= 0) || wht >= gross) throw new HttpError(400, 'Withholding tax must be zero or more and less than the payment.');
                if (wht > 0 && cleanText(ctx.body.whtNote).length < 3) throw new HttpError(400, 'Say what the withholding tax is for (for example the rate and type).');
                if ((await financeState(ctx.orgId, leId)) !== 'live') throw new HttpError(409, 'Finance is not live for this legal entity, so payments cannot be posted.');
                const map = await mappingOf(ctx.orgId, leId);
                for (const role of ['SUPPLIER_PAYABLE', 'BANK', ...(wht > 0 ? ['WHT_PAYABLE'] : [])]) roleAccount(map, role, '', { event: 'AP_PAYMENT' });
                const base = await toOrgCurrency(ctx, gross, str(first.currency));
                const route = await routeApproval(ctx, base);
                if (route.problems.length && ctx.testMode !== true) throw new HttpError(409, route.problems.join(' '));
                const id = await docNoFor(ctx.orgId, 'PAY');
                const at = nowIso();
                const pay: Obj = {
                    id, vendorId: str(first.vendorId), vendorName: str(first.vendorName), currency: str(first.currency), legalEntityId: leId, invoices: alloc, gross, wht, whtNote: cleanText(ctx.body.whtNote).slice(0, 120), net: r2(gross - wht), date, method, reference, note,
                    status: 'pending_approval', approval: { amount: base, steps: route.steps, authorityVersion: route.authorityVersion, problems: route.problems }, amountBase: base,
                    conflictUids: Array.from(new Set(docs.map(({ doc }) => str(doc!.data.createdBy)))),
                    createdBy: ctx.uid, createdByName: nameOfUser(ctx.me), createdAt: at, updatedAt: at,
                    history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'prepared and sent for approval', note }],
                };
                if (!(await writeDoc(`${P(ctx.orgId).payments}/${id}`, pay, { exists: false }))) throw new HttpError(409, 'Could not record the payment. Try again.');
                for (const { a, doc } of docs) await writeDoc(`${P(ctx.orgId).invoices}/${a.id}`, { ...doc!.data, reserved: r2((Number(doc!.data.reserved) || 0) + a.amount), payments: [...objs(doc!.data.payments), { id, amount: a.amount, status: 'pending_approval', at }], updatedAt: at });
                await record(ctx, 'org.ap.payment.create', id, `${str(first.vendorName)} ${str(first.currency)} ${fmt(gross)} (WHT ${fmt(wht)}) for ${alloc.map((a) => a.id).join(', ')}`.slice(0, 400));
                return { ok: true, id, status: 'pending_approval' };
            });
        }),
    ],
    'POST /api/org/fin/ap/payments/decide': [
        orgRoute('org.fin.ap.payments.decide', 'FIN.ap.payapprove', async (ctx) => {
            const id = str(ctx.body.id);
            if (!DOC_NO.PAY.test(id)) throw new HttpError(404, 'Payment not found.');
            const settle = async (d: Obj, paid: boolean) => {
                const at = nowIso();
                for (const a of objs(d.invoices)) {
                    const doc = await getDoc(`${P(ctx.orgId).invoices}/${str(a.id)}`);
                    if (!doc) continue;
                    const amount = Number(a.amount) || 0;
                    const reserved = Math.max(0, r2((Number(doc.data.reserved) || 0) - amount));
                    const payments = objs(doc.data.payments).map((p) => (str(p.id) === id ? { ...p, status: paid ? 'paid' : 'rejected', decidedAt: at } : p));
                    if (paid) {
                        const s = invoiceAfterPayment(Number(doc.data.amount) || 0, (Number(doc.data.paid) || 0) + amount);
                        await writeDoc(`${P(ctx.orgId).invoices}/${doc.id}`, { ...doc.data, reserved, payments, paid: s.paid, outstanding: s.outstanding, status: s.status, updatedAt: at });
                    } else await writeDoc(`${P(ctx.orgId).invoices}/${doc.id}`, { ...doc.data, reserved, payments, updatedAt: at });
                }
            };
            return decide(
                ctx,
                `${P(ctx.orgId).payments}/${id}`,
                'FIN.ap.payapprove',
                async (d) => {
                    const leId = str(d.legalEntityId);
                    const map = await mappingOf(ctx.orgId, leId);
                    const entity = await entityOf(ctx.orgId, leId);
                    const rate = await fxRate(str(d.currency), entity.functionalCurrency || str(d.currency)).catch(() => 1);
                    const lines = apPaymentLines({ gross: Number(d.gross) || 0, wht: Number(d.wht) || 0, rate, accounts: { payable: roleAccount(map, 'SUPPLIER_PAYABLE', '', { event: 'AP_PAYMENT' }), bank: roleAccount(map, 'BANK', '', { event: 'AP_PAYMENT' }), wht: Number(d.wht) > 0 ? roleAccount(map, 'WHT_PAYABLE', '', { event: 'AP_PAYMENT' }) : '' }, ref: id });
                    const posted = await post(ctx, { leId, type: 'AP_PAYMENT', date: today(), docCurrency: str(d.currency), fxRate: rate, lines: lines.map((l) => ({ ...l, ccId: '' })), narrative: `Payment ${id} to ${str(d.vendorName)} (${PAY_METHODS[str(d.method)]}${str(d.reference) ? ` ${str(d.reference)}` : ''})`, source: { kind: 'ap_payment', id, ref: str(d.reference) || id, route: `organization_home/fin_ap/payments/${id}` }, trace: { paymentId: id, invoices: d.invoices, vendorId: str(d.vendorId) }, sourceKey: `APPAY_${id}`, approvalRef: id });
                    await settle(d, true);
                    return { status: 'paid', journalId: posted.id, paidAt: nowIso() };
                },
                async (d) => {
                    await settle(d, false);
                    return {};
                },
                'Payment'
            );
        }),
    ],
    'POST /api/org/fin/ap/payments/list': [
        orgRoute('org.fin.ap.payments.list', 'FIN.ap.view', async (ctx) => {
            const [units, scope, docs] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(P(ctx.orgId).payments)]);
            return {
                rows: docs
                    .filter((x) => ctx.role === 'org_super_admin' || permAt(ctx, 'FIN.ap.view', str(x.data.legalEntityId), units, scope))
                    .map((x) => ({ id: x.id, vendorName: str(x.data.vendorName), currency: str(x.data.currency), gross: Number(x.data.gross) || 0, wht: Number(x.data.wht) || 0, net: Number(x.data.net) || 0, date: str(x.data.date), method: PAY_METHODS[str(x.data.method)] ?? str(x.data.method), reference: str(x.data.reference), invoices: objs(x.data.invoices).map((i) => str(i.id)).join(', '), status: str(x.data.status), statusLabel: PAYMENT_STATUS[str(x.data.status)] ?? str(x.data.status), journalId: str(x.data.journalId), createdByName: str(x.data.createdByName), createdAt: str(x.data.createdAt), canDecide: decider(ctx, x.data, 'FIN.ap.payapprove').ok, steps: stepsOf(x.data), why: decider(ctx, x.data, 'FIN.ap.payapprove').why }))
                    .sort((a, b) => b.id.localeCompare(a.id)),
            };
        }),
    ],
    'POST /api/org/fin/ap/dashboard': [
        orgRoute('org.fin.ap.dashboard', 'FIN.ap.view', async (ctx) => {
            const [units, scope, invs, pays] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx), listDocs(P(ctx.orgId).invoices), listDocs(P(ctx.orgId).payments)]);
            const mine = (x: Doc) => ctx.role === 'org_super_admin' || permAt(ctx, 'FIN.ap.view', str(x.data.legalEntityId), units, scope);
            const vis = invs.filter(mine);
            const counts: Record<string, number> = {};
            for (const x of vis) counts[str(x.data.status)] = (counts[str(x.data.status)] || 0) + 1;
            const t = today();
            const aging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
            const byVendor = new Map<string, { vendor: string; currency: string; outstanding: number; invoices: number }>();
            for (const x of vis.filter((y) => PAYABLE_INVOICE.includes(str(y.data.status)))) {
                const out = Number(x.data.outstanding) || 0;
                const due = str(x.data.dueDate) || str(x.data.date);
                const late = due && due < t ? Math.floor((Date.parse(t) - Date.parse(due)) / 86_400_000) : 0;
                if (late <= 0) aging.current += out;
                else if (late <= 30) aging.d30 += out;
                else if (late <= 60) aging.d60 += out;
                else if (late <= 90) aging.d90 += out;
                else aging.over90 += out;
                const k = `${str(x.data.vendorId)}|${str(x.data.currency)}`;
                const v = byVendor.get(k) ?? { vendor: str(x.data.vendorName), currency: str(x.data.currency), outstanding: 0, invoices: 0 };
                byVendor.set(k, { ...v, outstanding: r2(v.outstanding + out), invoices: v.invoices + 1 });
            }
            return { counts, aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, r2(v)])), vendors: Array.from(byVendor.values()).sort((a, b) => b.outstanding - a.outstanding), paymentsPending: pays.filter(mine).filter((p) => str(p.data.status) === 'pending_approval').length };
        }),
    ],

    // ===== Receipt adjustments: reverse a receipt or change where it posted, before payment =====
    'POST /api/org/fin/ap/adjust/request': [
        orgRoute('org.fin.ap.adjust.request', 'PRC.receipt.adjust', async (ctx) => {
            const kind = str(ctx.body.kind) === 'repost' ? 'repost' : str(ctx.body.kind) === 'reverse' ? 'reverse' : '';
            if (!kind) throw new HttpError(400, 'Choose to reverse the receipt or to change its cost center and GL account.');
            const reason = cleanText(ctx.body.reason).slice(0, 400);
            if (reason.length < 20) throw new HttpError(400, 'Give the reason in at least 20 characters.');
            const po = await loadOrder(ctx.orgId, str(ctx.body.poId));
            const d = po.data;
            const dv = objs(d.deliveries).find((x) => str(x.id) === str(ctx.body.deliveryId));
            if (!dv) throw new HttpError(404, 'Receipt not found.');
            if (str(dv.kind) === 'service' || str(d.poType) === 'service') throw new HttpError(409, 'Service receipts are corrected by rejecting and re-recording the service, not here.');
            if (!receiptLive(dv)) throw new HttpError(409, 'This receipt is already reversed.');
            const invId = str(dv.invoiceId);
            if (invId) {
                const inv = DOC_NO.INV.test(invId) ? await getDoc(`${P(ctx.orgId).invoices}/${invId}`) : null;
                const st = str(inv?.data.status) || 'recorded';
                if (['paid', 'part_paid'].includes(st)) throw new HttpError(409, `This receipt is paid through ${invId}. It cannot be changed after payment.`);
                if (!inv || LIVE_INVOICE.includes(st)) throw new HttpError(409, `This receipt is on invoice ${invId} (${INVOICE_STATUS[st] ?? st}). Withdraw or reverse the invoice first.`);
            }
            const recNo = recNoOf(dv);
            const open = (await runQuery({ from: [{ collectionId: 'receipt_adjustments' }], where: fieldEq('deliveryId', str(dv.id)) }, `organizations/${ctx.orgId}`)).find((x) => str(x.data.status) === 'pending_approval');
            if (open) throw new HttpError(409, `${open.id} for this receipt is already in approval.`);
            const units = await unitsOf(ctx.orgId);
            const { posted } = await postedOf(ctx.orgId, d, dv, units);
            let lines: Obj[] = [];
            let docValue = 0;
            if (kind === 'reverse') {
                const want = objs(ctx.body.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) })).filter((l) => l.qty > 0);
                if (!want.length) throw new HttpError(400, 'Enter the quantity to reverse on at least one line.');
                for (const w of want) {
                    const g = objs(dv.lines).find((x) => Number(x.no) === w.no);
                    const left = round((Number(g?.qty) || 0) - (Number(g?.reversedQty) || 0), 4);
                    if (!g || w.qty > left + 1e-9) throw new HttpError(400, `Line ${w.no}: only ${left} can be reversed on ${recNo}.`);
                    const pl = objs(d.lines).find((x) => Number(x.no) === w.no);
                    docValue += w.qty * (Number(pl?.netUnitPrice) || 0);
                }
                lines = want;
            } else {
                const want = objs(ctx.body.changes).map((l) => ({ no: Number(l.no), costCenterId: str(l.costCenterId).slice(0, 120), glCode: str(l.glCode).slice(0, 40) }));
                if (!want.length) throw new HttpError(400, 'Choose the new cost center and GL account for at least one line.');
                for (const w of want) {
                    const p = posted.find((x) => x.no === w.no);
                    const g = objs(dv.lines).find((x) => Number(x.no) === w.no);
                    if (!p || !g) throw new HttpError(400, `Line ${w.no} is not on ${recNo}.`);
                    if (p.warehouse) throw new HttpError(400, `Line ${w.no} is warehouse stock: reverse it instead.`);
                    const unit = units.get(w.costCenterId);
                    if (!unit || unit.level !== 'cost_center' || unit.status === 'inactive') throw new HttpError(400, `Line ${w.no}: choose an active cost center.`);
                    if (leOf(units, w.costCenterId)?.id !== p.leId) throw new HttpError(400, `Line ${w.no}: the cost center must be in the same legal entity.`);
                    const glCode = p.type === 'asset' ? '' : w.glCode;
                    if (p.type !== 'asset') await checkChosenGl(ctx.orgId, w.costCenterId, glCode, `Line ${w.no}: `);
                    if (w.costCenterId === p.costCenterId && (p.type === 'asset' || glCode === p.glCode)) throw new HttpError(400, `Line ${w.no}: nothing changes.`);
                    const qty = round((Number(g.qty) || 0) - (Number(g.reversedQty) || 0), 4);
                    const pl = objs(d.lines).find((x) => Number(x.no) === w.no);
                    docValue += qty * (Number(pl?.netUnitPrice) || 0);
                    lines.push({ no: w.no, qty, costCenterId: w.costCenterId, costCenterCode: unit.code, glCode, fromCostCenterId: p.costCenterId, fromCostCenterCode: units.get(p.costCenterId)?.code ?? p.costCenterId, fromGlCode: p.glCode });
                }
            }
            const base = await toOrgCurrency(ctx, r2(docValue), str(d.currency));
            const route = await routeApproval(ctx, base);
            if (route.problems.length && ctx.testMode !== true) throw new HttpError(409, route.problems.join(' '));
            const id = await docNoFor(ctx.orgId, 'RAD');
            const at = nowIso();
            await writeDoc(`${P(ctx.orgId).adjust}/${id}`, {
                id, kind, poId: po.id, poNumber: str(d.number) || po.id, vendorName: str(d.vendorName), currency: str(d.currency), deliveryId: str(dv.id), recNo, lines, reason, valueDoc: r2(docValue), valueBase: base,
                status: 'pending_approval', approval: { amount: base, steps: route.steps, authorityVersion: route.authorityVersion, problems: route.problems }, conflictUids: [str(dv.by)].filter(Boolean),
                createdBy: ctx.uid, createdByName: nameOfUser(ctx.me), createdAt: at, updatedAt: at, history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'requested', note: reason }],
            }, { exists: false });
            await record(ctx, `org.ap.adjust.${kind}.request`, id, `${recNo} on ${po.id}: ${reason}`.slice(0, 400));
            return { ok: true, id, status: 'pending_approval' };
        }),
    ],
    'POST /api/org/fin/ap/adjust/withdraw': [
        orgRoute('org.fin.ap.adjust.withdraw', 'PRC.receipt.adjust', async (ctx) => {
            const id = str(ctx.body.id);
            const doc = DOC_NO.RAD.test(id) ? await getDoc(`${P(ctx.orgId).adjust}/${id}`) : null;
            if (!doc) throw new HttpError(404, 'Request not found.');
            if (str(doc.data.createdBy) !== ctx.uid || str(doc.data.status) !== 'pending_approval') throw new HttpError(409, 'Only your own request in approval can be withdrawn.');
            const at = nowIso();
            await writeDoc(`${P(ctx.orgId).adjust}/${id}`, { ...doc.data, status: 'withdrawn', updatedAt: at, history: [...objs(doc.data.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'withdrawn', note: '' }] });
            await record(ctx, 'org.ap.adjust.withdraw', id, '');
            return { ok: true, id, status: 'withdrawn' };
        }),
    ],
    'POST /api/org/fin/ap/adjust/decide': [
        orgRoute('org.fin.ap.adjust.decide', 'FIN.receipt.approve', async (ctx) => {
            const id = str(ctx.body.id);
            if (!DOC_NO.RAD.test(id)) throw new HttpError(404, 'Request not found.');
            return decide(
                ctx,
                `${P(ctx.orgId).adjust}/${id}`,
                'FIN.receipt.approve',
                async (a) => {
                    // Re-checked at the moment of posting: the receipt must still be in force and not invoiced.
                    const po = await loadOrder(ctx.orgId, str(a.poId));
                    const dv = objs(po.data.deliveries).find((x) => str(x.id) === str(a.deliveryId));
                    if (!dv || !receiptLive(dv)) throw new HttpError(409, 'The receipt is no longer in force.');
                    if (str(dv.invoiceId)) {
                        const inv = await getDoc(`${P(ctx.orgId).invoices}/${str(dv.invoiceId)}`);
                        if (!inv || LIVE_INVOICE.includes(str(inv.data.status))) throw new HttpError(409, `The receipt is now on invoice ${str(dv.invoiceId)}. Reject this request or withdraw the invoice first.`);
                    }
                    const units = await unitsOf(ctx.orgId);
                    const { posted, rates } = await postedOf(ctx.orgId, po.data, dv, units);
                    const lines = objs(a.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) || 0, costCenterId: str(l.costCenterId), glCode: str(l.glCode) }));
                    const res = str(a.kind) === 'reverse' ? await reverseGoods(ctx, { po: po.data, poId: po.id, recNo: str(a.recNo), posted, rates, lines, key: id }) : await repostGoods(ctx, { po: po.data, poId: po.id, recNo: str(a.recNo), posted, rates, changes: lines, key: id });
                    await mutate(ctx, 'po', po.id, `receipt.${str(a.kind)}`, async (d) => {
                        const deliveries = objs(d.deliveries).map((x) => {
                            if (str(x.id) !== str(a.deliveryId)) return x;
                            if (str(a.kind) === 'reverse') {
                                const xl = objs(x.lines).map((y) => {
                                    const r = lines.find((q) => q.no === Number(y.no));
                                    return r ? { ...y, reversedQty: round((Number(y.reversedQty) || 0) + r.qty, 4) } : y;
                                });
                                const nx = { ...x, lines: xl, adjustments: [...(Array.isArray(x.adjustments) ? x.adjustments : []), id] };
                                return { ...nx, status: receiptLive(nx) ? 'part_reversed' : 'reversed' };
                            }
                            const np = posted.map((p) => {
                                const c = lines.find((q) => q.no === p.no);
                                return c ? { ...p, costCenterId: c.costCenterId, glCode: c.glCode || p.glCode } : p;
                            });
                            return { ...x, posted: np, rates, adjustments: [...(Array.isArray(x.adjustments) ? x.adjustments : []), id] };
                        });
                        const poLines = str(a.kind) === 'reverse' ? objs(d.lines).map((l) => {
                            const r = lines.find((q) => q.no === Number(l.no));
                            return r ? { ...l, receivedQty: Math.max(0, round((Number(l.receivedQty) || 0) - r.qty, 4)) } : l;
                        }) : objs(d.lines);
                        const anyReceived = poLines.some((l) => (Number(l.receivedQty) || 0) > 0);
                        const full = poLines.every((l) => outstanding(l) <= 0);
                        const status = str(a.kind) === 'reverse' ? (full ? 'full' : anyReceived ? 'partial' : str(d.sentAt) ? 'sent' : 'open') : str(d.status);
                        return { patch: { deliveries, lines: poLines, status, ...(status !== 'full' ? { deliveredAt: '' } : {}) }, event: str(a.kind) === 'reverse' ? 'receipt reversed' : 'receipt re-posted', note: `${id} on ${str(a.recNo)}${res.journals.length ? `; journal ${res.journals.join(', ')}` : ''}${res.note ? `; ${res.note}` : ''}`, label: `${id} posted` };
                    });
                    const reg = await getDoc(`${P(ctx.orgId).receipts}/${str(a.recNo)}`);
                    if (reg) await writeDoc(`${P(ctx.orgId).receipts}/${reg.id}`, { ...reg.data, adjustments: [...(Array.isArray(reg.data.adjustments) ? reg.data.adjustments : []), id], ...(str(a.kind) === 'reverse' ? { reversedLines: [...objs(reg.data.reversedLines), ...lines] } : {}), updatedAt: nowIso() });
                    return { status: 'done', journals: res.journals, financeNote: res.note, postedAt: nowIso() };
                },
                async () => ({}),
                'Receipt adjustment'
            );
        }),
    ],
    'POST /api/org/fin/ap/adjust/list': [
        orgRoute('org.fin.ap.adjust.list', 'PRC.receipt.adjust', async (ctx) => {
            const docs = await listDocs(P(ctx.orgId).adjust);
            return { rows: docs.filter((x) => str(x.data.createdBy) === ctx.uid).map((x) => ({ ...adjustRow(x.id, x.data), steps: stepsOf(x.data) })).sort((a, b) => b.id.localeCompare(a.id)) };
        }),
    ],
    'POST /api/org/fin/ap/adjust/queue': [
        orgRoute('org.fin.ap.adjust.queue', 'FIN.receipt.approve', async (ctx) => {
            const docs = await listDocs(P(ctx.orgId).adjust);
            return { rows: docs.map((x) => ({ ...adjustRow(x.id, x.data), steps: stepsOf(x.data), canDecide: decider(ctx, x.data, 'FIN.receipt.approve').ok, why: decider(ctx, x.data, 'FIN.receipt.approve').why })).sort((a, b) => b.id.localeCompare(a.id)) };
        }),
    ],
};

/** For the purchase order screen: the invoices and adjustment requests of the order, without amounts when prices are hidden. */
export async function apSummaryForPo(ctx: OrgContext, poId: string, priceOk: boolean) {
    const [invs, adj] = await Promise.all([
        invoicesOfPo(ctx.orgId, poId).catch(() => [] as Doc[]),
        runQuery({ from: [{ collectionId: 'receipt_adjustments' }], where: fieldEq('poId', poId) }, `organizations/${ctx.orgId}`).catch(() => [] as Doc[]),
    ]);
    return {
        invoices: invs.map((x) => {
            const r = invoiceRow(x.id, x.data);
            return { id: r.id, supplierInvoiceNo: r.supplierInvoiceNo, status: r.status, statusLabel: r.statusLabel, date: r.date, recNos: r.recNos, scope: r.scope, deliveryIds: (x.data.deliveryIds as string[]) ?? [], fileId: str(o(x.data.file).id), ...(priceOk ? { amount: r.amount, taxAmount: r.taxAmount, expected: r.expected, variancePct: r.variancePct, outstanding: r.outstanding, paid: r.paid } : {}) };
        }),
        adjustments: adj.map((x) => adjustRow(x.id, x.data)),
        canCaptureInvoice: can(ctx, 'FIN.ap.capture'),
        canAdjust: can(ctx, 'PRC.receipt.adjust'),
    };
}

function addDays(iso: string, n: number) {
    const t = Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
}
