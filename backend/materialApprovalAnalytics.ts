/**
 * Material master approvals analytics: new material requests (NWREQ, PRC-001) and warehouse extensions (EXREQ, PRC-002).
 * A pure read model over the request documents: every submission round, every review/approval decision, returns,
 * rejections and final approvals, by creator, approver, level, warehouse and category, within a time window.
 * No document is changed. Names are resolved by the caller.
 */
type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []);

export type RequestType = 'creation' | 'extension';
export type EventKind = 'created' | 'submitted' | 'approved_step' | 'reviewed' | 'approved' | 'rejected' | 'returned';
export interface ApprovalEvent {
    at: string;
    type: RequestType;
    event: EventKind;
    id: string;
    name: string;
    by: string;
    byName: string;
    level: number;
    waitHours: number | null;
    comment: string;
    warehouseId: string;
    categoryCode: string;
    requester: string;
    requesterName: string;
}
export interface AnalyticsInput {
    materials: Array<{ id: string; data: Obj }>;
    extensions: Array<{ id: string; data: Obj }>;
    names: Map<string, string>;
    from: string; // inclusive ISO date (YYYY-MM-DD)
    to: string; // inclusive ISO date
    now: string; // ISO timestamp
    /** When set, only events and pending requests involving this person (as requester or decision maker). */
    onlyUid?: string;
}

const hours = (a: string, b: string) => {
    const x = Date.parse(a), y = Date.parse(b);
    return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round(((y - x) / 36e5) * 10) / 10 : null;
};
const quantile = (sorted: number[], q: number) => {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 10) / 10;
};
const stats = (values: number[]) => {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return { n: v.length, avg: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null, median: quantile(v, 0.5), p90: quantile(v, 0.9), max: v.length ? v[v.length - 1] : null };
};

/** All rounds of one request: archived (returned) rounds, then the current one. */
function roundsOf(d: Obj) {
    const archived = objs(d.workflowRounds).map((r) => ({ submittedAt: str(r.submittedAt), submittedBy: str(r.submittedBy), history: objs(r.history), current: false }));
    const current = str(d.submittedAt) ? [{ submittedAt: str(d.submittedAt), submittedBy: str(d.submittedBy), history: objs(d.approvalHistory), current: true }] : [];
    return [...archived, ...current];
}

export function requestEvents(type: RequestType, id: string, d: Obj, names: Map<string, string>): ApprovalEvent[] {
    const nm = (uid: string) => names.get(uid) || (uid ? 'Unknown user' : '');
    const requester = str(d.createdBy);
    const base = {
        type, id, name: str(d.name) || str(d.materialName) || str(d.shortText) || id,
        warehouseId: str(d.warehouseId), categoryCode: str(d.categoryCode),
        requester, requesterName: nm(requester),
    };
    const out: ApprovalEvent[] = [];
    if (str(d.createdAt)) out.push({ ...base, at: str(d.createdAt), event: 'created', by: requester, byName: nm(requester), level: 0, waitHours: null, comment: '' });
    for (const round of roundsOf(d)) {
        if (round.submittedAt) out.push({ ...base, at: round.submittedAt, event: 'submitted', by: round.submittedBy, byName: nm(round.submittedBy), level: 0, waitHours: null, comment: '' });
        let since = round.submittedAt;
        const total = round.history.length;
        round.history.forEach((h, i) => {
            const at = str(h.at), decision = str(h.decision);
            const finalApproval = decision === 'approve' && round.current && i === total - 1 && ['approved', 'active', 'disabled'].includes(str(d.status));
            const event: EventKind = decision === 'reject' ? 'rejected' : decision === 'return' ? 'returned' : finalApproval ? 'approved' : str(h.action) === 'review' ? 'reviewed' : 'approved_step';
            out.push({ ...base, at, event, by: str(h.by), byName: nm(str(h.by)), level: Number(h.level) || Number(h.stepIndex) + 1 || 0, waitHours: since ? hours(since, at) : null, comment: str(h.comment).slice(0, 300) });
            since = at;
        });
    }
    // Final approvals recorded without a decision history (legacy or recovered records).
    if (['approved', 'active', 'disabled'].includes(str(d.status)) && str(d.approvedAt) && !out.some((e) => e.event === 'approved'))
        out.push({ ...base, at: str(d.approvedAt), event: 'approved', by: str(d.approvedBy), byName: nm(str(d.approvedBy)), level: Number(d.approvalLevel) || 0, waitHours: str(d.submittedAt) ? hours(str(d.submittedAt), str(d.approvedAt)) : null, comment: '' });
    return out;
}

const periodOf = (at: string, grain: 'day' | 'week' | 'month') => {
    const d = new Date(at);
    if (grain === 'month') return at.slice(0, 7);
    if (grain === 'day') return at.slice(0, 10);
    const day = (d.getUTCDay() + 6) % 7; // Monday start
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
    return monday.toISOString().slice(0, 10);
};

export function materialApprovalAnalytics(input: AnalyticsInput) {
    const { names, from, to, now, onlyUid } = input;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('Choose a valid date range.');
    const inRange = (at: string) => !!at && at.slice(0, 10) >= from && at.slice(0, 10) <= to;
    const all: ApprovalEvent[] = [
        ...input.materials.flatMap((m) => requestEvents('creation', m.id, m.data, names)),
        ...input.extensions.flatMap((e) => requestEvents('extension', e.id, e.data, names)),
    ];
    const involves = (e: ApprovalEvent) => !onlyUid || e.requester === onlyUid || e.by === onlyUid;
    const events = all.filter((e) => inRange(e.at) && involves(e)).sort((a, b) => b.at.localeCompare(a.at));
    const decisions = events.filter((e) => ['approved_step', 'reviewed', 'approved', 'rejected', 'returned'].includes(e.event));
    const count = (list: ApprovalEvent[], k: EventKind) => list.filter((e) => e.event === k).length;
    const totalsOf = (list: ApprovalEvent[]) => ({
        created: count(list, 'created'), submitted: count(list, 'submitted'), approved: count(list, 'approved'),
        rejected: count(list, 'rejected'), returned: count(list, 'returned'),
        stepDecisions: list.filter((e) => ['approved_step', 'reviewed', 'approved', 'rejected', 'returned'].includes(e.event)).length,
    });

    const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
    const grain: 'day' | 'week' | 'month' = days <= 62 ? 'day' : days <= 370 ? 'week' : 'month';
    const seriesMap = new Map<string, Record<string, number>>();
    for (const e of events) {
        if (!['created', 'submitted', 'approved', 'rejected', 'returned'].includes(e.event)) continue;
        const p = periodOf(e.at, grain);
        const row = seriesMap.get(p) ?? { creation: 0, extension: 0, approved: 0, rejected: 0, returned: 0, submitted: 0 };
        if (e.event === 'submitted') { row.submitted++; row[e.type]++; }
        else if (e.event !== 'created') row[e.event]++;
        seriesMap.set(p, row);
    }
    const series = [...seriesMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }));

    // Requesters: what they raised, and how their requests fared (first time right = approved without a return).
    const creators = new Map<string, { uid: string; name: string; created: number; submitted: number; approved: number; rejected: number; returned: number; creations: number; extensions: number }>();
    const touch = (uid: string, name: string) => {
        if (!creators.has(uid)) creators.set(uid, { uid, name, created: 0, submitted: 0, approved: 0, rejected: 0, returned: 0, creations: 0, extensions: 0 });
        return creators.get(uid)!;
    };
    for (const e of events) {
        if (!e.requester) continue;
        const c = touch(e.requester, e.requesterName);
        if (e.event === 'created') { c.created++; if (e.type === 'creation') c.creations++; else c.extensions++; }
        if (e.event === 'submitted') c.submitted++;
        if (e.event === 'approved') c.approved++;
        if (e.event === 'rejected') c.rejected++;
        if (e.event === 'returned') c.returned++;
    }
    const creatorRows = [...creators.values()].map((c) => ({ ...c, returnRate: c.submitted ? Math.round((c.returned / c.submitted) * 1000) / 10 : null })).sort((a, b) => b.submitted - a.submitted || b.created - a.created);

    const approverMap = new Map<string, { uid: string; name: string; decisions: number; approved: number; reviewed: number; rejected: number; returned: number; waits: number[] }>();
    for (const e of decisions) {
        const a = approverMap.get(e.by) ?? { uid: e.by, name: e.byName, decisions: 0, approved: 0, reviewed: 0, rejected: 0, returned: 0, waits: [] };
        a.decisions++;
        if (e.event === 'approved' || e.event === 'approved_step') a.approved++;
        if (e.event === 'reviewed') a.reviewed++;
        if (e.event === 'rejected') a.rejected++;
        if (e.event === 'returned') a.returned++;
        if (e.waitHours != null) a.waits.push(e.waitHours);
        approverMap.set(e.by, a);
    }
    const approvers = [...approverMap.values()].map(({ waits, ...a }) => ({ ...a, ...(() => { const s = stats(waits); return { avgHours: s.avg, medianHours: s.median, p90Hours: s.p90 }; })() })).sort((a, b) => b.decisions - a.decisions || a.name.localeCompare(b.name));

    const group = (key: (e: ApprovalEvent) => string) => {
        const m = new Map<string, { key: string; decisions: number; approved: number; rejected: number; returned: number; waits: number[] }>();
        for (const e of decisions) {
            const k = key(e) || '—';
            const g = m.get(k) ?? { key: k, decisions: 0, approved: 0, rejected: 0, returned: 0, waits: [] };
            g.decisions++;
            if (e.event === 'approved' || e.event === 'approved_step' || e.event === 'reviewed') g.approved++;
            if (e.event === 'rejected') g.rejected++;
            if (e.event === 'returned') g.returned++;
            if (e.waitHours != null) g.waits.push(e.waitHours);
            m.set(k, g);
        }
        return [...m.values()].map(({ waits, ...g }) => ({ ...g, avgWaitHours: stats(waits).avg, p90WaitHours: stats(waits).p90 })).sort((a, b) => b.decisions - a.decisions);
    };
    const levels = group((e) => e.type + ' · L' + e.level);
    const warehouses = group((e) => e.warehouseId);
    const categories = group((e) => e.categoryCode);

    // Cycle time: last submission to the final decision, for requests closed in the window.
    const cycle: number[] = [];
    for (const e of events) {
        if (e.event !== 'approved' && e.event !== 'rejected') continue;
        const sub = all.filter((x) => x.id === e.id && x.event === 'submitted' && x.at <= e.at).sort((a, b) => b.at.localeCompare(a.at))[0];
        const h = sub ? hours(sub.at, e.at) : null;
        if (h != null) cycle.push(h);
    }

    const pending = [
        ...input.materials.map((m) => ({ type: 'creation' as const, id: m.id, d: m.data })),
        ...input.extensions.map((x) => ({ type: 'extension' as const, id: x.id, d: x.data })),
    ].filter((r) => str(r.d.status) === 'pending_approval' && (!onlyUid || str(r.d.createdBy) === onlyUid || str(r.d.submittedBy) === onlyUid))
        .map((r) => {
            const last = objs(r.d.approvalHistory).map((h) => str(h.at)).sort().pop() || str(r.d.submittedAt);
            return {
                type: r.type, id: r.id, name: str(r.d.name) || str(r.d.materialName) || r.id, stage: str(r.d.workflowStage), level: Number(r.d.approvalLevel) || 1,
                submittedAt: str(r.d.submittedAt), requester: names.get(str(r.d.createdBy)) || '', warehouseId: str(r.d.warehouseId),
                ageHours: hours(str(r.d.submittedAt), now), waitingHours: hours(last, now), returnCount: Number(r.d.returnCount) || 0,
            };
        }).sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0));
    const returned = [
        ...input.materials.filter((m) => m.data.returned === true && str(m.data.status) === 'draft').map((m) => ({ type: 'creation' as const, id: m.id, d: m.data })),
        ...input.extensions.filter((x) => str(x.data.status) === 'returned').map((x) => ({ type: 'extension' as const, id: x.id, d: x.data })),
    ].filter((r) => !onlyUid || str(r.d.createdBy) === onlyUid)
        .map((r) => ({ type: r.type, id: r.id, name: str(r.d.name) || str(r.d.materialName) || r.id, returnedAt: str(r.d.returnedAt), returnedBy: names.get(str(r.d.returnedBy)) || '', reason: str(r.d.returnReason), requester: names.get(str(r.d.createdBy)) || '', ageHours: hours(str(r.d.returnedAt), now) }));

    const totals = totalsOf(events);
    const closed = totals.approved + totals.rejected;
    return {
        range: { from, to, grain },
        totals: {
            ...totals,
            pendingNow: pending.length,
            awaitingCorrection: returned.length,
            approvalRate: closed ? Math.round((totals.approved / closed) * 1000) / 10 : null,
            returnRate: totals.submitted ? Math.round((totals.returned / totals.submitted) * 1000) / 10 : null,
        },
        byType: { creation: totalsOf(events.filter((e) => e.type === 'creation')), extension: totalsOf(events.filter((e) => e.type === 'extension')) },
        cycle: stats(cycle),
        series, creators: creatorRows, approvers, levels, warehouses, categories,
        pending: pending.slice(0, 300), returned: returned.slice(0, 300),
        events: events.slice(0, 3000),
        eventsTruncated: events.length > 3000,
    };
}
