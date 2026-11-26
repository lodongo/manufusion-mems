// ---------------------------------------------------------------------------
// Purchase agreements (PA + 8 digits): the pure rules, with no database access, so they can be tested on their own.
//
// A purchase agreement fixes, for a supplier and a period, the buying parameters of chosen spares (material in a
// warehouse): price, currency, purchase unit, lead time, minimum order quantity, order multiple, the supplier's part
// number, payment terms and incoterms. The values come from the supplier's quote to an RFQ and are checked against the
// procurement setup of each material (the same fields and rules as Material › Procurement Information).
//
// While an agreement is active and in date, its parameters are the material's procurement parameters. The material's
// own values are kept (agreementBaseline) and come back when the agreement ends, is terminated, or the item is
// overridden. The material's standard price (unitPrice / priceCurrency) is never changed: savings are measured
// against it.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const PA_ID = /^PA\d{8}$/;
export const MAX_ITEMS = 200;
export const MAX_ATTACHMENTS = 10;
/** PDF attachments: up to 10 MB each (vendor documents are limited to 450 KB; agreements are often long scanned contracts). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_YEARS = 5;

export const PA_STATUS: Record<string, string> = {
    draft: 'Draft',
    rfq_sent: 'RFQ sent, waiting for the quote',
    returned: 'Returned for correction',
    pending_approval: 'In approval',
    approved: 'Approved, not yet activated',
    scheduled: 'Activated, starts on the start date',
    active: 'Active',
    expired: 'Expired',
    terminated: 'Terminated',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
};
/** Statuses in which an agreement holds its materials: another agreement cannot cover the same material in the same warehouse for overlapping dates. */
export const HOLDING = ['pending_approval', 'approved', 'scheduled', 'active'];
export const QUOTING = ['rfq_sent', 'returned'];
export const EDITABLE_ITEMS = ['draft', 'returned'];
export const FINAL = ['expired', 'terminated', 'rejected', 'cancelled'];

/** Agreement quote field -> Material › Procurement Information field it sets while the agreement is active. */
export const APPLIED_FIELDS: Array<[quoteKey: string, infoKey: string]> = [
    ['leadTimeDays', 'leadTimeDays'],
    ['minimumOrderQuantity', 'minimumOrderQuantity'],
    ['orderMultiple', 'orderMultiple'],
    ['vendorPartNumber', 'vendorPartNumber'],
    ['paymentTerms', 'paymentTerms'],
    ['incoterms', 'incoterms'],
];
/** Every procurement field an active agreement controls (the supplier too). A manual edit of these is refused while it is active. */
export const CONTROLLED_INFO_FIELDS = [...APPLIED_FIELDS.map(([, k]) => k), 'preferredVendor'];

export interface Quote {
    unitPrice: number;
    currency: string;
    uom: string;
    leadTimeDays: number;
    minimumOrderQuantity: number | null;
    orderMultiple: number | null;
    vendorPartNumber: string;
    paymentTerms: string;
    incoterms: string;
    quotedAt: string;
    quotedBy: string;
    quotedByName: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Days from a to b (dates), negative when b is before a. */
export function dayDiff(a: string, b: string): number {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Problems with the agreement period. */
export function periodProblems(start: string, end: string, now = today()): string[] {
    const out: string[] = [];
    if (!validDate(start)) out.push('Enter the start date.');
    if (!validDate(end)) out.push('Enter the end date.');
    if (out.length) return out;
    if (end < start) out.push('The end date must be on or after the start date.');
    if (end < now) out.push('The end date has already passed.');
    if (dayDiff(start, end) > MAX_YEARS * 366) out.push(`An agreement can run for at most ${MAX_YEARS} years.`);
    return out;
}

/** In date on a day: start <= day <= end. */
export const inDate = (pa: Obj, day = today()) => !!str(pa.startDate) && !!str(pa.endDate) && str(pa.startDate) <= day && day <= str(pa.endDate);
/** Two periods overlap. */
export const overlaps = (a1: string, a2: string, b1: string, b2: string) => !!a1 && !!a2 && !!b1 && !!b2 && a1 <= b2 && b1 <= a2;
export const itemKey = (i: Obj) => `${str(i.materialId)}|${str(i.warehouseId)}`;

/** The purchase unit the material is bought in: Procurement Information's purchase unit, else the material's registered unit. */
export const purchaseUnitOf = (info: Obj, material: Obj) => str(info.purchaseUom) || str(material.uom);
const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Checks a quoted item against the material's procurement setup. Returns the cleaned quote and the problems.
 * enabledCurrencies: codes enabled in the platform currency list.
 */
export function checkQuote(raw: Obj, ctx: { info: Obj; material: Obj; enabledCurrencies: Set<string>; label: string }): { quote: Omit<Quote, 'quotedAt' | 'quotedBy' | 'quotedByName'>; problems: string[] } {
    const p: string[] = [];
    const at = `${ctx.label}: `;
    const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
    const price = num(raw.unitPrice);
    if (price === null || !Number.isFinite(price) || price <= 0 || price > 1e12) p.push(`${at}enter a unit price above zero.`);
    const currency = str(raw.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || !ctx.enabledCurrencies.has(currency)) p.push(`${at}choose an enabled currency.`);
    const unit = purchaseUnitOf(ctx.info, ctx.material);
    const uom = str(raw.uom).trim() || unit;
    if (!unit) p.push(`${at}the material has no purchase unit. Set it in Procurement Information first.`);
    else if (!sameUnit(uom, unit)) p.push(`${at}the quote must be in the material's purchase unit (${unit}), not ${uom}. Ask the supplier to quote per ${unit}.`);
    const lead = num(raw.leadTimeDays);
    if (lead === null || !Number.isInteger(lead) || lead < 0 || lead > 3650) p.push(`${at}enter the lead time as whole days from 0 to 3650.`);
    const moq = num(raw.minimumOrderQuantity);
    if (moq !== null && (!Number.isFinite(moq) || moq < 0 || moq > 1e12)) p.push(`${at}the minimum order quantity must be a number of 0 or more.`);
    const mult = num(raw.orderMultiple);
    if (mult !== null && (!Number.isFinite(mult) || mult < 0 || mult > 1e12)) p.push(`${at}the order multiple must be a number of 0 or more.`);
    if (moq !== null && mult !== null && moq > 0 && mult > 0 && Math.abs(moq / mult - Math.round(moq / mult)) > 1e-9) p.push(`${at}the minimum order quantity (${moq}) must be a multiple of the order multiple (${mult}).`);
    const text = (k: string) => {
        const s = str(raw[k]).replace(/\s+/g, ' ').trim();
        if (s.length > 120) p.push(`${at}${k} is too long (120 characters at most).`);
        return s.slice(0, 120);
    };
    return {
        quote: {
            unitPrice: price !== null && Number.isFinite(price) ? round(price, 4) : 0,
            currency,
            uom: unit || uom,
            leadTimeDays: lead !== null && Number.isFinite(lead) ? lead : 0,
            minimumOrderQuantity: moq !== null && Number.isFinite(moq) ? moq : null,
            orderMultiple: mult !== null && Number.isFinite(mult) ? mult : null,
            vendorPartNumber: text('vendorPartNumber'),
            paymentTerms: text('paymentTerms'),
            incoterms: text('incoterms'),
        },
        problems: p,
    };
}

/** What an active agreement item writes into the material's procurement information (blank quote fields leave the material's own value). */
export function appliedValues(item: Obj, pa: Obj): Obj {
    const q = o(item.quote);
    const out: Obj = {};
    for (const [qk, ik] of APPLIED_FIELDS) {
        const v = q[qk];
        if (v === null || v === undefined || v === '') continue;
        out[ik] = v;
    }
    out.preferredVendor = str(pa.vendorId);
    out.preferredVendorName = `${str(pa.vendorNumber)} · ${str(pa.vendorName)}`.trim();
    return out;
}

/**
 * Applies an agreement item to the material's procurement information. The material's own values are kept in
 * agreementBaseline (only the first time, so re-applying never loses them). Returns null when another agreement already
 * holds the material.
 */
export function applyToInfo(info: Obj, pa: Obj, paId: string, item: Obj, at: string, by: string): Obj | null {
    const held = o(info.agreement);
    if (str(held.id) && str(held.id) !== paId) return null;
    const values = appliedValues(item, pa);
    const fields = Object.keys(values);
    const reapply = str(held.id) === paId && isObj(info.agreementBaseline);
    const baseline: Obj = reapply ? { ...(info.agreementBaseline as Obj) } : {};
    for (const k of fields) if (!(k in baseline)) baseline[k] = reapply ? '' : info[k] ?? '';
    const q = o(item.quote);
    return {
        ...info,
        ...values,
        agreementBaseline: baseline,
        agreement: {
            id: paId,
            number: str(pa.number) || paId,
            vendorId: str(pa.vendorId),
            vendorName: str(pa.vendorName),
            unitPrice: Number(q.unitPrice) || 0,
            currency: str(q.currency),
            uom: str(q.uom),
            startDate: str(pa.startDate),
            endDate: str(pa.endDate),
            fields,
            appliedAt: at,
            appliedBy: by,
        },
    };
}

/**
 * Takes an agreement off the material: each field it set goes back to the material's own value (kept in
 * agreementBaseline; manual changes to those fields are refused while the agreement holds them).
 * Returns null when the material is not held by this agreement.
 */
export function restoreInfo(info: Obj, paId: string): Obj | null {
    const held = o(info.agreement);
    if (str(held.id) !== paId) return null;
    const baseline = o(info.agreementBaseline);
    const next: Obj = { ...info };
    delete next.agreement;
    delete next.agreementBaseline;
    const fields = Array.isArray(held.fields) ? (held.fields as unknown[]).map(str) : Object.keys(baseline);
    for (const k of fields) if (k in baseline) next[k] = baseline[k];
    return next;
}

/** Why a manual change to Procurement Information is refused while an agreement controls the field, or ''. */
export function agreementLock(info: Obj | null | undefined, changed: string[], day = today()): string {
    const held = o(info?.agreement);
    if (!str(held.id)) return '';
    if (!(str(held.startDate) <= day && day <= str(held.endDate))) return '';
    const controlled = new Set([...(Array.isArray(held.fields) ? (held.fields as unknown[]).map(str) : []), 'preferredVendor', 'preferredVendorName']);
    const hit = changed.filter((k) => controlled.has(k));
    if (!hit.length) return '';
    return `${hit.join(', ')} ${hit.length === 1 ? 'is' : 'are'} set by purchase agreement ${str(held.number) || str(held.id)} until ${str(held.endDate)}. Change it through the agreement (override the item) instead.`;
}

/** Rate converter: amount in `from` to `to`, or null when either rate is unknown. rateToOrg(code) = units of the organization currency for one unit of code. */
export function converter(rateToOrg: (code: string) => number | null) {
    return (amount: number, from: string, to: string): number | null => {
        if (!from || !to) return null;
        if (from === to) return amount;
        const a = rateToOrg(from);
        const b = rateToOrg(to);
        return a && b ? (amount * a) / b : null;
    };
}

/** Value of the agreement in the organization currency: expected quantity x agreed price, item by item. */
export function agreementValue(items: Obj[], rateToOrg: (code: string) => number | null): { value: number; missing: string[] } {
    let value = 0;
    const missing: string[] = [];
    for (const i of items) {
        const q = o(i.quote);
        const r = rateToOrg(str(q.currency));
        if (!r) {
            missing.push(str(q.currency) || '(no currency)');
            continue;
        }
        value += (Number(i.expectedQty) || 0) * (Number(q.unitPrice) || 0) * r;
    }
    return { value: round(value), missing: [...new Set(missing)] };
}

export interface OrderLine {
    orderId: string;
    orderNumber: string;
    vendorId: string;
    status: string;
    date: string;
    currency: string;
    materialId: string;
    warehouseId: string;
    quantity: number;
    receivedQty: number;
    netUnitPrice: number;
}

export interface ItemUse {
    no: number;
    materialId: string;
    warehouseId: string;
    materialNumber: string;
    name: string;
    expectedQty: number;
    orderedQty: number;
    receivedQty: number;
    agreedPrice: number;
    standardPrice: number | null;
    standardCurrency: string;
    standardInAgreement: number | null;
    orderedValue: number;
    savings: number | null;
    priceBreaches: number;
    orders: number;
    applied: boolean;
    overridden: boolean;
}

/**
 * Agreement dashboard: what was bought under it (orders from the supplier for its materials, approved within its
 * dates), the savings against each material's standard price and the time left. Amounts are in the agreement currency.
 */
export function dashboardOf(pa: Obj, items: Obj[], lines: OrderLine[], convert: (amount: number, from: string, to: string) => number | null, day = today()) {
    const cur = str(pa.currency) || str(o(items[0]?.quote).currency);
    const start = str(pa.startDate);
    const end = str(pa.endDate);
    const totalDays = start && end ? Math.max(1, dayDiff(start, end) + 1) : 0;
    const elapsed = start && end ? Math.min(totalDays, Math.max(0, dayDiff(start, day) + 1)) : 0;
    const remaining = end ? Math.max(0, dayDiff(day, end)) : 0;
    const per: ItemUse[] = items.map((i) => {
        const q = o(i.quote);
        const agreed = Number(q.unitPrice) || 0;
        const qc = str(q.currency) || cur;
        const agreedInCur = convert(agreed, qc, cur) ?? agreed;
        const base = o(i.standard);
        const sp = base.unitPrice === '' || base.unitPrice === null || base.unitPrice === undefined ? null : Number(base.unitPrice);
        const sc = str(base.currency);
        const stdIn = sp !== null && Number.isFinite(sp) && sp > 0 && sc ? convert(sp, sc, cur) : null;
        const mine = lines.filter((l) => l.vendorId === str(pa.vendorId) && l.materialId === str(i.materialId) && l.warehouseId === str(i.warehouseId) && (!start || l.date >= start) && (!end || l.date <= end));
        let orderedQty = 0;
        let receivedQty = 0;
        let orderedValue = 0;
        let breaches = 0;
        for (const l of mine) {
            orderedQty += l.quantity;
            receivedQty += l.receivedQty;
            const v = convert(l.quantity * l.netUnitPrice, l.currency, cur);
            orderedValue += v ?? 0;
            const unitIn = convert(l.netUnitPrice, l.currency, cur);
            if (unitIn !== null && unitIn > agreedInCur * 1.0001) breaches++;
        }
        const ov = o(i.override);
        return {
            no: Number(i.no) || 0,
            materialId: str(i.materialId),
            warehouseId: str(i.warehouseId),
            materialNumber: str(i.materialNumber),
            name: str(i.name),
            expectedQty: Number(i.expectedQty) || 0,
            orderedQty: round(orderedQty, 4),
            receivedQty: round(receivedQty, 4),
            agreedPrice: round(agreedInCur, 4),
            standardPrice: sp,
            standardCurrency: sc,
            standardInAgreement: stdIn === null ? null : round(stdIn, 4),
            orderedValue: round(orderedValue),
            savings: stdIn === null ? null : round(orderedQty * (stdIn - agreedInCur)),
            priceBreaches: breaches,
            orders: new Set(mine.map((l) => l.orderId)).size,
            applied: i.applied === true,
            overridden: ov.on === true,
        };
    });
    const expectedValue = round(per.reduce((s, x) => s + x.expectedQty * x.agreedPrice, 0));
    const orderedValue = round(per.reduce((s, x) => s + x.orderedValue, 0));
    const savings = round(per.reduce((s, x) => s + (x.savings ?? 0), 0));
    const potential = round(per.reduce((s, x) => s + (x.standardInAgreement === null ? 0 : x.expectedQty * (x.standardInAgreement - x.agreedPrice)), 0));
    return {
        currency: cur,
        active: str(pa.status) === 'active' && inDate(pa, day),
        totalDays,
        elapsedDays: elapsed,
        daysRemaining: remaining,
        timeUsedPct: totalDays ? round((elapsed / totalDays) * 100, 1) : 0,
        expectedValue,
        orderedValue,
        utilisationPct: expectedValue > 0 ? round((orderedValue / expectedValue) * 100, 1) : 0,
        savings,
        potentialSavings: potential,
        materialsPurchased: per.filter((x) => x.orderedQty > 0).length,
        orders: new Set(lines.filter((l) => per.some((x) => x.materialId === l.materialId && x.warehouseId === l.warehouseId) && l.vendorId === str(pa.vendorId) && (!start || l.date >= start) && (!end || l.date <= end)).map((l) => l.orderId)).size,
        priceBreaches: per.reduce((s, x) => s + x.priceBreaches, 0),
        itemsApplied: per.filter((x) => x.applied).length,
        itemsOverridden: per.filter((x) => x.overridden).length,
        noStandardPrice: per.filter((x) => x.standardInAgreement === null).length,
        items: per,
    };
}

/**
 * What the settle step must do with an agreement today: start it, end it, or nothing.
 * scheduled + in date -> start; scheduled or active past the end -> expire.
 */
export function settleAction(pa: Obj, day = today()): 'start' | 'expire' | '' {
    const s = str(pa.status);
    const end = str(pa.endDate);
    if ((s === 'scheduled' || s === 'active') && end && end < day) return 'expire';
    if (s === 'scheduled' && inDate(pa, day)) return 'start';
    return '';
}

/** First problem that stops an agreement being submitted, item checks aside. */
export function submitProblems(pa: Obj, items: Obj[], attachments: Obj[], now = today()): string[] {
    const p = [...periodProblems(str(pa.startDate), str(pa.endDate), now)];
    if (!items.length) p.push('Add at least one material.');
    for (const i of items) {
        if (!(Number(i.expectedQty) > 0)) p.push(`Item ${Number(i.no)}: enter the expected quantity over the agreement.`);
        if (!isObj(i.quote) || !(Number(o(i.quote).unitPrice) > 0)) p.push(`Item ${Number(i.no)}: record the supplier's quote.`);
    }
    if (!attachments.some((a) => str(a.mime) === 'application/pdf')) p.push('Attach the agreement or the supplier\'s signed quote as a PDF.');
    return p;
}
