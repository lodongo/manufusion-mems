import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStepApproved,transactionPayloadHash,validateApprovalEvidence,
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
