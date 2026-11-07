// ---------------------------------------------------------------------------
// Stock take session progress (pure: no database access, so it is tested directly).
//
// A stock take session (STS + 9 digits) is planned first: a configuration, a warehouse, a start date and time, an
// optional end, and the metrics it is measured against. PI documents are then created inside it. The progress report
// is worked out from the session and its PI documents (recount PIs included):
//   - how many PI documents there are, by state, and how far each stage has gone (printing, counting, verification,
//     posting approval, posting, closure), as a percentage of the PI documents still in play (disregarded ones are
//     reported separately and do not count towards completion);
//   - locations planned, counted and posted; count accuracy (counted lines that matched the system quantity);
//   - the value of the variances sent for approval, against the session's tolerance;
//   - time used when an end is set, and whether the session is overdue.
// ---------------------------------------------------------------------------

export interface SessionMetrics {
    /** PI documents the session is expected to produce. */
    targetPiDocuments: number;
    /** Physical locations the session is expected to count. */
    targetLocations: number;
    /** Share of counted locations that should match the system quantity, 0 to 100. */
    targetAccuracyPct: number;
    /** Gross variance value (organization currency) the session should stay within; 0 means no tolerance set. */
    varianceToleranceValue: number;
}

type Obj = Record<string, unknown>;

const STAGE_RANK: Record<string, number> = {
    awaiting_print: 0,
    counting: 1,
    verification: 2,
    verified: 3,
    pending_post_approval: 4,
    approved_for_posting: 5,
    recount_pending: 6,
    posted: 6,
    reconciled: 7,
    closed_posted: 7,
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const lines = (pi: Obj): Obj[] => (Array.isArray(pi.lines) ? (pi.lines as unknown[]).filter((x): x is Obj => !!x && typeof x === 'object') : []);

export interface StageProgress {
    key: string;
    label: string;
    done: number;
    total: number;
    pct: number;
}

export function sessionProgress(session: Obj, pis: Obj[], nowIso: string) {
    const metrics = (session.metrics && typeof session.metrics === 'object' ? session.metrics : {}) as Partial<SessionMetrics>;
    const disregarded = pis.filter((p) => s(p.status) === 'disregarded');
    const live = pis.filter((p) => s(p.status) !== 'disregarded');
    const reached = (rank: number) => live.filter((p) => (STAGE_RANK[s(p.status)] ?? 0) >= rank).length;
    const stages: StageProgress[] = [
        { key: 'printing', label: 'Printed', rank: 1 },
        { key: 'counting', label: 'Counted', rank: 2 },
        { key: 'verification', label: 'Verified', rank: 3 },
        { key: 'submitted', label: 'Submitted for approval', rank: 4 },
        { key: 'approval', label: 'Approved for posting', rank: 5 },
        { key: 'posting', label: 'Posted', rank: 6 },
        { key: 'closure', label: 'Reconciled or closed', rank: 7 },
    ].map(({ key, label, rank }) => {
        const done = reached(rank);
        return { key, label, done, total: live.length, pct: pct(done, live.length) };
    });

    const byStatus: Record<string, number> = {};
    for (const p of pis) byStatus[s(p.status)] = (byStatus[s(p.status)] ?? 0) + 1;

    // Locations: the original PI documents carry the plan; recount PIs repeat locations, so they are not added again.
    const originals = live.filter((p) => !s(p.parentPi));
    const planned = originals.reduce((n, p) => n + lines(p).length, 0);
    const allLines = live.flatMap(lines);
    const counted = allLines.filter((l) => l.counted !== null && l.counted !== undefined);
    const comparable = counted.filter((l) => l.expected !== null && l.expected !== undefined);
    const matched = comparable.filter((l) => num(l.counted) === num(l.expected));
    const variances = comparable.length - matched.length;
    const posted = allLines.filter((l) => l.posted === true).length;
    const noBaseline = counted.length - comparable.length;
    const recounts = live.filter((p) => s(p.parentPi)).length;

    const varianceValue = Math.round(live.reduce((n, p) => n + num(p.varianceValue), 0) * 100) / 100;
    const accuracy = pct(matched.length, comparable.length);

    const startMs = Date.parse(s(session.startAt));
    const endMs = s(session.endAt) ? Date.parse(s(session.endAt)) : NaN;
    const nowMs = Date.parse(nowIso);
    const open = s(session.status) === 'open';
    const timeUsedPct = Number.isFinite(endMs) && Number.isFinite(startMs) && endMs > startMs ? Math.max(0, Math.min(100, pct(nowMs - startMs, endMs - startMs))) : null;
    const phase = !open ? s(session.status) : nowMs < startMs ? 'scheduled' : Number.isFinite(endMs) && nowMs > endMs ? 'overdue' : 'in_progress';

    const target = {
        piDocuments: num(metrics.targetPiDocuments),
        locations: num(metrics.targetLocations),
        accuracyPct: num(metrics.targetAccuracyPct),
        varianceToleranceValue: num(metrics.varianceToleranceValue),
    };
    const closedPis = stages[stages.length - 1].done;
    return {
        phase,
        piDocuments: { total: pis.length, live: live.length, disregarded: disregarded.length, recounts, closed: closedPis, byStatus },
        completionPct: pct(closedPis, live.length),
        stages,
        locations: { planned, counted: counted.length, posted, noBaseline, countedPct: pct(counted.length, planned), postedPct: pct(posted, planned) },
        accuracy: { comparable: comparable.length, matched: matched.length, variances, pct: accuracy },
        varianceValue,
        timeUsedPct,
        targets: {
            ...target,
            piDocumentsPct: pct(originals.length, target.piDocuments),
            locationsPct: pct(planned, target.locations),
            accuracyMet: comparable.length > 0 && target.accuracyPct > 0 ? accuracy >= target.accuracyPct : null,
            withinTolerance: target.varianceToleranceValue > 0 ? varianceValue <= target.varianceToleranceValue : null,
        },
    };
}

export type SessionProgress = ReturnType<typeof sessionProgress>;
