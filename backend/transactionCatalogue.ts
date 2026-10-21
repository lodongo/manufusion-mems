/**
 * One list of every MEMS transaction and its state, for the MEMS admin Transactions Manager.
 *
 *   live            reserved code with at least one installed server route linked to it
 *   reserved        placeholder only: nothing is installed, nothing can run
 *   live_unlinked   installed route that does not (yet) match a reserved code; keeps its permanent route code
 *   added_reserved  placeholder added by MEMS administration (never executable)
 *   retired         placeholder withdrawn by MEMS administration; the code is never reused
 *
 * Linking is deterministic: module and submodule from the route path, action from its final verb. A future route
 * named after the same pattern links itself to its placeholder on the next deployment. Linking is display and
 * planning only: it never grants access or changes a route's own checks.
 */
import { ACTION_NAMES, areaDefinitions, plannedTransactionBlueprints, type AreaDefinition } from './transactionBlueprints';
import { allSystemTransactions, type WiredTransaction } from './transactionRuntime';
import { POSTING_EVENTS } from './finPostingCatalogue';

export type CatalogueState = 'live' | 'reserved' | 'live_unlinked' | 'added_reserved' | 'retired';

export interface CatalogueRow {
    code: string;
    module: string;
    area: string;
    areaName: string;
    action: string;
    actionName: string;
    name: string;
    kind: 'module_access' | 'submodule_access' | 'transaction' | 'route';
    state: CatalogueState;
    source: 'built_in' | 'mems_admin' | 'installed_route';
    routes: string[];
    permissions: string[];
    addedBy?: string;
    addedAt?: string;
    reason?: string;
    /** General-ledger postings this transaction performs (live) or will perform (planned). */
    postings: Array<{ event: string; label: string; debit: string[]; credit: string[]; state: 'live' | 'planned' }>;
}

export interface CustomCode {
    code: string;
    module: string;
    area: string;
    areaName: string;
    action: string;
    actionName: string;
    name: string;
    status: 'reserved' | 'retired';
    addedBy: string;
    addedAt: string;
    reason: string;
}

/**
 * Route path (after /api/) to module, submodule and, where the final word is ambiguous, the action.
 * First match wins; most specific first. Every family of installed routes has a rule, so every route links.
 */
type Rule = [RegExp, string, string, string?];
const PATH_RULES: Rule[] = [
    // ----- Procurement -----
    [/^org\/procurement\/req\//, 'PRC', 'REQ'],
    [/^org\/procurement\/quotes\//, 'PRC', 'RFQ'],
    [/^org\/procurement\/requisitions\//, 'PRC', 'PRQ'],
    [/^org\/procurement\/orders\/receive/, 'PRC', 'GRN'],
    [/^org\/procurement\/orders\/service\//, 'PRC', 'SVC'],
    [/^org\/procurement\/orders\//, 'PRC', 'PUR'],
    [/^org\/procurement\/vendors\/sla\//, 'PRC', 'CTR'],
    [/^org\/procurement\/vendors\/srm/, 'PRC', 'VEV'],
    [/^org\/procurement\/vendors\//, 'PRC', 'VEN'],
    [/^org\/procurement\/materials\/workflow/, 'PRC', 'SET'],
    [/^org\/procurement\/(materials|catalog)\//, 'PRC', 'CAT'],
    [/^org\/procurement\/authority/, 'PRC', 'AUT'],
    [/^org\/procurement\/buyers\//, 'PRC', 'BGR'],
    [/^org\/procurement\/(setup|policy|evaluation|finance|workflows)\//, 'PRC', 'SET'],
    [/^org\/procurement\/dashboard\//, 'PRC', 'RPT'],
    // ----- Finance -----
    [/^org\/fin\/calendar\/period\/status/, 'FIN', 'PER', 'ED'],
    [/^org\/fin\/calendar\//, 'FIN', 'PER'],
    [/^org\/(fin\/chart|finance\/catalog)\//, 'FIN', 'COA'],
    [/^org\/fin\/cc\//, 'FIN', 'CCA'],
    [/^org\/fin\/close\//, 'FIN', 'CLS'],
    [/^org\/(fin\/journal|finance\/journals)\//, 'FIN', 'JRN'],
    [/^org\/fin\/mapping\//, 'FIN', 'MAP'],
    [/^org\/fin\/(requests|roles)\//, 'FIN', 'APR'],
    [/^org\/fin\/setup\//, 'FIN', 'SET'],
    [/^org\/fin\/tax\//, 'FIN', 'TAX'],
    [/^org\/fin\/stock\//, 'FIN', 'OPN'],
    [/^org\/fin\/(entities|le\/)/, 'FIN', 'ENT'],
    [/^org\/fin\/transactions\//, 'FIN', 'GLT'],
    [/^org\/fin\/gltxn\//, 'FIN', 'GTX'],
    [/^org\/transactions\/access\//, 'ADM', 'SEC'],
    // ----- Inventory and warehousing -----
    [/^org\/inventory\/stocktake\//, 'INV', 'CNT'],
    [/^org\/inventory\/replenishment\/verify/, 'INV', 'RPL', 'VF'],
    [/^org\/inventory\/replenishment\/dismiss/, 'INV', 'RPL', 'RJ'],
    [/^org\/inventory\/replenishment\/run/, 'INV', 'RPL', 'RN'],
    [/^org\/inventory\/replenishment\/signal\/acknowledge/, 'INV', 'RPL', 'AK'],
    [/^org\/inventory\/replenishment\//, 'INV', 'RPL'],
    [/^org\/inventory\/material\/bin\//, 'WHS', 'BIN'],
    [/^org\/inventory\/material\/isolation\//, 'INV', 'QRT'],
    [/^org\/inventory\/material\/opening-stock/, 'INV', 'OPN'],
    [/^org\/inventory\/material\//, 'INV', 'MAT'],
    [/^org\/inventory\/(on-hand|dashboard)/, 'INV', 'STK'],
    [/^org\/inventory\/operations/, 'INV', 'MOV'],
    [/^org\/inv\/issue\//, 'INV', 'GIS'],
    [/^org\/warehouse\/(cluster|bin)\//, 'WHS', 'BIN'],
    [/^org\/warehouse\//, 'WHS', 'WHM'],
    // ----- Maintenance, assets, safety -----
    [/^org\/mnt\/wr\/photo/, 'MNT', 'WRQ', 'UP'],
    [/^org\/mnt\/wr\//, 'MNT', 'WRQ'],
    [/^org\/mnt\/wo\//, 'MNT', 'WOR'],
    [/^org\/mnt\/operations/, 'MNT', 'WOR', 'ED'],
    [/^org\/mnt\/assessment\/photo/, 'MNT', 'ASS', 'UP'],
    [/^org\/mnt\/assessment\//, 'MNT', 'ASS'],
    [/^org\/mnt\/tasks\/validate/, 'MNT', 'TSK', 'AP'],
    [/^org\/mnt\/tasks\//, 'MNT', 'TSK'],
    [/^org\/mnt\/material-candidates\/adopt/, 'MNT', 'MCD', 'CR'],
    [/^org\/mnt\/material-candidates\//, 'MNT', 'MCD'],
    [/^org\/mnt\/workflow\//, 'MNT', 'WFL'],
    [/^org\/mnt\//, 'MNT', 'SET'],
    [/^org\/bom\//, 'MNT', 'BOM'],
    [/^org\/assets\/dictionary\//, 'AST', 'DIC'],
    [/^org\/assembly\/activities\//, 'AST', 'ACT'],
    [/^org\/ast\/stored-energy\//, 'SAF', 'ENE'],
    [/^org\/ast\/utilities\//, 'AST', 'EQP'],
    [/^org\/assets\//, 'AST', 'REG'],
    [/^org\/saf\/risk-matrix\//, 'SAF', 'MTX'],
    [/^org\/activity-risk\/register/, 'SAF', 'RSK', 'VW'],
    [/^org\/(activity-risk|saf)\//, 'SAF', 'RSK'],
    // ----- Documentation and records (DOC) -----
    [/^org\/drkms\/files\/stage/, 'DOC', 'SRC', 'UP'],
    [/^org\/drkms\/files\/release/, 'DOC', 'SRC', 'RL'],
    [/^org\/drkms\/files\/remove/, 'DOC', 'SRC', 'DL'],
    [/^org\/drkms\/files\//, 'DOC', 'SRC', 'VW'],
    [/^org\/drkms\/documents\/review-decision/, 'DOC', 'RVW', 'VF'],
    [/^org\/drkms\/documents\/submit-review/, 'DOC', 'RVW', 'SB'],
    [/^org\/drkms\/documents\/review-schedule/, 'DOC', 'RVW', 'VW'],
    [/^org\/drkms\/documents\/(approval-packet|publication-request)/, 'DOC', 'PBL', 'SB'],
    [/^org\/drkms\/documents\/publish/, 'DOC', 'PBL', 'PB'],
    [/^org\/drkms\/documents\/(signed-copy|effective-files|revision-download|revision-history)/, 'DOC', 'PBL', 'VW'],
    [/^org\/drkms\/documents\/(create-draft|revise)/, 'DOC', 'DRF', 'CR'],
    [/^org\/drkms\/documents\//, 'DOC', 'DRF', 'VW'],
    [/^org\/drkms\/signatures\/assign/, 'DOC', 'SGN', 'AS'],
    [/^org\/drkms\/signatures\/sign/, 'DOC', 'SGN', 'EV'],
    [/^org\/drkms\/signatures\//, 'DOC', 'SGN', 'VW'],
    [/^org\/drkms\/configure/, 'DOC', 'CFG', 'CG'],
    [/^org\/drkms\/(setup|submodules)/, 'DOC', 'CFG', 'VW'],
    [/^org\/drkms\/(engineering|industrial)\//, 'DOC', 'ENG'],
    [/^org\/drkms\/sds\//, 'DOC', 'SDS'],
    [/^org\/drkms\/rca\//, 'DOC', 'RCA'],
    [/^org\/drkms\/forms\/review\/decision/, 'DOC', 'FRM', 'AP'],
    [/^org\/drkms\/forms\//, 'DOC', 'FRM'],
    [/^org\/drkms\/(troubleshoot|ai)\//, 'DOC', 'KNW'],
    // ----- Organization administration -----
    [/^org\/users\//, 'ADM', 'USR'],
    [/^org\/(roles|security)\//, 'ADM', 'SEC'],
    [/^org\/positions\//, 'ADM', 'JBR'],
    [/^org\/structure\/site-roles/, 'ADM', 'ORG', 'ED'],
    [/^org\/(structure|settings|branding)\//, 'ADM', 'ORG'],
    [/^org\/(governance|workflows)\//, 'ADM', 'GOA'],
    [/^org\/audit$/, 'ADM', 'AUD'],
    [/^org\/(modules|subscription)(\/|$)/, 'ADM', 'MDL'],
    [/^org\/security-docs\/signoff\/upload/, 'ADM', 'SDC', 'UP'],
    [/^org\/security-docs\//, 'ADM', 'SDC'],
    [/^org\/(setup|home)\//, 'ADM', 'HOM'],
    [/^org\/reference\//, 'ADM', 'REF'],
    // ----- Workspace and collaboration -----
    [/^org\/quick\/chat\/action\//, 'WSP', 'CHA'],
    [/^org\/quick\/chat\/poll\//, 'WSP', 'POL'],
    [/^org\/quick\/chat\/(invitation\/respond)/, 'WSP', 'CHT', 'AN'],
    [/^org\/quick\/chat\/policy\/accept/, 'WSP', 'CHT', 'AC'],
    [/^org\/quick\/chat\//, 'WSP', 'CHT'],
    [/^org\/mail\/calendar\//, 'WSP', 'CAL'],
    [/^org\/mail\//, 'WSP', 'MAI'],
    [/^org\/actions\//, 'WSP', 'ACT'],
    [/^org\/quick\/todo\//, 'WSP', 'TOD'],
    [/^org\/quick\/note\//, 'WSP', 'NOT'],
    [/^org\/quick\/gemba\/resolve/, 'WSP', 'GEM', 'CL'],
    [/^org\/quick\/gemba\//, 'WSP', 'GEM'],
    [/^org\/my-tables\//, 'WSP', 'TBL'],
    [/^org\/(home-layout|shortcuts)\//, 'WSP', 'HOM'],
    [/^org\/quick\/status/, 'WSP', 'HOM', 'VW'],
    [/^org\/work-groups\//, 'WSP', 'WGR'],
    [/^(org\/my-access|org\/context|me\/activity)/, 'WSP', 'ACC', 'VW'],
    // ----- MEMS platform administration (staff) -----
    [/^admin\/tenants\/(status|module)/, 'PLT', 'TEN', 'ED'],
    [/^admin\/tenants\//, 'PLT', 'TEN'],
    [/^admin\/(applications|registrations)\//, 'PLT', 'APL'],
    [/^admin\/users\//, 'PLT', 'USR'],
    [/^admin\/modules\//, 'PLT', 'MDL'],
    [/^admin\/drkms\/scanning\/set/, 'PLT', 'MDL', 'CG'],
    [/^admin\/drkms\//, 'PLT', 'MDL'],
    [/^admin\/reference\//, 'PLT', 'REF'],
    [/^admin\/assets\//, 'PLT', 'ASM'],
    [/^admin\/procurement\//, 'PLT', 'PRM'],
    [/^admin\/(finance|banks)\//, 'PLT', 'FNM'],
    [/^admin\/security-docs\//, 'PLT', 'SDC'],
    [/^admin\/(ops|automations)\//, 'PLT', 'OPS'],
    [/^admin\/fx\//, 'PLT', 'FXR'],
    [/^admin\/logs$/, 'PLT', 'AUD', 'VW'],
    [/^admin\/(health|dashboard)$/, 'PLT', 'HLT', 'VW'],
    [/^admin\/transactions\//, 'PLT', 'TRX'],
    [/^admin\/fin\/gltxn\//, 'PLT', 'FNM'],
    [/^admin\/billing\//, 'PLT', 'BIL'],
    [/^admin\/(settings|site)\//, 'PLT', 'SET'],
    [/^admin\/skills\//, 'PLT', 'SKL'],
    [/^admin\/sequences$/, 'PLT', 'SEQ', 'VW'],
    [/^admin\/sequences\//, 'PLT', 'SEQ'],
    [/^admin\/explorer\//, 'PLT', 'EXP'],
    [/^admin\/branding\//, 'PLT', 'BRD'],
    // ----- Sign-in and self-service -----
    [/^(session|org\/context)$/, 'SYS', 'SES', 'VW'],
    [/^profile\/health\//, 'SYS', 'PRF'],
    [/^profile\//, 'SYS', 'PRF', 'ED'],
    [/^(organizations\/register|setup\/register)$/, 'SYS', 'REG', 'CR'],
    [/^registration\/settings$/, 'SYS', 'REG', 'VW'],
    [/^applications\/upload/, 'SYS', 'APL', 'UP'],
    [/^applications\//, 'SYS', 'APL'],
    [/^audit\//, 'SYS', 'AUD', 'CR'],
    [/^payments\//, 'SYS', 'PAY', 'PY'],
    [/^internal\//, 'SYS', 'INT', 'RN'],
    [/^_healthcheck$/, 'SYS', 'HLT', 'VW'],
    [/^setup\/status$/, 'SYS', 'SET', 'VW'],
    [/^(site|reference)$/, 'SYS', 'SIT', 'VW'],
];

const VIEW_VERBS = new Set(['list', 'get', 'options', 'overview', 'detail', 'tree', 'masters', 'targets', 'trace', 'positions', 'tiers', 'resolve', 'records', 'summary', 'dashboard', 'on-hand', 'read', 'active', 'available', 'inbox', 'registry', 'similar', 'extensions', 'candidates', 'metadata', 'quotes', 'vendors', 'owners', 'visibility', 'orders', 'warehouses', 'materials', 'spec', 'gl', 'contract', 'entities', 'roles', 'tb', 'preview', 'configuration', 'file', 'validate', 'locations', 'status', 'operations', 'audit', 'subscription', 'staffing', 'review', 'inspect', 'passed', 'describe', 'progress', 'reports', 'blueprints', 'my', 'library', 'search', 'account', 'master', 'class', 'item', 'domains', 'rates', 'collections', 'documents', 'document', 'orphans', 'logs', 'standard-preview', 'people', 'invitations', 'calendar', 'sent', 'assemblies', 'pending', 'proposals', 'templates', 'expand', 'manager-roles', 'node', 'site-roles', 'legacy-read', 'eligible-equipment', 'eligible-for-equipment', 'work-center', 'banks', 'core-skills', 'cost-center-types', 'skills', 'catalog-search', 'references', 'setup', 'assembly', 'room', 'reporting', 'preferences', 'activity', 'document-url', 'me', 'workspace', 'ownership-review', 'admin', 'context', 'health', 'session']);

const VERB_ACTION: Record<string, string> = {
    create: 'CR', draft: 'CR', start: 'CR', add: 'CR', init: 'CR', 'opening-stock': 'CR', new: 'CR', observe: 'CR', adopt: 'CR', register: 'CR',
    save: 'ED', autosave: 'ED', update: 'ED', edit: 'ED', revise: 'ED', toggle: 'ED', settings: 'ED', drop: 'ED', attachment: 'ED', set: 'ED', logo: 'ED',
    design: 'ED', entry: 'ED', repair: 'ED', 'reset-password': 'ED', module: 'ED', registration: 'ED', reset: 'ED', 'legacy-save': 'ED', change: 'ED',
    progress: 'ED', comment: 'ED', react: 'ED', typing: 'ED', presence: 'ED', read: 'VW', folder: 'ED', member: 'AS', 'password-changed': 'ED',
    amend: 'AM', submit: 'SB', propose: 'SB', request: 'SB', render: 'SB',
    approve: 'AP', decide: 'AP', reject: 'RJ', return: 'RT', cancel: 'CN', discard: 'CN', withdraw: 'WD',
    delete: 'DL', remove: 'DL', clear: 'DL', post: 'PS', close: 'CL', reopen: 'RO', restore: 'RO', suspend: 'SU', reinstate: 'RA',
    send: 'SN', receive: 'GR', acknowledge: 'AK', confirm: 'CF', invite: 'IN', recommend: 'RC',
    sign: 'EV', technical: 'EV', run: 'RN', refresh: 'RN', dispatch: 'RN', retry: 'RN', heartbeat: 'RN', pulse: 'RN', 'scheduled-refresh': 'RN',
    simulate: 'SM', link: 'LN', 'link-wr': 'LN', unlink: 'DN', override: 'OV',
    reassign: 'AS', extension: 'EX', accept: 'AC', end: 'TR', srm: 'CR', pay: 'PY', webhook: 'PY',
    import: 'IM', begin: 'IM', chunk: 'IM', finish: 'IM', load: 'IM', upload: 'UP', photo: 'UP', export: 'XP',
    recode: 'ED', action: 'ED', config: 'ED', lifecycle: 'ED', workflow: 'ED', prepare: 'CR', authority: 'VW', execute: 'SM',
    activate: 'AV', publish: 'PB', seed: 'CG', initialise: 'CG', defaults: 'CG', 'fresh-start': 'CG', sync: 'CG', apply: 'CG', 'fill-standard': 'CG', cleanup: 'CG',
    respond: 'AN', vote: 'VO', archive: 'AR', hide: 'ED', subscribe: 'ED', unsubscribe: 'ED', 'login-attempt': 'CR', events: 'CR',
};

/** Module, submodule and action for an installed route, when its family has a reserved placeholder. */
export function linkRouteToBlueprint(route: Pick<WiredTransaction, 'path'>, defs: AreaDefinition[] = areaDefinitions()): { module: string; area: string; action: string } | null {
    if (!route.path.startsWith('/api/')) return null;
    const rest = route.path.slice('/api/'.length);
    const rule = PATH_RULES.find(([pattern]) => pattern.test(rest));
    if (!rule) return null;
    const [, module, area, fixed] = rule;
    const def = defs.find((d) => d.module === module && d.area === area);
    if (!def) return null;
    const segments = rest.split('/').filter(Boolean);
    const verb = (segments[segments.length - 1] ?? '').toLowerCase();
    let action = fixed || (VIEW_VERBS.has(verb) ? 'VW' : VERB_ACTION[verb] ?? '');
    // A verb not seen before is treated as a change to the submodule; it still links and stays visible for review.
    if (!action) action = 'ED';
    if (!def.actions.includes(action)) {
        if (action !== 'VW' && def.actions.includes('ED')) action = 'ED';
        else if (def.actions.includes('VW')) action = 'VW';
        else return null;
    }
    return { module, area, action };
}

/** Every transaction: reserved placeholders (with their linked installed routes), unlinked routes, and admin-added codes. */
export function transactionCatalogue(custom: CustomCode[] = [], routes: WiredTransaction[] = allSystemTransactions()): CatalogueRow[] {
    const defs = areaDefinitions();
    const blueprints = plannedTransactionBlueprints().filter((b) => b.state === 'reserved');
    const linked = new Map<string, WiredTransaction[]>();
    const unlinked: WiredTransaction[] = [];
    for (const route of routes) {
        const link = linkRouteToBlueprint(route, defs);
        const code = link ? `${link.module}-${link.area}-${link.action}` : '';
        if (link && blueprints.some((b) => b.code === code)) linked.set(code, [...(linked.get(code) ?? []), route]);
        else unlinked.push(route);
    }
    const rows: CatalogueRow[] = blueprints.map((b) => {
        const hits = linked.get(b.code) ?? [];
        return {
            code: b.code, module: b.module, area: b.area, areaName: b.areaName, action: b.action, actionName: b.actionName,
            name: b.name, kind: b.kind, state: hits.length ? 'live' : 'reserved', source: 'built_in',
            routes: hits.map((r) => `${r.method} ${r.path}`).sort(),
            permissions: [...new Set(hits.map((r) => r.permission).filter((p): p is string => !!p))].sort(),
            postings: [],
        };
    });
    // Financial movements: attach postings; a live posting performed through a shared route makes its code live.
    const installed = new Set(routes.map((r) => `${r.method} ${r.path}`));
    const byCode = new Map(rows.map((r) => [r.code, r]));
    for (const e of POSTING_EVENTS) {
        for (const code of e.codes) {
            const row = byCode.get(code);
            if (!row) continue;
            row.postings.push({ event: e.event, label: e.label, debit: e.debit, credit: e.credit, state: e.state });
            if (e.state !== 'live') continue;
            const via = (e.via ?? []).map((p) => `POST ${p}`).filter((r) => installed.has(r));
            if (!via.length) continue;
            row.routes = [...new Set([...row.routes, ...via])].sort();
            row.state = 'live';
        }
    }
    // Submodule access is live when any of its transactions is live; module access when any submodule is.
    const liveAreas = new Set(rows.filter((r) => r.state === 'live').map((r) => `${r.module}-${r.area}`));
    const liveModules = new Set(rows.filter((r) => r.state === 'live').map((r) => r.module));
    for (const row of rows) {
        if (row.kind === 'submodule_access' && row.state === 'reserved' && liveAreas.has(`${row.module}-${row.area}`)) row.state = 'live';
        if (row.kind === 'module_access' && row.state === 'reserved' && liveModules.has(row.module)) row.state = 'live';
    }
    for (const r of unlinked) {
        if (!r.code) continue;
        rows.push({
            code: r.code, module: r.module, area: r.area, areaName: r.area, action: '', actionName: '',
            name: r.name, kind: 'route', state: 'live_unlinked', source: 'installed_route',
            routes: [`${r.method} ${r.path}`], permissions: r.permission ? [r.permission] : [], postings: [],
        });
    }
    const builtIn = new Set(rows.map((r) => r.code));
    for (const c of custom) {
        if (builtIn.has(c.code)) continue;
        rows.push({
            code: c.code, module: c.module, area: c.area, areaName: c.areaName, action: c.action, actionName: c.actionName,
            name: c.name, kind: 'transaction', state: c.status === 'retired' ? 'retired' : 'added_reserved', source: 'mems_admin',
            routes: [], permissions: [], addedBy: c.addedBy, addedAt: c.addedAt, reason: c.reason, postings: [],
        });
    }
    return rows.sort((a, b) => a.module.localeCompare(b.module) || a.area.localeCompare(b.area) || a.code.localeCompare(b.code));
}

export { ACTION_NAMES };
