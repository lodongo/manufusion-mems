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

/** Path prefix (after /api/org/) to module and submodule. First match wins; most specific first. */
const PATH_RULES: Array<[RegExp, string, string]> = [
    // Procurement
    [/^procurement\/req\//, 'PRC', 'REQ'],
    [/^procurement\/quotes\//, 'PRC', 'RFQ'],
    [/^procurement\/requisitions\//, 'PRC', 'PRQ'],
    [/^procurement\/orders\/receive/, 'PRC', 'GRN'],
    [/^procurement\/orders\/service\//, 'PRC', 'SVC'],
    [/^procurement\/orders\//, 'PRC', 'PUR'],
    [/^procurement\/vendors\/sla\//, 'PRC', 'CTR'],
    [/^procurement\/vendors\/srm/, 'PRC', 'VEV'],
    [/^procurement\/vendors\//, 'PRC', 'VEN'],
    [/^procurement\/materials\/workflow/, 'PRC', 'SET'],
    [/^procurement\/materials\//, 'PRC', 'CAT'],
    [/^procurement\/authority/, 'PRC', 'AUT'],
    [/^procurement\/buyers\//, 'PRC', 'BGR'],
    [/^procurement\/(setup|policy|evaluation|finance|workflows)\//, 'PRC', 'SET'],
    [/^procurement\/dashboard\//, 'PRC', 'RPT'],
    // Finance
    [/^fin\/calendar\//, 'FIN', 'PER'],
    [/^fin\/chart\//, 'FIN', 'COA'],
    [/^fin\/cc\//, 'FIN', 'CCA'],
    [/^fin\/close\//, 'FIN', 'CLS'],
    [/^(fin\/journal|finance\/journals)\//, 'FIN', 'JRN'],
    [/^fin\/mapping\//, 'FIN', 'MAP'],
    [/^fin\/(requests|roles)\//, 'FIN', 'APR'],
    [/^fin\/setup\//, 'FIN', 'SET'],
    [/^fin\/tax\//, 'FIN', 'TAX'],
    [/^fin\/stock\//, 'FIN', 'OPN'],
    [/^fin\/(entities|le\/)/, 'FIN', 'ENT'],
    [/^fin\/transactions\//, 'FIN', 'GLT'],
    // Inventory
    [/^inventory\/stocktake\//, 'INV', 'CNT'],
    [/^inventory\/material\/bin\//, 'WHS', 'BIN'],
    [/^inventory\/material\/isolation\//, 'INV', 'QRT'],
    [/^inventory\/material\/opening-stock/, 'INV', 'OPN'],
    [/^inventory\/material\//, 'INV', 'MAT'],
    [/^inventory\/(on-hand|dashboard)/, 'INV', 'STK'],
    [/^inventory\/operations/, 'INV', 'MOV'],
    [/^inv\/issue\//, 'INV', 'GIS'],
    // Warehousing
    [/^warehouse\/(cluster|bin)\//, 'WHS', 'BIN'],
    [/^warehouse\//, 'WHS', 'WHM'],
    // Other modules (standard action set)
    [/^mnt\/wr\//, 'MNT', 'WRQ'],
    [/^mnt\/wo\//, 'MNT', 'WOR'],
    [/^(assets|ast)\//, 'AST', 'REG'],
    [/^saf\/risk-matrix\//, 'SAF', 'MTX'],
    [/^(activity-risk|saf)\//, 'SAF', 'RSK'],
    [/^users\//, 'ADM', 'USR'],
    [/^roles\//, 'ADM', 'SEC'],
    [/^positions\//, 'ADM', 'JBR'],
    [/^(structure|settings|branding)\//, 'ADM', 'ORG'],
    [/^(governance|workflows)\//, 'ADM', 'GOA'],
    [/^audit$/, 'ADM', 'AUD'],
    [/^(modules|subscription)(\/|$)/, 'ADM', 'MDL'],
];

const VIEW_VERBS = new Set(['list', 'get', 'options', 'overview', 'detail', 'tree', 'masters', 'targets', 'trace', 'positions', 'tiers', 'resolve', 'records', 'summary', 'dashboard', 'on-hand', 'read', 'active', 'available', 'inbox', 'registry', 'similar', 'extensions', 'candidates', 'metadata', 'quotes', 'vendors', 'owners', 'visibility', 'orders', 'warehouses', 'materials', 'spec', 'gl', 'contract', 'entities', 'roles', 'tb', 'preview', 'configuration', 'file', 'validate', 'locations', 'status', 'operations', 'audit', 'subscription', 'staffing', 'review', 'inspect', 'passed', 'describe', 'progress', 'reports', 'blueprints', 'my', 'library', 'search', 'account', 'master']);

const VERB_ACTION: Record<string, string> = {
    create: 'CR', draft: 'CR', start: 'CR', add: 'CR', init: 'CR', 'opening-stock': 'CR', new: 'CR',
    save: 'ED', autosave: 'ED', update: 'ED', edit: 'ED', revise: 'ED', toggle: 'ED', settings: 'ED', drop: 'ED', attachment: 'ED', document: 'ED', set: 'ED', logo: 'ED', design: 'ED',
    amend: 'AM', submit: 'SB', propose: 'SB', request: 'SB', render: 'SB',
    approve: 'AP', decide: 'AP', reject: 'RJ', return: 'RT', cancel: 'CN', discard: 'CN', withdraw: 'WD',
    delete: 'DL', remove: 'DL', post: 'PS', close: 'CL', reopen: 'RO', suspend: 'SU', reinstate: 'RA',
    send: 'SN', receive: 'GR', acknowledge: 'AK', confirm: 'CF', invite: 'IN', recommend: 'RC',
    sign: 'EV', technical: 'EV', run: 'RN', simulate: 'SM', link: 'LN', unlink: 'DN', override: 'OV',
    reassign: 'AS', extension: 'EX', action: 'ED', config: 'ED', lifecycle: 'ED', workflow: 'ED', prepare: 'CR', authority: 'VW', execute: 'SM', accept: 'AC', end: 'TR', srm: 'CR', pay: 'PY', import: 'IM', recode: 'ED',
};

/** Module, submodule and action for an installed route, when it matches a reserved placeholder. */
export function linkRouteToBlueprint(route: Pick<WiredTransaction, 'path'>, defs: AreaDefinition[] = areaDefinitions()): { module: string; area: string; action: string } | null {
    if (!route.path.startsWith('/api/org/')) return null;
    const rest = route.path.slice('/api/org/'.length);
    const rule = PATH_RULES.find(([pattern]) => pattern.test(rest));
    if (!rule) return null;
    const [, module, area] = rule;
    const def = defs.find((d) => d.module === module && d.area === area);
    if (!def) return null;
    const segments = rest.split('/').filter(Boolean);
    const verb = (segments[segments.length - 1] ?? '').toLowerCase();
    let action = VIEW_VERBS.has(verb) ? 'VW' : VERB_ACTION[verb] ?? '';
    if (!action) return null;
    if (!def.actions.includes(action)) {
        // A write the submodule does not list as its own action is the submodule's edit; a read is its view.
        if (action !== 'VW' && def.actions.includes('ED')) action = 'ED';
        else if (def.actions.includes('VW') && VIEW_VERBS.has(verb)) action = 'VW';
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
        };
    });
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
            routes: [`${r.method} ${r.path}`], permissions: r.permission ? [r.permission] : [],
        });
    }
    const builtIn = new Set(rows.map((r) => r.code));
    for (const c of custom) {
        if (builtIn.has(c.code)) continue;
        rows.push({
            code: c.code, module: c.module, area: c.area, areaName: c.areaName, action: c.action, actionName: c.actionName,
            name: c.name, kind: 'transaction', state: c.status === 'retired' ? 'retired' : 'added_reserved', source: 'mems_admin',
            routes: [], permissions: [], addedBy: c.addedBy, addedAt: c.addedAt, reason: c.reason,
        });
    }
    return rows.sort((a, b) => a.module.localeCompare(b.module) || a.area.localeCompare(b.area) || a.code.localeCompare(b.code));
}

export { ACTION_NAMES };
