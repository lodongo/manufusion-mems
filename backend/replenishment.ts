/**
 * Replenishment for warehouse materials (Inventory › Replenishment Requests, INV-RPL).
 *
 * When anything about a material changes — its master record, its warehouse settings (strategy, ownership, supply
 * arrangement, levels, parameters), an extension to a warehouse, or a stock movement — the replenishment engine plans
 * that material in every warehouse where the replenishment strategy chosen in Stock Control is automated: RP01 Min-Max,
 * RP02 Reorder Point, RP03 EOQ, RP04 Just-in-Time and RP06 MRP (see replenishmentPlan.ts). Every other strategy is
 * recorded for planning only, and an older stocking policy without a Stock Control strategy never starts replenishment. What happens with the quantity depends on who owns and supplies the stock:
 *
 *   company-owned, standard / framework / emergency / project / direct buying
 *       → a purchase requirement with status UNVERIFIED (requester "Replenishment"), verified by a planner
 *         (INV.replenishment.verify), then the planner's manager approves under the chart of authority
 *   consignment, VMI or supplier-replenished, customer-owned, third-party, intercompany, subcontract, loan, pools …
 *       → a REPLENISHMENT SIGNAL for the right party (never an automatic purchase); a planner acknowledges it when the
 *         call-off / notification / transfer has been made
 *   unresolved ownership or drop shipping → blocked, logged
 *
 *   organizations/{org}/procurement_requirements/{REQ…}            status 'unverified', source 'replenishment'
 *   organizations/{org}/replenishment_keys/{material}__{warehouse}  the open unverified requirement, or a dismissal
 *   organizations/{org}/replenishment_signals/{material}__{warehouse} the open or acknowledged signal
 *   organizations/{org}/replenishment_state/{material}__{warehouse} last periodic review
 *   organizations/{org}/replenishment_locks/{material}__{warehouse} one planning run at a time
 *   organizations/{org}/replenishment_runs/{id}                     every run and its outcome
 *
 * One open request or signal per material and warehouse: later runs re-plan it, or close it when it is no longer
 * needed or the channel changes. Every create, re-plan, cancel, signal, acknowledgement, verification and dismissal is
 * audited. Requests raised by the earlier MRP engine (source 'mrp', mrp_keys) are adopted automatically.
 */
import { HttpError, deleteDoc, fieldEq, fieldIn, getDoc, isObj, listDocs, nowIso, randomId, runQuery, str, writeDoc, type Doc } from './core';
import { audit } from './audit';
import { onMaterialChanges, type MaterialChange } from './changeTracker';
import { materialIn } from './finCore';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { requirementsPath } from './procurementSetup';
import { record } from './org';
import {
    AUTOMATED_METHODS, CONSUMPTION_TYPES, METHODS, PO_OPEN, PRQ_OPEN, REQ_OPEN, RETURN_TYPES,
    factorsOf, legacyMethodOf, methodOf, numberOrNull, openQuantity, plan, routeFor, type Channel, type Params, type PlanResult,
} from './replenishmentPlan';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
export const keyOf = (materialId: string, warehouseId: string) => `${materialId}__${warehouseId}`;
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DEFAULT_LEAD_DAYS = 14;
const DEFAULT_LOOKBACK = 90;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter(isObj) as Obj[]) : []);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const SOURCES = ['replenishment', 'mrp'];

export const P = (orgId: string) => ({
    key: (k: string) => `${root(orgId)}/replenishment_keys/${k}`,
    legacyKey: (k: string) => `${root(orgId)}/mrp_keys/${k}`,
    signal: (k: string) => `${root(orgId)}/replenishment_signals/${k}`,
    state: (k: string) => `${root(orgId)}/replenishment_state/${k}`,
    lock: (k: string) => `${root(orgId)}/replenishment_locks/${k}`,
    runs: `${root(orgId)}/replenishment_runs`,
});

export type Trigger = { kind: 'change' | 'sweep' | 'manual'; route: string; uid: string; actor: string; source?: string };
export type Outcome = 'created' | 'replanned' | 'unchanged' | 'cancelled' | 'signalled' | 'signal_updated' | 'signal_closed' | 'no_need' | 'not_due' | 'not_planned' | 'incomplete' | 'blocked' | 'dismissed' | 'busy' | 'skipped' | 'failed';

// ----- Stock position and open supply -----

/** Physical and available stock, and consumption over the look-back window, from the posted material journal. */
export async function stockPosition(orgId: string, warehouseId: string, materialId: string, lookbackDays: number) {
    const docs = await runQuery({ from: [{ collectionId: 'material_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId));
    const t: Record<string, number> = {};
    const since = Date.now() - lookbackDays * 86_400_000;
    let consumed = 0;
    let earliest = Date.now();
    for (const d of docs) {
        if (str(d.data.status) !== 'posted') continue;
        const delta = isObj(d.data.balancesDelta) ? (d.data.balancesDelta as Obj) : {};
        for (const [k, v] of Object.entries(delta)) t[k] = (t[k] || 0) + (Number(v) || 0);
        const at = Date.parse(str(d.data.postedAt) || str(d.data.createdAt));
        if (Number.isFinite(at)) earliest = Math.min(earliest, at);
        if (!Number.isFinite(at) || at < since) continue;
        const type = str(d.data.type).toUpperCase();
        const q = Number(delta.physicalStock) || 0;
        if (CONSUMPTION_TYPES.includes(type) && q < 0) consumed += -q;
        if (RETURN_TYPES.includes(type) && q > 0) consumed -= q;
    }
    const physical = r3(t.physicalStock || 0);
    const available = r3(physical - (t.reservedStock || 0) - (t.quarantinedStock || 0) - (t.damagedStock || 0) - (t.expiredStock || 0) - (t.other || 0));
    // Usage is averaged over the history that exists, not over days before the first movement.
    const days = Math.max(1, Math.min(lookbackDays, Math.ceil((Date.now() - earliest) / 86_400_000)));
    return { physical, available, consumed: r3(Math.max(0, consumed)), consumedDays: docs.length ? days : lookbackDays };
}

export type Supply = Map<string, { qty: number; refs: string[] }>;
/** Open quantities on requirements, requisitions, purchase orders and replenishment signals, by material and warehouse. */
export async function supplyIndex(orgId: string): Promise<Supply> {
    const q = (collectionId: string, statuses: string[]) => runQuery({ from: [{ collectionId }], where: fieldIn('status', statuses) }, root(orgId));
    const [reqs, prqs, pos, signals] = await Promise.all([q('procurement_requirements', REQ_OPEN), q('procurement_requisitions', PRQ_OPEN), q('procurement_orders', PO_OPEN), q('replenishment_signals', ['acknowledged'])]);
    const out: Supply = new Map();
    const add = (k: string, qty: number, ref: string) => {
        if (qty <= 0) return;
        const e = out.get(k) ?? { qty: 0, refs: [] };
        e.qty = r3(e.qty + qty);
        if (e.refs.length < 10) e.refs.push(`${ref} (${qty})`);
        out.set(k, e);
    };
    const take = (kind: 'req' | 'prq' | 'po', docs: Doc[]) => {
        for (const d of docs) for (const l of objs(d.data.lines)) if (str(l.materialId) && str(l.warehouseId)) add(keyOf(str(l.materialId), str(l.warehouseId)), openQuantity(kind, l), str(d.data.number) || d.id);
    };
    take('req', reqs);
    take('prq', prqs);
    take('po', pos);
    // An acknowledged signal is supply on its way from the supplier, owner or pool.
    for (const s of signals) add(s.id, Number(s.data.quantity) || 0, `signal ${str(s.data.signalLabel) || s.id}`);
    return out;
}

// ----- Locks, run log, audit -----

async function lock(orgId: string, key: string): Promise<boolean> {
    const path = P(orgId).lock(key);
    if (await writeDoc(path, { at: nowIso() }, { exists: false })) return true;
    const cur = await getDoc(path);
    if (cur && Date.now() - Date.parse(str(cur.data.at)) > 120_000) return writeDoc(path, { at: nowIso() }, { updateTime: cur.updateTime });
    return false;
}
const unlock = (orgId: string, key: string) => deleteDoc(P(orgId).lock(key)).catch(() => undefined);

async function logRun(orgId: string, entry: Obj) {
    try {
        await writeDoc(`${P(orgId).runs}/${Date.now().toString(36)}${randomId(4)}`, { ...entry, at: nowIso() }, { exists: false });
    } catch {
        /* the run log never fails planning */
    }
}
function auditAction(orgId: string, trigger: Trigger, action: string, target: string, details: string) {
    return audit([{ category: 'data', action: `org.inventory.replenishment.${action}`, orgId, actor: trigger.uid ? { uid: trigger.uid, email: trigger.actor, orgId } : null, target: { type: action.startsWith('signal') ? 'replenishment_signal' : 'purchase_requirement', id: target, label: target }, details: details.slice(0, 600), source: 'server' }]);
}

const modulesOn = (org: Doc) => {
    const map = isObj(org.data.modules) ? (org.data.modules as Obj) : {};
    return { inv: map.INV === true, prc: map.PRC === true };
};

// ----- Building blocks -----

function paramsOf(i: Obj, p: Obj): Params {
    const n = (k: string, src: Obj = i) => numberOrNull(src[k]);
    return {
        minimumLevel: n('minimumLevel'), maximumLevel: n('maximumLevel'), reorderPoint: n('reorderPoint'), reorderQuantity: n('reorderQuantity'), safetyStock: n('safetyStock'),
        minimumOrderQuantity: n('minimumOrderQuantity', p), orderMultiple: n('orderMultiple', p), unitPrice: n('unitPrice', p),
        leadTimeDays: Math.max(0, Math.trunc(numberOrNull(p.leadTimeDays) ?? numberOrNull(i.leadTimeDays) ?? DEFAULT_LEAD_DAYS)),
        annualDemand: n('annualDemand'), orderCost: n('orderCost'), holdingCostRate: n('holdingCostRate'), demandLookbackDays: n('demandLookbackDays'), coverageDays: n('coverageDays'),
        emergencyLevel: n('emergencyLevel'), strategicLevel: n('strategicLevel'), seasonalFactors: factorsOf(i.seasonalFactors), rotablesInRepair: n('rotablesInRepair'),
        binQuantity: n('binQuantity'), kanbanCardQuantity: n('kanbanCardQuantity'), kanbanCards: n('kanbanCards'), reviewPeriodDays: n('reviewPeriodDays'), forecastMonthlyDemand: n('forecastMonthlyDemand'),
    };
}

function lineFor(material: Doc, wh: Doc | null, warehouseId: string, result: Extract<PlanResult, { kind: 'order' }>, params: Params, method: string, channel: Extract<Channel, { kind: 'purchase' }>, available: number, supply: number): Obj {
    const m = material.data;
    const name = (str(m.name) || str(m.shortText) || 'Material').slice(0, 160);
    const uomRaw = str(m.uom);
    const uom = PROCUREMENT_UNITS.find((u) => u.active && u.selectable && (u.code === uomRaw || u.symbol === uomRaw));
    return {
        no: 10, type: 'material', source: 'warehouse',
        categoryCode: str(m.categoryCode), subcategoryCode: str(m.subcategoryCode), familyCode: '', itemCode: '', itemName: name,
        master: { code: str(m.materialNumber), name },
        warehouseId, warehouseCode: str(wh?.data.code), warehouseName: str(wh?.data.name),
        materialId: material.id, materialNumber: str(m.materialNumber),
        requirement: `${name} (${str(m.materialNumber)})`.slice(0, 300),
        technical: `Automatic replenishment (${method} ${METHODS[method]?.name ?? ''}). Available ${available}, open supply ${supply}. ${result.basis}.${channel.note ? ` ${channel.note}` : ''}`.slice(0, 2000),
        attributes: {}, attributeView: [], requiredAttrs: [],
        quantity: result.quantity,
        unit: uom?.symbol ?? uomRaw, uomCode: uom?.code ?? '', uomLabel: uom?.label ?? '', uomCategoryCode: uom?.categoryCode ?? '', uomCategoryName: uom?.category ?? '',
        dateRequired: addDays(Math.max(1, params.leadTimeDays)),
        urgency: channel.urgent ? 'high' : result.urgency,
        budget: params.unitPrice !== null && params.unitPrice > 0 ? Math.round(result.quantity * params.unitPrice * 100) / 100 : null,
        costCenterId: warehouseId, costCenterCode: str(wh?.data.code), costCenterName: str(wh?.data.name),
        glCode: '', glName: '',
    };
}

async function cancelRequest(orgId: string, prId: string, reason: string, trigger: Trigger): Promise<boolean> {
    const path = `${requirementsPath(orgId)}/${prId}`;
    const d = await getDoc(path);
    if (!d || str(d.data.status) !== 'unverified') return false;
    const at = nowIso();
    const ok = await writeDoc(path, { ...d.data, status: 'cancelled', cancelReason: reason, updatedAt: at, version: (Number(d.data.version) || 1) + 1, history: [...objs(d.data.history), { at, by: 'replenishment', byName: 'Replenishment', action: 'cancelled', note: reason, from: 'unverified', to: 'cancelled' }] }, { updateTime: d.updateTime });
    if (ok) await auditAction(orgId, trigger, 'cancel', prId, reason);
    return ok;
}

async function closeSignal(orgId: string, key: string, reason: string, trigger: Trigger): Promise<boolean> {
    const path = P(orgId).signal(key);
    const d = await getDoc(path);
    if (!d || !['open', 'acknowledged'].includes(str(d.data.status))) return false;
    const at = nowIso();
    const ok = await writeDoc(path, { ...d.data, status: 'closed', closedAt: at, closeReason: reason, history: [...objs(d.data.history), { at, byName: 'Replenishment', action: 'closed', note: reason }].slice(-30) }, { updateTime: d.updateTime });
    if (ok) await auditAction(orgId, trigger, 'signal_close', key, reason);
    return ok;
}

// ----- Planning one material in one warehouse -----

export async function planMaterial(orgId: string, materialId: string, warehouseId: string, trigger: Trigger, ctx?: { org?: Doc; supply?: Supply }): Promise<{ outcome: Outcome; prId?: string; reason: string }> {
    if (!ID.test(materialId) || !ID.test(warehouseId)) return { outcome: 'skipped', reason: 'Invalid material or warehouse.' };
    const org = ctx?.org ?? (await getDoc(root(orgId)));
    if (!org) return { outcome: 'skipped', reason: 'Organization not found.' };
    const key = keyOf(materialId, warehouseId);
    if (!(await lock(orgId, key))) return { outcome: 'busy', reason: 'Another replenishment run for this material and warehouse is in progress.' };
    const paths = P(orgId);
    const base = { materialId, warehouseId, trigger: trigger.kind, route: trigger.route, source: trigger.source ?? '', by: trigger.uid };
    try {
        const [inv, proc, firstKey, signalDoc, material, wh, state] = await Promise.all([
            getDoc(`${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`),
            getDoc(`${root(orgId)}/procurement_material_info/${materialId}_${warehouseId}`),
            getDoc(paths.key(key)),
            getDoc(paths.signal(key)),
            materialIn(orgId, materialId, warehouseId),
            getDoc(`${root(orgId)}/structure/${warehouseId}`),
            getDoc(paths.state(key)),
        ]);
        let keyDoc = firstKey;
        // Adopt a request raised by the earlier MRP engine.
        if (!keyDoc) {
            const legacy = await getDoc(paths.legacyKey(key));
            if (legacy) {
                await writeDoc(paths.key(key), legacy.data, { exists: false });
                await deleteDoc(paths.legacyKey(key));
                keyDoc = await getDoc(paths.key(key));
            }
        }
        const openId = str(keyDoc?.data.prId);
        const signalOpen = !!signalDoc && ['open', 'acknowledged'].includes(str(signalDoc.data.status));
        const i = inv?.data ?? {};
        const method = methodOf(i.replenishmentStrategy, i.stockingPolicy);
        const finish = async (outcome: Outcome, reason: string, extra: Obj = {}, prId = '') => {
            await logRun(orgId, { ...base, outcome, reason, prId, method, materialNumber: str(material?.data.materialNumber), ...extra });
            return { outcome, reason, prId: prId || undefined };
        };
        const closeRequest = async (reason: string) => {
            if (!openId) return false;
            const done = await cancelRequest(orgId, openId, reason, trigger);
            await deleteDoc(paths.key(key));
            return done;
        };
        const closeAll = async (reason: string) => {
            const a = await closeRequest(reason);
            const b = signalOpen ? await closeSignal(orgId, key, reason, trigger) : false;
            return a || b;
        };

        if (!METHODS[method]?.automated) {
            if (await closeAll(`Replenishment: ${METHODS[method] ? `${method} ${METHODS[method].name} is not replenished automatically` : 'no automated replenishment strategy'}.`)) return finish('cancelled', 'Strategy changed; the open request or signal was closed.', {}, openId);
            return { outcome: 'not_planned', reason: METHODS[method] ? `${method} ${METHODS[method].name} is not replenished automatically.` : 'No automated replenishment strategy.' };
        }
        const mods = modulesOn(org);
        if (!mods.inv) return finish('skipped', 'Inventory must be adopted for replenishment.');
        if (!material || !['approved', 'active'].includes(str(material.data.status).toLowerCase())) {
            if (await closeAll('Replenishment: the material is no longer published in this warehouse.')) return finish('cancelled', 'Material unpublished or unlinked; open request or signal closed.', {}, openId);
            return finish('skipped', 'The material is not published in this warehouse.');
        }

        const params = paramsOf(i, proc?.data ?? {});
        const channel = routeFor(str(i.stockOwnership), str(i.supplyArrangement), method);
        if (channel.kind === 'blocked') {
            if (await closeAll(`Replenishment: ${channel.reason}`)) return finish('cancelled', channel.reason, {}, openId);
            return finish('blocked', channel.reason);
        }
        const lookback = Math.max(7, Math.min(730, Math.trunc(params.demandLookbackDays ?? DEFAULT_LOOKBACK)));
        const [stock, supply] = await Promise.all([stockPosition(orgId, warehouseId, materialId, lookback), ctx?.supply ? Promise.resolve(ctx.supply) : supplyIndex(orgId)]);
        const open = supply.get(key) ?? { qty: 0, refs: [] };
        const daysSinceReview = state?.data.lastReviewAt ? (Date.now() - Date.parse(str(state.data.lastReviewAt))) / 86_400_000 : null;
        const result = plan(method, params, {
            available: stock.available, openSupply: open.qty, consumed: stock.consumed, consumedDays: stock.consumedDays,
            arrivalMonth: new Date(Date.now() + params.leadTimeDays * 86_400_000).getUTCMonth(), daysSinceReview,
        });
        const numbers = { method, channel: channel.kind === 'signal' ? channel.signal : 'purchase', physical: stock.physical, available: stock.available, openSupply: open.qty, supplyRefs: open.refs, consumed: stock.consumed, consumedDays: stock.consumedDays };
        if (result.kind === 'not_due') return finish('not_due', result.reason, numbers);
        if (method === 'RP15') await writeDoc(paths.state(key), { lastReviewAt: nowIso(), materialId, warehouseId });

        if (result.kind === 'incomplete' || result.kind === 'not_planned') {
            if (await closeAll(`Replenishment: ${result.reason}`)) return finish('cancelled', `${result.reason} The open request or signal was closed.`, numbers, openId);
            return finish(result.kind === 'incomplete' ? 'incomplete' : 'not_planned', result.reason, numbers);
        }
        if (result.kind === 'no_need') {
            // An acknowledged signal is counted as supply: keep it until stock is covered without it (goods arrived).
            if (signalOpen && str(signalDoc!.data.status) === 'acknowledged') {
                const withoutSignal = r3(result.projected - (Number(signalDoc!.data.quantity) || 0));
                if (withoutSignal <= result.trigger) {
                    await closeRequest(`Replenishment: no longer required. ${result.reason}`);
                    return finish('unchanged', `Awaiting the acknowledged ${str(signalDoc!.data.signalLabel).toLowerCase()} (${Number(signalDoc!.data.quantity)}).`, numbers);
                }
                if (await closeAll(`Replenishment: stock is covered (${result.reason})`)) return finish('signal_closed', `Supply received; signal closed. ${result.reason}`, numbers);
            }
            if (await closeAll(`Replenishment: no longer required. ${result.reason}`)) return finish('cancelled', `No longer required: ${result.reason}`, numbers, openId);
            return finish('no_need', result.reason, numbers);
        }

        const calc = { ...numbers, projected: result.projected, trigger: result.trigger, target: result.target, basis: result.basis, leadTimeDays: params.leadTimeDays, minimumOrderQuantity: params.minimumOrderQuantity, orderMultiple: params.orderMultiple, safetyStock: params.safetyStock, plannedAt: nowIso(), triggerKind: trigger.kind, triggerRoute: trigger.route };
        const wName = str(wh?.data.code) || warehouseId;
        const mNo = str(material.data.materialNumber);

        // ----- Signal to supplier, owner or pool -----
        if (channel.kind === 'signal') {
            await closeRequest(`Replenishment: this material is now replenished by ${channel.label.toLowerCase()}, not by purchase.`);
            const at = nowIso();
            const unit = str(material.data.uom);
            if (signalOpen && str(signalDoc!.data.status) === 'acknowledged' && str(signalDoc!.data.signal) === channel.signal) return finish('unchanged', `Acknowledged ${channel.label.toLowerCase()} still covers it.`, numbers);
            if (signalOpen && str(signalDoc!.data.signal) === channel.signal) {
                if (Number(signalDoc!.data.quantity) === result.quantity && str(signalDoc!.data.urgency) === result.urgency) return finish('unchanged', `Signal still open: ${result.basis}.`, numbers);
                const ok = await writeDoc(paths.signal(key), { ...signalDoc!.data, quantity: result.quantity, urgency: result.urgency, calc, updatedAt: at, history: [...objs(signalDoc!.data.history), { at, byName: 'Replenishment', action: 'replanned', note: `Quantity ${Number(signalDoc!.data.quantity)} → ${result.quantity}` }].slice(-30) }, { updateTime: signalDoc!.updateTime });
                if (!ok) return finish('busy', 'The signal changed while it was being re-planned.', numbers);
                await auditAction(orgId, trigger, 'signal_replan', key, `${mNo} at ${wName}: ${channel.label} ${Number(signalDoc!.data.quantity)} → ${result.quantity}. ${result.basis}`);
                return finish('signal_updated', result.basis, numbers);
            }
            const dismissedUntil = str(keyDoc?.data.dismissedUntil);
            if (trigger.kind === 'sweep' && dismissedUntil && dismissedUntil > nowIso()) return finish('dismissed', `Dismissed by a planner until ${dismissedUntil.slice(0, 10)}; a change to the material plans it again.`, numbers);
            await writeDoc(paths.signal(key), {
                materialId, warehouseId, materialNumber: mNo, materialName: str(material.data.name) || str(material.data.shortText), warehouseCode: str(wh?.data.code), warehouseName: str(wh?.data.name),
                status: 'open', signal: channel.signal, signalLabel: channel.label, action: channel.action, method, methodName: METHODS[method].name,
                ownership: str(i.stockOwnership), arrangement: str(i.supplyArrangement), quantity: result.quantity, unit, urgency: result.urgency,
                dateRequired: addDays(Math.max(1, params.leadTimeDays)), calc, createdAt: at, updatedAt: at,
                history: [{ at, byName: 'Replenishment', action: 'raised', note: `${channel.action} ${result.basis}.` }],
            });
            await auditAction(orgId, trigger, 'signal', key, `${mNo} at ${wName}: ${channel.label}, ${result.quantity} ${unit}. ${result.basis}`);
            return finish('signalled', `${channel.label}: ${result.basis}`, numbers);
        }

        // ----- Purchase requirement -----
        if (signalOpen) await closeSignal(orgId, key, 'Replenishment: this material is now replenished by purchase.', trigger);
        if (!mods.prc) return finish('skipped', 'Procurement must be adopted to raise purchase requirements for replenishment.', numbers);
        const line = lineFor(material, wh, warehouseId, result, params, method, channel, stock.available, open.qty);
        if (openId) {
            const path = `${requirementsPath(orgId)}/${openId}`;
            const pr = await getDoc(path);
            if (pr && str(pr.data.status) === 'unverified') {
                const cur = objs(pr.data.lines)[0] ?? {};
                const same = Number(cur.quantity) === Number(line.quantity) && str(cur.urgency) === str(line.urgency) && str(cur.dateRequired) === str(line.dateRequired);
                if (same) return finish('unchanged', `Still needed: ${result.basis}.`, numbers, openId);
                const at = nowIso();
                const ok = await writeDoc(path, { ...pr.data, source: 'replenishment', lines: [{ ...cur, ...line }], replenishment: calc, updatedAt: at, version: (Number(pr.data.version) || 1) + 1, history: [...objs(pr.data.history), { at, by: 'replenishment', byName: 'Replenishment', action: 'replanned', note: `Quantity ${Number(cur.quantity)} → ${result.quantity}, urgency ${str(line.urgency)}, needed by ${str(line.dateRequired)}`, from: 'unverified', to: 'unverified' }] }, { updateTime: pr.updateTime });
                if (!ok) return finish('busy', 'The request changed while it was being re-planned; the next change re-plans it.', numbers, openId);
                await auditAction(orgId, trigger, 'replan', openId, `${mNo} at ${wName}: quantity ${Number(cur.quantity)} → ${result.quantity}. ${result.basis}`);
                return finish('replanned', result.basis, numbers, openId);
            }
            await deleteDoc(paths.key(key));
        }
        const dismissedUntil = str(keyDoc?.data.dismissedUntil);
        if (trigger.kind === 'sweep' && dismissedUntil && dismissedUntil > nowIso()) return finish('dismissed', `Dismissed by a planner until ${dismissedUntil.slice(0, 10)}; a change to the material plans it again.`, numbers);

        const id = `REQ${String(await nextOrgCounter(orgId, 'requirementSeq')).padStart(9, '0')}`;
        const at = nowIso();
        const name = str(material.data.name) || str(material.data.shortText) || materialId;
        const created = await writeDoc(`${requirementsPath(orgId)}/${id}`, {
            number: id, title: `Replenishment · ${mNo} ${name}`.slice(0, 120), status: 'unverified', source: 'replenishment', replenishmentKey: key, replenishment: calc,
            requesterUid: 'replenishment', requesterName: 'Replenishment (automatic)', requesterEmail: '',
            lines: [line], attachments: [], attachmentSeq: 0, createdAt: at, updatedAt: at, version: 1,
            history: [{ at, by: 'replenishment', byName: 'Replenishment', action: 'created', note: `${result.basis}. Waiting for a planner to verify.`, from: '', to: 'unverified' }],
        }, { exists: false });
        if (!created) return finish('failed', 'The requirement number was already used.', numbers);
        const curKey = await getDoc(paths.key(key));
        const keyed = await writeDoc(paths.key(key), { prId: id, materialId, warehouseId, createdAt: at }, curKey ? { updateTime: curKey.updateTime } : { exists: false });
        if (!keyed) {
            await cancelRequest(orgId, id, 'Replenishment: duplicate of a request raised at the same moment.', trigger);
            return finish('busy', 'Another run raised the request at the same moment.', numbers);
        }
        await auditAction(orgId, trigger, 'create', id, `${mNo} at ${wName}: ${result.quantity} ${str(line.unit)} (${method} ${METHODS[method].name}). ${result.basis}`);
        return finish('created', result.basis, numbers, id);
    } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 300) : 'Planning failed.';
        await logRun(orgId, { ...base, outcome: 'failed', reason });
        return { outcome: 'failed', reason };
    } finally {
        await unlock(orgId, key);
    }
}

// ----- Which pairs to plan -----

const automated = (d: Doc) => METHODS[methodOf(d.data.replenishmentStrategy, d.data.stockingPolicy)]?.automated === true;

async function plannedInfos(orgId: string, field: 'materialId' | 'warehouseId' | '', value = ''): Promise<Doc[]> {
    if (field) return (await runQuery({ from: [{ collectionId: 'inventory_material_info' }], where: fieldEq(field, value) }, root(orgId))).filter(automated);
    // Only the Stock Control strategy counts (RP01-RP04, RP06); open requests of anything else are closed by the sweep.
    return (await runQuery({ from: [{ collectionId: 'inventory_material_info' }], where: fieldIn('replenishmentStrategy', AUTOMATED_METHODS) }, root(orgId))).filter(automated);
}

/** Warehouses where a material is planned, or has an open request or signal (so it can be closed). */
async function warehousesOf(orgId: string, materialId: string): Promise<string[]> {
    const q = (collectionId: string) => runQuery({ from: [{ collectionId }], where: fieldEq('materialId', materialId) }, root(orgId));
    const [infos, keys, legacy, signals] = await Promise.all([q('inventory_material_info'), q('replenishment_keys'), q('mrp_keys'), q('replenishment_signals')]);
    const out = new Set<string>();
    for (const d of infos) out.add(str(d.data.warehouseId)); // every configured warehouse: a strategy change must close what is open
    for (const d of [...keys, ...legacy]) if (str(d.data.prId)) out.add(str(d.data.warehouseId));
    for (const d of signals) if (['open', 'acknowledged'].includes(str(d.data.status))) out.add(str(d.data.warehouseId));
    return [...out].filter((w) => ID.test(w));
}

/** Plans everything a request changed. Registered with the change tracker. */
export async function planChanges(input: { orgId: string; uid: string; actorName: string; route: string; changes: MaterialChange[]; unresolved: string[] }) {
    const { orgId } = input;
    const pairs = new Map<string, { m: string; w: string; source: string }>();
    const changes = [...input.changes];
    for (const path of input.unresolved) {
        if (!path.startsWith(`${root(orgId)}/`)) continue;
        const d = await getDoc(path).catch(() => null);
        if (d && str(d.data.materialId)) changes.push({ orgId, materialId: str(d.data.materialId), warehouseId: str(d.data.warehouseId), source: path.split('/')[2] });
    }
    for (const c of changes.slice(0, 50)) {
        const warehouses = c.warehouseId ? [c.warehouseId] : await warehousesOf(orgId, c.materialId);
        for (const w of warehouses) pairs.set(keyOf(c.materialId, w), { m: c.materialId, w, source: c.source });
    }
    if (!pairs.size) return;
    const org = await getDoc(root(orgId));
    if (!org) return;
    const supply = pairs.size > 1 ? await supplyIndex(orgId) : undefined;
    for (const { m, w, source } of [...pairs.values()].slice(0, 30)) {
        await planMaterial(orgId, m, w, { kind: 'change', route: input.route, uid: input.uid, actor: input.actorName, source }, { org, supply });
    }
}
onMaterialChanges(planChanges);

/** Safety net: plans every automated material of an organization (used by the automation sweep). */
export async function sweepOrganization(orgId: string, deadline: number): Promise<{ planned: number; created: number; replanned: number; signalled: number; cancelled: number; failed: number; complete: boolean }> {
    const out = { planned: 0, created: 0, replanned: 0, signalled: 0, cancelled: 0, failed: 0, complete: true };
    const org = await getDoc(root(orgId));
    if (!org || !modulesOn(org).inv) return out;
    const [infos, keys, legacy, signals] = await Promise.all([plannedInfos(orgId, ''), listDocs(`${root(orgId)}/replenishment_keys`), listDocs(`${root(orgId)}/mrp_keys`), runQuery({ from: [{ collectionId: 'replenishment_signals' }], where: fieldIn('status', ['open', 'acknowledged']) }, root(orgId))]);
    const pairs = new Map<string, { m: string; w: string }>();
    for (const d of infos) if (str(d.data.materialId) && str(d.data.warehouseId)) pairs.set(keyOf(str(d.data.materialId), str(d.data.warehouseId)), { m: str(d.data.materialId), w: str(d.data.warehouseId) });
    for (const k of [...keys, ...legacy, ...signals]) if (str(k.data.prId) || str(k.data.status)) pairs.set(k.id, { m: str(k.data.materialId), w: str(k.data.warehouseId) });
    if (!pairs.size) return out;
    const supply = await supplyIndex(orgId);
    for (const { m, w } of pairs.values()) {
        if (Date.now() > deadline) {
            out.complete = false;
            break;
        }
        const r = await planMaterial(orgId, m, w, { kind: 'sweep', route: 'automation.inv.replenishment-sweep', uid: '', actor: 'MEMS automation' }, { org, supply });
        out.planned++;
        if (r.outcome === 'created') out.created++;
        if (r.outcome === 'replanned' || r.outcome === 'signal_updated') out.replanned++;
        if (r.outcome === 'signalled') out.signalled++;
        if (r.outcome === 'cancelled') out.cancelled++;
        if (r.outcome === 'failed') out.failed++;
    }
    return out;
}

// ----- Routes -----

const can = (ctx: OrgContext, perm: string) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, perm);
const scopeOf = async (ctx: OrgContext): Promise<'all' | Set<string>> => (ctx.role === 'org_super_admin' ? 'all' : allowedNodeIds(ctx.orgId, ctx.me, true));

function requestOut(d: Doc) {
    const line = objs(d.data.lines)[0] ?? {};
    const c = isObj(d.data.replenishment) ? (d.data.replenishment as Obj) : isObj(d.data.mrp) ? (d.data.mrp as Obj) : {};
    const method = str(c.method) || legacyMethodOf(c.policy);
    return {
        id: d.id, status: str(d.data.status), title: str(d.data.title),
        materialId: str(line.materialId), materialNumber: str(line.materialNumber), materialName: str(line.itemName),
        warehouseId: str(line.warehouseId), warehouseCode: str(line.warehouseCode), warehouseName: str(line.warehouseName),
        quantity: Number(line.quantity) || 0, unit: str(line.unit), uomCode: str(line.uomCode), dateRequired: str(line.dateRequired), urgency: str(line.urgency),
        budget: line.budget ?? null, glCode: str(line.glCode),
        method, methodName: METHODS[method]?.name ?? '',
        physical: Number(c.physical) || 0, available: Number(c.available) || 0, openSupply: Number(c.openSupply) || 0, consumed: Number(c.consumed) || 0, consumedDays: Number(c.consumedDays) || 0,
        supplyRefs: Array.isArray(c.supplyRefs) ? (c.supplyRefs as unknown[]).map(str) : [],
        projected: Number(c.projected) || 0, trigger: c.trigger ?? null, target: c.target ?? null, basis: str(c.basis), leadTimeDays: Number(c.leadTimeDays) || 0, plannedAt: str(c.plannedAt),
        createdAt: str(d.data.createdAt), updatedAt: str(d.data.updatedAt), verifiedBy: str(d.data.verifiedByName), verifiedAt: str(d.data.verifiedAt), dismissReason: str(d.data.cancelReason),
        history: objs(d.data.history).slice(-20).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
    };
}
function signalOut(d: Doc) {
    const c = isObj(d.data.calc) ? (d.data.calc as Obj) : {};
    return {
        id: d.id, status: str(d.data.status), signal: str(d.data.signal), signalLabel: str(d.data.signalLabel), action: str(d.data.action),
        materialId: str(d.data.materialId), materialNumber: str(d.data.materialNumber), materialName: str(d.data.materialName),
        warehouseId: str(d.data.warehouseId), warehouseCode: str(d.data.warehouseCode), warehouseName: str(d.data.warehouseName),
        quantity: Number(d.data.quantity) || 0, unit: str(d.data.unit), urgency: str(d.data.urgency), dateRequired: str(d.data.dateRequired),
        method: str(d.data.method), methodName: str(d.data.methodName), ownership: str(d.data.ownership), arrangement: str(d.data.arrangement),
        available: Number(c.available) || 0, openSupply: Number(c.openSupply) || 0, projected: Number(c.projected) || 0, basis: str(c.basis),
        acknowledgedBy: str(d.data.acknowledgedByName), acknowledgedAt: str(d.data.acknowledgedAt), reference: str(d.data.reference),
        createdAt: str(d.data.createdAt), updatedAt: str(d.data.updatedAt), closeReason: str(d.data.closeReason),
        history: objs(d.data.history).slice(-20).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
    };
}

export const replenishmentRoutes = {
    // Requests and signals, the run log and the strategies, limited to the warehouses in the person's scope.
    'POST /api/org/inventory/replenishment/list': [
        orgRoute('org.inventory.replenishment.list', 'INV.replenishment.view', async (ctx) => {
            const [reqs, signals, runs, scope, warehouses, nodes] = await Promise.all([
                runQuery({ from: [{ collectionId: 'procurement_requirements' }], where: fieldIn('source', SOURCES) }, root(ctx.orgId)),
                listDocs(`${root(ctx.orgId)}/replenishment_signals`),
                runQuery({ from: [{ collectionId: 'replenishment_runs' }], orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }], limit: 300 }, root(ctx.orgId)),
                scopeOf(ctx),
                listDocs(`${root(ctx.orgId)}/warehouses`),
                listDocs(`${root(ctx.orgId)}/structure`),
            ]);
            const inScope = (w: string) => scope === 'all' || scope.has(w);
            const names = new Map(nodes.map((n) => [n.id, `${str(n.data.code)} ${str(n.data.name)}`.trim()]));
            const first = (s: string) => (['unverified', 'open'].includes(s) ? 0 : s === 'acknowledged' ? 1 : 2);
            return {
                items: reqs.map(requestOut).filter((r) => inScope(r.warehouseId)).sort((a, b) => first(a.status) - first(b.status) || b.updatedAt.localeCompare(a.updatedAt)),
                signals: signals.map(signalOut).filter((s) => inScope(s.warehouseId)).sort((a, b) => first(a.status) - first(b.status) || b.updatedAt.localeCompare(a.updatedAt)),
                runs: runs.filter((r) => inScope(str(r.data.warehouseId))).map((r) => ({ id: r.id, at: str(r.data.at), outcome: str(r.data.outcome), reason: str(r.data.reason), method: str(r.data.method), channel: str(r.data.channel), materialId: str(r.data.materialId), materialNumber: str(r.data.materialNumber), warehouseId: str(r.data.warehouseId), warehouse: names.get(str(r.data.warehouseId)) ?? str(r.data.warehouseId), trigger: str(r.data.trigger), route: str(r.data.route), source: str(r.data.source), prId: str(r.data.prId), available: r.data.available ?? null, openSupply: r.data.openSupply ?? null })),
                warehouses: warehouses.filter((w) => inScope(w.id)).map((w) => ({ id: w.id, name: names.get(w.id) || str(w.data.name) || w.id })),
                methods: Object.values(METHODS).map((m) => ({ code: m.code, name: m.name, automated: m.automated, explain: m.explain })),
                can: { run: can(ctx, 'INV.replenishment.run'), verify: can(ctx, 'INV.replenishment.verify') },
            };
        }),
    ],

    // Plan now: one material in one warehouse, or every planned material of a warehouse.
    'POST /api/org/inventory/replenishment/run': [
        orgRoute('org.inventory.replenishment.run', 'INV.replenishment.run', async (ctx) => {
            const warehouseId = str(ctx.body.warehouseId);
            const materialId = str(ctx.body.materialId);
            if (!ID.test(warehouseId)) throw new HttpError(400, 'Choose a warehouse.');
            if (materialId && !ID.test(materialId)) throw new HttpError(400, 'Choose a material.');
            const scope = await scopeOf(ctx);
            if (scope !== 'all' && !scope.has(warehouseId)) throw new HttpError(403, 'That warehouse is outside your access.');
            const trigger: Trigger = { kind: 'manual', route: 'org.inventory.replenishment.run', uid: ctx.uid, actor: str(ctx.me.data.email) };
            const materials = materialId ? [materialId] : (await plannedInfos(ctx.orgId, 'warehouseId', warehouseId)).map((d) => str(d.data.materialId)).filter((m) => ID.test(m));
            if (materials.length > 400) throw new HttpError(400, `This warehouse has ${materials.length} planned materials; the scheduled sweep plans them all. Run one material at a time here.`);
            const supply = await supplyIndex(ctx.orgId);
            const tally: Record<string, number> = {};
            const deadline = Date.now() + 50_000;
            let done = 0;
            for (const m of materials) {
                if (Date.now() > deadline) break;
                const r = await planMaterial(ctx.orgId, m, warehouseId, trigger, { org: ctx.org, supply });
                tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
                done++;
            }
            await record(ctx, 'org.inventory.replenishment.run', warehouseId, `Replenishment run on ${materialId ? `material ${materialId}` : `${done} of ${materials.length} planned materials`}: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing to plan'}`);
            return { planned: done, total: materials.length, outcomes: tally };
        }),
    ],

    // A planner records that the call-off, notification or transfer request has been made (with its reference).
    'POST /api/org/inventory/replenishment/signal/acknowledge': [
        orgRoute('org.inventory.replenishment.signal.acknowledge', 'INV.replenishment.verify', async (ctx) => {
            const key = str(ctx.body.id);
            if (!/^[A-Za-z0-9_-]{1,120}__[A-Za-z0-9_-]{1,120}$/.test(key)) throw new HttpError(404, 'Signal not found.');
            const reference = str(ctx.body.reference).trim();
            const note = str(ctx.body.note).trim();
            if (reference.length < 2 || reference.length > 80) throw new HttpError(400, 'Enter the reference of the call-off, notification or transfer (2 to 80 characters).');
            if (note.length < 10 || note.length > 300) throw new HttpError(400, 'Describe what was done (10 to 300 characters).');
            const path = P(ctx.orgId).signal(key);
            const d = await getDoc(path);
            if (!d || str(d.data.status) !== 'open') throw new HttpError(409, 'This signal is not open.');
            const w = str(d.data.warehouseId);
            const scope = await scopeOf(ctx);
            if (scope !== 'all' && !scope.has(w)) throw new HttpError(403, 'That warehouse is outside your access.');
            const at = nowIso();
            const who = [str(ctx.me.data.firstName), str(ctx.me.data.lastName)].filter(Boolean).join(' ') || str(ctx.me.data.email);
            const ok = await writeDoc(path, { ...d.data, status: 'acknowledged', reference, acknowledgedBy: ctx.uid, acknowledgedByName: who, acknowledgedAt: at, updatedAt: at, history: [...objs(d.data.history), { at, byName: who, action: 'acknowledged', note: `${reference}: ${note}` }].slice(-30) }, { updateTime: d.updateTime });
            if (!ok) throw new HttpError(409, 'The signal was re-planned at the same moment. Refresh and try again.');
            await record(ctx, 'org.inventory.replenishment.signal.acknowledge', key, `${str(d.data.signalLabel)} for ${str(d.data.materialNumber)} at ${str(d.data.warehouseCode)}: ${Number(d.data.quantity)} ${str(d.data.unit)}. Ref ${reference}. ${note}`.slice(0, 400));
            return { ok: true, status: 'acknowledged' };
        }),
    ],
};
