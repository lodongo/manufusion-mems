/**
 * Server-verifiable approval evidence bound to the exact business API payload.
 * Request data is never accepted as proof of its own approval.
 */
import { createHash } from 'node:crypto';
import { quorumCount, type ApprovalQuorum } from './governanceCore';

export type ApprovalStep = {
  stream: string; level: number; quorum: ApprovalQuorum;
  eligibleUserIds: string[];
};
export type ApprovalVote = {
  uid: string; stream: string; level: number;
  decision: 'approve' | 'reject' | 'return';
  decidedAt: string;
};
export type ApprovalEvidence = {
  orgId: string; code: string; handlerName: string;
  requestedBy: string; payloadHash: string;
  status: string; steps: ApprovalStep[]; votes: ApprovalVote[];
};

function normalize(value: unknown): unknown {
  if(Array.isArray(value))return value.map(normalize);
  if(value && typeof value==='object') {
    const src=value as Record<string,unknown>;
    return Object.fromEntries(Object.keys(src).filter(k=>src[k]!==undefined).sort()
      .map(k=>[k,normalize(src[k])]));
  }
  return value;
}
/** A stable digest of the business input, excluding only authentication/proof tokens. */
export function transactionPayloadHash(body:Record<string,unknown>):string {
  const clean=Object.fromEntries(Object.entries(body)
    .filter(([key])=>key!=='idToken'&&key!=='governanceApprovalId'));
  return createHash('sha256').update(JSON.stringify(normalize(clean))).digest('hex');
}
export function isStepApproved(step:ApprovalStep,votes:readonly ApprovalVote[]):boolean {
  const eligible=new Set(step.eligibleUserIds);
  if(eligible.size!==step.eligibleUserIds.length)return false;
  let required:number;
  try{required=quorumCount(step.quorum,eligible.size)}
  catch{return false}
  const approved=new Set(votes.filter(v=>v.stream===step.stream&&v.level===step.level&&
    v.decision==='approve'&&eligible.has(v.uid)).map(v=>v.uid));
  return approved.size>=required;
}
export function validateApprovalEvidence(e:ApprovalEvidence,context:{
  orgId:string;code:string;handlerName:string;requesterUid:string;
  payload:Record<string,unknown>;
}):string[] {
  const errors:string[]=[];
  if(e.orgId!==context.orgId || e.code!==context.code || e.handlerName!==context.handlerName)
    errors.push('Approval belongs to another organization or transaction');
  if(e.requestedBy!==context.requesterUid)errors.push('Approval belongs to another requester');
  if(e.payloadHash!==transactionPayloadHash(context.payload))errors.push('Transaction inputs changed after approval');
  if(e.status!=='approved')errors.push('Approval has not completed');
  if(!Array.isArray(e.steps)||!e.steps.length||!Array.isArray(e.votes))return [...errors,'Approval step history missing'];
  const steps=new Set<string>(), voted=new Set<string>();
  for(const step of e.steps){
    const key=step.stream+':'+step.level;
    if(!step.stream||!Number.isSafeInteger(step.level)||step.level<1||steps.has(key))errors.push('Invalid or duplicate approval level');
    steps.add(key);
    if(step.eligibleUserIds.includes(e.requestedBy))errors.push('Creator is included in approver group');
    if(!isStepApproved(step,e.votes))errors.push('Required approval quorum is unsatisfied');
  }
  for(const v of e.votes){
    const key=v.uid+':'+v.stream+':'+v.level;
    if(voted.has(key))errors.push('Duplicate decision by an approver');
    voted.add(key);
    if(v.uid===e.requestedBy)errors.push('Creator cannot approve their own transaction');
    if(streamByApprover.has(v.uid)&&streamByApprover.get(v.uid)!==v.stream)
      errors.push('Independent approval streams require distinct human approvers');
    streamByApprover.set(v.uid,v.stream);
    const step=e.steps.find(s=>s.stream===v.stream&&s.level===v.level);
    if(!step || !step.eligibleUserIds.includes(v.uid))errors.push('Decision by an ineligible approver');
    if(v.decision!=='approve')errors.push('Approval contains a return or rejection');
    if(!Number.isFinite(Date.parse(v.decidedAt)))errors.push('Decision time missing');
  }
  return errors;
}

/** Independent streams can run in parallel; levels in each stream are sequential. */
export function nextEligibleApprovalStep(e:ApprovalEvidence,uid:string):ApprovalStep|null {
  if(e.status!=='pending'||e.requestedBy===uid)return null;
  for(const step of e.steps){
    if(isStepApproved(step,e.votes))continue;
    if(e.steps.some(other=>other.stream===step.stream&&other.level<step.level&&!isStepApproved(other,e.votes)))continue;
    if(step.eligibleUserIds.includes(uid)&&
      !e.votes.some(v=>v.uid===uid&&v.stream!==step.stream)&&
      !e.votes.some(v=>v.uid===uid&&v.stream===step.stream&&v.level===step.level))
      return step;
  }
  return null;
}
export function applyApprovalDecision(e:ApprovalEvidence,uid:string,decision:ApprovalVote['decision'],decidedAt:string):
  {status:'pending'|'approved'|'rejected'|'returned';votes:ApprovalVote[];step:ApprovalStep} {
  const step=nextEligibleApprovalStep(e,uid);
  if(!step)throw new Error('Approver is not eligible for an outstanding level');
  if(!['approve','reject','return'].includes(decision)||!Number.isFinite(Date.parse(decidedAt)))
    throw new Error('Invalid approver decision');
  const votes=[...e.votes,{uid,stream:step.stream,level:step.level,decision,decidedAt}];
  const status=decision==='reject'?'rejected':decision==='return'?'returned':
    e.steps.every(s=>isStepApproved(s,votes))?'approved':'pending';
  return {status,votes,step};
}
