// ---------------------------------------------------------------------------
// Supplier relationship evaluation: the pure rules (no database), shared by the server and the tests.
//
// The platform master (module_masters/PRC_supplier_relationship_evaluation) has three profiles: MAT (materials and
// goods), SVC (services and maintenance) and PRJ (projects, assets and capital expenditure). Each has 10 categories and
// questions whose weights total 100, with an accountability: SUPPLIER, ORGANIZATION or BOTH (joint).
//
// The organization adopts questions per profile. Adopted weights are redistributed so each profile totals 100 again:
// effective = original x 100 / sum(original weights adopted in the profile).
//
// A question is answered by tapping: unassessed -> ok -> not ok -> unassessed. OK earns the question's effective
// weight, not OK earns nothing, unassessed is not yet counted. The scorecard score is points earned out of 100.
// Supplier, organization and joint scores are the share earned within each accountability.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const PROFILES = ['MAT', 'SVC', 'PRJ'] as const;
export type ProfileId = (typeof PROFILES)[number];
export const PROFILE_LABEL: Record<ProfileId, string> = { MAT: 'Materials and spares', SVC: 'Services', PRJ: 'Assets and capital projects' };
/** Vendor scope kind -> template profile. */
export const KIND_PROFILE: Record<string, ProfileId> = { material: 'MAT', service: 'SVC', asset: 'PRJ' };
export const ACCOUNTABILITY = ['SUPPLIER', 'ORGANIZATION', 'BOTH'] as const;
export type Accountability = (typeof ACCOUNTABILITY)[number];
export const ACCOUNTABILITY_LABEL: Record<Accountability, string> = { SUPPLIER: 'Supplier', ORGANIZATION: 'Organization', BOTH: 'Joint' };
export const STATES = ['unassessed', 'ok', 'not_ok'] as const;
export type AnswerState = (typeof STATES)[number];
export const FREQUENCIES: Record<string, { label: string; months: number }> = {
    monthly: { label: 'Monthly', months: 1 },
    quarterly: { label: 'Quarterly', months: 3 },
    semi_annual: { label: 'Every six months', months: 6 },
    annual: { label: 'Annually', months: 12 },
};

export interface MasterQuestion { question_id: string; question: string; accountability: string; weight_percent: number; measurement?: string; evidence_sources?: string[]; critical_control?: boolean }
export interface MasterCategory { category_id: string; name: string; weight_percent: number; questions: MasterQuestion[] }
export interface MasterProfile { profile_id: string; name: string; scope?: string; default_review_frequency?: string; categories: MasterCategory[] }

export interface Question { id: string; text: string; accountability: Accountability; weight: number; originalWeight: number; measurement: string; evidence: string[]; critical: boolean }
export interface Category { id: string; name: string; weight: number; questions: Question[] }
export interface Profile { id: ProfileId; name: string; categories: Category[] }

/** Next state of a tapped question. */
export const nextState = (s: string): AnswerState => (s === 'ok' ? 'not_ok' : s === 'not_ok' ? 'unassessed' : 'ok');

/**
 * Builds an organization's effective profile from the master and the adopted question ids, redistributing weights to
 * total 100. Returns null when nothing in the profile is adopted.
 */
export function effectiveProfile(master: MasterProfile, adopted: Set<string> | null): Profile | null {
    const pid = master.profile_id as ProfileId;
    if (!PROFILES.includes(pid)) return null;
    const take = (q: MasterQuestion) => !adopted || adopted.has(q.question_id);
    const total = master.categories.reduce((s, c) => s + c.questions.filter(take).reduce((t, q) => t + q.weight_percent, 0), 0);
    if (!(total > 0)) return null;
    const factor = 100 / total;
    const categories: Category[] = [];
    for (const c of master.categories) {
        const qs = c.questions.filter(take).map((q) => ({
            id: q.question_id,
            text: q.question,
            accountability: (ACCOUNTABILITY.includes(q.accountability as Accountability) ? q.accountability : 'BOTH') as Accountability,
            weight: q.weight_percent * factor,
            originalWeight: q.weight_percent,
            measurement: str(q.measurement),
            evidence: Array.isArray(q.evidence_sources) ? q.evidence_sources.map(str) : [],
            critical: q.critical_control === true,
        }));
        if (!qs.length) continue;
        categories.push({ id: c.category_id, name: c.name, weight: qs.reduce((s, q) => s + q.weight, 0), questions: qs });
    }
    return { id: pid, name: PROFILE_LABEL[pid] || master.name, categories };
}

/** Problems with the adoption: unknown ids, nothing adopted at all. */
export function adoptionProblems(masters: MasterProfile[], adoption: Record<string, string[]>): string[] {
    const p: string[] = [];
    const known = new Map(masters.map((m) => [m.profile_id, new Set(m.categories.flatMap((c) => c.questions.map((q) => q.question_id)))]));
    let any = 0;
    for (const [pid, ids] of Object.entries(adoption)) {
        const set = known.get(pid);
        if (!set) { p.push(`Unknown template ${pid}.`); continue; }
        for (const id of ids) if (!set.has(id)) p.push(`Unknown question ${id}.`);
        any += ids.length;
    }
    if (!any) p.push('Adopt at least one question.');
    return p;
}

export interface Bands { improveFrom: number; passFrom: number }
export function bandProblems(b: Obj): string[] {
    const i = Number(b.improveFrom), p = Number(b.passFrom);
    if (!Number.isFinite(i) || !Number.isFinite(p)) return ['Enter both performance limits.'];
    if (i <= 0 || p > 100 || i >= p) return ['The limits must satisfy 0 < "needs improvement from" < "pass from" <= 100.'];
    return [];
}
export type Band = 'fail' | 'improve' | 'pass';
export const BAND_LABEL: Record<Band, string> = { fail: 'Fail', improve: 'Needs improvement', pass: 'Pass' };
export const bandOf = (score: number, b: Bands): Band => (score >= b.passFrom ? 'pass' : score >= b.improveFrom ? 'improve' : 'fail');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
function addMonths(day: string, months: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, dd = d.getUTCDate();
    const t = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(dd, last));
    return t.toISOString().slice(0, 10);
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The window after one ending on `end`, for a frequency. */
export function nextWindow(end: string, frequency: string): { start: string; end: string } {
    const months = FREQUENCIES[frequency]?.months ?? 3;
    const start = addDays(end, 1);
    return { start, end: addDays(addMonths(start, months), -1) };
}
export const windowId = (start: string) => `W${start.replace(/-/g, '')}`;
export function windowProblems(start: string, end: string): string[] {
    if (!validDate(start) || !validDate(end)) return ['Enter the window start and end dates.'];
    if (end < start) return ['The window must end on or after its start.'];
    if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 400) return ['A window can be at most about 13 months long.'];
    return [];
}
export const inWindow = (w: { start: string; end: string } | null | undefined, day: string) => !!w && w.start <= day && day <= w.end;

export interface Answer { state: AnswerState; note?: string; by?: string; byName?: string; at?: string }
export const answerKey = (profile: string, questionId: string) => `${profile}|${questionId}`;

export interface CategoryScore { id: string; name: string; weight: number; earned: number; assessed: number; pct: number | null; ok: number; notOk: number; open: number; questions: number }
export interface ScorecardScore {
    profile: ProfileId; name: string; score: number; coverage: number; onAssessed: number | null; complete: boolean;
    sub: Record<Accountability, { earned: number; weight: number; assessed: number; pct: number | null }>;
    categories: CategoryScore[]; ok: number; notOk: number; open: number; questions: number;
}
/** Live score of one scorecard from its answers. */
export function scoreCard(p: Profile, answers: Record<string, Answer>): ScorecardScore {
    const sub = Object.fromEntries(ACCOUNTABILITY.map((a) => [a, { earned: 0, weight: 0, assessed: 0, pct: null as number | null }])) as ScorecardScore['sub'];
    let earned = 0, assessed = 0, ok = 0, notOk = 0, open = 0, questions = 0;
    const categories: CategoryScore[] = p.categories.map((c) => {
        let ce = 0, ca = 0, co = 0, cn = 0, cu = 0;
        for (const q of c.questions) {
            const s = answers[answerKey(p.id, q.id)]?.state ?? 'unassessed';
            sub[q.accountability].weight += q.weight;
            if (s === 'ok') { ce += q.weight; ca += q.weight; co++; sub[q.accountability].earned += q.weight; sub[q.accountability].assessed += q.weight; }
            else if (s === 'not_ok') { ca += q.weight; cn++; sub[q.accountability].assessed += q.weight; }
            else cu++;
        }
        earned += ce; assessed += ca; ok += co; notOk += cn; open += cu; questions += c.questions.length;
        return { id: c.id, name: c.name, weight: round(c.weight, 4), earned: round(ce, 4), assessed: round(ca, 4), pct: ca > 0 ? round((ce / c.weight) * 100, 1) : null, ok: co, notOk: cn, open: cu, questions: c.questions.length };
    });
    for (const a of ACCOUNTABILITY) { const s = sub[a]; s.pct = s.weight > 0 ? round((s.earned / s.weight) * 100, 1) : null; s.earned = round(s.earned, 2); s.weight = round(s.weight, 2); s.assessed = round(s.assessed, 2); }
    return {
        profile: p.id, name: p.name, score: round(earned, 2), coverage: round(assessed, 2), onAssessed: assessed > 0 ? round((earned / assessed) * 100, 1) : null,
        complete: open === 0, sub, categories, ok, notOk, open, questions,
    };
}
/** Overall score of an evaluation: the average of its scorecards (one per template in scope). */
export function overallOf(cards: ScorecardScore[]) {
    if (!cards.length) return { score: 0, coverage: 0, complete: false, sub: { SUPPLIER: null, ORGANIZATION: null, BOTH: null } as Record<Accountability, number | null> };
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length, 2) : null);
    return {
        score: avg(cards.map((c) => c.score)) ?? 0,
        coverage: avg(cards.map((c) => c.coverage)) ?? 0,
        complete: cards.every((c) => c.complete),
        sub: Object.fromEntries(ACCOUNTABILITY.map((a) => [a, avg(cards.map((c) => c.sub[a].pct).filter((x): x is number => x !== null))])) as Record<Accountability, number | null>,
    };
}

/** Why an evaluation cannot be submitted yet. */
export function submitProblems(cards: Profile[], answers: Record<string, Answer>): string[] {
    const p: string[] = [];
    for (const c of cards) {
        let open = 0;
        for (const cat of c.categories) for (const q of cat.questions) {
            const a = answers[answerKey(c.id, q.id)];
            if (!a || a.state === 'unassessed') open++;
            else if (a.state === 'not_ok' && str(a.note).trim().length < 10) p.push(`${q.id}: write the finding (10+ characters) for a question marked not OK.`);
        }
        if (open) p.push(`${c.name}: ${open} question${open === 1 ? '' : 's'} not yet assessed.`);
    }
    return p;
}

/** Eligible suppliers and their selected categories, cleaned against the vendors' own registered categories. */
export function cleanEligible(raw: unknown, vendors: Map<string, Array<{ kind: string; categoryCode: string; categoryName: string }>>): { list: Array<{ vendorId: string; scopes: Array<{ kind: string; categoryCode: string; categoryName: string }> }>; problems: string[] } {
    const problems: string[] = [];
    const list: Array<{ vendorId: string; scopes: Array<{ kind: string; categoryCode: string; categoryName: string }> }> = [];
    const seen = new Set<string>();
    for (const e of Array.isArray(raw) ? raw.filter(isObj).slice(0, 1000) : []) {
        const id = str(e.vendorId);
        if (seen.has(id)) continue;
        const own = vendors.get(id);
        if (!own) { problems.push(`${id} is not an approved supplier.`); continue; }
        const picked = Array.isArray(e.scopes) ? e.scopes.filter(isObj) : [];
        const scopes: Array<{ kind: string; categoryCode: string; categoryName: string }> = [];
        for (const s of picked) {
            const m = own.find((x) => x.kind === str(s.kind) && x.categoryCode === str(s.categoryCode));
            if (!m) { problems.push(`${id}: ${str(s.kind)} category ${str(s.categoryCode)} is not one the supplier is registered for.`); continue; }
            if (!scopes.some((x) => x.kind === m.kind && x.categoryCode === m.categoryCode)) scopes.push(m);
        }
        if (!scopes.length) { problems.push(`${id}: choose at least one of its categories to evaluate.`); continue; }
        seen.add(id);
        list.push({ vendorId: id, scopes });
    }
    return { list, problems };
}

/** Profiles an evaluation needs for a supplier's selected categories. */
export const profilesFor = (scopes: Array<{ kind: string }>) => PROFILES.filter((p) => scopes.some((s) => KIND_PROFILE[s.kind] === p));

/** Overdue: open or done-but-unverified actions past their due date. */
export const overdue = (a: Obj, day: string) => str(a.status) === 'open' && !!str(a.dueDate) && str(a.dueDate) < day;

// ---------------------------------------------------------------------------
// Deeper analytics: contribution, projection, cadence, action closure, question history, heat-map, rank.
// ---------------------------------------------------------------------------

export interface Contribution { accountability: Accountability; weight: number; earned: number; lost: number; open: number }
/**
 * How supplier, organization and joint questions make up the 100 points: earned, lost (not OK) and still open, averaged
 * over the scorecards. Earned across the three adds up to the overall score.
 */
export function contributionOf(cards: Array<Pick<ScorecardScore, 'sub'>>): Contribution[] {
    const n = cards.length || 1;
    return ACCOUNTABILITY.map((a) => {
        let weight = 0, earned = 0, assessed = 0;
        for (const c of cards) { weight += c.sub[a].weight; earned += c.sub[a].earned; assessed += c.sub[a].assessed ?? c.sub[a].weight; }
        return { accountability: a, weight: round(weight / n), earned: round(earned / n), lost: round((assessed - earned) / n), open: round((weight - assessed) / n) };
    });
}

/** Where a scorecard can still finish: now (all open fail) to best case (all open OK). */
export const projectionOf = (c: Pick<ScorecardScore, 'score' | 'coverage'>) => ({ low: round(c.score), high: round(c.score + (100 - c.coverage)) });

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface Cadence { phase: 'none' | 'upcoming' | 'open' | 'closed'; start: string; end: string; daysToOpen: number | null; daysToClose: number | null; windowDays: number; elapsedPct: number; next: { start: string; end: string } | null; daysSinceLast: number | null; dueBy: string; overdue: boolean }
/** Where the evaluation calendar stands today, and when this supplier is next due. */
export function cadenceOf(win: { start: string; end: string } | null | undefined, frequency: string, lastFinalWindowEnd: string, lastFinalAt: string, day: string): Cadence {
    const sinceLast = lastFinalAt ? daysBetween(lastFinalAt.slice(0, 10), day) : null;
    if (!win) return { phase: 'none', start: '', end: '', daysToOpen: null, daysToClose: null, windowDays: 0, elapsedPct: 0, next: null, daysSinceLast: sinceLast, dueBy: '', overdue: false };
    const phase = day < win.start ? 'upcoming' : day <= win.end ? 'open' : 'closed';
    const windowDays = daysBetween(win.start, win.end) + 1;
    const elapsed = phase === 'upcoming' ? 0 : phase === 'closed' ? windowDays : daysBetween(win.start, day) + 1;
    const covered = !!lastFinalWindowEnd && lastFinalWindowEnd >= win.end;
    return {
        phase, start: win.start, end: win.end,
        daysToOpen: phase === 'upcoming' ? daysBetween(day, win.start) : null,
        daysToClose: phase === 'open' ? daysBetween(day, win.end) : null,
        windowDays, elapsedPct: round((elapsed / windowDays) * 100, 1),
        next: nextWindow(win.end, frequency), daysSinceLast: sinceLast,
        dueBy: covered ? nextWindow(win.end, frequency).end : win.end,
        overdue: phase === 'closed' && !covered,
    };
}

export interface ActionStats {
    total: number; open: number; done: number; verified: number; overdue: number; closureRate: number; verifiedRate: number;
    onTimeRate: number | null; avgDaysToClose: number | null; avgDaysToVerify: number | null;
    aging: Array<{ label: string; count: number }>; dueSoon: number;
    byAccountability: Array<{ accountability: Accountability; open: number; closed: number }>;
}
/** Closure tracker: how many actions are closed, on time, how fast, and how late the open ones are. */
export function actionStats(actions: Obj[], day: string): ActionStats {
    const st = (a: Obj) => str(a.status);
    const closed = actions.filter((a) => ['done', 'verified'].includes(st(a)));
    const open = actions.filter((a) => st(a) === 'open');
    const late = open.filter((a) => str(a.dueDate) && str(a.dueDate) < day);
    const onTime = closed.filter((a) => str(a.doneAt) && str(a.dueDate) && str(a.doneAt).slice(0, 10) <= str(a.dueDate));
    const close = closed.filter((a) => str(a.doneAt) && str(a.createdAt)).map((a) => daysBetween(str(a.createdAt).slice(0, 10), str(a.doneAt).slice(0, 10)));
    const verify = actions.filter((a) => st(a) === 'verified' && str(a.verifiedAt) && str(a.doneAt)).map((a) => daysBetween(str(a.doneAt).slice(0, 10), str(a.verifiedAt).slice(0, 10)));
    const avg = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length, 1) : null);
    const lateBy = (a: Obj) => daysBetween(str(a.dueDate), day);
    const total = actions.length;
    return {
        total, open: open.length, done: actions.filter((a) => st(a) === 'done').length, verified: actions.filter((a) => st(a) === 'verified').length, overdue: late.length,
        closureRate: total ? round((closed.length / total) * 100, 1) : 0,
        verifiedRate: total ? round((actions.filter((a) => st(a) === 'verified').length / total) * 100, 1) : 0,
        onTimeRate: closed.length ? round((onTime.length / closed.length) * 100, 1) : null,
        avgDaysToClose: avg(close), avgDaysToVerify: avg(verify),
        aging: [
            { label: 'Not yet due', count: open.length - late.length },
            { label: '1–7 days late', count: late.filter((a) => lateBy(a) <= 7).length },
            { label: '8–30 days late', count: late.filter((a) => lateBy(a) > 7 && lateBy(a) <= 30).length },
            { label: 'Over 30 days late', count: late.filter((a) => lateBy(a) > 30).length },
        ],
        dueSoon: open.filter((a) => str(a.dueDate) >= day && daysBetween(day, str(a.dueDate)) <= 7).length,
        byAccountability: ACCOUNTABILITY.map((acc) => ({ accountability: acc, open: open.filter((a) => str(a.accountability) === acc).length, closed: closed.filter((a) => str(a.accountability) === acc).length })),
    };
}

export interface QuestionHistory { assessed: number; notOk: number; streak: number; last: { state: string; note: string; at: string; evaluation: string } | null }
/**
 * Each question's record over earlier evaluations (oldest first): how often assessed and failed, the current run of
 * consecutive failures, and the last result with its finding.
 */
export function questionHistory(evals: Array<{ number: string; at: string; answers: Record<string, Answer> }>): Record<string, QuestionHistory> {
    const out: Record<string, QuestionHistory> = {};
    for (const e of evals) {
        for (const [k, a] of Object.entries(e.answers)) {
            if (!a || (a.state !== 'ok' && a.state !== 'not_ok')) continue;
            const h = (out[k] ??= { assessed: 0, notOk: 0, streak: 0, last: null });
            h.assessed++;
            if (a.state === 'not_ok') { h.notOk++; h.streak++; } else h.streak = 0;
            h.last = { state: a.state, note: str(a.note), at: e.at, evaluation: e.number };
        }
    }
    return out;
}

/** Percentile rank of a score among others (100 = best). */
export function rankOf(score: number, all: number[]): { rank: number; of: number; percentile: number } {
    const sorted = [...all].sort((a, b) => b - a);
    const rank = sorted.findIndex((x) => x <= score) + 1 || sorted.length;
    const below = all.filter((x) => x < score).length;
    return { rank, of: all.length, percentile: all.length > 1 ? round((below / (all.length - 1)) * 100) : 100 };
}
