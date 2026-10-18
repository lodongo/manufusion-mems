/**
 * Captures only routes actually passed to the server router at startup.
 * Metadata is informational: being wired does not certify workflow/SoD enforcement.
 */
import { createHash } from 'node:crypto';

export type GovernanceHandlerMetadata = { name: string; permission: string | null; kind: 'organization' };
export type WiredTransaction = {
  method: string; path: string; name: string; permission: string | null;
  module: string; area: string; code: string | null;
  handlerWired: true; guard: 'organization' | 'other';
  activationCertified: false;
};
const inventory: WiredTransaction[] = [];
const MODULE_ALIASES: Record<string,string> = {
  admin:'ADM', organization:'ADM', org:'ADM', structure:'ADM', security:'ADM',
  fin:'FIN', finance:'FIN', inv:'INV', inventory:'INV', mnt:'MNT', maintenance:'MNT',
  ast:'AST', asset:'AST', assets:'AST', prc:'PRC', procurement:'PRC',
  whs:'WHS', warehouse:'WHS', hr:'HRM', hrm:'HRM', payroll:'PAY',
  saf:'SAF', quality:'QLT', qlt:'QLT', manufacturing:'MFG',
};
const AREA_ALIASES: Record<string,string> = {
  wr:'WRQ', wo:'WOR', po:'PUR', req:'REQ', prq:'PRQ', quotes:'RFQ', quotations:'RFQ',
  vendors:'VEN', material:'MAT', materials:'MAT', roles:'SEC', security:'SEC',
  governance:'GOA', users:'USR', warehouse:'WHM', bin:'BIN', bins:'BIN',
  stock:'STK', finance:'GLA', register:'REG', equipment:'EQP', workflow:'GOA',
  workflows:'GOA', settings:'ORG', positions:'JBR', structure:'ORG',
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
    const fromPermission = metadata?.permission?.split('.')[0].toUpperCase() || '';
    const first = segments[1] === 'org' ? segments[2] : '';
    const module = /^[A-Z]{2,4}$/.test(fromPermission) ? fromPermission : (MODULE_ALIASES[first?.toLowerCase()] ?? 'UNKNOWN');
    const area = AREA_ALIASES[(segments[3] || '').toLowerCase()] ?? AREA_ALIASES[(segments[2] || '').toLowerCase()] ?? 'GEN';
    const shortHash = parseInt(createHash('sha256').update(route).digest('hex').slice(0,13),16).toString(36).toUpperCase().padStart(8,'0').slice(-8);
    const code = metadata?.kind === 'organization' && module !== 'UNKNOWN' ? module+'-'+area+'-'+shortHash : null;
    if(code) {
      const earlier = codes.get(code);
      if(earlier && earlier!==route) throw new Error('Transaction code collision: '+code+' between '+earlier+' and '+route);
      codes.set(code,route);
    }
    found.push({method,path,name:metadata?.name??'',permission:metadata?.permission??null,
      module,area,code,handlerWired:true,guard:metadata?.kind==='organization'?'organization':'other',activationCertified:false});
  }
  inventory.splice(0,inventory.length,...found.sort((a,b)=>a.path.localeCompare(b.path)||a.method.localeCompare(b.method)));
  return routes;
}
export function wiredTransactionInventory(module?:string): WiredTransaction[] {
  const normalized = (module??'').trim().toUpperCase();
  return inventory.filter(r=>r.guard==='organization' && (!normalized||r.module===normalized));
}
export function wiredInventorySummary() {
  const org = inventory.filter(r=>r.guard==='organization');
  return {totalRoutes:inventory.length,orgGuardedRoutes:org.length,unclassified:inventory.filter(r=>r.guard!=='organization').length,
    withExplicitPermission:org.filter(r=>r.permission).length,
    handlerWired:org.length,activationCertified:0};
}
