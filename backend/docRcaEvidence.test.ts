import assert from 'node:assert/strict';
import test from 'node:test';
import {findingsValid,checksValid} from './docRcaEvidence';
const evidence=new Set(['E1','E2']);
test('analyze causes require registered evidence and meaningful verification rationale',()=>{
 const finding={cause:'Insufficient bearing lubrication',status:'verified',evidenceIds:['E1'],verificationRationale:'Measured oil flow below required design value'};
 assert.equal(findingsValid([finding],evidence),true);
 assert.equal(findingsValid([{...finding,evidenceIds:['E9']}],evidence),false);
 assert.equal(findingsValid([{...finding,verificationRationale:''}],evidence),false);
});
test('control rejects pending or failing results, unknown evidence and missing verifier',()=>{
 const check={criterion:'No recurrence during agreed monitoring window',result:'pass',evidenceIds:['E2'],verifiedBy:'Reliability Engineer',verifiedAt:'2026-10-21T06:00:00.000Z'};
 assert.equal(checksValid([check],evidence),true);
 assert.equal(checksValid([{...check,result:'fail'}],evidence),false);
 assert.equal(checksValid([{...check,evidenceIds:['UNKNOWN']}],evidence),false);
 assert.equal(checksValid([{...check,verifiedBy:''}],evidence),false);
});
