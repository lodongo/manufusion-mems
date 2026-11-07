import { randomInt } from 'crypto';
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { audited, requireAt } from './scopeGuard';
import { audit } from './audit';
import { bypass } from './testModeCore';
import { postStockTake } from './finOps';
import { stockValOf } from './finCore';
import { getAuthority } from './procurementPolicy';
import { approvalRoute, myPositions } from './purchaseOrders';
import { metricsOf, overallStatistics, plannedPis, sessionProgress } from './stockTakeProgress';

// ---------------------------------------------------------------------------
// Stock take (physical inventory, PI documents).
//   organizations/{org}/stock_take_configs/{COUNT_CONFIGnnnnnnnn}   reusable count configurations
//   organizations/{org}/stock_take_count_sessions/{CNT_SES_nnnnnnnn} a planned stock take session (configuration,
//                                                                    warehouse, start/end, metrics) holding PI documents
//   organizations/{org}/stock_take_sessions/{PI_nnnnnnnn[_n]}       a PI document and its recounts
//   organizations/{org}/stock_take_attachments/{sessionId}          the signed PI scan (kept out of the session)
//
// A session is created first (Active sessions); PI documents are only created inside an open session that has started
// and not ended, and take the session's configuration and warehouse.
// Flow: awaiting_print → counting → verification → verified → pending_post_approval → approved_for_posting
//       → reconciled (or recount_pending while recount PIs are open); disregarded / closed_posted end a session.
// Controls:
//   - every action needs its INV_ST_ permission at the session's warehouse (job roles bound to places);
//   - separation of duties: the counter cannot verify, approve or post; the person requesting posting cannot
//     approve it; there is no self-approval exception for anyone;
//   - stock is only posted after approval; every step is audited;
//   - variances are valued at moving average and approved under the Chart of Authority: each level of the value band
//     is approved, in order, by a different person holding the mapped job role (L1 follows the reporting line of the
//     person requesting posting); a PI with no variance needs one independent approval;
//   - posting cannot be requested while a line has no reconciled stock baseline.
// ---------------------------------------------------------------------------

const TYPES = ['Cycle Count', 'Full Stock Take', 'Cluster Stock Take', 'Random Stock Take'];
const PERIODS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually'];
// A PI is closed once it is reconciled, closed, disregarded, wholly recounted (its lines live on in the recount PI) or
// partly posted with the rest on a recount PI.
const CLOSED = ['reconciled', 'disregarded', 'closed_posted', 'recounted', 'recount_pending'];
const CLUSTER_RE = /^CL-\d{4}$/;
// PI documents: PI_ + 8 digits (organization counter); older ones PI + 9 digits. Recounts add _n.
const SESSION_RE = /^(PI_\d{8}|PI\d{9})(_\d{1,3})?$/;
const CONFIG_RE = /^COUNT_CONFIG\d{8}$/;
// Stock take sessions: CNT_SES_ + 8 digits (organization counter); the first few were STS + 9 digits.
const CAMPAIGN_RE = /^(CNT_SES_\d{8}|STS\d{9})$/;
const CAMPAIGNS = 'stock_take_count_sessions';
const MAX_SESSION_DAYS = 366;
const MAX_ATTACHMENT_CHARS = 650_000; // about 450 KB of file as base64
const ACTION_PERMS: Record<string, string> = {
    printed: 'INV_ST_010',
    counts: 'INV_ST_017',
    edit_counts: 'INV_ST_016',
    verify: 'INV_ST_020',
    accept: 'INV_ST_020',
    recount: 'INV_ST_022',
    refresh_baseline: 'INV_ST_024',
    submit_posting: 'INV_ST_026',
    approve_posting: 'INV_ST_027',
    reject_posting: 'INV_ST_027',
    post: 'INV_ST_028',
    disregard: 'INV_ST_012',
    close_posted: 'INV_ST_013',
};

const rootOf = (ctx: OrgContext) => `organizations/${ctx.orgId}`;
/** "1 line", "2 lines". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Warehouses the user may see ('read', includes view-only extra scopes) or act on ('write'). */
async function warehousesFor(ctx: OrgContext, mode: 'read' | 'write') {
    const allowed = ctx.role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, mode === 'read');
    return (await listDocs(`${rootOf(ctx)}/warehouses`)).filter((w) => allowed === 'all' || allowed.has(w.id));
}

function canView(ctx: OrgContext) {
    if (ctx.role === 'org_super_admin') return;
    if (!['INV.view', 'INV.edit', 'INV_ST_001', 'INV_ST_007'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Inventory access required');
}

/**
 * A configuration bound to a warehouse (automatic sessions, cluster stock takes) may only name one the person can act
 * on, and only clusters that exist in it.
 */
async function checkConfigWarehouse(ctx: OrgContext, warehouseId: string, clusterIds: string[] = []) {
    if (!warehouseId) return;
    if (!(await warehousesFor(ctx, 'write')).some((w) => w.id === warehouseId)) throw new HttpError(403, 'Choose a warehouse you can act on');
    if (clusterIds.length) {
        const have = new Set((await listDocs(`${rootOf(ctx)}/warehouses/${warehouseId}/clusters`)).map((x) => x.id));
        const missing = clusterIds.filter((c) => !have.has(c));
        if (missing.length) throw new HttpError(400, `Cluster ${missing.slice(0, 5).join(', ')} does not exist in this warehouse`);
    }
}

/** First automatic session: a cycle count begins at the end of the current period; other types at the next midnight. */
const firstDue = (config: { type: string; period: string }) => (config.type === 'Cycle Count' ? periodEnd(nairobiDay(), config.period) : nairobiDay());

/** Configurations are organization-wide templates: the permission counts wherever it is held. */
function requireAnywhere(ctx: OrgContext, key: string) {
    if (ctx.role !== 'org_super_admin' && !hasPerm(ctx.permissions, key)) throw new HttpError(403, `Stock take permission required: ${key}`);
}

/** Session work is bound to the warehouse: the permission must apply at that warehouse. */
function requireAtWarehouse(ctx: OrgContext, key: string, warehouseId: string) {
    return requireAt(ctx, [key], warehouseId, 'write', `Stock take permission ${key} is required for this warehouse.`);
}

async function snapshot(root: string, warehouseId: string) {
    const [occupancy, materials, journal, infos] = await Promise.all([
        listDocs(`${root}/warehouse_bin_occupancy`),
        listDocs(`${root}/materials`),
        listDocs(`${root}/material_journal`),
        listDocs(`${root}/inventory_material_info`),
    ]);
    const mm = new Map(materials.map((x) => [x.id, x.data]));
    const im = new Map(infos.map((x) => [x.id, x.data]));
    const byKey = new Map<string, { q: number; valid: boolean; seen: boolean }>();
    for (const x of journal) {
        const d = x.data;
        if (str(d.warehouseId) !== warehouseId) continue;
        const k = str(d.materialId);
        const v = byKey.get(k) || { q: 0, valid: true, seen: false };
        v.seen = true;
        if (str(d.status) !== 'posted' || d.reconciled !== true) v.valid = false;
        else v.q += Number(isObj(d.balancesDelta) ? d.balancesDelta.physicalStock : 0) || 0;
        byKey.set(k, v);
    }
    return occupancy
        .filter((x) => str(x.data.warehouseId) === warehouseId)
        .map((x) => {
            const d = x.data;
            const m = mm.get(str(d.materialId));
            const j = byKey.get(str(d.materialId));
            return {
                binId: str(d.binId),
                materialId: str(d.materialId),
                materialNumber: str(m?.materialNumber) || str(d.materialNumber),
                description: str(m?.shortText) || str(m?.name),
                expected: j?.seen && j.valid ? j.q : null,
                info: im.get(`${str(d.materialId)}_${warehouseId}`),
            };
        })
        .sort((a, b) => a.binId.localeCompare(b.binId, undefined, { numeric: true }));
}

// ----- Chart of Authority for stock variances -----

type Obj = Record<string, unknown>;
interface CoaStep {
    level: string;
    title: string;
    positionCode: string;
    positionTitle: string;
    status: 'pending' | 'approved';
    by: string;
    at: string;
}
const coaSteps = (d: Obj): CoaStep[] => (isObj(d.approval) && Array.isArray(d.approval.steps) ? (d.approval.steps as unknown[]).filter(isObj).map((x) => ({ ...x }) as unknown as CoaStep) : []);
const currentCoaStep = (d: Obj) => coaSteps(d).find((x) => x.status === 'pending') ?? null;

/**
 * May this person approve the current Chart of Authority level of this PI, and if not, why not. Only for PIs whose
 * variances were routed through the chart (a PI with no variance has no steps and keeps the single independent approval).
 * The separation-of-duties rules (counter, requester) are checked separately on the action.
 */
function coaCheck(ctx: OrgContext, d: Obj): { routed: boolean; ok: boolean; why: string; level: string; title: string; positionTitle: string; testMode: boolean } {
    const step = currentCoaStep(d);
    const base = { routed: coaSteps(d).length > 0, level: step?.level ?? '', title: step?.title ?? '', positionTitle: step?.positionTitle ?? '', testMode: false };
    if (str(d.status) !== 'pending_post_approval' || !step) return { ...base, ok: false, why: '' };
    let why = '';
    if (!myPositions(ctx.me).includes(step.positionCode)) why = `Level ${step.level} (${step.title}) is approved by ${step.positionTitle}.`;
    else if (coaSteps(d).some((x) => x.status === 'approved' && x.by === ctx.uid)) why = 'You approved an earlier level, so a different person must approve this one.';
    if (!why) return { ...base, ok: true, why: '' };
    // Platform test mode (development only): the organization super admin may act at every level; the action records it.
    if (ctx.testMode === true) return { ...base, ok: true, why: '', testMode: true };
    return { ...base, ok: false, why };
}

/** Gross value of the differences at moving average (organization currency); materials with no cost are listed. */
async function varianceValueOf(ctx: OrgContext, warehouseId: string, pending: Array<Record<string, any>>) {
    const agg = new Map<string, { delta: number; number: string }>();
    for (const line of pending) {
        const delta = Number(line.counted) - Number(line.expected);
        if (!delta) continue;
        const k = str(line.materialId);
        const v = agg.get(k) ?? { delta: 0, number: str(line.materialNumber) || k };
        v.delta += delta;
        agg.set(k, v);
    }
    let value = 0;
    const unvalued: string[] = [];
    const byMaterial: Array<{ materialId: string; materialNumber: string; delta: number; unitCost: number; value: number }> = [];
    for (const [materialId, v] of agg) {
        if (!v.delta) continue;
        const sv = await stockValOf(ctx.orgId, warehouseId, materialId);
        const unitCost = sv.avg > 0 ? sv.avg : 0;
        if (!unitCost) unvalued.push(v.number);
        const lineValue = Math.round(Math.abs(v.delta) * unitCost * 100) / 100;
        value += lineValue;
        byMaterial.push({ materialId, materialNumber: v.number, delta: Math.round(v.delta * 10000) / 10000, unitCost: Math.round(unitCost * 10000) / 10000, value: lineValue });
    }
    return { value: Math.round(value * 100) / 100, unvalued, byMaterial, differences: byMaterial.length };
}

// ----- Stock take sessions (planned first; PI documents are created inside them) -----

/** Metrics of a session: materials to count, materials per PI document and the targets. */
/**
 * Plan of a session: materials to count and materials per PI document. Accuracy and variance are KPIs measured by the
 * progress report and statistics, not set up here. With countAll the number of materials is not taken from the caller:
 * the server counts every mapped location in the warehouse that the configuration selects.
 */
function readMetrics(m: Obj, allCount: number | null = null) {
    const whole = (v: unknown, label: string, min: number, max: number) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
        return n;
    };
    const countAll = m.countAll === true;
    if (countAll && !allCount) throw new HttpError(409, 'No mapped materials match this configuration in the warehouse, so there is nothing to count.');
    const metrics = {
        countAll,
        targetMaterials: countAll ? (allCount as number) : whole(m.targetMaterials, 'Materials to count', 1, 1_000_000),
        materialsPerPi: whole(m.materialsPerPi, 'Materials per PI document', 1, 1000),
        // Independent count sheets printed per PI document (copies _A, _B …): where they disagree a recount is mandatory.
        piCopies: whole(m.piCopies ?? 1, 'PI documents printed per PI', 1, MAX_COPIES),
    };
    if (plannedPis(metrics.targetMaterials, metrics.materialsPerPi) > 1000) throw new HttpError(400, 'A session can have at most 1000 PI documents; count fewer materials or put more on each PI.');
    return metrics;
}

/** Mapped locations of a warehouse that a configuration would put on PI documents (cluster and criticality applied). */
async function selectableLocations(root: string, warehouseId: string, config: Obj) {
    let rows = await snapshot(root, warehouseId);
    if (str(config.type) === 'Cluster Stock Take') {
        const clusters = clustersOfConfig(config);
        rows = rows.filter((x) => clusters.some((c) => x.binId.startsWith(`${c}__`)));
    }
    const classes = config.byCriticality === true && Array.isArray(config.criticalityClasses) ? (config.criticalityClasses as unknown[]).map(str) : [];
    if (classes.length) rows = rows.filter((x) => classes.includes(str(x.info?.criticalityClass)));
    return rows;
}

/** A session runs from its start for the configuration's duration; nothing may be backdated. */
/** When a session that starts at startIso ends: a cycle count at the end of its period, others after the duration. */
function sessionEnd(config: Obj, startIso: string): string {
    const startMs = Date.parse(startIso);
    if (isCycle(config)) {
        if (!PERIODS.includes(str(config.period))) throw new HttpError(400, 'Set the cycle period on the configuration first.');
        return nairobiMidnight(periodEnd(nairobiDay(startMs), str(config.period)));
    }
    const days = Number(config.durationDays);
    if (!Number.isInteger(days) || days < 1) throw new HttpError(400, 'Set the duration (days) on the configuration first; the session end date is worked out from it.');
    return new Date(startMs + days * 86_400_000).toISOString();
}

function readCampaign(b: Obj, now: string, config: Obj, allCount: number | null) {
    const name = str(b.name).trim();
    if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Enter a session name of 3 to 80 characters');
    const startAt = str(b.startAt);
    const startMs = Date.parse(startAt);
    if (!startAt || !Number.isFinite(startMs)) throw new HttpError(400, 'Enter a valid start date and time');
    // No backdating: a session cannot claim to have started before it was planned (10 minutes allowed for the clock).
    if (startMs < Date.parse(now) - 10 * 60_000) throw new HttpError(400, 'The start cannot be in the past');
    if (startMs > Date.parse(now) + MAX_SESSION_DAYS * 86_400_000) throw new HttpError(400, `The start must be within ${MAX_SESSION_DAYS} days`);
    const end = sessionEnd(config, new Date(startMs).toISOString());
    return { name, startAt: new Date(startMs).toISOString(), endAt: end, metrics: readMetrics(isObj(b.metrics) ? b.metrics : {}, allCount) };
}

/** Why a PI cannot be created in this session now, or '' when it can. */
function campaignClosedReason(c: Obj, now: string): string {
    if (str(c.status) !== 'open') return 'This stock take session is not open.';
    if (Date.parse(now) < Date.parse(str(c.startAt))) return 'This stock take session has not started yet.';
    if (str(c.endAt) && Date.parse(now) > Date.parse(str(c.endAt))) return 'This stock take session has passed its end date, so no more PI documents can be created in it.';
    if (c.setupRequired === true) return 'Complete the session setup (materials to count, materials per PI and targets) before creating PI documents.';
    return '';
}

/**
 * A session closes by itself once posting is 100% done: every planned PI document exists (or no unplanned location is
 * left) and every PI document that is not disregarded is reconciled or closed with its stock posted. It cannot be
 * closed by hand. Returns true when it was closed now.
 */
/**
 * Whether a session's posting is 100% done: it is set up, has PI documents, every PI document that is not disregarded
 * is reconciled or closed with its stock posted, and no more PI documents can come: the planned number exists, the
 * locations ran out, or the session has passed its end date (after which no PI document can be created).
 */
export function sessionComplete(session: Obj, pis: Obj[], now: string): boolean {
    if (str(session.status) !== 'open' || session.setupRequired === true) return false;
    const live = pis.filter((x) => str(x.status) !== 'disregarded');
    if (!live.length || !live.every((x) => ['reconciled', 'closed_posted', 'recounted', 'recount_pending'].includes(str(x.status)))) return false;
    const p = sessionProgress(session, pis, now);
    const ended = !!str(session.endAt) && Date.parse(now) > Date.parse(str(session.endAt));
    return p.piDocuments.originals >= p.piDocuments.planned || session.locationsExhausted === true || ended;
}

export async function autoCloseSession(orgId: string, campaignId: string, by: string): Promise<boolean> {
    if (!CAMPAIGN_RE.test(campaignId)) return false;
    const root = `organizations/${orgId}`;
    const doc = await getDoc(`${root}/${CAMPAIGNS}/${campaignId}`);
    if (!doc || str(doc.data.status) !== 'open' || doc.data.setupRequired === true) return false;
    const pis = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.campaignId) === campaignId);
    const now = nowIso();
    if (!sessionComplete(doc.data, pis.map((x) => x.data), now)) return false;
    const progress = sessionProgress(doc.data, pis.map((x) => x.data), now);
    await writeDoc(`${root}/${CAMPAIGNS}/${campaignId}`, { ...doc.data, status: 'closed', closedAt: now, closedBy: by, closureReason: 'Closed automatically: 100% of the PI documents are posted.', finalProgress: progress, updatedAt: now, updatedBy: by } as never);
    await audit([{ category: 'inventory', action: 'inventory.stocktake.count_session.auto_close', orgId, target: { type: 'stock_take_session', id: campaignId, label: `Stock take session ${campaignId}` }, details: `PI documents ${progress.piDocuments.total}; stock accuracy ${progress.stockAccuracy.pct}%; count accuracy ${progress.countAccuracy.pct}%` }]);
    return true;
}

/**
 * Sessions whose posting is complete are closed as soon as anyone opens Stock take (not only after a posting or at the
 * nightly run). Decided from the data already loaded; only sessions that are complete are written.
 */
async function closeCompleted(ctx: OrgContext, campaigns: Doc[], pis: Doc[], now: string): Promise<Doc[]> {
    const out: Doc[] = [];
    for (const c of campaigns) {
        if (str(c.data.status) === 'open' && sessionComplete(c.data, pis.filter((x) => str(x.data.campaignId) === c.id).map((x) => x.data), now) && (await autoCloseSession(ctx.orgId, c.id, 'automation'))) {
            out.push((await getDoc(`${rootOf(ctx)}/${CAMPAIGNS}/${c.id}`)) ?? c);
        } else out.push(c);
    }
    return out;
}

async function getSession(ctx: OrgContext, id: string, mode: 'read' | 'write') {
    if (!SESSION_RE.test(id)) throw new HttpError(400, 'Invalid PI document');
    const root = rootOf(ctx);
    const [warehouses, doc] = await Promise.all([warehousesFor(ctx, mode), getDoc(`${root}/stock_take_sessions/${id}`)]);
    if (!doc || !warehouses.some((w) => w.id === str(doc.data.warehouseId))) throw new HttpError(404, 'Stock take session not found');
    return { root, doc };
}

/**
 * Where the signed-in person has a separation-of-duties conflict on this PI (they counted it, corrected the counts or
 * requested posting). The server still enforces every rule on the action itself; this only lets the screen say so
 * before the person taps. testMode is true only for an organization super administrator while the platform test mode
 * applies to the organization (development only): the conflict is then allowed and recorded in the audit trail.
 */
function independenceFor(ctx: OrgContext, data: Record<string, unknown>) {
    const counted = countersOf(data).includes(ctx.uid);
    const requestedPosting = str(data.postingRequestedBy) === ctx.uid;
    return {
        testMode: ctx.testMode === true,
        counted,
        requestedPosting,
        verifyConflict: counted || str(data.countEditedBy) === ctx.uid,
        approveConflict: counted || requestedPosting,
        postConflict: counted,
        coa: coaCheck(ctx, data),
    };
}

/**
 * Session as listed. Counting is blind: system quantities are withheld until counts are submitted. The signed PI
 * scan itself is fetched separately (stocktake/attachment).
 */
function publicSession(x: Doc, ctx: OrgContext) {
    const a = isObj(x.data.piAttachment) ? x.data.piAttachment : null;
    const blind = ['awaiting_print', 'counting'].includes(str(x.data.status));
    const lines = Array.isArray(x.data.lines) ? x.data.lines.filter(isObj).map((l) => (blind ? { ...l, expected: null } : l)) : [];
    return {
        id: x.id,
        ...x.data,
        lines,
        piAttachment: a ? { name: str(a.name), type: str(a.type), uploadedBy: str(a.uploadedBy), uploadedAt: str(a.uploadedAt) } : undefined,
        you: independenceFor(ctx, x.data),
    };
}

const CRITICALITY = ['A', 'B', 'C', 'D'];
const MAX_COPIES = 5;
const COPY_LETTERS = ['A', 'B', 'C', 'D', 'E'];
/** Copy labels of a PI document: none when one sheet is printed, otherwise A, B, … */
const copiesOf = (d: Obj) => {
    const n = Math.min(MAX_COPIES, Math.max(1, Number(d.copies) || 1));
    return n > 1 ? COPY_LETTERS.slice(0, n) : [];
};
/** Everyone who counted a PI document (all its copies). */
const countersOf = (d: Obj) => [...new Set([str(d.countedBy), ...(Array.isArray(d.countedByAll) ? (d.countedByAll as unknown[]).map(str) : [])].filter(Boolean))];
const NAIROBI_MS = 3 * 3_600_000;
/** Today's date in Nairobi (the platform's business day), YYYY-MM-DD. */
const nairobiDay = (ms = Date.now()) => new Date(ms + NAIROBI_MS).toISOString().slice(0, 10);
/** Midnight at the start of a Nairobi business day, as an ISO instant. */
const nairobiMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00.000Z`) - NAIROBI_MS).toISOString();
/** The day one period after a day (months are calendar months, kept to the month's last day when shorter). */
export function addPeriod(day: string, period: string): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    if (period === 'Daily') d.setUTCDate(d.getUTCDate() + 1);
    else if (period === 'Weekly') d.setUTCDate(d.getUTCDate() + 7);
    else {
        const months = period === 'Monthly' ? 1 : period === 'Quarterly' ? 3 : 12;
        const target = d.getUTCMonth() + months;
        const day0 = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(target);
        const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(day0, last));
    }
    return d.toISOString().slice(0, 10);
}

/**
 * The day the calendar period containing a day ends (the next period starts that midnight): tomorrow, next Monday, the
 * 1st of next month, the next quarter (January, April, July, October) or 1 January. A cycle count runs until this
 * boundary and the next cycle begins there.
 */
export function periodEnd(day: string, period: string): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    let end: Date;
    if (period === 'Daily') end = new Date(Date.UTC(y, m, d.getUTCDate() + 1));
    else if (period === 'Weekly') end = new Date(Date.UTC(y, m, d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7)));
    else if (period === 'Monthly') end = new Date(Date.UTC(y, m + 1, 1));
    else if (period === 'Quarterly') end = new Date(Date.UTC(y, m - (m % 3) + 3, 1));
    else end = new Date(Date.UTC(y + 1, 0, 1));
    return end.toISOString().slice(0, 10);
}
const isCycle = (c: Obj) => str(c.type) === 'Cycle Count';
/** The first day of the calendar period containing a day (the day the cycle began). */
export function periodStart(day: string, period: string): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    let start: Date;
    if (period === 'Daily') start = d;
    else if (period === 'Weekly') start = new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    else if (period === 'Monthly') start = new Date(Date.UTC(y, m, 1));
    else if (period === 'Quarterly') start = new Date(Date.UTC(y, m - (m % 3), 1));
    else start = new Date(Date.UTC(y, 0, 1));
    return start.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
/**
 * PI documents a session should have by today when they are released day by day: an even share per day of its run,
 * rounded up, never more than planned.
 */
export function dueByToday(planned: number, startIso: string, endIso: string, nowIso: string): number {
    const day = 86_400_000;
    const days = Math.max(1, Math.ceil((Date.parse(endIso) - Date.parse(startIso)) / day));
    const index = Math.min(days - 1, Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(startIso)) / day)));
    return Math.min(planned, Math.ceil((planned * (index + 1)) / days));
}
const cyclePath = (orgId: string, configId: string, cycleStart: string) => `organizations/${orgId}/stock_take_cycles/${configId}_${cycleStart}`;

/**
 * Today's share of a cycle run as daily sessions: what is left of the cycle's materials (not yet on any PI document of
 * the cycle) spread evenly over the days left, rounded up; the cycle's materials per PI and sheets per PI are kept.
 */
async function cycleDayShare(orgId: string, cycleId: string, plan: Obj, today: string, cycleEnd: string) {
    const root = `organizations/${orgId}`;
    const sessions = new Set((await listDocs(`${root}/${CAMPAIGNS}`)).filter((x) => str(x.data.cycleId) === cycleId && str(x.data.status) !== 'cancelled').map((x) => x.id));
    const onPis = (await listDocs(`${root}/stock_take_sessions`))
        .filter((x) => sessions.has(str(x.data.campaignId)) && !str(x.data.parentPi) && str(x.data.status) !== 'disregarded')
        .reduce((n, x) => n + (Array.isArray(x.data.lines) ? x.data.lines.length : 0), 0);
    const total = Number(plan.targetMaterials) || 0;
    const daysLeft = Math.max(1, daysBetween(today, cycleEnd));
    const materials = Math.max(0, Math.ceil((total - onPis) / daysLeft));
    return { materials, metrics: { countAll: false, targetMaterials: materials, materialsPerPi: Number(plan.materialsPerPi) || 1, piCopies: Number(plan.piCopies) || 1 } };
}
/** Clusters of a configuration (several may be chosen; older configurations hold one). */
const clustersOfConfig = (c: Obj) => (Array.isArray(c.clusterIds) ? (c.clusterIds as unknown[]).map(str) : str(c.clusterId) ? [str(c.clusterId)] : []).filter((x) => CLUSTER_RE.test(x));

function readConfig(b: Record<string, unknown>) {
    const name = str(b.name).trim();
    const type = str(b.type);
    const selection = str(b.selection);
    const period = str(b.period);
    const duration = Number(b.durationDays);
    const clusterIds = Array.isArray(b.clusterIds) ? [...new Set((b.clusterIds as unknown[]).map((x) => str(x).trim().toUpperCase()))].sort() : [];
    const cycle = type === 'Cycle Count';
    // A cycle count is always periodic: each cycle runs for one period and the next begins at the period's end.
    if (cycle) b = { ...b, periodic: true };
    if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Enter a configuration name of 3 to 80 characters');
    if (!TYPES.includes(type) || !['Sequence', 'Random'].includes(selection)) throw new HttpError(400, 'Invalid stock take type or selection order');
    if (b.periodic === true && !PERIODS.includes(period)) throw new HttpError(400, 'Select a valid period');
    // Other types: every session runs for the configuration's duration (end = start + days). A cycle count's session
    // runs to the end of its period instead.
    if (!cycle && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) throw new HttpError(400, 'Duration must be 1–3650 days');
    if (cycle && typeof b.fullScope !== 'boolean') throw new HttpError(400, 'Say whether the full scope of materials must be counted within each session');
    if (type === 'Cluster Stock Take') {
        if (!str(b.warehouseId)) throw new HttpError(400, 'Choose the warehouse first; its clusters are then listed');
        if (!clusterIds.length || clusterIds.some((x) => !CLUSTER_RE.test(x))) throw new HttpError(400, 'Choose at least one cluster of the warehouse');
        if (clusterIds.length > 200) throw new HttpError(400, 'Choose at most 200 clusters');
    }
    const byCriticality = b.byCriticality === true;
    const classes = Array.isArray(b.criticalityClasses) ? [...new Set((b.criticalityClasses as unknown[]).map(str))].filter((c) => CRITICALITY.includes(c)).sort() : [];
    if (byCriticality && !classes.length) throw new HttpError(400, 'Choose at least one criticality class (A, B, C or D)');
    const automatic = b.periodic === true && str(b.sessionCreation) === 'automatic';
    if (b.periodic === true && !['automatic', 'manual'].includes(str(b.sessionCreation))) throw new HttpError(400, 'Choose whether sessions are created automatically or manually');
    if (automatic && !str(b.warehouseId)) throw new HttpError(400, 'Choose the warehouse automatic sessions are created for');
    if (!['automatic', 'manual'].includes(str(b.piCreation))) throw new HttpError(400, 'Choose whether PI documents are created automatically or manually');
    // Cycle counts: one session for the whole cycle, or a session for each day of the cycle (created by the automation).
    const cycleSessions = cycle ? str(b.cycleSessions) : '';
    if (cycle && !['single', 'daily'].includes(cycleSessions)) throw new HttpError(400, 'Choose one session for the whole cycle or a session each day');
    if (cycle && cycleSessions === 'daily' && !automatic) throw new HttpError(400, 'Daily sessions are created by the automation: choose that sessions are created automatically');
    // One session for the cycle with automatic PI documents: all PI documents at once, or each day's share each day.
    const cyclePiRelease = cycle && cycleSessions === 'single' && str(b.piCreation) === 'automatic' ? str(b.cyclePiRelease) : '';
    if (cycle && cycleSessions === 'single' && str(b.piCreation) === 'automatic' && !['all', 'daily'].includes(cyclePiRelease)) throw new HttpError(400, 'Choose whether the PI documents are created all at once or each day');
    return {
        name,
        type,
        selection,
        periodic: b.periodic === true,
        period: b.periodic === true ? period : '',
        sessionCreation: b.periodic === true ? str(b.sessionCreation) : 'manual',
        piCreation: str(b.piCreation),
        cycleSessions,
        cyclePiRelease,
        durationDays: cycle ? null : duration,
        fullScope: cycle ? b.fullScope === true : false,
        byCriticality,
        criticalityClasses: byCriticality ? classes : [],
        clusterIds: type === 'Cluster Stock Take' ? clusterIds : [],
        clusterId: '',
        warehouseId: str(b.warehouseId),
    };
}

/** Cryptographically random sample, so nobody can predict which locations will be counted. */
function randomSample<T>(items: T[], size: number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, size);
}

export const stockTakeRoutes = {
    'POST /api/org/inventory/stocktake/list': [
        orgRoute('org.inventory.stocktake.list', null, async (ctx) => {
            canView(ctx);
            const root = rootOf(ctx);
            const warehouses = await warehousesFor(ctx, 'read');
            const visible = new Set(warehouses.map((w) => w.id));
            const [configs, sessions, campaigns] = await Promise.all([listDocs(`${root}/stock_take_configs`), listDocs(`${root}/stock_take_sessions`), listDocs(`${root}/${CAMPAIGNS}`)]);
            const now = nowIso();
            return {
                countSessions: (await closeCompleted(ctx, campaigns, sessions, now))
                    .filter((c) => visible.has(str(c.data.warehouseId)))
                    .map((c) => {
                        const pis = sessions.filter((x) => str(x.data.campaignId) === c.id).map((x) => x.data);
                        const progress = sessionProgress(c.data, pis, now);
                        const whyNoPi = campaignClosedReason(c.data, now) || (progress.piDocuments.originals >= progress.piDocuments.planned ? `All ${progress.piDocuments.planned} planned PI documents are created.` : '');
                        return { id: c.id, ...c.data, metrics: metricsOf(c.data), progress, canCreatePi: !whyNoPi, whyNoPi };
                    })
                    .sort((a, b) => str((b as Obj).createdAt).localeCompare(str((a as Obj).createdAt))),
                warehouses: warehouses.map((w) => ({ id: w.id, name: str(w.data.name) || str(w.data.costCenterCode) || str(w.data.code) || w.id })),
                configs: configs.filter((x) => !str(x.data.warehouseId) || visible.has(str(x.data.warehouseId))).map((x) => ({ id: x.id, ...x.data })),
                sessions: sessions
                    .filter((x) => visible.has(str(x.data.warehouseId)))
                    .map((x) => publicSession(x, ctx))
                    .sort((a, b) => str((b as Record<string, unknown>).createdAt).localeCompare(str((a as Record<string, unknown>).createdAt))),
            };
        }),
    ],

    'POST /api/org/inventory/stocktake/statistics': [
        orgRoute('org.inventory.stocktake.statistics', null, async (ctx) => {
            canView(ctx);
            const root = rootOf(ctx);
            const now = nowIso();
            const today = now.slice(0, 10);
            const DAY = /^\d{4}-\d{2}-\d{2}$/;
            // Year to date runs from the start of the current financial year (Finance > calendar); 1 January if none.
            const years = await listDocs(`${root}/fin_years`);
            const current = years.map((y) => ({ start: str(y.data.start).slice(0, 10), end: str(y.data.end).slice(0, 10) })).filter((y) => DAY.test(y.start) && y.start <= today && (!y.end || y.end >= today));
            const yearStart = current.length ? current.map((y) => y.start).sort()[0] : `${today.slice(0, 4)}-01-01`;
            const from = str(ctx.body.from) || yearStart;
            const to = str(ctx.body.to) || today;
            if (!DAY.test(from) || !DAY.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) throw new HttpError(400, 'Enter valid from and to dates');
            if (from > to) throw new HttpError(400, 'The from date must be on or before the to date');
            if (Date.parse(to) - Date.parse(from) > 5 * 366 * 86_400_000) throw new HttpError(400, 'Choose a period of at most five years');
            const warehouses = await warehousesFor(ctx, 'read');
            const visible = new Set(warehouses.map((w) => w.id));
            const [campaigns, pis] = await Promise.all([listDocs(`${root}/${CAMPAIGNS}`), listDocs(`${root}/stock_take_sessions`)]);
            const items = campaigns
                .filter((c) => visible.has(str(c.data.warehouseId)))
                .map((c) => ({ id: c.id, session: c.data, pis: pis.filter((x) => str(x.data.campaignId) === c.id).map((x) => x.data) }));
            const stats = overallStatistics(items, from, to, now);
            await audited(ctx, 'inventory.stocktake.statistics.view', 'Stock take statistics', { from, to, sessions: stats.totals.sessions });
            return { ...stats, yearStart, yearStartSource: current.length ? 'finance' : 'calendar' };
        }),
    ],

    'POST /api/org/inventory/stocktake/clusters': [
        orgRoute('org.inventory.stocktake.clusters', null, async (ctx) => {
            // Clusters configured in a warehouse, for choosing them in a Cluster Stock Take configuration.
            canView(ctx);
            const warehouseId = str(ctx.body.warehouseId);
            if (!warehouseId || !(await warehousesFor(ctx, 'read')).some((w) => w.id === warehouseId)) throw new HttpError(403, 'Select an accessible warehouse');
            const docs = await listDocs(`${rootOf(ctx)}/warehouses/${warehouseId}/clusters`);
            return {
                clusters: docs
                    .filter((d) => CLUSTER_RE.test(d.id))
                    .map((d) => ({ code: d.id, name: str(d.data.name), locationCode: str(d.data.locationCode), locations: Number(d.data.count) || 0 }))
                    .sort((a, b) => a.code.localeCompare(b.code)),
            };
        }),
    ],

    'POST /api/org/inventory/stocktake/material-count': [
        orgRoute('org.inventory.stocktake.material_count', null, async (ctx) => {
            // How many materials "All" means: the mapped locations of the warehouse this configuration would count.
            canView(ctx);
            const root = rootOf(ctx);
            const warehouseId = str(ctx.body.warehouseId);
            if (!warehouseId || !(await warehousesFor(ctx, 'read')).some((w) => w.id === warehouseId)) throw new HttpError(403, 'Select an accessible warehouse');
            const configId = str(ctx.body.configId);
            const config = CONFIG_RE.test(configId) ? await getDoc(`${root}/stock_take_configs/${configId}`) : null;
            if (!config) throw new HttpError(404, 'Configuration not found');
            return { count: (await selectableLocations(root, warehouseId, config.data)).length };
        }),
    ],

    'POST /api/org/inventory/stocktake/count-session/create': [
        orgRoute('org.inventory.stocktake.count_session.create', null, async (ctx) => {
            const root = rootOf(ctx);
            const b = ctx.body;
            const warehouseId = str(b.warehouseId);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!warehouseId || !warehouses.some((w) => w.id === warehouseId)) throw new HttpError(403, 'Select an accessible warehouse for this session');
            await requireAtWarehouse(ctx, 'INV_ST_030', warehouseId);
            const configId = str(b.configId);
            const config = CONFIG_RE.test(configId) ? await getDoc(`${root}/stock_take_configs/${configId}`) : null;
            if (!config || config.data.active === false) throw new HttpError(400, 'Choose an enabled configuration');
            if (str(config.data.warehouseId) && warehouseId !== str(config.data.warehouseId)) throw new HttpError(400, 'Selected warehouse does not match configuration');
            const now = nowIso();
            if (isCycle(config.data) && str(config.data.cycleSessions) === 'daily') throw new HttpError(409, 'Sessions of this configuration are created each day by the automation.');
            // A cycle count with full scope counts every material in each session: "All" is forced.
            if (config.data.fullScope === true) b.metrics = { ...(isObj(b.metrics) ? b.metrics : {}), countAll: true };
            const wantsAll = isObj(b.metrics) && b.metrics.countAll === true;
            const plan = readCampaign(b, now, config.data, wantsAll ? (await selectableLocations(root, warehouseId, config.data)).length : null);
            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'stockTakeSessionSeq');
                if (n > 99_999_999) throw new HttpError(409, 'Stock take session sequence exhausted');
                const id = `CNT_SES_${String(n).padStart(8, '0')}`;
                const ok = await writeDoc(
                    `${root}/${CAMPAIGNS}/${id}`,
                    {
                        sessionNumber: id,
                        ...plan,
                        configId,
                        configName: str(config.data.name),
                        type: str(config.data.type),
                        selection: str(config.data.selection),
                        documentSize: plan.metrics.materialsPerPi,
                        plannedPiDocuments: plannedPis(plan.metrics.targetMaterials, plan.metrics.materialsPerPi),
                        durationDays: isCycle(config.data) ? null : Number(config.data.durationDays),
                        fullScope: config.data.fullScope === true,
                        criticalityClasses: config.data.byCriticality === true && Array.isArray(config.data.criticalityClasses) ? config.data.criticalityClasses : [],
                        ...(isCycle(config.data)
                            ? (() => {
                                  const day = nairobiDay(Date.parse(plan.startAt));
                                  const cs = periodStart(day, str(config.data.period));
                                  const ce = periodEnd(day, str(config.data.period));
                                  return { cycleId: `${configId}_${cs}`, cycleStart: cs, cycleEnd: ce, cycleDays: daysBetween(cs, ce), cycleDay: daysBetween(cs, day) + 1, cycleSessions: 'single' };
                              })()
                            : {}),
                        origin: 'manual',
                        setupRequired: false,
                        warehouseId,
                        status: 'open',
                        createdAt: now,
                        createdBy: ctx.uid,
                    } as never,
                    { exists: false }
                );
                if (ok) {
                    await audited(ctx, 'inventory.stocktake.count_session.create', `Stock take session ${id}`, { warehouseId, configId, ...plan });
                    return { ok: true, id, ...(await autoGenerate(ctx.orgId, id, config.data, ctx.uid)) };
                }
            }
            throw new HttpError(409, 'Unable to reserve a session number. Retry.');
        }),
    ],

    'POST /api/org/inventory/stocktake/count-session/setup': [
        orgRoute('org.inventory.stocktake.count_session.setup', null, async (ctx) => {
            // Sessions created by the automation carry only the configuration and dates. Their remaining data (name,
            // materials to count, materials per PI, targets) is completed once, here, before any PI document is created.
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CAMPAIGN_RE.test(id)) throw new HttpError(400, 'Invalid stock take session');
            const doc = await getDoc(`${root}/${CAMPAIGNS}/${id}`);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!doc || !warehouses.some((w) => w.id === str(doc.data.warehouseId))) throw new HttpError(404, 'Stock take session not found');
            await requireAtWarehouse(ctx, 'INV_ST_030', str(doc.data.warehouseId));
            if (str(doc.data.status) !== 'open') throw new HttpError(409, 'This session is not open');
            if (doc.data.setupRequired !== true) throw new HttpError(409, 'This session is already set up; its plan cannot be changed.');
            const name = str(ctx.body.name).trim();
            if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Enter a session name of 3 to 80 characters');
            const config = await getDoc(`${root}/stock_take_configs/${str(doc.data.configId)}`);
            const m = { ...(isObj(ctx.body.metrics) ? ctx.body.metrics : {}), ...(config?.data.fullScope === true ? { countAll: true } : {}) };
            let metrics = readMetrics(m, m.countAll === true ? (await selectableLocations(root, str(doc.data.warehouseId), { ...(config?.data ?? {}), criticalityClasses: doc.data.criticalityClasses, byCriticality: Array.isArray(doc.data.criticalityClasses) && doc.data.criticalityClasses.length > 0 })).length : null);
            const now = nowIso();
            // A cycle run as daily sessions: what is entered is the plan of the whole cycle. It is kept for the cycle (the
            // first setup wins) and this day's session takes its share; later days are set up from it automatically.
            if (str(doc.data.cycleSessions) === 'daily' && str(doc.data.cycleId)) {
                const path = cyclePath(ctx.orgId, str(doc.data.configId), str(doc.data.cycleStart));
                await writeDoc(path, { ...metrics, configId: str(doc.data.configId), cycleId: str(doc.data.cycleId), cycleStart: str(doc.data.cycleStart), cycleEnd: str(doc.data.cycleEnd), days: Number(doc.data.cycleDays) || 1, setBy: ctx.uid, setAt: now }, { exists: false });
                const plan = (await getDoc(path))?.data ?? metrics;
                metrics = (await cycleDayShare(ctx.orgId, str(doc.data.cycleId), plan, nairobiDay(), str(doc.data.cycleEnd))).metrics as typeof metrics;
                if (!metrics.targetMaterials) throw new HttpError(409, 'Every material of this cycle is already on a PI document; nothing is left for this day.');
            }
            const ok = await writeDoc(
                `${root}/${CAMPAIGNS}/${id}`,
                { ...doc.data, name, metrics, documentSize: metrics.materialsPerPi, plannedPiDocuments: plannedPis(metrics.targetMaterials, metrics.materialsPerPi), setupRequired: false, setupBy: ctx.uid, setupAt: now, updatedAt: now, updatedBy: ctx.uid } as never,
                doc.updateTime ? { updateTime: doc.updateTime } : { exists: true }
            );
            if (ok === false) throw new HttpError(409, 'Someone else changed this session; reopen it and try again.');
            await audited(ctx, 'inventory.stocktake.count_session.setup', `Stock take session ${id}`, { name, ...metrics });
            return { ok: true, ...(await autoGenerate(ctx.orgId, id, config?.data, ctx.uid)) };
        }),
    ],

    'POST /api/org/inventory/stocktake/count-session/generate': [
        orgRoute('org.inventory.stocktake.count_session.generate', null, async (ctx) => {
            // Create all remaining planned PI documents of a session at once (automatic configurations, or a retry).
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CAMPAIGN_RE.test(id)) throw new HttpError(400, 'Invalid stock take session');
            const doc = await getDoc(`${root}/${CAMPAIGNS}/${id}`);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!doc || !warehouses.some((w) => w.id === str(doc.data.warehouseId))) throw new HttpError(404, 'Stock take session not found');
            await requireAtWarehouse(ctx, 'INV_ST_008', str(doc.data.warehouseId));
            if (str(doc.data.endAt) && Date.parse(nowIso()) > Date.parse(str(doc.data.endAt))) throw new HttpError(409, 'This session has passed its end date.');
            let r: { created: string[] };
            try {
                const config = await getDoc(`${root}/stock_take_configs/${str(doc.data.configId)}`);
                const limit = await releaseLimit(ctx.orgId, id, config?.data);
                if (limit <= 0) throw new HttpError(409, 'Today’s PI documents are already created; the next share is released tomorrow.');
                r = await generateSessionPis(ctx.orgId, id, ctx.uid, limit);
            } catch (e) {
                await recordGeneration(ctx.orgId, id, e instanceof Error ? e.message : 'PI documents could not be generated');
                throw e;
            }
            await recordGeneration(ctx.orgId, id, '');
            await audited(ctx, 'inventory.stocktake.count_session.generate', `Stock take session ${id}`, { created: r.created.length });
            return { ok: true, created: r.created };
        }),
    ],

    'POST /api/org/inventory/stocktake/count-session/action': [
        orgRoute('org.inventory.stocktake.count_session.action', null, async (ctx) => {
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            const action = str(ctx.body.action);
            if (!CAMPAIGN_RE.test(id)) throw new HttpError(400, 'Invalid stock take session');
            // A session is never closed by hand: it closes itself when posting is 100% done. Only cancelling is offered.
            if (action !== 'cancel') throw new HttpError(400, 'A session closes automatically once all its PI documents are posted; it can only be cancelled.');
            const doc = await getDoc(`${root}/${CAMPAIGNS}/${id}`);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!doc || !warehouses.some((w) => w.id === str(doc.data.warehouseId))) throw new HttpError(404, 'Stock take session not found');
            await requireAtWarehouse(ctx, 'INV_ST_031', str(doc.data.warehouseId));
            if (str(doc.data.status) !== 'open') throw new HttpError(409, 'This session is already closed');
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10) throw new HttpError(400, 'Enter a reason of at least 10 characters');
            const pis = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.campaignId) === id);
            const open = pis.filter((x) => !CLOSED.includes(str(x.data.status)));
            if (open.length) throw new HttpError(409, `Finish or disregard the open PI documents first (${open.map((x) => x.id).slice(0, 5).join(', ')}${open.length > 5 ? ', …' : ''}).`);
            if (action === 'cancel' && pis.some((x) => (Array.isArray(x.data.lines) ? x.data.lines : []).some((l: unknown) => isObj(l) && l.posted === true)))
                throw new HttpError(409, 'Stock has been posted in this session, so it cannot be cancelled; it closes automatically once all its PI documents are posted.');
            const now = nowIso();
            const progress = sessionProgress(doc.data, pis.map((x) => x.data), now);
            const status = 'cancelled';
            await writeDoc(`${root}/${CAMPAIGNS}/${id}`, { ...doc.data, status, closedAt: now, closedBy: ctx.uid, closureReason: reason.slice(0, 500), finalProgress: progress, updatedAt: now, updatedBy: ctx.uid } as never);
            await audited(ctx, `inventory.stocktake.count_session.${action}`, `Stock take session ${id}`, { reason: reason.slice(0, 500), piDocuments: pis.length, completionPct: progress.completionPct });
            return { ok: true };
        }),
    ],

    'POST /api/org/inventory/stocktake/config': [
        orgRoute('org.inventory.stocktake.config', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_002');
            const root = rootOf(ctx);
            const config = readConfig(ctx.body);
            await checkConfigWarehouse(ctx, config.warehouseId, config.clusterIds);
            // Automatic sessions: the first is created at the next midnight run; the automation keeps the schedule.
            const schedule = config.sessionCreation === 'automatic' ? { nextSessionDueOn: firstDue(config), lastSessionCreatedAt: '', lastSessionId: '' } : { nextSessionDueOn: '' };
            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'stockCountConfigSeq');
                if (n > 99_999_999) throw new HttpError(409, 'Stock count configuration sequence exhausted');
                const id = `COUNT_CONFIG${String(n).padStart(8, '0')}`;
                const ok = await writeDoc(`${root}/stock_take_configs/${id}`, { ...config, ...schedule, createdBy: ctx.uid, createdAt: nowIso(), active: true }, { exists: false });
                if (ok) {
                    await audited(ctx, 'inventory.stocktake.config.create', `Stock take configuration ${id}`, config);
                    return { ok: true, id };
                }
            }
            throw new HttpError(409, 'Unable to reserve configuration ID. Retry.');
        }),
    ],

    'POST /api/org/inventory/stocktake/config/edit': [
        orgRoute('org.inventory.stocktake.config.edit', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_003');
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CONFIG_RE.test(id)) throw new HttpError(400, 'Invalid configuration');
            const existing = await getDoc(`${root}/stock_take_configs/${id}`);
            if (!existing) throw new HttpError(404, 'Configuration not found');
            const config = readConfig(ctx.body);
            await checkConfigWarehouse(ctx, config.warehouseId, config.clusterIds);
            const wasAuto = str(existing.data.sessionCreation) === 'automatic';
            const isAuto = config.sessionCreation === 'automatic';
            const schedule = !isAuto ? { nextSessionDueOn: '' } : !wasAuto || !str(existing.data.nextSessionDueOn) || str(existing.data.period) !== config.period || str(existing.data.type) !== config.type ? { nextSessionDueOn: firstDue(config) } : {};
            const patch = { ...existing.data, ...config, ...schedule, documentSize: null, updatedBy: ctx.uid, updatedAt: nowIso() };
            await writeDoc(`${root}/stock_take_configs/${id}`, patch);
            const changed = Object.keys(config).filter((k) => JSON.stringify(existing.data[k] ?? null) !== JSON.stringify((config as Record<string, unknown>)[k] ?? null));
            await audited(ctx, 'inventory.stocktake.config.edit', `Stock take configuration ${id}`, {
                changed: Object.fromEntries(changed.map((k) => [k, { from: existing.data[k] ?? null, to: (config as Record<string, unknown>)[k] ?? null }])),
            });
            return { ok: true, id };
        }),
    ],

    'POST /api/org/inventory/stocktake/config/delete': [
        orgRoute('org.inventory.stocktake.config.delete', null, async (ctx) => {
            requireAnywhere(ctx, 'INV_ST_005');
            const root = rootOf(ctx);
            const id = str(ctx.body.id);
            if (!CONFIG_RE.test(id)) throw new HttpError(400, 'Invalid configuration');
            const existing = await getDoc(`${root}/stock_take_configs/${id}`);
            if (!existing) throw new HttpError(404, 'Configuration not found');
            const sessions = await listDocs(`${root}/stock_take_sessions`);
            if (sessions.some((x) => str(x.data.configId) === id)) throw new HttpError(409, 'Configuration has stock take sessions and cannot be deleted. Disable it instead.');
            await deleteDoc(`${root}/stock_take_configs/${id}`);
            await audited(ctx, 'inventory.stocktake.config.delete', `Stock take configuration ${id}`, existing.data);
            return { ok: true, id };
        }),
    ],

    'POST /api/org/inventory/stocktake/start': [
        orgRoute('org.inventory.stocktake.start', null, async (ctx) => {
            const root = rootOf(ctx);
            const b = ctx.body;
            // A PI document is always created inside an open stock take session, which fixes its configuration and warehouse.
            const campaignId = str(b.sessionId);
            if (!CAMPAIGN_RE.test(campaignId)) throw new HttpError(400, 'Open a stock take session first; PI documents are created inside a session.');
            const campaign = await getDoc(`${root}/${CAMPAIGNS}/${campaignId}`);
            const warehouseId = str(campaign?.data.warehouseId);
            const warehouses = await warehousesFor(ctx, 'write');
            if (!campaign || !warehouseId || !warehouses.some((w) => w.id === warehouseId)) throw new HttpError(404, 'Stock take session not found');
            await requireAtWarehouse(ctx, 'INV_ST_008', warehouseId);
            const closedWhy = campaignClosedReason(campaign.data, nowIso());
            if (closedWhy) throw new HttpError(409, closedWhy);
            const configId = str(campaign.data.configId);
            const config = CONFIG_RE.test(configId) ? await getDoc(`${root}/stock_take_configs/${configId}`) : null;
            if (!config || config.data.active === false) throw new HttpError(403, 'Configuration not accessible');
            if (str(config.data.warehouseId) && warehouseId !== str(config.data.warehouseId)) throw new HttpError(400, 'Selected warehouse does not match configuration');

            let eligible = await snapshot(root, warehouseId);
            if (str(config.data.type) === 'Cluster Stock Take') {
                const clusters = clustersOfConfig(config.data);
                if (!clusters.length) throw new HttpError(400, 'Cluster configuration required');
                eligible = eligible.filter((x) => clusters.some((c) => x.binId.startsWith(`${c}__`)));
            }
            if (!eligible.length) throw new HttpError(409, 'No mapped physical locations found for this selection');
            // The session plans the work: materials to count and materials per PI give the number of PI documents.
            // Locations already on this session's PI documents (not disregarded) are not picked again.
            const allPis = await listDocs(`${root}/stock_take_sessions`);
            const sessionPis = allPis.filter((x) => str(x.data.campaignId) === campaignId && !str(x.data.parentPi) && str(x.data.status) !== 'disregarded');
            const metrics = metricsOf(campaign.data);
            const planned = plannedPis(metrics.targetMaterials, metrics.materialsPerPi);
            if (sessionPis.length >= planned) throw new HttpError(409, `All ${planned} planned PI documents of this session are created.`);
            const taken = new Set(sessionPis.flatMap((x) => (Array.isArray(x.data.lines) ? x.data.lines : [])).filter(isObj).map((l) => `${str(l.materialId)}|${str(l.binId)}`));
            const onPis = taken.size;
            eligible = eligible.filter((x) => !taken.has(`${x.materialId}|${x.binId}`));
            // Criticality: a configuration may count only materials of chosen classes (A to D, set per material and warehouse).
            const classes = Array.isArray(config.data.criticalityClasses) && config.data.byCriticality === true ? (config.data.criticalityClasses as unknown[]).map(str) : [];
            if (classes.length) {
                eligible = eligible.filter((x) => classes.includes(str(x.info?.criticalityClass)));
                if (!eligible.length && !onPis) throw new HttpError(409, `No mapped material in this warehouse has criticality class ${classes.join(', ')}. Set the class under Material detail > Inventory Information.`);
            }
            if (!eligible.length) {
                // Nothing left to plan: the session can close itself once its PI documents are posted.
                await writeDoc(`${root}/${CAMPAIGNS}/${campaignId}`, { ...campaign.data, locationsExhausted: true, updatedAt: nowIso() } as never);
                await autoCloseSession(ctx.orgId, campaignId, ctx.uid);
                throw new HttpError(409, 'Every mapped location in this selection is already on a PI document of this session.');
            }
            const size = Math.max(1, Math.min(metrics.materialsPerPi, metrics.targetMaterials - onPis));
            if (str(config.data.selection) === 'Sequence') {
                // Without a starting location the PI continues from the first location not yet on this session's PIs.
                const start = str(b.startBin) || eligible[0].binId;
                const index = eligible.findIndex((x) => x.binId === start);
                if (index < 0) throw new HttpError(400, 'Starting physical location not found, or it is already on a PI document of this session');
                eligible = eligible.slice(index, index + size);
            } else {
                eligible = randomSample(eligible, size);
            }
            if (!eligible.length) throw new HttpError(409, 'No physical locations selected');
            // A count can only be posted against a reconciled stock baseline, so a PI is not started without one.
            const unbased = eligible.filter((x) => x.expected === null);
            if (unbased.length) {
                const names = [...new Set(unbased.map((x) => x.materialNumber || x.materialId))];
                throw new HttpError(409, `${names.length === 1 ? 'Material' : `${names.length} materials`} ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''} ${names.length === 1 ? 'has' : 'have'} no reconciled stock in this warehouse, so ${names.length === 1 ? 'its' : 'their'} count could not be posted. Post the opening stock (Material detail > Current Status) or reconcile the open stock movements first.`);
            }
            if (new Set(eligible.map((x) => x.materialId)).size !== eligible.length) {
                throw new HttpError(409, 'Multiple mapped locations for one material require location-level stock ledger; select a smaller PI document to avoid unsafe reconciliation.');
            }

            for (let attempt = 0; attempt < 3; attempt++) {
                const n = await nextOrgCounter(ctx.orgId, 'stockTakePiSeq');
                if (n > 99_999_999) throw new HttpError(409, 'PI document sequence exhausted');
                const id = `PI_${String(n).padStart(8, '0')}`;
                const now = nowIso();
                const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
                const part = (key: string) => parts.find((p) => p.type === key)?.value || '';
                const sessionName = `${str(config.data.name)} ${part('day')}${part('month').toUpperCase()}${part('year')}${part('hour')}${part('minute')}`;
                const ok = await writeDoc(
                    `${root}/stock_take_sessions/${id}`,
                    {
                        piNumber: id,
                        sessionName,
                        campaignId,
                        campaignName: str(campaign.data.name),
                        piSequenceInSession: sessionPis.length + 1,
                        configId,
                        configName: str(config.data.name),
                        warehouseId,
                        type: str(config.data.type),
                        status: 'awaiting_print',
                        createdAt: now,
                        createdBy: ctx.uid,
                        copies: Math.min(MAX_COPIES, Math.max(1, Number(isObj(campaign.data.metrics) ? campaign.data.metrics.piCopies : 1) || 1)),
                        printedAt: '',
                        parentPi: '',
                        recountNumber: 0,
                        lines: eligible.map((x) => ({ binId: x.binId, materialId: x.materialId, materialNumber: x.materialNumber, description: x.description, expected: x.expected, counted: null, verified: false, recount: false, posted: false })),
                        documentSize: eligible.length,
                    } as never,
                    { exists: false }
                );
                if (ok) {
                    await audited(ctx, 'inventory.stocktake.start', `PI ${id}`, { sessionId: campaignId, configId, warehouseId, locations: eligible.length, selection: str(config.data.selection) });
                    return { ok: true, id };
                }
            }
            throw new HttpError(409, 'Unable to reserve a PI sequence. Retry.');
        }),
    ],

    'POST /api/org/inventory/stocktake/attachment': [
        orgRoute('org.inventory.stocktake.attachment', null, async (ctx) => {
            canView(ctx);
            const id = str(ctx.body.id);
            const { root, doc } = await getSession(ctx, id, 'read');
            await requireAt(ctx, ['INV_ST_011', 'INV_ST_017', 'INV_ST_020', 'INV_ST_027', 'INV.view'], str(doc.data.warehouseId), 'read', 'You do not have permission to view PI documents for this warehouse.');
            const copy = str(ctx.body.copy);
            if (copy && !copiesOf(doc.data).includes(copy)) throw new HttpError(400, 'Unknown count sheet');
            const stored = await getDoc(`${root}/stock_take_attachments/${copy ? `${id}_${copy}` : id}`);
            const legacy = isObj(doc.data.piAttachment) ? doc.data.piAttachment : null;
            const source = stored?.data ?? legacy;
            if (!source || !str(source.data)) throw new HttpError(404, 'No signed PI document is attached');
            await audited(ctx, 'inventory.stocktake.attachment.view', `PI ${id}${copy ? `_${copy}` : ''}`, { name: str(source.name) });
            return { name: str(source.name), type: str(source.type), data: str(source.data) };
        }),
    ],

    'POST /api/org/inventory/stocktake/action': [
        orgRoute('org.inventory.stocktake.action', null, async (ctx) => {
            const id = str(ctx.body.id);
            const action = str(ctx.body.action);
            const perm = ACTION_PERMS[action];
            if (!perm) throw new HttpError(400, 'Unsupported Stock Take action');
            const { root, doc } = await getSession(ctx, id, 'write');
            const d = doc.data;
            const warehouseId = str(d.warehouseId);
            await requireAtWarehouse(ctx, perm, warehouseId);
            const status = str(d.status);
            const lines: Array<Record<string, any>> = Array.isArray(d.lines) ? d.lines.filter(isObj).map((x) => ({ ...x })) : [];
            const sessionPath = `${root}/stock_take_sessions/${id}`;
            const children = async () => (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.parentPi) === id);

            const save = async (patch: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
                await writeDoc(sessionPath, { ...d, ...patch, updatedAt: nowIso(), updatedBy: ctx.uid } as never);
                await audited(ctx, `inventory.stocktake.${action}`, `PI ${id}`, {
                    from: status,
                    to: str(patch.status) || status,
                    reason: str(patch.disregardReason || patch.closureReason || patch.countEditReason || patch.postingReturnReason),
                    linesChanged: Array.isArray(patch.lines) ? patch.lines.length : 0,
                    ...extra,
                });
                return { ok: true };
            };

            // Create the recount PI document for the lines flagged for recount (fresh system quantities, blind count).
            const makeRecount = async (flagged: Array<Record<string, any>>) => {
                const currentSnapshot = await snapshot(root, warehouseId);
                const parent = str(d.parentPi) || id;
                const siblings = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => x.id === parent || x.id.startsWith(`${parent}_`));
                const number = Math.max(0, ...siblings.map((x) => Number(new RegExp(`^${parent}_([0-9]+)$`).exec(x.id)?.[1] || 0))) + 1;
                const next = `${parent}_${number}`;
                const ok = await writeDoc(
                    `${root}/stock_take_sessions/${next}`,
                    {
                        piNumber: next,
                        campaignId: str(d.campaignId),
                        campaignName: str(d.campaignName),
                        configId: d.configId,
                        configName: d.configName,
                        warehouseId,
                        type: d.type,
                        status: 'awaiting_print',
                        createdAt: nowIso(),
                        createdBy: ctx.uid,
                        parentPi: parent,
                        recountNumber: number,
                        lines: flagged.map((x) => ({
                            ...x,
                            copyMismatch: false,
                            copyCounts: null,
                            expected: currentSnapshot.find((v) => v.materialId === str(x.materialId) && v.binId === str(x.binId))?.expected ?? null,
                            counted: null,
                            verified: false,
                            recount: false,
                            posted: false,
                        })),
                        documentSize: flagged.length,
                    } as never,
                    { exists: false }
                );
                if (!ok) throw new HttpError(409, 'Recount already created; refresh');
                return next;
            };

            // Value the differences and route them through the Chart of Authority; returns the patch that sends the PI
            // for posting approval (the caller saves it).
            const routeNow = async (pending: Array<Record<string, any>>) => {
                const unbased = pending.filter((x) => x.expected === null || x.counted === null);
                if (unbased.length) {
                    const names = [...new Set(unbased.map((x) => str(x.materialNumber) || str(x.materialId)))];
                    throw new HttpError(409, `${count(unbased.length, 'line')} (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}) ${unbased.length === 1 ? 'has' : 'have'} no reconciled stock baseline, so ${unbased.length === 1 ? 'it' : 'they'} cannot be posted. Post the opening stock or reconcile the open movements, then Recheck baseline and verify again — or disregard this PI.`);
                }
                // Value the differences and route them through the Chart of Authority.
                const variance = await varianceValueOf(ctx, warehouseId, pending);
                let approval: Record<string, unknown> | null = null;
                if (variance.differences > 0) {
                    const authority = await getAuthority(ctx.orgId);
                    const route = await approvalRoute(ctx.orgId, ctx.me, variance.value, authority, ctx.testMode === true);
                    if (route.problems.length && !bypass(ctx, 'inv.stocktake.coa_route')) throw new HttpError(409, `The Chart of Authority cannot route this variance: ${route.problems.join(' ')}`);
                    if (!route.steps.length) throw new HttpError(409, 'The Chart of Authority has no approval level for this variance value. Ask the chart of authority administrator to set the cost approval bands.');
                    approval = {
                        amount: variance.value,
                        authorityVersion: route.authorityVersion,
                        unvalued: variance.unvalued,
                        byMaterial: variance.byMaterial,
                        steps: route.steps.map((x) => ({ level: x.level, title: x.title, positionCode: x.positionCode, positionTitle: x.positionTitle, status: 'pending', by: '', at: '' })),
                    };
                }
                return {
                    patch: { status: 'pending_post_approval', postingRequestedBy: ctx.uid, postingRequestedAt: nowIso(), varianceValue: variance.value, approval, postingApprovedBy: '', postingApprovedAt: '', postingReturnReason: '' },
                    extra: { varianceValue: variance.value, unvalued: variance.unvalued, levels: approval ? (approval.steps as Array<{ level: string }>).map((x) => x.level) : ['independent'] },
                };
            };

            // Post the verified lines that are not being recounted (none when the whole PI is recounted), value the
            // differences in finance and close the PI: reconciled, partly posted (recount open) or recounted.
            const postNow = async (patch: Record<string, unknown>, auditExtra: Record<string, unknown>) => {
                const pending = lines.filter((x) => x.verified && !x.recount && !x.posted);
                // Value the differences in finance first (refused when finance is live and cannot post), then move the quantities.
                const freshStock = await snapshot(root, warehouseId);
                const finDeltas: Array<{ materialId: string; delta: number }> = [];
                for (const line of pending) {
                    if (line.expected === null || line.counted === null) continue;
                    const delta = Number(line.counted) - Number(line.expected);
                    if (!delta) continue;
                    const key = `PI_${id}_${str(line.materialId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${str(line.binId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                    if (await getDoc(`${root}/material_journal/${key}`)) continue;
                    const current = freshStock.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                    if (!current || current.expected !== line.expected) throw new HttpError(409, 'Stock has changed since counting; recount is required');
                    finDeltas.push({ materialId: str(line.materialId), delta });
                }
                const financeJournal = await postStockTake(ctx, warehouseId, id, finDeltas);
                let adjustments = 0;
                for (const line of pending) {
                    if (line.expected === null || line.counted === null) throw new HttpError(409, 'Cannot post without reconciled baseline and count');
                    const delta = Number(line.counted) - Number(line.expected);
                    const key = `PI_${id}_${str(line.materialId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${str(line.binId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                    if (delta !== 0) {
                        const existing = await getDoc(`${root}/material_journal/${key}`);
                        if (!existing) {
                            const latest = await snapshot(root, warehouseId);
                            const current = latest.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                            if (!current || current.expected !== line.expected) throw new HttpError(409, 'Stock has changed since counting; recount is required');
                            const created = await writeDoc(
                                `${root}/material_journal/${key}`,
                                {
                                    materialId: str(line.materialId),
                                    warehouseId,
                                    type: 'STOCK_TAKE_ADJUSTMENT',
                                    status: 'posted',
                                    reconciled: true,
                                    balancesDelta: { physicalStock: delta },
                                    reference: id,
                                    binId: str(line.binId),
                                    createdAt: nowIso(),
                                    postedAt: nowIso(),
                                    postedBy: ctx.uid,
                                    approvedBy: str(d.postingApprovedBy),
                                    source: 'stock_take',
                                    version: 1,
                                },
                                { exists: false }
                            );
                            if (!created) throw new HttpError(409, 'Concurrent stock take posting detected');
                            adjustments++;
                        }
                    }
                    line.posted = true;
                }
                const partial = lines.some((x) => x.recount && !x.posted);
                const result = await save({ ...patch, lines, status: !pending.length ? 'recounted' : partial ? 'recount_pending' : 'reconciled', postedAt: pending.length ? nowIso() : '', postedBy: pending.length ? ctx.uid : '', reconciledAt: partial || !pending.length ? '' : nowIso(), financeJournal }, { ...auditExtra, linesPosted: pending.length, adjustments, financeJournal });
                if (d.parentPi && !partial) {
                    const parentId = str(d.parentPi);
                    const parent = await getDoc(`${root}/stock_take_sessions/${parentId}`);
                    if (parent) {
                        const siblings = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.parentPi) === parentId);
                        if (siblings.length && siblings.every((x) => x.id === id || CLOSED.includes(str(x.data.status)))) {
                            const pLines = Array.isArray(parent.data.lines) ? parent.data.lines.filter(isObj) : [];
                            if (pLines.every((x) => x.posted || x.recount)) await writeDoc(`${root}/stock_take_sessions/${parentId}`, { ...parent.data, status: 'reconciled', reconciledAt: nowIso(), updatedAt: nowIso() });
                        }
                    }
                }
                // A session closes itself once every PI document in it is posted.
                await autoCloseSession(ctx.orgId, str(d.campaignId), ctx.uid);
                return result;
            };


            if (action === 'close_posted') {
                if (status !== 'posted' && !lines.some((x) => x.posted)) throw new HttpError(409, 'Only sessions with posted stock can use Close Posted Session');
                if (CLOSED.includes(status)) throw new HttpError(409, 'Session already closed');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Enter a closure reason of at least 10 characters');
                if ((await children()).some((x) => !CLOSED.includes(str(x.data.status)))) throw new HttpError(409, 'Close active recount PI documents first');
                const closedResult = await save({ status: 'closed_posted', closedAt: nowIso(), closedBy: ctx.uid, closureReason: reason.slice(0, 500), closureType: 'posted_session', reconciledAt: d.reconciledAt || '' });
                await autoCloseSession(ctx.orgId, str(d.campaignId), ctx.uid);
                return closedResult;
            }

            if (action === 'disregard') {
                if (['reconciled', 'disregarded', 'posted', 'recount_pending', 'closed_posted'].includes(status) || lines.some((x) => x.posted)) throw new HttpError(409, 'This PI has posted stock movements and cannot be disregarded');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Enter a reason of at least 10 characters');
                if ((await children()).some((x) => !CLOSED.includes(str(x.data.status)))) throw new HttpError(409, 'Close active recount PI documents first');
                const disregarded = await save({ status: 'disregarded', disregardedAt: nowIso(), disregardedBy: ctx.uid, disregardReason: reason.slice(0, 500) });
                await autoCloseSession(ctx.orgId, str(d.campaignId), ctx.uid);
                return disregarded;
            }

            if (action === 'printed') {
                if (status !== 'awaiting_print') throw new HttpError(409, 'PI is not awaiting printing');
                // PI documents may be generated in advance; counting starts only once the session has started.
                if (str(d.campaignId)) {
                    const camp = await getDoc(`${root}/${CAMPAIGNS}/${str(d.campaignId)}`);
                    if (camp && Date.parse(nowIso()) < Date.parse(str(camp.data.startAt))) throw new HttpError(409, 'This session has not started yet, so its PI documents cannot be issued for counting.');
                }
                return save({ status: 'counting', printedAt: nowIso(), printedBy: ctx.uid });
            }

            if (action === 'counts') {
                if (status !== 'counting') throw new HttpError(409, 'PI must be printed before counts are entered');
                const values = Array.isArray(ctx.body.counts) ? ctx.body.counts : [];
                if (values.length !== lines.length) throw new HttpError(400, 'Every line requires a count');
                const counts = values.map((v: unknown) => {
                    if (v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(400, 'Enter a non-negative count for every physical location');
                    return Number(v);
                });
                const attachment = ctx.body.attachment;
                const type = isObj(attachment) ? str(attachment.type) : '';
                const data = isObj(attachment) ? str(attachment.data) : '';
                if (
                    !isObj(attachment) ||
                    !['application/pdf', 'image/jpeg', 'image/png'].includes(type) ||
                    !data.startsWith(`data:${type};base64,`) ||
                    !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) ||
                    data.length > MAX_ATTACHMENT_CHARS
                ) {
                    throw new HttpError(400, 'Attach a signed PI PDF or image (maximum 450 KB)');
                }
                const meta = { name: str(attachment.name).slice(0, 120), type, uploadedBy: ctx.uid, uploadedAt: nowIso() };
                const copies = copiesOf(d);
                if (!copies.length) {
                    counts.forEach((v: number, i: number) => (lines[i].counted = v));
                    await writeDoc(`${root}/stock_take_attachments/${id}`, { ...meta, data, sessionId: id, warehouseId });
                    return save({ lines, status: 'verification', countedAt: nowIso(), countedBy: ctx.uid, countedByAll: [ctx.uid], piAttachment: meta }, { attachment: meta.name });
                }
                // Several independent count sheets (PI_…_A, _B …): each is counted and signed by a different person.
                const copy = str(ctx.body.copy);
                if (!copies.includes(copy)) throw new HttpError(400, `Choose the count sheet (${copies.map((c) => `${id}_${c}`).join(', ')})`);
                const done: Record<string, any> = isObj(d.copyCounts) ? { ...(d.copyCounts as Obj) } : {};
                if (done[copy]) throw new HttpError(409, `Counts for ${id}_${copy} are already submitted`);
                if (Object.values(done).some((x: any) => str(x?.countedBy) === ctx.uid) && !bypass(ctx, 'inv.stocktake.copy_independence'))
                    throw new HttpError(403, 'Each count sheet must be counted by a different person; you already submitted another sheet of this PI.');
                await writeDoc(`${root}/stock_take_attachments/${id}_${copy}`, { ...meta, data, sessionId: id, copy, warehouseId });
                done[copy] = { counts, countedBy: ctx.uid, countedAt: nowIso(), attachment: meta };
                const counters = [...new Set([...countersOf(d), ctx.uid])];
                const remaining = copies.filter((c) => !done[c]);
                if (remaining.length) return save({ copyCounts: done, countedByAll: counters, countedBy: str(d.countedBy) || ctx.uid }, { copy, remaining });
                // Every sheet is in: where the sheets agree the count stands; where they differ a recount is mandatory.
                let mismatched = 0;
                lines.forEach((line, i) => {
                    const seen = copies.map((c) => Number(done[c].counts[i]));
                    line.copyCounts = Object.fromEntries(copies.map((c, k) => [c, seen[k]]));
                    line.copyMismatch = seen.some((v) => v !== seen[0]);
                    line.counted = seen[0];
                    if (line.copyMismatch) mismatched++;
                });
                return save(
                    { lines, copyCounts: done, countedByAll: counters, status: 'verification', countedAt: nowIso(), countedBy: str(d.countedBy) || ctx.uid, piAttachment: done[copies[0]].attachment, copyMismatches: mismatched },
                    { copy, mismatched }
                );
            }

            if (action === 'edit_counts') {
                // Counts are never corrected once submitted: the variance is already known at that point, so a correction
                // could hide it. A recount (of some lines or the whole PI) is ordered instead.
                throw new HttpError(409, 'Submitted counts cannot be edited. Order a recount of the lines, or of the whole PI, instead.');
            }

            if (action === 'edit_counts_disabled') {
                if (status !== 'verification') throw new HttpError(409, 'Counts may only be edited before verification');
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Count correction reason must be at least 10 characters');
                const values = Array.isArray(ctx.body.counts) ? ctx.body.counts : [];
                if (values.length !== lines.length) throw new HttpError(400, 'Provide all corrected counts');
                const before = lines.map((x) => x.counted);
                values.forEach((v: unknown, i: number) => {
                    if (v === '' || v === null || !Number.isFinite(Number(v)) || Number(v) < 0) throw new HttpError(400, 'Counts must be non-negative');
                    lines[i].counted = Number(v);
                });
                return save({ lines, countEditedBy: ctx.uid, countEditedAt: nowIso(), countEditReason: reason.slice(0, 500) }, { before, after: lines.map((x) => x.counted) });
            }

            if (action === 'accept') {
                // One step after counting: accept the counts, order recounts (chosen lines, every line whose sheets differ,
                // or the whole PI), then either post at once (no variance on the remaining lines) or send the variance for
                // approval under the Chart of Authority (posted automatically on the last approval).
                if (status !== 'verification') throw new HttpError(409, 'PI is not awaiting verification');
                if ((countersOf(d).includes(ctx.uid) || str(d.countEditedBy) === ctx.uid) && !bypass(ctx, 'inv.stocktake.verify_independence')) throw new HttpError(403, 'Counts must be accepted by someone other than the person who counted them.');
                const full = ctx.body.fullRecount === true;
                const picked: number[] = full ? lines.map((_, i) => i) : Array.isArray(ctx.body.recountIndices) ? ctx.body.recountIndices.map(Number) : [];
                if (!full && picked.some((i: number) => !Number.isInteger(i) || i < 0 || i >= lines.length || (lines[i].expected === lines[i].counted && lines[i].copyMismatch !== true))) throw new HttpError(400, 'Only lines with a difference can be picked for recount; use a full recount for the whole PI');
                const missing = lines.map((l, i) => (l.copyMismatch === true && !picked.includes(i) ? i : -1)).filter((i) => i >= 0);
                if (missing.length) throw new HttpError(409, `${count(missing.length, 'line')} differ${missing.length === 1 ? 's' : ''} between the count sheets and must be recounted.`);
                if (full) {
                    const reason = str(ctx.body.reason).trim();
                    if (reason.length < 10) throw new HttpError(400, 'Give a reason of at least 10 characters for recounting the whole PI');
                }
                lines.forEach((line, i) => {
                    line.verified = true;
                    line.recount = picked.includes(i);
                });
                const verify = { verifiedAt: nowIso(), verifiedBy: ctx.uid, ...(full ? { fullRecountReason: str(ctx.body.reason).trim().slice(0, 500) } : {}) };
                const flagged = lines.filter((x) => x.recount && !x.posted);
                const pending = lines.filter((x) => x.verified && !x.recount && !x.posted);
                const withVariance = pending.filter((x) => x.expected === null || x.counted === null || Number(x.counted) !== Number(x.expected));
                // Route first (it may refuse, e.g. a missing baseline) so nothing is created when the step fails.
                const routed = pending.length && withVariance.length ? await routeNow(pending) : null;
                const recountPi = flagged.length ? await makeRecount(flagged) : '';
                if (routed) {
                    await save({ ...verify, lines, recountPi, ...routed.patch }, { ...routed.extra, recountLines: flagged.length, recountPi });
                    return { ok: true, outcome: 'approval', recountPi };
                }
                // No variance left (or everything goes to recount): post and close now.
                await postNow({ ...verify, recountPi, varianceValue: 0 }, { recountLines: flagged.length, recountPi, fullRecount: full });
                return { ok: true, outcome: pending.length ? 'posted' : 'recounted', recountPi };
            }

            if (action === 'verify') {
                if (status !== 'verification') throw new HttpError(409, 'Session not awaiting verification');
                if ((countersOf(d).includes(ctx.uid) || str(d.countEditedBy) === ctx.uid) && !bypass(ctx, 'inv.stocktake.verify_independence')) throw new HttpError(403, 'Counts must be verified by someone other than the person who counted or corrected them.');
                const recountIds = Array.isArray(ctx.body.recountIndices) ? ctx.body.recountIndices.map(Number) : [];
                if (recountIds.some((i: number) => !Number.isInteger(i) || i < 0 || i >= lines.length || (lines[i].expected === lines[i].counted && lines[i].copyMismatch !== true))) throw new HttpError(400, 'Recount selection must contain inconsistent lines');
                // Where the count sheets disagree the recount is mandatory: such a line can never be accepted as counted.
                const missingRecount = lines.map((l, i) => (l.copyMismatch === true && !recountIds.includes(i) ? i : -1)).filter((i) => i >= 0);
                if (missingRecount.length) throw new HttpError(409, `${count(missingRecount.length, 'line')} differ${missingRecount.length === 1 ? 's' : ''} between the count sheets and must be recounted.`);
                lines.forEach((line, i) => {
                    line.verified = true;
                    line.recount = recountIds.includes(i);
                });
                return save({ lines, status: 'verified', verifiedAt: nowIso(), verifiedBy: ctx.uid }, { recountLines: recountIds.length });
            }

            if (action === 'recount') {
                if (status !== 'verified') throw new HttpError(409, 'Verify discrepancies before recount');
                const flagged = lines.filter((x) => x.recount && !x.posted);
                if (!flagged.length) throw new HttpError(409, 'No discrepancies marked for recount');
                const next = await makeRecount(flagged);
                await save({ recountPi: next }, { recountPi: next });
                return { ok: true, id: next };
            }

            if (action === 'refresh_baseline') {
                if (status !== 'verified') throw new HttpError(409, 'Only verified sessions can refresh a stale baseline');
                const current = await snapshot(root, warehouseId);
                for (const line of lines) {
                    if (line.posted || line.recount) continue;
                    const fresh = current.find((x) => x.materialId === str(line.materialId) && x.binId === str(line.binId));
                    if (!fresh || fresh.expected === null) throw new HttpError(409, 'Current reconciled stock unavailable; cannot refresh baseline');
                    line.expected = fresh.expected;
                    line.verified = false;
                }
                return save({ lines, status: 'verification', baselineRefreshedAt: nowIso(), baselineRefreshedBy: ctx.uid });
            }

            if (action === 'submit_posting') {
                if (status !== 'verified') throw new HttpError(409, 'Verify the count before posting');
                const pending = lines.filter((x) => x.verified && !x.recount && !x.posted);
                if (!pending.length) throw new HttpError(409, 'No verified non-recount lines to post');
                const routed = await routeNow(pending);
                return save(routed.patch, routed.extra);
            }

            if (action === 'approve_posting') {
                if (status !== 'pending_post_approval') throw new HttpError(409, 'Posting not awaiting approval');
                if ((str(d.postingRequestedBy) === ctx.uid || countersOf(d).includes(ctx.uid)) && !bypass(ctx, 'inv.stocktake.approve_independence')) throw new HttpError(403, 'Posting must be approved by someone other than the person who requested it or counted the stock.');
                const steps = coaSteps(d);
                // The last approval posts the stock at once. If posting fails (for example the stock moved since counting),
                // the approval is kept and the PI waits at Approved for posting with the reason.
                const approveAndPost = async (patch: Record<string, unknown>, extra: Record<string, unknown>) => {
                    try {
                        await postNow({ ...patch, postingApprovedBy: ctx.uid, postingApprovedAt: nowIso() }, { ...extra, approvedAndPosted: true });
                        return { ok: true, outcome: 'posted' };
                    } catch (e) {
                        const why = e instanceof Error ? e.message : 'Posting failed';
                        await save({ ...patch, status: 'approved_for_posting', postingApprovedBy: ctx.uid, postingApprovedAt: nowIso(), postError: why.slice(0, 300) }, { ...extra, postError: why.slice(0, 300) });
                        throw new HttpError(409, `Approved, but the stock could not be posted: ${why}`);
                    }
                };
                if (!steps.length) return approveAndPost({}, {});
                // Chart of Authority: the current level is approved by a different person holding its job role.
                const check = coaCheck(ctx, d);
                if (!check.ok) throw new HttpError(403, check.why || 'You cannot approve this level.');
                if (check.testMode) bypass(ctx, 'inv.stocktake.coa_approver');
                const step = steps.find((x) => x.status === 'pending')!;
                step.status = 'approved';
                step.by = ctx.uid;
                step.at = nowIso();
                const last = steps.every((x) => x.status === 'approved');
                if (last) return approveAndPost({ approval: { ...(d.approval as Obj), steps } }, { level: step.level, positionCode: step.positionCode, amount: Number(d.varianceValue) || 0, final: true });
                return save(
                    { approval: { ...(d.approval as Obj), steps }, ...(last ? { status: 'approved_for_posting', postingApprovedBy: ctx.uid, postingApprovedAt: nowIso() } : {}) },
                    { level: step.level, positionCode: step.positionCode, amount: Number(d.varianceValue) || 0, final: last }
                );
            }

            if (action === 'reject_posting') {
                if (status !== 'pending_post_approval') throw new HttpError(409, 'Posting not awaiting approval');
                if ((str(d.postingRequestedBy) === ctx.uid || countersOf(d).includes(ctx.uid)) && !bypass(ctx, 'inv.stocktake.approve_independence')) throw new HttpError(403, 'You cannot return a posting you requested or counted.');
                if (coaSteps(d).length) {
                    const check = coaCheck(ctx, d);
                    if (!check.ok) throw new HttpError(403, check.why || 'You cannot return this posting.');
                    if (check.testMode) bypass(ctx, 'inv.stocktake.coa_approver');
                }
                const reason = str(ctx.body.reason).trim();
                if (reason.length < 10) throw new HttpError(400, 'Enter a reason of at least 10 characters');
                return save({ status: 'verified', postingReturnReason: reason.slice(0, 500), postingReturnedBy: ctx.uid, postingReturnedAt: nowIso(), approval: null, postingRequestedBy: '', postingRequestedAt: '' }, { reason: reason.slice(0, 500) });
            }

            if (action === 'post') {
                if (status !== 'approved_for_posting') throw new HttpError(409, 'Posting must be approved first. Submit the PI for posting approval.');
                if (countersOf(d).includes(ctx.uid) && !bypass(ctx, 'inv.stocktake.post_independence')) throw new HttpError(403, 'The person who counted the stock cannot post it.');
                if (coaSteps(d).some((x) => x.status !== 'approved')) throw new HttpError(409, 'Every Chart of Authority level must approve before posting.');
                if (!lines.some((x) => x.verified && !x.recount && !x.posted)) throw new HttpError(409, 'No eligible lines to reconcile');
                return postNow({}, {});
            }

            throw new HttpError(400, 'Unknown stock take action');
        }),
    ],
};

// ---------------------------------------------------------------------------
// Automatic PI documents: when a configuration says PI documents are created automatically, every planned PI document
// of a session is generated as soon as the session is complete (at creation for a manual session, at setup for an
// automatic one). Locations already on the session's PI documents are skipped; one material is never put twice on a
// PI; nothing is generated for materials with no reconciled stock baseline (the whole run is refused, naming them).
// Counting still waits for the session's start (Confirm printed is refused before it).
// ---------------------------------------------------------------------------

const piName = (configName: string, iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const part = (key: string) => parts.find((p) => p.type === key)?.value || '';
    return `${configName} ${part('day')}${part('month').toUpperCase()}${part('year')}${part('hour')}${part('minute')}`;
};

export async function generateSessionPis(orgId: string, campaignId: string, by: string, limit = Infinity): Promise<{ created: string[] }> {
    const root = `organizations/${orgId}`;
    const campaign = await getDoc(`${root}/${CAMPAIGNS}/${campaignId}`);
    if (!campaign || str(campaign.data.status) !== 'open') throw new HttpError(409, 'This stock take session is not open.');
    if (campaign.data.setupRequired === true) throw new HttpError(409, 'Complete the session setup first.');
    const config = await getDoc(`${root}/stock_take_configs/${str(campaign.data.configId)}`);
    if (!config || config.data.active === false) throw new HttpError(403, 'Configuration not accessible');
    const warehouseId = str(campaign.data.warehouseId);
    const metrics = metricsOf(campaign.data);
    const planned = plannedPis(metrics.targetMaterials, metrics.materialsPerPi);
    const allPis = await listDocs(`${root}/stock_take_sessions`);
    const existing = allPis.filter((x) => str(x.data.campaignId) === campaignId && !str(x.data.parentPi) && str(x.data.status) !== 'disregarded');
    const room = Math.min(planned - existing.length, limit);
    if (room <= 0) return { created: [] };
    const linesOf = (docs: Doc[]) => docs.flatMap((x) => (Array.isArray(x.data.lines) ? x.data.lines : [])).filter(isObj).map((l) => `${str(l.materialId)}|${str(l.binId)}`);
    const onSession = new Set(linesOf(existing));
    // Daily sessions of one cycle never repeat a location another day of the same cycle already has.
    const cycleId = str(campaign.data.cycleId);
    const cycleSessions = cycleId ? new Set((await listDocs(`${root}/${CAMPAIGNS}`)).filter((x) => str(x.data.cycleId) === cycleId && str(x.data.status) !== 'cancelled').map((x) => x.id)) : new Set<string>();
    const taken = new Set([...onSession, ...linesOf(allPis.filter((x) => cycleSessions.has(str(x.data.campaignId)) && str(x.data.status) !== 'disregarded'))]);
    let pool = (await selectableLocations(root, warehouseId, config.data)).filter((x) => !taken.has(`${x.materialId}|${x.binId}`));
    if (str(config.data.selection) !== 'Sequence') pool = randomSample(pool, pool.length);
    const need = Math.max(0, metrics.targetMaterials - onSession.size);
    const picked = pool.slice(0, Math.min(need, room * metrics.materialsPerPi));
    if (!picked.length) {
        await writeDoc(`${root}/${CAMPAIGNS}/${campaignId}`, { ...campaign.data, locationsExhausted: true, updatedAt: nowIso() } as never);
        throw new HttpError(409, 'There are no more mapped locations to put on PI documents for this session.');
    }
    const unbased = picked.filter((x) => x.expected === null);
    if (unbased.length) {
        const names = [...new Set(unbased.map((x) => x.materialNumber || x.materialId))];
        throw new HttpError(409, `${names.length === 1 ? 'Material' : `${names.length} materials`} ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''} ${names.length === 1 ? 'has' : 'have'} no reconciled stock in this warehouse, so no PI documents were generated. Post the opening stock (Material detail > Current Status) or reconcile the open stock movements, then tap Create PI documents.`);
    }
    // Fill PI documents in order; a material already on a PI moves to the next one (one material per PI document).
    const chunks: Array<typeof picked> = [];
    for (const loc of picked) {
        let target = chunks.find((c) => c.length < metrics.materialsPerPi && !c.some((x) => x.materialId === loc.materialId));
        if (!target) {
            if (chunks.length >= room) continue;
            target = [];
            chunks.push(target);
        }
        target.push(loc);
    }
    const copies = Math.min(MAX_COPIES, Math.max(1, Number(isObj(campaign.data.metrics) ? campaign.data.metrics.piCopies : 1) || 1));
    const created: string[] = [];
    for (const [k, chunk] of chunks.entries()) {
        const n = await nextOrgCounter(orgId, 'stockTakePiSeq');
        if (n > 99_999_999) throw new HttpError(409, 'PI document sequence exhausted');
        const id = `PI_${String(n).padStart(8, '0')}`;
        const now = nowIso();
        const ok = await writeDoc(
            `${root}/stock_take_sessions/${id}`,
            {
                piNumber: id,
                sessionName: piName(str(config.data.name), now),
                campaignId,
                campaignName: str(campaign.data.name),
                piSequenceInSession: existing.length + k + 1,
                configId: config.id,
                configName: str(config.data.name),
                warehouseId,
                type: str(config.data.type),
                status: 'awaiting_print',
                createdAt: now,
                createdBy: by,
                generated: true,
                copies,
                printedAt: '',
                parentPi: '',
                recountNumber: 0,
                lines: chunk.map((x) => ({ binId: x.binId, materialId: x.materialId, materialNumber: x.materialNumber, description: x.description, expected: x.expected, counted: null, verified: false, recount: false, posted: false })),
                documentSize: chunk.length,
            } as never,
            { exists: false }
        );
        if (ok) created.push(id);
    }
    if (pool.length < need && chunks.length < room) await writeDoc(`${root}/${CAMPAIGNS}/${campaignId}`, { ...((await getDoc(`${root}/${CAMPAIGNS}/${campaignId}`))?.data ?? campaign.data), locationsExhausted: true, updatedAt: nowIso() } as never);
    await audit([{ category: 'inventory', action: 'inventory.stocktake.generate', orgId, target: { type: 'stock_take_session', id: campaignId, label: `Stock take session ${campaignId}` }, details: `${created.length} PI document(s) by ${by}: ${created.slice(0, 20).join(', ')}${created.length > 20 ? ', …' : ''}` }]);
    return { created };
}

/** After a session is complete: generate its PI documents when the configuration says so; a failure is reported, not thrown. */
async function autoGenerate(orgId: string, campaignId: string, configData: Obj | undefined, by: string) {
    if (str(configData?.piCreation) !== 'automatic') return { generated: 0, generateError: '' };
    let out: { generated: number; generateError: string };
    try {
        const limit = await releaseLimit(orgId, campaignId, configData);
        out = { generated: limit > 0 ? (await generateSessionPis(orgId, campaignId, by, limit)).created.length : 0, generateError: '' };
    } catch (e) {
        out = { generated: 0, generateError: e instanceof Error ? e.message : 'PI documents could not be generated' };
    }
    await recordGeneration(orgId, campaignId, out.generateError);
    return out;
}

/** One session for a cycle with PI documents released each day: only what is due by today may be created. */
async function releaseLimit(orgId: string, campaignId: string, configData: Obj | undefined): Promise<number> {
    if (!(isCycle(configData ?? {}) && str(configData?.cycleSessions) === 'single' && str(configData?.cyclePiRelease) === 'daily')) return Infinity;
    const s = await getDoc(`organizations/${orgId}/${CAMPAIGNS}/${campaignId}`);
    if (!s) return 0;
    const m = metricsOf(s.data);
    const have = (await listDocs(`organizations/${orgId}/stock_take_sessions`)).filter((x) => str(x.data.campaignId) === campaignId && !str(x.data.parentPi) && str(x.data.status) !== 'disregarded').length;
    return Math.max(0, dueByToday(plannedPis(m.targetMaterials, m.materialsPerPi), str(s.data.startAt), str(s.data.endAt), nowIso()) - have);
}

/** Keep the last automatic generation problem on the session, so the screen says why there are no PI documents. */
async function recordGeneration(orgId: string, campaignId: string, error: string) {
    const path = `organizations/${orgId}/${CAMPAIGNS}/${campaignId}`;
    const doc = await getDoc(path);
    if (!doc || str(doc.data.autoPiError) === error) return;
    await writeDoc(path, { ...doc.data, autoPiError: error.slice(0, 500), autoPiErrorAt: error ? nowIso() : '', updatedAt: nowIso() } as never);
}

// ---------------------------------------------------------------------------
// Automation (shared heartbeat, job inv.stocktake-sessions): at each Nairobi midnight, every enabled periodic
// configuration set to create sessions automatically gets its next session when it is due. The session carries the
// configuration, warehouse, start (that midnight) and end (start + duration); its name, materials to count, materials
// per PI and targets are completed once by a planner before any PI document can be created. The configuration keeps
// lastSessionCreatedAt, lastSessionId and nextSessionDueOn for the next run. Open sessions whose posting is complete
// are closed. Duplicate runs for the same day are refused by a per-day key.
// ---------------------------------------------------------------------------

export async function stockTakeAutomationForOrg(orgId: string, deadline: number) {
    const out = { created: 0, closed: 0, generated: 0, failed: 0, complete: true };
    const root = `organizations/${orgId}`;
    const today = nairobiDay();
    const configs = await listDocs(`${root}/stock_take_configs`);
    for (const c of configs) {
        if (Date.now() > deadline) return { ...out, complete: false };
        const d = c.data;
        if (d.active === false || d.periodic !== true || str(d.sessionCreation) !== 'automatic') continue;
        const due = str(d.nextSessionDueOn);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due > today) continue;
        try {
            const warehouseId = str(d.warehouseId);
            const cycle = isCycle(d);
            const duration = Number(d.durationDays);
            if (!warehouseId || !(await getDoc(`${root}/warehouses/${warehouseId}`))) throw new Error('warehouse missing');
            if (!cycle && (!Number.isInteger(duration) || duration < 1)) throw new Error('duration missing');
            // One session per configuration and day, however often the run is repeated.
            const claimed = await writeDoc(`${root}/stock_take_auto_keys/${c.id}_${today}`, { configId: c.id, day: today, createdAt: nowIso() }, { exists: false });
            let next = due;
            // A cycle count runs to the end of its period and the next cycle begins there.
            // Daily cycle sessions: a session every day of the cycle.
            const daily = cycle && str(d.cycleSessions) === 'daily';
            if (daily) next = addPeriod(today, 'Daily');
            else if (cycle) next = periodEnd(today, str(d.period));
            else while (next <= today) next = addPeriod(next, str(d.period));
            // The cycle this session belongs to, and (for daily sessions) the plan set on its first session.
            const cycleStart = cycle ? periodStart(today, str(d.period)) : '';
            const cycleEnd = cycle ? periodEnd(today, str(d.period)) : '';
            const cycleId = cycle ? `${c.id}_${cycleStart}` : '';
            const plan = daily ? (await getDoc(cyclePath(orgId, c.id, cycleStart)))?.data : undefined;
            const share = daily && plan ? await cycleDayShare(orgId, cycleId, plan, today, cycleEnd) : null;
            if (claimed && share !== null && share.materials <= 0) {
                // The cycle's materials are all on PI documents already: no session today.
                await writeDoc(`${root}/stock_take_configs/${c.id}`, { ...d, nextSessionDueOn: next, updatedAt: nowIso() });
                continue;
            }
            if (claimed) {
                const n = await nextOrgCounter(orgId, 'stockTakeSessionSeq');
                if (n > 99_999_999) throw new Error('session sequence exhausted');
                const id = `CNT_SES_${String(n).padStart(8, '0')}`;
                const startAt = nairobiMidnight(today);
                const now = nowIso();
                await writeDoc(
                    `${root}/${CAMPAIGNS}/${id}`,
                    {
                        sessionNumber: id,
                        name: `${str(d.name)} ${today}`.slice(0, 80),
                        startAt,
                        endAt: daily ? nairobiMidnight(addPeriod(today, 'Daily')) : sessionEnd(d, startAt),
                        metrics: share ? share.metrics : {},
                        ...(cycle ? { cycleId, cycleStart, cycleEnd, cycleDays: daysBetween(cycleStart, cycleEnd), cycleDay: daysBetween(cycleStart, today) + 1, cycleSessions: str(d.cycleSessions) } : {}),
                        configId: c.id,
                        configName: str(d.name),
                        type: str(d.type),
                        selection: str(d.selection),
                        documentSize: share ? share.metrics.materialsPerPi : 0,
                        plannedPiDocuments: share ? plannedPis(share.metrics.targetMaterials, share.metrics.materialsPerPi) : 0,
                        durationDays: cycle ? null : duration,
                        fullScope: d.fullScope === true,
                        criticalityClasses: d.byCriticality === true && Array.isArray(d.criticalityClasses) ? d.criticalityClasses : [],
                        warehouseId,
                        status: 'open',
                        origin: 'automatic',
                        // A later day of a cycle takes its plan from the cycle; otherwise a planner sets it up once.
                        setupRequired: !share,
                        createdAt: now,
                        createdBy: 'automation',
                    } as never,
                    { exists: false }
                );
                if (share) out.generated += (await autoGenerate(orgId, id, d, 'automation')).generated;
                await writeDoc(`${root}/stock_take_configs/${c.id}`, { ...d, lastSessionCreatedAt: now, lastSessionId: id, nextSessionDueOn: next, updatedAt: now });
                await audit([{ category: 'inventory', action: 'inventory.stocktake.count_session.auto_create', orgId, target: { type: 'stock_take_session', id, label: `Stock take session ${id}` }, details: `Configuration ${c.id} (${str(d.period)}); next due ${next}` }]);
                out.created++;
            } else if (str(d.nextSessionDueOn) !== next) {
                await writeDoc(`${root}/stock_take_configs/${c.id}`, { ...d, nextSessionDueOn: next, updatedAt: nowIso() });
            }
        } catch (e) {
            out.failed++;
            await audit([{ category: 'inventory', action: 'inventory.stocktake.count_session.auto_create', outcome: 'failure', orgId, target: { type: 'stock_take_config', id: c.id }, details: (e instanceof Error ? e.message : 'failed').slice(0, 200) }]);
        }
    }
    const cfgById = new Map(configs.map((c) => [c.id, c.data]));
    for (const s of await listDocs(`${root}/${CAMPAIGNS}`)) {
        if (Date.now() > deadline) return { ...out, complete: false };
        if (str(s.data.status) !== 'open') continue;
        // A daily cycle session still waiting for setup takes the cycle's plan once a planner has set it.
        if (s.data.setupRequired === true && str(s.data.cycleSessions) === 'daily' && str(s.data.cycleId)) {
            const plan = (await getDoc(cyclePath(orgId, str(s.data.configId), str(s.data.cycleStart))))?.data;
            if (plan) {
                const share = await cycleDayShare(orgId, str(s.data.cycleId), plan, nairobiDay(), str(s.data.cycleEnd));
                if (share.materials > 0) {
                    await writeDoc(`${root}/${CAMPAIGNS}/${s.id}`, { ...s.data, metrics: share.metrics, documentSize: share.metrics.materialsPerPi, plannedPiDocuments: plannedPis(share.metrics.targetMaterials, share.metrics.materialsPerPi), setupRequired: false, setupBy: 'automation', setupAt: nowIso(), updatedAt: nowIso() } as never);
                    s.data.setupRequired = false;
                    s.data.metrics = share.metrics;
                }
            }
        }
        // Automatic PI documents that could not be generated earlier (for example a missing stock baseline) are retried.
        const cfg = cfgById.get(str(s.data.configId));
        const ended = !!str(s.data.endAt) && Date.parse(nowIso()) > Date.parse(str(s.data.endAt));
        if (str(cfg?.piCreation) === 'automatic' && s.data.setupRequired !== true && !ended && s.data.locationsExhausted !== true) {
            const pis = (await listDocs(`${root}/stock_take_sessions`)).filter((x) => str(x.data.campaignId) === s.id && !str(x.data.parentPi) && str(x.data.status) !== 'disregarded');
            if (pis.length < plannedPis(metricsOf(s.data).targetMaterials, metricsOf(s.data).materialsPerPi)) out.generated += (await autoGenerate(orgId, s.id, cfg, 'automation')).generated;
        }
        if (await autoCloseSession(orgId, s.id, 'automation')) out.closed++;
    }
    return out;
}

/** The job is due once per Nairobi day, at the first heartbeat after midnight. */
export const stockTakeAutomationDue = (lastCompletedAt: string, at: Date) => !lastCompletedAt || nairobiDay(Date.parse(lastCompletedAt)) < nairobiDay(at.getTime());
