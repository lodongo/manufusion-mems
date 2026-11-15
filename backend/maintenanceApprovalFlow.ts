/** Server-side, scope-checked maintenance adapter to the shared enterprise engine. */
import {HttpError,str,nowIso,type Obj,type Doc} from './core';
import {effectiveAccess,normalizeOrgRole,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {responsibilityData,scopedApprovalCandidates} from './maintenanceResponsibility';
import type {ApprovalKey} from './maintenanceGovernancePolicy';
import {validateApprovalEvidence,type ApprovalVote} from './unifiedApprovalProof';
import {approvalFlowOf,evidenceFor,flowVote,GATES,CODE,type FlowEvidence} from './maintenanceApprovalFlowCore';
export {flowSteps,flowVote,type FlowEvidence} from './maintenanceApprovalFlowCore';
const strings=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
export async function decideMaintenanceFlow(ctx:OrgContext,doc:Doc,key:ApprovalKey,payload:Record<string,unknown>,startedAt:string,previous:unknown,exclude:string[],decision:ApprovalVote['decision'],note:string):Promise<FlowEvidence|null>{
 const flow=approvalFlowOf(doc.data,key);if(!flow)return null;
 if(exclude.includes(ctx.uid))throw new HttpError(403,'Maker-checker independence is required for advanced approvals.');
 const [gate,permission]=GATES[key],path=strings(doc.data.path),data=await responsibilityData(ctx);
 const candidates=scopedApprovalCandidates(data,path,gate,permission,[...new Set(exclude.filter(Boolean))]);
 const eligible:string[]=[];
 for(const id of candidates){
  const user=data.users.get(id);if(!user||str(user.data.orgId)!==ctx.orgId)continue;
  const role=normalizeOrgRole(str(user.data.role));
  const access=await effectiveAccess(ctx.orgId,role,user,ctx.org.data.modules);
  const candidate={...ctx,uid:id,me:user,role,roleName:access.roleName,permissions:access.permissions,directPermissions:access.directPermissions,grants:access.grants,workGroupPolicy:access.workGroupPolicy,testMode:false} as OrgContext;
  if(canAt(candidate,permission,path,await scopeOf(candidate)))eligible.push(id);
 }
 try{
  const evidence=evidenceFor(flow,ctx.orgId,doc.id,key,payload,startedAt,previous,exclude,eligible);
  const next=flowVote(evidence,flow,ctx.uid,eligible,decision,nowIso(),note);
  if(next.status==='approved'){
   const errors=validateApprovalEvidence(next,{orgId:ctx.orgId,code:CODE[key],handlerName:doc.id,requesterUid:evidence.requestedBy,payload});
   if(errors.length)throw Error(errors.join('; '));
  }
  return next;
 }catch(e){throw new HttpError(409,e instanceof Error?e.message:'Approval workflow cannot proceed.');}
}
export function flowPlain(value:FlowEvidence|null):Obj{return value as unknown as Obj;}
