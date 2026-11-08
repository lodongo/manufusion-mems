// ---------------------------------------------------------------------------
// Material criticality analysis (INV): setup, assessments, approval and their effect on the procurement strategy.
//
//   organizations/{org}/inventory_setup/criticality                 the setup (versioned, every change with a reason)
//   organizations/{org}/criticality_assessments/{material}_{wh}     the assessment of a material in a warehouse
//
// Workflow: draft → submitted → approved (or returned). The assessor and the approver are different people
// (INV.criticality.assess / INV.criticality.approve at the warehouse; test mode bypass is audited). Approval writes the
// result to the material's inventory information: criticality class A–D, movement 1–4 and the grid cell.
//
// Procurement strategy: with setup "dependent on criticality analysis", an approved material at or below the cutoff
// cell is set to RP07 Direct purchase (bought on demand, never replenished automatically) and the strategy is locked
// while that holds; above the cutoff the planner's previous strategy is restored. Without an approved assessment the
// strategy is always manual. RP07 never starts automatic replenishment, whoever set it.
// ---------------------------------------------------------------------------

import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc, type Doc } from './core';
import { allowedNodeIds } from './positions';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { allowedAt, audited, requireAt, holdsAnywhere } from './scopeGuard';
import { bypass } from './testModeCore';
import { CONSUMPTION_TYPES, RETURN_TYPES } from './replenishmentPlan';
import { FACTORS, FACTOR_BY_CODE, MOVEMENT_LABELS, ON_DEMAND_STRATEGY, defaultSetup, isCell, movementFromData, onDemand, readSetup, scoreCriticality, type CriticalitySetup } from './criticalityModel';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
const setupPath = (orgId: string) => `${root(orgId)}/inventory_setup/criticality`;
const assessmentPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/criticality_assessments/${materialId}_${warehouseId}`;
const infoPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`;

export const CRIT = { view: 'INV.criticality.view', assess: 'INV.criticality.assess', approve: 'INV.criticality.approve', setup: 'INV.criticality.setup' };

/** The setup in force (defaults until it is first saved). */
export async function getCriticalitySetup(orgId: string): Promise<{ setup: CriticalitySetup; version: number; saved: Obj | null }> {
    const doc = await getDoc(setupPath(orgId));
    if (!doc) return { setup: defaultSetup(), version: 0, saved: null };
    try {
        return { setup: readSetup(doc.data.setup), version: Number(doc.data.version) || 0, saved: doc.data };
    } catch {
        return { setup: defaultSetup(), version: Number(doc.data.version) || 0, saved: doc.data };
    }
}

/**
 * Whether the procurement strategy of a material is locked by the criticality analysis: only when the setup makes the
 * strategy depend on it and an approved assessment put the material at or below the cutoff.
 */
export async function strategyLockedByCriticality(orgId: string, info: Obj | undefined): Promise<string> {
    if (!info || str(info.strategySource) !== 'criticality') return '';
    const { setup } = await getCriticalitySetup(orgId);
    if (setup.strategyMode !== 'criticality') return '';
    return `The procurement strategy is set by the criticality analysis (cell ${str(info.criticalityCell)} is at or below the cutoff ${setup.cutoff}, so it is bought on demand: ${ON_DEMAND_STRATEGY}). Change the assessment or the criticality setup instead.`;
}

async function warehouses(ctx: OrgContext, mode: 'read' | 'write') {
    const allowed = ctx.role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, mode === 'read');
    return (await listDocs(`${root(ctx.orgId)}/warehouses`)).filter((w) => allowed === 'all' || allowed.has(w.id));
}

function canView(ctx: OrgContext) {
    if (ctx.role === 'org_super_admin') return;
    if (![CRIT.view, CRIT.assess, CRIT.approve, CRIT.setup, 'INV.view', 'INV.edit'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Inventory access required');
}

function ids(b: Obj) {
    const materialId = str(b.materialId);
    const warehouseId = str(b.warehouseId);
    if (!ID.test(materialId) || !ID.test(warehouseId)) throw new HttpError(400, 'Choose a material and warehouse');
    return { materialId, warehouseId };
}

/** Consumption per month for the last twelve months (oldest first) and how many months of issue history exist. */
export async function movementData(orgId: string, materialId: string, warehouseId: string) {
    const docs = (await runQuery({ from: [{ collectionId: 'material_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId))).filter((d) => str(d.data.status) === 'posted');
    const now = new Date();
    const months: Array<{ month: string; quantity: number }> = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        months.push({ month: d.toISOString().slice(0, 7), quantity: 0 });
    }
    const index = new Map(months.map((m, i) => [m.month, i]));
    let firstIssue = Infinity;
    for (const d of docs) {
        const at = Date.parse(str(d.data.postedAt) || str(d.data.createdAt));
        if (!Number.isFinite(at)) continue;
        const type = str(d.data.type).toUpperCase();
        const q = Number(isObj(d.data.balancesDelta) ? d.data.balancesDelta.physicalStock : 0) || 0;
        const i = index.get(new Date(at).toISOString().slice(0, 7));
        if (CONSUMPTION_TYPES.includes(type) && q < 0) {
            firstIssue = Math.min(firstIssue, at);
            if (i !== undefined) months[i].quantity += -q;
        }
        if (RETURN_TYPES.includes(type) && q > 0 && i !== undefined) months[i].quantity -= q;
    }
    for (const m of months) m.quantity = Math.max(0, Math.round(m.quantity * 1000) / 1000);
    // Issue history: months since the first issue (no issue at all means no history to judge from).
    const historyMonths = Number.isFinite(firstIssue) ? Math.floor((Date.now() - firstIssue) / (30.44 * 86_400_000)) : 0;
    return { months, historyMonths };
}

/** Works out an assessment from the setup, the ratings and the movement. */
function evaluate(setup: CriticalitySetup, ratings: Record<string, number>, movement: ReturnType<typeof movementFromData>, manual: { level: number | null; reason: string }) {
    const crit = scoreCriticality(setup, ratings);
    const movementLevel = movement.level ?? manual.level;
    const movementSource = movement.level ? (manual.level && manual.level !== movement.level ? 'override' : 'data') : 'manual';
    const level = movementSource === 'override' ? manual.level : movementLevel;
    const cell = level ? `${crit.criticalityClass}${level}` : '';
    return { ...crit, movementLevel: level, movementSource, cell, onDemand: cell ? onDemand(cell, setup.cutoff) : false };
}

function readRatings(v: unknown, setup: CriticalitySetup) {
    const out: Record<string, number> = {};
    if (!isObj(v)) return out;
    for (const [k, r] of Object.entries(v)) {
        if (!FACTOR_BY_CODE.has(k) || !setup.factors[k]?.enabled) continue;
        const n = Number(r);
        if (![1, 2, 3].includes(n)) throw new HttpError(400, `Rate ${FACTOR_BY_CODE.get(k)!.name} 1, 2 or 3`);
        out[k] = n;
    }
    return out;
}

/** Applies an approved assessment to the material's inventory information, including the procurement strategy rule. */
async function applyResult(orgId: string, materialId: string, warehouseId: string, a: Obj, setup: CriticalitySetup, by: string) {
    const path = infoPath(orgId, materialId, warehouseId);
    const info = (await getDoc(path))?.data ?? {};
    const cell = str(a.cell);
    const reviewDue = new Date(Date.now() + setup.reviewMonths * 30.44 * 86_400_000).toISOString().slice(0, 10);
    const patch: Obj = {
        criticalityClass: str(a.criticalityClass),
        movementClass: Number(a.movementLevel) || null,
        criticalityCell: cell,
        criticalityAssessedAt: nowIso(),
        criticalityReviewDue: reviewDue,
    };
    let strategyChange = '';
    if (setup.strategyMode === 'criticality' && cell) {
        if (onDemand(cell, setup.cutoff)) {
            if (str(info.replenishmentStrategy) !== ON_DEMAND_STRATEGY || str(info.strategySource) !== 'criticality') {
                patch.strategyBeforeCriticality = str(info.strategySource) === 'criticality' ? str(info.strategyBeforeCriticality) : str(info.replenishmentStrategy);
                strategyChange = `${str(info.replenishmentStrategy) || 'none'} → ${ON_DEMAND_STRATEGY}`;
            }
            patch.replenishmentStrategy = ON_DEMAND_STRATEGY;
            patch.stockingPolicy = ON_DEMAND_STRATEGY;
            patch.strategySource = 'criticality';
        } else if (str(info.strategySource) === 'criticality') {
            // Above the cutoff again: the planner's earlier strategy comes back and the strategy is manual.
            const back = str(info.strategyBeforeCriticality);
            patch.replenishmentStrategy = back;
            patch.stockingPolicy = back;
            patch.strategySource = 'manual';
            patch.strategyBeforeCriticality = '';
            strategyChange = `${ON_DEMAND_STRATEGY} → ${back || 'not set'}`;
        }
    }
    await writeDoc(path, { ...info, ...patch, updatedAt: nowIso(), updatedBy: by } as never);
    return strategyChange;
}

function publicSetup(setup: CriticalitySetup, version: number, saved: Obj | null) {
    return {
        setup,
        version,
        updatedAt: str(saved?.updatedAt),
        updatedBy: str(saved?.updatedByName) || str(saved?.updatedBy),
        reason: str(saved?.reason),
        history: Array.isArray(saved?.history) ? (saved!.history as unknown[]).slice(0, 20) : [],
        factors: FACTORS,
        movementLabels: MOVEMENT_LABELS,
        onDemandStrategy: ON_DEMAND_STRATEGY,
    };
}

export const criticalityRoutes = {
    'POST /api/org/inventory/criticality/setup/get': [
        orgRoute('org.inventory.criticality.setup.get', 'INV.criticality.view', async (ctx) => {
            canView(ctx);
            const { setup, version, saved } = await getCriticalitySetup(ctx.orgId);
            return { ...publicSetup(setup, version, saved), canEdit: ctx.role === 'org_super_admin' || holdsAnywhere(ctx, [CRIT.setup]) };
        }),
    ],

    'POST /api/org/inventory/criticality/setup/save': [
        orgRoute('org.inventory.criticality.setup.save', 'INV.criticality.setup', async (ctx) => {
            if (ctx.role !== 'org_super_admin' && !holdsAnywhere(ctx, [CRIT.setup])) throw new HttpError(403, 'Criticality setup permission required');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for the change');
            let setup: CriticalitySetup;
            try {
                setup = readSetup(ctx.body.setup);
            } catch (e) {
                throw new HttpError(400, e instanceof Error ? e.message : 'Invalid setup');
            }
            const current = await getCriticalitySetup(ctx.orgId);
            if (Number(ctx.body.version ?? current.version) !== current.version) throw new HttpError(409, 'Someone else changed the setup; reopen it and try again.');
            const now = nowIso();
            const history = [{ version: current.version, setup: current.setup, at: str(current.saved?.updatedAt), by: str(current.saved?.updatedBy), reason: str(current.saved?.reason) }, ...(Array.isArray(current.saved?.history) ? (current.saved!.history as unknown[]) : [])].slice(0, 20);
            await writeDoc(setupPath(ctx.orgId), { setup, version: current.version + 1, updatedAt: now, updatedBy: ctx.uid, reason: reason.slice(0, 500), history } as never);
            // The strategy rule follows the setup: approved assessments are applied again under the new cutoff and mode.
            let changed = 0;
            if (current.setup.strategyMode !== setup.strategyMode || current.setup.cutoff !== setup.cutoff) {
                for (const a of await listDocs(`${root(ctx.orgId)}/criticality_assessments`)) {
                    if (str(a.data.status) !== 'approved' || !isCell(a.data.cell)) continue;
                    const info = (await getDoc(infoPath(ctx.orgId, str(a.data.materialId), str(a.data.warehouseId))))?.data;
                    if (setup.strategyMode === 'manual') {
                        // Back to manual: the strategy stays as it is but is no longer locked.
                        if (info && str(info.strategySource) === 'criticality') {
                            await writeDoc(infoPath(ctx.orgId, str(a.data.materialId), str(a.data.warehouseId)), { ...info, strategySource: 'manual', updatedAt: now } as never);
                            changed++;
                        }
                        continue;
                    }
                    if (await applyResult(ctx.orgId, str(a.data.materialId), str(a.data.warehouseId), a.data, setup, ctx.uid)) changed++;
                }
            }
            await audited(ctx, 'inventory.criticality.setup.save', 'Criticality setup', { version: current.version + 1, reason, strategyMode: setup.strategyMode, cutoff: setup.cutoff, factors: Object.entries(setup.factors).filter(([, v]) => v.enabled).map(([k, v]) => `${k}×${v.weight}`).join(','), strategiesChanged: changed });
            return { ok: true, version: current.version + 1, strategiesChanged: changed };
        }),
    ],

    'POST /api/org/inventory/criticality/get': [
        orgRoute('org.inventory.criticality.get', 'INV.criticality.view', async (ctx) => {
            canView(ctx);
            const { materialId, warehouseId } = ids(ctx.body);
            if (!(await warehouses(ctx, 'read')).some((w) => w.id === warehouseId)) throw new HttpError(404, 'Warehouse not found');
            const [{ setup, version }, doc, data, info] = await Promise.all([
                getCriticalitySetup(ctx.orgId),
                getDoc(assessmentPath(ctx.orgId, materialId, warehouseId)),
                movementData(ctx.orgId, materialId, warehouseId),
                getDoc(infoPath(ctx.orgId, materialId, warehouseId)),
            ]);
            const movement = movementFromData(setup, data);
            const a = doc?.data ?? null;
            const assessedBy = str(a?.submittedBy) || str(a?.createdBy);
            const [canAssess, canApprove] = await Promise.all([allowedAt(ctx, [CRIT.assess], warehouseId, 'write'), allowedAt(ctx, [CRIT.approve], warehouseId, 'write')]);
            return {
                setup,
                setupVersion: version,
                factors: FACTORS,
                movementLabels: MOVEMENT_LABELS,
                onDemandStrategy: ON_DEMAND_STRATEGY,
                movementData: data,
                movement,
                assessment: a,
                current: { criticalityClass: str(info?.data.criticalityClass), movementClass: Number(info?.data.movementClass) || null, cell: str(info?.data.criticalityCell), reviewDue: str(info?.data.criticalityReviewDue), strategy: str(info?.data.replenishmentStrategy), strategySource: str(info?.data.strategySource) || 'manual' },
                leadTimeDays: Number(info?.data.leadTimeDays) || null,
                can: { assess: canAssess, approve: canApprove && (assessedBy !== ctx.uid || ctx.testMode === true) },
                you: { assessed: assessedBy === ctx.uid, testMode: ctx.testMode === true },
            };
        }),
    ],

    'POST /api/org/inventory/criticality/save': [
        orgRoute('org.inventory.criticality.save', 'INV.criticality.assess', async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            await requireAt(ctx, [CRIT.assess], warehouseId, 'write', 'Criticality assessment permission is required for this warehouse.');
            if (!(await getDoc(`${root(ctx.orgId)}/materials/${materialId}`))) throw new HttpError(404, 'Material not found');
            const path = assessmentPath(ctx.orgId, materialId, warehouseId);
            const existing = await getDoc(path);
            if (existing && str(existing.data.status) === 'submitted') throw new HttpError(409, 'This assessment is waiting for approval; it cannot be changed now.');
            const { setup, version } = await getCriticalitySetup(ctx.orgId);
            const ratings = readRatings(ctx.body.ratings, setup);
            const data = await movementData(ctx.orgId, materialId, warehouseId);
            const movement = movementFromData(setup, data);
            const manualLevel = ctx.body.movementManual === null || ctx.body.movementManual === undefined || ctx.body.movementManual === '' ? null : Number(ctx.body.movementManual);
            if (manualLevel !== null && ![1, 2, 3, 4].includes(manualLevel)) throw new HttpError(400, 'Movement must be 1 to 4');
            const manualReason = str(ctx.body.movementReason).trim();
            if (manualLevel !== null && movement.level !== null && manualLevel !== movement.level && manualReason.length < 10)
                throw new HttpError(400, 'Give a reason of at least 10 characters for overriding the movement worked out from the issue history');
            const notes = str(ctx.body.notes).trim().slice(0, 1000);
            const result = evaluate(setup, ratings, movement, { level: manualLevel, reason: manualReason });
            const submit = ctx.body.submit === true;
            if (submit) {
                if (!result.complete) throw new HttpError(400, `Rate every declared factor before submitting (${result.missing.slice(0, 4).join(', ')}${result.missing.length > 4 ? ', …' : ''})`);
                if (!result.movementLevel) throw new HttpError(400, `There are less than ${setup.minHistoryMonths} months of issue history, so choose the movement (1 very slow to 4 very fast) by hand`);
                if (result.movementSource === 'manual' && manualReason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for the movement chosen by hand');
            }
            const now = nowIso();
            const prev = existing?.data ?? {};
            const doc = {
                materialId,
                warehouseId,
                status: submit ? 'submitted' : 'draft',
                ratings,
                movementManual: manualLevel,
                movementReason: manualReason.slice(0, 500),
                movementSnapshot: { ...movement, months: data.months, historyMonths: data.historyMonths },
                notes,
                ...result,
                setupVersion: version,
                createdAt: str(prev.createdAt) || now,
                createdBy: str(prev.createdBy) || ctx.uid,
                updatedAt: now,
                updatedBy: ctx.uid,
                ...(submit ? { submittedAt: now, submittedBy: ctx.uid } : {}),
                returnReason: '',
                // Earlier approved results stay visible until a new approval replaces them.
                approved: isObj(prev.approved) ? prev.approved : prev.status === 'approved' ? { cell: prev.cell, criticalityClass: prev.criticalityClass, movementLevel: prev.movementLevel, approvedAt: prev.approvedAt, approvedBy: prev.approvedBy } : null,
                history: Array.isArray(prev.history) ? prev.history : [],
            };
            await writeDoc(path, doc as never);
            await audited(ctx, submit ? 'inventory.criticality.submit' : 'inventory.criticality.save', `Criticality ${materialId} @ ${warehouseId}`, { cell: result.cell, score: result.score, scaled: result.scaled, override: result.overrideBy.join(', '), movementSource: result.movementSource });
            return { ok: true, status: doc.status, cell: result.cell };
        }),
    ],

    'POST /api/org/inventory/criticality/action': [
        orgRoute('org.inventory.criticality.action', 'INV.criticality.approve', async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            const action = str(ctx.body.action);
            if (!['approve', 'return'].includes(action)) throw new HttpError(400, 'Unsupported action');
            await requireAt(ctx, [CRIT.approve], warehouseId, 'write', 'Criticality approval permission is required for this warehouse.');
            const path = assessmentPath(ctx.orgId, materialId, warehouseId);
            const doc = await getDoc(path);
            if (!doc || str(doc.data.status) !== 'submitted') throw new HttpError(409, 'No assessment is waiting for approval');
            const d = doc.data;
            if ((str(d.submittedBy) === ctx.uid || str(d.createdBy) === ctx.uid) && !bypass(ctx, 'inv.criticality.approve_independence')) throw new HttpError(403, 'An assessment must be approved by someone other than the person who made it.');
            const now = nowIso();
            if (action === 'return') {
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters');
                await writeDoc(path, { ...d, status: 'returned', returnReason: reason.slice(0, 500), returnedAt: now, returnedBy: ctx.uid } as never);
                await audited(ctx, 'inventory.criticality.return', `Criticality ${materialId} @ ${warehouseId}`, { reason });
                return { ok: true };
            }
            const { setup, version } = await getCriticalitySetup(ctx.orgId);
            // The setup may have changed since submission: the result is worked out again under the setup in force.
            const movement = isObj(d.movementSnapshot) ? (d.movementSnapshot as ReturnType<typeof movementFromData>) : movementFromData(setup, { months: [], historyMonths: 0 });
            const result = evaluate(setup, (isObj(d.ratings) ? d.ratings : {}) as Record<string, number>, { ...movement, level: str(d.movementSource) === 'manual' ? null : movement.level }, { level: d.movementManual === null ? null : Number(d.movementManual), reason: str(d.movementReason) });
            if (!result.complete || !result.cell) throw new HttpError(409, 'The declared factors changed since this assessment was submitted; return it so that it can be completed.');
            const strategyChange = await applyResult(ctx.orgId, materialId, warehouseId, { ...d, ...result }, setup, ctx.uid);
            const history = [{ cell: str(d.cell), criticalityClass: str(d.criticalityClass), movementLevel: d.movementLevel, approvedAt: now, approvedBy: ctx.uid, submittedBy: str(d.submittedBy), setupVersion: version }, ...(Array.isArray(d.history) ? d.history : [])].slice(0, 20);
            await writeDoc(path, { ...d, ...result, status: 'approved', approvedAt: now, approvedBy: ctx.uid, setupVersion: version, approved: { cell: result.cell, criticalityClass: result.criticalityClass, movementLevel: result.movementLevel, approvedAt: now, approvedBy: ctx.uid }, strategyChange, history } as never);
            await audited(ctx, 'inventory.criticality.approve', `Criticality ${materialId} @ ${warehouseId}`, { cell: result.cell, onDemand: result.onDemand, strategyChange, setupVersion: version });
            return { ok: true, cell: result.cell, strategyChange };
        }),
    ],

    'POST /api/org/inventory/criticality/register': [
        orgRoute('org.inventory.criticality.register', 'INV.criticality.view', async (ctx) => {
            canView(ctx);
            const visible = new Set((await warehouses(ctx, 'read')).map((w) => w.id));
            const [assessments, materials, whs, { setup }] = await Promise.all([listDocs(`${root(ctx.orgId)}/criticality_assessments`), listDocs(`${root(ctx.orgId)}/materials`), listDocs(`${root(ctx.orgId)}/warehouses`), getCriticalitySetup(ctx.orgId)]);
            const mm = new Map(materials.map((m) => [m.id, m.data]));
            const wm = new Map(whs.map((w) => [w.id, str(w.data.name) || w.id]));
            const today = nowIso().slice(0, 10);
            const rows = assessments
                .filter((a: Doc) => visible.has(str(a.data.warehouseId)))
                .map((a: Doc) => {
                    const d = a.data;
                    const ap = isObj(d.approved) ? d.approved : null;
                    const cell = ap ? str(ap.cell) : '';
                    const reviewDue = ap ? new Date(Date.parse(str(ap.approvedAt)) + setup.reviewMonths * 30.44 * 86_400_000).toISOString().slice(0, 10) : '';
                    const m = mm.get(str(d.materialId));
                    return {
                        id: a.id,
                        materialId: str(d.materialId),
                        materialNumber: str(m?.materialNumber) || str(d.materialId),
                        description: str(m?.shortText) || str(m?.name),
                        warehouseId: str(d.warehouseId),
                        warehouse: wm.get(str(d.warehouseId)) || str(d.warehouseId),
                        status: str(d.status),
                        cell,
                        criticalityClass: cell ? cell[0] : '',
                        movement: cell ? Number(cell[1]) : null,
                        pendingCell: str(d.status) !== 'approved' ? str(d.cell) : '',
                        onDemand: cell ? onDemand(cell, setup.cutoff) : false,
                        approvedAt: ap ? str(ap.approvedAt) : '',
                        reviewDue,
                        overdue: !!reviewDue && reviewDue < today,
                    };
                });
            return { rows, cutoff: setup.cutoff, strategyMode: setup.strategyMode, onDemandStrategy: ON_DEMAND_STRATEGY };
        }),
    ],
};
