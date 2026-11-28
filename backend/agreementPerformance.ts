import { isObj, listDocs, str, type Doc } from './core';
import { materialNumberKeys } from './materialLifecycleIds';
import { converter, itemKey, paWindow, type OrderLine } from './purchaseAgreementModel';
import {
    agreementRefs, lineDelivery, matchAgreement, orderDateOf, quoteWaits, stockOf,
    type AgreementLine, type AgreementRef, type LineAgreement,
} from './vendorPerformanceModel';

// ---------------------------------------------------------------------------
// The data side of purchase agreement performance: which order lines were bought under an agreement, how they were
// delivered, and how long the supplier takes to quote. Shared by the purchase order screen (agreement number on the
// lines), the agreement dashboard and the supplier dashboard so all three show the same figures.
//
// No import from the purchase order module, so that module can use this one.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const root = (orgId: string) => `organizations/${orgId}`;
export const PLACED_STATUS = ['open', 'sent', 'partial', 'full'];

export interface LinkData {
    refs: AgreementRef[];
    agreements: Doc[];
    reqLines: Map<string, { materialId: string; warehouseId: string }>;
    byNumber: Map<string, string>;
}

/**
 * What is needed to tell which agreement an order line was bought under. Agreements are read first: with none for the
 * supplier, the requirements and materials are not read at all.
 */
export async function loadLinkData(orgId: string, vendorId?: string): Promise<LinkData> {
    const all = await listDocs(`${root(orgId)}/purchase_agreements`);
    const agreements = vendorId ? all.filter((a) => str(a.data.vendorId) === vendorId) : all;
    const refs = agreementRefs(agreements);
    if (!refs.length) return { refs, agreements, reqLines: new Map(), byNumber: new Map() };
    const [reqs, materials] = await Promise.all([listDocs(`${root(orgId)}/procurement_requirements`), listDocs(`${root(orgId)}/materials`)]);
    const reqLines = new Map<string, { materialId: string; warehouseId: string }>();
    for (const r of reqs) {
        for (const l of objs(r.data.lines)) {
            const materialId = str(l.materialId);
            const warehouseId = str(l.warehouseId);
            if (materialId && warehouseId) reqLines.set(`${r.id}|${num(l.no)}`, { materialId, warehouseId });
        }
    }
    const byNumber = new Map(materials.flatMap((m) => materialNumberKeys(m.id, m.data).map((k) => [k, m.id] as [string, string])));
    return { refs, agreements, reqLines, byNumber };
}

/** The agreement (and the agreed price) an order line was bought under, or null. */
export function agreementLinker(link: LinkData, rate: (code: string) => number | null) {
    const convert = converter(rate);
    return (po: Obj, line: Obj, date: string): LineAgreement | null => {
        if (!link.refs.length) return null;
        const stock = stockOf(line, link.reqLines, link.byNumber);
        if (!stock) return null;
        const ref = matchAgreement(link.refs, str(po.vendorId), stock.materialId, stock.warehouseId, date);
        const it = ref?.items.get(`${stock.materialId}|${stock.warehouseId}`);
        if (!ref || !it) return null;
        const inAgreed = convert(num(line.netUnitPrice), str(po.currency), it.currency);
        return { id: ref.id, number: ref.number, agreedPrice: it.price, agreedCurrency: it.currency, aboveAgreed: inAgreed !== null && inAgreed > it.price * 1.0001 };
    };
}

/** Every stock line of the supplier's placed orders, with its material and warehouse and how it was delivered. */
export function agreementLinesOf(pos: Doc[], vendorId: string, link: LinkData, day: string): AgreementLine[] {
    const out: AgreementLine[] = [];
    for (const p of pos) {
        const d = p.data;
        if (str(d.vendorId) !== vendorId || !PLACED_STATUS.includes(str(d.status))) continue;
        const date = orderDateOf(d);
        for (const l of objs(d.lines)) {
            const stock = stockOf(l, link.reqLines, link.byNumber);
            if (!stock) continue;
            const del = lineDelivery(d, l, day);
            out.push({
                orderId: p.id,
                orderNumber: str(d.number) || p.id,
                vendorId,
                status: str(d.status),
                date,
                currency: str(d.currency),
                materialId: stock.materialId,
                warehouseId: stock.warehouseId,
                quantity: num(l.quantity),
                receivedQty: num(l.receivedQty),
                netUnitPrice: num(l.netUnitPrice),
                no: del.no,
                promiseOn: del.promiseOn,
                completeOn: del.completeOn,
                verdict: del.verdict,
                daysLate: del.daysLate,
                quotedLeadDays: del.quotedLeadDays,
                actualLeadDays: del.actualLeadDays,
            });
        }
    }
    return out;
}

/** The supplier's placed purchase orders (every version is in the list; superseded ones are not placed). */
export async function placedOrders(orgId: string, vendorId: string): Promise<Doc[]> {
    return (await listDocs(`${root(orgId)}/procurement_orders`)).filter((p) => str(p.data.vendorId) === vendorId && PLACED_STATUS.includes(str(p.data.status)));
}

/** Lines bought under one agreement: its supplier, its materials, its dates. */
export function linesUnder<T extends OrderLine>(pa: Obj, lines: T[]): T[] {
    const keys = new Set(objs(pa.items).map((i) => itemKey(i)));
    const w = paWindow(pa);
    return lines.filter((l) => l.vendorId === str(pa.vendorId) && keys.has(`${l.materialId}|${l.warehouseId}`) && (!w.start || l.date >= w.start) && (!w.end || l.date <= w.end));
}

/** How the supplier's quotes were turned around over the last year. */
export async function quoteWaitOf(orgId: string, vendorId: string, agreements: Doc[], day: string) {
    const cases = await listDocs(`${root(orgId)}/procurement_quotations`);
    return quoteWaits(cases, agreements, vendorId, day);
}
