import { createHash } from 'node:crypto';
import { getDoc, HttpError, listDocs, nowIso, str, runQuery, fieldEq, type Obj, type Doc } from './core';
import { commit, materialIn, physicalOf, stockValOf, withLock, type Write } from './finCore';
import type { OrgContext } from './guards';
import { object, quantity, rows } from './maintenanceDomain';

export const maintenanceKey = (...parts: string[]) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);
const root = (org: string) => `organizations/${org}`;
export async function verifyMaintenanceStockLedger(orgId: string, warehouseId: string, materialId: string) {
    const entries = await runQuery(
        {
            from: [{ collectionId: 'material_journal' }],
            where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } },
        },
        `organizations/${orgId}`,
    );
    if (entries.some((d) => d.data.status !== 'posted' || d.data.reconciled !== true))
        throw new HttpError(409, 'Reconcile all material stock movements before reserving or issuing maintenance spares.');
}
export async function reserveTaskSpare(ctx: OrgContext, wo: Doc, task: Obj, spare: Obj, selection: Obj) {
    return withLock(ctx.orgId, 'inventory_movements', async () => {
        const materialId = str(selection.materialId) || str(spare.materialId),
            warehouseId = str(selection.warehouseId) || str(spare.warehouseId);
        const material = await materialIn(ctx.orgId, materialId, warehouseId);
        if (!material || !['approved', 'active'].includes(str(material.data.status)))
            throw new HttpError(409, 'An approved material linked to this warehouse is required.');
        const id = maintenanceKey(wo.id, str(task.id), str(spare.id));
        const path = `${root(ctx.orgId)}/inventory_reservations/${id}`,
            previous = await getDoc(path);
        if (previous && (previous.data.materialId !== materialId || previous.data.warehouseId !== warehouseId))
            throw new HttpError(409, 'Release the prior reservation before selecting another material.');
        const prior = Number(previous?.data.qty) || 0;
        await verifyMaintenanceStockLedger(ctx.orgId, warehouseId, materialId);
        const stock = await physicalOf(ctx.orgId, warehouseId, materialId);
        const qty = Math.min(quantity(spare.qty), Math.max(0, prior + stock.available));
        const version = (Number(previous?.data.version) || 0) + 1,
            at = nowIso();
        const data: Obj = {
            workOrderId: wo.id,
            taskId: str(task.id),
            spareId: str(spare.id),
            materialId,
            warehouseId,
            qty,
            version,
            status: qty ? 'active' : 'shortage',
            at,
            by: ctx.uid,
        };
        const journal: Obj = {
            ...data,
            type: 'MAINTENANCE_RESERVATION',
            status: 'posted',
            reconciled: true,
            balancesDelta: { reservedStock: qty - prior },
            reference: wo.id,
            postedAt: at,
            postedBy: ctx.uid,
        };
        const planning = object(wo.data.taskPlanning),
            taskPlanning = object(planning[str(task.id)]);
        const valuation = await stockValOf(ctx.orgId, warehouseId, materialId);
        const state: Obj = {
            ...selection,
            materialId,
            warehouseId,
            reservationId: id,
            reserved: qty,
            required: spare.qty,
            shortage: Math.max(0, Number(spare.qty) - qty),
            unitCost: valuation.avg || null,
            status: qty >= Number(spare.qty) ? 'reserved' : 'shortage',
        };
        await commit([
            { path, fields: data, ...(previous ? { updateTime: previous.updateTime } : { exists: false }) },
            { path: `${root(ctx.orgId)}/material_journal/MR_${id}_${version}`, fields: journal, exists: false },
            {
                path: `${root(ctx.orgId)}/work_orders/${wo.id}`,
                fields: { taskPlanning: { ...planning, [str(task.id)]: { ...taskPlanning, [str(spare.id)]: state } }, updatedAt: at },
                mask: ['taskPlanning', 'updatedAt'],
                updateTime: wo.updateTime,
            },
        ]);
        return state;
    });
}
export async function releaseMaintenanceReservations(ctx: OrgContext, woCode: string) {
    return withLock(ctx.orgId, 'inventory_movements', async () => {
        const docs = (await listDocs(`${root(ctx.orgId)}/inventory_reservations`)).filter(
            (d) => d.data.workOrderId === woCode && Number(d.data.qty) > 0,
        );
        const writes: Write[] = [];
        for (const d of docs) {
            const at = nowIso(),
                version = (Number(d.data.version) || 0) + 1;
            writes.push(
                {
                    path: `${root(ctx.orgId)}/inventory_reservations/${d.id}`,
                    fields: { ...d.data, qty: 0, status: 'released', version, at },
                    updateTime: d.updateTime,
                },
                {
                    path: `${root(ctx.orgId)}/material_journal/MR_${d.id}_${version}`,
                    fields: {
                        ...d.data,
                        type: 'MAINTENANCE_RESERVATION_RELEASE',
                        status: 'posted',
                        reconciled: true,
                        balancesDelta: { reservedStock: -Number(d.data.qty) },
                        postedAt: at,
                        postedBy: ctx.uid,
                    },
                    exists: false,
                },
            );
        }
        for (let i = 0; i < writes.length; i += 440) await commit(writes.slice(i, i + 440));
    });
}
/** Called by the existing goods-issue handler under the shared stock-movement lock. */
export async function reservationForIssue(
    orgId: string,
    woCode: string,
    taskId: string,
    materialId: string,
    warehouseId: string,
    qty: number,
    issueId: string,
): Promise<{ reserved: number; writes: Write[] }> {
    const docs = (await listDocs(`${root(orgId)}/inventory_reservations`)).filter(
        (d) =>
            d.data.workOrderId === woCode &&
            d.data.taskId === taskId &&
            d.data.materialId === materialId &&
            d.data.warehouseId === warehouseId &&
            Number(d.data.qty) > 0,
    );
    const reserved = docs.reduce((n, d) => n + Number(d.data.qty), 0),
        writes: Write[] = [];
    let left = qty;
    for (const d of docs) {
        const take = Math.min(left, Number(d.data.qty));
        if (!take) continue;
        left -= take;
        const version = (Number(d.data.version) || 0) + 1;
        writes.push(
            {
                path: `${root(orgId)}/inventory_reservations/${d.id}`,
                fields: {
                    ...d.data,
                    qty: Number(d.data.qty) - take,
                    issued: (Number(d.data.issued) || 0) + take,
                    version,
                    status: take === Number(d.data.qty) ? 'issued' : 'active',
                },
                updateTime: d.updateTime,
            },
            {
                path: `${root(orgId)}/material_journal/MR_${d.id}_${version}`,
                fields: {
                    ...d.data,
                    type: 'MAINTENANCE_RESERVATION_ISSUE',
                    status: 'posted',
                    reconciled: true,
                    balancesDelta: { reservedStock: -take },
                    reference: issueId,
                    postedAt: nowIso(),
                },
                exists: false,
            },
        );
    }
    return { reserved, writes };
}
