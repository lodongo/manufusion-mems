import {resolveAccountRule,validateRuleDraft,type AccountRule,type DeterminationContext} from './finAccountRules';
import { createHash } from 'crypto';
import { POSTING_EVENTS } from './finPostingCatalogue';
import { removedCodes, type Overrides, type Side } from './glTransactionMap';
import {
    DOCUMENT_NAME_ROOT,
    FIRESTORE_BASE,
    HttpError,
    deleteDoc,
    encodeFields,
    fieldEq,
    getDoc,
    googleRequest,
    isObj,
    listDocs,
    nowIso,
    runQuery,
    str,
    writeDoc,
    type Doc,
    type Fields,
} from './core';
import { effectiveAccess, hasPerm, normalizeOrgRole, type OrgContext } from './guards';
import { glMaster } from './procurement';
import { allowedNodeIds } from './positions';
import { record, orgUsers, enabledModules } from './org';
import { canAt } from './access';
import { getAuthority } from './procurementPolicy';

// ---------------------------------------------------------------------------
// Finance core. Finance is configured per LEGAL ENTITY: every setting, account, period, mapping, tax and posting
// belongs to exactly one legal entity.
//
//   organizations/{org}/fin_entities/{leId}            finance status, functional currency, approved settings
//   organizations/{org}/fin_years/{leId}_{fy}          a financial year with its periods and their status
//   organizations/{org}/fin_accounts/{leId}__{code}    an account adopted from the MEMS GL master (chart of accounts)
//   organizations/{org}/fin_mapping/{leId}             account determination for every system transaction
//   organizations/{org}/fin_taxes/{leId}               tax regimes and rates
//   organizations/{org}/fin_cc/{ccId}                  cost center posting status and account restrictions
//   organizations/{org}/fin_journal/{LE-FY-########}   THE journal of the legal entity (one, immutable, system postings only)
//   organizations/{org}/fin_bal/{...}                  balances per period, account and cost center (integer cents)
//   organizations/{org}/fin_stock/{wh}__{material}     moving-average valuation of stock per warehouse
//   organizations/{org}/fin_postkeys/{hash}            one per source event: a source can never post twice
//   organizations/{org}/fin_requests/FCR########       maker-checker change and posting requests
//
// Nothing in the journal is ever edited, deleted or uploaded. Every line comes from a system event (receipt, issue,
// acceptance, stock take, approved reconciliation, reallocation or year-end close). Every posting checks the period,
// the approved chart, the cost center and the balance, and is written in ONE atomic commit with its balances.
// ---------------------------------------------------------------------------

export type Obj = Record<string, unknown>;
export const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => !!x && typeof x === 'object' && !Array.isArray(x)) as Obj[]) : []);
export const o = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
export const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
export const cents = (n: number) => Math.round(n * 100);
export const today = () => new Date().toISOString().slice(0, 10);
export const cleanText = (v: unknown, max = 400) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
export const oneLine = (v: unknown, max: number) => cleanText(v, 2000).replace(/\s+/g, ' ').slice(0, max);
export const nameOf = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
export function reasonOf(body: Obj, min = 10) {
    const r = oneLine(body.reason, 300);
    if (r.length < min) throw new HttpError(400, `Give the reason (at least ${min} characters).`);
    return r;
}

export const P = (orgId: string) => {
    const r = `organizations/${orgId}`;
    return {
        root: r,
        entity: (le: string) => `${r}/fin_entities/${le}`,
        year: (le: string, fy: number) => `${r}/fin_years/${le}_${fy}`,
        years: `${r}/fin_years`,
        account: (le: string, code: string) => `${r}/fin_accounts/${le}__${enc(code)}`,
        accounts: `${r}/fin_accounts`,
        mapping: (le: string) => `${r}/fin_mapping/${le}`,
        taxes: (le: string) => `${r}/fin_taxes/${le}`,
        cc: (cc: string) => `${r}/fin_cc/${cc}`,
        gltxn: (le: string) => `${r}/fin_gltxn/${le}`,
        ccs: `${r}/fin_cc`,
        journal: (id: string) => `${r}/fin_journal/${id}`,
        journals: `${r}/fin_journal`,
        bal: (id: string) => `${r}/fin_bal/${id}`,
        bals: `${r}/fin_bal`,
        stock: (wh: string, m: string) => `${r}/fin_stock/${wh}__${enc(m)}`,
        stocks: `${r}/fin_stock`,
        postkey: (k: string) => `${r}/fin_postkeys/${k}`,
        request: (id: string) => `${r}/fin_requests/${id}`,
        requests: `${r}/fin_requests`,
        runs: `${r}/fin_runs`,
        run: (id: string) => `${r}/fin_runs/${id}`,
        lock: (id: string) => `${r}/fin_locks/${id}`,
        counter: (id: string) => `${r}/fin_counters/${id}`,
    };
};
/** Codes can contain characters that are not allowed in a document id; they are escaped. */
export const enc = (code: string) => code.replace(/[^A-Za-z0-9_-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`);
export const hashKey = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 40);

// ----- Module and structure -----

export async function requireFinance(ctx: OrgContext) {
    const mods = await enabledModules(ctx.org);
    if (!mods.some((m) => m.code === 'FIN')) throw new HttpError(403, 'The Finance module is not enabled for your organization.');
}

export interface Unit {
    id: string;
    code: string;
    name: string;
    level: string;
    parentId: string;
    status: string;
    managerUid: string;
    managerRoleCode: string;
    costType: string;
    attributes: Obj;
}
export async function unitsOf(orgId: string): Promise<Map<string, Unit>> {
    const docs = await listDocs(`organizations/${orgId}/structure`);
    return new Map(
        docs.map((n): [string, Unit] => {
            const a = o(n.data.attributes);
            return [n.id, { id: n.id, code: str(n.data.code) || n.id, name: str(n.data.name) || n.id, level: str(n.data.level), parentId: str(n.data.parentId), status: str(n.data.status) || 'active', managerUid: str(n.data.managerUid), managerRoleCode: str(n.data.managerRoleCode), costType: str(a.costType), attributes: a }];
        })
    );
}
export function chainOf(units: Map<string, Unit>, id: string): Unit[] {
    const out: Unit[] = [];
    let cur = units.get(id);
    for (let i = 0; cur && i < 14; i++) {
        out.push(cur);
        cur = units.get(cur.parentId);
    }
    return out;
}
export const leOf = (units: Map<string, Unit>, id: string): Unit | null => chainOf(units, id).find((u) => u.level === 'legal_entity') ?? null;
export const isSuper = (ctx: OrgContext) => ctx.role === 'org_super_admin';

export interface Scope {
    all: boolean;
    ids: Set<string>;
}
export async function scopeOf(ctx: OrgContext): Promise<Scope> {
    if (isSuper(ctx)) return { all: true, ids: new Set() };
    const s = await allowedNodeIds(ctx.orgId, ctx.me, true);
    return s === 'all' ? { all: true, ids: new Set() } : { all: false, ids: s };
}
/** May the person do `perm` at this node (job role at the node or above it, or direct role within their scope). */
export function permAt(ctx: OrgContext, perm: string, nodeId: string, units: Map<string, Unit>, scope: Scope): boolean {
    if (isSuper(ctx)) return true;
    const path = chainOf(units, nodeId).map((u) => u.id).reverse();
    if (!path.length) return false;
    // A person working at a site or below still belongs to its legal entity: their direct role reaches that entity.
    let reach: Set<string> | 'all' = scope.all ? 'all' : scope.ids;
    if (!scope.all && !scope.ids.has(nodeId) && units.get(nodeId)?.level === 'legal_entity' && Array.from(scope.ids).some((id) => leOf(units, id)?.id === nodeId)) reach = new Set([...scope.ids, nodeId]);
    return canAt(ctx, perm, path, reach);
}
export const anyPerm = (ctx: OrgContext, perm: string) => isSuper(ctx) || hasPerm(ctx.permissions, perm);

/** Legal entities the person works in: their own, or every one below the level they operate at. */
export function visibleEntities(units: Map<string, Unit>, scope: Scope): Unit[] {
    const les = Array.from(units.values()).filter((u) => u.level === 'legal_entity');
    if (scope.all) return les.sort((a, b) => a.code.localeCompare(b.code));
    const out = new Set<string>();
    for (const id of scope.ids) {
        const le = leOf(units, id);
        if (le) out.add(le.id);
    }
    return les.filter((l) => out.has(l.id)).sort((a, b) => a.code.localeCompare(b.code));
}
export function needEntity(units: Map<string, Unit>, scope: Scope, leId: string): Unit {
    const le = visibleEntities(units, scope).find((l) => l.id === leId);
    if (!le) throw new HttpError(404, 'Legal entity not found in your scope.');
    return le;
}
/** Cost centers a person owns: named on it, or holding its manager job role at the cost center or a unit above. */
export function ownedCostCenters(units: Map<string, Unit>, user: Doc | null | undefined): Set<string> {
    const out = new Set<string>();
    if (!user) return out;
    const t = today();
    const mine = objs(user.data.assignments).filter((a) => str(a.positionCode) && (!str(a.startsOn) || str(a.startsOn) <= t) && (!str(a.endsOn) || str(a.endsOn) >= t));
    for (const u of units.values()) {
        if (u.level !== 'cost_center') continue;
        if (u.managerUid && u.managerUid === user.id) {
            out.add(u.id);
            continue;
        }
        if (!u.managerRoleCode) continue;
        const chain = new Set(chainOf(units, u.id).map((x) => x.id));
        if (mine.some((a) => str(a.positionCode) === u.managerRoleCode && chain.has(str(a.nodeId)))) out.add(u.id);
    }
    return out;
}
export const activePositions = (user: Doc | null | undefined) => {
    const t = today();
    return objs(user?.data.assignments)
        .filter((a) => str(a.positionCode) && (!str(a.startsOn) || str(a.startsOn) <= t) && (!str(a.endsOn) || str(a.endsOn) >= t))
        .map((a) => str(a.positionCode));
};

// ----- Locks and counters -----

export async function withLock<T>(orgId: string, key: string, fn: () => Promise<T>): Promise<T> {
    const path = P(orgId).lock(enc(key));
    const existing = await getDoc(path);
    // A lock older than two minutes belongs to a request that died; it is released.
    if (existing && Date.now() - Date.parse(str(existing.data.at)) > 120_000) await deleteDoc(path);
    if (!(await writeDoc(path, { at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This is being updated by someone else. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}
export async function nextCounter(orgId: string, doc: string, field: string): Promise<number> {
    const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', {
        writes: [{ transform: { document: `${DOCUMENT_NAME_ROOT}/${P(orgId).counter(doc)}`, fieldTransforms: [{ fieldPath: field, increment: { integerValue: '1' } }] } }],
    });
    if (!res.ok) throw new HttpError(500, 'Could not assign the next number. Please try again.');
    const data = (await res.json()) as { writeResults?: Array<{ transformResults?: Array<{ integerValue?: string }> }> };
    const v = Number(data.writeResults?.[0]?.transformResults?.[0]?.integerValue);
    if (!Number.isInteger(v) || v < 1) throw new HttpError(500, 'Could not assign the next number. Please try again.');
    return v;
}

// ----- Atomic commit -----

export interface Write {
    path: string;
    fields?: Obj;
    mask?: string[];
    increments?: Record<string, number>;
    exists?: boolean;
    updateTime?: string;
}
/** All writes succeed together or none do. A precondition failure is reported as 409 so the caller can retry. */
export async function commit(writes: Write[]): Promise<void> {
    if (!writes.length) return;
    if (writes.length > 480) throw new HttpError(400, 'Too many changes in one posting. Split it.');
    const body = writes.map((w) => {
        const x: Record<string, unknown> = { update: { name: `${DOCUMENT_NAME_ROOT}/${w.path}`, fields: encodeFields((w.fields ?? {}) as unknown as Fields) } };
        if (w.mask) x.updateMask = { fieldPaths: w.mask };
        if (w.increments && Object.keys(w.increments).length) x.updateTransforms = Object.entries(w.increments).map(([k, v]) => ({ fieldPath: k, increment: Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v } }));
        if (w.updateTime) x.currentDocument = { updateTime: w.updateTime };
        else if (w.exists !== undefined) x.currentDocument = { exists: w.exists };
        return x;
    });
    const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', { writes: body });
    if (!res.ok) {
        if ([400, 404, 409].includes(res.status)) {
            let msg = '';
            try {
                msg = JSON.stringify(await res.json()).slice(0, 300);
            } catch {
                msg = '';
            }
            if (/FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND|ABORTED/.test(msg) || res.status === 409) throw new HttpError(409, 'Something changed at the same moment. Please try again.');
            console.error('Finance commit rejected', res.status, msg);
        }
        throw new HttpError(500, 'The posting could not be saved. Nothing was posted.');
    }
}

// ----- Settings and calendar -----

export const CAL_TYPES = [
    { code: 'month', label: 'Calendar months (12 periods)', weeks: null as number[] | null, note: 'Each period is a calendar month. The year starts on the 1st of the chosen month.' },
    { code: '445', label: '4-4-5 weeks (12 periods)', weeks: [4, 4, 5], note: 'Each quarter has periods of 4, 4 and 5 weeks.' },
    { code: '454', label: '4-5-4 weeks (12 periods)', weeks: [4, 5, 4], note: 'Each quarter has periods of 4, 5 and 4 weeks (retail, NRF).' },
    { code: '544', label: '5-4-4 weeks (12 periods)', weeks: [5, 4, 4], note: 'Each quarter has periods of 5, 4 and 4 weeks.' },
    { code: '13x4', label: '13 periods of 4 weeks', weeks: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], note: 'Thirteen equal periods of four weeks.' },
    { code: 'weekly', label: 'Weekly (52 or 53 periods)', weeks: Array(52).fill(1) as number[], note: 'Each period is one complete financial week; a 53rd week forms its own period.' },
    { code: 'quarterly', label: 'Quarterly (four 13-week periods)', weeks: [13, 13, 13, 13], note: 'Each period is a full 13-week quarter, with the possible 53rd week added as configured.' },
    { code: 'custom', label: 'Custom week pattern', weeks: [52], note: 'Specify positive whole weeks per accounting period, totaling 52. A 53rd week follows the chosen allocation rule.' },
];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Band {
    from: number;
    to: number | null;
    levels: string[];
}
export interface Settings {
    calendarType: string;
    yearStartMonth: number;
    yearNaming: 'start' | 'end';
    weekEndDay: number;
    yearEndRule: 'last' | 'nearest' | 'on_or_after';
    specialPeriods: number;
    extraWeekPeriod: number;
    customWeeks: number[];
    authority: Band[];
}
export const DEFAULT_SETTINGS: Settings = {
    calendarType: 'month',
    yearStartMonth: 1,
    yearNaming: 'start',
    weekEndDay: 6,
    yearEndRule: 'nearest',
    specialPeriods: 1,
    extraWeekPeriod: 0,
    customWeeks: [4,4,5,4,4,5,4,4,5,4,4,5],
    authority: [
        { from: 0, to: 100_000, levels: ['L1'] },
        { from: 100_000, to: 1_000_000, levels: ['L1', 'L2'] },
        { from: 1_000_000, to: 10_000_000, levels: ['L1', 'L2', 'L4'] },
        { from: 10_000_000, to: null, levels: ['L1', 'L2', 'L4', 'L5'] },
    ],
};
export function readSettings(raw: unknown): Settings {
    const s = o(raw);
    const ct = str(s.calendarType);
    if (!CAL_TYPES.some((c) => c.code === ct)) throw new HttpError(400, 'Choose the financial calendar type.');
    const m = Number(s.yearStartMonth);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new HttpError(400, 'Choose the month the financial year starts in.');
    const naming = str(s.yearNaming);
    if (!['start', 'end'].includes(naming)) throw new HttpError(400, 'Choose how years are named.');
    const wd = Number(s.weekEndDay);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new HttpError(400, 'Choose the last day of the week.');
    const rule = str(s.yearEndRule);
    if (!['last', 'nearest', 'on_or_after'].includes(rule)) throw new HttpError(400, 'Choose how the year end is fixed.');
    const sp = Number(s.specialPeriods);
    if (![0, 1].includes(sp)) throw new HttpError(400, 'Choose 0 or 1 year-end adjustment period.');
    const customWeeks = s.customWeeks === undefined ? DEFAULT_SETTINGS.customWeeks : (Array.isArray(s.customWeeks) ? s.customWeeks.map(Number) : []);
    if (!customWeeks.length || customWeeks.length > 52 || customWeeks.some(n=>!Number.isInteger(n)||n<1||n>52) || customWeeks.reduce((sum,n)=>sum+n,0)!==52)
        throw new HttpError(400, 'Custom accounting periods must contain positive whole weeks totaling exactly 52.');
    const totalPeriods = ct === '13x4' ? 13 : ct === 'weekly' ? 53 : ct === 'quarterly' ? 4 : ct === 'custom' ? customWeeks.length : 12;
    const extraWeekPeriod = s.extraWeekPeriod === undefined ? 0 : Number(s.extraWeekPeriod);
    if (!Number.isInteger(extraWeekPeriod) || extraWeekPeriod < 0 || extraWeekPeriod > totalPeriods) throw new HttpError(400, 'Choose which period receives a 53rd week, or leave automatic.');
    const bands = objs(s.authority).map((b, i): Band => {
        const from = Number(b.from);
        const to = b.to === null || b.to === undefined || b.to === '' ? null : Number(b.to);
        const levels = strs(b.levels).filter((x, k, a) => a.indexOf(x) === k);
        if (!Number.isFinite(from) || from < 0 || (to !== null && (!Number.isFinite(to) || to <= from))) throw new HttpError(400, `Approval band ${i + 1}: enter amounts that go up.`);
        if (!levels.length || levels.some((l) => !/^L[1-6]$/.test(l))) throw new HttpError(400, `Approval band ${i + 1}: choose 1 to 6 levels from L1 to L6.`);
        if (levels.some((l, k) => k > 0 && Number(l.slice(1)) <= Number(levels[k - 1].slice(1)))) throw new HttpError(400, `Approval band ${i + 1}: levels must go up in order.`);
        return { from: Math.round(from * 100) / 100, to: to === null ? null : Math.round(to * 100) / 100, levels };
    });
    if (!bands.length || bands.length > 10) throw new HttpError(400, 'Use 1 to 10 approval bands.');
    bands.forEach((b, i) => {
        if (i === 0 && b.from !== 0) throw new HttpError(400, 'The first approval band must start at 0.');
        if (i > 0 && b.from !== bands[i - 1].to) throw new HttpError(400, `Approval band ${i + 1} must start where band ${i} ends.`);
        if (i === bands.length - 1 && b.to !== null) throw new HttpError(400, 'The last approval band must have no upper limit.');
        if (i > 0 && b.levels.length < bands[i - 1].levels.length) throw new HttpError(400, `Approval band ${i + 1}: a higher amount cannot need fewer approvers.`);
    });
    return { calendarType: ct, yearStartMonth: m, yearNaming: naming as Settings['yearNaming'], weekEndDay: wd, yearEndRule: rule as Settings['yearEndRule'], specialPeriods: sp, extraWeekPeriod, customWeeks, authority: bands };
}

export interface Period {
    no: number;
    name: string;
    start: string;
    end: string;
    special: boolean;
    weeks: number | null;
    status: string;
    history: Obj[];
}
const DAY = 86_400_000;
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const parseIso = (s: string) => Date.parse(`${s}T00:00:00Z`);
const fmtShort = (t: number) => `${String(new Date(t).getUTCDate()).padStart(2, '0')} ${MONTHS[new Date(t).getUTCMonth()]}`;

/** The last day of week-based financial year `fy` (last or nearest week-end day to the end of the year-end month). */
function weekYearEnd(fy: number, s: Settings): number {
    const endMonth = s.yearStartMonth === 1 ? 12 : s.yearStartMonth - 1;
    const endYear = s.yearNaming === 'start' ? (s.yearStartMonth === 1 ? fy : fy + 1) : fy;
    const last = utc(endYear, endMonth + 1, 0);
    const back = (new Date(last).getUTCDay() - s.weekEndDay + 7) % 7;
    let d = last - back * DAY;
    if ((s.yearEndRule === 'nearest' && back >= 4) || (s.yearEndRule === 'on_or_after' && back > 0)) d += 7 * DAY;
    return d;
}

/** Periods of a financial year, accurate to the day. `prevEnd` (the stored end of the year before) keeps years continuous. */
export function buildYear(fy: number, s: Settings, prevEnd: string | null): { start: string; end: string; periods: Period[]; label: string; weeks: number | null } {
    const type = CAL_TYPES.find((c) => c.code === s.calendarType)!;
    const periods: Period[] = [];
    let start: number;
    let end: number;
    let totalWeeks: number | null = null;
    if (!type.weeks) {
        const sy = s.yearNaming === 'start' ? fy : s.yearStartMonth === 1 ? fy : fy - 1;
        start = utc(sy, s.yearStartMonth, 1);
        if (prevEnd && parseIso(prevEnd) + DAY !== start) throw new HttpError(409, `Financial year ${fy} would start on ${isoOf(start)}, but the year before ends on ${prevEnd}. Years must follow each other with no gap or overlap; keep the settings the earlier years used.`);
        for (let i = 0; i < 12; i++) {
            const y = sy + Math.floor((s.yearStartMonth - 1 + i) / 12);
            const m = ((s.yearStartMonth - 1 + i) % 12) + 1;
            const ps = utc(y, m, 1);
            const pe = utc(y, m + 1, 0);
            periods.push({ no: i + 1, name: `P${String(i + 1).padStart(2, '0')} · ${MONTHS[m - 1]} ${y}`, start: isoOf(ps), end: isoOf(pe), special: false, weeks: null, status: 'future', history: [] });
        }
        end = parseIso(periods[11].end);
    } else {
        end = weekYearEnd(fy, s);
        start = prevEnd ? parseIso(prevEnd) + DAY : weekYearEnd(fy - 1, s) + DAY;
        const days = Math.round((end - start) / DAY) + 1;
        totalWeeks = days / 7;
        if (!Number.isInteger(totalWeeks) || totalWeeks < 52 || totalWeeks > 53) throw new HttpError(409, `Financial year ${fy} would run ${days} days from ${isoOf(start)} to ${isoOf(end)}. A week-based year must be 52 or 53 whole weeks; check the week-end day and year-end rule against the earlier years.`);
        const pattern = s.calendarType==='custom' ? s.customWeeks.slice() : type.weeks.length === 3 ? [0, 1, 2, 3].flatMap(() => type.weeks!) : type.weeks.slice();
        if (totalWeeks === 53) {
            const desired = s.extraWeekPeriod || pattern.length;
            if (s.calendarType === 'weekly') pattern.push(1);
            else pattern[desired - 1] += 1;
        }
        let cur = start;
        let wk = 1;
        pattern.forEach((w, i) => {
            const pe = cur + w * 7 * DAY - DAY;
            periods.push({ no: i + 1, name: `P${String(i + 1).padStart(2, '0')} · W${wk}–W${wk + w - 1} (${fmtShort(cur)}–${fmtShort(pe)})`, start: isoOf(cur), end: isoOf(pe), special: false, weeks: w, status: 'future', history: [] });
            cur = pe + DAY;
            wk += w;
        });
        if (cur - DAY !== end) throw new HttpError(500, 'The periods do not add up to the year.');
    }
    if (s.specialPeriods === 1) periods.push({ no: periods.length + 1, name: `P${String(periods.length + 1).padStart(2, '0')} · Year-end adjustments`, start: isoOf(end), end: isoOf(end), special: true, weeks: null, status: 'future', history: [] });
    const sy = new Date(start).getUTCFullYear();
    const ey = new Date(end).getUTCFullYear();
    return { start: isoOf(start), end: isoOf(end), periods, label: sy === ey ? `FY ${fy}` : `FY ${fy} (${sy}/${String(ey).slice(2)})`, weeks: totalWeeks };
}

// ----- Entity, years, chart -----

export interface Entity {
    leId: string;
    status: string;
    functionalCurrency: string;
    settings: Settings | null;
    settingsVersion: number;
    goLiveAt: string;
    doc: Doc | null;
}
export const LE_STATUS: Record<string, string> = {
    not_live: 'Not live (setting up)',
    active: 'Live: open for posting',
    posting_blocked: 'Posting blocked',
    closed: 'Closed',
};
export async function entityOf(orgId: string, leId: string): Promise<Entity> {
    const doc = await getDoc(P(orgId).entity(leId));
    let settings: Settings | null = null;
    try {
        settings = doc && isObj(doc.data.settings) ? readSettings(doc.data.settings) : null;
    } catch {
        settings = null;
    }
    return { leId, status: str(doc?.data.status) || 'not_live', functionalCurrency: str(doc?.data.functionalCurrency), settings, settingsVersion: Number(doc?.data.settingsVersion) || 0, goLiveAt: str(doc?.data.goLiveAt), doc };
}

export interface Year {
    fy: number;
    label: string;
    start: string;
    end: string;
    status: string;
    periods: Period[];
    doc: Doc;
}
export async function yearsOf(orgId: string, leId: string): Promise<Year[]> {
    const docs = await runQuery({ from: [{ collectionId: 'fin_years' }], where: fieldEq('leId', leId) }, `organizations/${orgId}`);
    return docs
        .map((d) => ({ fy: Number(d.data.fy), label: str(d.data.label), start: str(d.data.start), end: str(d.data.end), status: str(d.data.status), periods: objs(d.data.periods) as unknown as Period[], doc: d }))
        .sort((a, b) => a.fy - b.fy);
}
/** The open (or, for period-end work, closing) period a date falls in. */
export function periodAt(years: Year[], date: string): { year: Year; period: Period } | null {
    for (const y of years) {
        if (y.status !== 'active' || date < y.start || date > y.end) continue;
        const p = y.periods.find((x) => !x.special && date >= x.start && date <= x.end);
        if (p) return { year: y, period: p };
    }
    return null;
}

export interface Account {
    code: string;
    name: string;
    classCode: string;
    className: string;
    categoryCode: string;
    categoryName: string;
    groupCode: string;
    groupName: string;
    normalBalance: string;
    accountType: string;
    accountRole: string;
    postingMode: string;
    statement: 'BS' | 'PL';
    postable: boolean;
    status: string;
    hasPostings: boolean;
    doc: Doc;
}
/** Balance sheet or profit and loss, from the account's type and class (falls back to the first digit of the class). */
export function statementOf(a: Obj): 'BS' | 'PL' {
    const t = `${str(a.accountType)} ${str(a.className)} ${str(a.categoryName)}`.toLowerCase();
    if (/(income|revenue|expense|cost of|costs|profit|loss|p&l|pl\b|cogs|depreciation charge)/.test(t)) return 'PL';
    if (/(asset|liabilit|equity|capital|reserve|balance|payable|receivable|inventory|bank|cash)/.test(t)) return 'BS';
    const d = Number(str(a.classCode).replace(/\D/g, '').charAt(0));
    return d >= 4 ? 'PL' : 'BS';
}
export const postableOf = (a: Obj) => !/(header|summary|total|non[-_ ]?post|no[-_ ]?post|title|heading|group)/i.test(str(a.postingMode));
export const normalOf = (a: Obj) => (/^c|credit/i.test(str(a.normalBalance)) ? 'credit' : 'debit');

export function accountOut(d: Doc): Account {
    const x = d.data;
    return {
        code: str(x.code),
        name: str(x.name),
        classCode: str(x.classCode),
        className: str(x.className),
        categoryCode: str(x.categoryCode),
        categoryName: str(x.categoryName),
        groupCode: str(x.groupCode),
        groupName: str(x.groupName),
        normalBalance: str(x.normalBalance),
        accountType: str(x.accountType),
        accountRole: str(x.accountRole),
        postingMode: str(x.postingMode),
        statement: str(x.statement) === 'PL' ? 'PL' : 'BS',
        postable: x.postable !== false,
        status: str(x.status),
        hasPostings: x.hasPostings === true,
        doc: d,
    };
}
export async function chartOf(orgId: string, leId: string): Promise<Map<string, Account>> {
    const docs = await runQuery({ from: [{ collectionId: 'fin_accounts' }], where: fieldEq('leId', leId) }, `organizations/${orgId}`);
    return new Map(docs.map((d) => [str(d.data.code), accountOut(d)]));
}

// ----- Account determination (mapping) -----

export const ROLES: Array<{ code: string; label: string; statement: 'BS' | 'PL'; required: boolean; note: string }> = [
    { code: 'INVENTORY', label: 'Inventory (stock on hand)', statement: 'BS', required: true, note: 'Debited on goods receipt into a warehouse, credited on issue.' },
    { code: 'GRIR', label: 'Goods and services received not invoiced (GR/IR)', statement: 'BS', required: true, note: 'Credited on every receipt and service acceptance; cleared by the supplier invoice in Accounts Payable.' },
    { code: 'CONSUMPTION', label: 'Material consumption', statement: 'PL', required: true, note: 'Debited when stock is issued to a cost center.' },
    { code: 'MAINT_CONSUMPTION', label: 'Maintenance spares consumption', statement: 'PL', required: false, note: 'Debited when stock is issued to a work order. Falls back to material consumption.' },
    { code: 'ASSET_CLEARING', label: 'Assets received (clearing)', statement: 'BS', required: true, note: 'Debited when an asset is received, until Asset Finance capitalises it.' },
    { code: 'OPENING_BALANCE', label: 'Opening balance clearing', statement: 'BS', required: true, note: 'Credited when stock that existed at go-live is valued.' },
    { code: 'STOCK_DIFF', label: 'Stock count differences', statement: 'PL', required: true, note: 'Stock take losses and gains.' },
    { code: 'RECON_DIFF', label: 'Reconciliation differences', statement: 'PL', required: true, note: 'Approved differences found by period-end reconciliation.' },
    { code: 'RETAINED_EARNINGS', label: 'Retained earnings', statement: 'BS', required: true, note: 'Receives the profit or loss when the year is closed.' },
    { code: 'VAT_INPUT', label: 'VAT recoverable (input)', statement: 'BS', required: false, note: 'Used by Accounts Payable invoices (not built yet).' },
    { code: 'VAT_OUTPUT', label: 'VAT payable (output)', statement: 'BS', required: false, note: 'Used by Accounts Receivable invoices (not built yet).' },
    { code: 'WHT_PAYABLE', label: 'Withholding tax payable', statement: 'BS', required: false, note: 'Used by Accounts Payable payments (not built yet).' },
];
export const TXNS: Array<{ code: string; label: string; debit: string; credit: string; live: boolean; taxStage: string; source: string }> = [
    { code: 'GR_STOCK', label: 'Goods receipt into a warehouse', debit: 'INVENTORY', credit: 'GRIR', live: true, taxStage: 'purchase', source: 'Purchase order delivery' },
    { code: 'GR_DIRECT', label: 'Goods receipt direct to a cost center', debit: 'Line GL account', credit: 'GRIR', live: true, taxStage: 'purchase', source: 'Purchase order delivery' },
    { code: 'GR_ASSET', label: 'Asset receipt', debit: 'ASSET_CLEARING', credit: 'GRIR', live: true, taxStage: 'purchase', source: 'Purchase order delivery' },
    { code: 'SVC_ACCEPT', label: 'Service accepted by the cost center owner', debit: 'Line GL account', credit: 'GRIR', live: true, taxStage: 'purchase', source: 'Service receipt' },
    { code: 'GI_CC', label: 'Goods issue to a cost center', debit: 'CONSUMPTION', credit: 'INVENTORY', live: true, taxStage: '', source: 'Goods issue' },
    { code: 'GI_WO', label: 'Goods issue to a work order', debit: 'MAINT_CONSUMPTION', credit: 'INVENTORY', live: true, taxStage: '', source: 'Goods issue' },
    { code: 'ST_ADJ', label: 'Stock take difference', debit: 'STOCK_DIFF (loss) / INVENTORY (gain)', credit: 'INVENTORY (loss) / STOCK_DIFF (gain)', live: true, taxStage: '', source: 'Stock take posting' },
    { code: 'STK_OPEN', label: 'Opening stock valuation', debit: 'INVENTORY', credit: 'OPENING_BALANCE', live: true, taxStage: '', source: 'Approved valuation' },
    { code: 'INV_RECON', label: 'Inventory reconciliation adjustment', debit: 'INVENTORY / RECON_DIFF', credit: 'RECON_DIFF / INVENTORY', live: true, taxStage: '', source: 'Approved reconciliation' },
    { code: 'REALLOC', label: 'Cost reallocation between cost centers', debit: 'Same account, receiving cost centers', credit: 'Same account, sending cost center', live: true, taxStage: '', source: 'Approved reallocation' },
    { code: 'YE_CLOSE', label: 'Year-end close of profit and loss', debit: 'P&L accounts / RETAINED_EARNINGS', credit: 'RETAINED_EARNINGS / P&L accounts', live: true, taxStage: '', source: 'Approved year-end close' },
    { code: 'AP_INVOICE', label: 'Supplier invoice (Accounts Payable)', debit: 'GRIR + VAT_INPUT', credit: 'Supplier payable', live: false, taxStage: 'purchase', source: 'Accounts Payable (not built yet)' },
    { code: 'AR_INVOICE', label: 'Customer invoice (Accounts Receivable)', debit: 'Customer receivable', credit: 'Revenue + VAT_OUTPUT', live: false, taxStage: 'sale', source: 'Accounts Receivable (not built yet)' },
];
export const TXN_LABEL: Record<string, string> = Object.fromEntries(TXNS.map((t) => [t.code, t.label]));

export interface Mapping {
    roles: Record<string, string>;
    byCategory: Record<string, { INVENTORY?: string; CONSUMPTION?: string }>;
    rules: AccountRule[];
    version: number;
}
export async function mappingOf(orgId: string, leId: string): Promise<Mapping> {
    const d = await getDoc(P(orgId).mapping(leId));
    const roles: Record<string, string> = {};
    for (const [k, v] of Object.entries(o(d?.data.roles))) if (str(v)) roles[k] = str(v);
    const byCategory: Mapping['byCategory'] = {};
    for (const [k, v] of Object.entries(o(d?.data.byCategory))) byCategory[k] = { INVENTORY: str(o(v).INVENTORY) || undefined, CONSUMPTION: str(o(v).CONSUMPTION) || undefined };
    let rules:AccountRule[]=[];
    try {rules=validateRuleDraft(d?.data.rules??[]);}catch {rules=[];}
    return { roles, byCategory, rules, version: Number(d?.data.version) || 0 };
}
/** Accounts that only the system posts to: they can never be chosen by people on a requirement or line. */
export function systemAccounts(m: Mapping): Set<string> {
    const s = new Set(Object.values(m.roles));
    for (const rule of m.rules??[]) if (rule.enabled) s.add(rule.account);
    for (const v of Object.values(m.byCategory)) {
        if (v.INVENTORY) s.add(v.INVENTORY);
        if (v.CONSUMPTION) s.add(v.CONSUMPTION);
    }
    return s;
}
export function roleAccount(m: Mapping, role: string, categoryCode = '', context:DeterminationContext = {}): string {
    const eventRule=resolveAccountRule(m.rules??[],role,{...context,categoryCode:context.categoryCode||categoryCode});
    if(eventRule)return eventRule.account;
    const cat = categoryCode ? m.byCategory[categoryCode] : undefined;
    if (role === 'INVENTORY' && cat?.INVENTORY) return cat.INVENTORY;
    if ((role === 'CONSUMPTION' || role === 'MAINT_CONSUMPTION') && cat?.CONSUMPTION && !(role === 'MAINT_CONSUMPTION' && m.roles.MAINT_CONSUMPTION)) return cat.CONSUMPTION;
    const code = m.roles[role] || (role === 'MAINT_CONSUMPTION' ? m.roles.CONSUMPTION : '');
    if (!code) throw new HttpError(409, `Finance has not mapped the ${ROLES.find((r) => r.code === role)?.label ?? role} account for this legal entity (Finance > GL Accounts > Mapping).`);
    return code;
}

// ----- Cost centers -----

export interface CcFin {
    status: string;
    allowedGl: string[];
    /** Transaction codes switched off for this cost center (approved with FIN.cc.approve; enforced at posting). */
    txnOff: string[];
    version: number;
}
export async function ccFinOf(orgId: string, ccId: string): Promise<CcFin> {
    const d = await getDoc(P(orgId).cc(ccId));
    return { status: str(d?.data.status) || 'open', allowedGl: strs(d?.data.allowedGl), txnOff: strs(d?.data.txnOff), version: Number(d?.data.version) || 0 };
}
export const CC_STATUS: Record<string, string> = { open: 'Open for posting', blocked: 'Blocked for posting', closed: 'Closed' };

/**
 * GL accounts people may choose for a cost center (requirements, services, direct purchases): approved and active in the
 * chart of the cost center's legal entity, open for posting, not a system control account, and within the cost center's
 * account restriction when it has one.
 */
export async function choosableAccounts(orgId: string, ccId: string): Promise<{ le: Unit; accounts: Account[] }> {
    const units = await unitsOf(orgId);
    const cc = units.get(ccId);
    if (!cc || cc.level !== 'cost_center') throw new HttpError(400, 'Choose a cost center first.');
    const le = leOf(units, ccId);
    if (!le) throw new HttpError(409, 'The cost center is not under a legal entity.');
    await syncDefaultChart(orgId, le.id);
    const [chart, map, fin, entity] = await Promise.all([chartOf(orgId, le.id), mappingOf(orgId, le.id), ccFinOf(orgId, ccId), entityOf(orgId, le.id)]);
    const sys = systemAccounts(map);
    const allowed = new Set(fin.allowedGl);
    const accounts = Array.from(chart.values()).filter((a) => a.status === 'active' && a.postable && !sys.has(a.code) && (entity.doc?.data.glScopeConfigured !== true || strs(entity.doc.data.allowedGl).includes(a.code)) && (!allowed.size || a.statement === 'BS' || allowed.has(a.code)));
    return { le, accounts: accounts.sort((a, b) => a.code.localeCompare(b.code)) };
}
/** Throws with a plain reason unless the GL account may be used on this cost center. */
export async function checkChosenGl(orgId: string, ccId: string, glCode: string, at = ''): Promise<{ code: string; name: string; leId: string }> {
    const { le, accounts } = await choosableAccounts(orgId, ccId);
    const a = accounts.find((x) => x.code === glCode);
    if (a) return { code: a.code, name: a.name, leId: le.id };
    if (!accounts.length) throw new HttpError(409, `${at}${le.code} ${le.name} has no GL accounts available: the MEMS GL account master may not be loaded yet. Ask MEMS support.`);
    throw new HttpError(400, `${at}GL account ${glCode || '(none)'} is not an approved, open account for this cost center in ${le.code}. Choose one from the list.`);
}

// ----- FX -----

export async function fxRate(from: string, to: string): Promise<number> {
    if (!from || !to) throw new HttpError(409, 'A currency is missing, so the amount cannot be converted.');
    if (from === to) return 1;
    const doc = await getDoc('reference/currencies');
    const items = Array.isArray(doc?.data.items) ? doc!.data.items.filter(isObj) : [];
    const rate = (c: string) => Number(items.find((x) => str(x.code) === c)?.unitsPerUsd) || 0;
    const f = rate(from);
    const t = rate(to);
    if (!(f > 0) || !(t > 0)) throw new HttpError(409, `There is no exchange rate between ${from} and ${to}. Ask MEMS to refresh the currency list.`);
    return Math.round((t / f) * 1e6) / 1e6;
}

// ----- Posting engine -----

export interface PostLine {
    side: 'D' | 'C';
    glCode: string;
    ccId: string;
    amount: number;
    docAmount?: number;
    description: string;
    materialId?: string;
    qty?: number;
    ref?: string;
}
export interface StockMove {
    warehouseId: string;
    materialId: string;
    materialNumber: string;
    qty: number;
    value: number;
    expectedUpdateTime: string | null;
    /** Inventory account the stock is carried in (used by reconciliation). */
    glCode?: string;
}
export interface PostInput {
    leId: string;
    type: string;
    date?: string;
    period?: { fy: number; no: number };
    docCurrency: string;
    fxRate: number;
    lines: PostLine[];
    narrative: string;
    source: { kind: string; id: string; ref: string; route: string };
    trace?: Obj;
    sourceKey: string;
    approvalRef?: string;
    stock?: StockMove[];
    extra?: Write[];
    /** Strict source-linked writes evaluated after the journal ID exists, in the same GL commit. */
    extraForJournal?: (journalId:string)=>Promise<Write[]>;
}
export interface Posted {
    id: string;
    reused: boolean;
    fy: number;
    period: number;
}

export type FinState = 'not_live' | 'live' | 'blocked';
export async function financeState(orgId: string, leId: string): Promise<FinState> {
    const e = await entityOf(orgId, leId);
    if (e.status === 'active') return 'live';
    if (e.status === 'not_live') return 'not_live';
    return 'blocked';
}

const PERIOD_END_TYPES = ['INV_RECON', 'REALLOC', 'YE_CLOSE'];

/** MEMS-wide GL account transaction settings (MEMS administration; super admin only). */
export const MEMS_GLTXN_DOC = 'platform_config/gl_transaction_map';

/** Approved override items ({account, add, remove}) of a document, as a lookup by account. */
export function overridesOf(raw: unknown): Overrides {
    const out: Overrides = {};
    for (const it of Array.isArray(raw) ? raw : []) {
        const x = o(it);
        const account = str(x.account);
        if (!account) continue;
        out[account] = {
            add: objs(x.add).map((h) => ({ code: str(h.code), side: (['Dr', 'Cr', 'Dr/Cr'].includes(str(h.side)) ? str(h.side) : 'Dr/Cr') as Side })).filter((h) => h.code),
            remove: strs(x.remove),
        };
    }
    return out;
}
export function overridesToItems(ov: Overrides): Obj[] {
    return Object.entries(ov).sort(([a], [b]) => a.localeCompare(b)).map(([account, v]) => ({ account, add: v.add as unknown as Obj[], remove: v.remove } as unknown as Obj));
}

/** Explicit transaction removals per account: MEMS default changes, then the legal entity's approved changes. */
async function glTxnRemovals(orgId: string, leId: string): Promise<(account: string) => Set<string>> {
    const [mems, le] = await Promise.all([getDoc(MEMS_GLTXN_DOC), getDoc(P(orgId).gltxn(leId))]);
    const a = overridesOf(mems?.data.items);
    const b = overridesOf(le?.data.items);
    return (account: string) => removedCodes(account, a, b);
}

/** Validates and posts one journal entry with its balances (and stock valuation) in a single atomic commit. */
export async function post(ctx: OrgContext, input: PostInput): Promise<Posted> {
    const keyId = hashKey(`${input.sourceKey}`);
    for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await getDoc(P(ctx.orgId).postkey(keyId));
        if (existing) {
            if(input.extraForJournal)throw new HttpError(409,'A source-linked GL journal already exists. Reopen the source record for reconciliation; no budget or PO updates were made.');
            return { id: str(existing.data.journalId), reused: true, fy: Number(existing.data.fy), period: Number(existing.data.period) };
        }
        try {
            return await postOnce(ctx, input, keyId);
        } catch (e) {
            if (e instanceof HttpError && e.status === 409 && /same moment/.test(e.message) && attempt < 2) continue;
            throw e;
        }
    }
    throw new HttpError(409, 'The ledger is busy. Please try again.');
}

async function postOnce(ctx: OrgContext, input: PostInput, keyId: string): Promise<Posted> {
    const orgId = ctx.orgId;
    const paths = P(orgId);
    const [entity, years, chart, units] = await Promise.all([entityOf(orgId, input.leId), yearsOf(orgId, input.leId), chartOf(orgId, input.leId), unitsOf(orgId)]);
    const le = units.get(input.leId);
    if (!le || le.level !== 'legal_entity') throw new HttpError(409, 'The legal entity of this posting was not found.');
    if (entity.status !== 'active') throw new HttpError(409, `Finance for ${le.code} ${le.name} is ${LE_STATUS[entity.status] ?? entity.status}. Nothing can be posted.`);
    if (!entity.functionalCurrency) throw new HttpError(409, `${le.code} has no functional currency in finance.`);

    // Period
    const isPeriodEnd = PERIOD_END_TYPES.includes(input.type);
    let year: Year | undefined;
    let period: Period | undefined;
    let date = input.date || today();
    if (input.period) {
        year = years.find((y) => y.fy === input.period!.fy && y.status === 'active');
        period = year?.periods.find((p) => p.no === input.period!.no);
        if (!year || !period) throw new HttpError(409, 'That period does not exist or its year is not active.');
        date = period.end;
        const ok = isPeriodEnd ? ['open', 'closing'].includes(period.status) : period.status === 'open';
        if (!ok) throw new HttpError(409, `${period.name} of ${year.label} is ${period.status}. ${isPeriodEnd ? 'Period-end postings need it open or in closing.' : 'It must be open.'}`);
    } else {
        const at = periodAt(years, date);
        if (!at) throw new HttpError(409, `No active financial period covers ${date} in ${le.code}. Finance must initialise the financial year (Finance > Financial Calendar).`);
        year = at.year;
        period = at.period;
        if (period.status !== 'open') throw new HttpError(409, `${period.name} of ${year.label} is ${period.status}. Postings dated ${date} need the period open. Ask finance to open it.`);
    }

    // Lines
    if (!input.lines.length || input.lines.length > 300) throw new HttpError(400, 'A journal entry needs 1 to 300 lines.');
    const [map, glTxn] = await Promise.all([mappingOf(orgId, input.leId), glTxnRemovals(orgId, input.leId)]);
    const sys = systemAccounts(map);
    const ccCache = new Map<string, CcFin>();
    // Transactions that may post this entry (from the posting catalogue). An account or cost center that has had all of
    // them explicitly removed or switched off (approved changes) refuses the line. Unknown types are not restricted.
    const txnCodes = POSTING_EVENTS.find((x) => x.event === input.type)?.codes ?? [];
    const lines: Obj[] = [];
    let dr = 0;
    let cr = 0;
    for (const [i, l] of input.lines.entries()) {
        const amountC = cents(l.amount);
        if (!(amountC > 0)) throw new HttpError(400, `Line ${i + 1}: the amount must be more than zero.`);
        const acc = chart.get(l.glCode);
        if (!acc) throw new HttpError(409, `GL account ${l.glCode} is not in the approved chart of accounts of ${le.code}.`);
        if (acc.status !== 'active') throw new HttpError(409, `GL account ${acc.code} ${acc.name} is ${acc.status} in ${le.code}.`);
        if (entity.doc?.data.glScopeConfigured === true && !strs(entity.doc.data.allowedGl).includes(acc.code)) throw new HttpError(409, `GL account ${acc.code} is not included in the approved account selection for ${le.code}.`);
        if (!acc.postable) throw new HttpError(409, `GL account ${acc.code} ${acc.name} is a heading and cannot take postings.`);
        if (txnCodes.length) {
            const removed = glTxn(acc.code);
            if (txnCodes.every((c) => removed.has(c))) throw new HttpError(409, `GL account ${acc.code} ${acc.name} is not open to ${txnCodes.join(' / ')} in ${le.code} (approved GL account transaction settings).`);
        }
        let ccCode = '';
        let ccName = '';
        if (l.ccId) {
            const cc = units.get(l.ccId);
            if (!cc || cc.level !== 'cost_center') throw new HttpError(409, `Cost center ${l.ccId} was not found.`);
            if (leOf(units, cc.id)?.id !== input.leId) throw new HttpError(409, `Cost center ${cc.code} does not belong to ${le.code}.`);
            if (cc.status === 'inactive') throw new HttpError(409, `Cost center ${cc.code} ${cc.name} is inactive.`);
            const f = ccCache.get(cc.id) ?? (await ccFinOf(orgId, cc.id));
            ccCache.set(cc.id, f);
            if (f.status !== 'open') throw new HttpError(409, `Cost center ${cc.code} ${cc.name} is ${CC_STATUS[f.status] ?? f.status}.`);
            if (f.allowedGl.length && acc.statement === 'PL' && !sys.has(acc.code) && !f.allowedGl.includes(acc.code)) throw new HttpError(409, `GL account ${acc.code} is not allowed on cost center ${cc.code}.`);
            if (txnCodes.length && txnCodes.every((c) => f.txnOff.includes(c))) throw new HttpError(409, `${txnCodes.join(' / ')} is switched off for cost center ${cc.code} ${cc.name}.`);
            ccCode = cc.code;
            ccName = cc.name;
        } else if (acc.statement === 'PL') throw new HttpError(409, `Profit and loss account ${acc.code} needs a cost center.`);
        if (l.side === 'D') dr += amountC;
        else cr += amountC;
        lines.push({ no: i + 1, side: l.side, glCode: acc.code, glName: acc.name, statement: acc.statement, ccId: l.ccId, ccCode, ccName, amount: amountC / 100, docAmount: l.docAmount ?? null, description: l.description.slice(0, 200), materialId: l.materialId ?? '', qty: l.qty ?? null, ref: l.ref ?? '' });
    }
    if (dr !== cr) throw new HttpError(500, `The entry does not balance (debits ${dr / 100}, credits ${cr / 100}). Nothing was posted.`);

    // Number: legal entity code, financial year, sequence from the database.
    const seq = await nextCounter(orgId, input.leId, `y${year.fy}`);
    if (seq > 99_999_999) throw new HttpError(500, 'The journal number range for this year is exhausted.');
    const id = `${le.code}-${year.fy}-${String(seq).padStart(8, '0')}`;
    const at = nowIso();
    const writes: Write[] = [];
    // The year document is touched with its read time, so a period cannot close while this posting is being saved.
    writes.push({ path: paths.year(input.leId, year.fy), fields: { lastPostingAt: at }, mask: ['lastPostingAt'], updateTime: year.doc.updateTime });
    writes.push({
        path: paths.journal(id),
        exists: false,
        fields: {
            id,
            leId: input.leId,
            leCode: le.code,
            fy: year.fy,
            period: period.no,
            periodName: period.name,
            postingDate: date,
            type: input.type,
            typeLabel: TXN_LABEL[input.type] ?? input.type,
            narrative: input.narrative.slice(0, 300),
            currency: entity.functionalCurrency,
            docCurrency: input.docCurrency || entity.functionalCurrency,
            fxRate: input.fxRate,
            lines,
            totalDebit: dr / 100,
            totalCredit: cr / 100,
            ccIds: Array.from(new Set(input.lines.map((l) => l.ccId).filter(Boolean))),
            glCodes: Array.from(new Set(input.lines.map((l) => l.glCode))),
            source: input.source,
            trace: input.trace ?? {},
            sourceKey: input.sourceKey.slice(0, 300),
            approvalRef: input.approvalRef ?? '',
            mappingVersion: map.version,
            postedBy: ctx.uid,
            postedByName: nameOf(ctx.me),
            postedAt: at,
        },
    });
    writes.push({ path: paths.postkey(keyId), exists: false, fields: { journalId: id, fy: year.fy, period: period.no, sourceKey: input.sourceKey.slice(0, 300), at } });
    // Balances in integer cents, per period, account and cost center.
    const bal = new Map<string, { gl: string; cc: string; dr: number; cr: number }>();
    for (const l of lines) {
        const k = `${str(l.glCode)}|${str(l.ccId)}`;
        const b = bal.get(k) ?? { gl: str(l.glCode), cc: str(l.ccId), dr: 0, cr: 0 };
        if (l.side === 'D') b.dr += cents(Number(l.amount));
        else b.cr += cents(Number(l.amount));
        bal.set(k, b);
    }
    for (const b of bal.values()) {
        const bid = `${input.leId}_${year.fy}_${String(period.no).padStart(2, '0')}_${enc(b.gl)}_${b.cc || 'NOCC'}`;
        writes.push({ path: paths.bal(bid), fields: { leId: input.leId, fy: year.fy, period: period.no, glCode: b.gl, ccId: b.cc }, mask: ['leId', 'fy', 'period', 'glCode', 'ccId'], increments: { drC: b.dr, crC: b.cr } });
    }
    // Accounts used: marked as having postings (they can never be blocked or removed afterwards).
    for (const code of new Set(lines.map((l) => str(l.glCode)))) {
        const acc = chart.get(code)!;
        writes.push({ path: acc.doc.id ? `${paths.accounts}/${acc.doc.id}` : paths.account(input.leId, code), fields: { hasPostings: true, lastPostedAt: at }, mask: ['hasPostings', 'lastPostedAt'], updateTime: acc.doc.updateTime });
    }
    // Stock valuation moves, guarded by the read time of each valuation record.
    for (const s of input.stock ?? []) {
        const fields: Obj = { leId: input.leId, warehouseId: s.warehouseId, materialId: s.materialId, materialNumber: s.materialNumber, lastJournal: id, updatedAt: at };
        if (s.glCode) fields.glCode = s.glCode;
        // The cost of the latest receipt is kept to value a counted gain when nothing is left in stock.
        if (s.qty > 0 && s.value > 0) fields.lastAvg = Math.round((s.value / s.qty) * 10000) / 10000;
        const w: Write = { path: paths.stock(s.warehouseId, s.materialId), fields, mask: Object.keys(fields), increments: { qtyM: Math.round(s.qty * 10000), valueC: cents(s.value) } };
        if (s.expectedUpdateTime) w.updateTime = s.expectedUpdateTime;
        else w.exists = false;
        writes.push(w);
    }
    for (const x of input.extra ?? []) writes.push(x);
    if(input.extraForJournal)writes.push(...await input.extraForJournal(id));
    await commit(writes);
    try {
        await record(ctx, 'org.finance.journal.post', id, `${TXN_LABEL[input.type] ?? input.type}: ${entity.functionalCurrency} ${(dr / 100).toFixed(2)}; ${input.source.kind} ${input.source.id}${input.approvalRef ? `; approval ${input.approvalRef}` : ''}`.slice(0, 400));
    } catch(e) {
        if(!input.extraForJournal)throw e;
        console.error('Atomic GL+PO journal committed but secondary audit logging requires reconciliation',id,e instanceof Error?e.message:'unknown');
    }
    return { id, reused: false, fy: year.fy, period: period.no };
}

// ----- Stock valuation -----

export interface StockVal {
    qty: number;
    value: number;
    avg: number;
    updateTime: string | null;
    lastAvg: number;
}
export async function stockValOf(orgId: string, warehouseId: string, materialId: string): Promise<StockVal> {
    const d = await getDoc(P(orgId).stock(warehouseId, materialId));
    const qty = (Number(d?.data.qtyM) || 0) / 10000;
    const value = (Number(d?.data.valueC) || 0) / 100;
    const lastAvg = Number(d?.data.lastAvg) || 0;
    return { qty, value, avg: qty > 0 ? value / qty : lastAvg, updateTime: d ? d.updateTime : null, lastAvg };
}
/** Value of `qty` taken out of stock at moving average. Taking the whole quantity takes the whole value (no residue). */
export function issueValue(v: StockVal, qty: number): number {
    if (qty > v.qty + 1e-9) throw new HttpError(409, `Only ${round4(v.qty)} is valued in finance for this material, less than the ${round4(qty)} needed.`);
    if (Math.abs(qty - v.qty) < 1e-9) return round2(v.value);
    return round2((v.value * qty) / v.qty);
}

/** Physical stock of a material in a warehouse, from the posted inventory journal. */
export async function physicalOf(orgId: string, warehouseId: string, materialId: string): Promise<{ physical: number; available: number }> {
    const docs = await runQuery({ from: [{ collectionId: 'material_journal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('materialId', materialId), fieldEq('warehouseId', warehouseId)] } } }, `organizations/${orgId}`);
    const t: Record<string, number> = {};
    for (const d of docs) {
        if (str(d.data.status) !== 'posted') continue;
        for (const [k, v] of Object.entries(o(d.data.balancesDelta))) t[k] = (t[k] || 0) + (Number(v) || 0);
    }
    const physical = round4(t.physicalStock || 0);
    const available = round4(physical - (t.reservedStock || 0) - (t.quarantinedStock || 0) - (t.damagedStock || 0) - (t.expiredStock || 0) - (t.other || 0));
    return { physical, available };
}

/** Is the material linked to the warehouse (master data). */
export async function materialIn(orgId: string, materialId: string, warehouseId: string): Promise<Doc | null> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(materialId)) return null;
    const m = await getDoc(`organizations/${orgId}/materials/${materialId}`);
    if (!m || !str(m.data.materialNumber)) return null;
    const ids = strs(m.data.warehouseIds);
    if (ids.includes(warehouseId) || (str(m.data.pushedAt) && str(m.data.warehouseId) === warehouseId)) return m;
    const ext = await runQuery({ from: [{ collectionId: 'material_extensions' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('sourceId', materialId), fieldEq('warehouseId', warehouseId)] } } }, `organizations/${orgId}`);
    return ext.some((x) => str(x.data.status) === 'approved') ? m : null;
}

// ----- Maker-checker requests -----

export interface Step {
    level: string;
    title: string;
    positionCode: string;
    positionTitle: string;
    status: string;
    by: string;
    byName: string;
    at: string;
    note: string;
}
export interface Handler {
    label: string;
    approvePerm: string;
    /** Value-bearing requests are approved level by level under the finance chart of authority. */
    valued?: boolean;
    apply: (ctx: OrgContext, req: Obj, id: string) => Promise<Obj>;
}
export const HANDLERS: Record<string, Handler> = {};
export const registerHandler = (type: string, h: Handler) => {
    HANDLERS[type] = h;
};

/** Approval steps for an amount: each level of the legal entity's finance bands, resolved to the job role mapped to it. */
async function stepsFor(ctx: OrgContext, leId: string, amount: number): Promise<{ steps: Step[]; problems: string[] }> {
    const [entity, authority, positions, users] = await Promise.all([entityOf(ctx.orgId, leId), getAuthority(ctx.orgId), listDocs(`organizations/${ctx.orgId}/positions`), orgUsers(ctx.orgId)]);
    const bands = (entity.settings ?? DEFAULT_SETTINGS).authority;
    const band = bands.find((b) => amount >= b.from && (b.to === null || amount < b.to)) ?? bands[bands.length - 1];
    const pos = new Map(positions.map((p) => [p.id, { title: str(p.data.title), parentCode: str(p.data.parentCode) }]));
    const mine = activePositions(ctx.me);
    const problems: string[] = [];
    const steps: Step[] = [];
    for (const lv of band.levels) {
        const def = authority.levels.find((l) => l.code === lv);
        let code = def?.positionCode ?? '';
        if (!code && lv === 'L1') code = pos.get(mine[0] ?? '')?.parentCode ?? '';
        if (!code) {
            problems.push(`Approval level ${lv} (${def?.title ?? lv}) is not mapped to a job role. Map it in Procurement > Setup > Authority limits, or assign yourself a job role with a manager.`);
            continue;
        }
        const holders = users.filter((u) => u.id !== ctx.uid && str(u.data.status) !== 'disabled' && activePositions(u).includes(code)).length;
        if (!holders) problems.push(`Nobody other than you holds ${pos.get(code)?.title ?? code}, which approves level ${lv}.`);
        steps.push({ level: lv, title: def?.title ?? lv, positionCode: code, positionTitle: pos.get(code)?.title ?? code, status: 'pending', by: '', byName: '', at: '', note: '' });
    }
    return { steps, problems };
}

export async function createRequest(ctx: OrgContext, r: { leId: string; type: string; title: string; summary: string; payload: Obj; reason: string; amount?: number; scopeKey: string }): Promise<{ id: string }> {
    const h = HANDLERS[r.type];
    if (!h) throw new HttpError(500, 'Unknown request type.');
    // One open request per subject, so two people cannot propose conflicting changes at once.
    const open = await runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('scopeKey', r.scopeKey) }, `organizations/${ctx.orgId}`);
    const pending = open.find((x) => str(x.data.status) === 'pending');
    if (pending) throw new HttpError(409, `${pending.id} for the same subject is already waiting for approval. Approve, reject or withdraw it first.`);
    let steps: Step[] = [{ level: 'A', title: 'Approver', positionCode: '', positionTitle: `Holder of ${h.approvePerm}`, status: 'pending', by: '', byName: '', at: '', note: '' }];
    if (h.valued) {
        const s = await stepsFor(ctx, r.leId, Math.abs(r.amount ?? 0));
        if (s.problems.length) throw new HttpError(409, s.problems.join(' '));
        steps = s.steps;
    }
    const n = await nextCounter(ctx.orgId, 'requests', 'seq');
    const id = `FCR${String(n).padStart(8, '0')}`;
    const at = nowIso();
    const ok = await writeDoc(
        P(ctx.orgId).request(id),
        {
            id,
            leId: r.leId,
            type: r.type,
            typeLabel: h.label,
            title: r.title.slice(0, 160),
            summary: r.summary.slice(0, 1500),
            payload: r.payload,
            reason: r.reason,
            amount: r.amount ?? null,
            scopeKey: r.scopeKey,
            status: 'pending',
            approvePerm: h.approvePerm,
            steps,
            makerUid: ctx.uid,
            makerName: nameOf(ctx.me),
            createdAt: at,
            history: [{ at, by: ctx.uid, byName: nameOf(ctx.me), action: 'submitted', note: r.reason }],
        } as unknown as Fields,
        { exists: false }
    );
    if (!ok) throw new HttpError(409, 'Could not save the request. Please try again.');
    await record(ctx, `org.finance.request.${r.type}`, id, `${h.label}: ${r.title}. Reason: ${r.reason}`.slice(0, 400));
    return { id };
}

/** Why this person cannot decide the request now ('' when they can). */
export function cannotDecide(ctx: OrgContext, req: Obj, units: Map<string, Unit>, scope: Scope): string {
    if (str(req.status) !== 'pending') return 'This request is not waiting for a decision.';
    if (str(req.makerUid) === ctx.uid) return 'You submitted this request, so someone else must decide it.';
    if (!permAt(ctx, str(req.approvePerm), str(req.leId), units, scope)) return `Deciding needs ${str(req.approvePerm)} for this legal entity.`;
    const steps = objs(req.steps) as unknown as Step[];
    const step = steps.find((s) => s.status === 'pending');
    if (!step) return 'Nothing left to approve.';
    if (step.positionCode && !activePositions(ctx.me).includes(step.positionCode)) return `Level ${step.level} is approved by ${step.positionTitle}.`;
    if (steps.some((s) => s.status === 'approved' && s.by === ctx.uid)) return 'You approved an earlier level, so a different person must approve this one.';
    return '';
}

// ----- Default chart of accounts -----

/** A chart of accounts entry built from the MEMS GL master (every parameter kept). */
export function chartEntry(leId: string, a: Obj): Obj {
    return {
        leId,
        code: str(a.code),
        name: str(a.name),
        description: str(a.description),
        classCode: str(a.classCode),
        className: str(a.className),
        categoryCode: str(a.categoryCode),
        categoryName: str(a.categoryName),
        groupCode: str(a.groupCode),
        groupName: str(a.groupName),
        normalBalance: normalOf(a),
        accountType: str(a.accountType),
        accountRole: str(a.accountRole),
        postingMode: str(a.postingMode),
        statement: statementOf(a),
        postable: postableOf(a),
        params: objs(a.params) as unknown as Obj,
        status: 'active',
        hasPostings: false,
        version: 1,
    };
}
const chartSynced = new Map<string, string>();
/**
 * Every legal entity's chart holds every active account of the MEMS GL master, active and approved by default (a
 * system approval, recorded on each account and in the audit trail). Accounts later removed through an approved
 * request stay out. Runs again when the master version changes; existing accounts are never overwritten.
 */
export async function syncDefaultChart(orgId: string, leId: string, ctx?: OrgContext): Promise<number> {
    let m: Awaited<ReturnType<typeof glMaster>> = null;
    try {
        m = await glMaster();
    } catch {
        m = null;
    }
    if (!m || !leId) return 0;
    const key = `${orgId}|${leId}`;
    if (chartSynced.get(key) === m.version) return 0;
    const [chart, ent] = await Promise.all([chartOf(orgId, leId), getDoc(P(orgId).entity(leId))]);
    const removed = new Set(strs(ent?.data.removedGl));
    const at = nowIso();
    const writes: Write[] = [];
    for (const a of m.accounts) {
        const code = str(a.code);
        if (!code || chart.has(code) || removed.has(code)) continue;
        writes.push({ path: P(orgId).account(leId, code), exists: false, fields: { ...chartEntry(leId, a), adoptedBy: 'system', approvedBy: 'system', approvedBySystem: true, approvalNote: 'Approved by default: every MEMS GL account is active in each legal entity', adoptedAt: at, masterVersion: m.version } });
    }
    let added = 0;
    for (let i = 0; i < writes.length; i += 400) {
        const part = writes.slice(i, i + 400);
        try {
            await commit(part);
            added += part.length;
        } catch {
            // Another request added some of them at the same time: add the rest one by one, never overwriting.
            for (const w of part) if (await writeDoc(w.path, w.fields as unknown as Fields, { exists: false })) added++;
        }
    }
    chartSynced.set(key, m.version);
    if (added && ctx) await record(ctx, 'org.fin.chart.default', leId, `${added} MEMS GL account(s) added to the chart, active and approved by default (master version ${m.version}).`);
    return added;
}

// ----- Next approver -----

export interface NextApprover {
    level: string;
    levelTitle: string;
    role: string;
    people: Array<{ uid: string; name: string; role: string }>;
    text: string;
}
/**
 * Who decides the next level of each pending request: the people who could approve it right now (same checks as the
 * decision itself), each with their job role (ROL_) and the security role that gives them the right.
 */
export async function nextApprovers(ctx: OrgContext, reqs: Obj[], units: Map<string, Unit>): Promise<Map<string, NextApprover>> {
    const out = new Map<string, NextApprover>();
    const pending = reqs.filter((r) => str(r.status) === 'pending');
    if (!pending.length) return out;
    const [users, positions] = await Promise.all([orgUsers(ctx.orgId), listDocs(`organizations/${ctx.orgId}/positions`)]);
    const titles = new Map(positions.map((p) => [p.id, str(p.data.title)]));
    const people: Array<{ u: Doc; c: OrgContext; scope: Scope; direct: string[]; roleName: string; grants: OrgContext['grants'] }> = [];
    for (const u of users) {
        if (str(u.data.status) === 'disabled' || str(u.data.orgId) !== ctx.orgId) continue;
        try {
            const role = normalizeOrgRole(str(u.data.role));
            const access = await effectiveAccess(ctx.orgId, role, u);
            if (role !== 'org_super_admin' && !access.permissions.some((p) => p === '*' || p.startsWith('FIN'))) continue;
            const c = { ...ctx, uid: u.id, me: u, role, roleName: access.roleName, permissions: access.permissions, directPermissions: access.directPermissions, grants: access.grants } as OrgContext;
            const s = role === 'org_super_admin' ? 'all' : await allowedNodeIds(ctx.orgId, u, true);
            people.push({ u, c, scope: s === 'all' ? { all: true, ids: new Set() } : { all: false, ids: s }, direct: access.directPermissions, roleName: access.roleName, grants: access.grants });
        } catch {
            continue;
        }
    }
    for (const r of pending) {
        const step = (objs(r.steps) as unknown as Step[]).find((s) => s.status === 'pending');
        if (!step) continue;
        const perm = str(r.approvePerm);
        const who = people
            .filter((p) => !cannotDecide(p.c, r, units, p.scope))
            .map((p) => {
                const jobs = activePositions(p.u).map((code) => `${titles.get(code) || code} (${code})`);
                const via = p.c.role === 'org_super_admin' ? 'Organization super admin' : p.grants.find((g) => hasPerm(g.permissions, perm))?.roleName || (hasPerm(p.direct, perm) ? p.roleName : '');
                return { uid: p.u.id, name: nameOf(p.u), role: [jobs.join(', '), via ? `security role ${via}` : ''].filter(Boolean).join(' · ') || 'No job role' };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        const role = step.positionCode ? `${step.positionTitle} (${step.positionCode})` : `holder of ${perm}`;
        const names = who.slice(0, 3).map((w) => w.name).join(', ') + (who.length > 3 ? ` and ${who.length - 3} more` : '');
        out.set(str(r.id), {
            level: step.level,
            levelTitle: step.title,
            role,
            people: who.slice(0, 20),
            text: `${step.level === 'A' ? '' : `${step.level} ${step.title}, `}${role}: ${who.length ? names : 'nobody can approve it yet'}`,
        });
    }
    return out;
}

// ----- Recommended written rules for finance roles -----

export interface RoleRules {
    template: string;
    name: string;
    purpose: string;
    audience: string;
    allows: string;
    never: string;
    limits: string;
    rules: string;
}
const RR = (template: string, name: string, purpose: string, audience: string, allows: string, never: string, limits: string, rules: string[]): RoleRules => ({ template, name, purpose, audience, allows, never, limits, rules: rules.map((r, i) => `${i + 1}. ${r}`).join('\n') });
/** Recommended written rules for each finance role template (role documentation fields). */
export const FIN_ROLE_RULES: RoleRules[] = [
    RR('fin_viewer', 'Finance Viewer', 'Read the finance of their legal entities to answer questions and check postings, without changing anything.', 'Managers, analysts and internal auditors who need to see finance but must not change it.', 'Read the setup, financial calendar, chart of accounts, mapping, taxes, cost centers and the journal of the legal entities in their scope, and download tables to Excel.', 'Any finance officer or approver right when the person audits finance.', 'No approval or cost authority.', ['Use downloads only for work and never share them outside the organization.', 'Report anything that looks wrong to the Financial Controller; never ask a colleague to work around a posting.', 'Access is reviewed every six months.']),
    RR('fin_gl_viewer', 'GL Account Viewer', 'Look up GL accounts of the MEMS GL master.', 'Requesters and buyers who choose GL accounts on requirements.', 'Read the GL account master.', 'Nothing in particular.', 'No approval or cost authority.', ['Choose the account that matches what is bought; ask finance when unsure.']),
    RR('fin_gl_officer', 'Chart of Accounts Officer', 'Keep the chart of accounts of each legal entity complete and clean.', 'A senior accountant or finance systems officer.', 'Propose adopting accounts from the MEMS GL master, and blocking or removing accounts that were never used.', 'Chart of Accounts Approver (FIN.gl.approve) and GL Mapping Approver for the same legal entity.', 'Proposals only: every change needs the Chart of Accounts Approver.', ['Every proposal states the business reason.', 'Never propose removing or blocking a core account (mapped, used by a tax rate, with postings, or a control account); the system refuses it anyway.', 'Block rather than remove when in doubt: blocking can be undone.', 'Check the account description and statement (balance sheet or profit and loss) before proposing.', 'Review the chart with the Financial Controller at least once a year.']),
    RR('fin_gl_approver', 'Chart of Accounts Approver', 'Independent check on every chart of accounts change.', 'A finance manager or financial controller.', 'Approve or reject chart of accounts changes for the legal entities in scope.', 'Chart of Accounts Officer (FIN.gl.manage) for the same legal entity.', 'Non-monetary approvals; one approval per change.', ['Never approve your own proposal (the system blocks it).', 'Reject proposals with a missing or vague reason.', 'Confirm the account is needed by a real transaction or report before approving.', 'Decide within two working days.']),
    RR('fin_setup_officer', 'Finance Setup Officer', 'Prepare the calendar rules, finance chart of authority, taxes and the finance status of a legal entity.', 'The head of financial reporting or the finance systems lead.', 'Propose calendar rules, chart of authority bands, tax regimes and rates, go-live, blocking or closing a legal entity.', 'Finance Setup Approver and Financial Controller for the same legal entity.', 'Proposals only.', ['Calendar type and year start must match the statutory reporting year; quote the policy or board decision in the reason.', 'Tax rates only from a published law or tax authority notice; quote it in the reason.', 'Authority bands grow with the amount: never fewer approvers for a higher amount.', 'Propose go-live only when the chart, mapping, open periods and the opening stock plan are ready.']),
    RR('fin_setup_approver', 'Finance Setup Approver', 'Independent approval of finance setup, taxes and legal entity status.', 'The CFO or Finance Director.', 'Approve finance setup, tax regimes and rates, and legal entity status changes.', 'Finance Setup Officer for the same legal entity.', 'Non-monetary approvals. Not a posting approver unless also Financial Controller.', ['Check every tax rate against the legal source quoted.', 'Approve go-live only when the setup checklist is complete.', 'Closing a legal entity needs every period closed and a board decision referenced.']),
    RR('fin_calendar_officer', 'Financial Calendar Officer', 'Maintain financial years and periods.', 'A senior accountant.', 'Add financial years, generate and propose initialising their periods, propose opening periods.', 'Financial Calendar Approver and Financial Controller.', 'Proposals only.', ['Check the generated dates against the approved calendar type before proposing.', 'Open only the current period and the next one.', 'Never propose reopening a closed period without a written instruction from the Financial Controller.']),
    RR('fin_calendar_approver', 'Financial Calendar Approver', 'Independent approval of year initialisation and period opening.', 'A finance manager.', 'Approve year initialisation and the opening of periods.', 'Financial Calendar Officer.', 'Non-monetary approvals.', ['Check every period date and the calendar type.', 'Keep at most two periods open at a time.']),
    RR('fin_mapping_officer', 'GL Mapping Officer', 'Decide which GL account every system transaction posts to, and the finance settings of cost centers.', 'A senior accountant or finance systems officer.', 'Propose the account mapping (inventory, GR/IR, consumption, clearing, tax and closing accounts) and cost center status and account lists.', 'GL Mapping Approver; Accountant (period-end) for the same legal entity.', 'Proposals only.', ['Balance sheet roles go to balance sheet accounts and expense roles to profit and loss accounts (the system enforces it).', 'Change the mapping only at the start of a period and name the effective period in the reason.', 'Every required role must be mapped before go-live.']),
    RR('fin_mapping_approver', 'GL Mapping Approver', 'Independent approval of the account mapping and cost center finance settings.', 'The Financial Controller or finance manager.', 'Approve the account mapping and cost center finance settings.', 'GL Mapping Officer.', 'Non-monetary approvals.', ['Check the effect on open GR/IR and inventory balances before approving a mapping change.', 'Reject a mapping change in the middle of a period unless the reason explains why it cannot wait.']),
    RR('fin_accountant', 'Accountant (Period-end)', 'Run the period-end routines.', 'An accountant of the legal entity.', 'Run the trial balance and the inventory and GR/IR reconciliation, propose adjustments, reallocations and opening stock valuation, start period-end, propose close, lock and the year-end close.', 'Financial Controller (FIN.close.approve, FIN.post.approve); Stores Issuer; stock take counter or verifier.', 'Proposals only: postings are approved under the finance chart of authority by amount.', ['Record a balanced trial balance and a clean or adjusted reconciliation before proposing a close.', 'Every adjustment carries a written explanation and the evidence.', 'Document the reallocation basis (headcount, area, usage) and keep it the same from period to period.', 'Close each month within five working days of its end.']),
    RR('fin_controller', 'Financial Controller', 'Independent approval of postings and of the period and year close.', 'The Financial Controller or finance manager mapped to an approval level.', 'Approve reconciliation adjustments, reallocations, opening stock valuations, period close and lock, and the year-end close.', 'Accountant (FIN.close.run); Chart of Accounts Officer; Stores Issuer.', 'Approves only at the level mapped to their job role in the finance chart of authority; higher amounts go to the next level.', ['Never approve your own work or a second level of the same request (the system blocks it).', 'Lock a period only after reviewing its trial balance and reconciliation.', 'Approve the year-end close only after the audit adjustments are posted.']),
    RR('inv_issuer', 'Stores Issuer', 'Issue stock from warehouses to cost centers and work orders.', 'Storekeepers.', 'Issue stock that is available in the warehouses in their scope.', 'Stock take verifier or approver; Financial Controller.', 'Only quantities available; issues are valued at moving average and posted when finance is live.', ['Issue only against a signed issue slip or a released work order.', 'The receiver is always another person who signs.', 'A return is a new receipt, never a change to an issue.']),
];
