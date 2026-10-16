import { HttpError, fieldEq, getDoc, listDocs, nowIso, runQuery, str, writeDoc, type Doc, type Fields } from './core';
import { orgRoute, type OrgContext } from './guards';
import { record, orgUsers } from './org';
import {
    P,
    activePositions,
    cents,
    createRequest,
    entityOf,
    financeState,
    fxRate,
    hashKey,
    issueValue,
    leOf,
    mappingOf,
    materialIn,
    nameOf,
    needEntity,
    nextCounter,
    o,
    objs,
    oneLine,
    permAt,
    physicalOf,
    post,
    reasonOf,
    registerHandler,
    roleAccount,
    round2,
    round4,
    scopeOf,
    stockValOf,
    strs,
    today,
    unitsOf,
    ccFinOf,
    type Obj,
    type PostLine,
    type StockMove,
    type Unit,
    type Write,
} from './finCore';
import { fin } from './finRoutes';

// ---------------------------------------------------------------------------
// Operational events that post to the journal of a legal entity:
//   goods receipt (purchase order delivery)   GR_STOCK / GR_DIRECT / GR_ASSET   Dr inventory, line account or asset clearing / Cr GR/IR
//   service accepted by the cost center owner  SVC_ACCEPT                       Dr line account / Cr GR/IR
//   goods issue to a cost center or work order GI_CC / GI_WO                    Dr consumption / Cr inventory (moving average)
//   stock take difference                      ST_ADJ                           inventory against stock differences
//   opening stock valuation (approved)         STK_OPEN                         Dr inventory / Cr opening balance
//
// Before a legal entity goes live in finance, the events still happen (stock quantities move) but nothing is posted:
// stock that exists at go-live is valued once through the approved opening valuation. After go-live every event MUST
// post; if it cannot (closed period, missing mapping, blocked account or cost center) the event itself is refused.
// ---------------------------------------------------------------------------

const ccOfLine = (l: Obj) => str(l.costCenterId) || str(l.costCenterCode);
const mjPath = (orgId: string, id: string) => `organizations/${orgId}/material_journal/${id}`;
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);

async function isWarehouse(orgId: string, ccId: string): Promise<boolean> {
    return !!ccId && !!(await getDoc(`organizations/${orgId}/warehouses/${ccId}`));
}
function mjEntry(materialId: string, warehouseId: string, materialNumber: string, type: string, qty: number, reference: string, by: string, extra: Obj): Obj {
    const at = nowIso();
    return { materialId, warehouseId, materialNumber, type, status: 'posted', reconciled: true, balancesDelta: { physicalStock: qty }, reference, createdAt: at, postedAt: at, postedBy: by, version: 1, ...extra };
}

interface LeInfo {
    le: Unit;
    state: 'not_live' | 'live' | 'blocked';
    currency: string;
}
async function leInfo(orgId: string, units: Map<string, Unit>, ccId: string, cache: Map<string, LeInfo>): Promise<LeInfo> {
    const le = leOf(units, ccId);
    if (!le) throw new HttpError(409, `Cost center ${units.get(ccId)?.code ?? ccId} is not under a legal entity.`);
    const hit = cache.get(le.id);
    if (hit) return hit;
    const e = await entityOf(orgId, le.id);
    const state = await financeState(orgId, le.id);
    const info: LeInfo = { le, state, currency: e.functionalCurrency || str(le.attributes.currencyCode) };
    if (state === 'blocked') throw new HttpError(409, `Finance for ${le.code} ${le.name} is ${e.status === 'closed' ? 'closed' : 'blocked for posting'}, so this cannot be recorded now.`);
    cache.set(le.id, info);
    return info;
}

// ===== Goods receipt =====

export interface ReceiptLine {
    no: number;
    qty: number;
    materialId?: string;
}
/** What receiving each line of an order will do: warehouse or not, the material it lands as, and the finance state. */
export async function receiptPlan(orgId: string, po: Obj): Promise<Obj[]> {
    const units = await unitsOf(orgId);
    const cache = new Map<string, LeInfo>();
    const out: Obj[] = [];
    for (const l of objs(po.lines)) {
        const cc = ccOfLine(l);
        const wh = str(l.type) === 'material' && (await isWarehouse(orgId, cc));
        let linked: Doc | null = null;
        let options: Obj[] = [];
        if (wh) {
            linked = str(l.itemCode) ? await materialIn(orgId, str(l.itemCode), cc) : null;
            if (!linked) {
                const mats = await listDocs(`organizations/${orgId}/materials`);
                const cands: Obj[] = [];
                for (const m of mats) {
                    if (cands.length >= 300) break;
                    if (!str(m.data.materialNumber) || !['approved', 'active'].includes(str(m.data.status))) continue;
                    if (strs(m.data.warehouseIds).includes(cc) || (str(m.data.pushedAt) && str(m.data.warehouseId) === cc)) cands.push({ id: m.id, number: str(m.data.materialNumber), name: str(m.data.name) || str(m.data.shortText), categoryCode: str(m.data.categoryCode) });
                }
                options = cands;
            }
        }
        let state = 'not_live';
        try {
            state = (await leInfo(orgId, units, cc, cache)).state;
        } catch {
            state = 'blocked';
        }
        out.push({ no: Number(l.no), costCenterId: cc, warehouse: wh, materialId: linked?.id ?? '', materialNumber: str(linked?.data.materialNumber), materialName: str(linked?.data.name), options, finance: state });
    }
    return out;
}

/**
 * Posts a delivery of materials or assets. Call it inside the order lock, after the quantities were checked.
 * Idempotent: the same delivery id never posts twice.
 */
export async function receiveGoods(ctx: OrgContext, a: { po: Obj; poId: string; deliveryId: string; date: string; ref: string; lines: ReceiptLine[] }): Promise<{ journals: string[]; note: string }> {
    const units = await unitsOf(ctx.orgId);
    const cache = new Map<string, LeInfo>();
    type Item = { l: Obj; qty: number; cc: string; wh: boolean; material: Doc | null; le: LeInfo; docValue: number };
    const items: Item[] = [];
    for (const g of a.lines) {
        const l = objs(a.po.lines).find((x) => Number(x.no) === g.no);
        if (!l) throw new HttpError(400, `Line ${g.no} does not exist on this order.`);
        const cc = ccOfLine(l);
        const le = await leInfo(ctx.orgId, units, cc, cache);
        const wh = str(l.type) === 'material' && (await isWarehouse(ctx.orgId, cc));
        let material: Doc | null = null;
        if (wh) {
            material = (str(l.itemCode) ? await materialIn(ctx.orgId, str(l.itemCode), cc) : null) ?? (g.materialId ? await materialIn(ctx.orgId, g.materialId, cc) : null);
            if (!material) throw new HttpError(400, `Line ${g.no} goes into warehouse ${units.get(cc)?.code ?? cc}: choose the warehouse material it is received as.`);
        }
        items.push({ l, qty: g.qty, cc, wh, material, le, docValue: round2(g.qty * (Number(l.netUnitPrice) || 0)) });
    }
    // Stock quantities move in every case. They are written with the posting when finance is live.
    const mj = (it: Item, i: number) => ({ id: safeId(`GR_${a.deliveryId}_${Number(it.l.no)}_${i}`), data: mjEntry(it.material!.id, it.cc, str(it.material!.data.materialNumber), 'GOODS_RECEIPT', it.qty, a.poId, ctx.uid, { deliveryId: a.deliveryId, deliveryNote: a.ref, source: 'purchase_order' }) });
    const journals: string[] = [];
    const notLive: string[] = [];
    const byLe = new Map<string, Item[]>();
    for (const it of items) byLe.set(it.le.le.id, [...(byLe.get(it.le.le.id) ?? []), it]);
    for (const [leId, list] of byLe) {
        const info = list[0].le;
        if (info.state === 'not_live') {
            for (const [i, it] of list.entries()) if (it.material) await writeDoc(mjPath(ctx.orgId, mj(it, i).id), { ...mj(it, i).data, journalId: '', financeNote: 'Finance not live: not posted' } as unknown as Fields, { exists: false });
            notLive.push(info.le.code);
            continue;
        }
        const rate = await fxRate(str(a.po.currency), info.currency);
        const map = await mappingOf(ctx.orgId, leId);
        const grir = roleAccount(map, 'GRIR');
        const groups: Record<string, { lines: PostLine[]; stock: StockMove[]; extra: Write[] }> = {};
        const add = (t: string) => (groups[t] ??= { lines: [], stock: [], extra: [] });
        const stockAgg = new Map<string, StockMove>();
        for (const [i, it] of list.entries()) {
            const value = round2(it.docValue * rate);
            if (!(value > 0)) throw new HttpError(409, `Line ${Number(it.l.no)} has no value to post.`);
            const desc = `${a.poId} line ${Number(it.l.no)}: ${str(it.l.itemName) || str(it.l.requirement)}`.slice(0, 200);
            if (it.wh) {
                const g = add('GR_STOCK');
                const gl = roleAccount(map, 'INVENTORY', str(it.l.categoryCode) || str(it.material!.data.categoryCode));
                g.lines.push({ side: 'D', glCode: gl, ccId: it.cc, amount: value, docAmount: it.docValue, description: desc, materialId: it.material!.id, qty: it.qty });
                g.lines.push({ side: 'C', glCode: grir, ccId: it.cc, amount: value, docAmount: it.docValue, description: `GR/IR ${a.poId} delivery ${a.ref}`.slice(0, 200) });
                const k = `${it.cc}|${it.material!.id}`;
                const cur = stockAgg.get(k);
                if (cur) {
                    cur.qty = round4(cur.qty + it.qty);
                    cur.value = round2(cur.value + value);
                } else {
                    const v = await stockValOf(ctx.orgId, it.cc, it.material!.id);
                    stockAgg.set(k, { warehouseId: it.cc, materialId: it.material!.id, materialNumber: str(it.material!.data.materialNumber), qty: it.qty, value, expectedUpdateTime: v.updateTime, glCode: gl } as StockMove);
                }
                const m = mj(it, i);
                g.extra.push({ path: mjPath(ctx.orgId, m.id), exists: false, fields: m.data });
            } else if (str(it.l.type) === 'asset') {
                const g = add('GR_ASSET');
                g.lines.push({ side: 'D', glCode: roleAccount(map, 'ASSET_CLEARING'), ccId: it.cc, amount: value, docAmount: it.docValue, description: desc, qty: it.qty });
                g.lines.push({ side: 'C', glCode: grir, ccId: it.cc, amount: value, docAmount: it.docValue, description: `GR/IR ${a.poId} delivery ${a.ref}`.slice(0, 200) });
            } else {
                const g = add('GR_DIRECT');
                g.lines.push({ side: 'D', glCode: str(it.l.glCode), ccId: it.cc, amount: value, docAmount: it.docValue, description: desc, qty: it.qty });
                g.lines.push({ side: 'C', glCode: grir, ccId: it.cc, amount: value, docAmount: it.docValue, description: `GR/IR ${a.poId} delivery ${a.ref}`.slice(0, 200) });
            }
        }
        if (groups.GR_STOCK) groups.GR_STOCK.stock = Array.from(stockAgg.values());
        for (const [type, g] of Object.entries(groups)) {
            const p = await post(ctx, {
                leId,
                type,
                docCurrency: str(a.po.currency),
                fxRate: rate,
                lines: g.lines,
                narrative: `Delivery ${a.ref} on ${a.poId} from ${str(a.po.vendorName)}`,
                source: { kind: 'purchase_order', id: a.poId, ref: a.deliveryId, route: `organization_home/procurement_orders/${a.poId}` },
                trace: { poId: a.poId, deliveryId: a.deliveryId, deliveryNote: a.ref, vendorName: str(a.po.vendorName), requisitionIds: Array.from(new Set(list.map((x) => str(x.l.requisitionId)).filter(Boolean))), requirementIds: Array.from(new Set(list.map((x) => str(x.l.requirementId)).filter(Boolean))), quotationIds: Array.from(new Set(list.map((x) => str(x.l.quotationId)).filter(Boolean))) },
                sourceKey: `GR_${a.deliveryId}_${leId}_${type}`,
                stock: g.stock,
                extra: g.extra,
            });
            journals.push(p.id);
        }
    }
    return { journals, note: notLive.length ? `Finance is not live for ${notLive.join(', ')}: quantities were recorded, nothing was posted.` : '' };
}

// ===== Service acceptance =====

export async function acceptService(ctx: OrgContext, a: { po: Obj; poId: string; receiptId: string; invoiceNo: string; lines: Array<{ no: number; qty: number; amount: number }> }): Promise<{ journals: string[]; note: string }> {
    const units = await unitsOf(ctx.orgId);
    const cache = new Map<string, LeInfo>();
    const byLe = new Map<string, Array<{ l: Obj; amount: number; info: LeInfo }>>();
    for (const x of a.lines) {
        const l = objs(a.po.lines).find((q) => Number(q.no) === x.no);
        if (!l) throw new HttpError(400, `Line ${x.no} does not exist.`);
        const info = await leInfo(ctx.orgId, units, ccOfLine(l), cache);
        byLe.set(info.le.id, [...(byLe.get(info.le.id) ?? []), { l, amount: x.amount, info }]);
    }
    const journals: string[] = [];
    const notLive: string[] = [];
    for (const [leId, list] of byLe) {
        const info = list[0].info;
        if (info.state === 'not_live') {
            notLive.push(info.le.code);
            continue;
        }
        const rate = await fxRate(str(a.po.currency), info.currency);
        const map = await mappingOf(ctx.orgId, leId);
        const grir = roleAccount(map, 'GRIR');
        const lines: PostLine[] = [];
        for (const x of list) {
            const value = round2(x.amount * rate);
            const cc = ccOfLine(x.l);
            lines.push({ side: 'D', glCode: str(x.l.glCode), ccId: cc, amount: value, docAmount: x.amount, description: `${a.poId} line ${Number(x.l.no)}: ${str(x.l.itemName) || str(x.l.requirement)}`.slice(0, 200) });
            lines.push({ side: 'C', glCode: grir, ccId: cc, amount: value, docAmount: x.amount, description: `GR/IR ${a.poId} service ${a.receiptId}, invoice ${a.invoiceNo}`.slice(0, 200) });
        }
        const p = await post(ctx, {
            leId,
            type: 'SVC_ACCEPT',
            docCurrency: str(a.po.currency),
            fxRate: rate,
            lines,
            narrative: `Service ${a.receiptId} on ${a.poId} from ${str(a.po.vendorName)}, invoice ${a.invoiceNo}`,
            source: { kind: 'purchase_order', id: a.poId, ref: a.receiptId, route: `organization_home/procurement_orders/${a.poId}` },
            trace: { poId: a.poId, receiptId: a.receiptId, invoiceNo: a.invoiceNo, vendorName: str(a.po.vendorName), requisitionIds: Array.from(new Set(list.map((x) => str(x.l.requisitionId)).filter(Boolean))), requirementIds: Array.from(new Set(list.map((x) => str(x.l.requirementId)).filter(Boolean))), quotationIds: Array.from(new Set(list.map((x) => str(x.l.quotationId)).filter(Boolean))) },
            sourceKey: `SVC_${a.receiptId}_${leId}`,
        });
        journals.push(p.id);
    }
    return { journals, note: notLive.length ? `Finance is not live for ${notLive.join(', ')}: the service was accepted, nothing was posted.` : '' };
}

// ===== Stock take =====

/** Values a posted stock count: losses at moving average, gains at the moving (or last known) average cost. */
export async function postStockTake(ctx: OrgContext, warehouseId: string, sessionId: string, deltas: Array<{ materialId: string; delta: number }>): Promise<string> {
    const moves = deltas.filter((d) => d.delta !== 0);
    if (!moves.length) return '';
    const units = await unitsOf(ctx.orgId);
    const info = await leInfo(ctx.orgId, units, warehouseId, new Map());
    if (info.state === 'not_live') return '';
    const map = await mappingOf(ctx.orgId, info.le.id);
    const diff = roleAccount(map, 'STOCK_DIFF');
    const lines: PostLine[] = [];
    const stock: StockMove[] = [];
    const agg = new Map<string, number>();
    for (const d of moves) agg.set(d.materialId, round4((agg.get(d.materialId) ?? 0) + d.delta));
    for (const [materialId, delta] of agg) {
        if (!delta) continue;
        const [v, m] = await Promise.all([stockValOf(ctx.orgId, warehouseId, materialId), getDoc(`organizations/${ctx.orgId}/materials/${materialId}`)]);
        const sdoc = await getDoc(P(ctx.orgId).stock(warehouseId, materialId));
        const gl = str(sdoc?.data.glCode) || roleAccount(map, 'INVENTORY', str(m?.data.categoryCode));
        let value: number;
        if (delta < 0) value = issueValue(v, -delta);
        else {
            if (!(v.avg > 0)) throw new HttpError(409, `Material ${str(m?.data.materialNumber) || materialId} has no cost in finance, so a counted gain cannot be valued. Value its stock first (Finance > Cost Centers > warehouse > Stock).`);
            value = round2(v.avg * delta);
        }
        if (!(value > 0)) continue;
        const label = `${str(m?.data.materialNumber) || materialId}: count ${delta > 0 ? 'gain' : 'loss'} ${Math.abs(delta)}`;
        lines.push({ side: delta < 0 ? 'D' : 'C', glCode: diff, ccId: warehouseId, amount: value, description: label, materialId, qty: delta });
        lines.push({ side: delta < 0 ? 'C' : 'D', glCode: gl, ccId: warehouseId, amount: value, description: label, materialId, qty: delta });
        stock.push({ warehouseId, materialId, materialNumber: str(m?.data.materialNumber), qty: delta, value: delta < 0 ? -value : value, expectedUpdateTime: v.updateTime, glCode: gl } as StockMove);
    }
    if (!lines.length) return '';
    const key = hashKey(JSON.stringify(Array.from(agg.entries()).sort()));
    const p = await post(ctx, { leId: info.le.id, type: 'ST_ADJ', docCurrency: info.currency, fxRate: 1, lines, narrative: `Stock take ${sessionId} at ${units.get(warehouseId)?.code ?? warehouseId}`, source: { kind: 'stock_take', id: sessionId, ref: sessionId, route: '' }, trace: { sessionId, warehouseId }, sourceKey: `ST_${sessionId}_${key}`, stock });
    return p.id;
}

// ===== Opening stock valuation (approved) =====

async function unvalued(orgId: string, warehouseId: string): Promise<Array<{ materialId: string; materialNumber: string; name: string; categoryCode: string; physical: number; valuedQty: number; value: number; avg: number; gap: number }>> {
    const [mj, stocks, mats] = await Promise.all([
        runQuery({ from: [{ collectionId: 'material_journal' }], where: fieldEq('warehouseId', warehouseId) }, `organizations/${orgId}`),
        runQuery({ from: [{ collectionId: 'fin_stock' }], where: fieldEq('warehouseId', warehouseId) }, `organizations/${orgId}`),
        listDocs(`organizations/${orgId}/materials`),
    ]);
    const phys = new Map<string, number>();
    for (const d of mj) if (str(d.data.status) === 'posted') phys.set(str(d.data.materialId), (phys.get(str(d.data.materialId)) ?? 0) + (Number(o(d.data.balancesDelta).physicalStock) || 0));
    const val = new Map(stocks.map((s) => [str(s.data.materialId), { qty: (Number(s.data.qtyM) || 0) / 10000, value: (Number(s.data.valueC) || 0) / 100 }]));
    const mm = new Map(mats.map((m) => [m.id, m]));
    const ids = new Set([...phys.keys(), ...val.keys()]);
    return Array.from(ids)
        .map((id) => {
            const p = round4(phys.get(id) ?? 0);
            const v = val.get(id) ?? { qty: 0, value: 0 };
            const m = mm.get(id);
            return { materialId: id, materialNumber: str(m?.data.materialNumber), name: str(m?.data.name) || str(m?.data.shortText), categoryCode: str(m?.data.categoryCode), physical: p, valuedQty: round4(v.qty), value: round2(v.value), avg: v.qty > 0 ? round4(v.value / v.qty) : 0, gap: round4(p - v.qty) };
        })
        .sort((a, b) => a.materialNumber.localeCompare(b.materialNumber));
}

registerHandler('stock.opening', {
    label: 'Opening stock valuation',
    approvePerm: 'FIN.post.approve',
    valued: true,
    apply: async (ctx, req, id) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const wh = str(p.warehouseId);
        const now = await unvalued(ctx.orgId, wh);
        const map = await mappingOf(ctx.orgId, leId);
        const ob = roleAccount(map, 'OPENING_BALANCE');
        const lines: PostLine[] = [];
        const stock: StockMove[] = [];
        for (const it of objs(p.items)) {
            const cur = now.find((x) => x.materialId === str(it.materialId));
            if (!cur || cur.gap !== Number(it.qty)) throw new HttpError(409, `The unvalued quantity of ${str(it.materialNumber)} changed. Reject and propose again.`);
            const value = round2(Number(it.qty) * Number(it.unitCost));
            const gl = roleAccount(map, 'INVENTORY', cur.categoryCode);
            const v = await stockValOf(ctx.orgId, wh, cur.materialId);
            lines.push({ side: 'D', glCode: gl, ccId: wh, amount: value, description: `Opening stock ${cur.materialNumber}: ${cur.gap} at ${Number(it.unitCost)}`, materialId: cur.materialId, qty: cur.gap });
            lines.push({ side: 'C', glCode: ob, ccId: wh, amount: value, description: `Opening stock ${cur.materialNumber}` });
            stock.push({ warehouseId: wh, materialId: cur.materialId, materialNumber: cur.materialNumber, qty: cur.gap, value, expectedUpdateTime: v.updateTime, glCode: gl } as StockMove);
        }
        const e = await entityOf(ctx.orgId, leId);
        const posted = await post(ctx, { leId, type: 'STK_OPEN', docCurrency: e.functionalCurrency, fxRate: 1, lines, narrative: `Opening stock valuation ${str(p.warehouseCode)}`, source: { kind: 'stock_valuation', id, ref: id, route: '' }, trace: { request: id, warehouseId: wh }, sourceKey: `STKOPEN_${id}`, approvalRef: id, stock });
        return { journalId: posted.id };
    },
});

// ===== Goods issue =====

const ISSUE_STATUSES = ['released', 'scheduled', 'in_progress'];
/** Goods issue belongs to inventory: it works whether or not the Finance module is enabled (then it only moves quantities). */
const inv = (name: string, fn: (ctx: OrgContext) => Promise<unknown>) => orgRoute(name, null, fn);

async function issueWarehouses(ctx: OrgContext, units: Map<string, Unit>) {
    const scope = await scopeOf(ctx);
    const whs = await listDocs(`organizations/${ctx.orgId}/warehouses`);
    return whs.filter((w) => units.get(w.id) && permAt(ctx, 'INV.issue', w.id, units, scope)).map((w) => ({ id: w.id, code: units.get(w.id)!.code, name: units.get(w.id)!.name || str(w.data.name) }));
}

export const finOpsRoutes = {
    'POST /api/org/inv/issue/options': [
        inv('org.inv.issue.options', async (ctx) => {
            const units = await unitsOf(ctx.orgId);
            const warehouses = await issueWarehouses(ctx, units);
            const wh = str(ctx.body.warehouseId);
            if (!wh) return { warehouses };
            if (!warehouses.some((w) => w.id === wh)) throw new HttpError(403, 'You cannot issue from this warehouse (INV.issue).');
            const le = leOf(units, wh);
            if (!le) throw new HttpError(409, 'The warehouse is not under a legal entity.');
            const [stock, wos, users, state] = await Promise.all([unvalued(ctx.orgId, wh), listDocs(`organizations/${ctx.orgId}/work_orders`), orgUsers(ctx.orgId), financeState(ctx.orgId, le.id)]);
            const avail = new Map<string, number>();
            for (const s of stock) if (s.physical > 0) avail.set(s.materialId, (await physicalOf(ctx.orgId, wh, s.materialId)).available);
            const ccs = Array.from(units.values()).filter((u) => u.level === 'cost_center' && u.status !== 'inactive' && leOf(units, u.id)?.id === le.id);
            return {
                warehouses,
                finance: state,
                leCode: le.code,
                materials: stock.filter((s) => (avail.get(s.materialId) ?? 0) > 0).map((s) => ({ ...s, available: avail.get(s.materialId) ?? 0 })),
                costCenters: ccs.map((u) => ({ id: u.id, code: u.code, name: u.name })),
                workOrders: wos.filter((w) => ISSUE_STATUSES.includes(str(w.data.status)) && ccs.some((c) => c.id === str(w.data.costCenterId))).map((w) => ({ id: w.id, title: str(w.data.title), costCenterId: str(w.data.costCenterId), status: str(w.data.status) })),
                people: users.filter((u) => u.id !== ctx.uid && str(u.data.status) !== 'disabled').map((u) => ({ uid: u.id, name: nameOf(u) })).sort((a, b) => a.name.localeCompare(b.name)),
            };
        }),
    ],
    'POST /api/org/inv/issue/post': [
        inv('org.inv.issue.post', async (ctx) => {
            const units = await unitsOf(ctx.orgId);
            const wh = str(ctx.body.warehouseId);
            const warehouses = await issueWarehouses(ctx, units);
            if (!warehouses.some((w) => w.id === wh)) throw new HttpError(403, 'You cannot issue from this warehouse (INV.issue).');
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the quantities were physically handed over.');
            const woId = str(ctx.body.workOrderId);
            let ccId = str(ctx.body.ccId);
            let wo: Doc | null = null;
            if (woId) {
                if (!/^WO\d{8}$/.test(woId)) throw new HttpError(400, 'Choose the work order.');
                wo = await getDoc(`organizations/${ctx.orgId}/work_orders/${woId}`);
                if (!wo || !ISSUE_STATUSES.includes(str(wo.data.status))) throw new HttpError(409, 'The work order is not released, scheduled or in progress.');
                ccId = str(wo.data.costCenterId);
            }
            const cc = units.get(ccId);
            const whLe = leOf(units, wh);
            if (!cc || cc.level !== 'cost_center' || cc.status === 'inactive') throw new HttpError(400, 'Choose the cost center the stock is issued to.');
            if (!whLe || leOf(units, ccId)?.id !== whLe.id) throw new HttpError(400, 'Stock can only be issued to a cost center of the same legal entity as the warehouse.');
            if ((await ccFinOf(ctx.orgId, ccId)).status !== 'open') throw new HttpError(409, `Cost center ${cc.code} is not open for posting.`);
            const receivedBy = str(ctx.body.receivedBy);
            if (!receivedBy || receivedBy === ctx.uid) throw new HttpError(400, 'Choose the person who received the stock. It cannot be you.');
            const receiver = await getDoc(`users/${receivedBy}`);
            if (!receiver || str(receiver.data.orgId) !== ctx.orgId || str(receiver.data.status) === 'disabled') throw new HttpError(400, 'Choose an active person of your organization as the receiver.');
            const ref = oneLine(ctx.body.ref, 60);
            const note = oneLine(ctx.body.note, 300);
            if (ref.length < 3) throw new HttpError(400, 'Enter the issue slip or reference (at least 3 characters).');
            const want = objs(ctx.body.lines).slice(0, 31).map((l) => ({ materialId: str(l.materialId), qty: Number(l.qty) }));
            if (!want.length || want.length > 30) throw new HttpError(400, 'Issue 1 to 30 materials at a time.');
            if (new Set(want.map((w) => w.materialId)).size !== want.length) throw new HttpError(400, 'A material is listed twice.');
            const info = await leInfo(ctx.orgId, units, wh, new Map());
            const map = info.state === 'live' ? await mappingOf(ctx.orgId, info.le.id) : null;
            // Every line is checked before a number is taken, so issue numbers have no gaps from refused issues.
            const checked: Array<{ m: Doc; qty: number }> = [];
            for (const [i, w] of want.entries()) {
                if (!(w.qty > 0) || w.qty > 1e9) throw new HttpError(400, `Line ${i + 1}: enter a quantity above zero.`);
                const m = await materialIn(ctx.orgId, w.materialId, wh);
                if (!m) throw new HttpError(400, `Line ${i + 1}: the material is not held in this warehouse.`);
                const { available } = await physicalOf(ctx.orgId, wh, w.materialId);
                if (w.qty > available + 1e-9) throw new HttpError(409, `${str(m.data.materialNumber)}: only ${available} is available to issue.`);
                if (map) issueValue(await stockValOf(ctx.orgId, wh, m.id), w.qty);
                checked.push({ m, qty: w.qty });
            }
            const n = await nextCounter(ctx.orgId, 'issues', 'seq');
            const gid = `GI${String(n).padStart(8, '0')}`;
            const lines: PostLine[] = [];
            const stock: StockMove[] = [];
            const extra: Write[] = [];
            const out: Obj[] = [];
            for (const [i, c] of checked.entries()) {
                const m = c.m;
                const w = { materialId: m.id, qty: c.qty };
                const entry = mjEntry(m.id, wh, str(m.data.materialNumber), 'GOODS_ISSUE', -w.qty, gid, ctx.uid, { issueId: gid, costCenterId: ccId, workOrderId: woId, receivedBy, source: 'goods_issue' });
                const mjId = safeId(`GI_${gid}_${i + 1}`);
                let value = 0;
                if (map) {
                    const v = await stockValOf(ctx.orgId, wh, m.id);
                    value = issueValue(v, w.qty);
                    const sdoc = await getDoc(P(ctx.orgId).stock(wh, m.id));
                    const inv = str(sdoc?.data.glCode) || roleAccount(map, 'INVENTORY', str(m.data.categoryCode));
                    const exp = roleAccount(map, woId ? 'MAINT_CONSUMPTION' : 'CONSUMPTION', str(m.data.categoryCode));
                    const desc = `${str(m.data.materialNumber)} ${str(m.data.name)}: ${w.qty}`.slice(0, 200);
                    if (value > 0) {
                        lines.push({ side: 'D', glCode: exp, ccId, amount: value, description: desc, materialId: m.id, qty: w.qty });
                        lines.push({ side: 'C', glCode: inv, ccId: wh, amount: value, description: desc, materialId: m.id, qty: -w.qty });
                    }
                    stock.push({ warehouseId: wh, materialId: m.id, materialNumber: str(m.data.materialNumber), qty: -w.qty, value: -value, expectedUpdateTime: v.updateTime, glCode: inv } as StockMove);
                    extra.push({ path: mjPath(ctx.orgId, mjId), exists: false, fields: entry });
                } else await writeDoc(mjPath(ctx.orgId, mjId), { ...entry, financeNote: 'Finance not live: not posted' } as unknown as Fields, { exists: false });
                out.push({ no: i + 1, materialId: m.id, materialNumber: str(m.data.materialNumber), name: str(m.data.name), qty: w.qty, uom: str(m.data.baseUom) || str(m.data.uom), value, unitCost: w.qty ? round4(value / w.qty) : 0 });
            }
            let journalId = '';
            if (map && lines.length) {
                const p = await post(ctx, { leId: info.le.id, type: woId ? 'GI_WO' : 'GI_CC', docCurrency: info.currency, fxRate: 1, lines, narrative: `Goods issue ${gid} from ${units.get(wh)?.code} to ${cc.code}${woId ? ` for ${woId}` : ''}`, source: { kind: 'goods_issue', id: gid, ref: ref, route: woId ? `organization_home/work_orders/${woId}` : '' }, trace: { issueId: gid, warehouseId: wh, costCenterId: ccId, workOrderId: woId, receivedBy: nameOf(receiver) }, sourceKey: `GI_${gid}`, stock, extra });
                journalId = p.id;
            } else if (map) for (const x of extra) await writeDoc(x.path, x.fields as unknown as Fields, { exists: false });
            const at = nowIso();
            await writeDoc(`organizations/${ctx.orgId}/goods_issues/${gid}`, { id: gid, leId: info.le.id, warehouseId: wh, costCenterId: ccId, workOrderId: woId, ref, note, lines: out as unknown as Fields[keyof Fields], total: round2(out.reduce((s, x) => s + (Number(x.value) || 0), 0)), journalId, finance: info.state, issuedBy: ctx.uid, issuedByName: nameOf(ctx.me), receivedBy, receivedByName: nameOf(receiver), at } as unknown as Fields);
            if (wo) {
                const fresh = await getDoc(`organizations/${ctx.orgId}/work_orders/${woId}`);
                if (fresh) {
                    const used = [...objs(fresh.data.sparesUsed), ...out.map((x) => ({ id: `${gid}_${x.no}`, description: `${str(x.materialNumber)} ${str(x.name)}`.trim(), qty: Number(x.qty), uom: str(x.uom) || 'EA', unitCost: Number(x.unitCost) || 0, uid: ctx.uid, name: nameOf(ctx.me), at, source: 'goods_issue', issueId: gid, journalId }))];
                    await writeDoc(`organizations/${ctx.orgId}/work_orders/${woId}`, { ...fresh.data, sparesUsed: used as unknown as Fields[keyof Fields], updatedAt: at } as unknown as Fields);
                }
            }
            await record(ctx, 'org.inv.issue.post', gid, `${out.length} material(s) from ${units.get(wh)?.code} to ${cc.code}${woId ? ` (${woId})` : ''}, received by ${nameOf(receiver)}${journalId ? `, journal ${journalId}` : ', not posted (finance not live)'}`.slice(0, 400));
            return { ok: true, id: gid, journalId, finance: info.state };
        }),
    ],
    'POST /api/org/inv/issue/list': [
        inv('org.inv.issue.list', async (ctx) => {
            const units = await unitsOf(ctx.orgId);
            const whs = new Set((await issueWarehouses(ctx, units)).map((w) => w.id));
            const docs = await listDocs(`organizations/${ctx.orgId}/goods_issues`);
            return {
                issues: docs
                    .filter((d) => whs.has(str(d.data.warehouseId)) || str(d.data.issuedBy) === ctx.uid || str(d.data.receivedBy) === ctx.uid)
                    .map((d) => ({ id: d.id, at: str(d.data.at), warehouse: units.get(str(d.data.warehouseId))?.code ?? '', costCenter: units.get(str(d.data.costCenterId))?.code ?? '', workOrderId: str(d.data.workOrderId), ref: str(d.data.ref), items: objs(d.data.lines).length, total: Number(d.data.total) || 0, journalId: str(d.data.journalId), issuedByName: str(d.data.issuedByName), receivedByName: str(d.data.receivedByName) }))
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 2000),
            };
        }),
    ],

    // ----- Stock valuation of a warehouse cost center -----

    'POST /api/org/fin/stock/list': [
        fin('org.fin.stock.list', async (ctx) => {
            const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
            const le = needEntity(units, scope, str(ctx.body.leId));
            const wh = str(ctx.body.warehouseId);
            if (leOf(units, wh)?.id !== le.id || !(await isWarehouse(ctx.orgId, wh))) throw new HttpError(404, 'Warehouse not found in this legal entity.');
            if (!['FIN.view', 'FIN.close.run', 'FIN.journal.view', 'FIN.post.approve'].some((p) => permAt(ctx, p, wh, units, scope))) throw new HttpError(403, 'Stock valuation needs finance access here.');
            const items = await unvalued(ctx.orgId, wh);
            return { items, total: round2(items.reduce((s, x) => s + x.value, 0)), canPropose: permAt(ctx, 'FIN.close.run', le.id, units, scope), finance: await financeState(ctx.orgId, le.id) };
        }),
    ],
    'POST /api/org/fin/stock/opening/propose': [
        fin('org.fin.stock.opening.propose', async (ctx) => {
            const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
            const le = needEntity(units, scope, str(ctx.body.leId));
            if (!permAt(ctx, 'FIN.close.run', le.id, units, scope)) throw new HttpError(403, 'Valuing stock needs FIN.close.run.');
            if ((await financeState(ctx.orgId, le.id)) !== 'live') throw new HttpError(409, `${le.code} must be live in finance before stock is valued (the valuation is posted).`);
            const wh = str(ctx.body.warehouseId);
            if (leOf(units, wh)?.id !== le.id || !(await isWarehouse(ctx.orgId, wh))) throw new HttpError(404, 'Warehouse not found in this legal entity.');
            const reason = reasonOf(ctx.body, 15);
            const now = await unvalued(ctx.orgId, wh);
            const items = objs(ctx.body.items).slice(0, 200).map((x) => ({ materialId: str(x.materialId), unitCost: Math.round(Number(x.unitCost) * 10000) / 10000 }));
            if (!items.length) throw new HttpError(400, 'Enter the unit cost of at least one material.');
            const payload: Obj[] = [];
            let total = 0;
            for (const it of items) {
                const cur = now.find((x) => x.materialId === it.materialId);
                if (!cur || !(cur.gap > 0)) throw new HttpError(400, 'Only stock that is not yet valued can be valued.');
                if (!(it.unitCost > 0)) throw new HttpError(400, `${cur.materialNumber}: enter a unit cost above zero.`);
                payload.push({ materialId: cur.materialId, materialNumber: cur.materialNumber, qty: cur.gap, unitCost: it.unitCost });
                total += cur.gap * it.unitCost;
            }
            total = round2(total);
            const w = units.get(wh)!;
            return createRequest(ctx, { leId: le.id, type: 'stock.opening', title: `${w.code} ${w.name}: opening stock value ${total}`, summary: payload.map((x) => `${str(x.materialNumber)}: ${x.qty} at ${x.unitCost}`).join('; '), payload: { warehouseId: wh, warehouseCode: w.code, items: payload as unknown as Obj }, reason, amount: total, scopeKey: `stockopen_${wh}` });
        }),
    ],
};

export { activePositions, cents };
