import { HttpError, getDoc, isObj, listDocs, str, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';

// Workflow trace: for every approval in flight, who has decided, who is next, when, and the key figures that let a
// reader judge it at a glance (amount, quantity, event, reference). Read only.
//   workflows/describe   details and trail for given requests (used by My Workflow to enrich the inbox)
//   workflows/passed     requests I have already decided that are still not finished
// A person only sees a request they raised, already decided, or that is waiting on them (same rule as the inbox).

type Obj = Record<string, unknown>;
const TYPES = ['creation', 'extension', 'stock_adjustment', 'generic_workflow'] as const;
type WfType = (typeof TYPES)[number];
const LIVE = ['pending_approval', 'approved_pending_posting'];

interface Source {
    type: WfType;
    path: (root: string) => string;
    label: string;
    link: { path: string; label: string } | null;
}
const SOURCES: Source[] = [
    { type: 'creation', path: (r) => `${r}/materials`, label: 'Material creation', link: { path: 'material_catalog', label: 'Open Materials Master' } },
    { type: 'extension', path: (r) => `${r}/material_extensions`, label: 'Material extension', link: { path: 'material_catalog', label: 'Open Materials Master' } },
    { type: 'stock_adjustment', path: (r) => `${r}/material_isolation_requests`, label: 'Stock adjustment', link: { path: 'inventory_on_hand', label: 'Open On Hand' } },
    { type: 'generic_workflow', path: (r) => `${r}/workflow_requests`, label: 'Workflow request', link: null },
];

const MONEY_KEYS: Array<[string, string]> = [['amount', 'Amount'], ['totalValue', 'Total value'], ['value', 'Value'], ['totalCost', 'Total cost'], ['cost', 'Cost'], ['unitCost', 'Unit cost']];
const EVENT_KEYS: Array<[string, string]> = [['eventName', 'Event'], ['event', 'Event'], ['transactionName', 'Transaction'], ['reference', 'Reference'], ['description', 'Description']];

const clip = (v: unknown, n = 120) => str(v).slice(0, n);
const hasValue = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

function details(type: WfType, d: Obj): Array<{ label: string; value: string }> {
    const out: Array<{ label: string; value: string }> = [];
    const add = (label: string, v: unknown) => {
        if (hasValue(v) && !out.some((o) => o.label === label)) out.push({ label, value: clip(v) });
    };
    if (type === 'stock_adjustment') {
        add('Material', d.materialNumber);
        add('Reason', d.reason);
        add('Quantity', d.quantity);
        add('Warehouse', d.warehouseId);
        if (d.moveToBin === true) add('Move to bin', 'Yes');
    } else if (type === 'creation' || type === 'extension') {
        add('Material number', d.materialNumber);
        add('Name', d.name ?? d.materialName ?? d.shortText);
        add('Material type', d.materialType);
        add('Base unit', d.baseUnit);
    }
    for (const [k, label] of MONEY_KEYS) add(label, d[k]);
    if (hasValue(d.currency) && out.some((o) => MONEY_KEYS.some(([, l]) => l === o.label))) add('Currency', d.currency);
    for (const [k, label] of EVENT_KEYS) add(label, d[k]);
    return out.slice(0, 8);
}

export interface Step {
    level: number;
    approver: string;
    state: 'done' | 'current' | 'waiting' | 'rejected';
    by: string;
    at: string;
    comment: string;
}

interface Caches {
    users: Map<string, string>;
    titles: Map<string, string>;
    roles: Map<string, string>;
    registry: Doc[];
    legacy: Doc | null;
}

async function build(ctx: OrgContext, src: Source, doc: Doc, caches: Caches) {
    const d = doc.data;
    const nameOf = async (uid: string): Promise<string> => {
        if (!uid) return '';
        const cached = caches.users.get(uid);
        if (cached !== undefined) return cached;
        const u = await getDoc(`users/${uid}`);
        const n = u && str(u.data.orgId) === ctx.orgId ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '';
        caches.users.set(uid, n);
        return n;
    };
    const roleLabel = (code: string) => caches.titles.get(code) || caches.roles.get(code) || code;

    const history = (Array.isArray(d.approvalHistory) ? (d.approvalHistory as unknown[]) : []).filter(isObj);
    const level = Number(d.approvalLevel) || 1;
    const owner = str(d.submittedBy || d.createdBy);
    const registryCode = src.type === 'creation' ? 'PRC-001' : src.type === 'extension' ? 'PRC-002' : src.type === 'stock_adjustment' ? 'INV-003' : str(d.workflowCode);
    const config = caches.registry.find((w) => w.id === registryCode && w.data.enabled === true);

    // The approver of each level, from the enabled workflow, else the older material workflow.
    let plan: string[] = [];
    if (config) {
        const steps = Array.isArray(config.data.steps) ? (config.data.steps as unknown[]).filter(isObj) : [];
        plan = await Promise.all(
            steps.map(async (s) => {
                if (str(s.mode) === 'user') return (await nameOf(str(s.uid))) || 'A named person';
                if (str(s.mode) === 'manager') return `Manager ${Number(s.managerLevel) || 1} level${Number(s.managerLevel) > 1 ? 's' : ''} above the requester`;
                return roleLabel(str(s.role));
            })
        );
    } else if (caches.legacy && (src.type === 'creation' || src.type === 'extension')) {
        const roles = Array.isArray(caches.legacy.data.roles) ? (caches.legacy.data.roles as unknown[]) : [];
        const modes = Array.isArray(caches.legacy.data.modes) ? (caches.legacy.data.modes as unknown[]) : [];
        plan = [0, 1, 2].map((i) => (str(modes[i]) === 'above_creator' ? `Manager ${i + 1} level${i ? 's' : ''} above the requester` : roleLabel(str(roles[i])) || `Level ${i + 1}`));
    }
    const total = Math.max(plan.length, history.filter((h) => str(h.decision) === 'approve' || str(h.decision) === 'approved').length, 1);
    const status = str(d.status);
    const finished = !LIVE.includes(status);

    const steps: Step[] = [];
    for (let i = 0; i < total; i++) {
        const lvl = i + 1;
        const entry = history.find((h, idx) => (Number(h.level) || idx + 1) === lvl);
        const decision = entry ? str(entry.decision) : '';
        const state: Step['state'] = entry ? (decision === 'reject' || decision === 'rejected' ? 'rejected' : 'done') : !finished && lvl === level && status === 'pending_approval' ? 'current' : 'waiting';
        steps.push({ level: lvl, approver: plan[i] || (entry ? roleLabel(str(entry.role)) : `Level ${lvl}`), state, by: entry ? await nameOf(str(entry.by)) : '', at: entry ? str(entry.at) : '', comment: entry ? clip(entry.comment, 300) : '' });
    }

    const reconcile = status === 'approved_pending_posting';
    return {
        key: `${src.type}:${doc.id}`,
        type: src.type,
        id: doc.id,
        label: src.label,
        title: clip(d.name || d.materialName || d.shortText || d.description || (src.type === 'stock_adjustment' ? `${str(d.materialNumber)} ${str(d.reason)}` : '') || doc.id),
        status,
        statusLabel: reconcile ? 'Approved, awaiting posting' : status === 'pending_approval' ? 'Awaiting approval' : status.replace(/_/g, ' '),
        level: Math.min(level, total),
        totalLevels: total,
        submittedAt: str(d.submittedAt || d.createdAt),
        requester: await nameOf(owner),
        isMine: owner === ctx.uid,
        decidedByMe: history.some((h) => str(h.by) === ctx.uid),
        details: details(src.type, d),
        source: src.link,
        steps,
    };
}

async function loadCaches(ctx: OrgContext): Promise<Caches> {
    const root = `organizations/${ctx.orgId}`;
    const [positions, roles, registry, legacy] = await Promise.all([listDocs(`${root}/positions`), listDocs(`${root}/roles`), listDocs(`${root}/workflow_registry`), getDoc(`${root}/material_workflows/default`)]);
    return {
        users: new Map<string, string>(),
        titles: new Map(positions.map((p) => [p.id, str(p.data.title) ? `${str(p.data.title)} (${p.id})` : p.id])),
        roles: new Map(roles.map((r) => [r.id, str(r.data.name) || r.id])),
        registry,
        legacy,
    };
}

export const workflowTraceRoutes = {
    'POST /api/org/workflows/describe': [
        orgRoute('org.workflows.describe', null, async (ctx) => {
            const wanted = (Array.isArray(ctx.body.items) ? (ctx.body.items as unknown[]) : []).filter(isObj).slice(0, 60);
            const c = await loadCaches(ctx);
            const root = `organizations/${ctx.orgId}`;
            const out = [];
            for (const w of wanted) {
                const src = SOURCES.find((s) => s.type === str(w.type));
                const id = str(w.id);
                if (!src || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
                const doc = await getDoc(`${src.path(root)}/${id}`);
                if (!doc) continue;
                const item = await build(ctx, src, doc, c);
                // Only requests I raised, already decided, or that wait on an approver I am mapped to.
                if (item.isMine || item.decidedByMe || ctx.role === 'org_super_admin' || (await waitingOnMe(ctx, c, src, doc))) out.push(item);
            }
            return { items: out };
        }),
    ],

    'POST /api/org/workflows/passed': [
        orgRoute('org.workflows.passed', null, async (ctx) => {
            const c = await loadCaches(ctx);
            const root = `organizations/${ctx.orgId}`;
            const out = [];
            for (const src of SOURCES) {
                for (const doc of await listDocs(src.path(root))) {
                    if (!LIVE.includes(str(doc.data.status))) continue;
                    const history = Array.isArray(doc.data.approvalHistory) ? (doc.data.approvalHistory as unknown[]).filter(isObj) : [];
                    if (!history.some((h) => str(h.by) === ctx.uid)) continue;
                    out.push(await build(ctx, src, doc, c));
                }
            }
            if (out.length > 200) throw new HttpError(413, 'Too many results.');
            return { items: out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)) };
        }),
    ],
};

/** Is this request currently waiting for an approver the caller is mapped to (user, role or job role)? */
async function waitingOnMe(ctx: OrgContext, c: Caches, src: Source, doc: Doc): Promise<boolean> {
    if (str(doc.data.status) !== 'pending_approval') return false;
    const level = Number(doc.data.approvalLevel) || 1;
    const registryCode = src.type === 'creation' ? 'PRC-001' : src.type === 'extension' ? 'PRC-002' : src.type === 'stock_adjustment' ? 'INV-003' : str(doc.data.workflowCode);
    const config = c.registry.find((w) => w.id === registryCode && w.data.enabled === true);
    const assigned = (Array.isArray(ctx.me.data.assignments) ? (ctx.me.data.assignments as unknown[]) : []).filter(isObj).map((a) => str(a.positionCode));
    const held = new Set([ctx.role, ...assigned, ...ctx.grants.map((g) => g.positionCode)]);
    if (config) {
        const step = (Array.isArray(config.data.steps) ? (config.data.steps as unknown[]) : [])[level - 1];
        return isObj(step) && ((str(step.mode) === 'user' && str(step.uid) === ctx.uid) || (str(step.mode) === 'role' && held.has(str(step.role))));
    }
    if (c.legacy && (src.type === 'creation' || src.type === 'extension')) {
        const roles = Array.isArray(c.legacy.data.roles) ? (c.legacy.data.roles as unknown[]) : [];
        return held.has(str(roles[level - 1]));
    }
    return false;
}
