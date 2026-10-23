import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveHrManager} from '../../backend/hrManagerResolver.ts';

const nodes=new Map([
 ['LE',{level:'legal_entity',parentId:'root',status:'active',managerRoleCode:'ROL_001'}],
 ['SITE',{level:'site',parentId:'LE',status:'active',managerRoleCode:'ROL_010'}],
 ['DEPT',{level:'department',parentId:'SITE',status:'active',managerRoleCode:''}],
 ['CC',{level:'cost_center',parentId:'DEPT',status:'active',managerRoleCode:'ROL_030'}],
]);
const user=(uid,nodeId,positionCode)=>({
 id:uid,data:{uid,orgId:'test',status:'active',
 assignments:[{type:'primary',nodeId,positionCode}]},
});
const employee=user('employee','CC','ROL_100');
const planner=user('line-manager','SITE','ROL_030');
const siteManager=user('site-manager','SITE','ROL_010');
const legalManager=user('legal-manager','LE','ROL_001');
test('configured cost centre manager role resolves site-scoped holder (not legacy managerUid)',()=>{
 const r=resolveHrManager('employee',employee.data,nodes,[employee,planner,siteManager,legalManager]);
 assert.deepEqual({uid:r.uid,reason:r.reason,roleCode:r.roleCode},
  {uid:'line-manager',reason:'resolved',roleCode:'ROL_030'});
});
test('missing cost centre role occupant elevates to verified site manager',()=>{
 const r=resolveHrManager('employee',employee.data,nodes,[employee,siteManager,legalManager]);
 assert.equal(r.uid,'site-manager');
});
test('multiple holders of same manager role never auto-approve one another',()=>{
 const duplicate=user('second-line-manager','SITE','ROL_030');
 const r=resolveHrManager('employee',employee.data,nodes,[employee,planner,duplicate,siteManager]);
 assert.equal(r.uid,'');
 assert.equal(r.reason,'ambiguous');
});
test('role holder with wrong node scope cannot manage cost centre',()=>{
 const incorrect=user('wrong-scope','DEPT','ROL_030');
 const r=resolveHrManager('employee',employee.data,nodes,[employee,incorrect,siteManager]);
 assert.equal(r.uid,'site-manager');
});
test('self cannot be their own immediate manager',()=>{
 const selfLine=user('employee','CC','ROL_100');
 selfLine.data.assignments.push({type:'primary',nodeId:'SITE',positionCode:'ROL_030'});
 const r=resolveHrManager('employee',selfLine.data,nodes,[selfLine,siteManager]);
 assert.equal(r.uid,'site-manager');
});
test('legacy managerUid remains supported for older tenant structures',()=>{
 const old=new Map(nodes);
 old.set('CC',{...old.get('CC'),managerRoleCode:'',managerUid:'line-manager'});
 const r=resolveHrManager('employee',employee.data,old,[employee,planner,siteManager]);
 assert.equal(r.uid,'line-manager');
});
