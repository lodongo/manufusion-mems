// ---------------------------------------------------------------------------
// Record search and live record references for email, chat and To-dos.
//
// One search across modules (purchase requirements, requisitions, purchase orders, vendors, supplier invoices, work
// requests, work assessments, work orders, materials, stock takes, stock adjustments, assets, S&OP plans). A message
// links a record with a token [[TYPE:ID]]; readers see a live card (current status, title, open button).
// Security: every result and every card is filtered by the reader's OWN access in that module (the module's rule
// where it exports one, otherwise its view permission at the record's place), plus records the person takes part in
// (requester, creator, approver, assignee, workflow action recipient). A reference to a record the reader may not see
// is shown as "not available to you" with no detail. Searches are audited.
// ---------------------------------------------------------------------------
import { HttpError, encodeValue, getDoc, isObj, listDocs, runQuery, str, type Doc } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { allowedAt } from './scopeGuard';
import { audit } from './audit';

type Obj = Record<string, unknown>;
const root = (o: string) => `organizations/${o}`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const o = (v: unknown): Obj => (isObj(v) ? v : {});

export const REF_TOKEN = /\[\[([A-Z]{2,4}):([A-Za-z0-9_.-]{1,100})\]\]/g;
export const tokenOf = (type: string, id: string) => `[[${type}:${id}]]`;

/** People who take part in a record, from its own fields (requester, creator, approvers, assignees, history). */
export function participantsOf(d: Obj): Set<string> {
    const out = new Set<string>();
    const take = (v: unknown) => typeof v === 'string' && v && v.length <= 128 && out.add(v);
    for (const [k, v] of Object.entries(d)) {
        if (/(By|Uid|uid)$/.test(k)) take(v);
        if (/(Uids|ByAll|members|assignees|technicians)$/i.test(k) && Array.isArray(v)) v.forEach(take);
    }
    for (const h of objs(d.history)) take(h.by);
    for (const holder of [d, o(d.approval), o(d.coa), o(d.proposal)]) for (const s of objs(holder.steps)) take(s.by);
    for (const l of objs(d.assignments)) take(l.uid);
    return out;
}

interface Helpers {
    ctx: OrgContext;
    at: (perms: string[], nodeId: string) => Promise<boolean>;
    holds: (...perms: string[]) => boolean;
    involved: (type: string, id: string, d: Obj) => boolean;
    memo: Map<string, unknown>;
}
export interface Source {
    type: string;
    label: string;
    module: string;
    coll: string;
    link: string;
    linkLabel: string;
    /** Workflow-action adapters for the same records (their recipients may see them). */
    adapters: string[];
    ref: (id: string, d: Obj) => string;
    title: (id: string, d: Obj) => string;
    sub: (d: Obj) => string;
    status: (d: Obj) => string;
    when: (d: Obj) => string;
    visible: (h: Helpers, id: string, d: Obj) => boolean | Promise<boolean>;
}
const first = (...v: unknown[]) => v.map(str).find(Boolean) ?? '';
const lineText = (d: Obj) => objs(d.lines).slice(0, 3).map((l) => first(l.description, l.shortText, l.materialName, l.name)).filter(Boolean).join(', ');
const atSite = (perm: string, field = 'siteId') => (h: Helpers, id: string, d: Obj) => h.involved('', id, d) || h.at([perm], str(d[field]));

export const SOURCES: Source[] = [
    {
        type: 'PR', label: 'Purchase requirement', module: 'Procurement', coll: 'procurement_requirements', link: 'purchase_requirements', linkLabel: 'Purchase requirements', adapters: ['prc.requirement'],
        ref: (id) => id, title: (id, d) => first(d.title, lineText(d), 'Purchase requirement'), sub: (d) => first(d.requesterName), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.submittedAt, d.createdAt),
        visible: (h, id, d) => str(d.requesterUid) === h.ctx.uid || (str(d.status) !== 'draft' && (h.involved('PR', id, d) || h.holds('PRC.req.viewall', 'PRC.req.acknowledge', 'INV.req.release'))),
    },
    {
        type: 'PRQ', label: 'Purchase requisition', module: 'Procurement', coll: 'procurement_requisitions', link: 'procurement_requisitions', linkLabel: 'Purchase requisitions', adapters: ['prc.requisition'],
        ref: (id, d) => first(d.number, id), title: (id, d) => first(d.title, lineText(d), 'Purchase requisition'), sub: (d) => first(d.requesterName, d.buyerName), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('PRQ', id, d) || h.holds('PRC.prq.view'),
    },
    {
        type: 'PO', label: 'Purchase order', module: 'Procurement', coll: 'procurement_orders', link: 'procurement_orders', linkLabel: 'Purchase orders', adapters: ['prc.order'],
        ref: (id, d) => first(d.number, id), title: (id, d) => first(d.vendorName, lineText(d), 'Purchase order'), sub: (d) => [str(d.currency), Number(d.total ?? d.baseTotal) ? Number(d.total ?? d.baseTotal).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''].filter(Boolean).join(' '), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        async visible(h, id, d) {
            if (h.involved('PO', id, d)) return true;
            const po = await import('./purchaseOrders');
            const fin = await import('./finCore');
            if (!h.memo.has('po')) h.memo.set('po', Promise.all([po.poScope(h.ctx), fin.unitsOf(h.ctx.orgId)]).then(([scope, units]) => ({ scope, owned: po.ownedCostCenters(units, h.ctx.me) })).catch(() => null));
            const m = (await h.memo.get('po')) as { scope: Awaited<ReturnType<typeof po.poScope>>; owned: Set<string> } | null;
            return !!m && po.accessFlags({ ...h.ctx, testMode: false }, d, m.scope, m.owned).any;
        },
    },
    {
        type: 'VEN', label: 'Vendor', module: 'Procurement', coll: 'vendors', link: 'procurement_vendors', linkLabel: 'Vendors', adapters: ['prc.vendor'],
        ref: (id) => id, title: (id, d) => first(d.name, d.legalName, id), sub: (d) => first(d.category, d.country), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('VEN', id, d) || h.holds('PRC.vendors.view'),
    },
    {
        type: 'PA', label: 'Purchase agreement', module: 'Procurement', coll: 'purchase_agreements', link: 'procurement_agreements', linkLabel: 'Purchase agreements', adapters: ['prc.agreement'],
        ref: (id, d) => first(d.number, id), title: (id, d) => first(d.title, d.vendorName, 'Purchase agreement'), sub: (d) => [str(d.vendorName), str(d.startDate) && str(d.endDate) ? `${str(d.startDate)} to ${str(d.endDate)}` : ''].filter(Boolean).join(' · '), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('PA', id, d) || h.holds('PRC.agreements.view', 'PRC.agreements.manage', 'PRC.agreements.approve'),
    },
    {
        type: 'INV', label: 'Supplier invoice', module: 'Finance', coll: 'ap_invoices', link: 'fin_ap', linkLabel: 'Accounts payable', adapters: ['fin.ap_invoice'],
        ref: (id, d) => first(d.supplierInvoiceNo, id), title: (id, d) => first(d.vendorName, 'Supplier invoice'), sub: (d) => [str(d.currency), str(d.amount)].filter(Boolean).join(' '), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('INV', id, d) || h.holds('FIN.ap.view'),
    },
    {
        type: 'WR', label: 'Work request', module: 'Maintenance', coll: 'work_requests', link: 'work_requests', linkLabel: 'Work requests', adapters: ['mnt.wr'],
        ref: (id, d) => first(d.code, id), title: (id, d) => first(d.title, d.description, 'Work request'), sub: (d) => first(d.assetName, d.equipmentName, d.locationName), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('MNT.view'),
    },
    {
        type: 'WA', label: 'Work assessment', module: 'Maintenance', coll: 'work_assessments', link: 'work_requests', linkLabel: 'Work requests › Assessment', adapters: [],
        ref: (id, d) => first(d.code, d.wrCode, id), title: (id, d) => first(d.title, d.findings, d.description, 'Work assessment'), sub: (d) => first(d.wrCode, d.assetName), status: (d) => first(d.status, d.reviewStatus), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('MNT.view'),
    },
    {
        type: 'WO', label: 'Work order', module: 'Maintenance', coll: 'work_orders', link: 'work_orders', linkLabel: 'Work orders', adapters: ['mnt.wo'],
        ref: (id, d) => first(d.code, id), title: (id, d) => first(d.title, d.description, 'Work order'), sub: (d) => first(d.assetName, d.equipmentName, d.workflowLabel), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('MNT.view'),
    },
    {
        type: 'MAT', label: 'Material', module: 'Inventory', coll: 'materials', link: 'material_catalog', linkLabel: 'Materials Master', adapters: ['inv.material_creation'],
        ref: (id, d) => first(d.materialNumber, d.requestNumber, id), title: (id, d) => first(d.shortText, d.name, id), sub: (d) => first(d.uom, d.categoryName, d.category), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('MAT', id, d) || (['approved', 'active', 'extended'].includes(str(d.status)) && h.holds('INV.view', 'PRC.view', 'MNT.view')),
    },
    {
        type: 'PI', label: 'Stock take', module: 'Inventory', coll: 'stock_take_sessions', link: 'module/INV/feature/3', linkLabel: 'Stock take', adapters: ['inv.stock_take'],
        ref: (id) => id, title: (id, d) => first(d.title, d.warehouseName, 'Stock take'), sub: (d) => first(d.warehouseName, d.scopeLabel), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('INV.view', 'warehouseId'),
    },
    {
        type: 'ADJ', label: 'Stock adjustment', module: 'Inventory', coll: 'material_isolation_requests', link: 'inventory_on_hand', linkLabel: 'Inventory on hand', adapters: ['inv.stock_adjustment'],
        ref: (id) => id, title: (id, d) => first(d.reason, 'Stock adjustment'), sub: (d) => first(d.materialNumber, d.warehouseId), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('INV.view', 'warehouseId'),
    },
    {
        type: 'AST', label: 'Asset', module: 'Assets', coll: 'assets', link: 'assets', linkLabel: 'Assets', adapters: ['ast.asset'],
        ref: (id, d) => first(d.tag, d.assetNumber, id), title: (id, d) => first(d.name, id), sub: (d) => first(d.categoryName, d.locationName), status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: (h, id, d) => h.involved('AST', id, d) || h.at(['AST.view'], str(d.nodeId)),
    },
    {
        type: 'SOP', label: 'S&OP plan', module: 'Production Planning', coll: 'pln_plans', link: 'pln_foundation', linkLabel: 'S&OP planning cycle', adapters: ['pln.plan'],
        ref: (id) => id, title: (id, d) => `${first(d.siteName, d.siteId)} · ${str(d.fyLabel)}`, sub: (d) => `${Array.isArray(d.lines) ? d.lines.length : 0} SKUs`, status: (d) => str(d.status), when: (d) => first(d.updatedAt, d.createdAt),
        visible: atSite('PLN.view'),
    },
];
const byType = new Map(SOURCES.map((s) => [s.type, s]));

/** Search text of a record: reference, id, title, subtitle, status. */
export const haystack = (s: Source, id: string, d: Obj) => [s.type, s.label, id, s.ref(id, d), s.title(id, d), s.sub(d), s.status(d), lineText(d)].join(' ').toLowerCase();
/** Rank: exact reference, then reference prefix, then every word found; newest first within a rank. */
export function score(s: Source, id: string, d: Obj, words: string[], q: string): number {
    const ref = s.ref(id, d).toLowerCase();
    if (!words.length) return 1;
    const hay = haystack(s, id, d);
    if (!words.every((w) => hay.includes(w))) return 0;
    if (ref === q || id.toLowerCase() === q) return 100;
    if (ref.startsWith(q) || id.toLowerCase().startsWith(q)) return 60;
    if (s.title(id, d).toLowerCase().includes(q)) return 30;
    return 10;
}
/** "po: acme" or "PO acme" narrows to one record type. */
export function parseQuery(raw: string) {
    const text = raw.trim().slice(0, 120);
    const m = /^([A-Za-z]{2,4})(?::\s*|\s+)(.*)$/.exec(text);
    if (m && byType.has(m[1].toUpperCase())) return { type: m[1].toUpperCase(), q: m[2].trim().toLowerCase() };
    if (byType.has(text.toUpperCase())) return { type: text.toUpperCase(), q: '' };
    return { type: '', q: text.toLowerCase() };
}

const cache = new Map<string, { at: number; docs: Doc[] }>();
async function docsOf(orgId: string, s: Source): Promise<Doc[]> {
    const k = `${orgId}|${s.type}`;
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < 60_000) return hit.docs;
    const docs = (await listDocs(`${root(orgId)}/${s.coll}`).catch(() => [] as Doc[])).slice(0, 8000);
    cache.set(k, { at: Date.now(), docs });
    return docs;
}

async function helpersFor(ctx: OrgContext): Promise<Helpers> {
    const tasks = await runQuery({ from: [{ collectionId: 'workflow_tasks' }], where: { fieldFilter: { field: { fieldPath: 'recipients' }, op: 'ARRAY_CONTAINS', value: encodeValue(ctx.uid) } } }, root(ctx.orgId)).catch(() => [] as Doc[]);
    const mineTasks = new Set(tasks.map((t) => `${str(t.data.adapter)}|${str(t.data.refId)}`));
    const atMemo = new Map<string, Promise<boolean>>();
    const sa = ctx.role === 'org_super_admin';
    return {
        ctx,
        memo: new Map(),
        holds: (...perms) => sa || perms.some((p) => hasPerm(ctx.permissions, p)),
        at(perms, nodeId) {
            if (sa) return Promise.resolve(true);
            if (!nodeId) return Promise.resolve(false);
            const k = `${perms.join(',')}@${nodeId}`;
            if (!atMemo.has(k)) atMemo.set(k, allowedAt(ctx, perms, nodeId, 'read').catch(() => false));
            return atMemo.get(k)!;
        },
        involved(type, id, d) {
            if (participantsOf(d).has(ctx.uid)) return true;
            const s = byType.get(type);
            return !!s && s.adapters.some((a) => mineTasks.has(`${a}|${id}`));
        },
    };
}
const card = (s: Source, id: string, d: Obj) => ({ type: s.type, id, label: s.label, module: s.module, ref: s.ref(id, d), title: s.title(id, d).slice(0, 140), sub: s.sub(d).slice(0, 120), status: s.status(d), updatedAt: s.when(d), link: s.link, linkLabel: s.linkLabel, token: tokenOf(s.type, id) });
// `involved` needs the record type for workflow recipients; sources call it with '' when the type is implicit.
const visibleFor = async (h: Helpers, s: Source, id: string, d: Obj) => {
    const wrapped: Helpers = { ...h, involved: (_t, i, dd) => h.involved(s.type, i, dd) };
    try { return await s.visible(wrapped, id, d); } catch { return false; }
};

export const recordSearchRoutes = {
    // Search records across modules the person may see. Body: { q, types?: string[] }.
    'POST /api/org/records/search': [
        orgRoute('org.records.search', 'ADM.records.search', async (ctx) => {
            const parsed = parseQuery(str(ctx.body.q));
            const wanted = new Set((Array.isArray(ctx.body.types) ? ctx.body.types.map(str) : []).filter((t) => byType.has(t)));
            if (parsed.type) wanted.add(parsed.type);
            const sources = SOURCES.filter((s) => !wanted.size || wanted.has(s.type));
            const words = parsed.q.split(/\s+/).filter(Boolean).slice(0, 6);
            if (!words.length && !wanted.size) return { results: [], types: SOURCES.map((s) => ({ type: s.type, label: s.label, module: s.module })) };
            const h = await helpersFor(ctx);
            const results: Array<ReturnType<typeof card> & { score: number }> = [];
            for (const s of sources) {
                const docs = await docsOf(ctx.orgId, s);
                const ranked = docs.map((d) => ({ d, sc: score(s, d.id, d.data, words, parsed.q) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || s.when(b.d.data).localeCompare(s.when(a.d.data)));
                let n = 0;
                for (const x of ranked) {
                    if (n >= (sources.length === 1 ? 40 : 8)) break;
                    if (!(await visibleFor(h, s, x.d.id, x.d.data))) continue;
                    results.push({ ...card(s, x.d.id, x.d.data), score: x.sc });
                    n++;
                }
            }
            results.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
            await audit([{ category: 'access', action: 'records.search', actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { type: 'records', id: [...wanted].join(',') || 'all' }, details: `"${str(ctx.body.q).slice(0, 80)}" → ${results.length} result(s)` }]).catch(() => undefined);
            return { results: results.slice(0, 40).map(({ score: _s, ...r }) => r), types: SOURCES.map((s) => ({ type: s.type, label: s.label, module: s.module })) };
        }),
    ],
    // Live cards for references in a message. Body: { refs: [{ type, id }] } (up to 30).
    'POST /api/org/records/resolve': [
        orgRoute('org.records.resolve', 'ADM.records.search', async (ctx) => {
            const refs = (Array.isArray(ctx.body.refs) ? ctx.body.refs : []).filter(isObj).map((r) => ({ type: str(r.type), id: str(r.id) })).filter((r) => byType.has(r.type) && /^[A-Za-z0-9_.-]{1,100}$/.test(r.id));
            if (refs.length > 30) throw new HttpError(400, 'At most 30 references at a time');
            const h = await helpersFor(ctx);
            const cards = await Promise.all(
                refs.map(async (r) => {
                    const s = byType.get(r.type)!;
                    const d = await getDoc(`${root(ctx.orgId)}/${s.coll}/${r.id}`).catch(() => null);
                    if (!d) return { type: r.type, id: r.id, label: s.label, missing: true };
                    if (!(await visibleFor(h, s, d.id, d.data))) return { type: r.type, id: r.id, label: s.label, hidden: true };
                    return card(s, d.id, d.data);
                })
            );
            return { cards };
        }),
    ],
};
