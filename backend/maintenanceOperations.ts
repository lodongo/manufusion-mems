import { createHash } from 'node:crypto';
import { bypass } from './testModeCore';
import { stableJson } from './scopeGuard';
import { defaultMaintenanceRiskMatrix, scoreMaintenanceRisk, finalizeAssessedTaskRisks, type RiskMatrix } from './maintenanceTaskRisk';
import { HttpError, getDoc, listDocs, nowIso, str, writeDoc, runQuery, fieldEq, type Doc, type Obj } from './core';
import { orgRoute, hasPerm, type OrgContext } from './guards';
import { canAt, canAnywhere, nodePath, scopeOf } from './access';
import { audit } from './audit';
import { commit, materialIn, physicalOf, stockValOf, withLock, type Write } from './finCore';
import { catalogItemSpec } from './procurement';
import { createMaintenanceRequirement } from './purchaseRequirements';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { postMaintenanceReturn } from './finOps';
import { maintenancePermission, requireMaintenanceRole } from './maintenanceAccess';
import { assessmentReviewCurrent } from './maintenanceAssessmentReview';
import { maintenanceKey, reserveTaskSpare, releaseMaintenanceReservations, verifyMaintenanceStockLedger } from './maintenanceInventory';
import {
    equipmentMake,
    linkPath,
    openReplenishmentCover,
    procurementTrace,
    qualifiedServiceVendors,
    raiseSupplierOnboarding,
    requireQualifiedVendor,
    supplierCategories,
} from './maintenanceSourcing';
import { planningGroup } from './maintenanceMaterialHook';
import { budgetStatus, costApprovalOf, estimateOf, periodOf, submitCost } from './maintenancePlanning';
import {
    closurePrerequisites,
    criticalPath,
    identifier,
    object,
    quantity,
    reconcileQuantities,
    requiredText,
    rows,
    safetyDeclaration,
    taskCompletion,
    texts,
    type ScheduleTask,
} from './maintenanceDomain';

const root = (ctx: OrgContext) => `organizations/${ctx.orgId}`;
const name = (ctx: OrgContext) => [str(ctx.me.data.firstName), str(ctx.me.data.lastName)].filter(Boolean).join(' ') || ctx.uid;
const hash = (v: unknown) => createHash('sha256').update(stableJson(v)).digest('hex');
const tasksOf = (wo: Doc) => rows(wo.data.assessmentTasks);
const recordPath = (wo: Doc) => texts(wo.data.path);
async function event(ctx: OrgContext, action: string, id: string, details = '') {
    await audit([
        {
            category: 'maintenance',
            action: 'mnt.' + action,
            actor: ctx.actor,
            meta: ctx.meta,
            orgId: ctx.orgId,
            target: { label: id },
            details,
        },
    ]);
}
function history(ctx: OrgContext, d: Obj, action: string, note = '') {
    return [...rows(d.history), { at: nowIso(), uid: ctx.uid, name: name(ctx), action, note }];
}
async function saveWo(ctx: OrgContext, wo: Doc, patch: Obj, action: string, note = '') {
    await commit([
        {
            path: `${root(ctx)}/work_orders/${wo.id}`,
            fields: { ...wo.data, ...patch, updatedAt: nowIso(), history: history(ctx, wo.data, action, note) },
            updateTime: wo.updateTime,
        },
    ]);
    await event(ctx, action, wo.id, note);
}
async function order(ctx: OrgContext, code: unknown) {
    const id = identifier(code);
    if (!/^WO\d{8}$/.test(id)) throw new HttpError(400, 'Choose a work order.');
    const wo = await getDoc(`${root(ctx)}/work_orders/${id}`);
    if (!wo) throw new HttpError(404, 'Work order not found.');
    await maintenancePermission(ctx, 'MNT.view', recordPath(wo));
    return wo;
}
async function authority(ctx: OrgContext, wo: Doc, permission: string, gate?: string) {
    await maintenancePermission(ctx, permission, recordPath(wo));
    if (gate) await requireMaintenanceRole(ctx, gate, recordPath(wo));
}
/** The existing equipment unit is the scheduling boundary. An explicit line mapping must be a real unit in the same site. */
async function productionLine(ctx: OrgContext, wo: Doc) {
    const unit = await getDoc(`${root(ctx)}/structure/${identifier(wo.data.unitId)}`);
    if (!unit) throw new HttpError(409, 'Equipment unit is missing from Organization design.');
    const mapping = await getDoc(`${root(ctx)}/maintenance_line_mappings/${unit.id}`);
    const id = str(mapping?.data.lineId) || str(object(unit.data.attributes).productionLineId) || unit.id;
    const line = await getDoc(`${root(ctx)}/structure/${identifier(id)}`);
    const path = await nodePath(ctx.orgId, id);
    if (!line || !['work_center', 'equipment', 'cost_center'].includes(str(line.data.level)) || !path.includes(str(wo.data.siteId)))
        throw new HttpError(409, 'The production-line mapping must reference a designated line node in the same site.');
    return { id, name: str(line.data.name), path };
}
async function safetyCatalogue() {
    const out: Obj = {};
    for (const key of ['hazardousEnergy', 'hazards', 'impacts', 'controlMeasures'])
        out[key] = rows((await getDoc(`module_workspaces/SAF/metadata/${key}`))?.data.items).map((x) => ({ code: x.code, label: x.label }));
    return out;
}
async function equipmentSafety(ctx: OrgContext, wos: Doc[]) {
    const result: Obj[] = [];
    for (const id of [...new Set(wos.map((w) => str(w.data.unitId)))]) {
        const [equipment, energy, utilities] = await Promise.all([
            getDoc(`${root(ctx)}/structure/${id}`),
            getDoc(`${root(ctx)}/equipment_stored_energy/${id}`),
            getDoc(`${root(ctx)}/equipment_utilities/${id}`),
        ]);
        result.push({
            equipmentId: id,
            name: str(equipment?.data.name),
            storedEnergy: energy?.data || {},
            utilities: utilities?.data || {},
            energyRevision: energy?.updateTime || '',
            equipmentRevision: equipment?.updateTime || '',
            utilitiesRevision: utilities?.updateTime || '',
        });
    }
    return result;
}
async function currentWindow(ctx: OrgContext, id: unknown) {
    const doc = await getDoc(`${root(ctx)}/maintenance_windows/${identifier(id)}`);
    if (!doc) throw new HttpError(404, 'Maintenance window not found.');
    await maintenancePermission(ctx, 'MNT.view', texts(doc.data.path));
    return doc;
}
async function internalOrder(ctx: OrgContext, code: unknown) {
    const id = identifier(code);
    if (!/^WO\d{8}$/.test(id)) throw new HttpError(409, 'Invalid window work order.');
    const doc = await getDoc(`${root(ctx)}/work_orders/${id}`);
    if (!doc) throw new HttpError(409, 'Window work order no longer exists.');
    return doc;
}
async function windowContext(ctx: OrgContext, window: Doc, internal = false) {
    const wos: Doc[] = [];
    for (const id of texts(window.data.workOrderIds)) wos.push(await (internal ? internalOrder(ctx, id) : order(ctx, id)));
    for (const wo of wos) {
        if (wo.data.status === 'closed') continue;
        if (window.data.model === EQUIPMENT_WINDOW) {
            if (str(wo.data.unitId) !== str(window.data.equipmentId)) throw new HttpError(409, 'Every work order must belong to the window equipment.');
        } else if ((await productionLine(ctx, wo)).id !== window.data.lineId)
            throw new HttpError(409, 'Every work order must belong to this production line.');
    }
    const equipment = await equipmentSafety(ctx, wos);
    const settings = await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
    const riskMatrix = (await getDoc(`${root(ctx)}/saf/risk_matrix`))?.data.configuration || defaultMaintenanceRiskMatrix;
    const fingerprint = hash({
        revision: window.data.revision,
        tasks: window.data.tasks,
        start: window.data.start,
        end: window.data.end,
        safetySteps: rows(window.data.safetySteps).map((s) => ({ id: s.id, instruction: s.instruction })),
        riskMatrix,
        wos: wos.map((w) => ({
            id: w.id,
            assessment: tasksOf(w).filter((t) => rows(window.data.tasks).some((s) => s.woCode === w.id && s.taskId === t.id)),
            version: w.data.assessmentTasksVersion,
            planning: Object.fromEntries(
                rows(window.data.tasks)
                    .filter((s) => s.woCode === w.id)
                    .map((s) => [str(s.taskId), object(object(w.data.taskPlanning)[str(s.taskId)])]),
            ),
            status: ['cancelled', 'planning'].includes(str(w.data.status)) ? w.data.status : 'active',
        })),
        equipment,
        configurationVersion: settings?.data.version || 0,
    });
    return { wos, equipment, fingerprint, configurationVersion: Number(settings?.data.version) || 0 };
}
export async function requireApprovedWindow(ctx: OrgContext, wo: Doc, taskId?: string) {
    const execution = object(object(wo.data.taskExecution)[taskId || '']);
    const id = str(execution.windowId) || str(object(wo.data.taskWindows)[taskId || '']) || str(wo.data.windowId);
    if (!id) throw new HttpError(409, 'Schedule the task in an approved maintenance window.');
    const w = await getDoc(`${root(ctx)}/maintenance_windows/${identifier(id)}`);
    if (!w) throw new HttpError(409, 'The task maintenance window no longer exists.');
    const context = await windowContext(ctx, w, true);
    if (w.data.model === EQUIPMENT_WINDOW) {
        // Planner-scheduled window: valid while the work, resources and safety setup match what was scheduled.
        if (!['scheduled', 'in_progress', 'completed'].includes(str(w.data.status)))
            throw new HttpError(409, 'The maintenance window is not scheduled.');
        if (w.data.fingerprint !== context.fingerprint)
            throw new HttpError(409, 'The work, resources or safety setup changed after the window was scheduled. The planner must save the window again.');
    } else {
        if (!['authorized', 'in_progress', 'completed'].includes(str(w.data.status)))
            throw new HttpError(409, 'The maintenance window is not authorized.');
        for (const gate of ['engineering', 'safety'])
            if (object(w.data[gate]).fingerprint !== context.fingerprint)
                throw new HttpError(
                    409,
                    'Scope, resources, equipment safety or approval configuration changed. Reapprove the maintenance window.',
                );
    }
    const selected = rows(w.data.tasks).filter((t) => t.woCode === wo.id && (!taskId || t.taskId === taskId));
    if (!selected.length) throw new HttpError(409, 'This task is not selected in the approved maintenance window.');
    if (rows(w.data.safetySteps).some((s) => !s.completedAt))
        throw new HttpError(409, 'Complete the maintenance window safety prerequisites before physical work starts.');
    return w;
}
export async function enforceMaintenanceTransition(ctx: OrgContext, wo: Doc, action: string) {
    if (action === 'verify' && ctx.body.result === 'rework')
        throw new HttpError(409, 'Record a controlled follow-up work request for rework so the completed task history is preserved.');
    if (action === 'start') await requireApprovedWindow(ctx, wo);
    if (action === 'schedule') throw new HttpError(409, 'Schedule assessed tasks through Maintenance Windows.');
    if (action === 'log_time') throw new HttpError(409, 'Record actual labour hours with the individual task execution feedback.');
    if (action === 'use_spare')
        throw new HttpError(409, 'Issue materials to the selected task in Inventory, then confirm actual consumption in task execution.');
    if (action === 'complete') {
        for (const t of tasksOf(wo)) {
            const e = object(object(wo.data.taskExecution)[str(t.id)]);
            if (e.status !== 'completed' || e.reconciled !== true)
                throw new HttpError(409, 'Complete feedback and reconcile every task before completing the work order.');
            taskCompletion(t, object(e.feedback));
        }
        if (!tasksOf(wo).length) throw new HttpError(409, 'Assess and execute the individual tasks first.');
    }
    if (action === 'close') {
        await requireMaintenanceRole(ctx, 'MNT.WO.TECHNICAL_CLOSE', recordPath(wo));
        closurePrerequisites(wo.data);
        for (const t of tasksOf(wo)) await requireApprovedWindow(ctx, wo, str(t.id));
    }
    if (action === 'cancel') await releaseMaintenanceReservations(ctx, wo.id);
    if (action === 'reopen')
        throw new HttpError(409, 'Closed maintenance history is immutable. Raise a follow-up work request for further work.');
}
/**
 * Task and work-order readiness, recalculated on every read and before scheduling approval from the live stock,
 * reservation and procurement records. A spare is ready only when its full quantity is reserved or issued; a
 * service only when it is secured on a placed purchase order raised from this task's requirement.
 */
async function readiness(ctx: OrgContext, wo: Doc, selected?: Set<string>) {
    const items: Obj[] = [],
        problems: string[] = [];
    const chosen = tasksOf(wo).filter((t) => !selected || selected.has(str(t.id)));
    const links = new Map(
        (await listDocs(`${root(ctx)}/mnt_supply_links`)).filter((l) => l.data.woCode === wo.id && l.data.status === 'active').map((l) => [l.id, l.data]),
    );
    const reqIds: string[] = [...[...links.values()].map((l) => str(l.requirementId))];
    for (const t of chosen) {
        const planning = object(object(wo.data.taskPlanning)[str(t.id)]);
        for (const r of [...rows(t.spares), ...rows(t.services)]) reqIds.push(str(object(planning[str(r.id)]).requirementId));
    }
    const trace = await procurementTrace(ctx.orgId, reqIds);
    for (const t of chosen) {
        const planning = object(object(wo.data.taskPlanning)[str(t.id)]),
            allocation = object(planning.allocation);
        if (
            texts(allocation.personnel).length < Number(t.persons) ||
            allocation.toolsReady !== true ||
            allocation.competenciesConfirmed !== true
        )
            problems.push(`${str(t.description)}: allocate qualified personnel and confirm tools.`);
        for (const spare of rows(t.spares)) {
            const key = maintenanceKey(wo.id, str(t.id), str(spare.id));
            const p = object(planning[str(spare.id)]),
                materialId = str(p.materialId) || (['warehouse', 'material'].includes(str(spare.source)) ? str(spare.materialId) : ''),
                warehouseId = str(p.warehouseId) || str(spare.warehouseId);
            let available: number | null = null,
                unitCost: number | null = null,
                reserved = 0;
            if (materialId && warehouseId) {
                const m = await materialIn(ctx.orgId, materialId, warehouseId);
                if (m && ['approved', 'active'].includes(str(m.data.status))) {
                    try {
                        await verifyMaintenanceStockLedger(ctx.orgId, warehouseId, materialId);
                        available = (await physicalOf(ctx.orgId, warehouseId, materialId)).available;
                    } catch {
                        available = null;
                    }
                    unitCost = (await stockValOf(ctx.orgId, warehouseId, materialId)).avg || null;
                }
                const r = await getDoc(`${root(ctx)}/inventory_reservations/${key}`);
                reserved = Number(r?.data.qty) || 0;
                reserved += Number(r?.data.issued) || 0;
            }
            if (materialId && warehouseId && available === null)
                problems.push(`${str(t.description)}: reconcile stock movements and verify the approved material.`);
            const link = links.get(key);
            const requirementId = str(link?.requirementId) || str(p.requirementId);
            const procurement = requirementId ? trace.get(requirementId) : undefined;
            const shortage = Math.max(0, Number(spare.qty) - reserved);
            const status =
                shortage === 0
                    ? 'reserved'
                    : ['needs_specification', 'ready_for_material_creation', 'material_rejected'].includes(str(p.status))
                      ? str(p.status)
                      : p.materialDraftId && !p.materialId
                        ? 'awaiting_material_approval'
                        : procurement && procurement.open === false
                          ? 'supply_closed'
                          : procurement && ['received', 'partially_received'].includes(str(procurement.stage)) && (available ?? 0) > 0
                            ? 'received_reserve'
                            : str(link?.kind) === 'replenishment'
                              ? 'linked_replenishment'
                              : procurement?.stage === 'verification'
                                ? 'awaiting_verification'
                                : requirementId
                                  ? 'awaiting_procurement'
                                  : !materialId
                                    ? 'awaiting_material_creation'
                                    : 'shortage';
            items.push({
                taskId: t.id,
                spareId: spare.id,
                ...spare,
                ...p,
                materialId,
                warehouseId,
                available,
                unitCost,
                reserved,
                shortage,
                status,
                requirementId,
                supply: link ? { kind: str(link.kind), requirementId: str(link.requirementId), qty: Number(link.qty) || 0, at: str(link.at) } : null,
                procurement: procurement ?? null,
            });
            if (shortage > 0) problems.push(`${str(t.description)}: secure ${shortage} ${str(spare.uom)} of ${str(spare.description)}.`);
            if (status === 'supply_closed') problems.push(`${str(t.description)}: requirement ${requirementId} for ${str(spare.description)} was cancelled or rejected; secure the spare again.`);
        }
        for (const s of rows(t.services)) {
            const p = object(planning[str(s.id)]);
            const procurement = str(p.requirementId) ? trace.get(str(p.requirementId)) : undefined;
            let orderLive = false;
            if (p.status === 'secured' && str(p.poId)) {
                const po = await getDoc(`${root(ctx)}/procurement_orders/${identifier(p.poId)}`);
                orderLive = !!po && ['open', 'sent', 'partial', 'full'].includes(str(po.data.status));
            }
            const ready = p.status === 'secured' && orderLive;
            const orderReady = procurement ? rows(procurement.orders).find((o) => o.live === true) ?? null : null;
            const status = ready
                ? 'secured'
                : p.status === 'secured'
                  ? 'order_inactive'
                  : procurement && procurement.open === false
                    ? 'supply_closed'
                    : orderReady
                      ? 'order_placed'
                      : str(p.requirementId)
                        ? 'awaiting_procurement'
                        : str(p.status) === 'awaiting_supplier_onboarding'
                          ? 'awaiting_supplier_onboarding'
                          : object(p.sourcing).supplierCategory
                            ? 'sourcing_confirmed'
                            : 'awaiting_sourcing';
            items.push({ taskId: t.id, serviceId: s.id, kind: 'service', ...p, status, procurement: procurement ?? null, orderReady });
            if (!ready)
                problems.push(
                    status === 'order_inactive'
                        ? `${str(t.description)}: the purchase order securing ${str(s.description)} is no longer active.`
                        : `${str(t.description)}: secure service ${str(s.description)}.`,
                );
        }
    }
    return { items, problems, ready: problems.length === 0 };
}
/**
 * The planner's readiness checklist: spares secured (reserved or issued, shortages sourced), services secured,
 * people and tools allocated, the schedule locked, the assessment risks reviewed and the estimated cost approved under
 * the Chart of Authority. Recomputed from live records on every read and again when readiness is confirmed.
 */
async function planChecklist(ctx: OrgContext, wo: Doc, ready?: Awaited<ReturnType<typeof readiness>>) {
    const r = ready ?? (await readiness(ctx, wo));
    const est = estimateOf(wo, r.items);
    const cost = await costApprovalOf(ctx.orgId, wo, est);
    const period = periodOf(str(wo.data.scheduledStart));
    const budget = await budgetStatus(ctx.orgId, str(wo.data.costCenterId), period, wo.id);
    const lock = object(wo.data.scheduleLock);
    const riskReview = object(wo.data.riskReview);
    const version = Number(wo.data.assessmentTasksVersion) || 0;
    const spares = r.items.filter((i) => i.spareId);
    const services = r.items.filter((i) => i.kind === 'service');
    const items = [
        { key: 'spares', label: 'Spares available and reserved', done: spares.every((i) => i.status === 'reserved'), detail: `${spares.filter((i) => i.status === 'reserved').length} of ${spares.length} reserved` },
        { key: 'services', label: 'Services engaged with procurement and secured', done: services.every((i) => i.status === 'secured'), detail: `${services.filter((i) => i.status === 'secured').length} of ${services.length} secured` },
        { key: 'people', label: 'People and tools allocated', done: !r.problems.some((p) => p.includes('allocate qualified personnel')), detail: '' },
        { key: 'schedule', label: 'Schedule dates reviewed and locked', done: !!lock.at && lock.start === wo.data.scheduledStart && lock.end === wo.data.scheduledEnd, detail: `${str(wo.data.scheduledStart) || 'no start'} to ${str(wo.data.scheduledEnd) || 'no end'}` },
        { key: 'risk', label: 'Risk assessment reviewed from the assessment', done: !!riskReview.at && Number(riskReview.version) === version, detail: str(riskReview.note) },
        { key: 'cost', label: 'Estimated cost approved (Chart of Authority)', done: cost.current, detail: est.total === 0 ? 'Nothing to approve' : `${cost.status}` },
    ];
    return { items, estimate: est, cost, budget, problems: r.problems, ready: items.every((i) => i.done) && r.ready };
}

/** Planner actions on the readiness checklist. */
async function planningAction(ctx: OrgContext, wo: Doc, action: string) {
    if (!['planning', 'plan_ready'].includes(str(wo.data.status))) throw new HttpError(409, 'The work order is no longer in planning.');
    await authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
    const settings = await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
    const jobRole = str(object(settings?.data.approverRoles)['MNT.ASSESS.REVIEW']);
    if (!jobRole || !assessmentReviewCurrent(wo.data, jobRole))
        throw new HttpError(409, 'Approve the latest work assessment through the configured reviewer before planning.');
    const b = ctx.body;
    if (action === 'lock_schedule') {
        const start = requiredText(b.scheduledStart, 'Scheduled start', 10, 10),
            end = requiredText(b.scheduledEnd, 'Scheduled end', 10, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))
            throw new HttpError(400, 'Enter the scheduled dates as YYYY-MM-DD.');
        if (end < start) throw new HttpError(400, 'The scheduled end cannot be before the start.');
        if (start < nowIso().slice(0, 10)) throw new HttpError(400, 'The scheduled start cannot be in the past.');
        const changed = start !== wo.data.scheduledStart || end !== wo.data.scheduledEnd;
        const reason = str(b.note).trim().slice(0, 300);
        if (changed && reason.length < 10) throw new HttpError(400, 'Explain why the dates change (at least 10 characters).');
        const ca = object(wo.data.costApproval);
        // A move to another budget period needs a new cost approval against that period's budget.
        const periodMoved = periodOf(start) !== periodOf(str(wo.data.scheduledStart));
        await saveWo(ctx, wo, {
            scheduledStart: start, scheduledEnd: end,
            scheduleLock: { start, end, at: nowIso(), by: ctx.uid, name: name(ctx) },
            ...(periodMoved && str(ca.status) ? { costApproval: { ...ca, status: 'superseded' } } : {}),
        }, 'plan.schedule_locked', `${start} to ${end}${changed ? ' · ' + reason : ''}${periodMoved && str(ca.status) ? ' · cost approval superseded (period changed)' : ''}`);
        return { ok: true };
    }
    if (action === 'review_risk') {
        const note = requiredText(b.note, 'Risk review notes', 10, 1000);
        const tasks = tasksOf(wo);
        if (!tasks.every((t) => rows(t.risk).length)) throw new HttpError(409, 'Every task needs its preliminary risk assessment before review.');
        await saveWo(ctx, wo, { riskReview: { version: Number(wo.data.assessmentTasksVersion) || 0, at: nowIso(), by: ctx.uid, name: name(ctx), note,
            hazards: tasks.reduce((n, t) => n + rows(t.risk).length, 0), permits: [...new Set(tasks.flatMap((t) => texts(t.permitCodes)))] } }, 'plan.risk_reviewed', note);
        return { ok: true };
    }
    if (action === 'submit_cost') {
        const ready = await readiness(ctx, wo);
        const allowance = b.allowance === undefined || b.allowance === '' ? Number(object(wo.data.costPlan).allowance) || 0 : Number(b.allowance);
        if (!Number.isFinite(allowance) || allowance < 0 || allowance > 1e12) throw new HttpError(400, 'Enter a valid allowance (0 or more).');
        const est = estimateOf(wo, ready.items, allowance);
        const current = await costApprovalOf(ctx.orgId, wo, est);
        if (current.status === 'pending') throw new HttpError(409, `${current.requestId} is already waiting for approval.`);
        if (current.current && current.status === 'approved') throw new HttpError(409, 'The current estimate is already approved.');
        const out = await submitCost(ctx, wo, est, b);
        await saveWo(ctx, wo, { costApproval: out.costApproval, costPlan: out.costPlan, plannedBy: ctx.uid, plannedByName: name(ctx) }, 'plan.cost_submitted', `${out.requestId} · ${est.total}`);
        return { ok: true, requestId: out.requestId };
    }
    if (action === 'confirm_readiness') {
        const check = await planChecklist(ctx, wo);
        if (!check.ready) {
            const open = check.items.filter((i) => !i.done).map((i) => i.label);
            throw new HttpError(409, `Not ready yet: ${[...open, ...check.problems].slice(0, 6).join('; ')}.`);
        }
        await saveWo(ctx, wo, { status: 'released', readiness: { at: nowIso(), by: ctx.uid, name: name(ctx), estimate: check.estimate.total }, releasedBy: ctx.uid, releasedByName: name(ctx), releasedAt: nowIso(), releaseEstimate: check.estimate.total },
            'plan.readiness_confirmed', `Estimate ${check.estimate.total}`);
        return { ok: true };
    }
    throw new HttpError(400, 'Unknown planning action.');
}
async function resourceAction(ctx: OrgContext, wo: Doc, action: string) {
     const settings=await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
     const jobRole=str(object(settings?.data.approverRoles)['MNT.ASSESS.REVIEW']);
     if(!jobRole||!assessmentReviewCurrent(wo.data,jobRole))
         throw new HttpError(409,'Approve the latest work assessment through the configured reviewer before allocating or sourcing resources.');
    await authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
    if (!['planning', 'plan_ready', 'released', 'scheduled', 'in_progress'].includes(str(wo.data.status)))
        throw new HttpError(409, 'Resource planning is locked after execution starts.');
    const b = ctx.body,
        task = tasksOf(wo).find((t) => t.id === str(b.taskId));
    if (!task) throw new HttpError(400, 'Select an assessed task.');
    if (object(object(wo.data.taskExecution)[str(task.id)]).startedAt)
        throw new HttpError(409, 'Resource planning is locked for a task once execution begins.');
    const spare = rows(task.spares).find((s) => s.id === str(b.resourceId)),
        service = rows(task.services).find((s) => s.id === str(b.resourceId));
    const planning = object(wo.data.taskPlanning),
        p = object(planning[str(task.id)]),
        previous = object(p[str(b.resourceId)]);
    let state: Obj = { ...previous },
        result: Obj = {};
    if (action === 'allocate') {
        const ids = [...new Set(texts(b.personnel))];
        if (ids.length < Number(task.persons) || ids.length > 50) throw new HttpError(400, 'Allocate enough personnel for this task.');
        for (const id of ids) {
            const u = await getDoc(`users/${identifier(id)}`);
            if (!u || u.data.orgId !== ctx.orgId || u.data.status === 'disabled')
                throw new HttpError(400, 'Choose active employees in this organization.');
        }
        const coveredSkills = new Set<string>();
        for (const id of ids) {
            const employee = await getDoc(`users/${id}`);
            texts(employee?.data.skillCodes).forEach((code) => coveredSkills.add(code));
        }
        if (texts(task.skillCodes).some((code) => !coveredSkills.has(code)))
            throw new HttpError(409, 'Allocated employees do not collectively cover the task HRM competencies.');
        if (b.toolsReady !== true || b.competenciesConfirmed !== true)
            throw new HttpError(400, 'Confirm tool availability and personnel competencies.');
        await saveWo(
            ctx,
            wo,
            {
                taskPlanning: {
                    ...planning,
                    [str(task.id)]: {
                        ...p,
                        allocation: {
                            personnel: ids,
                            toolsReady: true,
                            competenciesConfirmed: true,
                            notes: requiredText(b.note, 'Allocation evidence'),
                            by: ctx.uid,
                            at: nowIso(),
                        },
                    },
                },
                plannedBy: ctx.uid,
                plannedByName: name(ctx),
            },
            'task.resources.allocated',
        );
        return { ok: true };
    }
    if (!spare && !service) throw new HttpError(400, 'Select an assessed spare or service.');
    if (action === 'match_spare') {
        if (!spare) throw new HttpError(400, 'Select a spare requirement.');
        const materialId = identifier(b.materialId),
            warehouseId = identifier(b.warehouseId),
            m = await materialIn(ctx.orgId, materialId, warehouseId);
        if (!m || !['approved', 'active'].includes(str(m.data.status))) throw new HttpError(409, 'Select an approved warehouse material.');
        if (previous.reservationId) throw new HttpError(409, 'Reassess before changing a reserved material.');
        requiredText(b.note, 'Technical equivalence review');
        state = {
            ...state,
            materialId,
            warehouseId,
            status: 'matched',
            equivalenceReview: str(b.note),
            matchedBy: ctx.uid,
            matchedAt: nowIso(),
        };
    } else if (action === 'candidate') {
        if (!spare) throw new HttpError(400, 'Select a spare requirement.');
        if (previous.materialId || previous.reservationId)
            throw new HttpError(409, 'This spare is already matched or reserved. Use the existing approved material.');
        const candidateId = maintenanceKey(wo.id, str(task.id), str(spare.id));
        const path = `${root(ctx)}/material_creation_candidates/${candidateId}`;
        const existing = await getDoc(path);
        if (existing?.data.materialDraftId)
            throw new HttpError(409, 'The material draft has already been created. Complete its normal Materials Master approval.');
        if (existing && existing.data.assessmentVersion !== wo.data.assessmentTasksVersion)
            throw new HttpError(409, 'Reassess this work order before updating an outdated material candidate.');
        const code = str(b.catalogCode) || str(spare.catalogCode);
        const spec = code ? await catalogItemSpec('materials', code) : null;
        if (code && !spec)
            throw new HttpError(400, 'Choose a valid approved technical catalogue specification.');
        const attrs = { ...object(spare.attributes), ...object(b.attributes) };
        const reason = requiredText(b.note, 'Planner specification review', 5, 500);
        const status = spec ? 'ready_for_material_creation' : 'needs_specification';
        // Assessment owns the required quantity and technical description.
        // Planner queues a proposal; an authorized Materials Master maintainer
        // validates specifications and creates the material using PRC governance.
        const candidate: Obj = {
            woCode: wo.id, taskId: task.id, spareId: spare.id,
            assemblyId: str(task.assemblyId) || str(wo.data.assemblyId),
            equipmentId: str(task.equipmentId) || str(wo.data.unitId),
            assessmentVersion: wo.data.assessmentTasksVersion,
            source: str(spare.source), description: str(spare.description),
            qty: Number(spare.qty), uom: str(spare.uom),
            catalogCode: code, catalogueSpecification: spec ? (spec as unknown as Obj) : null,
            procurementWarehouseId: str(spare.warehouseId),
            attributes: attrs, plannerNotes: reason, status,
            createdBy: str(existing?.data.createdBy) || ctx.uid,
            createdAt: str(existing?.data.createdAt) || nowIso(),
            updatedBy: ctx.uid, updatedAt: nowIso(),
        };
        await commit([{
            path, fields: candidate,
            ...(existing ? { updateTime: existing.updateTime } : { exists: false }),
        }]);
        state = { ...state, candidateId, status, materialDraftId: '' };
        result = { candidateId, status };
    } else if (action === 'reserve') {
        if (!spare) throw new HttpError(400, 'Select a spare requirement.');
        await reserveTaskSpare(ctx, wo, task, spare, previous);
        await event(ctx, 'task.spare.reserved', wo.id, str(task.id));
        return { ok: true };
    } else if (action === 'secure_spare' || (action === 'procure' && spare)) {
        // Warehouse first: reserve what is usable and uncommitted, then cover only the shortage, by linking an
        // existing open replenishment or raising (or reusing) this task's procurement requirement.
        if (!spare) throw new HttpError(400, 'Select a spare requirement.');
        const materialId = str(previous.materialId) || (['warehouse', 'material'].includes(str(spare.source)) ? str(spare.materialId) : '');
        const warehouseId = (str(b.warehouseId) ? identifier(b.warehouseId) : '') || str(previous.warehouseId) || str(spare.warehouseId);
        if (!materialId)
            throw new HttpError(409, 'This spare has no approved material code yet. Material creation and approval must complete first; the need is then pushed to procurement automatically.');
        const m = await materialIn(ctx.orgId, materialId, warehouseId);
        if (!m || !['approved', 'active'].includes(str(m.data.status)))
            throw new HttpError(409, 'Choose a warehouse where this approved material is stocked (material approval and warehouse extension must be complete).');
        await maintenancePermission(ctx, 'INV.issue', await nodePath(ctx.orgId, warehouseId));
        const key = maintenanceKey(wo.id, str(task.id), str(spare.id));
        let current = wo;
        if (action === 'secure_spare') {
            await reserveTaskSpare(ctx, wo, task, spare, { ...previous, materialId, warehouseId });
            current = (await getDoc(`${root(ctx)}/work_orders/${wo.id}`))!;
        }
        const reservation = await getDoc(`${root(ctx)}/inventory_reservations/${key}`);
        if (reservation && (str(reservation.data.warehouseId) !== warehouseId || str(reservation.data.materialId) !== materialId) && Number(reservation.data.qty) > 0)
            throw new HttpError(409, 'Release the existing reservation before sourcing from another warehouse.');
        const reserved = (Number(reservation?.data.qty) || 0) + (Number(reservation?.data.issued) || 0);
        const shortage = Math.max(0, Number(spare.qty) - reserved);
        const cp = object(object(current.data.taskPlanning)[str(task.id)]),
            cur = object(cp[str(spare.id)]);
        state = { ...cur, materialId, warehouseId };
        if (!shortage) {
            if (action === 'procure') throw new HttpError(409, 'No shortage remains.');
            await event(ctx, 'task.spare.secured', wo.id, `${str(task.id)}/${str(spare.id)} reserved in full`);
            return { ok: true, reserved, shortage: 0 };
        }
        const linkDoc = await getDoc(linkPath(ctx.orgId, key));
        const trace = linkDoc && linkDoc.data.status === 'active' ? (await procurementTrace(ctx.orgId, [str(linkDoc.data.requirementId)])).get(str(linkDoc.data.requirementId)) : undefined;
        let requirementId = '',
            kind: 'maintenance' | 'replenishment' = 'maintenance';
        if (linkDoc && linkDoc.data.status === 'active' && trace?.open && Number(linkDoc.data.qty) >= shortage) {
            requirementId = str(linkDoc.data.requirementId);
            kind = str(linkDoc.data.kind) === 'replenishment' ? 'replenishment' : 'maintenance';
            if (kind === 'maintenance' && trace.stage === 'verification')
                await createMaintenanceRequirement(ctx, { glCode: b.glCode, dateRequired: b.dateRequired, urgency: b.urgency, budget: b.budget ?? null }, { key, woCode: wo.id, taskId: task.id, resourceId: spare.id });
        } else {
            const cover = await openReplenishmentCover(ctx.orgId, materialId, warehouseId, shortage, key);
            if (cover) {
                requirementId = cover.requirementId;
                kind = 'replenishment';
            } else {
                const uom = PROCUREMENT_UNITS.find((u) => u.active && u.selectable && (u.code === str(spare.uom) || u.code === str(m.data.uom) || u.symbol.toLowerCase() === str(spare.uom).toLowerCase()));
                if (!str(b.glCode)) throw new HttpError(400, `No open supply covers the shortage of ${shortage}. Choose the GL account and date required to raise the purchase requirement.`);
                requirementId = await createMaintenanceRequirement(
                    ctx,
                    {
                        type: 'material',
                        source: 'warehouse',
                        requirement: str(spare.description) || str(m.data.name),
                        technical: [str(spare.specifications), str(spare.function) ? 'Function: ' + str(spare.function) : '', `Work order ${wo.id}, task ${str(task.title) || str(task.description)}`].filter(Boolean).join('\n'),
                        categoryCode: str(m.data.categoryCode),
                        subcategoryCode: str(m.data.subcategoryCode),
                        familyCode: str(m.data.familyCode),
                        materialId,
                        warehouseId,
                        quantity: shortage,
                        uomCode: uom?.code || str(b.uomCode),
                        dateRequired: b.dateRequired || str(spare.requiredDate),
                        urgency: ['low', 'medium', 'high'].includes(str(b.urgency)) ? b.urgency : 'medium',
                        costCenterId: warehouseId,
                        glCode: b.glCode,
                        budget: b.budget ?? null,
                    },
                    {
                        key,
                        woCode: wo.id,
                        taskId: task.id,
                        resourceId: spare.id,
                        description: spare.description,
                        quantity: shortage,
                        assessedRequirement: spare,
                        assessmentVersion: Number(wo.data.assessmentTasksVersion) || 1,
                        costCenterId: str(wo.data.costCenterId),
                        planningGroup: planningGroup(wo),
                        attachments: [str(spare.photoPath), ...texts(spare.attachments)].filter(Boolean),
                    },
                );
            }
        }
        await commit([
            {
                path: linkPath(ctx.orgId, key),
                fields: { woCode: wo.id, taskId: str(task.id), resourceId: str(spare.id), requirementId, kind, qty: shortage, materialId, warehouseId, status: 'active', at: nowIso(), by: ctx.uid },
            },
        ]);
        state = { ...state, requirementId, supplyKind: kind, status: kind === 'replenishment' ? 'linked_replenishment' : 'awaiting_procurement' };
        result = { requirementId, kind, reserved, shortage };
        wo = current;
    } else if (action === 'service_sourcing') {
        // The planner confirms the supplier category and a qualified registered vendor, or routes the need to
        // supplier onboarding when no suitable approved vendor exists. Never a free-text vendor.
        if (!service) throw new HttpError(400, 'Select a service.');
        if (str(previous.requirementId)) throw new HttpError(409, 'Supplier sourcing is fixed once the purchase requirement is raised. Change it through Procurement.');
        const category = (await supplierCategories()).find((c) => c.code === str(b.supplierCategory));
        if (!category) throw new HttpError(400, 'Choose the supplier category.');
        const make = await equipmentMake(ctx.orgId, wo);
        const q = { supplierCategory: category.code, categoryCode: str(service.categoryCode), subcategoryCode: str(service.subcategoryCode), make };
        const at = nowIso();
        if (str(b.preferredVendorId)) {
            const vendor = await requireQualifiedVendor(ctx.orgId, identifier(b.preferredVendorId), q);
            state = {
                ...state,
                status: 'sourcing_confirmed',
                sourcing: { supplierCategory: category.code, supplierCategoryLabel: category.label, preferredVendorId: vendor.id, preferredVendorName: vendor.name, manufacturerMatch: vendor.manufacturerMatch, by: ctx.uid, at },
            };
        } else {
            const { vendors } = await qualifiedServiceVendors(ctx.orgId, q);
            const reason = requiredText(b.onboardingReason, 'Reason no approved vendor is suitable', vendors.length ? 20 : 10, 600);
            const suggested = requiredText(b.suggestedVendor, 'Suggested supplier name', 3, 120);
            const onboardingRequestId = await raiseSupplierOnboarding(ctx, wo, task, service, { supplierCategory: category, name: suggested, contact: str(b.suggestedContact).trim().slice(0, 160), reason });
            state = {
                ...state,
                status: 'awaiting_supplier_onboarding',
                sourcing: { supplierCategory: category.code, supplierCategoryLabel: category.label, preferredVendorId: '', preferredVendorName: '', onboardingRequestId, suggestedVendor: suggested, approvedAlternatives: vendors.length, by: ctx.uid, at },
            };
        }
        result = { status: state.status };
    } else if (action === 'procure') {
        // External service → Procurement Requirement, carrying the full scope, supplier category and preferred vendor.
        if (!service) throw new HttpError(400, 'Select a service.');
        const sourcing = object(previous.sourcing);
        if (!str(sourcing.supplierCategory)) throw new HttpError(409, 'Confirm the supplier category and vendor (or supplier onboarding) first.');
        if (str(sourcing.preferredVendorId))
            await requireQualifiedVendor(ctx.orgId, str(sourcing.preferredVendorId), {
                supplierCategory: str(sourcing.supplierCategory), categoryCode: str(service.categoryCode), subcategoryCode: str(service.subcategoryCode), make: await equipmentMake(ctx.orgId, wo),
            });
        const technical = [
            `Scope: ${str(service.scope)}`,
            str(service.instructions) && `Instructions: ${str(service.instructions)}`,
            `Deliverables: ${str(service.deliverables)}`,
            `Acceptance: ${str(service.acceptanceCriteria)}`,
            `Competencies: ${str(service.qualifications)}${str(service.certifications) ? '; certifications: ' + str(service.certifications) : ''}`,
            (service.personnel || service.durationHours) && `Personnel ${Number(service.personnel) || '—'}, duration ${Number(service.durationHours) || '—'} h`,
            `Supplier category: ${str(sourcing.supplierCategoryLabel)}${str(sourcing.preferredVendorName) ? '; preferred vendor ' + str(sourcing.preferredVendorName) + ' (' + str(sourcing.preferredVendorId) + ')' : '; supplier onboarding requested: ' + str(sourcing.suggestedVendor)}`,
            `Work order ${wo.id}, task ${str(task.title) || str(task.description)}; planning group ${planningGroup(wo).label}`,
        ]
            .filter(Boolean)
            .join('\n');
        const requirementId = await createMaintenanceRequirement(
            ctx,
            {
                type: 'service',
                source: str(service.catalogCode) ? 'catalogue' : 'description',
                requirement: service.description,
                technical,
                categoryCode: str(service.categoryCode),
                subcategoryCode: str(service.subcategoryCode),
                familyCode: str(service.classCode),
                itemCode: str(service.catalogCode),
                attributes: object(service.attributes),
                quantity: 1,
                dateRequired: b.dateRequired || str(service.executionDate),
                urgency: ['low', 'medium', 'high'].includes(str(b.urgency)) ? b.urgency : 'medium',
                costCenterId: str(wo.data.costCenterId),
                glCode: b.glCode,
                budget: b.budget ?? service.expectedCost ?? null,
            },
            {
                key: maintenanceKey(wo.id, str(task.id), str(service.id)),
                woCode: wo.id,
                taskId: task.id,
                resourceId: service.id,
                description: service.description,
                quantity: Number(service.quantity) || 1,
                serviceCode: str(service.catalogCode),
                assessedRequirement: service,
                assessmentVersion: Number(wo.data.assessmentTasksVersion) || 1,
                supplierCategory: str(sourcing.supplierCategory),
                supplierCategoryLabel: str(sourcing.supplierCategoryLabel),
                preferredVendor: str(sourcing.preferredVendorId) ? { id: str(sourcing.preferredVendorId), name: str(sourcing.preferredVendorName) } : null,
                supplierOnboardingRequestId: str(sourcing.onboardingRequestId),
                executionDate: str(service.executionDate),
                costCenterId: str(wo.data.costCenterId),
                planningGroup: planningGroup(wo),
                attachments: texts(service.attachments),
                proposedVendors: await Promise.all(
                    texts(service.proposedVendorIds).map(async (id) => {
                        const vendor = await getDoc(`${root(ctx)}/vendors/${id}`);
                        return { id, name: str(vendor?.data.tradeName) || str(vendor?.data.legalName) || id };
                    }),
                ),
            },
        );
        state = { ...state, requirementId, status: 'awaiting_procurement' };
        result = { requirementId };
    } else if (action === 'secure_service') {
        if (!service) throw new HttpError(400, 'Select a service.');
        const po = await getDoc(`${root(ctx)}/procurement_orders/${identifier(b.poId)}`);
        const line = rows(po?.data.lines).find((l) => Number(l.no) === Number(b.lineNo));
        if (!po || !['open', 'sent', 'partial', 'full'].includes(str(po.data.status)) || !line || line.type !== 'service')
            throw new HttpError(409, 'Choose an approved service purchase-order line.');
        const reqId = str(previous.requirementId);
        if (
            !reqId ||
            !(
                po.data.requirementId === reqId ||
                po.data.requirementNumber === reqId ||
                texts(po.data.requirementIds).includes(reqId) ||
                line.requirementId === reqId
            )
        )
            throw new HttpError(409, 'The service purchase order must originate from this task purchase requirement.');
        state = {
            ...state,
            poId: po.id,
            lineNo: line.no,
            vendorId: po.data.vendorId || '',
            vendorName: str(po.data.vendorName),
            cost: Number(line.net) || Number(line.total) || 0,
            readyAt: requiredText(b.readyAt, 'Service readiness date'),
            scopeConfirmation: requiredText(b.note, 'Service scope confirmation'),
            status: 'secured',
        };
    } else throw new HttpError(400, 'Unknown resource action.');
    // Re-read the planning map from the record being saved (a reservation may have just updated it).
    const latest = object(wo.data.taskPlanning),
        latestTask = object(latest[str(task.id)]);
    await saveWo(
        ctx,
        wo,
        {
            taskPlanning: { ...latest, [str(task.id)]: { ...latestTask, [str((spare || service)!.id)]: state } },
            plannedBy: ctx.uid,
            plannedByName: name(ctx),
        },
        'task.resource.' + action,
    );
    return { ok: true, ...result };
}

export const EQUIPMENT_WINDOW = 'equipment_v2';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Offset (ms) of a time zone from UTC at an instant. */
function zoneOffset(ms: number, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
}
/** The UTC instant of a local date and time in a time zone. */
export function zonedInstant(date: string, time: string, timeZone: string) {
    const guess = Date.parse(`${date}T${time}:00Z`);
    let t = guess - zoneOffset(guess, timeZone);
    const second = zoneOffset(t, timeZone);
    if (guess - second !== t) t = guess - second;
    return new Date(t).toISOString();
}

/**
 * A maintenance window is one piece of equipment on one date: start date, start time and duration (the end follows).
 * The planner fills it with as many ready work orders of that equipment as fit; no separate approval. Every task of
 * the chosen work orders is scheduled; people allocated to several tasks do them one after another. Isolation and
 * permit prerequisites are listed for verification before physical work starts.
 */
async function windowSave(ctx: OrgContext) {
    const b = ctx.body,
        existing = b.windowId ? await currentWindow(ctx, b.windowId) : null;
    if (existing && str(b.reason).trim().length < 10 && b.action !== 'preview_window')
        throw new HttpError(400, 'Explain the reason for changing the window (at least 10 characters).');
    if (existing && ['in_progress', 'completed', 'superseded'].includes(str(existing.data.status)))
        throw new HttpError(409, 'A started, completed or replaced window cannot change.');
    if (existing && existing.data.model !== EQUIPMENT_WINDOW)
        throw new HttpError(409, 'This is an older production-line window. Create a new equipment window for its work orders; the old one is replaced.');
    const equipmentId = identifier(b.equipmentId);
    const equipment = await getDoc(`${root(ctx)}/structure/${equipmentId}`);
    if (!equipment || !['work_center', 'equipment'].includes(str(equipment.data.level))) throw new HttpError(400, 'Choose the equipment.');
    const date = str(b.date), startTime = str(b.startTime);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, 'Choose the window date.');
    if (!TIME_RE.test(startTime)) throw new HttpError(400, 'Choose the start time (HH:MM).');
    const durationHours = Number(b.durationHours);
    if (!Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 72 || Math.round(durationHours * 4) !== durationHours * 4)
        throw new HttpError(400, 'Enter a duration from 0.25 to 72 hours, in quarter hours.');
    const timeZone = str(b.timeZone) || 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone });
    } catch {
        throw new HttpError(400, 'Choose a valid planning timezone.');
    }
    const start = zonedInstant(date, startTime, timeZone),
        end = new Date(Date.parse(start) + durationHours * 3600000).toISOString();
    if (Date.parse(start) < Date.now() - 15 * 60000 && (!existing || existing.data.start !== start))
        throw new HttpError(400, 'The window cannot start in the past.');
    const ids = [...new Set(texts(b.workOrderIds))];
    if (!ids.length || ids.length > 30) throw new HttpError(400, 'Choose 1 to 30 work orders.');
    const wos: Doc[] = [];
    for (const id of ids) {
        const wo = await order(ctx, id);
        await authority(ctx, wo, 'MNT.WO.schedule', 'MNT.WO.PLAN');
        if (str(wo.data.unitId) !== equipmentId) throw new HttpError(400, `${id} is on other equipment (${str(wo.data.unitCode)}).`);
        const inThis = !!existing && texts(existing.data.workOrderIds).includes(id);
        if (!(str(wo.data.status) === 'released' || (inThis && str(wo.data.status) === 'scheduled')))
            throw new HttpError(409, `${id}: the planner must confirm readiness on the work order first.`);
        const ready = await readiness(ctx, wo);
        if (!ready.ready) throw new HttpError(409, `${id} is no longer ready: ${ready.problems.slice(0, 3).join(' ')}`);
        wos.push(wo);
    }
    // Tasks: every not-started task of the chosen work orders. People allocated to several tasks do them in turn.
    const selected: ScheduleTask[] = [];
    const busyUntil = new Map<string, number>();
    const superseded = new Map<string, Doc>();
    // Optionally only some tasks of a work order (the rest go to a later window); by default all of them.
    const chosen = new Set(rows(b.tasks).map((x) => `${str(x.woCode)}_${str(x.taskId)}`));
    for (const key of chosen)
        if (!wos.some((wo) => tasksOf(wo).some((t) => `${wo.id}_${str(t.id)}` === key))) throw new HttpError(400, 'Choose tasks of the selected work orders.');
    for (const wo of wos)
        for (const t of tasksOf(wo)) {
            if (object(object(wo.data.taskExecution)[str(t.id)]).startedAt) continue;
            // A work order with chosen tasks contributes only those; one without contributes all its tasks.
            const picksHere = [...chosen].some((k) => k.startsWith(wo.id + '_'));
            if (picksHere && !chosen.has(`${wo.id}_${str(t.id)}`)) continue;
            const assigned = str(object(wo.data.taskWindows)[str(t.id)]);
            if (assigned && assigned !== existing?.id && !superseded.has(assigned)) {
                const other = await getDoc(`${root(ctx)}/maintenance_windows/${identifier(assigned)}`);
                if (other && other.data.model !== EQUIPMENT_WINDOW && ['draft', 'awaiting_approval'].includes(str(other.data.status))) superseded.set(other.id, other);
                else if (other && !['superseded'].includes(str(other.data.status)))
                    throw new HttpError(409, `${wo.id}: a task is already in window ${other.id}. Remove the work order from that window first.`);
            }
            const personnel = texts(object(object(object(wo.data.taskPlanning)[str(t.id)]).allocation).personnel);
            const hours = Number(t.hours) || 0.25;
            const offset = Math.max(0, ...personnel.map((p) => busyUntil.get(p) ?? 0));
            for (const p of personnel) busyUntil.set(p, offset + hours);
            selected.push({
                id: `${wo.id}_${str(t.id)}`, woCode: wo.id, taskId: str(t.id), description: str(t.title) || str(t.description),
                hours, offset, dependencies: [], personnel, tools: [], safety: false, executionPriority: 50,
            });
            (selected[selected.length - 1] as ScheduleTask & { _deps: string[] })._deps = texts(t.dependencies).map((dep) => `${wo.id}_${dep}`);
        }
    // Technical dependencies on tasks scheduled here; dependencies outside this window must already be complete.
    for (const sTask of selected as Array<ScheduleTask & { _deps?: string[] }>) {
        const wo = wos.find((w) => w.id === sTask.woCode)!;
        for (const dep of sTask._deps ?? []) {
            if (selected.some((x) => x.id === dep)) sTask.dependencies.push(dep);
            else if (object(object(wo.data.taskExecution)[dep.slice(wo.id.length + 1)]).status !== 'completed')
                throw new HttpError(409, `${sTask.description} depends on a task that is neither in this window nor completed.`);
        }
        delete sTask._deps;
    }
    if (!selected.length) throw new HttpError(409, 'Every task of these work orders has already started.');
    const schedule = criticalPath(selected);
    const needed = Math.max(...schedule.tasks.map((t) => t.finish));
    if (b.action === 'preview_window') return { schedule, neededHours: needed, start, end };
    if (schedule.conflicts.length) throw new HttpError(409, schedule.conflicts.join(' '));
    if (needed > durationHours + 1e-6)
        throw new HttpError(409, `The work needs ${Math.round(needed * 100) / 100} h but the window is ${durationHours} h. Lengthen the window or remove a work order.`);
    // Safety prerequisites to verify before physical work starts (isolation and permits).
    const steps: Obj[] = [],
        catalogue = await safetyCatalogue();
    const label = (kind: string, code: string) => str(rows(catalogue[kind]).find((x) => x.code === code)?.label) || code;
    const needsIsolation = wos.some((wo) => tasksOf(wo).some((t) => t.lotoRequired === true));
    for (const e of await equipmentSafety(ctx, wos)) {
        const energy = object(e.storedEnergy);
        if (energy.initialized !== true) {
            if (needsIsolation) throw new HttpError(409, `Complete the stored energy assessment for ${str(e.name)} before scheduling isolation work.`);
            continue;
        }
        for (const source of rows(energy.items))
            steps.push({ id: maintenanceKey(str(e.equipmentId), str(source.id)), equipmentId: e.equipmentId, instruction: `Verify isolation of ${label('hazardousEnergy', str(source.energyCode))}. ${str(source.notes)}`.trim(), completedAt: '', completedBy: '' });
    }
    for (const sTask of selected) {
        const t = tasksOf(wos.find((w) => w.id === sTask.woCode)!).find((x) => x.id === sTask.taskId)!;
        const instructions = [
            ...(t.lotoRequired === true ? texts(t.energySourceCodes).map((c) => `LOTO: isolate, lock, tag and prove zero ${label('hazardousEnergy', c)}`) : []),
            ...(t.liveEquipment === true ? ['Live work: authorized procedure, guarding, exclusion zone and emergency stop ready'] : []),
            str(t.isolation),
            ...rows(t.risk).filter((r) => str(r.permit)).map((r) => `${str(r.permit)}: ${str(r.controls)}`),
        ].filter(Boolean);
        for (const instruction of instructions) steps.push({ id: maintenanceKey(sTask.id, instruction), taskId: sTask.id, instruction, completedAt: '', completedBy: '' });
    }
    // Keep verifications already done for unchanged prerequisites.
    const previous = new Map(rows(existing?.data.safetySteps).map((x) => [str(x.id), x]));
    const safetySteps = steps.map((x) => { const p = previous.get(str(x.id)); return p && p.completedAt ? { ...x, completedAt: p.completedAt, completedBy: p.completedBy, evidence: p.evidence } : x; });
    const id = existing?.id || 'MW_' + maintenanceKey(ctx.orgId, nowIso(), ctx.uid).slice(0, 16),
        revision = (Number(existing?.data.revision) || 0) + 1;
    const weekDate = new Date(date + 'T00:00:00Z');
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - (weekDate.getUTCDay() || 7));
    const isoWeekYear = weekDate.getUTCFullYear(),
        isoWeek = Math.ceil(((weekDate.getTime() - Date.UTC(isoWeekYear, 0, 1)) / 86400000 + 1) / 7);
    const data: Obj = {
        id,
        model: EQUIPMENT_WINDOW,
        title: str(b.title).trim().slice(0, 120) || `${str(equipment.data.code)} ${date} ${startTime}`,
        equipmentId, equipmentCode: str(equipment.data.code), equipmentName: str(equipment.data.name),
        lineId: equipmentId, lineName: str(equipment.data.name),
        siteId: wos[0].data.siteId,
        path: await nodePath(ctx.orgId, equipmentId),
        date, startTime, durationHours, start, end, timeZone, isoWeek, isoWeekYear, rangeType: 'equipment',
        workOrderIds: ids,
        tasks: selected as unknown as Obj[],
        schedule: schedule as unknown as Obj,
        safetySteps,
        revision,
        status: 'scheduled',
        engineering: null,
        safety: null,
        plannedBy: ctx.uid,
        plannedByName: name(ctx),
        scheduledAt: nowIso(),
        updatedAt: nowIso(),
        history: history(ctx, existing?.data || {}, revision === 1 ? 'Window scheduled' : 'Window revised (revision ' + revision + ')', str(b.reason)),
    };
    data.fingerprint = (await windowContext(ctx, { id, data, updateTime: '' } as unknown as Doc)).fingerprint;
    const writes: Write[] = [
        { path: `${root(ctx)}/maintenance_windows/${id}`, fields: data, ...(existing ? { updateTime: existing.updateTime } : { exists: false }) },
    ];
    const touched = new Map<string, Doc>(wos.map((w) => [w.id, w]));
    const patches = new Map<string, Obj>();
    for (const wo of wos) {
        const assignments = { ...object(wo.data.taskWindows) };
        for (const [key, value] of Object.entries(assignments)) if (value === id || superseded.has(str(value))) delete assignments[key];
        for (const sTask of selected.filter((x) => x.woCode === wo.id)) assignments[sTask.taskId] = id;
        patches.set(wo.id, { status: str(wo.data.status) === 'in_progress' ? 'in_progress' : 'scheduled', taskWindows: assignments, windowId: id, windowIds: [...new Set([...texts(wo.data.windowIds), id])], windowStart: start, windowEnd: end });
    }
    // Work orders taken out of this window, or left in a replaced older window, go back to ready.
    const released = [...(existing ? texts(existing.data.workOrderIds).filter((x) => !ids.includes(x)) : []), ...[...superseded.values()].flatMap((w) => texts(w.data.workOrderIds).filter((x) => !ids.includes(x)))];
    for (const woId of [...new Set(released)]) {
        const wo = await internalOrder(ctx, woId);
        touched.set(wo.id, wo);
        const assignments = { ...object(wo.data.taskWindows) };
        for (const [key, value] of Object.entries(assignments)) if (value === id || superseded.has(str(value))) delete assignments[key];
        patches.set(wo.id, { taskWindows: assignments, ...(str(wo.data.status) === 'scheduled' ? { status: 'released', windowId: '', windowStart: '', windowEnd: '' } : {}) });
    }
    for (const [woId, patch] of patches) {
        const wo = touched.get(woId)!;
        writes.push({ path: `${root(ctx)}/work_orders/${woId}`, fields: { ...patch, updatedAt: nowIso(), history: history(ctx, wo.data, patch.status === 'released' ? 'Removed from window ' + id : 'Scheduled in window ' + id, `${date} ${startTime} for ${durationHours} h`) }, mask: [...Object.keys(patch), 'updatedAt', 'history'], updateTime: wo.updateTime });
    }
    for (const old of superseded.values())
        writes.push({ path: `${root(ctx)}/maintenance_windows/${old.id}`, fields: { status: 'superseded', supersededBy: id, history: history(ctx, old.data, 'Replaced by equipment window ' + id) }, mask: ['status', 'supersededBy', 'history'], updateTime: old.updateTime });
    await commit(writes);
    await event(ctx, 'window.scheduled', id, `${str(equipment.data.code)} ${date} ${startTime} ${durationHours} h · ${ids.join(', ')}${existing ? ' · ' + str(b.reason) : ''}`);
    return { ok: true, windowId: id };
}

async function windowAction(ctx: OrgContext, action: string) {
    if (action === 'save_window' || action === 'preview_window') return windowSave(ctx);
    const w = await currentWindow(ctx, ctx.body.windowId),
        c = await windowContext(ctx, w),
        b = ctx.body,
        path = texts(w.data.path);
    if (action === 'window_report' && c.wos.every((wo) => wo.data.status === 'closed') && object(w.data.approvedReport).fingerprint) {
        const snapshot = object(w.data.approvedReport);
        return {
            window: { id: w.id, ...w.data },
            equipment: snapshot.equipment,
            workOrders: snapshot.workOrders,
            fingerprint: snapshot.fingerprint,
            safetyCatalogue: await safetyCatalogue(),
            approvedSnapshot: snapshot,
        };
    }
    if (action === 'window_report')
        return {
            window: { id: w.id, ...w.data },
            equipment: c.equipment,
            workOrders: c.wos.map((wo) => ({
                code: wo.id,
                title: wo.data.title,
                assetTag: wo.data.assetTag,
                unitName: wo.data.unitName,
                tasks: tasksOf(wo).filter((t) => rows(w.data.tasks).some((s) => s.woCode === wo.id && s.taskId === t.id)),
            })),
            fingerprint: c.fingerprint,
            safetyCatalogue: await safetyCatalogue(),
            approvedSnapshot: w.data.approvedReport || null,
        };
    if (['approve_engineering', 'approve_safety', 'reject_window', 'authorize_window'].includes(action))
        throw new HttpError(409, 'Maintenance windows no longer need engineering or safety approval: the planner schedules them. Create an equipment window for these work orders.');
    if (action === 'safety_prerequisite') {
        if (!['authorized', 'scheduled', 'in_progress'].includes(str(w.data.status)))
            throw new HttpError(409, 'Schedule the window before verifying safety prerequisites.');
        // The people who apply isolation and do the work verify it: safety officers or allocated executors.
        try {
            await maintenancePermission(ctx, 'MNT.WO.safety', path);
        } catch {
            await maintenancePermission(ctx, 'MNT.WO.execute', path);
        }
        const id = str(b.stepId);
        if (!rows(w.data.safetySteps).some((s) => s.id === id)) throw new HttpError(400, 'Choose a safety prerequisite.');
        const steps = rows(w.data.safetySteps).map((s) =>
            s.id === id
                ? { ...s, completedAt: nowIso(), completedBy: ctx.uid, evidence: requiredText(b.note, 'Safety verification evidence', 5) }
                : s,
        );
        await commit([
            {
                path: `${root(ctx)}/maintenance_windows/${w.id}`,
                fields: { ...w.data, safetySteps: steps, history: history(ctx, w.data, 'Safety prerequisite verified', id) },
                updateTime: w.updateTime,
            },
        ]);
        return { ok: true };
    }
    throw new HttpError(400, 'Unknown maintenance-window action.');
}

async function reconcileTask(ctx: OrgContext, wo: Doc, task: Obj, execution: Obj, confirmOnly = false) {
    if (execution.status !== 'completed') throw new HttpError(409, 'Record task completion feedback before reconciliation.');
    if (execution.reconciled === true) return { ok: true, reused: true };
    const allIssues = (await listDocs(`${root(ctx)}/goods_issues`)).filter(
        (i) => i.data.workOrderId === wo.id && i.data.taskId === task.id,
    );
    const issued = allIssues.flatMap((issue) => rows(issue.data.lines).map((line) => ({ issue, line, id: issue.id + '_' + line.no })));
    const proposal = object(execution.consumptionProposal);
    if (!confirmOnly && !proposal.confirmedAt)
        throw new HttpError(409, 'The task executor must explicitly confirm actual material consumption first.');
    const consumption = rows(confirmOnly ? ctx.body.consumption : proposal.rawConsumption);
    if (new Set(consumption.map((c) => str(c.issueLineId))).size !== consumption.length || consumption.length !== issued.length)
        throw new HttpError(400, 'Confirm actual use and unused returns for every issued material line, including additional spares.');
    const normalized: Obj[] = [];
    for (const i of issued) {
        const c = consumption.find((c) => c.issueLineId === i.id);
        if (!c) throw new HttpError(400, 'An issued material has no actual-consumption confirmation.');
        const q = reconcileQuantities(Number(i.line.qty), c.consumed, c.returned);
        if (c.installed !== true && c.installed !== false)
            throw new HttpError(400, 'Explicitly identify whether each consumed material is an installed BOM component.');
        if (c.installed === true && q.consumed <= 0) throw new HttpError(400, 'Only actually consumed parts can be installed in the BOM.');
        const requirementId = str(c.spareId);
        if (requirementId && !rows(task.spares).some((s) => s.id === requirementId))
            throw new HttpError(400, 'Select this task spare requirement, or mark the material as additional.');
        normalized.push({
            issueLineId: i.id,
            issueId: i.issue.id,
            lineNo: i.line.no,
            materialId: i.line.materialId,
            materialNumber: i.line.materialNumber,
            description: i.line.name,
            warehouseId: i.issue.data.warehouseId,
            plannedSpareId: requirementId,
            plannedQuantity: rows(task.spares).find((s) => s.id === requirementId)?.qty || 0,
            issued: Number(i.line.qty),
            ...q,
            installed: c.installed,
            uom: i.line.uom,
            unitCost: i.issue.data.finance === 'live' ? i.line.unitCost : null,
            remarks: requiredText(c.remarks, 'Material reconciliation remarks'),
            confirmedBy: ctx.uid,
            confirmedAt: nowIso(),
        });
    }
    // A planned spare not used must be explicitly dispositioned, never auto-consumed.
    const dispositions = rows(confirmOnly ? ctx.body.dispositions : proposal.dispositions);
    for (const spare of rows(task.spares))
        if (!normalized.some((c) => c.plannedSpareId === spare.id)) {
            const d = dispositions.find((d) => d.spareId === spare.id);
            if (!d || str(d.reason).trim().length < 5)
                throw new HttpError(400, `Record why planned spare ${str(spare.description)} was not used.`);
        }
    if (confirmOnly) {
        await saveWo(
            ctx,
            wo,
            {
                taskExecution: {
                    ...object(wo.data.taskExecution),
                    [str(task.id)]: {
                        ...execution,
                        consumptionProposal: {
                            rawConsumption: consumption,
                            consumption: normalized,
                            dispositions,
                            confirmedAt: nowIso(),
                            confirmedBy: ctx.uid,
                        },
                    },
                },
            },
            'task.actual_materials.confirmed',
            str(task.id),
        );
        return { ok: true };
    }
    for (const i of allIssues) await maintenancePermission(ctx, 'INV.issue', await nodePath(ctx.orgId, str(i.data.warehouseId)));
    // Confirm stores returns first. Stable keys make a retry safe if the final BOM transaction fails.
    for (const c of normalized.filter((c) => Number(c.returned) > 0)) {
        const i = issued.find((i) => i.id === c.issueLineId)!;
        await postMaintenanceReturn(ctx, i.issue, i.line, Number(c.returned), maintenanceKey(wo.id, str(task.id), str(c.issueLineId)));
    }
    const target = str(task.assemblyId) || str(task.equipmentId) || str(wo.data.assemblyId) || str(wo.data.unitId);
    const node = await getDoc(`${root(ctx)}/structure/${identifier(target)}`),
        path = await nodePath(ctx.orgId, target);
    if (!node || !path.includes(str(wo.data.unitId)))
        throw new HttpError(409, 'The BOM target must be this task equipment or an assembly below it.');
    const writes: Write[] = [],
        at = nowIso();
    const installed = normalized.filter((c) => c.installed === true && Number(c.consumed) > 0);
    if (installed.length) {
        const versions = (await listDocs(`${root(ctx)}/boms`)).filter(
                (d) => d.data.assemblyId === target || (!str(d.data.assemblyId) && d.data.equipmentId === target),
            ),
            boms = versions.filter((d) => d.data.status === 'active');
        if (boms.length > 1) throw new HttpError(409, 'Select a single active BOM at this technical level before reconciliation.');
        const current = boms[0],
            nextVersion = Math.max(0, ...versions.map((b) => Number(b.data.version) || 0)) + 1,
            bomId = current?.id || 'BOM_MNT_' + maintenanceKey(target, String(nextVersion)).slice(0, 20),
            lines = rows(current?.data.lines);
        if (current)
            writes.push({
                path: `${root(ctx)}/bom_revisions/${current.id}_v${current.data.version}_${maintenanceKey(wo.id, str(task.id))}`,
                fields: { ...current.data, archivedAt: at, sourceWorkOrder: wo.id, sourceTask: task.id },
                exists: false,
            });
        for (const c of installed) {
            const found = lines.find((l) => l.materialId === c.materialId || l.component === c.materialNumber);
            const link = {
                woCode: wo.id,
                taskId: task.id,
                issueId: c.issueId,
                issueLineId: c.issueLineId,
                quantity: c.consumed,
                installedAt: at,
                confirmedBy: ctx.uid,
            };
            if (found) {
                found.materialId = c.materialId;
                found.quantity = Math.max(
                    Number(found.quantity) || 0,
                    installed.filter((part) => part.materialId === c.materialId).reduce((n, part) => n + Number(part.consumed), 0),
                );
                found.lastInstalledQuantity = c.consumed;
                found.unit = c.uom;
                found.installations = [...rows(found.installations), link];
            } else
                lines.push({
                    component: c.materialNumber,
                    materialId: c.materialId,
                    description: c.description,
                    quantity: installed
                        .filter((part) => part.materialId === c.materialId)
                        .reduce((n, part) => n + Number(part.consumed), 0),
                    unit: c.uom,
                    installations: [link],
                });
        }
        writes.push({
            path: `${root(ctx)}/boms/${bomId}`,
            fields: {
                ...(current?.data || {}),
                assemblyId: node.data.level === 'assembly' ? target : '',
                equipmentId: node.data.level === 'assembly' ? str(wo.data.unitId) : target,
                name: str(current?.data.name) || 'Maintenance confirmed installed parts',
                code: str(current?.data.code),
                status: 'active',
                version: nextVersion,
                lines,
                updatedAt: at,
                updatedBy: ctx.uid,
            },
            ...(current ? { updateTime: current.updateTime } : { exists: false }),
        });
    }
    const executions = object(wo.data.taskExecution),
        e = {
            ...execution,
            reconciled: true,
            consumption: normalized,
            unusedPlannedSpares: dispositions,
            reconciledAt: at,
            reconciledBy: ctx.uid,
            bomTargetId: target,
            bomUpdated: installed.length > 0,
        };
    writes.push(
        {
            path: `${root(ctx)}/maintenance_material_reconciliations/${maintenanceKey(wo.id, str(task.id))}`,
            fields: {
                woCode: wo.id,
                taskId: task.id,
                consumption: normalized,
                unusedPlannedSpares: dispositions,
                bomTargetId: target,
                at,
                by: ctx.uid,
            },
            exists: false,
        },
        {
            path: `${root(ctx)}/work_orders/${wo.id}`,
            fields: {
                ...wo.data,
                taskExecution: { ...executions, [str(task.id)]: e },
                history: history(ctx, wo.data, 'Task materials reconciled and BOM reviewed', str(task.id)),
                updatedAt: at,
            },
            updateTime: wo.updateTime,
        },
    );
    await commit(writes);
    await event(ctx, 'task.reconciled', wo.id, str(task.id));
    return { ok: true };
}

function executionSchedule(window: Doc, wos: Doc[]) {
    const tasks = rows(object(window.data.schedule).tasks).map((raw) => {
        const s = raw as unknown as ScheduleTask;
        if (s.safety) return s;
        const wo = wos.find((w) => w.id === s.woCode),
            e = object(object(wo?.data.taskExecution)[s.taskId]);
        if (!e.startedAt) return { ...s, status: 'not_started' };
        const elapsed = Math.max(
                0.001,
                ((e.completedAt ? Date.parse(str(e.completedAt)) : Date.now()) - Date.parse(str(e.startedAt))) / 3600000,
            ),
            offset = Math.max(s.offset, (Date.parse(str(e.startedAt)) - Date.parse(str(window.data.start))) / 3600000);
        return { ...s, hours: e.status === 'completed' ? elapsed : Math.max(s.hours, elapsed), offset, status: str(e.status) };
    });
    try {
        return criticalPath(tasks, (Date.parse(str(window.data.end)) - Date.parse(str(window.data.start))) / 3600000);
    } catch {
        return window.data.schedule;
    }
}

export async function executeMaintenanceAction(ctx: OrgContext, wo: Doc, action: string) {
    const b = ctx.body,
        executions = object(wo.data.taskExecution),
        task = tasksOf(wo).find((t) => t.id === str(b.taskId)),
        e = object(executions[str(b.taskId)]);
    if (['start_task', 'block_task', 'complete_task', 'confirm_consumption', 'reconcile_task'].includes(action)) {
        if (action === 'reconcile_task') {
            await authority(ctx, wo, 'MNT.view', 'MNT.SPARES.RECONCILE');
        } else await authority(ctx, wo, 'MNT.WO.execute', 'MNT.TASK.FEEDBACK');
        if (!task) throw new HttpError(400, 'Select a maintenance task.');
        if (['closed', 'cancelled'].includes(str(wo.data.status)) || object(wo.data.safetySignoff).at)
            throw new HttpError(409, 'Task execution is locked after safety sign-off or closure.');
        const w = await requireApprovedWindow(ctx, wo, str(task.id));
        if (action === 'reconcile_task') return reconcileTask(ctx, wo, task, e);
        if (action === 'confirm_consumption') {
            if (!texts(e.performers).includes(ctx.uid) && !bypass(ctx, 'mnt.task.execution_team')) throw new HttpError(403, 'The task execution team must confirm actual usage.');
            return reconcileTask(ctx, wo, task, e, true);
        }
        if (e.status === 'completed') throw new HttpError(409, 'Completed task history is immutable.');
        if (action === 'start_task') {
            const selected = rows(w.data.tasks).find((t) => t.woCode === wo.id && t.taskId === task.id)!;
            for (const dependency of texts(selected.dependencies)) {
                const s = rows(w.data.tasks).find((s) => s.id === dependency)!;
                const other = await order(ctx, s.woCode),
                    prior = object(object(other.data.taskExecution)[str(s.taskId)]);
                if (prior.status !== 'completed') throw new HttpError(409, 'Complete every predecessor task before starting this task.');
            }
            const allocation = object(object(object(wo.data.taskPlanning)[str(task.id)]).allocation);
            for (const other of await listDocs(`${root(ctx)}/work_orders`))
                for (const [id, raw] of Object.entries(object(other.data.taskExecution))) {
                    const running = object(raw);
                    if ((other.id === wo.id && id === task.id) || !['in_progress', 'blocked'].includes(str(running.status))) continue;
                    const otherWindow = await getDoc(`${root(ctx)}/maintenance_windows/${str(running.windowId)}`),
                        otherSchedule = rows(otherWindow?.data.tasks).find((s) => s.woCode === other.id && s.taskId === id);
                    if (
                        texts(running.performers).some((p) => texts(allocation.personnel).includes(p)) ||
                        texts(selected.tools).some((tool) => texts(otherSchedule?.tools).includes(tool))
                    )
                        throw new HttpError(
                            409,
                            'An assigned person or exclusive tool is already occupied by another active maintenance task.',
                        );
                }
            if (!texts(allocation.personnel).includes(ctx.uid) && !bypass(ctx, 'mnt.task.execution_team'))
                throw new HttpError(403, 'Only personnel allocated to this task may start it.');
            await saveWo(
                ctx,
                wo,
                {
                    status: 'in_progress',
                    startedAt: wo.data.startedAt || nowIso(),
                    taskExecution: {
                        ...executions,
                        [str(task.id)]: {
                            ...e,
                            taskId: task.id,
                            status: 'in_progress',
                            windowId: w.id,
                            startedAt: e.startedAt || nowIso(),
                            startedBy: ctx.uid,
                            performers: texts(allocation.personnel),
                        },
                    },
                },
                'task.started',
                str(task.id),
            );
            await commit([
                {
                    path: `${root(ctx)}/maintenance_windows/${w.id}`,
                    fields: { status: 'in_progress' },
                    mask: ['status'],
                    updateTime: w.updateTime,
                },
            ]);
            return { ok: true };
        }
        if (!['in_progress', 'blocked'].includes(str(e.status)))
            throw new HttpError(409, 'Start the task before recording execution results.');
        if (!texts(e.performers).includes(ctx.uid) && !bypass(ctx, 'mnt.task.execution_team')) throw new HttpError(403, 'Only this task execution team may record feedback.');
        if (action === 'block_task') {
            await saveWo(
                ctx,
                wo,
                {
                    taskExecution: {
                        ...executions,
                        [str(task.id)]: {
                            ...e,
                            status: 'blocked',
                            blockReason: requiredText(b.note, 'Reason for blocking', 5),
                            blockedAt: nowIso(),
                        },
                    },
                },
                'task.blocked',
            );
            return { ok: true };
        }
        const feedback = object(b.feedback);
        taskCompletion(task, feedback);
        if (feedback.scopeDeviation === true)
            throw new HttpError(
                409,
                'A technical deviation requires reassessment in a follow-up work order; do not certify this task complete.',
            );
        const hours = quantity(feedback.actualHours),
            next = {
                ...executions,
                [str(task.id)]: {
                    ...e,
                    status: 'completed',
                    feedback: { ...feedback, actualHours: hours },
                    completedAt: nowIso(),
                    completedBy: ctx.uid,
                    reconciled: false,
                },
            };
        const complete = tasksOf(wo).every((t) => object(next[str(t.id)]).status === 'completed');
        await saveWo(
            ctx,
            wo,
            {
                taskExecution: next,
                status: complete ? 'completed' : 'in_progress',
                ...(complete ? { completedAt: nowIso(), completedBy: ctx.uid } : {}),
            },
            'task.completed',
            str(task.id),
        );
        const current = (await getDoc(`${root(ctx)}/maintenance_windows/${w.id}`))!;
        let windowComplete = true;
        for (const scheduled of rows(current.data.tasks)) {
            const related = await internalOrder(ctx, scheduled.woCode);
            if (object(object(related.data.taskExecution)[str(scheduled.taskId)]).status !== 'completed') windowComplete = false;
        }
        if (windowComplete)
            await commit([
                {
                    path: `${root(ctx)}/maintenance_windows/${w.id}`,
                    fields: { status: 'completed', executionCompletedAt: nowIso() },
                    mask: ['status', 'executionCompletedAt'],
                    updateTime: current.updateTime,
                },
            ]);
        return { ok: true };
    }
    if (action === 'safety_signoff') {
        await authority(ctx, wo, 'MNT.WO.safety', 'MNT.SAFETY.SIGNOFF');
        for (const t of tasksOf(wo)) {
            const state = object(executions[str(t.id)]);
            if (state.status !== 'completed' || state.reconciled !== true)
                throw new HttpError(409, 'Complete and reconcile every task before safety sign-off.');
            await requireApprovedWindow(ctx, wo, str(t.id));
        }
        if (!tasksOf(wo).length || object(wo.data.safetySignoff).at)
            throw new HttpError(409, 'Safety sign-off cannot be applied in this state.');
        safetyDeclaration(object(b));
        const incidentRecords = (await listDocs(`${root(ctx)}/safety_incidents`)).filter((i) => i.data.woCode === wo.id);
        if (b.declaration === 'none' && incidentRecords.length)
            throw new HttpError(
                409,
                'An incident or near miss is already recorded for this work order. Use the reported-incident declaration.',
            );
        if (incidentRecords.some((i) => i.data.status !== 'cleared'))
            throw new HttpError(409, 'Every recorded incident requires containment and independent safety clearance before sign-off.');
        if (b.declaration === 'reported') {
            const incident = await getDoc(`${root(ctx)}/safety_incidents/${identifier(b.incidentId)}`);
            if (!incident || incident.data.woCode !== wo.id || incident.data.status !== 'cleared')
                throw new HttpError(409, 'Link a cleared safety incident for this work order.');
        }
        await saveWo(
            ctx,
            wo,
            {
                safetySignoff: {
                    declaration: str(b.declaration),
                    noIncidentsConfirmed: b.noIncidentsConfirmed === true,
                    statement:
                        b.declaration === 'none'
                            ? 'No safety incidents or near misses occurred during this maintenance activity.'
                            : str(b.narrative),
                    incidentId: str(b.incidentId),
                    note: requiredText(b.note, 'Safety clearance notes', 5),
                    by: ctx.uid,
                    name: name(ctx),
                    at: nowIso(),
                },
                handover: null,
            },
            'safety.signed_off',
        );
        return { ok: true };
    }
    if (action === 'report_incident') {
        await authority(ctx, wo, 'MNT.WO.safety', 'MNT.SAFETY.SIGNOFF');
        const id = 'INC_' + maintenanceKey(wo.id, nowIso(), ctx.uid).slice(0, 16);
        const data: Obj = {
            id,
            woCode: wo.id,
            windowIds: wo.data.windowIds || [],
            equipmentId: wo.data.unitId,
            taskIds: texts(b.taskIds).length ? texts(b.taskIds) : tasksOf(wo).some((t) => t.id === str(b.taskId)) ? [str(b.taskId)] : [],
            classification: requiredText(b.classification, 'Incident classification'),
            narrative: requiredText(b.narrative, 'Incident narrative', 10),
            occurredAt: requiredText(b.occurredAt, 'Incident date'),
            immediateControls: requiredText(b.immediateControls, 'Immediate controls', 10),
            status: 'open',
            createdBy: ctx.uid,
            createdAt: nowIso(),
            peopleOrRoles: str(b.peopleOrRoles),
            followUp: requiredText(b.followUp, 'Incident follow-up', 5),
        };
        if (!Number.isFinite(Date.parse(str(data.occurredAt)))) throw new HttpError(400, 'Enter the incident date and time.');
        await writeDoc(`${root(ctx)}/safety_incidents/${id}`, data, { exists: false });
        await event(ctx, 'incident.reported', id, wo.id);
        return { ok: true, incidentId: id };
    }
    if (action === 'clear_incident') {
        await authority(ctx, wo, 'MNT.WO.safety', 'MNT.SAFETY.SIGNOFF');
        const id = identifier(b.incidentId),
            incident = await getDoc(`${root(ctx)}/safety_incidents/${id}`);
        if (!incident || incident.data.woCode !== wo.id || incident.data.status !== 'open')
            throw new HttpError(409, 'Choose an open incident for this work order.');
        if (incident.data.createdBy === ctx.uid && !bypass(ctx, 'mnt.incident.independent_clearance'))
            throw new HttpError(403, 'An independent safety representative must clear the reported incident.');
        await commit([
            {
                path: `${root(ctx)}/safety_incidents/${id}`,
                fields: {
                    ...incident.data,
                    status: 'cleared',
                    clearance: requiredText(b.note, 'Containment and clearance evidence', 10),
                    clearedAt: nowIso(),
                    clearedBy: ctx.uid,
                },
                updateTime: incident.updateTime,
            },
        ]);
        await event(ctx, 'incident.cleared', id);
        return { ok: true };
    }
    if (action === 'handover') {
        await authority(ctx, wo, 'MNT.WO.verify', 'MNT.HANDOVER');
        if (!object(wo.data.safetySignoff).at) throw new HttpError(409, 'Safety sign-off must precede equipment handover.');
        if (object(wo.data.handover).at) throw new HttpError(409, 'Handover is already recorded.');
        if (b.accepted !== true || b.ready !== true) throw new HttpError(400, 'Explicitly accept handover and equipment readiness.');
        const receivingParty = identifier(b.receivingParty),
            person = await getDoc(`users/${receivingParty}`);
        if (!person || person.data.orgId !== ctx.orgId || person.data.status === 'disabled' || (receivingParty !== ctx.uid && !bypass(ctx, 'mnt.handover.receiver_self_acceptance')))
            throw new HttpError(403, 'The authorized receiving employee must record their own acceptance.');
        await saveWo(
            ctx,
            wo,
            {
                handover: {
                    by: ctx.uid,
                    name: name(ctx),
                    receivingParty,
                    at: nowIso(),
                    accepted: true,
                    ready: true,
                    functionalChecks: requiredText(b.functionalChecks, 'Operational test results', 10),
                    condition: requiredText(b.condition, 'Equipment condition', 5),
                    restrictions: requiredText(b.restrictions, 'Outstanding restrictions or None'),
                    acceptedOutstanding: b.acceptedOutstanding === true,
                },
            },
            'equipment.handed_over',
        );
        return { ok: true };
    }
    if (action === 'technical_close') {
        await authority(ctx, wo, 'MNT.WO.close', 'MNT.WO.TECHNICAL_CLOSE');
        if (wo.data.status === 'closed') return { ok: true, reused: true };
        closurePrerequisites(wo.data);
        for (const t of tasksOf(wo)) await requireApprovedWindow(ctx, wo, str(t.id));
        if (
            (tasksOf(wo).some((t) => {
                const f = object(object(executions[str(t.id)]).feedback);
                return !/^none\.?$/i.test(str(f.outstandingDefects).trim()) || !/^none\.?$/i.test(str(f.followUp).trim());
            }) ||
                !/^none\.?$/i.test(str(object(wo.data.handover).restrictions).trim())) &&
            b.outstandingAccepted !== true
        )
            throw new HttpError(409, 'Explicitly accept outstanding issues and linked follow-up actions before closure.');
        const at = nowIso(),
            spares = Object.values(executions).reduce<number>(
                (sum, e) => sum + rows(object(e).consumption).reduce((n, c) => n + Number(c.consumed) * Number(c.unitCost || 0), 0),
                0,
            ),
            labour = tasksOf(wo).reduce(
                (n, t) => n + Number(object(object(executions[str(t.id)]).feedback).actualHours) * Number(t.rate || 0),
                0,
            );
        const services = tasksOf(wo).reduce(
            (n, t) =>
                n +
                rows(t.services).reduce(
                    (sum, s) => sum + Number(object(object(object(wo.data.taskPlanning)[str(t.id)])[str(s.id)]).cost || 0),
                    0,
                ),
            0,
        );
        await saveWo(
            ctx,
            wo,
            {
                status: 'closed',
                closedBy: ctx.uid,
                closedByName: name(ctx),
                closedAt: at,
                technicalClosure: {
                    by: ctx.uid,
                    name: name(ctx),
                    at,
                    note: requiredText(b.note, 'Technical Manager closure review', 10),
                    outstandingAccepted: b.outstandingAccepted === true,
                },
                finalCost: {
                    spares,
                    labour,
                    services,
                    total: spares + labour + services,
                    pendingMaterialValuation: Object.values(executions).some((e) =>
                        rows(object(e).consumption).some((c) => c.unitCost === null),
                    ),
                },
            },
            'work_order.technical_closed',
        );
        await releaseMaintenanceReservations(ctx, wo.id);
        for (const id of texts(wo.data.windowIds)) {
            const window = (await getDoc(`${root(ctx)}/maintenance_windows/${identifier(id)}`))!;
            let complete = true;
            for (const s of rows(window.data.tasks)) {
                const other = await internalOrder(ctx, s.woCode);
                if (object(object(other.data.taskExecution)[str(s.taskId)]).status !== 'completed') complete = false;
            }
            if (complete)
                await commit([
                    {
                        path: `${root(ctx)}/maintenance_windows/${id}`,
                        fields: { status: 'completed', completedAt: at },
                        mask: ['status', 'completedAt'],
                        updateTime: window.updateTime,
                    },
                ]);
        }
        return { ok: true };
    }
    if (action === 'reassess') {
        await authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
        if (Object.values(executions).some((e) => object(e).startedAt) || ['closed', 'cancelled'].includes(str(wo.data.status)))
            throw new HttpError(409, 'Executed history is immutable. Raise a follow-up request to change technical scope.');
        const reason = requiredText(b.note, 'Controlled reassessment reason', 10);
        await releaseMaintenanceReservations(ctx, wo.id);
        const revision = Number(wo.data.assessmentTasksVersion) || 1;
        await commit([
            {
                path: `${root(ctx)}/maintenance_assessment_revisions/${wo.id}_${revision}`,
                fields: { ...wo.data, revisionReason: reason, archivedAt: nowIso(), archivedBy: ctx.uid },
                exists: false,
            },
            {
                path: `${root(ctx)}/work_orders/${wo.id}`,
                fields: {
                    ...wo.data,
                    status: 'planning',
                    taskPlanning: {},
                    assessmentReview: null,
                    safety: null,
                    safetySignoff: null,
                    handover: null,
                    reassessmentReason: reason,
                    history: history(ctx, wo.data, 'Controlled reassessment opened', reason),
                },
                updateTime: wo.updateTime,
            },
        ]);
        await event(ctx, 'assessment.reopened', wo.id, reason);
        return { ok: true };
    }
    throw new HttpError(400, 'Unknown task execution action.');
}

export async function maintenanceOperations(ctx: OrgContext) {
    const b = ctx.body,
        action = str(b.action);
    if (action === 'line_options') {
        const scope = await scopeOf(ctx),
            nodes = await listDocs(`${root(ctx)}/structure`),
            items: Obj[] = [];
        for (const n of nodes.filter(
            (n) => ['work_center', 'equipment', 'cost_center'].includes(str(n.data.level)) && n.data.status !== 'inactive',
        )) {
            const path = await nodePath(ctx.orgId, n.id);
            if (!canAt(ctx, 'MNT.view', path, scope)) continue;
            const site = nodes.find((s) => s.data.level === 'site' && path.includes(s.id));
            items.push({ id: n.id, name: str(n.data.name), code: str(n.data.code), siteId: site?.id || '', level: str(n.data.level) });
        }
        const mappings = await listDocs(`${root(ctx)}/maintenance_line_mappings`);
        return {
            nodes: items,
            mappings: mappings.map((m) => ({ equipmentId: m.id, ...m.data })),
            canEdit: ctx.role === 'org_super_admin' || hasPerm(ctx.directPermissions, 'ADM.structure') || canAnywhere(ctx, 'MNT.admin'),
        };
    }
    if (action === 'catalog_spec') {
        await order(ctx, b.code);
        const spec = await catalogItemSpec(b.kind === 'services' ? 'services' : 'materials', str(b.catalogCode));
        if (!spec) throw new HttpError(404, 'Catalogue specification not found.');
        return { spec };
    }
    if (action === 'workspace') {
        const scope = await scopeOf(ctx),
            wos = (await listDocs(`${root(ctx)}/work_orders`)).filter((w) => canAt(ctx, 'MNT.view', recordPath(w), scope));
        const windows = (await listDocs(`${root(ctx)}/maintenance_windows`)).filter((w) =>
            canAt(ctx, 'MNT.view', texts(w.data.path), scope),
        );
        const items: Obj[] = [];
        for (const w of wos) {
            let line: Obj = {};
            try {
                line = await productionLine(ctx, w);
            } catch {}
            items.push({
                code: w.id,
                title: w.data.title,
                status: w.data.status,
                unitId: str(w.data.unitId),
                unitCode: str(w.data.unitCode),
                unitName: str(w.data.unitName),
                scheduledStart: str(w.data.scheduledStart),
                scheduledEnd: str(w.data.scheduledEnd),
                windowId: str(w.data.windowId),
                line,
                siteId: w.data.siteId,
                tasks: tasksOf(w),
                taskPlanning: object(w.data.taskPlanning),
                taskWindows: object(w.data.taskWindows),
            });
        }
        return {
            orders: items,
            windows: windows.map((w) => ({
                id: w.id,
                ...w.data,
                liveSchedule: executionSchedule(w, wos),
                progress: rows(w.data.tasks).length
                    ? Math.round(
                          (100 *
                              rows(w.data.tasks).filter(
                                  (s) =>
                                      object(object(wos.find((wo) => wo.id === s.woCode)?.data.taskExecution)[str(s.taskId)]).status ===
                                      'completed',
                              ).length) /
                              rows(w.data.tasks).length,
                      )
                    : 0,
            })),
        };
    }
    if (action === 'read') {
        const wo = await order(ctx, b.code),
            readinessData = await readiness(ctx, wo),
            permissions: Obj = {};
        for (const [key, perm, gate] of [
            ['reconcile', 'MNT.view', 'MNT.SPARES.RECONCILE'],
            ['assess', 'MNT.view', 'MNT.WR.ASSESS'],
            ['reviewAssessment', 'MNT.assessment.review', 'MNT.ASSESS.REVIEW'],
            ['plan', 'MNT.WO.plan', 'MNT.WO.PLAN'],
            ['execute', 'MNT.WO.execute', 'MNT.TASK.FEEDBACK'],
            ['safety', 'MNT.WO.safety', 'MNT.SAFETY.SIGNOFF'],
            ['handover', 'MNT.WO.verify', 'MNT.HANDOVER'],
            ['close', 'MNT.WO.close', 'MNT.WO.TECHNICAL_CLOSE'],
        ]) {
            try {
                // Assessment is intentionally open to employees who can view the
                // work order at their organizational scope. Conversion, planning,
                // execution, approvals and closure remain role-gated.
                if (key === 'assess') await maintenancePermission(ctx, 'MNT.assessment.edit', recordPath(wo));
                else if (key === 'reviewAssessment') {
                    if(str(wo.data.status)!=='planning'||([str(wo.data.createdBy),str(wo.data.assessmentTasksBy)].includes(ctx.uid)&&!bypass(ctx,'mnt.assessment.review_independence')))throw new Error('Not independently reviewable');
                    await maintenancePermission(ctx, 'MNT.assessment.review', recordPath(wo));
                    await requireMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo));
                }
                else await authority(ctx, wo, perm, gate);
                permissions[key] = true;
            } catch {
                permissions[key] = false;
            }
        }
        permissions.cancel =
            ['planning', 'plan_ready', 'released', 'scheduled'].includes(str(wo.data.status)) &&
            canAt(ctx, 'MNT.WO.cancel', recordPath(wo), await scopeOf(ctx));
        const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) });
        const workflow=await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
        const reviewRole=str(object(workflow?.data.approverRoles)['MNT.ASSESS.REVIEW']);
        return {
            wo: { code: wo.id, ...wo.data, assessmentReviewCurrent: !!reviewRole && assessmentReviewCurrent(wo.data,reviewRole) },
            readiness: readinessData,
            checklist: await planChecklist(ctx, wo, readinessData),
            currency: str(ctx.org.data.currencyCode),
            permissions,
            currentUserId: ctx.uid,
            people: users
                .filter((u) => u.data.orgId === ctx.orgId && u.data.status !== 'disabled')
                .map((u) => ({ id: u.id, name: [str(u.data.firstName), str(u.data.lastName)].join(' ') })),
            issues: (await listDocs(`${root(ctx)}/goods_issues`))
                .filter((i) => i.data.workOrderId === wo.id)
                .map((i) => ({ id: i.id, ...i.data })),
            incidents: (await listDocs(`${root(ctx)}/safety_incidents`))
                .filter((i) => i.data.woCode === wo.id)
                .map((i) => ({ id: i.id, ...i.data })),
        };
    }
    // Serializes the read/validate/write sequence across task, window and closure mutations.
    return withLock(ctx.orgId, 'maintenance_operations', async () => {
        if (action === 'map_line') {
            const equipmentId = identifier(b.equipmentId),
                lineId = identifier(b.lineId),
                equipment = await getDoc(`${root(ctx)}/structure/${equipmentId}`),
                line = await getDoc(`${root(ctx)}/structure/${lineId}`);
            if (
                !equipment ||
                !line ||
                !['work_center', 'equipment'].includes(str(equipment.data.level)) ||
                !['work_center', 'equipment', 'cost_center'].includes(str(line.data.level))
            )
                throw new HttpError(400, 'Select existing equipment and a production-line node.');
            const a = await nodePath(ctx.orgId, equipmentId),
                z = await nodePath(ctx.orgId, lineId),
                scope = await scopeOf(ctx);
            const authorized = (path: string[]) =>
                ctx.role === 'org_super_admin' ||
                canAt(ctx, 'MNT.admin', path, scope) ||
                (hasPerm(ctx.directPermissions, 'ADM.structure') && (scope === 'all' || scope.has(path[path.length - 1])));
            if (!authorized(a) || !authorized(z))
                throw new HttpError(403, 'Maintenance administration or Organization design authority is required for both nodes.');
            const site = (await listDocs(`${root(ctx)}/structure`)).find((n) => n.data.level === 'site' && a.includes(n.id));
            if (!site || !z.includes(site.id)) throw new HttpError(400, 'Equipment and its production line must belong to the same site.');
            const live = (await listDocs(`${root(ctx)}/work_orders`)).some(
                (w) =>
                    w.data.unitId === equipmentId &&
                    !['closed', 'cancelled'].includes(str(w.data.status)) &&
                    Object.values(object(w.data.taskExecution)).some((e) => object(e).startedAt),
            );
            if (live) throw new HttpError(409, 'Complete active maintenance before changing this equipment production-line association.');
            const reason = requiredText(b.note, 'Production-line mapping reason', 10),
                path = `${root(ctx)}/maintenance_line_mappings/${equipmentId}`,
                prior = await getDoc(path);
            const mappingWrites: Write[] = [
                {
                    path,
                    fields: {
                        equipmentId,
                        lineId,
                        siteId: site.id,
                        version: (Number(prior?.data.version) || 0) + 1,
                        updatedAt: nowIso(),
                        updatedBy: ctx.uid,
                        reason,
                    },
                    ...(prior ? { updateTime: prior.updateTime } : { exists: false }),
                },
            ];
            const affectedOrders = new Set(
                (await listDocs(`${root(ctx)}/work_orders`)).filter((wo) => wo.data.unitId === equipmentId).map((wo) => wo.id),
            );
            for (const window of await listDocs(`${root(ctx)}/maintenance_windows`))
                if (
                    !['completed'].includes(str(window.data.status)) &&
                    texts(window.data.workOrderIds).some((id) => affectedOrders.has(id))
                )
                    mappingWrites.push({
                        path: `${root(ctx)}/maintenance_windows/${window.id}`,
                        fields: {
                            ...window.data,
                            status: 'draft',
                            engineering: null,
                            safety: null,
                            approvedReport: null,
                            revision: (Number(window.data.revision) || 0) + 1,
                            lineAssociationChanged: true,
                            history: history(ctx, window.data, 'Production line association changed; replan and reapprove', reason),
                        },
                        updateTime: window.updateTime,
                    });
            await commit(mappingWrites);
            await event(ctx, 'production_line.mapped', equipmentId, lineId + ' · ' + reason);
            return { ok: true };
        }
        if (
            [
                'save_window',
                'preview_window',
                'approve_engineering',
                'approve_safety',
                'authorize_window',
                'safety_prerequisite',
                'window_report',
                'reject_window',
            ].includes(action)
        )
            return windowAction(ctx, action);
        const wo = await order(ctx, b.code);
        if (['match_spare', 'candidate', 'reserve', 'procure', 'secure_spare', 'service_sourcing', 'secure_service', 'allocate'].includes(action))
            return resourceAction(ctx, wo, action);
        if (['lock_schedule', 'review_risk', 'submit_cost', 'confirm_readiness'].includes(action)) return planningAction(ctx, wo, action);
        return executeMaintenanceAction(ctx, wo, action);
    });
}
export const maintenanceOperationRoutes = {
    // prettier-ignore
    'POST /api/org/mnt/operations': [
        orgRoute('org.mnt.operations', 'MNT.view', maintenanceOperations),
    ],
};
