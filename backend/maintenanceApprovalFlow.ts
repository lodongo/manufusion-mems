/** Maintenance adapter for the existing unified enterprise vote and quorum engine.
 * Business records persist revision-bound evidence under the existing transaction lock.
 */
import {HttpError,str,nowIso,isObj,type Obj,type Doc} from './core';
import {effectiveAccess,normalizeOrgRole,type OrgContext} from './guards';
import {canAt,scopeOf} from './access';
import {responsibilityData,scopedApprovalCandidates} from './maintenanceResponsibility';
import {readMaintenancePolicySnapshot,type ApprovalKey} from './maintenanceGovernancePolicy';
import {quorumCount} from './governanceCore';
import {applyApprovalDecision,nextEligibleApprovalStep,isStepApproved,validateApprovalEvidence,transactionPayloadHash,type ApprovalEvidence,type ApprovalStep,type ApprovalVote} from './unifiedApprovalProof';
import type {ApprovalFlow} from './maintenanceApprovalFlowPolicy';
const GATES:Record<ApprovalKey,[string,string]>={workRequest:['MNT.WR.APPROVAL','MNT.WR.approve'],workOrder:['MNT.ASSESS.REVIEW','MNT.assessment.review'],technicalClosure:['MNT.WO.CLOSE_APPROVAL','MNT.WO.technicalApprove']};
const CODE:Record<ApprovalKey,string>={workRequest:'MNT-WRQ-AP',workOrder:'MNT-WOR-AP',technicalClosure:'MNT-WOR-CL'};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];
export type ActorVote={principalUid:string;actorUid:string;stream:string;level:number;mode:'direct'|'delegation'|'escalation';at:string;note:string};
export type FlowEvidence=ApprovalEvidence&{startedAt:string;actors:ActorVote[]};
export function flowSteps(flow:ApprovalFlow,eligible:string[]):ApprovalStep[]{
 const pool=new Set(eligible),alternates=new Set(flow.alternates.map(a=>a.alternateUid));
 return flow.steps.map(s=>{
  const eligibleUserIds=(s.approverUids.length?s.approverUids:eligible).filter(uid=>pool.has(uid)&&!alternates.has(uid));
  const unique=[...new Set(eligibleUserIds)];
  quorumCount(s.quorum,unique.length);
  return {stream:s.stream,level:s.level,quorum:s.quorum,eligibleUserIds:unique};
 });
}
export function flowVote(e:FlowEvidence,flow:ApprovalFlow,actor:string,liveEligible:string[],decision:ApprovalVote['decision'],at:string,note:string):FlowEvidence{
 const clock=Date.parse(at),start=Date.parse(e.startedAt),eligible=new Set(liveEligible);
 if(!eligible.has(actor)||!Number.isFinite(clock)||!Number.isFinite(start))throw Error('Approver is not currently eligible.');
 const candidates:Array<{principalUid:string;mode:ActorVote['mode']}>= [{principalUid:actor,mode:'direct'}];
 for(const a of flow.alternates)if(a.alternateUid===actor&&(
  a.mode==='delegation'?clock>=Date.parse(a.startsAt)&&clock<Date.parse(a.endsAt):clock>=start+a.afterHours*3600000
 ))candidates.push({principalUid:a.principalUid,mode:a.mode});
 for(const c of candidates){
  const step=nextEligibleApprovalStep(e,c.principalUid);
  if(!step)continue;
  // A real person cannot act twice for distinct principals at one level, nor across independent streams.
  if(e.actors.some(v=>v.actorUid===actor&&(v.stream!==step.stream||v.level===step.level)))continue;
  // An already represented principal cannot later take an independent stream under their physical identity.
  if(e.actors.some(v=>v.actorUid===c.principalUid&&v.stream!==step.stream||v.principalUid===actor&&v.stream!==step.stream))continue;
  const next=applyApprovalDecision(e,c.principalUid,decision,at);
  return {...e,status:next.status,votes:next.votes,actors:[...e.actors,{principalUid:c.principalUid,actorUid:actor,stream:step.stream,level:step.level,mode:c.mode,at,note}]};
 }
 throw Error('No outstanding eligible approval level or valid alternate assignment.');
}
export function flowStatus(e:FlowEvidence){return {status:e.status,levels:e.steps.map(step=>({stream:step.stream,level:step.level,required:quorumCount(step.quorum,step.eligibleUserIds.length),votes:e.votes.filter(v=>v.stream===step.stream&&v.level===step.level&&v.decision==='approve').length,complete:isStepApproved(step,e.votes)}))};}
export function approvalFlowOf(d:Obj,key:ApprovalKey){return readMaintenancePolicySnapshot(d.maintenanceGovernance)?.policy[key].flow;}
export const approvalHash=(payload:Record<string,unknown>)=>transactionPayloadHash(payload);
export async function decideMaintenanceFlow(ctx:OrgContext,doc:Doc,key:ApprovalKey,payload:Record<string,unknown>,startedAt:string,previous:unknown,exclude:string[],decision:ApprovalVote['decision'],note:string):Promise<FlowEvidence|null>{
 const flow=approvalFlowOf(doc.data,key);if(!flow)return null;
 if(exclude.includes(ctx.uid))throw new HttpError(403,'Maker-checker independence is required for advanced approvals.');
 const [gate,permission]=GATES[key],path=strings(doc.data.path),data=await responsibilityData(ctx);
 const candidates=scopedApprovalCandidates(data,path,gate,permission,[...new Set(exclude.filter(Boolean))]);
 // A named alternate receives no new role, scope or permission. Verify all actual eligible users.
 const eligible:string[]=[];
 for(const id of candidates){
  const user=data.users.get(id);if(!user||str(user.data.orgId)!==ctx.orgId)continue;
  const role=normalizeOrgRole(str(user.data.role));
  const access=await effectiveAccess(ctx.orgId,role,user,ctx.org.data.modules);
  const candidate={...ctx,uid:id,me:user,role,roleName:access.roleName,permissions:access.permissions,directPermissions:access.directPermissions,grants:access.grants,workGroupPolicy:access.workGroupPolicy,testMode:false} as OrgContext;
  if(canAt(candidate,permission,path,await scopeOf(candidate)))eligible.push(id);
 }
 const hash=transactionPayloadHash(payload),prior=object(previous),requestedBy=exclude.find(Boolean)||'__maintenance_request__';
 let evidence:FlowEvidence;
 try{
  if(prior.payloadHash===hash&&prior.status==='pending'&&prior.orgId===ctx.orgId&&prior.code===CODE[key]&&prior.handlerName===doc.id&&Array.isArray(prior.steps)&&Array.isArray(prior.votes)&&Array.isArray(prior.actors)){
   evidence=prior as unknown as FlowEvidence;
   if(evidence.requestedBy!==requestedBy)throw Error('Approval submitter changed.');
  }else{
   const steps=flowSteps(flow,eligible);
   evidence={orgId:ctx.orgId,code:CODE[key],handlerName:doc.id,requestedBy,payloadHash:hash,status:'pending',steps,votes:[],actors:[],startedAt:Number.isFinite(Date.parse(startedAt))?startedAt:nowIso()};
  }
  const next=flowVote(evidence,flow,ctx.uid,eligible,decision,nowIso(),note);
  if(next.status==='approved'){
   const errors=validateApprovalEvidence(next,{orgId:ctx.orgId,code:CODE[key],handlerName:doc.id,requesterUid:requestedBy,payload});
   if(errors.length)throw Error(errors.join('; '));
  }
  return next;
 }catch(e){throw new HttpError(409,e instanceof Error?e.message:'Approval workflow cannot proceed.');}
}
export function flowPlain(value:FlowEvidence|null):Obj{return value as unknown as Obj;}
