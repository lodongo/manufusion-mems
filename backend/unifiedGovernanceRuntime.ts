/**
 * Central runtime enforcement for a tenant that has explicitly activated
 * governance. A missing/inactive configuration leaves established business
 * handlers unchanged. Active configuration fails closed for EVERY guarded
 * organization action; permission-only handlers can be certified individually.
 * Approval-required actions are blocked until a handler-specific, server-side
 * approval proof adapter exists. Request body flags never count as approvals.
 */
import { HttpError, getDoc, str, type Doc } from './core';
import { evaluateTransactionAccess, type AccessDecision } from './transactionAccessBoundary';
import { wiredTransactionInventory } from './transactionRuntime';

const RUNTIME = (org: string) => `organizations/${org}/governance/runtime`;
const BINDING = (org: string, code: string) => `organizations/${org}/governance_bindings/${code}`;
export type RuntimeMode = 'inactive' | 'enforce';
export type RuntimeBinding = {
  code: string;
  handlerName: string;
  permission: string;
  module: string;
  area: string;
  classification: 'permission_only' | 'approval_required';
  status: 'active';
  configuredBy: string;
  approvedBy: string;
  handlerEvidenceId: string;
  scopeEvidenceId: string;
  sodEvidenceId: string;
};

/** Pure reviewable decision contract. No user-provided flags are trusted. */
export function evaluateGovernedHandler(input: {
  mode: RuntimeMode;
  code: string | null;
  handlerName: string;
  routePermission: string | null;
  module: string;
  area: string;
  moduleEnabled: boolean;
  submoduleEnabled: boolean;
  effectivePermissionGranted: boolean;
  binding: Partial<RuntimeBinding> | null;
  approvalSatisfied?: boolean;
}): AccessDecision {
  if(input.mode==='inactive') return {allowed:true,reasons:[]};
  const b=input.binding;
  if(!input.code || !b || b.code!==input.code || b.handlerName!==input.handlerName ||
    !input.routePermission || b.permission!==input.routePermission ||
    b.module!==input.module || b.area!==input.area ||
    b.status!=='active' || !b.configuredBy || !b.approvedBy ||
    b.configuredBy===b.approvedBy ||
    !b.handlerEvidenceId || !b.scopeEvidenceId || !b.sodEvidenceId) {
    return {allowed:false,reasons:['Transaction has no independently reviewed, matching active governance binding']};
  }
  return evaluateTransactionAccess({
    code:input.code,
    moduleEnabled:input.moduleEnabled,submoduleEnabled:input.submoduleEnabled,
    implementedHandler:true,registryVerified:true,
    actionPermissionGranted:input.effectivePermissionGranted,
    // A verified binding is required before relying on original handler-specific
    // scope/SoD checks. Those checks must remain in force inside the handler.
    scopeAuthorized:true,sodPermitted:true,
    governanceClass:b.classification==='permission_only'?'permission_only':b.classification==='approval_required'?'approval_required':'unconfigured',
    approvedPolicy:b.classification==='permission_only',
    approvalSatisfied:b.classification==='permission_only' || input.approvalSatisfied===true,
  });
}

/** Called only from the authenticated, tenant-scoped orgRoute server guard. */
export async function enforceOrgTransactionGovernance(input: {
  orgId:string;
  name:string;
  permission:string|null;
  effectivePermissionGranted:boolean;
  org:Doc;
}):Promise<void> {
  const config=await getDoc(RUNTIME(input.orgId));
  if(str(config?.data.mode)!=='enforce')return;
  // A tenant-wide cutover must be independently authorized.
  const owner=str(config?.data.configuredBy), approver=str(config?.data.approvedBy);
  if(!owner||!approver||owner===approver) throw new HttpError(403,'Unified governance activation is not independently approved.');
  const matches=wiredTransactionInventory().filter(r=>r.name===input.name);
  if(matches.length!==1 || !matches[0].code)throw new HttpError(403,'Transaction endpoint has no unique registered handler.');
  const route=matches[0];
  const bindingDoc=await getDoc(BINDING(input.orgId,route.code));
  const b=bindingDoc?.data??null;
  const modules=input.org.data.modules;
  const moduleMap=modules&&typeof modules==='object'&&!Array.isArray(modules)?modules as Record<string,unknown>:{};
  const submodules=input.org.data.submodules;
  const subMap=submodules&&typeof submodules==='object'&&!Array.isArray(submodules)?submodules as Record<string,unknown>:{};
  const result=evaluateGovernedHandler({
    mode:'enforce',code:route.code,handlerName:input.name,routePermission:input.permission,
    module:route.module,area:route.area,
    moduleEnabled:moduleMap[route.module]!==false,
    submoduleEnabled:subMap[route.module+'.'+route.area]!==false,
    effectivePermissionGranted:input.effectivePermissionGranted,
    binding:b as Partial<RuntimeBinding>|null,
  });
  if(!result.allowed)throw new HttpError(403,'Transaction governance denied: '+result.reasons.join('; '));
}
