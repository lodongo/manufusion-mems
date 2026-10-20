/**
 * MRP replenishment for warehouse materials (Inventory › MRP Replenishment Requests, INV-RPL).
 *
 * When anything about a material changes — its master record, its warehouse inventory or procurement settings, an
 * extension to a warehouse, or a stock movement — MRP plans that material in every warehouse where its stocking policy
 * is Min/max (MINMAX) or Reorder point (REORDER). When stock is needed it raises a purchase requirement with status
 * UNVERIFIED (requester "MRP"). A material planner (INV.mrp.verify) checks the quantity, date and GL account and
 * verifies it: it then follows the normal manager approval and chart of authority as a requirement of the planner.
 * A planner can also dismiss it with a reason.
 *
 *   organizations/{org}/procurement_requirements/{REQ…}   status 'unverified', source 'mrp', mrpKey '{material}__{warehouse}'
 *   organizations/{org}/mrp_keys/{material}__{warehouse}  the one open unverified request, or a dismissal
 *   organizations/{org}/mrp_locks/{material}__{warehouse} one planning run at a time per material and warehouse
 *   organizations/{org}/mrp_runs/{id}                     every planning run and its outcome (run log)
 *
 * Only one unverified request exists per material and warehouse: later runs re-plan it (quantity, date, urgency) or
 * cancel it when stock is no longer needed. Every create, re-plan, cancel, verify and dismissal is audited.
 */
import { HttpError, deleteDoc, fieldEq, fieldIn, getDoc, isObj, listDocs, nowIso, randomId, runQuery, str, writeDoc, type Doc } from './core';
import { audit } from './audit';
import { onMaterialChanges, type MaterialChange } from './changeTracker';
import { materialIn, physicalOf } from './finCore';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { requirementsPath } from './procurementSetup';
import { record } from './org';
import { MRP_POLICIES, PO_OPEN, PRQ_OPEN, REQ_OPEN, numberOrNull, openQuantity, plan, type PlanResult } from './mrpPlan';
import {isStandardMrpSafe} from './stockPolicyConfig';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
const keyOf = (materialId: string, warehouseId: string) => `${materialId}__${warehouseId}`;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DISMISS_DAYS = 7;
const DEFAULT_LEAD_DAYS = 14;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter(isObj) as Obj[]) : []);

export type Trigger = { kind: 'change' | 'sweep' | 'manual'; route: string; uid: string; actor: string; source?: string };
export type Outcome = 'created' | 'replanned' | 'unchanged' | 'cancelled' | 'no_need' | 'not_planned' | 'incomplete' | 'dismissed' | 'busy' | 'skipped' | 'failed';

// ----- Open supply -----

export type Supply = Map<string, { qty: number; refs: string[] }>;
/** Open quantities on purchase requirements, requisitions and purchase orders, by material and warehouse. */
export async function supplyIndex(orgId: string): Promise<Supply> {
    const q = (collectionId: string, statuses: string[]) => runQuery({ from: [{ collectionId }], where: fieldIn('status', statuses) }, root(orgId));
    const [reqs, prqs, pos] = await Promise.all([q('procurement_requirements', REQ_OPEN), q('procurement_requisitions', PRQ_OPEN), q('procurement_orders', PO_OPEN)]);
    const out: Supply = new Map();
    const take = (kind: 'req' | 'prq' | 'po', docs: Doc[]) => {
        for (const d of docs) {
            for (const l of objs(d.data.lines)) {
                const m = str(l.materialId);
                const w = str(l.warehouseId);
                if (!m || !w) continue;
                const qty = openQuantity(kind, l);
                if (qty <= 0) continue;
                const k = keyOf(m, w);
                const e = out.get(k) ?? { qty: 0, refs: [] };
                e.qty += qty;
                if (e.refs.length < 10) e.refs.push(`${str(d.data.number) || d.id} (${qty})`);
                out.set(k, e);
            }
        }
    };
    take('req', reqs);
    take('prq', prqs);
    take('po', pos);
    return out;
}

// ----- Locks and run log -----

async function lock(orgId: string, key: string): Promise<boolean> {
    const path = `${root(orgId)}/mrp_locks/${key}`;
    if (await writeDoc(path, { at: nowIso() }, { exists: false })) return true;
    const cur = await getDoc(path);
    // A lock older than two minutes belongs to a run that did not finish: take it over.
    if (cur && Date.now() - Date.parse(str(cur.data.at)) > 120_000) return writeDoc(path, { at: nowIso() }, { updateTime: cur.updateTime });
    return false;
}
const unlock = (orgId: string, key: string) => deleteDoc(`${root(orgId)}/mrp_locks/${key}`).catch(() => undefined);

async function logRun(orgId: string, entry: Obj) {
    try {
        await writeDoc(`${root(orgId)}/mrp_runs/${Date.now().toString(36)}${randomId(4)}`, { ...entry, at: nowIso() }, { exists: false });
    } catch {
        /* the run log never fails planning */
    }
}

function auditPr(orgId: string, trigger: Trigger, action: string, prId: string, details: string) {
    return audit([{ category: 'data', action: `org.inventory.mrp.${action}`, orgId, actor: trigger.uid ? { uid: trigger.uid, email: trigger.actor, orgId } : null, target: { type: 'purchase_requirement', id: prId, label: prId }, details: details.slice(0, 600), source: 'server' }]);
}

// ----- Planning one material in one warehouse -----

interface Context {
    org: Doc;
    supply?: Supply;
}

const modulesOn = (org: Doc) => {
    const map = isObj(org.data.modules) ? (org.data.modules as Obj) : {};
    return map.PRC === true && map.INV === true;
};

/** Builds the requirement line for an MRP request (completed and checked by the planner on verification). */
function lineFor(material: Doc, wh: Doc | null, warehouseId: string, plan: Extract<PlanResult, { kind: 'order' }>, lead: number, unitPrice: number | null, policy: string, available: number, supply: number): Obj {
    const m = material.data;
    const name = (str(m.name) || str(m.shortText) || 'Material').slice(0, 160);
    const uomRaw = str(m.uom);
    const uom = PROCUREMENT_UNITS.find((u) => u.active && u.selectable && (u.code === uomRaw || u.symbol === uomRaw));
    return {
        no: 10,
        type: 'material',
        source: 'warehouse',
        categoryCode: str(m.categoryCode),
        subcategoryCode: str(m.subcategoryCode),
        familyCode: '',
        itemCode: '',
        itemName: name,
        master: { code: str(m.materialNumber), name },
        warehouseId,
        warehouseCode: str(wh?.data.code),
        warehouseName: str(wh?.data.name),
        materialId: material.id,
        materialNumber: str(m.materialNumber),
        requirement: `${name} (${str(m.materialNumber)})`.slice(0, 300),
        technical: `Automatic replenishment (${policy === 'MINMAX' ? 'Min/max' : 'Reorder point'}). Available ${available}, open supply ${supply}. ${plan.basis}.`.slice(0, 2000),
        attributes: {},
        attributeView: [],
        requiredAttrs: [],
        quantity: plan.quantity,
        unit: uom?.symbol ?? uomRaw,
        uomCode: uom?.code ?? '',
        uomLabel: uom?.label ?? '',
        uomCategoryCode: uom?.categoryCode ?? '',
        uomCategoryName: uom?.category ?? '',
        dateRequired: addDays(Math.max(1, lead)),
        urgency: plan.urgency,
        budget: unitPrice !== null && unitPrice > 0 ? Math.round(plan.quantity * unitPrice * 100) / 100 : null,
        costCenterId: warehouseId,
        costCenterCode: str(wh?.data.code),
        costCenterName: str(wh?.data.name),
        glCode: '',
        glName: '',
    };
}

async function cancelOpen(orgId: string, prId: string, reason: string, trigger: Trigger): Promise<boolean> {
    const path = `${requirementsPath(orgId)}/${prId}`;
    const d = await getDoc(path);
    if (!d || str(d.data.status) !== 'unverified') return false;
    const at = nowIso();
    const ok = await writeDoc(path, { ...d.data, status: 'cancelled', cancelReason: reason, updatedAt: at, version: (Number(d.data.version) || 1) + 1, history: [...objs(d.data.history), { at, by: 'mrp', byName: 'MRP', action: 'cancelled', note: reason, from: 'unverified', to: 'cancelled' }] }, { updateTime: d.updateTime });
    if (ok) await auditPr(orgId, trigger, 'cancel', prId, reason);
    return ok;
}

export async function planMaterial(orgId: string, materialId: string, warehouseId: string, trigger: Trigger, ctx?: Context): Promise<{ outcome: Outcome; prId?: string; reason: string; result?: PlanResult }> {
    if (!ID.test(materialId) || !ID.test(warehouseId)) return { outcome: 'skipped', reason: 'Invalid material or warehouse.' };
    const org = ctx?.org ?? (await getDoc(root(orgId)));
    if (!org) return { outcome: 'skipped', reason: 'Organization not found.' };
    const key = keyOf(materialId, warehouseId);
    if (!(await lock(orgId, key))) return { outcome: 'busy', reason: 'Another MRP run for this material and warehouse is in progress.' };
    const base = { materialId, warehouseId, trigger: trigger.kind, route: trigger.route, source: trigger.source ?? '', by: trigger.uid };
    try {
        const [inv, proc, keyDoc, material, wh] = await Promise.all([
            getDoc(`${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`),
            getDoc(`${root(orgId)}/procurement_material_info/${materialId}_${warehouseId}`),
            getDoc(`${root(orgId)}/mrp_keys/${key}`),
            materialIn(orgId, materialId, warehouseId),
            getDoc(`${root(orgId)}/structure/${warehouseId}`),
        ]);
        const openId = str(keyDoc?.data.prId);
        const finish = async (outcome: Outcome, reason: string, extra: Obj = {}, prId = '') => {
            await logRun(orgId, { ...base, outcome, reason, prId, materialNumber: str(material?.data.materialNumber), ...extra });
            return { outcome, reason, prId: prId || undefined };
        };
        const closeOpen = async (reason: string) => {
            if (!openId) return false;
            const done = await cancelOpen(orgId, openId, reason, trigger);
            await deleteDoc(`${root(orgId)}/mrp_keys/${key}`);
            return done;
        };

        const policy = str(inv?.data.stockingPolicy).toUpperCase();
        if (!MRP_POLICIES.includes(policy as (typeof MRP_POLICIES)[number])) {
            if (await closeOpen('MRP: the stocking policy is no longer Min/max or Reorder point.')) return finish('cancelled', 'Stocking policy changed; the open MRP request was cancelled.', {}, openId);
            return { outcome: 'not_planned', reason: 'Not planned by MRP (stocking policy).' };
        }
        const arrangement=isStandardMrpSafe(inv?.data||{});
        if(!arrangement.safe){
            if(await closeOpen('MRP: '+arrangement.reason))return finish('cancelled',arrangement.reason,{},openId);
            return finish('skipped',arrangement.reason);
        }
        if (!modulesOn(org)) return finish('skipped', 'Inventory and Procurement must both be adopted for MRP requests.');
        if (!material || !['approved', 'active'].includes(str(material.data.status).toLowerCase())) {
            if (await closeOpen('MRP: the material is no longer published in this warehouse.')) return finish('cancelled', 'Material unpublished or unlinked; open MRP request cancelled.', {}, openId);
            return finish('skipped', 'The material is not published in this warehouse.');
        }

        const [stock, supply] = await Promise.all([physicalOf(orgId, warehouseId, materialId), ctx?.supply ? Promise.resolve(ctx.supply) : supplyIndex(orgId)]);
        const open = supply.get(key) ?? { qty: 0, refs: [] };
        const i = inv!.data;
        const p = proc?.data ?? {};
        const result = plan({
            policy,
            available: stock.available,
            openSupply: open.qty,
            minimumLevel: numberOrNull(i.minimumLevel),
            maximumLevel: numberOrNull(i.maximumLevel),
            reorderPoint: numberOrNull(i.reorderPoint),
            reorderQuantity: numberOrNull(i.reorderQuantity),
            safetyStock: numberOrNull(i.safetyStock),
            minimumOrderQuantity: numberOrNull(p.minimumOrderQuantity),
            orderMultiple: numberOrNull(p.orderMultiple),
        });
        const numbers = { policy, physical: stock.physical, available: stock.available, openSupply: open.qty, supplyRefs: open.refs };

        if (result.kind === 'incomplete') {
            if (await closeOpen(`MRP: ${result.reason}`)) return finish('cancelled', `${result.reason} The open MRP request was cancelled.`, numbers, openId);
            return finish('incomplete', result.reason, numbers);
        }
        if (result.kind !== 'order') {
            if (await closeOpen(`MRP: no longer required. ${result.reason}`)) return finish('cancelled', `No longer required: ${result.reason}`, numbers, openId);
            return finish('no_need', result.reason, numbers);
        }

        const lead = Math.trunc(numberOrNull(p.leadTimeDays) ?? numberOrNull(i.leadTimeDays) ?? DEFAULT_LEAD_DAYS);
        const line = lineFor(material, wh, warehouseId, result, lead, numberOrNull(p.unitPrice), policy, stock.available, open.qty);
        const calc = { ...numbers, projected: result.projected, trigger: result.trigger, target: result.target, basis: result.basis, leadTimeDays: lead, minimumOrderQuantity: numberOrNull(p.minimumOrderQuantity), orderMultiple: numberOrNull(p.orderMultiple), safetyStock: numberOrNull(i.safetyStock), plannedAt: nowIso(), trigger_kind: trigger.kind, trigger_route: trigger.route };

        // Re-plan the open request.
        if (openId) {
            const path = `${requirementsPath(orgId)}/${openId}`;
            const pr = await getDoc(path);
            if (pr && str(pr.data.status) === 'unverified') {
                const cur = objs(pr.data.lines)[0] ?? {};
                const same = Number(cur.quantity) === Number(line.quantity) && str(cur.urgency) === str(line.urgency) && str(cur.dateRequired) === str(line.dateRequired);
                if (same) return finish('unchanged', `Still needed: ${result.basis}.`, numbers, openId);
                const at = nowIso();
                const ok = await writeDoc(path, { ...pr.data, lines: [{ ...cur, ...line }], mrp: calc, updatedAt: at, version: (Number(pr.data.version) || 1) + 1, history: [...objs(pr.data.history), { at, by: 'mrp', byName: 'MRP', action: 'replanned', note: `Quantity ${Number(cur.quantity)} → ${result.quantity}, urgency ${str(line.urgency)}, needed by ${str(line.dateRequired)}`, from: 'unverified', to: 'unverified' }] }, { updateTime: pr.updateTime });
                if (!ok) return finish('busy', 'The request changed while MRP was re-planning it; the next change will re-plan it.', numbers, openId);
                await auditPr(orgId, trigger, 'replan', openId, `${str(material.data.materialNumber)} at ${str(wh?.data.code) || warehouseId}: quantity ${Number(cur.quantity)} → ${result.quantity}. ${result.basis}`);
                return finish('replanned', result.basis, numbers, openId);
            }
            // Verified or closed meanwhile: the key is stale.
            await deleteDoc(`${root(orgId)}/mrp_keys/${key}`);
        }

        // A planner dismissed the last request: the safety-net sweep respects it for a week; real changes re-plan.
        const dismissedUntil = str(keyDoc?.data.dismissedUntil);
        if (trigger.kind === 'sweep' && dismissedUntil && dismissedUntil > nowIso()) return finish('dismissed', `Dismissed by a planner until ${dismissedUntil.slice(0, 10)}; a change to the material plans it again.`, numbers);

        const id = `REQ${String(await nextOrgCounter(orgId, 'requirementSeq')).padStart(9, '0')}`;
        const at = nowIso();
        const name = str(material.data.name) || str(material.data.shortText) || materialId;
        const created = await writeDoc(`${requirementsPath(orgId)}/${id}`, {
            number: id,
            title: `MRP · ${str(material.data.materialNumber)} ${name}`.slice(0, 120),
            status: 'unverified',
            source: 'mrp',
            mrpKey: key,
            mrp: calc,
            requesterUid: 'mrp',
            requesterName: 'MRP (automatic)',
            requesterEmail: '',
            lines: [line],
            attachments: [],
            attachmentSeq: 0,
            createdAt: at,
            updatedAt: at,
            version: 1,
            history: [{ at, by: 'mrp', byName: 'MRP', action: 'created', note: `${result.basis}. Waiting for a material planner to verify.`, from: '', to: 'unverified' }],
        }, { exists: false });
        if (!created) return finish('failed', 'The requirement number was already used.', numbers);
        const keyed = await writeDoc(`${root(orgId)}/mrp_keys/${key}`, { prId: id, materialId, warehouseId, createdAt: at }, keyDoc ? { updateTime: keyDoc.updateTime } : { exists: false });
        if (!keyed) {
            // Another run raised one first: keep that one.
            await cancelOpen(orgId, id, 'MRP: duplicate of a request raised at the same moment.', trigger);
            return finish('busy', 'Another run raised the request at the same moment.', numbers);
        }
        await auditPr(orgId, trigger, 'create', id, `${str(material.data.materialNumber)} at ${str(wh?.data.code) || warehouseId}: ${result.quantity} ${str(line.unit)} (${policy}). ${result.basis}`);
        return finish('created', result.basis, numbers, id);
    } catch (e) {
        const reason = e instanceof Error ? e.message.slice(0, 300) : 'Planning failed.';
        await logRun(orgId, { ...base, outcome: 'failed', reason });
        return { outcome: 'failed', reason };
    } finally {
        await unlock(orgId, key);
    }
}

/** Warehouses where a material is planned (its policy) or has an open MRP request. */
async function warehousesOf(orgId: string, materialId: string): Promise<string[]> {
    const [infos, keys] = await Promise.all([
        runQuery({ from: [{ collectionId: 'inventory_material_info' }], where: fieldEq('materialId', materialId) }, root(orgId)),
        runQuery({ from: [{ collectionId: 'mrp_keys' }], where: fieldEq('materialId', materialId) }, root(orgId)),
    ]);
    const out = new Set<string>();
    for (const d of infos) if (MRP_POLICIES.includes(str(d.data.stockingPolicy).toUpperCase() as (typeof MRP_POLICIES)[number])) out.add(str(d.data.warehouseId));
    for (const d of keys) if (str(d.data.prId)) out.add(str(d.data.warehouseId));
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

/** Safety net: plans every Min/max and Reorder point material of an organization (used by the automation sweep). */
export async function sweepOrganization(orgId: string, deadline: number): Promise<{ planned: number; created: number; replanned: number; cancelled: number; failed: number; complete: boolean }> {
    const out = { planned: 0, created: 0, replanned: 0, cancelled: 0, failed: 0, complete: true };
    const org = await getDoc(root(orgId));
    if (!org || !modulesOn(org)) return out;
    const [infos, keys] = await Promise.all([runQuery({ from: [{ collectionId: 'inventory_material_info' }], where: fieldIn('stockingPolicy', MRP_POLICIES) }, root(orgId)), listDocs(`${root(orgId)}/mrp_keys`)]);
    const pairs = new Map<string, { m: string; w: string }>();
    for (const d of infos) if (str(d.data.materialId) && str(d.data.warehouseId)) pairs.set(keyOf(str(d.data.materialId), str(d.data.warehouseId)), { m: str(d.data.materialId), w: str(d.data.warehouseId) });
    for (const k of keys) if (str(k.data.prId)) pairs.set(k.id, { m: str(k.data.materialId), w: str(k.data.warehouseId) });
    if (!pairs.size) return out;
    const supply = await supplyIndex(orgId);
    for (const { m, w } of pairs.values()) {
        if (Date.now() > deadline) {
            out.complete = false;
            break;
        }
        const r = await planMaterial(orgId, m, w, { kind: 'sweep', route: 'automation.inv.mrp-sweep', uid: '', actor: 'MEMS automation' }, { org, supply });
        out.planned++;
        if (r.outcome === 'created') out.created++;
        if (r.outcome === 'replanned') out.replanned++;
        if (r.outcome === 'cancelled') out.cancelled++;
        if (r.outcome === 'failed') out.failed++;
    }
    return out;
}

// ----- Routes -----

const can = (ctx: OrgContext, perm: string) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, perm);

async function scopeOf(ctx: OrgContext): Promise<'all' | Set<string>> {
    return ctx.role === 'org_super_admin' ? 'all' : allowedNodeIds(ctx.orgId, ctx.me, true);
}

function requestOut(d: Doc) {
    const line = objs(d.data.lines)[0] ?? {};
    const mrp = isObj(d.data.mrp) ? (d.data.mrp as Obj) : {};
    return {
        id: d.id,
        status: str(d.data.status),
        title: str(d.data.title),
        materialId: str(line.materialId),
        materialNumber: str(line.materialNumber),
        materialName: str(line.itemName),
        warehouseId: str(line.warehouseId),
        warehouseCode: str(line.warehouseCode),
        warehouseName: str(line.warehouseName),
        quantity: Number(line.quantity) || 0,
        unit: str(line.unit),
        uomCode: str(line.uomCode),
        dateRequired: str(line.dateRequired),
        urgency: str(line.urgency),
        budget: line.budget ?? null,
        glCode: str(line.glCode),
        policy: str(mrp.policy),
        physical: Number(mrp.physical) || 0,
        available: Number(mrp.available) || 0,
        openSupply: Number(mrp.openSupply) || 0,
        supplyRefs: Array.isArray(mrp.supplyRefs) ? (mrp.supplyRefs as unknown[]).map(str) : [],
        projected: Number(mrp.projected) || 0,
        trigger: mrp.trigger ?? null,
        target: mrp.target ?? null,
        basis: str(mrp.basis),
        leadTimeDays: Number(mrp.leadTimeDays) || 0,
        plannedAt: str(mrp.plannedAt),
        createdAt: str(d.data.createdAt),
        updatedAt: str(d.data.updatedAt),
        verifiedBy: str(d.data.verifiedByName),
        verifiedAt: str(d.data.verifiedAt),
        dismissReason: str(d.data.cancelReason),
        history: objs(d.data.history).slice(-20).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
    };
}

export const mrpRoutes = {
    // MRP requests (unverified and recently processed) and the run log, limited to the warehouses in the person's scope.
    'POST /api/org/inventory/mrp/list': [
        orgRoute('org.inventory.mrp.list', 'INV.mrp.view', async (ctx) => {
            const [reqs, runs, scope, warehouses] = await Promise.all([
                runQuery({ from: [{ collectionId: 'procurement_requirements' }], where: fieldEq('source', 'mrp') }, root(ctx.orgId)),
                runQuery({ from: [{ collectionId: 'mrp_runs' }], orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }], limit: 300 }, root(ctx.orgId)),
                scopeOf(ctx),
                listDocs(`${root(ctx.orgId)}/warehouses`),
            ]);
            const inScope = (w: string) => scope === 'all' || scope.has(w);
            const items = reqs.map(requestOut).filter((r) => inScope(r.warehouseId)).sort((a, b) => (a.status === 'unverified' ? 0 : 1) - (b.status === 'unverified' ? 0 : 1) || b.updatedAt.localeCompare(a.updatedAt));
            const names = new Map((await listDocs(`${root(ctx.orgId)}/structure`)).map((n) => [n.id, `${str(n.data.code)} ${str(n.data.name)}`.trim()]));
            return {
                items,
                runs: runs.filter((r) => inScope(str(r.data.warehouseId))).map((r) => ({ id: r.id, at: str(r.data.at), outcome: str(r.data.outcome), reason: str(r.data.reason), materialId: str(r.data.materialId), materialNumber: str(r.data.materialNumber), warehouseId: str(r.data.warehouseId), warehouse: names.get(str(r.data.warehouseId)) ?? str(r.data.warehouseId), trigger: str(r.data.trigger), route: str(r.data.route), source: str(r.data.source), prId: str(r.data.prId), available: r.data.available ?? null, openSupply: r.data.openSupply ?? null })),
                warehouses: warehouses.filter((w) => inScope(w.id)).map((w) => ({ id: w.id, name: names.get(w.id) || str(w.data.name) || w.id })),
                can: { run: can(ctx, 'INV.mrp.run'), verify: can(ctx, 'INV.mrp.verify') },
            };
        }),
    ],

    // Run MRP now for one material in one warehouse, or for every planned material of a warehouse.
    'POST /api/org/inventory/mrp/run': [
        orgRoute('org.inventory.mrp.run', 'INV.mrp.run', async (ctx) => {
            const warehouseId = str(ctx.body.warehouseId);
            const materialId = str(ctx.body.materialId);
            if (!ID.test(warehouseId)) throw new HttpError(400, 'Choose a warehouse.');
            if (materialId && !ID.test(materialId)) throw new HttpError(400, 'Choose a material.');
            const scope = await scopeOf(ctx);
            if (scope !== 'all' && !scope.has(warehouseId)) throw new HttpError(403, 'That warehouse is outside your access.');
            const trigger: Trigger = { kind: 'manual', route: 'org.inventory.mrp.run', uid: ctx.uid, actor: str(ctx.me.data.email) };
            let pairs: string[];
            if (materialId) pairs = [materialId];
            else {
                const infos = await runQuery({ from: [{ collectionId: 'inventory_material_info' }], where: fieldEq('warehouseId', warehouseId) }, root(ctx.orgId));
                pairs = infos.filter((d) => MRP_POLICIES.includes(str(d.data.stockingPolicy).toUpperCase() as (typeof MRP_POLICIES)[number])).map((d) => str(d.data.materialId)).filter((m) => ID.test(m));
            }
            if (pairs.length > 400) throw new HttpError(400, `This warehouse has ${pairs.length} planned materials; the scheduled sweep plans them all. Run one material at a time here.`);
            const supply = await supplyIndex(ctx.orgId);
            const tally: Record<string, number> = {};
            const deadline = Date.now() + 50_000;
            let done = 0;
            for (const m of pairs) {
                if (Date.now() > deadline) break;
                const r = await planMaterial(ctx.orgId, m, warehouseId, trigger, { org: ctx.org, supply });
                tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
                done++;
            }
            await record(ctx, 'org.inventory.mrp.run', warehouseId, `MRP run on ${materialId ? `material ${materialId}` : `${done} of ${pairs.length} planned materials`}: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing to plan'}`);
            return { planned: done, total: pairs.length, outcomes: tally };
        }),
    ],
};
