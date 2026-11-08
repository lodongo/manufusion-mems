import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { record } from './org';
import { requirementsPath } from './procurementSetup';
import { dismissReplenishment, stockHash, stockLinesOf, verifyReplenishment } from './purchaseRequirements';
import { METHODS, methodOf, plan } from './replenishmentPlan';
import { buildPipeline, keyOf, maintenanceNeeds, shortageOf, STAGE_LABEL, verdictFor, type MaintenanceNeed, type Pipe } from './supplyPipeline';

// ---------------------------------------------------------------------------
// Inventory > Requirements: the stores review every purchase requirement for warehouse stock before procurement
// processes it (procurement cannot acknowledge without a current stores release).
//
//   automation (Replenishment / MRP), maintenance reservations: release to procurement or cancel
//   raised by people (users, procurement): release, or return to the requester with the reason
//
// Each decision is guided by a strict position of the material in the warehouse: physical and available stock,
// maintenance reservations and shortages with their planned dates, everything already in the pipeline counted once
// (requirements incl. not yet approved, quotations, requisitions, orders net of partial deliveries, signals), the
// lead time (actual purchase orders or the material), the replenishment strategy and levels, and whether the levels
// come from the forecast or are manual and the strategy from the criticality analysis. Every action is audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const ID = /^REQ\d{9}$/;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter(isObj) as Obj[]) : []);
const root = (orgId: string) => `organizations/${orgId}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const nameOf = (ctx: OrgContext) => [str(ctx.me.data.firstName), str(ctx.me.data.lastName)].filter(Boolean).join(' ') || str(ctx.me.data.email);
const can = (ctx: OrgContext, p: string) => ctx.role === 'org_super_admin' || (Array.isArray(ctx.permissions) && (ctx.permissions.includes('*') || ctx.permissions.includes(p)));
const clean = (v: unknown, max: number) => str(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

export const AUTOMATION = ['replenishment', 'mrp'];
export const sourceKind = (d: Obj): 'automation' | 'maintenance' | 'people' => (AUTOMATION.includes(str(d.source)) ? 'automation' : str(d.source) === 'maintenance' ? 'maintenance' : 'people');
const SOURCE_LABEL = { automation: 'Replenishment / MRP (automatic)', maintenance: 'Maintenance reservation', people: 'Raised by a person' };
const REVIEWABLE = ['unverified', 'pending_approval', 'approved'];
const STATUS_LABEL: Record<string, string> = { unverified: 'Unverified (automatic)', pending_approval: 'Pending manager approval', approved: 'Approved, awaiting procurement', acknowledged: 'With procurement', converted: 'With procurement', returned_user: 'Returned to requester', rejected: 'Rejected', cancelled: 'Cancelled', draft: 'Draft' };

async function scopeOf(ctx: OrgContext): Promise<Set<string> | 'all'> {
    if (ctx.role === 'org_super_admin') return 'all';
    return allowedNodeIds(ctx.orgId, ctx.me, true);
}


// ----- Position of one stock line -----

export interface Position {
    lineNo: number;
    materialId: string;
    materialNumber: string;
    materialName: string;
    warehouseId: string;
    warehouseCode: string;
    unit: string;
    requested: number;
    dateRequired: string;
    stock: { physical: number; available: number; reserved: number };
    reservations: MaintenanceNeed[];
    shortage: number;
    shortageWithinLead: number;
    pipeline: Pipe;
    byStage: Record<string, number>;
    lead: { internalDays: number; externalDays: number; totalDays: number; source: string; arrival: string; lateForNeed: boolean };
    strategy: { code: string; name: string; automated: boolean; source: string };
    levels: { minimum: number | null; maximum: number | null; reorderPoint: number | null; reorderQuantity: number | null; safetyStock: number | null; source: 'forecast' | 'manual'; why: string };
    criticality: { class: string; cell: string };
    projected: number;
    verdict: ReturnType<typeof verdictFor>;
    regeneration: string;
    guidance: string[];
}

async function positionOf(orgId: string, d: Obj, line: Obj, pipe: Map<string, Pipe>, needs: Map<string, MaintenanceNeed[]>): Promise<Position> {
    const { stockPosition, paramsOf } = await import('./replenishment');
    const { levelSourceOf, leadTimeSamples, getForecastSetup } = await import('./forecasting');
    const { leadTimeFrom } = await import('./forecastModel');
    const m = str(line.materialId);
    const w = str(line.warehouseId);
    const key = keyOf(m, w);
    const [infoDoc, procDoc, { setup }] = await Promise.all([getDoc(`${root(orgId)}/inventory_material_info/${m}_${w}`), getDoc(`${root(orgId)}/procurement_material_info/${m}_${w}`), getForecastSetup(orgId)]);
    const i = infoDoc?.data ?? {};
    const p = procDoc?.data ?? {};
    const params = paramsOf(i, p);
    const lookback = Math.max(7, Math.min(730, Math.trunc(params.demandLookbackDays ?? 90)));
    const [stock, samples, src] = await Promise.all([
        stockPosition(orgId, w, m, lookback),
        leadTimeSamples(orgId, m, w, setup.leadTimeLookbackMonths).catch(() => []),
        levelSourceOf(orgId, m, w, i).catch(() => ({ source: 'manual', why: '' }) as { source: string; why: string }),
    ]);
    const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
    const lead = leadTimeFrom(samples, setup, { externalDays: pos(p.leadTimeDays) ?? pos(i.leadTimeDays), internalDays: pos(i.internalLeadTimeDays) });
    const totalDays = Math.max(0, Math.round((lead.internalDays || 0) + (lead.externalDays || params.leadTimeDays || 0)));
    const arrival = new Date(Date.now() + totalDays * 86_400_000).toISOString().slice(0, 10);
    const list = needs.get(key) ?? [];
    const shortage = shortageOf(list);
    const shortageWithinLead = shortageOf(list, arrival);
    const reserved = r3(list.reduce((s, n) => s + n.reserved, 0));
    const pp = pipe.get(key) ?? { qty: 0, entries: [] };
    const byStage: Record<string, number> = {};
    for (const e of pp.entries) byStage[e.stage] = r3((byStage[e.stage] ?? 0) + e.qty);
    const method = methodOf(i.replenishmentStrategy, i.stockingPolicy);
    const def = METHODS[method];
    const projected = r3(stock.available - shortage + pp.qty);
    const requested = Number(line.quantity) || 0;
    // What is still needed after stock, the pipeline and maintenance shortages.
    let need: number | null = null;
    const reasons: string[] = [];
    if (method === 'RP07' || method === 'RP18') {
        need = r3(Math.max(0, shortage - Math.max(0, stock.available) - pp.qty));
        reasons.push(`${method} ${def?.name}: no stock is held; only maintenance shortages (${shortage}) are bought.`);
    } else if (def?.automated) {
        const res = plan(method, params, { available: r3(stock.available - shortage), openSupply: pp.qty, consumed: stock.consumed, consumedDays: stock.consumedDays, arrivalMonth: new Date(Date.parse(arrival)).getUTCMonth(), daysSinceReview: null });
        if (res.kind === 'order') {
            need = res.quantity;
            reasons.push(`${method} ${def.name}: ${res.basis}.`);
        } else if (res.kind === 'no_need') {
            need = 0;
            reasons.push(`${method} ${def.name}: ${res.reason}`);
        } else reasons.push(res.reason);
    } else if (params.maximumLevel !== null) {
        need = r3(Math.max(0, params.maximumLevel - projected));
        reasons.push(`Up to the maximum ${params.maximumLevel}: projected ${projected}.`);
    } else if (shortage > 0) {
        need = r3(Math.max(0, shortage - Math.max(0, stock.available) - pp.qty));
        reasons.push(`Maintenance shortages ${shortage} against available ${stock.available} and pipeline ${pp.qty}.`);
    }
    const verdict = verdictFor({ requested, need, moq: params.minimumOrderQuantity, multiple: params.orderMultiple, onDemand: method === 'RP07', strategyAutomated: !!def?.automated, reasons });
    const levelsForecast = src.source === 'forecast';
    const strategyFromCrit = str(i.strategySource) === 'criticality';
    const regeneration = sourceKind(d) === 'automation' && def?.automated
        ? `Replenishment (${method} ${def.name}) will raise this requirement again on its next run while the levels and strategy stay as they are. To stop it, either review the stock levels (minimum ${params.minimumLevel ?? '-'}, maximum ${params.maximumLevel ?? '-'}${params.reorderPoint !== null ? `, reorder point ${params.reorderPoint}` : ''}) or change the replenishment strategy to RP07 Direct purchase (on demand) or RP18 Non-stock.`
        : '';
    const guidance: string[] = [];
    if (regeneration) {
        guidance.push(levelsForecast ? `The levels come from the forecast (${src.why || 'forecasting setup'}): review them on the material's Forecasting tab (new levels need approval).` : 'The levels are manual: review them in the material\'s Stock Control.');
        guidance.push(strategyFromCrit ? `The strategy comes from the criticality analysis (${str(i.criticalityCell) || 'not assessed'}): review the criticality assessment to change it.` : 'The strategy is manual: change it in Stock Control (RP07 Direct purchase or RP18 Non-stock stop automatic replenishment).');
    }
    if (shortageWithinLead > 0 && Date.parse(arrival) > Date.parse(list.map((n) => n.plannedDate).filter(Boolean).sort()[0] ?? arrival)) guidance.push(`A maintenance work order is planned before supply can arrive (${arrival}): expedite or reschedule the work.`);
    if (pp.entries.some((e) => e.stage === 'order' && e.received > 0)) guidance.push('A purchase order is partly delivered; only what is still outstanding is counted.');
    if (pp.entries.some((e) => e.stage === 'requirement' && ['pending_approval', 'unverified', 'returned_user'].includes(e.status))) guidance.push('Requirements not yet approved are counted: if one of them is rejected, this need may come back.');
    const lateForNeed = !!str(line.dateRequired) && arrival > str(line.dateRequired);
    return {
        lineNo: Number(line.no), materialId: m, materialNumber: str(line.materialNumber), materialName: str(line.itemName) || str(line.requirement), warehouseId: w, warehouseCode: str(line.warehouseCode) || w, unit: str(line.unit),
        requested, dateRequired: str(line.dateRequired),
        stock: { physical: stock.physical, available: stock.available, reserved },
        reservations: list, shortage, shortageWithinLead, pipeline: pp, byStage,
        lead: { internalDays: lead.internalDays || 0, externalDays: lead.externalDays || params.leadTimeDays || 0, totalDays, source: `${lead.externalSource === 'actual' ? `actual (${lead.externalSamples} orders, ${lead.statistic})` : lead.externalSource === 'material' ? 'material setting' : 'default'}`, arrival, lateForNeed },
        strategy: { code: method, name: def?.name ?? 'Not set', automated: !!def?.automated, source: strategyFromCrit ? 'criticality' : 'manual' },
        levels: { minimum: params.minimumLevel, maximum: params.maximumLevel, reorderPoint: params.reorderPoint, reorderQuantity: params.reorderQuantity, safetyStock: params.safetyStock, source: levelsForecast ? 'forecast' : 'manual', why: str(src.why) },
        criticality: { class: str(i.criticalityClass), cell: str(i.criticalityCell) },
        projected, verdict, regeneration, guidance,
    };
}

async function loadAll(orgId: string) {
    const { pipelineDocs } = await import('./replenishment');
    const [docs, wos] = await Promise.all([pipelineDocs(orgId), listDocs(`${root(orgId)}/work_orders`)]);
    return { docs, needs: maintenanceNeeds(wos) };
}

async function analyse(orgId: string, doc: Doc) {
    const { docs, needs } = await loadAll(orgId);
    // Left out: this requirement (and what came from it) and the engine's other open automatic requests are not the issue here.
    const pipe = buildPipeline(docs, new Set([doc.id]));
    const lines = stockLinesOf(doc.data);
    return Promise.all(lines.map((l) => positionOf(orgId, doc.data, l, pipe, needs)));
}

async function loadReq(ctx: OrgContext, id: string): Promise<Doc> {
    if (!ID.test(id)) throw new HttpError(404, 'Requirement not found.');
    const doc = await getDoc(`${requirementsPath(ctx.orgId)}/${id}`);
    if (!doc || !stockLinesOf(doc.data).length) throw new HttpError(404, 'Requirement not found.');
    const scope = await scopeOf(ctx);
    if (scope !== 'all' && !stockLinesOf(doc.data).every((l) => scope.has(str(l.warehouseId)))) throw new HttpError(404, 'Requirement not found.');
    return doc;
}

function rowOf(id: string, d: Obj) {
    const lines = stockLinesOf(d);
    const l = lines[0] ?? {};
    const rel = isObj(d.storesRelease) ? d.storesRelease : {};
    const released = str(rel.status) === 'released' && str(rel.hash) === stockHash(d);
    const status = str(d.status);
    const queue = status === 'cancelled' || status === 'rejected' ? 'closed' : released || ['acknowledged', 'converted'].includes(status) ? 'released' : REVIEWABLE.includes(status) ? 'review' : 'other';
    return {
        id, number: str(d.number) || id, title: str(d.title), source: sourceKind(d), sourceLabel: SOURCE_LABEL[sourceKind(d)], status, statusLabel: STATUS_LABEL[status] ?? status, queue,
        materialNumber: str(l.materialNumber), material: str(l.itemName) || str(l.requirement), warehouse: str(l.warehouseCode), quantity: Number(l.quantity) || 0, unit: str(l.unit), lines: lines.length,
        dateRequired: str(l.dateRequired), requester: str(d.requesterName), createdAt: str(d.createdAt), updatedAt: str(d.updatedAt),
        releasedBy: str(rel.byName), releasedAt: str(rel.at), verdict: str(o(rel.verdict).action),
        woCode: str(o(d.maintenanceSource).woCode),
    };
}
const o = (v: unknown): Obj => (isObj(v) ? v : {});

async function stamp(ctx: OrgContext, id: string, patch: (d: Obj) => Obj, expectStatus: string[]) {
    const path = `${requirementsPath(ctx.orgId)}/${id}`;
    const doc = await getDoc(path);
    if (!doc || !expectStatus.includes(str(doc.data.status))) throw new HttpError(409, 'The requirement changed. Refresh and review it again.');
    const at = nowIso();
    const p = patch(doc.data);
    const ok = await writeDoc(path, { ...doc.data, ...p, updatedAt: at, version: (Number(doc.data.version) || 1) + 1, history: [...objs(doc.data.history), ...(objs(p.history))] }, { updateTime: doc.updateTime });
    if (!ok) throw new HttpError(409, 'The requirement changed at the same moment. Refresh and try again.');
}

const snap = (ps: Position[]) => ps.map((p) => ({ line: p.lineNo, action: p.verdict.action, need: p.verdict.need, suggested: p.verdict.suggested, requested: p.requested, available: p.stock.available, pipeline: p.pipeline.qty, shortage: p.shortage, leadDays: p.lead.totalDays, strategy: p.strategy.code }));

export const storesReleaseRoutes = {
    'POST /api/org/inventory/requirements/list': [
        orgRoute('org.inventory.requirements.list', 'INV.req.view', async (ctx) => {
            const [docs, scope] = await Promise.all([listDocs(requirementsPath(ctx.orgId)), scopeOf(ctx)]);
            const rows = docs
                .filter((x) => str(x.data.status) !== 'draft' && stockLinesOf(x.data).length && (scope === 'all' || stockLinesOf(x.data).every((l) => scope.has(str(l.warehouseId)))))
                .map((x) => rowOf(x.id, x.data))
                .filter((r) => r.queue !== 'other')
                .sort((a, b) => (a.queue === 'review' ? 0 : 1) - (b.queue === 'review' ? 0 : 1) || a.dateRequired.localeCompare(b.dateRequired));
            return { rows, can: { release: can(ctx, 'INV.req.release') } };
        }),
    ],
    'POST /api/org/inventory/requirements/position': [
        orgRoute('org.inventory.requirements.position', 'INV.req.view', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const positions = await analyse(ctx.orgId, doc);
            const d = doc.data;
            const kind = sourceKind(d);
            const status = str(d.status);
            const row = rowOf(doc.id, d);
            await record(ctx, 'org.inventory.requirements.review', doc.id, positions.map((p) => `L${p.lineNo} ${p.verdict.action} need ${p.verdict.need}`).join('; ').slice(0, 300));
            return {
                ...row,
                positions: positions.map((p) => ({ ...p, pipeline: { qty: p.pipeline.qty, entries: p.pipeline.entries.map((e) => ({ ...e, stageLabel: STAGE_LABEL[e.stage] })) } })),
                history: objs(d.history).slice(-15).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
                can: {
                    release: can(ctx, 'INV.req.release') && row.queue === 'review' && (kind !== 'people' || str(d.requesterUid) !== ctx.uid),
                    changeQty: kind === 'automation' && status === 'unverified',
                    cancel: can(ctx, 'INV.req.release') && kind !== 'people' && status === 'unverified',
                    returnToRequester: can(ctx, 'INV.req.release') && kind === 'people' && ['pending_approval', 'approved'].includes(status) && row.queue === 'review',
                },
                note: kind === 'automation' && status === 'unverified' ? 'Releasing verifies the automatic request: you become its requester and it goes to your manager for approval under the chart of authority, then to procurement.' : kind === 'maintenance' && status === 'unverified' ? 'Releasing clears it for procurement; the maintenance planner still verifies it for the work order.' : 'Releasing clears it for procurement once it is approved.',
            };
        }),
    ],
    'POST /api/org/inventory/requirements/release': [
        orgRoute('org.inventory.requirements.release', 'INV.req.release', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const d = doc.data;
            const kind = sourceKind(d);
            const status = str(d.status);
            if (!REVIEWABLE.includes(status)) throw new HttpError(409, 'Only a requirement awaiting the stores can be released.');
            if (kind === 'people' && str(d.requesterUid) === ctx.uid) throw new HttpError(403, 'You raised this requirement, so another stores supervisor must release it.');
            if (ctx.body.reviewed !== true) throw new HttpError(400, 'Confirm that you reviewed stock, reservations, the pipeline and the lead time.');
            const note = clean(ctx.body.note, 300);
            const positions = await analyse(ctx.orgId, doc);
            const first = stockLinesOf(d)[0];
            const wantQty = ctx.body.quantity === undefined || ctx.body.quantity === '' ? Number(first.quantity) : Number(ctx.body.quantity);
            if (!Number.isFinite(wantQty) || wantQty <= 0) throw new HttpError(400, 'Enter the quantity to release.');
            if (wantQty !== Number(first.quantity) && !(kind === 'automation' && status === 'unverified')) throw new HttpError(400, 'Only an automatic request can be changed here; return the requirement to its requester to change the quantity.');
            // Strict: releasing what the analysis says is covered, or more than it says is needed, needs a written reason.
            const p0 = positions.find((p) => p.lineNo === Number(first.no)) ?? positions[0];
            const over = positions.filter((p) => (p.lineNo === Number(first.no) ? wantQty : p.requested) > p.verdict.suggested + 1e-9 || p.verdict.action === 'cancel');
            const override = clean(ctx.body.overrideReason, 400);
            if (over.length && override.length < 20) throw new HttpError(409, `The stock position shows ${over.map((p) => `line ${p.lineNo}: ${p.verdict.action === 'cancel' ? 'nothing is needed' : `only ${p.verdict.suggested} is needed`}`).join('; ')}. Give the reason to release anyway (at least 20 characters).`);
            const at = nowIso();
            const releaseFor = (lines: Obj) => ({ status: 'released', by: ctx.uid, byName: nameOf(ctx), at, note, overrideReason: over.length ? override : '', hash: stockHash(lines), verdict: { action: p0?.verdict.action ?? '', need: p0?.verdict.need ?? 0 }, analysis: snap(positions) });
            const histNote = `Released by the stores${wantQty !== Number(first.quantity) ? ` (quantity ${Number(first.quantity)} → ${wantQty})` : ''}${over.length ? `; override: ${override}` : ''}${note ? `; ${note}` : ''}`.slice(0, 300);
            if (kind === 'automation' && status === 'unverified') {
                const changed = wantQty !== Number(first.quantity);
                const reason = changed ? (clean(ctx.body.reason, 300) || `Stores position: ${p0?.verdict.reasons.join(' ')}`).slice(0, 300) : 'Released by the stores after reviewing the stock position';
                if (changed && reason.length < 10) throw new HttpError(400, 'Give the reason for changing the quantity (at least 10 characters).');
                await verifyReplenishment(ctx, doc.id, { quantity: wantQty, reason, dateRequired: str(ctx.body.dateRequired) || str(first.dateRequired), urgency: str(first.urgency), glCode: str(ctx.body.glCode) || str(first.glCode), uomCode: str(first.uomCode) }, 'INV.req.release');
                const fresh = (await getDoc(`${requirementsPath(ctx.orgId)}/${doc.id}`))!;
                await stamp(ctx, doc.id, (x) => ({ storesRelease: releaseFor(x), history: [{ at, by: ctx.uid, byName: nameOf(ctx), action: 'released by the stores', note: histNote, from: str(fresh.data.status), to: str(fresh.data.status) }] }), [str(fresh.data.status)]);
            } else {
                await stamp(ctx, doc.id, (x) => ({ storesRelease: releaseFor(x), history: [{ at, by: ctx.uid, byName: nameOf(ctx), action: 'released by the stores', note: histNote, from: status, to: status }] }), [status]);
            }
            await record(ctx, 'org.inventory.requirements.release', doc.id, `${histNote}. Position: ${positions.map((p) => `L${p.lineNo} available ${p.stock.available}, pipeline ${p.pipeline.qty}, shortage ${p.shortage}, need ${p.verdict.need}`).join('; ')}`.slice(0, 600));
            return { ok: true, id: doc.id, status: str((await getDoc(`${requirementsPath(ctx.orgId)}/${doc.id}`))?.data.status) };
        }),
    ],
    'POST /api/org/inventory/requirements/cancel': [
        orgRoute('org.inventory.requirements.cancel', 'INV.req.release', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const d = doc.data;
            const kind = sourceKind(d);
            if (kind === 'people') throw new HttpError(403, 'A requirement raised by a person is returned to them, not cancelled by the stores.');
            if (str(d.status) !== 'unverified') throw new HttpError(409, 'Only an automatic requirement not yet released can be cancelled here.');
            const reason = clean(ctx.body.reason, 300);
            if (reason.length < 10) throw new HttpError(400, 'Give the reason for cancelling (at least 10 characters).');
            const positions = await analyse(ctx.orgId, doc);
            const regen = positions.find((p) => p.regeneration);
            if (regen && ctx.body.understood !== true) throw new HttpError(409, `${regen.regeneration} Confirm that you understand.`);
            const at = nowIso();
            const extra = { storesRelease: { status: 'cancelled', by: ctx.uid, byName: nameOf(ctx), at, note: reason, analysis: snap(positions), regenerates: !!regen } };
            if (kind === 'automation') {
                await dismissReplenishment(ctx, doc.id, `Cancelled by the stores: ${reason}`, 'INV.req.release', extra);
            } else {
                await stamp(ctx, doc.id, () => ({ ...extra, status: 'cancelled', cancelReason: `Cancelled by the stores: ${reason}`, history: [{ at, by: ctx.uid, byName: nameOf(ctx), action: 'cancelled by the stores', note: `${reason}. The work order still shows the spare as short until it is re-planned.`, from: 'unverified', to: 'cancelled' }] }), ['unverified']);
            }
            await record(ctx, 'org.inventory.requirements.cancel', doc.id, `${reason}${regen ? ' (will be raised again by replenishment unless levels or strategy change)' : ''}`.slice(0, 400));
            return { ok: true, id: doc.id, status: 'cancelled', regenerates: !!regen };
        }),
    ],
    'POST /api/org/inventory/requirements/return': [
        orgRoute('org.inventory.requirements.return', 'INV.req.release', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const d = doc.data;
            if (sourceKind(d) !== 'people') throw new HttpError(409, 'Automatic requirements are released or cancelled.');
            const status = str(d.status);
            if (!['pending_approval', 'approved'].includes(status)) throw new HttpError(409, 'Only a requirement in approval or approved can be returned by the stores.');
            const reason = clean(ctx.body.reason, 300);
            if (reason.length < 20) throw new HttpError(400, 'Give the reason for returning it (at least 20 characters), for example what stock or open orders already cover it.');
            const positions = await analyse(ctx.orgId, doc);
            const at = nowIso();
            await stamp(ctx, doc.id, () => ({ status: 'returned_user', returnReason: `Stores: ${reason}`, storesRelease: { status: 'returned', by: ctx.uid, byName: nameOf(ctx), at, note: reason, analysis: snap(positions) }, history: [{ at, by: ctx.uid, byName: nameOf(ctx), action: 'returned by the stores', note: reason, from: status, to: 'returned_user' }] }), [status]);
            await record(ctx, 'org.inventory.requirements.return', doc.id, reason);
            return { ok: true, id: doc.id, status: 'returned_user' };
        }),
    ],
};
