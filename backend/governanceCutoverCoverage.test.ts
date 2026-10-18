import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateCutoverCoverage,validateBinding} from './governanceCutoverCoverage';
import type {WiredTransaction} from './transactionRuntime';

const route=(code:string,name:string,permission:string|null):WiredTransaction=>({
  method:'POST',path:'/api/org/'+name.replaceAll('.','/'),name,permission,
  module:'MNT',area:'WOR',code,handlerWired:true,guard:'organization',activationCertified:false,
});
const a=route('MNT-WOR-ABC12345','org.mnt.wo.close','MNT.WO.close');
const binding=(r:WiredTransaction,classification:'permission_only'|'approval_required'='permission_only')=>({
  code:r.code,handlerName:r.name,permission:r.permission,module:r.module,area:r.area,
  status:'active',classification,configuredBy:'author-a',approvedBy:'reviewer-b',
  handlerEvidenceId:'test-handler',scopeEvidenceId:'test-scope',
  sodEvidenceId:'test-sod',version:1,
});
test('release readiness fails closed until EVERY installed handler has a matching reviewed binding',()=>{
  const b=route('MNT-WOR-DEF12345','org.mnt.wo.plan','MNT.WO.plan');
  const result=evaluateCutoverCoverage([a,b],new Map([[a.code!,binding(a)]]),new Map());
  assert.equal(result.inspected,2);
  assert.equal(result.ready,1);
  assert.equal(result.blocked,1);
  assert.equal(result.canActivate,false);
  assert.ok(result.items[1].issues.some(x=>x.includes('binding')));
  const passed=evaluateCutoverCoverage([a,b],new Map([[a.code!,binding(a)],[b.code!,binding(b)]]),new Map());
  assert.equal(passed.canActivate,true);
  assert.equal(passed.coveragePercent,100);
  assert.notEqual(passed.digest,result.digest);
});
test('mapping rejects unverified future handlers, duplicate handler names, self-approval and missing SoD',()=>{
  assert.ok(validateBinding(a,{...binding(a),approvedBy:'author-a'}).some(x=>x.includes('reviewed')));
  assert.ok(validateBinding(a,{...binding(a),sodEvidenceId:''}).some(x=>x.includes('evidence')));
  assert.equal(evaluateCutoverCoverage([a,{...a,code:'MNT-WOR-ZZZ12345'}],
    new Map([[a.code!,binding(a)],['MNT-WOR-ZZZ12345',binding({...a,code:'MNT-WOR-ZZZ12345'})]]),new Map()).canActivate,false);
  assert.ok(validateBinding({...a,permission:null},binding(a)).length);
});
test('approval classified transaction requires independently reviewed authority rules',()=>{
  const bindings=new Map([[a.code!,binding(a,'approval_required')]]);
  assert.equal(evaluateCutoverCoverage([a],bindings,new Map()).canActivate,false);
  const authority={status:'active',configuredBy:'a',approvedBy:'b',rules:[{id:'FIN1'}],approversByLevel:{'FINANCE:1':['u1']},version:1};
  const ready=evaluateCutoverCoverage([a],bindings,new Map([[a.code!,authority]]));
  assert.equal(ready.canActivate,true);
  const changed=evaluateCutoverCoverage([a],bindings,new Map([[a.code!,{...authority,version:2}]]));
  assert.notEqual(ready.digest,changed.digest);
});
test('control-plane endpoints do not deadlock the cutover validation',()=>{
  const control=route('ADM-GOA-EEE12345','org.governance.cutover.status','ADM.workflows');
  assert.equal(evaluateCutoverCoverage([a,control],new Map([[a.code!,binding(a)]]),new Map()).canActivate,true);
  assert.equal(evaluateCutoverCoverage([control],new Map(),new Map()).canActivate,false);
});
