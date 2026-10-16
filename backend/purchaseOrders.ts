import { secrets } from './platform/sdk';
import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { effectiveAccess, hasPerm, normalizeOrgRole, orgRoute, type OrgContext } from './guards';
import { orgUsers, record } from './org';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { col as structureCol } from './structure';
import { can, requireProcurement, requirementsPath } from './procurementSetup';
import { covers, deskScope, lineKeyOf, ownersOf, type DeskScope } from './buyerGroups';
import { METHODS, getAuthority, resolveAuthority, type Authority } from './procurementPolicy';
import { vendorsPath } from './vendors';
import { receiveGoods, receiptPlan } from './finOps';
import { checkChosenGl } from './finCore';

// Purchase requisitions (PRQ + 9 digits) and purchase orders (PO + 9 digits).
//   organizations/{org}/procurement_requisitions/{PRQ000000001}   one per recommended quotation
//   organizations/{org}/procurement_orders/{PO000000001}          the order, its lines, validation, approval, deliveries
//   organizations/{org}/procurement_setup/orders                  order settings (send approved orders automatically)
// Flow: recommended quotation -> requisition (Draft) -> confirmed by the requester -> new order or consolidated into a
// matching draft order -> validated -> confirmed -> approved level by level (chart of authority) -> open -> sent
// (automatic email or print) -> delivered partially / in full. Everything is audited, versioned and checked on the server.

type Obj = Record<string, unknown>;
export const RQ_ID = /^PRQ\d{9}$/;
// New orders are PO + 8 digits with a version, PO00000012-V1. Older orders keep their nine-digit number (no version suffix).
export const PO_ID = /^PO(\d{8}|\d{9})(-V\d{1,3})?$/;
export const BASE_ID = /^PO(\d{8}|\d{9})$/;
const MAX_LINES = 200;
const MAX_DELIVERIES = 60;
const MAX_VERSIONS = 50;

export const baseOf = (id: string) => id.replace(/-V\d+$/, '');
export const verOf = (id: string) => {
    const m = /-V(\d+)$/.exec(id);
    return m ? Number(m[1]) : 1;
};

export const reqsPath = (orgId: string) => `organizations/${orgId}/procurement_requisitions`;
export const ordersPath = (orgId: string) => `organizations/${orgId}/procurement_orders`;
export const casesPath = (orgId: string) => `organizations/${orgId}/procurement_quotations`;
const settingsPath = (orgId: string) => `organizations/${orgId}/procurement_setup/orders`;
const visibilityPath = (orgId: string) => `organizations/${orgId}/procurement_setup/po_visibility`;

export const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
export const o = (v: unknown): Obj => (isObj(v) ? v : {});
export const today = () => new Date().toISOString().slice(0, 10);
export const nameOfUser = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
export const cleanText = (v: unknown) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
export const oneLine = (v: unknown, max: number) => cleanText(v).replace(/\s+/g, ' ').slice(0, max);
export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
export const reasonOf = (b: Obj, min = 10) => {
    const r = cleanText(b.reason);
    if (r.length < min || r.length > 400) throw new HttpError(400, `Give a reason of ${min} to 400 characters.`);
    return r;
};

export const PO_STATUS: Record<string, string> = {
    draft: 'Draft',
    validated: 'Validated',
    pending_approval: 'Confirmed, in approval',
    open: 'Approved, open',
    sent: 'Sent to supplier',
    partial: 'Delivered partially',
    full: 'Delivered in full',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    returned: 'Returned, replaced by a new version',
    superseded: 'Superseded by a newer version',
};
export const RQ_STATUS: Record<string, string> = {
    draft: 'Draft: waiting for the requester',
    confirmed: 'Confirmed by the requester',
    returned: 'Returned by the requester',
    converted: 'Converted to a purchase order',
    suspended: 'Suspended: being revised',
    cancelled: 'Cancelled',
};
export const PLACED = ['open', 'sent', 'partial', 'full'];
export const DELIVERING = ['open', 'sent', 'partial'];
export const TYPE_LABEL: Record<string, string> = { material: 'Materials', service: 'Services', asset: 'Assets' };
const COMPETITION: Record<string, number> = { direct: 0, single_source: 0, rfq: 1, rfp: 1, rft: 2, open_tender: 3 };

// ----- Rates, prices and items -----

/** Latest conversion of each currency to the organization currency, from the platform currency list. */
async function ratesOf(orgCurrency: string) {
    const doc = await getDoc('reference/currencies');
    const per = new Map<string, number>([['USD', 1]]);
    for (const c of objs(doc?.data.items)) {
        const u = Number(c.unitsPerUsd);
        if (c.enabled !== false && /^[A-Z]{3}$/.test(str(c.code)) && u > 0) per.set(str(c.code), u);
    }
    const rate = (code: string): number | null => {
        if (!code) return null;
        if (code === orgCurrency) return 1;
        const q = per.get(code);
        const b = per.get(orgCurrency);
        return q && b ? Math.round((b / q) * 1e6) / 1e6 : null;
    };
    return { rate, asOf: str(doc?.data.ratesUpdatedAt) || str(doc?.data.loadedAt) };
}

/** Two lines are the same material when they carry the same catalogue code, or the same name when there is no code. */
export const itemKey = (l: Obj) => {
    const code = str(l.itemCode);
    return code ? `${str(l.type)}:${code}` : `${str(l.type)}:n:${str(l.itemName).trim().toLowerCase()}`;
};
const netPrice = (ql: Obj | undefined, q: Obj) => {
    if (!ql) return 0;
    return round((Number(ql.unitPrice) || 0) * (1 - (Number(ql.discountPct) || 0) / 100) * (1 - (Number(q.discountPct) || 0) / 100), 4);
};

export interface LastPrice {
    unitPrice: number;
    currency: string;
    fxRate: number | null;
    vendorName: string;
    date: string;
    ref: string;
    source: string;
}

/** The last price paid or agreed for each item of a quotation: from placed orders, else from earlier recommended quotations. */
export async function lastPricesFor(orgId: string, orgCurrency: string, lines: Obj[], excludeCaseId = ''): Promise<Map<number, LastPrice>> {
    const want = new Map<string, number[]>();
    for (const l of lines) want.set(itemKey(l), [...(want.get(itemKey(l)) ?? []), Number(l.no)]);
    const found = new Map<string, LastPrice>();
    const [pos, cases] = await Promise.all([listDocs(ordersPath(orgId)), listDocs(casesPath(orgId))]);
    const offer = (k: string, p: LastPrice) => {
        const cur = found.get(k);
        if (!cur || p.date > cur.date) found.set(k, p);
    };
    for (const p of pos) {
        if (!PLACED.includes(str(p.data.status))) continue;
        const date = (str(p.data.approvedAt) || str(p.data.createdAt)).slice(0, 10);
        for (const l of objs(p.data.lines)) {
            const k = itemKey(l);
            const price = Number(l.netUnitPrice);
            if (want.has(k) && price > 0) offer(k, { unitPrice: price, currency: str(p.data.currency), fxRate: Number(p.data.fxRate) || null, vendorName: str(p.data.vendorName), date, ref: str(p.data.number) || p.id, source: 'Purchase order' });
        }
    }
    for (const c of cases) {
        if (c.id === excludeCaseId) continue;
        const rec = o(c.data.recommendation);
        const q = objs(c.data.quotes).find((x) => str(x.id) === str(rec.quoteId));
        if (!q) continue;
        const date = str(rec.at).slice(0, 10);
        for (const cl of objs(c.data.lines)) {
            const k = itemKey(cl);
            if (!want.has(k)) continue;
            const price = netPrice(objs(q.lines).find((x) => Number(x.no) === Number(cl.no) && x.bid !== false), q);
            if (price > 0) offer(k, { unitPrice: price, currency: str(q.currency), fxRate: str(q.currency) === orgCurrency ? 1 : Number(q.fxRate) || null, vendorName: str(q.vendorName), date, ref: str(c.data.number) || c.id, source: 'Recommended quotation' });
        }
    }
    const out = new Map<number, LastPrice>();
    for (const [k, nos] of want) {
        const p = found.get(k);
        if (p) for (const n of nos) out.set(n, p);
    }
    return out;
}

// ----- People and positions -----

interface Pos {
    title: string;
    parentCode: string;
}
export async function positionsMap(orgId: string): Promise<Map<string, Pos>> {
    return new Map((await listDocs(`organizations/${orgId}/positions`)).map((p): [string, Pos] => [p.id, { title: str(p.data.title), parentCode: str(p.data.parentCode) }]));
}
export function activeAssignments(user: Doc | null | undefined): Obj[] {
    const t = today();
    return objs(user?.data.assignments).filter((a) => str(a.positionCode) && (!str(a.startsOn) || str(a.startsOn) <= t) && (!str(a.endsOn) || str(a.endsOn) >= t));
}
export const myPositions = (user: Doc | null | undefined) => activeAssignments(user).map((a) => str(a.positionCode));
function primaryPosition(user: Doc | null | undefined): string {
    const list = activeAssignments(user);
    return str((list.find((a) => str(a.type) === 'primary') ?? list[0])?.positionCode);
}

export interface Step {
    level: string;
    title: string;
    positionCode: string;
    positionTitle: string;
    viaReportingLine: boolean;
    status: 'pending' | 'approved';
    by: string;
    byName: string;
    at: string;
    note: string;
}

/** Who must approve an amount: each level of the chart of authority resolved to the job role that holds it. */
async function approvalRoute(orgId: string, creator: Doc | null, amount: number, authority: Authority) {
    const resolved = resolveAuthority(authority, amount);
    const [pos, users] = await Promise.all([positionsMap(orgId), orgUsers(orgId)]);
    const problems: string[] = [];
    const steps: Step[] = [];
    for (const lv of resolved.approval.levels) {
        const def = authority.levels.find((l) => l.code === lv);
        const title = def?.title ?? lv;
        let position = def?.positionCode ?? '';
        let viaLine = false;
        if (!position && lv === 'L1') {
            position = pos.get(primaryPosition(creator))?.parentCode ?? '';
            viaLine = true;
            if (!position) {
                problems.push(`Level ${lv} (${title}) follows the reporting line, but the preparer has no job role with a manager. Assign the job role or map ${lv} in the chart of authority.`);
                continue;
            }
        }
        if (!position) {
            problems.push(`Level ${lv} (${title}) is not mapped to a job role. Ask the chart of authority administrator to map it.`);
            continue;
        }
        const holders = users.filter((u) => str(u.data.status) !== 'disabled' && u.id !== (creator?.id ?? '') && myPositions(u).includes(position)).length;
        const positionTitle = pos.get(position)?.title ?? position;
        if (!holders) problems.push(`Nobody other than the preparer holds ${positionTitle}, which approves level ${lv} (${title}).`);
        steps.push({ level: lv, title, positionCode: position, positionTitle, viaReportingLine: viaLine, status: 'pending', by: '', byName: '', at: '', note: '' });
    }
    return { amount, steps, problems, authorityVersion: authority.version, resolved };
}

// ----- Cost centers, owners and who may see an order -----

export interface Unit {
    id: string;
    code: string;
    name: string;
    level: string;
    parentId: string;
    managerRoleCode: string;
    managerUid: string;
    status: string;
}
/** The organization structure: legal entities, sites, departments and cost centers. A cost center's code is its id. */
export async function unitsOf(orgId: string): Promise<Map<string, Unit>> {
    return new Map(
        (await listDocs(structureCol(orgId))).map((n): [string, Unit] => [
            n.id,
            { id: n.id, code: str(n.data.code) || n.id, name: str(n.data.name) || n.id, level: str(n.data.level), parentId: str(n.data.parentId), managerRoleCode: str(n.data.managerRoleCode), managerUid: str(n.data.managerUid), status: str(n.data.status) || 'active' },
        ])
    );
}
/** The unit and every unit above it, nearest first. */
export function chainOf(units: Map<string, Unit>, id: string): Unit[] {
    const out: Unit[] = [];
    let cur = units.get(id);
    for (let i = 0; cur && i < 12; i++) {
        out.push(cur);
        cur = units.get(cur.parentId);
    }
    return out;
}
export const ccOf = (l: Obj) => str(l.costCenterId) || str(l.costCenterCode);
/** Cost centers a person owns: they hold the cost center's manager job role at its site (or a unit above), or are named on it. */
export function ownedCostCenters(units: Map<string, Unit>, user: Doc | null | undefined): Set<string> {
    const out = new Set<string>();
    if (!user) return out;
    const mine = activeAssignments(user);
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
/** People who own one cost center, for the check that the person accepting a service is the owner. */
export function isCostCenterOwner(units: Map<string, Unit>, user: Doc | null | undefined, ccId: string): boolean {
    return ownedCostCenters(units, user).has(ccId);
}
export async function userHolds(orgId: string, user: Doc, perm: string): Promise<boolean> {
    const access = await effectiveAccess(orgId, normalizeOrgRole(str(user.data.role)), user);
    return access.permissions.includes('*') || hasPerm(access.permissions, perm);
}

// ----- Access and locking -----

export const canViewReq = (ctx: OrgContext) => can(ctx, 'PRC.prq.view') || can(ctx, 'PRC.prq.manage') || can(ctx, 'PRC.prq.approve');
export const canViewPo = (ctx: OrgContext) => can(ctx, 'PRC.po.view') || can(ctx, 'PRC.po.manage') || can(ctx, 'PRC.po.approve') || can(ctx, 'PRC.po.receive');
/** Buyers see their groups' orders; approvers and receivers see every order they may be asked to act on. */
export async function poScope(ctx: OrgContext): Promise<DeskScope> {
    const s = await deskScope(ctx);
    return !s.all && (can(ctx, 'PRC.po.approve') || can(ctx, 'PRC.po.receive')) ? { ...s, all: true } : s;
}

export const ownerOf = (d: Obj) => str(d.ownerUid) || str(d.createdBy);
export const isOwner = (ctx: OrgContext, d: Obj) => ownerOf(d) === ctx.uid;
export const requesterIds = (d: Obj) => (Array.isArray(d.requesterUids) ? (d.requesterUids as unknown[]).map(str) : []);

export interface Access {
    owner: boolean;
    creator: boolean;
    ccOwner: boolean;
    requester: boolean;
    approver: boolean;
    viewer: boolean;
    any: boolean;
}
/** Why a person may open an order: they are responsible for it, own a cost center in it, asked for something in it, approve it, or hold the permission and the buyer group. */
export function accessFlags(ctx: OrgContext, d: Obj, scope: DeskScope, owned: Set<string>): Access {
    const lines = objs(d.lines);
    const mine = new Set(myPositions(ctx.me));
    const a = {
        owner: ownerOf(d) === ctx.uid,
        creator: str(d.createdBy) === ctx.uid,
        ccOwner: lines.some((l) => owned.has(ccOf(l))),
        requester: requesterIds(d).includes(ctx.uid),
        approver: steps(d).some((s) => mine.has(s.positionCode)) && can(ctx, 'PRC.po.approve'),
        viewer: canViewPo(ctx) && covers(scope, lines),
    };
    return { ...a, any: Object.values(a).some(Boolean) };
}

/** An order by its number. A number without a version (PO00000012) opens the newest version. */
export async function resolvePo(orgId: string, id: string): Promise<Doc | null> {
    if (!PO_ID.test(id)) return null;
    if (BASE_ID.test(id)) {
        const siblings = (await listDocs(ordersPath(orgId))).filter((p) => baseOf(p.id) === id);
        return siblings.sort((a, b) => verOf(b.id) - verOf(a.id))[0] ?? null;
    }
    return getDoc(`${ordersPath(orgId)}/${id}`);
}
export async function versionsOf(orgId: string, base: string): Promise<Doc[]> {
    return (await listDocs(ordersPath(orgId))).filter((p) => baseOf(p.id) === base).sort((a, b) => verOf(a.id) - verOf(b.id));
}

export async function lock<T>(ctx: OrgContext, id: string, fn: () => Promise<T>): Promise<T> {
    const path = `organizations/${ctx.orgId}/procurement_order_locks/${id}`;
    if (!(await writeDoc(path, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This record is being updated by someone else. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}

export interface Change {
    patch: Obj;
    label: string;
    event?: string;
    note?: string;
    result?: Obj;
}
/** One change to a requisition or order under a lock, re-read, checked, added to its history and audited. */
export async function mutate(ctx: OrgContext, col: 'req' | 'po', id: string, action: string, run: (d: Obj) => Promise<Change>) {
    const path = `${col === 'req' ? reqsPath(ctx.orgId) : ordersPath(ctx.orgId)}/${id}`;
    return lock(ctx, id, async () => {
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, col === 'req' ? 'Requisition not found.' : 'Purchase order not found.');
        const d = fresh.data;
        const c = await run(d);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, version: (Number(d.version) || 1) + 1 };
        if (c.event) next.history = [...objs(d.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: c.note ?? '', from: str(d.status), to: str(next.status) }];
        await writeDoc(path, next);
        await record(ctx, `org.procurement.${col === 'req' ? 'requisition' : 'order'}.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), ...(c.result ?? {}) } as { ok: boolean; id: string; status: string; done?: boolean; [k: string]: unknown };
    });
}

// ----- Requisitions -----

async function loadReq(ctx: OrgContext, id: string): Promise<Doc> {
    requireProcurement(ctx);
    if (!RQ_ID.test(id)) throw new HttpError(404, 'Requisition not found.');
    const [doc, scope, units] = await Promise.all([getDoc(`${reqsPath(ctx.orgId)}/${id}`), deskScope(ctx), unitsOf(ctx.orgId)]);
    if (!doc) throw new HttpError(404, 'Requisition not found.');
    const mine = str(doc.data.requesterUid) === ctx.uid;
    const lines = objs(doc.data.lines);
    const owned = ownedCostCenters(units, ctx.me);
    const ccOwner = lines.some((l) => owned.has(ccOf(l)));
    if (!mine && !ccOwner && !(canViewReq(ctx) && covers(scope, lines))) throw new HttpError(404, 'Requisition not found.');
    return doc;
}

function reqRow(d: Obj, id: string) {
    return {
        id,
        number: str(d.number) || id,
        status: str(d.status),
        statusLabel: RQ_STATUS[str(d.status)] ?? str(d.status),
        quotationNumber: str(d.quotationNumber),
        requirementId: str(d.requirementId),
        requirementTitle: str(d.requirementTitle),
        requesterName: str(d.requesterName),
        vendorName: str(d.vendorName),
        currency: str(d.currency),
        total: Number(d.total) || 0,
        items: objs(d.lines).length,
        groups: str(d.groupLabel),
        orderNumber: str(d.orderNumber),
        poType: str(d.poType),
        poTypeLabel: TYPE_LABEL[str(d.poType)] ?? '',
        rqRev: Number(d.rqRev) || 1,
        validUntil: str(d.validUntil),
        expired: !!str(d.validUntil) && str(d.validUntil) < today() && !['converted', 'cancelled'].includes(str(d.status)),
        createdAt: str(d.createdAt),
        updatedAt: str(d.updatedAt),
    };
}

// ----- Orders -----

export type PoDoc = Doc & { acc: Access };
/** Opens an order for someone who is responsible for it, owns a cost center in it, asked for something in it, approves it or holds the permission and buyer group. */
export async function loadPo(ctx: OrgContext, id: string): Promise<PoDoc> {
    requireProcurement(ctx);
    if (!PO_ID.test(id)) throw new HttpError(404, 'Purchase order not found.');
    const [doc, scope, units] = await Promise.all([resolvePo(ctx.orgId, id), poScope(ctx), unitsOf(ctx.orgId)]);
    if (!doc) throw new HttpError(404, 'Purchase order not found.');
    const acc = accessFlags(ctx, doc.data, scope, ownedCostCenters(units, ctx.me));
    if (!acc.any) throw new HttpError(404, 'Purchase order not found.');
    return { ...doc, acc };
}
/** Changes to an order are made only by the person responsible for it. */
export function needOwner(ctx: OrgContext, d: Obj) {
    if (!isOwner(ctx, d)) throw new HttpError(403, `Only ${str(d.ownerName) || 'the person responsible for this order'} can do this. If they are away, someone holding the reassign right can hand the order over.`);
}
export const poTypeOf = (lines: Obj[]): string => {
    const t = Array.from(new Set(lines.map((l) => str(l.type)).filter(Boolean)));
    return t.length === 1 ? t[0] : t.length ? 'mixed' : '';
};
const financePath = (orgId: string) => `organizations/${orgId}/procurement_setup/finance`;
const inForce = (s: string) => ['draft', 'validated', 'pending_approval', ...PLACED].includes(s);

export const steps = (d: Obj): Step[] => objs(o(d.approval).steps) as unknown as Step[];
const currentStep = (d: Obj): Step | undefined => steps(d).find((s) => s.status === 'pending');
export const editable = (d: Obj) => ['draft', 'validated'].includes(str(d.status));
export const outstanding = (l: Obj) => Math.max(0, round((Number(l.quantity) || 0) - (Number(l.receivedQty) || 0), 4));

/** May this person approve the current level of this order now, and if not, why not. */
export function approverCheck(ctx: OrgContext, d: Obj): { ok: boolean; why: string } {
    if (str(d.status) !== 'pending_approval') return { ok: false, why: '' };
    const step = currentStep(d);
    if (!step) return { ok: false, why: '' };
    if (!can(ctx, 'PRC.po.approve')) return { ok: false, why: '' };
    if (!myPositions(ctx.me).includes(step.positionCode)) return { ok: false, why: `Level ${step.level} is approved by ${step.positionTitle}.` };
    if (ctx.uid === str(d.createdBy) || ctx.uid === str(d.confirmedBy) || ctx.uid === ownerOf(d)) return { ok: false, why: 'You prepared or confirmed this order, so someone else must approve it.' };
    const requesters = Array.isArray(d.requesterUids) ? (d.requesterUids as unknown[]).map(str) : [];
    if (requesters.includes(ctx.uid)) return { ok: false, why: 'You raised a requirement in this order, so someone else must approve it.' };
    if (steps(d).some((s) => s.status === 'approved' && s.by === ctx.uid)) return { ok: false, why: 'You approved an earlier level, so a different person must approve this one.' };
    return { ok: true, why: '' };
}

/** Who may see the quotes behind an order and its prices. The cost center owner always sees everything. */
export interface Visibility {
    quotes: string[];
    prices: string[];
}
export const DEFAULT_VISIBILITY: Visibility = { quotes: ['owner', 'approver', 'viewer'], prices: ['owner', 'approver', 'viewer', 'requester'] };
export const VIS_ROLES = ['owner', 'approver', 'viewer', 'requester'];
export async function visibilityOf(orgId: string): Promise<Visibility> {
    const doc = await getDoc(visibilityPath(orgId));
    const pick = (v: unknown, dflt: string[]) => (Array.isArray(v) ? (v as unknown[]).map(str).filter((x) => VIS_ROLES.includes(x)) : dflt);
    return { quotes: pick(doc?.data.quotes, DEFAULT_VISIBILITY.quotes), prices: pick(doc?.data.prices, DEFAULT_VISIBILITY.prices) };
}
export function sees(ctx: OrgContext, acc: Access, vis: Visibility, what: 'quotes' | 'prices'): boolean {
    if (acc.ccOwner || ctx.role === 'org_super_admin') return true;
    if (what === 'quotes' && can(ctx, 'PRC.po.viewquotes')) return true;
    return vis[what].some((r) => (acc as unknown as Record<string, boolean>)[r]);
}
export const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
const isExpired = (d: Obj) => ['draft', 'validated'].includes(str(d.status)) && objs(d.lines).some((l) => str(l.quoteValidUntil) && str(l.quoteValidUntil) < today());

function poRow(d: Obj, id: string, ctx: OrgContext, acc?: Access, priceOk = true) {
    const step = currentStep(d);
    const lines = objs(d.lines);
    const sent = str(d.sentAt) || str(d.approvedAt);
    const quoted = Math.max(0, ...lines.map((l) => Number(l.leadTimeDays) || 0));
    const live = PLACED.includes(str(d.status));
    const done = str(d.deliveredAt);
    const ageFrom = str(d.originAt) || str(d.createdAt);
    const ageTo = live && !done ? nowIso() : done || str(d.updatedAt) || nowIso();
    const dueOn = sent && quoted ? addDays(sent.slice(0, 10), quoted) : '';
    const ack = o(d.ack);
    return {
        id,
        number: str(d.number) || id,
        baseNumber: baseOf(id),
        ver: verOf(id),
        poType: str(d.poType) || poTypeOf(lines),
        poTypeLabel: TYPE_LABEL[str(d.poType) || poTypeOf(lines)] ?? 'Mixed',
        status: str(d.status),
        statusLabel: PO_STATUS[str(d.status)] ?? str(d.status),
        vendorName: str(d.vendorName),
        currency: str(d.currency),
        total: priceOk ? Number(d.total) || 0 : null,
        baseTotal: priceOk ? Number(d.baseTotal) || 0 : null,
        lines: lines.length,
        groups: str(d.groupLabel),
        waitingFor: str(d.status) === 'pending_approval' && step ? `${step.level} ${step.positionTitle}` : '',
        mine: ownerOf(d) === ctx.uid,
        ownerName: str(d.ownerName) || str(d.createdByName),
        canApprove: approverCheck(ctx, d).ok,
        createdByName: str(d.createdByName),
        createdAt: str(d.createdAt),
        approvedAt: str(d.approvedAt),
        sentAt: str(d.sentAt),
        updatedAt: str(d.updatedAt),
        acknowledged: !!str(ack.at),
        acknowledgedAt: str(ack.at),
        expired: isExpired(d),
        ageDays: daysBetween(ageFrom, ageTo),
        leadQuotedDays: quoted,
        dueOn,
        overdue: live && !done && !!dueOn && dueOn < today(),
        access: acc ? { owner: acc.owner, ccOwner: acc.ccOwner, requester: acc.requester, approver: acc.approver } : undefined,
    };
}

// ----- Validation -----

interface Check {
    code: string;
    group: string;
    label: string;
    result: 'pass' | 'warn' | 'fail' | 'info';
    detail: string;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

async function runChecks(ctx: OrgContext, po: Obj, id: string) {
    const checks: Check[] = [];
    const add = (group: string, code: string, label: string, result: Check['result'], detail: string) => checks.push({ code, group, label, result, detail });
    const orgCurrency = str(ctx.org.data.currencyCode);
    const currency = str(po.currency);
    const lines = objs(po.lines);
    const base = baseOf(id);
    const [vendorDoc, authority, fx, allOrders, users, caseDocs, units, finance, rqDocs] = await Promise.all([
        getDoc(`${vendorsPath(ctx.orgId)}/${str(po.vendorId)}`),
        getAuthority(ctx.orgId),
        ratesOf(orgCurrency),
        listDocs(ordersPath(ctx.orgId)),
        orgUsers(ctx.orgId),
        Promise.all(Array.from(new Set(lines.map((l) => str(l.quotationId)))).filter(Boolean).map((cid) => getDoc(`${casesPath(ctx.orgId)}/${cid}`))),
        unitsOf(ctx.orgId),
        getDoc(financePath(ctx.orgId)),
        Promise.all(Array.from(new Set(lines.map((l) => str(l.requisitionId)))).filter(Boolean).map((rid) => getDoc(`${reqsPath(ctx.orgId)}/${rid}`))),
    ]);
    // Other versions of this same order are not "other orders".
    const orders = allOrders.filter((p) => baseOf(p.id) !== base);
    const v = vendorDoc?.data ?? null;
    const c = authority.controls;

    // Value in the organization currency: at the latest rate, compared with the rate on the quotes.
    const total = round(lines.reduce((s, l) => s + (Number(l.total) || 0), 0));
    const latest = fx.rate(currency);
    const quoteBase = round(lines.reduce((s, l) => s + (Number(l.total) || 0) * (Number(l.quoteFxRate) || 0), 0));
    const fxRate = latest ?? (quoteBase > 0 && total > 0 ? round(quoteBase / total, 6) : null);
    const baseTotal = fxRate ? round(total * fxRate) : 0;

    // ----- Procurement standards -----
    const kinds = Array.from(new Set(lines.map((l) => str(l.type))));
    add('Procurement', 'type.pure', 'One kind of purchase per order', kinds.length === 1 && TYPE_LABEL[kinds[0]] ? 'pass' : 'fail', kinds.length === 1 && TYPE_LABEL[kinds[0]] ? `The whole order is ${TYPE_LABEL[kinds[0]].toLowerCase()}.` : `An order is entirely materials, entirely services or entirely assets. This one mixes ${kinds.map((k) => TYPE_LABEL[k] ?? (k || 'unknown')).join(', ')}. Drop the lines of the other kind and order them separately.`);
    const noCc = lines.filter((l) => !ccOf(l) || !str(l.glCode) || !units.get(ccOf(l)) || units.get(ccOf(l))!.status === 'inactive');
    add('Procurement', 'cost.centers', 'Cost center and GL account on every line', noCc.length ? 'fail' : 'pass', noCc.length ? `Line ${noCc.map((l) => l.no).join(', ')} has no active cost center or no GL account, so the cost cannot be charged.` : 'Every line is charged to an active cost center and a GL account.');
    const overQty = lines.filter((l) => Number(l.reqQuantity) > 0 && Number(l.quantity) > Number(l.reqQuantity) + 1e-9);
    const rqBad = rqDocs.filter((r) => !r || str(r.data.status) !== 'converted' || baseOf(str(r.data.orderId)) !== base);
    add('Procurement', 'requisition.link', 'Lines match their confirmed requisitions', overQty.length || rqBad.length ? 'fail' : 'pass', overQty.length ? `Line ${overQty.map((l) => l.no).join(', ')} is for more than the requisition allows.` : rqBad.length ? 'A requisition behind this order is no longer confirmed and attached to it.' : 'Every line is within the quantity of a requisition confirmed by its requester.');
    if (str(po.amendOf)) {
        const prev = allOrders.find((p) => p.id === str(po.amendOf));
        const short = lines.filter((l) => { const pl = objs(prev?.data.lines).find((x) => Number(x.no) === Number(l.no)); return pl && Number(l.quantity) < (Number(pl.receivedQty) || 0); });
        const gone = objs(prev?.data.lines).filter((pl) => (Number(pl.receivedQty) || 0) > 0 && !lines.some((l) => Number(l.no) === Number(pl.no)));
        add('Procurement', 'amend.received', 'Amendment keeps what was already received', short.length || gone.length ? 'fail' : 'pass', short.length || gone.length ? 'An amended line cannot be for less than was already received, and a received line cannot be removed.' : 'Nothing already received is reduced.');
    }
    // Every line must use an account approved in the chart of its cost center's legal entity (and allowed for the cost center).
    const glBad: string[] = [];
    for (const l of lines) {
        try {
            await checkChosenGl(ctx.orgId, ccOf(l), str(l.glCode), `Line ${Number(l.no)}: `);
        } catch (e) {
            glBad.push(e instanceof Error ? e.message : `Line ${Number(l.no)}: GL account not allowed.`);
        }
    }
    add('Finance', 'finance.gl', 'GL accounts approved for the cost centers', glBad.length ? 'fail' : 'pass', glBad.length ? glBad.slice(0, 3).join(' ') : "Every line uses an approved, open GL account of its cost center's legal entity. Receipts post to GR/IR through the approved mapping.");

    // ----- Supplier -----
    if (!v) add('Supplier', 'vendor.found', 'Supplier is on record', 'fail', 'The supplier could not be found.');
    else {
        const status = str(v.status);
        add('Supplier', 'vendor.approved', 'Supplier is approved', status === 'approved' ? 'pass' : 'fail', status === 'approved' ? `${str(v.legalName)} is an approved supplier.` : `${str(v.legalName)} is ${status || 'not approved'}. Only approved suppliers can be bought from.`);
        const docs = objs(v.documents);
        const expired = docs.filter((x) => x.expires === true && str(x.expiry) && str(x.expiry) < today());
        const overrides = objs(v.overrides).filter((x) => x.resolved !== true && str(x.expiresAt) >= today());
        if (expired.length) add('Supplier', 'vendor.documents', 'Supplier documents are current', 'fail', `Expired: ${expired.map((x) => str(x.typeName)).join(', ')}.`);
        else if (overrides.length) add('Supplier', 'vendor.documents', 'Supplier documents are current', 'warn', `Documents still outstanding under a temporary override: ${overrides.map((x) => `${str(x.typeName)} (until ${str(x.expiresAt)})`).join(', ')}.`);
        else add('Supplier', 'vendor.documents', 'Supplier documents are current', 'pass', 'No document has expired.');
        const scopes = objs(v.scopes);
        const uncovered = lines.filter((l) => !scopes.some((s) => str(s.kind) === str(l.type) && str(s.categoryCode) === str(l.categoryCode) && (!str(s.subcategoryCode) || str(s.subcategoryCode) === str(l.subcategoryCode))));
        add('Supplier', 'vendor.scope', 'Supplier is registered for these categories', uncovered.length ? 'warn' : 'pass', uncovered.length ? `Not in the supplier's categories: ${Array.from(new Set(uncovered.map((l) => str(l.categoryName)))).join(', ')}.` : 'Every item is in a category the supplier is registered for.');
        if (str(v.conflict) === 'declared') add('Supplier', 'vendor.conflict', 'Conflict of interest', baseTotal >= c.conflictDeclarationFrom ? 'fail' : 'warn', `A conflict of interest is declared on this supplier${baseTotal >= c.conflictDeclarationFrom ? ` and the order is above ${fmt(c.conflictDeclarationFrom)}, so it cannot proceed until the supplier record is cleared` : ''}.`);
        else add('Supplier', 'vendor.conflict', 'Conflict of interest', 'pass', 'None declared.');
    }

    // ----- Cost -----
    const badLines = lines.filter((l) => !(Number(l.quantity) > 0) || !(Number(l.netUnitPrice) > 0));
    add('Cost', 'cost.lines', 'Every line has a quantity and a price', lines.length && !badLines.length ? 'pass' : 'fail', lines.length ? (badLines.length ? `Lines without quantity or price: ${badLines.map((l) => l.no).join(', ')}.` : `${lines.length} line(s), ${currency} ${fmt(total)}.`) : 'The order has no lines.');
    if (!fxRate) add('Cost', 'cost.rate', 'Exchange rate', 'fail', `No rate to ${orgCurrency} is available for ${currency}.`);
    else if (currency === orgCurrency) add('Cost', 'cost.rate', 'Exchange rate', 'pass', `Order in ${orgCurrency}.`);
    else {
        const moved = quoteBase > 0 ? Math.abs(baseTotal - quoteBase) / quoteBase : 0;
        add('Cost', 'cost.rate', 'Exchange rate', moved > 0.05 ? 'warn' : 'pass', `${currency} ${fmt(total)} is ${orgCurrency} ${fmt(baseTotal)} at the latest rate${fx.asOf ? ` (${fx.asOf.slice(0, 10)})` : ''} and ${orgCurrency} ${fmt(quoteBase)} at the rate on the quotes${moved > 0.05 ? `. The rate has moved ${(moved * 100).toFixed(1)}%.` : '.'}`);
    }
    const stale = lines.filter((l) => str(l.quoteValidUntil) && str(l.quoteValidUntil) < today());
    add('Cost', 'cost.validity', 'Quotes are still valid', stale.length ? 'fail' : 'pass', stale.length ? `The quote expired on ${Array.from(new Set(stale.map((l) => str(l.quoteValidUntil)))).join(', ')}. An order cannot be submitted on an expired price. Suspend the requisition, revise it with the supplier's new price and validity, and have the requester confirm it again.` : 'Every quote is within its validity.');
    const drift: string[] = [];
    const revised: string[] = [];
    for (const l of lines) {
        const cd = caseDocs.find((x) => x && x.id === str(l.quotationId));
        const quote = objs(cd?.data.quotes).find((q) => str(q.id) === str(o(cd?.data.recommendation).quoteId));
        const qp = quote ? netPrice(objs(quote.lines).find((x) => Number(x.no) === Number(l.requirementLineNo || l.no) && x.bid !== false), quote) : Number(l.quotePrice) || 0;
        const net = Number(l.netUnitPrice) || 0;
        if (l.priceRevised === true) revised.push(`line ${l.no}`);
        else if (qp > 0 && net > qp * (1 + c.matchTolerancePct / 100) + 1e-9) drift.push(`line ${l.no} is ${fmt(net)} against ${fmt(qp)} quoted`);
    }
    add('Cost', 'cost.pricematch', 'Order price equals the quoted price', drift.length ? 'fail' : revised.length ? 'warn' : 'pass', drift.length ? `The price is above the quotation (tolerance ${c.matchTolerancePct}%): ${drift.join('; ')}.` : revised.length ? `Prices on ${revised.join(', ')} were revised after the quote and confirmed by the requester. Check them with the supplier.` : 'Every price equals the recommended quotation.');
    const notRec = caseDocs.filter((d) => d && str(d.data.status) !== 'recommended');
    add('Cost', 'cost.recommended', 'Price is from a recommended quotation', notRec.length ? 'fail' : 'pass', notRec.length ? `${notRec.map((d) => str(d!.data.number)).join(', ')} is no longer recommended.` : 'Prices are those of the recommended quotation(s).');
    const budgeted = lines.filter((l) => typeof l.budget === 'number' && (l.budget as number) > 0);
    const over = budgeted.filter((l) => fxRate && (Number(l.total) || 0) * fxRate > (l.budget as number) * (1 + c.matchTolerancePct / 100));
    if (c.budgetRequired && !budgeted.length) add('Cost', 'cost.budget', 'Within budget', 'warn', 'No budget was recorded on the items, so the order cannot be checked against one.');
    else add('Cost', 'cost.budget', 'Within budget', over.length ? 'warn' : 'pass', over.length ? `Above the item budget (tolerance ${c.matchTolerancePct}%): line ${over.map((l) => l.no).join(', ')}.` : budgeted.length ? 'Every budgeted line is within budget.' : 'No budget recorded.');
    const sourcing = resolveAuthority(authority, baseTotal);
    const shorts: string[] = [];
    const lessCompetition: string[] = [];
    for (const d of caseDocs) {
        if (!d) continue;
        const received = objs(d.data.quotes).length;
        if (received < sourcing.sourcing.minQuotes && !str(o(d.data.recommendation).shortfallReason)) shorts.push(`${str(d.data.number)} has ${received} quote(s)`);
        const mode = str(o(d.data.review).mode);
        if ((COMPETITION[mode] ?? 0) < (COMPETITION[sourcing.sourcing.method] ?? 0)) lessCompetition.push(`${str(d.data.number)} was sourced by ${METHODS.find((m) => m.code === mode)?.label ?? mode}`);
    }
    add('Cost', 'cost.sourcing', 'Sourcing follows the chart of authority', shorts.length || lessCompetition.length ? 'warn' : 'pass', shorts.length || lessCompetition.length ? `For ${orgCurrency} ${fmt(baseTotal)} the chart asks for ${sourcing.sourcing.methodLabel} and ${sourcing.sourcing.minQuotes} quote(s). ${[...shorts, ...lessCompetition].join('; ')}.` : `${sourcing.sourcing.methodLabel} with ${sourcing.sourcing.minQuotes} quote(s) is met.`);
    if (baseTotal >= c.contractThreshold) add('Cost', 'cost.contract', 'Written contract', str(po.contractRef) ? 'pass' : 'warn', str(po.contractRef) ? `Contract reference ${str(po.contractRef)}.` : `Orders from ${orgCurrency} ${fmt(c.contractThreshold)} need a written contract. Enter its reference on the order.`);
    const since = addDays(today(), -c.splitOrderDays);
    const recent = orders.filter((p) => p.id !== id && str(p.data.vendorId) === str(po.vendorId) && ['pending_approval', ...PLACED].includes(str(p.data.status)) && (str(p.data.createdAt).slice(0, 10) >= since));
    const recentBase = recent.reduce((s, p) => s + (Number(p.data.baseTotal) || 0), 0);
    if (c.splitOrderDays > 0 && recent.length) {
        const own = resolveAuthority(authority, baseTotal).approval.approvers;
        const combined = resolveAuthority(authority, baseTotal + recentBase).approval.approvers;
        add('Cost', 'cost.split', 'Not a split order', combined > own ? 'warn' : 'pass', `${recent.length} other order(s) to this supplier in the last ${c.splitOrderDays} days total ${orgCurrency} ${fmt(recentBase)}. ${combined > own ? `Together they would need ${combined} approver(s) instead of ${own}.` : 'The approval band does not change.'}`);
    } else add('Cost', 'cost.split', 'Not a split order', 'pass', `No other order to this supplier in the last ${c.splitOrderDays} days.`);

    // ----- Service level agreements -----
    const today0 = today();
    const slas = objs(v?.slas).filter((s) => str(s.status) !== 'ended' && (!str(s.validFrom) || str(s.validFrom) <= today0) && (!str(s.validTo) || str(s.validTo) >= today0));
    const lead = Math.max(0, ...lines.map((l) => Number(l.leadTimeDays) || 0));
    const warranty = Math.min(...lines.map((l) => (Number(l.warrantyMonths) > 0 ? Number(l.warrantyMonths) : Infinity)));
    if (!slas.length) add('Service level', 'sla.none', 'Supplier SLA', 'info', 'No active SLA is on file for this supplier, so there is nothing to compare.');
    for (const s of slas) {
        const applies = !Array.isArray(s.categoryKeys) || !(s.categoryKeys as unknown[]).length || lines.some((l) => (s.categoryKeys as unknown[]).map(str).includes(`${str(l.type)}|${str(l.categoryCode)}`));
        if (!applies) continue;
        const name = `SLA ${str(s.ref) || str(s.title)}`;
        const max = Number(s.maxLeadTimeDays) || 0;
        if (max > 0) add('Service level', `sla.${str(s.id)}.lead`, `${name}: lead time`, lead > max ? 'warn' : 'pass', `Quoted lead time ${lead} day(s) against an agreed maximum of ${max}.`);
        const minW = Number(s.minWarrantyMonths) || 0;
        if (minW > 0) add('Service level', `sla.${str(s.id)}.warranty`, `${name}: warranty`, warranty === Infinity ? 'warn' : warranty < minW ? 'warn' : 'pass', warranty === Infinity ? `No warranty is quoted; the SLA asks for ${minW} month(s).` : `Quoted warranty ${warranty} month(s) against an agreed minimum of ${minW}.`);
        if (str(s.paymentTermsCode)) add('Service level', `sla.${str(s.id)}.terms`, `${name}: payment terms`, str(po.paymentTermsCode) === str(s.paymentTermsCode) ? 'pass' : 'warn', `Order terms ${str(po.paymentTermsLabel) || '-'} against SLA terms ${str(s.paymentTermsLabel) || str(s.paymentTermsCode)}.`);
    }

    // ----- Deliveries -----
    const pending = orders.filter((p) => p.id !== id && ['pending_approval', ...DELIVERING].includes(str(p.data.status)));
    let anyOpen = false;
    const byKey = new Map<string, Obj>();
    for (const l of lines) if (!byKey.has(itemKey(l))) byKey.set(itemKey(l), l);
    for (const [k, l] of byKey) {
        const hits: string[] = [];
        for (const p of pending) {
            for (const pl of objs(p.data.lines)) {
                if (itemKey(pl) !== k) continue;
                const left = str(p.data.status) === 'pending_approval' ? Number(pl.quantity) || 0 : outstanding(pl);
                if (left <= 0) continue;
                const base = (str(p.data.sentAt) || str(p.data.approvedAt)).slice(0, 10);
                const due = base ? addDays(base, Number(pl.leadTimeDays) || 0) : '';
                hits.push(`${fmt(left)} ${str(pl.unit)} on ${str(p.data.number) || p.id} (${str(p.data.vendorName)}${str(p.data.status) === 'pending_approval' ? ', awaiting approval' : due ? `, due ${due}` : ''})`);
            }
        }
        if (hits.length) {
            anyOpen = true;
            add('Deliveries', `open.${k}`, `Open deliveries: ${str(l.itemName)}`, 'warn', `Already on order: ${hits.join('; ')}.`);
        }
    }
    if (!anyOpen) add('Deliveries', 'open.none', 'Open deliveries of the same material', 'pass', 'No other order, from any supplier, has this material still to be delivered.');
    const late = lines.filter((l) => str(l.dateRequired) && addDays(today0, Number(l.leadTimeDays) || 0) > str(l.dateRequired));
    add('Deliveries', 'delivery.timing', 'Delivery meets the date required', late.length ? 'warn' : 'pass', late.length ? `Expected after the date required: ${late.map((l) => `line ${l.no} (needed ${str(l.dateRequired)}, lead time ${Number(l.leadTimeDays) || 0} days)`).join('; ')}.` : 'Every line can arrive by the date required.');

    // ----- Approval -----
    const creator = users.find((u) => u.id === str(po.createdBy)) ?? null;
    const route = baseTotal > 0 ? await approvalRoute(ctx.orgId, creator, baseTotal, authority) : null;
    if (route) add('Approval', 'approval.route', 'Approval route exists', route.problems.length ? 'fail' : 'pass', route.problems.length ? route.problems.join(' ') : `${route.steps.map((s) => `${s.level} ${s.positionTitle}`).join(' then ')} will approve ${orgCurrency} ${fmt(baseTotal)}.`);
    const unconfirmed = Array.from(new Set(lines.map((l) => str(l.requisitionId)))).length;
    add('Approval', 'approval.requisitions', 'Requisitions confirmed by their requesters', 'pass', `${unconfirmed} requisition(s), each confirmed by the person who raised the requirement.`);

    return { checks, total, baseTotal, fxRate, fxAsOf: fx.asOf, quoteBase };
}

// ----- Sending -----

async function secret(name: string): Promise<string> {
    try {
        return String((await secrets.readSecret(name)) ?? '').trim();
    } catch {
        return '';
    }
}
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string);

async function mailerReady(): Promise<boolean> {
    return !!((await secret('RESEND_API_KEY')) && (await secret('PO_FROM_EMAIL')));
}

async function emailOrder(ctx: OrgContext, d: Obj, id: string): Promise<void> {
    const [key, from] = await Promise.all([secret('RESEND_API_KEY'), secret('PO_FROM_EMAIL')]);
    if (!key || !from) throw new HttpError(409, 'Automatic email is not set up. Print the order and send it, or ask the administrator to connect an email service.');
    const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${str(d.vendorId)}`);
    const to = str(o(vendor?.data.contact).email);
    if (!to) throw new HttpError(409, 'The supplier has no contact email on record.');
    const orgName = str(ctx.org.data.name) || str(ctx.org.data.legalName) || 'Our organization';
    const rows = objs(d.lines)
        .map((l) => `<tr><td>${esc(l.no)}</td><td>${esc(l.itemName)}</td><td style="text-align:right">${esc(l.quantity)} ${esc(l.unit)}</td><td style="text-align:right">${esc(fmt(Number(l.netUnitPrice) || 0))}</td><td style="text-align:right">${esc(fmt(Number(l.total) || 0))}</td><td>${esc(l.dateRequired)}</td></tr>`)
        .join('');
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Dear ${esc(str(v(vendor)))},</p><p>Please find purchase order <strong>${esc(d.number)}</strong> from ${esc(orgName)}.</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#ccc"><thead><tr><th>No</th><th>Item</th><th>Quantity</th><th>Unit price (${esc(d.currency)})</th><th>Total (${esc(d.currency)})</th><th>Required by</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Order total: ${esc(d.currency)} ${esc(fmt(Number(d.total) || 0))}</strong><br/>Payment terms: ${esc(d.paymentTermsLabel)}</p>${str(d.notes) ? `<p>${esc(d.notes)}</p>` : ''}<p>Please confirm receipt of this order and the delivery date by replying to this email, quoting ${esc(d.number)}.</p></div>`;
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: `Purchase order ${str(d.number)} from ${orgName}`, html, reply_to: str(ctx.me.data.email) || undefined }),
    });
    if (!res.ok) throw new HttpError(502, `The email service refused the message (${res.status}). The order stays open; print it or try again.`);
    void id;
}
const v = (vendor: Doc | null) => str(vendor?.data.legalName) || 'Supplier';

async function sendOrder(ctx: OrgContext, id: string, method: 'email' | 'print', auto: boolean) {
    return mutate(ctx, 'po', id, 'send', async (d) => {
        if (!(str(d.status) === 'open' || (str(d.status) === 'partial' && !!str(d.amendOf) && !str(d.sentAt)))) throw new HttpError(409, 'Only an approved order that has not been sent can be sent.');
        if (method === 'email') await emailOrder(ctx, d, id);
        const at = nowIso();
        return {
            patch: { status: str(d.status) === 'open' ? 'sent' : str(d.status), sentAt: at, sentBy: auto ? 'system' : ctx.uid, sentByName: auto ? 'Automatic' : nameOfUser(ctx.me), sentMethod: method, sendError: '' },
            event: method === 'email' ? (auto ? 'sent by email (automatic)' : 'sent by email') : 'printed and sent',
            label: method === 'email' ? 'Sent to the supplier by email' : 'Recorded as printed and sent',
        };
    });
}

// ----- Order settings -----

async function orderSettings(orgId: string) {
    const doc = await getDoc(settingsPath(orgId));
    return { autoSend: doc?.data.autoSend === true, version: Number(doc?.data.version) || 0 };
}

// ----- Building order lines from a requisition -----

function poLinesFrom(rq: Obj, rqId: string, firstNo: number): Obj[] {
    return objs(rq.lines).map((l, i) => ({
        no: firstNo + i * 10,
        type: str(l.type),
        itemCode: str(l.itemCode),
        itemName: str(l.itemName),
        requirement: str(l.requirement),
        categoryCode: str(l.categoryCode),
        categoryName: str(l.categoryName),
        subcategoryCode: str(l.subcategoryCode),
        subcategoryName: str(l.subcategoryName),
        quantity: Number(l.quantity) || 0,
        unit: str(l.unit),
        unitPrice: Number(l.unitPrice) || 0,
        discountPct: Number(l.discountPct) || 0,
        netUnitPrice: Number(l.netUnitPrice) || 0,
        total: Number(l.total) || 0,
        quoteFxRate: Number(rq.quoteFxRate) || 0,
        quoteValidUntil: str(rq.validUntil),
        dateRequired: str(l.dateRequired),
        budget: typeof l.budget === 'number' ? l.budget : null,
        costCenterId: str(l.costCenterId),
        costCenterCode: str(l.costCenterCode),
        costCenterName: str(l.costCenterName),
        glCode: str(l.glCode),
        glName: str(l.glName),
        reqQuantity: Number(l.reqQuantity) || Number(l.quantity) || 0,
        quotePrice: Number(l.quotePrice) || Number(l.netUnitPrice) || 0,
        priceRevised: l.priceRevised === true,
        priceNote: str(l.priceNote),
        warehouseName: str(l.warehouseName),
        leadTimeDays: Number(l.leadTimeDays) || 0,
        warrantyMonths: Number(l.warrantyMonths) || 0,
        requisitionId: rqId,
        quotationId: str(rq.quotationId),
        requirementId: str(rq.requirementId),
        requirementLineNo: Number(l.requirementLineNo) || 0,
        receivedQty: 0,
    }));
}
const scopeKeysOf = (lines: Obj[]) => Array.from(new Set(lines.map(lineKeyOf))).sort();
const sumTotal = (lines: Obj[]) => round(lines.reduce((s, l) => s + (Number(l.total) || 0), 0));

/** A new version of an order (PO00000012-V2): a copy to correct and approve again. The earlier version is closed by the caller. */
async function forkVersion(ctx: OrgContext, src: Obj, srcId: string, kind: 'return' | 'amend', reason: string): Promise<string> {
    const base = baseOf(srcId);
    const versions = await versionsOf(ctx.orgId, base);
    const next = Math.max(1, ...versions.map((p) => verOf(p.id))) + 1;
    if (next > MAX_VERSIONS) throw new HttpError(400, `An order can have up to ${MAX_VERSIONS} versions.`);
    const id = `${base}-V${next}`;
    const at = nowIso();
    const amend = kind === 'amend';
    const data: Obj = {
        ...src,
        number: id,
        baseNumber: base,
        ver: next,
        status: 'draft',
        validation: null,
        approval: null,
        confirmedAt: '',
        confirmedBy: '',
        confirmedByName: '',
        approvedAt: '',
        sentAt: '',
        sentBy: '',
        sentByName: '',
        sentMethod: '',
        sendError: '',
        ack: null,
        returnReason: amend ? '' : reason,
        returnedBy: '',
        returnedByName: '',
        rejectReason: '',
        nextVersion: '',
        supersededBy: '',
        prevId: srcId,
        amendOf: amend ? srcId : '',
        amendReason: amend ? reason : '',
        baseTotal: 0,
        rev: 1,
        lines: objs(src.lines).map((l) => (amend ? { ...l } : { ...l, receivedQty: 0 })),
        ...(amend ? {} : { deliveries: [], deliverySeq: 0, firstDeliveryAt: '', deliveredAt: '' }),
        originAt: str(src.originAt) || str(src.createdAt),
        createdAt: at,
        updatedAt: at,
        version: 1,
        history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: amend ? 'amendment version created' : 'version created after return', note: `${id} from ${srcId}: ${reason}`.slice(0, 380), from: '', to: 'draft' }],
    };
    if (!(await writeDoc(`${ordersPath(ctx.orgId)}/${id}`, data, { exists: false }))) throw new HttpError(409, 'That version already exists. Please try again.');
    await record(ctx, 'org.procurement.order.version', id, `${kind} of ${srcId}: ${reason}`.slice(0, 380));
    return id;
}

// ----- Routes -----

export const purchaseOrderRoutes = {
    // ===== Requisitions =====

    'POST /api/org/procurement/requisitions/list': [
        orgRoute('org.procurement.requisitions.list', null, async (ctx) => {
            requireProcurement(ctx);
            const [scope, units] = await Promise.all([deskScope(ctx), unitsOf(ctx.orgId)]);
            const owned = ownedCostCenters(units, ctx.me);
            const view = canViewReq(ctx);
            const docs = (await listDocs(reqsPath(ctx.orgId))).filter((r) => str(r.data.requesterUid) === ctx.uid || objs(r.data.lines).some((l) => owned.has(ccOf(l))) || (view && covers(scope, objs(r.data.lines))));
            const views: Record<string, Doc[]> = {
                confirm: docs.filter((r) => str(r.data.status) === 'draft' && str(r.data.requesterUid) === ctx.uid),
                draft: docs.filter((r) => ['draft', 'returned', 'suspended'].includes(str(r.data.status))),
                ready: docs.filter((r) => str(r.data.status) === 'confirmed'),
                all: docs,
            };
            const which = str(ctx.body.view) || 'all';
            if (!(which in views)) throw new HttpError(400, 'Choose a view.');
            let waiting: Obj[] = [];
            if (can(ctx, 'PRC.prq.manage')) {
                const taken = new Set(docs.filter((r) => str(r.data.status) !== 'cancelled').map((r) => str(r.data.quotationId)));
                waiting = (await listDocs(casesPath(ctx.orgId)))
                    .filter((c) => str(c.data.status) === 'recommended' && covers(scope, objs(c.data.lines)))
                    .map((c) => {
                        const kinds = Array.from(new Set(objs(c.data.lines).map((l) => str(l.type))));
                        const open = kinds.filter((k) => !docs.some((r) => str(r.data.quotationId) === c.id && str(r.data.poType) === k && str(r.data.status) !== 'cancelled') && !(taken.has(c.id) && !docs.some((r) => str(r.data.quotationId) === c.id && str(r.data.poType))));
                        return { c, open };
                    })
                    .filter((x) => x.open.length)
                    .map(({ c, open }) => ({ id: c.id, number: str(c.data.number) || c.id, requirementTitle: str(c.data.requirementTitle), vendorName: str(o(c.data.recommendation).vendorName), total: Number(o(c.data.recommendation).total) || 0, items: objs(c.data.lines).length, kinds: open.map((k) => TYPE_LABEL[k] ?? k), recommendedAt: str(o(c.data.recommendation).at) }));
            }
            return {
                rows: views[which].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 2000).map((r) => reqRow(r.data, r.id)),
                counts: Object.fromEntries(Object.entries(views).map(([k, x]) => [k, x.length])),
                waiting,
                can: { manage: can(ctx, 'PRC.prq.manage'), convert: can(ctx, 'PRC.po.manage') },
            };
        }),
    ],

    'POST /api/org/procurement/requisitions/get': [
        orgRoute('org.procurement.requisitions.get', null, async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const d = doc.data;
            const status = str(d.status);
            const mine = str(d.requesterUid) === ctx.uid;
            const rates = await ratesOf(str(ctx.org.data.currencyCode));
            const latest = rates.rate(str(d.currency));
            const row = reqRow(d, doc.id);
            return {
                ...row,
                quotationId: str(d.quotationId),
                quoteRef: str(d.quoteRef),
                vendorId: str(d.vendorId),
                paymentTermsLabel: str(d.paymentTermsLabel),
                leadTimeDays: Number(d.leadTimeDays) || 0,
                quoteFxRate: Number(d.quoteFxRate) || null,
                latestRate: latest,
                latestBase: latest ? round((Number(d.total) || 0) * latest) : null,
                quoteBase: Number(d.quoteFxRate) ? round((Number(d.total) || 0) * Number(d.quoteFxRate)) : null,
                ratesAsOf: rates.asOf,
                orgCurrency: str(ctx.org.data.currencyCode),
                orderId: str(d.orderId),
                returnReason: str(d.returnReason),
                suspendReason: str(d.suspendReason),
                lines: objs(d.lines),
                history: objs(d.history).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note) })),
                can: {
                    confirm: mine && status === 'draft',
                    cancel: can(ctx, 'PRC.prq.manage') && ['draft', 'returned', 'confirmed', 'suspended'].includes(status),
                    reopen: can(ctx, 'PRC.prq.manage') && status === 'returned',
                    convert: can(ctx, 'PRC.po.manage') && status === 'confirmed' && !row.expired,
                    suspend: can(ctx, 'PRC.prq.manage') && ['confirmed', 'converted', 'draft'].includes(status),
                    revise: can(ctx, 'PRC.prq.manage') && status === 'suspended',
                },
                mine,
            };
        }),
    ],

    // A recommended quotation becomes requisitions in Draft: one for each kind of purchase (materials, services, assets).
    'POST /api/org/procurement/requisitions/create': [
        orgRoute('org.procurement.requisitions.create', 'PRC.prq.manage', async (ctx) => {
            requireProcurement(ctx);
            const qid = str(ctx.body.quotationId);
            if (!/^QTN\d{9}$/.test(qid)) throw new HttpError(404, 'Quotation not found.');
            const [qdoc, scope, existing] = await Promise.all([getDoc(`${casesPath(ctx.orgId)}/${qid}`), deskScope(ctx), listDocs(reqsPath(ctx.orgId))]);
            if (!qdoc || !covers(scope, objs(qdoc.data.lines))) throw new HttpError(404, 'Quotation not found.');
            const d = qdoc.data;
            if (str(d.status) !== 'recommended') throw new HttpError(409, 'Only a recommended quotation can become a requisition.');
            const rec = o(d.recommendation);
            const quote = objs(d.quotes).find((q) => str(q.id) === str(rec.quoteId));
            if (!quote) throw new HttpError(409, 'The recommended quote could not be found.');
            if (str(quote.validUntil) && str(quote.validUntil) < today()) throw new HttpError(409, `The recommended quote expired on ${str(quote.validUntil)}. Ask the supplier for a new quote before raising requisitions.`);
            const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${str(quote.vendorId)}`);
            if (!vendor || str(vendor.data.status) !== 'approved') throw new HttpError(409, 'The recommended vendor is not an approved vendor.');
            const req = await getDoc(`${requirementsPath(ctx.orgId)}/${str(d.requirementId)}`);
            if (!req) throw new HttpError(409, 'The purchase requirement could not be found.');
            const owners = await ownersOf(ctx.orgId);
            const caseLines = objs(d.lines);
            const kinds = Array.from(new Set(caseLines.map((l) => str(l.type)))).filter((k) => TYPE_LABEL[k]);
            if (!kinds.length || kinds.length !== Array.from(new Set(caseLines.map((l) => str(l.type)))).length) throw new HttpError(409, 'Every item must be a material, a service or an asset.');
            const todo = kinds.filter((k) => !existing.some((r) => str(r.data.quotationId) === qid && str(r.data.status) !== 'cancelled' && (str(r.data.poType) === k || !str(r.data.poType))));
            if (!todo.length) throw new HttpError(409, 'This quotation already has its requisitions.');
            const orgCurrency = str(ctx.org.data.currencyCode);
            const made: string[] = [];
            for (const kind of todo) {
                const mine = caseLines.filter((l) => str(l.type) === kind);
                const lines = mine.map((cl) => {
                    const ql = objs(quote.lines).find((x) => Number(x.no) === Number(cl.no) && x.bid !== false);
                    const net = netPrice(ql, quote);
                    const qty = Number(ql?.quantity) || Number(cl.quantity) || 0;
                    if (!ql || !(net > 0) || !(qty > 0)) throw new HttpError(409, `The recommended quote has no price for item ${Number(cl.no)}.`);
                    return {
                        ...cl,
                        requirementLineNo: Number(cl.no),
                        quantity: qty,
                        reqQuantity: qty,
                        unitPrice: Number(ql.unitPrice) || 0,
                        discountPct: Number(ql.discountPct) || 0,
                        netUnitPrice: net,
                        quotePrice: net,
                        total: round(qty * net),
                        leadTimeDays: Number(ql.leadTimeDays) || Number(quote.leadTimeDays) || 0,
                        warrantyMonths: Number(ql.warrantyMonths) || Number(quote.warrantyMonths) || 0,
                        no: Number(cl.no),
                    };
                });
                const groupMap = new Map<string, { id: string; number: string; name: string }>();
                for (const l of mine) {
                    const g = owners.get(lineKeyOf(l));
                    if (g && g.id) groupMap.set(g.id, g);
                }
                const groups = Array.from(groupMap.values());
                const n = await nextOrgCounter(ctx.orgId, 'requisitionSeq');
                if (n > 999_999_999) throw new HttpError(500, 'The requisition number range is exhausted.');
                const id = `PRQ${String(n).padStart(9, '0')}`;
                const at = nowIso();
                const data: Obj = {
                    number: id,
                    status: 'draft',
                    poType: kind,
                    rqRev: 1,
                    quotationId: qid,
                    quotationNumber: str(d.number) || qid,
                    requirementId: str(d.requirementId),
                    requirementTitle: str(d.requirementTitle),
                    requesterUid: str(req.data.requesterUid),
                    requesterName: str(req.data.requesterName),
                    vendorId: str(quote.vendorId),
                    vendorName: str(quote.vendorName) || str(vendor.data.legalName),
                    quoteId: str(quote.id),
                    quoteRef: str(quote.ref),
                    currency: str(quote.currency),
                    quoteFxRate: str(quote.currency) === orgCurrency ? 1 : Number(quote.fxRate) || 0,
                    paymentTermsCode: str(quote.paymentTermsCode),
                    paymentTermsLabel: str(quote.paymentTermsLabel),
                    leadTimeDays: Number(quote.leadTimeDays) || 0,
                    validUntil: str(quote.validUntil),
                    groupKey: groups.map((g) => g.id).sort().join('+'),
                    groupLabel: groups.map((g) => g.name).join(', '),
                    lines,
                    total: sumTotal(lines),
                    createdBy: ctx.uid,
                    createdByName: nameOfUser(ctx.me),
                    createdAt: at,
                    updatedAt: at,
                    version: 1,
                    history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'created from recommended quotation', note: `${str(d.number) || qid}, ${str(quote.vendorName)}, ${TYPE_LABEL[kind]}`, from: '', to: 'draft' }],
                };
                if (!(await writeDoc(`${reqsPath(ctx.orgId)}/${id}`, data, { exists: false }))) throw new HttpError(409, 'That requisition number is already in use. Please try again.');
                await record(ctx, 'org.procurement.requisition.create', id, `From ${str(d.number) || qid}, ${str(quote.vendorName)}, ${TYPE_LABEL[kind]}`);
                made.push(id);
            }
            return { ok: true, id: made[0], ids: made };
        }),
    ],

    // The person who raised the purchase requirement confirms the requisition made from it.
    'POST /api/org/procurement/requisitions/confirm': [
        orgRoute('org.procurement.requisitions.confirm', null, async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            if (str(doc.data.requesterUid) !== ctx.uid) throw new HttpError(403, 'Only the person who raised the purchase requirement can confirm this requisition.');
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that the items, quantities, prices and vendor are what you asked for.');
            return mutate(ctx, 'req', doc.id, 'confirm', async (d) => {
                if (str(d.status) !== 'draft') throw new HttpError(409, 'This requisition is no longer waiting for confirmation.');
                if (str(d.validUntil) && str(d.validUntil) < today()) throw new HttpError(409, `The quote expired on ${str(d.validUntil)}. Ask procurement to revise the requisition with a current price.`);
                const at = nowIso();
                return { patch: { status: 'confirmed', confirmedAt: at, confirmedBy: ctx.uid }, event: 'confirmed by the requester', note: Number(d.rqRev) > 1 ? `Revision ${Number(d.rqRev)}` : '', label: 'Requisition confirmed by the requester' };
            });
        }),
    ],

    'POST /api/org/procurement/requisitions/return': [
        orgRoute('org.procurement.requisitions.return', null, async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            if (str(doc.data.requesterUid) !== ctx.uid) throw new HttpError(403, 'Only the person who raised the purchase requirement can return this requisition.');
            const reason = reasonOf(ctx.body);
            return mutate(ctx, 'req', doc.id, 'return', async (d) => {
                if (str(d.status) !== 'draft') throw new HttpError(409, 'This requisition is no longer waiting for confirmation.');
                return { patch: { status: 'returned', returnReason: reason }, event: 'returned by the requester', note: reason, label: 'Returned by the requester' };
            });
        }),
    ],

    'POST /api/org/procurement/requisitions/reopen': [
        orgRoute('org.procurement.requisitions.reopen', 'PRC.prq.manage', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, 'req', doc.id, 'reopen', async (d) => {
                if (str(d.status) !== 'returned') throw new HttpError(409, 'Only a returned requisition can be sent back to the requester.');
                return { patch: { status: 'draft', returnReason: '' }, event: 'sent back to the requester', note: reason, label: 'Sent back to the requester' };
            });
        }),
    ],

    'POST /api/org/procurement/requisitions/cancel': [
        orgRoute('org.procurement.requisitions.cancel', 'PRC.prq.manage', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, 'req', doc.id, 'cancel', async (d) => {
                if (!['draft', 'returned', 'confirmed', 'suspended'].includes(str(d.status))) throw new HttpError(409, 'This requisition can no longer be cancelled.');
                return { patch: { status: 'cancelled', cancelReason: reason }, event: 'cancelled', note: reason, label: 'Cancelled' };
            });
        }),
    ],

    // Suspend a requisition whose price has expired or must change. If it sits in a draft order its lines leave that order.
    'POST /api/org/procurement/requisitions/suspend': [
        orgRoute('org.procurement.requisitions.suspend', 'PRC.prq.manage', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            const poId = str(doc.data.orderId);
            if (str(doc.data.status) === 'converted' && poId) {
                const po = await resolvePo(ctx.orgId, poId);
                if (!po) throw new HttpError(409, 'The order could not be found.');
                if (!editable(po.data)) throw new HttpError(409, 'The order is already submitted or approved. Return or cancel the order first; a submitted order cannot be changed.');
                await mutate(ctx, 'po', po.id, 'requisition.suspend', async (p) => {
                    if (!editable(p)) throw new HttpError(409, 'The order is no longer a draft.');
                    const lines = objs(p.lines).filter((l) => str(l.requisitionId) !== doc.id);
                    if (!lines.length) return { patch: { status: 'cancelled', cancelReason: `Requisition ${doc.id} suspended: ${reason}`, lines: [], total: 0, baseTotal: 0 }, event: 'cancelled', note: `Its only requisition ${doc.id} was suspended`, label: 'Cancelled: no lines left' };
                    return { patch: { lines, total: sumTotal(lines), baseTotal: 0, status: 'draft', validation: null, rev: (Number(p.rev) || 1) + 1 }, event: 'requisition suspended', note: `${doc.id}: ${reason}`, label: `Requisition ${doc.id} left the order` };
                });
            }
            return mutate(ctx, 'req', doc.id, 'suspend', async (d) => {
                if (!['confirmed', 'converted', 'draft'].includes(str(d.status))) throw new HttpError(409, 'This requisition cannot be suspended now.');
                return { patch: { status: 'suspended', suspendReason: reason, orderId: '', orderNumber: '' }, event: 'suspended', note: reason, label: 'Requisition suspended' };
            });
        }),
    ],

    // Revise a suspended requisition: new price, validity, quantity. The requester must confirm it again, then it goes back into an order and the approval starts afresh.
    'POST /api/org/procurement/requisitions/revise': [
        orgRoute('org.procurement.requisitions.revise', 'PRC.prq.manage', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            const validUntil = str(ctx.body.validUntil);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || validUntil < today()) throw new HttpError(400, 'Enter the new quote validity date. It cannot be in the past.');
            const given = objs(ctx.body.lines);
            return mutate(ctx, 'req', doc.id, 'revise', async (d) => {
                if (str(d.status) !== 'suspended') throw new HttpError(409, 'Only a suspended requisition can be revised.');
                const notes: string[] = [];
                const lines = objs(d.lines).map((l) => {
                    const g = given.find((x) => Number(x.no) === Number(l.no));
                    if (!g) return l;
                    const unitPrice = Number(g.unitPrice);
                    const disc = Number(g.discountPct) || 0;
                    const qty = Number(g.quantity);
                    const lead = Number(g.leadTimeDays);
                    if (!(unitPrice > 0) || unitPrice > 1e12 || disc < 0 || disc > 100 || !(qty > 0)) throw new HttpError(400, `Line ${Number(l.no)}: enter a price above zero, a discount of 0 to 100 and a quantity above zero.`);
                    if (qty > (Number(l.reqQuantity) || Number(l.quantity)) + 1e-9) throw new HttpError(400, `Line ${Number(l.no)}: the quantity cannot exceed what was asked for (${Number(l.reqQuantity) || Number(l.quantity)}).`);
                    const net = round(unitPrice * (1 - disc / 100), 4);
                    if (Math.abs(net - (Number(l.netUnitPrice) || 0)) > 1e-9 || qty !== Number(l.quantity)) notes.push(`line ${Number(l.no)} ${fmt(Number(l.netUnitPrice) || 0)}→${fmt(net)}, qty ${Number(l.quantity)}→${qty}`);
                    return { ...l, unitPrice, discountPct: disc, netUnitPrice: net, quantity: qty, total: round(qty * net), leadTimeDays: lead >= 0 && lead <= 3650 ? Math.floor(lead) : Number(l.leadTimeDays) || 0, priceRevised: true, priceNote: reason.slice(0, 200) };
                });
                return {
                    patch: { status: 'draft', lines, total: sumTotal(lines), validUntil, rqRev: (Number(d.rqRev) || 1) + 1, suspendReason: '', returnReason: '' },
                    event: 'revised',
                    note: `${reason}${notes.length ? `. ${notes.join('; ')}` : ''}`.slice(0, 380),
                    label: 'Requisition revised: the requester must confirm it again',
                };
            });
        }),
    ],

    // Draft orders of mine a confirmed requisition can be consolidated into.
    'POST /api/org/procurement/requisitions/targets': [
        orgRoute('org.procurement.requisitions.targets', 'PRC.po.manage', async (ctx) => {
            const doc = await loadReq(ctx, str(ctx.body.id));
            const rq = doc.data;
            if (str(rq.status) !== 'confirmed') throw new HttpError(409, 'Only a confirmed requisition can be turned into an order.');
            const scope = await deskScope(ctx);
            const keys = scopeKeysOf(objs(rq.lines));
            const all = await listDocs(ordersPath(ctx.orgId));
            const newest = new Map<string, number>();
            for (const p of all) newest.set(baseOf(p.id), Math.max(newest.get(baseOf(p.id)) ?? 0, verOf(p.id)));
            const items = all
                .filter((p) => editable(p.data) && ownerOf(p.data) === ctx.uid && verOf(p.id) === newest.get(baseOf(p.id)) && !str(p.data.amendOf) && covers(scope, objs(p.data.lines)) && matches(p.data, rq, keys))
                .map((p) => ({ id: p.id, number: str(p.data.number) || p.id, lines: objs(p.data.lines).length, total: Number(p.data.total) || 0, currency: str(p.data.currency), createdByName: str(p.data.createdByName), status: str(p.data.status) }));
            return { items };
        }),
    ],

    // ===== Orders =====

    'POST /api/org/procurement/orders/options': [
        orgRoute('org.procurement.orders.options', null, async (ctx) => {
            requireProcurement(ctx);
            const s = await orderSettings(ctx.orgId);
            const fin = await getDoc(financePath(ctx.orgId));
            return {
                currency: str(ctx.org.data.currencyCode),
                autoSend: s.autoSend,
                emailReady: can(ctx, 'PRC.setup.manage') || can(ctx, 'PRC.po.manage') ? await mailerReady() : false,
                payableGlCode: str(fin?.data.payableGlCode),
                can: { manage: can(ctx, 'PRC.po.manage'), approve: can(ctx, 'PRC.po.approve'), receive: can(ctx, 'PRC.po.receive'), settings: can(ctx, 'PRC.setup.manage'), reassign: can(ctx, 'PRC.po.reassign'), journals: can(ctx, 'PRC.journal.view') },
            };
        }),
    ],

    'POST /api/org/procurement/orders/settings': [
        orgRoute('org.procurement.orders.settings', 'PRC.setup.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            if (typeof ctx.body.autoSend !== 'boolean') throw new HttpError(400, 'Choose on or off.');
            const cur = await orderSettings(ctx.orgId);
            if (ctx.body.autoSend && !(await mailerReady())) throw new HttpError(409, 'Automatic email needs an email service. Ask the MEMS administrator to connect one first.');
            if (cur.autoSend === ctx.body.autoSend) throw new HttpError(400, 'Nothing has changed.');
            await writeDoc(settingsPath(ctx.orgId), { autoSend: ctx.body.autoSend, version: cur.version + 1, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.procurement.orders.settings', 'Purchase order settings', `Send approved orders automatically: ${ctx.body.autoSend ? 'on' : 'off'}. Reason: ${reason}`.slice(0, 400));
            return { ok: true };
        }),
    ],

    // Who may see the quotes behind an order and its prices (the cost center owner always sees everything).
    'POST /api/org/procurement/orders/visibility': [
        orgRoute('org.procurement.orders.visibility', null, async (ctx) => {
            requireProcurement(ctx);
            const vis = await visibilityOf(ctx.orgId);
            const canSet = can(ctx, 'PRC.setup.manage');
            if (ctx.body.set !== true) return { ...vis, roles: VIS_ROLES, canSet };
            if (!canSet) throw new HttpError(403, 'You cannot change who sees order details.');
            const reason = reasonOf(ctx.body);
            const pick = (v: unknown) => {
                if (!Array.isArray(v)) throw new HttpError(400, 'Choose who can see.');
                const out = Array.from(new Set((v as unknown[]).map(str)));
                if (out.some((x) => !VIS_ROLES.includes(x))) throw new HttpError(400, 'Unknown audience.');
                return out;
            };
            const next = { quotes: pick(ctx.body.quotes), prices: pick(ctx.body.prices) };
            if (!next.quotes.includes('owner') || !next.prices.includes('owner')) throw new HttpError(400, 'The person responsible for the order must always see its quotes and prices.');
            await writeDoc(visibilityPath(ctx.orgId), { ...next, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.procurement.orders.visibility', 'Order visibility', `Quotes: ${next.quotes.join(', ')}. Prices: ${next.prices.join(', ')}. Reason: ${reason}`.slice(0, 400));
            return { ok: true };
        }),
    ],

    'POST /api/org/procurement/orders/list': [
        orgRoute('org.procurement.orders.list', null, async (ctx) => {
            requireProcurement(ctx);
            const [scope, units, vis, all] = await Promise.all([poScope(ctx), unitsOf(ctx.orgId), visibilityOf(ctx.orgId), listDocs(ordersPath(ctx.orgId))]);
            const owned = ownedCostCenters(units, ctx.me);
            const newest = new Map<string, number>();
            for (const p of all) newest.set(baseOf(p.id), Math.max(newest.get(baseOf(p.id)) ?? 0, verOf(p.id)));
            const withAcc = all.map((p) => ({ p, acc: accessFlags(ctx, p.data, scope, owned) })).filter((x) => x.acc.any);
            const showAll = ctx.body.versions === true;
            const docs = withAcc.filter((x) => showAll || !['superseded', 'returned'].includes(str(x.p.data.status)) || verOf(x.p.id) === newest.get(baseOf(x.p.id)));
            const views: Record<string, typeof docs> = {
                approvals: docs.filter((x) => approverCheck(ctx, x.p.data).ok),
                mine: docs.filter((x) => x.acc.owner),
                draft: docs.filter((x) => ['draft', 'validated'].includes(str(x.p.data.status))),
                inapproval: docs.filter((x) => str(x.p.data.status) === 'pending_approval'),
                open: docs.filter((x) => DELIVERING.includes(str(x.p.data.status))),
                acknowledged: docs.filter((x) => !!str(o(x.p.data.ack).at)),
                unacknowledged: docs.filter((x) => ['sent', 'partial'].includes(str(x.p.data.status)) && !str(o(x.p.data.ack).at)),
                expired: docs.filter((x) => isExpired(x.p.data)),
                all: docs,
            };
            const view = str(ctx.body.view) || 'all';
            if (!(view in views)) throw new HttpError(400, 'Choose a view.');
            return {
                rows: views[view].sort((a, b) => b.p.id.localeCompare(a.p.id)).slice(0, 2000).map((x) => poRow(x.p.data, x.p.id, ctx, x.acc, sees(ctx, x.acc, vis, 'prices'))),
                counts: Object.fromEntries(Object.entries(views).map(([k, x]) => [k, x.length])),
            };
        }),
    ],

    'POST /api/org/procurement/orders/get': [
        orgRoute('org.procurement.orders.get', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const d = doc.data;
            const acc = doc.acc;
            const mine = acc.owner;
            const status = str(d.status);
            const ap = approverCheck(ctx, d);
            const val = o(d.validation);
            const valid = status === 'validated' && Number(val.rev) === (Number(d.rev) || 0) && Number(val.fails) === 0;
            const deliveries = objs(d.deliveries);
            const [s, vis, versions, fin] = await Promise.all([orderSettings(ctx.orgId), visibilityOf(ctx.orgId), versionsOf(ctx.orgId, baseOf(doc.id)), getDoc(financePath(ctx.orgId))]);
            const orgCurrency = str(ctx.org.data.currencyCode);
            const rates = await ratesOf(orgCurrency);
            const latest = rates.rate(str(d.currency));
            const priceOk = sees(ctx, acc, vis, 'prices');
            const quotesOk = sees(ctx, acc, vis, 'quotes');
            const lines = objs(d.lines).map((l) => {
                const x: Obj = { ...l, outstanding: outstanding(l) };
                if (!priceOk) for (const k of ['unitPrice', 'discountPct', 'netUnitPrice', 'total', 'quotePrice', 'budget']) delete x[k];
                return x;
            });
            const poType = str(d.poType) || poTypeOf(objs(d.lines));
            const newerInForce = versions.some((p) => verOf(p.id) > verOf(doc.id) && inForce(str(p.data.status)));
            const locked = versions.some((p) => p.id !== doc.id && str(p.data.status) === 'pending_approval');
            const mgr = can(ctx, 'PRC.po.manage') && acc.owner;
            const ack = o(d.ack);
            const myOwn = ownedCostCenters(await unitsOf(ctx.orgId), ctx.me);
            return {
                ...poRow(d, doc.id, ctx, acc, priceOk),
                vendorId: str(d.vendorId),
                vendorEmail: str(d.vendorEmail),
                paymentTermsLabel: str(d.paymentTermsLabel),
                contractRef: str(d.contractRef),
                notes: str(d.notes),
                fxRate: priceOk ? Number(d.fxRate) || null : null,
                fxAsOf: str(d.fxAsOf),
                latestRate: priceOk ? latest : null,
                latestBase: priceOk && latest ? round((Number(d.total) || 0) * latest) : null,
                ratesAsOf: rates.asOf,
                orgCurrency,
                rev: Number(d.rev) || 0,
                ownerUid: ownerOf(d),
                amendOf: str(d.amendOf),
                amendReason: str(d.amendReason),
                prevId: str(d.prevId),
                payableReady: !!str(fin?.data.payableGlCode),
                lines,
                requisitions: Array.from(new Set(objs(d.lines).map((l) => str(l.requisitionId)))).filter(Boolean),
                versions: versions.map((p) => ({ id: p.id, ver: verOf(p.id), status: str(p.data.status), statusLabel: PO_STATUS[str(p.data.status)] ?? str(p.data.status), createdAt: str(p.data.createdAt), approvedAt: str(p.data.approvedAt), reason: str(p.data.amendReason) || str(p.data.returnReason), current: p.id === doc.id })),
                validation: { at: str(val.at), byName: str(val.byName), rev: Number(val.rev) || 0, current: Number(val.rev) === (Number(d.rev) || 0), fails: Number(val.fails) || 0, warns: Number(val.warns) || 0, checks: objs(val.checks), ackReason: str(val.ackReason) },
                approval: { amount: priceOk ? Number(o(d.approval).amount) || 0 : 0, steps: steps(d), authorityVersion: Number(o(d.approval).authorityVersion) || 0 },
                approveWhy: ap.why,
                deliveries: deliveries.map((x) => ({ id: str(x.id), at: str(x.at), date: str(x.date), ref: str(x.ref), byName: str(x.byName), note: str(x.note), lines: objs(x.lines) })),
                receipts: objs(d.receipts).map((r) => ({ id: str(r.id), status: str(r.status), periodFrom: str(r.periodFrom), periodTo: str(r.periodTo), renderedByName: str(r.renderedByName), renderedAt: str(r.renderedAt), invoiceNo: str(r.invoiceNo), invoiceAmount: Number(r.invoiceAmount) || 0, amount: Number(r.amount) || 0, journalId: str(r.journalId), lines: objs(r.lines), files: objs(r.files).map((f) => ({ id: str(f.id), kind: str(f.kind), name: str(f.name) })), decidedByName: str(r.decidedByName), decidedAt: str(r.decidedAt), decisionNote: str(r.decisionNote), mine: str(r.renderedBy) === ctx.uid })),
                ack: { at: str(ack.at), byName: str(ack.byName), ref: str(ack.ref), date: str(ack.date), note: str(ack.note), fileName: str(ack.fileName), fileId: str(ack.fileId) },
                history: objs(d.history).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note), from: str(h.from), to: str(h.to) })),
                returnReason: str(d.returnReason),
                rejectReason: str(d.rejectReason),
                sendError: str(d.sendError),
                sentMethod: str(d.sentMethod),
                sentByName: str(d.sentByName),
                autoSend: s.autoSend,
                emailReady: can(ctx, 'PRC.po.manage') ? await mailerReady() : false,
                seesQuotes: quotesOk,
                seesPrices: priceOk,
                ownsCostCenter: acc.ccOwner,
                myCostCenters: Array.from(myOwn),
                can: {
                    edit: mgr && editable(d),
                    validate: mgr && editable(d) && objs(d.lines).length > 0,
                    confirm: mgr && valid && !isExpired(d),
                    reopen: mgr && status === 'validated',
                    approve: ap.ok,
                    send: mgr && (status === 'open' || (status === 'partial' && !!str(d.amendOf) && !str(d.sentAt))),
                    receive: can(ctx, 'PRC.po.receive') && DELIVERING.includes(status) && poType !== 'service' && !locked,
                    cancel: (mgr && ['draft', 'validated', 'rejected'].includes(status)) || (can(ctx, 'PRC.po.approve') && ['open', 'sent'].includes(status) && !deliveries.length && !acc.owner && !newerInForce),
                    amend: mgr && ['open', 'sent', 'partial'].includes(status) && !newerInForce && !objs(d.receipts).some((r) => str(r.status) === 'submitted'),
                    reassign: (acc.owner || can(ctx, 'PRC.po.reassign')) && inForce(status) && !newerInForce,
                    acknowledge: acc.owner && can(ctx, 'PRC.po.manage') && ['sent', 'partial'].includes(status) && !str(ack.at),
                    renderService: poType === 'service' && DELIVERING.includes(status) && acc.requester && !locked,
                    acceptService: poType === 'service' && DELIVERING.includes(status) && acc.ccOwner && can(ctx, 'PRC.service.accept') && !locked,
                },
                mine: acc.owner,
            };
        }),
    ],

    // A confirmed requisition becomes a new order (PO + 8 digits, version V1), or is consolidated into a matching draft order of mine.
    'POST /api/org/procurement/orders/create': [
        orgRoute('org.procurement.orders.create', 'PRC.po.manage', async (ctx) => {
            requireProcurement(ctx);
            const rqId = str(ctx.body.requisitionId);
            const rqDoc = await loadReq(ctx, rqId);
            const mode = str(ctx.body.mode);
            if (!['new', 'consolidate'].includes(mode)) throw new HttpError(400, 'Choose a new order or an existing order.');
            if (str(rqDoc.data.status) !== 'confirmed') throw new HttpError(409, 'Only a requisition confirmed by its requester can be turned into an order.');
            if (str(rqDoc.data.validUntil) && str(rqDoc.data.validUntil) < today()) throw new HttpError(409, `The quote expired on ${str(rqDoc.data.validUntil)}. Suspend the requisition and revise it with a current price first.`);
            const vendor = await getDoc(`${vendorsPath(ctx.orgId)}/${str(rqDoc.data.vendorId)}`);
            if (!vendor || str(vendor.data.status) !== 'approved') throw new HttpError(409, 'The vendor is not an approved vendor.');

            const attach = async (poId: string, build: (rq: Obj) => Obj) =>
                lock(ctx, rqId, async () => {
                    const fresh = await getDoc(`${reqsPath(ctx.orgId)}/${rqId}`);
                    if (!fresh || str(fresh.data.status) !== 'confirmed') throw new HttpError(409, 'This requisition has already been turned into an order.');
                    const out = build(fresh.data);
                    const at = nowIso();
                    await writeDoc(`${reqsPath(ctx.orgId)}/${rqId}`, {
                        ...fresh.data,
                        status: 'converted',
                        orderId: baseOf(poId),
                        orderNumber: baseOf(poId),
                        updatedAt: at,
                        version: (Number(fresh.data.version) || 1) + 1,
                        history: [...objs(fresh.data.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: mode === 'new' ? 'turned into a new order' : 'consolidated into an existing order', note: poId, from: 'confirmed', to: 'converted' }],
                    });
                    return out;
                });

            if (mode === 'new') {
                const n = await nextOrgCounter(ctx.orgId, 'orderSeq');
                if (n > 99_999_999) throw new HttpError(500, 'The order number range is exhausted.');
                const base = `PO${String(n).padStart(8, '0')}`;
                const id = `${base}-V1`;
                const at = nowIso();
                const data = await attach(id, (rq) => {
                    const lines = poLinesFrom(rq, rqId, 10);
                    return {
                        number: id,
                        baseNumber: base,
                        ver: 1,
                        poType: str(rq.poType) || poTypeOf(lines),
                        status: 'draft',
                        vendorId: str(rq.vendorId),
                        vendorName: str(rq.vendorName),
                        vendorEmail: str(o(vendor.data.contact).email),
                        currency: str(rq.currency),
                        paymentTermsCode: str(rq.paymentTermsCode),
                        paymentTermsLabel: str(rq.paymentTermsLabel),
                        groupKey: str(rq.groupKey),
                        groupLabel: str(rq.groupLabel),
                        contractRef: '',
                        notes: '',
                        lines,
                        total: sumTotal(lines),
                        baseTotal: 0,
                        rev: 1,
                        deliveries: [],
                        deliverySeq: 0,
                        requesterUids: [str(rq.requesterUid)],
                        ownerUid: ctx.uid,
                        ownerName: nameOfUser(ctx.me),
                        createdBy: ctx.uid,
                        createdByName: nameOfUser(ctx.me),
                        createdAt: at,
                        originAt: at,
                        updatedAt: at,
                        version: 1,
                        history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'created', note: `${id} from ${rqId}, ${lines.length} line(s)`, from: '', to: 'draft' }],
                    };
                });
                if (!(await writeDoc(`${ordersPath(ctx.orgId)}/${id}`, data, { exists: false }))) throw new HttpError(409, 'That order number is already in use. Please try again.');
                await record(ctx, 'org.procurement.order.create', id, `From ${rqId}`);
                return { ok: true, id };
            }

            const targetId = str(ctx.body.orderId);
            if (!PO_ID.test(targetId)) throw new HttpError(404, 'Purchase order not found.');
            await lock(ctx, targetId, async () => {
                const target = await getDoc(`${ordersPath(ctx.orgId)}/${targetId}`);
                const scope = await deskScope(ctx);
                if (!target || !covers(scope, objs(target.data.lines))) throw new HttpError(404, 'Purchase order not found.');
                needOwner(ctx, target.data);
                if (str(target.data.amendOf)) throw new HttpError(409, 'An amendment cannot take lines from other requisitions.');
                if (!editable(target.data)) throw new HttpError(409, 'Only a draft or validated order can take more lines.');
                if (!matches(target.data, rqDoc.data, scopeKeysOf(objs(rqDoc.data.lines)))) throw new HttpError(409, 'This requisition does not match that order: it needs the same kind of purchase, vendor, currency, payment terms, buyer group and categories.');
                const cur = objs(target.data.lines);
                if (cur.length + objs(rqDoc.data.lines).length > MAX_LINES) throw new HttpError(400, `An order can have up to ${MAX_LINES} lines.`);
                const next = await attach(targetId, (rq) => {
                    const lastNo = cur.reduce((m, l) => Math.max(m, Number(l.no) || 0), 0);
                    const added = poLinesFrom(rq, rqId, lastNo + 10);
                    const lines = [...cur, ...added];
                    const at = nowIso();
                    const uids = Array.from(new Set([...requesterIds(target.data), str(rq.requesterUid)]));
                    return {
                        ...target.data,
                        lines,
                        total: sumTotal(lines),
                        baseTotal: 0,
                        status: 'draft',
                        validation: null,
                        rev: (Number(target.data.rev) || 1) + 1,
                        requesterUids: uids,
                        updatedAt: at,
                        version: (Number(target.data.version) || 1) + 1,
                        history: [...objs(target.data.history), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'requisition consolidated', note: `${rqId}: ${added.length} line(s) added`, from: str(target.data.status), to: 'draft' }],
                    };
                });
                await writeDoc(`${ordersPath(ctx.orgId)}/${targetId}`, next);
            });
            await record(ctx, 'org.procurement.order.consolidate', targetId, `Added ${rqId}`);
            return { ok: true, id: targetId };
        }),
    ],

    'POST /api/org/procurement/orders/update': [
        orgRoute('org.procurement.orders.update', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const contractRef = oneLine(ctx.body.contractRef, 60);
            const notes = cleanText(ctx.body.notes).slice(0, 600);
            return mutate(ctx, 'po', doc.id, 'update', async (d) => {
                needOwner(ctx, d);
                if (!editable(d)) throw new HttpError(409, 'A submitted order cannot be changed. Ask an approver to return it, or wait for the decision.');
                return { patch: { contractRef, notes, status: 'draft', validation: null, rev: (Number(d.rev) || 1) + 1 }, event: 'edited', note: contractRef ? `Contract ${contractRef}` : '', label: 'Order details changed. Validate it again' };
            });
        }),
    ],

    // Quantity, date required and (with a reason) price of lines of a draft order. Every change is logged and the validation lapses.
    'POST /api/org/procurement/orders/lines/edit': [
        orgRoute('org.procurement.orders.lines.edit', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const given = objs(ctx.body.lines);
            if (!given.length) throw new HttpError(400, 'Nothing to change.');
            const reason = reasonOf(ctx.body);
            return mutate(ctx, 'po', doc.id, 'lines.edit', async (d) => {
                needOwner(ctx, d);
                if (!editable(d)) throw new HttpError(409, 'A submitted order cannot be changed.');
                const notes: string[] = [];
                const lines = objs(d.lines).map((l) => {
                    const g = given.find((x) => Number(x.no) === Number(l.no));
                    if (!g) return l;
                    const x: Obj = { ...l };
                    if (g.quantity !== undefined) {
                        const q = Number(g.quantity);
                        if (!(q > 0) || q > (Number(l.reqQuantity) || Number(l.quantity)) + 1e-9) throw new HttpError(400, `Line ${Number(l.no)}: the quantity must be above zero and not more than the requisition (${Number(l.reqQuantity) || Number(l.quantity)}).`);
                        if (q < (Number(l.receivedQty) || 0)) throw new HttpError(400, `Line ${Number(l.no)}: ${Number(l.receivedQty)} has already been received.`);
                        if (q !== Number(l.quantity)) notes.push(`line ${Number(l.no)} qty ${Number(l.quantity)}→${q}`);
                        x.quantity = q;
                    }
                    if (g.dateRequired !== undefined) {
                        const dt = str(g.dateRequired);
                        if (dt && !/^\d{4}-\d{2}-\d{2}$/.test(dt)) throw new HttpError(400, `Line ${Number(l.no)}: enter a valid date.`);
                        if (dt !== str(l.dateRequired)) notes.push(`line ${Number(l.no)} date ${str(l.dateRequired) || '-'}→${dt || '-'}`);
                        x.dateRequired = dt;
                    }
                    if (g.netUnitPrice !== undefined) {
                        const p = Number(g.netUnitPrice);
                        if (!(p > 0) || p > 1e12) throw new HttpError(400, `Line ${Number(l.no)}: enter a price above zero.`);
                        if (Math.abs(p - (Number(l.netUnitPrice) || 0)) > 1e-9) {
                            notes.push(`line ${Number(l.no)} price ${fmt(Number(l.netUnitPrice) || 0)}→${fmt(p)}`);
                            x.netUnitPrice = round(p, 4);
                            x.unitPrice = round(p, 4);
                            x.discountPct = 0;
                            x.priceRevised = true;
                            x.priceNote = reason.slice(0, 200);
                        }
                    }
                    x.total = round((Number(x.quantity) || 0) * (Number(x.netUnitPrice) || 0));
                    return x;
                });
                if (!notes.length) throw new HttpError(400, 'Nothing has changed.');
                return { patch: { lines, total: sumTotal(lines), baseTotal: 0, status: 'draft', validation: null, rev: (Number(d.rev) || 1) + 1 }, event: 'lines edited', note: `${reason}. ${notes.join('; ')}`.slice(0, 380), label: 'Lines changed. Validate the order again' };
            });
        }),
    ],

    // Take all lines of one requisition out of a draft order; the requisition goes back to Confirmed.
    'POST /api/org/procurement/orders/lines/drop': [
        orgRoute('org.procurement.orders.lines.drop', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const rqId = str(ctx.body.requisitionId);
            const reason = reasonOf(ctx.body);
            let emptied = false;
            const out = await mutate(ctx, 'po', doc.id, 'lines.drop', async (d) => {
                needOwner(ctx, d);
                if (!editable(d)) throw new HttpError(409, 'A submitted order cannot be changed.');
                const gone = objs(d.lines).filter((l) => str(l.requisitionId) === rqId);
                if (!gone.length) throw new HttpError(404, 'That requisition is not in this order.');
                if (gone.some((l) => (Number(l.receivedQty) || 0) > 0)) throw new HttpError(409, 'Something on these lines has already been received.');
                const lines = objs(d.lines).filter((l) => str(l.requisitionId) !== rqId);
                emptied = !lines.length;
                if (emptied) return { patch: { lines: [], total: 0, baseTotal: 0, status: 'cancelled', cancelReason: `All lines removed: ${reason}` }, event: 'cancelled', note: `Last requisition ${rqId} removed: ${reason}`, label: 'Cancelled: no lines left' };
                return { patch: { lines, total: sumTotal(lines), baseTotal: 0, status: 'draft', validation: null, rev: (Number(d.rev) || 1) + 1 }, event: 'requisition removed', note: `${rqId}: ${reason}`, label: `Requisition ${rqId} left the order` };
            });
            if (!str(doc.data.amendOf)) {
                await mutate(ctx, 'req', rqId, 'release', async (r) => {
                    if (str(r.status) !== 'converted' || baseOf(str(r.orderId)) !== baseOf(doc.id)) throw new HttpError(409, 'skip');
                    return { patch: { status: 'confirmed', orderId: '', orderNumber: '' }, event: 'released', note: `${doc.id}: ${reason}`, label: `Released from ${doc.id}` };
                }).catch(() => undefined);
            }
            return out;
        }),
    ],

    // Opens a validated order that has not been submitted, so it can be edited again.
    'POST /api/org/procurement/orders/reopen': [
        orgRoute('org.procurement.orders.reopen', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            return mutate(ctx, 'po', doc.id, 'reopen', async (d) => {
                needOwner(ctx, d);
                if (str(d.status) !== 'validated') throw new HttpError(409, 'Only a validated order that has not been submitted can be reopened.');
                return { patch: { status: 'draft', validation: null, rev: (Number(d.rev) || 1) + 1 }, event: 'reopened before submission', note: reason, label: 'Reopened for editing' };
            });
        }),
    ],

    // An approved order is changed by a new version (V2, V3...) that goes through validation and approval again.
    'POST /api/org/procurement/orders/amend': [
        orgRoute('org.procurement.orders.amend', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body, 15);
            let newId = '';
            const out = await mutate(ctx, 'po', doc.id, 'amend', async (d) => {
                needOwner(ctx, d);
                if (!['open', 'sent', 'partial'].includes(str(d.status))) throw new HttpError(409, 'Only an approved order can be amended. A draft is edited directly; a submitted order waits for its decision.');
                if ((await versionsOf(ctx.orgId, baseOf(doc.id))).some((p) => verOf(p.id) > verOf(doc.id) && inForce(str(p.data.status)))) throw new HttpError(409, 'A newer version of this order is already open.');
                if (objs(d.receipts).some((r) => str(r.status) === 'submitted')) throw new HttpError(409, 'A service receipt is waiting for acceptance. Decide it first.');
                newId = await forkVersion(ctx, d, doc.id, 'amend', reason);
                return { patch: { nextVersion: newId }, event: 'amendment started', note: `${newId}: ${reason}`, label: `Amendment ${newId} started` };
            });
            return { ...out, id: newId };
        }),
    ],

    // Hands an order over to someone else: the owner, or a person holding the reassign right when the owner is away.
    'POST /api/org/procurement/orders/owners': [
        orgRoute('org.procurement.orders.owners', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            if (!isOwner(ctx, doc.data) && !can(ctx, 'PRC.po.reassign')) throw new HttpError(403, 'You cannot reassign this order.');
            const users = await orgUsers(ctx.orgId);
            const out: Obj[] = [];
            for (const u of users) {
                if (str(u.data.status) === 'disabled' || u.id === ownerOf(doc.data)) continue;
                if (await userHolds(ctx.orgId, u, 'PRC.po.manage')) out.push({ uid: u.id, name: nameOfUser(u) });
            }
            return { items: out };
        }),
    ],

    'POST /api/org/procurement/orders/reassign': [
        orgRoute('org.procurement.orders.reassign', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            const toUid = str(ctx.body.toUid);
            const users = await orgUsers(ctx.orgId);
            const target = users.find((u) => u.id === toUid && str(u.data.status) !== 'disabled');
            if (!target) throw new HttpError(400, 'Choose an active colleague.');
            if (!(await userHolds(ctx.orgId, target, 'PRC.po.manage'))) throw new HttpError(400, 'That person cannot manage purchase orders.');
            const family = (await versionsOf(ctx.orgId, baseOf(doc.id))).filter((p) => inForce(str(p.data.status)));
            if (!family.length) throw new HttpError(409, 'This order is closed and cannot be reassigned.');
            let result: Obj = {};
            for (const p of family) {
                result = await mutate(ctx, 'po', p.id, 'reassign', async (d) => {
                    if (!isOwner(ctx, d) && !can(ctx, 'PRC.po.reassign')) throw new HttpError(403, 'You cannot reassign this order.');
                    if (ownerOf(d) === toUid) throw new HttpError(409, 'That person is already responsible for this order.');
                    if (steps(d).some((s) => s.status === 'approved' && s.by === toUid)) throw new HttpError(409, 'That person has approved this order, so cannot also be responsible for it.');
                    return { patch: { ownerUid: toUid, ownerName: nameOfUser(target) }, event: 'reassigned', note: `${str(d.ownerName) || str(d.createdByName)} to ${nameOfUser(target)}: ${reason}`.slice(0, 380), label: `Reassigned to ${nameOfUser(target)}` };
                });
            }
            return result;
        }),
    ],

    // Runs every check and keeps the result. The order is Validated only when nothing fails.
    'POST /api/org/procurement/orders/validate': [
        orgRoute('org.procurement.orders.validate', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            return mutate(ctx, 'po', doc.id, 'validate', async (d) => {
                needOwner(ctx, d);
                if (!editable(d)) throw new HttpError(409, 'Only a draft order can be validated.');
                if (!objs(d.lines).length) throw new HttpError(400, 'Add at least one line first.');
                const r = await runChecks(ctx, d, doc.id);
                const fails = r.checks.filter((c) => c.result === 'fail').length;
                const warns = r.checks.filter((c) => c.result === 'warn').length;
                const at = nowIso();
                const validation = { at, by: ctx.uid, byName: nameOfUser(ctx.me), rev: Number(d.rev) || 1, fails, warns, checks: r.checks, ackReason: '' };
                return {
                    patch: { status: fails ? 'draft' : 'validated', validation, total: r.total, baseTotal: r.baseTotal, fxRate: r.fxRate, fxAsOf: r.fxAsOf, poType: poTypeOf(objs(d.lines)) },
                    event: fails ? 'validation failed' : 'validated',
                    note: `${fails} failure(s), ${warns} warning(s)`,
                    label: fails ? `Validation found ${fails} failure(s)` : `Validated with ${warns} warning(s)`,
                    result: { fails, warns },
                };
            });
        }),
    ],

    // Confirming sends a validated order into approval. Warnings need a written reason.
    'POST /api/org/procurement/orders/confirm': [
        orgRoute('org.procurement.orders.confirm', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = cleanText(ctx.body.reason).slice(0, 600);
            return mutate(ctx, 'po', doc.id, 'confirm', async (d) => {
                needOwner(ctx, d);
                const val = o(d.validation);
                if (str(d.status) !== 'validated' || Number(val.rev) !== (Number(d.rev) || 0)) throw new HttpError(409, 'Validate the order again first. It has changed since it was validated.');
                if (Number(val.fails) > 0) throw new HttpError(409, 'The order has failed checks.');
                if (isExpired(d)) throw new HttpError(409, 'A quote behind this order has expired. It cannot be submitted.');
                // Checked again now: a supplier suspended, a document expired or a quote withdrawn since validation blocks it.
                const recheck = (await runChecks(ctx, d, doc.id)).checks.filter((c) => c.result === 'fail');
                if (recheck.length) throw new HttpError(409, `Something changed since validation: ${recheck.map((c) => c.label).join(', ')}. Validate the order again.`);
                const warns = Number(val.warns) || 0;
                if (warns > 0 && (ctx.body.acknowledge !== true || reason.length < 20)) throw new HttpError(400, `${warns} warning(s) need your written reason (at least 20 characters) before you confirm.`);
                // The approval route is worked out again now, on the value and the people of today.
                const authority = await getAuthority(ctx.orgId);
                const users = await orgUsers(ctx.orgId);
                const creator = users.find((u) => u.id === ownerOf(d)) ?? null;
                const base = Number(d.baseTotal) || 0;
                const route = await approvalRoute(ctx.orgId, creator, base, authority);
                if (route.problems.length) throw new HttpError(409, route.problems.join(' '));
                const at = nowIso();
                return {
                    patch: {
                        status: 'pending_approval',
                        confirmedAt: at,
                        confirmedBy: ctx.uid,
                        confirmedByName: nameOfUser(ctx.me),
                        validation: { ...val, ackReason: reason },
                        approval: { amount: base, steps: route.steps, authorityVersion: route.authorityVersion, startedAt: at },
                    },
                    event: 'submitted for approval',
                    note: `${route.steps.map((s) => `${s.level} ${s.positionTitle}`).join(' then ')} to approve ${str(ctx.org.data.currencyCode)} ${fmt(base)}${reason ? `. ${reason}` : ''}`.slice(0, 380),
                    label: 'Submitted for approval',
                };
            });
        }),
    ],

    'POST /api/org/procurement/orders/approve': [
        orgRoute('org.procurement.orders.approve', 'PRC.po.approve', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            if (ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have reviewed the order, its validation results and the amount.');
            const note = oneLine(ctx.body.note, 300);
            let prevId = '';
            const result = await mutate(ctx, 'po', doc.id, 'approve', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot approve this order now.');
                const cur = currentStep(d)!;
                const at = nowIso();
                const list = steps(d).map((s) => (s.level === cur.level ? { ...s, status: 'approved' as const, by: ctx.uid, byName: nameOfUser(ctx.me), at, note } : s));
                const done = list.every((s) => s.status === 'approved');
                const patch: Obj = { approval: { ...o(d.approval), steps: list } };
                if (done) {
                    patch.status = 'open';
                    patch.approvedAt = at;
                    if (str(d.amendOf)) {
                        // The amendment takes over from the version it replaces, including what has been received and accepted.
                        const prev = await getDoc(`${ordersPath(ctx.orgId)}/${str(d.amendOf)}`);
                        if (prev) {
                            prevId = prev.id;
                            const lines = objs(d.lines).map((l) => {
                                const pl = objs(prev.data.lines).find((x) => Number(x.no) === Number(l.no));
                                const got = Number(pl?.receivedQty) || 0;
                                if (Number(l.quantity) < got) throw new HttpError(409, `Line ${Number(l.no)} is for less than the ${got} already received.`);
                                return { ...l, receivedQty: got };
                            });
                            const full = lines.every((l) => outstanding(l) <= 0);
                            const any = objs(prev.data.deliveries).length > 0 || objs(prev.data.receipts).some((r) => str(r.status) === 'accepted');
                            Object.assign(patch, { lines, deliveries: objs(prev.data.deliveries), deliverySeq: Number(prev.data.deliverySeq) || 0, receipts: objs(prev.data.receipts), receiptSeq: Number(prev.data.receiptSeq) || 0, firstDeliveryAt: str(prev.data.firstDeliveryAt), status: any ? (full ? 'full' : 'partial') : 'open', ...(full && any ? { deliveredAt: at } : {}) });
                        }
                    }
                }
                return { patch, event: `approved ${cur.level} (${cur.positionTitle})`, note, label: done ? 'Fully approved' : `Approved level ${cur.level}`, result: { done } };
            });
            if (result.done === true) {
                if (prevId) {
                    await mutate(ctx, 'po', prevId, 'supersede', async () => ({ patch: { status: 'superseded', supersededBy: doc.id }, event: 'superseded', note: `Replaced by ${doc.id}`, label: `Superseded by ${doc.id}` })).catch(() => undefined);
                }
                const s = await orderSettings(ctx.orgId);
                if (s.autoSend && str(result.status) === 'open') {
                    try {
                        await sendOrder(ctx, doc.id, 'email', true);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : 'The email could not be sent.';
                        await mutate(ctx, 'po', doc.id, 'send.failed', async () => ({ patch: { sendError: msg }, event: 'automatic email failed', note: msg.slice(0, 200), label: 'Automatic email failed' })).catch(() => undefined);
                    }
                }
            }
            return result;
        }),
    ],

    // An approver sends the order back with a reason: this version is closed and a new draft version is made for the owner to correct.
    'POST /api/org/procurement/orders/return': [
        orgRoute('org.procurement.orders.return', 'PRC.po.approve', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            let newId = '';
            const out = await mutate(ctx, 'po', doc.id, 'return', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot return this order now.');
                newId = await forkVersion(ctx, d, doc.id, 'return', reason);
                return { patch: { status: 'returned', returnReason: reason, returnedBy: ctx.uid, returnedByName: nameOfUser(ctx.me), nextVersion: newId }, event: 'returned for correction', note: `${reason} (new version ${newId})`, label: 'Returned to the owner' };
            });
            return { ...out, id: newId };
        }),
    ],

    'POST /api/org/procurement/orders/reject': [
        orgRoute('org.procurement.orders.reject', 'PRC.po.approve', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            const out = await mutate(ctx, 'po', doc.id, 'reject', async (d) => {
                const chk = approverCheck(ctx, d);
                if (!chk.ok) throw new HttpError(403, chk.why || 'You cannot reject this order now.');
                return { patch: { status: 'rejected', rejectReason: reason, rejectedBy: ctx.uid, rejectedByName: nameOfUser(ctx.me) }, event: 'rejected', note: reason, label: 'Rejected' };
            });
            await releaseRequisitions(ctx, doc.data, doc.id, 'order rejected');
            return out;
        }),
    ],

    'POST /api/org/procurement/orders/cancel': [
        orgRoute('org.procurement.orders.cancel', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const reason = reasonOf(ctx.body);
            const out = await mutate(ctx, 'po', doc.id, 'cancel', async (d) => {
                const status = str(d.status);
                const owner = isOwner(ctx, d);
                const early = can(ctx, 'PRC.po.manage') && owner && ['draft', 'validated', 'rejected'].includes(status);
                const late = can(ctx, 'PRC.po.approve') && ['open', 'sent'].includes(status) && !objs(d.deliveries).length && !owner;
                if (!early && !late) throw new HttpError(403, 'You cannot cancel this order now.');
                if (late && (await versionsOf(ctx.orgId, baseOf(doc.id))).some((p) => verOf(p.id) > verOf(doc.id) && inForce(str(p.data.status)))) throw new HttpError(409, 'A newer version is open. Cancel that first.');
                return { patch: { status: 'cancelled', cancelReason: reason }, event: 'cancelled', note: reason, label: 'Cancelled' };
            });
            await releaseRequisitions(ctx, doc.data, doc.id, 'order cancelled');
            return out;
        }),
    ],

    'POST /api/org/procurement/orders/send': [
        orgRoute('org.procurement.orders.send', 'PRC.po.manage', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            needOwner(ctx, doc.data);
            const method = str(ctx.body.method);
            if (!['email', 'print'].includes(method)) throw new HttpError(400, 'Choose email or print.');
            if (method === 'print' && ctx.body.acknowledge !== true) throw new HttpError(400, 'Confirm that you have printed the order and sent it to the supplier.');
            return sendOrder(ctx, doc.id, method as 'email' | 'print', false);
        }),
    ],

    // A delivery of materials or assets against an order. Services are received by the requester and accepted by the cost center owner instead.
    // What receiving each line will do: into which warehouse material it lands, and whether finance posts it.
    'POST /api/org/procurement/orders/receive/prepare': [
        orgRoute('org.procurement.orders.receive.prepare', 'PRC.po.receive', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            return { lines: await receiptPlan(ctx.orgId, doc.data) };
        }),
    ],
    'POST /api/org/procurement/orders/receive': [
        orgRoute('org.procurement.orders.receive', 'PRC.po.receive', async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            if ((str(doc.data.poType) || poTypeOf(objs(doc.data.lines))) === 'service') throw new HttpError(409, 'Services are received by the requester and accepted by the cost center owner, not as a delivery.');
            if ((await versionsOf(ctx.orgId, baseOf(doc.id))).some((p) => p.id !== doc.id && str(p.data.status) === 'pending_approval')) throw new HttpError(409, 'An amendment of this order is in approval. Deliveries wait for its decision.');
            const ref = oneLine(ctx.body.ref, 40);
            if (ref.length < 2) throw new HttpError(400, 'Enter the delivery note number.');
            const date = str(ctx.body.date);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) throw new HttpError(400, 'Enter the delivery date. It cannot be in the future.');
            const given = objs(ctx.body.lines).map((l) => ({ no: Number(l.no), qty: Number(l.qty), materialId: str(l.materialId).slice(0, 120) })).filter((l) => l.qty > 0);
            if (!given.length) throw new HttpError(400, 'Enter the quantity received for at least one line.');
            return mutate(ctx, 'po', doc.id, 'receive', async (d) => {
                if (!DELIVERING.includes(str(d.status))) throw new HttpError(409, 'Deliveries can only be recorded on an approved order.');
                if (date < str(d.approvedAt).slice(0, 10)) throw new HttpError(400, 'The delivery cannot be before the order was approved.');
                if (objs(d.deliveries).length >= MAX_DELIVERIES) throw new HttpError(400, `An order can have up to ${MAX_DELIVERIES} deliveries.`);
                const lines = objs(d.lines).map((l) => {
                    const g = given.find((x) => x.no === Number(l.no));
                    if (!g) return l;
                    if (g.qty > outstanding(l) + 1e-9) throw new HttpError(400, `Line ${Number(l.no)}: only ${outstanding(l)} ${str(l.unit)} is still to be delivered.`);
                    return { ...l, receivedQty: round((Number(l.receivedQty) || 0) + g.qty, 4) };
                });
                if (given.some((g) => !lines.some((l) => Number(l.no) === g.no))) throw new HttpError(400, 'A line does not exist on this order.');
                const full = lines.every((l) => outstanding(l) <= 0);
                const seq = (Number(d.deliverySeq) || 0) + 1;
                const at = nowIso();
                // Stock and the ledger move with the delivery, or the delivery is refused: Dr inventory, the line account or asset clearing, Cr GR/IR.
                const posted = await receiveGoods(ctx, { po: d, poId: doc.id, deliveryId: `${doc.id}_D${seq}`, date, ref, lines: given });
                const entry = { id: `${doc.id}_D${seq}`, at, date, ref, by: ctx.uid, byName: nameOfUser(ctx.me), note: cleanText(ctx.body.note).slice(0, 300), lines: given, journals: posted.journals, financeNote: posted.note };
                return {
                    patch: { lines, deliveries: [...objs(d.deliveries), entry], deliverySeq: seq, status: full ? 'full' : 'partial', ...(full ? { deliveredAt: at } : {}), ...(!str(d.firstDeliveryAt) ? { firstDeliveryAt: at } : {}) },
                    event: full ? 'delivered in full' : 'delivered partially',
                    note: `Delivery note ${ref}, ${given.length} line(s)${posted.journals.length ? `; journal ${posted.journals.join(', ')}` : ''}${posted.note ? `; ${posted.note}` : ''}`.slice(0, 380),
                    label: full ? 'Delivered in full' : 'Delivery recorded: delivered partially',
                    result: { journals: posted.journals, financeNote: posted.note },
                };
            });
        }),
    ],

    // The quotes and quotation analysis behind an order. Only those the visibility rules allow; every view is audited.
    'POST /api/org/procurement/orders/quotes': [
        orgRoute('org.procurement.orders.quotes', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const vis = await visibilityOf(ctx.orgId);
            if (!sees(ctx, doc.acc, vis, 'quotes')) throw new HttpError(403, 'You are not allowed to see the quotes behind this order.');
            const lines = objs(doc.data.lines);
            const ids = Array.from(new Set(lines.map((l) => str(l.quotationId)))).filter(Boolean);
            const cases = (await Promise.all(ids.map((i) => getDoc(`${casesPath(ctx.orgId)}/${i}`)))).filter((x): x is Doc => !!x);
            await record(ctx, 'org.procurement.order.quotes.view', doc.id, `${cases.length} quotation(s)`);
            return {
                cases: cases.map((c) => {
                    const quotes = objs(c.data.quotes);
                    const rec = o(c.data.recommendation);
                    const recQuote = quotes.find((q) => str(q.id) === str(rec.quoteId));
                    const caseLines = objs(c.data.lines);
                    const qLine = (q: Obj, no: number) => objs(q.lines).find((x) => Number(x.no) === no && x.bid !== false);
                    return {
                        id: c.id,
                        number: str(c.data.number) || c.id,
                        requirementTitle: str(c.data.requirementTitle),
                        mode: str(o(c.data.review).mode),
                        recommendation: { vendorName: str(rec.vendorName), at: str(rec.at), reason: str(rec.reason) || str(rec.justification) || str(rec.notes), shortfallReason: str(rec.shortfallReason) },
                        quotes: quotes.map((q) => ({
                            id: str(q.id),
                            vendorName: str(q.vendorName),
                            ref: str(q.ref),
                            currency: str(q.currency),
                            validUntil: str(q.validUntil),
                            leadTimeDays: Number(q.leadTimeDays) || 0,
                            paymentTermsLabel: str(q.paymentTermsLabel),
                            recommended: str(q.id) === str(rec.quoteId),
                            bids: caseLines.filter((cl) => qLine(q, Number(cl.no))).length,
                            total: round(caseLines.reduce((s, cl) => { const ql = qLine(q, Number(cl.no)); return s + (ql ? netPrice(ql, q) * (Number(ql.quantity) || Number(cl.quantity) || 0) : 0); }, 0)),
                        })),
                        comparison: caseLines.map((cl) => ({
                            no: Number(cl.no),
                            itemName: str(cl.itemName) || str(cl.requirement),
                            quantity: Number(cl.quantity) || 0,
                            unit: str(cl.unit),
                            prices: quotes.map((q) => { const ql = qLine(q, Number(cl.no)); return { quoteId: str(q.id), net: ql ? netPrice(ql, q) : null }; }),
                        })),
                        orderPrices: lines
                            .filter((l) => str(l.quotationId) === c.id)
                            .map((l) => {
                                const quoted = recQuote ? netPrice(qLine(recQuote, Number(l.requirementLineNo || l.no)), recQuote) : Number(l.quotePrice) || 0;
                                const net = Number(l.netUnitPrice) || 0;
                                return { no: Number(l.no), itemName: str(l.itemName) || str(l.requirement), orderNet: net, quotedNet: quoted, variancePct: quoted > 0 ? round(((net - quoted) / quoted) * 100, 2) : null, revised: l.priceRevised === true, validUntil: str(l.quoteValidUntil) };
                            }),
                    };
                }),
            };
        }),
    ],

    // From the requirement to the order: every step, who did it, and how long each took.
    'POST /api/org/procurement/orders/trace': [
        orgRoute('org.procurement.orders.trace', null, async (ctx) => {
            const doc = await loadPo(ctx, str(ctx.body.id));
            const d = doc.data;
            const versionDocs = await versionsOf(ctx.orgId, baseOf(doc.id));
            const lines = objs(d.lines);
            const reqIds = Array.from(new Set(lines.map((l) => str(l.requirementId)))).filter(Boolean);
            const caseIds = Array.from(new Set(lines.map((l) => str(l.quotationId)))).filter(Boolean);
            const rqIds = Array.from(new Set(lines.map((l) => str(l.requisitionId)))).filter(Boolean);
            const [reqs, cases, rqs] = await Promise.all([
                Promise.all(reqIds.map((i) => getDoc(`${requirementsPath(ctx.orgId)}/${i}`))),
                Promise.all(caseIds.map((i) => getDoc(`${casesPath(ctx.orgId)}/${i}`))),
                Promise.all(rqIds.map((i) => getDoc(`${reqsPath(ctx.orgId)}/${i}`))),
            ]);
            interface Ev {
                at: string;
                stage: string;
                ref: string;
                title: string;
                byName: string;
                note: string;
            }
            const events: Ev[] = [];
            const take = (stage: string, ref: string, x: Doc | null) => {
                for (const h of objs(x?.data.history)) events.push({ at: str(h.at), stage, ref, title: str(h.action), byName: str(h.byName), note: str(h.note) });
            };
            reqs.forEach((x, i) => take('Requirement', reqIds[i], x));
            cases.forEach((x, i) => take('Quotation', caseIds[i], x));
            rqs.forEach((x, i) => take('Requisition', rqIds[i], x));
            for (const vd of versionDocs) take('Purchase order', vd.id, vd);
            for (const r of objs(d.receipts)) events.push({ at: str(r.renderedAt), stage: 'Service', ref: str(r.id), title: `service rendered ${str(r.periodFrom)} to ${str(r.periodTo)}`, byName: str(r.renderedByName), note: '' });
            for (const x of objs(d.deliveries)) events.push({ at: str(x.at), stage: 'Delivery', ref: str(x.ref), title: `delivery recorded (${str(x.date)})`, byName: str(x.byName), note: str(x.note) });
            events.sort((a, b) => a.at.localeCompare(b.at));
            const t0 = events.length ? Date.parse(events[0].at) : 0;
            const timeline = events.map((e, i) => ({ ...e, hoursSincePrevious: i ? round((Date.parse(e.at) - Date.parse(events[i - 1].at)) / 3_600_000, 1) : 0, hoursSinceStart: round((Date.parse(e.at) - t0) / 3_600_000, 1) }));

            // Milestones and the time between them.
            const r0 = reqs[0]?.data ?? {};
            const c0 = cases[0]?.data ?? {};
            const q0 = rqs[0]?.data ?? {};
            const ms = [
                { key: 'raised', label: 'Requirement raised', at: str(r0.createdAt) },
                { key: 'submitted', label: 'Submitted to the manager', at: str(r0.submittedAt) },
                { key: 'approved', label: 'Approved by the manager', at: str(r0.approvedAt) },
                { key: 'acknowledged', label: 'Acknowledged by procurement', at: str(o(objs(r0.history).find((h) => str(h.action).startsWith('acknowledged')) ?? {}).at) },
                { key: 'quotation', label: 'Quotation opened', at: str(c0.createdAt) },
                { key: 'recommended', label: 'Quote recommended', at: str(o(c0.recommendation).at) },
                { key: 'requisition', label: 'Requisition created', at: str(q0.createdAt) },
                { key: 'reqConfirmed', label: 'Requisition confirmed by requester', at: str(q0.confirmedAt) },
                { key: 'poCreated', label: 'Order created', at: str(d.originAt) || str(d.createdAt) },
                { key: 'validated', label: 'Order validated', at: str(o(d.validation).at) },
                { key: 'confirmed', label: 'Order confirmed', at: str(d.confirmedAt) },
                ...steps(d).filter((s) => s.status === 'approved').map((s) => ({ key: `ap${s.level}`, label: `Approved ${s.level} (${s.positionTitle}) by ${s.byName}`, at: s.at })),
                { key: 'open', label: 'Fully approved', at: str(d.approvedAt) },
                { key: 'sent', label: 'Sent to the supplier', at: str(d.sentAt) },
                { key: 'ack', label: 'Acknowledged by the supplier', at: str(o(d.ack).at) },
                { key: 'first', label: 'First delivery', at: str(d.firstDeliveryAt) },
                { key: 'full', label: 'Delivered in full', at: str(d.deliveredAt) },
            ]
                .filter((m) => m.at)
                .sort((a, b) => a.at.localeCompare(b.at));
            const milestones = ms.map((m, i) => ({ ...m, hoursFromPrevious: i ? round((Date.parse(m.at) - Date.parse(ms[i - 1].at)) / 3_600_000, 1) : 0 }));

            const quoted = Math.max(0, ...lines.map((l) => Number(l.leadTimeDays) || 0));
            const start = str(d.sentAt) || str(d.approvedAt);
            const end = str(d.deliveredAt);
            const actual = start && end ? Math.ceil((Date.parse(end) - Date.parse(start)) / 86_400_000) : null;
            const elapsed = start ? Math.floor((Date.now() - Date.parse(start)) / 86_400_000) : null;
            return {
                chain: {
                    requirements: reqIds.map((i, k) => ({ id: i, title: str(reqs[k]?.data.title) })),
                    quotations: caseIds.map((i, k) => ({ id: i, number: str(cases[k]?.data.number) || i })),
                    requisitions: rqIds.map((i, k) => ({ id: i, number: str(rqs[k]?.data.number) || i })),
                },
                timeline,
                milestones,
                totalHours: milestones.length > 1 ? round((Date.parse(milestones[milestones.length - 1].at) - Date.parse(milestones[0].at)) / 3_600_000, 1) : 0,
                leadTime: { quotedDays: quoted, actualDays: actual, elapsedDays: elapsed, onTime: actual === null ? null : actual <= quoted, since: start },
            };
        }),
    ],
};

/** Requisitions go back to Confirmed when their order is cancelled or rejected, so they can be used again. */
async function releaseRequisitions(ctx: OrgContext, po: Obj, poId: string, why: string) {
    // Another version of the same order still in force keeps the requisitions.
    const siblings = (await versionsOf(ctx.orgId, baseOf(poId))).filter((p) => p.id !== poId && inForce(str(p.data.status)));
    if (siblings.length) return;
    for (const rqId of Array.from(new Set(objs(po.lines).map((l) => str(l.requisitionId)))).filter(Boolean)) {
        try {
            await mutate(ctx, 'req', rqId, 'release', async (d) => {
                if (str(d.status) !== 'converted' || baseOf(str(d.orderId)) !== baseOf(poId)) throw new HttpError(409, 'skip');
                return { patch: { status: 'confirmed', orderId: '', orderNumber: '' }, event: 'released', note: `${poId}: ${why}`, label: `Released from ${poId}` };
            });
        } catch {
            /* a requisition that is not tied to this order is left as it is */
        }
    }
}

/** A requisition matches an order when vendor, currency, payment terms, buyer group and categories agree. */
function matches(po: Obj, rq: Obj, keys: string[]): boolean {
    const pt = str(po.poType) || poTypeOf(objs(po.lines));
    if (pt && str(rq.poType) && pt !== str(rq.poType)) return false;
    if (str(po.vendorId) !== str(rq.vendorId) || str(po.currency) !== str(rq.currency) || str(po.paymentTermsCode) !== str(rq.paymentTermsCode) || str(po.groupKey) !== str(rq.groupKey)) return false;
    const have = new Set(scopeKeysOf(objs(po.lines)));
    return !have.size || keys.every((k) => have.has(k));
}
