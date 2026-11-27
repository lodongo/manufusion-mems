import { HttpError, getDoc, isObj, listDocs, nowIso, randomId, rateLimit, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { bypass } from './testModeCore';
import { record } from './org';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { can, requireProcurement } from './procurementSetup';
import { vendorsPath } from './vendors';
import { lock, nameOfUser } from './purchaseOrders';
import { validateSupplierRelationshipTemplate } from './supplierRelationshipTemplate';
import {
    ACCOUNTABILITY, BAND_LABEL, FREQUENCIES, KIND_PROFILE, PROFILES, PROFILE_LABEL, STATES,
    actionStats, adoptionProblems, answerKey, bandOf, bandProblems, cadenceOf, cleanEligible, contributionOf, effectiveProfile, inWindow, nextWindow, overallOf,
    overdue, profilesFor, questionHistory, rankOf, scoreCard, submitProblems, windowId, windowProblems,
    type Answer, type AnswerState, type Bands, type MasterProfile, type Profile, type ProfileId,
} from './supplierEvaluationModel';

// ---------------------------------------------------------------------------
// Supplier relationship evaluation (Procurement › Supplier evaluation)
//
//   organizations/{org}/procurement_srm/setup                       frequency, bands, eligible suppliers and their
//                                                                    categories, adopted questions, current window
//   organizations/{org}/procurement_srm_versions/{n}                every saved setup (kept unchanged)
//   organizations/{org}/srm_evaluations/{SRE00000001}               one evaluation: legal entity x supplier x window,
//                                                                    one scorecard per template, answers, actions
//   organizations/{org}/srm_evaluation_keys/{window}_{le}_{vendor}  one evaluation per window, legal entity, supplier
//
// Flow: in_progress (evaluators tap questions; scores update live) -> submitted -> finalized by an independent
// approver (or returned). The final score is written to the supplier's SRM score used in quotation analysis.
// Improvement actions are raised on "not OK" questions and followed to verified completion.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});
const today = () => new Date().toISOString().slice(0, 10);
const clean = (v: unknown, max: number) => str(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const SRE = /^SRE\d{8}$/;
const MASTER = 'module_masters/PRC_supplier_relationship_evaluation';
const setupPath = (org: string) => `organizations/${org}/procurement_srm/setup`;
const evalPath = (org: string) => `organizations/${org}/srm_evaluations`;
const reasonOf = (b: Obj, min = 20) => {
    const r = clean(b.reason, 500);
    if (r.length < min) throw new HttpError(400, `Give a reason of at least ${min} characters.`);
    return r;
};

// ----- Platform master -----

let cache: { sha: string; profiles: MasterProfile[]; version: string } | null = null;
async function master(): Promise<{ profiles: MasterProfile[]; version: string; sha: string } | null> {
    const doc = await getDoc(MASTER);
    if (!doc || typeof doc.data.json !== 'string') return null;
    const sha = str(doc.data.sha256);
    if (cache && cache.sha === sha) return cache;
    const stats = validateSupplierRelationshipTemplate(doc.data.json);
    if (stats.sha256 !== sha) throw new HttpError(500, 'The supplier evaluation template failed its integrity check. Ask MEMS Admin to reload it.');
    const t = JSON.parse(doc.data.json) as { evaluation_profiles: MasterProfile[] };
    cache = { sha, profiles: t.evaluation_profiles, version: stats.version };
    return cache;
}
async function needMaster() {
    const m = await master();
    if (!m) throw new HttpError(409, 'The supplier relationship evaluation template is not loaded. Ask MEMS Admin to load it (Modules › Procurement).');
    return m;
}

// ----- Setup -----

interface Setup {
    version: number; frequency: string; bands: Bands; window: { id: string; start: string; end: string } | null;
    eligible: Array<{ vendorId: string; scopes: Array<{ kind: string; categoryCode: string; categoryName: string }> }>;
    adoption: Record<string, string[]>; updatedAt: string; updatedByName: string; templateVersion: string;
}
async function getSetup(orgId: string): Promise<Setup | null> {
    const d = (await getDoc(setupPath(orgId)))?.data;
    if (!d) return null;
    const b = o(d.bands);
    return {
        version: Number(d.version) || 0, frequency: str(d.frequency) || 'quarterly',
        bands: { improveFrom: Number(b.improveFrom) || 60, passFrom: Number(b.passFrom) || 75 },
        window: isObj(d.window) && str(d.window.start) ? { id: str(d.window.id), start: str(d.window.start), end: str(d.window.end) } : null,
        eligible: objs(d.eligible).map((e) => ({ vendorId: str(e.vendorId), scopes: objs(e.scopes).map((s) => ({ kind: str(s.kind), categoryCode: str(s.categoryCode), categoryName: str(s.categoryName) })) })),
        adoption: Object.fromEntries(PROFILES.map((p) => [p, Array.isArray(o(d.adoption)[p]) ? (o(d.adoption)[p] as unknown[]).map(str) : []])),
        updatedAt: str(d.updatedAt), updatedByName: str(d.updatedByName), templateVersion: str(d.templateVersion),
    };
}
async function needSetup(orgId: string) {
    const s = await getSetup(orgId);
    if (!s || !s.version) throw new HttpError(409, 'Supplier evaluation is not set up yet. Procurement › Supplier evaluation › Setup.');
    return s;
}
/** Approved suppliers and the categories (category level) they are registered for. */
async function supplierScopes(orgId: string) {
    const vendors = (await listDocs(vendorsPath(orgId))).filter((v) => str(v.data.status) === 'approved');
    const map = new Map<string, Array<{ kind: string; categoryCode: string; categoryName: string }>>();
    for (const v of vendors) {
        const out: Array<{ kind: string; categoryCode: string; categoryName: string }> = [];
        for (const s of objs(v.data.scopes)) {
            const kind = str(s.kind), code = str(s.categoryCode);
            if (!KIND_PROFILE[kind] || !code || out.some((x) => x.kind === kind && x.categoryCode === code)) continue;
            out.push({ kind, categoryCode: code, categoryName: str(s.categoryName) || code });
        }
        map.set(v.id, out);
    }
    return { vendors, map };
}
const vendorName = (v: Doc | null | undefined) => str(v?.data.tradeName) || str(v?.data.legalName) || str(v?.id);

// ----- Legal entities the person works in -----

async function legalEntities(orgId: string) {
    return (await listDocs(`organizations/${orgId}/structure`)).filter((n) => str(n.data.level) === 'legal_entity' && str(n.data.status) !== 'inactive').map((n) => ({ id: n.id, code: str(n.data.code), name: str(n.data.name) || n.id }));
}
/** Legal entities the person may evaluate for: those in their scope, or above the units they work in. */
async function myEntities(ctx: OrgContext): Promise<Set<string>> {
    const all = await legalEntities(ctx.orgId);
    if (ctx.role === 'org_super_admin') return new Set(all.map((e) => e.id));
    const allowed = await allowedNodeIds(ctx.orgId, ctx.me, true);
    if (allowed === 'all') return new Set(all.map((e) => e.id));
    const nodes = new Map((await listDocs(`organizations/${ctx.orgId}/structure`)).map((n) => [n.id, n]));
    const out = new Set<string>();
    const assigned = (Array.isArray(ctx.me.data.assignments) ? (ctx.me.data.assignments as unknown[]) : []).filter(isObj).map((a) => str(a.nodeId));
    for (const id of [...allowed, ...assigned]) {
        let cur = nodes.get(id);
        for (let i = 0; cur && i < 30; i++) {
            if (str(cur.data.level) === 'legal_entity') { out.add(cur.id); break; }
            cur = nodes.get(str(cur.data.parentId));
        }
    }
    return out;
}

// ----- Evaluations -----

function cardsOf(d: Obj): Profile[] {
    return objs(d.scorecards).map((c) => ({ id: str(c.id) as ProfileId, name: str(c.name), categories: objs(c.categories) as unknown as Profile['categories'] }));
}
const answersOf = (d: Obj) => o(d.answers) as Record<string, Answer>;
function scores(d: Obj) {
    const cards = cardsOf(d).map((c) => scoreCard(c, answersOf(d)));
    const overall = overallOf(cards);
    const b = o(d.bands);
    const bands: Bands = { improveFrom: Number(b.improveFrom) || 60, passFrom: Number(b.passFrom) || 75 };
    return { cards, overall: { ...overall, band: bandOf(overall.score, bands), bandLabel: BAND_LABEL[bandOf(overall.score, bands)] }, bands };
}
const evaluators = (d: Obj) => [...new Set([str(d.createdBy), ...Object.values(answersOf(d)).map((a) => str(a.by))].filter(Boolean))];

function approverCheck(ctx: OrgContext, d: Obj): { ok: boolean; why: string; testMode?: boolean } {
    if (str(d.status) !== 'submitted' || !can(ctx, 'PRC.srm.approve')) return { ok: false, why: '' };
    let why = '';
    if (evaluators(d).includes(ctx.uid) || str(d.submittedBy) === ctx.uid) why = 'You took part in this evaluation, so someone else must approve it.';
    if (!why) return { ok: true, why: '' };
    if (ctx.testMode === true) return { ok: true, why: '', testMode: true };
    return { ok: false, why };
}
export { approverCheck as srmApproverCheck };

async function loadEval(ctx: OrgContext, id: string): Promise<Doc> {
    requireProcurement(ctx);
    if (!SRE.test(id)) throw new HttpError(404, 'Evaluation not found.');
    const doc = await getDoc(`${evalPath(ctx.orgId)}/${id}`);
    if (!doc) throw new HttpError(404, 'Evaluation not found.');
    return doc;
}
/** Evaluators work only for legal entities they belong to; viewers with the view right see all. */
async function needEntity(ctx: OrgContext, d: Obj) {
    if ((await myEntities(ctx)).has(str(d.legalEntityId))) return;
    if (bypass(ctx, 'prc.srm.legal_entity_scope')) return;
    throw new HttpError(403, 'You can evaluate suppliers only for the legal entities you work in.');
}

interface Change { patch: Obj; event: string; note?: string; label: string; result?: Obj }
async function mutate(ctx: OrgContext, id: string, action: string, run: (d: Obj) => Promise<Change>) {
    return lock(ctx, id, async () => {
        const path = `${evalPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Evaluation not found.');
        const d = fresh.data;
        const c = await run(d);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, updatedBy: ctx.uid, version: (Number(d.version) || 1) + 1 };
        const sc = scores(next);
        next.result = { score: sc.overall.score, coverage: sc.overall.coverage, band: sc.overall.band, sub: sc.overall.sub, cards: sc.cards.map((c2) => ({ profile: c2.profile, score: c2.score, coverage: c2.coverage, sub: c2.sub, categories: c2.categories.map((x) => ({ id: x.id, name: x.name, weight: x.weight, earned: x.earned, pct: x.pct })) })) };
        if (c.event) next.history = [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: (c.note ?? '').slice(0, 300), from: str(d.status), to: str(next.status) }].slice(-500);
        if (!(await writeDoc(path, next, { updateTime: fresh.updateTime }))) throw new HttpError(409, 'The evaluation changed at the same time. It has been refreshed; try again.');
        await record(ctx, `org.procurement.srm.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), version: Number(next.version), ...live(next), ...(c.result ?? {}) };
    });
}

const live = (d: Obj) => ({ scores: scores(d) });

function flags(ctx: OrgContext, d: Obj, inEntity: boolean) {
    const s = str(d.status);
    const evalRight = can(ctx, 'PRC.srm.evaluate') && (inEntity || ctx.testMode === true);
    const chk = approverCheck(ctx, d);
    return {
        answer: evalRight && ['in_progress', 'returned'].includes(s),
        submit: evalRight && ['in_progress', 'returned'].includes(s),
        cancel: evalRight && ['in_progress', 'returned'].includes(s),
        actions: evalRight && s !== 'cancelled',
        approve: chk.ok,
        approveWhy: s === 'submitted' && can(ctx, 'PRC.srm.approve') && !chk.ok ? chk.why : '',
        verify: can(ctx, 'PRC.srm.approve'),
    };
}

function evalOut(ctx: OrgContext, id: string, d: Obj, inEntity: boolean) {
    return {
        id, number: str(d.number) || id, status: str(d.status), windowId: str(d.windowId), windowStart: str(d.windowStart), windowEnd: str(d.windowEnd),
        legalEntityId: str(d.legalEntityId), legalEntityName: str(d.legalEntityName), vendorId: str(d.vendorId), vendorNumber: str(d.vendorNumber), vendorName: str(d.vendorName),
        scopes: objs(d.scopes), scorecards: objs(d.scorecards), answers: answersOf(d), actions: objs(d.actions), bands: o(d.bands),
        history: objs(d.history).slice().reverse().slice(0, 200), createdByName: str(d.createdByName), createdAt: str(d.createdAt),
        submittedByName: str(d.submittedByName), submittedAt: str(d.submittedAt), approvedByName: str(d.approvedByName), approvedAt: str(d.approvedAt),
        returnReason: str(d.returnReason), version: Number(d.version) || 1, configVersion: Number(d.configVersion) || 0,
        can: flags(ctx, d, inEntity), ...live(d),
    };
}

// ----- Dashboard -----

function trendRows(evals: Doc[]) {
    return evals
        .filter((e) => str(e.data.status) === 'finalized')
        .sort((a, b) => str(a.data.windowStart).localeCompare(str(b.data.windowStart)) || str(a.data.approvedAt).localeCompare(str(b.data.approvedAt)))
        .map((e) => {
            const r = o(e.data.result);
            return {
                id: e.id, number: str(e.data.number) || e.id, windowStart: str(e.data.windowStart), windowEnd: str(e.data.windowEnd), legalEntityName: str(e.data.legalEntityName),
                score: Number(r.score) || 0, band: str(r.band), sub: o(r.sub), cards: objs(r.cards), approvedAt: str(e.data.approvedAt),
            };
        });
}
function dashboardOf(vendorId: string, evals: Doc[], setup: Setup | null) {
    const mine = evals.filter((e) => str(e.data.vendorId) === vendorId);
    const trend = trendRows(mine);
    const last = trend[trend.length - 1] ?? null;
    // Last score of each template category, per profile, and of each procurement category in scope.
    const lastCategory: Record<string, Array<{ id: string; name: string; pct: number | null; previous: number | null; earned: number; weight: number }>> = {};
    const lastCard: Record<string, { score: number; previous: number | null; at: string; sub: Obj }> = {};
    for (const p of PROFILES) {
        const rows = trend.filter((t) => t.cards.some((c) => str(c.profile) === p));
        const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
        if (!cur) continue;
        const cc = cur.cards.find((c) => str(c.profile) === p)!;
        const pc = prev?.cards.find((c) => str(c.profile) === p);
        lastCard[p] = { score: Number(cc.score) || 0, previous: pc ? Number(pc.score) || 0 : null, at: cur.windowEnd, sub: o(cc.sub) };
        lastCategory[p] = objs(cc.categories).map((x) => {
            const before = objs(pc?.categories).find((y) => str(y.id) === str(x.id));
            return { id: str(x.id), name: str(x.name), pct: x.pct === null ? null : Number(x.pct), previous: before && before.pct !== null ? Number(before.pct) : null, earned: Number(x.earned) || 0, weight: Number(x.weight) || 0 };
        });
    }
    const procurementCategories: Array<{ kind: string; categoryCode: string; categoryName: string; score: number | null; at: string }> = [];
    for (const e of mine.filter((x) => str(x.data.status) === 'finalized').sort((a, b) => str(b.data.windowStart).localeCompare(str(a.data.windowStart)))) {
        for (const s of objs(e.data.scopes)) {
            if (procurementCategories.some((x) => x.kind === str(s.kind) && x.categoryCode === str(s.categoryCode))) continue;
            const card = objs(o(e.data.result).cards).find((c) => str(c.profile) === KIND_PROFILE[str(s.kind)]);
            procurementCategories.push({ kind: str(s.kind), categoryCode: str(s.categoryCode), categoryName: str(s.categoryName), score: card ? Number(card.score) || 0 : null, at: str(e.data.windowEnd) });
        }
    }
    const day = today();
    // Contribution of supplier, organization and joint questions to the latest score, and over time.
    const contribution = last ? contributionOf(last.cards.map((c) => ({ sub: o(c.sub) as never }))) : [];
    const contributionTrend = trend.map((t) => ({ label: t.windowEnd, contributions: contributionOf(t.cards.map((c) => ({ sub: o(c.sub) as never }))) }));
    const subTrend = trend.map((t) => ({ label: t.windowEnd, score: t.score, SUPPLIER: t.sub.SUPPLIER ?? null, ORGANIZATION: t.sub.ORGANIZATION ?? null, BOTH: t.sub.BOTH ?? null }));
    // Heat-map: template categories x the last six final evaluations.
    const heatmap: Record<string, { columns: string[]; rows: Array<{ id: string; name: string; cells: Array<number | null> }> }> = {};
    for (const p of PROFILES) {
        const cols = trend.filter((t) => t.cards.some((c) => str(c.profile) === p)).slice(-6);
        if (!cols.length) continue;
        const rows = new Map<string, { id: string; name: string; cells: Array<number | null> }>();
        cols.forEach((t, i) => {
            for (const x of objs(t.cards.find((c) => str(c.profile) === p)?.categories)) {
                const r = rows.get(str(x.id)) ?? { id: str(x.id), name: str(x.name), cells: cols.map(() => null) };
                r.cells[i] = x.pct === null ? null : Number(x.pct);
                rows.set(r.id, r);
            }
        });
        heatmap[p] = { columns: cols.map((t) => t.windowEnd), rows: [...rows.values()] };
    }
    // Recurring issues and consistent strengths, question by question.
    const finals = mine.filter((e) => str(e.data.status) === 'finalized').sort((a, b) => str(a.data.windowStart).localeCompare(str(b.data.windowStart)));
    const qh = questionHistory(finals.map((e) => ({ number: str(e.data.number) || e.id, at: str(e.data.windowEnd), answers: answersOf(e.data) })));
    const qtext = new Map<string, { text: string; accountability: string; weight: number; category: string }>();
    for (const e of finals) for (const c of objs(e.data.scorecards)) for (const cat of objs(c.categories)) for (const q of objs(cat.questions)) qtext.set(answerKey(str(c.id), str(q.id)), { text: str(q.text), accountability: str(q.accountability), weight: Number(q.weight) || 0, category: str(cat.name) });
    const qrows = Object.entries(qh).map(([k, h]) => ({ key: k, profile: k.split('|')[0], questionId: k.split('|')[1], ...h, ...(qtext.get(k) ?? { text: '', accountability: '', weight: 0, category: '' }) }));
    const issues = qrows.filter((q) => q.notOk > 0).sort((a, b) => b.streak - a.streak || b.notOk - a.notOk || b.weight - a.weight).slice(0, 8);
    const strengths = qrows.filter((q) => q.notOk === 0 && q.assessed > 0).sort((a, b) => b.assessed - a.assessed || b.weight - a.weight).slice(0, 6);
    const lastFinal = finals[finals.length - 1];
    const cadence = cadenceOf(setup?.window, setup?.frequency ?? 'quarterly', str(lastFinal?.data.windowEnd), str(lastFinal?.data.approvedAt), day);
    const actions: Obj[] = mine.flatMap((e) => objs(e.data.actions).map((a) => ({ ...a, evaluationId: e.id, evaluationNumber: str(e.data.number) || e.id, legalEntityName: str(e.data.legalEntityName), overdue: overdue(a, day) })));
    const current = mine.filter((e) => setup?.window && str(e.data.windowId) === setup.window.id).map((e) => ({ id: e.id, number: str(e.data.number), legalEntityName: str(e.data.legalEntityName), status: str(e.data.status), score: Number(o(e.data.result).score) || 0, coverage: Number(o(e.data.result).coverage) || 0 }));
    return {
        last, trend, lastCard, lastCategory, procurementCategories, current, contribution, contributionTrend, subTrend, heatmap, issues, strengths, cadence,
        actionStats: actionStats(actions, day),
        actions: actions.sort((a, b) => Number(b.overdue) - Number(a.overdue) || str(a.dueDate).localeCompare(str(b.dueDate))),
        actionCounts: { open: actions.filter((a) => str(a.status) === 'open').length, overdue: actions.filter((a) => a.overdue).length, done: actions.filter((a) => str(a.status) === 'done').length, verified: actions.filter((a) => str(a.status) === 'verified').length },
    };
}

/** Each supplier's latest final evaluation. */
function latestByVendor(evals: Doc[]): Map<string, Doc> {
    const m = new Map<string, Doc>();
    for (const e of evals) {
        if (str(e.data.status) !== 'finalized') continue;
        const cur = m.get(str(e.data.vendorId));
        if (!cur || `${str(e.data.windowStart)}${str(e.data.approvedAt)}` > `${str(cur.data.windowStart)}${str(cur.data.approvedAt)}`) m.set(str(e.data.vendorId), e);
    }
    return m;
}

/** Portfolio insights: every evaluated supplier, distribution, trend, weakest categories, window progress, actions. */
async function insights(ctx: OrgContext) {
    const [setup, evals, les] = await Promise.all([getSetup(ctx.orgId), listDocs(evalPath(ctx.orgId)), legalEntities(ctx.orgId)]);
    const day = today();
    const bands = setup?.bands ?? { improveFrom: 60, passFrom: 75 };
    const latest = latestByVendor(evals);
    const finals = evals.filter((e) => str(e.data.status) === 'finalized');
    const scoresAll = [...latest.values()].map((e) => Number(o(e.data.result).score) || 0);
    const league = [...latest.values()].map((e) => {
        const vid = str(e.data.vendorId);
        const prev = finals.filter((x) => str(x.data.vendorId) === vid && x.id !== e.id && str(x.data.windowStart) < str(e.data.windowStart)).sort((a, b) => str(b.data.windowStart).localeCompare(str(a.data.windowStart)))[0];
        const acts = evals.filter((x) => str(x.data.vendorId) === vid).flatMap((x) => objs(x.data.actions));
        const r = o(e.data.result), score = Number(r.score) || 0;
        const cur = setup?.window ? evals.filter((x) => str(x.data.vendorId) === vid && str(x.data.windowId) === setup.window!.id && str(x.data.status) !== 'cancelled') : [];
        return {
            vendorId: vid, vendorName: str(e.data.vendorName), vendorNumber: str(e.data.vendorNumber), score, band: bandOf(score, bands),
            previous: prev ? Number(o(prev.data.result).score) || 0 : null, delta: prev ? Math.round((score - (Number(o(prev.data.result).score) || 0)) * 10) / 10 : null,
            supplier: o(r.sub).SUPPLIER ?? null, organization: o(r.sub).ORGANIZATION ?? null, joint: o(r.sub).BOTH ?? null,
            openActions: acts.filter((a) => str(a.status) === 'open').length, overdueActions: acts.filter((a) => overdue(a, day)).length,
            lastWindowEnd: str(e.data.windowEnd), lastLegalEntity: str(e.data.legalEntityName),
            currentStatus: cur.length ? (cur.every((x) => str(x.data.status) === 'finalized') ? 'finalized' : cur.some((x) => str(x.data.status) === 'submitted') ? 'submitted' : 'in_progress') : setup?.eligible.some((x) => x.vendorId === vid) ? 'not_started' : 'not_selected',
            rank: rankOf(score, scoresAll).rank,
        };
    }).sort((a, b) => b.score - a.score);
    // Portfolio trend: average final score per window.
    const byWindow = new Map<string, { start: string; end: string; scores: number[]; sub: Record<string, number[]> }>();
    for (const e of finals) {
        const k = str(e.data.windowId);
        const w = byWindow.get(k) ?? { start: str(e.data.windowStart), end: str(e.data.windowEnd), scores: [], sub: { SUPPLIER: [], ORGANIZATION: [], BOTH: [] } };
        w.scores.push(Number(o(e.data.result).score) || 0);
        for (const a of ACCOUNTABILITY) { const v = o(o(e.data.result).sub)[a]; if (typeof v === 'number') w.sub[a].push(v); }
        byWindow.set(k, w);
    }
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    const trend = [...byWindow.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-8).map((w) => ({ label: w.end, score: avg(w.scores) ?? 0, count: w.scores.length, SUPPLIER: avg(w.sub.SUPPLIER), ORGANIZATION: avg(w.sub.ORGANIZATION), BOTH: avg(w.sub.BOTH) }));
    // Weakest template categories across suppliers' latest evaluations.
    const cat = new Map<string, { profile: string; id: string; name: string; values: number[] }>();
    for (const e of latest.values()) for (const c of objs(o(e.data.result).cards)) for (const x of objs(c.categories)) {
        if (x.pct === null || x.pct === undefined) continue;
        const k = `${str(c.profile)}|${str(x.id)}`;
        const r = cat.get(k) ?? { profile: str(c.profile), id: str(x.id), name: str(x.name), values: [] };
        r.values.push(Number(x.pct));
        cat.set(k, r);
    }
    const categories = [...cat.values()].map((r) => ({ profile: r.profile, id: r.id, name: r.name, average: avg(r.values) ?? 0, suppliers: r.values.length, failing: r.values.filter((v) => v < bands.improveFrom).length })).sort((a, b) => a.average - b.average);
    // Window progress per legal entity.
    const progress = setup?.window ? les.map((le) => {
        const ws = evals.filter((e) => str(e.data.windowId) === setup.window!.id && str(e.data.legalEntityId) === le.id && str(e.data.status) !== 'cancelled');
        const total = setup.eligible.length;
        return { legalEntityId: le.id, legalEntityName: le.name, total, started: ws.length, submitted: ws.filter((e) => str(e.data.status) === 'submitted').length, finalized: ws.filter((e) => str(e.data.status) === 'finalized').length, avgCoverage: avg(ws.map((e) => Number(o(e.data.result).coverage) || 0)) };
    }) : [];
    const actions = evals.flatMap((e) => objs(e.data.actions));
    const contribution = contributionOf([...latest.values()].flatMap((e) => objs(o(e.data.result).cards).map((c) => ({ sub: o(c.sub) as never }))));
    return {
        bands, cadence: cadenceOf(setup?.window, setup?.frequency ?? 'quarterly', '', '', day), frequencyLabel: FREQUENCIES[setup?.frequency ?? '']?.label ?? '',
        league, distribution: { pass: league.filter((x) => x.band === 'pass').length, improve: league.filter((x) => x.band === 'improve').length, fail: league.filter((x) => x.band === 'fail').length },
        average: avg(scoresAll), trend, categories: categories.slice(0, 12), progress, actionStats: actionStats(actions, day), contribution,
        eligible: setup?.eligible.length ?? 0, evaluated: latest.size,
        stamp: `${evals.length}:${evals.reduce((m, e) => (str(e.data.updatedAt) > m ? str(e.data.updatedAt) : m), '')}`,
    };
}

// ----- Routes -----

export const supplierEvaluationRoutes = {
    'POST /api/org/procurement/srm/setup/get': [
        orgRoute('org.procurement.srm.setup.get', 'PRC.srm.view', async (ctx) => {
            requireProcurement(ctx);
            const [m, setup, sup, les] = await Promise.all([master(), getSetup(ctx.orgId), supplierScopes(ctx.orgId), legalEntities(ctx.orgId)]);
            return {
                templateLoaded: !!m, templateVersion: m?.version ?? '',
                template: (m?.profiles ?? []).map((p) => ({
                    id: p.profile_id, name: PROFILE_LABEL[p.profile_id as ProfileId] ?? p.name, scope: str(p.scope), defaultFrequency: str(p.default_review_frequency),
                    categories: p.categories.map((c) => ({ id: c.category_id, name: c.name, weight: c.weight_percent, questions: c.questions.map((q) => ({ id: q.question_id, text: q.question, accountability: q.accountability, weight: q.weight_percent })) })),
                })),
                setup,
                suggestedNext: setup?.window ? nextWindow(setup.window.end, setup.frequency) : null,
                suggestedFirst: (() => { const start = today(); return { start, end: nextWindow(new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), setup?.frequency ?? 'quarterly').end }; })(),
                suppliers: sup.vendors.map((v) => ({ id: v.id, number: str(v.data.number) || v.id, name: vendorName(v), scopes: sup.map.get(v.id) ?? [] })).sort((a, b) => a.name.localeCompare(b.name)),
                legalEntities: les,
                frequencies: Object.entries(FREQUENCIES).map(([value, f]) => ({ value, label: f.label })),
                can: { setup: can(ctx, 'PRC.srm.setup') },
            };
        }),
    ],

    'POST /api/org/procurement/srm/setup/save': [
        orgRoute('org.procurement.srm.setup.save', 'PRC.srm.setup', async (ctx) => {
            requireProcurement(ctx);
            await rateLimit('prc-srm-setup', ctx.uid, 60, 3600);
            const reason = reasonOf(ctx.body, 10);
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm the evaluation setup.');
            const m = await needMaster();
            const old = await getSetup(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== (old?.version ?? 0)) throw new HttpError(409, 'Someone saved the setup since you opened it. Open it again.');
            const frequency = str(ctx.body.frequency);
            const problems: string[] = [];
            if (!FREQUENCIES[frequency]) problems.push('Choose how often suppliers are evaluated.');
            const bands = o(ctx.body.bands);
            problems.push(...bandProblems(bands));
            const w = o(ctx.body.window);
            problems.push(...windowProblems(str(w.start), str(w.end)));
            const adoption: Record<string, string[]> = {};
            for (const p of PROFILES) adoption[p] = [...new Set(Array.isArray(o(ctx.body.adoption)[p]) ? (o(ctx.body.adoption)[p] as unknown[]).map(str) : [])];
            problems.push(...adoptionProblems(m.profiles, adoption));
            const sup = await supplierScopes(ctx.orgId);
            const el = cleanEligible(ctx.body.eligible, sup.map);
            problems.push(...el.problems);
            if (!el.list.length) problems.push('Select at least one supplier to evaluate.');
            for (const e of el.list) for (const p of profilesFor(e.scopes)) if (!adoption[p].length) problems.push(`${e.vendorId}: ${PROFILE_LABEL[p]} categories are selected but nothing is adopted from the ${PROFILE_LABEL[p]} template.`);
            if (problems.length) throw new HttpError(400, [...new Set(problems)].slice(0, 20).join(' '));
            const version = (old?.version ?? 0) + 1;
            const at = nowIso();
            const doc = {
                version, frequency, bands: { improveFrom: Number(bands.improveFrom), passFrom: Number(bands.passFrom) },
                window: { id: windowId(str(w.start)), start: str(w.start), end: str(w.end) }, eligible: el.list, adoption,
                templateVersion: m.version, templateSha: m.sha, updatedAt: at, updatedBy: ctx.uid, updatedByName: nameOfUser(ctx.me), reason,
            };
            if (!(await writeDoc(`organizations/${ctx.orgId}/procurement_srm_versions/${version}`, { ...doc, previous: old ?? null }, { exists: false }))) throw new HttpError(409, 'That setup version is taken. Open it again.');
            await writeDoc(setupPath(ctx.orgId), doc);
            const adopted = PROFILES.map((p) => `${p} ${adoption[p].length}`).join(', ');
            await record(ctx, 'org.procurement.srm.setup.save', `v${version}`, `${FREQUENCIES[frequency].label}; bands ${doc.bands.improveFrom}/${doc.bands.passFrom}; window ${doc.window.start} to ${doc.window.end}; ${el.list.length} suppliers; adopted ${adopted}. ${reason}`.slice(0, 400));
            return { ok: true, version };
        }),
    ],

    // Suppliers to evaluate in the current window, per legal entity the person works in, with live status and score.
    'POST /api/org/procurement/srm/evaluations/list': [
        orgRoute('org.procurement.srm.evaluations.list', 'PRC.srm.view', async (ctx) => {
            requireProcurement(ctx);
            const [setup, les, mine, evals, vendors] = await Promise.all([getSetup(ctx.orgId), legalEntities(ctx.orgId), myEntities(ctx), listDocs(evalPath(ctx.orgId)), listDocs(vendorsPath(ctx.orgId))]);
            const vmap = new Map(vendors.map((v) => [v.id, v]));
            const day = today();
            const rows: Obj[] = [];
            if (setup?.window) {
                for (const le of les) {
                    for (const e of setup.eligible) {
                        const ev = evals.find((x) => str(x.data.windowId) === setup.window!.id && str(x.data.legalEntityId) === le.id && str(x.data.vendorId) === e.vendorId && str(x.data.status) !== 'cancelled');
                        const r = o(ev?.data.result);
                        rows.push({
                            key: `${le.id}|${e.vendorId}`, legalEntityId: le.id, legalEntityName: le.name, mine: mine.has(le.id),
                            vendorId: e.vendorId, vendorNumber: str(vmap.get(e.vendorId)?.data.number) || e.vendorId, vendorName: vendorName(vmap.get(e.vendorId)),
                            profiles: profilesFor(e.scopes), scopes: e.scopes,
                            evaluationId: ev?.id ?? '', status: ev ? str(ev.data.status) : 'not_started', score: ev ? Number(r.score) || 0 : null, coverage: ev ? Number(r.coverage) || 0 : 0, band: str(r.band),
                            updatedAt: str(ev?.data.updatedAt),
                        });
                    }
                }
            }
            const history = trendRows(evals).reverse().slice(0, 500).map((t) => ({ ...t, vendorId: str(evals.find((e) => e.id === t.id)?.data.vendorId), vendorName: str(evals.find((e) => e.id === t.id)?.data.vendorName) }));
            const open = evals.filter((e) => ['in_progress', 'returned', 'submitted'].includes(str(e.data.status))).length;
            return {
                setup: setup ? { version: setup.version, frequency: setup.frequency, frequencyLabel: FREQUENCIES[setup.frequency]?.label ?? '', bands: setup.bands, window: setup.window } : null,
                windowOpen: inWindow(setup?.window, day), rows, history, open,
                can: { evaluate: can(ctx, 'PRC.srm.evaluate'), approve: can(ctx, 'PRC.srm.approve'), setup: can(ctx, 'PRC.srm.setup') },
                stamp: `${evals.length}:${evals.reduce((m, e) => (str(e.data.updatedAt) > m ? str(e.data.updatedAt) : m), '')}`,
            };
        }),
    ],

    'POST /api/org/procurement/srm/evaluations/start': [
        orgRoute('org.procurement.srm.evaluations.start', 'PRC.srm.evaluate', async (ctx) => {
            requireProcurement(ctx);
            await rateLimit('prc-srm-start', ctx.uid, 120, 3600);
            const [m, setup] = await Promise.all([needMaster(), needSetup(ctx.orgId)]);
            if (!setup.window || !inWindow(setup.window, today())) throw new HttpError(409, setup.window ? `Evaluations run from ${setup.window.start} to ${setup.window.end}.` : 'Set the evaluation window first.');
            const leId = str(ctx.body.legalEntityId), vendorId = str(ctx.body.vendorId);
            const le = (await legalEntities(ctx.orgId)).find((x) => x.id === leId);
            if (!le) throw new HttpError(404, 'Legal entity not found.');
            if (!(await myEntities(ctx)).has(le.id) && !bypass(ctx, 'prc.srm.legal_entity_scope')) throw new HttpError(403, 'You can evaluate suppliers only for the legal entities you work in.');
            const el = setup.eligible.find((e) => e.vendorId === vendorId);
            if (!el) throw new HttpError(409, 'This supplier is not selected for evaluation.');
            const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${vendorId}`);
            if (!vendor || str(vendor.data.status) !== 'approved') throw new HttpError(409, 'The supplier is no longer approved.');
            const cards: Profile[] = [];
            for (const pid of profilesFor(el.scopes)) {
                const mp = m.profiles.find((p) => p.profile_id === pid);
                const eff = mp ? effectiveProfile(mp, new Set(setup.adoption[pid] ?? [])) : null;
                if (eff) cards.push(eff);
            }
            if (!cards.length) throw new HttpError(409, 'No adopted questions apply to this supplier\'s categories. Adjust the setup.');
            const keyPath = `organizations/${ctx.orgId}/srm_evaluation_keys/${setup.window.id}_${le.id}_${vendorId}`;
            const existing = await getDoc(keyPath);
            if (existing) {
                const ev = await getDoc(`${evalPath(ctx.orgId)}/${str(existing.data.id)}`);
                if (ev && str(ev.data.status) !== 'cancelled') return { ok: true, id: ev.id, existing: true };
            }
            const n = await nextOrgCounter(ctx.orgId, 'srmEvaluationSeq');
            const id = `SRE${String(n).padStart(8, '0')}`;
            const at = nowIso();
            const d: Obj = {
                number: id, status: 'in_progress', windowId: setup.window.id, windowStart: setup.window.start, windowEnd: setup.window.end,
                legalEntityId: le.id, legalEntityName: le.name, vendorId, vendorNumber: str(vendor.data.number) || vendorId, vendorName: vendorName(vendor),
                scopes: el.scopes, scorecards: cards, answers: {}, actions: [], bands: setup.bands, configVersion: setup.version, templateVersion: m.version,
                createdAt: at, createdBy: ctx.uid, createdByName: nameOfUser(ctx.me), version: 1,
                history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'started', note: `${le.name} · ${cards.map((c) => c.name).join(', ')}`, from: '', to: 'in_progress' }],
            };
            const sc = scores(d);
            d.result = { score: sc.overall.score, coverage: 0, band: sc.overall.band, sub: sc.overall.sub, cards: [] };
            if (existing) await writeDoc(keyPath, { id, at, by: ctx.uid, previous: str(existing.data.id) });
            else if (!(await writeDoc(keyPath, { id, at, by: ctx.uid }, { exists: false }))) throw new HttpError(409, 'Someone started this evaluation at the same moment. Open it from the list.');
            if (!(await writeDoc(`${evalPath(ctx.orgId)}/${id}`, d, { exists: false }))) throw new HttpError(409, 'That evaluation number is taken. Try again.');
            await record(ctx, 'org.procurement.srm.start', id, `${vendorName(vendor)} · ${le.name} · window ${setup.window.start} to ${setup.window.end}`);
            return { ok: true, id };
        }),
    ],

    // Real time: the screen polls with the version it has; unchanged evaluations return almost nothing.
    'POST /api/org/procurement/srm/evaluations/get': [
        orgRoute('org.procurement.srm.evaluations.get', 'PRC.srm.view', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            const version = Number(doc.data.version) || 1;
            if (Number(ctx.body.knownVersion) === version) return { unchanged: true, version };
            const [entities, all] = await Promise.all([myEntities(ctx), listDocs(evalPath(ctx.orgId))]);
            const inEntity = entities.has(str(doc.data.legalEntityId));
            // Earlier final evaluations of this supplier (same legal entity first), oldest first, for repeat findings.
            const earlier = all
                .filter((e) => e.id !== doc.id && str(e.data.vendorId) === str(doc.data.vendorId) && str(e.data.status) === 'finalized')
                .sort((a, b) => Number(str(a.data.legalEntityId) === str(doc.data.legalEntityId)) - Number(str(b.data.legalEntityId) === str(doc.data.legalEntityId)) || str(a.data.windowStart).localeCompare(str(b.data.windowStart)));
            const last = earlier[earlier.length - 1];
            const day = today();
            return {
                unchanged: false,
                evaluation: evalOut(ctx, doc.id, doc.data, inEntity),
                previous: {
                    history: questionHistory(earlier.map((e) => ({ number: str(e.data.number) || e.id, at: str(e.data.windowEnd), answers: answersOf(e.data) }))),
                    last: last ? { id: last.id, number: str(last.data.number) || last.id, score: Number(o(last.data.result).score) || 0, windowEnd: str(last.data.windowEnd), legalEntityName: str(last.data.legalEntityName), cards: objs(o(last.data.result).cards).map((c) => ({ profile: str(c.profile), score: Number(c.score) || 0, categories: objs(c.categories).map((x) => ({ id: str(x.id), pct: x.pct === null ? null : Number(x.pct) })) })) } : null,
                    evaluations: earlier.length,
                },
                window: { daysLeft: str(doc.data.windowEnd) >= day ? Math.max(0, Math.round((Date.parse(`${str(doc.data.windowEnd)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)) : 0, closed: str(doc.data.windowEnd) < day },
                actionStats: actionStats(objs(doc.data.actions), day),
            };
        }),
    ],

    // One tap on a question: unassessed, OK or not OK (with the finding for not OK). Refused if it changed under you.
    'POST /api/org/procurement/srm/evaluations/answer': [
        orgRoute('org.procurement.srm.evaluations.answer', 'PRC.srm.evaluate', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            await needEntity(ctx, doc.data);
            const profile = str(ctx.body.profile), qid = str(ctx.body.questionId);
            const state = str(ctx.body.state) as AnswerState;
            if (!STATES.includes(state)) throw new HttpError(400, 'Choose unassessed, OK or not OK.');
            const note = clean(ctx.body.note, 600);
            return mutate(ctx, doc.id, 'answer', async (d) => {
                if (!['in_progress', 'returned'].includes(str(d.status))) throw new HttpError(409, 'This evaluation is no longer open for scoring.');
                const card = cardsOf(d).find((c) => c.id === profile);
                const q = card?.categories.flatMap((c) => c.questions).find((x) => x.id === qid);
                if (!card || !q) throw new HttpError(404, 'Question not found in this evaluation.');
                const key = answerKey(profile, qid);
                const answers = { ...answersOf(d) };
                const cur = answers[key]?.state ?? 'unassessed';
                if (ctx.body.expected !== undefined && str(ctx.body.expected) !== cur) throw new HttpError(409, `Someone else changed ${qid} to ${cur === 'not_ok' ? 'not OK' : cur}. The screen has been refreshed.`);
                if (state === 'unassessed') delete answers[key];
                else answers[key] = { state, note: state === 'not_ok' ? note || str(answers[key]?.note) : '', by: ctx.uid, byName: nameOfUser(ctx.me), at: nowIso() };
                const label = state === 'ok' ? 'OK' : state === 'not_ok' ? 'not OK' : 'unassessed';
                // Every tap is audited; only state changes go into the evaluation history to keep it readable.
                return { patch: { answers }, event: cur !== state ? `${qid} ${label}` : '', note: state === 'not_ok' && note ? note : '', label: `${qid} ${label}` };
            });
        }),
    ],

    'POST /api/org/procurement/srm/evaluations/submit': [
        orgRoute('org.procurement.srm.evaluations.submit', 'PRC.srm.evaluate', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            await needEntity(ctx, doc.data);
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that every answer is backed by evidence.');
            return mutate(ctx, doc.id, 'submit', async (d) => {
                if (!['in_progress', 'returned'].includes(str(d.status))) throw new HttpError(409, 'Only an evaluation in progress can be submitted.');
                const p = submitProblems(cardsOf(d), answersOf(d));
                if (p.length) throw new HttpError(409, p.slice(0, 12).join(' '));
                const sc = scores(d);
                return { patch: { status: 'submitted', submittedAt: nowIso(), submittedBy: ctx.uid, submittedByName: nameOfUser(ctx.me), returnReason: '' }, event: 'submitted for approval', note: `Score ${sc.overall.score} (${sc.overall.bandLabel})`, label: 'Submitted' };
            });
        }),
    ],

    'POST /api/org/procurement/srm/evaluations/approve': [
        orgRoute('org.procurement.srm.evaluations.approve', 'PRC.srm.approve', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you reviewed the answers, findings and actions.');
            const out = await mutate(ctx, doc.id, 'approve', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot approve this evaluation.');
                if (chk.testMode) bypass(ctx, 'prc.srm.approver_independence');
                const sc = scores(d);
                return { patch: { status: 'finalized', approvedAt: nowIso(), approvedBy: ctx.uid, approvedByName: nameOfUser(ctx.me), finalScore: sc.overall.score, finalBand: sc.overall.band }, event: 'approved and finalized', note: clean(ctx.body.note, 300) || `Score ${sc.overall.score} (${sc.overall.bandLabel})`, label: 'Finalized', result: { finalScore: sc.overall.score } };
            });
            // The supplier's SRM score (used in quotation analysis) becomes the latest final score.
            const vpath = `${vendorsPath(ctx.orgId)}/${str(doc.data.vendorId)}`;
            const v = await getDoc(vpath);
            const fresh = await getDoc(`${evalPath(ctx.orgId)}/${doc.id}`);
            if (v && fresh && str(fresh.data.status) === 'finalized') {
                const score = Number(fresh.data.finalScore) || 0, at = nowIso();
                const note = `${doc.id} ${str(fresh.data.legalEntityName)} ${str(fresh.data.windowStart)} to ${str(fresh.data.windowEnd)}`.slice(0, 200);
                await writeDoc(vpath, { ...v.data, srmScore: Math.round(score * 10) / 10, srmAt: at, srmNote: note, srmSource: doc.id, history: [...objs(v.data.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'SRM score from evaluation', note: `${score} · ${note}` }].slice(-200) }, { updateTime: v.updateTime });
                await record(ctx, 'org.procurement.srm.vendor_score', str(doc.data.vendorId), `${score} from ${doc.id}`);
            }
            return out;
        }),
    ],

    'POST /api/org/procurement/srm/evaluations/return': [
        orgRoute('org.procurement.srm.evaluations.return', 'PRC.srm.approve', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, doc.id, 'return', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot return this evaluation.');
                if (chk.testMode) bypass(ctx, 'prc.srm.approver_independence');
                return { patch: { status: 'returned', returnReason: reason, returnedBy: ctx.uid, returnedAt: nowIso() }, event: 'returned for correction', note: reason, label: 'Returned' };
            });
        }),
    ],

    'POST /api/org/procurement/srm/evaluations/cancel': [
        orgRoute('org.procurement.srm.evaluations.cancel', 'PRC.srm.evaluate', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            await needEntity(ctx, doc.data);
            const reason = reasonOf(ctx.body);
            return mutate(ctx, doc.id, 'cancel', async (d) => {
                if (!['in_progress', 'returned'].includes(str(d.status))) throw new HttpError(409, 'Only an evaluation in progress can be cancelled.');
                return { patch: { status: 'cancelled', cancelReason: reason, cancelledAt: nowIso(), cancelledBy: ctx.uid }, event: 'cancelled', note: reason, label: 'Cancelled' };
            });
        }),
    ],

    // Improvement actions on questions marked not OK, followed to verified completion.
    'POST /api/org/procurement/srm/actions/add': [
        orgRoute('org.procurement.srm.actions.add', 'PRC.srm.evaluate', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            await needEntity(ctx, doc.data);
            const description = clean(ctx.body.description, 500), owner = clean(ctx.body.owner, 120), dueDate = str(ctx.body.dueDate);
            const accountability = str(ctx.body.accountability);
            if (description.length < 10) throw new HttpError(400, 'Describe the action (10+ characters).');
            if (owner.length < 2) throw new HttpError(400, 'Name the action owner.');
            if (!ACCOUNTABILITY.includes(accountability as never)) throw new HttpError(400, 'Choose who is accountable: supplier, organization or joint.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today()) throw new HttpError(400, 'Enter a due date of today or later.');
            return mutate(ctx, doc.id, 'actions.add', async (d) => {
                if (str(d.status) === 'cancelled') throw new HttpError(409, 'The evaluation is cancelled.');
                const profile = str(ctx.body.profile), qid = str(ctx.body.questionId);
                const q = cardsOf(d).find((c) => c.id === profile)?.categories.flatMap((c) => c.questions).find((x) => x.id === qid);
                if (!q) throw new HttpError(404, 'Question not found.');
                if (answersOf(d)[answerKey(profile, qid)]?.state !== 'not_ok') throw new HttpError(409, 'Actions are raised on questions marked not OK.');
                const actions = objs(d.actions);
                if (actions.length >= 300) throw new HttpError(409, 'Too many actions on one evaluation.');
                const a = { id: randomId(6), profile, questionId: qid, question: q.text.slice(0, 300), description, accountability, owner, dueDate, status: 'open', createdAt: nowIso(), createdBy: ctx.uid, createdByName: nameOfUser(ctx.me) };
                return { patch: { actions: [...actions, a] }, event: `action raised on ${qid}`, note: `${description} · ${owner} · due ${dueDate}`, label: 'Action raised' };
            });
        }),
    ],

    // done: the owner's evidence (evaluators); verified: an approver who did not mark it done; reopen: not effective.
    'POST /api/org/procurement/srm/actions/update': [
        orgRoute('org.procurement.srm.actions.update', 'PRC.srm.view', async (ctx) => {
            const doc = await loadEval(ctx, str(ctx.body.id));
            const step = str(ctx.body.step);
            const note = clean(ctx.body.note, 500);
            if (note.length < 10) throw new HttpError(400, 'Describe the evidence or reason (10+ characters).');
            if (step === 'done' && !can(ctx, 'PRC.srm.evaluate')) throw new HttpError(403, 'You need the supplier evaluator right.');
            if (['verify', 'reopen'].includes(step) && !can(ctx, 'PRC.srm.approve')) throw new HttpError(403, 'You need the supplier evaluation approver right.');
            if (!['done', 'verify', 'reopen'].includes(step)) throw new HttpError(400, 'Choose done, verify or reopen.');
            return mutate(ctx, doc.id, `actions.${step}`, async (d) => {
                const actions = objs(d.actions);
                const a = actions.find((x) => str(x.id) === str(ctx.body.actionId));
                if (!a) throw new HttpError(404, 'Action not found.');
                const at = nowIso();
                let patch: Obj;
                if (step === 'done') {
                    if (str(a.status) !== 'open') throw new HttpError(409, 'Only an open action can be marked done.');
                    patch = { status: 'done', doneAt: at, doneBy: ctx.uid, doneByName: nameOfUser(ctx.me), evidence: note };
                } else {
                    if (str(a.status) !== 'done') throw new HttpError(409, 'Only an action marked done can be verified or reopened.');
                    if (str(a.doneBy) === ctx.uid && !bypass(ctx, 'prc.srm.action_verifier')) throw new HttpError(403, 'Someone other than the person who marked it done must verify it.');
                    patch = step === 'verify' ? { status: 'verified', verifiedAt: at, verifiedBy: ctx.uid, verifiedByName: nameOfUser(ctx.me), verification: note } : { status: 'open', reopenedAt: at, reopenedBy: ctx.uid, reopenReason: note };
                }
                return { patch: { actions: actions.map((x) => (x === a ? { ...x, ...patch } : x)) }, event: `action ${step === 'verify' ? 'verified' : step === 'reopen' ? 'reopened' : 'done'} (${str(a.questionId)})`, note, label: `Action ${step}` };
            });
        }),
    ],

    'POST /api/org/procurement/srm/insights': [
        orgRoute('org.procurement.srm.insights', 'PRC.srm.view', async (ctx) => {
            requireProcurement(ctx);
            return insights(ctx);
        }),
    ],

    'POST /api/org/procurement/srm/dashboard': [
        orgRoute('org.procurement.srm.dashboard', 'PRC.srm.view', async (ctx) => {
            requireProcurement(ctx);
            const vendorId = str(ctx.body.vendorId);
            if (!/^VND\d{6}$/.test(vendorId)) throw new HttpError(400, 'Choose a supplier.');
            const [v, evals, setup] = await Promise.all([getDoc(`${vendorsPath(ctx.orgId)}/${vendorId}`), listDocs(evalPath(ctx.orgId)), getSetup(ctx.orgId)]);
            if (!v) throw new HttpError(404, 'Supplier not found.');
            const mine = evals.filter((e) => str(e.data.vendorId) === vendorId);
            const latest = latestByVendor(evals);
            const own = latest.get(vendorId);
            return {
                rank: own ? rankOf(Number(o(own.data.result).score) || 0, [...latest.values()].map((e) => Number(o(e.data.result).score) || 0)) : null,
                vendor: { id: v.id, number: str(v.data.number) || v.id, name: vendorName(v), srmScore: typeof v.data.srmScore === 'number' ? v.data.srmScore : null },
                bands: setup?.bands ?? { improveFrom: 60, passFrom: 75 }, eligible: !!setup?.eligible.some((e) => e.vendorId === vendorId),
                ...dashboardOf(vendorId, evals, setup),
                stamp: `${mine.length}:${mine.reduce((m, e) => (str(e.data.updatedAt) > m ? str(e.data.updatedAt) : m), '')}`,
            };
        }),
    ],
};

export const _test = { dashboardOf, trendRows, nextWindow };
