// ---------------------------------------------------------------------------
// Background forecasting: recommendations, mass evaluation, impact analysis and acceptance.
//
// Every activated material × warehouse is forecast from its own issue history with its actual internal and external
// lead times, criticality class (service level, insurance spares, PD protection), demand pattern and ageing. The result
// is only a RECOMMENDATION (organizations/{org}/forecast_recommendations/{material}_{warehouse}) until a person accepts
// it, one by one or a whole group at a time:
//   levels   no_change · increase · decrease · pd (purchase on demand, RP07: hold no stock)
//   strategy none · to_pd (to RP07) · to_stock (RP07 → RP01 Min-Max)
// Acceptance:
//   - needs INV.forecast.approve for the warehouse; a person cannot accept recommendations of a run they started;
//   - changes that release capital (decrease, PD, no change) are applied by the accepting approver;
//   - changes that commit capital (increase, back to stock) become a proposal routed through the Chart of Authority on
//     |Δ maximum| × moving average cost and are applied by the existing forecast approval (independent approver);
//   - a strategy set by the criticality analysis is never changed here.
// Triggers: the weekly automation job, every issue posted (change tracker), and the mass evaluation button.
// Materials whose category is not activated are neither forecast nor analysed, and are left out of every report.
// Everything is audited.
// ---------------------------------------------------------------------------
import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, randomId, runQuery, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { allowedAt, audited, holdsAnywhere, requireAt } from './scopeGuard';
import { bypass } from './testModeCore';
import { onMaterialChanges, type MaterialChange } from './changeTracker';
import { LEVEL_FIELDS, ageingOf, isActivated, recommendFrom, type ForecastSetup } from './forecastModel';
import { FC, forecastFor, getForecastSetup, journalInstances, materialInputs } from './forecasting';
import { getCriticalitySetup, strategyLockedByCriticality } from './criticality';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
const recPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/forecast_recommendations/${materialId}_${warehouseId}`;
const runPath = (orgId: string, runId: string) => `${root(orgId)}/forecast_runs/${runId}`;
const infoPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`;
const forecastPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/material_forecasts/${materialId}_${warehouseId}`;

/** Activated material × warehouse pairs: approved materials of activated categories that are set up in a warehouse. */
export async function activatedPairs(orgId: string, setup: ForecastSetup, warehouseFilter?: (w: string) => boolean) {
    const [infos, materials] = await Promise.all([listDocs(`${root(orgId)}/inventory_material_info`), listDocs(`${root(orgId)}/materials`)]);
    const mat = new Map(materials.map((m) => [m.id, m.data]));
    const out: Array<{ materialId: string; warehouseId: string; categoryCode: string; name: string; materialNumber: string }> = [];
    for (const i of infos) {
        const materialId = str(i.data.materialId), warehouseId = str(i.data.warehouseId);
        const m = mat.get(materialId);
        if (!m || !ID.test(materialId) || !ID.test(warehouseId) || !['approved', 'active'].includes(str(m.status))) continue;
        if (!isActivated(setup, str(m.categoryCode))) continue;
        if (warehouseFilter && !warehouseFilter(warehouseId)) continue;
        out.push({ materialId, warehouseId, categoryCode: str(m.categoryCode), name: str(m.shortText) || str(m.name), materialNumber: str(m.materialNumber) || materialId });
    }
    return out.sort((a, b) => (a.materialId + a.warehouseId).localeCompare(b.materialId + b.warehouseId));
}

/** Is this material analysed (forecasting and criticality)? */
export async function materialActivated(orgId: string, materialId: string, setup?: ForecastSetup) {
    const s = setup ?? (await getForecastSetup(orgId)).setup;
    if (s.activation.mode !== 'selected') return true;
    const m = await getDoc(`${root(orgId)}/materials/${materialId}`);
    return !!m && isActivated(s, str(m.data.categoryCode));
}

/** Forecasts one material in one warehouse and stores the recommendation (an open one is replaced). */
export async function evaluateMaterial(orgId: string, materialId: string, warehouseId: string, run: { runId: string; by: string; trigger: 'mass' | 'weekly' | 'issue' }, cache: { setup: ForecastSetup; setupVersion: number; crit?: Awaited<ReturnType<typeof getCriticalitySetup>>; supply?: Awaited<ReturnType<Awaited<typeof import('./replenishment')>['supplyIndex']>> | null; meta?: { name: string; materialNumber: string; categoryCode: string } }) {
    const setup = cache.setup;
    const [instances, m, existing] = await Promise.all([
        journalInstances(orgId, materialId, warehouseId),
        materialInputs(orgId, materialId, warehouseId, setup, { crit: cache.crit, supply: cache.supply }),
        getDoc(recPath(orgId, materialId, warehouseId)),
    ]);
    const now = nowIso();
    const f = (await getDoc(forecastPath(orgId, materialId, warehouseId)))?.data ?? {};
    // The saved masks and planned events of the material are respected; the method follows the setup.
    const result = forecastFor(setup, instances, { masked: f.masked, events: f.events }, m, now);
    const onHand = m.stock ? Math.max(0, Number(m.stock.physical ?? m.stock.available) || 0) : 0;
    const ageing = ageingOf(instances, now, onHand, setup);
    const locked = await strategyLockedByCriticality(orgId, m.info);
    const rec = recommendFrom({
        setup, criticalityClass: m.criticalityClass, strategy: str(m.info.replenishmentStrategy), strategyLocked: locked ? 'criticality' : '',
        current: m.current, levels: result.levels, leadDays: result.levels.leadDays, ageing, onHand, unitCost: m.unitCost,
    });
    const meta = cache.meta ?? await (async () => {
        const md = (await getDoc(`${root(orgId)}/materials/${materialId}`))?.data ?? {};
        return { name: str(md.shortText) || str(md.name), materialNumber: str(md.materialNumber) || materialId, categoryCode: str(md.categoryCode) };
    })();
    const doc = {
        materialId, warehouseId, ...meta,
        status: 'open',
        runId: run.runId, runBy: run.by, trigger: run.trigger, evaluatedAt: now, setupVersion: cache.setupVersion,
        group: rec.group, strategyGroup: rec.strategyGroup, reasons: rec.reasons,
        current: m.current, values: rec.values,
        currentStrategy: str(m.info.replenishmentStrategy), recommendedStrategy: rec.recommendedStrategy, strategyLocked: locked,
        impact: rec.impact, unitCost: m.unitCost, onHand,
        criticalityClass: m.criticalityClass, criticalityCell: m.criticalityCell,
        method: result.method, pattern: result.pattern.pattern, trend: result.trend.direction,
        accuracy: result.accuracy, demandPerMonth: result.levels.demandPerMonth, serviceLevel: result.levels.serviceLevel,
        leadDays: result.levels.leadDays, externalLeadDays: result.levels.externalLeadDays, internalLeadDays: result.levels.internalLeadDays,
        leadBasis: `${m.lead.externalSource}/${m.lead.internalSource} · ${m.lead.statistic} · ${m.samples.length} order(s)`,
        historyMonths: result.historyMonths, sufficient: result.sufficient, notes: result.levels.notes,
        ageing,
        previous: existing && str(existing.data.status) === 'open' ? null : existing ? { status: str(existing.data.status), decidedAt: str(existing.data.decidedAt), group: str(existing.data.group) } : null,
    };
    await writeDoc(recPath(orgId, materialId, warehouseId), doc as never);
    return doc;
}

/** Visible warehouse filter for a person (null = every warehouse). */
async function warehouseFilter(ctx: OrgContext, mode: 'read' | 'write'): Promise<(w: string) => boolean> {
    if (ctx.role === 'org_super_admin') return () => true;
    const allowed = await allowedNodeIds(ctx.orgId, ctx.me, mode === 'read');
    return (w: string) => allowed === 'all' || allowed.has(w);
}

/** Runs a slice of a mass evaluation within the time budget; resumable by cursor. */
export async function evaluateSlice(orgId: string, run: { runId: string; by: string; trigger: 'mass' | 'weekly' }, pairs: Awaited<ReturnType<typeof activatedPairs>>, cursor: string, deadline: number) {
    const { setup, version } = await getForecastSetup(orgId);
    const [crit, repl] = await Promise.all([getCriticalitySetup(orgId), import('./replenishment')]);
    const supply = await repl.supplyIndex(orgId).catch(() => null);
    const todo = cursor ? pairs.filter((p) => p.materialId + '_' + p.warehouseId > cursor) : pairs;
    let done = 0, failed = 0, next = '';
    for (const p of todo) {
        if (Date.now() > deadline) { next = p.materialId + '_' + p.warehouseId; break; }
        try {
            await evaluateMaterial(orgId, p.materialId, p.warehouseId, run, { setup, setupVersion: version, crit, supply, meta: { name: p.name, materialNumber: p.materialNumber, categoryCode: p.categoryCode } });
            done++;
        } catch {
            failed++;
        }
        next = '';
        cursor = p.materialId + '_' + p.warehouseId;
    }
    return { done, failed, cursor: next ? cursor : '', complete: !next };
}

/** Weekly automation: every activated material of an organization, resumable. */
export async function weeklyForOrganization(orgId: string, deadline: number, cursor: string) {
    const { setup } = await getForecastSetup(orgId);
    if (!setup.autoWeekly) return { done: 0, failed: 0, cursor: '', complete: true, skipped: true };
    const pairs = await activatedPairs(orgId, setup);
    const runId = 'W' + nowIso().slice(0, 10).replace(/-/g, '');
    const r = await evaluateSlice(orgId, { runId, by: 'system', trigger: 'weekly' }, pairs, cursor, deadline);
    return { ...r, skipped: false };
}

// After every issue: re-forecast the material in that warehouse (background; never blocks the posting).
async function onIssue(input: { orgId: string; changes: MaterialChange[] }) {
    const pairs = new Map<string, MaterialChange>();
    for (const c of input.changes) if (c.source === 'material_journal' && c.warehouseId && ID.test(c.materialId) && ID.test(c.warehouseId)) pairs.set(c.materialId + '_' + c.warehouseId, c);
    if (!pairs.size) return;
    const { setup, version } = await getForecastSetup(input.orgId);
    if (!setup.autoOnIssue) return;
    for (const c of [...pairs.values()].slice(0, 10)) {
        try {
            if (!(await materialActivated(input.orgId, c.materialId, setup))) continue;
            // Only an issue (consumption) triggers it: receipts and transfers do not change demand.
            const latest = (await journalInstances(input.orgId, c.materialId, c.warehouseId)).at(-1);
            if (!latest || latest.kind !== 'issue' || Date.now() - Date.parse(latest.at) > 15 * 60_000) continue;
            await evaluateMaterial(input.orgId, c.materialId, c.warehouseId, { runId: 'I' + latest.id.slice(0, 40), by: 'system', trigger: 'issue' }, { setup, setupVersion: version });
        } catch {
            /* background: a failed re-forecast is picked up by the weekly run */
        }
    }
}
onMaterialChanges(onIssue);

const GROUPS = ['no_change', 'increase', 'decrease', 'pd'] as const;
const STRATEGY_GROUPS = ['to_pd', 'to_stock'] as const;

/** Impact analysis over open recommendations. */
export function impactSummary(recs: Obj[]) {
    const sum = (list: Obj[], k: string) => Math.round(list.reduce((n, r) => n + (Number(isObj(r.impact) ? r.impact[k] : 0) || 0), 0) * 100) / 100;
    const by = (key: string, values: readonly string[]) => Object.fromEntries(values.map((g) => {
        const list = recs.filter((r) => str(r[key]) === g);
        return [g, { count: list.length, plannedValueChange: sum(list, 'plannedValueChange'), onHandValue: sum(list, 'onHandValue'), excessValue: sum(list, 'excessValue') }];
    }));
    const dead = recs.filter((r) => isObj(r.ageing) && r.ageing.dead === true);
    const slow = recs.filter((r) => isObj(r.ageing) && r.ageing.slow === true);
    return {
        materials: recs.length,
        stockCapital: { onHand: sum(recs, 'onHandValue'), plannedNow: sum(recs, 'plannedValueNow'), plannedRecommended: sum(recs, 'plannedValueRecommended'), change: sum(recs, 'plannedValueChange') },
        excess: { count: recs.filter((r) => isObj(r.impact) && Number(r.impact.excessQty) > 0).length, value: sum(recs, 'excessValue') },
        deadStock: { count: dead.length, value: sum(dead, 'deadStockValue') },
        slowMoving: { count: slow.length, value: sum(slow, 'onHandValue') },
        pd: { count: recs.filter((r) => str(r.group) === 'pd').length, onHandValue: sum(recs.filter((r) => str(r.group) === 'pd'), 'onHandValue') },
        groups: by('group', GROUPS),
        strategyGroups: by('strategyGroup', STRATEGY_GROUPS),
        insufficientHistory: recs.filter((r) => r.sufficient === false).length,
    };
}

/** Applies an accepted recommendation that releases capital (or confirms no change). */
async function applyDirect(ctx: OrgContext, r: Obj, info: Obj) {
    const now = nowIso();
    const values = isObj(r.values) ? r.values : {};
    const patch: Obj = { forecastAppliedAt: now, forecastAppliedBy: ctx.uid, forecastMethod: str(r.method), forecastRecommendation: str(r.runId), updatedAt: now, updatedBy: ctx.uid };
    if (str(r.group) !== 'no_change') for (const k of LEVEL_FIELDS) if (Number.isFinite(Number(values[k]))) patch[k] = Number(values[k]);
    if (str(r.strategyGroup) === 'to_pd' && !str(r.strategyLocked)) Object.assign(patch, { replenishmentStrategy: 'RP07', strategySource: 'forecast', strategyChangedAt: now, strategyChangedBy: ctx.uid });
    await writeDoc(infoPath(ctx.orgId, str(r.materialId), str(r.warehouseId)), { ...info, ...patch } as never);
    const { logLevelChange } = await import('./materialAudit');
    await logLevelChange(ctx.orgId, str(r.materialId), str(r.warehouseId), info, patch, { source: 'forecast', by: ctx.uid, method: str(r.method) }).catch(() => null);
}

/** Routes an accepted recommendation that commits capital through the Chart of Authority as a forecast proposal. */
async function routeThroughAuthority(ctx: OrgContext, r: Obj): Promise<string[]> {
    const path = forecastPath(ctx.orgId, str(r.materialId), str(r.warehouseId));
    const f = (await getDoc(path))?.data ?? {};
    if (isObj(f.proposal) && str(f.proposal.status) === 'pending') throw new HttpError(409, 'Levels are already waiting for approval on this material.');
    const value = Number(isObj(r.impact) ? r.impact.maxChangeValue : 0) || 0;
    const [{ getAuthority }, { approvalRoute }] = await Promise.all([import('./procurementPolicy'), import('./purchaseOrders')]);
    const route = await approvalRoute(ctx.orgId, ctx.me, value, await getAuthority(ctx.orgId), ctx.testMode === true);
    if (route.problems.length && !bypass(ctx, 'inv.forecast.coa_route')) throw new HttpError(409, `The Chart of Authority cannot route this change: ${route.problems.join(' ')}`);
    const now = nowIso();
    const values = isObj(r.values) ? r.values : {};
    const current = isObj(r.current) ? r.current : {};
    const proposal = {
        status: 'pending', values, previous: current, changes: LEVEL_FIELDS.filter((k) => Number(current[k] ?? 0) !== Number(values[k])),
        value, unitCost: r.unitCost, steps: route.steps.map((x) => ({ level: x.level, title: x.title, positionCode: x.positionCode, positionTitle: x.positionTitle, status: 'pending', by: '', at: '' })),
        authorityVersion: route.authorityVersion, method: r.method, trend: r.trend, pattern: r.pattern, accuracy: r.accuracy,
        historyMonths: r.historyMonths, simulated: false, requestedBy: ctx.uid, requestedAt: now,
        fromRecommendation: str(r.runId), recommendedStrategy: str(r.strategyGroup) === 'to_stock' ? 'RP01' : '',
    };
    await writeDoc(path, { ...f, materialId: r.materialId, warehouseId: r.warehouseId, proposal, createdAt: str(f.createdAt) || now, createdBy: str(f.createdBy) || ctx.uid } as never);
    return proposal.steps.map((x) => x.level);
}

export const forecastRecommendationRoutes = {
    // Starts or continues a mass evaluation over every activated material in the warehouses the person may change.
    'POST /api/org/inventory/forecast/evaluate': [
        orgRoute('org.inventory.forecast.evaluate', 'INV.forecast.edit', async (ctx) => {
            if (!holdsAnywhere(ctx, [FC.edit, FC.setup])) throw new HttpError(403, 'Forecast permission required');
            const { setup } = await getForecastSetup(ctx.orgId);
            const filter = await warehouseFilter(ctx, 'write');
            const pairs = await activatedPairs(ctx.orgId, setup, filter);
            let runId = str(ctx.body.runId);
            let run: Obj;
            if (runId) {
                if (!/^M[0-9A-Za-z]{6,40}$/.test(runId)) throw new HttpError(400, 'Invalid run');
                const d = await getDoc(runPath(ctx.orgId, runId));
                if (!d || str(d.data.by) !== ctx.uid) throw new HttpError(404, 'Run not found');
                if (str(d.data.status) === 'complete') return { runId, ...(d.data as Obj) };
                run = d.data;
            } else {
                runId = 'M' + nowIso().replace(/[^0-9]/g, '').slice(0, 14) + randomId(4).replace(/[^0-9A-Za-z]/g, '');
                run = { runId, by: ctx.uid, startedAt: nowIso(), status: 'running', total: pairs.length, done: 0, failed: 0, cursor: '' };
                await audited(ctx, 'inventory.forecast.evaluate.start', 'Forecast mass evaluation', { runId, materials: pairs.length, activation: setup.activation });
            }
            const r = await evaluateSlice(ctx.orgId, { runId, by: ctx.uid, trigger: 'mass' }, pairs, str(run.cursor), Date.now() + 40_000);
            const next = { ...run, done: Number(run.done || 0) + r.done, failed: Number(run.failed || 0) + r.failed, cursor: r.cursor, status: r.complete ? 'complete' : 'running', ...(r.complete ? { completedAt: nowIso() } : {}) };
            await writeDoc(runPath(ctx.orgId, runId), next as never);
            if (r.complete) await audited(ctx, 'inventory.forecast.evaluate.complete', 'Forecast mass evaluation', { runId, done: next.done, failed: next.failed });
            return next;
        }),
    ],

    // Open recommendations in the warehouses the person can see, with the impact analysis.
    'POST /api/org/inventory/forecast/recommendations': [
        orgRoute('org.inventory.forecast.recommendations', 'INV.forecast.view', async (ctx) => {
            const filter = await warehouseFilter(ctx, 'read');
            const { setup } = await getForecastSetup(ctx.orgId);
            const runId = str(ctx.body.runId);
            const docs = await runQuery({ from: [{ collectionId: 'forecast_recommendations' }], where: fieldEq('status', 'open') }, root(ctx.orgId));
            const recs = docs.map((d) => ({ id: d.id, ...d.data }) as Obj)
                .filter((r) => filter(str(r.warehouseId)) && isActivated(setup, str(r.categoryCode)) && (!runId || str(r.runId) === runId));
            const warehouses = Object.fromEntries((await listDocs(`${root(ctx.orgId)}/warehouses`)).map((w) => [w.id, str(w.data.name) || w.id]));
            return { recommendations: recs, summary: impactSummary(recs), warehouses, canDecide: holdsAnywhere(ctx, [FC.approve]), activation: setup.activation };
        }),
    ],

    // Accept or reject recommendations, one or many (a group). Accepting needs INV.forecast.approve per warehouse.
    'POST /api/org/inventory/forecast/recommendations/decide': [
        orgRoute('org.inventory.forecast.recommendations.decide', 'INV.forecast.approve', async (ctx) => {
            const decision = str(ctx.body.decision);
            if (!['accept', 'reject'].includes(decision)) throw new HttpError(400, 'Choose accept or reject');
            const keys = Array.isArray(ctx.body.keys) ? [...new Set(ctx.body.keys.map(str))] : [];
            if (!keys.length || keys.length > 300 || keys.some((k) => !/^[A-Za-z0-9_-]{3,241}$/.test(k))) throw new HttpError(400, 'Choose 1 to 300 recommendations');
            const reason = str(ctx.body.reason).trim();
            if (decision === 'reject' && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for rejecting');
            if (keys.length > 1 && str(ctx.body.confirm) !== String(keys.length)) throw new HttpError(400, `Type ${keys.length} to confirm the number of recommendations`);
            const { setup } = await getForecastSetup(ctx.orgId);
            const results: Array<{ key: string; outcome: 'applied' | 'routed' | 'rejected' | 'skipped'; detail: string }> = [];
            const deadline = Date.now() + 45_000;
            for (const key of keys) {
                if (Date.now() > deadline) { results.push({ key, outcome: 'skipped', detail: 'Time limit reached; run it again for the rest.' }); continue; }
                const path = `${root(ctx.orgId)}/forecast_recommendations/${key}`;
                const doc = await getDoc(path);
                const r = doc?.data;
                try {
                    if (!r || str(r.status) !== 'open') throw new HttpError(409, 'No longer open (re-evaluated or decided).');
                    const materialId = str(r.materialId), warehouseId = str(r.warehouseId);
                    if (!(await allowedAt(ctx, [FC.approve], warehouseId, 'write'))) throw new HttpError(403, 'No forecast approval right in this warehouse.');
                    if (!isActivated(setup, str(r.categoryCode))) throw new HttpError(409, 'Its category is no longer activated for forecasting.');
                    // Maker-checker: a person never accepts the output of a run they started themselves.
                    if (decision === 'accept' && str(r.runBy) === ctx.uid && !bypass(ctx, 'inv.forecast.recommendation_independence')) throw new HttpError(403, 'You started this evaluation, so another approver must accept it.');
                    const now = nowIso();
                    let outcome: 'applied' | 'routed' | 'rejected' = 'rejected';
                    let detail = '';
                    if (decision === 'reject') {
                        detail = reason.slice(0, 300);
                    } else {
                        const info = (await getDoc(infoPath(ctx.orgId, materialId, warehouseId)))?.data;
                        if (!info) throw new HttpError(404, 'The material is not set up in this warehouse.');
                        // Recommendation must still match the material: levels changed since → re-evaluate first.
                        const cur = isObj(r.current) ? r.current : {};
                        if (LEVEL_FIELDS.some((k) => Number(cur[k] ?? 0) !== Number(info[k] ?? 0)) || str(r.currentStrategy) !== str(info.replenishmentStrategy))
                            throw new HttpError(409, 'The levels or strategy changed after the evaluation; re-evaluate first.');
                        const commits = str(r.group) === 'increase' || str(r.strategyGroup) === 'to_stock';
                        if (commits && Number(isObj(r.impact) ? r.impact.maxChangeValue : 0) > 0) {
                            const levels = await routeThroughAuthority(ctx, r);
                            outcome = 'routed';
                            detail = `Sent for Chart of Authority approval (${levels.join(', ') || 'independent approver'}).`;
                        } else {
                            await applyDirect(ctx, r, info);
                            outcome = 'applied';
                            detail = str(r.group) === 'no_change' ? 'Current levels confirmed.' : 'Applied.';
                        }
                    }
                    await writeDoc(path, { ...r, status: decision === 'accept' ? (outcome === 'routed' ? 'routed' : 'accepted') : 'rejected', decidedAt: now, decidedBy: ctx.uid, decisionNote: (decision === 'reject' ? reason : detail).slice(0, 300) } as never, { updateTime: doc!.updateTime });
                    await audited(ctx, `inventory.forecast.recommendation.${decision === 'reject' ? 'reject' : outcome}`, `Forecast recommendation ${materialId} @ ${warehouseId}`, { group: r.group, strategyGroup: r.strategyGroup, values: r.values, previous: r.current, strategy: `${str(r.currentStrategy)} → ${str(r.recommendedStrategy)}`, impact: r.impact, runId: r.runId, reason: decision === 'reject' ? reason : undefined, bulk: keys.length > 1 });
                    results.push({ key, outcome, detail });
                } catch (e) {
                    results.push({ key, outcome: 'skipped', detail: e instanceof Error ? e.message : 'Failed' });
                }
            }
            return { results, applied: results.filter((x) => x.outcome === 'applied').length, routed: results.filter((x) => x.outcome === 'routed').length, rejected: results.filter((x) => x.outcome === 'rejected').length, skipped: results.filter((x) => x.outcome === 'skipped').length };
        }),
    ],

    // Single material: is it activated, and its open recommendation (for the Forecasting tab).
    'POST /api/org/inventory/forecast/activation': [
        orgRoute('org.inventory.forecast.activation', 'INV.view', async (ctx) => {
            const materialId = str(ctx.body.materialId), warehouseId = str(ctx.body.warehouseId);
            if (!ID.test(materialId)) throw new HttpError(400, 'Choose a material');
            const activated = await materialActivated(ctx.orgId, materialId);
            let recommendation: Obj | null = null;
            if (activated && ID.test(warehouseId)) {
                const filter = await warehouseFilter(ctx, 'read');
                if (filter(warehouseId)) {
                    const d = await getDoc(recPath(ctx.orgId, materialId, warehouseId));
                    if (d && str(d.data.status) === 'open') recommendation = { id: `${materialId}_${warehouseId}`, ...d.data };
                }
            }
            return { activated, recommendation, canDecide: holdsAnywhere(ctx, [FC.approve]) };
        }),
    ],

    // Re-evaluate one material now (from its Forecasting tab).
    'POST /api/org/inventory/forecast/recommendation/refresh': [
        orgRoute('org.inventory.forecast.recommendation.refresh', 'INV.forecast.edit', async (ctx) => {
            const materialId = str(ctx.body.materialId), warehouseId = str(ctx.body.warehouseId);
            if (!ID.test(materialId) || !ID.test(warehouseId)) throw new HttpError(400, 'Choose a material and warehouse');
            await requireAt(ctx, [FC.edit], warehouseId, 'write', 'Forecast permission is required for this warehouse.');
            const { setup, version } = await getForecastSetup(ctx.orgId);
            if (!(await materialActivated(ctx.orgId, materialId, setup))) throw new HttpError(409, 'This material category is not activated for forecasting.');
            const rec = await evaluateMaterial(ctx.orgId, materialId, warehouseId, { runId: 'S' + nowIso().replace(/[^0-9]/g, '').slice(0, 14), by: ctx.uid, trigger: 'mass' }, { setup, setupVersion: version });
            await audited(ctx, 'inventory.forecast.recommendation.refresh', `Forecast ${materialId} @ ${warehouseId}`, { group: rec.group, strategyGroup: rec.strategyGroup });
            return { recommendation: { id: `${materialId}_${warehouseId}`, ...rec } };
        }),
    ],
};
