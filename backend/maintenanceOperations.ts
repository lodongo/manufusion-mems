import { createHash } from 'node:crypto';
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
import { maintenanceKey, reserveTaskSpare, releaseMaintenanceReservations, verifyMaintenanceStockLedger } from './maintenanceInventory';
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
        if (wo.data.status !== 'closed' && (await productionLine(ctx, wo)).id !== window.data.lineId)
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
    if (!['authorized', 'in_progress', 'completed'].includes(str(w.data.status)))
        throw new HttpError(409, 'The maintenance window is not authorized.');
    for (const gate of ['engineering', 'safety'])
        if (object(w.data[gate]).fingerprint !== context.fingerprint)
            throw new HttpError(
                409,
                'Scope, resources, equipment safety or approval configuration changed. Reapprove the maintenance window.',
            );
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
async function readiness(ctx: OrgContext, wo: Doc, selected?: Set<string>) {
    const items: Obj[] = [],
        problems: string[] = [];
    for (const t of tasksOf(wo).filter((t) => !selected || selected.has(str(t.id)))) {
        const planning = object(object(wo.data.taskPlanning)[str(t.id)]),
            allocation = object(planning.allocation);
        if (
            texts(allocation.personnel).length < Number(t.persons) ||
            allocation.toolsReady !== true ||
            allocation.competenciesConfirmed !== true
        )
            problems.push(`${str(t.description)}: allocate qualified personnel and confirm tools.`);
        for (const spare of rows(t.spares)) {
            const p = object(planning[str(spare.id)]),
                materialId = str(p.materialId) || str(spare.materialId),
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
                const r = await getDoc(`${root(ctx)}/inventory_reservations/${maintenanceKey(wo.id, str(t.id), str(spare.id))}`);
                reserved = Number(r?.data.qty) || 0;
                reserved += Number(r?.data.issued) || 0;
            }
            if (materialId && warehouseId && available === null)
                problems.push(`${str(t.description)}: reconcile stock movements and verify the approved material.`);
            const shortage = Math.max(0, Number(spare.qty) - reserved),
                status =
                    shortage === 0
                        ? 'reserved'
                        : p.status === 'needs_specification' || p.status === 'ready_for_material_creation'
                          ? p.status
                          : p.materialDraftId
                          ? 'awaiting_material_approval'
                          : p.requirementId
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
            });
            if (shortage > 0) problems.push(`${str(t.description)}: secure ${shortage} ${str(spare.uom)} of ${str(spare.description)}.`);
        }
        for (const s of rows(t.services)) {
            const p = object(planning[str(s.id)]);
            if (p.status !== 'secured') problems.push(`${str(t.description)}: secure service ${str(s.description)}.`);
        }
    }
    return { items, problems, ready: problems.length === 0 };
}
async function resourceAction(ctx: OrgContext, wo: Doc, action: string) {
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
            catalogCode: code, catalogueSpecification: spec || null,
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
    } else if (action === 'procure') {
        const materialId = str(previous.materialId) || str(spare?.materialId),
            warehouseId = str(previous.warehouseId) || str(spare?.warehouseId);
        let m: Doc | null = null,
            required = 1;
        if (spare) {
            m = await materialIn(ctx.orgId, materialId, warehouseId);
            if (!m || !['approved', 'active'].includes(str(m.data.status)))
                throw new HttpError(409, 'Material approval and warehouse extension must complete before purchasing.');
            const r = await getDoc(`${root(ctx)}/inventory_reservations/${maintenanceKey(wo.id, str(task.id), str(spare.id))}`);
            required = Math.max(0, Number(spare.qty) - (Number(r?.data.qty) || 0) - (Number(r?.data.issued) || 0));
            if (!required) throw new HttpError(409, 'No shortage remains.');
            await maintenancePermission(ctx, 'INV.issue', await nodePath(ctx.orgId, warehouseId));
        }
        const r = spare || service!,
            uom = PROCUREMENT_UNITS.find(
                (u) => u.active && u.selectable && (u.code === str(r.uom) || u.symbol.toLowerCase() === str(r.uom).toLowerCase()),
            );
        const requirementId = await createMaintenanceRequirement(
            ctx,
            {
                type: spare ? 'material' : 'service',
                source: spare ? 'warehouse' : str(r.catalogCode) ? 'catalogue' : 'description',
                requirement: r.description,
                technical: [str(spare?.specifications) || str(service?.scope), str(r.description), str(task.instructions)]
                    .filter(Boolean)
                    .join('\n'),
                categoryCode: m ? str(m.data.categoryCode) : str(r.categoryCode),
                subcategoryCode: m ? str(m.data.subcategoryCode) : str(r.subcategoryCode),
                familyCode: m ? str(m.data.familyCode) : str(r.classCode),
                itemCode: spare ? '' : str(r.catalogCode),
                attributes: object(r.attributes),
                materialId,
                warehouseId,
                quantity: required,
                uomCode: uom?.code || str(b.uomCode),
                dateRequired: b.dateRequired,
                urgency: 'medium',
                costCenterId: spare ? warehouseId : str(wo.data.costCenterId),
                glCode: b.glCode,
                budget: b.budget ?? null,
            },
            {
                key: maintenanceKey(wo.id, str(task.id), str(r.id), String(wo.data.assessmentTasksVersion || 1)),
                woCode: wo.id,
                taskId: task.id,
                resourceId: r.id,
                description: r.description,
                quantity: required,
                assessedRequirement: r,
                assessmentVersion: Number(wo.data.assessmentTasksVersion) || 1,
                proposedVendors: await Promise.all(
                    texts(service?.proposedVendorIds).map(async (id) => {
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
            cost: Number(line.net) || Number(line.total) || 0,
            readyAt: requiredText(b.readyAt, 'Service readiness date'),
            scopeConfirmation: requiredText(b.note, 'Service scope confirmation'),
            status: 'secured',
        };
    } else throw new HttpError(400, 'Unknown resource action.');
    await saveWo(
        ctx,
        wo,
        {
            taskPlanning: { ...planning, [str(task.id)]: { ...p, [str((spare || service)!.id)]: state } },
            plannedBy: ctx.uid,
            plannedByName: name(ctx),
        },
        'task.resource.' + action,
    );
    return { ok: true, ...result };
}

async function windowSave(ctx: OrgContext) {
    const b = ctx.body,
        existing = b.windowId ? await currentWindow(ctx, b.windowId) : null;
    if (existing && str(b.reason).trim().length < 10 && b.action !== 'preview_window')
        throw new HttpError(400, 'Explain the reason for the window revision (at least 10 characters).');
    if (existing && ['in_progress', 'completed'].includes(str(existing.data.status)))
        throw new HttpError(409, 'An executed window is immutable.');
    const ids = [...new Set(texts(b.workOrderIds))];
    if (!ids.length || ids.length > 30) throw new HttpError(400, 'Choose 1 to 30 work orders.');
    const wos: Doc[] = [];
    for (const id of ids) {
        const wo = await order(ctx, id);
        await authority(ctx, wo, 'MNT.WO.schedule', 'MNT.WO.PLAN');
        if (!['plan_ready', 'released', 'scheduled', 'in_progress'].includes(str(wo.data.status)))
            throw new HttpError(409, `${id}: submit the assessed resource plan before scheduling.`);
        wos.push(wo);
    }
    const line = await productionLine(ctx, wos[0]);
    for (const wo of wos)
        if ((await productionLine(ctx, wo)).id !== line.id)
            throw new HttpError(400, 'A maintenance window can contain work orders from only one production line.');
    const timeZone = str(b.timeZone) || 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone });
    } catch {
        throw new HttpError(400, 'Choose a valid planning timezone.');
    }
    const start = requiredText(b.start, 'Window start'),
        end = requiredText(b.end, 'Window end'),
        hours = (Date.parse(end) - Date.parse(start)) / 3600000;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 90)
        throw new HttpError(400, 'Enter a valid maintenance window of up to 90 days.');
    const raw = rows(b.tasks),
        selected: ScheduleTask[] = [];
    for (const r of raw) {
        const wo = wos.find((w) => w.id === r.woCode),
            t = wo && tasksOf(wo).find((t) => t.id === r.taskId);
        if (!wo || !t) throw new HttpError(400, 'Schedule tasks from the selected assessed work orders.');
        if (object(object(wo.data.taskExecution)[str(t.id)]).startedAt)
            throw new HttpError(409, 'Only tasks that have not started can be scheduled in a new or revised window.');
        const key = `${wo.id}_${str(t.id)}`,
            assigned = str(object(wo.data.taskWindows)[str(t.id)]);
        if (assigned && assigned !== existing?.id) throw new HttpError(409, 'This task already belongs to another window.');
        const allocation = object(object(object(wo.data.taskPlanning)[str(t.id)]).allocation);
        const executionPriority = Number(r.executionPriority ?? 50);
        if (!Number.isInteger(executionPriority) || executionPriority < 1 || executionPriority > 999)
            throw new HttpError(400, 'Execution priority must be between 1 and 999.');
        selected.push({
            executionPriority,
            id: key,
            woCode: wo.id,
            taskId: str(t.id),
            description: str(t.title) || str(t.description),
            hours: r.hours === undefined ? Number(t.hours) : Number(r.hours),
            offset: r.offset === undefined ? 0 : Number(r.offset),
            dependencies: [...new Set([...texts(r.dependencies), ...texts(t.dependencies).map((dep) => `${wo.id}_${dep}`)])],
            personnel: texts(allocation.personnel),
            tools: texts(r.exclusiveTools).map((s) => s.toLowerCase().trim()),
            safety: false,
        });
    }
    selected.sort((a, b) => (a.executionPriority || 50) - (b.executionPriority || 50));
    criticalPath(selected, hours); // Validate technical dependencies before deriving safety prerequisites.
    const equipment = await equipmentSafety(ctx, wos),
        steps: Obj[] = [],
        catalogue = await safetyCatalogue();
    const label = (kind: string, code: string) => str(rows(catalogue[kind]).find((x) => x.code === code)?.label) || code;
    for (const e of equipment) {
        const energy = object(e.storedEnergy);
        if (energy.initialized !== true)
            throw new HttpError(409, `Complete the equipment safety assessment for ${str(e.name)} before scheduling.`);
        for (const source of rows(energy.items))
            steps.push({
                id: maintenanceKey(str(e.equipmentId), str(source.id)),
                equipmentId: e.equipmentId,
                instruction: `Verify isolation of ${label('hazardousEnergy', str(source.energyCode))}. ${rows(source.hazards)
                    .map(
                        (h) =>
                            label('hazards', str(h.code)) +
                            ': ' +
                            rows(h.impacts)
                                .flatMap((i) => texts(i.controls).map((c) => label('controlMeasures', c)))
                                .join('; '),
                    )
                    .join('. ')} ${str(source.notes)}`,
                completedAt: '',
                completedBy: '',
            });
    }
    for (const s of selected) {
        const t = tasksOf(wos.find((w) => w.id === s.woCode)!).find((t) => t.id === s.taskId)!;
        const instructions = [
            str(t.isolation),
            ...rows(t.risk)
                .filter((r) => str(r.permit))
                .map((r) => `${str(r.permit)}: ${str(r.controls)}`),
        ].filter(Boolean);
        for (const instruction of instructions)
            steps.push({ id: maintenanceKey(s.id, instruction), taskId: s.id, instruction, completedAt: '', completedBy: '' });
    }
    const safetyDurations = object(b.safetyDurations),
        safetyOffsets = object(b.safetyOffsets);
    const safetyTasks: ScheduleTask[] = steps.map((step) => ({
        id: 'SAFE_' + str(step.id),
        woCode: 'Safety prerequisites',
        taskId: str(step.id),
        description: str(step.instruction).slice(0, 100),
        hours: safetyDurations[str(step.id)] !== undefined ? quantity(safetyDurations[str(step.id)]) : 0.25,
        offset: safetyOffsets[str(step.id)] !== undefined ? quantity(safetyOffsets[str(step.id)], true) : 0,
        dependencies: [],
        personnel: [],
        tools: [],
        safety: true,
    }));
    const schedule = criticalPath(
        [...safetyTasks, ...selected.map((t) => ({ ...t, dependencies: [...t.dependencies, ...safetyTasks.map((s) => s.id)] }))],
        hours,
    );
    if (b.action === 'preview_window') return { schedule };
    if (schedule.conflicts.length) throw new HttpError(409, schedule.conflicts.join(' '));
    const id = existing?.id || 'MW_' + maintenanceKey(ctx.orgId, nowIso(), ctx.uid).slice(0, 16),
        revision = (Number(existing?.data.revision) || 0) + 1;
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
            new Date(start),
        ),
        weekDate = new Date(localDay + 'T00:00:00Z');
    weekDate.setUTCDate(weekDate.getUTCDate() + 4 - (weekDate.getUTCDay() || 7));
    const isoWeekYear = weekDate.getUTCFullYear(),
        isoWeek = Math.ceil(((weekDate.getTime() - Date.UTC(isoWeekYear, 0, 1)) / 86400000 + 1) / 7);
    const data: Obj = {
        id,
        title: requiredText(b.title, 'Window title', 3, 120),
        lineId: line.id,
        lineName: line.name,
        siteId: wos[0].data.siteId,
        path: line.path,
        start,
        end,
        timeZone,
        isoWeek,
        isoWeekYear,
        rangeType: str(b.rangeType) || 'custom',
        workOrderIds: ids,
        tasks: selected as unknown as Obj[],
        schedule: schedule as unknown as Obj,
        safetySteps: steps,
        safetyDurations,
        safetyOffsets,
        revision,
        status: 'draft',
        engineering: null,
        safety: null,
        plannedBy: ctx.uid,
        plannedByName: name(ctx),
        updatedAt: nowIso(),
        history: history(ctx, existing?.data || {}, 'Window plan revision ' + revision, str(b.reason)),
    };
    const writes: Write[] = [
        {
            path: `${root(ctx)}/maintenance_windows/${id}`,
            fields: data,
            ...(existing ? { updateTime: existing.updateTime } : { exists: false }),
        },
    ];
    for (const wo of wos) {
        const assignments = { ...object(wo.data.taskWindows) };
        for (const s of selected.filter((s) => s.woCode === wo.id)) assignments[s.taskId] = id;
        for (const [key, value] of Object.entries(assignments))
            if (value === id && !selected.some((s) => s.woCode === wo.id && s.taskId === key)) delete assignments[key];
        writes.push({
            path: `${root(ctx)}/work_orders/${wo.id}`,
            fields: { taskWindows: assignments, windowId: id, windowIds: [...new Set([...texts(wo.data.windowIds), id])] },
            mask: ['taskWindows', 'windowId', 'windowIds'],
            updateTime: wo.updateTime,
        });
    }
    if (existing)
        for (const oldId of texts(existing.data.workOrderIds).filter((id) => !ids.includes(id))) {
            const wo = await order(ctx, oldId),
                assignments = object(wo.data.taskWindows);
            for (const [key, value] of Object.entries(assignments)) if (value === id) delete assignments[key];
            writes.push({
                path: `${root(ctx)}/work_orders/${wo.id}`,
                fields: { taskWindows: assignments },
                mask: ['taskWindows'],
                updateTime: wo.updateTime,
            });
        }
    await commit(writes);
    await event(ctx, 'window.saved', id);
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
    if (['approve_engineering', 'approve_safety', 'reject_window'].includes(action)) {
        if (!['draft', 'awaiting_approval'].includes(str(w.data.status)))
            throw new HttpError(409, 'Revise the window before submitting another approval.');
        const engineering = action === 'approve_engineering' || b.gate === 'engineering';
        await maintenancePermission(ctx, engineering ? 'MNT.WO.release' : 'MNT.WO.safety', path);
        const role = await requireMaintenanceRole(ctx, engineering ? 'MNT.WINDOW.ENGINEERING' : 'MNT.WINDOW.SAFETY', path);
        if (w.data.plannedBy === ctx.uid) throw new HttpError(403, 'The window planner cannot approve their own window.');
        const other = object(w.data[engineering ? 'safety' : 'engineering']);
        if (other.by === ctx.uid) throw new HttpError(403, 'Engineering and Safety approvals require different people.');
        if (action === 'reject_window') {
            const reason = requiredText(b.note, 'Rejection reason', 10);
            await commit([
                {
                    path: `${root(ctx)}/maintenance_windows/${w.id}`,
                    fields: {
                        ...w.data,
                        status: 'draft',
                        engineering: null,
                        safety: null,
                        history: history(ctx, w.data, 'Window approval rejected', reason),
                    },
                    updateTime: w.updateTime,
                },
            ]);
            await event(ctx, 'window.rejected', w.id, reason);
            return { ok: true };
        }
        const matrix = ((await getDoc(`${root(ctx)}/saf/risk_matrix`))?.data.configuration ||
            defaultMaintenanceRiskMatrix) as unknown as RiskMatrix;
        for (const wo of c.wos) {
            if (['planning', 'cancelled', 'closed'].includes(str(wo.data.status)))
                throw new HttpError(409, 'Submit current work-order plans before window approval.');
            try {
                finalizeAssessedTaskRisks(
                    tasksOf(wo).filter((t) => rows(w.data.tasks).some((s) => s.woCode === wo.id && s.taskId === t.id)) as any,
                    matrix,
                );
            } catch (e) {
                throw new HttpError(409, e instanceof Error ? e.message : 'Task risk revalidation required.');
            }
        }
        for (const equipment of c.equipment)
            for (const energy of rows(object(equipment.storedEnergy).items))
                for (const h of rows(energy.hazards))
                    for (const impact of rows(h.impacts)) {
                        const residual = object(impact.residualRisk);
                        if (typeof residual.score !== 'number' || Number(residual.score) > matrix.tolerableMax)
                            throw new HttpError(409, 'Equipment residual risks must be assessed and tolerable before window approval.');
                    }
        for (const wo of c.wos) {
            const ready = await readiness(
                ctx,
                wo,
                new Set(
                    rows(w.data.tasks)
                        .filter((t) => t.woCode === wo.id)
                        .map((t) => str(t.taskId)),
                ),
            );
            if (!ready.ready) throw new HttpError(409, ready.problems.join(' '));
        }
        const patch: Obj = {
            ...w.data,
            [engineering ? 'engineering' : 'safety']: {
                by: ctx.uid,
                name: name(ctx),
                at: nowIso(),
                role: role.role,
                fingerprint: c.fingerprint,
                note: requiredText(b.note, 'Approval review notes', 5),
            },
            status: 'awaiting_approval',
            history: history(ctx, w.data, engineering ? 'Engineering approved' : 'Safety approved', str(b.note)),
        };
        await commit([{ path: `${root(ctx)}/maintenance_windows/${w.id}`, fields: patch, updateTime: w.updateTime }]);
        await event(ctx, action, w.id);
        return { ok: true };
    }
    if (action === 'authorize_window') {
        await maintenancePermission(ctx, 'MNT.WO.schedule', path);
        await requireMaintenanceRole(ctx, 'MNT.WO.PLAN', path);
        for (const gate of ['engineering', 'safety'])
            if (object(w.data[gate]).fingerprint !== c.fingerprint)
                throw new HttpError(409, 'Current Engineering and Safety approvals are both required.');
        const writes: Write[] = [
            {
                path: `${root(ctx)}/maintenance_windows/${w.id}`,
                fields: {
                    ...w.data,
                    status: 'authorized',
                    approvedReport: {
                        revision: w.data.revision,
                        fingerprint: c.fingerprint,
                        equipment: c.equipment,
                        workOrders: c.wos.map((wo) => ({
                            code: wo.id,
                            title: wo.data.title,
                            tasks: tasksOf(wo).filter((t) => rows(w.data.tasks).some((s) => s.woCode === wo.id && s.taskId === t.id)),
                        })),
                        engineering: w.data.engineering,
                        safety: w.data.safety,
                    },
                    authorizedAt: nowIso(),
                    history: history(ctx, w.data, 'Window authorized'),
                },
                updateTime: w.updateTime,
            },
        ];
        for (const wo of c.wos)
            writes.push({
                path: `${root(ctx)}/work_orders/${wo.id}`,
                fields: {
                    status: wo.data.status === 'in_progress' ? 'in_progress' : 'scheduled',
                    scheduledStart: w.data.start,
                    scheduledEnd: w.data.end,
                },
                mask: ['status', 'scheduledStart', 'scheduledEnd'],
                updateTime: wo.updateTime,
            });
        writes.push({
            path: `${root(ctx)}/maintenance_window_revisions/${w.id}_${w.data.revision}`,
            fields: { ...w.data, equipment: c.equipment, fingerprint: c.fingerprint, authorizedAt: nowIso() },
            exists: false,
        });
        await commit(writes);
        await event(ctx, 'window.authorized', w.id);
        return { ok: true };
    }
    if (action === 'safety_prerequisite') {
        if (!['authorized', 'in_progress'].includes(str(w.data.status)))
            throw new HttpError(409, 'Authorize the window before verifying safety prerequisites.');
        await maintenancePermission(ctx, 'MNT.WO.safety', path);
        await requireMaintenanceRole(ctx, 'MNT.WINDOW.SAFETY', path);
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
            if (!texts(e.performers).includes(ctx.uid)) throw new HttpError(403, 'The task execution team must confirm actual usage.');
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
            if (!texts(allocation.personnel).includes(ctx.uid))
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
        if (!texts(e.performers).includes(ctx.uid)) throw new HttpError(403, 'Only this task execution team may record feedback.');
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
        if (incident.data.createdBy === ctx.uid)
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
        if (!person || person.data.orgId !== ctx.orgId || person.data.status === 'disabled' || receivingParty !== ctx.uid)
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
                if (key === 'assess') await maintenancePermission(ctx, 'MNT.view', recordPath(wo));
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
        return {
            wo: { code: wo.id, ...wo.data },
            readiness: readinessData,
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
        if (['match_spare', 'candidate', 'reserve', 'procure', 'secure_service', 'allocate'].includes(action))
            return resourceAction(ctx, wo, action);
        return executeMaintenanceAction(ctx, wo, action);
    });
}
export const maintenanceOperationRoutes = {
    // prettier-ignore
    'POST /api/org/mnt/operations': [
        orgRoute('org.mnt.operations', 'MNT.view', maintenanceOperations),
    ],
};
