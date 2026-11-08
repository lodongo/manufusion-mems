// Trace of a purchase requirement from the moment it was raised until it is delivered and paid, and the delay
// analytics built on it. Pure: no database access, so every rule can be tested.
//
// Milestones (those that happened, in time order): raised → released by the stores → approved by the manager →
// acknowledged by procurement → quotation opened → quote recommended → requisition → requisition confirmed → order
// created → order approved → sent to the supplier → acknowledged by the supplier → first delivery → delivered in full
// → invoice recorded → invoice posted → paid.
//
// Groups: internal (everything until the order goes to the supplier), external (the supplier: from the order being
// sent, or approved if never sent, until delivered in full) and finance (invoice to payment, internal too but shown
// on its own). While a step is still open, the time from the last milestone to today counts against the next step.
//
// Delays in days (positive = late):
//   internal: the order went out after (need date − supplier lead time)
//   external: delivered in full after the expected delivery (sent or approved + quoted lead time)
//   overall:  delivered in full after the date needed

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const day = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
export const daysBetween = (from: string, to: string) => (from && to ? r1((day(to) - day(from)) / 86_400_000) : 0);
const addDays = (iso: string, n: number) => (iso ? new Date(day(iso.slice(0, 10)) + n * 86_400_000).toISOString().slice(0, 10) : '');

export type Group = 'internal' | 'external' | 'finance';
export const STEPS: Array<{ key: string; label: string; party: string; group: Group }> = [
    { key: 'raised', label: 'Requirement raised', party: 'Requester / automation', group: 'internal' },
    { key: 'released', label: 'Released by the stores', party: 'Stores', group: 'internal' },
    { key: 'approved', label: 'Approved by the manager', party: 'Manager', group: 'internal' },
    { key: 'acknowledged', label: 'Acknowledged by procurement', party: 'Procurement', group: 'internal' },
    { key: 'quotation', label: 'Quotation opened', party: 'Procurement', group: 'internal' },
    { key: 'recommended', label: 'Quote recommended', party: 'Procurement (sourcing)', group: 'internal' },
    { key: 'requisition', label: 'Requisition created', party: 'Procurement', group: 'internal' },
    { key: 'reqConfirmed', label: 'Requisition confirmed', party: 'Requester', group: 'internal' },
    { key: 'poCreated', label: 'Order created', party: 'Procurement', group: 'internal' },
    { key: 'poApproved', label: 'Order approved', party: 'Approvers', group: 'internal' },
    { key: 'sent', label: 'Sent to the supplier', party: 'Procurement', group: 'internal' },
    { key: 'supplierAck', label: 'Acknowledged by the supplier', party: 'Supplier', group: 'external' },
    { key: 'firstDelivery', label: 'First delivery', party: 'Supplier', group: 'external' },
    { key: 'delivered', label: 'Delivered in full', party: 'Supplier', group: 'external' },
    { key: 'invoiced', label: 'Invoice recorded', party: 'Supplier / accounts payable', group: 'finance' },
    { key: 'invoicePosted', label: 'Invoice approved and posted', party: 'Finance approvers', group: 'finance' },
    { key: 'paid', label: 'Paid', party: 'Finance', group: 'finance' },
];
const STEP = new Map(STEPS.map((s, i) => [s.key, { ...s, i }]));
export const STAGE_NOW: Record<string, string> = {
    raised: 'With the stores', released: 'With the manager', approved: 'With procurement', acknowledged: 'Sourcing', quotation: 'Sourcing', recommended: 'Requisition', requisition: 'Requisition confirmation', reqConfirmed: 'Order to be created', poCreated: 'Order approval', poApproved: 'To be sent to the supplier', sent: 'With the supplier', supplierAck: 'With the supplier', firstDelivery: 'Partly delivered', delivered: 'Delivered, not invoiced', invoiced: 'Invoice in approval', invoicePosted: 'Awaiting payment', paid: 'Paid',
};

export interface TraceInput {
    req: { id: string; data: Obj };
    quotations: Array<{ id: string; data: Obj }>;
    requisitions: Array<{ id: string; data: Obj }>;
    orders: Array<{ id: string; data: Obj }>;
    invoices: Array<{ id: string; data: Obj }>;
    payments: Array<{ id: string; data: Obj }>;
    today: string;
    materialLeadDays?: number;
}

const IN_FORCE = ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial', 'full', 'closed'];
const baseOf = (id: string) => id.replace(/-V\d+$/, '');
const verOf = (id: string) => Number((id.match(/-V(\d+)$/) ?? [])[1] ?? 1);
const earliest = (xs: string[]) => xs.filter(Boolean).sort()[0] ?? '';
const latestOf = (xs: string[]) => xs.filter(Boolean).sort().slice(-1)[0] ?? '';
const LIVE_INV = ['on_hold', 'pending_approval', 'posted', 'part_paid', 'paid'];

export function traceRequirement(t: TraceInput) {
    const d = t.req.data;
    const id = t.req.id;
    const lines = objs(d.lines).filter((l) => str(l.materialId) && str(l.warehouseId));
    const first = lines[0] ?? objs(d.lines)[0] ?? {};
    const hist = objs(d.history);
    const hAt = (re: RegExp) => str(hist.find((h) => re.test(str(h.action)))?.at);
    const needDate = earliest(lines.map((l) => str(l.dateRequired)));
    const requested = r3(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0));

    const cases = t.quotations.filter((c) => str(c.data.requirementId) === id && str(c.data.status) !== 'cancelled');
    const rqs = t.requisitions.filter((r) => str(r.data.requirementId) === id && str(r.data.status) !== 'cancelled');
    // One version per order: the latest in force that carries this requirement.
    const latest = new Map<string, { id: string; data: Obj }>();
    for (const p of t.orders) {
        if (!IN_FORCE.includes(str(p.data.status)) || !objs(p.data.lines).some((l) => str(l.requirementId) === id)) continue;
        const b = baseOf(p.id);
        const cur = latest.get(b);
        if (!cur || verOf(p.id) > verOf(cur.id)) latest.set(b, p);
    }
    const pos = Array.from(latest.values());
    const poLines = pos.flatMap((p) => objs(p.data.lines).filter((l) => str(l.requirementId) === id).map((l) => ({ p, l })));
    const ordered = r3(poLines.reduce((s, x) => s + (Number(x.l.quantity) || 0), 0));
    // Deliveries of this requirement's lines (net of reversals), in time order.
    const dels = pos
        .flatMap((p) =>
            objs(p.data.deliveries).map((dv) => {
                const nos = new Set(objs(p.data.lines).filter((l) => str(l.requirementId) === id).map((l) => Number(l.no)));
                const qty = objs(dv.lines).filter((x) => nos.has(Number(x.no))).reduce((s, x) => s + Math.max(0, (Number(x.qty) || 0) - (Number(x.reversedQty) || 0)), 0);
                return { po: p.id, id: str(dv.id), recNo: str(dv.recNo) || str(dv.id), at: str(dv.at), date: str(dv.date), qty: r3(qty), ref: str(dv.ref) };
            }),
        )
        .filter((x) => x.qty > 0)
        .sort((a, b) => a.at.localeCompare(b.at));
    let cum = 0;
    let fullAt = '';
    for (const x of dels) {
        cum = r3(cum + x.qty);
        if (!fullAt && ordered > 0 && cum + 1e-9 >= ordered) fullAt = x.at;
    }
    const received = r3(cum);
    const delIds = new Set(dels.map((x) => x.id));
    const invs = t.invoices.filter((i) => LIVE_INV.includes(str(i.data.status)) && (Array.isArray(i.data.deliveryIds) ? (i.data.deliveryIds as unknown[]).map(str) : []).some((x) => delIds.has(x)));
    const allPaid = invs.length > 0 && invs.every((i) => str(i.data.status) === 'paid') && !!fullAt;
    const paidAt = allPaid ? latestOf(t.payments.filter((p) => str(p.data.status) === 'paid' && objs(p.data.invoices).some((a) => invs.some((i) => i.id === str(a.id)))).map((p) => str(p.data.paidAt) || str(p.data.updatedAt))) : '';
    const sentAt = earliest(pos.map((p) => str(p.data.sentAt)));
    const approvedAt = earliest(pos.map((p) => str(p.data.approvedAt)));

    const at: Record<string, string> = {
        raised: str(d.createdAt),
        released: str(o(d.storesRelease).status) === 'released' ? str(o(d.storesRelease).at) : '',
        approved: str(d.approvedAt) || hAt(/^approved/),
        acknowledged: str(d.acknowledgedAt) || hAt(/^acknowledged/),
        quotation: earliest(cases.map((c) => str(c.data.createdAt))),
        recommended: earliest(cases.map((c) => str(o(c.data.recommendation).at))),
        requisition: earliest(rqs.map((r) => str(r.data.createdAt))),
        reqConfirmed: earliest(rqs.map((r) => str(r.data.confirmedAt))),
        poCreated: earliest(pos.map((p) => str(p.data.originAt) || str(p.data.createdAt))),
        poApproved: approvedAt,
        sent: sentAt,
        supplierAck: earliest(pos.map((p) => str(o(p.data.ack).at))),
        firstDelivery: dels[0]?.at ?? '',
        delivered: fullAt,
        invoiced: earliest(invs.map((i) => str(i.data.createdAt))),
        invoicePosted: invs.length && invs.every((i) => str(i.data.postedAt)) ? latestOf(invs.map((i) => str(i.data.postedAt))) : '',
        paid: paidAt,
    };
    const milestones = STEPS.filter((s) => at[s.key]).map((s) => ({ ...s, at: at[s.key] })).sort((a, b) => a.at.localeCompare(b.at) || STEP.get(a.key)!.i - STEP.get(b.key)!.i);
    const lastKey = milestones.length ? milestones.reduce((best, m) => (STEP.get(m.key)!.i > STEP.get(best.key)!.i ? m : best)).key : 'raised';
    const done = !!at.paid;
    const cancelled = ['cancelled', 'rejected'].includes(str(d.status));
    // The step still open: from the last milestone to today, against the next step.
    const nextStep = STEPS.find((s) => STEP.get(s.key)!.i > STEP.get(lastKey)!.i && !at[s.key] && !(s.key === 'firstDelivery' && at.delivered) && !(s.key === 'supplierAck' && at.firstDelivery));
    const steps = milestones.slice(1).map((m, i) => ({ key: m.key, from: milestones[i].label, to: m.label, party: m.party, group: m.group, days: Math.max(0, daysBetween(milestones[i].at, m.at)), ongoing: false }));
    if (!done && !cancelled && nextStep && milestones.length) {
        const last = milestones[milestones.length - 1];
        steps.push({ key: nextStep.key, from: last.label, to: `${nextStep.label} (waiting)`, party: nextStep.party, group: nextStep.group, days: Math.max(0, daysBetween(last.at, t.today)), ongoing: true });
    }
    const total = steps.reduce((s, x) => s + x.days, 0);
    const byGroup = { internal: 0, external: 0, finance: 0 } as Record<Group, number>;
    for (const s of steps) byGroup[s.group] = r1(byGroup[s.group] + s.days);
    const byParty = Object.values(steps.reduce<Record<string, { party: string; days: number }>>((acc, s) => ((acc[s.party] = { party: s.party, days: r1((acc[s.party]?.days ?? 0) + s.days) }), acc), {})).map((p) => ({ ...p, pct: total > 0 ? r1((p.days / total) * 100) : 0 }));

    const supplierLead = Math.max(0, ...poLines.map((x) => Number(x.l.leadTimeDays) || 0), poLines.length ? 0 : t.materialLeadDays ?? 0);
    const outAt = (sentAt || approvedAt).slice(0, 10);
    const expectedDelivery = outAt ? (supplierLead ? addDays(outAt, supplierLead) : earliest(poLines.map((x) => str(x.l.dateRequired)))) : '';
    const plannedSendBy = needDate && supplierLead ? addDays(needDate, -supplierLead) : needDate;
    const internalDelay = plannedSendBy ? r1(Math.max(0, daysBetween(plannedSendBy, (outAt || t.today).slice(0, 10)))) : 0;
    const externalDelay = expectedDelivery ? r1(Math.max(0, daysBetween(expectedDelivery, (fullAt || t.today).slice(0, 10)))) : 0;
    const overallDelay = needDate ? r1(daysBetween(needDate, (fullAt || t.today).slice(0, 10))) : 0;
    const outstanding = r3(Math.max(0, ordered - received));
    const vendor = str(pos[0]?.data.vendorName);
    return {
        id,
        number: str(d.number) || id,
        title: str(d.title),
        source: str(d.source),
        status: str(d.status),
        materialId: str(first.materialId),
        materialNumber: str(first.materialNumber),
        material: str(first.itemName) || str(first.requirement),
        warehouseId: str(first.warehouseId),
        warehouse: str(first.warehouseCode),
        unit: str(first.unit),
        lines: lines.length,
        requested,
        ordered,
        received,
        outstanding,
        needDate,
        expectedDelivery,
        plannedSendBy,
        supplierLead,
        vendor,
        orders: pos.map((p) => str(p.data.number) || p.id),
        deliveries: dels,
        invoices: invs.map((i) => ({ id: i.id, status: str(i.data.status), amount: Number(i.data.amount) || 0, currency: str(i.data.currency) })),
        milestones,
        steps,
        byGroup,
        byParty,
        totalDays: r1(total),
        stage: cancelled ? 'cancelled' : lastKey,
        stageLabel: cancelled ? 'Cancelled' : STAGE_NOW[lastKey] ?? lastKey,
        delivered: !!fullAt,
        deliveredAt: fullAt,
        paid: done,
        awaitingDelivery: !cancelled && !fullAt && (ordered > 0 || !!at.poApproved),
        deliveryExpired: !cancelled && !fullAt && !!expectedDelivery && expectedDelivery < t.today,
        dueSoon: !cancelled && !fullAt && !!expectedDelivery && expectedDelivery >= t.today && daysBetween(t.today, expectedDelivery) <= 7,
        internalDelay,
        externalDelay,
        overallDelay,
        onTime: !!fullAt && overallDelay <= 0,
    };
}
export type Trace = ReturnType<typeof traceRequirement>;

export const PYRAMID = [
    { key: 'on_time', label: 'On time', min: -Infinity, max: 0 },
    { key: 'd1_7', label: '1-7 days late', min: 0, max: 7 },
    { key: 'd8_14', label: '8-14 days late', min: 7, max: 14 },
    { key: 'd15_30', label: '15-30 days late', min: 14, max: 30 },
    { key: 'd31_60', label: '31-60 days late', min: 30, max: 60 },
    { key: 'd60', label: 'Over 60 days late', min: 60, max: Infinity },
];
export const bucketOf = (delay: number) => (PYRAMID.find((b) => delay > b.min && delay <= b.max) ?? PYRAMID[0]).key;

const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);

/** Overall performance across traced requirements. */
export function dashboardOf(traces: Trace[], today: string) {
    const live = traces.filter((t) => t.stage !== 'cancelled');
    const delivered = live.filter((t) => t.delivered);
    const steps = new Map<string, { key: string; label: string; group: Group; days: number[] }>();
    for (const t of live) for (const s of t.steps) {
        const e = steps.get(s.key) ?? { key: s.key, label: STEPS.find((x) => x.key === s.key)?.label ?? s.key, group: s.group, days: [] };
        e.days.push(s.days);
        steps.set(s.key, e);
    }
    const vendors = new Map<string, { vendor: string; n: number; onTime: number; delays: number[]; external: number[] }>();
    for (const t of delivered.filter((x) => x.vendor)) {
        const v = vendors.get(t.vendor) ?? { vendor: t.vendor, n: 0, onTime: 0, delays: [], external: [] };
        v.n++;
        if (t.externalDelay <= 0) v.onTime++;
        v.delays.push(t.externalDelay);
        v.external.push(t.byGroup.external);
        vendors.set(t.vendor, v);
    }
    const pyramid = PYRAMID.map((b) => ({ key: b.key, label: b.label, count: live.filter((t) => (t.delivered || t.overallDelay > 0) && bucketOf(t.overallDelay) === b.key).length }));
    const funnel = Object.entries(live.reduce<Record<string, number>>((acc, t) => ((acc[t.stageLabel] = (acc[t.stageLabel] ?? 0) + 1), acc), {})).map(([label, count]) => ({ label, count }));
    const months = new Map<string, { month: string; internal: number[]; external: number[] }>();
    for (const t of delivered) {
        const m = t.deliveredAt.slice(0, 7);
        const e = months.get(m) ?? { month: m, internal: [], external: [] };
        e.internal.push(t.byGroup.internal);
        e.external.push(t.byGroup.external);
        months.set(m, e);
    }
    const sumGroup = (g: Group) => r1(live.reduce((s, t) => s + t.byGroup[g], 0));
    return {
        today,
        counts: { traced: live.length, delivered: delivered.length, awaiting: live.filter((t) => t.awaitingDelivery).length, expired: live.filter((t) => t.deliveryExpired).length, dueSoon: live.filter((t) => t.dueSoon).length, notOrdered: live.filter((t) => !t.ordered).length, awaitingPayment: live.filter((t) => t.delivered && !t.paid).length, paid: live.filter((t) => t.paid).length },
        averages: {
            internalDays: avg(live.filter((t) => t.milestones.some((m) => m.key === 'sent' || m.key === 'poApproved')).map((t) => t.byGroup.internal)),
            externalDays: avg(delivered.map((t) => t.byGroup.external)),
            financeDays: avg(live.filter((t) => t.paid).map((t) => t.byGroup.finance)),
            internalDelay: avg(live.filter((t) => t.ordered).map((t) => t.internalDelay)),
            externalDelay: avg(delivered.map((t) => t.externalDelay)),
            overallDelay: avg(delivered.map((t) => Math.max(0, t.overallDelay))),
            onTimePct: delivered.length ? Math.round((delivered.filter((t) => t.onTime).length / delivered.length) * 100) : 0,
            cycleDays: avg(live.filter((t) => t.paid).map((t) => t.totalDays)),
        },
        split: [
            { key: 'internal', label: 'Internal (stores, approvals, procurement)', days: sumGroup('internal') },
            { key: 'external', label: 'External (supplier delivery)', days: sumGroup('external') },
            { key: 'finance', label: 'Finance (invoice to payment)', days: sumGroup('finance') },
        ],
        steps: Array.from(steps.values()).map((s) => ({ key: s.key, label: s.label, group: s.group, avgDays: avg(s.days), count: s.days.length })).sort((a, b) => b.avgDays - a.avgDays),
        pyramid,
        funnel: funnel.sort((a, b) => b.count - a.count),
        vendors: Array.from(vendors.values()).map((v) => ({ vendor: v.vendor, deliveries: v.n, onTimePct: Math.round((v.onTime / v.n) * 100), avgDelay: avg(v.delays), avgDays: avg(v.external) })).sort((a, b) => b.avgDelay - a.avgDelay),
        trend: Array.from(months.values()).map((m) => ({ month: m.month, internal: avg(m.internal), external: avg(m.external) })).sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
    };
}
