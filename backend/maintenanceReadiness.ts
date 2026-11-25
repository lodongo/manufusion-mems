// ---------------------------------------------------------------------------
// Work order readiness: prioritised report with drill-down, manual follow-up steps and planning windows.
// Called from the maintenance operations route (org/mnt/operations) with its helpers, so every permission, job-role
// gate, history entry and audit event follows the existing maintenance rules.
//
//   readiness_report          open work orders in scope, in priority sequence, with readiness %, phase, the dimension
//                             waiting, delays, and bottlenecks (open sub-steps across work orders with their ages)
//   readiness_step            add or update a manual sub-step (any order; a preceding step never blocks a later one)
//   planning_windows          planning windows in scope
//   planning_window_save      create a planning window (a period for an opportunity: shutdown, production stop …)
//   planning_window_close     close a window (mapped work orders keep their dates)
//   planning_window_map       map a work order to a window: scheduled start and end move inside the window
//   planning_window_unmap     remove the mapping (dates unchanged)
// Planning actions need MNT.WO.plan and the MNT.WO.PLAN job role at the work order's (or window's) location.
// ---------------------------------------------------------------------------
import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, str, writeDoc, type Doc, type Obj as CoreObj } from './core';
import type { OrgContext } from './guards';
import { audit } from './audit';
import { MANUAL_LIBRARY, DIMENSIONS, bottlenecks, datesWithin, prioritySort, type DimensionKey } from './maintenanceReadinessModel';

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => (isObj(v) ? v : {});
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = ['planning', 'plan_ready', 'released', 'scheduled'];
const KINDS: Record<string, string> = { shutdown: 'Planned shutdown', production_stop: 'Production stop', opportunity: 'Opportunity window', campaign: 'Maintenance campaign' };

export interface ReadinessDeps {
    order: (ctx: OrgContext, code: unknown) => Promise<Doc>;
    authority: (ctx: OrgContext, wo: Doc, permission: string, gate?: string) => Promise<void>;
    authorityAt: (ctx: OrgContext, path: string[], permission: string, gate?: string) => Promise<void>;
    saveWo: (ctx: OrgContext, wo: Doc, patch: CoreObj, action: string, note?: string) => Promise<void>;
    visible: (ctx: OrgContext, path: string[]) => Promise<boolean>;
    applyDates: (ctx: OrgContext, wo: Doc, start: string, end: string, reason: string, extra: CoreObj, action: string) => Promise<{ costSuperseded: boolean }>;
    displayName: (ctx: OrgContext) => string;
    syncOrderAfter: (ctx: OrgContext, id: string, source: string) => Promise<void>;
}

const root = (ctx: OrgContext) => `organizations/${ctx.orgId}`;
const rank = (code: unknown) => { const m = /(\d+)\s*$/.exec(str(code)); return m ? Number(m[1]) : 99; };
const within = (inner: string[], outer: string[]) => outer.length > 0 && outer.every((id, i) => inner[i] === id);

async function windowsInScope(ctx: OrgContext, deps: ReadinessDeps) {
    const all = await listDocs(`${root(ctx)}/mnt_planning_windows`);
    const out: Doc[] = [];
    for (const w of all) if (await deps.visible(ctx, texts(w.data.path))) out.push(w);
    return out;
}

export async function readinessActions(ctx: OrgContext, action: string, deps: ReadinessDeps): Promise<unknown | undefined> {
    const b = ctx.body;
    if (action === 'readiness_report') {
        const wos = (await listDocs(`${root(ctx)}/work_orders`)).filter((w) => OPEN.includes(str(w.data.status)) && w.data.executionMode !== 'request_closure' && !str(w.data.directCompletion && object(w.data.directCompletion).at));
        const visible: Doc[] = [];
        for (const w of wos) if (await deps.visible(ctx, texts(w.data.path))) visible.push(w);
        // Work orders never evaluated yet are refreshed now (a few at a time), so the report is complete.
        const missing = visible.filter((w) => !isObj(w.data.readinessSnapshot)).slice(0, 25);
        for (const w of missing) await deps.syncOrderAfter(ctx, w.id, 'readiness_report');
        const fresh = missing.length ? new Map((await Promise.all(missing.map((w) => getDoc(`${root(ctx)}/work_orders/${w.id}`)))).filter((x): x is Doc => !!x).map((x) => [x.id, x])) : new Map<string, Doc>();
        const list = visible.map((w0) => {
            const w = fresh.get(w0.id) ?? w0;
            const d = w.data, snap = object(d.readinessSnapshot);
            return {
                code: w.id, title: str(d.title), status: str(d.status), workflowLabel: str(d.workflowLabel), workflowReason: str(d.workflowReason), workflowSince: str(d.workflowSince),
                priorityCode: str(d.priorityCode), priorityLabel: str(d.priorityLabel) || 'Not set', priorityRank: rank(d.priorityCode),
                severityLabel: str(d.criticalityLabel) || str(d.severityLabel), severityRank: rank(d.criticalityCode),
                scheduledStart: str(d.scheduledStart), scheduledEnd: str(d.scheduledEnd), unitName: str(d.unitName), unitCode: str(d.unitCode), siteName: str(d.siteName),
                maintenanceType: str(d.maintenanceTypeLabel), planningWindowId: str(d.planningWindowId), readinessAchievedAt: str(d.readinessAchievedAt),
                phase: str(snap.phase) || 'not_ready', readinessPct: Number(snap.readinessPct) || 0, fullyReady: snap.fullyReady === true,
                dimensions: rows(snap.dimensions), delays: Number(snap.delays) || 0, steps: rows(snap.steps), asOf: str(snap.asOf),
            };
        });
        const ordered = prioritySort(list).map((x, i) => ({ ...x, sequence: i + 1 }));
        const snaps = ordered.map((x) => ({ code: x.code, snapshot: { steps: x.steps } as never }));
        const windows = await windowsInScope(ctx, deps);
        return {
            workOrders: ordered,
            bottlenecks: bottlenecks(snaps),
            summary: {
                total: ordered.length,
                fullyReady: ordered.filter((x) => x.fullyReady).length,
                awaitingOpportunity: ordered.filter((x) => x.phase === 'ready_awaiting_opportunity').length,
                scheduled: ordered.filter((x) => x.phase === 'scheduled').length,
                withDelays: ordered.filter((x) => x.delays > 0).length,
                averagePct: ordered.length ? Math.round(ordered.reduce((n, x) => n + x.readinessPct, 0) / ordered.length) : 0,
            },
            dimensions: DIMENSIONS,
            windows: windows.map((w) => ({ id: w.id, ...w.data })).filter((w) => str((w as Obj).status) === 'open'),
        };
    }

    if (action === 'readiness_step') {
        const wo = await deps.order(ctx, b.code);
        if (!OPEN.includes(str(wo.data.status))) throw new HttpError(409, 'Readiness can be updated only while the work order is being prepared or scheduled.');
        await deps.authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
        const dimension = str(b.dimension) as DimensionKey;
        if (!DIMENSIONS.some((x) => x.key === dimension)) throw new HttpError(400, 'Choose a readiness area.');
        let key = str(b.step);
        const custom = rows(wo.data.readinessCustomSteps);
        const extra: Obj = {};
        if (key === 'custom') {
            const label = str(b.label).trim();
            if (label.length < 3 || label.length > 80) throw new HttpError(400, 'Name the follow-up step (3 to 80 characters).');
            if (custom.length >= 40) throw new HttpError(409, 'This work order already has 40 custom steps.');
            key = 'c_' + randomId(4);
            extra.readinessCustomSteps = [...custom, { key, dimension, label, at: nowIso(), by: ctx.uid }];
        } else if (!MANUAL_LIBRARY[dimension].some((x) => x.key === key) && !custom.some((c) => str(c.key) === key && str(c.dimension) === dimension)) {
            throw new HttpError(400, 'Choose a follow-up step for this area.');
        }
        const state = str(b.state);
        if (!['waiting', 'in_progress', 'done', 'blocked', 'not_needed', 'remove'].includes(state)) throw new HttpError(400, 'Choose the state of the step.');
        const note = str(b.note).trim().slice(0, 500);
        if (['blocked', 'not_needed', 'remove'].includes(state) && note.length < 10) throw new HttpError(400, 'Say why (at least 10 characters).');
        const expectedDate = str(b.expectedDate);
        if (expectedDate && (!DAY_RE.test(expectedDate) || !Number.isFinite(Date.parse(expectedDate)))) throw new HttpError(400, 'Enter the expected date as YYYY-MM-DD.');
        const all = object(wo.data.readinessSteps);
        const dim = { ...object(all[dimension]) };
        const prev = object(dim[key]);
        const at = nowIso();
        if (state === 'remove') {
            if (!Object.keys(prev).length) throw new HttpError(404, 'That step is not on this work order.');
            delete dim[key];
        } else {
            dim[key] = {
                state, note, expectedDate, at, by: ctx.uid, byName: deps.displayName(ctx),
                addedAt: str(prev.addedAt) || at, doneAt: state === 'done' ? (str(prev.state) === 'done' ? str(prev.doneAt) : at) : '',
                history: [{ at, by: ctx.uid, byName: deps.displayName(ctx), from: str(prev.state) || 'new', to: state, note, expectedDate }, ...rows(prev.history)].slice(0, 20),
            };
        }
        const label = MANUAL_LIBRARY[dimension].find((x) => x.key === key)?.label || str(b.label) || str(custom.find((c) => str(c.key) === key)?.label) || key;
        await deps.saveWo(ctx, wo, { ...extra, readinessSteps: { ...all, [dimension]: dim } } as CoreObj, 'readiness.step', `${DIMENSIONS.find((x) => x.key === dimension)!.label} · ${label}: ${str(prev.state) || 'new'} → ${state}${expectedDate ? ' · expected ' + expectedDate : ''}${note ? ' · ' + note : ''}`);
        return { ok: true, key };
    }

    if (action === 'planning_windows') {
        const windows = await windowsInScope(ctx, deps);
        const wos = await listDocs(`${root(ctx)}/work_orders`);
        return {
            windows: windows.map((w) => ({ id: w.id, ...w.data, mapped: wos.filter((x) => str(x.data.planningWindowId) === w.id && !['closed', 'cancelled'].includes(str(x.data.status))).map((x) => ({ code: x.id, title: str(x.data.title), scheduledStart: str(x.data.scheduledStart), scheduledEnd: str(x.data.scheduledEnd), status: str(x.data.status) })) }))
                .sort((a, c) => str((a as Obj).start).localeCompare(str((c as Obj).start))),
            kinds: KINDS,
        };
    }

    if (action === 'planning_window_save') {
        const name = str(b.name).trim();
        if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Name the planning window (3 to 80 characters).');
        const kind = str(b.kind);
        if (!KINDS[kind]) throw new HttpError(400, 'Choose the kind of window.');
        const start = str(b.start), end = str(b.end);
        if (!DAY_RE.test(start) || !DAY_RE.test(end) || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) throw new HttpError(400, 'Enter the window dates as YYYY-MM-DD.');
        if (end < start) throw new HttpError(400, 'The window cannot end before it starts.');
        if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 90) throw new HttpError(400, 'A planning window can be at most 90 days long.');
        if (end < nowIso().slice(0, 10)) throw new HttpError(400, 'The window has already ended.');
        const nodeId = str(b.scopeNodeId);
        const node = /^[A-Za-z0-9_-]{1,80}$/.test(nodeId) ? await getDoc(`${root(ctx)}/structure/${nodeId}`) : null;
        if (!node) throw new HttpError(400, 'Choose where the window applies (site, area or equipment).');
        const { nodePath } = await import('./access');
        const path = await nodePath(ctx.orgId, node.id);
        await deps.authorityAt(ctx, path, 'MNT.WO.plan', 'MNT.WO.PLAN');
        const note = str(b.note).trim().slice(0, 500);
        const id = 'PW' + start.replace(/-/g, '') + randomId(2).toUpperCase();
        const at = nowIso();
        const doc = { name, kind, kindLabel: KINDS[kind], start, end, scopeNodeId: node.id, scopeName: str(node.data.name), scopeLevel: str(node.data.level), path, note, status: 'open', createdAt: at, createdBy: ctx.uid, createdByName: deps.displayName(ctx) };
        if (!(await writeDoc(`${root(ctx)}/mnt_planning_windows/${id}`, doc as never, { exists: false }))) throw new HttpError(409, 'Try again.');
        await audit([{ category: 'maintenance', action: 'mnt.planning_window.created', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: id }, details: `${name} · ${KINDS[kind]} · ${start} to ${end} · ${str(node.data.name)}${note ? ' · ' + note : ''}` }]);
        return { ok: true, id };
    }

    if (action === 'planning_window_close') {
        const id = str(b.id);
        const w = /^PW\d{8}[0-9A-F]{4}$/.test(id) ? await getDoc(`${root(ctx)}/mnt_planning_windows/${id}`) : null;
        if (!w) throw new HttpError(404, 'Planning window not found.');
        await deps.authorityAt(ctx, texts(w.data.path), 'MNT.WO.plan', 'MNT.WO.PLAN');
        const reason = str(b.reason).trim();
        if (reason.length < 10) throw new HttpError(400, 'Say why the window is closed (at least 10 characters).');
        if (str(w.data.status) !== 'open') throw new HttpError(409, 'The window is already closed.');
        await writeDoc(`${root(ctx)}/mnt_planning_windows/${id}`, { ...w.data, status: 'closed', closedAt: nowIso(), closedBy: ctx.uid, closeReason: reason.slice(0, 500) } as never, { updateTime: w.updateTime });
        await audit([{ category: 'maintenance', action: 'mnt.planning_window.closed', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label: id }, details: reason }]);
        return { ok: true };
    }

    if (action === 'planning_window_map' || action === 'planning_window_unmap') {
        const wo = await deps.order(ctx, b.code);
        if (!['planning', 'plan_ready', 'released'].includes(str(wo.data.status))) throw new HttpError(409, 'Only a work order that is not yet scheduled can be mapped to a planning window.');
        await deps.authority(ctx, wo, 'MNT.WO.plan', 'MNT.WO.PLAN');
        const reason = str(b.reason).trim().slice(0, 300);
        if (reason.length < 10) throw new HttpError(400, 'Say why (at least 10 characters).');
        if (action === 'planning_window_unmap') {
            if (!str(wo.data.planningWindowId)) throw new HttpError(409, 'The work order is not mapped to a planning window.');
            await deps.saveWo(ctx, wo, { planningWindowId: '', planningWindowMappedAt: '' }, 'readiness.window_unmapped', `${str(wo.data.planningWindowId)} · ${reason}`);
            return { ok: true };
        }
        const id = str(b.windowId);
        const w = /^PW\d{8}[0-9A-F]{4}$/.test(id) ? await getDoc(`${root(ctx)}/mnt_planning_windows/${id}`) : null;
        if (!w || str(w.data.status) !== 'open') throw new HttpError(404, 'Choose an open planning window.');
        if (!within(texts(wo.data.path), texts(w.data.path))) throw new HttpError(409, `${str(w.data.name)} does not cover the equipment of this work order.`);
        let dates;
        try {
            dates = datesWithin({ start: str(w.data.start), end: str(w.data.end) }, { start: str(wo.data.scheduledStart), end: str(wo.data.scheduledEnd) }, str(b.start) || undefined);
        } catch (e) {
            throw new HttpError(400, e instanceof Error ? e.message : 'Invalid dates');
        }
        if (!dates.fits && b.acceptShorter !== true) throw new HttpError(409, `The work needs about ${dates.durationDays} day(s) but the window has fewer. Confirm to use the whole window anyway.`);
        const r = await deps.applyDates(ctx, wo, dates.start, dates.end, `Planning window ${str(w.data.name)}: ${reason}`, { planningWindowId: w.id, planningWindowMappedAt: nowIso() }, 'readiness.window_mapped');
        return { ok: true, start: dates.start, end: dates.end, fits: dates.fits, costSuperseded: r.costSuperseded };
    }
    return undefined;
}
