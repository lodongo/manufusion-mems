// ---------------------------------------------------------------------------
// Work order readiness model (pure: no database access, tested directly).
//
// The workflow state (maintenanceWorkflowState.ts) stays the authorization gate and reports the FIRST blocker. This
// model shows every readiness dimension side by side, so a preceding item never hides or blocks progress downstream:
//   assessment · spares · services · specialist · people · tools · equipment · permits · risk · schedule · cost
// and, after full readiness, the opportunity (a planning window or maintenance window).
// Each dimension holds items (one per spare, service, task …) and each item sub-steps:
//   - system sub-steps are read from live records (requirement → approval → sourcing → requisition → PO approval →
//     delivery → reserved; services up to secured on a purchase order). Evidence further down the chain marks the
//     earlier sub-steps done, even when they were skipped;
//   - manual sub-steps are for what the system cannot see (specialist availability, production stop agreed, tool hire …).
//     They are added by the planner, updated in any order (not started · in progress · done · blocked · not needed),
//     with a note and an expected date.
// Every sub-step carries when it started, when it finished, its age and a target, so delays can be analysed per
// sub-step and across work orders.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const object = (v: unknown): Obj => (isObj(v) ? v : {});

export type StepState = 'done' | 'in_progress' | 'waiting' | 'blocked' | 'not_needed';
export type DimensionKey = 'assessment' | 'spares' | 'services' | 'specialist' | 'people' | 'tools' | 'equipment' | 'permits' | 'risk' | 'schedule' | 'cost' | 'opportunity';
export const DIMENSIONS: Array<{ key: DimensionKey; label: string }> = [
    { key: 'assessment', label: 'Assessment' },
    { key: 'spares', label: 'Spares' },
    { key: 'services', label: 'External services' },
    { key: 'specialist', label: 'Specialist resources' },
    { key: 'people', label: 'Internal labour' },
    { key: 'tools', label: 'Tools' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'permits', label: 'Permits and isolation' },
    { key: 'risk', label: 'Risk review' },
    { key: 'schedule', label: 'Schedule' },
    { key: 'cost', label: 'Cost approval' },
    { key: 'opportunity', label: 'Opportunity / window' },
];
const DIM_LABEL = new Map(DIMENSIONS.map((d) => [d.key, d.label]));

/** Manual sub-steps a planner can add per dimension (custom ones too). */
export const MANUAL_LIBRARY: Record<DimensionKey, Array<{ key: string; label: string }>> = {
    assessment: [{ key: 'site_survey', label: 'Site survey done' }],
    spares: [{ key: 'expedite', label: 'Supplier expedited' }, { key: 'alternative', label: 'Alternative part agreed' }, { key: 'repair', label: 'Repair of the failed unit arranged' }],
    services: [{ key: 'scope_agreed', label: 'Scope agreed with the supplier' }, { key: 'site_visit', label: 'Supplier site visit done' }],
    specialist: [{ key: 'identified', label: 'Specialist identified' }, { key: 'service_request', label: 'Service request raised' }, { key: 'availability', label: 'Availability confirmed' }, { key: 'induction', label: 'Site access and induction arranged' }],
    people: [{ key: 'overtime', label: 'Overtime or shift change approved' }, { key: 'contractor_labour', label: 'Contract labour booked' }],
    tools: [{ key: 'hire', label: 'Special tools hired' }, { key: 'calibration', label: 'Tools inspected or calibrated' }],
    equipment: [{ key: 'crane', label: 'Crane or lifting equipment booked' }, { key: 'scaffold', label: 'Scaffolding erected' }, { key: 'on_site', label: 'Equipment on site' }],
    permits: [{ key: 'permits', label: 'Permits prepared' }, { key: 'isolation', label: 'Isolation plan agreed' }],
    risk: [{ key: 'jsa', label: 'Job safety analysis briefed' }],
    schedule: [{ key: 'production_agreed', label: 'Production agreed the dates' }],
    cost: [{ key: 'budget_transfer', label: 'Budget transfer requested' }],
    opportunity: [{ key: 'production_stop', label: 'Production stop agreed' }, { key: 'shutdown_slot', label: 'Shutdown slot confirmed' }],
};
/** Target days per system sub-step, for delay analysis. */
export const TARGET_DAYS: Record<string, number> = {
    material: 3, pr: 1, pr_approval: 2, sourcing: 5, requisition: 2, po_approval: 2, delivery: 14, reserve: 1,
    secured: 2, onboarding: 10, evidence: 5, allocated: 3, confirmed: 2, review: 2, lock: 2, submit: 2, approve: 3, approved: 3, window: 14,
};

export interface Step {
    key: string;
    label: string;
    state: StepState;
    system: boolean;
    since: string;
    doneAt: string;
    ageDays: number | null;
    targetDays: number | null;
    delayed: boolean;
    ref?: { type: string; id: string; number: string };
    note?: string;
    expectedDate?: string;
    updatedBy?: string;
    updatedAt?: string;
}
export interface Item { id: string; label: string; detail?: string; steps: Step[]; state: StepState }
export interface Dimension { key: DimensionKey; label: string; state: StepState | 'delayed'; done: number; total: number; items: Item[]; current: string }

const DAY = 86_400_000;
const age = (since: string, until: string) => {
    const a = Date.parse(since), b = Date.parse(until);
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(((b - a) / DAY) * 10) / 10 : null;
};

function sys(key: string, label: string, done: boolean, since: string, doneAt: string, now: string, ref?: Step['ref'], partial = false): Step {
    const end = done ? doneAt || since : now;
    const a = since ? age(since, end) : null;
    const t = TARGET_DAYS[key] ?? null;
    return { key, label, state: done ? 'done' : partial ? 'in_progress' : 'waiting', system: true, since, doneAt: done ? doneAt : '', ageDays: a, targetDays: t, delayed: !done && a !== null && t !== null && a > t, ...(ref ? { ref } : {}) };
}

/** Procurement chain sub-steps of one spare or service from its live trace (later evidence completes earlier steps). */
function chain(kind: 'spare' | 'service', item: Obj, now: string, startedAt: string): Step[] {
    const p = object(item.procurement);
    const stage = str(p.stage);
    const order = rows(p.orders).find((o) => o.live === true) ?? rows(p.orders)[0];
    const rq = rows(p.requisitions)[0];
    const qt = rows(p.quotations)[0];
    const reqRef = str(p.requirementId) ? { type: 'requirement', id: str(p.requirementId), number: str(p.requirementId) } : undefined;
    const rank = ['verification', 'approval', 'procurement', 'sourcing', 'requisition', 'ordered', 'partially_received', 'received', 'service_accepted'].indexOf(stage);
    const at = (n: number) => rank >= n;
    const status = str(item.status);
    const secured = kind === 'spare' ? status === 'reserved' : status === 'secured';
    const out: Step[] = [];
    const hasReq = !!str(p.requirementId) || !!str(item.requirementId);
    if (kind === 'spare' && ['awaiting_material_creation', 'awaiting_material_approval', 'needs_specification', 'ready_for_material_creation', 'material_rejected'].includes(status))
        out.push({ ...sys('material', 'Material master created and approved', false, startedAt, '', now), state: status === 'material_rejected' ? 'blocked' : 'waiting' });
    if (kind === 'service' && status === 'awaiting_supplier_onboarding') out.push(sys('onboarding', 'Supplier onboarded', false, startedAt, '', now));
    out.push(sys('pr', 'Purchase requirement raised', hasReq || secured, startedAt, str(p.createdAt), now, reqRef));
    out.push(sys('pr_approval', 'Requirement approved', at(2) || secured, str(p.submittedAt) || str(p.createdAt), str(p.approvedAt), now, reqRef));
    out.push(sys('sourcing', 'Sourcing and quotations', at(4) || secured, str(p.approvedAt), str(rq?.createdAt) || str(qt?.closedAt) || str(order?.createdAt), now, qt ? { type: 'quotation', id: str(qt.id), number: str(qt.number) } : undefined, at(3)));
    out.push(sys('requisition', 'Purchase requisition approved', at(5) || secured, str(rq?.createdAt), str(rq?.approvedAt) || str(order?.createdAt), now, rq ? { type: 'requisition', id: str(rq.id), number: str(rq.number) } : undefined, at(4)));
    const poRef = order ? { type: 'purchase_order', id: str(order.id), number: str(order.number) } : undefined;
    out.push(sys('po_approval', 'Purchase order approved', at(5) || secured, str(order?.createdAt), str(order?.approvedAt) || str(order?.ackAt) || str(order?.createdAt), now, poRef));
    if (kind === 'spare') {
        out.push(sys('delivery', 'Delivered to the warehouse', at(7) || secured, str(order?.ackAt) || str(order?.approvedAt), str(order?.lastReceiptAt), now, poRef, at(6)));
        out.push(sys('reserve', 'Reserved for this work order', secured, str(order?.lastReceiptAt) || str(p.createdAt) || startedAt, secured ? str(item.reservedAt) || str(order?.lastReceiptAt) || now : '', now));
    } else {
        out.push(sys('secured', 'Secured on the purchase order', secured, str(order?.approvedAt) || str(order?.createdAt), secured ? str(item.securedAt) || str(order?.approvedAt) : '', now, poRef));
    }
    if (str(item.status) === 'supply_closed') out.forEach((s) => { if (s.state !== 'done') s.state = 'blocked'; });
    // Straight from stock: one sub-step.
    if (kind === 'spare' && secured && !hasReq) return [sys('reserve', 'Reserved from stock', true, startedAt, str(item.reservedAt) || startedAt, now)];
    return out;
}

export interface ReadinessInput {
    wo: Obj;
    /** readiness().items: spares and services with their live procurement trace. */
    items: Obj[];
    /** planChecklist().items: keyed checklist (people, tools, equipment, schedule, risk, cost …). */
    checklist: Obj[];
    costStatus?: string;
    assessmentApproved: boolean;
    window?: Obj | null;
    now: string;
}

function manualSteps(wo: Obj, dim: DimensionKey, now: string): Step[] {
    const saved = object(object(wo.readinessSteps)[dim]);
    const custom = rows(wo.readinessCustomSteps).filter((c) => str(c.dimension) === dim);
    const lib = MANUAL_LIBRARY[dim];
    const label = (key: string) => lib.find((x) => x.key === key)?.label || str(custom.find((c) => str(c.key) === key)?.label) || key;
    return Object.entries(saved).filter(([, v]) => isObj(v)).map(([key, raw]) => {
        const v = object(raw);
        const state = (['done', 'in_progress', 'waiting', 'blocked', 'not_needed'].includes(str(v.state)) ? str(v.state) : 'waiting') as StepState;
        const since = str(v.addedAt) || str(v.at);
        const expected = str(v.expectedDate);
        const doneAt = state === 'done' ? str(v.doneAt) || str(v.at) : '';
        return {
            key, label: label(key), state, system: false, since, doneAt, ageDays: since ? age(since, doneAt || now) : null, targetDays: null,
            delayed: !['done', 'not_needed'].includes(state) && !!expected && expected < now.slice(0, 10),
            note: str(v.note), expectedDate: expected, updatedBy: str(v.byName), updatedAt: str(v.at),
        };
    });
}

const itemState = (steps: Step[]): StepState => {
    const live = steps.filter((s) => s.state !== 'not_needed');
    if (!live.length || live.every((s) => s.state === 'done')) return 'done';
    if (live.some((s) => s.state === 'blocked')) return 'blocked';
    if (live.some((s) => s.state === 'done' || s.state === 'in_progress')) return 'in_progress';
    return 'waiting';
};

export function readinessModel(input: ReadinessInput) {
    const { wo, items, checklist, now } = input;
    const check = (key: string) => checklist.find((c) => str(c.key) === key);
    const tasks = rows(wo.assessmentTasks);
    const plan = object(wo.taskPlanning);
    const started = str(object(wo.assessmentReview).reviewedAt) || str(object(wo.assessmentReview).at) || str(wo.convertedAt) || str(wo.createdAt);
    const dims: Dimension[] = [];
    const push = (key: DimensionKey, its: Item[]) => {
        const manual = manualSteps(wo, key, now);
        if (manual.length) its = [...its, { id: 'manual', label: 'Follow-up steps', steps: manual, state: itemState(manual) }];
        if (!its.length) return;
        its.forEach((i) => (i.state = itemState(i.steps)));
        const steps = its.flatMap((i) => i.steps).filter((s) => s.state !== 'not_needed');
        const done = steps.filter((s) => s.state === 'done').length;
        const state = itemState(steps);
        const delayed = steps.some((s) => s.delayed);
        const current = steps.find((s) => s.state !== 'done' && s.state !== 'not_needed');
        dims.push({ key, label: DIM_LABEL.get(key)!, state: state !== 'done' && state !== 'blocked' && delayed ? 'delayed' : state, done, total: steps.length, items: its, current: current ? current.label : '' });
    };
    const ck = (key: string, label: string, target: string, item?: string): Item[] => {
        const c = check(key);
        if (!c) return [];
        return [{ id: key, label: item || label, detail: str(c.detail), state: 'waiting', steps: [sys(target, label, c.done === true, started, c.done === true ? str(wo[key + 'ConfirmedAt']) || '' : '', now)] }];
    };

    push('assessment', [{ id: 'assessment', label: 'Work assessment', state: 'waiting', steps: [
        sys('review', 'Assessment completed', rows(wo.assessmentTasks).length > 0, str(wo.createdAt), str(wo.assessedAt) || str(wo.assessmentTasksAt), now),
        sys('approved', 'Assessment approved', input.assessmentApproved, str(wo.assessmentSubmittedAt) || str(wo.assessedAt), str(object(wo.assessmentReview).at), now),
    ] }]);
    const taskName = (id: string) => str(tasks.find((t) => str(t.id) === id)?.description) || 'Task';
    push('spares', items.filter((i) => i.spareId).map((i) => ({
        id: `${str(i.taskId)}_${str(i.spareId)}`, label: str(i.description) || 'Spare', detail: `${taskName(str(i.taskId))} · ${Number(i.qty) || 0} ${str(i.uom)}${Number(i.shortage) > 0 ? ` · short ${i.shortage}` : ''}`,
        state: 'waiting' as StepState, steps: chain('spare', i, now, started),
    })));
    push('services', items.filter((i) => i.kind === 'service').map((i) => ({
        id: `${str(i.taskId)}_${str(i.serviceId)}`, label: str(i.description) || 'Service', detail: taskName(str(i.taskId)), state: 'waiting' as StepState, steps: chain('service', i, now, started),
    })));
    // Specialist: the evidence is system-linked; a service request is linked when the task has a service requirement.
    push('specialist', tasks.filter((t) => str(object(t.externalResource).type)).map((t) => {
        const p = object(plan[str(t.id)]);
        const svc = items.find((i) => i.kind === 'service' && str(i.taskId) === str(t.id) && object(i.procurement).requirementId);
        const steps: Step[] = [];
        if (svc) steps.push(sys('pr', 'Service request raised', true, started, str(object(svc.procurement).createdAt), now, { type: 'requirement', id: str(object(svc.procurement).requirementId), number: str(object(svc.procurement).requirementId) }));
        steps.push(sys('evidence', 'Specialist secured with availability evidence', !!str(object(p.externalSpecialist).at), started, str(object(p.externalSpecialist).at), now));
        return { id: str(t.id), label: `${str(object(t.externalResource).type)} · ${str(t.description)}`, state: 'waiting' as StepState, steps };
    }));
    push('people', ck('people', 'Qualified personnel allocated and competencies confirmed', 'allocated'));
    push('tools', ck('tools', 'Tools available', 'confirmed'));
    push('equipment', ck('equipment', 'Equipment available', 'confirmed'));
    const permits = [...new Set(tasks.flatMap((t) => (Array.isArray(t.permitCodes) ? t.permitCodes.map(str) : [])))];
    // Permits required by the assessed tasks: a "Permits prepared" step waits until the planner updates it.
    push('permits', permits.length && !object(object(wo.readinessSteps).permits).permits ? [{ id: 'permit_list', label: `Permits required: ${permits.join(', ')}`, state: 'waiting', steps: [{ key: 'permits', label: 'Permits prepared', state: 'waiting', system: false, since: started, doneAt: '', ageDays: started ? age(started, now) : null, targetDays: null, delayed: false }] }] : []);
    push('risk', ck('risk', 'Risk assessment reviewed', 'review'));
    push('schedule', ck('schedule', 'Scheduled dates reviewed and locked', 'lock'));
    const cost = check('cost');
    if (cost) push('cost', [{ id: 'cost', label: 'Estimated cost', detail: str(cost.detail), state: 'waiting', steps: [
        sys('submit', 'Cost estimate submitted', cost.done === true || ['pending', 'approved'].includes(str(input.costStatus)), started, '', now),
        sys('approve', 'Cost approved (Chart of Authority)', cost.done === true, started, '', now),
    ] }]);
    const resource = dims.filter((d) => d.key !== 'opportunity');
    const readinessPct = resource.length ? Math.round((resource.reduce((n, d) => n + (d.total ? d.done / d.total : 1), 0) / resource.length) * 100) : 0;
    const fullyReady = resource.length > 0 && resource.every((d) => d.state === 'done');

    // Opportunity: after (or alongside) readiness, when the work can be done. A planning window maps the dates.
    const status = str(wo.status);
    const w = input.window;
    const inWindow = !!w && str(wo.scheduledStart) >= str(w.start) && str(wo.scheduledEnd) <= str(w.end);
    const scheduled = ['scheduled', 'in_progress'].includes(status);
    push('opportunity', [{ id: 'window', label: w ? `${str(w.name)} (${str(w.start)} to ${str(w.end)})` : 'No planning window', state: 'waiting', steps: [
        sys('window', w ? 'Mapped to the planning window' : 'Planning window identified', scheduled || inWindow, str(wo.readinessAchievedAt) || started, str(wo.planningWindowMappedAt), now, w ? { type: 'planning_window', id: str(w.id), number: str(w.id) } : undefined),
        sys('lock', 'Scheduled in a maintenance window', scheduled, str(wo.planningWindowMappedAt) || str(wo.readinessAchievedAt) || started, str(wo.scheduledAt), now),
    ] }]);
    const opportunity = dims.find((d) => d.key === 'opportunity')!;
    const phase = scheduled ? 'scheduled' : fullyReady ? (opportunity.state === 'done' ? 'scheduled' : 'ready_awaiting_opportunity') : 'not_ready';
    const delays = dims.flatMap((d) => d.items.flatMap((i) => i.steps.filter((s) => s.delayed).map((s) => ({ dimension: d.key, dimensionLabel: d.label, item: i.label, step: s.key, label: s.label, ageDays: s.ageDays, targetDays: s.targetDays, expectedDate: s.expectedDate || '' }))));
    const waitingOn = resource.filter((d) => d.state !== 'done').map((d) => ({ key: d.key, label: d.label, current: d.current, state: d.state }));
    return { phase, readinessPct, fullyReady, dimensions: dims, delays, waitingOn, asOf: now };
}
export type ReadinessModel = ReturnType<typeof readinessModel>;

/** Compact snapshot stored on the work order for the readiness report. */
export function readinessSnapshot(m: ReadinessModel) {
    return {
        asOf: m.asOf, phase: m.phase, readinessPct: m.readinessPct, fullyReady: m.fullyReady,
        dimensions: m.dimensions.map((d) => ({ key: d.key, state: d.state, done: d.done, total: d.total, current: d.current })),
        steps: m.dimensions.flatMap((d) => d.items.flatMap((i) => i.steps.filter((s) => s.state !== 'not_needed').map((s) => ({ d: d.key, k: s.key, l: s.label, s: s.state, a: s.ageDays, t: s.targetDays, x: s.delayed, i: i.label.slice(0, 80) })))).slice(0, 150),
        delays: m.delays.length,
    };
}

/** Priority sequence: priority list order, then severity, then scheduled start, then number. */
export function prioritySort<T extends { priorityRank: number; severityRank: number; scheduledStart: string; code: string }>(list: T[]) {
    return [...list].sort((a, b) => a.priorityRank - b.priorityRank || a.severityRank - b.severityRank || (a.scheduledStart || '9999').localeCompare(b.scheduledStart || '9999') || a.code.localeCompare(b.code));
}

/** Bottlenecks across work orders: open sub-steps grouped by dimension and step, with ages. */
export function bottlenecks(snaps: Array<{ code: string; snapshot: ReturnType<typeof readinessSnapshot> }>) {
    const m = new Map<string, { dimension: string; step: string; label: string; open: number; delayed: number; ages: number[]; workOrders: string[] }>();
    for (const { code, snapshot } of snaps) for (const s of snapshot.steps) {
        if (s.s === 'done') continue;
        const k = `${s.d}|${s.k}`;
        const g = m.get(k) ?? { dimension: s.d, step: s.k, label: s.l, open: 0, delayed: 0, ages: [], workOrders: [] };
        g.open++;
        if (s.x) g.delayed++;
        if (s.a !== null && s.a !== undefined) g.ages.push(s.a);
        if (!g.workOrders.includes(code)) g.workOrders.push(code);
        m.set(k, g);
    }
    return [...m.values()].map(({ ages, ...g }) => {
        const sorted = [...ages].sort((a, b) => a - b);
        return { ...g, dimensionLabel: DIM_LABEL.get(g.dimension as DimensionKey) || g.dimension, averageAgeDays: sorted.length ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10 : null, maxAgeDays: sorted.length ? sorted[sorted.length - 1] : null };
    }).sort((a, b) => b.delayed - a.delayed || b.open - a.open);
}

/** Scheduled dates inside a planning window: keep the duration where it fits, else the whole window. */
export function datesWithin(window: { start: string; end: string }, current: { start: string; end: string }, requestedStart?: string) {
    const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d));
    if (!valid(window.start) || !valid(window.end) || window.end < window.start) throw new Error('The planning window dates are invalid.');
    const days = valid(current.start) && valid(current.end) ? Math.max(0, Math.round((Date.parse(current.end) - Date.parse(current.start)) / DAY)) : 0;
    let start = requestedStart && valid(requestedStart) ? requestedStart : window.start;
    if (start < window.start || start > window.end) throw new Error(`Choose a start from ${window.start} to ${window.end}.`);
    const wanted = new Date(Date.parse(start) + days * DAY).toISOString().slice(0, 10);
    let end = wanted;
    let fits = true;
    if (wanted > window.end) {
        // Too long for the rest of the window: start as early as the window allows, keep within it.
        const earliest = new Date(Date.parse(window.end) - days * DAY).toISOString().slice(0, 10);
        if (earliest >= window.start) { start = earliest; end = window.end; } else { start = window.start; end = window.end; fits = false; }
    }
    return { start, end, fits, durationDays: days + 1 };
}
