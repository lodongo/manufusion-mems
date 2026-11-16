import {serviceJustification,validateServiceJustification,SERVICE_JUSTIFICATION_GATE,SERVICE_JUSTIFICATION_PERMISSION} from './maintenanceServiceJustification';
import {expectedDates,protectExpectedDates,expectedDatesLocked,expectedDateCompletionPatch} from './maintenanceExpectedDates';
import {summarizeWorkOrderReview} from './maintenanceStatusReview';
import {capacityForWindow,capacityContext,windowTeamAvailability} from './maintenanceCapacity';
import {levelResources} from './maintenanceResourceLeveling';
import {getMaintenanceCycle,validateCycleDates,localDate,validateStartDateMove,startDateMoves} from './maintenanceCycle';
import {stateOf,transitionPatch,shortWorkOrderStatus,type FactSet} from './maintenanceWorkflowState';
import {responsibilityData,responsibilityFor,groupFields,approvalPreviewFor} from './maintenanceResponsibility';
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
import { maintenancePermission, requireMaintenanceRole, configuredMaintenanceRole, requireWorkOrderAssessor } from './maintenanceAccess';
import {groupAt,groupGateRole,outsideExecutionAccess,loadWorkGroupPolicy,workGroupGateAllowed} from './maintenanceWorkGroupPolicy';
import { workGroupResourcePool, requireOutsideGroupOptIn } from './maintenanceWorkGroups';
import { assessmentReviewCurrent,maintenanceAssessmentReady } from './maintenanceAssessmentReview';
import {maintenanceAssessmentApprovalRequired,configuredOrderApprovalStage,technicalClosureApprovalRequired,readMaintenancePolicySnapshot} from './maintenanceGovernancePolicy';
import {approveStage,requireStageApproval,stageApprovalCurrent,stageApprovalPending,stageReached,STAGE_LABELS} from './maintenanceStageApproval';
import {decideMaintenanceFlow,flowPlain} from './maintenanceApprovalFlow';
import {approvalInput} from './maintenanceApprovalFlowCore';
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
import { DEFAULT_MODULE_METADATA } from './moduleDefaults';
import { storage } from './platform/sdk';
import { signedUrl } from './structure';
import { budgetStatus, costApprovalOf, estimateOf, periodOf, submitCost } from './maintenancePlanning';
import {
    closurePrerequisites,
    isRequestClosureOrder,
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
    const at=nowIso(),stopping=Object.entries(object(patch.taskExecution)).filter(([id,value])=>['blocked','awaiting_feedback','completed'].includes(str(object(value).status))&&object(object(wo.data.taskExecution)[id]).status!==object(value).status).map(([id])=>id);
    const timed:Write[]=[];
    if(stopping.length){const entries=await runQuery({from:[{collectionId:'maintenance_time_bookings'}],where:fieldEq('woCode',wo.id)},root(ctx));for(const d of entries){if(d.data.status!=='running'||!stopping.includes(str(d.data.taskId)))continue;const start=Date.parse(str(d.data.start)),end=Date.parse(at),valid=Number.isFinite(start)&&end>start&&end-start<=36*3600000;timed.push({path:root(ctx)+'/maintenance_time_bookings/'+d.id,fields:{...d.data,end:at,status:valid?(d.data.approvalRequired===true?'pending_approval':'recorded'):'needs_review',stopReason:'physical_activity_state_changed',stoppedAt:at,systemStopped:true,stopNote:action},updateTime:d.updateTime});}}
    await commit([
        ...timed,
        {
            path: `${root(ctx)}/work_orders/${wo.id}`,
            fields: { ...wo.data, ...patch,...groupFields(ctx.workGroupPolicy,recordPath(wo)), updatedAt: nowIso(), history: history(ctx, wo.data, action, note) },
            updateTime: wo.updateTime,
        },
    ]);
    await event(ctx, action, wo.id, note);
    await syncOrderAfter(ctx,wo.id,action);
}
async function order(ctx: OrgContext, code: unknown) {
    const id = identifier(code);
    if (!/^WO\d{8}(?:_[1-9]\d{0,8})?$/.test(id)) throw new HttpError(400, 'Choose a work order.');
    const wo = await getDoc(`${root(ctx)}/work_orders/${id}`);
    if (!wo) throw new HttpError(404, 'Work order not found.');
    if(!outsideExecutionAccess(ctx.workGroupPolicy,wo))await maintenancePermission(ctx, 'MNT.view', recordPath(wo));
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
    if (!/^WO\d{8}(?:_[1-9]\d{0,8})?$/.test(id)) throw new HttpError(409, 'Invalid window work order.');
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
        ...(wos.some(w=>groupAt(ctx.workGroupPolicy,recordPath(w)))?{workGroupRevisions:wos.map(w=>groupGateRole(ctx.workGroupPolicy,'MNT.ASSESS.REVIEW',recordPath(w)))}:{}),
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
    if(isRequestClosureOrder(wo.data)&&action!=='close')throw new HttpError(409,'Use safety sign-off to close the linked work order. Create a break-in sub-order for additional work.');
    // The task-based engine is authoritative. Old flat-order mutation endpoints cannot bypass it.
    if(['save_plan','save_safety','start','complete','verify','reopen'].includes(action))
        throw new HttpError(409,'Use the Work Order task assessment, readiness, execution feedback and safety sign-off. Additional work uses a break-in sub-order.');
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
        await requireMaintenanceRole(ctx, 'MNT.SAFETY.SIGNOFF', recordPath(wo));
        closurePrerequisites(wo.data);
        if(!isRequestClosureOrder(wo.data))for (const t of tasksOf(wo)) await requireApprovedWindow(ctx, wo, str(t.id));
    }
    if (action === 'cancel')throw new HttpError(409,'Use the controlled cancellation handler.');
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
        if(object(t.externalResource).type&&!object(planning.externalSpecialist).at)problems.push(`${str(t.description)}: secure external specialist and record availability evidence.`);
        for (const s of rows(t.services)) {
            const p = object(planning[str(s.id)]),justification=serviceJustification(wo.data,t,s);
            const procurement = str(p.requirementId) ? trace.get(str(p.requirementId)) : undefined;
            let orderLive = false;
            if (p.status === 'secured' && str(p.poId)) {
                const po = await getDoc(`${root(ctx)}/procurement_orders/${identifier(p.poId)}`);
                orderLive = !!po && ['open', 'sent', 'partial', 'full'].includes(str(po.data.status));
            }
            const justificationReady=!justification.required||justification.status==='approved';
            const ready = p.status === 'secured' && orderLive&&justificationReady;
            const orderReady = procurement ? rows(procurement.orders).find((o) => o.live === true) ?? null : null;
            const status = !justificationReady?'awaiting_justification_approval':ready
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
            items.push({ taskId: t.id, serviceId: s.id, kind: 'service', ...p,justification, description:str(s.description), status, procurement: procurement ?? null, orderReady });
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
    const expected=expectedDates(wo.data),expectedPeriod=periodOf(expected.expectedStart);
    const expectedBudget=expected.expectedStart?(expectedPeriod===period?budget:await budgetStatus(ctx.orgId,str(wo.data.costCenterId),expectedPeriod,wo.id)):null;
    const lock = object(wo.data.scheduleLock);
    const riskReview = object(wo.data.riskReview);
    const version = Number(wo.data.assessmentTasksVersion) || 0;
    const spares = r.items.filter((i) => i.spareId);
    const services = r.items.filter((i) => i.kind === 'service');
    const items = [
        { key: 'spares', label: 'Spares available and reserved', done: spares.every((i) => i.status === 'reserved'), detail: `${spares.filter((i) => i.status === 'reserved').length} of ${spares.length} reserved` },
        { key: 'services', label: 'Services engaged with procurement and secured', done: services.every((i) => i.status === 'secured'), detail: `${services.filter((i) => i.status === 'secured').length} of ${services.length} secured` },
        {key:'external_specialist',label:'External specialists secured',done:!r.problems.some(p=>p.includes('secure external specialist')),detail:''},
        { key: 'people', label: 'People and tools allocated', done: !r.problems.some((p) => p.includes('allocate qualified personnel')), detail: '' },
        { key: 'schedule', label: 'Schedule dates reviewed and locked', done: !!lock.at && lock.start === wo.data.scheduledStart && lock.end === wo.data.scheduledEnd, detail: `${str(wo.data.scheduledStart) || 'no start'} to ${str(wo.data.scheduledEnd) || 'no end'}` },
        { key: 'risk', label: 'Risk assessment reviewed from the assessment', done: !!riskReview.at && Number(riskReview.version) === version, detail: str(riskReview.note) },
        { key: 'cost', label: 'Estimated cost approved (Chart of Authority)', done: cost.current, detail: est.total === 0 ? 'Nothing to approve' : `${cost.status}` },
    ];
    return { items, estimate: est, cost, budget, expectedBudget, expectedDates:expected, problems: r.problems, ready: items.every((i) => i.done) && r.ready };
}

/** Evaluate on each successful maintenance mutation and on read. External changes are observed from live source records. */
export async function syncWorkOrderState(ctx:OrgContext,doc:Doc,source='refresh'):Promise<Doc>{
 let wo=doc;
 for(let attempt=0;attempt<3;attempt++){
  const d=wo.data,status=str(d.status),facts:FactSet={};
  if(!isRequestClosureOrder(d)&&['planning','plan_ready','released','scheduled'].includes(status)){
    const settings=await getDoc(root(ctx)+'/maintenance_workflow_settings/default'),token=configuredMaintenanceRole({...ctx,testMode:false},'MNT.ASSESS.REVIEW',recordPath(wo),settings?.data.approverRoles);
    facts.approved=maintenanceAssessmentReady(d,token);
    if(facts.approved){const ready=await readiness(ctx,wo),check=await planChecklist(ctx,wo,ready);facts.items=ready.items;facts.checklist=check.items;facts.costStatus=check.cost.status;}
  }
  if(!isRequestClosureOrder(d)&&['scheduled','in_progress'].includes(status)){
    const pending=tasksOf(wo).filter(t=>object(object(d.taskExecution)[str(t.id)]).status!=='completed');
    facts.windowStatus='ready';
    for(const t of pending){const tid=str(t.id),win=str(object(object(d.taskExecution)[tid]).windowId)||str(object(d.taskWindows)[tid])||str(d.windowId);if(!win){facts.windowStatus='missing';break;}try{await requireApprovedWindow(ctx,wo,tid);}catch{facts.windowStatus='blocked';}}
  }
  if(object(d.earlyClosureRequest).at&&!['closed','cancelled'].includes(status))facts.openIncident=(await listDocs(root(ctx)+'/safety_incidents')).some(i=>i.data.woCode===wo.id&&i.data.status!=='cleared');
  if(!object(d.earlyClosureRequest).at&&['completed','verified','in_progress'].includes(status)&&tasksOf(wo).length&&tasksOf(wo).every(t=>object(object(d.taskExecution)[str(t.id)]).status==='completed')){
    facts.openIncident=(await listDocs(root(ctx)+'/safety_incidents')).some(i=>i.data.woCode===wo.id&&i.data.status!=='cleared');
    if(!isRequestClosureOrder(d)&&tasksOf(wo).every(t=>object(object(d.taskExecution)[str(t.id)]).reconciled===true)){
        try{await ensureClosureResources(ctx,wo);}catch(e){if(!(e instanceof HttpError))throw e;const reason=e.message;facts.closureResource={code:/service report|service feedback/i.test(reason)?'WO185':/service acceptance|service receipt/i.test(reason)?'WO187':/reconcil/i.test(reason)?'WO180':'WO186',reason};}
    }
  }
  const state=stateOf(d,facts),patch=transitionPatch(d,state,nowIso(),source==='refresh'?'SYSTEM':ctx.uid,source==='refresh'?'System observation':name(ctx),source);
  if(d.workflowCode===patch.workflowCode&&d.workflowReason===patch.workflowReason&&d.workflowLabel===patch.workflowLabel&&d.workflowSince===patch.workflowSince&&(d.workflowStatusCode===patch.workflowStatusCode||['closed','cancelled'].includes(status)))return wo;
  try{await commit([{path:root(ctx)+'/work_orders/'+wo.id,fields:patch,mask:Object.keys(patch),updateTime:wo.updateTime}]);return {...wo,data:{...d,...patch}};}
  catch(e){const latest=await getDoc(root(ctx)+'/work_orders/'+wo.id);if(!latest||attempt===2)throw e;wo=latest;}
 }
 return wo;
}
export async function syncOrderAfter(ctx:OrgContext,id:string,source:string){
 if(!/^WO\d{8}(?:_[1-9]\d{0,8})?$/.test(id))return;
 try{const fresh=await getDoc(root(ctx)+'/work_orders/'+id);if(!fresh)return;const policy=ctx.workGroupPolicy||await loadWorkGroupPolicy(ctx.orgId,ctx.me);await syncWorkOrderState({...ctx,workGroupPolicy:policy},fresh,source);}catch(e){console.error('Maintenance status refresh failed',id,source,e);}
}
export async function syncProcurementOrderStates(ctx:OrgContext,ids:string[],source:string){
 const reqs=new Set(ids.filter(id=>/^REQ\d{9}$/.test(id)));if(!reqs.size)return;
 try{const whos=new Set<string>();for(const l of await listDocs(root(ctx)+'/mnt_supply_links'))if(reqs.has(str(l.data.requirementId)))whos.add(str(l.data.woCode));
 for(const wo of await listDocs(root(ctx)+'/work_orders'))if(!['closed','cancelled'].includes(str(wo.data.status))&&Object.values(object(wo.data.taskPlanning)).some(t=>Object.values(object(t)).some(r=>reqs.has(str(object(r).requirementId)))))whos.add(wo.id);
 for(const id of whos)await syncOrderAfter(ctx,id,source);}catch(e){console.error('Maintenance procurement status observation failed',source,e);}
}
/** Planner actions on the readiness checklist. */
async function planningAction(ctx: OrgContext, wo: Doc, action: string) {
    if (!['planning', 'plan_ready'].includes(str(wo.data.status))) throw new HttpError(409, 'The work order is no longer in planning.');
    await authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
    await requireStageApproval(ctx,wo,'before_assessment');
    const settings = await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
    const jobRole = configuredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo),settings?.data.approverRoles);
    if (!maintenanceAssessmentReady(wo.data, jobRole))
        throw new HttpError(409, 'Approve the latest work assessment through the configured reviewer before planning.');
    const b = ctx.body;
    if (action === 'lock_schedule') {
        const start = requiredText(b.scheduledStart, 'Scheduled start', 10, 10),
            end = requiredText(b.scheduledEnd, 'Scheduled end', 10, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))
            throw new HttpError(400, 'Enter the scheduled dates as YYYY-MM-DD.');
        if (end < start) throw new HttpError(400, 'The scheduled end cannot be before the start.');
        const cycle=await getMaintenanceCycle(ctx);
        validateCycleDates(str(wo.data.maintenanceTypeCode),start,end,cycle,wo.data);
        const moves=validateStartDateMove(wo.data,start);
        const baseline=protectExpectedDates(wo.data,b);
        const changed = start !== wo.data.scheduledStart || end !== wo.data.scheduledEnd;
        const reason = str(b.note).trim().slice(0, 300);
        if (changed && reason.length < 10) throw new HttpError(400, 'Explain why the dates change (at least 10 characters).');
        const ca = object(wo.data.costApproval);
        // A move to another budget period needs a new cost approval against that period's budget.
        const periodMoved = periodOf(start) !== periodOf(str(wo.data.scheduledStart));
        await saveWo(ctx, wo, {
            ...baseline,scheduledStart: start, scheduledEnd: end,startDateMoves:moves,
            ...(start!==str(wo.data.scheduledStart)?{currentCycleAdmission:{startDay:cycle.startDay,timeZone:cycle.timeZone,version:cycle.version,at:nowIso()}}:{}),
            dateChanges:changed?[...rows(wo.data.dateChanges),{at:nowIso(),by:ctx.uid,name:name(ctx),fromStart:str(wo.data.scheduledStart),fromEnd:str(wo.data.scheduledEnd),toStart:start,toEnd:end,reason}]:rows(wo.data.dateChanges),
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
        if(groupAt(ctx.workGroupPolicy,recordPath(wo)))await requireMaintenanceRole(ctx,'MNT.WO.RELEASE',recordPath(wo));
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
async function decideExternalService(ctx:OrgContext,wo:Doc,action:string){
 const d=wo.data,b=ctx.body,path=recordPath(wo);
 if(!['planning','plan_ready'].includes(str(d.status))||object(d.earlyClosureRequest).at||d.assessmentDraft)throw new HttpError(409,'Submit the assessment before reviewing external service justification.');
 const task=tasksOf(wo).find(t=>str(t.id)===str(b.taskId)),service=task&&rows(task.services).find(s=>str(s.id)===str(b.resourceId));
 if(!task||!service)throw new HttpError(400,'Choose an assessed external service.');
 const j=serviceJustification(d,task,service),planning=object(object(object(d.taskPlanning)[str(task.id)])[str(service.id)]);
 if(!j.required)throw new HttpError(409,'This is a historical service without the new justification policy.');
 if(planning.requirementId||planning.sourcing||planning.status==='secured')throw new HttpError(409,'Service sourcing already exists. Use controlled reassessment to alter the approved scope.');
 const all=object(d.externalServiceJustifications),byTask=object(all[str(task.id)]),old=object(byTask[str(service.id)]);
 let next:Obj;
 if(action==='revise_service_justification'){
   await maintenancePermission(ctx,'MNT.assessment.edit',path);
   if(groupAt(ctx.workGroupPolicy,path))await requireMaintenanceRole(ctx,'MNT.WR.ASSESS',path);
   if(j.status==='approved')throw new HttpError(409,'Approved justification is locked. Use controlled reassessment.');
   const revision=validateServiceJustification(b.reasons,b.explanation);
   next={...revision,submittedBy:ctx.uid,submittedAt:nowIso(),decision:null,history:[...rows(old.history),...(j.decision?[j.decision]:[])]};
 }else{
   await authority(ctx,wo,SERVICE_JUSTIFICATION_PERMISSION,SERVICE_JUSTIFICATION_GATE);
   if([j.submittedBy,str(d.assessmentTasksBy),str(d.assessedBy)].includes(ctx.uid))throw new HttpError(403,'The assessment or justification author cannot approve their own external service.');
   if(j.status!=='pending')throw new HttpError(409,'Only a pending justification can be decided. Returned items must be revised.');
   validateServiceJustification(j.reasons,j.explanation);
   const note=requiredText(b.note,'Technical manager decision note',10,500);
   const {role}=await requireMaintenanceRole(ctx,SERVICE_JUSTIFICATION_GATE,path);
   next={...old,decision:{status:action==='approve_service_justification'?'approved':'returned',signature:j.signature,by:ctx.uid,name:name(ctx),role,at:nowIso(),note}};
 }
 await saveWo(ctx,wo,{externalServiceJustifications:{...all,[str(task.id)]:{...byTask,[str(service.id)]:next}}},'service.justification.'+action,str(service.description));return {ok:true};
}
async function resourceAction(ctx: OrgContext, wo: Doc, action: string) {
     await requireStageApproval(ctx,wo,'before_assessment');
     const settings=await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
     const jobRole=configuredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo),settings?.data.approverRoles);
     if(!maintenanceAssessmentReady(wo.data,jobRole))
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
    if(service&&['service_sourcing','procure','secure_service'].includes(action)){const j=serviceJustification(wo.data,task,service);if(j.required&&j.status!=='approved')throw new HttpError(409,'Technical manager approval of this external service justification is required before sourcing or procurement.');}
    let state: Obj = { ...previous },
        result: Obj = {};
    if(action==='confirm_external_specialist'){
        const ext=object(task.externalResource);if(!ext.type)throw new HttpError(400,'This task does not require an external specialist.');
        const persons=Number(b.persons);if(!Number.isInteger(persons)||persons<Number(ext.persons)||persons>50)throw new HttpError(400,'Confirm sufficient specialist personnel.');
        const date=requiredText(b.availableDate,'Confirmed availability date',10,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new HttpError(400,'Choose a valid availability date.');
        const externalSpecialist={provider:requiredText(b.provider,'Specialist provider'),reference:requiredText(b.reference,'Booking / contract / order reference'),persons,availableDate:date,note:requiredText(b.note,'Confirmation evidence',5),at:nowIso(),by:ctx.uid,name:name(ctx)};
        await saveWo(ctx,wo,{taskPlanning:{...planning,[str(task.id)]:{...p,externalSpecialist}}},'task.external_specialist.confirmed',str(task.id));return {ok:true};
    }
    if (action === 'allocate') {
        const ids = [...new Set(texts(b.personnel))];
        if (ids.length < Number(task.persons) || ids.length > 50) throw new HttpError(400, 'Allocate enough personnel for this task.');
        const pool = await workGroupResourcePool(ctx.orgId, wo);
        const outside = requireOutsideGroupOptIn(ids, pool.people, b.includeOutsideGroup);
        const executionPool=await capacityContext(ctx);if(executionPool.active&&ids.some(id=>!executionPool.artisans.some(a=>a.id===id)))throw new HttpError(409,'All assigned employees must hold an active maintenance execution role.');
        for (const id of ids) identifier(id);
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
                            workGroupId: pool.group?.id || '',
                            workGroupCode: pool.group?.code || '',
                            workGroupVersion: pool.group?.version || 0,
                            outsideGroupPersonnel: outside,
                            outsideGroupOptIn: outside.length > 0,
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
            (pool.group?.code || 'No work group configured') + (outside.length ? ' · Outside group (explicitly selected): ' + outside.join(', ') : ' · Work group team only'),
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
                await createMaintenanceRequirement(ctx, { glCode: b.glCode, dateRequired: b.dateRequired || str(spare.requiredDate) || expectedDates(wo.data).expectedStart, urgency: b.urgency, budget: b.budget ?? null }, { key, woCode: wo.id, taskId: task.id, resourceId: spare.id });
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
                        dateRequired: b.dateRequired || str(spare.requiredDate) || expectedDates(wo.data).expectedStart,
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
            const shortlist=[...new Set([vendor.id,...texts(b.shortlistedVendorIds)])];if(shortlist.length>3)throw new HttpError(400,'Shortlist up to three qualified vendors, including the preferred vendor.');
            const shortlistedVendors=await Promise.all(shortlist.map(id=>requireQualifiedVendor(ctx.orgId,identifier(id),q)));
            state = {
                ...state,
                status: 'sourcing_confirmed',
                sourcing: { supplierCategory: category.code, supplierCategoryLabel: category.label, preferredVendorId: vendor.id, preferredVendorName: vendor.name, shortlistedVendorIds:shortlist,shortlistedVendors:shortlistedVendors.map(v=>({id:v.id,name:v.name})), manufacturerMatch: vendor.manufacturerMatch, by: ctx.uid, at },
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
        const executionDate=str(b.dateRequired)||str(previous.executionDate)||str(service.executionDate)||str(wo.data.scheduledStart)||expectedDates(wo.data).expectedStart;
        const plannedEstimate=b.budget===undefined||b.budget===null||b.budget===''?previous.expectedCost??service.expectedCost??null:Number(b.budget);
        if(plannedEstimate!==null&&(!Number.isFinite(Number(plannedEstimate))||Number(plannedEstimate)<0))throw new HttpError(400,'Enter a valid non-negative service estimate.');
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
                dateRequired: executionDate,
                urgency: ['low', 'medium', 'high'].includes(str(b.urgency)) ? b.urgency : 'medium',
                costCenterId: str(wo.data.costCenterId),
                glCode: b.glCode,
                budget: plannedEstimate,
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
                executionDate,
                costCenterId: str(wo.data.costCenterId),
                planningGroup: planningGroup(wo),
                attachments: texts(service.attachments),
                proposedVendors: await Promise.all(
                    (str(sourcing.preferredVendorId)?[...new Set([str(sourcing.preferredVendorId),...texts(sourcing.shortlistedVendorIds)])]:[]).map(async (id) => {
                        const vendor = await requireQualifiedVendor(ctx.orgId,id,{supplierCategory:str(sourcing.supplierCategory),categoryCode:str(service.categoryCode),subcategoryCode:str(service.subcategoryCode),make:await equipmentMake(ctx.orgId,wo)});
                        return { id, name: vendor.name };
                    }),
                ),
            },
        );
        state = { ...state, requirementId, executionDate, expectedCost:plannedEstimate, status: 'awaiting_procurement' };
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date) throw new HttpError(400, 'Choose a valid window date.');
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
        await authority(ctx, wo, 'MNT.WO.schedule', groupGateRole(ctx.workGroupPolicy,'MNT.WINDOW.LOCK',recordPath(wo))!==null?'MNT.WINDOW.LOCK':'MNT.WO.PLAN');
        if (str(wo.data.unitId) !== equipmentId) throw new HttpError(400, `${id} is on other equipment (${str(wo.data.unitCode)}).`);
        const inThis = !!existing && texts(existing.data.workOrderIds).includes(id);
        if (!(str(wo.data.status) === 'released' || (inThis && str(wo.data.status) === 'scheduled')))
            throw new HttpError(409, `${id}: the planner must confirm readiness on the work order first.`);
        if(object(wo.data.earlyClosureRequest).at)throw new HttpError(409,'Work order is pending early closure.');
        await requireStageApproval(ctx,wo,'before_assessment');
        await requireStageApproval(ctx,wo,'after_readiness');
        const ready = await readiness(ctx, wo);
        if (!ready.ready) throw new HttpError(409, `${id} is no longer ready: ${ready.problems.slice(0, 3).join(' ')}`);
        wos.push(wo);
    }
    // Tasks: every not-started task of the chosen work orders. People allocated to several tasks do them in turn.
    const selected: ScheduleTask[] = [];
    const offsets=object(b.manualOffsets);
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
            const taskKey=wo.id+'_'+str(t.id),offset=offsets[taskKey]===undefined?0:Number(offsets[taskKey]);if(!Number.isFinite(offset)||offset<0||offset>durationHours||Math.abs(offset*4-Math.round(offset*4))>1e-6)throw new HttpError(400,'Choose a valid quarter-hour earliest start inside the window.');
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
    const constraints=await windowTeamAvailability(ctx,start,durationHours,selected.map(t=>({...t,path:recordPath(wos.find(w=>w.id===t.woCode)!)})) as unknown as Obj[],existing?.id||'');
    const levelled=levelResources(selected,durationHours,constraints),schedule=levelled.schedule;
    selected.splice(0,selected.length,...levelled.tasks);
    const needed = Math.max(...schedule.tasks.map((t) => t.finish));
    const cycle=await getMaintenanceCycle(ctx);
    for(const t of schedule.tasks){const w=wos.find(x=>x.id===t.woCode);if(!w||!w.data.cycleAdmission)continue;const zone=str(object(w.data.currentCycleAdmission).timeZone)||str(object(w.data.cycleAdmission).timeZone)||cycle.timeZone,a=localDate(new Date(Date.parse(start)+t.start*3600000),zone),z=localDate(new Date(Date.parse(start)+t.finish*3600000-1),zone);if(a<str(w.data.scheduledStart)||z>str(w.data.scheduledEnd))throw new HttpError(409,w.id+': the task falls outside the Work Order start/end dates. Change and reconfirm the plan before scheduling.');}
    const capacity=await capacityForWindow(ctx,start,schedule.tasks.map(t=>({...t,path:texts(wos.find(w=>w.id===t.woCode)?.data.path)})) as unknown as Obj[],existing?.id||'');
    if (b.action === 'preview_window') return { schedule:{...schedule,conflicts:[...schedule.conflicts,...capacity.blockers]}, neededHours: needed, start, end,capacityWarnings:capacity.warnings };
    if (needed > durationHours + 1e-6)
        throw new HttpError(409, `The work needs ${Math.round(needed * 100) / 100} h but the window is ${durationHours} h. Lengthen the window or remove a work order.`);
    if(capacity.blockers.length)throw new HttpError(409,capacity.blockers.slice(0,8).join(' '));
    if (schedule.conflicts.length) throw new HttpError(409, schedule.conflicts.join(' '));
    const overrideReason=str(b.capacityOverrideReason).trim().slice(0,500);if(capacity.warnings.length&&overrideReason.length<10)throw new HttpError(409,'Acknowledge capacity warnings with a documented planning reason (10+ characters).');
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
        ...groupFields(ctx.workGroupPolicy,recordPath(wos[0])),
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
        capacityWarnings:capacity.warnings,
        manualOffsets:offsets,
        capacityOverride:capacity.warnings.length?{by:ctx.uid,at:nowIso(),reason:overrideReason,warnings:capacity.warnings}:null,
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
        patches.set(wo.id, { status: str(wo.data.status) === 'in_progress' ? 'in_progress' : 'scheduled', taskWindows: assignments, windowId: id, windowIds: [...new Set([...texts(wo.data.windowIds), id])], windowStart: start, windowEnd: end,windowApprovalRevision:revision });
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
    for(const woId of touched.keys())await syncOrderAfter(ctx,woId,'window.scheduled');
    await event(ctx, 'window.scheduled', id, `${str(equipment.data.code)} ${date} ${startTime} ${durationHours} h · ${ids.join(', ')}${existing ? ' · ' + str(b.reason) : ''}`);
    return { ok: true, windowId: id };
}

// Consolidate the existing independent, role-gated order sign-offs without inventing
// safety evidence. Split-window orders retain the individual closure route.
function windowClosureSummary(w:Doc,wos:Doc[]) {
    const members=texts(w.data.workOrderIds);
    const orders=members.map(id=>wos.find(x=>x.id===id));
    const eligible=w.data.model===EQUIPMENT_WINDOW&&members.length>0&&orders.every(wo=>!!wo&&tasksOf(wo).length>0&&tasksOf(wo).every(t=>rows(w.data.tasks).some(s=>s.woCode===wo.id&&s.taskId===t.id)));
    const fully=orders.filter((wo):wo is Doc=>!!wo);
    return {eligible,ready:eligible&&fully.every(wo=>wo.data.status==='closed'&&wo.data.closureMode==='early'||tasksOf(wo).every(t=>{const e=object(object(wo.data.taskExecution)[str(t.id)]);return e.status==='completed'&&e.reconciled===true;})),
        safety:fully.filter(wo=>wo.data.status==='closed'&&wo.data.closureMode==='early'||!!object(wo.data.safetySignoff).at).length,
        closed:fully.filter(wo=>wo.data.status==='closed').length,total:members.length};
}
async function windowManagedClosure(ctx:OrgContext,wo:Doc){
    if(isRequestClosureOrder(wo.data)||object(wo.data.earlyClosureRequest).at||wo.data.closureMode==='early'||!wo.data.windowId)return false;
    const w=await getDoc(`${root(ctx)}/maintenance_windows/${identifier(wo.data.windowId)}`);
    if(!w)return false;
    const members=await Promise.all(texts(w.data.workOrderIds).map(id=>internalOrder(ctx,id)));
    return windowClosureSummary(w,members).eligible;
}
async function windowAction(ctx: OrgContext, action: string) {
    if (action === 'save_window' || action === 'preview_window') return windowSave(ctx);
    const w = await currentWindow(ctx, ctx.body.windowId),
        c = await windowContext(ctx, w),
        b = ctx.body,
        path = texts(w.data.path);
    if(['window_close_handover','window_close_final'].includes(action))throw new HttpError(409,'Only window safety sign-off is needed for closure.');
    if(action==='window_close_safety'){
        const summary=windowClosureSummary(w,c.wos);
        if(!summary.ready||w.data.status!=='completed')throw new HttpError(409,'Complete and reconcile all work orders before window safety sign-off.');
        const active=c.wos.filter(wo=>wo.data.status!=='closed');
        for(const wo of active){await authority(ctx,wo,'MNT.WO.safety','MNT.SAFETY.SIGNOFF');await ensureClosureResources(ctx,wo);}
        const incidents=(await listDocs(root(ctx)+'/safety_incidents')).filter(i=>c.wos.some(wo=>wo.id===i.data.woCode));
        if(incidents.some(i=>i.data.status!=='cleared'))throw new HttpError(409,'Clear every recorded incident or near miss first.');
        if(active.length&&(incidents.length?b.declaration!=='reported'||b.clearanceConfirmed!==true:b.declaration!=='none'||b.noIncidentsConfirmed!==true))throw new HttpError(400,'Explicitly declare the window incident history.');
        if(!active.length)for(const wo of c.wos)await authority(ctx,wo,'MNT.WO.safety','MNT.SAFETY.SIGNOFF');
        for(const original of active){
            const wo=await internalOrder(ctx,original.id),incident=incidents.find(i=>i.data.woCode===wo.id);
            const body={...b,declaration:incident?'reported':'none',noIncidentsConfirmed:!incident,clearanceConfirmed:!!incident,...(incident?{incidentId:incident.id,classification:incident.data.classification,narrative:incident.data.narrative,occurredAt:incident.data.occurredAt,immediateControls:incident.data.immediateControls}:{})};
            await executeMaintenanceAction({...ctx,body} as OrgContext,wo,'safety_signoff');
        }
        const current=await currentWindow(ctx,w.id);
        if(!object(current.data.finalClosure).at){
            const fresh=await Promise.all(c.wos.map(wo=>internalOrder(ctx,wo.id)));
            if(!fresh.every(wo=>wo.data.status==='closed')){
                if(fresh.every(wo=>wo.data.status==='closed'||!!object(wo.data.technicalClosurePending).at)){
                    const safetyClosure=object(current.data.safetyClosure).at?object(current.data.safetyClosure):{at:nowIso(),by:ctx.uid,name:name(ctx),note:str(b.note),workOrderIds:fresh.map(wo=>wo.id)};
                    await commit([{path:root(ctx)+'/maintenance_windows/'+w.id,fields:{safetyClosure},mask:['safetyClosure'],updateTime:current.updateTime}]);
                    return {ok:true,pendingTechnicalApproval:fresh.filter(wo=>wo.data.status!=='closed').map(wo=>wo.id)};
                }
                throw new HttpError(409,'Every linked work order must be closed.');
            }
            const finalClosure={at:nowIso(),by:ctx.uid,name:name(ctx),note:str(b.note),workOrderIds:fresh.map(wo=>wo.id)};
            await commit([{path:root(ctx)+'/maintenance_windows/'+w.id,fields:{finalClosure,history:history(ctx,current.data,'Maintenance window closed',str(b.note))},mask:['finalClosure','history'],updateTime:current.updateTime}]);
            await event(ctx,'window.closed',w.id,str(b.note));
        }
        return {ok:true};
    }
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

// Same reference registry as Work Request closure.
async function actualClosureChoice(key:string,code:unknown,label:string){
    const db=rows((await getDoc('module_workspaces/MNT/metadata/'+key))?.data.items);
    const items=(db.length?db:rows((DEFAULT_MODULE_METADATA.MNT??[]).find(x=>x.key===key)?.items)).filter(x=>x.active!==false);
    const item=items.find(x=>x.code===code);
    if(!item||item.selectable===false&&items.some(x=>x.category===item.code&&x.selectable!==false))throw new HttpError(400,'Choose the '+label+' from the maintenance reference list.');
    const group=items.find(x=>x.code===item.category);
    return {code:str(item.code),label:str(item.label),group:str(group?.label)||str(item.label)};
}
async function normalClosureFeedback(ctx:OrgContext,wo:Doc,task:Obj,feedback:Obj):Promise<Obj>{
    if(feedback.closureFieldsVersion!==1)return feedback;
    const failure=await actualClosureChoice('failureModes',feedback.failureModeCode,'failure mode');
    const cause=await actualClosureChoice('rootCauses',feedback.causeCode,'failure cause');
    const codes=[...new Set(texts(feedback.solutionCodes))];
    if(!codes.length||codes.length>5)throw new HttpError(400,'Choose one to five solution types.');
    const solutions=await Promise.all(codes.map(code=>actualClosureChoice('solutionTypes',code,'solution type')));
    const minutes=Number(feedback.durationMinutes),date=str(feedback.dateClosed);
    if(!Number.isInteger(minutes)||minutes<=0||minutes>525600)throw new HttpError(400,'Enter actual time in whole minutes.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>new Date(Date.now()+14*3600000).toISOString().slice(0,10)||date<str(wo.data.createdAt).slice(0,10))throw new HttpError(400,'Enter an actual closure date from work order creation up to today.');
    const qualityOutcome=str(feedback.qualityOutcome)||'not_assessed',qualityNote=str(feedback.qualityNote).trim().slice(0,500);if(!['not_assessed','first_pass','rework_completed','follow_up'].includes(qualityOutcome))throw new HttpError(400,'Invalid execution-quality declaration.');if(['rework_completed','follow_up'].includes(qualityOutcome)&&qualityNote.length<5)throw new HttpError(400,'Describe the rework or follow-up.');
    return {...feedback,qualityOutcome,qualityNote,qualitySource:'execution_declaration',failureModeCode:failure.code,failureModeLabel:failure.label,failureModeGroup:failure.group,causeCode:cause.code,causeLabel:cause.label,causeGroup:cause.group,solutions,maintenanceTypeCode:str(task.maintenanceTypeCode)||str(wo.data.maintenanceTypeCode),maintenanceTypeLabel:str(task.maintenanceTypeLabel)||str(wo.data.maintenanceTypeLabel),actualHours:minutes/60,actualMinutes:minutes,dateClosed:date,closedBy:ctx.uid,closedByName:name(ctx)};
}
/** No material or service transaction can be silently ignored by retrospective closure. */
async function ensureClosureResources(ctx:OrgContext,wo:Doc){
    const executions=object(wo.data.taskExecution),planning=object(wo.data.taskPlanning);
    const issues=(await listDocs(root(ctx)+'/goods_issues')).filter(x=>x.data.workOrderId===wo.id);
    const links=(await listDocs(root(ctx)+'/mnt_supply_links')).filter(x=>x.data.woCode===wo.id&&x.data.status==='active');
    const trace=await procurementTrace(ctx.orgId,links.map(x=>str(x.data.requirementId)));
    const orders=await listDocs(root(ctx)+'/procurement_orders');
    const requirePostedReceipt=(req:string)=>{
        for(const po of orders.filter(x=>['open','sent','partial','full'].includes(str(x.data.status)))){
            for(const line of rows(po.data.lines).filter(x=>x.requirementId===req&&x.type!=='service')){
                if((Number(line.receivedQty)||0)+1e-6<Number(line.quantity))throw new HttpError(409,'Purchase order '+po.id+' is not fully received.');
                const posted=rows(po.data.deliveries).filter(x=>x.status==='posted').flatMap(x=>rows(x.lines)).filter(x=>Number(x.no)===Number(line.no)).reduce((n,x)=>n+Number(x.qty||x.quantity||0),0);
                if(posted+1e-6<Number(line.quantity))throw new HttpError(409,'Post the goods receipt for '+po.id+' line '+line.no+'.');
            }
        }
    };
    for(const link of links){
        const p=trace.get(str(link.data.requirementId));
        if(!p||p.open===false||p.stage!=='received'&&p.stage!=='service_accepted')throw new HttpError(409,'Receive and post every linked procurement requirement before closure: '+str(link.data.requirementId));
        if(p.stage==='received')requirePostedReceipt(str(link.data.requirementId));
    }
    for(const issue of issues){
        if(issue.data.finance==='live'&&!str(issue.data.journalId))throw new HttpError(409,'Goods issue '+issue.id+' has not been financially posted.');
        const e=object(executions[str(issue.data.taskId)]);
        if(e.reconciled!==true)throw new HttpError(409,'Reconcile every goods issue before closure.');
        for(const line of rows(issue.data.lines)){
            const c=rows(e.consumption).find(x=>x.issueLineId===issue.id+'_'+line.no);
            if(!c||Math.abs(Number(c.consumed)+Number(c.returned)-Number(line.qty))>1e-6)throw new HttpError(409,'Reconcile all issued and returned quantities: '+issue.id);
            await verifyMaintenanceStockLedger(ctx.orgId,str(issue.data.warehouseId),str(line.materialId));
        }
    }
    for(const task of tasksOf(wo)){
        const e=object(executions[str(task.id)]),plan=object(planning[str(task.id)]),reports=object(object(wo.data.serviceReports)[str(task.id)]);
        for(const spare of rows(task.spares)){
            const p=object(plan[str(spare.id)]),req=str(p.requirementId);
            if(req&&!links.some(l=>l.data.requirementId===req)){
                const t=(await procurementTrace(ctx.orgId,[req])).get(req);
                if(!t||t.stage!=='received')throw new HttpError(409,'Receive and post spare '+str(spare.description)+' before closure.');
                requirePostedReceipt(req);
            }
            const issued=rows(e.consumption).filter(c=>c.plannedSpareId===spare.id).reduce((n,c)=>n+Number(c.issued),0);
            // Unused received material must be returned and reconciled; a note alone cannot satisfy the quantity gate.
            if(issued+1e-6<Number(spare.qty))throw new HttpError(409,'Receive, issue and reconcile the full planned quantity of '+str(spare.description)+'.');
        }
        for(const service of rows(task.services)){
            const f=rows(object(e.feedback).services).find(x=>x.id===service.id),report=object(reports[str(service.id)]);
            if(!f||f.accepted!==true||!str(report.path).startsWith(root(ctx)+'/mnt/service_reports/'+wo.id+'/'))throw new HttpError(409,'Complete service feedback and attach the service report: '+str(service.description));
            const servicePlan=object(plan[str(service.id)]),po=orders.find(x=>x.id===servicePlan.poId);
            if(!po||!rows(po.data.receipts).some(receipt=>receipt.status==='accepted'))throw new HttpError(409,'Complete procurement service acceptance for '+str(service.description)+'.');
        }
    }
}
async function earlyClosureCommitments(ctx:OrgContext,wo:Doc){
    const [requirements,links,orders]=await Promise.all([listDocs(root(ctx)+'/procurement_requirements'),listDocs(root(ctx)+'/mnt_supply_links'),listDocs(root(ctx)+'/procurement_orders')]);
    const owned=requirements.filter(x=>x.data.source==='maintenance'&&object(x.data.maintenanceSource).woCode===wo.id);
    const associated=links.filter(x=>x.data.woCode===wo.id&&x.data.status==='active');
    const plan=object(wo.data.taskPlanning),items=Object.values(plan).flatMap(v=>Object.values(object(v))).map(object);
    const ids=new Set([...owned.map(x=>x.id),...associated.map(x=>str(x.data.requirementId)),...items.map(x=>str(x.requirementId))].filter(Boolean));
    const poIds=new Set(items.map(x=>str(x.poId)).filter(Boolean));
    const blocked=orders.filter(p=>{
        const linked=poIds.has(p.id)||ids.has(str(p.data.requirementId))||texts(p.data.requirementIds).some(id=>ids.has(id))||rows(p.data.lines).some(l=>ids.has(str(l.requirementId))||l.workOrderId===wo.id||l.woCode===wo.id);
        return linked&&(['open','sent','partial','full'].includes(str(p.data.status))||rows(p.data.lines).some(l=>(Number(l.receivedQty)||0)>0)||rows(p.data.deliveries).some(l=>l.status==='posted')||rows(p.data.receipts).some(l=>l.status==='accepted'));
    }).map(p=>p.id);
    return {owned,associated,blocked};
}
function earlyExecutionStarted(wo:Doc){return !!wo.data.startedAt||Object.values(object(wo.data.taskExecution)).some(v=>!!object(v).startedAt||['in_progress','blocked','awaiting_feedback','completed'].includes(str(object(v).status)));}
async function ensureEarlyActuals(ctx:OrgContext,wo:Doc){
    const executions=object(wo.data.taskExecution);
    for(const task of tasksOf(wo)){
        const e=object(executions[str(task.id)]);
        if(e.startedAt||['in_progress','blocked','awaiting_feedback','completed'].includes(str(e.status))){
            if(e.status!=='completed'||e.reconciled!==true)throw new HttpError(409,'Record actual feedback and reconcile every started task before early closure.');
            taskCompletion(task,object(e.feedback));
        }
    }
    for(const issue of (await listDocs(root(ctx)+'/goods_issues')).filter(x=>x.data.workOrderId===wo.id)){
        const e=object(executions[str(issue.data.taskId)]);
        if(e.reconciled!==true||issue.data.finance==='live'&&!str(issue.data.journalId))throw new HttpError(409,'Post and reconcile all actual goods issues before early closure.');
        for(const l of rows(issue.data.lines)){
            const c=rows(e.consumption).find(v=>v.issueLineId===issue.id+'_'+l.no);
            if(!c||Math.abs(Number(c.consumed)+Number(c.returned)-Number(l.qty))>1e-6)throw new HttpError(409,'Reconcile the issued and returned quantities for '+issue.id+'.');
            await verifyMaintenanceStockLedger(ctx.orgId,str(issue.data.warehouseId),str(l.materialId));
        }
    }
    if((await listDocs(root(ctx)+'/safety_incidents')).some(i=>i.data.woCode===wo.id&&i.data.status!=='cleared'))throw new HttpError(409,'Clear all recorded incidents before early closure.');
}
async function earlyClose(ctx:OrgContext,wo:Doc,prepare=false,safetyFinal=false,cancel=false,technicalFinal=false){
    if(technicalFinal)await authority(ctx,wo,'MNT.WO.technicalApprove','MNT.WO.CLOSE_APPROVAL');
    else if(safetyFinal)await authority(ctx,wo,'MNT.WO.safety','MNT.SAFETY.SIGNOFF');
    else await authority(ctx,wo,cancel?'MNT.WO.cancel':'MNT.WO.close');
    if(['closed','cancelled'].includes(str(wo.data.status)))throw new HttpError(409,'This order is already final.');
    if(isRequestClosureOrder(wo.data))throw new HttpError(409,'Use safety sign-off to close the retrospective work order.');
    return withLock(ctx.orgId,'maintenance_po_commitment',async()=>{
        const check=await earlyClosureCommitments(ctx,wo);
        if(check.blocked.length)throw new HttpError(409,'Early closure is blocked by committed purchase order(s): '+check.blocked.join(', '));
        const prior=object(wo.data.earlyClosureRequest),reason=requiredText(safetyFinal||technicalFinal?prior.reason:ctx.body.note||prior.reason,'Early closure reason',10);
        const started=earlyExecutionStarted(wo);
        if(cancel&&object(wo.data.technicalClosurePending).at)throw new HttpError(409,'Resolve the pending technical closure approval before cancellation.');
        if(cancel&&started)throw new HttpError(409,'Record actual work and use early closure after execution starts.');
        if(prepare){
            if(!started)throw new HttpError(400,'Use direct early closure for work that has not started.');
            await saveWo(ctx,wo,{earlyClosureRequest:{at:nowIso(),by:ctx.uid,name:name(ctx),reason}},'work_order.early_closure_requested',reason);
            return {ok:true};
        }
        if(!safetyFinal&&!technicalFinal&&(ctx.body.confirm!==wo.id||!cancel&&ctx.body.noCommitmentConfirmed!==true))throw new HttpError(400,'Confirm the order number and no outstanding PO commitment.');
        await ensureEarlyActuals(ctx,wo);
        if(started&&!object(wo.data.safetySignoff).at)throw new HttpError(409,'Complete safety sign-off for the work actually performed.');
        if(!cancel&&!technicalFinal&&(technicalClosureApprovalRequired(wo.data)||object(wo.data.technicalClosurePending).at)){
            const pending=object(wo.data.technicalClosurePending);
            if(pending.at)return {ok:true,pendingTechnicalApproval:true};
            const at=nowIso(),earlyClosureRequest=prior.at?prior:{at,by:ctx.uid,name:name(ctx),reason};
            await saveWo(ctx,wo,{earlyClosureRequest,technicalClosurePending:{at,by:ctx.uid,name:name(ctx),mode:'early',policyVersion:readMaintenancePolicySnapshot(wo.data.maintenanceGovernance)!.version}},'work_order.technical_closure_requested',reason);
            return {ok:true,pendingTechnicalApproval:true};
        }
        const at=nowIso(),execution=object(wo.data.taskExecution);
        const skipped=tasksOf(wo).filter(t=>object(execution[str(t.id)]).status!=='completed').map(t=>str(t.id));
        const writes:Write[]=[];
        // Cancel only requirements owned by this work order, never shared replenishment demand.
        for(const req of check.owned.filter(x=>!['cancelled','rejected'].includes(str(x.data.status)))){
            writes.push({path:root(ctx)+'/procurement_requirements/'+req.id,fields:{status:'cancelled',cancelReason:'Work order early closure: '+reason,updatedAt:at,version:(Number(req.data.version)||0)+1,history:[...rows(req.data.history),{at,by:ctx.uid,byName:name(ctx),action:'cancelled',note:reason,from:str(req.data.status),to:'cancelled'}]},mask:['status','cancelReason','updatedAt','version','history'],updateTime:req.updateTime});
        }
        for(const link of check.associated)writes.push({path:root(ctx)+'/mnt_supply_links/'+link.id,fields:{status:'released',releasedAt:at,releasedBy:ctx.uid},mask:['status','releasedAt','releasedBy'],updateTime:link.updateTime});
        const labour=tasksOf(wo).reduce((n,t)=>n+(Number(object(object(execution[str(t.id)]).feedback).actualHours)||0)*(Number(t.rate)||0),0);
        const spares=Object.values(execution).reduce<number>((n,e)=>n+rows(object(e).consumption).reduce((v,c)=>v+(Number(c.consumed)||0)*(Number(c.unitCost)||0),0),0);
        const closure={at,by:ctx.uid,name:name(ctx),note:reason,outcome:started?'work_stopped':'not_started',skippedTaskIds:skipped,previousStatus:str(wo.data.status),noPoCommitment:true};
        const patch={...(technicalFinal?{technicalClosure:object(wo.data.technicalClosure),technicalClosurePending:null}:{}),status:cancel?'cancelled':'closed',...(cancel?{cancelledAt:at,cancelledBy:ctx.uid,cancelledByName:name(ctx),cancelReason:reason}:{closedAt:at}),closureMode:'early',...(object(wo.data.safetySignoff).at?{safetySignoff:object(wo.data.safetySignoff)}:{}),earlyClosure:closure,closedBy:ctx.uid,closedByName:name(ctx),finalCost:{labour,spares,services:0,total:labour+spares},updatedAt:at,history:history(ctx,wo.data,cancel?'Work order cancelled before execution':'Work order closed early',reason)};
        writes.push({path:root(ctx)+'/work_orders/'+wo.id,fields:patch,mask:Object.keys(patch),updateTime:wo.updateTime});
        if(writes.length>430)throw new HttpError(409,'Too many linked procurement records; resolve them in procurement first.');
        await releaseMaintenanceReservations(ctx,wo.id);
        await commit(writes);
        await event(ctx,cancel?'work_order.cancelled':'work_order.early_closed',wo.id,reason);
        await syncOrderAfter(ctx,wo.id,cancel?'work_order.cancelled':'work_order.early_closed');
        return {ok:true};
    });
}
async function ensureNoDirectResources(ctx:OrgContext,wo:Doc){
 if(!isRequestClosureOrder(wo.data))return;
 const [issues,links]=await Promise.all([listDocs(root(ctx)+'/goods_issues'),listDocs(root(ctx)+'/mnt_supply_links')]);
 if(issues.some(i=>i.data.workOrderId===wo.id)||links.some(i=>i.data.woCode===wo.id&&i.data.status==='active')||rows(wo.data.sparesUsed).length||rows(wo.data.spares).length||rows(wo.data.services).length||tasksOf(wo).some(t=>rows(t.spares).length||rows(t.services).length)||Object.keys(object(wo.data.taskPlanning)).length)
  throw new HttpError(409,'This retrospective order has resource activity. Resolve the discrepancy through controlled maintenance review; do not close it as no-spares/no-services.');
}
async function finalizeSafetyClosure(ctx:OrgContext,wo:Doc){
    const executions=object(wo.data.taskExecution),retrospective=isRequestClosureOrder(wo.data);
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
                safetySignoff:object(wo.data.safetySignoff),closureMode:'safety',
                ...(object(wo.data.technicalClosure).at?{technicalClosure:object(wo.data.technicalClosure),technicalClosurePending:null}:{}),
                finalCost: {
                    spares,
                    labour,
                    services,
                    total: spares + labour + services,
                    ...(retrospective?{pendingLabourValuation:tasksOf(wo).some(t=>!(Number(t.rate)>0)),actualLabourMinutes:Number(object(wo.data.directCompletion).durationMinutes)}:{}),
                    pendingMaterialValuation: Object.values(executions).some((e) =>
                        rows(object(e).consumption).some((c) => c.unitCost === null),
                    ),
                },
            },
            object(wo.data.technicalClosure).at?'work_order.technical_closed':'work_order.safety_closed',
        );
        await releaseMaintenanceReservations(ctx, wo.id);
        for (const id of texts(wo.data.windowIds)) {
            const window = (await getDoc(`${root(ctx)}/maintenance_windows/${identifier(id)}`))!;
            let complete = true;
            for (const s of rows(window.data.tasks)) {
                const other = await internalOrder(ctx, s.woCode);
                if (!(other.data.status==='closed'&&other.data.closureMode==='early')&&object(object(other.data.taskExecution)[str(s.taskId)]).status !== 'completed') complete = false;
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
export async function executeMaintenanceAction(ctx: OrgContext, wo: Doc, action: string) {
    const b = ctx.body,
        executions = object(wo.data.taskExecution),
        task = tasksOf(wo).find((t) => t.id === str(b.taskId)),
        e = object(executions[str(b.taskId)]);
    const retrospective=isRequestClosureOrder(wo.data);
    if(action==='approve_order_stage'){
        const approval=await approveStage(ctx,wo);
        await saveWo(ctx,wo,{stageApproval:approval,stageApprovalHistory:[...rows(wo.data.stageApprovalHistory),approval]},approval.status==='approved'?'work_order.stage_approved':'work_order.stage_approval_vote',str(approval.note));return {ok:true,pendingApproval:approval.status==='pending'};
    }
    if(action==='early_close'||action==='prepare_early_close')return earlyClose(ctx,wo,action==='prepare_early_close');
    if(action==='cancel_order_legacy')return earlyClose(ctx,wo,false,false,true);
    if(action==='handover')throw new HttpError(409,'Equipment handover is no longer a work order closure step.');
    if(action==='technical_close'){
        const pending=object(wo.data.technicalClosurePending);
        if(!pending.at||['closed','cancelled'].includes(str(wo.data.status)))throw new HttpError(409,technicalClosureApprovalRequired(wo.data)?'Technical closure approval is not pending.':'Technical closure approval is no longer required under this work order policy.');
        await authority(ctx,wo,'MNT.WO.technicalApprove','MNT.WO.CLOSE_APPROVAL');
        const excluded=new Set([str(pending.by),str(object(wo.data.safetySignoff).by),...Object.values(executions).flatMap(e=>texts(object(e).performers)),...rows(wo.data.timeLogs).map(e=>str(e.uid))].filter(Boolean));
        if(excluded.has(ctx.uid)&&!bypass(ctx,'mnt.wo.technical_closure.independence'))throw new HttpError(403,'An independent technical closure approver is required.');
        const note=requiredText(b.note,'Technical closure approval notes',10);
        const input=approvalInput(wo.data,'technicalClosure'),flow=await decideMaintenanceFlow(ctx,wo,'technicalClosure',input.payload,input.startedAt,input.previous,input.exclude,'approve',note);
        if(flow?.status==='pending'){await saveWo(ctx,wo,{technicalClosurePending:{...pending,flow:flowPlain(flow)},technicalClosureVoteHistory:[...rows(wo.data.technicalClosureVoteHistory),flowPlain(flow)]},'work_order.technical_closure_vote',note);return {ok:true,pendingTechnicalApproval:true};}
        const approved:Doc={...wo,data:{...wo.data,technicalClosure:{at:nowIso(),by:ctx.uid,name:name(ctx),note,policyVersion:pending.policyVersion,...(flow?{flow:flowPlain(flow)}:{})}}};
        if(pending.mode==='early')return earlyClose(ctx,approved,false,false,false,true);
        if(!object(wo.data.safetySignoff).at)throw new HttpError(409,'Complete safety sign-off first.');
        if((await listDocs(root(ctx)+'/safety_incidents')).some(i=>i.data.woCode===wo.id&&i.data.status!=='cleared'))throw new HttpError(409,'Clear every recorded incident or near miss before technical closure.');
        if(retrospective)await ensureNoDirectResources(ctx,wo);
        else for(const t of tasksOf(wo))await requireApprovedWindow(ctx,wo,str(t.id));
        closurePrerequisites(wo.data);await ensureClosureResources(ctx,wo);
        const result=await finalizeSafetyClosure(ctx,approved);
        for(const id of texts(wo.data.windowIds)){
            const window=await getDoc(root(ctx)+'/maintenance_windows/'+identifier(id));
            if(!window||!object(window.data.safetyClosure).at||object(window.data.finalClosure).at)continue;
            const all=await Promise.all(texts(window.data.workOrderIds).map(id=>internalOrder(ctx,id)));
            if(!all.length||!all.every(order=>order.data.status==='closed'))continue;
            const finalClosure={at:nowIso(),by:ctx.uid,name:name(ctx),note:'All required work order technical closure approvals completed.',workOrderIds:all.map(order=>order.id)};
            await commit([{path:root(ctx)+'/maintenance_windows/'+window.id,fields:{finalClosure,history:history(ctx,window.data,'Maintenance window closed after technical approvals','')},mask:['finalClosure','history'],updateTime:window.updateTime}]);
            await event(ctx,'window.closed',window.id,'Work order technical approvals completed');
        }
        return result;
    }
    if(['closed','cancelled'].includes(str(wo.data.status))&&!(wo.data.status==='closed'&&['report_incident','clear_incident'].includes(action)))throw new HttpError(409,'A closed work order cannot be reopened or modified.');
    if(action==='upload_service_report'){
        await authority(ctx,wo,'MNT.WO.execute','MNT.TASK.FEEDBACK');
        if(!task||!['in_progress','blocked','awaiting_feedback','completed'].includes(str(e.status))||!texts(e.performers).includes(ctx.uid)&&!bypass(ctx,'mnt.task.execution_team'))throw new HttpError(403,'Only the allocated execution team can upload the completed service report.');
        const service=rows(task.services).find(s=>s.id===b.serviceId);
        if(!service)throw new HttpError(400,'Choose a service on this task.');
        const data=str(b.data);if(data.length>2_000_000)throw new HttpError(400,'Service report exceeds 1.5 MB.');const buffer=Buffer.from(data,'base64');
        if(!data||data.length>2_000_000||!/^[A-Za-z0-9+/=]+$/.test(data)||buffer.length>1_500_000||buffer.subarray(0,5).toString('latin1')!=='%PDF-'||/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(buffer.toString('latin1')))throw new HttpError(400,'Upload a PDF service report without active content, maximum 1.5 MB.');
        const filename=str(b.filename).slice(0,150)||'service-report.pdf';
        const path=root(ctx)+'/mnt/service_reports/'+wo.id+'/'+identifier(task.id)+'/'+identifier(service.id)+'/'+maintenanceKey(nowIso(),ctx.uid,data).slice(0,24)+'.pdf';
        const [ok]=await storage.write([{path,content:data,contentType:'application/pdf'}]);if(!ok)throw new HttpError(502,'Service report upload failed.');
        const all=object(wo.data.serviceReports),reports=object(all[str(task.id)]);
        await saveWo(ctx,wo,{serviceReports:{...all,[str(task.id)]:{...reports,[str(service.id)]:{path,filename,by:ctx.uid,at:nowIso()}}}},'service.report_attached',filename);
        return {ok:true,filename};
    }
    if(retrospective){
        if(!['complete_task','safety_signoff','report_incident','clear_incident'].includes(action))throw new HttpError(409,'No planning, scheduling, new execution or resource transactions are allowed on work already completed at request review.');
        if(action==='complete_task'){
            await authority(ctx,wo,'MNT.WO.execute','MNT.TASK.FEEDBACK');
            if(wo.data.status!=='in_progress'||!task||e.status!=='awaiting_feedback'||object(wo.data.safetySignoff).at)throw new HttpError(409,'This retrospective feedback is not pending.');
            const source=object(wo.data.directCompletion),executor=object(source.executor),minutes=Number(source.durationMinutes);
            if(str(executor.uid)!==ctx.uid&&!bypass(ctx,'mnt.direct_completion.executor_feedback'))throw new HttpError(403,'The named employee who performed the work must confirm the execution feedback.');
            const submitted=object(b.feedback);
            const feedback:Obj={...submitted,workPerformed:str(source.reportedWork)};
            if(feedback.noSparesOrServicesConfirmed!==true)throw new HttpError(400,'Explicitly confirm no spare parts or external services were used.');
            
            taskCompletion(task,feedback);
            if(!Number.isInteger(minutes)||minutes<=0)throw new HttpError(409,'The source request has an invalid recorded duration.');
            await ensureNoDirectResources(ctx,wo);
            const at=nowIso(),actualHours=minutes/60;
            await saveWo(ctx,wo,{taskExecution:{...executions,[str(task.id)]:{...e,status:'completed',feedback:{...feedback,actualHours,actualMinutes:minutes,services:[]},completedAt:at,completedBy:str(executor.uid),feedbackRecordedBy:ctx.uid,feedbackRecordedAt:at,reconciled:true,reconciliationMode:'no_resources_confirmed',reconciledAt:at,reconciledBy:ctx.uid,consumption:[],bomUpdated:false}},status:'completed',completedBy:str(executor.uid),completedByName:str(executor.name),completedAt:at,timeLogs:[{id:'DIRECT_COMPLETION',uid:str(executor.uid),name:str(executor.name),date:str(source.performedDate),hours:actualHours,minutes,note:'Actual work reported on '+str(wo.data.wrCode)}]},'task.completed_from_request',str(task.id));
            return {ok:true};
        }
    }
    if (['start_task', 'block_task','finish_task_execution', 'complete_task', 'confirm_consumption', 'reconcile_task'].includes(action)) {
        if (action === 'reconcile_task') {
            await authority(ctx, wo, 'MNT.view', 'MNT.SPARES.RECONCILE');
        } else if(!outsideExecutionAccess(ctx.workGroupPolicy,wo,str(b.taskId)))await authority(ctx, wo, 'MNT.WO.execute', 'MNT.TASK.FEEDBACK');
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
            await requireStageApproval(ctx,wo,'before_assessment');
            await requireStageApproval(ctx,wo,'after_readiness');
            await requireStageApproval(ctx,wo,'before_execution');
            if(object(wo.data.earlyClosureRequest).at)throw new HttpError(409,'Early closure requested. Do not start new work.');
            if(e.status==='awaiting_feedback'||e.status==='in_progress')throw new HttpError(409,'This task is already started or physically finished.');
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
        if (!['in_progress', 'blocked','awaiting_feedback'].includes(str(e.status)))
            throw new HttpError(409, 'Start the task before recording execution results.');
        if (!texts(e.performers).includes(ctx.uid) && !bypass(ctx, 'mnt.task.execution_team')) throw new HttpError(403, 'Only this task execution team may record feedback.');
        if(action==='finish_task_execution'){
            if(e.status!=='in_progress')throw new HttpError(409,'Only an active task can be marked physically complete.');
            await saveWo(ctx,wo,{taskExecution:{...executions,[str(task.id)]:{...e,status:'awaiting_feedback',physicalFinishedAt:nowIso(),physicalFinishedBy:ctx.uid}}},'task.physical_execution_finished',str(task.id));return {ok:true};
        }
        if (action === 'block_task') {
            if(e.status==='awaiting_feedback')throw new HttpError(409,'Physical execution has finished; record feedback instead.');
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
        const feedback = await normalClosureFeedback(ctx,wo,task,object(b.feedback));
        if(feedback.closureFieldsVersion===1&&str(e.startedAt)&&str(feedback.dateClosed)<str(e.startedAt).slice(0,10))throw new HttpError(400,'Actual completion date cannot precede task execution.');
        taskCompletion(task, feedback);
        for(const service of rows(task.services))if(!str(object(object(object(wo.data.serviceReports)[str(task.id)])[str(service.id)]).path))throw new HttpError(409,'Attach the service report for '+str(service.description)+'.');
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
            if (!(related.data.status==='closed'&&related.data.closureMode==='early')&&object(object(related.data.taskExecution)[str(scheduled.taskId)]).status !== 'completed') windowComplete = false;
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
        if(retrospective){
            await ensureNoDirectResources(ctx,wo);
            const source=object(wo.data.directCompletion),executor=object(source.executor),minutes=Number(source.durationMinutes);
            const direct=object(executions.DIRECT_COMPLETION);
            if(direct.status==='awaiting_feedback'){
                if(!Number.isInteger(minutes)||minutes<=0||!str(executor.uid)||!str(source.reportedWork))throw new HttpError(409,'The original work request is missing actual work feedback.');
                const at=nowIso(),feedback={workPerformed:str(source.reportedWork),actualHours:minutes/60,actualMinutes:minutes,services:[],noSparesOrServicesConfirmed:true,source:'work_request'};
                executions.DIRECT_COMPLETION={...direct,status:'completed',feedback,completedAt:at,completedBy:str(executor.uid),feedbackRecordedBy:str(source.recordedBy),feedbackRecordedAt:str(source.recordedAt),reconciled:true,reconciliationMode:'no_resources_confirmed',reconciledAt:at,reconciledBy:ctx.uid,consumption:[],bomUpdated:false};
                wo={...wo,data:{...wo.data,taskExecution:executions,completedAt:at,completedBy:str(executor.uid),completedByName:str(executor.name),timeLogs:[{id:'DIRECT_COMPLETION',uid:str(executor.uid),name:str(executor.name),date:str(source.performedDate),hours:minutes/60,minutes,note:'Actual work reported on '+str(wo.data.wrCode)}]}};
            }
        }
        if(object(wo.data.earlyClosureRequest).at)await ensureEarlyActuals(ctx,wo);
        for (const t of tasksOf(wo)) {
            const state = object(executions[str(t.id)]);
            if(object(wo.data.earlyClosureRequest).at&&!state.startedAt&&!['completed','in_progress','blocked','awaiting_feedback'].includes(str(state.status)))continue;
            if (state.status !== 'completed' || state.reconciled !== true)
                throw new HttpError(409, 'Complete and reconcile every task before safety sign-off.');
            if(!retrospective)await requireApprovedWindow(ctx, wo, str(t.id));
            else taskCompletion(t,object(state.feedback));
        }
        if(retrospective)await ensureNoDirectResources(ctx,wo);
        if (!tasksOf(wo).length)throw new HttpError(409,'Safety sign-off cannot be applied before the work is recorded.');
        const previousSignoff=object(wo.data.safetySignoff);
        if(!previousSignoff.at)safetyDeclaration(object(b));
        const incidentRecords = (await listDocs(`${root(ctx)}/safety_incidents`)).filter((i) => i.data.woCode === wo.id);
        if (!previousSignoff.at&&b.declaration === 'none' && incidentRecords.length)
            throw new HttpError(
                409,
                'An incident or near miss is already recorded for this work order. Use the reported-incident declaration.',
            );
        if (incidentRecords.some((i) => i.data.status !== 'cleared'))
            throw new HttpError(409, 'Every recorded incident requires containment and independent safety clearance before sign-off.');
        if (!previousSignoff.at&&b.declaration === 'reported') {
            const incident = await getDoc(`${root(ctx)}/safety_incidents/${identifier(b.incidentId)}`);
            if (!incident || incident.data.woCode !== wo.id || incident.data.status !== 'cleared')
                throw new HttpError(409, 'Link a cleared safety incident for this work order.');
        }
        const signoff=previousSignoff.at?previousSignoff:{declaration:str(b.declaration),noIncidentsConfirmed:b.noIncidentsConfirmed===true,statement:b.declaration==='none'?'No safety incidents or near misses occurred during this maintenance activity.':str(b.narrative),incidentId:str(b.incidentId),note:str(b.note).trim(),by:ctx.uid,name:name(ctx),at:nowIso()};
        const signed:Doc={...wo,data:{...wo.data,safetySignoff:signoff}};
        if(object(wo.data.earlyClosureRequest).at)return earlyClose(ctx,signed,false,true);
        closurePrerequisites(signed.data);await ensureClosureResources(ctx,signed);
        if(technicalClosureApprovalRequired(signed.data)||object(signed.data.technicalClosurePending).at){
            if(!object(signed.data.technicalClosurePending).at)await saveWo(ctx,signed,{safetySignoff:signoff,technicalClosurePending:{at:nowIso(),by:ctx.uid,name:name(ctx),mode:'normal',policyVersion:readMaintenancePolicySnapshot(signed.data.maintenanceGovernance)!.version}},'work_order.safety_signed_technical_pending',str(signoff.note));
            return {ok:true,pendingTechnicalApproval:true};
        }
        return finalizeSafetyClosure(ctx,signed);
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
    if(action==='return_to_planning'){
        await authority(ctx,wo,'MNT.WO.plan','MNT.WO.PLAN');
        if(wo.data.status!=='released'||Object.values(executions).some(x=>object(x).startedAt)||Object.keys(object(wo.data.taskWindows)).length)throw new HttpError(409,'Remove unstarted work from its window before returning to planning.');
        const reason=requiredText(b.note,'Reason for returning to planning',10);
        await saveWo(ctx,wo,{status:'planning',readiness:null,scheduleLock:null},'plan.returned_for_update',reason);return {ok:true};
    }
    if (action === 'reassess') {
        await authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
        if (Object.values(executions).some((e) => object(e).startedAt) || !['planning','plan_ready','released'].includes(str(wo.data.status)))
            throw new HttpError(409, 'Executed history is immutable. Create a break-in sub-order for additional scope.');
        if(Object.keys(object(wo.data.taskWindows)).length||str(wo.data.windowId))throw new HttpError(409,'Remove work from its maintenance window before reassessment.');
        const currentCommitments=await earlyClosureCommitments(ctx,wo);
        if(currentCommitments.blocked.length)throw new HttpError(409,'Committed purchase orders prevent reassessment: '+currentCommitments.blocked.join(', '));
        if(currentCommitments.associated.length||currentCommitments.owned.some(x=>!['cancelled','rejected'].includes(str(x.data.status))))throw new HttpError(409,'Resolve existing purchase requirements before reassessment.');
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
                    ...wo.data,...expectedDateCompletionPatch(wo.data,nowIso()),
                    status: 'planning',
                    taskPlanning: {},
                    assessmentReview: null,
                    readiness:null,riskReview:null,scheduleLock:null,costApproval:null,costPlan:null,
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
            wos = (await listDocs(`${root(ctx)}/work_orders`)).filter((w) => canAt(ctx, 'MNT.view', recordPath(w), scope)||outsideExecutionAccess(ctx.workGroupPolicy,w));
        const windows = (await listDocs(`${root(ctx)}/maintenance_windows`)).filter((w) =>
            canAt(ctx, 'MNT.view', texts(w.data.path), scope),
        );
        const routing=await responsibilityData(ctx,true);
        const items: Obj[] = [];
        for (const w of wos) {
            if(isRequestClosureOrder(w.data))continue;
            let line: Obj = {};
            try {
                line = await productionLine(ctx, w);
            } catch {}
            items.push({
                code: w.id,
                ...responsibilityFor(routing,w.data,'wo'),
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
            testModeOverride: ctx.role==='org_super_admin' && ctx.testMode===true,
            windows: windows.map((w) => ({
                id: w.id,
                ...w.data,
                ...responsibilityFor(routing,w.data,'window'),
                closureSummary:windowClosureSummary(w,wos),
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
        const wo = await syncWorkOrderState(ctx,await order(ctx,b.code)),
            retrospective=isRequestClosureOrder(wo.data),
            readinessData = retrospective?{items:[],problems:[],ready:true}:await readiness(ctx, wo),
            permissions: Obj = {};
        let assessmentBlockReason='';
        for (const [key, perm, gate] of [
            ['reconcile', 'MNT.view', 'MNT.SPARES.RECONCILE'],
            ['assess', 'MNT.view', 'MNT.WR.ASSESS'],
            ['reviewAssessment', 'MNT.assessment.review', 'MNT.ASSESS.REVIEW'],
            ['plan', 'MNT.WO.plan', 'MNT.WO.PLAN'],
            ['execute', 'MNT.WO.execute', 'MNT.TASK.FEEDBACK'],
            ['safety', 'MNT.WO.safety', 'MNT.SAFETY.SIGNOFF'],
            
            ['close', 'MNT.WO.close', ''],
        ]) {
            try {
                // Assessment is intentionally open to employees who can view the
                // work order at their organizational scope. Conversion, planning,
                // execution, approvals and closure remain role-gated.
                if (key === 'assess') {await requireWorkOrderAssessor(ctx,wo);}
                else if (key === 'reviewAssessment') {
                    if(!maintenanceAssessmentApprovalRequired(wo.data))throw Error('Approval not required');
                    if(str(wo.data.status)!=='planning'||([str(wo.data.requestedBy),wo.data.executionMode==='confirmed_request'?'':str(wo.data.createdBy),str(wo.data.assessedBy),str(wo.data.assessmentTasksBy)].includes(ctx.uid)&&!bypass(ctx,'mnt.assessment.review_independence')))throw new Error('Not independently reviewable');
                    await maintenancePermission(ctx, 'MNT.assessment.review', recordPath(wo));
                    await requireMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo));
                }
                else if(key!=='execute'||!outsideExecutionAccess(ctx.workGroupPolicy,wo))await authority(ctx, wo, perm, gate);
                permissions[key] = true;
            } catch (e) {
                if(key==='assess')assessmentBlockReason=e instanceof Error?e.message:'Assessment access could not be verified.';
                permissions[key] = false;
            }
        }
        if(retrospective){
            for(const k of ['assess','reviewAssessment','plan','reconcile'])permissions[k]=false;
            permissions.execute=false;
            permissions.safety=permissions.safety===true&&!['closed','cancelled'].includes(str(wo.data.status));
        }
        permissions.earlyClose=permissions.close===true&&!retrospective&&!['closed','cancelled'].includes(str(wo.data.status));
        const earlyCheck=permissions.earlyClose?await earlyClosureCommitments(ctx,wo):null;
        if(object(wo.data.earlyClosureRequest).at){permissions.assess=false;permissions.plan=false;permissions.reviewAssessment=false;permissions.cancel=false;}
        permissions.createBreakIn=permissions.close===true&&['completed','verified','closed'].includes(str(wo.data.status));
        if(retrospective&&['completed','closed'].includes(str(wo.data.status))){try{await authority(ctx,wo,'MNT.WO.close');permissions.createBreakIn=true;}catch{/* restricted */}}
        if(['closed','cancelled'].includes(str(wo.data.status)))for(const k of ['reconcile','assess','reviewAssessment','plan','execute','safety','close'])permissions[k]=false;
        if(str(wo.data.status)!=='planning'||['approved','pending'].includes(str(object(wo.data.assessmentReview).status))||Object.keys(object(wo.data.taskPlanning)).length)permissions.assess=false;
        if(object(wo.data.assessmentReview).status==='approved'||wo.data.assessmentDraft)permissions.reviewAssessment=false;
        const approvalStage=configuredOrderApprovalStage(wo.data);
        permissions.approveServiceJustification=false;permissions.reviseServiceJustification=false;
        if(['planning','plan_ready'].includes(str(wo.data.status))&&!wo.data.assessmentDraft&&!object(wo.data.earlyClosureRequest).at){try{await authority(ctx,wo,SERVICE_JUSTIFICATION_PERMISSION,SERVICE_JUSTIFICATION_GATE);permissions.approveServiceJustification=![wo.data.assessmentTasksBy,wo.data.assessedBy].includes(ctx.uid);}catch{/* not configured or unauthorized */}try{await maintenancePermission(ctx,'MNT.assessment.edit',recordPath(wo));if(groupAt(ctx.workGroupPolicy,recordPath(wo)))await requireMaintenanceRole(ctx,'MNT.WR.ASSESS',recordPath(wo));permissions.reviseServiceJustification=true;}catch{/* unauthorized */}}
        permissions.approveOrderStage=false;
        if(approvalStage&&stageReached(wo.data,approvalStage)&&stageApprovalPending(wo.data,approvalStage)){
            try{await maintenancePermission(ctx,'MNT.assessment.review',recordPath(wo));await requireMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo));const excluded=[wo.data.requestedBy,wo.data.createdBy,...(approvalStage==='before_assessment'?[]:[wo.data.assessedBy,wo.data.assessmentTasksBy,wo.data.plannedBy,object(wo.data.readiness).by])];permissions.approveOrderStage=!excluded.includes(ctx.uid)||ctx.testMode===true;}catch{/* unauthorized */}
        }
        if(stageApprovalPending(wo.data,'before_assessment'))permissions.assess=false;
        permissions.technicalApprove=false;
        if(object(wo.data.technicalClosurePending).at&&!['closed','cancelled'].includes(str(wo.data.status))){
            try{
                await authority(ctx,wo,'MNT.WO.technicalApprove','MNT.WO.CLOSE_APPROVAL');
                const excluded=[str(object(wo.data.technicalClosurePending).by),str(object(wo.data.safetySignoff).by),...Object.values(object(wo.data.taskExecution)).flatMap(e=>texts(object(e).performers)),...rows(wo.data.timeLogs).map(e=>str(e.uid))];
                permissions.technicalApprove=!excluded.includes(ctx.uid)||ctx.testMode===true;
            }catch{/* no approval authority */}
        }
        permissions.signoff=permissions.safety===true&&wo.data.workflowCode==='WO200'&&!object(wo.data.technicalClosurePending).at;
        permissions.cancel =
            ['planning', 'plan_ready', 'released', 'scheduled'].includes(str(wo.data.status)) &&
            !object(wo.data.earlyClosureRequest).at&&!earlyExecutionStarted(wo)&&!earlyCheck?.blocked.length&&canAt(ctx, 'MNT.WO.cancel', recordPath(wo), await scopeOf(ctx));
        const users = await runQuery({ from: [{ collectionId: 'users' }], where: fieldEq('orgId', ctx.orgId) });
        const pool=await workGroupResourcePool(ctx.orgId,wo,users);
        const workflow=await getDoc(`${root(ctx)}/maintenance_workflow_settings/default`);
        const reviewRole=configuredMaintenanceRole(ctx,'MNT.ASSESS.REVIEW',recordPath(wo),workflow?.data.approverRoles);
        const routing=await responsibilityData(ctx,true),approvalKey=object(wo.data.technicalClosurePending).at?'technicalClosure':approvalStage&&stageReached(wo.data,approvalStage)&&stageApprovalPending(wo.data,approvalStage)||wo.data.workflowCode==='WO020'?'workOrder':null;
        const approvalPreview=approvalKey&&!['closed','cancelled'].includes(str(wo.data.status))?approvalPreviewFor(routing,wo.data,approvalKey,recordPath(wo)):null;
        if(approvalPreview&&!approvalPreview.actions.some(a=>a.actorUid===ctx.uid)){if(approvalKey==='technicalClosure')permissions.technicalApprove=false;else if(approvalStage)permissions.approveOrderStage=false;else permissions.reviewAssessment=false;}
        const cycle=await getMaintenanceCycle(ctx),d=wo.data,zone=str(object(d.currentCycleAdmission).timeZone)||str(object(d.cycleAdmission).timeZone)||cycle.timeZone;
        let dueAt:string|null=null;const dueDate=str(d.scheduledEnd);if(!retrospective&&/^\d{4}-\d{2}-\d{2}$/.test(dueDate)){try{const day=new Date(dueDate+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1);dueAt=zonedInstant(day.toISOString().slice(0,10),'00:00',zone);}catch{/* Invalid historical dates stay unclassified. */}}
        return {
            wo: { code: wo.id, ...wo.data,...expectedDates(wo.data),expectedDatesLocked:expectedDatesLocked(wo.data),workflowStatusCode:shortWorkOrderStatus(str(wo.data.workflowCode)),...responsibilityFor(routing,wo.data,'wo'),approvalPreview, assessmentReviewCurrent: !!reviewRole && assessmentReviewCurrent(wo.data,reviewRole),assessmentReady:maintenanceAssessmentReady(wo.data,reviewRole),assessmentApprovalRequired:maintenanceAssessmentApprovalRequired(wo.data),orderApprovalStage:approvalStage,orderApprovalLabel:approvalStage?STAGE_LABELS[approvalStage]:'',orderStageApprovalPending:!!approvalStage&&stageApprovalPending(wo.data,approvalStage),orderStageApprovalReached:!!approvalStage&&stageReached(wo.data,approvalStage),technicalClosureApprovalRequired:technicalClosureApprovalRequired(wo.data) },
            assemblyOptions:wo.data.executionMode==='confirmed_request'?await (async()=>{const nodes=(await listDocs(root(ctx)+'/structure')).filter(n=>n.data.status!=='inactive'),by=new Map(nodes.map(n=>[n.id,str(n.data.parentId)]));return nodes.filter(n=>{if(n.data.level!=='assembly')return false;let p=by.get(n.id);for(let i=0;i<14&&p;i++,p=by.get(p))if(p===wo.data.unitId)return true;return false;}).map(n=>({id:n.id,code:str(n.data.code),name:str(n.data.name)}));})():[],
            earlyClosure:earlyCheck?{blocked:earlyCheck.blocked,started:earlyExecutionStarted(wo),requested:!!object(wo.data.earlyClosureRequest).at}:null,
            maintenanceCycle:cycle,
            windowClosureManaged:await windowManagedClosure(ctx,wo),
            startDateMoves:startDateMoves(wo.data),
            subOrders:(await listDocs(root(ctx)+'/work_orders')).filter(x=>x.data.parentWoCode===wo.id).map(x=>({code:x.id,title:str(x.data.title),status:str(x.data.status)})),
            serviceReportUrls:Object.fromEntries(await Promise.all(Object.values(object(wo.data.serviceReports)).flatMap(v=>Object.values(object(v))).map(object).filter(v=>str(v.path)).map(async v=>[str(v.path),await signedUrl(str(v.path)).catch(()=> '')]))),
            statusReview:summarizeWorkOrderReview(d,nowIso(),dueAt),
            readiness: readinessData,
            checklist: retrospective?null:await planChecklist(ctx, wo, readinessData),
            currency: str(ctx.org.data.currencyCode),
            permissions,
            assessmentBlockReason,
            testModeOverride: ctx.role==='org_super_admin' && ctx.testMode===true,
            currentUserId: ctx.uid,
            workGroup: pool.group,
            people: pool.people,
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
        ctx.workGroupPolicy=await loadWorkGroupPolicy(ctx.orgId,ctx.me);
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
                'window_close_safety',
                'reject_window',
            ].includes(action)
        )
            {const result=await windowAction(ctx,action);if(action!=='preview_window'&&action!=='save_window'&&b.windowId){const w=await getDoc(root(ctx)+'/maintenance_windows/'+str(b.windowId));for(const id of texts(w?.data.workOrderIds))await syncOrderAfter(ctx,id,'window.'+action);}return result;}
        const wo = await order(ctx, b.code);
        if(object(wo.data.earlyClosureRequest).at&&['match_spare','candidate','reserve','procure','secure_spare','service_sourcing','secure_service','allocate','confirm_external_specialist','lock_schedule','review_risk','submit_cost','confirm_readiness','reassess','return_to_planning'].includes(action))throw new HttpError(409,'Work order is pending early closure. Resource and scope changes are locked.');
        let result;
        if(isRequestClosureOrder(wo.data))result=await executeMaintenanceAction(ctx,wo,action);
        else if (['approve_service_justification','return_service_justification','revise_service_justification'].includes(action))result=await decideExternalService(ctx,wo,action);
        else if (['match_spare', 'candidate', 'reserve', 'procure', 'secure_spare', 'service_sourcing', 'secure_service', 'allocate','confirm_external_specialist'].includes(action))result=await resourceAction(ctx, wo, action);
        else if (['lock_schedule', 'review_risk', 'submit_cost', 'confirm_readiness'].includes(action))result=await planningAction(ctx, wo, action);
        else result=await executeMaintenanceAction(ctx, wo, action);
        await syncOrderAfter(ctx,wo.id,action);return result;
    });
}
export const maintenanceOperationRoutes = {
    // prettier-ignore
    'POST /api/org/mnt/operations': [
        orgRoute('org.mnt.operations', 'MNT.view', maintenanceOperations),
    ],
};
