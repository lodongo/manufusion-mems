// ---------------------------------------------------------------------------
// S&OP planning cycle: annual demand → SKU forecast → demand review → BOM unitisation, MRP and rough-cut capacity →
// executive S&OP (Chart of Authority on the planned purchase value) → release as the plan of record.
//
// Collections (organizations/{org}/…):
//   pln_config/planning                 the planning setup (versioned, audited, direct PLN.configure only)
//   pln_plans/{planId}                  a plan: site, financial year, buckets, annual demand lines, status, approvals
//   pln_plan_results/{planId}_{part}_{n} forecast and supply results (JSON text, chunked under the document limit)
//   pln_plan_of_record/{siteId}_{fy}    the released plan for a site and financial year
// Rules:
//   - the planning year is the financial year of the site's legal entity (Finance years, else Finance settings, else a
//     calendar year with a warning); part-way through the year only the balance is planned;
//   - every action is checked at the plan's site (job-role scope) and every change is audited;
//   - independent people at each gate (transitionCheck in plnPlanningModel.ts); the S&OP approval follows the Chart of
//     Authority levels for the planned purchase value; the test-mode override is development-only and audited;
//   - commercial confirmed demand is not linked yet: planned demand comes from the annual plan, and approved firm
//     orders in the demand register consume the forecast.
// ---------------------------------------------------------------------------
import { HttpError, getDoc, isObj, listDocs, nowIso, nextSequence, str, writeDoc, commitChecked, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedAt, audited, holdsAnywhere, holdsDirect } from './scopeGuard';
import { bypass } from './testModeCore';
import { selectEffectiveForSite } from './plnMfgRelease';
import { routingForSku, routingSkuIds } from './mfgRoutingSkuMappings';
import { mfgMaterialPolicyForOrg } from './mfgMaterialPolicy';
import { suggestedSplitRule } from '../src/shared/bomSplitRule';
import {
    ACTION_PERMISSION, NEXT_STATUS, PLAN_STEPS, balanceSummary, bucketsOf, defaultPlanningSetup, forecastSku, readLines, readPlanningSetup,
    roughCut, routingRate, runMrp, sopSummary, transitionCheck, unitiseBom,
    type BomIn, type Bucket, type MaterialPosition, type PlanAction, type PlanActors, type PlanStatus, type PlanningSetup, type SkuForecast, type SkuInfo, type SkuLine, type Unitisation,
} from './plnPlanningModel';

type Obj = Record<string, unknown>;
type Rel = Obj & { id: string; siteId: string; status: string; effectiveFrom: string; approvedAt: string };
const rel = (r: Obj & { id: string }): Rel => ({ ...r, siteId: str(r.siteId), status: str(r.status), effectiveFrom: str(r.effectiveFrom), approvedAt: str(r.approvedAt) });
const root = (o: string) => `organizations/${o}`;
const setupPath = (o: string) => `${root(o)}/pln_config/planning`;
const planPath = (o: string, id: string) => `${root(o)}/pln_plans/${id}`;
const resultPath = (o: string, id: string, part: string, i: number) => `${root(o)}/pln_plan_results/${id}_${part}_${i}`;
const recordPath = (o: string, siteId: string, fy: number) => `${root(o)}/pln_plan_of_record/${siteId}_${fy}`;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
const PLAN_ID = /^SOP\d{4}\d{6}$/;
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const asInput = <T>(fn: () => T): T => {
    try {
        return fn();
    } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, msg(e));
    }
};

// ----- Setup -----

export async function planningSetup(orgId: string): Promise<{ setup: PlanningSetup; version: number; doc: Doc | null }> {
    const doc = await getDoc(setupPath(orgId));
    if (!doc || !isObj(doc.data.setup)) return { setup: defaultPlanningSetup(), version: 0, doc };
    try {
        return { setup: readPlanningSetup(doc.data.setup), version: Number(doc.data.version) || 0, doc };
    } catch {
        return { setup: defaultPlanningSetup(), version: Number(doc.data.version) || 0, doc };
    }
}

// ----- Financial year of a site -----

interface PlanYear { fy: number; label: string; start: string; end: string; periods: Array<{ no: number; name: string; start: string; end: string; special?: boolean }>; source: 'finance' | 'settings' | 'calendar'; leId: string; leName: string; status: string }
/** The financial years a site can plan: the one that contains today and the next, from Finance for its legal entity. */
export async function siteYears(orgId: string, siteId: string, on = today()): Promise<PlanYear[]> {
    const fin = await import('./finCore');
    const units = await fin.unitsOf(orgId);
    const le = fin.leOf(units, siteId);
    const leId = le?.id ?? '';
    const leName = le?.name ?? '';
    if (le) {
        const years = (await fin.yearsOf(orgId, le.id).catch(() => [])).filter((y) => y.status !== 'closed');
        const cur = years.find((y) => on >= y.start && on <= y.end);
        if (cur) {
            const next = years.find((y) => y.fy === cur.fy + 1);
            const out: PlanYear[] = [{ fy: cur.fy, label: cur.label, start: cur.start, end: cur.end, periods: cur.periods, source: 'finance', leId, leName, status: cur.status }];
            if (next) out.push({ fy: next.fy, label: next.label, start: next.start, end: next.end, periods: next.periods, source: 'finance', leId, leName, status: next.status });
            else {
                const ent = await fin.entityOf(orgId, le.id);
                try {
                    const b = fin.buildYear(cur.fy + 1, ent.settings ?? fin.DEFAULT_SETTINGS, cur.end);
                    out.push({ fy: cur.fy + 1, ...b, source: 'settings', leId, leName, status: 'not initialised' });
                } catch { /* the next year cannot be built from the settings: plan the current year only */ }
            }
            return out;
        }
        const ent = await fin.entityOf(orgId, le.id);
        if (ent.settings) {
            const y = Number(on.slice(0, 4));
            for (const fy of [y - 1, y, y + 1]) {
                try {
                    const b = fin.buildYear(fy, ent.settings, null);
                    if (on >= b.start && on <= b.end) {
                        const out: PlanYear[] = [{ fy, ...b, source: 'settings', leId, leName, status: 'not initialised' }];
                        try {
                            out.push({ fy: fy + 1, ...fin.buildYear(fy + 1, ent.settings, b.end), source: 'settings', leId, leName, status: 'not initialised' });
                        } catch { /* current year only */ }
                        return out;
                    }
                } catch { /* try the next candidate */ }
            }
        }
    }
    const y = Number(on.slice(0, 4));
    return [y, y + 1].map((fy) => ({ fy, ...fin.buildYear(fy, { ...fin.DEFAULT_SETTINGS, calendarType: 'month', yearStartMonth: 1, specialPeriods: 0 }, null), source: 'calendar' as const, leId, leName, status: 'no finance calendar' }));
}

// ----- Access -----

async function needAt(ctx: OrgContext, perm: string, siteId: string, mode: 'read' | 'write', what: string) {
    if (!(await allowedAt(ctx, [perm], siteId, mode))) throw new HttpError(403, `You need ${perm} at this site to ${what}.`);
}
async function sites(ctx: OrgContext, perm: string) {
    const nodes = await listDocs(`${root(ctx.orgId)}/structure`);
    const out: Array<{ id: string; name: string }> = [];
    for (const n of nodes) if (str(n.data.level) === 'site' && str(n.data.status) !== 'inactive' && (await allowedAt(ctx, [perm], n.id, 'read'))) out.push({ id: n.id, name: str(n.data.name) || n.id });
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
const can = (ctx: OrgContext) => Object.fromEntries(['PLN.configure', 'PLN.demand.plan', 'PLN.demand.approve', 'PLN.supply.plan', 'PLN.sop.approve', 'PLN.mrp.release'].map((p) => [p, holdsAnywhere(ctx, [p])]));

// ----- Results storage (JSON text, chunked) -----

const CHUNK = 800_000;
async function saveResult(orgId: string, planId: string, part: string, value: unknown, previousChunks: number): Promise<number> {
    const text = JSON.stringify(value);
    const chunks = Math.max(1, Math.ceil(text.length / CHUNK));
    if (chunks > 8) throw new HttpError(413, 'The plan results are too large: split the plan into fewer SKUs.');
    for (let i = 0; i < chunks; i++) await writeDoc(resultPath(orgId, planId, part, i), { planId, part, index: i, chunks, json: text.slice(i * CHUNK, (i + 1) * CHUNK), savedAt: nowIso() });
    for (let i = chunks; i < previousChunks; i++) await writeDoc(resultPath(orgId, planId, part, i), { planId, part, index: i, chunks, json: '', savedAt: nowIso() });
    return chunks;
}
async function loadResult<T>(orgId: string, planId: string, part: string, chunks: number): Promise<T | null> {
    if (!chunks) return null;
    const docs = await Promise.all(Array.from({ length: chunks }, (_, i) => getDoc(resultPath(orgId, planId, part, i))));
    try {
        return JSON.parse(docs.map((d) => str(d?.data.json)).join('')) as T;
    } catch {
        return null;
    }
}

// ----- Plans -----

interface Plan extends Obj {
    id: string;
    siteId: string;
    siteName: string;
    fy: number;
    fyLabel: string;
    leId: string;
    yearSource: string;
    status: PlanStatus;
    revision: number;
    lines: SkuLine[];
    buckets: Bucket[];
    createdBy: string;
}
async function loadPlan(ctx: OrgContext, id: string, perm = 'PLN.view', mode: 'read' | 'write' = 'read') {
    if (!PLAN_ID.test(id)) throw new HttpError(400, 'Invalid plan');
    const doc = await getDoc(planPath(ctx.orgId, id));
    if (!doc) throw new HttpError(404, 'Plan not found');
    const plan = { ...doc.data, id } as unknown as Plan;
    await needAt(ctx, perm, plan.siteId, mode, 'work on this plan');
    return { doc, plan };
}
function actorsOf(p: Obj): PlanActors {
    return {
        createdBy: str(p.createdBy),
        demandSubmittedBy: str(p.demandSubmittedBy),
        demandApprovedBy: str(p.demandApprovedBy),
        supplySubmittedBy: str(p.supplySubmittedBy),
        sopApprovers: objs(isObj(p.coa) ? p.coa.steps : []).filter((s) => s.status === 'approved').map((s) => str(s.by)),
    };
}
/** Independence and state checks; the development test-mode override relaxes independence only (audited). */
function check(ctx: OrgContext, plan: Plan, action: PlanAction, extra: Parameters<typeof transitionCheck>[4] = {}) {
    const why = transitionCheck(plan.status, action, ctx.uid, actorsOf(plan), extra);
    if (!why) return;
    const independence = /independent|earlier level|another person|final approval/.test(why);
    if (independence && bypass(ctx, `pln.plan.${action}.independence`)) return;
    throw new HttpError(independence ? 403 : 409, why);
}
async function savePlan(ctx: OrgContext, doc: Doc, plan: Plan, patch: Obj, action: string, note: string, expectedRevision: unknown) {
    if (expectedRevision !== undefined && Number(expectedRevision) !== Number(plan.revision)) throw new HttpError(409, 'The plan changed since you opened it. Reload and try again.');
    const now = nowIso();
    const history = [{ at: now, by: ctx.uid, byName: str(ctx.me.data.displayName) || str(ctx.me.data.name) || ctx.uid, action, note: note.slice(0, 400), status: str(patch.status) || plan.status }, ...objs(plan.history)].slice(0, 80);
    const next = { ...plan, ...patch, revision: Number(plan.revision) + 1, history, updatedAt: now, updatedBy: ctx.uid } as Obj;
    delete next.id;
    if (!(await writeDoc(planPath(ctx.orgId, plan.id), next, { updateTime: doc.updateTime }))) throw new HttpError(409, 'The plan changed while saving. Reload and try again.');
    await audited(ctx, `pln.plan.${action}`, `S&OP plan ${plan.id}`, { site: plan.siteId, fy: plan.fy, status: next.status, note: note.slice(0, 300), bypassed: ctx.bypassed ?? [] });
    return { ...next, id: plan.id } as Plan;
}

// ----- Masters -----

// Whether a SKU is planned in whole units (forecast and demand quantities): from its unit.
const isWhole = (_setup: PlanningSetup, uom: string) => suggestedSplitRule(uom) === 'WHOLE';
async function skuMasters(orgId: string, setup: PlanningSetup) {
    const items = await listDocs(`${root(orgId)}/mfg_items`);
    const skus = new Map<string, SkuInfo>();
    for (const d of items) {
        const category = str(d.data.category);
        if (str(d.data.status) === 'removed') continue;
        skus.set(d.id, { name: str(d.data.name) || d.id, uom: str(d.data.uom) || 'EA', category, processClassId: str(d.data.processClassId), whole: isWhole(setup, str(d.data.uom) || 'EA') });
    }
    return skus;
}
const outputs = (skus: Map<string, SkuInfo>) => [...skus.entries()].filter(([, s]) => s.category === 'FINISHED' || s.category === 'INTERMEDIATE').map(([id, s]) => ({ id, ...s })).sort((a, b) => a.name.localeCompare(b.name));

/** Confirmed-order history and firm orders per SKU at a site, from approved lines in the demand register. */
async function demandRegister(orgId: string, siteId: string, months: number) {
    const docs = await listDocs(`${root(orgId)}/pln_demand`);
    const nowMonth = today().slice(0, 7);
    const start = (() => {
        const d = new Date(`${nowMonth}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - months);
        return d.toISOString().slice(0, 7);
    })();
    const history = new Map<string, Map<string, number>>();
    const firm = new Map<string, Record<string, number>>();
    for (const d of docs) {
        const r = d.data;
        if (str(r.status) !== 'approved' || str(r.siteId) !== siteId || str(r.type) !== 'FIRM_ORDER') continue;
        const month = str(r.needDate).slice(0, 7);
        const q = Number(r.quantity) || 0;
        if (!/^\d{4}-\d{2}$/.test(month) || q <= 0) continue;
        const sku = str(r.skuId);
        if (month < nowMonth) {
            if (month < start) continue;
            const m = history.get(sku) ?? history.set(sku, new Map()).get(sku)!;
            m.set(month, (m.get(month) ?? 0) + q);
        }
        if (month >= nowMonth) {
            const f = firm.get(sku) ?? firm.set(sku, {}).get(sku)!;
            f[month] = (f[month] ?? 0) + q;
        }
    }
    const series = (sku: string) => {
        const m = history.get(sku);
        if (!m) return [];
        const out: Array<{ month: string; qty: number }> = [];
        const d = new Date(`${start}-01T00:00:00Z`);
        for (let i = 0; i < months; i++) {
            const key = d.toISOString().slice(0, 7);
            out.push({ month: key, qty: m.get(key) ?? 0 });
            d.setUTCMonth(d.getUTCMonth() + 1);
        }
        return out;
    };
    return { series, firm: (sku: string) => firm.get(sku) ?? {} };
}

/** Effective BOMs and routings for a site on a date, with unitisation. */
async function supplyMasters(orgId: string, siteId: string, date: string, setup: PlanningSetup, skus: Map<string, SkuInfo>) {
    const [bomDocs, routeDocs, policy] = await Promise.all([listDocs(`${root(orgId)}/mfg_boms`), listDocs(`${root(orgId)}/mfg_routings`), mfgMaterialPolicyForOrg(orgId).catch(() => null)]);
    const mrpClasses = new Set((policy?.policy.bomClassifications ?? [{ code: 'PRODUCTION', mrpRelevant: true, enabled: true }]).filter((c) => c.mrpRelevant && c.enabled !== false).map((c) => c.code));
    const boms = bomDocs.map((d) => ({ ...d.data, id: d.id, updateTime: d.updateTime }) as Obj & { id: string }).filter((b) => mrpClasses.has(str(b.classificationCode) || 'PRODUCTION'));
    const routes = routeDocs.map((d) => ({ ...d.data, id: d.id }) as Obj & { id: string });
    const bomCache = new Map<string, BomIn | null>();
    const bomOf = (sku: string): BomIn | null => {
        if (bomCache.has(sku)) return bomCache.get(sku)!;
        const info = skus.get(sku);
        const pickFrom = (list: Array<Obj & { id: string }>) => selectEffectiveForSite(list.map(rel), date, siteId);
        const found =
            pickFrom(boms.filter((b) => str(b.applicability || 'SKU') === 'SKU' && str(b.parentSkuId) === sku)) ??
            (info?.processClassId ? pickFrom(boms.filter((b) => str(b.applicability) === 'PROCESS_CLASS' && str(b.processClassId) === info.processClassId)) : null) ??
            pickFrom(boms.filter((b) => str(b.applicability) === 'ALL'));
        const out = found ? ({ id: found.id, name: str(found.name), parentSkuId: sku, outputQty: Number(found.outputQty) || 1, outputUom: str(found.outputUom) || info?.uom || 'EA', components: objs(found.components) as unknown as BomIn['components'], routingId: str(found.routingId) } as BomIn) : null;
        bomCache.set(sku, out);
        return out;
    };
    const routeCache = new Map<string, { id: string; name: string; stages: Obj[] } | null>();
    const routingOf = (sku: string) => {
        if (routeCache.has(sku)) return routeCache.get(sku)!;
        const bom = bomOf(sku);
        const candidates = routes.filter((r) => routingSkuIds(r).includes(sku));
        const preferred = bom?.routingId ? candidates.filter((r) => r.id === bom.routingId) : [];
        const eff = selectEffectiveForSite((preferred.length ? preferred : candidates).map(rel), date, siteId);
        const mapped = eff ? routingForSku(eff, sku) : null;
        const out = mapped ? { id: eff!.id, name: str(eff!.name) || eff!.id, stages: objs(mapped.operations) } : null;
        routeCache.set(sku, out);
        return out;
    };
    const unitCache = new Map<string, Unitisation>();
    const unitOf = (sku: string, bom: BomIn) => {
        const k = `${sku}|${bom.id}`;
        if (!unitCache.has(k)) {
            const rt = routingOf(sku);
            const vessel = rt ? routingRate(rt.stages).vessel : null;
            unitCache.set(k, unitiseBom(bom, setup, vessel));
        }
        return unitCache.get(k)!;
    };
    const fingerprint = boms.map((b) => `${b.id}:${str(b.updateTime)}`).sort().join('|').length + ':' + routes.length;
    return { bomOf, routingOf, unitOf, fingerprint };
}

/** Stock, open supply, cost, lead time and lot rules of every warehouse material the explosion can reach. */
async function materialPositions(orgId: string, keys: Array<{ materialId: string; warehouseId: string }>) {
    const [repl, fin] = await Promise.all([import('./replenishment'), import('./finCore')]);
    const supply = await repl.supplyIndex(orgId).catch(() => null);
    const out = new Map<string, MaterialPosition>();
    const list = keys.slice(0, 1500);
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
                const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
                out.set(`${materialId}|${warehouseId}`, {
                    available: Math.max(0, stock?.available ?? 0),
                    safetyStock: pos(i2.safetyStock) ?? 0,
                    openSupply: supply?.get(repl.keyOf(materialId, warehouseId))?.qty ?? 0,
                    unitCost: val && val.avg > 0 ? val.avg : pos(p.unitPrice) ?? 0,
                    leadDays: (pos(i2.leadTimeDays) ?? pos(p.leadTimeDays) ?? 0) + (pos(i2.internalLeadTimeDays) ?? 0),
                    moq: pos(p.minimumOrderQuantity),
                    orderMultiple: pos(p.orderMultiple),
                    name: str(mat?.data.shortText) || str(mat?.data.name) || materialId,
                    number: str(mat?.data.materialNumber) || materialId,
                    uom: str(mat?.data.uom) || str(i2.uom),
                });
            })
        );
    }
    return out;
}

// ----- Runs -----

async function runForecastFor(ctx: OrgContext, plan: Plan, setup: PlanningSetup) {
    const years = await siteYears(ctx.orgId, plan.siteId);
    const year = years.find((y) => y.fy === plan.fy);
    if (!year) throw new HttpError(409, `${plan.fyLabel} is no longer open for planning at this site.`);
    const buckets = bucketsOf(year, today(), setup.currentPeriodRule);
    if (!buckets.some((b) => b.fraction > 0)) throw new HttpError(409, `${plan.fyLabel} has no balance periods left to plan.`);
    const lines = asInput(() => readLines(plan.lines, buckets, setup));
    if (!lines.length) throw new HttpError(400, 'Add at least one SKU with its annual quantity.');
    const skus = await skuMasters(ctx.orgId, setup);
    const reg = await demandRegister(ctx.orgId, plan.siteId, setup.historyMonths);
    const { getForecastSetup } = await import('./forecasting');
    const fs = (await getForecastSetup(ctx.orgId).catch(() => null))?.setup;
    const now = nowIso();
    const forecasts: SkuForecast[] = lines.map((line) => {
        const info = skus.get(line.skuId);
        if (!info || !['FINISHED', 'INTERMEDIATE'].includes(info.category)) throw new HttpError(400, `${line.skuId} is not a finished or intermediate SKU.`);
        return forecastSku({ line, uom: info.uom, whole: info.whole, buckets, history: reg.series(line.skuId), firm: reg.firm(line.skuId), setup, forecastSetup: fs, now });
    });
    return { buckets, forecasts, balance: balanceSummary(buckets), year };
}

async function runSupplyFor(ctx: OrgContext, plan: Plan, setup: PlanningSetup, forecasts: SkuForecast[]) {
    const buckets = plan.buckets;
    const skus = await skuMasters(ctx.orgId, setup);
    const date = buckets.find((b) => b.fraction > 0)?.start ?? today();
    const m = await supplyMasters(ctx.orgId, plan.siteId, date > today() ? date : today(), setup, skus);
    // Every warehouse material reachable from the demanded SKUs, to load their positions first.
    const keys = new Map<string, { materialId: string; warehouseId: string }>();
    const seen = new Set<string>();
    const walk = (sku: string, depth: number) => {
        if (seen.has(sku) || depth > 20) return;
        seen.add(sku);
        const bom = m.bomOf(sku);
        for (const c of bom?.components ?? []) {
            if (c.source === 'WAREHOUSE' && c.materialId && c.warehouseId) keys.set(`${c.materialId}|${c.warehouseId}`, { materialId: c.materialId, warehouseId: c.warehouseId });
            else if ((c.source !== 'WAREHOUSE' && c.source !== 'PROCESS_SUPPLY') || c.processSupplyKind === 'SKU') if (c.skuId) walk(c.skuId, depth + 1);
        }
    };
    forecasts.forEach((f) => walk(f.skuId, 0));
    const positions = await materialPositions(ctx.orgId, [...keys.values()]);
    const demand = new Map(forecasts.map((f) => [f.skuId, f.buckets.map((b) => b.demand)]));
    const mrp = runMrp({ buckets, demand, bomOf: m.bomOf, unitOf: m.unitOf, skus, materialOf: (id, wh) => positions.get(`${id}|${wh}`) ?? null });
    for (const it of mrp.items) if (it.kind === 'material') {
        const p = positions.get(`${it.id}|${it.warehouseId}`);
        if (p?.number) it.name = `${p.number} · ${p.name}`;
    }
    const production = new Map([...mrp.skuPlan.entries()].map(([sku, p]) => [sku, p.rows.map((r) => r.receipt)]));
    const byRoute = new Map<string, { id: string; name: string; stages: Obj[]; skus: string[] }>();
    for (const sku of production.keys()) {
        const rt = m.routingOf(sku);
        if (!rt) continue;
        const g = byRoute.get(rt.id) ?? { ...rt, skus: [] };
        g.skus.push(sku);
        byRoute.set(rt.id, g);
    }
    const capacity = roughCut({ buckets, routings: [...byRoute.values()], production, setup });
    const units = [...mrp.skuPlan.keys()].map((sku) => {
        const bom = m.bomOf(sku);
        const rt = m.routingOf(sku);
        return { skuId: sku, name: skus.get(sku)?.name ?? sku, uom: skus.get(sku)?.uom ?? '', bomId: bom?.id ?? '', bomName: bom?.name ?? '', routingId: rt?.id ?? '', routingName: rt?.name ?? '', unit: bom ? m.unitOf(sku, bom) : null };
    });
    const sop = sopSummary({ buckets, forecasts, mrp, capacity, skus });
    const readiness = units.map((u) => ({ skuId: u.skuId, bom: !!u.bomId, routing: !!u.routingId })).filter((r) => !r.bom || !r.routing);
    return { mrp: { items: mrp.items.slice(0, 1500), issues: mrp.issues, truncated: mrp.items.length > 1500 }, skuPlan: Object.fromEntries(mrp.skuPlan), capacity, units, sop, readiness, fingerprint: m.fingerprint };
}

/** A plan without its heavy results, for lists and decisions. */
const brief = (p: Obj) => ({ id: str(p.id), siteId: str(p.siteId), siteName: str(p.siteName), fy: Number(p.fy), fyLabel: str(p.fyLabel), status: str(p.status), revision: Number(p.revision), lines: objs(p.lines).length, kpis: isObj(p.kpis) ? p.kpis : null, demandTotals: isObj(p.demandTotals) ? p.demandTotals : null, createdBy: str(p.createdBy), createdByName: str(p.createdByName), createdAt: str(p.createdAt), updatedAt: str(p.updatedAt), coa: isObj(p.coa) ? { amount: p.coa.amount, steps: p.coa.steps } : null });

export const plnPlanningRoutes = {
    // Sites, financial years (with the balance periods), SKUs, the setup and what the person may do.
    'POST /api/org/pln/planning/context': [
        orgRoute('org.pln.planning.context', 'PLN.view', async (ctx) => {
            const { setup, version, doc } = await planningSetup(ctx.orgId);
            const siteList = await sites(ctx, 'PLN.view');
            const siteId = ID.test(str(ctx.body.siteId)) ? str(ctx.body.siteId) : siteList[0]?.id ?? '';
            let years: Array<Obj> = [];
            if (siteId) {
                await needAt(ctx, 'PLN.view', siteId, 'read', 'see its planning year');
                years = (await siteYears(ctx.orgId, siteId)).map((y) => {
                    const buckets = bucketsOf(y, today(), setup.currentPeriodRule);
                    return { fy: y.fy, label: y.label, start: y.start, end: y.end, source: y.source, leId: y.leId, leName: y.leName, status: y.status, buckets, balance: balanceSummary(buckets) };
                });
            }
            const skus = await skuMasters(ctx.orgId, setup);
            return { setup, version, setupUpdatedAt: str(doc?.data.updatedAt), setupHistory: objs(doc?.data.history).slice(0, 15), sites: siteList, siteId, years, skus: outputs(skus), can: can(ctx), steps: PLAN_STEPS, today: today() };
        }),
    ],

    'POST /api/org/pln/planning/setup/save': [
        orgRoute('org.pln.planning.setup.save', 'PLN.configure', async (ctx) => {
            if (!holdsDirect(ctx, ['PLN.configure'])) throw new HttpError(403, 'The organization planning setup needs PLN.configure in your own security role.');
            const setup = asInput(() => readPlanningSetup(ctx.body.setup));
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for changing the planning setup.');
            const { version, doc } = await planningSetup(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== version) throw new HttpError(409, 'The setup changed since you opened it. Reload and try again.');
            const now = nowIso();
            const history = [{ at: now, by: ctx.uid, byName: str(ctx.me.data.displayName) || ctx.uid, version: version + 1, reason: reason.slice(0, 300) }, ...objs(doc?.data.history)].slice(0, 30);
            if (!(await writeDoc(setupPath(ctx.orgId), { setup: setup as unknown as Obj, version: version + 1, history, updatedAt: now, updatedBy: ctx.uid }, doc ? { updateTime: doc.updateTime } : { exists: false }))) throw new HttpError(409, 'The setup changed while saving. Reload and try again.');
            await audited(ctx, 'pln.planning.setup.save', 'S&OP planning setup', { version: version + 1, reason, setup });
            return { setup, version: version + 1 };
        }),
    ],

    'POST /api/org/pln/planning/plans': [
        orgRoute('org.pln.planning.plans', 'PLN.view', async (ctx) => {
            const docs = await listDocs(`${root(ctx.orgId)}/pln_plans`);
            const out = [];
            for (const d of docs) if (await allowedAt(ctx, ['PLN.view'], str(d.data.siteId), 'read')) out.push(brief({ ...d.data, id: d.id }));
            return { plans: out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
        }),
    ],

    'POST /api/org/pln/planning/plan/create': [
        orgRoute('org.pln.planning.plan.create', 'PLN.demand.plan', async (ctx) => {
            const siteId = str(ctx.body.siteId);
            if (!ID.test(siteId)) throw new HttpError(400, 'Choose a production site');
            await needAt(ctx, 'PLN.demand.plan', siteId, 'write', 'create a plan');
            const fy = Number(ctx.body.fy);
            const years = await siteYears(ctx.orgId, siteId);
            const year = years.find((y) => y.fy === fy);
            if (!year) throw new HttpError(400, 'Choose the current or the next financial year');
            const { setup } = await planningSetup(ctx.orgId);
            const buckets = bucketsOf(year, today(), setup.currentPeriodRule);
            if (!buckets.some((b) => b.fraction > 0)) throw new HttpError(409, `${year.label} has no balance periods left to plan.`);
            const open = (await listDocs(`${root(ctx.orgId)}/pln_plans`)).find((d) => str(d.data.siteId) === siteId && Number(d.data.fy) === fy && !['released', 'superseded', 'cancelled'].includes(str(d.data.status)));
            if (open) throw new HttpError(409, `Plan ${open.id} for this site and year is still ${str(open.data.status).replace('_', ' ')}. Finish or cancel it first.`);
            const site = await getDoc(`${root(ctx.orgId)}/structure/${siteId}`);
            // Start from the last released plan's lines, so the next cycle only revises what changed.
            const rec = await getDoc(recordPath(ctx.orgId, siteId, fy));
            const prev = rec ? await getDoc(planPath(ctx.orgId, str(rec.data.planId))) : null;
            const id = `SOP${fy}${String(await nextSequence('plnPlanSeq')).padStart(6, '0')}`;
            const now = nowIso();
            const plan = {
                siteId, siteName: str(site?.data.name) || siteId, fy, fyLabel: year.label, leId: year.leId, leName: year.leName, yearSource: year.source,
                status: 'draft', revision: 1, lines: prev ? objs(prev.data.lines).map((l) => ({ ...l, overrides: {} })) : [], buckets, balance: balanceSummary(buckets),
                createdAt: now, createdBy: ctx.uid, createdByName: str(ctx.me.data.displayName) || ctx.uid, updatedAt: now, updatedBy: ctx.uid,
                copiedFrom: prev?.id ?? '', history: [{ at: now, by: ctx.uid, byName: str(ctx.me.data.displayName) || ctx.uid, action: 'create', note: prev ? `Copied the lines of ${prev.id}` : '', status: 'draft' }],
            };
            if (!(await writeDoc(planPath(ctx.orgId, id), plan, { exists: false }))) throw new HttpError(409, 'Plan number already used. Try again.');
            await audited(ctx, 'pln.plan.create', `S&OP plan ${id}`, { siteId, fy, yearSource: year.source, copiedFrom: prev?.id ?? '' });
            return { plan: { ...plan, id } };
        }),
    ],

    'POST /api/org/pln/planning/plan/get': [
        orgRoute('org.pln.planning.plan.get', 'PLN.view', async (ctx) => {
            const { plan } = await loadPlan(ctx, str(ctx.body.id));
            const [forecast, supply] = await Promise.all([
                loadResult<{ forecasts: SkuForecast[] }>(ctx.orgId, plan.id, 'forecast', Number(plan.forecastChunks) || 0),
                loadResult<Obj>(ctx.orgId, plan.id, 'supply', Number(plan.supplyChunks) || 0),
            ]);
            const act = (a: PlanAction) => holdsAnywhere(ctx, [ACTION_PERMISSION[a]]) && !transitionCheck(plan.status, a, ctx.uid, actorsOf(plan), { forecastRun: !!plan.forecastRunAt, supplyRun: !!plan.supplyRunAt });
            const step = objs(isObj(plan.coa) ? plan.coa.steps : []).find((s) => s.status === 'pending');
            const { myPositions } = await import('./purchaseOrders');
            const mine = myPositions(ctx.me);
            const actions = (['edit_demand', 'run_forecast', 'submit_demand', 'approve_demand', 'return_demand', 'run_supply', 'submit_supply', 'approve_sop', 'return_sop', 'release', 'cancel'] as PlanAction[]).filter(act).filter((a) => a !== 'approve_sop' || !step || !str(step.positionCode) || mine.includes(str(step.positionCode)) || ctx.testMode === true);
            return { plan, forecast: forecast?.forecasts ?? [], supply, actions };
        }),
    ],

    // Annual demand lines (draft only). Overrides need a reason; the forecast is re-run after any change.
    'POST /api/org/pln/planning/plan/lines/save': [
        orgRoute('org.pln.planning.plan.lines.save', 'PLN.demand.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.demand.plan', 'write');
            check(ctx, plan, 'edit_demand');
            const { setup } = await planningSetup(ctx.orgId);
            const lines = asInput(() => readLines(ctx.body.lines, plan.buckets, setup));
            const skus = await skuMasters(ctx.orgId, setup);
            for (const l of lines) if (!['FINISHED', 'INTERMEDIATE'].includes(skus.get(l.skuId)?.category ?? '')) throw new HttpError(400, `${l.skuId} is not a finished or intermediate SKU.`);
            const changed = lines.length !== objs(plan.lines).length ? `${lines.length} SKUs` : 'lines updated';
            const saved = await savePlan(ctx, doc, plan, { lines, forecastRunAt: '', forecastStale: true }, 'lines.save', changed, ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    // Detailed SKU forecast over the balance periods (re-dates the buckets to today).
    'POST /api/org/pln/planning/plan/forecast': [
        orgRoute('org.pln.planning.plan.forecast', 'PLN.demand.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.demand.plan', 'write');
            check(ctx, plan, 'run_forecast');
            const { setup } = await planningSetup(ctx.orgId);
            const r = await runForecastFor(ctx, plan, setup);
            const chunks = await saveResult(ctx.orgId, plan.id, 'forecast', { forecasts: r.forecasts }, Number(plan.forecastChunks) || 0);
            const demandTotals = { annual: r.forecasts.reduce((t, f) => t + f.totals.annual, 0), balance: r.forecasts.reduce((t, f) => t + f.totals.balance, 0), demand: r.forecasts.reduce((t, f) => t + f.totals.demand, 0), firm: r.forecasts.reduce((t, f) => t + f.totals.firm, 0), statisticalSkus: r.forecasts.filter((f) => f.stat).length };
            const saved = await savePlan(ctx, doc, plan, { buckets: r.buckets, balance: r.balance, forecastChunks: chunks, forecastRunAt: nowIso(), forecastStale: false, demandTotals, supplyRunAt: '', supplyChunks: 0 }, 'forecast.run', `${r.forecasts.length} SKUs, ${r.balance.open} open periods`, undefined);
            return { plan: saved, forecast: r.forecasts };
        }),
    ],

    'POST /api/org/pln/planning/plan/demand/submit': [
        orgRoute('org.pln.planning.plan.demand.submit', 'PLN.demand.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.demand.plan', 'write');
            check(ctx, plan, 'submit_demand', { forecastRun: !!plan.forecastRunAt && !plan.forecastStale });
            const saved = await savePlan(ctx, doc, plan, { status: NEXT_STATUS.submit_demand, demandSubmittedBy: ctx.uid, demandSubmittedAt: nowIso() }, 'demand.submit', str(ctx.body.note).trim(), ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    'POST /api/org/pln/planning/plan/demand/decide': [
        orgRoute('org.pln.planning.plan.demand.decide', 'PLN.demand.approve', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.demand.approve', 'write');
            const decision = str(ctx.body.decision);
            if (!['approve', 'return'].includes(decision)) throw new HttpError(400, 'Choose approve or return');
            const action: PlanAction = decision === 'approve' ? 'approve_demand' : 'return_demand';
            check(ctx, plan, action);
            const reason = str(ctx.body.reason).trim();
            if (decision === 'return' && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for returning the demand plan.');
            const patch: Obj = decision === 'approve' ? { status: 'supply_planning', demandApprovedBy: ctx.uid, demandApprovedAt: nowIso() } : { status: 'draft', demandReturnedBy: ctx.uid, demandReturnReason: reason.slice(0, 400), demandSubmittedBy: '' };
            const saved = await savePlan(ctx, doc, plan, patch, `demand.${decision}`, reason, ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    // Unitisation, MRP, rough-cut capacity and the S&OP summary on the approved demand.
    'POST /api/org/pln/planning/plan/supply/run': [
        orgRoute('org.pln.planning.plan.supply.run', 'PLN.supply.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.supply.plan', 'write');
            check(ctx, plan, 'run_supply');
            const { setup } = await planningSetup(ctx.orgId);
            const fc = await loadResult<{ forecasts: SkuForecast[] }>(ctx.orgId, plan.id, 'forecast', Number(plan.forecastChunks) || 0);
            if (!fc?.forecasts?.length) throw new HttpError(409, 'The approved demand has no forecast results. Return it to the demand planner.');
            const r = await runSupplyFor(ctx, plan, setup, fc.forecasts);
            const chunks = await saveResult(ctx.orgId, plan.id, 'supply', r, Number(plan.supplyChunks) || 0);
            const saved = await savePlan(ctx, doc, plan, { supplyChunks: chunks, supplyRunAt: nowIso(), supplyRunBy: ctx.uid, kpis: r.sop.kpis, readinessGaps: r.readiness.length }, 'supply.run', `${r.mrp.items.length} planned items; purchase value ${r.sop.kpis.purchaseValue}`, undefined);
            return { plan: saved, supply: r };
        }),
    ],

    // Submits the supply plan: the Chart of Authority levels for the planned purchase value become the approval steps.
    'POST /api/org/pln/planning/plan/supply/submit': [
        orgRoute('org.pln.planning.plan.supply.submit', 'PLN.supply.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.supply.plan', 'write');
            const stale = !plan.supplyRunAt || Date.now() - Date.parse(str(plan.supplyRunAt)) > 24 * 3_600_000 || str(plan.supplyRunAt) < str(plan.demandApprovedAt);
            check(ctx, plan, 'submit_supply', { supplyRun: !!plan.supplyRunAt, supplyStale: stale });
            const amount = Number(isObj(plan.kpis) ? plan.kpis.purchaseValue : 0) || 0;
            const [{ getAuthority }, { approvalRoute }] = await Promise.all([import('./procurementPolicy'), import('./purchaseOrders')]);
            const route = await approvalRoute(ctx.orgId, ctx.me, amount, await getAuthority(ctx.orgId), ctx.testMode === true);
            if (route.problems.length && !bypass(ctx, 'pln.plan.coa_route')) throw new HttpError(409, `The Chart of Authority cannot route this plan: ${route.problems.join(' ')}`);
            const steps = route.steps.map((x) => ({ level: x.level, title: x.title, positionCode: x.positionCode, positionTitle: x.positionTitle, status: 'pending', by: '', byName: '', at: '', note: '' }));
            // Below every authority band, an S&OP approver at the site still approves (one level, any holder).
            if (!steps.length) steps.push({ level: 'SOP', title: 'S&OP approval', positionCode: '', positionTitle: 'Any S&OP approver at the site', status: 'pending', by: '', byName: '', at: '', note: '' });
            const note = str(ctx.body.note).trim();
            const saved = await savePlan(ctx, doc, plan, { status: NEXT_STATUS.submit_supply, supplySubmittedBy: ctx.uid, supplySubmittedAt: nowIso(), coa: { amount, steps, authorityVersion: route.authorityVersion, problems: route.problems } }, 'supply.submit', note || `Planned purchase value ${amount}; ${steps.length} approval level(s)`, ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    'POST /api/org/pln/planning/plan/sop/decide': [
        orgRoute('org.pln.planning.plan.sop.decide', 'PLN.sop.approve', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.sop.approve', 'write');
            const decision = str(ctx.body.decision);
            if (!['approve', 'return'].includes(decision)) throw new HttpError(400, 'Choose approve or return');
            check(ctx, plan, decision === 'approve' ? 'approve_sop' : 'return_sop');
            const reason = str(ctx.body.reason).trim();
            if (decision === 'return' && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for returning the plan.');
            const coa = isObj(plan.coa) ? { ...plan.coa } : { steps: [] };
            const steps = objs(coa.steps).map((s) => ({ ...s }));
            const step = steps.find((s) => s.status === 'pending');
            if (!step) throw new HttpError(409, 'No approval level is pending.');
            const { myPositions } = await import('./purchaseOrders');
            const pc = str(step.positionCode);
            if (pc === 'TEST_MODE' ? !(ctx.role === 'org_super_admin' && ctx.testMode === true) : pc && !myPositions(ctx.me).includes(pc)) {
                if (!bypass(ctx, 'pln.plan.coa_position')) throw new HttpError(403, `Level ${str(step.level)} (${str(step.title)}) is approved by ${str(step.positionTitle)}.`);
            }
            const now = nowIso();
            const by = str(ctx.me.data.displayName) || ctx.uid;
            let patch: Obj;
            if (decision === 'return') {
                patch = { status: 'supply_planning', coa: { ...coa, steps: steps.map((s) => ({ ...s, status: 'pending', by: '', byName: '', at: '' })), returnedBy: ctx.uid, returnReason: reason.slice(0, 400) }, supplySubmittedBy: '' };
            } else {
                Object.assign(step, { status: 'approved', by: ctx.uid, byName: by, at: now, note: reason.slice(0, 300) });
                const done = steps.every((s) => s.status === 'approved');
                patch = { coa: { ...coa, steps }, ...(done ? { status: 'approved', approvedAt: now, approvedBy: ctx.uid } : {}) };
            }
            const saved = await savePlan(ctx, doc, plan, patch, `sop.${decision}`, reason || `Level ${str(step.level)} ${decision === 'approve' ? 'approved' : 'returned'}`, ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    // Release: the approved plan becomes the plan of record for the site and year; the previous one is superseded.
    'POST /api/org/pln/planning/plan/release': [
        orgRoute('org.pln.planning.plan.release', 'PLN.mrp.release', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.mrp.release', 'write');
            check(ctx, plan, 'release');
            const rp = recordPath(ctx.orgId, plan.siteId, plan.fy);
            const rec = await getDoc(rp);
            const now = nowIso();
            const prevId = str(rec?.data.planId);
            const prev = prevId && prevId !== plan.id ? await getDoc(planPath(ctx.orgId, prevId)) : null;
            const history = [{ at: now, by: ctx.uid, byName: str(ctx.me.data.displayName) || ctx.uid, action: 'release', note: str(ctx.body.note).trim().slice(0, 400) || (prev ? `Supersedes ${prev.id}` : ''), status: 'released' }, ...objs(plan.history)].slice(0, 80);
            const next = { ...plan, status: 'released', releasedAt: now, releasedBy: ctx.uid, supersedes: prev?.id ?? '', revision: Number(plan.revision) + 1, history, updatedAt: now, updatedBy: ctx.uid } as Obj;
            delete next.id;
            if (ctx.body.expectedRevision !== undefined && Number(ctx.body.expectedRevision) !== Number(plan.revision)) throw new HttpError(409, 'The plan changed since you opened it. Reload and try again.');
            const writes: Array<{ path: string; data: Obj; precondition: { exists?: boolean; updateTime?: string } }> = [
                { path: planPath(ctx.orgId, plan.id), data: next, precondition: { updateTime: doc.updateTime } },
                { path: rp, data: { planId: plan.id, siteId: plan.siteId, fy: plan.fy, releasedAt: now, releasedBy: ctx.uid, previous: prevId }, precondition: rec ? { updateTime: rec.updateTime } : { exists: false } },
            ];
            if (prev) writes.push({ path: planPath(ctx.orgId, prev.id), data: { ...prev.data, status: 'superseded', supersededBy: plan.id, supersededAt: now }, precondition: { updateTime: prev.updateTime } });
            if (!(await commitChecked(writes))) throw new HttpError(409, 'The plan or the plan of record changed while releasing. Reload and try again.');
            await audited(ctx, 'pln.plan.release', `S&OP plan ${plan.id}`, { site: plan.siteId, fy: plan.fy, supersedes: prev?.id ?? '', bypassed: ctx.bypassed ?? [] });
            return { plan: { ...next, id: plan.id } };
        }),
    ],

    'POST /api/org/pln/planning/plan/cancel': [
        orgRoute('org.pln.planning.plan.cancel', 'PLN.demand.plan', async (ctx) => {
            const { doc, plan } = await loadPlan(ctx, str(ctx.body.id), 'PLN.demand.plan', 'write');
            check(ctx, plan, 'cancel');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for cancelling the plan.');
            const saved = await savePlan(ctx, doc, plan, { status: 'cancelled', cancelledBy: ctx.uid, cancelReason: reason.slice(0, 400) }, 'cancel', reason, ctx.body.expectedRevision);
            return { plan: saved };
        }),
    ],

    // Unitisation of one SKU's effective BOM at a site with the current setup (what-if before planning).
    'POST /api/org/pln/planning/unitise': [
        orgRoute('org.pln.planning.unitise', 'PLN.view', async (ctx) => {
            const siteId = str(ctx.body.siteId);
            const skuId = str(ctx.body.skuId);
            if (!ID.test(siteId) || !ID.test(skuId)) throw new HttpError(400, 'Choose a site and a SKU');
            await needAt(ctx, 'PLN.view', siteId, 'read', 'see its BOMs');
            const { setup } = await planningSetup(ctx.orgId);
            const skus = await skuMasters(ctx.orgId, setup);
            const m = await supplyMasters(ctx.orgId, siteId, today(), setup, skus);
            const bom = m.bomOf(skuId);
            if (!bom) return { skuId, bom: null, unit: null, routing: null, message: 'No approved BOM is effective for this SKU at this site today.' };
            const rt = m.routingOf(skuId);
            const qty = Number(ctx.body.quantity) > 0 ? Number(ctx.body.quantity) : 0;
            const unit = m.unitOf(skuId, bom);
            const { unitise } = await import('./plnPlanningModel');
            return { skuId, bom: { id: bom.id, name: bom.name, outputQty: bom.outputQty, outputUom: bom.outputUom }, routing: rt ? { id: rt.id, name: rt.name, ...routingRate(rt.stages) } : null, unit, check: qty ? unitise(qty, unit.lot) : null };
        }),
    ],

    // The released plan of record for a site and year (planned production and purchases for execution).
    'POST /api/org/pln/planning/plan-of-record': [
        orgRoute('org.pln.planning.plan_of_record', 'PLN.view', async (ctx) => {
            const siteId = str(ctx.body.siteId);
            const fy = Number(ctx.body.fy);
            if (!ID.test(siteId) || !Number.isInteger(fy)) throw new HttpError(400, 'Choose a site and a financial year');
            await needAt(ctx, 'PLN.view', siteId, 'read', 'see its plan of record');
            const rec = await getDoc(recordPath(ctx.orgId, siteId, fy));
            if (!rec) return { plan: null };
            const p = await getDoc(planPath(ctx.orgId, str(rec.data.planId)));
            return { plan: p ? brief({ ...p.data, id: p.id }) : null, releasedAt: str(rec.data.releasedAt) };
        }),
    ],
};
