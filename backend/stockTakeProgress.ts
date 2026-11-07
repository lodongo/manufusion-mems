// ---------------------------------------------------------------------------
// Stock take session progress and statistics (pure: no database access, so it is tested directly).
//
// A stock take session (CNT_SES_ + 8 digits) is planned first: a configuration, a warehouse, a start date and time, an
// optional end, the number of materials to count and the materials per PI document (which give the number of PI
// documents), and the targets it is measured against. PI documents (PI_ + 8 digits) are created inside it.
//
// KPIs (kept apart on purpose):
//   - Count accuracy: how often a count was right the first time. Of the materials counted on the original PI
//     documents, a recount that finds a different quantity from the previous count is a count error.
//     Count accuracy = (materials counted - count errors) / materials counted; count error rate is the rest.
//   - Stock accuracy: how often the system stock was right. A posted line whose counted quantity differs from the
//     system quantity is a stock error. Stock accuracy = (materials counted - stock errors posted) / materials counted.
// ---------------------------------------------------------------------------

export interface SessionMetrics {
    /** Materials (physical locations) the session is expected to count. */
    targetMaterials: number;
    /** Materials on each PI document; the number of PI documents is worked out from it. */
    materialsPerPi: number;
    /** Targets, 0 to 100. */
    targetCountAccuracyPct: number;
    targetStockAccuracyPct: number;
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
const isCounted = (l: Obj) => l.counted !== null && l.counted !== undefined;
const keyOf = (l: Obj) => `${s(l.materialId)}|${s(l.binId)}`;

/** PI documents needed to count a number of materials at a number per PI. */
export const plannedPis = (targetMaterials: number, materialsPerPi: number) => (targetMaterials > 0 && materialsPerPi > 0 ? Math.ceil(targetMaterials / materialsPerPi) : 0);

/** Session metrics, reading the older shape (target PI documents and one accuracy target) where a session has it. */
export function metricsOf(session: Obj): SessionMetrics {
    const m = (session.metrics && typeof session.metrics === 'object' ? session.metrics : {}) as Obj;
    const perPi = num(m.materialsPerPi) || num(session.documentSize) || 1;
    return {
        targetMaterials: num(m.targetMaterials) || num(m.targetLocations) || num(m.targetPiDocuments) * perPi,
        materialsPerPi: perPi,
        targetCountAccuracyPct: num(m.targetCountAccuracyPct ?? m.targetAccuracyPct),
        targetStockAccuracyPct: num(m.targetStockAccuracyPct ?? m.targetAccuracyPct),
        varianceToleranceValue: num(m.varianceToleranceValue),
    };
}

/** Counts behind both accuracy KPIs, for one session's PI documents (recounts included). */
export function accuracyCounts(pis: Obj[]) {
    const live = pis.filter((p) => s(p.status) !== 'disregarded');
    const originals = live.filter((p) => !s(p.parentPi));
    const counted = originals.reduce((n, p) => n + lines(p).filter(isCounted).length, 0);
    // Count errors: walk each original PI and its recounts in order; a recount that differs from the count before it.
    let countErrors = 0;
    for (const root of originals) {
        const rootId = s(root.piNumber) || s(root.id);
        const chain = [root, ...live.filter((p) => s(p.parentPi) && s(p.parentPi) === rootId)].sort((a, b) => num(a.recountNumber) - num(b.recountNumber));
        const last = new Map<string, number>();
        for (const pi of chain) {
            for (const l of lines(pi)) {
                if (!isCounted(l)) continue;
                const k = keyOf(l);
                if (last.has(k) && last.get(k) !== num(l.counted)) countErrors++;
                last.set(k, num(l.counted));
            }
        }
    }
    const postedLines = live.flatMap(lines).filter((l) => l.posted === true);
    const stockErrors = postedLines.filter((l) => l.expected !== null && l.expected !== undefined && num(l.counted) !== num(l.expected)).length;
    return { counted, countErrors, posted: postedLines.length, stockErrors };
}

export interface StageProgress {
    key: string;
    label: string;
    done: number;
    total: number;
    pct: number;
}

export function sessionProgress(session: Obj, pis: Obj[], nowIso: string) {
    const metrics = metricsOf(session);
    const disregarded = pis.filter((p) => s(p.status) === 'disregarded');
    const live = pis.filter((p) => s(p.status) !== 'disregarded');
    const originals = live.filter((p) => !s(p.parentPi));
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

    // Materials: the original PI documents carry the plan; recount PIs repeat materials, so they are not added again.
    const onPis = originals.reduce((n, p) => n + lines(p).length, 0);
    const allLines = live.flatMap(lines);
    const noBaseline = allLines.filter((l) => isCounted(l) && (l.expected === null || l.expected === undefined)).length;
    const a = accuracyCounts(pis);
    const countAccuracy = pct(a.counted - a.countErrors, a.counted);
    const stockAccuracy = pct(a.counted - a.stockErrors, a.counted);
    const varianceValue = Math.round(live.reduce((n, p) => n + num(p.varianceValue), 0) * 100) / 100;

    const startMs = Date.parse(s(session.startAt));
    const endMs = s(session.endAt) ? Date.parse(s(session.endAt)) : NaN;
    const nowMs = Date.parse(nowIso);
    const open = s(session.status) === 'open';
    const timeUsedPct = Number.isFinite(endMs) && Number.isFinite(startMs) && endMs > startMs ? Math.max(0, Math.min(100, pct(nowMs - startMs, endMs - startMs))) : null;
    const phase = !open ? s(session.status) : nowMs < startMs ? 'scheduled' : Number.isFinite(endMs) && nowMs > endMs ? 'overdue' : 'in_progress';
    const planned = plannedPis(metrics.targetMaterials, metrics.materialsPerPi);
    const closedPis = stages[stages.length - 1].done;

    return {
        phase,
        piDocuments: { total: pis.length, live: live.length, originals: originals.length, planned, disregarded: disregarded.length, recounts: live.length - originals.length, closed: closedPis, byStatus },
        completionPct: pct(closedPis, live.length),
        stages,
        materials: { target: metrics.targetMaterials, perPi: metrics.materialsPerPi, onPis, counted: a.counted, posted: a.posted, noBaseline, onPisPct: pct(onPis, metrics.targetMaterials), countedPct: pct(a.counted, metrics.targetMaterials), postedPct: pct(a.posted, metrics.targetMaterials) },
        countAccuracy: { counted: a.counted, errors: a.countErrors, pct: countAccuracy, errorPct: pct(a.countErrors, a.counted), target: metrics.targetCountAccuracyPct, met: a.counted > 0 && metrics.targetCountAccuracyPct > 0 ? countAccuracy >= metrics.targetCountAccuracyPct : null },
        stockAccuracy: { counted: a.counted, errors: a.stockErrors, pct: stockAccuracy, errorPct: pct(a.stockErrors, a.counted), target: metrics.targetStockAccuracyPct, met: a.counted > 0 && metrics.targetStockAccuracyPct > 0 ? stockAccuracy >= metrics.targetStockAccuracyPct : null },
        variance: { value: varianceValue, tolerance: metrics.varianceToleranceValue, within: metrics.varianceToleranceValue > 0 ? varianceValue <= metrics.varianceToleranceValue : null },
        timeUsedPct,
    };
}

export type SessionProgress = ReturnType<typeof sessionProgress>;

/**
 * Statistics over all sessions that start within [from, to] (ISO dates, inclusive by day): totals, both accuracy KPIs
 * recomputed from the summed counts (not averaged), a row per session and a row per month.
 */
export function overallStatistics(items: Array<{ id: string; session: Obj; pis: Obj[] }>, from: string, to: string, nowIso: string) {
    const inRange = items.filter((x) => {
        const day = s(x.session.startAt).slice(0, 10);
        return day >= from && day <= to;
    });
    const sessions = inRange.map((x) => {
        const p = sessionProgress(x.session, x.pis, nowIso);
        const a = accuracyCounts(x.pis);
        return { id: x.id, name: s(x.session.name), warehouseId: s(x.session.warehouseId), startAt: s(x.session.startAt), status: s(x.session.status), phase: p.phase, p, a };
    });
    const sum = (f: (x: (typeof sessions)[number]) => number) => sessions.reduce((n, x) => n + f(x), 0);
    const counted = sum((x) => x.a.counted);
    const countErrors = sum((x) => x.a.countErrors);
    const stockErrors = sum((x) => x.a.stockErrors);
    const live = sum((x) => x.p.piDocuments.live);
    const closed = sum((x) => x.p.piDocuments.closed);
    const months = new Map<string, { month: string; sessions: number; counted: number; countErrors: number; stockErrors: number; varianceValue: number }>();
    for (const x of sessions) {
        const k = x.startAt.slice(0, 7);
        const m = months.get(k) ?? { month: k, sessions: 0, counted: 0, countErrors: 0, stockErrors: 0, varianceValue: 0 };
        m.sessions++;
        m.counted += x.a.counted;
        m.countErrors += x.a.countErrors;
        m.stockErrors += x.a.stockErrors;
        m.varianceValue = Math.round((m.varianceValue + x.p.variance.value) * 100) / 100;
        months.set(k, m);
    }
    return {
        from,
        to,
        totals: {
            sessions: sessions.length,
            open: sessions.filter((x) => x.status === 'open').length,
            closed: sessions.filter((x) => x.status === 'closed').length,
            cancelled: sessions.filter((x) => x.status === 'cancelled').length,
            overdue: sessions.filter((x) => x.phase === 'overdue').length,
            piDocuments: sum((x) => x.p.piDocuments.total),
            plannedPis: sum((x) => x.p.piDocuments.planned),
            recounts: sum((x) => x.p.piDocuments.recounts),
            targetMaterials: sum((x) => x.p.materials.target),
            counted,
            posted: sum((x) => x.a.posted),
            countErrors,
            stockErrors,
            countAccuracyPct: pct(counted - countErrors, counted),
            stockAccuracyPct: pct(counted - stockErrors, counted),
            completionPct: pct(closed, live),
            varianceValue: Math.round(sum((x) => x.p.variance.value) * 100) / 100,
        },
        sessions: sessions.map((x) => ({
            id: x.id,
            name: x.name,
            warehouseId: x.warehouseId,
            startAt: x.startAt,
            phase: x.phase,
            piDocuments: x.p.piDocuments.total,
            plannedPis: x.p.piDocuments.planned,
            counted: x.a.counted,
            countErrors: x.a.countErrors,
            stockErrors: x.a.stockErrors,
            countAccuracyPct: x.p.countAccuracy.pct,
            stockAccuracyPct: x.p.stockAccuracy.pct,
            completionPct: x.p.completionPct,
            varianceValue: x.p.variance.value,
        })),
        months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, countAccuracyPct: pct(m.counted - m.countErrors, m.counted), stockAccuracyPct: pct(m.counted - m.stockErrors, m.counted) })),
    };
}
