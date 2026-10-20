import {DETERMINATION_EVENTS,resolveAccountRule,validateRuleDraft,type AccountRule} from './finAccountRules';
import {buildGlTransactionVariants} from './finTransactionVariants';
import {registerGlContracts} from './finTransactionContracts';
import { postingRoles, suggestRoleAccounts } from './finPostingCatalogue';
import { HttpError, deleteDoc, fieldEq, getDoc, listDocs, nowIso, runQuery, str, updateFields, writeDoc, type Fields } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { canGrant, orgUsers, record } from './org';
import { ROLE_TEMPLATES } from './permissionPolicy';
import { glMaster, glMasterItem, materialCategories } from './procurement';
import { getAuthority } from './procurementPolicy';
import {
    CAL_TYPES,
    CC_STATUS,
    FIN_ROLE_RULES,
    DEFAULT_SETTINGS,
    HANDLERS,
    LE_STATUS,
    P,
    ROLES,
    TXNS,
    WEEKDAYS,
    buildYear,
    cannotDecide,
    ccFinOf,
    chainOf,
    chartOf,
    commit,
    createRequest,
    entityOf,
    isSuper,
    leOf,
    mappingOf,
    nameOf,
    needEntity,
    nextApprovers,
    normalOf,
    o,
    objs,
    oneLine,
    ownedCostCenters,
    periodAt,
    permAt,
    postableOf,
    readSettings,
    reasonOf,
    registerHandler,
    requireFinance,
    scopeOf,
    statementOf,
    strs,
    syncDefaultChart,
    systemAccounts,
    today,
    unitsOf,
    visibleEntities,
    withLock,
    yearsOf,
    type Account,
    type Mapping,
    type Obj,
    type Period,
    type Scope,
    type Step,
    type Unit,
    type Write,
    type Year,
} from './finCore';

// ---------------------------------------------------------------------------
// Finance configuration per legal entity: setup, financial calendar, chart of accounts, account mapping, taxes and
// cost centers, and the maker-checker requests that change them. Nothing here takes effect until a second person
// with the approving right approves it; every proposal, decision and change is audited.
// ---------------------------------------------------------------------------

const ALL_FIN = ['FIN.view', 'FIN.gl.view', 'FIN.gl.manage', 'FIN.gl.approve', 'FIN.setup.manage', 'FIN.setup.approve', 'FIN.calendar.manage', 'FIN.calendar.approve', 'FIN.mapping.manage', 'FIN.mapping.approve', 'FIN.tax.manage', 'FIN.tax.approve', 'FIN.cc.manage', 'FIN.cc.approve', 'FIN.journal.view', 'FIN.close.run', 'FIN.close.approve', 'FIN.post.approve'];

interface Env {
    units: Map<string, Unit>;
    scope: Scope;
    le: Unit;
}
async function env(ctx: OrgContext, leId: unknown): Promise<Env> {
    const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
    const le = needEntity(units, scope, str(leId));
    await syncDefaultChart(ctx.orgId, le.id, ctx);
    return { units, scope, le };
}
const may = (ctx: OrgContext, e: Env, perm: string) => permAt(ctx, perm, e.le.id, e.units, e.scope);
function need(ctx: OrgContext, e: Env, perm: string, what: string) {
    if (!may(ctx, e, perm)) throw new HttpError(403, `${what} needs ${perm} for ${e.le.code} ${e.le.name}.`);
}
function needView(ctx: OrgContext, e: Env) {
    if (!ALL_FIN.some((p) => may(ctx, e, p))) throw new HttpError(403, `You have no finance access in ${e.le.code} ${e.le.name}.`);
}
export const fin = (name: string, fn: (ctx: OrgContext) => Promise<unknown>) =>
    orgRoute(name, null, async (ctx) => {
        await requireFinance(ctx);
        return fn(ctx);
    });
const flags = (ctx: OrgContext, e: Env) => Object.fromEntries(ALL_FIN.map((p) => [p.slice(4).replace(/\./g, '_'), may(ctx, e, p)]));

/** Requests of a legal entity waiting for approval, each with who must approve next (name and role). */
async function pendingFor(ctx: OrgContext, leId: string, types: string[]): Promise<Obj[]> {
    const docs = (await runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('leId', leId) }, `organizations/${ctx.orgId}`)).filter((d) => str(d.data.status) === 'pending' && (!types.length || types.includes(str(d.data.type))));
    if (!docs.length) return [];
    const next = await nextApprovers(ctx, docs.map((d) => ({ ...d.data, id: d.id })), await unitsOf(ctx.orgId));
    return docs.map((d) => ({ id: d.id, type: str(d.data.type), typeLabel: str(d.data.typeLabel), title: str(d.data.title), makerName: str(d.data.makerName), createdAt: str(d.data.createdAt), next: next.get(d.id)?.text ?? '' }));
}

// ===== Calendar rules (shared by requests and their approval) =====

const PERIOD_STATUS: Record<string, string> = { future: 'Not yet open', open: 'Open', closing: 'Closing (period-end)', closed: 'Closed', locked: 'Locked' };

/**
 * The period that must move before this one. Year-end adjustment periods are left out of the chain of normal periods, so
 * a new year can open and close its months while the previous year's adjustment period stays open for the audit.
 */
function previousOf(years: Year[], fy: number, no: number): { year: Year; period: Period } | null {
    const y = years.find((x) => x.fy === fy);
    if (!y) return null;
    const normal = y.periods.filter((p) => !p.special);
    const self = y.periods.find((p) => p.no === no);
    if (self?.special) return normal.length ? { year: y, period: normal[normal.length - 1] } : null;
    const idx = normal.findIndex((p) => p.no === no);
    if (idx > 0) return { year: y, period: normal[idx - 1] };
    const prev = years.filter((x) => x.fy < fy && x.status !== 'draft').sort((a, b) => b.fy - a.fy)[0];
    const pn = prev ? prev.periods.filter((p) => !p.special) : [];
    return prev && pn.length ? { year: prev, period: pn[pn.length - 1] } : null;
}

/** Checks one change of period status; returns the reasons it cannot happen. */
async function periodProblems(orgId: string, leId: string, years: Year[], fy: number, nos: number[], to: string): Promise<string[]> {
    const y = years.find((x) => x.fy === fy);
    if (!y || y.status === 'draft') return ['The financial year is not initialised.'];
    const out: string[] = [];
    const sorted = [...nos].sort((a, b) => a - b);
    const planned = new Map<string, string>();
    for (const no of sorted) {
        const p = y.periods.find((x) => x.no === no);
        if (!p) {
            out.push(`Period ${no} does not exist.`);
            continue;
        }
        const prev = previousOf(years, fy, no);
        const prevStatus = prev ? planned.get(`${prev.year.fy}-${prev.period.no}`) ?? prev.period.status : '';
        if (to === 'open') {
            if (!['future', 'closed'].includes(p.status)) out.push(`${p.name} is ${PERIOD_STATUS[p.status]}; only a period not yet open or a closed (not locked) period can be opened.`);
            if (p.status === 'future' && prev && prevStatus === 'future') out.push(`${p.name}: open ${prev.period.name} first. Periods open in order.`);
        } else if (to === 'closed') {
            if (!['closing', 'open'].includes(p.status)) out.push(`${p.name} is ${PERIOD_STATUS[p.status]}; only an open or closing period can be closed.`);
            if (prev && ['open', 'closing', 'future'].includes(prevStatus)) out.push(`${p.name}: close ${prev.period.name} first. Periods close in order.`);
            const runs = await runQuery({ from: [{ collectionId: 'fin_runs' }], where: fieldEq('key', `${leId}_${fy}_${no}`) }, `organizations/${orgId}`);
            const recon = runs.filter((r) => str(r.data.kind) === 'inventory').sort((a, b) => str(b.data.at).localeCompare(str(a.data.at)))[0];
            if (!recon) out.push(`${p.name}: run the inventory reconciliation for this period first.`);
            else if (recon.data.clean !== true && str(recon.data.status) !== 'adjusted') out.push(`${p.name}: the inventory reconciliation found differences that are not yet adjusted (${recon.id}).`);
            const tb = runs.filter((r) => str(r.data.kind) === 'trial_balance').sort((a, b) => str(b.data.at).localeCompare(str(a.data.at)))[0];
            if (!tb) out.push(`${p.name}: run the trial balance for this period first.`);
            else if (tb.data.balanced !== true) out.push(`${p.name}: the last trial balance did not balance.`);
            const pend = (await runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('leId', leId) }, `organizations/${orgId}`)).filter((r) => str(r.data.status) === 'pending' && Number(o(r.data.payload).fy) === fy && Number(o(r.data.payload).no) === no && ['recon.post', 'realloc.post', 'yearend.close'].includes(str(r.data.type)));
            if (pend.length) out.push(`${p.name}: decide ${pend.map((r) => r.id).join(', ')} first.`);
        } else if (to === 'locked') {
            if (p.status !== 'closed') out.push(`${p.name} must be closed before it is locked.`);
            if (prev && prevStatus !== 'locked') out.push(`${p.name}: lock ${prev.period.name} first.`);
            const last = y.periods[y.periods.length - 1];
            if (last.no === no && !str(y.doc.data.yearEndJournal) && y.doc.data.yearEndNotNeeded !== true) out.push(`${p.name} is the last period of ${y.label}: post the year-end close (profit and loss to retained earnings) before locking it.`);
        } else out.push('Unknown period status.');
        planned.set(`${fy}-${no}`, to);
    }
    return out;
}

async function applyPeriods(ctx: OrgContext, leId: string, fy: number, nos: number[], to: string, reqId: string) {
    const years = await yearsOf(ctx.orgId, leId);
    const problems = await periodProblems(ctx.orgId, leId, years, fy, nos, to);
    if (problems.length) throw new HttpError(409, problems.join(' '));
    const y = years.find((x) => x.fy === fy)!;
    const at = nowIso();
    const periods = y.periods.map((p) => (nos.includes(p.no) ? { ...p, status: to, history: [...objs(p.history), { at, to, from: p.status, request: reqId, by: ctx.uid, byName: nameOf(ctx.me) }] } : p));
    const allLocked = periods.every((p) => p.status === 'locked');
    await commit([{ path: P(ctx.orgId).year(leId, fy), fields: { periods: periods as unknown as Obj, status: allLocked ? 'closed' : 'active', updatedAt: at }, mask: ['periods', 'status', 'updatedAt'], updateTime: y.doc.updateTime }]);
    return { periods: nos, to };
}

// ===== Handlers: what an approved request does =====

registerHandler('setup.save', {
    label: 'Finance setup',
    approvePerm: 'FIN.setup.approve',
    apply: async (ctx, req) => {
        const p = o(req.payload);
        const settings = readSettings(p.settings);
        const leId = str(req.leId);
        const e = await entityOf(ctx.orgId, leId);
        const at = nowIso();
        await writeDoc(P(ctx.orgId).entity(leId), { ...(e.doc?.data ?? {}), leId, status: e.status, settings: settings as unknown as Fields, settingsVersion: e.settingsVersion + 1, settingsApprovedAt: at, settingsApprovedBy: ctx.uid, updatedAt: at } as unknown as Fields);
        return { settingsVersion: e.settingsVersion + 1 };
    },
});

async function goLiveProblems(ctx: OrgContext, leId: string, units: Map<string, Unit>): Promise<string[]> {
    const out: string[] = [];
    const le = units.get(leId)!;
    const [e, chart, map, years] = await Promise.all([entityOf(ctx.orgId, leId), chartOf(ctx.orgId, leId), mappingOf(ctx.orgId, leId), yearsOf(ctx.orgId, leId)]);
    if (!e.settings) out.push('Finance setup is not approved.');
    if (!str(le.attributes.currencyCode) && !e.functionalCurrency) out.push('The legal entity has no functional currency (set it on the legal entity in the organization design).');
    const active = Array.from(chart.values()).filter((a) => a.status === 'active');
    if (!active.length) out.push('No GL accounts are approved in the chart of accounts.');
    for (const r of ROLES.filter((x) => x.required)) {
        const code = map.roles[r.code];
        const a = code ? chart.get(code) : undefined;
        if (!a || a.status !== 'active') out.push(`Mapping: ${r.label} has no active account.`);
    }
    const at = periodAt(years, today());
    if (!at) out.push(`No initialised financial year covers today (${today()}).`);
    else if (at.period.status !== 'open') out.push(`Today's period (${at.period.name}) is ${PERIOD_STATUS[at.period.status]}; open it first.`);
    return out;
}

registerHandler('le.status', {
    label: 'Legal entity finance status',
    approvePerm: 'FIN.setup.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const to = str(o(req.payload).to);
        const units = await unitsOf(ctx.orgId);
        const e = await entityOf(ctx.orgId, leId);
        if (to === 'active') {
            const problems = await goLiveProblems(ctx, leId, units);
            if (problems.length) throw new HttpError(409, `Cannot go live: ${problems.join(' ')}`);
        } else if (to === 'posting_blocked') {
            if (e.status !== 'active') throw new HttpError(409, 'Only a live legal entity can be blocked for posting.');
        } else if (to === 'closed') {
            if (!['active', 'posting_blocked'].includes(e.status)) throw new HttpError(409, 'Only a live or blocked legal entity can be closed.');
            const years = await yearsOf(ctx.orgId, leId);
            if (years.some((y) => y.periods.some((p) => ['open', 'closing'].includes(p.status)))) throw new HttpError(409, 'Close every open period before closing the legal entity.');
        } else throw new HttpError(400, 'Unknown status.');
        const at = nowIso();
        const currency = e.functionalCurrency || str(units.get(leId)?.attributes.currencyCode);
        await writeDoc(P(ctx.orgId).entity(leId), {
            ...(e.doc?.data ?? {}),
            leId,
            status: to,
            functionalCurrency: currency,
            goLiveAt: e.goLiveAt || (to === 'active' ? at : ''),
            statusHistory: [...objs(e.doc?.data.statusHistory), { at, from: e.status, to, by: ctx.uid, byName: nameOf(ctx.me), request: str(req.id) }],
            updatedAt: at,
        } as unknown as Fields);
        return { status: to };
    },
});

registerHandler('year.init', {
    label: 'Initialise financial year',
    approvePerm: 'FIN.calendar.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const fy = Number(p.fy);
        const [e, years] = await Promise.all([entityOf(ctx.orgId, leId), yearsOf(ctx.orgId, leId)]);
        if (!e.settings) throw new HttpError(409, 'Finance setup is not approved.');
        const y = years.find((x) => x.fy === fy);
        if (!y || y.status !== 'draft') throw new HttpError(409, 'The year is not waiting to be initialised.');
        const built = buildFor(years, fy, e.settings);
        if (built.start !== str(p.start) || built.end !== str(p.end) || built.periods.length !== objs(p.periods).length) throw new HttpError(409, 'The setup changed since this was proposed. Reject it and propose the year again.');
        const at = nowIso();
        await commit([{ path: P(ctx.orgId).year(leId, fy), fields: { status: 'active', label: built.label, start: built.start, end: built.end, weeks: built.weeks, calendarType: e.settings.calendarType, settingsVersion: e.settingsVersion, periods: built.periods as unknown as Obj, initialisedAt: at, initialisedBy: str(req.makerUid), approvedBy: ctx.uid, updatedAt: at }, mask: ['status', 'label', 'start', 'end', 'weeks', 'calendarType', 'settingsVersion', 'periods', 'initialisedAt', 'initialisedBy', 'approvedBy', 'updatedAt'], updateTime: y.doc.updateTime }]);
        return { fy, periods: built.periods.length };
    },
});

function buildFor(years: Year[], fy: number, s: NonNullable<Awaited<ReturnType<typeof entityOf>>['settings']>) {
    const live = years.filter((y) => y.status !== 'draft');
    const before = live.filter((y) => y.fy < fy).sort((a, b) => b.fy - a.fy)[0];
    const after = live.filter((y) => y.fy > fy).sort((a, b) => a.fy - b.fy)[0];
    if (before && before.fy !== fy - 1) throw new HttpError(409, `Initialise FY ${fy - 1} first. Years are initialised in order.`);
    if (after) throw new HttpError(409, `FY ${after.fy} is already initialised; years are initialised in order.`);
    return buildYear(fy, s, before ? before.end : null);
}

for (const [type, label, perm] of [
    ['period.open', 'Open or reopen periods', 'FIN.calendar.approve'],
    ['period.close', 'Close or lock periods', 'FIN.close.approve'],
] as const) {
    registerHandler(type, {
        label,
        approvePerm: perm,
        apply: async (ctx, req, id) => {
            const p = o(req.payload);
            return applyPeriods(ctx, str(req.leId), Number(p.fy), (Array.isArray(p.nos) ? (p.nos as unknown[]) : []).map(Number), str(p.to), id);
        },
    });
}

/** A chart of accounts entry built from the MEMS GL master (all parameters kept). */
function chartFields(leId: string, a: Obj, makerUid: string, ctx: OrgContext): Obj {
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
        adoptedBy: makerUid,
        approvedBy: ctx.uid,
        adoptedAt: nowIso(),
        version: 1,
    };
}

/** Master parameters that mark a control (core) account of the MEMS GL master. */
const CORE_RX = /(control|system|core|reconcil|automatic|auto[-_ ]?post|retained|clearing|suspense|gr\/?ir|tax|vat)/i;
export function masterCore(a: Obj): boolean {
    if (CORE_RX.test(`${str(a.accountRole)} ${str(a.postingMode)}`)) return true;
    return objs(a.params).some((x) => /^(core|is_?core|control|is_?control|system|is_?system)$/i.test(str(x.key)) && /^(true|yes|y|1)$/i.test(str(x.value)));
}
/**
 * Core accounts of a legal entity and why they are core: in the account mapping, used by a tax rate, holding journal
 * postings, or a control account in the MEMS GL master. A core account can never be removed from the chart or blocked.
 */
async function coreAccounts(orgId: string, leId: string, chart: Map<string, Account>, map: Mapping): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const taxes = await getDoc(P(orgId).taxes(leId));
    for (const r of objs(taxes?.data.regimes)) for (const x of objs(r.rates)) for (const g of [str(x.purchaseGl), str(x.saleGl)]) if (g && !out.has(g)) out.set(g, `used by tax ${str(r.code)} ${str(x.code)}`.trim());
    for (const [role, c] of Object.entries(map.roles)) if (c) out.set(c, `mapped as ${ROLES.find((r) => r.code === role)?.label ?? role}`);
    for (const v of Object.values(map.byCategory)) for (const c of [v.INVENTORY, v.CONSUMPTION]) if (c && !out.has(c)) out.set(c, 'mapped for a material category');
    for (const a of chart.values()) {
        if (out.has(a.code)) continue;
        if (a.hasPostings) out.set(a.code, 'has journal postings');
        else if (masterCore(a.doc.data as unknown as Obj)) out.set(a.code, 'control account in the MEMS GL master');
    }
    return out;
}

registerHandler('coa.change', {
    label: 'Chart of accounts change',
    approvePerm: 'FIN.gl.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const action = str(p.action);
        const codes = strs(p.codes);
        const [chart, map, master] = await Promise.all([chartOf(ctx.orgId, leId), mappingOf(ctx.orgId, leId), glMaster()]);
        const core = await coreAccounts(ctx.orgId, leId, chart, map);
        const writes: Write[] = [];
        const deletes: string[] = [];
        if (action === 'adopt') {
            if (!master) throw new HttpError(409, 'The MEMS GL account master is not loaded.');
            const byCode = new Map(master.accounts.map((a) => [str(a.code), a as Obj]));
            for (const c of codes) {
                const a = byCode.get(c);
                if (!a) throw new HttpError(409, `GL account ${c} is no longer active in the MEMS GL master.`);
                if (chart.has(c)) continue;
                writes.push({ path: P(ctx.orgId).account(leId, c), exists: false, fields: chartFields(leId, a, str(req.makerUid), ctx) });
            }
        } else {
            const ccs = await listDocs(P(ctx.orgId).ccs);
            for (const c of codes) {
                const a = chart.get(c);
                if (!a) throw new HttpError(409, `GL account ${c} is not in the chart.`);
                if (action === 'block' || action === 'remove') {
                    const why = core.get(c);
                    if (why) throw new HttpError(409, `GL account ${c} ${a.name} is a core account (${why}), so it can never be ${action === 'block' ? 'blocked' : 'removed'}.`);
                    if (ccs.some((x) => str(x.data.leId) === leId && strs(x.data.allowedGl).includes(c))) throw new HttpError(409, `GL account ${c} is in a cost center's account list. Remove it there first.`);
                }
                if (action === 'block') writes.push({ path: `${P(ctx.orgId).accounts}/${a.doc.id}`, fields: { status: 'blocked', updatedAt: nowIso(), version: (Number(a.doc.data.version) || 1) + 1 }, mask: ['status', 'updatedAt', 'version'], updateTime: a.doc.updateTime });
                else if (action === 'unblock') {
                    if (a.status !== 'blocked') throw new HttpError(409, `GL account ${c} is not blocked.`);
                    writes.push({ path: `${P(ctx.orgId).accounts}/${a.doc.id}`, fields: { status: 'active', updatedAt: nowIso(), version: (Number(a.doc.data.version) || 1) + 1 }, mask: ['status', 'updatedAt', 'version'], updateTime: a.doc.updateTime });
                } else if (action === 'remove') deletes.push(`${P(ctx.orgId).accounts}/${a.doc.id}`);
                else if (action !== 'block') throw new HttpError(400, 'Unknown change.');
            }
        }
        for (let i = 0; i < writes.length; i += 400) await commit(writes.slice(i, i + 400));
        // Accounts removed by an approved request stay out of the default chart; adopting one again lifts that.
        if (action === 'remove' || action === 'adopt') {
            const ent = await getDoc(P(ctx.orgId).entity(leId));
            const was = strs(ent?.data.removedGl);
            const removedGl = action === 'remove' ? Array.from(new Set([...was, ...codes])) : was.filter((c) => !codes.includes(c));
            if (removedGl.length !== was.length || removedGl.some((c, i) => c !== was[i])) await commit([{ path: P(ctx.orgId).entity(leId), fields: { removedGl }, mask: ['removedGl'] }]);
        }
        // Removal only of accounts that never had postings (checked again just above).
        for (const d of deletes) {
            const fresh = await getDoc(d);
            if (fresh && fresh.data.hasPostings === true) throw new HttpError(409, 'An account received a posting meanwhile; it was not removed.');
            await deleteDoc(d);
        }
        return { action, count: codes.length };
    },
});

function readMapping(raw: Obj): { roles: Record<string, string>; byCategory: Record<string, Obj>; rules: AccountRule[] } {
    const roles: Record<string, string> = {};
    for (const r of ROLES) {
        const v = str(o(raw.roles)[r.code]);
        if (v) roles[r.code] = v;
    }
    const byCategory: Record<string, Obj> = {};
    for (const [k, v] of Object.entries(o(raw.byCategory)).slice(0, 200)) {
        const inv = str(o(v).INVENTORY);
        const con = str(o(v).CONSUMPTION);
        if (inv || con) byCategory[k.slice(0, 60)] = { INVENTORY: inv, CONSUMPTION: con };
    }
    let rules:AccountRule[];
    try {rules=validateRuleDraft(raw.rules??[]);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid account rules');}
    return { roles, byCategory, rules };
}
async function mappingProblems(orgId: string, leId: string, m: ReturnType<typeof readMapping>): Promise<string[]> {
    const chart = await chartOf(orgId, leId);
    const [entity,units,categories]=await Promise.all([entityOf(orgId,leId),unitsOf(orgId),materialCategories()]);
    const validCategories=new Set(categories.map(c=>c.code));
    const out: string[] = [];
    for(const rule of m.rules){
        if(rule.categoryCode&&!validCategories.has(rule.categoryCode))out.push(`Rule ${rule.id}: unknown material category ${rule.categoryCode}.`);
        if(rule.costCenterId){const cc=units.get(rule.costCenterId);
            if(!cc || cc.level!=='cost_center' || leOf(units,cc.id)?.id!==leId)out.push(`Rule ${rule.id}: cost center is not part of this legal entity.`);
        }
    }
    const check = (code: string, statement: 'BS' | 'PL', what: string) => {
        const a = chart.get(code);
        if (!a) out.push(`${what}: ${code} is not in the approved chart.`);
        else if (a.status !== 'active') out.push(`${what}: ${code} is ${a.status}.`);
        else if (!a.postable) out.push(`${what}: ${code} is a heading.`);
        else if(entity.doc?.data.glScopeConfigured===true&&!strs(entity.doc.data.allowedGl).includes(code))out.push(`${what}: ${code} is not in the legal entity approved scope.`);
        else if (a.statement !== statement) out.push(`${what}: ${code} is a ${a.statement === 'BS' ? 'balance sheet' : 'profit and loss'} account; this role needs a ${statement === 'BS' ? 'balance sheet' : 'profit and loss'} account.`);
    };
    for (const r of ROLES) if (m.roles[r.code]) check(m.roles[r.code], r.statement, r.label);
    for(const rule of m.rules){
        const def=ROLES.find(r=>r.code===rule.role);
        if(def)check(rule.account,def.statement,`Transaction ${rule.event}, ${rule.role}`);
    }
    for (const [k, v] of Object.entries(m.byCategory)) {
        if (str(v.INVENTORY)) check(str(v.INVENTORY), 'BS', `Inventory for category ${k}`);
        if (str(v.CONSUMPTION)) check(str(v.CONSUMPTION), 'PL', `Consumption for category ${k}`);
    }
    return out;
}
registerHandler('mapping.save', {
    label: 'Account mapping',
    approvePerm: 'FIN.mapping.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const m = readMapping(o(o(req.payload).mapping));
        const problems = await mappingProblems(ctx.orgId, leId, m);
        if (problems.length) throw new HttpError(409, problems.join(' '));
        const cur = await mappingOf(ctx.orgId, leId);
        await writeDoc(P(ctx.orgId).mapping(leId), { leId, roles: m.roles, byCategory: m.byCategory as unknown as Fields, rules: m.rules as unknown as Fields[keyof Fields], version: cur.version + 1, approvedBy: ctx.uid, approvedAt: nowIso(), proposedBy: str(req.makerUid) } as unknown as Fields);
        return { version: cur.version + 1 };
    },
});

const TAX_KINDS: Record<string, string> = { vat: 'Value added tax', withholding: 'Withholding tax', excise: 'Excise duty', other: 'Other tax' };
function readTaxes(raw: unknown): Obj[] {
    const regimes = objs(raw).slice(0, 30);
    const codes = new Set<string>();
    return regimes.map((r, i) => {
        const at = `Tax regime ${i + 1}`;
        const code = str(r.code).trim().toUpperCase();
        if (!/^[A-Z0-9_]{2,12}$/.test(code)) throw new HttpError(400, `${at}: code of 2 to 12 letters or digits.`);
        if (codes.has(code)) throw new HttpError(400, `${at}: code ${code} is used twice.`);
        codes.add(code);
        const name = oneLine(r.name, 80);
        if (name.length < 3) throw new HttpError(400, `${at}: give a name.`);
        const kind = str(r.kind);
        if (!TAX_KINDS[kind]) throw new HttpError(400, `${at}: choose the kind of tax.`);
        const appliesTo = strs(r.appliesTo).filter((x) => ['purchase', 'sale'].includes(x));
        if (!appliesTo.length) throw new HttpError(400, `${at}: choose whether it applies to purchases, sales or both.`);
        const rateCodes = new Set<string>();
        const rates = objs(r.rates).slice(0, 20).map((x, k) => {
            const rat = `${at}, rate ${k + 1}`;
            const rc = str(x.code).trim().toUpperCase();
            if (!/^[A-Z0-9_]{2,16}$/.test(rc) || rateCodes.has(rc)) throw new HttpError(400, `${rat}: a unique code of 2 to 16 letters or digits.`);
            rateCodes.add(rc);
            const rate = Number(x.rate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, `${rat}: the rate must be 0 to 100 percent.`);
            const validFrom = str(x.validFrom);
            const validTo = str(x.validTo);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || (validTo && (!/^\d{4}-\d{2}-\d{2}$/.test(validTo) || validTo < validFrom))) throw new HttpError(400, `${rat}: enter the date it applies from (and, if it ends, the date it ends, after the start).`);
            const purchaseGl = str(x.purchaseGl);
            const saleGl = str(x.saleGl);
            if (appliesTo.includes('purchase') && !purchaseGl) throw new HttpError(400, `${rat}: choose the GL account for purchases.`);
            if (appliesTo.includes('sale') && !saleGl) throw new HttpError(400, `${rat}: choose the GL account for sales.`);
            return { code: rc, name: oneLine(x.name, 60) || rc, rate: Math.round(rate * 1000) / 1000, validFrom, validTo, purchaseGl: appliesTo.includes('purchase') ? purchaseGl : '', saleGl: appliesTo.includes('sale') ? saleGl : '', recoverable: x.recoverable !== false };
        });
        if (!rates.length) throw new HttpError(400, `${at}: add at least one rate.`);
        return { code, name, kind, authority: oneLine(r.authority, 80), registrationNo: oneLine(r.registrationNo, 40), appliesTo, rates, active: r.active !== false };
    });
}
registerHandler('tax.save', {
    label: 'Taxes',
    approvePerm: 'FIN.tax.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const regimes = readTaxes(o(req.payload).regimes);
        const [chart, cur] = await Promise.all([chartOf(ctx.orgId, leId), getDoc(P(ctx.orgId).taxes(leId))]);
        for (const r of regimes) {
            for (const x of objs(r.rates)) {
                for (const g of [str(x.purchaseGl), str(x.saleGl)].filter(Boolean)) {
                    const a = chart.get(g);
                    if (!a || a.status !== 'active' || !a.postable || a.statement !== 'BS') throw new HttpError(409, `${str(r.code)} ${str(x.code)}: ${g} must be an active balance sheet account in the chart.`);
                }
            }
        }
        // A rate that has been approved is never deleted: it is ended with a date, so history stays explainable.
        for (const old of objs(cur?.data.regimes)) {
            const now = regimes.find((r) => str(r.code) === str(old.code));
            for (const or of objs(old.rates)) if (!now || !objs(now.rates).some((x) => str(x.code) === str(or.code))) throw new HttpError(409, `Rate ${str(old.code)} ${str(or.code)} was approved before; end it with a date instead of removing it.`);
        }
        const version = (Number(cur?.data.version) || 0) + 1;
        await writeDoc(P(ctx.orgId).taxes(leId), { leId, regimes: regimes as unknown as Fields[keyof Fields], version, approvedBy: ctx.uid, approvedAt: nowIso() } as unknown as Fields);
        return { version };
    },
});

registerHandler('cc.config', {
    label: 'Cost center finance settings',
    approvePerm: 'FIN.cc.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const p = o(req.payload);
        const ccId = str(p.ccId);
        const units = await unitsOf(ctx.orgId);
        const cc = units.get(ccId);
        if (!cc || cc.level !== 'cost_center' || leOf(units, ccId)?.id !== leId) throw new HttpError(409, 'The cost center is not in this legal entity.');
        const status = str(p.status);
        if (!CC_STATUS[status]) throw new HttpError(400, 'Unknown cost center status.');
        const chart = await chartOf(ctx.orgId, leId);
        const allowed = strs(p.allowedGl);
        const entity=await entityOf(ctx.orgId,leId);
        for (const g of allowed) {
            if(entity.doc?.data.glScopeConfigured===true && !strs(entity.doc.data.allowedGl).includes(g)) throw new HttpError(409,`${g} is no longer approved for the legal entity.`);
            const a = chart.get(g);
            if (!a || a.status !== 'active' || !a.postable) throw new HttpError(409, `${g} is not an active account in the chart.`);
        }
        const cur = await getDoc(P(ctx.orgId).cc(ccId));
        const version = (Number(cur?.data.version) || 0) + 1;
        await writeDoc(P(ctx.orgId).cc(ccId), { leId, ccId, status, allowedGl: allowed, importedFrom: str(p.importedFrom), version, approvedBy: ctx.uid, approvedAt: nowIso(), proposedBy: str(req.makerUid) });
        return { version };
    },
});

registerHandler('coa.scope', {
    label: 'Legal entity approved GL account scope',
    approvePerm: 'FIN.gl.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const codes = Array.from(new Set(strs(o(req.payload).codes)));
        const [chart, map, old, ccs] = await Promise.all([
            chartOf(ctx.orgId,leId), mappingOf(ctx.orgId,leId),
            getDoc(P(ctx.orgId).entity(leId)),listDocs(P(ctx.orgId).ccs)
        ]);
        if (!codes.length) throw new HttpError(409,'At least one account must remain enabled.');
        for (const code of codes) {
            const a=chart.get(code);
            if(!a || a.status!=='active' || !a.postable) throw new HttpError(409,`GL account ${code} is no longer eligible.`);
        }
        const chosen=new Set(codes);
        const core=await coreAccounts(ctx.orgId,leId,chart,map);
        for(const code of core.keys()) {
            if(chart.get(code)?.status==='active' && chart.get(code)?.postable && !chosen.has(code))
                throw new HttpError(409,`Core account ${code} is required by finance configuration and cannot be excluded.`);
        }
        for(const cc of ccs) {
            if(str(cc.data.leId)!==leId) continue;
            for(const code of strs(cc.data.allowedGl)) if(!chosen.has(code))
                throw new HttpError(409,`GL account ${code} remains approved on cost center ${cc.id}. Change that cost center first.`);
        }
        const at=nowIso();
        await updateFields(P(ctx.orgId).entity(leId),{
            leId,allowedGl:codes,glScopeConfigured:true,
            glScopeVersion:(Number(old?.data.glScopeVersion)||0)+1,
            glScopeApprovedAt:at,glScopeApprovedBy:ctx.uid,
            glScopeProposedBy:str(req.makerUid),updatedAt:at
        });
        return {enabled:codes.length};
    }
});

// ===== Routes =====

export const finRoutes = {
    // Legal entities the person can work with in finance, with their finance status and what they may do there.
    'POST /api/org/fin/entities': [
        fin('org.fin.entities', async (ctx) => {
            const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
            const out: Obj[] = [];
            for (const le of visibleEntities(units, scope)) {
                const e: Env = { units, scope, le };
                const f = flags(ctx, e);
                const owned = ownedCostCenters(units, ctx.me);
                const ownsHere = Array.from(owned).some((c) => leOf(units, c)?.id === le.id);
                if (!Object.values(f).some(Boolean) && !ownsHere) continue;
                const ent = await entityOf(ctx.orgId, le.id);
                out.push({ id: le.id, code: le.code, name: le.name, nodeCurrency: str(le.attributes.currencyCode), status: ent.status, statusLabel: LE_STATUS[ent.status] ?? ent.status, functionalCurrency: ent.functionalCurrency || str(le.attributes.currencyCode), goLiveAt: ent.goLiveAt, settingsApproved: !!ent.settings, can: f, ownsCostCenters: ownsHere });
            }
            return { entities: out };
        }),
    ],

    // ----- Setup -----

    'POST /api/org/fin/setup/get': [
        fin('org.fin.setup.get', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [ent, authority, pending, problems] = await Promise.all([entityOf(ctx.orgId, e.le.id), getAuthority(ctx.orgId), pendingFor(ctx, e.le.id, ['setup.save', 'le.status']), goLiveProblems(ctx, e.le.id, e.units)]);
            const startMeta = str(e.le.attributes.fiscalYearStart);
            return {
                le: { id: e.le.id, code: e.le.code, name: e.le.name, nodeCurrency: str(e.le.attributes.currencyCode), fiscalYearStart: startMeta },
                status: ent.status,
                statusLabel: LE_STATUS[ent.status] ?? ent.status,
                statusHistory: objs(ent.doc?.data.statusHistory),
                functionalCurrency: ent.functionalCurrency,
                goLiveAt: ent.goLiveAt,
                settings: ent.settings,
                settingsVersion: ent.settingsVersion,
                settingsApprovedAt: str(ent.doc?.data.settingsApprovedAt),
                defaults: DEFAULT_SETTINGS,
                calendarTypes: CAL_TYPES.map((c) => ({ code: c.code, label: c.label, note: c.note })),
                weekdays: WEEKDAYS,
                levels: authority.levels.map((l) => ({ code: l.code, title: l.title, mapped: !!l.positionCode })),
                statuses: LE_STATUS,
                goLiveProblems: ent.status === 'active' ? [] : problems,
                pending,
                can: flags(ctx, e),
            };
        }),
    ],
    'POST /api/org/fin/setup/propose': [
        fin('org.fin.setup.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.setup.manage', 'Changing finance setup');
            const settings = readSettings(ctx.body.settings);
            const reason = reasonOf(ctx.body);
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Confirm that the calendar settings match your financial policy.');
            const type = CAL_TYPES.find((c) => c.code === settings.calendarType)!;
            return createRequest(ctx, {
                leId: e.le.id,
                type: 'setup.save',
                title: `Finance setup for ${e.le.code}`,
                summary: `${type.label}; year starts ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][settings.yearStartMonth - 1]}; named by the year it ${settings.yearNaming}s in${type.weeks ? `; weeks end on ${WEEKDAYS[settings.weekEndDay]}, year ends on the ${settings.yearEndRule} ${WEEKDAYS[settings.weekEndDay]} to the month end` : ''}; ${settings.specialPeriods} year-end adjustment period; ${settings.authority.length} approval bands.`,
                payload: { settings: settings as unknown as Obj },
                reason,
                scopeKey: `setup_${e.le.id}`,
            });
        }),
    ],
    'POST /api/org/fin/le/status': [
        fin('org.fin.le.status', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.setup.manage', 'Changing the finance status of a legal entity');
            const to = str(ctx.body.to);
            if (!['active', 'posting_blocked', 'closed'].includes(to)) throw new HttpError(400, 'Choose the new status.');
            const reason = reasonOf(ctx.body, 15);
            if (to === 'active') {
                const problems = await goLiveProblems(ctx, e.le.id, e.units);
                if (problems.length) throw new HttpError(409, `Not ready to go live: ${problems.join(' ')}`);
            }
            return createRequest(ctx, { leId: e.le.id, type: 'le.status', title: `${e.le.code}: ${LE_STATUS[to]}`, summary: `Change the finance status of ${e.le.code} ${e.le.name} to ${LE_STATUS[to]}.`, payload: { to }, reason, scopeKey: `lestatus_${e.le.id}` });
        }),
    ],

    // ----- Financial calendar -----

    'POST /api/org/fin/calendar/get': [
        fin('org.fin.calendar.get', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [ent, years, pending] = await Promise.all([entityOf(ctx.orgId, e.le.id), yearsOf(ctx.orgId, e.le.id), pendingFor(ctx, e.le.id, ['year.init', 'period.open', 'period.close', 'recon.post', 'realloc.post', 'yearend.close'])]);
            const now = periodAt(years, today());
            const cy = new Date().getUTCFullYear();
            const have = new Set(years.map((y) => y.fy));
            return {
                settings: ent.settings,
                status: ent.status,
                years: years.map((y) => ({ fy: y.fy, label: y.label || `FY ${y.fy}`, status: y.status, start: y.start, end: y.end, weeks: Number(y.doc.data.weeks) || null, calendarType: str(y.doc.data.calendarType), yearEndJournal: str(y.doc.data.yearEndJournal), periods: y.periods.map((p) => ({ no: p.no, name: p.name, start: p.start, end: p.end, special: p.special, weeks: p.weeks, status: p.status, statusLabel: PERIOD_STATUS[p.status] ?? p.status, history: objs(p.history) })) })),
                active: now ? { fy: now.year.fy, no: now.period.no, name: now.period.name, status: now.period.status } : null,
                canAdd: Array.from({ length: 7 }, (_, i) => cy - 1 + i).filter((y) => !have.has(y)),
                periodStatus: PERIOD_STATUS,
                pending,
                can: flags(ctx, e),
            };
        }),
    ],
    'POST /api/org/fin/calendar/year/add': [
        fin('org.fin.calendar.year.add', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.calendar.manage', 'Adding a financial year');
            const fy = Number(ctx.body.fy);
            const cy = new Date().getUTCFullYear();
            if (!Number.isInteger(fy) || fy < cy - 1 || fy > cy + 5) throw new HttpError(400, `Add a year from ${cy - 1} to ${cy + 5}.`);
            const ok = await writeDoc(P(ctx.orgId).year(e.le.id, fy), { leId: e.le.id, fy, label: `FY ${fy}`, status: 'draft', periods: [], createdAt: nowIso(), createdBy: ctx.uid }, { exists: false });
            if (!ok) throw new HttpError(409, `FY ${fy} already exists for ${e.le.code}.`);
            await record(ctx, 'org.fin.calendar.year.add', `${e.le.code} FY ${fy}`, 'Year added; periods are initialised through approval.');
            return { ok: true };
        }),
    ],
    'POST /api/org/fin/calendar/year/preview': [
        fin('org.fin.calendar.year.preview', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const fy = Number(ctx.body.fy);
            const [ent, years] = await Promise.all([entityOf(ctx.orgId, e.le.id), yearsOf(ctx.orgId, e.le.id)]);
            if (!ent.settings) throw new HttpError(409, 'Finance setup must be approved before years can be initialised.');
            const built = buildFor(years, fy, ent.settings);
            const type = CAL_TYPES.find((c) => c.code === ent.settings!.calendarType)!;
            return { ...built, calendarType: type.label, calendarNote: type.note };
        }),
    ],
    'POST /api/org/fin/calendar/year/init': [
        fin('org.fin.calendar.year.init', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.calendar.manage', 'Initialising a financial year');
            const fy = Number(ctx.body.fy);
            const reason = reasonOf(ctx.body);
            if (ctx.body.confirmType !== true || ctx.body.confirmDates !== true) throw new HttpError(400, 'Confirm the calendar type and the period dates.');
            const [ent, years] = await Promise.all([entityOf(ctx.orgId, e.le.id), yearsOf(ctx.orgId, e.le.id)]);
            if (!ent.settings) throw new HttpError(409, 'Finance setup must be approved first.');
            const y = years.find((x) => x.fy === fy);
            if (!y || y.status !== 'draft') throw new HttpError(409, 'Add the year first; it can be initialised once.');
            const built = buildFor(years, fy, ent.settings);
            return createRequest(ctx, {
                leId: e.le.id,
                type: 'year.init',
                title: `${e.le.code} ${built.label}: ${built.periods.length} periods`,
                summary: `${built.start} to ${built.end}${built.weeks ? ` (${built.weeks} weeks)` : ''}. ${built.periods.map((p) => `${p.no}: ${p.start} to ${p.end}`).join('; ')}`,
                payload: { fy, start: built.start, end: built.end, periods: built.periods.map((p) => ({ no: p.no, start: p.start, end: p.end })) as unknown as Obj },
                reason,
                scopeKey: `year_${e.le.id}_${fy}`,
            });
        }),
    ],
    // Open, close, lock or reopen periods. Moving an open period into "closing" (period-end work) and back is immediate.
    'POST /api/org/fin/calendar/period/status': [
        fin('org.fin.calendar.period.status', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            const fy = Number(ctx.body.fy);
            const nos = (Array.isArray(ctx.body.nos) ? (ctx.body.nos as unknown[]) : [ctx.body.no]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
            const to = str(ctx.body.to);
            if (!nos.length || nos.length > 14) throw new HttpError(400, 'Choose the periods.');
            const years = await yearsOf(ctx.orgId, e.le.id);
            const y = years.find((x) => x.fy === fy);
            if (!y || y.status === 'draft') throw new HttpError(409, 'The year is not initialised.');
            if (to === 'closing' || to === 'reopen_from_closing') {
                need(ctx, e, 'FIN.close.run', 'Starting or stopping period-end work');
                if (nos.length !== 1) throw new HttpError(400, 'Choose one period.');
                const p = y.periods.find((x) => x.no === nos[0]);
                if (!p) throw new HttpError(404, 'Period not found.');
                const from = to === 'closing' ? 'open' : 'closing';
                const next = to === 'closing' ? 'closing' : 'open';
                if (p.status !== from) throw new HttpError(409, `${p.name} is ${PERIOD_STATUS[p.status]}.`);
                const reason = reasonOf(ctx.body);
                const at = nowIso();
                const periods = y.periods.map((x) => (x.no === p.no ? { ...x, status: next, history: [...objs(x.history), { at, from, to: next, by: ctx.uid, byName: nameOf(ctx.me), note: reason }] } : x));
                await commit([{ path: P(ctx.orgId).year(e.le.id, fy), fields: { periods: periods as unknown as Obj, updatedAt: at }, mask: ['periods', 'updatedAt'], updateTime: y.doc.updateTime }]);
                await record(ctx, 'org.fin.period.' + (to === 'closing' ? 'closing' : 'reopen'), `${e.le.code} ${y.label} ${p.name}`, reason);
                return { ok: true };
            }
            if (!['open', 'closed', 'locked'].includes(to)) throw new HttpError(400, 'Unknown period status.');
            need(ctx, e, to === 'open' ? 'FIN.calendar.manage' : 'FIN.close.run', to === 'open' ? 'Opening periods' : 'Closing or locking periods');
            const reason = reasonOf(ctx.body);
            const problems = await periodProblems(ctx.orgId, e.le.id, years, fy, nos, to);
            if (problems.length) throw new HttpError(409, problems.join(' '));
            const names = nos.map((n) => y.periods.find((p) => p.no === n)?.name ?? String(n));
            return createRequest(ctx, { leId: e.le.id, type: to === 'open' ? 'period.open' : 'period.close', title: `${e.le.code} ${y.label}: ${to === 'open' ? 'open' : to === 'closed' ? 'close' : 'lock'} ${names.join(', ')}`, summary: `${names.join(', ')} to ${PERIOD_STATUS[to]}.`, payload: { fy, nos, to }, reason, scopeKey: `period_${e.le.id}_${fy}` });
        }),
    ],

    // ----- Chart of accounts -----

    'POST /api/org/fin/chart/scope/get': [
        fin('org.fin.chart.scope.get',async ctx=>{
            const e=await env(ctx,ctx.body.leId);
            needView(ctx,e);
            const [entity,chart,pending]=await Promise.all([
                getDoc(P(ctx.orgId).entity(e.le.id)),chartOf(ctx.orgId,e.le.id),
                pendingFor(ctx,e.le.id,['coa.scope'])
            ]);
            const eligible=Array.from(chart.values()).filter(a=>a.status==='active'&&a.postable);
            const configured=entity?.data.glScopeConfigured===true;
            const selected=configured?new Set(strs(entity?.data.allowedGl)):new Set(eligible.map(a=>a.code));
            return {
                configured,selected:[...selected],eligible:eligible.map(a=>({
                    code:a.code,name:a.name,classCode:a.classCode,className:a.className,
                    categoryCode:a.categoryCode,categoryName:a.categoryName,
                    groupCode:a.groupCode,groupName:a.groupName
                })),version:Number(entity?.data.glScopeVersion)||0,pending,can:flags(ctx,e)
            };
        }),
    ],
    'POST /api/org/fin/chart/scope/propose': [
        fin('org.fin.chart.scope.propose',async ctx=>{
            const e=await env(ctx,ctx.body.leId);
            need(ctx,e,'FIN.gl.manage','Selecting legal entity GL accounts');
            const chart=await chartOf(ctx.orgId,e.le.id);
            let codes=Array.from(new Set(strs(ctx.body.codes)));
            const fromLe=str(ctx.body.fromLeId);
            if(fromLe){
                needEntity(e.units,e.scope,fromLe);
                if(fromLe===e.le.id) throw new HttpError(400,'Choose another legal entity to copy.');
                const source=await getDoc(P(ctx.orgId).entity(fromLe));
                const other=await chartOf(ctx.orgId,fromLe);
                codes=source?.data.glScopeConfigured===true?strs(source.data.allowedGl):
                    Array.from(other.values()).filter(a=>a.status==='active'&&a.postable).map(a=>a.code);
            }
            if(codes.length>5000) throw new HttpError(400,'Select no more than 5000 accounts.');
            const valid=new Set(Array.from(chart.values()).filter(a=>a.status==='active'&&a.postable).map(a=>a.code));
            const invalid=codes.filter(code=>!valid.has(code));
            if(invalid.length)throw new HttpError(400,`Not eligible in this entity: ${invalid.slice(0,10).join(', ')}`);
            if(!codes.length)throw new HttpError(400,'Select at least one account.');
            const core=await coreAccounts(ctx.orgId,e.le.id,chart,await mappingOf(ctx.orgId,e.le.id));
            const chosen=new Set(codes);
            for(const code of core.keys())if(valid.has(code)&&!chosen.has(code))
                throw new HttpError(409,`Required finance mapping account ${code} cannot be excluded.`);
            const ccs=await listDocs(P(ctx.orgId).ccs);
            for(const cc of ccs)if(str(cc.data.leId)===e.le.id)for(const code of strs(cc.data.allowedGl))
                if(!chosen.has(code))throw new HttpError(409,`Account ${code} is used by cost center ${cc.id}. Amend it first.`);
            return createRequest(ctx,{
                leId:e.le.id,type:'coa.scope',
                title:`${e.le.code}: approve ${codes.length} GL accounts`,
                summary:`Enable ${codes.length} posting-level accounts for this legal entity.`,
                payload:{codes,fromLeId:fromLe},reason:reasonOf(ctx.body),
                scopeKey:`coa_scope_${e.le.id}`
            });
        }),
    ],
    'POST /api/org/fin/chart/list': [
        fin('org.fin.chart.list', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [chart, map, ccs, bals, pending] = await Promise.all([chartOf(ctx.orgId, e.le.id), mappingOf(ctx.orgId, e.le.id), listDocs(P(ctx.orgId).ccs), runQuery({ from: [{ collectionId: 'fin_bal' }], where: fieldEq('leId', e.le.id) }, `organizations/${ctx.orgId}`), pendingFor(ctx, e.le.id, ['coa.change', 'mapping.save'])]);
            const years = await yearsOf(ctx.orgId, e.le.id);
            const cur = periodAt(years, today())?.year.fy ?? new Date().getUTCFullYear();
            const balance = new Map<string, number>();
            for (const b of bals) {
                const code = str(b.data.glCode);
                const a = chart.get(code);
                if (!a) continue;
                if (a.statement === 'PL' && Number(b.data.fy) !== cur) continue;
                balance.set(code, (balance.get(code) ?? 0) + ((Number(b.data.drC) || 0) - (Number(b.data.crC) || 0)));
            }
            const roleOf = new Map<string, string[]>();
            for (const [r, c] of Object.entries(map.roles)) roleOf.set(c, [...(roleOf.get(c) ?? []), r]);
            const core = await coreAccounts(ctx.orgId, e.le.id, chart, map);
            const restricted = new Map<string, number>();
            for (const c of ccs) if (str(c.data.leId) === e.le.id) for (const g of strs(c.data.allowedGl)) restricted.set(g, (restricted.get(g) ?? 0) + 1);
            return {
                accounts: Array.from(chart.values())
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map((a) => ({ code: a.code, name: a.name, className: a.className, categoryName: a.categoryName, groupName: a.groupName, statement: a.statement, normalBalance: a.normalBalance, accountType: a.accountType, postable: a.postable, status: a.status, hasPostings: a.hasPostings, roles: roleOf.get(a.code) ?? [], core: core.get(a.code) ?? '', ccLists: restricted.get(a.code) ?? 0, balance: (balance.get(a.code) ?? 0) / 100 })),
                fy: cur,
                pending,
                can: flags(ctx, e),
            };
        }),
    ],
    'POST /api/org/fin/chart/account': [
        fin('org.fin.chart.account', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const code = str(ctx.body.code);
            const chart = await chartOf(ctx.orgId, e.le.id);
            const a = chart.get(code);
            let master: unknown = null;
            try {
                master = await glMasterItem(code);
            } catch {
                master = null;
            }
            if (!a && !master) throw new HttpError(404, 'Account not found.');
            const map = await mappingOf(ctx.orgId, e.le.id);
            const core = a ? (await coreAccounts(ctx.orgId, e.le.id, chart, map)).get(code) ?? '' : '';
            const bals = a ? await runQuery({ from: [{ collectionId: 'fin_bal' }], where: { compositeFilter: { op: 'AND', filters: [fieldEq('leId', e.le.id), fieldEq('glCode', code)] } } }, `organizations/${ctx.orgId}`) : [];
            const byPeriod = new Map<string, { fy: number; period: number; dr: number; cr: number }>();
            for (const b of bals) {
                const k = `${b.data.fy}-${b.data.period}`;
                const x = byPeriod.get(k) ?? { fy: Number(b.data.fy), period: Number(b.data.period), dr: 0, cr: 0 };
                x.dr += Number(b.data.drC) || 0;
                x.cr += Number(b.data.crC) || 0;
                byPeriod.set(k, x);
            }
            return {
                chart: a ? { ...a.doc.data, doc: undefined } : null,
                inChart: !!a,
                core,
                master,
                roles: Object.entries(map.roles).filter(([, c]) => c === code).map(([r]) => ROLES.find((x) => x.code === r)?.label ?? r),
                periods: Array.from(byPeriod.values()).sort((x, y) => x.fy - y.fy || x.period - y.period).map((x) => ({ ...x, dr: x.dr / 100, cr: x.cr / 100 })),
            };
        }),
    ],
    // The MEMS GL account master, to browse and pick accounts to adopt.
    'POST /api/org/fin/chart/master': [
        fin('org.fin.chart.master', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [m, chart] = await Promise.all([glMaster(), chartOf(ctx.orgId, e.le.id)]);
            if (!m) throw new HttpError(409, 'MEMS has not loaded the GL account master yet.');
            return {
                version: m.version,
                classes: m.classes,
                categories: m.categories,
                groups: m.groups,
                accounts: m.accounts.map((a) => ({ code: str(a.code), name: str(a.name), description: str(a.description), classCode: str(a.classCode), categoryCode: str(a.categoryCode), groupCode: str(a.groupCode), normalBalance: str(a.normalBalance), accountType: str(a.accountType), postingMode: str(a.postingMode), statement: statementOf(a as Obj), postable: postableOf(a as Obj), core: masterCore(a as Obj), adopted: chart.get(str(a.code))?.status ?? '' })),
            };
        }),
    ],
    'POST /api/org/fin/chart/propose': [
        fin('org.fin.chart.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.gl.manage', 'Changing the chart of accounts');
            const action = str(ctx.body.action);
            if (!['adopt', 'block', 'unblock', 'remove'].includes(action)) throw new HttpError(400, 'Choose what to do.');
            const reason = reasonOf(ctx.body);
            let codes = Array.from(new Set(strs(ctx.body.codes))).slice(0, 5000);
            const all = action === 'adopt' && ctx.body.all === true;
            const fromLe = str(ctx.body.fromLeId);
            const chart = await chartOf(ctx.orgId, e.le.id);
            if (action === 'adopt' && fromLe) {
                needEntity(e.units, e.scope, fromLe);
                const other = await chartOf(ctx.orgId, fromLe);
                codes = Array.from(other.values()).filter((a) => a.status === 'active' && !chart.has(a.code)).map((a) => a.code);
            }
            if (all) {
                const m = await glMaster();
                if (!m) throw new HttpError(409, 'MEMS has not loaded the GL account master yet.');
                codes = m.accounts.map((a) => str(a.code)).filter((c) => c && !chart.has(c)).slice(0, 5000);
            }
            if (all && !codes.length) throw new HttpError(409, 'Every account of the MEMS GL master is already in the chart.');
            if (!codes.length) throw new HttpError(400, action === 'adopt' ? 'Choose accounts that are not yet in the chart.' : 'Choose the accounts.');
            if (action === 'adopt') {
                const m = await glMaster();
                if (!m) throw new HttpError(409, 'MEMS has not loaded the GL account master yet.');
                const known = new Set(m.accounts.map((a) => str(a.code)));
                const bad = codes.filter((c) => !known.has(c));
                if (bad.length) throw new HttpError(400, `Not active in the MEMS GL master: ${bad.slice(0, 10).join(', ')}.`);
                codes = codes.filter((c) => !chart.has(c));
                if (!codes.length) throw new HttpError(400, 'These accounts are already in the chart.');
            } else {
                const map = await mappingOf(ctx.orgId, e.le.id);
                const core = await coreAccounts(ctx.orgId, e.le.id, chart, map);
                for (const c of codes) {
                    const a = chart.get(c);
                    if (!a) throw new HttpError(400, `${c} is not in the chart.`);
                    const why = core.get(c);
                    if ((action === 'block' || action === 'remove') && why) throw new HttpError(409, `${c} ${a.name} is a core account (${why}), so it can never be ${action === 'block' ? 'blocked' : 'removed'}.`);
                }
            }
            const what = { adopt: 'Adopt', block: 'Block', unblock: 'Unblock', remove: 'Remove' }[action];
            return createRequest(ctx, { leId: e.le.id, type: 'coa.change', title: `${e.le.code}: ${what} ${all ? `all ${codes.length} remaining MEMS` : codes.length} account(s)${fromLe ? ` copied from ${e.units.get(fromLe)?.code ?? fromLe}` : ''}${action === 'adopt' ? ', active' : ''}`, summary: codes.slice(0, 80).join(', ') + (codes.length > 80 ? ` and ${codes.length - 80} more` : ''), payload: { action, codes }, reason, scopeKey: `coa_${e.le.id}` });
        }),
    ],

    // ----- Mapping -----

    'POST /api/org/fin/mapping/get': [
        fin('org.fin.mapping.get', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [map, chart, cats, taxes, pending] = await Promise.all([mappingOf(ctx.orgId, e.le.id), chartOf(ctx.orgId, e.le.id), materialCategories(), getDoc(P(ctx.orgId).taxes(e.le.id)), pendingFor(ctx, e.le.id, ['mapping.save'])]);
            const regimes = objs(taxes?.data.regimes).filter((r) => r.active !== false);
            return {
                roles: ROLES,
                events: DETERMINATION_EVENTS,
                variants: buildGlTransactionVariants(Array.from(chart.values()).filter(a=>a.status==='active'&&a.postable).map(a=>({code:a.code,name:a.name,statement:a.statement,classCode:a.classCode,className:a.className,categoryCode:a.categoryCode,categoryName:a.categoryName,groupCode:a.groupCode,groupName:a.groupName,accountRole:a.accountRole,accountType:a.accountType}))),
                contracts: registerGlContracts(buildGlTransactionVariants(Array.from(chart.values()).filter(a=>a.status==='active'&&a.postable).map(a=>({code:a.code,name:a.name,statement:a.statement,classCode:a.classCode,className:a.className,categoryCode:a.categoryCode,categoryName:a.categoryName,groupCode:a.groupCode,groupName:a.groupName,accountRole:a.accountRole,accountType:a.accountType})))),
                mapping: map,
                // Default account per role from this legal entity's approved chart. A suggestion only: it becomes the
                // mapping through the normal proposal and FIN.mapping.approve decision.
                suggested: suggestRoleAccounts(
                    Array.from(chart.values()).filter((a) => a.status === 'active' && a.postable)
                        .map((a) => ({ code: a.code, name: a.name, statement: a.statement, accountRole: a.accountRole, accountType: a.accountType, postable: a.postable })),
                    postingRoles().filter((r) => r.live),
                ),
                txns: TXNS.map((t) => ({ ...t, taxes: t.taxStage ? regimes.filter((r) => strs(r.appliesTo).includes(t.taxStage)).map((r) => `${str(r.code)} (${objs(r.rates).map((x) => `${str(x.code)} ${Number(x.rate)}%`).join(', ')})`) : [] })),
                accounts: Array.from(chart.values()).filter((a) => a.status === 'active' && a.postable).map((a) => ({ code: a.code, name: a.name, statement: a.statement })),
                categories: cats.map((c) => ({ code: c.code, name: c.name })),
                pending,
                can: flags(ctx, e),
            };
        }),
    ],
    'POST /api/org/fin/transactions/contract': [
        fin('org.fin.transactions.contract',async ctx=>{
            const e=await env(ctx,ctx.body.leId);
            needView(ctx,e);
            const chart=await chartOf(ctx.orgId,e.le.id);
            const variants=buildGlTransactionVariants(Array.from(chart.values()).filter(a=>a.status==='active'&&a.postable).map(a=>({code:a.code,name:a.name,statement:a.statement,classCode:a.classCode,className:a.className,categoryCode:a.categoryCode,categoryName:a.categoryName,groupCode:a.groupCode,groupName:a.groupName,accountRole:a.accountRole,accountType:a.accountType})));
            const contract=registerGlContracts(variants).find(c=>c.id===str(ctx.body.id));
            if(!contract)throw new HttpError(404,'Transaction contract not found among approved legal entity accounts.');
            return {contract,editable:false,note:'Registry contract only. This endpoint never creates journal entries or changes transactions.'};
        })
    ],
    'POST /api/org/fin/transactions/placeholder/execute': [
        fin('org.fin.transactions.placeholder.execute',async ctx=>{
            const e=await env(ctx,ctx.body.leId);
            needView(ctx,e);
            // Explicit fail-closed endpoint for all future nonposting handlers.
            // No amount, approval flag or arbitrary client value can bypass this gate.
            throw new HttpError(409,'This transaction has a placeholder handler contract only. Execution is disabled until the owning module implements and verifies its operational posting handler.');
        })
    ],
    'POST /api/org/fin/mapping/simulate': [
        fin('org.fin.mapping.simulate',async ctx=>{
            const e=await env(ctx,ctx.body.leId);
            needView(ctx,e);
            const map=ctx.body.mapping?readMapping(o(ctx.body.mapping)):await mappingOf(ctx.orgId,e.le.id);
            const event=str(ctx.body.event);
            const def=DETERMINATION_EVENTS.find(x=>x.code===event);
            if(!def)throw new HttpError(400,'Unknown transaction event.');
            const categoryCode=str(ctx.body.categoryCode),costCenterId=str(ctx.body.costCenterId);
            if(costCenterId){
                const cc=e.units.get(costCenterId);
                if(!cc || cc.level!=='cost_center'||leOf(e.units,cc.id)?.id!==e.le.id)
                    throw new HttpError(400,'Cost center must belong to this legal entity.');
            }
            const chart=await chartOf(ctx.orgId,e.le.id);
            const entity=await entityOf(ctx.orgId,e.le.id);
            const lines=def.roles.map(role=>{
                const matched=resolveAccountRule(map.rules,role,{event,categoryCode,costCenterId});
                const override=categoryCode?map.byCategory[categoryCode]:undefined;
                const fallback=role==='INVENTORY'?override?.INVENTORY
                  :role==='CONSUMPTION'||role==='MAINT_CONSUMPTION'?override?.CONSUMPTION:undefined;
                const code=matched?.account||str(fallback)||map.roles[role]||
                    (role==='MAINT_CONSUMPTION'?map.roles.CONSUMPTION:'')||'';
                const account=chart.get(code);
                const scopeOK=entity.doc?.data.glScopeConfigured!==true||strs(entity.doc.data.allowedGl).includes(code);
                return {role,code,accountName:account?.name||'',source:matched?'Transaction rule':fallback?'Material category override':'Standard role',
                    matchedRuleId:matched?.id||'',status:!code?'missing':!account||account.status!=='active'||!account.postable||!scopeOK?'unavailable':'resolved'};
            });
            return {event,implemented:def.implemented,lines,covered:lines.every(x=>x.status==='resolved'),
                note:def.implemented?'Configuration preview only; posting also validates amounts, account restrictions and periods.':'Planned event: this simulator does not activate a posting handler.'};
        }),
    ],
    'POST /api/org/fin/mapping/propose': [
        fin('org.fin.mapping.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.mapping.manage', 'Changing the account mapping');
            const reason = reasonOf(ctx.body);
            const m = readMapping(o(ctx.body.mapping));
            const problems = await mappingProblems(ctx.orgId, e.le.id, m);
            if (problems.length) throw new HttpError(400, problems.join(' '));
            const cur = await mappingOf(ctx.orgId, e.le.id);
            const changed = ROLES.filter((r) => (cur.roles[r.code] ?? '') !== (m.roles[r.code] ?? '')).map((r) => `${r.code}: ${cur.roles[r.code] || '-'} to ${m.roles[r.code] || '-'}`);
            if (!changed.length && JSON.stringify(cur.byCategory) === JSON.stringify(m.byCategory) && JSON.stringify(cur.rules) === JSON.stringify(m.rules)) throw new HttpError(400, 'Nothing has changed.');
            return createRequest(ctx, { leId: e.le.id, type: 'mapping.save', title: `${e.le.code}: account mapping`, summary: `${changed.join('; ')}${Object.keys(m.byCategory).length ? `; ${Object.keys(m.byCategory).length} category override(s)` : ''}${m.rules.length ? `; ${m.rules.length} transaction determination rule(s)` : ''}`, payload: { mapping: m as unknown as Obj }, reason, scopeKey: `mapping_${e.le.id}` });
        }),
    ],

    // ----- Taxes -----

    'POST /api/org/fin/tax/get': [
        fin('org.fin.tax.get', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            needView(ctx, e);
            const [doc, chart, pending] = await Promise.all([getDoc(P(ctx.orgId).taxes(e.le.id)), chartOf(ctx.orgId, e.le.id), pendingFor(ctx, e.le.id, ['tax.save'])]);
            return { regimes: objs(doc?.data.regimes), version: Number(doc?.data.version) || 0, kinds: TAX_KINDS, accounts: Array.from(chart.values()).filter((a) => a.status === 'active' && a.postable && a.statement === 'BS').map((a) => ({ code: a.code, name: a.name })), country: str(e.le.attributes.countryCode), pending, can: flags(ctx, e) };
        }),
    ],
    'POST /api/org/fin/tax/propose': [
        fin('org.fin.tax.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.tax.manage', 'Changing taxes');
            const reason = reasonOf(ctx.body);
            const regimes = readTaxes(ctx.body.regimes);
            return createRequest(ctx, { leId: e.le.id, type: 'tax.save', title: `${e.le.code}: taxes (${regimes.length} regime(s))`, summary: regimes.map((r) => `${str(r.code)} ${str(r.name)}: ${objs(r.rates).map((x) => `${str(x.code)} ${Number(x.rate)}% from ${str(x.validFrom)}${str(x.validTo) ? ` to ${str(x.validTo)}` : ''}`).join(', ')}`).join('; '), payload: { regimes: regimes as unknown as Obj }, reason, scopeKey: `tax_${e.le.id}` });
        }),
    ],

    // ----- Cost centers -----

    'POST /api/org/fin/cc/list': [
        fin('org.fin.cc.list', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            const owned = ownedCostCenters(e.units, ctx.me);
            const finAccess = ALL_FIN.some((p) => may(ctx, e, p));
            const ccs = Array.from(e.units.values()).filter((u) => u.level === 'cost_center' && leOf(e.units, u.id)?.id === e.le.id && (finAccess || owned.has(u.id)));
            if (!ccs.length && !finAccess) throw new HttpError(403, `You have no finance access in ${e.le.code}.`);
            const [fins, whs, bals, years] = await Promise.all([listDocs(P(ctx.orgId).ccs), listDocs(`organizations/${ctx.orgId}/warehouses`), runQuery({ from: [{ collectionId: 'fin_bal' }], where: fieldEq('leId', e.le.id) }, `organizations/${ctx.orgId}`), yearsOf(ctx.orgId, e.le.id)]);
            const fy = periodAt(years, today())?.year.fy ?? new Date().getUTCFullYear();
            const finBy = new Map(fins.map((f) => [f.id, f.data]));
            const wh = new Set(whs.map((w) => w.id));
            const actual = new Map<string, number>();
            const chart = await chartOf(ctx.orgId, e.le.id);
            for (const b of bals) {
                if (Number(b.data.fy) !== fy || chart.get(str(b.data.glCode))?.statement !== 'PL') continue;
                const c = str(b.data.ccId);
                actual.set(c, (actual.get(c) ?? 0) + (Number(b.data.drC) || 0) - (Number(b.data.crC) || 0));
            }
            return {
                fy,
                costCenters: ccs
                    .map((u) => {
                        const ch = chainOf(e.units, u.id);
                        const f = finBy.get(u.id);
                        return { id: u.id, code: u.code, name: u.name, department: ch.find((x) => x.level === 'department')?.name ?? '', site: ch.find((x) => x.level === 'site')?.name ?? '', costType: u.costType, structureStatus: u.status, status: str(f?.status) || 'open', statusLabel: CC_STATUS[str(f?.status) || 'open'], restricted: strs(f?.allowedGl).length, warehouse: wh.has(u.id), owned: owned.has(u.id), actual: (actual.get(u.id) ?? 0) / 100 };
                    })
                    .sort((a, b) => a.code.localeCompare(b.code)),
                can: flags(ctx, e),
            };
        }),
    ],
    'POST /api/org/fin/cc/get': [
        fin('org.fin.cc.get', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            const ccId = str(ctx.body.ccId);
            const cc = e.units.get(ccId);
            if (!cc || cc.level !== 'cost_center' || leOf(e.units, ccId)?.id !== e.le.id) throw new HttpError(404, 'Cost center not found in this legal entity.');
            const owned = ownedCostCenters(e.units, ctx.me).has(ccId);
            if (!owned && !ALL_FIN.some((p) => permAt(ctx, p, ccId, e.units, e.scope))) throw new HttpError(403, 'You have no finance access to this cost center.');
            const [f, chart, map, entity, wh, pending, others] = await Promise.all([ccFinOf(ctx.orgId, ccId), chartOf(ctx.orgId, e.le.id), mappingOf(ctx.orgId, e.le.id), entityOf(ctx.orgId, e.le.id), getDoc(`organizations/${ctx.orgId}/warehouses/${ccId}`), runQuery({ from: [{ collectionId: 'fin_requests' }], where: fieldEq('scopeKey', `cc_${ccId}`) }, `organizations/${ctx.orgId}`), listDocs(P(ctx.orgId).ccs)]);
            const sys = systemAccounts(map);
            const ch = chainOf(e.units, ccId);
            return {
                cc: { id: cc.id, code: cc.code, name: cc.name, costType: cc.costType, structureStatus: cc.status, department: ch.find((x) => x.level === 'department')?.name ?? '', site: ch.find((x) => x.level === 'site')?.name ?? '', managerRoleCode: cc.managerRoleCode, warehouse: !!wh },
                status: f.status,
                statusLabel: CC_STATUS[f.status],
                statuses: CC_STATUS,
                allowedGl: f.allowedGl.map((c) => ({ code: c, name: chart.get(c)?.name ?? '', status: chart.get(c)?.status ?? 'missing' })),
                choosable: Array.from(chart.values()).filter((a) => a.status === 'active' && a.postable && a.statement === 'PL' && !sys.has(a.code) && (entity.doc?.data.glScopeConfigured !== true || strs(entity.doc.data.allowedGl).includes(a.code))).map((a) => ({ code: a.code, name: a.name, classCode: a.classCode, className: a.className, categoryCode: a.categoryCode, categoryName: a.categoryName, groupCode: a.groupCode, groupName: a.groupName })),
                importFrom: others.filter((x) => str(x.data.leId) === e.le.id && x.id !== ccId && strs(x.data.allowedGl).length).map((x) => ({ id: x.id, code: e.units.get(x.id)?.code ?? x.id, name: e.units.get(x.id)?.name ?? '', count: strs(x.data.allowedGl).length })),
                version: f.version,
                pending: await (async () => {
                    const open = pending.filter((x) => str(x.data.status) === 'pending');
                    const next = await nextApprovers(ctx, open.map((x) => ({ ...x.data, id: x.id })), e.units);
                    return open.map((x) => ({ id: x.id, title: str(x.data.title), makerName: str(x.data.makerName), next: next.get(x.id)?.text ?? '' }));
                })(),
                owned,
                can: { ...flags(ctx, e), journal: owned || permAt(ctx, 'FIN.journal.view', ccId, e.units, e.scope) },
            };
        }),
    ],
    'POST /api/org/fin/cc/propose': [
        fin('org.fin.cc.propose', async (ctx) => {
            const e = await env(ctx, ctx.body.leId);
            need(ctx, e, 'FIN.cc.manage', 'Changing cost center finance settings');
            const ccId = str(ctx.body.ccId);
            const cc = e.units.get(ccId);
            if (!cc || cc.level !== 'cost_center' || leOf(e.units, ccId)?.id !== e.le.id) throw new HttpError(404, 'Cost center not found in this legal entity.');
            const reason = reasonOf(ctx.body);
            const cur = await ccFinOf(ctx.orgId, ccId);
            const chart = await chartOf(ctx.orgId, e.le.id);
            let allowed = Array.from(new Set(strs(ctx.body.allowedGl))).slice(0, 500);
            const fromCc = str(ctx.body.fromCcId);
            if (fromCc) {
                if (leOf(e.units, fromCc)?.id !== e.le.id) throw new HttpError(400, 'Import only from a cost center of the same legal entity.');
                allowed = Array.from(new Set([...(ctx.body.merge === true ? cur.allowedGl : []), ...(await ccFinOf(ctx.orgId, fromCc)).allowedGl]));
            }
            const entity = await entityOf(ctx.orgId,e.le.id);
            for (const g of allowed) {
                if (entity.doc?.data.glScopeConfigured === true && !strs(entity.doc.data.allowedGl).includes(g)) throw new HttpError(400, `${g} is not enabled for this legal entity.`);
                const a = chart.get(g);
                if (!a || a.status !== 'active' || !a.postable) throw new HttpError(400, `${g} is not an active account in the chart.`);
                if (a.statement !== 'PL') throw new HttpError(400, `${g} is a balance sheet account. A cost center list holds profit and loss accounts only.`);
            }
            const status = str(ctx.body.status) || cur.status;
            if (!CC_STATUS[status]) throw new HttpError(400, 'Choose the cost center status.');
            if (status === cur.status && JSON.stringify([...allowed].sort()) === JSON.stringify([...cur.allowedGl].sort())) throw new HttpError(400, 'Nothing has changed.');
            const added = allowed.filter((g) => !cur.allowedGl.includes(g));
            const removed = cur.allowedGl.filter((g) => !allowed.includes(g));
            return createRequest(ctx, {
                leId: e.le.id,
                type: 'cc.config',
                title: `${cc.code} ${cc.name}: ${status !== cur.status ? CC_STATUS[status] : 'account list'}${fromCc ? ` (imported from ${e.units.get(fromCc)?.code ?? fromCc})` : ''}`,
                summary: `${status !== cur.status ? `Status ${CC_STATUS[cur.status]} to ${CC_STATUS[status]}. ` : ''}${added.length ? `Add ${added.join(', ')}. ` : ''}${removed.length ? `Remove ${removed.join(', ')}. ` : ''}${allowed.length ? `${allowed.length} account(s) allowed.` : 'Every open account allowed.'}`,
                payload: { ccId, status, allowedGl: allowed, importedFrom: fromCc },
                reason,
                scopeKey: `cc_${ccId}`,
            });
        }),
    ],

    // ----- Finance roles and their recommended written rules -----

    'POST /api/org/fin/roles/list': [
        fin('org.fin.roles.list', async (ctx) => {
            const [roles, positions, docs, users] = await Promise.all([listDocs(`organizations/${ctx.orgId}/roles`), listDocs(`organizations/${ctx.orgId}/positions`), listDocs(`organizations/${ctx.orgId}/role_docs`), orgUsers(ctx.orgId)]);
            const docOf = new Map(docs.map((d) => [d.id, d]));
            const jaccard = (a: string[], b: string[]) => {
                const A = new Set(a);
                const B = new Set(b);
                const inter = Array.from(A).filter((x) => B.has(x)).length;
                return inter / (new Set([...a, ...b]).size || 1);
            };
            const tpl = new Map(ROLE_TEMPLATES.map((t) => [t.id, t]));
            const manages = ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, 'ADM.roles');
            if (!manages && !['FIN.setup.manage', 'FIN.setup.approve'].some((p) => hasPerm(ctx.permissions, p))) throw new HttpError(403, 'Finance roles and their rules need FIN.setup.manage, FIN.setup.approve or the right to manage security roles.');
            const finRoles = roles
                .map((r) => ({ id: r.id, name: str(r.data.name) || r.id, permissions: strs(r.data.permissions) }))
                .filter((r) => r.permissions.some((p) => p.startsWith('FIN.') || p === 'INV.issue'));
            const out = finRoles.map((r) => {
                let best: { rules: (typeof FIN_ROLE_RULES)[number]; score: number } | null = null;
                for (const rr of FIN_ROLE_RULES) {
                    const t = tpl.get(rr.template);
                    if (!t) continue;
                    const score = jaccard(r.permissions, t.permissions);
                    if (!best || score > best.score) best = { rules: rr, score };
                }
                const jobs = positions.filter((p) => strs(p.data.securityRoles).includes(r.id));
                const jobCodes = new Set(jobs.map((p) => p.id));
                const holders = users.filter((u) => str(u.data.status) !== 'disabled' && (str(u.data.role) === r.id || objs(u.data.assignments).some((a) => jobCodes.has(str(a.positionCode))))).length;
                const d = docOf.get(r.id);
                return {
                    id: r.id,
                    name: r.name,
                    finance: r.permissions.filter((p) => p.startsWith('FIN.') || p.startsWith('INV.issue')),
                    jobRoles: jobs.map((p) => `${p.id} ${str(p.data.title)}`.trim()),
                    holders,
                    doc: d ? { version: Number(d.data.version) || 1, updatedAt: str(d.data.updatedAt), purpose: str(d.data.purpose) } : null,
                    canEdit: ctx.role === 'org_super_admin' || (hasPerm(ctx.permissions, 'ADM.roles') && canGrant(ctx, r.permissions)),
                    recommended: best && best.score > 0 ? { ...best.rules, match: Math.round(best.score * 100) } : null,
                };
            });
            const covered = new Set(out.filter((x) => x.recommended && x.recommended.match >= 60).map((x) => x.recommended!.template));
            return {
                roles: out.sort((a, b) => a.name.localeCompare(b.name)),
                missing: FIN_ROLE_RULES.filter((r) => !covered.has(r.template)).map((r) => ({ ...r, permissions: tpl.get(r.template)?.permissions ?? [] })),
                manages,
            };
        }),
    ],

    // ----- Requests (approvals) -----

    'POST /api/org/fin/requests/list': [
        fin('org.fin.requests.list', async (ctx) => {
            const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
            const les = new Map(visibleEntities(units, scope).map((l) => [l.id, l]));
            const want = str(ctx.body.leId);
            const docs = await listDocs(P(ctx.orgId).requests);
            const visible = docs.filter((d) => les.has(str(d.data.leId)) && (!want || str(d.data.leId) === want));
            const next = await nextApprovers(ctx, visible.map((d) => ({ ...d.data, id: d.id })), units);
            const rows: Obj[] = [];
            for (const d of docs) {
                const leId = str(d.data.leId);
                const le = les.get(leId);
                if (!le || (want && leId !== want)) continue;
                const mine = str(d.data.makerUid) === ctx.uid;
                const e: Env = { units, scope, le };
                if (!mine && !ALL_FIN.some((p) => may(ctx, e, p))) continue;
                const why = cannotDecide(ctx, d.data, units, scope);
                rows.push({ id: d.id, leCode: le.code, leId, type: str(d.data.type), typeLabel: str(d.data.typeLabel), title: str(d.data.title), status: str(d.data.status), makerName: str(d.data.makerName), createdAt: str(d.data.createdAt), decidedAt: str(d.data.decidedAt), amount: d.data.amount ?? null, mine, canDecide: !why, step: ((objs(d.data.steps) as unknown as Step[]).find((s) => s.status === 'pending')?.positionTitle ?? ''), next: next.get(d.id)?.text ?? '' });
            }
            rows.sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)));
            return { requests: rows.slice(0, 1500) };
        }),
    ],
    'POST /api/org/fin/requests/get': [
        fin('org.fin.requests.get', async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^FCR\d{8}$/.test(id)) throw new HttpError(404, 'Request not found.');
            const d = await getDoc(P(ctx.orgId).request(id));
            if (!d) throw new HttpError(404, 'Request not found.');
            const e = await env(ctx, d.data.leId);
            if (str(d.data.makerUid) !== ctx.uid && !ALL_FIN.some((p) => may(ctx, e, p))) throw new HttpError(404, 'Request not found.');
            const why = cannotDecide(ctx, d.data, e.units, e.scope);
            const next = (await nextApprovers(ctx, [{ ...d.data, id: d.id }], e.units)).get(d.id) ?? null;
            return { ...d.data, leCode: e.le.code, leName: e.le.name, canDecide: !why, whyNot: why, canWithdraw: str(d.data.makerUid) === ctx.uid && str(d.data.status) === 'pending', next };
        }),
    ],
    'POST /api/org/fin/requests/decide': [
        fin('org.fin.requests.decide', async (ctx) => {
            const id = str(ctx.body.id);
            if (!/^FCR\d{8}$/.test(id)) throw new HttpError(404, 'Request not found.');
            const decision = str(ctx.body.decision);
            if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Approve or reject.');
            const note = decision === 'reject' ? reasonOf(ctx.body) : oneLine(ctx.body.reason, 300);
            if (decision === 'approve' && ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have checked what this request changes.');
            return withLock(ctx.orgId, `req_${id}`, async () => {
                const d = await getDoc(P(ctx.orgId).request(id));
                if (!d) throw new HttpError(404, 'Request not found.');
                const e = await env(ctx, d.data.leId);
                const why = cannotDecide(ctx, d.data, e.units, e.scope);
                if (why) throw new HttpError(403, why);
                const at = nowIso();
                const steps = objs(d.data.steps) as unknown as Step[];
                const idx = steps.findIndex((s) => s.status === 'pending');
                const history = [...objs(d.data.history), { at, by: ctx.uid, byName: nameOf(ctx.me), action: decision === 'approve' ? `approved ${steps[idx].level}` : 'rejected', note }];
                if (decision === 'reject') {
                    await writeDoc(P(ctx.orgId).request(id), { ...d.data, status: 'rejected', decidedAt: at, decidedBy: ctx.uid, history } as unknown as Fields);
                    await record(ctx, 'org.fin.request.reject', id, `${str(d.data.typeLabel)}: ${note}`.slice(0, 400));
                    return { ok: true, status: 'rejected' };
                }
                const nextSteps = steps.map((s, i) => (i === idx ? { ...s, status: 'approved', by: ctx.uid, byName: nameOf(ctx.me), at, note } : s));
                if (nextSteps.some((s) => s.status === 'pending')) {
                    await writeDoc(P(ctx.orgId).request(id), { ...d.data, steps: nextSteps as unknown as Fields[keyof Fields], history } as unknown as Fields);
                    await record(ctx, 'org.fin.request.approve_level', id, `${steps[idx].level} approved`);
                    return { ok: true, status: 'pending' };
                }
                const h = HANDLERS[str(d.data.type)];
                if (!h) throw new HttpError(500, 'Unknown request type.');
                const result = await h.apply(ctx, { ...d.data, id }, id);
                await writeDoc(P(ctx.orgId).request(id), { ...d.data, steps: nextSteps as unknown as Fields[keyof Fields], status: 'approved', decidedAt: at, decidedBy: ctx.uid, result: result as unknown as Fields[keyof Fields], history } as unknown as Fields);
                await record(ctx, 'org.fin.request.approve', id, `${str(d.data.typeLabel)}: ${str(d.data.title)}. ${JSON.stringify(result).slice(0, 200)}`.slice(0, 400));
                return { ok: true, status: 'approved', result };
            });
        }),
    ],
    'POST /api/org/fin/requests/withdraw': [
        fin('org.fin.requests.withdraw', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = reasonOf(ctx.body);
            return withLock(ctx.orgId, `req_${id}`, async () => {
                const d = await getDoc(P(ctx.orgId).request(id));
                if (!d || str(d.data.makerUid) !== ctx.uid) throw new HttpError(404, 'Request not found.');
                if (str(d.data.status) !== 'pending') throw new HttpError(409, 'Only a pending request can be withdrawn.');
                await writeDoc(P(ctx.orgId).request(id), { ...d.data, status: 'withdrawn', decidedAt: nowIso(), history: [...objs(d.data.history), { at: nowIso(), by: ctx.uid, byName: nameOf(ctx.me), action: 'withdrawn', note: reason }] } as unknown as Fields);
                await record(ctx, 'org.fin.request.withdraw', id, reason);
                return { ok: true };
            });
        }),
    ],
};

export { isSuper };
