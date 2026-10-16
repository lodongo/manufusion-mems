import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { orgUsers, record } from './org';
import { can, requireProcurement } from './procurementSetup';

// ---------------------------------------------------------------------------
// Procurement policy and the chart of authority (amount tiers).
//
//   organizations/{org}/procurement_setup/policy              buying rules (can materials be bought for any cost center?)
//   organizations/{org}/procurement_setup/authority           the tiers: sourcing method, quotes, approvers
//   ... each has /versions/{n}: every earlier version with its reason
//
// Both are versioned, need a reason, are audited, and refuse a save made on top of someone else's change.
// Defaults apply (version 0) until the organization saves its own tiers; amounts are in the organization currency.
// The policy needs PRC.setup.manage. The authority tiers need PRC.authority.manage, which is kept apart from
// anyone who approves purchase orders.
// ---------------------------------------------------------------------------

const policyPath = (orgId: string) => `organizations/${orgId}/procurement_setup/policy`;
const authorityPath = (orgId: string) => `organizations/${orgId}/procurement_setup/authority`;

export interface BuyingPolicy {
    /** true: materials may be bought for any cost center. false: only for warehouses that hold that material type. */
    directToCostCenters: boolean;
    version: number;
    updatedAt: string;
    updatedBy: string;
}

export async function buyingPolicy(orgId: string): Promise<BuyingPolicy> {
    const doc = await getDoc(policyPath(orgId));
    return {
        directToCostCenters: doc?.data.directToCostCenters === true,
        version: Number(doc?.data.version) || 0,
        updatedAt: str(doc?.data.updatedAt),
        updatedBy: str(doc?.data.updatedBy),
    };
}

// ----- Chart of authority tiers -----

export const METHODS = [
    { code: 'direct', label: 'Direct purchase', note: 'One price is enough. No competition is needed.' },
    { code: 'single_source', label: 'Single or sole source', note: 'Negotiate with the one capable supplier. A written justification is required.' },
    { code: 'rfq', label: 'Request for quotation (RFQ)', note: 'Invite priced quotations for a clearly specified item.' },
    { code: 'rfp', label: 'Request for proposal (RFP)', note: 'Invite proposals where the solution or method is part of the evaluation, usually services.' },
    { code: 'rft', label: 'Request for tender (RFT or ITT)', note: 'Invite sealed bids from selected suppliers, opened and evaluated by a committee.' },
    { code: 'open_tender', label: 'Open tender', note: 'Advertise publicly. Any qualified supplier may bid.' },
];
const METHOD_CODES = METHODS.map((m) => m.code);

interface Level {
    code: string;
    title: string;
    /** The job role (ROL_ code in Organization design) whose holders approve at this level. L1 may stay empty: it then means the requester's immediate manager. */
    positionCode: string;
}
interface Sourcing {
    from: number;
    to: number | null;
    method: string;
    minQuotes: number;
    minEvaluators: number;
    justification: boolean;
}
interface Approval {
    from: number;
    to: number | null;
    levels: string[];
}
interface Controls {
    requireApprovedVendor: boolean;
    budgetRequired: boolean;
    splitOrderDays: number;
    matchTolerancePct: number;
    emergencyCeiling: number;
    emergencyRatifyDays: number;
    contractThreshold: number;
    conflictDeclarationFrom: number;
    tenderCommitteeMin: number;
}
export interface Authority {
    levels: Level[];
    sourcing: Sourcing[];
    approval: Approval[];
    controls: Controls;
    version: number;
    updatedAt: string;
    updatedBy: string;
}

const DEFAULT_LEVELS: Level[] = [
    { code: 'L1', title: 'Immediate manager', positionCode: '' },
    { code: 'L2', title: 'Head of department', positionCode: '' },
    { code: 'L3', title: 'Procurement manager', positionCode: '' },
    { code: 'L4', title: 'Finance director', positionCode: '' },
    { code: 'L5', title: 'Chief executive', positionCode: '' },
    { code: 'L6', title: 'Board', positionCode: '' },
];
const DEFAULT_SOURCING: Sourcing[] = [
    { from: 0, to: 10_000, method: 'direct', minQuotes: 1, minEvaluators: 1, justification: false },
    { from: 10_000, to: 100_000, method: 'rfq', minQuotes: 3, minEvaluators: 2, justification: false },
    { from: 100_000, to: 1_000_000, method: 'rft', minQuotes: 3, minEvaluators: 3, justification: false },
    { from: 1_000_000, to: null, method: 'open_tender', minQuotes: 3, minEvaluators: 5, justification: false },
];
const DEFAULT_APPROVAL: Approval[] = [
    { from: 0, to: 10_000, levels: ['L1'] },
    { from: 10_000, to: 100_000, levels: ['L1', 'L2'] },
    { from: 100_000, to: 1_000_000, levels: ['L1', 'L2', 'L3'] },
    { from: 1_000_000, to: 10_000_000, levels: ['L1', 'L2', 'L3', 'L4'] },
    { from: 10_000_000, to: null, levels: ['L1', 'L2', 'L3', 'L4', 'L5'] },
];
const DEFAULT_CONTROLS: Controls = {
    requireApprovedVendor: true,
    budgetRequired: true,
    splitOrderDays: 30,
    matchTolerancePct: 2,
    emergencyCeiling: 50_000,
    emergencyRatifyDays: 3,
    contractThreshold: 500_000,
    conflictDeclarationFrom: 100_000,
    tenderCommitteeMin: 3,
};

const objs = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter(isObj) : []);

function money(v: unknown, at: string, nullable = false): number | null {
    if (nullable && (v === null || v === undefined || String(v).trim() === '')) return null;
    const n = Number(String(v).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new HttpError(400, `${at}: enter an amount of zero or more.`);
    return Math.round(n * 100) / 100;
}
function whole(v: unknown, at: string, min: number, max: number): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${at}: enter a whole number from ${min} to ${max}.`);
    return n;
}

function checkBands(rows: Array<{ from: number; to: number | null }>, what: string) {
    if (rows.length < 1 || rows.length > 12) throw new HttpError(400, `${what}: use 1 to 12 amount bands.`);
    rows.forEach((r, i) => {
        if (i === 0 && r.from !== 0) throw new HttpError(400, `${what}: the first band must start at 0.`);
        if (i > 0 && r.from !== rows[i - 1].to) throw new HttpError(400, `${what}: band ${i + 1} must start where band ${i} ends, with no gap or overlap.`);
        if (i < rows.length - 1 && (r.to === null || r.to <= r.from)) throw new HttpError(400, `${what}: band ${i + 1} must end above where it starts.`);
        if (i === rows.length - 1 && r.to !== null) throw new HttpError(400, `${what}: the last band must have no upper limit.`);
    });
}

function readAuthority(body: Record<string, unknown>): Omit<Authority, 'version' | 'updatedAt' | 'updatedBy'> {
    const levels = objs(body.levels).map((l): Level => ({ code: str(l.code), title: str(l.title).trim().slice(0, 60), positionCode: str(l.positionCode).trim().slice(0, 40) }));
    if (levels.length !== DEFAULT_LEVELS.length || levels.some((l, i) => l.code !== DEFAULT_LEVELS[i].code)) throw new HttpError(400, 'The approval levels L1 to L6 must all be present.');
    for (const l of levels) if (l.title.length < 3) throw new HttpError(400, `Give level ${l.code} a title of at least 3 characters.`);
    const known = new Set(levels.map((l) => l.code));

    const sourcing = objs(body.sourcing).map((r, i): Sourcing => {
        const at = `Sourcing band ${i + 1}`;
        const method = str(r.method);
        if (!METHOD_CODES.includes(method)) throw new HttpError(400, `${at}: choose a sourcing method.`);
        return {
            from: money(r.from, at) as number,
            to: money(r.to, at, true),
            method,
            minQuotes: whole(r.minQuotes, `${at} quotes`, 1, 20),
            minEvaluators: whole(r.minEvaluators, `${at} evaluators`, 1, 20),
            justification: r.justification === true || method === 'single_source',
        };
    });
    checkBands(sourcing, 'Sourcing');

    const approval = objs(body.approval).map((r, i): Approval => {
        const at = `Approval band ${i + 1}`;
        const lv = (Array.isArray(r.levels) ? (r.levels as unknown[]).map(str) : []).filter((x, k, a) => a.indexOf(x) === k);
        if (!lv.length || lv.length > 6) throw new HttpError(400, `${at}: choose 1 to 6 approval levels.`);
        if (lv.some((x) => !known.has(x))) throw new HttpError(400, `${at}: unknown approval level.`);
        const order = lv.map((x) => levels.findIndex((l) => l.code === x));
        if (order.some((o, k) => k > 0 && o <= order[k - 1])) throw new HttpError(400, `${at}: levels must go up in order (L1 first).`);
        return { from: money(r.from, at) as number, to: money(r.to, at, true), levels: lv };
    });
    checkBands(approval, 'Cost approval');
    // A higher amount never needs fewer approvers.
    approval.forEach((a, i) => {
        if (i > 0 && a.levels.length < approval[i - 1].levels.length) throw new HttpError(400, `Cost approval band ${i + 1}: a higher amount cannot need fewer approvers than the band below.`);
    });

    const c: Record<string, unknown> = isObj(body.controls) ? body.controls : {};
    const controls: Controls = {
        requireApprovedVendor: c.requireApprovedVendor !== false,
        budgetRequired: c.budgetRequired !== false,
        splitOrderDays: whole(c.splitOrderDays, 'Split order window', 0, 90),
        matchTolerancePct: Math.round((Number(c.matchTolerancePct) || 0) * 100) / 100,
        emergencyCeiling: money(c.emergencyCeiling, 'Emergency ceiling') as number,
        emergencyRatifyDays: whole(c.emergencyRatifyDays, 'Emergency ratification days', 1, 30),
        contractThreshold: money(c.contractThreshold, 'Written contract threshold') as number,
        conflictDeclarationFrom: money(c.conflictDeclarationFrom, 'Conflict of interest threshold') as number,
        tenderCommitteeMin: whole(c.tenderCommitteeMin, 'Tender committee size', 2, 20),
    };
    if (controls.matchTolerancePct < 0 || controls.matchTolerancePct > 20) throw new HttpError(400, 'Invoice matching tolerance can be 0 to 20 percent.');
    return { levels, sourcing, approval, controls };
}

export async function getAuthority(orgId: string): Promise<Authority> {
    const doc = await getDoc(authorityPath(orgId));
    if (!doc) return { levels: DEFAULT_LEVELS, sourcing: DEFAULT_SOURCING, approval: DEFAULT_APPROVAL, controls: DEFAULT_CONTROLS, version: 0, updatedAt: '', updatedBy: '' };
    const d = doc.data;
    const base = { levels: d.levels, sourcing: d.sourcing, approval: d.approval, controls: d.controls };
    const parsed = readAuthority(base);
    return { ...parsed, version: Number(d.version) || 1, updatedAt: str(d.updatedAt), updatedBy: str(d.updatedBy) };
}

function bandOf<T extends { from: number; to: number | null }>(rows: T[], amount: number): T {
    return rows.find((r) => amount >= r.from && (r.to === null || amount < r.to)) ?? rows[rows.length - 1];
}

/** What the chart of authority requires for an amount. */
export function resolveAuthority(a: Authority, amount: number) {
    const s = bandOf(a.sourcing, amount);
    const p = bandOf(a.approval, amount);
    const title = new Map(a.levels.map((l) => [l.code, l.title]));
    const c = a.controls;
    return {
        amount,
        sourcing: { ...s, methodLabel: METHODS.find((m) => m.code === s.method)?.label ?? s.method },
        approval: { ...p, approvers: p.levels.length, titles: p.levels.map((x) => ({ code: x, title: title.get(x) ?? x })) },
        requires: {
            writtenContract: amount >= c.contractThreshold,
            conflictDeclaration: amount >= c.conflictDeclarationFrom,
            tenderCommittee: ['rft', 'open_tender'].includes(s.method) ? c.tenderCommitteeMin : 0,
            emergencyAllowed: amount <= c.emergencyCeiling,
        },
    };
}

/** Who approves at each level of an amount: the mapped job role and how many people hold it today. */
export async function describeApproval(orgId: string, a: Authority, resolved: ReturnType<typeof resolveAuthority>) {
    const [positions, users] = await Promise.all([listDocs(`organizations/${orgId}/positions`), orgUsers(orgId)]);
    const title = new Map(positions.map((p): [string, string] => [p.id, str(p.data.title)]));
    const day = nowIso().slice(0, 10);
    const holders = (code: string) =>
        users.filter((u) => str(u.data.status) !== 'disabled' && objs(u.data.assignments).some((x) => str(x.positionCode) === code && (!str(x.startsOn) || str(x.startsOn) <= day) && (!str(x.endsOn) || str(x.endsOn) >= day))).length;
    const mapped = new Map(a.levels.map((l): [string, string] => [l.code, l.positionCode]));
    return resolved.approval.titles.map((t) => {
        const positionCode = mapped.get(t.code) ?? '';
        return { ...t, positionCode, positionTitle: title.get(positionCode) ?? '', holders: positionCode ? holders(positionCode) : 0, viaReportingLine: t.code === 'L1' && !positionCode };
    });
}

function canViewPolicy(ctx: OrgContext) {
    return can(ctx, 'PRC.setup.view') || can(ctx, 'PRC.setup.manage') || can(ctx, 'PRC.authority.manage') || can(ctx, 'ADM.roles');
}

const reasonOf = (body: Record<string, unknown>) => {
    const r = str(body.reason).trim();
    if (r.length < 10 || r.length > 300) throw new HttpError(400, 'Give the reason for this change (10 to 300 characters).');
    return r;
};

export const procurementPolicyRoutes = {
    'POST /api/org/procurement/policy/get': [
        orgRoute('org.procurement.policy.get', null, async (ctx) => {
            requireProcurement(ctx);
            return { policy: await buyingPolicy(ctx.orgId), canManage: can(ctx, 'PRC.setup.manage') };
        }),
    ],

    'POST /api/org/procurement/policy/save': [
        orgRoute('org.procurement.policy.save', 'PRC.setup.manage', async (ctx) => {
            requireProcurement(ctx);
            if (typeof ctx.body.directToCostCenters !== 'boolean') throw new HttpError(400, 'Choose whether materials can be bought for cost centers that are not warehouses.');
            const reason = reasonOf(ctx.body);
            const current = await buyingPolicy(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== current.version) throw new HttpError(409, 'Someone else changed the buying rules. Reload and try again.');
            if (ctx.body.directToCostCenters === current.directToCostCenters) throw new HttpError(400, 'Nothing has changed.');
            const version = current.version + 1;
            const data = { directToCostCenters: ctx.body.directToCostCenters, version, updatedAt: nowIso(), updatedBy: ctx.uid };
            await writeDoc(`${policyPath(ctx.orgId)}/versions/${version}`, { ...data, reason }, { exists: false });
            await writeDoc(policyPath(ctx.orgId), data);
            await record(ctx, 'org.procurement.policy.save', 'Buying rules', `Version ${version}: materials can be bought ${data.directToCostCenters ? 'for any cost center' : 'only for matching warehouses'}. Reason: ${reason}`);
            return { ok: true, version };
        }),
    ],

    'POST /api/org/procurement/authority/tiers': [
        orgRoute('org.procurement.authority.tiers', null, async (ctx) => {
            requireProcurement(ctx);
            if (!canViewPolicy(ctx)) throw new HttpError(403, 'You do not have permission to view the chart of authority.');
            return { authority: await getAuthority(ctx.orgId), methods: METHODS, currency: str(ctx.org.data.currencyCode), canManage: can(ctx, 'PRC.authority.manage') };
        }),
    ],

    'POST /api/org/procurement/authority/resolve': [
        orgRoute('org.procurement.authority.resolve', null, async (ctx) => {
            requireProcurement(ctx);
            if (!canViewPolicy(ctx) && !can(ctx, 'PRC.req.acknowledge') && !can(ctx, 'PRC.quotes.manage')) throw new HttpError(403, 'You do not have permission to check the chart of authority.');
            const amount = money(ctx.body.amount, 'Amount') as number;
            const authority = await getAuthority(ctx.orgId);
            const resolved = resolveAuthority(authority, amount);
            return { ...resolved, approvers: await describeApproval(ctx.orgId, authority, resolved) };
        }),
    ],

    // Job roles of Organization design, to map each approval level to one.
    'POST /api/org/procurement/authority/positions': [
        orgRoute('org.procurement.authority.positions', null, async (ctx) => {
            requireProcurement(ctx);
            if (!canViewPolicy(ctx)) throw new HttpError(403, 'You do not have permission to view the chart of authority.');
            const list = await listDocs(`organizations/${ctx.orgId}/positions`);
            return { positions: list.map((p) => ({ code: p.id, title: str(p.data.title) || p.id, parentCode: str(p.data.parentCode) })).sort((a, b) => a.title.localeCompare(b.title)) };
        }),
    ],

    'POST /api/org/procurement/authority/save': [
        orgRoute('org.procurement.authority.save', 'PRC.authority.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            const next = readAuthority(ctx.body);
            const known = new Set((await listDocs(`organizations/${ctx.orgId}/positions`)).map((p) => p.id));
            for (const l of next.levels) if (l.positionCode && !known.has(l.positionCode)) throw new HttpError(400, `Level ${l.code}: the chosen job role does not exist in Organization design.`);
            const used = new Set(next.approval.flatMap((b) => b.levels));
            const unmapped = next.levels.filter((l) => used.has(l.code) && l.code !== 'L1' && !l.positionCode).map((l) => l.code);
            const current = await getAuthority(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== current.version) throw new HttpError(409, 'Someone else changed the chart of authority. Reload and apply your changes again.');
            const before = JSON.stringify({ l: current.levels, s: current.sourcing, a: current.approval, c: current.controls });
            const after = JSON.stringify({ l: next.levels, s: next.sourcing, a: next.approval, c: next.controls });
            if (before === after && current.version > 0) throw new HttpError(400, 'Nothing has changed.');
            const version = current.version + 1;
            const data = { ...next, version, updatedAt: nowIso(), updatedBy: ctx.uid };
            await writeDoc(`${authorityPath(ctx.orgId)}/versions/${version}`, { ...data, reason }, { exists: false });
            await writeDoc(authorityPath(ctx.orgId), data);
            await record(ctx, 'org.procurement.authority.save', 'Chart of authority', `Version ${version}: ${next.sourcing.length} sourcing bands, ${next.approval.length} cost approval bands. Reason: ${reason}`);
            return { ok: true, version, unmapped };
        }),
    ],
};
