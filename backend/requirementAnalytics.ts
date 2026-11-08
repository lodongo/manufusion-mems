import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { record } from './org';
import { requirementsPath } from './procurementSetup';
import { stockLinesOf } from './purchaseRequirements';
import { bucketOf, dashboardOf, PYRAMID, traceRequirement, type Trace } from './requirementTrace';

// ---------------------------------------------------------------------------
// Inventory > Requirements: the trace of every released requirement to delivery and payment, its delays (internal
// and external), the requirements dashboard (averages, delay pyramid, expired delivery dates, materials and empty
// bins awaiting delivery, supplier performance, trend) and personal reminders.
//
//   organizations/{org}/requirement_reminders/{id}   a reminder a person set on a requirement (date and note)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const root = (orgId: string) => `organizations/${orgId}`;
const today = () => new Date().toISOString().slice(0, 10);

const r3 = (n: number) => Math.round(n * 1000) / 1000;

async function scopeOf(ctx: OrgContext): Promise<Set<string> | 'all'> {
    if (ctx.role === 'org_super_admin') return 'all';
    return allowedNodeIds(ctx.orgId, ctx.me, true);
}
/** Released by the stores, or already taken by procurement (before the stores gate existed). */
export const isReleased = (d: Obj) => (isObj(d.storesRelease) && str(d.storesRelease.status) === 'released') || ['acknowledged', 'converted'].includes(str(d.status));

async function loadAll(orgId: string) {
    const [reqs, quotations, requisitions, orders, invoices, payments] = await Promise.all([
        listDocs(requirementsPath(orgId)),
        listDocs(`${root(orgId)}/procurement_quotations`),
        listDocs(`${root(orgId)}/procurement_requisitions`),
        listDocs(`${root(orgId)}/procurement_orders`),
        listDocs(`${root(orgId)}/ap_invoices`),
        listDocs(`${root(orgId)}/ap_payments`),
    ]);
    return { reqs, quotations, requisitions, orders, invoices, payments };
}

function traceAll(all: Awaited<ReturnType<typeof loadAll>>, keep: (d: Obj) => boolean): Trace[] {
    const t = today();
    return all.reqs.filter((r) => stockLinesOf(r.data).length && isReleased(r.data) && keep(r.data)).map((r) => traceRequirement({ req: r, quotations: all.quotations, requisitions: all.requisitions, orders: all.orders, invoices: all.invoices, payments: all.payments, today: t }));
}

const brief = (t: Trace) => ({ id: t.id, number: t.number, materialNumber: t.materialNumber, material: t.material, warehouse: t.warehouse, unit: t.unit, requested: t.requested, ordered: t.ordered, received: t.received, outstanding: t.outstanding, needDate: t.needDate, expectedDelivery: t.expectedDelivery, vendor: t.vendor, orders: t.orders.join(', '), stageLabel: t.stageLabel, internalDays: t.byGroup.internal, externalDays: t.byGroup.external, financeDays: t.byGroup.finance, internalDelay: t.internalDelay, externalDelay: t.externalDelay, overallDelay: t.overallDelay, bucket: bucketOf(t.overallDelay), delivered: t.delivered, paid: t.paid, deliveryExpired: t.deliveryExpired, dueSoon: t.dueSoon });

async function myReminders(ctx: OrgContext, requirementId = '') {
    const docs = await listDocs(`${root(ctx.orgId)}/requirement_reminders`);
    return docs.filter((x) => str(x.data.uid) === ctx.uid && str(x.data.status) === 'open' && (!requirementId || str(x.data.requirementId) === requirementId)).map((x) => ({ id: x.id, requirementId: str(x.data.requirementId), number: str(x.data.number), date: str(x.data.date), note: str(x.data.note), due: str(x.data.date) <= today() })).sort((a, b) => a.date.localeCompare(b.date));
}

export const requirementAnalyticsRoutes = {
    'POST /api/org/inventory/requirements/trace': [
        orgRoute('org.inventory.requirements.trace', 'INV.req.view', async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^REQ\d{9}$/.test(id)) throw new HttpError(404, 'Requirement not found.');
            const doc = await getDoc(`${requirementsPath(ctx.orgId)}/${id}`);
            const scope = await scopeOf(ctx);
            if (!doc || !stockLinesOf(doc.data).length || (scope !== 'all' && !stockLinesOf(doc.data).every((l) => scope.has(str(l.warehouseId))))) throw new HttpError(404, 'Requirement not found.');
            const all = await loadAll(ctx.orgId);
            const trace = traceRequirement({ req: doc, quotations: all.quotations, requisitions: all.requisitions, orders: all.orders, invoices: all.invoices, payments: all.payments, today: today() });
            await record(ctx, 'org.inventory.requirements.trace', id, `${trace.stageLabel}; internal ${trace.byGroup.internal} d, external ${trace.byGroup.external} d`);
            return { trace, reminders: await myReminders(ctx, id), released: isReleased(doc.data) };
        }),
    ],
    'POST /api/org/inventory/requirements/dashboard': [
        orgRoute('org.inventory.requirements.dashboard', 'INV.req.view', async (ctx) => {
            const [all, scope] = await Promise.all([loadAll(ctx.orgId), scopeOf(ctx)]);
            const from = /^\d{4}-\d{2}-\d{2}$/.test(str(ctx.body.from)) ? str(ctx.body.from) : '';
            const traces = traceAll(all, (d) => (scope === 'all' || stockLinesOf(d).every((l) => scope.has(str(l.warehouseId)))) && (!from || str(d.createdAt).slice(0, 10) >= from));
            const live = traces.filter((t) => t.stage !== 'cancelled');
            // Materials awaiting delivery, by material and warehouse.
            const awaiting = new Map<string, { materialId: string; materialNumber: string; material: string; warehouseId: string; warehouse: string; unit: string; outstanding: number; nextExpected: string; expired: boolean; requirements: string[] }>();
            for (const t of live.filter((x) => x.awaitingDelivery)) {
                const k = `${t.materialId}__${t.warehouseId}`;
                const e = awaiting.get(k) ?? { materialId: t.materialId, materialNumber: t.materialNumber, material: t.material, warehouseId: t.warehouseId, warehouse: t.warehouse, unit: t.unit, outstanding: 0, nextExpected: '', expired: false, requirements: [] };
                e.outstanding = r3(e.outstanding + (t.outstanding || t.requested));
                if (t.expectedDelivery && (!e.nextExpected || t.expectedDelivery < e.nextExpected)) e.nextExpected = t.expectedDelivery;
                e.expired = e.expired || t.deliveryExpired;
                e.requirements.push(t.number);
                awaiting.set(k, e);
            }
            // Empty bins: a bin holding a material that is out of stock while it is on its way.
            const [bins, journal] = await Promise.all([listDocs(`${root(ctx.orgId)}/warehouse_bin_occupancy`), listDocs(`${root(ctx.orgId)}/material_journal`)]);
            const phys = new Map<string, number>();
            for (const j of journal) {
                if (str(j.data.status) !== 'posted') continue;
                const k = `${str(j.data.materialId)}__${str(j.data.warehouseId)}`;
                phys.set(k, (phys.get(k) ?? 0) + (Number(o(j.data.balancesDelta).physicalStock) || 0));
            }
            const emptyBins = bins
                .map((b) => ({ b, k: `${str(b.data.materialId)}__${str(b.data.warehouseId)}` }))
                .filter(({ k }) => awaiting.has(k) && (phys.get(k) ?? 0) <= 0)
                .map(({ b, k }) => ({ bin: str(b.data.binId) || b.id, warehouseId: str(b.data.warehouseId), ...awaiting.get(k)!, physical: r3(phys.get(k) ?? 0) }));
            const reminders = await myReminders(ctx);
            await record(ctx, 'org.inventory.requirements.dashboard', ctx.orgId, `${live.length} requirement(s)`);
            return {
                ...dashboardOf(traces, today()),
                pyramidBuckets: PYRAMID.map((b) => ({ key: b.key, label: b.label })),
                rows: live.map(brief),
                awaitingMaterials: Array.from(awaiting.values()).map((a) => ({ ...a, requirements: a.requirements.join(', '), physical: r3(phys.get(`${a.materialId}__${a.warehouseId}`) ?? 0) })).sort((a, b) => (a.nextExpected || '9').localeCompare(b.nextExpected || '9')),
                emptyBins,
                reminders,
                autoReminders: live.filter((t) => t.deliveryExpired || t.dueSoon).map((t) => ({ id: t.id, number: t.number, material: `${t.materialNumber} ${t.material}`, expectedDelivery: t.expectedDelivery, kind: t.deliveryExpired ? 'expired' : 'due_soon', vendor: t.vendor })),
            };
        }),
    ],
    'POST /api/org/inventory/requirements/reminder': [
        orgRoute('org.inventory.requirements.reminder', 'INV.req.view', async (ctx) => {
            const action = str(ctx.body.action) || 'set';
            const path = (id: string) => `${root(ctx.orgId)}/requirement_reminders/${id}`;
            if (action === 'set') {
                const requirementId = str(ctx.body.requirementId);
                if (!/^REQ\d{9}$/.test(requirementId)) throw new HttpError(404, 'Requirement not found.');
                const doc = await getDoc(`${requirementsPath(ctx.orgId)}/${requirementId}`);
                const scope = await scopeOf(ctx);
                if (!doc || !stockLinesOf(doc.data).length || (scope !== 'all' && !stockLinesOf(doc.data).every((l) => scope.has(str(l.warehouseId))))) throw new HttpError(404, 'Requirement not found.');
                const date = str(ctx.body.date);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today()) throw new HttpError(400, 'Choose a reminder date, today or later.');
                const note = str(ctx.body.note).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
                if (note.length < 3) throw new HttpError(400, 'Write what to follow up (at least 3 characters).');
                const mine = (await myReminders(ctx)).length;
                if (mine >= 100) throw new HttpError(400, 'You have 100 open reminders. Close some first.');
                const id = `RMD${Date.now().toString(36)}${randomId(4)}`.toUpperCase();
                await writeDoc(path(id), { uid: ctx.uid, requirementId, number: str(doc.data.number) || requirementId, date, note, status: 'open', createdAt: nowIso() }, { exists: false });
                await record(ctx, 'org.inventory.requirements.reminder.set', requirementId, `${date}: ${note}`);
                return { ok: true, id };
            }
            const id = str(ctx.body.id);
            if (!/^RMD[A-Z0-9]{4,30}$/.test(id)) throw new HttpError(404, 'Reminder not found.');
            const doc = await getDoc(path(id));
            if (!doc || str(doc.data.uid) !== ctx.uid) throw new HttpError(404, 'Reminder not found.');
            await writeDoc(path(id), { ...doc.data, status: 'done', doneAt: nowIso() });
            await record(ctx, 'org.inventory.requirements.reminder.done', str(doc.data.requirementId), str(doc.data.note));
            return { ok: true };
        }),
    ],
};
const o = (v: unknown): Obj => (isObj(v) ? v : {});
