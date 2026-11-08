// ---------------------------------------------------------------------------
// Demand forecasting (INV): setup, per-material forecast inputs, forecast-derived levels and their approval.
//
//   organizations/{org}/inventory_setup/forecasting               the setup (versioned, every change with a reason)
//   organizations/{org}/material_forecasts/{material}_{wh}         masked movements, planned events, method, proposal
//
// Levels: the setup decides whether minimum, maximum, reorder quantity, safety stock and reorder point are
//   forecast              derived from the forecast when there are at least the minimum months of issue history
//   manual                always typed by planners
//   manual_unless_forced  manual unless a material is switched to forecasting (levelsSource 'forecast', with a reason)
// When the levels come from the forecast they cannot be typed in Inventory Information (enforced on the update route).
// New forecast levels are worked out on the server from the real journal (never from simulation data) and need
// approval by someone other than the proposer (INV.forecast.approve); a change in stock value (change of the maximum
// level at moving average cost) is also routed through the Chart of Authority. Everything is audited.
// ---------------------------------------------------------------------------

import { HttpError, fieldEq, getDoc, isObj, listDocs, nowIso, runQuery, str, writeDoc } from './core';
import { allowedNodeIds } from './positions';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { allowedAt, audited, holdsAnywhere, requireAt } from './scopeGuard';
import { bypass } from './testModeCore';
// Purchase orders, procurement policy and finance are loaded when used: the material update route (procurement.ts)
// imports this module, and a static import back into that graph would create an initialization cycle.
const po = () => import('./purchaseOrders');
import { LEVEL_FIELDS, METHODS, classify, defaultForecastSetup, effectiveSource, historyMonthsOf, readEvents, readForecastSetup, runForecast, type ForecastSetup, type Instance, type Method } from './forecastModel';

type Obj = Record<string, unknown>;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const root = (orgId: string) => `organizations/${orgId}`;
const setupPath = (orgId: string) => `${root(orgId)}/inventory_setup/forecasting`;
const forecastPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/material_forecasts/${materialId}_${warehouseId}`;
const infoPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/inventory_material_info/${materialId}_${warehouseId}`;
const procPath = (orgId: string, materialId: string, warehouseId: string) => `${root(orgId)}/procurement_material_info/${materialId}_${warehouseId}`;

export const FC = { view: 'INV.forecast.view', edit: 'INV.forecast.edit', approve: 'INV.forecast.approve', setup: 'INV.forecast.setup' };
const LEVEL_LABEL: Record<string, string> = { minimumLevel: 'Minimum', maximumLevel: 'Maximum', reorderQuantity: 'Reorder quantity', safetyStock: 'Safety stock', reorderPoint: 'Reorder point' };

export async function getForecastSetup(orgId: string): Promise<{ setup: ForecastSetup; version: number; saved: Obj | null }> {
    const doc = await getDoc(setupPath(orgId));
    if (!doc) return { setup: defaultForecastSetup(), version: 0, saved: null };
    try {
        return { setup: readForecastSetup(doc.data.setup), version: Number(doc.data.version) || 0, saved: doc.data };
    } catch {
        return { setup: defaultForecastSetup(), version: Number(doc.data.version) || 0, saved: doc.data };
    }
}

/** Posted receipts, issues and reversals of a material in a warehouse over the last three years (oldest first). */
export async function journalInstances(orgId: string, materialId: string, warehouseId: string): Promise<Instance[]> {
    const docs = await runQuery({ from: [{ collectionId: 'material_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, root(orgId));
    const since = Date.now() - 37 * 30.44 * 86_400_000;
    const out: Instance[] = [];
    for (const d of docs) {
        if (str(d.data.status) !== 'posted') continue;
        const at = str(d.data.postedAt) || str(d.data.createdAt);
        const t = Date.parse(at);
        if (!Number.isFinite(t) || t < since) continue;
        const q = Number(isObj(d.data.balancesDelta) ? d.data.balancesDelta.physicalStock : 0) || 0;
        const kind = classify(str(d.data.type), q);
        if (!kind) continue;
        out.push({ id: d.id, at: new Date(t).toISOString(), kind, qty: Math.abs(q), type: str(d.data.type).toUpperCase(), reference: str(d.data.reference) || str(d.data.issueId) || str(d.data.deliveryNote) });
    }
    return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-3000);
}

/** Where the levels of a material come from right now (setup, the material's switch and its issue history). */
export async function levelSourceOf(orgId: string, materialId: string, warehouseId: string, info?: Obj | null) {
    const [{ setup }, instances, doc] = await Promise.all([getForecastSetup(orgId), journalInstances(orgId, materialId, warehouseId), getDoc(forecastPath(orgId, materialId, warehouseId))]);
    const masked = new Set(maskedIds(doc?.data));
    const historyMonths = historyMonthsOf(instances, masked, nowIso());
    return { setup, historyMonths, ...effectiveSource(setup, info ?? null, historyMonths) };
}

/**
 * The message refusing a manual change of a forecast-derived level, or '' when the levels are manual. Called by the
 * material update route before any of minimum, maximum, reorder quantity, safety stock or reorder point changes.
 */
export async function levelsLockedByForecast(orgId: string, materialId: string, warehouseId: string, info: Obj | null, changed: string[]): Promise<string> {
    const levels = changed.filter((k) => (LEVEL_FIELDS as readonly string[]).includes(k));
    if (!levels.length) return '';
    const src = await levelSourceOf(orgId, materialId, warehouseId, info);
    if (src.source !== 'forecast') return '';
    return `${levels.map((k) => LEVEL_LABEL[k]).join(', ')} ${levels.length === 1 ? 'comes' : 'come'} from the forecast: ${src.why} Propose new levels on the Forecasting tab (they need approval)${src.setup.levelMode === 'manual_unless_forced' ? ' or switch the material back to manual' : ''}.`;
}

function maskedIds(d: Obj | undefined): string[] {
    return Array.isArray(d?.masked) ? (d!.masked as unknown[]).filter(isObj).map((m) => str(m.id)).filter(Boolean) : [];
}

function canView(ctx: OrgContext) {
    if (ctx.role === 'org_super_admin') return;
    if (![FC.view, FC.edit, FC.approve, FC.setup, 'INV.view', 'INV.edit'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Inventory access required');
}

function ids(b: Obj) {
    const materialId = str(b.materialId);
    const warehouseId = str(b.warehouseId);
    if (!ID.test(materialId) || !ID.test(warehouseId)) throw new HttpError(400, 'Choose a material and warehouse');
    return { materialId, warehouseId };
}

async function visibleWarehouse(ctx: OrgContext, warehouseId: string) {
    if (ctx.role === 'org_super_admin') return;
    const allowed = await allowedNodeIds(ctx.orgId, ctx.me, true);
    if (allowed !== 'all' && !allowed.has(warehouseId)) throw new HttpError(404, 'Warehouse not found');
}

/** Inputs of the forecast that live on the material: lead times, class, price, order constraints. */
async function materialInputs(orgId: string, materialId: string, warehouseId: string) {
    const { stockValOf } = await import('./finCore');
    const [info, proc, val] = await Promise.all([getDoc(infoPath(orgId, materialId, warehouseId)), getDoc(procPath(orgId, materialId, warehouseId)), stockValOf(orgId, warehouseId, materialId).catch(() => null)]);
    const i = info?.data ?? {};
    const p = proc?.data ?? {};
    const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
    const externalLeadDays = pos(p.leadTimeDays) ?? pos(i.leadTimeDays) ?? 0;
    return {
        info: i,
        externalLeadDays,
        externalLeadSource: pos(p.leadTimeDays) ? 'procurement' : pos(i.leadTimeDays) ? 'inventory' : 'none',
        criticalityClass: str(i.criticalityClass),
        criticalityCell: str(i.criticalityCell),
        unitPrice: pos(p.unitPrice),
        unitCost: val && val.avg > 0 ? val.avg : pos(p.unitPrice) ?? 0,
        moq: pos(p.minimumOrderQuantity),
        orderMultiple: pos(p.orderMultiple),
        current: Object.fromEntries(LEVEL_FIELDS.map((k) => [k, i[k] === '' || i[k] === undefined || i[k] === null ? null : Number(i[k])])) as Record<string, number | null>,
    };
}

function readInputs(b: Obj, setup: ForecastSetup) {
    let events;
    try {
        events = readEvents(b.events);
    } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : 'Invalid planned events');
    }
    const method = str(b.method || 'setup');
    if (!['setup', 'auto', ...METHODS.map((m) => m.code)].includes(method)) throw new HttpError(400, 'Choose a forecast method');
    const n = (v: unknown, label: string, min: number, max: number) => {
        if (v === undefined || v === null || v === '') return null;
        const x = Number(v);
        if (!Number.isInteger(x) || x < min || x > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
        return x;
    };
    const pastMonths = n(b.pastMonths, 'Past months', setup.minHistoryMonths, 36);
    const futureMonths = n(b.futureMonths, 'Future months', 1, 24);
    const internalLeadDays = n(b.internalLeadDays, 'Internal lead time', 0, 120);
    const masks = Array.isArray(b.masked) ? b.masked : [];
    if (masks.length > 500) throw new HttpError(400, 'At most 500 masked movements');
    const masked = masks.map((m) => {
        const id = str(isObj(m) ? m.id : m);
        if (!ID.test(id) || id.startsWith('SIM-')) throw new HttpError(400, 'Only real journal movements can be masked and saved');
        return { id, note: str(isObj(m) ? m.note : '').trim().slice(0, 200) };
    });
    return { events, method, pastMonths, futureMonths, internalLeadDays, masked };
}

function forecastFor(setup: ForecastSetup, instances: Instance[], inputs: Obj, m: Awaited<ReturnType<typeof materialInputs>>) {
    const method = str(inputs.method);
    return runForecast({
        instances,
        masked: maskedIds(inputs),
        setup,
        events: readEvents(inputs.events ?? []),
        now: nowIso(),
        method: method && method !== 'setup' ? (method as Method) : undefined,
        pastMonths: Number(inputs.pastMonths) || undefined,
        futureMonths: Number(inputs.futureMonths) || undefined,
        externalLeadDays: m.externalLeadDays,
        internalLeadDays: inputs.internalLeadDays === null || inputs.internalLeadDays === undefined ? null : Number(inputs.internalLeadDays),
        criticalityClass: m.criticalityClass,
        unitPrice: m.unitPrice,
        moq: m.moq,
        orderMultiple: m.orderMultiple,
    });
}

interface CoaStep {
    level: string;
    title: string;
    positionCode: string;
    positionTitle: string;
    status: 'pending' | 'approved';
    by: string;
    at: string;
}
const stepsOf = (p: Obj): CoaStep[] => (Array.isArray(p.steps) ? (p.steps as unknown[]).filter(isObj).map((x) => ({ ...x }) as unknown as CoaStep) : []);

/** May this person act on the current Chart of Authority level of a proposal (and why not). */
async function coaCheck(ctx: OrgContext, p: Obj): Promise<{ ok: boolean; why: string; testMode: boolean }> {
    const { myPositions } = await po();
    const steps = stepsOf(p);
    const step = steps.find((x) => x.status === 'pending');
    if (!step) return { ok: true, why: '', testMode: false };
    let why = '';
    if (!myPositions(ctx.me).includes(step.positionCode)) why = `Level ${step.level} (${step.title}) is approved by ${step.positionTitle}.`;
    else if (steps.some((x) => x.status === 'approved' && x.by === ctx.uid)) why = 'You approved an earlier level, so a different person must approve this one.';
    if (!why) return { ok: true, why: '', testMode: false };
    if (ctx.testMode === true) return { ok: true, why: '', testMode: true };
    return { ok: false, why, testMode: false };
}

function publicSetup(setup: ForecastSetup, version: number, saved: Obj | null) {
    return { setup, version, updatedAt: str(saved?.updatedAt), updatedBy: str(saved?.updatedBy), reason: str(saved?.reason), history: Array.isArray(saved?.history) ? (saved!.history as unknown[]).slice(0, 20) : [], methods: METHODS };
}

export const forecastingRoutes = {
    'POST /api/org/inventory/forecast/setup/get': [
        orgRoute('org.inventory.forecast.setup.get', null, async (ctx) => {
            canView(ctx);
            const { setup, version, saved } = await getForecastSetup(ctx.orgId);
            return { ...publicSetup(setup, version, saved), canEdit: holdsAnywhere(ctx, [FC.setup]) };
        }),
    ],

    'POST /api/org/inventory/forecast/setup/save': [
        orgRoute('org.inventory.forecast.setup.save', null, async (ctx) => {
            if (!holdsAnywhere(ctx, [FC.setup])) throw new HttpError(403, 'Forecasting setup permission required');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for the change');
            let setup: ForecastSetup;
            try {
                setup = readForecastSetup(ctx.body.setup);
            } catch (e) {
                throw new HttpError(400, e instanceof Error ? e.message : 'Invalid setup');
            }
            const current = await getForecastSetup(ctx.orgId);
            if (Number(ctx.body.version ?? current.version) !== current.version) throw new HttpError(409, 'Someone else changed the setup; reopen it and try again.');
            const now = nowIso();
            const history = [{ version: current.version, setup: current.setup, at: str(current.saved?.updatedAt), by: str(current.saved?.updatedBy), reason: str(current.saved?.reason) }, ...(Array.isArray(current.saved?.history) ? (current.saved!.history as unknown[]) : [])].slice(0, 20);
            await writeDoc(setupPath(ctx.orgId), { setup, version: current.version + 1, updatedAt: now, updatedBy: ctx.uid, reason: reason.slice(0, 500), history } as never);
            // Leaving forced forecasting: pending proposals of materials that are no longer forecast-driven are withdrawn.
            let withdrawn = 0;
            if (setup.levelMode === 'manual' && current.setup.levelMode !== 'manual') {
                for (const f of await listDocs(`${root(ctx.orgId)}/material_forecasts`)) {
                    if (!isObj(f.data.proposal) || str(f.data.proposal.status) !== 'pending') continue;
                    await writeDoc(`${root(ctx.orgId)}/material_forecasts/${f.id}`, { ...f.data, proposal: { ...f.data.proposal, status: 'withdrawn', closedAt: now, closedBy: ctx.uid, closeReason: 'Levels set to manual in the forecasting setup' } } as never);
                    withdrawn++;
                }
            }
            await audited(ctx, 'inventory.forecast.setup.save', 'Forecasting setup', { version: current.version + 1, reason, levelMode: setup.levelMode, method: setup.method, minHistoryMonths: setup.minHistoryMonths, serviceLevels: setup.serviceLevels, roqMethod: setup.roqMethod, withdrawn });
            return { ok: true, version: current.version + 1, withdrawn };
        }),
    ],

    'POST /api/org/inventory/forecast/status': [
        orgRoute('org.inventory.forecast.status', null, async (ctx) => {
            canView(ctx);
            const { materialId, warehouseId } = ids(ctx.body);
            await visibleWarehouse(ctx, warehouseId);
            const info = (await getDoc(infoPath(ctx.orgId, materialId, warehouseId)))?.data ?? null;
            const src = await levelSourceOf(ctx.orgId, materialId, warehouseId, info);
            const canSwitch = src.setup.levelMode === 'manual_unless_forced' && (await allowedAt(ctx, [FC.edit], warehouseId, 'write'));
            return { levelMode: src.setup.levelMode, minHistoryMonths: src.setup.minHistoryMonths, historyMonths: src.historyMonths, source: src.source, why: src.why, forced: str(info?.levelsSource) === 'forecast', canSwitch, appliedAt: str(info?.forecastAppliedAt), levelFields: LEVEL_FIELDS };
        }),
    ],

    'POST /api/org/inventory/forecast/get': [
        orgRoute('org.inventory.forecast.get', null, async (ctx) => {
            canView(ctx);
            const { materialId, warehouseId } = ids(ctx.body);
            await visibleWarehouse(ctx, warehouseId);
            const [{ setup, version }, instances, doc, m] = await Promise.all([getForecastSetup(ctx.orgId), journalInstances(ctx.orgId, materialId, warehouseId), getDoc(forecastPath(ctx.orgId, materialId, warehouseId)), materialInputs(ctx.orgId, materialId, warehouseId)]);
            const f = doc?.data ?? {};
            const masked = new Set(maskedIds(f));
            const historyMonths = historyMonthsOf(instances, masked, nowIso());
            const src = effectiveSource(setup, m.info, historyMonths);
            const proposal = isObj(f.proposal) ? f.proposal : null;
            const [canEdit, canApprove] = await Promise.all([allowedAt(ctx, [FC.edit], warehouseId, 'write'), allowedAt(ctx, [FC.approve], warehouseId, 'write')]);
            const pending = proposal && str(proposal.status) === 'pending';
            const check = pending ? await coaCheck(ctx, proposal!) : { ok: false, why: '', testMode: false };
            return {
                setup,
                setupVersion: version,
                methods: METHODS,
                instances,
                saved: { masked: Array.isArray(f.masked) ? f.masked : [], events: Array.isArray(f.events) ? f.events : [], method: str(f.method) || 'setup', pastMonths: f.pastMonths ?? null, futureMonths: f.futureMonths ?? null, internalLeadDays: f.internalLeadDays ?? null, updatedAt: str(f.updatedAt), updatedBy: str(f.updatedBy), reason: str(f.reason) },
                material: { externalLeadDays: m.externalLeadDays, externalLeadSource: m.externalLeadSource, criticalityClass: m.criticalityClass, criticalityCell: m.criticalityCell, unitPrice: m.unitPrice, unitCost: m.unitCost, moq: m.moq, orderMultiple: m.orderMultiple, current: m.current, strategy: str(m.info.replenishmentStrategy) },
                source: { ...src, levelMode: setup.levelMode, historyMonths, forced: str(m.info.levelsSource) === 'forecast', appliedAt: str(m.info.forecastAppliedAt), appliedMethod: str(m.info.forecastMethod) },
                proposal,
                can: {
                    edit: canEdit,
                    switch: canEdit && setup.levelMode === 'manual_unless_forced',
                    approve: !!pending && canApprove && (str(proposal!.requestedBy) !== ctx.uid || ctx.testMode === true) && check.ok,
                    withdraw: !!pending && str(proposal!.requestedBy) === ctx.uid,
                    approveWhy: pending ? (!canApprove ? 'Forecast approval permission is required for this warehouse.' : str(proposal!.requestedBy) === ctx.uid && ctx.testMode !== true ? 'You proposed these levels; someone else must approve them.' : check.why) : '',
                },
            };
        }),
    ],

    'POST /api/org/inventory/forecast/save': [
        orgRoute('org.inventory.forecast.save', null, async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            await requireAt(ctx, [FC.edit], warehouseId, 'write', 'Forecast permission is required for this warehouse.');
            if (!(await getDoc(`${root(ctx.orgId)}/materials/${materialId}`))) throw new HttpError(404, 'Material not found');
            const { setup } = await getForecastSetup(ctx.orgId);
            const inputs = readInputs(ctx.body, setup);
            const path = forecastPath(ctx.orgId, materialId, warehouseId);
            const prev = (await getDoc(path))?.data ?? {};
            if (isObj(prev.proposal) && str(prev.proposal.status) === 'pending') throw new HttpError(409, 'Proposed levels are waiting for approval; the forecast inputs cannot change until they are approved or returned.');
            // Masks must point at real movements of this material in this warehouse.
            const instances = await journalInstances(ctx.orgId, materialId, warehouseId);
            const known = new Set(instances.map((x) => x.id));
            const unknown = inputs.masked.filter((m) => !known.has(m.id));
            if (unknown.length) throw new HttpError(400, `${unknown.length} masked movement${unknown.length === 1 ? ' is' : 's are'} not in this material's journal`);
            const before = new Set(maskedIds(prev));
            const added = inputs.masked.filter((m) => !before.has(m.id)).map((m) => m.id);
            const removed = [...before].filter((id) => !inputs.masked.some((m) => m.id === id));
            const eventsChanged = JSON.stringify(prev.events ?? []) !== JSON.stringify(inputs.events);
            const reason = str(ctx.body.reason).trim();
            if ((added.length || removed.length || eventsChanged) && reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for masking movements or changing planned events');
            const now = nowIso();
            const oldMasks = new Map((Array.isArray(prev.masked) ? (prev.masked as unknown[]) : []).filter(isObj).map((m) => [str(m.id), m]));
            const masked = inputs.masked.map((m) => oldMasks.get(m.id) ?? { ...m, by: ctx.uid, at: now, reason: reason.slice(0, 300) });
            const doc = { ...prev, materialId, warehouseId, masked, events: inputs.events, method: inputs.method, pastMonths: inputs.pastMonths, futureMonths: inputs.futureMonths, internalLeadDays: inputs.internalLeadDays, reason: reason.slice(0, 500), updatedAt: now, updatedBy: ctx.uid, createdAt: str(prev.createdAt) || now, createdBy: str(prev.createdBy) || ctx.uid };
            await writeDoc(path, doc as never);
            await audited(ctx, 'inventory.forecast.save', `Forecast ${materialId} @ ${warehouseId}`, { masked: masked.length, added, removed, events: inputs.events.map((e) => `${e.label} ${e.recurrence} ${e.month} +${e.qty}${e.upliftPct ? `/${e.upliftPct}%` : ''}`), method: inputs.method, pastMonths: inputs.pastMonths, futureMonths: inputs.futureMonths, internalLeadDays: inputs.internalLeadDays, reason });
            return { ok: true };
        }),
    ],

    'POST /api/org/inventory/forecast/propose': [
        orgRoute('org.inventory.forecast.propose', null, async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            await requireAt(ctx, [FC.edit], warehouseId, 'write', 'Forecast permission is required for this warehouse.');
            const [{ setup, version }, instances, doc, m] = await Promise.all([getForecastSetup(ctx.orgId), journalInstances(ctx.orgId, materialId, warehouseId), getDoc(forecastPath(ctx.orgId, materialId, warehouseId)), materialInputs(ctx.orgId, materialId, warehouseId)]);
            const f = doc?.data ?? {};
            if (isObj(f.proposal) && str(f.proposal.status) === 'pending') throw new HttpError(409, 'Proposed levels are already waiting for approval.');
            const historyMonths = historyMonthsOf(instances, new Set(maskedIds(f)), nowIso());
            const src = effectiveSource(setup, m.info, historyMonths);
            if (src.source !== 'forecast') throw new HttpError(409, `The levels of this material are manual: ${src.why}`);
            if (str(m.info.replenishmentStrategy) === 'RP07') throw new HttpError(409, 'This material is bought on demand (RP07 Direct purchase), so it keeps no minimum or maximum.');
            const result = forecastFor(setup, instances, f, m);
            if (!result.levels.leadDays) throw new HttpError(409, 'Record the supplier lead time (Procurement Information) or an internal lead time before proposing levels.');
            const proposed = Object.fromEntries(LEVEL_FIELDS.map((k) => [k, result.levels[k]])) as Record<string, number>;
            const changes = LEVEL_FIELDS.filter((k) => m.current[k] !== proposed[k]);
            if (!changes.length) throw new HttpError(409, 'The forecast levels are the same as the current levels; nothing to approve.');
            // Value of the change: the change of the maximum stock at moving average cost.
            const value = Math.round(Math.abs(proposed.maximumLevel - (m.current.maximumLevel ?? 0)) * m.unitCost * 100) / 100;
            let steps: CoaStep[] = [];
            let authorityVersion: unknown = null;
            if (value > 0) {
                const [{ getAuthority }, { approvalRoute }] = await Promise.all([import('./procurementPolicy'), po()]);
                const authority = await getAuthority(ctx.orgId);
                const route = await approvalRoute(ctx.orgId, ctx.me, value, authority, ctx.testMode === true);
                if (route.problems.length && !bypass(ctx, 'inv.forecast.coa_route')) throw new HttpError(409, `The Chart of Authority cannot route this change: ${route.problems.join(' ')}`);
                steps = route.steps.map((x) => ({ level: x.level, title: x.title, positionCode: x.positionCode, positionTitle: x.positionTitle, status: 'pending' as const, by: '', at: '' }));
                authorityVersion = route.authorityVersion;
            }
            const now = nowIso();
            const proposal = {
                status: 'pending',
                values: proposed,
                previous: m.current,
                changes,
                value,
                unitCost: m.unitCost,
                steps,
                authorityVersion,
                method: result.method,
                trend: result.trend.direction,
                pattern: result.pattern.pattern,
                accuracy: result.accuracy,
                levels: result.levels,
                historyMonths,
                setupVersion: version,
                masked: maskedIds(f).length,
                events: Array.isArray(f.events) ? f.events.length : 0,
                requestedBy: ctx.uid,
                requestedAt: now,
            };
            await writeDoc(forecastPath(ctx.orgId, materialId, warehouseId), { ...f, materialId, warehouseId, proposal, createdAt: str(f.createdAt) || now, createdBy: str(f.createdBy) || ctx.uid } as never);
            await audited(ctx, 'inventory.forecast.propose', `Forecast ${materialId} @ ${warehouseId}`, { values: proposed, previous: m.current, value, levels: steps.map((s) => s.level), method: result.method, mae: result.accuracy.mae, historyMonths });
            return { ok: true, values: proposed, value, levels: steps.map((s) => s.level) };
        }),
    ],

    'POST /api/org/inventory/forecast/action': [
        orgRoute('org.inventory.forecast.action', null, async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            const action = str(ctx.body.action);
            if (!['approve', 'return', 'withdraw'].includes(action)) throw new HttpError(400, 'Unsupported action');
            const path = forecastPath(ctx.orgId, materialId, warehouseId);
            const doc = await getDoc(path);
            const f = doc?.data ?? {};
            const p = isObj(f.proposal) ? f.proposal : null;
            if (!p || str(p.status) !== 'pending') throw new HttpError(409, 'No proposed levels are waiting for approval');
            const now = nowIso();
            if (action === 'withdraw') {
                if (str(p.requestedBy) !== ctx.uid) throw new HttpError(403, 'Only the person who proposed the levels can withdraw them.');
                await writeDoc(path, { ...f, proposal: { ...p, status: 'withdrawn', closedAt: now, closedBy: ctx.uid } } as never);
                await audited(ctx, 'inventory.forecast.withdraw', `Forecast ${materialId} @ ${warehouseId}`, { values: p.values });
                return { ok: true };
            }
            await requireAt(ctx, [FC.approve], warehouseId, 'write', 'Forecast approval permission is required for this warehouse.');
            if (str(p.requestedBy) === ctx.uid && !bypass(ctx, 'inv.forecast.approve_independence')) throw new HttpError(403, 'Forecast levels must be approved by someone other than the person who proposed them.');
            const check = await coaCheck(ctx, p);
            if (!check.ok) throw new HttpError(403, check.why || 'You cannot approve this level.');
            if (check.testMode) bypass(ctx, 'inv.forecast.coa_approver');
            if (action === 'return') {
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters');
                await writeDoc(path, { ...f, proposal: { ...p, status: 'returned', closedAt: now, closedBy: ctx.uid, closeReason: reason.slice(0, 500) } } as never);
                await audited(ctx, 'inventory.forecast.return', `Forecast ${materialId} @ ${warehouseId}`, { reason, values: p.values });
                return { ok: true };
            }
            const steps = stepsOf(p);
            const step = steps.find((x) => x.status === 'pending');
            if (step) {
                step.status = 'approved';
                step.by = ctx.uid;
                step.at = now;
            }
            if (steps.some((x) => x.status === 'pending')) {
                await writeDoc(path, { ...f, proposal: { ...p, steps } } as never);
                await audited(ctx, 'inventory.forecast.approve_level', `Forecast ${materialId} @ ${warehouseId}`, { level: step?.level, value: p.value });
                return { ok: true, outcome: 'level_approved' };
            }
            // Final approval: the levels are written only if the material is still forecast-driven.
            const { setup } = await getForecastSetup(ctx.orgId);
            const info = (await getDoc(infoPath(ctx.orgId, materialId, warehouseId)))?.data ?? {};
            const instances = await journalInstances(ctx.orgId, materialId, warehouseId);
            const src = effectiveSource(setup, info, historyMonthsOf(instances, new Set(maskedIds(f)), now));
            if (src.source !== 'forecast') throw new HttpError(409, `The levels of this material are manual now (${src.why}); return the proposal.`);
            const values = isObj(p.values) ? p.values : {};
            const patch: Obj = { forecastAppliedAt: now, forecastAppliedBy: ctx.uid, forecastMethod: str(p.method), updatedAt: now, updatedBy: ctx.uid };
            for (const k of LEVEL_FIELDS) if (Number.isFinite(Number(values[k]))) patch[k] = Number(values[k]);
            await writeDoc(infoPath(ctx.orgId, materialId, warehouseId), { ...info, ...patch } as never);
            const history = [{ values, previous: p.previous, value: p.value, approvedAt: now, approvedBy: ctx.uid, requestedBy: p.requestedBy, method: p.method }, ...(Array.isArray(f.history) ? f.history : [])].slice(0, 20);
            await writeDoc(path, { ...f, proposal: { ...p, steps, status: 'approved', closedAt: now, closedBy: ctx.uid }, history } as never);
            await audited(ctx, 'inventory.forecast.approve', `Forecast ${materialId} @ ${warehouseId}`, { values, previous: p.previous, value: p.value, levels: steps.map((s) => s.level) });
            return { ok: true, outcome: 'applied' };
        }),
    ],

    'POST /api/org/inventory/forecast/source': [
        orgRoute('org.inventory.forecast.source', null, async (ctx) => {
            const { materialId, warehouseId } = ids(ctx.body);
            await requireAt(ctx, [FC.edit], warehouseId, 'write', 'Forecast permission is required for this warehouse.');
            const source = str(ctx.body.source);
            if (!['forecast', 'manual'].includes(source)) throw new HttpError(400, 'Choose forecasting or manual');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters');
            const { setup } = await getForecastSetup(ctx.orgId);
            if (setup.levelMode !== 'manual_unless_forced') throw new HttpError(409, setup.levelMode === 'manual' ? 'The forecasting setup keeps every material manual.' : 'The forecasting setup decides from the issue history; materials cannot be switched one by one.');
            const path = infoPath(ctx.orgId, materialId, warehouseId);
            const info = (await getDoc(path))?.data;
            if (!info) throw new HttpError(404, 'Open the material in this warehouse first');
            const was = str(info.levelsSource) === 'forecast' ? 'forecast' : 'manual';
            if (was === source) throw new HttpError(409, `The material already uses ${source === 'forecast' ? 'forecasting' : 'manual levels'}.`);
            const now = nowIso();
            await writeDoc(path, { ...info, levelsSource: source, levelsSourceReason: reason.slice(0, 500), levelsSourceAt: now, levelsSourceBy: ctx.uid, updatedAt: now, updatedBy: ctx.uid } as never);
            // Back to manual: a pending proposal no longer applies.
            if (source === 'manual') {
                const f = await getDoc(forecastPath(ctx.orgId, materialId, warehouseId));
                if (f && isObj(f.data.proposal) && str(f.data.proposal.status) === 'pending') await writeDoc(forecastPath(ctx.orgId, materialId, warehouseId), { ...f.data, proposal: { ...f.data.proposal, status: 'withdrawn', closedAt: now, closedBy: ctx.uid, closeReason: 'Material switched to manual levels' } } as never);
            }
            await audited(ctx, 'inventory.forecast.source', `Forecast ${materialId} @ ${warehouseId}`, { from: was, to: source, reason });
            return { ok: true, source };
        }),
    ],
};
