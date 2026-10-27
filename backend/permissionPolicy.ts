import { MNT_ACTIVITIES } from './maintenanceActivities';
import { expandPermissions, hasPerm } from './guards';
import { HttpError } from './core';

// ---------------------------------------------------------------------------
// Permission policy: the single source of truth for what a security role can hold.
//
// A permission is only offered when code enforces it. Modules with no screens or actions yet offer nothing,
// so an administrator can never hand out a right that silently does nothing. When a feature ships, its
// permissions are added here (and nowhere else).
//
// Segregation of duties (SoD): some rights must not sit together. The server also enforces them per person at
// run time (a counter can never verify, approve or post the same stock take); the role editor warns here, and a
// role that combines them can only be saved with an acknowledged reason, which goes to the audit trail.
// ---------------------------------------------------------------------------

export interface PermDef {
    key: string;
    label: string;
    /** Approve, post, delete, configure or administer: shown with a warning and audited when granted. */
    sensitive?: boolean;
}

export interface PermGroup {
    module: string;
    name: string;
    permissions: PermDef[];
}

const p = (key: string, label: string, sensitive = false): PermDef => (sensitive ? { key, label, sensitive } : { key, label });

export const ADM_PERMISSIONS: PermDef[] = [
    p('ADM.users', 'Manage users', true),
    p('ADM.structure', 'Manage organization design and job roles', true),
    p('ADM.modules', 'Manage modules and subscription', true),
    p('ADM.roles', 'Manage security roles and permissions', true),
    p('ADM.audit', 'View audit trail'),
    p('ADM.workflows', 'Manage workflows and approvals', true),
    p('ADM.settings', 'Manage organization settings and branding', true),
    p('ADM.document_registry', 'Register and view controlled document drafts', true),
    p('ADM.document_config', 'Configure organization document controls', true),
    p('ADM.document_review', 'Independently review or return document drafts', true),
    p('ADM.document_publish', 'Publish independently approved, verified document revisions', true),
    p('ADM.scope.site', 'Grant view access beyond assigned site', true),
    p('ADM.scope.country', 'Grant country-wide view access', true),
    p('ADM.scope.business', 'Grant whole-organization view access', true),
    p('ADM.billing', 'Manage subscription and payments', true),
];

const STOCK_TAKE: PermDef[] = [
    p('INV_ST_001', 'Stock take: view configurations'),
    p('INV_ST_002', 'Stock take: create configuration'),
    p('INV_ST_003', 'Stock take: edit configuration'),
    p('INV_ST_005', 'Stock take: delete configuration', true),
    p('INV_ST_007', 'Stock take: view sessions'),
    p('INV_ST_008', 'Stock take: create session'),
    p('INV_ST_010', 'Stock take: confirm PI printing'),
    p('INV_ST_011', 'Stock take: view PI documents'),
    p('INV_ST_012', 'Stock take: disregard session', true),
    p('INV_ST_013', 'Stock take: close posted session'),
    p('INV_ST_016', 'Stock take: edit counts'),
    p('INV_ST_017', 'Stock take: enter and submit counts'),
    p('INV_ST_020', 'Stock take: verify counts', true),
    p('INV_ST_022', 'Stock take: request recount'),
    p('INV_ST_024', 'Stock take: refresh stock baseline'),
    p('INV_ST_026', 'Stock take: initiate posting'),
    p('INV_ST_027', 'Stock take: approve posting', true),
    p('INV_ST_028', 'Stock take: post and reconcile', true),
];

const warehouse = (code: string): PermDef[] => [
    p(`${code}.warehouse.view`, 'Warehouse: view setup and physical bins'),
    p(`${code}.warehouse.configure`, 'Warehouse: configure layout and storage locations', true),
    p(`${code}.cluster.create`, 'Warehouse: create storage clusters and allocate bins'),
    p(`${code}.cluster.delete`, 'Warehouse: remove storage clusters', true),
    p(`${code}.bin.view`, 'Warehouse: view bin and material details'),
    p(`${code}.bin.history`, 'Warehouse: view bin event history'),
    p(`${code}.bin.link`, 'Warehouse: link a material to a bin'),
    p(`${code}.bin.unlink`, 'Warehouse: delink a material from a bin'),
];

const SENSITIVE_MNT = new Set(['MNT.WO.safety', 'MNT.WO.release', 'MNT.WO.verify', 'MNT.WO.close', 'MNT.WO.cancel', 'MNT.WO.reopen', 'MNT.WR.decline', 'MNT.WR.convert', 'MNT.assessment.review']);

/** Permissions of every module that has working screens or actions. Nothing else is ever offered. */
export const BUILT_PERMISSIONS: Record<string, PermDef[]> = {
    HRM: [p('HRM.shell.view', 'HR: open HR submodules and employee portal (record access separately controlled)'), p('HRM.employee.site.read', 'HR: read minimum employee directory within verified assigned site', true), p('HRM.manager.hierarchy.read', 'Manager: read minimum profiles under verified managed hierarchy', true), p('HRM.skills.manage', 'HR: manage organization skills master and skill categories', true), p('HRM.rules.manage', 'HR: configure protected portal privacy and visibility rules', true), p('HRM.rules.approve', 'Privacy Officer: independently approve HR access rule changes', true), p('HRM.records.verify', 'HR: independently verify employee qualification evidence, with scope checks and no self-approval', true), p('HRM.compensation.approve', 'HR: approve activation of compensation, benefits and leave-entitlement policy (Chart of Authority applies)', true)],
    INV: [p('INV.view', 'Inventory: view'), p('INV.edit', 'Inventory: maintain materials and settings'), p('INV.issue', 'Inventory: issue stock to a cost center or work order (posts to the ledger when finance is live)', true), p('INV.replenishment.view', 'Replenishment: view requests, signals and the run log'), p('INV.replenishment.run', 'Replenishment: run planning on demand for a warehouse or material'), p('INV.replenishment.verify', 'Replenishment: verify purchase requests (becomes the requester, manager approves), dismiss them, acknowledge signals to suppliers and owners', true), ...warehouse('INV'), ...STOCK_TAKE],
    WHS: [p('WHS.view', 'Warehousing: view'), ...warehouse('WHS')],
    MNT: MNT_ACTIVITIES.map((a) => p(a.key, a.label, SENSITIVE_MNT.has(a.key))),
    AST: [
        p('AST.view', 'Assets: view'),
        p('AST.create', 'Assets: create'),
        p('AST.edit', 'Assets: edit'),
        p('AST.approve', 'Assets: approve changes', true),
        p('AST.delete', 'Assets: delete', true),
        p('AST.admin', 'Assets: administer', true),
        p('AST.catalog.view', 'Asset catalog: view'),
        p('AST.utilities.view', 'Equipment utilities: view'),
        p('AST.utilities.edit', 'Equipment utilities: maintain'),
    ],
    PRC: [
        p('PRC.view', 'Procurement: view'),
        p('PRC.create', 'Procurement: create'),
        p('PRC.edit', 'Procurement: edit'),
        p('PRC.admin', 'Procurement: administer', true),
        p('PRC.materials.manage', 'Material catalog: manage', true),
        p('PRC.services.manage', 'Service catalog: manage', true),
        p('PRC.setup.view', 'Procurement setup and chart of authority: view'),
        p('PRC.setup.manage', 'Procurement setup: adopt categories and subcategories', true),
        p('PRC.authority.manage', 'Chart of authority: change amount limits, sourcing methods and approval levels', true),
        p('PRC.req.approve', 'Purchase requirements: approve, reject or return as immediate manager', true),
        p('PRC.req.acknowledge', 'Purchase requirements: acknowledge and return as procurement', true),
        p('PRC.req.viewall', 'Purchase requirements: view all'),
        p('PRC.vendors.view', 'Vendors: view approved vendors'),
        p('PRC.vendors.manage', 'Vendors: register, maintain and submit for approval', true),
        p('PRC.vendors.approve', 'Vendors: approve, return, reject, suspend and reinstate', true),
        p('PRC.vendors.override', 'Vendors: grant a temporary override for a required document that cannot be uploaded', true),
        p('PRC.quotes.view', 'Quotations: view'),
        p('PRC.quotes.manage', 'Quotations: review, invite vendors, record quotes, recommend', true),
        p('PRC.quotes.evaluate', 'Quotations: give the technical view and sign off the evaluation', true),
        p('PRC.buyers.manage', 'Buyer groups: create groups, allocate subcategories, add people, switch the function on or off', true),
        p('PRC.prq.view', 'Purchase requisitions: view'),
        p('PRC.prq.manage', 'Purchase requisitions: create from a recommended quotation, send back, cancel', true),
        p('PRC.prq.approve', 'Purchase requisitions: reserved (the requester confirms)', true),
        p('PRC.po.view', 'Purchase orders: view'),
        p('PRC.po.manage', 'Purchase orders: create, consolidate, validate, confirm, send', true),
        p('PRC.po.approve', 'Purchase orders: approve, return or reject at the level the chart of authority assigns', true),
        p('PRC.po.receive', 'Purchase orders: record deliveries', true),
        p('PRC.vendors.sla', 'Vendors: record and end service level agreements', true),
        p('PRC.po.reassign', 'Purchase orders: take over and reassign an order when its owner is away', true),
        p('PRC.po.viewquotes', 'Purchase orders: see the quotes and quotation analysis behind any order you can open'),
        p('PRC.service.accept', 'Services: accept or reject rendered services as the cost center owner (reconciles and posts the journal)', true),
        p('PRC.journal.view', 'Journals: view every journal posted from procurement, with its source'),
    ],
    SAF: [
        p('SAF.view', 'Safety: view'),
        p('SAF.edit', 'Safety: edit'),
        p('SAF.admin', 'Safety: administer', true),
        p('SAF.risk.view', 'Risk assessments: view (activity and stored energy)'),
        p('SAF.risk.assess', 'Risk assessments: assess hazards, impacts and controls'),
        p('SAF.configure', 'Risk matrix: configure for the whole organization (direct role only)', true),
    ],
    FIN: [
        p('FIN.view', 'Finance: view (the legal entities you work in)'),
        p('FIN.gl.view', 'GL account master: view'),
        p('FIN.gl.manage', 'Chart of accounts: propose adopting, blocking or removing accounts', true),
        p('FIN.gl.approve', 'Chart of accounts: approve changes', true),
        p('FIN.setup.manage', 'Finance setup: propose calendar rules, finance chart of authority and legal entity finance status', true),
        p('FIN.setup.approve', 'Finance setup: approve setup and legal entity status (go-live, block, close)', true),
        p('FIN.calendar.manage', 'Financial calendar: add years, propose initialising years and opening periods', true),
        p('FIN.calendar.approve', 'Financial calendar: approve year initialisation and opening or reopening periods', true),
        p('FIN.mapping.manage', 'GL account mapping: propose the account every transaction posts to', true),
        p('FIN.mapping.approve', 'GL account mapping: approve', true),
        p('FIN.tax.manage', 'Taxes: propose regimes and rates', true),
        p('FIN.tax.approve', 'Taxes: approve', true),
        p('FIN.cc.manage', 'Cost centers: propose posting status and account lists', true),
        p('FIN.cc.approve', 'Cost centers: approve finance settings', true),
        p('FIN.gltxn.manage', 'GL account transactions: propose which transactions may post to each GL account', true),
        p('FIN.gltxn.approve', 'GL account transactions: approve', true),
        p('FIN.journal.view', 'Journal: view every entry of the legal entity (cost center owners see their own without it)'),
        p('FIN.close.run', 'Period-end: start period-end, trial balance, reconciliation, propose adjustments, reallocations, opening stock valuation, close and lock', true),
        p('FIN.close.approve', 'Period-end: approve closing and locking periods and the year-end close', true),
        p('FIN.post.approve', 'Approve system postings: reconciliation adjustments, reallocations and opening stock valuation', true),
    ],
};

export const BUILT_MODULE_CODES = Object.keys(BUILT_PERMISSIONS);

/** Every permission key that is real, whichever modules an organization has adopted. */
export const ALL_BUILT_KEYS: Set<string> = new Set([...ADM_PERMISSIONS.map((x) => x.key), ...Object.values(BUILT_PERMISSIONS).flatMap((list) => list.map((x) => x.key))]);

/** Groups offered to an organization: administration, plus every built module it has adopted. */
export function buildCatalogue(modules: Array<{ code: string; name: string }>): PermGroup[] {
    const groups: PermGroup[] = [{ module: 'ADM', name: 'Administration & Security', permissions: ADM_PERMISSIONS }];
    for (const m of modules) {
        if (m.code === 'ADM') continue;
        const list = BUILT_PERMISSIONS[m.code];
        if (list?.length) groups.push({ module: m.code, name: m.name, permissions: list });
    }
    return groups;
}

export function sensitiveKeys(): string[] {
    return [...ADM_PERMISSIONS, ...Object.values(BUILT_PERMISSIONS).flat()].filter((x) => x.sensitive).map((x) => x.key);
}

/** Why a stored key is no longer offered (shown in the review). */
export function retirementReason(key: string): string {
    if (key === 'INV_ST_034') return 'Super admin self-approval contradicts segregation of duties and is not allowed anywhere.';
    if (/^INV_ST_\d+$/.test(key)) return 'No stock take action uses this permission.';
    if (/\.feature\.\d+\.view$/.test(key)) return 'Placeholder for a functional area that has no screen yet.';
    if (key === 'ADM.delegations' || key === 'ADM.authority') return 'The screen is planned but not built yet, so the permission would do nothing.';
    if (key === 'ADM.profile' || key === 'ADM.activity') return 'Everyone can always view and update their own profile and activity.';
    if (/^WMS\./.test(key)) return 'There is no WMS module. Warehouse rights belong to Inventory (INV) and Warehousing (WHS).';
    const module = key.split('.')[0];
    if (!BUILT_MODULE_CODES.includes(module) && module !== 'ADM') return 'This module has no screens or actions yet.';
    return 'No action in the system uses this permission.';
}

/** Older keys that code still honours by expanding them; cleanup replaces them with their exact equivalents. */
export function replacementsFor(key: string): string[] {
    return expandPermissions([key]).filter((x) => x !== key && ALL_BUILT_KEYS.has(x));
}

export interface StaleKey {
    key: string;
    reason: string;
    replacedBy: string[];
}

/** Split a stored permission list into what stays, what converts and what is retired. Wildcards are left alone. */
export function reviewPermissions(perms: string[]): { keep: string[]; stale: StaleKey[]; wildcards: string[]; after: string[] } {
    const keep: string[] = [];
    const stale: StaleKey[] = [];
    const wildcards: string[] = [];
    const after = new Set<string>();
    for (const key of perms) {
        if (key === '*') {
            after.add(key);
            continue;
        }
        if (key.endsWith('.*')) {
            wildcards.push(key);
            after.add(key);
            continue;
        }
        if (ALL_BUILT_KEYS.has(key)) {
            keep.push(key);
            after.add(key);
            continue;
        }
        const replacedBy = replacementsFor(key);
        for (const r of replacedBy) after.add(r);
        stale.push({ key, reason: replacedBy.length ? 'Older module-wide right. Replaced by the exact activities it used to cover.' : retirementReason(key), replacedBy });
    }
    return { keep, stale, wildcards, after: [...after].sort() };
}

// ---------------------------------------------------------------------------
// Segregation of duties
// ---------------------------------------------------------------------------

export interface SodRule {
    id: string;
    a: string;
    b: string;
    why: string;
}

export const SOD_RULES: SodRule[] = [
    { id: 'comp-settings-approve', a: 'ADM.settings', b: 'HRM.compensation.approve', why: 'The person who edits compensation and leave policy drafts must not approve their activation.' },
    { id: 'st-count-verify', a: 'INV_ST_017', b: 'INV_ST_020', why: 'The person who counts stock must not verify the same count.' },
    { id: 'st-count-approve', a: 'INV_ST_017', b: 'INV_ST_027', why: 'The person who counts stock must not approve its posting.' },
    { id: 'st-count-post', a: 'INV_ST_017', b: 'INV_ST_028', why: 'The person who counts stock must not post the result to inventory.' },
    { id: 'st-initiate-approve', a: 'INV_ST_026', b: 'INV_ST_027', why: 'The person who requests a posting must not approve it.' },
    { id: 'vendor-create-approve', a: 'PRC.vendors.manage', b: 'PRC.vendors.approve', why: 'The person who creates a vendor must not approve it.' },
    { id: 'vendor-override-manage', a: 'PRC.vendors.override', b: 'PRC.vendors.manage', why: 'The person who waives a vendor document must not be the person who registers the vendor.' },
    { id: 'vendor-override-approve', a: 'PRC.vendors.override', b: 'PRC.vendors.approve', why: 'The person who waives a vendor document must not also approve the vendor.' },
    { id: 'authority-po-approve', a: 'PRC.authority.manage', b: 'PRC.po.approve', why: 'The person who sets the limits of authority must not approve purchase orders against those limits.' },
    { id: 'prq-prepare-approve', a: 'PRC.prq.manage', b: 'PRC.prq.approve', why: 'The person who prepares a purchase requisition must not approve it.' },
    { id: 'po-prepare-approve', a: 'PRC.po.manage', b: 'PRC.po.approve', why: 'The person who prepares a purchase order must not approve it.' },
    { id: 'po-manage-receive', a: 'PRC.po.manage', b: 'PRC.po.receive', why: 'The person who prepares and sends a purchase order must not also record its deliveries.' },
    { id: 'vendor-sla-po-manage', a: 'PRC.vendors.sla', b: 'PRC.po.manage', why: 'The person who agrees the service levels with a supplier must not also prepare orders that are checked against them.' },
    { id: 'prq-po-approve', a: 'PRC.prq.approve', b: 'PRC.po.approve', why: 'The person who approves the requisition must not also approve the purchase order raised from it.' },
    { id: 'service-accept-manage', a: 'PRC.service.accept', b: 'PRC.po.manage', why: 'The person who accepts a service and posts its journal must not also prepare the purchase order.' },
    { id: 'service-accept-setup', a: 'PRC.service.accept', b: 'PRC.setup.manage', why: 'The person who sets the payable account must not also accept services posted to it.' },
    { id: 'reassign-approve', a: 'PRC.po.reassign', b: 'PRC.po.approve', why: 'The person who can take over purchase orders must not also approve them.' },
    { id: 'req-approve-acknowledge', a: 'PRC.req.approve', b: 'PRC.req.acknowledge', why: 'The manager who approves a purchase requirement must not also acknowledge it for procurement.' },
    { id: 'quote-record-evaluate', a: 'PRC.quotes.manage', b: 'PRC.quotes.evaluate', why: 'The person who records and recommends quotations must not also evaluate and sign them off.' },
    { id: 'buyers-allocate-process', a: 'PRC.buyers.manage', b: 'PRC.quotes.manage', why: 'The person who decides which buyer group handles a subcategory must not also process its quotations.' },
    { id: 'fin-gl-maker-checker', a: 'FIN.gl.manage', b: 'FIN.gl.approve', why: 'The person who proposes chart of accounts changes must not approve them.' },
    { id: 'fin-setup-maker-checker', a: 'FIN.setup.manage', b: 'FIN.setup.approve', why: 'The person who proposes finance setup or go-live must not approve it.' },
    { id: 'fin-calendar-maker-checker', a: 'FIN.calendar.manage', b: 'FIN.calendar.approve', why: 'The person who proposes years and period openings must not approve them.' },
    { id: 'fin-mapping-maker-checker', a: 'FIN.mapping.manage', b: 'FIN.mapping.approve', why: 'The person who proposes the account mapping must not approve it.' },
    { id: 'fin-tax-maker-checker', a: 'FIN.tax.manage', b: 'FIN.tax.approve', why: 'The person who proposes tax rates must not approve them.' },
    { id: 'fin-gltxn-maker-checker', a: 'FIN.gltxn.manage', b: 'FIN.gltxn.approve', why: 'The person who proposes which transactions may post to a GL account must not approve it.' },
    { id: 'fin-gltxn-post', a: 'FIN.gltxn.manage', b: 'FIN.post.approve', why: 'The person who decides which transactions reach an account must not approve postings.' },
    { id: 'fin-cc-maker-checker', a: 'FIN.cc.manage', b: 'FIN.cc.approve', why: 'The person who proposes cost center finance settings must not approve them.' },
    { id: 'fin-close-run-approve', a: 'FIN.close.run', b: 'FIN.close.approve', why: 'The person who runs period-end must not approve closing or locking.' },
    { id: 'fin-close-run-post', a: 'FIN.close.run', b: 'FIN.post.approve', why: 'The person who proposes reconciliation adjustments, reallocations and valuations must not approve them.' },
    { id: 'fin-mapping-post', a: 'FIN.mapping.manage', b: 'FIN.post.approve', why: 'The person who decides which accounts postings go to must not approve postings.' },
    { id: 'replenishment-verify-acknowledge', a: 'INV.replenishment.verify', b: 'PRC.req.acknowledge', why: 'The planner who confirms an automatic replenishment request must not also accept it for procurement.' },
    { id: 'replenishment-verify-po-approve', a: 'INV.replenishment.verify', b: 'PRC.po.approve', why: 'The planner who confirms what to buy must not also approve the purchase order for it.' },
    { id: 'inv-issue-post', a: 'INV.issue', b: 'FIN.post.approve', why: 'The person who issues stock must not approve stock valuations and adjustments.' },
    { id: 'inv-issue-verify', a: 'INV.issue', b: 'INV_ST_020', why: 'The person who issues stock must not verify stock counts.' },
];

/**
 * Segregation of duties across everything one person (or one job role) would hold together, not only within one
 * security role. Conflicts block the change unless each is acknowledged (acknowledgeSod ids, or acknowledgeSodAll)
 * with a reason of 10 to 300 characters. Returns the audit note.
 */
export function requireCombinedSodAcknowledgement(raw: Record<string, unknown>, permissions: string[], subject: string): string {
    const conflicts = sodConflicts(permissions);
    if (!conflicts.length) return '';
    const list = Array.isArray(raw.acknowledgeSod) ? raw.acknowledgeSod.map((x) => String(x ?? '')) : [];
    const all = raw.acknowledgeSodAll === true;
    const reason = String(raw.sodReason ?? '').trim();
    if ((!all && !conflicts.every((c) => list.includes(c.id))) || reason.length < 10 || reason.length > 300) {
        throw new HttpError(409, `Segregation of duties: ${subject} would combine duties that must stay apart. ${conflicts.map((c) => c.why).join(' ')} To continue anyway, acknowledge the conflict and give a reason of at least 10 characters.`);
    }
    return `SoD acknowledged (${conflicts.map((c) => c.id).join(', ')}): ${reason}`;
}

export function sodConflicts(perms: string[]): SodRule[] {
    if (perms.includes('*')) return [];
    return SOD_RULES.filter((r) => hasPerm(perms, r.a) && hasPerm(perms, r.b));
}

// ---------------------------------------------------------------------------
// Recommended security roles (created only when an administrator asks; always editable)
// ---------------------------------------------------------------------------

export interface RoleTemplate {
    id: string;
    module: string;
    name: string;
    description: string;
    permissions: string[];
}

const T = (id: string, module: string, name: string, description: string, permissions: string[]): RoleTemplate => ({ id, module, name, description, permissions });

export const ROLE_TEMPLATES: RoleTemplate[] = [
    T('st_controller', 'INV', 'Stock Take Controller', 'Sets up stock take configurations and sessions. Cannot count, verify, approve or post.', ['INV_ST_001', 'INV_ST_002', 'INV_ST_003', 'INV_ST_005', 'INV_ST_007', 'INV_ST_008', 'INV_ST_010', 'INV_ST_011', 'INV_ST_012', 'INV_ST_013', 'INV_ST_024']),
    T('st_counter', 'INV', 'Stock Take Counter', 'Counts stock and submits the counts.', ['INV_ST_007', 'INV_ST_011', 'INV_ST_016', 'INV_ST_017']),
    T('st_verifier', 'INV', 'Stock Take Verifier', 'Verifies submitted counts and asks for recounts.', ['INV_ST_007', 'INV_ST_011', 'INV_ST_020', 'INV_ST_022']),
    T('st_poster', 'INV', 'Stock Take Posting Clerk', 'Requests posting of verified counts and posts approved results.', ['INV_ST_007', 'INV_ST_011', 'INV_ST_026', 'INV_ST_028']),
    T('st_approver', 'INV', 'Stock Take Approver', 'Approves stock take posting. Cannot count or request posting.', ['INV_ST_007', 'INV_ST_011', 'INV_ST_027']),
    T('inv_viewer', 'INV', 'Inventory Viewer', 'Read-only view of inventory.', ['INV.view', 'INV.warehouse.view', 'INV.bin.view']),
    T('wh_manager', 'INV', 'Warehouse Manager', 'Sets up warehouses, clusters and bins and links materials to bins.', ['INV.view', 'INV.edit', 'INV.warehouse.view', 'INV.warehouse.configure', 'INV.cluster.create', 'INV.cluster.delete', 'INV.bin.view', 'INV.bin.history', 'INV.bin.link', 'INV.bin.unlink']),
    T('mnt_requester', 'MNT', 'Maintenance Requester', 'Raises and follows own work requests.', ['MNT.view', 'MNT.WR.create', 'MNT.WR.edit', 'MNT.WR.cancel']),
    T('mnt_assessor', 'MNT', 'Maintenance Assessor', 'Create task-based technical work assessments; cannot independently approve own assessments.', ['MNT.view','MNT.assessment.edit']),
    T('mnt_assessment_reviewer', 'MNT', 'Maintenance Assessment Reviewer', 'Independently approves or returns completed technical work assessments; also assign an organizational reviewer job role in Maintenance Workflows.', ['MNT.view', 'MNT.assessment.review']),
    T('mnt_planner', 'MNT', 'Maintenance Planner', 'Reviews requests and plans, schedules and releases work orders.', ['MNT.view', 'MNT.WR.review', 'MNT.WR.return', 'MNT.WR.decline', 'MNT.WR.convert', 'MNT.WO.plan', 'MNT.WO.schedule', 'MNT.WO.release', 'MNT.activities.view', 'MNT.activities.edit']),
    T('mnt_technician', 'MNT', 'Maintenance Technician', 'Executes assigned work orders.', ['MNT.view', 'MNT.WO.execute', 'MNT.activities.view']),
    T('mnt_safety', 'MNT', 'Maintenance Safety Officer', 'Performs the safety assessment of work orders.', ['MNT.view', 'MNT.WO.safety']),
    T('mnt_verifier', 'MNT', 'Maintenance Verifier', 'Verifies completed work and closes work orders.', ['MNT.view', 'MNT.WO.verify', 'MNT.WO.close']),
    T('ast_clerk', 'AST', 'Asset Clerk', 'Registers and edits assets. Cannot approve.', ['AST.view', 'AST.create', 'AST.edit', 'AST.catalog.view']),
    T('ast_approver', 'AST', 'Asset Approver', 'Approves asset changes. Cannot create or edit.', ['AST.view', 'AST.approve', 'AST.catalog.view']),
    T('ast_viewer', 'AST', 'Asset Viewer', 'Read-only view of assets.', ['AST.view', 'AST.catalog.view']),
    T('prc_catalog', 'PRC', 'Catalog Maintainer', 'Creates and maintains materials and services (approval stays with the workflow).', ['PRC.view', 'PRC.create', 'PRC.edit', 'PRC.materials.manage', 'PRC.services.manage']),
    T('prc_viewer', 'PRC', 'Catalog Viewer', 'Read-only view of materials and services.', ['PRC.view']),
    T('prc_materials', 'PRC', 'Materials Master Maintainer', 'Creates and maintains materials (approval stays with the material workflow).', ['PRC.view', 'PRC.create', 'PRC.edit', 'PRC.materials.manage']),
    T('prc_services', 'PRC', 'Service Catalog Maintainer', 'Maintains the service catalog.', ['PRC.view', 'PRC.create', 'PRC.edit', 'PRC.services.manage']),
    T('prc_asset_catalog', 'PRC', 'Asset Catalog Reader', 'Reads the asset catalog when specifying assets in procurement.', ['PRC.view', 'AST.view', 'AST.catalog.view']),
    T('prc_setup_admin', 'PRC', 'Procurement Setup Administrator', 'Decides which categories and subcategories the organization accepts, and views the chart of authority.', ['PRC.view', 'PRC.setup.view', 'PRC.setup.manage']),
    T('prc_req_approver', 'PRC', 'Requirement Approver', 'Immediate manager who approves, rejects or returns purchase requirements of the people who report to them. Cannot acknowledge.', ['PRC.view', 'PRC.req.approve']),
    T('prc_buyer', 'PRC', 'Procurement Officer', 'Acknowledges approved requirements to start offline quotation and returns them with a reason. Cannot approve.', ['PRC.view', 'PRC.req.acknowledge']),
    T('prc_authority_admin', 'PRC', 'Chart of Authority Administrator', 'Sets the amount bands: sourcing method, quotes needed, approval levels and controls. Cannot approve purchase orders.', ['PRC.view', 'PRC.setup.view', 'PRC.authority.manage']),
    T('prc_vendor_clerk', 'PRC', 'Vendor Clerk', 'Registers vendors, keeps their documents and submits them for approval. Cannot approve.', ['PRC.view', 'PRC.vendors.view', 'PRC.vendors.manage']),
    T('prc_vendor_override', 'PRC', 'Vendor Document Override Officer', 'Grants a temporary, time-limited override for a required vendor document that cannot be uploaded, with a written reason. Cannot register or approve vendors.', ['PRC.view', 'PRC.vendors.view', 'PRC.vendors.override']),
    T('prc_vendor_approver', 'PRC', 'Vendor Approver', 'Approves, returns, rejects, suspends and reinstates vendors. Cannot register or edit them.', ['PRC.view', 'PRC.vendors.view', 'PRC.vendors.approve']),
    T('prc_quotes_officer', 'PRC', 'Quotations Officer', 'Takes acknowledged requirements into quotations, decides the mode of procurement, invites vendors, records quotes and recommends one. Cannot evaluate or sign off.', ['PRC.view', 'PRC.quotes.view', 'PRC.quotes.manage', 'PRC.vendors.view']),
    T('prc_quotes_evaluator', 'PRC', 'Quotations Evaluator', 'Technical team and evaluators: give the technical view of a quote and sign off the evaluation. Cannot record quotes.', ['PRC.view', 'PRC.quotes.view', 'PRC.quotes.evaluate']),
    T('prc_buyer_admin', 'PRC', 'Buyer Group Administrator', 'Creates buyer groups, gives them subcategories and people, and switches the buyer group function on or off. Cannot process quotations.', ['PRC.view', 'PRC.setup.view', 'PRC.buyers.manage']),
    T('prc_prq_officer', 'PRC', 'Requisition Officer', 'Turns recommended quotations into requisitions for the requester to confirm. Cannot prepare or approve orders.', ['PRC.view', 'PRC.prq.view', 'PRC.prq.manage', 'PRC.quotes.view']),
    T('prc_prq_approver', 'PRC', 'Requisition Approver', 'Reserved. Requisitions are confirmed by the person who raised the requirement.', ['PRC.view', 'PRC.prq.view', 'PRC.prq.approve']),
    T('prc_po_officer', 'PRC', 'Purchase Order Officer', 'Turns confirmed requisitions into orders, consolidates them, validates, confirms for approval and sends approved orders to the supplier. Cannot approve or receive.', ['PRC.view', 'PRC.po.view', 'PRC.po.manage', 'PRC.prq.view', 'PRC.vendors.view']),
    T('prc_po_approver', 'PRC', 'Purchase Order Approver', 'Approves, returns or rejects confirmed orders at the level the chart of authority gives their job role. Cannot prepare or receive.', ['PRC.view', 'PRC.po.view', 'PRC.po.approve']),
    T('prc_po_receiver', 'PRC', 'Purchase Order Receiver', 'Records deliveries against approved orders. Cannot prepare or approve orders.', ['PRC.view', 'PRC.po.view', 'PRC.po.receive']),
    T('prc_service_acceptor', 'PRC', 'Service Acceptor (Cost Center Owner)', 'Accepts or rejects services rendered against orders charged to the cost centers they own. Acceptance reconciles and posts the journal. Cannot prepare orders.', ['PRC.view', 'PRC.po.view', 'PRC.service.accept', 'PRC.journal.view']),
    T('prc_po_delegate', 'PRC', 'Purchase Order Delegate', 'Takes over and reassigns purchase orders when their owner is away. Cannot approve.', ['PRC.view', 'PRC.po.view', 'PRC.po.reassign']),
    T('prc_quotes_reader', 'PRC', 'Quotes and Analysis Reader', 'Sees the quotes and quotation analysis behind purchase orders they can open.', ['PRC.view', 'PRC.po.view', 'PRC.po.viewquotes', 'PRC.quotes.view']),
    T('prc_journal_viewer', 'PRC', 'Procurement Journal Viewer', 'Reads every journal posted from procurement and traces it back to its source.', ['PRC.view', 'PRC.journal.view']),
    T('prc_vendor_sla', 'PRC', 'Vendor SLA Officer', 'Records and ends service level agreements with approved suppliers. Cannot prepare orders.', ['PRC.view', 'PRC.vendors.view', 'PRC.vendors.sla']),
    T('prc_req_auditor', 'PRC', 'Requirements Auditor', 'Read-only view of every purchase requirement and the chart of authority.', ['PRC.view', 'PRC.req.viewall', 'PRC.setup.view']),
    T('saf_assessor', 'SAF', 'Risk Assessor', 'Assesses hazards, impacts and controls.', ['SAF.view', 'SAF.risk.view', 'SAF.risk.assess']),
    T('saf_matrix', 'SAF', 'Risk Matrix Owner', 'Configures the organization risk matrix. Must be given as a direct role.', ['SAF.view', 'SAF.risk.view', 'SAF.configure']),
    T('fin_gl_viewer', 'FIN', 'GL Account Viewer', 'Read-only view of the GL account master.', ['FIN.view', 'FIN.gl.view']),
    T('fin_viewer', 'FIN', 'Finance Viewer', 'Reads finance setup, calendar, chart, mapping, taxes, cost centers and the journal of their legal entities.', ['FIN.view', 'FIN.gl.view', 'FIN.journal.view']),
    T('fin_gl_officer', 'FIN', 'Chart of Accounts Officer', 'Proposes accounts to adopt from the MEMS GL master, and blocking or removing unused accounts. Cannot approve.', ['FIN.view', 'FIN.gl.view', 'FIN.gl.manage']),
    T('fin_gl_approver', 'FIN', 'Chart of Accounts Approver', 'Approves chart of accounts changes. Cannot propose them.', ['FIN.view', 'FIN.gl.view', 'FIN.gl.approve']),
    T('fin_setup_officer', 'FIN', 'Finance Setup Officer', 'Proposes calendar rules, the finance chart of authority, taxes and the go-live of a legal entity. Cannot approve.', ['FIN.view', 'FIN.setup.manage', 'FIN.tax.manage']),
    T('fin_setup_approver', 'FIN', 'Finance Setup Approver', 'Approves finance setup, taxes and legal entity status. Cannot propose them.', ['FIN.view', 'FIN.setup.approve', 'FIN.tax.approve']),
    T('fin_calendar_officer', 'FIN', 'Financial Calendar Officer', 'Adds financial years, proposes initialising them and opening periods. Cannot approve.', ['FIN.view', 'FIN.calendar.manage']),
    T('fin_calendar_approver', 'FIN', 'Financial Calendar Approver', 'Approves year initialisation and period opening. Cannot propose.', ['FIN.view', 'FIN.calendar.approve']),
    T('fin_mapping_officer', 'FIN', 'GL Mapping Officer', 'Proposes the account each system transaction posts to, the transactions each GL account takes and cost center finance settings. Cannot approve them or postings.', ['FIN.view', 'FIN.gl.view', 'FIN.mapping.manage', 'FIN.cc.manage', 'FIN.gltxn.manage']),
    T('fin_mapping_approver', 'FIN', 'GL Mapping Approver', 'Approves the account mapping, GL account transactions and cost center finance settings.', ['FIN.view', 'FIN.gl.view', 'FIN.mapping.approve', 'FIN.cc.approve', 'FIN.gltxn.approve']),
    T('fin_accountant', 'FIN', 'Accountant (Period-end)', 'Runs period-end: trial balance, reconciliation, reallocation and opening stock valuation; proposes close and lock. Cannot approve them.', ['FIN.view', 'FIN.gl.view', 'FIN.journal.view', 'FIN.close.run']),
    T('fin_controller', 'FIN', 'Financial Controller', 'Approves reconciliation adjustments, reallocations, opening stock valuation, period close and lock and the year-end close. Cannot run them.', ['FIN.view', 'FIN.gl.view', 'FIN.journal.view', 'FIN.close.approve', 'FIN.post.approve']),
    T('doc_author', 'DOC', 'Document Author', 'Registers controlled document drafts from standard templates at their locations, uploads the source files, assigns who signs them off, submits them for independent review, requests publication approval under the chart of authority and publishes the approved revision. Cannot review documents.', ['ADM.document_registry', 'ADM.document_publish']),
    T('doc_reviewer', 'DOC', 'Document Technical Reviewer', 'Independently reviews submitted documents at their locations and verifies, returns or rejects them with a reason. Never reviews a document they wrote.', ['ADM.document_registry', 'ADM.document_review']),
    T('doc_controller', 'DOC', 'Document Controller', 'Configures the organization document controls: enabled classes, review cycle and DOC sections. Does not write, review or publish documents through this role.', ['ADM.document_registry', 'ADM.document_config']),
    T('inv_replenishment_planner', 'INV', 'Replenishment Planner', 'Reviews replenishment for warehouse materials under the automated strategies chosen in Stock Control (RP01 Min-Max, RP02 Reorder Point, RP03 EOQ, RP04 Just-in-Time, RP06 MRP): verifies purchase requests (they then go to the manager for approval) or dismisses them, acknowledges signals to suppliers and owners, and runs planning on demand. Cannot acknowledge requirements or approve orders.', ['INV.view', 'INV.replenishment.view', 'INV.replenishment.run', 'INV.replenishment.verify', 'PRC.view']),
    T('inv_replenishment_viewer', 'INV', 'Replenishment Viewer', 'Read-only view of replenishment requests, signals and the run log.', ['INV.view', 'INV.replenishment.view']),
    T('inv_issuer', 'INV', 'Stores Issuer', 'Issues stock from warehouses to cost centers and work orders. Cannot approve postings or verify counts.', ['INV.view', 'INV.issue', 'INV.warehouse.view', 'INV.bin.view']),
];

// A template can never carry a permission that is not real (never throws at load: it just drops the key).
for (const t of ROLE_TEMPLATES) t.permissions = t.permissions.filter((k) => ALL_BUILT_KEYS.has(k));

// ---------------------------------------------------------------------------
// Role documentation helpers
// ---------------------------------------------------------------------------

/** Short fingerprint of a permission list; documentation remembers it to show when the role has changed since review. */
export function permissionsDigest(perms: string[]): string {
    const s = [...new Set(perms)].sort().join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${(h >>> 0).toString(16)}:${new Set(perms).size}`;
}

export type DocStatus = 'missing' | 'outdated' | 'current';

export function docStatus(doc: Record<string, unknown> | undefined | null, perms: string[], today: string): DocStatus {
    if (!doc) return 'missing';
    if (String(doc.reviewedDigest ?? '') !== permissionsDigest(perms)) return 'outdated';
    const next = String(doc.nextReview ?? '');
    return next && next < today ? 'outdated' : 'current';
}

const LABELS: Map<string, string> = new Map([...ADM_PERMISSIONS, ...Object.values(BUILT_PERMISSIONS).flat()].map((x) => [x.key, x.label]));

/** Permission labels grouped by module, for reading. Unknown (leftover) keys are left out. */
export function groupLabels(perms: string[]): Array<{ module: string; items: string[] }> {
    if (perms.includes('*')) return [{ module: 'ALL', items: ['Every permission in the organization'] }];
    const groups = new Map<string, string[]>();
    for (const key of perms) {
        const label = LABELS.get(key);
        if (!label) continue;
        const module = key.startsWith('INV_ST_') ? 'INV' : key.split('.')[0];
        groups.set(module, [...(groups.get(module) ?? []), label]);
    }
    return [...groups.entries()].map(([module, items]) => ({ module, items }));
}

