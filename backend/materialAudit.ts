// ---------------------------------------------------------------------------
// Material audit, change control and level change log (INV).
//
//   organizations/{org}/inventory_setup/change_control      whether Stock Control, Replenishment and Procurement
//                                                            Information may be changed by hand (versioned, reasons)
//   organizations/{org}/material_audits/{m}_{wh}_{day}      one audit report per material, warehouse and day (trend)
//   organizations/{org}/inventory_level_changes/{id}        every accepted change of minimum, maximum, reorder quantity,
//                                                            safety stock or reorder point, with its stock-holding impact
//
// The audit works the forecast out in the background from the real journal and the saved forecast inputs, reads the
// criticality analysis, the stock, the open supply and the stock take adjustments, and reports what has not been done,
// what is out of line, and the risk and opportunity in the stock held. Running it saves (replaces) the day's report.
// ---------------------------------------------------------------------------

import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc, type Doc } from './core';
import { allowedNodeIds } from './positions';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { audited, holdsAnywhere } from './scopeGuard';
import { AUTOMATED_METHODS, methodOf } from './replenishmentPlan';
import { auditMaterial, levelImpact, type Levels } from './materialAuditModel';
import { LEVEL_FIELDS, effectiveSource, historyMonthsOf } from './forecastModel';
import { getCriticalitySetup } from './criticality';
import { onDemand as belowCutoff } from './criticalityModel';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
const controlPath = (orgId: string) => `${root(orgId)}/inventory_setup/change_control`;
const infoPath = (orgId: string, m: string, wh: string) => `${root(orgId)}/inventory_material_info/${m}_${wh}`;
export const AUDIT = { view: 'INV.audit.view', controls: 'INV.controls.setup' };
export const ADJUSTMENT_TYPES = ['STOCK_TAKE_ADJUSTMENT', 'ST_ADJ', 'INV_RECON', 'STOCK_ADJUSTMENT'];

// ----- Change control -----

export type ControlArea = 'stockControl' | 'replenishment' | 'procurement';
export interface ChangeControl {
    manual: Record<ControlArea, boolean>;
    tolerancePct: number;
}
const AREA_LABEL: Record<ControlArea, string> = { stockControl: 'Stock Control', replenishment: 'Replenishment', procurement: 'Procurement Information' };
export const defaultControl = (): ChangeControl => ({ manual: { stockControl: true, replenishment: true, procurement: true }, tolerancePct: 25 });

export function readControl(v: unknown): ChangeControl {
    if (!isObj(v) || !isObj(v.manual)) throw new Error('Change control required');
    const m = v.manual;
    const tol = Number(v.tolerancePct ?? 25);
    if (!Number.isFinite(tol) || tol < 1 || tol > 200) throw new Error('Tolerance must be 1 to 200%');
    return { manual: { stockControl: m.stockControl !== false, replenishment: m.replenishment !== false, procurement: m.procurement !== false }, tolerancePct: Math.round(tol * 10) / 10 };
}

export async function getChangeControl(orgId: string) {
    const doc = await getDoc(controlPath(orgId));
    if (!doc) return { control: defaultControl(), version: 0, saved: null as Obj | null };
    try {
        return { control: readControl(doc.data.control), version: Number(doc.data.version) || 0, saved: doc.data };
    } catch {
        return { control: defaultControl(), version: Number(doc.data.version) || 0, saved: doc.data };
    }
}

/**
 * The message refusing a manual change, or '' when it is allowed. `section` is the update route's section; `keys` are
 * the fields being changed. Stock Control = stock dimensions and the strategy; Replenishment = the strategy parameters.
 */
export async function manualChangeBlocked(orgId: string, section: string, keys: string[], groups: { stockControl: string[]; replenishment: string[] }): Promise<string> {
    if (!keys.length) return '';
    const { control } = await getChangeControl(orgId);
    const blocked: ControlArea[] = [];
    if (section === 'procurement' && !control.manual.procurement) blocked.push('procurement');
    if (section === 'inventory') {
        if (!control.manual.stockControl && keys.some((k) => groups.stockControl.includes(k))) blocked.push('stockControl');
        if (!control.manual.replenishment && keys.some((k) => groups.replenishment.includes(k))) blocked.push('replenishment');
    }
    if (!blocked.length) return '';
    return `Manual changes to ${blocked.map((a) => AREA_LABEL[a]).join(' and ')} are switched off in Inventory › Setup › Change control.`;
}

// ----- Level change log -----

const levelsOf = (x: Obj | null | undefined): Levels => Object.fromEntries(LEVEL_FIELDS.map((k) => [k, x?.[k] === '' || x?.[k] === undefined || x?.[k] === null ? null : Number(x[k])])) as unknown as Levels;

/**
 * Records an accepted change of the stock levels with its impact on stock holding (average stock, maximum stock value,
 * holding cost, cover, excess or order now). Never blocks the change: a failure here is logged and skipped.
 */
export async function logLevelChange(orgId: string, materialId: string, warehouseId: string, before: Obj | null, after: Obj, meta: { source: 'forecast' | 'manual'; by: string; simulated?: boolean; proposalAt?: string; method?: string }) {
    try {
        const b = levelsOf(before);
        const a = levelsOf({ ...(before ?? {}), ...after });
        if (LEVEL_FIELDS.every((k) => b[k] === a[k])) return null;
        const [{ stockValOf }, repl, fc, { getForecastSetup, journalInstances }] = await Promise.all([import('./finCore'), import('./replenishment'), import('./forecastModel'), import('./forecasting')]);
        const [val, pos, supply, setup, instances] = await Promise.all([
            stockValOf(orgId, warehouseId, materialId).catch(() => null),
            repl.stockPosition(orgId, warehouseId, materialId, 365).catch(() => null),
            repl.supplyIndex(orgId).catch(() => null),
            getForecastSetup(orgId),
            journalInstances(orgId, materialId, warehouseId),
        ]);
        const months = fc.monthlyHistory(instances, new Set(), fc.monthOf(nowIso()), 13).filter((r) => !r.partial);
        const demandPerMonth = months.length ? months.reduce((s, r) => s + r.demand, 0) / months.length : 0;
        const unitCost = val && val.avg > 0 ? val.avg : 0;
        const impact = levelImpact(b, a, { available: Math.max(0, pos?.available ?? 0), openSupply: supply?.get(repl.keyOf(materialId, warehouseId))?.qty ?? 0, demandPerMonth, unitCost, holdingPct: setup.setup.holdingPct });
        const at = nowIso();
        const id = `${materialId}_${warehouseId}_${Date.now()}`;
        await writeDoc(`${root(orgId)}/inventory_level_changes/${id}`, { materialId, warehouseId, source: meta.source, simulated: meta.simulated === true, method: meta.method ?? '', before: b, after: a, impact, unitCost, demandPerMonth: Math.round(demandPerMonth * 1000) / 1000, at, by: meta.by, proposalAt: meta.proposalAt ?? '' } as never, { exists: false });
        return impact;
    } catch {
        return null;
    }
}

// ----- Audit -----

function canView(ctx: OrgContext) {
    if (ctx.role === 'org_super_admin') return;
    if (![AUDIT.view, 'INV.view'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Inventory access required');
}
async function visible(ctx: OrgContext) {
    return ctx.role === 'org_super_admin' ? ('all' as const) : await allowedNodeIds(ctx.orgId, ctx.me, true);
}
function ids(b: Obj) {
    const materialId = str(b.materialId);
    const warehouseId = str(b.warehouseId);
    if (!ID.test(materialId) || !ID.test(warehouseId)) throw new HttpError(400, 'Choose a material and warehouse');
    return { materialId, warehouseId };
}

/** Works the audit out for one material in one warehouse (forecast in the background). */
export async function runAudit(orgId: string, materialId: string, warehouseId: string) {
    const fc = await import('./forecasting');
    const [{ setup }, instances, fdoc, crit, control, journal, assessment, material] = await Promise.all([
        fc.getForecastSetup(orgId),
        fc.journalInstances(orgId, materialId, warehouseId),
        getDoc(`${root(orgId)}/material_forecasts/${materialId}_${warehouseId}`),
        getCriticalitySetup(orgId),
        getChangeControl(orgId),
        runQuery({ from: [{ collectionId: 'material_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId)),
        getDoc(`${root(orgId)}/criticality_assessments/${materialId}_${warehouseId}`),
        getDoc(`${root(orgId)}/materials/${materialId}`),
    ]);
    if (!material) throw new HttpError(404, 'Material not found');
    const m = await fc.materialInputs(orgId, materialId, warehouseId, setup);
    const f = fdoc?.data ?? {};
    const now = nowIso();
    const masked = new Set(fc.maskedIds(f));
    const historyMonths = historyMonthsOf(instances, masked, now);
    const src = effectiveSource(setup, m.info, historyMonths);
    const result = fc.forecastFor(setup, instances, f, m, now);
    const info = m.info;
    const strategy = str(info.replenishmentStrategy);
    const method = methodOf(info.replenishmentStrategy, info.stockingPolicy);
    const cell = str(info.criticalityCell);
    const approved = assessment && (str(assessment.data.status) === 'approved' || isObj(assessment.data.approved));
    const adjustments = journal
        .filter((d) => str(d.data.status) === 'posted' && ADJUSTMENT_TYPES.includes(str(d.data.type).toUpperCase()))
        .map((d) => ({ at: str(d.data.postedAt) || str(d.data.createdAt), qty: Number(isObj(d.data.balancesDelta) ? d.data.balancesDelta.physicalStock : 0) || 0, reference: str(d.data.reference) }))
        .filter((x) => x.qty !== 0);
    const yearAgo = Date.now() - 365 * 86_400_000;
    const issues = instances.filter((x) => x.kind === 'issue');
    const annualIssues = issues.filter((x) => Date.parse(x.at) >= yearAgo).reduce((s, x) => s + x.qty, 0) - instances.filter((x) => x.kind === 'reversal' && Date.parse(x.at) >= yearAgo).reduce((s, x) => s + x.qty, 0);
    const rec = result.levels.onDemand ? null : (Object.fromEntries(LEVEL_FIELDS.map((k) => [k, result.levels[k]])) as unknown as Levels);
    const report = auditMaterial({
        now,
        strategy,
        automated: AUTOMATED_METHODS.includes(method),
        strategySource: str(info.strategySource) || 'manual',
        levels: levelsOf(info),
        criticality: { assessed: !!approved && !!cell, status: str(assessment?.data.status), cell, cls: str(info.criticalityClass), reviewDue: str(info.criticalityReviewDue), strategyMode: crit.setup.strategyMode, cutoff: crit.setup.cutoff, onDemandCell: /^[ABCD][1-4]$/.test(cell) && belowCutoff(cell, crit.setup.cutoff) },
        forecast: {
            levelSource: src.source,
            levelMode: setup.levelMode,
            appliedAt: str(info.forecastAppliedAt),
            appliedSimulated: info.forecastSimulated === true,
            historyMonths,
            minHistoryMonths: setup.minHistoryMonths,
            demandPerMonth: result.levels.demandPerMonth,
            recommended: rec,
            trend: result.trend.direction,
            leadDays: result.levels.leadDays,
            leadSource: m.lead.externalSource,
            onDemand: !!m.onDemand,
        },
        stock: { physical: m.stock?.physical ?? 0, available: m.stock?.available ?? 0, openSupply: m.stock?.openSupply ?? 0 },
        unitCost: m.unitCost,
        holdingPct: setup.holdingPct,
        adjustments,
        lastIssueAt: issues.at(-1)?.at ?? '',
        annualIssues: Math.max(0, annualIssues),
        tolerancePct: control.control.tolerancePct,
    });
    return {
        report,
        context: {
            materialNumber: str(material.data.materialNumber) || materialId,
            description: str(material.data.shortText) || str(material.data.name),
            strategy,
            cell,
            levelSource: src.source,
            levelMode: setup.levelMode,
            method: result.method,
            trend: result.trend.direction,
            leadDays: result.levels.leadDays,
            serviceLevel: result.levels.serviceLevel,
            current: levelsOf(info),
            recommended: rec,
            tolerancePct: control.control.tolerancePct,
        },
    };
}

function trendRow(d: Doc) {
    const r = isObj(d.data.report) ? d.data.report : {};
    const h = isObj(r.holding) ? r.holding : {};
    const c = isObj(r.counts) ? r.counts : {};
    return { day: str(d.data.day), at: str(d.data.at), score: Number(r.score) || 0, excessValue: Number(h.excessValue) || 0, riskValue: Number(h.riskValue) || 0, stockValue: Number(h.stockValue) || 0, high: Number(c.high) || 0, medium: Number(c.medium) || 0, low: Number(c.low) || 0 };
}

async function historyOf(orgId: string, materialId: string, warehouseId: string) {
    const [audits, changes] = await Promise.all([
        runQuery({ from: [{ collectionId: 'material_audits' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId)),
        runQuery({ from: [{ collectionId: 'inventory_level_changes' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId)),
    ]);
    return {
        trend: audits.map(trendRow).sort((a, b) => a.day.localeCompare(b.day)).slice(-60),
        levelChanges: changes.map((c) => ({ id: c.id, ...c.data })).sort((a, b) => str((b as Obj).at).localeCompare(str((a as Obj).at))).slice(0, 30),
    };
}

export const materialAuditRoutes = {
    'POST /api/org/inventory/controls/get': [
        orgRoute('org.inventory.controls.get', 'INV.view', async (ctx) => {
            const { control, version, saved } = await getChangeControl(ctx.orgId);
            return { control, version, updatedAt: str(saved?.updatedAt), reason: str(saved?.reason), history: Array.isArray(saved?.history) ? (saved!.history as unknown[]).slice(0, 20) : [], canEdit: holdsAnywhere(ctx, [AUDIT.controls]) };
        }),
    ],

    'POST /api/org/inventory/controls/save': [
        orgRoute('org.inventory.controls.save', 'INV.controls.setup', async (ctx) => {
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for the change');
            let control: ChangeControl;
            try {
                control = readControl(ctx.body.control);
            } catch (e) {
                throw new HttpError(400, e instanceof Error ? e.message : 'Invalid change control');
            }
            const current = await getChangeControl(ctx.orgId);
            if (Number(ctx.body.version ?? current.version) !== current.version) throw new HttpError(409, 'Someone else changed the setup; reopen it and try again.');
            const now = nowIso();
            const history = [{ version: current.version, control: current.control, at: str(current.saved?.updatedAt), by: str(current.saved?.updatedBy), reason: str(current.saved?.reason) }, ...(Array.isArray(current.saved?.history) ? (current.saved!.history as unknown[]) : [])].slice(0, 20);
            await writeDoc(controlPath(ctx.orgId), { control, version: current.version + 1, updatedAt: now, updatedBy: ctx.uid, reason: reason.slice(0, 500), history } as never);
            await audited(ctx, 'inventory.controls.save', 'Change control', { version: current.version + 1, reason, manual: control.manual, tolerancePct: control.tolerancePct });
            return { ok: true, version: current.version + 1 };
        }),
    ],

    'POST /api/org/inventory/audit/run': [
        orgRoute('org.inventory.audit.run', 'INV.audit.view', async (ctx) => {
            canView(ctx);
            const { materialId, warehouseId } = ids(ctx.body);
            const allowed = await visible(ctx);
            if (allowed !== 'all' && !allowed.has(warehouseId)) throw new HttpError(404, 'Warehouse not found');
            const { report, context } = await runAudit(ctx.orgId, materialId, warehouseId);
            const at = nowIso();
            const day = at.slice(0, 10);
            // One saved report per material, warehouse and day: running again the same day replaces it.
            await writeDoc(`${root(ctx.orgId)}/material_audits/${materialId}_${warehouseId}_${day}`, { materialId, warehouseId, day, at, by: ctx.uid, report, context } as never);
            await audited(ctx, 'inventory.audit.run', `Material audit ${context.materialNumber} @ ${warehouseId}`, { score: report.score, high: report.counts.high, medium: report.counts.medium, low: report.counts.low, excessValue: report.holding.excessValue, riskValue: report.holding.riskValue });
            return { report, context, at, ...(await historyOf(ctx.orgId, materialId, warehouseId)) };
        }),
    ],

    'POST /api/org/inventory/audit/register': [
        orgRoute('org.inventory.audit.register', 'INV.audit.view', async (ctx) => {
            canView(ctx);
            const allowed = await visible(ctx);
            const [audits, whs] = await Promise.all([listDocs(`${root(ctx.orgId)}/material_audits`), listDocs(`${root(ctx.orgId)}/warehouses`)]);
            const wm = new Map(whs.map((w) => [w.id, str(w.data.name) || w.id]));
            const mine = audits.filter((a) => allowed === 'all' || allowed.has(str(a.data.warehouseId)));
            const latest = new Map<string, Doc>();
            for (const a of mine) {
                const k = `${str(a.data.materialId)}_${str(a.data.warehouseId)}`;
                if (!latest.has(k) || str(latest.get(k)!.data.day) < str(a.data.day)) latest.set(k, a);
            }
            const rows = [...latest.values()].map((a) => {
                const r = isObj(a.data.report) ? a.data.report : {};
                const c = isObj(a.data.context) ? a.data.context : {};
                const h = isObj(r.holding) ? r.holding : {};
                const done = isObj(r.done) ? r.done : {};
                const counts = isObj(r.counts) ? r.counts : {};
                return {
                    id: a.id,
                    materialId: str(a.data.materialId),
                    warehouseId: str(a.data.warehouseId),
                    materialNumber: str(c.materialNumber),
                    description: str(c.description),
                    warehouse: wm.get(str(a.data.warehouseId)) || str(a.data.warehouseId),
                    day: str(a.data.day),
                    score: Number(r.score) || 0,
                    rating: str(r.rating),
                    high: Number(counts.high) || 0,
                    medium: Number(counts.medium) || 0,
                    stockValue: Number(h.stockValue) || 0,
                    excessValue: Number(h.excessValue) || 0,
                    riskValue: Number(h.riskValue) || 0,
                    criticality: done.criticality === true,
                    forecast: done.forecast === true,
                    strategyAligned: done.strategyAligned === true,
                    levelsAligned: done.levelsAligned === true,
                    cell: str(c.cell),
                    strategy: str(c.strategy),
                };
            });
            // Organization trend: for each day, the latest report of every material up to that day.
            const days = [...new Set(mine.map((a) => str(a.data.day)))].sort().slice(-90);
            const byMat = new Map<string, Array<ReturnType<typeof trendRow>>>();
            for (const a of mine) {
                const k = `${str(a.data.materialId)}_${str(a.data.warehouseId)}`;
                byMat.set(k, [...(byMat.get(k) ?? []), trendRow(a)]);
            }
            for (const list of byMat.values()) list.sort((x, y) => x.day.localeCompare(y.day));
            const trend = days.map((day) => {
                let excess = 0;
                let risk = 0;
                let score = 0;
                let n = 0;
                for (const list of byMat.values()) {
                    const last = [...list].reverse().find((x) => x.day <= day);
                    if (!last) continue;
                    excess += last.excessValue;
                    risk += last.riskValue;
                    score += last.score;
                    n++;
                }
                return { day, excessValue: Math.round(excess * 100) / 100, riskValue: Math.round(risk * 100) / 100, score: n ? Math.round(score / n) : 0, materials: n };
            });
            const changes = (await listDocs(`${root(ctx.orgId)}/inventory_level_changes`)).filter((c) => allowed === 'all' || allowed.has(str(c.data.warehouseId)));
            const impact = changes.reduce((s, c) => s + (isObj(c.data.impact) ? Number(c.data.impact.averageValueChange) || 0 : 0), 0);
            return { rows, trend, levelChanges: { count: changes.length, averageValueChange: Math.round(impact * 100) / 100 } };
        }),
    ],
};
