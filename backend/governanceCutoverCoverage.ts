/**
 * Pure, tenant-independent cutover coverage gate. Route metadata comes from the
 * actual router, not a manually curated catalogue. Configuration/evidence is
 * loaded by the server, never accepted from the browser as readiness proof.
 */
import { createHash } from 'node:crypto';
import type { WiredTransaction } from './transactionRuntime';

export type ReviewedBinding = {
  code?:unknown; handlerName?:unknown; permission?:unknown;
  module?:unknown;area?:unknown;status?:unknown;classification?:unknown;
  configuredBy?:unknown;approvedBy?:unknown;
  handlerEvidenceId?:unknown;scopeEvidenceId?:unknown;sodEvidenceId?:unknown;
  version?:unknown;
};
export type ReviewedAuthority = {
  status?:unknown; configuredBy?:unknown;approvedBy?:unknown;
  rules?:unknown;approversByLevel?:unknown;version?:unknown;
};
export type CoverageRow = {
  code:string|null;module:string;area:string;handler:string;route:string;
  classification:string;issues:string[];
};
export type CoverageReport = {
  inspected:number;ready:number;blocked:number;coveragePercent:number;
  digest:string;canActivate:boolean;items:CoverageRow[];
};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const independentlyApproved=(v:ReviewedBinding|ReviewedAuthority|undefined)=>
  !!v && text(v.status)==='active' &&
  !!text(v.configuredBy)&&!!text(v.approvedBy)&&v.configuredBy!==v.approvedBy;

/** Whitelisted control-plane endpoints enforce their own org privileges. */
export const CONTROL_ROUTES = new Set([
  'org.governance.config.propose','org.governance.config.review',
  'org.governance.config.list','org.governance.approvals.request',
  'org.governance.approvals.decide','org.governance.approvals.my',
  'org.governance.cutover.status','org.governance.cutover.propose',
  'org.governance.cutover.approve','org.governance.cutover.disable',
]);
export function validateBinding(route:WiredTransaction,b?:ReviewedBinding,
  authority?:ReviewedAuthority):string[]{
  const issues:string[]=[];
  if(route.guard!=='organization')return ['Route has no organization guard'];
  if(!route.code||route.module==='UNKNOWN')issues.push('Stable canonical transaction code missing');
  if(!route.name||!route.permission)issues.push('Explicit route action permission missing');
  if(!independentlyApproved(b))issues.push('Independently reviewed active binding missing');
  if(b) {
    if(b.code!==route.code||b.handlerName!==route.name||
      b.permission!==route.permission||b.module!==route.module||b.area!==route.area)
      issues.push('Binding does not match the registered handler');
    if(!text(b.handlerEvidenceId)||!text(b.scopeEvidenceId)||!text(b.sodEvidenceId))
      issues.push('Handler, scope or separation-of-duties evidence missing');
    if(b.classification!=='permission_only'&&b.classification!=='approval_required')
      issues.push('Unclassified transaction action');
    if(b.classification==='approval_required') {
      if(!independentlyApproved(authority))issues.push('Approved chart of authority missing');
      if(!Array.isArray(authority?.rules)||!(authority?.rules as unknown[]).length||
         !authority?.approversByLevel)
        issues.push('Authority rules and approver groups missing');
    }
  }
  return issues;
}
export function evaluateCutoverCoverage(
  routes:readonly WiredTransaction[],
  bindings:ReadonlyMap<string,ReviewedBinding>,
  authorities:ReadonlyMap<string,ReviewedAuthority>
):CoverageReport {
  const byName=new Map<string,number>();
  for(const r of routes)byName.set(r.name,(byName.get(r.name)??0)+1);
  // Also inspect organization-prefixed endpoints that have NO orgRoute guard;
  // otherwise an unguarded business endpoint could be invisible at cutover.
  const entries=routes.filter(r=>(r.guard==='organization'||r.path.startsWith('/api/org/')) &&
    !(r.guard==='organization'&&CONTROL_ROUTES.has(r.name)));
  const items=entries.map(r=>{
    const issues=validateBinding(r,r.code?bindings.get(r.code):undefined,r.code?authorities.get(r.code):undefined);
    if(byName.get(r.name)!==1)issues.push('Handler name is not unique across registered routes');
    return {code:r.code,module:r.module,area:r.area,handler:r.name,route:r.method+' '+r.path,
      classification:String(r.code?bindings.get(r.code)?.classification??'unconfigured':'unconfigured'),issues};
  });
  const ready=items.filter(x=>x.issues.length===0).length;
  const digest=createHash('sha256').update(JSON.stringify(items
    .map(x=>[x.code,x.route,x.classification,
      bindings.get(x.code??'')?.version,authorities.get(x.code??'')?.version,x.issues])
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
  return {inspected:items.length,ready,blocked:items.length-ready,
    coveragePercent:items.length?Math.round(ready*10000/items.length)/100:0,
    digest,canActivate:items.length>0&&ready===items.length,items};
}
