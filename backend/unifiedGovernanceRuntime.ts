/**
 * Central runtime enforcement for a tenant that has explicitly activated
 * governance. All installed organization routes have a built-in code and keep
 * their existing authentication, role and in-handler business controls.
 * Optional tenant-specific policies may add approval requirements but their
 * absence must not block the standard system-bound business routes.
 * Approval-required actions are blocked until a handler-specific, server-side
 * approval proof adapter exists. Request body flags never count as approvals.
 */
import { HttpError, getDoc, nowIso, str, updateFields, writeDoc, type Doc } from './core';
import { validateApprovalEvidence, type ApprovalEvidence } from './unifiedApprovalProof';
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
    approvedPolicy:b.classification==='permission_only' || input.approvalSatisfied===true,
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
  uid:string;
  body:Record<string,unknown>;
 }):Promise<((success:boolean)=>Promise<void>) | null> {
  // These three routes independently validate tenant, permission, policy and
  // eligible approvers; applying business-execution approval proof to them
  // would prevent submission/decision of the proof itself.
  if(['drkms.documents.publish', 'org.governance.approvals.request','org.governance.approvals.decide',
      'org.governance.approvals.my',
      'org.governance.config.propose','org.governance.config.review',
      'org.governance.config.list',
      'org.governance.cutover.status','org.governance.cutover.propose',
      'org.governance.cutover.approve','org.governance.cutover.disable'].includes(input.name))return null;
  const config=await getDoc(RUNTIME(input.orgId));
  if(str(config?.data.mode)!=='enforce')return null;
  const matches=wiredTransactionInventory().filter(r=>r.name===input.name);
  if(matches.length!==1 || !matches[0].code)throw new HttpError(403,'Transaction endpoint has no unique registered handler.');
  const route=matches[0];
  const bindingDoc=await getDoc(BINDING(input.orgId,route.code));
  const b=bindingDoc?.data??null;
  // Built-in bindings are supplied by the deployed router itself.
  // A tenant does not have to create or approve a Firestore binding document.
  // The existing orgRoute security and the business handler still enforce access.
  if(!b)return null;
  // Legacy tenant-specific approval overrides still require a validated
  // activation; the automatic platform route binding itself does not.
  const owner=str(config?.data.configuredBy), approver=str(config?.data.approvedBy);
  if(!owner||!approver||owner===approver)
    throw new HttpError(403,'Existing custom workflow override has not been authorized.');

  const modules=input.org.data.modules;
  const moduleMap=modules&&typeof modules==='object'&&!Array.isArray(modules)?modules as Record<string,unknown>:{};
  const submodules=input.org.data.submodules;
  const subMap=submodules&&typeof submodules==='object'&&!Array.isArray(submodules)?submodules as Record<string,unknown>:{};
  let approved=false;
  let approvalPath='';
  let approvalDoc:Doc|null=null;
  if(b?.classification==='approval_required') {
    const approvalId=str(input.body.governanceApprovalId);
    if(!/^[A-Za-z0-9_-]{8,128}$/.test(approvalId))
      throw new HttpError(403,'Provide a valid independently approved governance request.');
    approvalPath=`organizations/${input.orgId}/governance_approvals/${approvalId}`;
    approvalDoc=await getDoc(approvalPath);
    if(!approvalDoc)throw new HttpError(403,'Approval request not found.');
    const issues=validateApprovalEvidence(approvalDoc.data as unknown as ApprovalEvidence,{
      orgId:input.orgId,code:route.code,handlerName:input.name,
      requesterUid:input.uid,payload:input.body,
    });
    if(issues.length)throw new HttpError(403,'Approval evidence invalid: '+issues.join('; '));
    const policy=await getDoc(`organizations/${input.orgId}/governance_authority/${route.code}`);
    if(str(policy?.data.status)!=='active' ||
       !str(policy?.data.configuredBy) || !str(policy?.data.approvedBy) ||
       str(policy?.data.configuredBy)===str(policy?.data.approvedBy) ||
       str(policy?.data.version)!==str(approvalDoc.data.policyVersion) ||
       str(bindingDoc?.data.version)!==str(approvalDoc.data.bindingVersion))
      throw new HttpError(409,'Approval no longer matches the current, independently reviewed authority and transaction policy.');
    for(const vote of (approvalDoc.data.votes as Array<{uid?:string}>??[])) {
      const user=await getDoc('users/'+vote.uid);
      if(!user||str(user.data.orgId)!==input.orgId || str(user.data.status)==='disabled')
        throw new HttpError(403,'Approving employee is no longer eligible.');
    }
    approved=true;
  }
  const result=evaluateGovernedHandler({
    mode:'enforce',code:route.code,handlerName:input.name,routePermission:input.permission,
    module:route.module,area:route.area,
    moduleEnabled:moduleMap[route.module]!==false,
    submoduleEnabled:subMap[route.module+'.'+route.area]!==false,
    effectivePermissionGranted:input.effectivePermissionGranted,
    binding:b as Partial<RuntimeBinding>|null,
    approvalSatisfied:approved,
  });
  if(!result.allowed)throw new HttpError(403,'Transaction governance denied: '+result.reasons.join('; '));
  if(!approvalPath || !approvalDoc)return null;
  // Claim the approval atomically BEFORE executing the handler. Concurrent
  // requests cannot reuse the same proof. A failed business action needs
  // a new approved request rather than an unsafe automatic replay.
  const claimed=await writeDoc(approvalPath,{...approvalDoc.data,status:'executing',
    executionStartedAt:nowIso(),executionBy:input.uid},{updateTime:approvalDoc.updateTime});
  if(!claimed)throw new HttpError(409,'Approval was already used or updated.');
  return async(success:boolean)=>{
    await updateFields(approvalPath,{
      status:success?'executed':'execution_failed',executionCompletedAt:nowIso(),
    });
  };
}
