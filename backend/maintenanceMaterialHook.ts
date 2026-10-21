/**
 * Called by Materials Master approval. When a material created from a work-order spare (free-text or catalogue
 * candidate) is approved, the task spare is linked automatically to the approved material code and its need is
 * pushed into Procurement Requirements as an automatic request that the maintenance planner verifies. A rejected
 * material is reflected on the task so the planner can respecify it. Loaded lazily by the approval route.
 */
import { getDoc, listDocs, nowIso, str, type Doc, type Obj } from './core';
import type { OrgContext } from './guards';
import { audit } from './audit';
import { commit, withLock, type Write } from './finCore';
import { object, rows } from './maintenanceDomain';
import { maintenanceKey } from './maintenanceInventory';
import { raiseMaintenanceSupplyRequest } from './purchaseRequirements';
import { linkPath } from './maintenanceSourcing';

const root = (orgId: string) => `organizations/${orgId}`;

async function note(ctx: OrgContext, action: string, label: string, details: string) {
    await audit([{ category: 'maintenance', action: 'mnt.' + action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label }, details }]);
}

export async function maintenanceMaterialDecided(ctx: OrgContext, materialId: string, decision: 'approved' | 'rejected') {
    const candidates = (await listDocs(`${root(ctx.orgId)}/material_creation_candidates`)).filter((c) => str(c.data.materialDraftId) === materialId);
    for (const c of candidates) {
        try {
            await withLock(ctx.orgId, 'maintenance_operations', () => link(ctx, c.id, materialId, decision));
        } catch (e) {
            // Approval of the material stands; the planner can still match and procure the spare by hand.
            await note(ctx, 'material_link.failed', str(c.data.woCode), `${c.id}: ${e instanceof Error ? e.message.slice(0, 200) : 'link failed'}`);
        }
    }
}

async function link(ctx: OrgContext, candidateId: string, materialId: string, decision: 'approved' | 'rejected') {
    const cPath = `${root(ctx.orgId)}/material_creation_candidates/${candidateId}`;
    const c = await getDoc(cPath);
    if (!c || str(c.data.materialDraftId) !== materialId || ['material_registered', 'material_rejected'].includes(str(c.data.status))) return;
    const wo = await getDoc(`${root(ctx.orgId)}/work_orders/${str(c.data.woCode)}`);
    const task = wo && rows(wo.data.assessmentTasks).find((t) => str(t.id) === str(c.data.taskId));
    const spare = task && rows(task.spares).find((s) => str(s.id) === str(c.data.spareId));
    const open = !!wo && !!spare && !['closed', 'cancelled'].includes(str(wo.data.status)) && Number(wo.data.assessmentTasksVersion) === Number(c.data.assessmentVersion);
    const at = nowIso();
    if (decision === 'rejected') {
        const writes: Write[] = [{ path: cPath, fields: { ...c.data, status: 'material_rejected', decidedAt: at }, updateTime: c.updateTime }];
        if (open) writes.push(planningWrite(ctx.orgId, wo!, str(task!.id), str(spare!.id), { status: 'material_rejected', materialDraftId: '' }));
        await commit(writes);
        await note(ctx, 'material_link.rejected', str(c.data.woCode), `${candidateId} · material ${materialId}`);
        return;
    }
    const material = await getDoc(`${root(ctx.orgId)}/materials/${materialId}`);
    if (!material) return;
    if (!open) {
        await commit([{ path: cPath, fields: { ...c.data, status: 'material_registered', materialId, decidedAt: at, note: 'Work order no longer open or reassessed; not pushed.' }, updateTime: c.updateTime }]);
        return;
    }
    const warehouseId = str(c.data.procurementWarehouseId) || str(material.data.warehouseId) || str((Array.isArray(material.data.warehouseIds) ? material.data.warehouseIds : [])[0]);
    const reservation = await getDoc(`${root(ctx.orgId)}/inventory_reservations/${maintenanceKey(wo!.id, str(task!.id), str(spare!.id))}`);
    const quantity = Math.max(0, Number(spare!.qty) - (Number(reservation?.data.qty) || 0) - (Number(reservation?.data.issued) || 0));
    let requirementId = '';
    if (warehouseId && quantity > 0) {
        const source: Obj = {
            key: maintenanceKey(wo!.id, str(task!.id), str(spare!.id)),
            woCode: wo!.id, taskId: str(task!.id), resourceId: str(spare!.id), description: str(spare!.description), quantity,
            assessedRequirement: spare!, assessmentVersion: Number(wo!.data.assessmentTasksVersion) || 1,
            costCenterId: str(wo!.data.costCenterId), planningGroup: planningGroup(wo!), attachments: [str(spare!.photoPath), ...(Array.isArray(spare!.attachments) ? spare!.attachments.map(str) : [])].filter(Boolean),
            raisedBy: 'material_approval',
        };
        requirementId = await raiseMaintenanceSupplyRequest(ctx.orgId, {
            material, warehouse: await getDoc(`${root(ctx.orgId)}/warehouses/${warehouseId}`), warehouseId, quantity,
            dateRequired: str(spare!.requiredDate), source,
            technical: [str(spare!.specifications), str(spare!.function) ? 'Function: ' + str(spare!.function) : '', `Work order ${wo!.id}, task ${str(task!.title) || str(task!.description)}`].filter(Boolean).join('\n'),
        });
    }
    const fresh = (await getDoc(`${root(ctx.orgId)}/work_orders/${wo!.id}`))!;
    const writes: Write[] = [
        { path: cPath, fields: { ...c.data, status: 'material_registered', materialId, requirementId, decidedAt: at }, updateTime: c.updateTime },
        planningWrite(ctx.orgId, fresh, str(task!.id), str(spare!.id), {
            materialId, warehouseId, materialNumber: str(material.data.materialNumber), requirementId,
            status: requirementId ? 'awaiting_verification' : 'material_approved', linkedAt: at, linkedFrom: 'material_approval',
        }),
    ];
    if (requirementId)
        writes.push({
            path: linkPath(ctx.orgId, maintenanceKey(wo!.id, str(task!.id), str(spare!.id))),
            fields: { woCode: wo!.id, taskId: str(task!.id), resourceId: str(spare!.id), requirementId, kind: 'maintenance', qty: quantity, materialId, warehouseId, status: 'active', at, by: 'material_approval' },
        });
    await commit(writes);
    await note(ctx, 'material_link.approved', wo!.id, `Spare ${str(spare!.id)} → ${str(material.data.materialNumber)}${requirementId ? `; requirement ${requirementId} awaiting planner verification` : ''}`);
}

export const planningGroup = (wo: Doc) => ({
    disciplineCode: str(wo.data.disciplineCode), discipline: str(wo.data.disciplineLabel), siteId: str(wo.data.siteId), site: str(wo.data.siteName),
    label: [str(wo.data.disciplineLabel), str(wo.data.siteName)].filter(Boolean).join(' · '),
});

function planningWrite(orgId: string, wo: Doc, taskId: string, resourceId: string, patch: Obj) {
    const planning = object(wo.data.taskPlanning),
        taskState = object(planning[taskId]);
    return {
        path: `${root(orgId)}/work_orders/${wo.id}`,
        fields: { taskPlanning: { ...planning, [taskId]: { ...taskState, [resourceId]: { ...object(taskState[resourceId]), ...patch } } }, updatedAt: nowIso() },
        mask: ['taskPlanning', 'updatedAt'],
        updateTime: wo.updateTime,
    };
}
