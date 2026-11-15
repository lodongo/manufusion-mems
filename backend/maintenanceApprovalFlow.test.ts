import test from 'node:test';
import assert from 'node:assert/strict';
import {validateApprovalFlow} from './maintenanceApprovalFlowPolicy';
import {flowSteps,flowVote,type FlowEvidence} from './maintenanceApprovalFlow';
import {transactionPayloadHash,validateApprovalEvidence} from './unifiedApprovalProof';
const at='2026-11-15T00:00:00Z',payload={record:'WO00000001',version:1};
const base=(steps:FlowEvidence['steps']):FlowEvidence=>({orgId:'org',code:'MNT-WOR-AP',handlerName:'WO00000001',requestedBy:'maker',payloadHash:transactionPayloadHash(payload),status:'pending',steps,votes:[],actors:[],startedAt:at});
test('shared engine handles fixed quorum, sequential and independent parallel streams',()=>{
 const flow=validateApprovalFlow({steps:[{stream:'main',level:1,quorum:{mode:'count',value:2},approverUids:['a','b']},{stream:'main',level:2,quorum:{mode:'all'},approverUids:['c']},{stream:'parallel',level:1,quorum:{mode:'any'},approverUids:['d']}],alternates:[]});
 const pool=['a','b','c','d'];let e=base(flowSteps(flow,pool));
 assert.throws(()=>flowVote(e,flow,'c',pool,'approve',at,'out of order'));
 e=flowVote(e,flow,'d',pool,'approve',at,'parallel');e=flowVote(e,flow,'a',pool,'approve',at,'first');
 assert.equal(e.status,'pending');assert.throws(()=>flowVote(e,flow,'a',pool,'approve',at,'duplicate'));
 e=flowVote(e,flow,'b',pool,'approve',at,'second');e=flowVote(e,flow,'c',pool,'approve',at,'level two');assert.equal(e.status,'approved');
 assert.deepEqual(validateApprovalEvidence(e,{orgId:'org',code:'MNT-WOR-AP',handlerName:'WO00000001',requesterUid:'maker',payload}),[]);
});
test('time-bounded delegation and overdue escalation substitute a seat, not add a vote',()=>{
 const flow=validateApprovalFlow({steps:[{stream:'main',level:1,quorum:{mode:'all'},approverUids:['a','b']}],alternates:[{principalUid:'a',alternateUid:'x',mode:'delegation',startsAt:at,endsAt:'2026-11-16T00:00:00Z',afterHours:0},{principalUid:'b',alternateUid:'y',mode:'escalation',afterHours:2,startsAt:'',endsAt:''}]});
 const pool=['a','b','x','y'],e=base(flowSteps(flow,pool));
 assert.throws(()=>flowVote(e,flow,'y',pool,'approve',at,'too early'));
 assert.throws(()=>flowVote(e,flow,'x',['a','b'],'approve',at,'scope missing'));
 assert.throws(()=>flowVote(e,flow,'x',pool,'approve','2026-11-17T00:00:00Z','expired'));
 const one=flowVote(e,flow,'x',pool,'approve',at,'delegated');assert.equal(one.actors[0].principalUid,'a');assert.equal(one.status,'pending');
 assert.throws(()=>flowVote(one,flow,'a',pool,'approve',at,'double counted'));
 const final=flowVote(one,flow,'y',pool,'approve','2026-11-15T02:00:00Z','escalation');assert.equal(final.status,'approved');assert.equal(final.actors[1].mode,'escalation');
});
test('invalid configurations and impossible scoped quorums fail closed',()=>{
 assert.throws(()=>validateApprovalFlow({steps:[{stream:'main',level:2,quorum:{mode:'any'},approverUids:[]}],alternates:[]}));
 const flow=validateApprovalFlow({steps:[{stream:'main',level:1,quorum:{mode:'count',value:2},approverUids:['a','b']}],alternates:[]});
 assert.throws(()=>flowSteps(flow,['a']));
});
