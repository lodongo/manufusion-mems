import { ALL_BUILT_KEYS, sodConflicts } from './permissionPolicy';

// ---------------------------------------------------------------------------
// Standard level roles: a short ladder of security roles per module (Viewer … Administrator) that replaces the
// long list of single-purpose roles. Each level carries a default permission set for that level of work.
//
// Levels are NOT simply cumulative: maker-checker is preserved by design. The person who prepares (Buyer, Planner,
// Officer) never holds the right to approve the same thing (Manager, Controller, Supervisor), and the person who
// sets limits or configuration (Administrator) never approves against them. Every level is checked against the
// segregation-of-duties rules when this module loads and again when it is installed; a level that would break a
// rule is dropped rather than installed.
//
// System roles stay as they are: Organization super admin (everything) and MEMS Standard User (self-service).
// Approval amounts still come from the chart of authority and job roles; a level role only gives the right to act.
// ---------------------------------------------------------------------------

export interface LevelRole {
    /** Stable security role id, also the role documentation id. */
    id: string;
    module: string;
    moduleName: string;
    /** 1 = lowest. */
    rank: number;
    level: string;
    name: string;
    description: string;
    permissions: string[];
    /** Role documentation: what this level must never do (maker-checker). */
    never: string;
}

const L = (module: string, moduleName: string, rank: number, level: string, description: string, permissions: string[], never: string): LevelRole => ({
    id: `lvl_${module.toLowerCase()}_${level.toLowerCase().replace(/[^a-z]+/g, '_')}`,
    module,
    moduleName,
    rank,
    level,
    name: `${moduleName} ${level}`,
    description,
    permissions: [...new Set(permissions)],
    never,
});

// ----- Procurement -----
const PRC_VIEW = ['PRC.view', 'PRC.vendors.view', 'PRC.quotes.view', 'PRC.prq.view', 'PRC.po.view', 'PRC.setup.view'];
// ----- Maintenance -----
const MNT_VIEW = ['MNT.view', 'MNT.activities.view'];
const MNT_REQUEST = ['MNT.WR.create', 'MNT.WR.edit', 'MNT.WR.cancel'];
// ----- Inventory -----
const INV_VIEW = ['INV.view', 'INV.warehouse.view', 'INV.bin.view', 'INV.bin.history', 'INV.replenishment.view', 'INV_ST_001', 'INV_ST_007', 'INV_ST_011'];
const WHS_VIEW = ['WHS.view', 'WHS.warehouse.view', 'WHS.bin.view', 'WHS.bin.history'];
const AST_VIEW = ['AST.view', 'AST.catalog.view', 'AST.utilities.view'];
const SAF_VIEW = ['SAF.view', 'SAF.risk.view'];
const FIN_VIEW = ['FIN.view', 'FIN.gl.view', 'FIN.journal.view'];

const DEFINITIONS: LevelRole[] = [
    // Administration (organization). Super admin remains the system role with everything.
    L('ADM', 'Administration', 1, 'Viewer', 'Reads the organization audit trail. Changes nothing.', ['ADM.audit'], 'Never changes users, roles, structure, settings or modules.'),
    L('ADM', 'Administration', 2, 'Security Administrator', 'Maintains security roles, user access and view scopes. Grants only rights they hold themselves.', ['ADM.audit', 'ADM.roles', 'ADM.users', 'ADM.scope.site', 'ADM.scope.country', 'ADM.scope.business'], 'Never adds employees in HR, never changes organization design, settings or modules, never approves business transactions through this role.'),
    L('ADM', 'Administration', 3, 'Administrator', 'Maintains organization design and job roles, workflows, settings, modules and subscription.', ['ADM.audit', 'ADM.structure', 'ADM.workflows', 'ADM.settings', 'ADM.modules', 'ADM.billing'], 'Never edits security roles or user access, never approves compensation policy it drafted.'),

    // Procurement
    L('PRC', 'Procurement', 1, 'Viewer', 'Read-only view of requirements, vendors, quotations, requisitions, orders, setup and procurement journals.', [...PRC_VIEW, 'PRC.req.viewall', 'PRC.journal.view'], 'Never creates, changes or approves anything.'),
    L('PRC', 'Procurement', 2, 'Buyer', 'Acknowledges approved requirements, runs quotations, prepares requisitions and purchase orders, registers vendors and maintains catalogue entries.', [...PRC_VIEW, 'PRC.create', 'PRC.edit', 'PRC.req.acknowledge', 'PRC.quotes.manage', 'PRC.prq.manage', 'PRC.po.manage', 'PRC.vendors.manage'], 'Never evaluates the quotations they record, approves orders or vendors, records deliveries, accepts services or agrees supplier SLAs.'),
    L('PRC', 'Procurement', 3, 'Specialist', 'Technical evaluation and sign-off of quotations, receiving deliveries, supplier SLAs and the material and service catalogues.', [...PRC_VIEW, 'PRC.create', 'PRC.edit', 'PRC.quotes.evaluate', 'PRC.po.receive', 'PRC.po.viewquotes', 'PRC.vendors.sla', 'PRC.materials.manage', 'PRC.services.manage'], 'Never records or recommends quotations, prepares or approves orders.'),
    L('PRC', 'Procurement', 4, 'Manager', 'Approves purchase requirements (immediate manager), purchase orders at the chart-of-authority level of their job role, vendors and rendered services for cost centers they own.', [...PRC_VIEW, 'PRC.req.viewall', 'PRC.req.approve', 'PRC.po.approve', 'PRC.po.viewquotes', 'PRC.vendors.approve', 'PRC.service.accept', 'PRC.journal.view'], 'Never prepares orders, records quotations, sets authority limits, reassigns orders or acknowledges requirements they approved.'),
    L('PRC', 'Procurement', 5, 'Administrator', 'Procurement setup, chart of authority, buyer groups, vendor document overrides and reassigning orders when their owner is away.', [...PRC_VIEW, 'PRC.admin', 'PRC.setup.manage', 'PRC.authority.manage', 'PRC.buyers.manage', 'PRC.vendors.override', 'PRC.po.reassign'], 'Never approves orders against the limits it sets, never processes quotations or registers vendors.'),

    // Maintenance
    L('MNT', 'Maintenance', 1, 'Viewer', 'Read-only view of work requests, work orders and assembly activities.', MNT_VIEW, 'Never raises, changes or approves work.'),
    L('MNT', 'Maintenance', 2, 'Clerk', 'Raises, edits and cancels work requests and follows them.', [...MNT_VIEW, ...MNT_REQUEST], 'Never assesses, plans, executes, approves or closes work.'),
    L('MNT', 'Maintenance', 3, 'Artisan', 'Executes assigned work orders: starts tasks, books time and spares, records feedback. Can raise work requests.', [...MNT_VIEW, ...MNT_REQUEST, 'MNT.WO.execute'], 'Never verifies, approves or closes the work they performed.'),
    L('MNT', 'Maintenance', 4, 'Specialist', 'Technical assessor: prepares task-based work assessments and executes specialist work.', [...MNT_VIEW, ...MNT_REQUEST, 'MNT.assessment.edit', 'MNT.WO.execute'], 'Never approves their own assessment, releases, verifies or closes work orders.'),
    L('MNT', 'Maintenance', 5, 'Planner', 'Triages requests, converts approved assessments, plans, schedules and assigns work orders and maintains PM/AM activities.', [...MNT_VIEW, 'MNT.WR.review', 'MNT.WR.return', 'MNT.WR.convert', 'MNT.assessment.edit', 'MNT.WO.plan', 'MNT.WO.schedule', 'MNT.activities.edit'], 'Never releases or safety-assesses the work orders they plan, never verifies or closes them.'),
    L('MNT', 'Maintenance', 6, 'Supervisor', 'Independently approves assessments, performs the safety assessment, releases planned work and verifies completed work.', [...MNT_VIEW, 'MNT.assessment.review', 'MNT.WO.safety', 'MNT.WO.release', 'MNT.WO.verify', 'MNT.WR.decline'], 'Never plans, executes or assesses the work they approve or verify.'),
    L('MNT', 'Maintenance', 7, 'Manager', 'Closes, cancels and reopens work orders, declines requests and independently approves assessments.', [...MNT_VIEW, 'MNT.WO.close', 'MNT.WO.cancel', 'MNT.WO.reopen', 'MNT.WR.decline', 'MNT.assessment.review'], 'Never plans or executes the work it closes.'),
    L('MNT', 'Maintenance', 8, 'Administrator', 'Maintains maintenance settings and the PM/AM activity library.', [...MNT_VIEW, 'MNT.admin', 'MNT.activities.edit'], 'Never executes, approves or closes work through this role.'),

    // Inventory
    L('INV', 'Inventory', 1, 'Viewer', 'Read-only view of inventory, warehouses, bins, replenishment and stock take sessions.', INV_VIEW, 'Never moves stock or changes settings.'),
    L('INV', 'Inventory', 2, 'Storekeeper', 'Issues stock (including Stores Issue Vouchers), links materials to bins and counts stock.', [...INV_VIEW, 'INV.issue', 'INV.bin.link', 'INV.bin.unlink', 'INV_ST_016', 'INV_ST_017'], 'Never verifies, approves or posts counts, never approves stock valuations.'),
    L('INV', 'Inventory', 3, 'Planner', 'Maintains materials, runs and verifies replenishment, sets up stock take sessions and requests their posting.', [...INV_VIEW, 'INV.edit', 'INV.replenishment.run', 'INV.replenishment.verify', 'INV_ST_002', 'INV_ST_003', 'INV_ST_008', 'INV_ST_010', 'INV_ST_024', 'INV_ST_026'], 'Never counts, approves or posts stock take results, never acknowledges the requirements it verifies.'),
    L('INV', 'Inventory', 4, 'Controller', 'Verifies counts, requests recounts, approves and posts stock take results and closes sessions.', [...INV_VIEW, 'INV_ST_013', 'INV_ST_020', 'INV_ST_022', 'INV_ST_027', 'INV_ST_028'], 'Never counts stock, requests posting or issues stock.'),
    L('INV', 'Inventory', 5, 'Administrator', 'Configures warehouses, clusters and stock take configurations; may disregard sessions.', [...INV_VIEW, 'INV.edit', 'INV.warehouse.configure', 'INV.cluster.create', 'INV.cluster.delete', 'INV_ST_002', 'INV_ST_003', 'INV_ST_005', 'INV_ST_012'], 'Never counts, verifies, approves or posts stock movements.'),

    // Warehousing
    L('WHS', 'Warehousing', 1, 'Viewer', 'Read-only view of warehouses and bins.', WHS_VIEW, 'Never changes layout or bins.'),
    L('WHS', 'Warehousing', 2, 'Operator', 'Creates storage clusters and links materials to bins.', [...WHS_VIEW, 'WHS.cluster.create', 'WHS.bin.link', 'WHS.bin.unlink'], 'Never reconfigures warehouses or removes clusters.'),
    L('WHS', 'Warehousing', 3, 'Administrator', 'Configures warehouse layout and storage locations and removes clusters.', [...WHS_VIEW, 'WHS.warehouse.configure', 'WHS.cluster.create', 'WHS.cluster.delete'], 'Never moves stock through this role.'),

    // Assets
    L('AST', 'Asset', 1, 'Viewer', 'Read-only view of assets, the asset catalog and equipment utilities.', AST_VIEW, 'Never changes assets.'),
    L('AST', 'Asset', 2, 'Clerk', 'Registers and edits assets and equipment utilities.', [...AST_VIEW, 'AST.create', 'AST.edit', 'AST.utilities.edit'], 'Never approves the changes they make.'),
    L('AST', 'Asset', 3, 'Manager', 'Independently approves asset changes.', [...AST_VIEW, 'AST.approve'], 'Never creates or edits the assets they approve.'),
    L('AST', 'Asset', 4, 'Administrator', 'Administers asset settings and deletes assets.', [...AST_VIEW, 'AST.admin', 'AST.delete'], 'Never approves asset changes through this role.'),

    // Safety
    L('SAF', 'Safety', 1, 'Viewer', 'Read-only view of safety and risk assessments.', SAF_VIEW, 'Never assesses or configures.'),
    L('SAF', 'Safety', 2, 'Officer', 'Assesses hazards, impacts and controls and maintains safety records.', [...SAF_VIEW, 'SAF.edit', 'SAF.risk.assess'], 'Never configures the risk matrix it assesses against.'),
    L('SAF', 'Safety', 3, 'Administrator', 'Administers safety and configures the organization risk matrix (give as a direct role).', [...SAF_VIEW, 'SAF.admin', 'SAF.configure'], 'Never performs the risk assessments judged by the matrix it configures.'),

    // Finance
    L('FIN', 'Finance', 1, 'Viewer', 'Reads finance setup, chart of accounts and the journal of their legal entities.', FIN_VIEW, 'Never proposes or approves anything.'),
    L('FIN', 'Finance', 2, 'Accountant', 'Runs period-end: trial balance, reconciliation, reallocations, opening stock valuation; proposes close and lock.', [...FIN_VIEW, 'FIN.close.run'], 'Never approves period close, adjustments or postings.'),
    L('FIN', 'Finance', 3, 'Officer', 'Proposes chart of accounts, account mapping, GL account transactions, cost center finance settings, taxes and the financial calendar.', [...FIN_VIEW, 'FIN.gl.manage', 'FIN.mapping.manage', 'FIN.gltxn.manage', 'FIN.cc.manage', 'FIN.tax.manage', 'FIN.calendar.manage'], 'Never approves what it proposes, never approves postings.'),
    L('FIN', 'Finance', 4, 'Controller', 'Independently approves finance proposals, period close and lock, the year-end and system postings.', [...FIN_VIEW, 'FIN.gl.approve', 'FIN.setup.approve', 'FIN.calendar.approve', 'FIN.mapping.approve', 'FIN.tax.approve', 'FIN.cc.approve', 'FIN.gltxn.approve', 'FIN.close.approve', 'FIN.post.approve'], 'Never proposes, runs period-end or issues stock.'),
    L('FIN', 'Finance', 5, 'Administrator', 'Proposes finance setup, the finance chart of authority and legal entity go-live.', [...FIN_VIEW, 'FIN.setup.manage'], 'Never approves finance setup or postings.'),

    // Human resources
    L('HRM', 'HR', 1, 'Viewer', 'Opens HR submodules and the employee portal. Record access is separately controlled.', ['HRM.shell.view'], 'Never changes employee records.'),
    L('HRM', 'HR', 2, 'Officer', 'Adds employees with their employee numbers, reads the site employee directory and maintains the skills master.', ['HRM.shell.view', 'HRM.employee.site.read', 'HRM.employees.manage', 'HRM.skills.manage'], 'Never verifies evidence, approves compensation or access rules, never defines security roles.'),
    L('HRM', 'HR', 3, 'Manager', 'Verifies qualification evidence, approves compensation policy (chart of authority) and HR access rule changes, reads the managed hierarchy.', ['HRM.shell.view', 'HRM.employee.site.read', 'HRM.manager.hierarchy.read', 'HRM.records.verify', 'HRM.compensation.approve', 'HRM.rules.approve'], 'Never approves its own submissions or rules it configured.'),
    L('HRM', 'HR', 4, 'Administrator', 'Configures HR privacy and visibility rules, the skills master and adds employees.', ['HRM.shell.view', 'HRM.employee.site.read', 'HRM.rules.manage', 'HRM.skills.manage', 'HRM.employees.manage'], 'Never approves the rules it configures, never verifies evidence.'),

    // Controlled documents (no read-only right exists: registering is the lowest level)
    L('DOC', 'Document', 1, 'Author', 'Registers controlled document drafts, assigns sign-off and publishes independently approved revisions.', ['ADM.document_registry', 'ADM.document_publish'], 'Never reviews documents.'),
    L('DOC', 'Document', 2, 'Reviewer', 'Independently reviews, returns or rejects submitted documents; never one they wrote.', ['ADM.document_registry', 'ADM.document_review'], 'Never publishes or configures document controls.'),
    L('DOC', 'Document', 3, 'Administrator', 'Configures document controls: classes, review cycle and DOC sections.', ['ADM.document_registry', 'ADM.document_config'], 'Never writes, reviews or publishes documents through this role.'),
];

/** Only real permissions; a level that would combine duties that must stay apart is never offered. */
export const LEVEL_ROLES: LevelRole[] = DEFINITIONS.map((r) => ({ ...r, permissions: r.permissions.filter((k) => ALL_BUILT_KEYS.has(k)) })).filter(
    (r) => r.permissions.length > 0 && sodConflicts(r.permissions).length === 0,
);

export const LEVEL_ROLE_IDS = new Set(LEVEL_ROLES.map((r) => r.id));

/** The module a security role mostly serves (by permission prefix). */
export function moduleOf(permissions: string[]): string {
    const counts = new Map<string, number>();
    for (const p of permissions) {
        const m = p.startsWith('ADM.document_') ? 'DOC' : p.startsWith('INV_ST') ? 'INV' : p.split('.')[0];
        counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * Suggested level for an existing role: the lowest level of its module that covers all of its rights; otherwise the
 * level that covers most of them (then fewest extra rights). Reports what would be lost and gained.
 */
export function suggestLevel(permissions: string[], offered: LevelRole[]): { target: LevelRole | null; lost: string[]; gained: string[] } {
    const mine = permissions.filter((p) => p !== '*');
    const module = moduleOf(mine);
    const ladder = offered.filter((r) => r.module === module).sort((a, b) => a.rank - b.rank);
    if (!ladder.length) return { target: null, lost: mine, gained: [] };
    const score = (r: LevelRole) => {
        const have = new Set(r.permissions);
        const covered = mine.filter((p) => have.has(p)).length;
        return { r, covered, extra: r.permissions.filter((p) => !mine.includes(p)).length };
    };
    const scored = ladder.map(score);
    const full = scored.find((x) => x.covered === mine.length);
    const best = full ?? scored.sort((a, b) => b.covered - a.covered || a.extra - b.extra || a.r.rank - b.r.rank)[0];
    const target = best.r;
    return { target, lost: mine.filter((p) => !target.permissions.includes(p)), gained: target.permissions.filter((p) => !mine.includes(p)) };
}
