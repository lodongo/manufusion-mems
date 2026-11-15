/** Pure maintenance adapter to the enterprise quorum and vote functions. */
import {str,nowIso,type Obj} from './core';
import {readMaintenancePolicySnapshot,configuredOrderApprovalStage,type ApprovalKey} from './maintenanceGovernancePolicy';
import {quorumCount} from './governanceCore';
import {applyApprovalDecision,nextEligibleApprovalStep,isStepApproved,transactionPayloadHash,type ApprovalEvidence,type ApprovalStep,type ApprovalVote} from './unifiedApprovalProof';
import type {ApprovalFlow} from './maintenanceApprovalFlowPolicy';
export const GATES:Record<ApprovalKey,[string,string]>={workRequest:['MNT.WR.APPROVAL','MNT.WR.approve'],workOrder:['MNT.ASSESS.REVIEW','MNT.assessment.review'],technicalClosure:['MNT.WO.CLOSE_APPROVAL','MNT.WO.technicalApprove']};
export const CODE:Record<ApprovalKey,string>={workRequest:'MNT-WRQ-AP',workOrder:'MNT-WOR-AP',technicalClosure:'MNT-WOR-CL'};
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const strings=(v:unknown)=>Array.isArray(v)?v.map(str).filter(Boolean):[];

type Stage=NonNullable<ReturnType<typeof configuredOrderApprovalStage>>;
export function stageApprovalFingerprint(d:Obj,stage:Stage,schema=2):string{
 const base={policyVersion:readMaintenancePolicySnapshot(d.maintenanceGovernance)?.version,code:d.code,unitId:d.unitId,wrCode:d.wrCode,stage};
 if(stage==='before_assessment')return transactionPayloadHash({...base,requestConfirmation:d.requestConfirmation,initialScheduledStart:d.initialScheduledStart,initialScheduledEnd:d.initialScheduledEnd,...(schema>=2?{initialApprovalFacts:d.initialApprovalFacts}:{})});
 return transactionPayloadHash({...base,assessmentTasksVersion:d.assessmentTasksVersion,assessmentTasksAt:d.assessmentTasksAt,assessedAt:d.assessedAt,readiness:d.readiness,estimatedCost:d.costPlan,costApproval:d.costApproval,scheduledStart:d.scheduledStart,scheduledEnd:d.scheduledEnd,taskPlanning:d.taskPlanning,...(stage==='before_execution'?{taskWindows:d.taskWindows,windowId:d.windowId,...(schema>=2?{windowStart:d.windowStart,windowEnd:d.windowEnd,windowApprovalRevision:d.windowApprovalRevision}: {})}: {})});
}

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

export function approvalInput(d:Obj,key:ApprovalKey){
 if(key==='workRequest'){
  const pending=object(d.requestApproval);
  return {payload:{policyVersion:pending.policyVersion,submittedAt:pending.submittedAt,submittedBy:pending.submittedBy,maintenanceTypeCode:pending.maintenanceTypeCode,scheduledStart:pending.scheduledStart,scheduledEnd:pending.scheduledEnd,title:d.title,description:d.description},startedAt:str(pending.submittedAt),previous:pending.flow,exclude:[str(d.requestedBy),str(pending.submittedBy)]};
 }
 if(key==='technicalClosure'){
  const pending=object(d.technicalClosurePending);
  return {payload:{policyVersion:pending.policyVersion,at:pending.at,mode:pending.mode,safetySignoff:d.safetySignoff,taskExecution:d.taskExecution,serviceReports:d.serviceReports,earlyClosureRequest:d.earlyClosureRequest},startedAt:str(pending.at),previous:pending.flow,exclude:[...new Set([str(pending.by),str(object(d.safetySignoff).by),...Object.values(object(d.taskExecution)).flatMap(e=>strings(object(e).performers)),...(Array.isArray(d.timeLogs)?d.timeLogs.map(e=>str(object(e).uid)):[])].filter(Boolean))]};
 }
 const stage=configuredOrderApprovalStage(d);
 if(stage)return {payload:{fingerprint:stageApprovalFingerprint(d,stage)},startedAt:str(d.workflowSince)||str(d.createdAt),previous:object(d.stageApproval).flow,exclude:[d.requestedBy,d.createdBy,...(stage==='before_assessment'?[]:[d.assessedBy,d.assessmentTasksBy,d.plannedBy,object(d.readiness).by])].map(str).filter(Boolean)};
 return {payload:{policyVersion:readMaintenancePolicySnapshot(d.maintenanceGovernance)?.version,assessmentTasksVersion:d.assessmentTasksVersion,assessmentTasksAt:d.assessmentTasksAt,assessedAt:d.assessedAt},startedAt:str(d.assessmentTasksAt),previous:object(d.assessmentReview).flow,exclude:[str(d.requestedBy),str(d.assessedBy),str(d.assessmentTasksBy),...(d.executionMode==='confirmed_request'?[]:[str(d.createdBy)])]};
}
export function evidenceFor(flow:ApprovalFlow,orgId:string,docId:string,key:ApprovalKey,payload:Record<string,unknown>,startedAt:string,previous:unknown,exclude:string[],eligible:string[],now=nowIso()):FlowEvidence{
 const hash=transactionPayloadHash(payload),prior=object(previous),requestedBy=exclude.find(Boolean)||'__maintenance_request__';
 if(prior.payloadHash===hash&&prior.status==='pending'&&prior.orgId===orgId&&prior.code===CODE[key]&&prior.handlerName===docId&&Array.isArray(prior.steps)&&Array.isArray(prior.votes)&&Array.isArray(prior.actors)){
  const evidence=prior as unknown as FlowEvidence;
  if(evidence.requestedBy!==requestedBy)throw Error('Approval submitter changed.');
  return evidence;
 }
 return {orgId,code:CODE[key],handlerName:docId,requestedBy,payloadHash:hash,status:'pending',steps:flowSteps(flow,eligible),votes:[],actors:[],startedAt:Number.isFinite(Date.parse(startedAt))?startedAt:now};
}
export function pendingFlowPreview(flow:ApprovalFlow,evidence:FlowEvidence,eligible:string[],now:string){
 const actions=eligible.flatMap(actorUid=>{
  try{const vote=flowVote(evidence,flow,actorUid,eligible,'approve',now,'preview').actors.at(-1)!;return [{actorUid,principalUid:vote.principalUid,stream:vote.stream,level:vote.level,mode:vote.mode}];}catch{return [];}
 });
 const escalationDue=flow.alternates.filter(a=>a.mode==='escalation'&&evidence.steps.some(s=>s.eligibleUserIds.includes(a.principalUid)&&!isStepApproved(s,evidence.votes)&&!evidence.votes.some(v=>v.uid===a.principalUid&&v.stream===s.stream&&v.level===s.level))).map(a=>({principalUid:a.principalUid,alternateUid:a.alternateUid,dueAt:new Date(Date.parse(evidence.startedAt)+a.afterHours*3600000).toISOString()}));
 return {evidence,actions,escalationDue};
}
