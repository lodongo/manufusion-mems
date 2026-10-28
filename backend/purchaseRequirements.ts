import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { orgUsers, record } from './org';
import { allowedNodeIds, nextOrgCounter } from './positions';
import { catalogItemSpec, catalogSummary, catalogTree, searchCatalog, type ItemSpec, type TreeOut } from './procurement';
import { assetClassSpec, assetClassTree } from './assets';
import { col as structureCol, signedUrl } from './structure';
import { PROCUREMENT_UNITS } from './procurementUnits';
import { buyingPolicy } from './procurementPolicy';
import { covers, deskScope } from './buyerGroups';
import { checkChosenGl, choosableAccounts } from './finCore';
import { requireAt } from './scopeGuard';
import { STORAGE_COST_TYPES } from './warehouse';
import { KIND_LABEL, LINE_KINDS, OPEN_STATUSES, adopted, can, isSuper, kindOf, masterSummary, requireProcurement, requirementsPath, type LineKind } from './procurementSetup';

// ---------------------------------------------------------------------------
// Purchase requirements (REQ + 9 digits). Raised by any user, approved by the immediate manager, acknowledged by
// procurement for offline quotation. No prices or quotes are held here; an item may carry an indicative budget.
//
//   organizations/{org}/procurement_requirements/{REQ000000001}                the requirement, its items and history
//   organizations/{org}/procurement_requirements/{id}/attachments/{attId}      one file each (PDF, JPEG, PNG, 450 KB)
//
// Items are numbered 10, 20, 30 ... so they can become purchase order lines later. Each item is saved on its own,
// core details first (what, how many, when, cost center, GL account), then the technical attributes. The whole
// requirement stays a private draft until the requester submits it.
//
// Status flow
//   unverified (raised by Replenishment) --planner verifies--> pending_approval (the planner becomes the requester)
//   unverified --planner dismisses, or Replenishment finds it no longer needed--> cancelled
//   draft --requester submits--> pending_approval --manager approves--> approved --procurement acknowledges--> acknowledged
//   pending_approval --manager returns--> returned_user (requester edits and submits again)
//   pending_approval --manager rejects--> rejected
//   approved|acknowledged --procurement returns--> pending_approval (back to the manager) or returned_user
//   pending_approval|returned_user --requester cancels--> cancelled          draft --discard--> cancelled
// Who sees what: the requester (drafts only the requester), the manager it waits on (or approved, until converted),
// procurement personnel (approved and acknowledged), and holders of PRC.req.viewall. Separation: nobody acts on their
// own requirement, and whoever approved cannot acknowledge the same requirement. Every action is audited.
// ---------------------------------------------------------------------------

const ID = /^REQ\d{9}$/;
const URGENCY = ['low', 'medium', 'high'] as const;
const EDITABLE = ['draft', 'returned_user'];
const ITEM_STEP = 10;
const MAX_LINES = 50;
const MAX_FILES = 10;
const MAX_DRAFTS = 25;
const MAX_FILE_CHARS = 620_000; // about 450 KB of file once encoded
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Units of measure by category (Mass, Length, ...). Services have no unit: each service item is one.
const UNITS = PROCUREMENT_UNITS.filter((u) => u.active && u.selectable);
function uomGroups() {
    const groups = new Map<string, { code: string; name: string; units: Array<{ code: string; label: string; symbol: string }> }>();
    for (const u of UNITS) {
        const g = groups.get(u.categoryCode) ?? { code: u.categoryCode, name: u.category, units: [] };
        g.units.push({ code: u.code, label: u.label, symbol: u.symbol });
        groups.set(u.categoryCode, g);
    }
    return Array.from(groups.values());
}

const STATUS_LABEL: Record<string, string> = {
    unverified: 'Unverified (automatic), awaiting a planner',
    draft: 'Draft',
    pending_approval: 'Pending manager approval',
    approved: 'Approved, awaiting procurement',
    acknowledged: 'Acknowledged by procurement',
    returned_user: 'Returned to requester',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    converted: 'Converted to requisition',
};

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const today = () => new Date().toISOString().slice(0, 10);
const nameOfUser = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
const numOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cleanText = (v: unknown) => str(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
/** Older requirements used normal / critical; show them as medium / high. */
const urgencyOf = (u: string) => (u === 'normal' ? 'medium' : u === 'critical' ? 'high' : u);

// ----- Job role chart -----

interface Pos {
    title: string;
    parentCode: string;
}
async function positions(orgId: string): Promise<Map<string, Pos>> {
    return new Map((await listDocs(`organizations/${orgId}/positions`)).map((p) => [p.id, { title: str(p.data.title), parentCode: str(p.data.parentCode) }]));
}
function activeAssignments(user: Doc | null | undefined): Obj[] {
    const t = today();
    return objs(user?.data.assignments).filter((a) => str(a.positionCode) && (!str(a.startsOn) || str(a.startsOn) <= t) && (!str(a.endsOn) || str(a.endsOn) >= t));
}
const myPositions = (user: Doc | null | undefined) => activeAssignments(user).map((a) => str(a.positionCode));
function primaryPosition(user: Doc | null | undefined): string {
    const list = activeAssignments(user);
    return str((list.find((a) => str(a.type) === 'primary') ?? list[0])?.positionCode);
}

/** The approver for a requester: the job role this person reports to, and how many people hold it. */
async function approverFor(ctx: OrgContext, user: Doc | null | undefined): Promise<{ position: string; title: string; holders: number; managerPosition: string; managerTitle: string; problem: string }> {
    const pos = await positions(ctx.orgId);
    const position = primaryPosition(user);
    const base = { position, title: pos.get(position)?.title ?? '', holders: 0, managerPosition: '', managerTitle: '' };
    if (!position) return { ...base, problem: 'You have no job role assigned, so your manager cannot be found. Ask your administrator to assign one.' };
    const manager = pos.get(position)?.parentCode ?? '';
    if (!manager) return { ...base, problem: `Your job role (${base.title || position}) does not report to anyone, so there is no immediate manager to approve. Ask your administrator to set the reporting line.` };
    const users = await orgUsers(ctx.orgId);
    const holders = users.filter((u) => str(u.data.status) !== 'disabled' && u.id !== (user?.id ?? '') && myPositions(u).includes(manager)).length;
    const out = { ...base, managerPosition: manager, managerTitle: pos.get(manager)?.title ?? manager, holders };
    if (!holders) return { ...out, problem: `Nobody currently holds your manager's job role (${out.managerTitle}). Ask your administrator to assign it.` };
    return { ...out, problem: '' };
}

// ----- Access -----

/** May this person approve, reject or return this requirement as the immediate manager? */
const isManager = (ctx: OrgContext, d: Obj) => str(d.requesterUid) !== ctx.uid && can(ctx, 'PRC.req.approve') && myPositions(ctx.me).includes(str(d.approverPosition));
const history = (d: Obj) => objs(d.history);
const approvedByMe = (ctx: OrgContext, d: Obj) => history(d).some((h) => str(h.by) === ctx.uid && str(h.action) === 'approved');

function visible(ctx: OrgContext, d: Obj): boolean {
    const status = str(d.status);
    // Replenishment requests are reviewed by planners before they become anybody's requirement.
    if (status === 'unverified') return can(ctx, 'PRC.req.viewall') || can(ctx, 'INV.replenishment.view');
    if (str(d.requesterUid) === ctx.uid) return true;
    if (status === 'draft') return false; // a draft belongs to its requester alone
    if (can(ctx, 'PRC.req.viewall')) return true;
    if (status === 'pending_approval' && isManager(ctx, d)) return true;
    if (approvedByMe(ctx, d) && status !== 'converted') return true;
    if (can(ctx, 'PRC.req.acknowledge') && ['approved', 'acknowledged'].includes(status)) return true;
    return false;
}

function flags(ctx: OrgContext, d: Obj) {
    const status = str(d.status);
    const mine = str(d.requesterUid) === ctx.uid;
    const desk = can(ctx, 'PRC.req.acknowledge') && !mine && !approvedByMe(ctx, d);
    return {
        edit: mine && EDITABLE.includes(status),
        submit: mine && EDITABLE.includes(status),
        discard: mine && status === 'draft',
        cancel: mine && ['pending_approval', 'returned_user'].includes(status),
        approve: status === 'pending_approval' && isManager(ctx, d),
        reject: status === 'pending_approval' && isManager(ctx, d),
        returnManager: status === 'pending_approval' && isManager(ctx, d),
        acknowledge: status === 'approved' && desk,
        returnDesk: ['approved', 'acknowledged'].includes(status) && desk,
    };
}

// ----- Output -----

function waitingOn(d: Obj): string {
    switch (str(d.status)) {
        case 'unverified':
            return str(d.source) === 'maintenance' ? 'Maintenance planner (verify the work-order request)' : 'Planner (verify the replenishment request)';
        case 'draft':
            return 'Requester (not yet submitted)';
        case 'pending_approval':
            return str(d.approverTitle) || 'Immediate manager';
        case 'approved':
            return 'Procurement';
        case 'acknowledged':
            return 'Procurement (offline quotation)';
        case 'returned_user':
            return str(d.requesterName) || 'Requester';
        default:
            return '';
    }
}

function row(d: Obj, id: string) {
    const lines = objs(d.lines);
    const rank = (u: string) => URGENCY.indexOf(urgencyOf(u) as (typeof URGENCY)[number]);
    const dates = lines.map((l) => str(l.dateRequired)).filter(Boolean).sort();
    const budget = lines.reduce((sum, l) => sum + (numOf(l.budget) ?? 0), 0);
    return {
        id,
        title: str(d.title),
        status: str(d.status),
        statusLabel: STATUS_LABEL[str(d.status)] ?? str(d.status),
        requester: str(d.requesterName),
        requesterEmail: str(d.requesterEmail),
        submittedAt: str(d.submittedAt),
        updatedAt: str(d.updatedAt),
        lineCount: lines.length,
        summary: lines.length ? str(lines[0].requirement).slice(0, 140) : '',
        kinds: Array.from(new Set(lines.map((l) => KIND_LABEL[str(l.type) as LineKind] ?? str(l.type)))),
        neededBy: dates[0] ?? '',
        urgency: lines.reduce((best, l) => (rank(str(l.urgency)) > rank(best) ? urgencyOf(str(l.urgency)) : best), 'low'),
        budget: Math.round(budget * 100) / 100,
        waitingOn: waitingOn(d),
        attachments: objs(d.attachments).length,
    };
}

// ----- Technical attributes -----

async function specOf(type: LineKind, code: string): Promise<ItemSpec | null> {
    if (type === 'asset') return assetClassSpec(code);
    return catalogItemSpec(type === 'material' ? 'materials' : 'services', code);
}
async function treeOf(type: LineKind, categoryCode: string, subcategoryCode: string): Promise<TreeOut | null> {
    if (type === 'asset') return assetClassTree(categoryCode, subcategoryCode);
    return catalogTree(type === 'material' ? 'materials' : 'services', categoryCode, subcategoryCode);
}

/** Checks the values entered for the attributes of a catalogue entry. Missing mandatory ones are reported by missingOf, so a draft can be saved part way. */
function readAttrs(spec: ItemSpec, raw: unknown): { values: Obj; view: Array<{ code: string; name: string; value: string; unit: string }> } {
    const input = isObj(raw) ? raw : {};
    const values: Obj = {};
    const view: Array<{ code: string; name: string; value: string; unit: string }> = [];
    for (const a of spec.attributes) {
        const v = input[a.code];
        const blank = v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
        if (blank) continue;
        const val: Obj = a.validation;
        const min = numOf(val.minimum);
        const max = numOf(val.maximum);
        let stored: unknown = null;
        let shown = '';
        switch (a.dataType) {
            case 'integer':
            case 'decimal': {
                const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
                if (!Number.isFinite(n) || (a.dataType === 'integer' && !Number.isInteger(n))) throw new HttpError(400, `${a.name} must be a ${a.dataType === 'integer' ? 'whole number' : 'number'}.`);
                if (min !== null && n < min) throw new HttpError(400, `${a.name} must be at least ${min}.`);
                if (max !== null && n > max) throw new HttpError(400, `${a.name} must be at most ${max}.`);
                if (Math.abs(n) > 1e15) throw new HttpError(400, `${a.name} is too large.`);
                stored = n;
                shown = String(n);
                break;
            }
            case 'boolean': {
                if (v !== true && v !== false && v !== 'true' && v !== 'false') throw new HttpError(400, `${a.name} must be yes or no.`);
                const b = v === true || v === 'true';
                stored = b;
                shown = b ? 'Yes' : 'No';
                break;
            }
            case 'date': {
                const s = str(v);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new HttpError(400, `Enter a valid date for ${a.name}.`);
                stored = s;
                shown = s;
                break;
            }
            case 'enum': {
                const s = str(v);
                const o = a.options.find((x) => x.code === s);
                if (!o) throw new HttpError(400, `Choose a valid option for ${a.name}.`);
                stored = s;
                shown = o.label;
                break;
            }
            case 'multi_select': {
                // A list, or the comma-separated form used by maintenance records and the shared catalogue form.
                const list = Array.isArray(v) ? v.map(str) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : [];
                if (!list.length || new Set(list).size !== list.length || list.some((s) => !a.options.some((o) => o.code === s))) throw new HttpError(400, `Choose valid options for ${a.name}.`);
                stored = list;
                shown = list.map((s) => a.options.find((o) => o.code === s)?.label ?? s).join(', ');
                break;
            }
            case 'country':
            case 'currency': {
                const s = str(v).trim().toUpperCase();
                if (!(a.dataType === 'country' ? /^[A-Z]{2}$/ : /^[A-Z]{3}$/).test(s)) throw new HttpError(400, `Enter a valid ${a.dataType} code for ${a.name}.`);
                stored = s;
                shown = s;
                break;
            }
            default: {
                const s = cleanText(v);
                const maxLength = numOf(val.maxLength) ?? 500;
                if (s.length > Math.min(maxLength, 2000)) throw new HttpError(400, `${a.name} can be up to ${Math.min(maxLength, 2000)} characters.`);
                const pattern = str(val.pattern);
                if (pattern) {
                    let re: RegExp | null = null;
                    try {
                        re = new RegExp(pattern);
                    } catch {
                        re = null;
                    }
                    if (re && !re.test(s)) throw new HttpError(400, `${a.name} is not in the expected format.`);
                }
                stored = s;
                shown = s;
            }
        }
        values[a.code] = stored;
        view.push({ code: a.code, name: a.name, value: shown, unit: a.unit });
    }
    return { values, view };
}

/** What an item still needs before the requirement can be submitted. */
function missingOf(line: Obj): string[] {
    const out: string[] = [];
    if (str(line.source) === 'catalogue' && !str(line.itemCode)) out.push('Catalogue entry (or switch to Description)');
    if (str(line.source) === 'warehouse' && !str(line.materialId)) out.push('Material from a warehouse (or switch to Description)');
    const values = isObj(line.attributes) ? line.attributes : {};
    for (const a of objs(line.requiredAttrs)) {
        const v = values[str(a.code)];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) out.push(str(a.name));
    }
    if (cleanText(line.technical).length < 10) out.push('Technical notes');
    if (str(line.dateRequired) < today()) out.push('Date required (it has passed)');
    return out;
}

// ----- Validation of one item -----

/** Published materials and where they are stocked. */
const isPublished = (m: Doc) => !!str(m.data.materialNumber) && ['approved', 'active'].includes(str(m.data.status).toLowerCase());
function linkedTo(m: Doc, warehouseId: string, exts: Doc[]): boolean {
    const ids = Array.isArray(m.data.warehouseIds) ? (m.data.warehouseIds as unknown[]).map(str) : [];
    if (ids.includes(warehouseId)) return true;
    if (str(m.data.pushedAt) && str(m.data.warehouseId) === warehouseId) return true;
    return exts.some((e) => str(e.data.sourceId) === m.id && str(e.data.warehouseId) === warehouseId && str(e.data.status) === 'approved');
}

/** Cost centers of type Inventory or Warehousing, with the material categories each warehouse holds. */
function warehouseMap(nodes: Doc[], whDocs: Doc[]): Map<string, { node: Doc; categories: string[] }> {
    const byId = new Map(whDocs.map((w): [string, Doc] => [w.id, w]));
    const out = new Map<string, { node: Doc; categories: string[] }>();
    for (const n of nodes) {
        const costType = isObj(n.data.attributes) ? str(n.data.attributes.costType) : '';
        if (str(n.data.level) !== 'cost_center' || str(n.data.status) === 'inactive' || !STORAGE_COST_TYPES.includes(costType)) continue;
        const d = byId.get(n.id)?.data ?? {};
        const cats = Array.isArray(d.materialCategoryCodes) ? (d.materialCategoryCodes as unknown[]).map(str).filter(Boolean) : str(d.materialCategoryCode) ? [str(d.materialCategoryCode)] : [];
        out.set(n.id, { node: n, categories: cats });
    }
    return out;
}

async function refsOf(ctx: OrgContext) {
    const [adoptions, nodes, gl, whDocs, policy] = await Promise.all([
        Promise.all(LINE_KINDS.map(async (k) => [k, await adopted(ctx.orgId, k)] as const)),
        listDocs(structureCol(ctx.orgId)),
        catalogSummary('gl_accounts'),
        listDocs(`organizations/${ctx.orgId}/warehouses`),
        buyingPolicy(ctx.orgId),
    ]);
    const allowed = isSuper(ctx) ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, true);
    return {
        adoptedBy: new Map(adoptions),
        costCenters: new Map(nodes.filter((n) => str(n.data.level) === 'cost_center' && str(n.data.status) !== 'inactive' && (allowed === 'all' || allowed.has(n.id))).map((n) => [n.id, n])),
        glByCode: new Map((gl?.items ?? []).map((i) => [i.code, i.name])),
        policy,
        warehouses: warehouseMap(nodes, whDocs),
    };
}

async function prepareItem(ctx: OrgContext, l: Obj, no: number): Promise<Obj> {
    const at = `Item ${no}: `;
    const refs = await refsOf(ctx);
    const type = str(l.type) as LineKind;
    if (!LINE_KINDS.includes(type)) throw new HttpError(400, `${at}choose Material, Service or Asset.`);
    const categoryCode = str(l.categoryCode);
    const subcategoryCode = str(l.subcategoryCode);
    const cat = refs.adoptedBy.get(type)!.categories.find((c) => c.code === categoryCode);
    const sub = cat?.subcategories.find((s) => s.code === subcategoryCode);
    if (!cat || !sub) throw new HttpError(400, `${at}choose a category and subcategory that your organization has adopted for ${KIND_LABEL[type]}.`);
    const requirement = cleanText(l.requirement);
    if (requirement.length < 3 || requirement.length > 300) throw new HttpError(400, `${at}describe the requirement in 3 to 300 characters.`);
    const technical = cleanText(l.technical);
    if (technical.length > 2000) throw new HttpError(400, `${at}technical notes can be up to 2000 characters.`);

    const isService = type === 'service';
    const uom = isService ? null : UNITS.find((x) => x.code === str(l.uomCode));
    if (!isService && !uom) throw new HttpError(400, `${at}choose the unit of measure.`);
    const quantity = isService ? 1 : Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) throw new HttpError(400, `${at}enter a quantity greater than zero.`);

    const dateRequired = str(l.dateRequired);
    const limit = new Date(Date.now() + 5 * 365 * 86_400_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRequired) || Number.isNaN(Date.parse(`${dateRequired}T00:00:00Z`))) throw new HttpError(400, `${at}enter the date required.`);
    if (dateRequired < today()) throw new HttpError(400, `${at}the date required cannot be in the past.`);
    if (dateRequired > limit) throw new HttpError(400, `${at}the date required is too far ahead.`);
    const urgency = str(l.urgency);
    if (!URGENCY.includes(urgency as (typeof URGENCY)[number])) throw new HttpError(400, `${at}choose the urgency: low, medium or high.`);

    let budget: number | null = null;
    if (l.budget !== undefined && l.budget !== null && String(l.budget).trim() !== '') {
        const b = Number(String(l.budget).replace(/,/g, ''));
        if (!Number.isFinite(b) || b < 0 || b > 1_000_000_000_000) throw new HttpError(400, `${at}enter a budget of zero or more, or leave it empty.`);
        budget = Math.round(b * 100) / 100;
    }

    // Buying rules: when materials may only be bought for warehouses, the cost center must be a warehouse that holds this material category.
    let cc = refs.costCenters.get(str(l.costCenterId));
    const wh = refs.warehouses.get(str(l.costCenterId));
    if (type === 'material') {
        if (!refs.policy.directToCostCenters) {
            if (!wh || !wh.categories.includes(categoryCode)) throw new HttpError(400, `${at}your organization buys materials only for warehouses that hold this material type. Choose a matching warehouse.`);
            cc = wh.node;
        } else if (!cc && wh) cc = wh.node;
    }
    if (!cc) throw new HttpError(400, `${at}choose a cost center that you have access to.`);
    const glCode = str(l.glCode);
    // Only accounts approved in the chart of the cost center's legal entity, open, and allowed for the cost center.
    const glOk = await checkChosenGl(ctx.orgId, cc.id, glCode, at);

    // Family and catalogue entry (dropdowns down to the technical attributes).
    const asked = str(l.source);
    const source = ['description', 'warehouse', 'catalogue'].includes(asked) ? asked : str(l.itemCode) ? 'catalogue' : 'description';
    if (source === 'warehouse' && type !== 'material') throw new HttpError(400, `${at}only materials can be picked from a warehouse.`);
    const tree = source === 'catalogue' ? await treeOf(type, categoryCode, subcategoryCode) : null;
    const itemCode = source === 'catalogue' ? str(l.itemCode) : '';
    let familyCode = source === 'catalogue' ? str(l.familyCode) : '';
    let itemName = '';
    let spec: ItemSpec | null = null;
    if (itemCode) {
        spec = await specOf(type, itemCode);
        if (!spec) throw new HttpError(400, `${at}the selected entry is not in the ${KIND_LABEL[type]}.`);
        if (spec.categoryCode !== categoryCode || spec.subcategoryCode !== subcategoryCode) throw new HttpError(400, `${at}the selected entry does not belong to that category and subcategory.`);
        familyCode = spec.familyCode;
        itemName = spec.name.slice(0, 160);
    }
    let familyName = '';
    if (familyCode) {
        const fam = tree?.families.find((f) => f.code === familyCode);
        if (!fam && !itemCode) throw new HttpError(400, `${at}the selected family does not belong to that subcategory.`);
        familyName = (fam?.name ?? '').slice(0, 160);
    }

    let attributes: Obj = {};
    let attributeView: Array<{ code: string; name: string; value: string; unit: string }> = [];
    if (source === 'catalogue' && isObj(l.attributes) && Object.keys(l.attributes).length) {
        if (!spec) throw new HttpError(400, `${at}choose the catalogue entry before filling in technical attributes.`);
        const read = readAttrs(spec, l.attributes);
        attributes = read.values;
        attributeView = read.view;
    }

    // Material picked from the stock of a warehouse (any warehouse of the organization).
    let wm: { warehouseId: string; warehouseCode: string; warehouseName: string; materialId: string; materialNumber: string; name: string } | null = null;
    if (source === 'warehouse' && (str(l.warehouseId) || str(l.materialId))) {
        const w = refs.warehouses.get(str(l.warehouseId));
        if (!w) throw new HttpError(400, `${at}choose a warehouse of your organization.`);
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(str(l.materialId))) throw new HttpError(400, `${at}choose the material.`);
        const [m, exts] = await Promise.all([getDoc(`organizations/${ctx.orgId}/materials/${str(l.materialId)}`), listDocs(`organizations/${ctx.orgId}/material_extensions`)]);
        if (!m || !isPublished(m) || !linkedTo(m, w.node.id, exts)) throw new HttpError(400, `${at}that material is not stocked in the chosen warehouse.`);
        const msub = str(m.data.subcategoryCode);
        if (msub && msub !== subcategoryCode) throw new HttpError(400, `${at}that material belongs to a different subcategory. Choose the matching subcategory or another material.`);
        wm = { warehouseId: w.node.id, warehouseCode: str(w.node.data.code), warehouseName: str(w.node.data.name), materialId: m.id, materialNumber: str(m.data.materialNumber), name: (str(m.data.name) || str(m.data.shortText)).slice(0, 160) };
    }
    const shownCode = source === 'warehouse' ? (wm?.materialNumber ?? '') : itemCode;
    const shownName = source === 'warehouse' ? (wm?.name ?? '') : itemName;

    return {
        no,
        type,
        source,
        categoryCode,
        categoryName: cat.name,
        subcategoryCode,
        subcategoryName: sub.name,
        familyCode,
        familyName,
        itemCode,
        itemName: shownName,
        master: shownCode ? { code: shownCode, name: shownName } : null,
        warehouseId: wm?.warehouseId ?? '',
        warehouseCode: wm?.warehouseCode ?? '',
        warehouseName: wm?.warehouseName ?? '',
        materialId: wm?.materialId ?? '',
        materialNumber: wm?.materialNumber ?? '',
        requirement,
        technical,
        attributes,
        attributeView,
        requiredAttrs: spec ? spec.attributes.filter((a) => a.required).map((a) => ({ code: a.code, name: a.name })) : [],
        quantity: Math.round(quantity * 1000) / 1000,
        unit: isService ? 'Service' : uom!.symbol,
        uomCategoryCode: uom?.categoryCode ?? '',
        uomCategoryName: uom?.category ?? '',
        uomCode: uom?.code ?? '',
        uomLabel: uom?.label ?? '',
        dateRequired,
        urgency,
        budget,
        costCenterId: cc.id,
        costCenterCode: str(cc.data.code),
        costCenterName: str(cc.data.name),
        glCode,
        glName: glOk.name,
    };
}

// ----- Writes -----

async function lock<T>(ctx: OrgContext, id: string, fn: () => Promise<T>): Promise<T> {
    const path = `organizations/${ctx.orgId}/procurement_requirement_locks/${id}`;
    if (!(await writeDoc(path, { by: ctx.uid, at: nowIso() }, { exists: false }))) throw new HttpError(409, 'This requirement is being updated by someone else. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}

async function load(ctx: OrgContext, body: Obj): Promise<{ id: string; doc: Doc }> {
    requireProcurement(ctx);
    const id = str(body.id);
    if (!ID.test(id)) throw new HttpError(404, 'Purchase requirement not found.');
    const doc = await getDoc(`${requirementsPath(ctx.orgId)}/${id}`);
    if (!doc || !visible(ctx, doc.data)) throw new HttpError(404, 'Purchase requirement not found.');
    // Someone who reaches a requirement only through procurement authority sees those of their buyer groups.
    const d = doc.data;
    const entitled = str(d.requesterUid) === ctx.uid || can(ctx, 'PRC.req.viewall') || approvedByMe(ctx, d) || (str(d.status) === 'pending_approval' && isManager(ctx, d));
    if (!entitled && !covers(await deskScope(ctx), objs(d.lines))) throw new HttpError(404, 'Purchase requirement not found.');
    return { id, doc };
}

function reasonOf(body: Obj): string {
    const reason = str(body.reason).trim();
    if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give a reason of 10 to 300 characters.');
    return reason;
}

/** Applies one transition under a lock: re-reads the document, checks it is still in the expected state, and appends to the history. */
async function transition(ctx: OrgContext, body: Obj, action: string, run: (d: Obj, id: string) => { patch: Obj; note: string; label: string }) {
    const { id } = await load(ctx, body);
    return lock(ctx, id, async () => {
        const path = `${requirementsPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Purchase requirement not found.');
        const d = fresh.data;
        const { patch, note, label } = run(d, id);
        const at = nowIso();
        const next: Obj = { ...d, ...patch, history: [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action, note, from: str(d.status), to: str(patch.status ?? d.status) }], updatedAt: at, version: (Number(d.version) || 1) + 1 };
        await writeDoc(path, next);
        await record(ctx, `org.procurement.req.${action}`, id, `${label}${note ? `. ${note}` : ''}`.slice(0, 400));
        return { ok: true, status: str(next.status) };
    });
}

interface Change {
    patch: Obj;
    label: string;
    note?: string;
    /** When set, the step is added to the visible history (draft edits are audited but not listed). */
    event?: string;
    result?: Obj;
}

/** A requester's change to an editable requirement, under a lock, audited. */
async function mutate(ctx: OrgContext, body: Obj, action: string, statuses: string[], run: (d: Obj, id: string) => Promise<Change>) {
    const { id, doc } = await load(ctx, body);
    if (str(doc.data.requesterUid) !== ctx.uid) throw new HttpError(403, 'Only the requester can change this requirement.');
    return lock(ctx, id, async () => {
        const path = `${requirementsPath(ctx.orgId)}/${id}`;
        const fresh = await getDoc(path);
        if (!fresh) throw new HttpError(404, 'Purchase requirement not found.');
        const d = fresh.data;
        if (!statuses.includes(str(d.status))) throw new HttpError(409, 'This requirement can no longer be changed in its current status.');
        const c = await run(d, id);
        const at = nowIso();
        const next: Obj = { ...d, ...c.patch, updatedAt: at, version: (Number(d.version) || 1) + 1 };
        if (c.event) next.history = [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: c.event, note: c.note ?? '', from: str(d.status), to: str(next.status) }];
        await writeDoc(path, next);
        await record(ctx, `org.procurement.req.${action}`, id, `${c.label}${c.note ? `. ${c.note}` : ''}`.slice(0, 400));
        return { ok: true, id, status: str(next.status), version: Number(next.version), ...(c.result ?? {}) };
    });
}

/** Maintenance sourcing uses the same item checks, manager routing and approval lifecycle. */
/** The open requirement already raised for this work-order task resource, whatever assessment revision raised it. */
async function openMaintenanceRequirement(orgId: string, source: Obj): Promise<Doc | null> {
    const same = (d: Obj) => {
        const m = isObj(d.maintenanceSource) ? d.maintenanceSource : {};
        return d.maintenanceSourceKey === source.key || (str(m.woCode) === str(source.woCode) && str(m.taskId) === str(source.taskId) && str(m.resourceId) === str(source.resourceId));
    };
    return (await listDocs(requirementsPath(orgId))).find((d) => same(d.data) && !['cancelled', 'rejected'].includes(str(d.data.status))) ?? null;
}

/**
 * Raises (or reuses) the procurement requirement for a work-order task resource. One open requirement per task
 * resource: repeated calls, reassessment and task edits return the same requirement instead of a duplicate. A
 * requirement raised automatically when a new material was approved is verified here by the planner, who then
 * becomes its requester; it then follows the standard manager approval (and chart of authority).
 */
export async function createMaintenanceRequirement(ctx: OrgContext, input: Obj, source: Obj) {
    requireProcurement(ctx);
    const existing = await openMaintenanceRequirement(ctx.orgId, source);
    if (existing) {
        if (str(existing.data.status) === 'unverified' && str(existing.data.source) === 'maintenance') await verifyMaintenanceRequest(ctx, existing, input);
        return existing.id;
    }
    const line = await prepareItem(ctx, input, 10);
    const missing = missingOf(line);
    if (missing.length) throw new HttpError(400, 'Complete procurement specifications: ' + missing.join(', '));
    const approver = await approverFor(ctx, ctx.me);
    if (approver.problem) throw new HttpError(409, approver.problem);
    const id = `REQ${String(await nextOrgCounter(ctx.orgId, 'requirementSeq')).padStart(9, '0')}`;
    const at = nowIso();
    if (!await writeDoc(`${requirementsPath(ctx.orgId)}/${id}`, {
        number:id,title:requiredMaintenanceTitle(source),status:'pending_approval',source:'maintenance',
        requesterUid:ctx.uid,requesterName:nameOfUser(ctx.me),requesterEmail:str(ctx.me.data.email),
        requesterPosition:approver.position,approverPosition:approver.managerPosition,approverTitle:approver.managerTitle,
        lines:[{...line,maintenanceSource:source}],attachments:[],attachmentSeq:0,
        maintenanceSourceKey:source.key,maintenanceSource:source,submittedAt:at,createdAt:at,updatedAt:at,version:1,
        history:[{at,by:ctx.uid,byName:nameOfUser(ctx.me),action:'submitted',note:'Maintenance sourcing; standard manager approval required',from:'',to:'pending_approval'}],
    }, {exists:false})) throw new HttpError(409, 'Purchase requirement number already exists.');
    await record(ctx,'org.procurement.req.submit',id,`Maintenance ${str(source.woCode)} / ${str(source.taskId)}`);
    return id;
}

/** Planner verification of a requirement raised automatically for a work-order task (material approved after free-text entry). */
async function verifyMaintenanceRequest(ctx: OrgContext, doc: Doc, input: Obj) {
    const d = doc.data;
    const cur = objs(d.lines)[0] ?? {};
    const line = await prepareItem(ctx, {
        ...cur, source: 'warehouse', costCenterId: str(cur.warehouseId), glCode: str(input.glCode),
        dateRequired: str(input.dateRequired) || str(cur.dateRequired), urgency: str(input.urgency) || str(cur.urgency) || 'medium',
        budget: input.budget ?? cur.budget ?? null,
    }, 10);
    if (str(line.materialId) !== str(cur.materialId) || str(line.warehouseId) !== str(cur.warehouseId)) throw new HttpError(409, 'The material or warehouse of this request cannot be changed.');
    const missing = missingOf(line);
    if (missing.length) throw new HttpError(400, `Complete before verifying: ${missing.join(', ')}.`);
    const approver = await approverFor(ctx, ctx.me);
    if (approver.problem) throw new HttpError(409, approver.problem);
    const at = nowIso();
    const ok = await writeDoc(`${requirementsPath(ctx.orgId)}/${doc.id}`, {
        ...d, status: 'pending_approval', requesterUid: ctx.uid, requesterName: nameOfUser(ctx.me), requesterEmail: str(ctx.me.data.email),
        requesterPosition: approver.position, approverPosition: approver.managerPosition, approverTitle: approver.managerTitle,
        lines: [{ ...line, maintenanceSource: cur.maintenanceSource ?? d.maintenanceSource }], submittedAt: at, verifiedBy: ctx.uid, verifiedByName: nameOfUser(ctx.me), verifiedAt: at,
        updatedAt: at, version: (Number(d.version) || 1) + 1,
        history: [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'verified', note: 'Verified by the maintenance planner', from: 'unverified', to: 'pending_approval' }],
    }, { updateTime: doc.updateTime });
    if (!ok) throw new HttpError(409, 'The requirement changed at the same time. Refresh and try again.');
    await record(ctx, 'org.procurement.req.verify', doc.id, `Maintenance ${str(object(d.maintenanceSource).woCode)}`);
}
const object = (v: unknown): Obj => (isObj(v) ? v : {});

/**
 * Pushes the need of a work-order task into Procurement Requirements once its new material is approved (free-text
 * or catalogue spare → material creation → approval). Raised as an automatic request waiting for the planner to
 * verify it (the planner becomes the requester), exactly like replenishment requests. Returns the requirement id.
 */
export async function raiseMaintenanceSupplyRequest(orgId: string, input: { material: Doc; warehouse: Doc | null; warehouseId: string; quantity: number; dateRequired: string; technical: string; source: Obj }): Promise<string> {
    const existing = await openMaintenanceRequirement(orgId, input.source);
    if (existing) return existing.id;
    const m = input.material.data;
    const name = (str(m.name) || str(m.shortText) || 'Material').slice(0, 160);
    const uom = PROCUREMENT_UNITS.find((u) => u.active && u.selectable && (u.code === str(m.uom) || u.symbol === str(m.uom)));
    const due = /^\d{4}-\d{2}-\d{2}$/.test(input.dateRequired) && input.dateRequired >= today() ? input.dateRequired : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const line = {
        no: 10, type: 'material', source: 'warehouse',
        categoryCode: str(m.categoryCode), subcategoryCode: str(m.subcategoryCode), familyCode: str(m.familyCode), itemCode: '', itemName: name,
        master: { code: str(m.materialNumber), name },
        warehouseId: input.warehouseId, warehouseCode: str(input.warehouse?.data.code), warehouseName: str(input.warehouse?.data.name),
        materialId: input.material.id, materialNumber: str(m.materialNumber),
        requirement: `${name} (${str(m.materialNumber)})`.slice(0, 300), technical: input.technical.slice(0, 2000),
        attributes: {}, attributeView: [], requiredAttrs: [],
        quantity: Math.round(input.quantity * 1000) / 1000,
        unit: uom?.symbol ?? str(m.uom), uomCode: uom?.code ?? '', uomLabel: uom?.label ?? '', uomCategoryCode: uom?.categoryCode ?? '', uomCategoryName: uom?.category ?? '',
        dateRequired: due, urgency: 'medium', budget: null,
        costCenterId: input.warehouseId, costCenterCode: str(input.warehouse?.data.code), costCenterName: str(input.warehouse?.data.name),
        glCode: '', glName: '', maintenanceSource: input.source,
    };
    const id = `REQ${String(await nextOrgCounter(orgId, 'requirementSeq')).padStart(9, '0')}`;
    const at = nowIso();
    const ok = await writeDoc(`${requirementsPath(orgId)}/${id}`, {
        number: id, title: requiredMaintenanceTitle(input.source), status: 'unverified', source: 'maintenance',
        requesterUid: 'maintenance', requesterName: 'Maintenance (automatic)', requesterEmail: '',
        lines: [line], attachments: [], attachmentSeq: 0, maintenanceSourceKey: input.source.key, maintenanceSource: input.source,
        createdAt: at, updatedAt: at, version: 1,
        history: [{ at, by: 'maintenance', byName: 'Maintenance', action: 'created', note: `Material ${str(m.materialNumber)} approved for ${str(input.source.woCode)}. Waiting for the maintenance planner to verify.`, from: '', to: 'unverified' }],
    }, { exists: false });
    if (!ok) throw new HttpError(409, 'Purchase requirement number already exists.');
    return id;
}
/** What a maintenance-raised requirement carries forward, with short-lived links to its photos and drawings. */
async function maintenanceSourceOut(orgId: string, d: Obj) {
    if (!isObj(d.maintenanceSource)) return null;
    const m = d.maintenanceSource;
    const prefix = `organizations/${orgId}/mnt/assessment_photos/`;
    const files = (Array.isArray(m.attachments) ? m.attachments.map(str) : []).filter((f) => f.startsWith(prefix) && /^[A-Za-z0-9_/-]+\.(jpg|png|pdf)$/.test(f)).slice(0, 10);
    return {
        woCode: str(m.woCode), taskId: str(m.taskId), description: str(m.description), quantity: Number(m.quantity) || 0,
        supplierCategory: str(m.supplierCategoryLabel) || str(m.supplierCategory), preferredVendor: isObj(m.preferredVendor) ? { id: str(m.preferredVendor.id), name: str(m.preferredVendor.name) } : null,
        supplierOnboarding: !!str(m.supplierOnboardingRequestId), executionDate: str(m.executionDate),
        planningGroup: isObj(m.planningGroup) ? str(m.planningGroup.label) : '', raisedBy: str(m.raisedBy),
        attachments: await Promise.all(files.map(async (f) => ({ kind: f.endsWith('.pdf') ? 'drawing' : 'photo', url: await signedUrl(f) }))),
    };
}
const requiredMaintenanceTitle = (s: Obj) => `${str(s.woCode)} · ${str(s.description)}`.slice(0,120);

// ----- Replenishment requests: verification by a planner -----

const RPL_KEYS = (orgId: string, key: string) => [`organizations/${orgId}/replenishment_keys/${key}`, `organizations/${orgId}/mrp_keys/${key}`];
const REPLENISHMENT_SOURCES = ['replenishment', 'mrp'];
const rplKeyOf = (d: Obj) => str(d.replenishmentKey) || str(d.mrpKey);
async function replenishmentRequest(ctx: OrgContext, id: string): Promise<Doc> {
    if (!ID.test(id)) throw new HttpError(404, 'Replenishment request not found.');
    const doc = await getDoc(`${requirementsPath(ctx.orgId)}/${id}`);
    if (!doc || !REPLENISHMENT_SOURCES.includes(str(doc.data.source))) throw new HttpError(404, 'Replenishment request not found.');
    if (str(doc.data.status) !== 'unverified') throw new HttpError(409, 'This replenishment request has already been verified, dismissed or cancelled.');
    const w = str(objs(doc.data.lines)[0]?.warehouseId);
    await requireAt(ctx, ['INV.replenishment.verify'], w, 'write', 'You can verify or dismiss replenishment requests only for warehouses where you hold INV.replenishment.verify.');
    return doc;
}

export const replenishmentVerificationRoutes = {
    // The planner checks quantity, date, urgency, unit and GL account; the request then follows the normal manager
    // approval (and chart of authority) as the planner's own requirement.
    'POST /api/org/inventory/replenishment/verify': [
        orgRoute('org.inventory.replenishment.verify', 'INV.replenishment.verify', async (ctx) => {
            requireProcurement(ctx);
            const id = str(ctx.body.id);
            await replenishmentRequest(ctx, id);
            return lock(ctx, id, async () => {
                const path = `${requirementsPath(ctx.orgId)}/${id}`;
                const doc = await replenishmentRequest(ctx, id);
                const d = doc.data;
                const cur = objs(d.lines)[0] ?? {};
                const quantity = ctx.body.quantity === undefined || ctx.body.quantity === '' ? Number(cur.quantity) : Number(String(ctx.body.quantity).replace(/,/g, ''));
                const changedQty = Number(cur.quantity) !== quantity;
                const reason = cleanText(ctx.body.reason);
                if (changedQty && (reason.length < 10 || reason.length > 300)) throw new HttpError(400, 'Give the reason for changing the planned quantity (10 to 300 characters).');
                const line = await prepareItem(ctx, { ...cur, source: 'warehouse', quantity, dateRequired: str(ctx.body.dateRequired) || str(cur.dateRequired), urgency: str(ctx.body.urgency) || str(cur.urgency), glCode: str(ctx.body.glCode), uomCode: str(ctx.body.uomCode) || str(cur.uomCode), costCenterId: str(cur.warehouseId) }, 10);
                if (str(line.materialId) !== str(cur.materialId) || str(line.warehouseId) !== str(cur.warehouseId)) throw new HttpError(409, 'The material or warehouse of a replenishment request cannot be changed.');
                const missing = missingOf(line);
                if (missing.length) throw new HttpError(400, `Complete before verifying: ${missing.join(', ')}.`);
                const approver = await approverFor(ctx, ctx.me);
                if (approver.problem) throw new HttpError(409, approver.problem);
                const at = nowIso();
                const note = `${changedQty ? `Quantity ${Number(cur.quantity)} → ${quantity}. ` : ''}${reason}`.trim() || 'Verified as planned';
                const ok = await writeDoc(path, {
                    ...d,
                    status: 'pending_approval',
                    requesterUid: ctx.uid,
                    requesterName: nameOfUser(ctx.me),
                    requesterEmail: str(ctx.me.data.email),
                    requesterPosition: approver.position,
                    approverPosition: approver.managerPosition,
                    approverTitle: approver.managerTitle,
                    source: 'replenishment',
                    lines: [{ ...line, replenishmentSource: { key: rplKeyOf(d), plannedQuantity: Number(cur.quantity) } }],
                    submittedAt: at,
                    verifiedBy: ctx.uid,
                    verifiedByName: nameOfUser(ctx.me),
                    verifiedAt: at,
                    updatedAt: at,
                    version: (Number(d.version) || 1) + 1,
                    history: [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'verified', note, from: 'unverified', to: 'pending_approval' }],
                }, { updateTime: doc.updateTime });
                if (!ok) throw new HttpError(409, 'Replenishment re-planned this request while you were verifying it. Refresh and check the quantity again.');
                for (const kp of RPL_KEYS(ctx.orgId, rplKeyOf(d))) {
                    const key = await getDoc(kp);
                    if (key && str(key.data.prId) === id) await deleteDoc(kp);
                }
                await record(ctx, 'org.inventory.replenishment.verify', id, `Replenishment request verified: ${str(line.materialNumber)} ${quantity} ${str(line.unit)} for ${str(line.warehouseCode)}; sent to ${approver.managerTitle} for approval. ${note}`.slice(0, 400));
                return { ok: true, id, status: 'pending_approval', approver: approver.managerTitle };
            });
        }),
    ],
    'POST /api/org/inventory/replenishment/dismiss': [
        orgRoute('org.inventory.replenishment.dismiss', 'INV.replenishment.verify', async (ctx) => {
            const id = str(ctx.body.id);
            const reason = reasonOf(ctx.body);
            await replenishmentRequest(ctx, id);
            return lock(ctx, id, async () => {
                const path = `${requirementsPath(ctx.orgId)}/${id}`;
                const doc = await replenishmentRequest(ctx, id);
                const d = doc.data;
                const cur = objs(d.lines)[0] ?? {};
                const at = nowIso();
                const ok = await writeDoc(path, { ...d, status: 'cancelled', cancelReason: `Dismissed by ${nameOfUser(ctx.me)}: ${reason}`, dismissedBy: ctx.uid, dismissedAt: at, updatedAt: at, version: (Number(d.version) || 1) + 1, history: [...history(d), { at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'dismissed', note: reason, from: 'unverified', to: 'cancelled' }] }, { updateTime: doc.updateTime });
                if (!ok) throw new HttpError(409, 'Replenishment re-planned this request at the same moment. Refresh and try again.');
                const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
                const [keyPath, legacyPath] = RPL_KEYS(ctx.orgId, rplKeyOf(d));
                await deleteDoc(legacyPath).catch(() => undefined);
                await writeDoc(keyPath, { materialId: str(cur.materialId), warehouseId: str(cur.warehouseId), prId: '', dismissedUntil: until, dismissedBy: ctx.uid, dismissedAt: at, reason });
                await record(ctx, 'org.inventory.replenishment.dismiss', id, `Replenishment request dismissed: ${str(cur.materialNumber)} for ${str(cur.warehouseCode)}. ${reason}`.slice(0, 400));
                return { ok: true, id, status: 'cancelled' };
            });
        }),
    ],
};

export const purchaseRequirementRoutes = {
    // Everything the screens need: adopted categories, units, cost centers in the person's scope, who will approve.
    'POST /api/org/procurement/req/options': [
        orgRoute('org.procurement.req.options', null, async (ctx) => {
            requireProcurement(ctx);
            const [adoptions, nodes, approver] = await Promise.all([
                Promise.all(LINE_KINDS.map(async (k) => ({ kind: k, label: KIND_LABEL[k], categories: (await adopted(ctx.orgId, k)).categories }))),
                listDocs(structureCol(ctx.orgId)),
                approverFor(ctx, ctx.me),
            ]);
            const allowed = isSuper(ctx) ? 'all' : await allowedNodeIds(ctx.orgId, ctx.me, true);
            const ccs = nodes.filter((n) => str(n.data.level) === 'cost_center' && str(n.data.status) !== 'inactive' && (allowed === 'all' || allowed.has(n.id)));
            const ccIds = new Set(ccs.map((n) => n.id));
            // The tree shows each usable cost center under its parents so people can type or browse to it.
            const byId = new Map<string, Doc>(nodes.map((n): [string, Doc] => [n.id, n]));
            const shown = new Map<string, Doc>();
            for (const c of ccs) {
                let cur: Doc | undefined = c;
                for (let g = 0; cur && !shown.has(cur.id) && g < 20; g++) {
                    shown.set(cur.id, cur);
                    cur = byId.get(str(cur.data.parentId));
                }
            }
            const [gl, existing] = await Promise.all([catalogSummary('gl_accounts'), listDocs(requirementsPath(ctx.orgId))]);
            // Remember the cost center and GL account of this person's most recently saved item.
            const lastReq = existing
                .filter((r) => str(r.data.requesterUid) === ctx.uid && objs(r.data.lines).length > 0)
                .sort((a, b) => str(b.data.updatedAt).localeCompare(str(a.data.updatedAt)))[0];
            const lastLine = lastReq ? objs(lastReq.data.lines).slice(-1)[0] : undefined;
            return {
                kinds: adoptions,
                units: uomGroups(),
                costCenterTree: Array.from(shown.values()).map((n) => ({ id: n.id, parentId: str(n.data.parentId), level: str(n.data.level), code: str(n.data.code) || n.id, name: str(n.data.name) || n.id, selectable: ccIds.has(n.id) })),
                glTree: gl ? gl.categories : [],
                last: lastLine && ccIds.has(str(lastLine.costCenterId)) ? { costCenterId: str(lastLine.costCenterId), glCode: str(lastLine.glCode), glName: str(lastLine.glName) } : null,
                currency: str(ctx.org.data.currencyCode),
                urgencies: URGENCY,
                policy: await buyingPolicy(ctx.orgId).then((p) => ({ directToCostCenters: p.directToCostCenters })),
                approver: { title: approver.managerTitle, position: approver.managerPosition, holders: approver.holders, problem: approver.problem },
                can: { approve: can(ctx, 'PRC.req.approve'), desk: can(ctx, 'PRC.req.acknowledge'), viewAll: can(ctx, 'PRC.req.viewall'), setup: can(ctx, 'PRC.setup.view') || can(ctx, 'PRC.setup.manage') },
                limits: { lines: MAX_LINES, files: MAX_FILES, fileKb: 450 },
            };
        }),
    ],

    // Family and catalogue entry dropdowns for the chosen category and subcategory.
    'POST /api/org/procurement/req/tree': [
        orgRoute('org.procurement.req.tree', null, async (ctx) => {
            requireProcurement(ctx);
            const kind = kindOf(ctx.body.kind);
            const categoryCode = str(ctx.body.categoryCode);
            const subcategoryCode = str(ctx.body.subcategoryCode);
            const current = await adopted(ctx.orgId, kind);
            const ok = current.categories.find((c) => c.code === categoryCode)?.subcategories.some((s) => s.code === subcategoryCode);
            if (!ok) throw new HttpError(400, 'That category and subcategory are not adopted by your organization.');
            const tree = await treeOf(kind, categoryCode, subcategoryCode);
            return tree ?? { families: [], items: [] };
        }),
    ],

    // The technical attributes of one catalogue entry (mandatory ones are flagged).
    'POST /api/org/procurement/req/spec': [
        orgRoute('org.procurement.req.spec', null, async (ctx) => {
            requireProcurement(ctx);
            const kind = kindOf(ctx.body.kind);
            const code = str(ctx.body.itemCode).slice(0, 80);
            const spec = code ? await specOf(kind, code) : null;
            if (!spec) throw new HttpError(404, `That entry is not in the ${KIND_LABEL[kind]}.`);
            const current = await adopted(ctx.orgId, kind);
            const isAdopted = !!current.categories.find((c) => c.code === spec.categoryCode)?.subcategories.some((s) => s.code === spec.subcategoryCode);
            return { ...spec, adopted: isAdopted };
        }),
    ],

    // Quick find in the catalogue by code or name. The screen then asks for the entry's attributes.
    'POST /api/org/procurement/req/masters': [
        orgRoute('org.procurement.req.masters', null, async (ctx) => {
            requireProcurement(ctx);
            const kind = kindOf(ctx.body.kind);
            const q = str(ctx.body.q).trim().toLowerCase().slice(0, 60);
            if (q.length < 2) return { items: [] };
            if (kind === 'asset') {
                const summary = await masterSummary('asset');
                if (!summary) throw new HttpError(409, `MEMS has not loaded the ${KIND_LABEL.asset} yet.`);
                return { items: summary.items.filter((i) => `${i.code} ${i.name}`.toLowerCase().includes(q)).slice(0, 30).map((i) => ({ code: i.code, name: i.name, family: '' })) };
            }
            return { items: await searchCatalog(kind === 'material' ? 'materials' : 'services', q, 30) };
        }),
    ],

    // Warehouses for a material item. deliver: where it may be delivered under the buying rules. browse: any warehouse, to pick stocked material from.
    'POST /api/org/procurement/req/warehouses': [
        orgRoute('org.procurement.req.warehouses', null, async (ctx) => {
            requireProcurement(ctx);
            const refs = await refsOf(ctx);
            const browse = str(ctx.body.mode) === 'browse';
            const categoryCode = str(ctx.body.categoryCode);
            const items = Array.from(refs.warehouses.values())
                .map((w) => ({ id: w.node.id, code: str(w.node.data.code) || w.node.id, name: str(w.node.data.name) || w.node.id, matches: !!categoryCode && w.categories.includes(categoryCode) }))
                .filter((w) => browse || refs.policy.directToCostCenters || w.matches)
                .sort((a, b) => Number(b.matches) - Number(a.matches) || a.name.localeCompare(b.name));
            return { items, directToCostCenters: refs.policy.directToCostCenters };
        }),
    ],

    // Materials stocked in one warehouse, found by number or name.
    'POST /api/org/procurement/req/warehouse/materials': [
        orgRoute('org.procurement.req.warehouse.materials', null, async (ctx) => {
            requireProcurement(ctx);
            const root = `organizations/${ctx.orgId}`;
            const warehouseId = str(ctx.body.warehouseId);
            const subcategoryCode = str(ctx.body.subcategoryCode);
            const q = str(ctx.body.q).trim().toLowerCase().slice(0, 60);
            if (!/^[A-Za-z0-9_-]{1,80}$/.test(warehouseId)) throw new HttpError(400, 'Choose a warehouse.');
            if (q.length < 2) return { items: [] };
            const [wh, materials, exts] = await Promise.all([getDoc(`${root}/warehouses/${warehouseId}`), listDocs(`${root}/materials`), listDocs(`${root}/material_extensions`)]);
            if (!wh) throw new HttpError(404, 'Warehouse not found.');
            const items = materials
                .filter((m) => isPublished(m) && linkedTo(m, warehouseId, exts))
                .filter((m) => !subcategoryCode || !str(m.data.subcategoryCode) || str(m.data.subcategoryCode) === subcategoryCode)
                .filter((m) => `${str(m.data.materialNumber)} ${str(m.data.name)} ${str(m.data.shortText)}`.toLowerCase().includes(q))
                .slice(0, 40)
                .map((m) => ({ code: m.id, name: `${str(m.data.name) || str(m.data.shortText)} (${str(m.data.materialNumber)})` }));
            return { items };
        }),
    ],

    'POST /api/org/procurement/req/gl': [
        orgRoute('org.procurement.req.gl', null, async (ctx) => {
            requireProcurement(ctx);
            const q = str(ctx.body.q).trim().toLowerCase().slice(0, 60);
            // Only accounts approved in the chart of the chosen cost center's legal entity (and its account list). Type to search or browse.
            const ccId = str(ctx.body.costCenterId);
            if (!ccId) return { items: [], tree: [], needCostCenter: true };
            const { accounts } = await choosableAccounts(ctx.orgId, ccId);
            const cat = str(ctx.body.categoryCode).slice(0, 60);
            const sub = str(ctx.body.subcategoryCode).slice(0, 60);
            if (ctx.body.tree === true) {
                const tree = new Map<string, { code: string; name: string; subs: Map<string, string> }>();
                for (const a of accounts) {
                    const t = tree.get(a.classCode) ?? { code: a.classCode, name: a.className || a.classCode, subs: new Map<string, string>() };
                    t.subs.set(a.categoryCode, a.categoryName || a.categoryCode);
                    tree.set(a.classCode, t);
                }
                return { items: [], tree: Array.from(tree.values()).map((t) => ({ code: t.code, name: t.name, subcategories: Array.from(t.subs.entries()).map(([code, name]) => ({ code, name })) })) };
            }
            if (q.length < 2 && !(cat && sub)) return { items: [] };
            return { items: accounts.filter((a) => (!cat || a.classCode === cat) && (!sub || a.categoryCode === sub) && (q.length < 2 || `${a.code} ${a.name}`.toLowerCase().includes(q))).slice(0, 100).map((a) => ({ code: a.code, name: a.name })) };
        }),
    ],

    // Starts a requirement as a private draft. The REQ number is allocated now.
    'POST /api/org/procurement/req/draft': [
        orgRoute('org.procurement.req.draft', null, async (ctx) => {
            requireProcurement(ctx);
            const title = cleanText(ctx.body.title).replace(/\n/g, ' ');
            if (title.length < 3 || title.length > 120) throw new HttpError(400, 'Give the requirement a title of 3 to 120 characters.');
            const mine = (await listDocs(requirementsPath(ctx.orgId))).filter((r) => str(r.data.requesterUid) === ctx.uid && str(r.data.status) === 'draft');
            if (mine.length >= MAX_DRAFTS) throw new HttpError(409, `You already have ${MAX_DRAFTS} drafts. Submit or discard some before starting another.`);
            const n = await nextOrgCounter(ctx.orgId, 'requirementSeq');
            if (n > 999_999_999) throw new HttpError(500, 'The requirement number range is exhausted.');
            const id = `REQ${String(n).padStart(9, '0')}`;
            const at = nowIso();
            const data = {
                number: id,
                title,
                status: 'draft',
                requesterUid: ctx.uid,
                requesterName: nameOfUser(ctx.me),
                requesterEmail: str(ctx.me.data.email),
                lines: [],
                attachments: [],
                attachmentSeq: 0,
                history: [{ at, by: ctx.uid, byName: nameOfUser(ctx.me), action: 'drafted', note: '', from: '', to: 'draft' }],
                createdAt: at,
                updatedAt: at,
                version: 1,
            };
            if (!(await writeDoc(`${requirementsPath(ctx.orgId)}/${id}`, data, { exists: false }))) throw new HttpError(409, 'That requirement number is already in use. Please try again.');
            await record(ctx, 'org.procurement.req.draft', id, title);
            return { ok: true, id };
        }),
    ],

    'POST /api/org/procurement/req/header/save': [
        orgRoute('org.procurement.req.header.save', null, async (ctx) => {
            const title = cleanText(ctx.body.title).replace(/\n/g, ' ');
            if (title.length < 3 || title.length > 120) throw new HttpError(400, 'Give the requirement a title of 3 to 120 characters.');
            return mutate(ctx, ctx.body, 'header.save', EDITABLE, async () => ({ patch: { title }, label: 'Title changed', note: title }));
        }),
    ],

    // Saves one item on its own. A new item gets the next number (10, 20, 30 ...); an existing one is replaced.
    'POST /api/org/procurement/req/item/save': [
        orgRoute('org.procurement.req.item.save', null, async (ctx) =>
            mutate(ctx, ctx.body, 'item.save', EDITABLE, async (d) => {
                const lines = objs(d.lines);
                const given = Number(ctx.body.no) || 0;
                let no = given;
                if (given) {
                    if (!lines.some((l) => Number(l.no) === given)) throw new HttpError(404, 'That item no longer exists.');
                } else {
                    if (lines.length >= MAX_LINES) throw new HttpError(400, `A requirement can have up to ${MAX_LINES} items.`);
                    const top = lines.reduce((m, l) => Math.max(m, Number(l.no) || 0), 0);
                    no = Math.floor(top / ITEM_STEP) * ITEM_STEP + ITEM_STEP;
                }
                const line = await prepareItem(ctx, ctx.body, no);
                const previous=lines.find(l=>Number(l.no)===given);
                if(isObj(previous?.maintenanceSource)){const keys=['type','source','requirement','technical','categoryCode','subcategoryCode','familyCode','materialId','warehouseId','quantity','uomCode','attributes'];for(const key of keys)if(JSON.stringify(previous[key]??null)!==JSON.stringify(line[key]??null))throw new HttpError(409,'Maintenance technical scope must be changed by controlled reassessment of the originating task.');line.maintenanceSource=previous.maintenanceSource;}
                const next = [...lines.filter((l) => Number(l.no) !== no), line].sort((a, b) => Number(a.no) - Number(b.no));
                return { patch: { lines: next }, label: `${given ? 'Item changed' : 'Item added'}: ${no}`, note: str(line.requirement).slice(0, 100), result: { no, missing: missingOf(line) } };
            })
        ),
    ],

    'POST /api/org/procurement/req/item/remove': [
        orgRoute('org.procurement.req.item.remove', null, async (ctx) =>
            mutate(ctx, ctx.body, 'item.remove', EDITABLE, async (d, id) => {
                const no = Number(ctx.body.no) || 0;
                const lines = objs(d.lines);
                if (!lines.some((l) => Number(l.no) === no)) throw new HttpError(404, 'That item no longer exists.');
                const gone = objs(d.attachments).filter((a) => Number(a.lineNo) === no);
                for (const a of gone) await deleteDoc(`${requirementsPath(ctx.orgId)}/${id}/attachments/${str(a.id)}`);
                return {
                    patch: { lines: lines.filter((l) => Number(l.no) !== no), attachments: objs(d.attachments).filter((a) => Number(a.lineNo) !== no) },
                    label: `Item removed: ${no}`,
                    note: gone.length ? `${gone.length} attachment(s) removed with it` : '',
                };
            })
        ),
    ],

    'POST /api/org/procurement/req/attachment/add': [
        orgRoute('org.procurement.req.attachment.add', null, async (ctx) => {
            const type = str(ctx.body.type);
            const data = str(ctx.body.data);
            const lineNo = ctx.body.lineNo === null || ctx.body.lineNo === undefined || ctx.body.lineNo === '' ? null : Number(ctx.body.lineNo);
            if (!FILE_TYPES.includes(type) || !data.startsWith(`data:${type};base64,`) || !/^data:(application\/pdf|image\/jpeg|image\/png);base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > MAX_FILE_CHARS)
                throw new HttpError(400, 'Attachments must be PDF, JPEG or PNG files of up to 450 KB each.');
            const name = str(ctx.body.name).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120) || 'attachment';
            return mutate(ctx, ctx.body, 'attachment.add', EDITABLE, async (d, id) => {
                const kept = objs(d.attachments);
                if (kept.length >= MAX_FILES) throw new HttpError(400, `Attach up to ${MAX_FILES} files.`);
                if (lineNo !== null && !objs(d.lines).some((l) => Number(l.no) === lineNo)) throw new HttpError(400, 'Save the item before attaching a file to it.');
                const seq = (Number(d.attachmentSeq) || 0) + 1;
                const attId = `${id}_${seq}`;
                const at = nowIso();
                await writeDoc(`${requirementsPath(ctx.orgId)}/${id}/attachments/${attId}`, { name, type, data, lineNo, uploadedBy: ctx.uid, uploadedAt: at }, { exists: false });
                const meta = { id: attId, name, type, lineNo, size: Math.round((data.length * 3) / 4), uploadedAt: at, uploadedBy: nameOfUser(ctx.me) };
                return { patch: { attachments: [...kept, meta], attachmentSeq: seq }, label: 'Attachment added', note: `${name}${lineNo === null ? '' : ` (item ${lineNo})`}` };
            });
        }),
    ],

    'POST /api/org/procurement/req/attachment/remove': [
        orgRoute('org.procurement.req.attachment.remove', null, async (ctx) =>
            mutate(ctx, ctx.body, 'attachment.remove', EDITABLE, async (d, id) => {
                const attId = str(ctx.body.attId);
                const found = objs(d.attachments).find((a) => str(a.id) === attId);
                if (!found) throw new HttpError(404, 'Attachment not found.');
                await deleteDoc(`${requirementsPath(ctx.orgId)}/${id}/attachments/${attId}`);
                return { patch: { attachments: objs(d.attachments).filter((a) => str(a.id) !== attId) }, label: 'Attachment removed', note: str(found.name) };
            })
        ),
    ],

    // Sends the requirement to the immediate manager once every item is complete.
    'POST /api/org/procurement/req/submit': [
        orgRoute('org.procurement.req.submit', null, async (ctx) => {
            requireProcurement(ctx);
            if (ctx.body.acknowledgeNoQuotes !== true) throw new HttpError(400, 'Confirm that no quotations are included.');
            const approver = await approverFor(ctx, ctx.me);
            if (approver.problem) throw new HttpError(409, approver.problem);
            return mutate(ctx, ctx.body, 'submit', EDITABLE, async (d) => {
                const lines = objs(d.lines);
                if (!lines.length) throw new HttpError(400, 'Add at least one item before submitting.');
                const gaps = lines.map((l) => ({ no: Number(l.no), missing: missingOf(l) })).filter((x) => x.missing.length);
                if (gaps.length)
                    throw new HttpError(400, `Complete these items first: ${gaps.slice(0, 5).map((x) => `item ${x.no} needs ${x.missing.join(', ')}`).join('; ')}${gaps.length > 5 ? ` and ${gaps.length - 5} more` : ''}.`);
                const at = nowIso();
                return {
                    patch: {
                        status: 'pending_approval',
                        requesterPosition: approver.position,
                        approverPosition: approver.managerPosition,
                        approverTitle: approver.managerTitle,
                        submittedAt: at,
                    },
                    event: str(d.status) === 'draft' ? 'submitted' : 'resubmitted',
                    label: `Submitted with ${lines.length} item(s). Approver: ${approver.managerTitle}`,
                };
            });
        }),
    ],

    // A draft that is no longer wanted. The number stays on record as cancelled.
    'POST /api/org/procurement/req/discard': [
        orgRoute('org.procurement.req.discard', null, async (ctx) =>
            mutate(ctx, ctx.body, 'discard', ['draft'], async (d, id) => {
                for (const a of objs(d.attachments)) await deleteDoc(`${requirementsPath(ctx.orgId)}/${id}/attachments/${str(a.id)}`);
                return { patch: { status: 'cancelled', cancelReason: 'Draft discarded by the requester', lines: [], attachments: [] }, event: 'discarded', label: 'Draft discarded' };
            })
        ),
    ],

    'POST /api/org/procurement/req/list': [
        orgRoute('org.procurement.req.list', null, async (ctx) => {
            requireProcurement(ctx);
            const docs = await listDocs(requirementsPath(ctx.orgId));
            const mine = docs.filter((r) => str(r.data.requesterUid) === ctx.uid);
            const others = docs.filter((r) => str(r.data.status) !== 'draft'); // drafts are private to their requester
            const scope = await deskScope(ctx);
            const views: Record<string, Doc[]> = {
                mine: mine.filter((r) => OPEN_STATUSES.includes(str(r.data.status))),
                all: mine,
                approvals: others.filter((r) => str(r.data.status) === 'pending_approval' && isManager(ctx, r.data)),
                approved: others.filter((r) => approvedByMe(ctx, r.data) && str(r.data.status) !== 'converted' && str(r.data.requesterUid) !== ctx.uid),
                desk: can(ctx, 'PRC.req.acknowledge') ? others.filter((r) => ['approved', 'acknowledged'].includes(str(r.data.status)) && str(r.data.requesterUid) !== ctx.uid && covers(scope, objs(r.data.lines))) : [],
                org: can(ctx, 'PRC.req.viewall') ? others : [],
            };
            const view = str(ctx.body.view) || 'mine';
            if (!(view in views)) throw new HttpError(400, 'Choose a view.');
            return {
                rows: views[view].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 1000).map((r) => row(r.data, r.id)),
                counts: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.length])),
            };
        }),
    ],

    'POST /api/org/procurement/req/get': [
        orgRoute('org.procurement.req.get', null, async (ctx) => {
            requireProcurement(ctx);
            const { id, doc } = await load(ctx, ctx.body);
            const d = doc.data;
            const f = flags(ctx, d);
            return {
                ...row(d, id),
                lines: objs(d.lines)
                    .map((l): Obj => ({ ...l, urgency: urgencyOf(str(l.urgency)), ...(f.edit ? { missing: missingOf(l), complete: missingOf(l).length === 0 } : {}) }))
                    .sort((a, b) => Number(a.no) - Number(b.no)),
                attachments: objs(d.attachments).map((a) => ({ id: str(a.id), name: str(a.name), type: str(a.type), lineNo: a.lineNo ?? null, size: Number(a.size) || 0, uploadedAt: str(a.uploadedAt), uploadedBy: str(a.uploadedBy) })),
                history: history(d).map((h) => ({ at: str(h.at), byName: str(h.byName), action: str(h.action), note: str(h.note), from: str(h.from), to: str(h.to) })),
                approverTitle: str(d.approverTitle),
                returnReason: str(d.status) === 'returned_user' ? str(d.returnReason) : '',
                maintenance: await maintenanceSourceOut(ctx.orgId, d),
                currency: str(ctx.org.data.currencyCode),
                version: Number(d.version) || 1,
                can: f,
                mine: str(d.requesterUid) === ctx.uid,
            };
        }),
    ],

    'POST /api/org/procurement/req/attachment': [
        orgRoute('org.procurement.req.attachment', null, async (ctx) => {
            requireProcurement(ctx);
            const { id, doc } = await load(ctx, ctx.body);
            const attId = str(ctx.body.attId);
            if (!objs(doc.data.attachments).some((a) => str(a.id) === attId)) throw new HttpError(404, 'Attachment not found.');
            const file = await getDoc(`${requirementsPath(ctx.orgId)}/${id}/attachments/${attId}`);
            if (!file) throw new HttpError(404, 'Attachment not found.');
            await record(ctx, 'org.procurement.req.attachment.view', id, str(file.data.name));
            return { name: str(file.data.name), type: str(file.data.type), data: str(file.data.data) };
        }),
    ],

    'POST /api/org/procurement/req/approve': [
        orgRoute('org.procurement.req.approve', 'PRC.req.approve', async (ctx) =>
            transition(ctx, ctx.body, 'approved', (d) => {
                if (str(d.status) !== 'pending_approval') throw new HttpError(409, 'This requirement is not waiting for approval.');
                if (!isManager(ctx, d)) throw new HttpError(403, 'Only the immediate manager of the requester can approve this requirement.');
                return { patch: { status: 'approved', approvedBy: ctx.uid, approvedAt: nowIso() }, note: '', label: 'Approved by the immediate manager' };
            })
        ),
    ],

    'POST /api/org/procurement/req/reject': [
        orgRoute('org.procurement.req.reject', 'PRC.req.approve', async (ctx) => {
            const reason = reasonOf(ctx.body);
            return transition(ctx, ctx.body, 'rejected', (d) => {
                if (str(d.status) !== 'pending_approval') throw new HttpError(409, 'This requirement is not waiting for approval.');
                if (!isManager(ctx, d)) throw new HttpError(403, 'Only the immediate manager of the requester can reject this requirement.');
                return { patch: { status: 'rejected', rejectedBy: ctx.uid, rejectedAt: nowIso(), rejectReason: reason }, note: reason, label: 'Rejected by the immediate manager' };
            });
        }),
    ],

    // Manager (to the requester) or procurement (back to the manager, or to the requester).
    'POST /api/org/procurement/req/return': [
        orgRoute('org.procurement.req.return', null, async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            const to = str(ctx.body.to) || 'user';
            if (!['user', 'manager'].includes(to)) throw new HttpError(400, 'Choose who it goes back to.');
            return transition(ctx, ctx.body, 'returned', (d) => {
                const status = str(d.status);
                const f = flags(ctx, d);
                if (status === 'pending_approval') {
                    if (!f.returnManager) throw new HttpError(403, 'Only the immediate manager can return a requirement that is waiting for approval.');
                    if (to !== 'user') throw new HttpError(400, 'A manager returns a requirement to the requester.');
                    return { patch: { status: 'returned_user', returnedBy: 'manager', returnReason: reason }, note: `To requester: ${reason}`, label: 'Returned by the manager' };
                }
                if (!f.returnDesk) throw new HttpError(403, 'Only procurement personnel (who did not approve it) can return this requirement.');
                if (to === 'manager') return { patch: { status: 'pending_approval', approvedBy: '', approvedAt: '', returnedBy: 'procurement', returnReason: reason }, note: `To manager: ${reason}`, label: 'Returned by procurement to the manager' };
                return { patch: { status: 'returned_user', approvedBy: '', approvedAt: '', returnedBy: 'procurement', returnReason: reason }, note: `To requester: ${reason}`, label: 'Returned by procurement to the requester' };
            });
        }),
    ],

    'POST /api/org/procurement/req/acknowledge': [
        orgRoute('org.procurement.req.acknowledge', 'PRC.req.acknowledge', async (ctx) => {
            const scope = await deskScope(ctx);
            return transition(ctx, ctx.body, 'acknowledged', (d) => {
                if (str(d.status) !== 'approved') throw new HttpError(409, 'Only an approved requirement can be acknowledged.');
                if (!covers(scope, objs(d.lines))) throw new HttpError(403, 'This requirement belongs to another buyer group.');
                if (str(d.requesterUid) === ctx.uid) throw new HttpError(403, 'You cannot acknowledge your own requirement.');
                if (approvedByMe(ctx, d)) throw new HttpError(403, 'You approved this requirement, so you cannot also acknowledge it.');
                return { patch: { status: 'acknowledged', acknowledgedBy: ctx.uid, acknowledgedAt: nowIso() }, note: '', label: 'Acknowledged: offline quotation started' };
            });
        }),
    ],

    'POST /api/org/procurement/req/cancel': [
        orgRoute('org.procurement.req.cancel', null, async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            return transition(ctx, ctx.body, 'cancelled', (d) => {
                if (str(d.requesterUid) !== ctx.uid) throw new HttpError(403, 'Only the requester can cancel this requirement.');
                if (!['pending_approval', 'returned_user'].includes(str(d.status))) throw new HttpError(409, 'It is too late to cancel: procurement has already received this requirement. Ask procurement to return it.');
                return { patch: { status: 'cancelled', cancelReason: reason }, note: reason, label: 'Cancelled by the requester' };
            });
        }),
    ],
};

