// ---------------------------------------------------------------------------
// Commercial requirements: final-product SKUs are firmed by hand, worked back through the BOMs to the materials, the
// purchase requirements are firmed under the Chart of Authority and pushed to Procurement as purchase requirements.
//
// Collections (organizations/{org}/…):
//   pln_requirements/{CMR000000001}            a requirement set: site, final-SKU lines, status, firming, approvals, pushes
//   pln_requirement_results/{set}_{part}_{n}   the work-back result (JSON text, chunked under the document limit)
//   pln_requirement_locks/{set}                held while a push is raising procurement requirements
// Rules:
//   - every action is checked at the set's site (job-role scope) and every change is audited (pln.requirement.*);
//   - independent people at every gate (reqTransitionCheck in plnRequirementsModel.ts): whoever prepares does not firm,
//     whoever firms does not approve the purchase, whoever approves does not push; the test-mode override relaxes the
//     independence only, is development-only and is audited;
//   - the purchase approval follows the Chart of Authority on the firmed purchase value; a push may move quantity between
//     lines (with a reason) but never above the approved value;
//   - the requester of the procurement requirement is the person who pushes, so it waits for their manager, then the
//     stores release and procurement acknowledges it like any other requirement for warehouse stock;
//   - commercial lines are MANUAL for now; the commercial forecast will feed the same lines later.
// ---------------------------------------------------------------------------
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedAt, audited, holdsAnywhere } from './scopeGuard';
import { bypass } from './testModeCore';
import { nextOrgCounter } from './positions';
import { asInput, needAt, objs, planningSetup, sites, skuMasters, supplyMasters, today } from './plnPlanning';
import { skuUnitConversion } from './mfgSkuModel';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { unitPricePerStockUnit } from './inventoryValuation';
import {
    REQ_NEXT, REQ_PERMISSION, REQ_STEPS, explodeRequirements, firmedLinesOf, readRequirementLines, reqTransitionCheck, reviewPush,
    type Explosion, type FirmedLine, type MaterialPositionU, type ReqAction, type ReqActors, type ReqStatus, type RequirementLine,
} from './plnRequirementsModel';

type Obj = Record<string, unknown>;
const root = (o: string) => `organizations/${o}`;
const setPath = (o: string, id: string) => `${root(o)}/pln_requirements/${id}`;
const resultPath = (o: string, id: string, part: string, i: number) => `${root(o)}/pln_requirement_results/${id}_${part}_${i}`;
const lockPath = (o: string, id: string) => `${root(o)}/pln_requirement_locks/${id}`;
const SET_ID = /^CMR\d{9}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
const STALE_MS = 24 * 3_600_000;
const ALL_ACTIONS: ReqAction[] = ['edit_lines', 'submit_commercial', 'firm_commercial', 'return_commercial', 'run_explosion', 'submit_purchase', 'approve_purchase', 'return_purchase', 'push', 'reopen', 'cancel'];

interface ReqSet extends Obj {
    id: string;
    siteId: string;
    siteName: string;
    title: string;
    status: ReqStatus;
    revision: number;
    lines: RequirementLine[];
    createdBy: string;
}

// ----- Results storage (JSON text, chunked) -----

const CHUNK = 800_000;
async function saveResult(orgId: string, id: string, part: string, value: unknown, previousChunks: number): Promise<number> {
    const text = JSON.stringify(value);
    const chunks = Math.max(1, Math.ceil(text.length / CHUNK));
    if (chunks > 8) throw new HttpError(413, 'The work-back result is too large: split the requirements into fewer final products.');
    for (let i = 0; i < chunks; i++) await writeDoc(resultPath(orgId, id, part, i), { setId: id, part, index: i, chunks, json: text.slice(i * CHUNK, (i + 1) * CHUNK), savedAt: nowIso() });
    for (let i = chunks; i < previousChunks; i++) await writeDoc(resultPath(orgId, id, part, i), { setId: id, part, index: i, chunks, json: '', savedAt: nowIso() });
    return chunks;
}
async function loadResult<T>(orgId: string, id: string, part: string, chunks: number): Promise<T | null> {
    if (!chunks) return null;
    const docs = await Promise.all(Array.from({ length: chunks }, (_, i) => getDoc(resultPath(orgId, id, part, i))));
    try {
        return JSON.parse(docs.map((d) => str(d?.data.json)).join('')) as T;
    } catch {
        return null;
    }
}

// ----- Sets -----

async function loadSet(ctx: OrgContext, id: string, perm = 'PLN.view', mode: 'read' | 'write' = 'read') {
    if (!SET_ID.test(id)) throw new HttpError(400, 'Invalid requirement set');
    const doc = await getDoc(setPath(ctx.orgId, id));
    if (!doc) throw new HttpError(404, 'Requirement set not found');
    const set = { ...doc.data, id } as unknown as ReqSet;
    await needAt(ctx, perm, set.siteId, mode, 'work on this requirement set');
    return { doc, set };
}
const nameOf = (ctx: OrgContext) => str(ctx.me.data.displayName) || str(ctx.me.data.name) || ctx.uid;
function actorsOf(s: Obj): ReqActors {
    return {
        createdBy: str(s.createdBy),
        commercialSubmittedBy: str(s.commercialSubmittedBy),
        firmedBy: str(s.firmedBy),
        purchaseSubmittedBy: str(s.purchaseSubmittedBy),
        approvers: objs(isObj(s.coa) ? s.coa.steps : []).filter((x) => x.status === 'approved').map((x) => str(x.by)),
    };
}
const staleOf = (s: Obj, stamp: string) => !s.explosionAt || Date.now() - Date.parse(str(s.explosionAt)) > STALE_MS || str(s.explosionAt) < str(s.firmedAt) || (!!stamp && str(s.explosionStamp) !== stamp);
type Extra = Parameters<typeof reqTransitionCheck>[4];
/** Independence and state checks; the development test-mode override relaxes independence only (audited). */
function check(ctx: OrgContext, set: ReqSet, action: ReqAction, extra: Extra = {}) {
    const why = reqTransitionCheck(set.status, action, ctx.uid, actorsOf(set), extra);
    if (!why) return;
    const independence = /independent|earlier level|another person/.test(why);
    if (independence && bypass(ctx, `pln.requirement.${action}.independence`)) return;
    throw new HttpError(independence ? 403 : 409, why);
}
async function save(ctx: OrgContext, doc: Doc, set: ReqSet, patch: Obj, action: string, note: string, expectedRevision: unknown) {
    if (expectedRevision !== undefined && Number(expectedRevision) !== Number(set.revision)) throw new HttpError(409, 'The requirement set changed since you opened it. Reload and try again.');
    const now = nowIso();
    const history = [{ at: now, by: ctx.uid, byName: nameOf(ctx), action, note: note.slice(0, 400), status: str(patch.status) || set.status }, ...objs(set.history)].slice(0, 100);
    const next = { ...set, ...patch, revision: Number(set.revision) + 1, history, updatedAt: now, updatedBy: ctx.uid } as Obj;
    delete next.id;
    if (!(await writeDoc(setPath(ctx.orgId, set.id), next, { updateTime: doc.updateTime }))) throw new HttpError(409, 'The requirement set changed while saving. Reload and try again.');
    await audited(ctx, `pln.requirement.${action}`, `Requirement set ${set.id}`, { site: set.siteId, status: next.status, note: note.slice(0, 300), bypassed: ctx.bypassed ?? [] });
    return { ...next, id: set.id } as ReqSet;
}
const can = (ctx: OrgContext) => Object.fromEntries(['PLN.commercial.plan', 'PLN.commercial.firm', 'PLN.requirements.approve', 'PLN.requirements.push'].map((p) => [p, holdsAnywhere(ctx, [p])]));

/** A set without its heavy results, for lists. */
const brief = (s: Obj, id: string) => {
    const lines = objs(s.lines);
    const dates = lines.map((l) => str(l.needDate)).filter(Boolean).sort();
    const firmed = objs(s.firmed);
    const sum = isObj(s.explosionSummary) ? s.explosionSummary : null;
    return {
        id, title: str(s.title), siteId: str(s.siteId), siteName: str(s.siteName), status: str(s.status), revision: Number(s.revision) || 1, lines: lines.length,
        units: lines.reduce((t, l) => t + (Number(l.quantity) || 0), 0), from: dates[0] ?? '', to: dates[dates.length - 1] ?? '',
        materials: sum ? Number(sum.materials) || 0 : null, toBuy: sum ? Number(sum.toBuy) || 0 : null, value: sum ? Number(sum.value) || 0 : null,
        firmedValue: Number(s.firmedValue) || 0, firmedLines: firmed.length, pushed: firmed.filter((f) => str(f.pushedTo)).length,
        createdByName: str(s.createdByName), updatedAt: str(s.updatedAt), createdAt: str(s.createdAt),
    };
};

// ----- Units: names, never registry codes -----

const UNITS = PROCUREMENT_UNITS.filter((u) => u.active);
function unitInfo(v: string): { label: string; symbol: string } {
    const k = v.trim();
    const u = UNITS.find((x) => x.code === k) ?? UNITS.find((x) => x.symbol === k) ?? UNITS.find((x) => x.label.toLowerCase() === k.toLowerCase()) ?? UNITS.find((x) => x.symbol.toLowerCase() === k.toLowerCase());
    return u ? { label: u.label, symbol: u.symbol } : { label: k, symbol: k };
}
/** Unit codes inside a sentence become unit names: people read "Kilogram", never a registry code. A bare code is left alone (the screen looks it up). */
const UNIT_CODE = /UOM-\d{2}-\d{3}/g;
const named = (text: string) => text.replace(UNIT_CODE, (c) => unitInfo(c).label);
function nameUnits<T>(value: T, depth = 0): T {
    if (depth > 40) return value;
    if (typeof value === 'string') return (/^UOM-\d{2}-\d{3}$/.test(value) ? value : named(value)) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => nameUnits(v, depth + 1)) as unknown as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Obj).map(([k, v]) => [k, nameUnits(v, depth + 1)])) as unknown as T;
    return value;
}
/** Every unit that appears in a result, with its name and symbol. */
function unitsIn(value: unknown, out: Record<string, { label: string; symbol: string }> = {}, depth = 0): Record<string, { label: string; symbol: string }> {
    if (depth > 40 || value === null || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
        for (const v of value) unitsIn(v, out, depth + 1);
        return out;
    }
    for (const [k, v] of Object.entries(value as Obj)) {
        if (typeof v === 'string' && v && (/uom$/i.test(k) || k === 'stockUom')) out[v] = unitInfo(v);
        else if (k === 'bomUnits' && Array.isArray(v)) for (const u of v) if (typeof u === 'string' && u) out[u] = unitInfo(u);
        else unitsIn(v, out, depth + 1);
    }
    return out;
}

// ----- Work back -----

/** Stock, open supply, price, lead time and lot rules of every warehouse material the explosion can reach. */
async function positionsOf(orgId: string, keys: Array<{ materialId: string; warehouseId: string }>, currency: string) {
    const [repl, fin] = await Promise.all([import('./replenishment'), import('./finCore')]);
    const supply = await repl.supplyIndex(orgId).catch(() => null);
    const out = new Map<string, MaterialPositionU>();
    const list = keys.slice(0, 1500);
    const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
    for (let i = 0; i < list.length; i += 12) {
        await Promise.all(
            list.slice(i, i + 12).map(async ({ materialId, warehouseId }) => {
                const [info, proc, mat, stock, val] = await Promise.all([
                    getDoc(`${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`),
                    getDoc(`${root(orgId)}/procurement_material_info/${materialId}_${warehouseId}`),
                    getDoc(`${root(orgId)}/materials/${materialId}`),
                    repl.stockPosition(orgId, warehouseId, materialId, 30).catch(() => null),
                    fin.stockValOf(orgId, warehouseId, materialId).catch(() => null),
                ]);
                if (!info) return;
                const i2 = info.data;
                const p = proc?.data ?? {};
                const notes: string[] = [];
                const stockUom = str(mat?.data.uom) || str(i2.uom);
                const purchaseUom = str(p.purchaseUom);
                // Cost per STOCK unit: the moving average when there is stock, otherwise the purchase price converted to the stock unit and currency.
                let unitCost = val && val.avg > 0 ? val.avg : 0;
                const price = pos(p.unitPrice);
                if (!unitCost && price !== null) {
                    let perStock: number | null = price;
                    if (purchaseUom && stockUom && purchaseUom !== stockUom) {
                        perStock = unitPricePerStockUnit(price, purchaseUom, stockUom);
                        if (perStock === null) notes.push(`The price is per ${purchaseUom} and cannot be converted to the stock unit ${stockUom}: it is not used.`);
                    }
                    const priceCurrency = str(p.priceCurrency).toUpperCase();
                    if (perStock !== null && priceCurrency && currency && priceCurrency !== currency) {
                        try {
                            perStock *= await fin.fxRate(priceCurrency, currency);
                        } catch {
                            perStock = null;
                            notes.push(`The price is in ${priceCurrency} and there is no exchange rate to ${currency}: it is not used.`);
                        }
                    }
                    unitCost = perStock ?? 0;
                }
                out.set(`${materialId}|${warehouseId}`, {
                    number: str(mat?.data.materialNumber) || materialId,
                    name: str(mat?.data.shortText) || str(mat?.data.name) || materialId,
                    stockUom,
                    purchaseUom,
                    available: Math.max(0, stock?.available ?? 0),
                    safetyStock: pos(i2.safetyStock) ?? 0,
                    openSupply: supply?.get(repl.keyOf(materialId, warehouseId))?.qty ?? 0,
                    unitCost,
                    leadDays: (pos(i2.leadTimeDays) ?? pos(p.leadTimeDays) ?? 0) + (pos(i2.internalLeadTimeDays) ?? 0),
                    moq: pos(p.minimumOrderQuantity),
                    orderMultiple: pos(p.orderMultiple),
                    notes,
                });
            })
        );
    }
    return out;
}

async function workBack(ctx: OrgContext, set: ReqSet) {
    const { setup } = await planningSetup(ctx.orgId);
    const skus = await skuMasters(ctx.orgId, setup);
    const date = today();
    const m = await supplyMasters(ctx.orgId, set.siteId, date, setup, skus);
    // The stored lines were validated when they were saved; a need date that has passed since only makes the order urgent.
    const lines = objs(set.lines) as unknown as RequirementLine[];
    // Every warehouse material the explosion can reach, to load their positions first.
    const keys = new Map<string, { materialId: string; warehouseId: string }>();
    const seen = new Set<string>();
    const walk = (sku: string, depth: number) => {
        if (seen.has(sku) || depth > 20) return;
        seen.add(sku);
        for (const c of m.bomOf(sku)?.components ?? []) {
            if (c.source === 'WAREHOUSE' && c.materialId && c.warehouseId) keys.set(`${c.materialId}|${c.warehouseId}`, { materialId: c.materialId, warehouseId: c.warehouseId });
            else if (c.source === 'PROCESS_SUPPLY' && c.processSupplyKind === 'PROCUREMENT' && c.materialId && c.warehouseId) keys.set(`${c.materialId}|${c.warehouseId}`, { materialId: c.materialId, warehouseId: c.warehouseId });
            else if ((c.source !== 'WAREHOUSE' && c.source !== 'PROCESS_SUPPLY') || c.processSupplyKind === 'SKU') if (c.skuId) walk(c.skuId, depth + 1);
        }
    };
    lines.forEach((l) => walk(l.skuId, 0));
    const positions = await positionsOf(ctx.orgId, [...keys.values()], str(ctx.org.data.currencyCode));
    const result = explodeRequirements({
        lines, skus, today: date, convert: skuUnitConversion,
        bomOf: m.bomOf, unitOf: m.unitOf, materialOf: (id, wh) => positions.get(`${id}|${wh}`) ?? null,
    });
    return { result: nameUnits(result), stamp: m.stamp };
}

// ----- Procurement hand-over helpers -----

async function warehouseNames(orgId: string, ids: string[]) {
    const out: Record<string, { code: string; name: string }> = {};
    await Promise.all([...new Set(ids)].map(async (id) => {
        const d = await getDoc(`${root(orgId)}/structure/${id}`);
        out[id] = { code: str(d?.data.code) || id, name: str(d?.data.name) || id };
    }));
    return out;
}

export const plnRequirementRoutes = {
    // Sites, final-product SKUs, what the person may do and the stages.
    'POST /api/org/pln/requirements/context': [
        orgRoute('org.pln.requirements.context', 'PLN.view', async (ctx) => {
            const { setup } = await planningSetup(ctx.orgId);
            const siteList = await sites(ctx, 'PLN.view');
            const skus = await skuMasters(ctx.orgId, setup);
            const finals = [...skus.entries()].filter(([, v]) => v.category === 'FINISHED').map(([id, v]) => ({ id, name: v.name, uom: v.uom, uomLabel: unitInfo(v.uom).label, uomSymbol: unitInfo(v.uom).symbol, whole: v.whole })).sort((a, b) => a.name.localeCompare(b.name));
            return { sites: siteList, skus: finals, can: can(ctx), steps: REQ_STEPS, today: today(), source: 'MANUAL' };
        }),
    ],

    'POST /api/org/pln/requirements/list': [
        orgRoute('org.pln.requirements.list', 'PLN.view', async (ctx) => {
            const docs = await listDocs(`${root(ctx.orgId)}/pln_requirements`);
            const out = [];
            for (const d of docs) if (await allowedAt(ctx, ['PLN.view'], str(d.data.siteId), 'read')) out.push(brief(d.data, d.id));
            return { sets: out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
        }),
    ],

    'POST /api/org/pln/requirements/create': [
        orgRoute('org.pln.requirements.create', 'PLN.commercial.plan', async (ctx) => {
            const siteId = str(ctx.body.siteId);
            if (!ID.test(siteId)) throw new HttpError(400, 'Choose a production site');
            await needAt(ctx, 'PLN.commercial.plan', siteId, 'write', 'create a requirement set');
            const title = str(ctx.body.title).trim();
            if (title.length < 3 || title.length > 100) throw new HttpError(400, 'Give the set a title of 3 to 100 characters, for example the customer order or the month.');
            const site = await getDoc(`${root(ctx.orgId)}/structure/${siteId}`);
            if (!site || str(site.data.level) !== 'site') throw new HttpError(400, 'Choose a production site');
            const id = `CMR${String(await nextOrgCounter(ctx.orgId, 'plnRequirementSeq')).padStart(9, '0')}`;
            const now = nowIso();
            const set = {
                title, siteId, siteName: str(site.data.name) || siteId, status: 'draft', revision: 1, lines: [], source: 'MANUAL',
                createdAt: now, createdBy: ctx.uid, createdByName: nameOf(ctx), updatedAt: now, updatedBy: ctx.uid,
                history: [{ at: now, by: ctx.uid, byName: nameOf(ctx), action: 'create', note: title, status: 'draft' }],
            };
            if (!(await writeDoc(setPath(ctx.orgId, id), set, { exists: false }))) throw new HttpError(409, 'Requirement set number already used. Try again.');
            await audited(ctx, 'pln.requirement.create', `Requirement set ${id}`, { siteId, title });
            return { set: { ...set, id } };
        }),
    ],

    'POST /api/org/pln/requirements/get': [
        orgRoute('org.pln.requirements.get', 'PLN.view', async (ctx) => {
            const { set } = await loadSet(ctx, str(ctx.body.id));
            const explosion = await loadResult<Explosion>(ctx.orgId, set.id, 'explosion', Number(set.explosionChunks) || 0);
            const blocking = Number(isObj(set.explosionSummary) ? set.explosionSummary.blocking : 0) || 0;
            const toBuy = Number(isObj(set.explosionSummary) ? set.explosionSummary.toBuy : 0) || 0;
            const unpriced = (explosion?.materials ?? []).filter((m) => m.buy > 0 && m.pushable && m.unitCost <= 0).length;
            const extra: Extra = { explosionRun: !!set.explosionAt, explosionStale: !!set.explosionAt && (Date.now() - Date.parse(str(set.explosionAt)) > STALE_MS || str(set.explosionAt) < str(set.firmedAt)), blocking, toBuy, unpriced };
            const step = objs(isObj(set.coa) ? set.coa.steps : []).find((x) => x.status === 'pending');
            const { myPositions } = await import('./purchaseOrders');
            const mine = myPositions(ctx.me);
            const actions: ReqAction[] = [];
            for (const a of ALL_ACTIONS) {
                if (!(await allowedAt(ctx, [REQ_PERMISSION[a]], set.siteId, 'write'))) continue;
                const why = reqTransitionCheck(set.status, a, ctx.uid, actorsOf(set), extra);
                // In test mode the independence rules are relaxed (and audited when used); state rules never are.
                if (why && !(ctx.testMode === true && /independent|earlier level|another person/.test(why))) continue;
                if ((a === 'approve_purchase' || a === 'return_purchase') && step && str(step.positionCode) && str(step.positionCode) !== 'TEST_MODE' && !mine.includes(str(step.positionCode))) continue;
                actions.push(a);
            }
            const firmed = objs(set.firmed) as unknown as FirmedLine[];
            const warehouses = await warehouseNames(ctx.orgId, [...firmed.map((f) => f.warehouseId), ...(explosion?.materials ?? []).map((m) => m.warehouseId)].filter(Boolean));
            const units = unitsIn([explosion, set.lines, set.firmed]);
            return { set, explosion, units, actions, warehouses, can: can(ctx), stale: !!set.explosionAt && extra.explosionStale, unpriced };
        }),
    ],

    // The commercial lines (draft only): final-product SKUs with a quantity in their own unit and a need date.
    'POST /api/org/pln/requirements/lines/save': [
        orgRoute('org.pln.requirements.lines.save', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            check(ctx, set, 'edit_lines');
            const { setup } = await planningSetup(ctx.orgId);
            const skus = await skuMasters(ctx.orgId, setup);
            const lines = asInput(() => readRequirementLines(ctx.body.lines, skus, today()));
            const title = ctx.body.title === undefined ? str(set.title) : str(ctx.body.title).trim();
            if (title.length < 3 || title.length > 100) throw new HttpError(400, 'Give the set a title of 3 to 100 characters.');
            const saved = await save(ctx, doc, set, { lines, title, explosionAt: '', explosionChunks: 0, explosionSummary: null }, 'lines.save', `${lines.length} final product line${lines.length === 1 ? '' : 's'}`, ctx.body.expectedRevision);
            return { set: saved };
        }),
    ],

    'POST /api/org/pln/requirements/submit': [
        orgRoute('org.pln.requirements.submit', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            check(ctx, set, 'submit_commercial');
            if (!objs(set.lines).length) throw new HttpError(400, 'Add at least one final product before submitting.');
            const { setup } = await planningSetup(ctx.orgId);
            const skuMap = await skuMasters(ctx.orgId, setup);
            // The lines are read again as if typed now: a need date that has passed or a SKU that is no longer final stops the submission.
            asInput(() => readRequirementLines(set.lines, skuMap, today()));
            const saved = await save(ctx, doc, set, { status: REQ_NEXT.submit_commercial, commercialSubmittedBy: ctx.uid, commercialSubmittedAt: nowIso() }, 'commercial.submit', str(ctx.body.note).trim(), ctx.body.expectedRevision);
            return { set: saved };
        }),
    ],

    // The independent approver firms the commercial requirements, or returns them with a reason.
    'POST /api/org/pln/requirements/decide': [
        orgRoute('org.pln.requirements.decide', 'PLN.commercial.firm', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.firm', 'write');
            const decision = str(ctx.body.decision);
            if (!['firm', 'return'].includes(decision)) throw new HttpError(400, 'Choose firm or return');
            check(ctx, set, decision === 'firm' ? 'firm_commercial' : 'return_commercial');
            const reason = str(ctx.body.reason).trim();
            if (decision === 'return' && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for returning the requirements.');
            let patch: Obj;
            if (decision === 'firm') {
                const { setup } = await planningSetup(ctx.orgId);
                const skus = await skuMasters(ctx.orgId, setup);
                asInput(() => readRequirementLines(set.lines, skus, today()));
                patch = { status: REQ_NEXT.firm_commercial, firmedBy: ctx.uid, firmedByName: nameOf(ctx), firmedAt: nowIso(), explosionAt: '', explosionChunks: 0, explosionSummary: null };
            } else {
                patch = { status: REQ_NEXT.return_commercial, commercialSubmittedBy: '', returnReason: reason.slice(0, 400), returnedBy: ctx.uid };
            }
            return { set: await save(ctx, doc, set, patch, `commercial.${decision}`, reason, ctx.body.expectedRevision) };
        }),
    ],

    // Works back from the final products to the materials (a preview while drafting; the firmed run is the one that counts).
    'POST /api/org/pln/requirements/explode': [
        orgRoute('org.pln.requirements.explode', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            check(ctx, set, 'run_explosion');
            if (!objs(set.lines).length) throw new HttpError(400, 'Add at least one final product before working back.');
            const { result, stamp } = await workBack(ctx, set);
            const chunks = await saveResult(ctx.orgId, set.id, 'explosion', result, Number(set.explosionChunks) || 0);
            const note = `${result.summary.materials} materials, ${result.summary.toBuy} to buy worth ${result.summary.value}${result.summary.blocking ? `; ${result.summary.blocking} blocking issue${result.summary.blocking === 1 ? '' : 's'}` : ''}`;
            const saved = await save(ctx, doc, set, { explosionAt: nowIso(), explosionBy: ctx.uid, explosionChunks: chunks, explosionStamp: stamp, explosionSummary: result.summary, explosionPreview: set.status !== 'firmed' }, 'explosion.run', note, undefined);
            return { set: saved, explosion: result, units: unitsIn(result) };
        }),
    ],

    // Firms the purchase requirements: the lines to buy are frozen and the Chart of Authority levels for their value become the approval steps.
    'POST /api/org/pln/requirements/purchase/submit': [
        orgRoute('org.pln.requirements.purchase.submit', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            const explosion = await loadResult<Explosion>(ctx.orgId, set.id, 'explosion', Number(set.explosionChunks) || 0);
            const { setup } = await planningSetup(ctx.orgId);
            const skus = await skuMasters(ctx.orgId, setup);
            const stamp = (await supplyMasters(ctx.orgId, set.siteId, today(), setup, skus)).stamp;
            const firmed = explosion ? firmedLinesOf(explosion.materials) : [];
            const unpriced = (explosion?.materials ?? []).filter((m) => m.buy > 0 && m.pushable && m.unitCost <= 0).length;
            check(ctx, set, 'submit_purchase', { explosionRun: !!explosion && !!set.explosionAt, explosionStale: staleOf(set, stamp), blocking: explosion?.summary.blocking ?? 0, toBuy: firmed.length, unpriced });
            const amount = Math.round(firmed.reduce((s, f) => s + f.value, 0) * 100) / 100;
            const [{ getAuthority }, { approvalRoute }] = await Promise.all([import('./procurementPolicy'), import('./purchaseOrders')]);
            const route = await approvalRoute(ctx.orgId, ctx.me, amount, await getAuthority(ctx.orgId), ctx.testMode === true);
            if (route.problems.length && !bypass(ctx, 'pln.requirement.coa_route')) throw new HttpError(409, `The Chart of Authority cannot route this purchase: ${route.problems.join(' ')}`);
            const steps = route.steps.map((x) => ({ level: x.level, title: x.title, positionCode: x.positionCode, positionTitle: x.positionTitle, status: 'pending', by: '', byName: '', at: '', note: '' }));
            // Below every authority band, a purchase requirements approver at the site still approves (one level, any holder).
            if (!steps.length) steps.push({ level: 'PRQ', title: 'Purchase requirements approval', positionCode: '', positionTitle: 'Any purchase requirements approver at the site', status: 'pending', by: '', byName: '', at: '', note: '' });
            const saved = await save(ctx, doc, set, { status: REQ_NEXT.submit_purchase, purchaseSubmittedBy: ctx.uid, purchaseSubmittedAt: nowIso(), firmed, firmedValue: amount, coa: { amount, steps, authorityVersion: route.authorityVersion, problems: route.problems } }, 'purchase.submit', str(ctx.body.note).trim() || `${firmed.length} materials to buy, value ${amount}`, ctx.body.expectedRevision);
            return { set: saved };
        }),
    ],

    'POST /api/org/pln/requirements/purchase/decide': [
        orgRoute('org.pln.requirements.purchase.decide', 'PLN.requirements.approve', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.requirements.approve', 'write');
            const decision = str(ctx.body.decision);
            if (!['approve', 'return'].includes(decision)) throw new HttpError(400, 'Choose approve or return');
            check(ctx, set, decision === 'approve' ? 'approve_purchase' : 'return_purchase');
            const reason = str(ctx.body.reason).trim();
            if (decision === 'return' && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for returning the purchase requirements.');
            const coa = isObj(set.coa) ? { ...set.coa } : { steps: [] };
            const steps = objs(coa.steps).map((x) => ({ ...x }));
            const step = steps.find((x) => x.status === 'pending');
            if (!step) throw new HttpError(409, 'No approval level is pending.');
            const { myPositions } = await import('./purchaseOrders');
            const pc = str(step.positionCode);
            if (pc === 'TEST_MODE' ? !(ctx.role === 'org_super_admin' && ctx.testMode === true) : pc && !myPositions(ctx.me).includes(pc)) {
                if (!bypass(ctx, 'pln.requirement.coa_position')) throw new HttpError(403, `Level ${str(step.level)} (${str(step.title)}) is approved by ${str(step.positionTitle)}.`);
            }
            const now = nowIso();
            let patch: Obj;
            if (decision === 'return') {
                patch = { status: REQ_NEXT.return_purchase, coa: { ...coa, steps: steps.map((x) => ({ ...x, status: 'pending', by: '', byName: '', at: '' })), returnedBy: ctx.uid, returnReason: reason.slice(0, 400) }, purchaseSubmittedBy: '', firmed: [], firmedValue: 0 };
            } else {
                Object.assign(step, { status: 'approved', by: ctx.uid, byName: nameOf(ctx), at: now, note: reason.slice(0, 300) });
                const done = steps.every((x) => x.status === 'approved');
                patch = { coa: { ...coa, steps }, ...(done ? { status: 'approved', approvedAt: now, approvedBy: ctx.uid } : {}) };
            }
            return { set: await save(ctx, doc, set, patch, `purchase.${decision}`, reason || `Level ${str(step.level)} ${decision === 'approve' ? 'approved' : 'returned'}`, ctx.body.expectedRevision) };
        }),
    ],

    // Confirms the quantities of the firmed lines (changeable with a reason, never above the approved value) and raises
    // them as purchase requirements. With dryRun the server only checks and shows what would be raised.
    'POST /api/org/pln/requirements/push': [
        orgRoute('org.pln.requirements.push', 'PLN.requirements.push', async (ctx) => {
            const { set } = await loadSet(ctx, str(ctx.body.id), 'PLN.requirements.push', 'write');
            check(ctx, set, 'push');
            const dryRun = ctx.body.dryRun === true;
            const gl = isObj(ctx.body.gl) ? ctx.body.gl : {};
            const edits = (Array.isArray(ctx.body.edits) ? ctx.body.edits : []).filter(isObj).map((e) => ({ key: str(e.key), quantity: e.quantity as number | string, reason: str(e.reason), dateRequired: str(e.dateRequired) }));
            const prep = async (current: ReqSet) => {
                const firmed = objs(current.firmed) as unknown as FirmedLine[];
                const review = reviewPush(firmed, edits, Number(current.firmedValue) || 0);
                const problems = review.problems.map(named);
                const names = await warehouseNames(ctx.orgId, review.lines.map((l) => l.warehouseId));
                const groups = new Map<string, typeof review.lines>();
                for (const l of review.lines) (groups.get(l.warehouseId) ?? groups.set(l.warehouseId, []).get(l.warehouseId)!).push(l);
                const min = today();
                const dateOf = (l: (typeof review.lines)[number]) => {
                    const asked = edits.find((e) => e.key === l.key)?.dateRequired ?? '';
                    if (asked) {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(asked) || Number.isNaN(Date.parse(`${asked}T00:00:00Z`)) || asked < min) problems.push(`${l.number}: the date required must be today or later.`);
                        return asked;
                    }
                    return l.needBy && l.needBy > min ? l.needBy : min;
                };
                const out = [];
                for (const [warehouseId, lines] of groups) {
                    if (!(await allowedAt(ctx, ['PLN.requirements.push'], warehouseId, 'write'))) problems.push(`${names[warehouseId]?.code ?? warehouseId} is outside your scope: you cannot push requirements for it.`);
                    const code = str(gl[warehouseId]).trim();
                    if (!dryRun && !code) problems.push(`Choose the GL account for ${names[warehouseId]?.code ?? warehouseId}.`);
                    out.push({ warehouseId, code: names[warehouseId]?.code ?? warehouseId, name: names[warehouseId]?.name ?? '', glCode: code, total: Math.round(lines.reduce((s, l) => s + l.pushValue, 0) * 100) / 100, lines: lines.map((l) => ({ ...l, dateRequired: dateOf(l) })) });
                }
                return { review, problems, groups: out };
            };
            const first = await prep(set);
            if (dryRun) {
                const { plannedApprover } = await import('./purchaseRequirements');
                const ap = await plannedApprover(ctx);
                return { ok: !first.problems.length && !ap.problem, problems: [...first.problems, ...(ap.problem ? [ap.problem] : [])], groups: first.groups, total: first.review.total, firmedTotal: first.review.firmedTotal, ceiling: Number(set.firmedValue) || 0, approver: ap.title };
            }
            if (first.problems.length) throw new HttpError(400, first.problems.join(' '));
            if (ctx.body.expectedRevision !== undefined && Number(ctx.body.expectedRevision) !== Number(set.revision)) throw new HttpError(409, 'The requirement set changed since you opened it. Reload and try again.');
            const { raisePlannedRequirement } = await import('./purchaseRequirements');
            // One push at a time per set: a lock that a crashed push left behind expires after five minutes.
            const lp = lockPath(ctx.orgId, set.id);
            const held = await getDoc(lp);
            if (held && Date.now() - Date.parse(str(held.data.at)) > 5 * 60_000) await deleteDoc(lp);
            if (!(await writeDoc(lp, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'Another push of this set is running. Try again in a moment.');
            const raised: Array<{ id: string; warehouse: string; lines: number; approver: string }> = [];
            try {
                // Reload under the lock: the lines to push must still be unpushed.
                let cur = await loadSet(ctx, set.id, 'PLN.requirements.push', 'write');
                check(ctx, cur.set, 'push');
                const again = await prep(cur.set);
                if (again.problems.length) throw new HttpError(409, again.problems.join(' '));
                for (const g of again.groups) {
                    const keys = new Set(g.lines.map((l) => l.key));
                    const mark = (to: string) => (objs(cur.set.firmed) as unknown as FirmedLine[]).map((f) => (keys.has(f.key) ? { ...f, pushedTo: to } : f));
                    // Reserve the lines first, so a failure after the requirement exists can never push them twice.
                    cur = { doc: cur.doc, set: await save(ctx, cur.doc, cur.set, { firmed: mark('PENDING') }, 'push.reserve', `${g.code}: ${g.lines.length} lines`, undefined) };
                    cur.doc = (await getDoc(setPath(ctx.orgId, set.id)))!;
                    let r;
                    try {
                        r = await raisePlannedRequirement(ctx, {
                            setId: set.id, setTitle: str(set.title), siteId: set.siteId, warehouseId: g.warehouseId, glCode: g.glCode,
                            lines: g.lines.map((l) => ({
                                key: l.key, materialId: l.materialId, quantity: l.quantity, firmQty: l.firmQty, reason: l.reason, dateRequired: l.dateRequired, urgency: l.orderNow ? 'high' : 'medium', budget: l.pushValue,
                                technical: named(`Planned from ${set.id} (${str(set.title)}) at ${set.siteName}${l.forSkus.length ? ` for ${l.forSkus.join(', ')}` : ''}. Firmed ${l.firmQty} ${l.stockUom}${l.changed ? `, pushed ${l.quantity} ${l.stockUom}: ${l.reason}` : ''}. Needed by ${l.needBy || l.dateRequired}.`).slice(0, 1900),
                            })),
                        });
                    } catch (e) {
                        // Nothing was raised: release the reservation and report.
                        const back = await getDoc(setPath(ctx.orgId, set.id));
                        if (back) await save(ctx, back, { ...(back.data as unknown as ReqSet), id: set.id }, { firmed: (objs(back.data.firmed) as unknown as FirmedLine[]).map((f) => (keys.has(f.key) && f.pushedTo === 'PENDING' ? { ...f, pushedTo: undefined } : f)) }, 'push.release', `${g.code}: ${e instanceof Error ? e.message : 'failed'}`.slice(0, 300), undefined).catch(() => undefined);
                        throw new HttpError(e instanceof HttpError ? e.status : 409, `${raised.length ? `${raised.map((x) => x.id).join(', ')} raised; ` : ''}${g.code}: ${e instanceof Error ? e.message : 'could not raise the requirement'}`);
                    }
                    raised.push({ id: r.id, warehouse: g.code, lines: r.lines, approver: r.approver });
                    const fresh = await getDoc(setPath(ctx.orgId, set.id));
                    const freshSet = { ...(fresh!.data as unknown as ReqSet), id: set.id } as ReqSet;
                    const nextFirmed = (objs(freshSet.firmed) as unknown as FirmedLine[]).map((f) => (keys.has(f.key) ? { ...f, pushedTo: r.id } : f));
                    const pushes = [...objs(freshSet.pushes), { at: nowIso(), by: ctx.uid, byName: nameOf(ctx), requirementId: r.id, warehouseId: g.warehouseId, total: g.total, lines: g.lines.map((l) => ({ key: l.key, quantity: l.quantity, firmQty: l.firmQty, reason: l.reason })) }];
                    const all = nextFirmed.every((f) => str(f.pushedTo) && f.pushedTo !== 'PENDING');
                    cur = { doc: fresh!, set: await save(ctx, fresh!, freshSet, { firmed: nextFirmed, pushes, ...(all ? { status: 'pushed', pushedAt: nowIso() } : {}) }, 'push', `${r.id}: ${g.code}, ${g.lines.length} lines, ${g.total}`, undefined) };
                }
                return { ok: true, raised, set: cur.set };
            } finally {
                await deleteDoc(lp).catch(() => undefined);
            }
        }),
    ],

    // Back to commercial requirements: the lines are editable again and everything after them has to be done again.
    'POST /api/org/pln/requirements/reopen': [
        orgRoute('org.pln.requirements.reopen', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            check(ctx, set, 'reopen');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for reopening the requirements.');
            const saved = await save(ctx, doc, set, { status: REQ_NEXT.reopen, commercialSubmittedBy: '', firmedBy: '', firmedAt: '', explosionAt: '', explosionChunks: 0, explosionSummary: null, firmed: [], firmedValue: 0, returnReason: reason.slice(0, 400) }, 'reopen', reason, ctx.body.expectedRevision);
            return { set: saved };
        }),
    ],

    'POST /api/org/pln/requirements/cancel': [
        orgRoute('org.pln.requirements.cancel', 'PLN.commercial.plan', async (ctx) => {
            const { doc, set } = await loadSet(ctx, str(ctx.body.id), 'PLN.commercial.plan', 'write');
            check(ctx, set, 'cancel');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for cancelling the requirement set.');
            const pushed = objs(set.firmed).filter((f) => str(f.pushedTo) && f.pushedTo !== 'PENDING').length;
            const saved = await save(ctx, doc, set, { status: REQ_NEXT.cancel, cancelledBy: ctx.uid, cancelReason: reason.slice(0, 400) }, 'cancel', `${reason}${pushed ? ` (${pushed} lines were already pushed to procurement and stay there)` : ''}`, ctx.body.expectedRevision);
            return { set: saved };
        }),
    ],
};
