import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStepApproved,transactionPayloadHash,validateApprovalEvidence,applyApprovalDecision,nextEligibleApprovalStep,
  type ApprovalEvidence,
} from './unifiedApprovalProof';
const payload={materialId:'MAT-123',amount:12500,currency:'KES',idToken:'session-a'};
const context={
  orgId:'org-a',code:'PRC-PUR-ABC12345',handlerName:'org.prc.po.post',
  requesterUid:'user-a',payload,
};
const proof:ApprovalEvidence={
  orgId:context.orgId,code:context.code,handlerName:context.handlerName,
  requestedBy:'user-a',payloadHash:transactionPayloadHash(payload),status:'approved',
  steps:[{stream:'FINANCE',level:1,quorum:{mode:'count',value:2},eligibleUserIds:['u1','u2','u3']}],
  votes:[
    {uid:'u1',stream:'FINANCE',level:1,decision:'approve',decidedAt:'2026-10-18T09:00:00Z'},
    {uid:'u2',stream:'FINANCE',level:1,decision:'approve',decidedAt:'2026-10-18T09:10:00Z'},
  ],
};
test('approval belongs to a tenant, transaction, requester and exact payload',()=>{
  assert.deepEqual(validateApprovalEvidence(proof,context),[]);
  assert.notEqual(transactionPayloadHash({...payload,amount:13000}),proof.payloadHash);
  assert.equal(transactionPayloadHash({...payload,idToken:'renewed',governanceApprovalId:'ref-a'}),proof.payloadHash);
  assert.ok(validateApprovalEvidence(proof,{...context,payload:{...payload,amount:13000}}).length);
  assert.ok(validateApprovalEvidence(proof,{...context,orgId:'org-b'}).length);
  assert.ok(validateApprovalEvidence(proof,{...context,requesterUid:'other'}).length);
});
test('quorum requires distinct eligible humans; denies self, duplicates and rejected votes',()=>{
  assert.equal(isStepApproved(proof.steps[0],proof.votes),true);
  assert.ok(validateApprovalEvidence({...proof,votes:proof.votes.slice(0,1)},context).length);
  assert.ok(validateApprovalEvidence({...proof,votes:[...proof.votes,proof.votes[0]]},context).length);
  assert.ok(validateApprovalEvidence({...proof,votes:[...proof.votes,{uid:'u3',stream:'FINANCE',level:1,decision:'reject',decidedAt:'2026-10-18T09:11:00Z'}]},context).length);
  assert.ok(validateApprovalEvidence({...proof,steps:[{...proof.steps[0],eligibleUserIds:['user-a','u1','u2']}]},context).length);
  assert.ok(validateApprovalEvidence({...proof,status:'executed'},context).length);
});

test('approval state machine enforces sequential levels and parallel specialist streams',()=>{
  const e:ApprovalEvidence={
    ...proof,status:'pending',votes:[],
    steps:[
      {stream:'FINANCE',level:1,quorum:{mode:'count',value:2},eligibleUserIds:['u1','u2']},
      {stream:'FINANCE',level:2,quorum:{mode:'any'},eligibleUserIds:['u3']},
      {stream:'SAFETY',level:1,quorum:{mode:'any'},eligibleUserIds:['u4']},
    ],
  };
  assert.equal(nextEligibleApprovalStep(e,'u3'),null);
  const s1=applyApprovalDecision(e,'u4','approve','2026-10-18T09:00:00Z');
  assert.equal(s1.status,'pending');
  const s2=applyApprovalDecision({...e,votes:s1.votes},'u1','approve','2026-10-18T09:01:00Z');
  assert.equal(s2.status,'pending');
  assert.equal(nextEligibleApprovalStep({...e,votes:s2.votes},'u3'),null);
  const s3=applyApprovalDecision({...e,votes:s2.votes},'u2','approve','2026-10-18T09:02:00Z');
  assert.equal(s3.status,'pending');
  const s4=applyApprovalDecision({...e,votes:s3.votes},'u3','approve','2026-10-18T09:03:00Z');
  assert.equal(s4.status,'approved');
  assert.equal(validateApprovalEvidence({...e,status:'approved',votes:s4.votes},context).length,0);
  assert.throws(()=>applyApprovalDecision({...e,votes:s3.votes},'user-a','approve','2026-10-18T09:04:00Z'));
  assert.throws(()=>applyApprovalDecision({...e,votes:s3.votes},'u1','approve','2026-10-18T09:04:00Z'));
});

test('independent streams prohibit a single person approving both financial and specialist obligations',()=>{
  const a:ApprovalEvidence={
    ...proof,status:'pending',votes:[],steps:[
      {stream:'FINANCE',level:1,quorum:{mode:'any'},eligibleUserIds:['u1']},
      {stream:'SAFETY',level:1,quorum:{mode:'any'},eligibleUserIds:['u1','u2']},
    ],
  };
  const first=applyApprovalDecision(a,'u1','approve','2026-10-18T09:00:00Z');
  assert.equal(nextEligibleApprovalStep({...a,votes:first.votes},'u1'),null);
  const second=applyApprovalDecision({...a,votes:first.votes},'u2','approve','2026-10-18T09:01:00Z');
  assert.equal(second.status,'approved');
  assert.equal(validateApprovalEvidence({...a,status:'approved',votes:second.votes},context).length,0);
  const forged={...a,status:'approved',votes:[...first.votes,{uid:'u1',stream:'SAFETY',level:1,decision:'approve' as const,decidedAt:'2026-10-18T09:01:00Z'}]};
  assert.ok(validateApprovalEvidence(forged,context).some(m=>m.includes('distinct human')));
});
