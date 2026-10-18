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
    const step=e.steps.find(s=>s.stream===v.stream&&s.level===v.level);
    if(!step || !step.eligibleUserIds.includes(v.uid))errors.push('Decision by an ineligible approver');
    if(v.decision!=='approve')errors.push('Approval contains a return or rejection');
    if(!Number.isFinite(Date.parse(v.decidedAt)))errors.push('Decision time missing');
  }
  return errors;
}
