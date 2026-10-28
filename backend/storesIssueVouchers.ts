import { HttpError, getDoc, listDocs, nowIso, str, writeDoc, type Doc, type Obj } from './core';
import { orgRoute, type OrgContext } from './guards';
import { orgUsers, record } from './org';
import { materialIn, nextCounter, unitsOf, withLock } from './finCore';
import { issueWarehouses, postGoodsIssue } from './finOps';
import { maintenancePath, maintenancePermission } from './maintenanceAccess';
import { canAt, scopeOf } from './access';

/**
 * Stores Issue Voucher (SIV + 8 digits): the maintenance document stores issues materials against, as in SAP
 * (reservation -> goods issue to the order) and the stores requisition/issue voucher of MRO practice.
 *
 *   1. The planner or technician raises a voucher from the work order's ACTIVE reservations (one voucher per
 *      warehouse), naming who will collect the materials and when they are needed.
 *   2. Stores (INV.issue at that warehouse) issues the voucher, fully or in part. Each task group posts a normal goods
 *      issue (GI + 8 digits) with its journal, consuming the task reservation. The person collecting must not be
 *      the person issuing (maker-checker).
 *   3. The voucher is issued when every line is issued; it can be cancelled (nothing issued) or short-closed.
 *
 * Quantities, reservations, warehouse rights, work-order status and stock availability are always validated on the
 * server. Every change is recorded in the audit trail.
 */

const ID = /^SIV\d{8}$/;
const WO_ID = /^WO\d{8}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISSUABLE = ['released', 'scheduled', 'in_progress'];
const OPEN = ['open', 'partial'];
const col = (orgId: string) => `organizations/${orgId}/stores_issue_vouchers`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const nameOf = (u: Doc | null | undefined) => `${str(u?.data.firstName)} ${str(u?.data.lastName)}`.trim() || str(u?.data.email);
const oneLine = (v: unknown, max: number) => str(v).replace(/\s+/g, ' ').trim().slice(0, max);

export const STATUS_LABEL: Record<string, string> = {
    open: 'Waiting for stores',
    partial: 'Partly issued',
    issued: 'Issued',
    closed: 'Short-closed',
    cancelled: 'Cancelled',
};

async function loadWo(ctx: OrgContext, code: string): Promise<Doc> {
    if (!WO_ID.test(code)) throw new HttpError(400, 'Choose the work order.');
    const wo = await getDoc(`organizations/${ctx.orgId}/work_orders/${code}`);
    if (!wo) throw new HttpError(404, 'Work order not found.');
    return wo;
}

/** Quantity of each reservation already requested on vouchers that are still open (minus what they issued). */
async function openRequested(orgId: string, woCode: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const v of await listDocs(col(orgId))) {
        if (str(v.data.workOrderId) !== woCode || !OPEN.includes(str(v.data.status))) continue;
        for (const l of objs(v.data.lines)) {
            const left = Math.max(0, (Number(l.qty) || 0) - (Number(l.issuedQty) || 0));
            out.set(str(l.reservationId), (out.get(str(l.reservationId)) ?? 0) + left);
        }
    }
    return out;
}

/** What can still be put on a voucher: active reservation quantity not yet on an open voucher. */
async function available(ctx: OrgContext, wo: Doc) {
    const reservations = (await listDocs(`organizations/${ctx.orgId}/inventory_reservations`)).filter(
        (r) => str(r.data.workOrderId) === wo.id && Number(r.data.qty) > 0,
    );
    const requested = await openRequested(ctx.orgId, wo.id);
    const tasks = objs(wo.data.assessmentTasks);
    const rows: Obj[] = [];
    for (const r of reservations) {
        const left = round4((Number(r.data.qty) || 0) - (requested.get(r.id) ?? 0));
        if (left <= 0) continue;
        const wh = str(r.data.warehouseId);
        const m = await materialIn(ctx.orgId, str(r.data.materialId), wh);
        const task = tasks.find((t) => str(t.id) === str(r.data.taskId));
        rows.push({
            reservationId: r.id,
            taskId: str(r.data.taskId),
            taskName: str(task?.description) || str(task?.name) || str(r.data.taskId),
            spareId: str(r.data.spareId),
            materialId: str(r.data.materialId),
            materialNumber: str(m?.data.materialNumber),
            materialName: str(m?.data.name),
            uom: str(m?.data.baseUom) || str(m?.data.uom) || 'EA',
            warehouseId: wh,
            reserved: Number(r.data.qty) || 0,
            qty: left,
        });
    }
    return rows;
}

function out(d: Obj, id: string, flags?: Obj) {
    const lines = objs(d.lines);
    return {
        id,
        number: str(d.number) || id,
        status: str(d.status),
        statusLabel: STATUS_LABEL[str(d.status)] ?? str(d.status),
        workOrderId: str(d.workOrderId),
        workOrderTitle: str(d.workOrderTitle),
        warehouseId: str(d.warehouseId),
        warehouseCode: str(d.warehouseCode),
        warehouseName: str(d.warehouseName),
        costCenterId: str(d.costCenterId),
        requiredDate: str(d.requiredDate),
        requestedByName: str(d.requestedByName),
        receivedBy: str(d.receivedBy),
        receivedByName: str(d.receivedByName),
        note: str(d.note),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
        version: Number(d.version) || 0,
        items: lines.length,
        outstanding: round4(lines.reduce((s, l) => s + Math.max(0, (Number(l.qty) || 0) - (Number(l.issuedQty) || 0)), 0)),
        lines: lines.map((l) => ({
            no: Number(l.no), taskId: str(l.taskId), taskName: str(l.taskName), materialId: str(l.materialId),
            materialNumber: str(l.materialNumber), materialName: str(l.materialName), uom: str(l.uom),
            qty: Number(l.qty) || 0, issuedQty: Number(l.issuedQty) || 0,
        })),
        issues: objs(d.issues).map((x) => ({ goodsIssueId: str(x.goodsIssueId), journalId: str(x.journalId), taskId: str(x.taskId), at: str(x.at), byName: str(x.byName) })),
        history: objs(d.history).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
        ...(flags ? { can: flags } : {}),
    };
}

async function issueRights(ctx: OrgContext) {
    const units = await unitsOf(ctx.orgId);
    return { units, warehouses: new Set((await issueWarehouses(ctx, units)).map((w) => w.id)) };
}

async function canRaise(ctx: OrgContext, wo: Doc): Promise<boolean> {
    const path = maintenancePath(wo.data);
    const scope = await scopeOf(ctx);
    return canAt(ctx, 'MNT.WO.plan', path, scope) || canAt(ctx, 'MNT.WO.execute', path, scope);
}

async function flagsOf(ctx: OrgContext, d: Obj, whs: Set<string>, wo: Doc | null) {
    const open = OPEN.includes(str(d.status));
    const stores = whs.has(str(d.warehouseId));
    const raiser = str(d.requestedBy) === ctx.uid || (wo ? await canRaise(ctx, wo) : false);
    const anyIssued = objs(d.lines).some((l) => Number(l.issuedQty) > 0);
    return { issue: open && stores, cancel: open && !anyIssued && (raiser || stores), close: str(d.status) === 'partial' && (raiser || stores) };
}

const historyOf = (d: Obj | undefined, ctx: OrgContext, action: string, note = '') => [
    ...objs(d?.history),
    { at: nowIso(), by: ctx.uid, byName: nameOf(ctx.me), action, note: note.slice(0, 300) },
].slice(-100);

export const storesIssueVoucherRoutes = {
    /** Lines that can still go on a voucher for a work order, and the vouchers already raised. */
    'POST /api/org/mnt/siv/for-wo': [
        orgRoute('org.mnt.siv.for_wo', 'MNT.view', async (ctx) => {
            const wo = await loadWo(ctx, str(ctx.body.code));
            await maintenancePermission(ctx, 'MNT.view', maintenancePath(wo.data));
            const { units, warehouses } = await issueRights(ctx);
            const vouchers = (await listDocs(col(ctx.orgId))).filter((v) => str(v.data.workOrderId) === wo.id).sort((a, b) => b.id.localeCompare(a.id));
            const raise = ISSUABLE.includes(str(wo.data.status)) && await canRaise(ctx, wo);
            const lines = raise ? await available(ctx, wo) : [];
            const people = raise ? (await orgUsers(ctx.orgId)).filter((u) => str(u.data.status) !== 'disabled').map((u) => ({ uid: u.id, name: nameOf(u) })).sort((a, b) => a.name.localeCompare(b.name)) : [];
            return {
                people,
                workOrderStatus: str(wo.data.status),
                canRaise: raise,
                available: lines.map((l) => ({ ...l, warehouseCode: units.get(str(l.warehouseId))?.code ?? '' })),
                vouchers: await Promise.all(vouchers.map(async (v) => out(v.data, v.id, await flagsOf(ctx, v.data, warehouses, wo)))),
            };
        }),
    ],

    /** Raise vouchers from the work order's reservations: one voucher per warehouse. */
    'POST /api/org/mnt/siv/create': [
        orgRoute('org.mnt.siv.create', 'MNT.view', async (ctx) => withLock(ctx.orgId, 'maintenance_operations', async () => {
            const wo = await loadWo(ctx, str(ctx.body.code));
            await maintenancePermission(ctx, 'MNT.view', maintenancePath(wo.data));
            if (!await canRaise(ctx, wo)) throw new HttpError(403, 'MNT.WO.plan or MNT.WO.execute is required at this location to raise a stores issue voucher.');
            if (!ISSUABLE.includes(str(wo.data.status))) throw new HttpError(409, 'Stores issue vouchers are raised for released, scheduled or in-progress work orders.');
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the materials, quantities and the person collecting them.');
            const requiredDate = str(ctx.body.requiredDate);
            const today = nowIso().slice(0, 10);
            if (!DATE.test(requiredDate) || requiredDate < today) throw new HttpError(400, 'Enter the date the materials are needed (today or later).');
            const receivedBy = str(ctx.body.receivedBy);
            const receiver = /^[A-Za-z0-9_-]{4,128}$/.test(receivedBy) ? await getDoc(`users/${receivedBy}`) : null;
            if (!receiver || str(receiver.data.orgId) !== ctx.orgId || str(receiver.data.status) === 'disabled') throw new HttpError(400, 'Choose an active person of your organization to collect the materials.');
            const note = oneLine(ctx.body.note, 300);
            const rows = await available(ctx, wo);
            if (!rows.length) throw new HttpError(409, 'There is no reserved material left to request. Reserve the task spares first.');
            const picked = objs(ctx.body.lines);
            if (picked.length > 60) throw new HttpError(400, 'Request up to 60 lines at a time.');
            const wanted = picked.length
                ? picked.map((p) => {
                    const row = rows.find((r) => str(r.reservationId) === str(p.reservationId));
                    if (!row) throw new HttpError(409, 'A selected line is no longer reserved or is already on an open voucher. Reload and try again.');
                    const qty = Number(p.qty);
                    if (!(qty > 0) || qty > (Number(row.qty) || 0) + 1e-9) throw new HttpError(400, `${str(row.materialNumber) || 'A line'}: request between 0 and ${Number(row.qty)} ${str(row.uom)}.`);
                    return { ...row, qty: round4(qty) } as Obj;
                })
                : rows;
            if (new Set(wanted.map((w) => str(w.reservationId))).size !== wanted.length) throw new HttpError(400, 'A line is listed twice.');
            const units = await unitsOf(ctx.orgId);
            const byWarehouse = new Map<string, Obj[]>();
            for (const w of wanted) byWarehouse.set(str(w.warehouseId), [...(byWarehouse.get(str(w.warehouseId)) ?? []), w]);
            const ids: string[] = [];
            const at = nowIso();
            for (const [wh, list] of byWarehouse) {
                const n = await nextCounter(ctx.orgId, 'stores_issue_vouchers', 'seq');
                const id = `SIV${String(n).padStart(8, '0')}`;
                const unit = units.get(wh);
                const data: Obj = {
                    number: id, status: 'open', workOrderId: wo.id, workOrderTitle: str(wo.data.title),
                    costCenterId: str(wo.data.costCenterId), warehouseId: wh, warehouseCode: unit?.code ?? '', warehouseName: unit?.name ?? '',
                    requiredDate, note, requestedBy: ctx.uid, requestedByName: nameOf(ctx.me),
                    receivedBy, receivedByName: nameOf(receiver),
                    lines: list.map((l, i) => ({ no: (i + 1) * 10, reservationId: str(l.reservationId), taskId: str(l.taskId), taskName: str(l.taskName), spareId: str(l.spareId), materialId: str(l.materialId), materialNumber: str(l.materialNumber), materialName: str(l.materialName), uom: str(l.uom), qty: Number(l.qty), issuedQty: 0 })),
                    issues: [], issueSeq: 0, createdAt: at, updatedAt: at, version: 1,
                    history: historyOf(undefined, ctx, 'Raised', note),
                };
                if (!await writeDoc(`${col(ctx.orgId)}/${id}`, data, { exists: false })) throw new HttpError(409, 'That voucher number is already in use. Please try again.');
                await record(ctx, 'org.mnt.siv.create', id, `${wo.id}: ${list.length} line(s) from ${unit?.code ?? wh}, collected by ${nameOf(receiver)}, needed ${requiredDate}`);
                ids.push(id);
            }
            return { ok: true, ids };
        })),
    ],

    /** Stores queue: open vouchers of the warehouses this person may issue from (and their own). */
    'POST /api/org/mnt/siv/list': [
        orgRoute('org.mnt.siv.list', null, async (ctx) => {
            const { warehouses } = await issueRights(ctx);
            const view = str(ctx.body.view) || 'open';
            if (!['open', 'all'].includes(view)) throw new HttpError(400, 'Choose a view.');
            const docs = (await listDocs(col(ctx.orgId))).filter((v) =>
                warehouses.has(str(v.data.warehouseId)) || str(v.data.requestedBy) === ctx.uid || str(v.data.receivedBy) === ctx.uid);
            const rows = docs.filter((v) => view === 'all' || OPEN.includes(str(v.data.status))).sort((a, b) => str(a.data.requiredDate).localeCompare(str(b.data.requiredDate)) || a.id.localeCompare(b.id));
            return {
                rows: rows.slice(0, 2000).map((v) => { const o = out(v.data, v.id); return { ...o, lines: undefined, history: undefined, issues: undefined, canIssue: OPEN.includes(o.status) && warehouses.has(o.warehouseId) }; }),
                counts: { open: docs.filter((v) => OPEN.includes(str(v.data.status))).length, all: docs.length },
                canIssueAnywhere: warehouses.size > 0,
            };
        }),
    ],

    'POST /api/org/mnt/siv/get': [
        orgRoute('org.mnt.siv.get', null, async (ctx) => {
            const id = str(ctx.body.id);
            if (!ID.test(id)) throw new HttpError(404, 'Voucher not found.');
            const doc = await getDoc(`${col(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Voucher not found.');
            const { warehouses } = await issueRights(ctx);
            const wo = await getDoc(`organizations/${ctx.orgId}/work_orders/${str(doc.data.workOrderId)}`);
            const mine = [str(doc.data.requestedBy), str(doc.data.receivedBy)].includes(ctx.uid);
            const scope = await scopeOf(ctx);
            const viewer = wo ? canAt(ctx, 'MNT.view', maintenancePath(wo.data), scope) : false;
            if (!mine && !viewer && !warehouses.has(str(doc.data.warehouseId))) throw new HttpError(404, 'Voucher not found.');
            return out(doc.data, doc.id, await flagsOf(ctx, doc.data, warehouses, wo));
        }),
    ],

    /** Stores issues the voucher (all or part). Each task group posts a goods issue against its reservation. */
    'POST /api/org/mnt/siv/issue': [
        orgRoute('org.mnt.siv.issue', 'INV.issue', async (ctx) => withLock(ctx.orgId, 'maintenance_operations', () => withLock(ctx.orgId, 'inventory_movements', async () => {
            const id = str(ctx.body.id);
            if (!ID.test(id)) throw new HttpError(404, 'Voucher not found.');
            const doc = await getDoc(`${col(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Voucher not found.');
            const d = doc.data;
            if (Number(ctx.body.expectedVersion) !== (Number(d.version) || 0)) throw new HttpError(409, 'This voucher changed since you opened it. Reload and try again.');
            const { warehouses } = await issueRights(ctx);
            if (!warehouses.has(str(d.warehouseId))) throw new HttpError(403, 'You cannot issue from this warehouse (INV.issue).');
            if (!OPEN.includes(str(d.status))) throw new HttpError(409, 'This voucher is not waiting for stores.');
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the quantities were physically handed over to the person collecting them.');
            const note = oneLine(ctx.body.note, 300);
            const given = objs(ctx.body.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty) })).filter((l) => l.qty > 0);
            if (!given.length) throw new HttpError(400, 'Enter the quantity issued on at least one line.');
            const lines = objs(d.lines).map((l) => ({ ...l }));
            const groups = new Map<string, Map<string, number>>();
            for (const g of given) {
                const l = lines.find((x) => Number(x.no) === g.no);
                if (!l) throw new HttpError(400, 'A line does not exist on this voucher.');
                const left = round4((Number(l.qty) || 0) - (Number(l.issuedQty) || 0));
                if (g.qty > left + 1e-9) throw new HttpError(400, `Line ${g.no}: only ${left} ${str(l.uom)} is still to be issued.`);
                const task = groups.get(str(l.taskId)) ?? new Map<string, number>();
                task.set(str(l.materialId), round4((task.get(str(l.materialId)) ?? 0) + g.qty));
                groups.set(str(l.taskId), task);
            }
            let seq = Number(d.issueSeq) || 0;
            const issues = objs(d.issues);
            const at = nowIso();
            for (const [taskId, materials] of groups) {
                seq += 1;
                const posted = await postGoodsIssue(ctx, {
                    warehouseId: str(d.warehouseId), workOrderId: str(d.workOrderId), taskId,
                    receivedBy: str(d.receivedBy), ref: `${id}-${seq}`, note: note || `Stores issue voucher ${id}`,
                    lines: [...materials].map(([materialId, qty]) => ({ materialId, qty })), acknowledge: true,
                });
                if (posted.reused) {
                    // A retry after an interrupted issue: the earlier goods issue stands only if it matches exactly.
                    const gi = await getDoc(`organizations/${ctx.orgId}/goods_issues/${posted.id}`);
                    const same = gi && objs(gi.data.lines).length === materials.size && objs(gi.data.lines).every((x) => Math.abs((materials.get(str(x.materialId)) ?? -1) - (Number(x.qty) || 0)) < 1e-9);
                    if (!same) throw new HttpError(409, `An earlier attempt already posted ${posted.id} for this voucher with different quantities. Reload the voucher and issue the remainder.`);
                }
                issues.push({ goodsIssueId: posted.id, journalId: posted.journalId, taskId, at, by: ctx.uid, byName: nameOf(ctx.me), lines: [...materials].map(([materialId, qty]) => ({ materialId, qty })) });
            }
            for (const g of given) {
                const l = lines.find((x) => Number(x.no) === g.no)!;
                l.issuedQty = round4((Number(l.issuedQty) || 0) + g.qty);
            }
            const done = lines.every((l) => (Number(l.issuedQty) || 0) >= (Number(l.qty) || 0) - 1e-9);
            const status = done ? 'issued' : 'partial';
            const ok = await writeDoc(`${col(ctx.orgId)}/${id}`, {
                ...d, lines, issues, issueSeq: seq, status, updatedAt: at, version: (Number(d.version) || 0) + 1,
                ...(done ? { issuedAt: at } : {}), lastIssuedBy: ctx.uid,
                history: historyOf(d, ctx, done ? 'Issued in full' : 'Issued in part', issues.slice(-groups.size).map((x) => str(x.goodsIssueId)).join(', ')),
            }, { updateTime: doc.updateTime });
            if (!ok) throw new HttpError(409, 'The voucher changed while it was being issued. Reload it: the goods issues already posted are kept and will not be repeated.');
            await record(ctx, 'org.mnt.siv.issue', id, `${status === 'issued' ? 'Issued in full' : 'Issued in part'}: ${issues.slice(-groups.size).map((x) => str(x.goodsIssueId)).join(', ')} to ${str(d.receivedByName)}`.slice(0, 400));
            return { ok: true, status, goodsIssues: issues.slice(-groups.size).map((x) => str(x.goodsIssueId)) };
        }))),
    ],

    /** Cancel (nothing issued yet) or short-close (the rest is no longer needed). */
    'POST /api/org/mnt/siv/cancel': [
        orgRoute('org.mnt.siv.cancel', null, async (ctx) => withLock(ctx.orgId, 'maintenance_operations', async () => {
            const id = str(ctx.body.id);
            if (!ID.test(id)) throw new HttpError(404, 'Voucher not found.');
            const doc = await getDoc(`${col(ctx.orgId)}/${id}`);
            if (!doc) throw new HttpError(404, 'Voucher not found.');
            const reason = oneLine(ctx.body.reason, 300);
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters.');
            const { warehouses } = await issueRights(ctx);
            const wo = await getDoc(`organizations/${ctx.orgId}/work_orders/${str(doc.data.workOrderId)}`);
            const f = await flagsOf(ctx, doc.data, warehouses, wo);
            const close = str(ctx.body.mode) === 'close';
            if (close ? !f.close : !f.cancel) throw new HttpError(403, close ? 'Only a partly issued voucher can be short-closed, by its requester or stores.' : 'Only a voucher with nothing issued can be cancelled, by its requester or stores.');
            const at = nowIso();
            const ok = await writeDoc(`${col(ctx.orgId)}/${id}`, {
                ...doc.data, status: close ? 'closed' : 'cancelled', closeReason: reason, closedBy: ctx.uid, closedAt: at,
                updatedAt: at, version: (Number(doc.data.version) || 0) + 1,
                history: historyOf(doc.data, ctx, close ? 'Short-closed' : 'Cancelled', reason),
            }, { updateTime: doc.updateTime });
            if (!ok) throw new HttpError(409, 'This voucher changed. Reload and try again.');
            await record(ctx, close ? 'org.mnt.siv.close' : 'org.mnt.siv.cancel', id, reason);
            return { ok: true };
        })),
    ],
};
