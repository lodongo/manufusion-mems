/**
 * Captures only routes actually passed to the server router at startup.
 * Metadata is informational: being wired does not certify workflow/SoD enforcement.
 */
import { createHash } from 'node:crypto';

export type GovernanceHandlerMetadata = { name: string; permission: string | null; kind: 'organization' | 'staff' };
export type WiredTransaction = {
  method: string; path: string; name: string; permission: string | null;
  module: string; area: string; code: string | null;
  handlerWired: true; guard: 'organization' | 'staff' | 'other';
  /** Bound means the running router has this handler. It does NOT grant user access. */
  bindingStatus: 'system_bound' | 'unguarded_org' | 'public_or_custom';
  enforcement: 'role_permission' | 'authenticated_handler' | 'platform_staff' | 'unclassified';
  activationCertified: false;
};
const inventory: WiredTransaction[] = [];
const MODULE_ALIASES: Record<string,string> = {
  admin:'ADM', organization:'ADM', org:'ADM', structure:'ADM', security:'ADM',
  fin:'FIN', finance:'FIN', inv:'INV', inventory:'INV', mnt:'MNT', maintenance:'MNT',
  ast:'AST', asset:'AST', assets:'AST', prc:'PRC', procurement:'PRC',
  whs:'WHS', warehouse:'WHS', hr:'HRM', hrm:'HRM', payroll:'PAY',
  saf:'SAF', safety:'SAF', quality:'QLT', qlt:'QLT', manufacturing:'MFG',
  actions:'ACT', action:'ACT', chat:'COM', calendar:'CAL', mail:'COM',
  notifications:'COM', personal:'USR', quick:'USR', todos:'USR', notes:'USR',
  users:'ADM', profile:'USR', orgHome:'ADM', materials:'INV', material:'INV',
  purchase:'PRC', purchasing:'PRC', vendor:'PRC', vendors:'PRC',
  logistics:'LOG', distribution:'DST', sales:'SAL', service:'SVC', services:'SVC',
  reporting:'RPT', reports:'RPT', documents:'DOC', documentation:'DOC',
  projects:'PRJ', planning:'PLN', production:'MFG', automation:'AUT',
  workforce:'HRM', people:'HRM', attendance:'HRM', shifts:'HRM',
  stocktake:'INV',
};
const AREA_ALIASES: Record<string,string> = {
  wr:'WRQ', wo:'WOR', po:'PUR', req:'REQ', prq:'PRQ', quotes:'RFQ', quotations:'RFQ',
  vendors:'VEN', material:'MAT', materials:'MAT', roles:'SEC', security:'SEC',
  governance:'GOA', users:'USR', warehouse:'WHM', bin:'BIN', bins:'BIN',
  stock:'STK', finance:'GLA', register:'REG', equipment:'EQP', workflow:'GOA',
  workflows:'GOA', settings:'ORG', positions:'JBR', structure:'ORG',
  actions:'ACT', calendar:'CAL', chat:'COM', mail:'COM', messages:'COM',
  jobs:'JBR', tasks:'TSK', alerts:'ALT', notifications:'NTF', photos:'PHT',
  organization:'ORG', list:'LST', stocktake:'STK',
};
export function recordWiredRoutes<T extends Record<string, unknown>>(routes: T): T {
  const found: WiredTransaction[] = [];
  const codes = new Map<string,string>();
  for (const [route, entries] of Object.entries(routes)) {
    const matched = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/[^\s]+)$/.exec(route);
    if (!matched || !Array.isArray(entries)) continue;
    const [ ,method,path ] = matched;
    const handler = entries[0] as ((...args:unknown[])=>unknown) & { governanceMetadata?: GovernanceHandlerMetadata };
    const metadata = handler && handler.governanceMetadata;
    const segments = path.split('/').filter(Boolean);
    const fromPermission = metadata?.kind==='organization' ? (metadata.permission?.split('.')[0].toUpperCase() || '') : '';
    const first = segments[1] === 'org' ? segments[2] : '';
    // Every declared /api/org handler belongs to the installed ORG namespace,
    // even if no product-specific module was inferred. Do not invent a role grant.
    const module = /^[A-Z][A-Z0-9_]{1,10}$/.test(fromPermission) ? fromPermission :
      (MODULE_ALIASES[first?.toLowerCase()] ?? (segments[1]==='org'?'ORG':'PLT'));
    const area = AREA_ALIASES[(segments[3] || '').toLowerCase()] ?? AREA_ALIASES[(segments[2] || '').toLowerCase()] ?? 'GEN';
    const shortHash = parseInt(createHash('sha256').update(route).digest('hex').slice(0,13),16).toString(36).toUpperCase().padStart(8,'0').slice(-8);
    const code = module+'-'+area+'-'+shortHash;
    if(code) {
      const earlier = codes.get(code);
      if(earlier && earlier!==route) throw new Error('Transaction code collision: '+code+' between '+earlier+' and '+route);
      codes.set(code,route);
    }
    const guard=metadata?.kind==='organization'?'organization' as const:
      metadata?.kind==='staff'?'staff' as const:'other' as const;
    const bindingStatus=(guard==='organization'||guard==='staff')?'system_bound' as const:
      (path.startsWith('/api/org/')?'unguarded_org' as const:'public_or_custom' as const);
    const enforcement=guard==='organization'
      ?(metadata?.permission?'role_permission' as const:'authenticated_handler' as const)
      :guard==='staff'?'platform_staff' as const:'unclassified' as const;
    found.push({method,path,name:metadata?.name??method+' '+path,permission:metadata?.permission??null,
      module,area,code,handlerWired:true,guard,bindingStatus,enforcement,activationCertified:false});
  }
  inventory.splice(0,inventory.length,...found.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method)));
  return routes;
}
export function allSystemTransactions(module?:string): WiredTransaction[] {
  const normalized=(module??'').trim().toUpperCase();
  return inventory.filter(r=>!normalized||r.module===normalized);
}
export function wiredTransactionInventory(module?:string): WiredTransaction[] {
  const normalized = (module??'').trim().toUpperCase();
  return inventory.filter(r=>r.guard==='organization' && (!normalized||r.module===normalized));
}
export function wiredInventorySummary() {
  const org = inventory.filter(r=>r.guard==='organization');
  return {totalRoutes:inventory.length,orgGuardedRoutes:org.length,unclassified:inventory.filter(r=>r.bindingStatus==='unguarded_org').length,
    withExplicitPermission:org.filter(r=>r.permission).length,
    systemBound:org.length,authenticatedSelfService:org.filter(r=>!r.permission).length,
    handlerWired:org.length,activationCertified:0};
}
