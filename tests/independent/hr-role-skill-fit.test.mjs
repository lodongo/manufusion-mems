import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSkillFit,buildFitIndex,requiredRoleSkills} from '../../backend/hrSkillFit.ts';

const position=(id,codes)=>({id,data:{title:id,coreSkills:codes}});
const user=(id,positionCode)=>({id,data:{
 assignments:[{type:'primary',nodeId:'DEPT',positionCode}]
}});
const proposal=(id,uid,code,status)=>({id,data:{employeeUid:uid,skillCode:code,status}});
test('fit uses distinct role-required skills and manager-approved evidence only',()=>{
 const roles=[position('ELEC',['M1','M2','M2','M3','M4'])];
 const u=user('emp','ELEC');
 const index=buildFitIndex([u],roles,[
   proposal('a','emp','M1','approved'),proposal('b','emp','M2','pending'),
   proposal('c','emp','M3','rejected'),proposal('d','emp','M9','approved'),
   proposal('e','emp','M1','approved'),proposal('f','other','M2','approved'),
 ]);
 const fit=index.get('emp');
 assert.ok(fit);
 assert.equal(fit.percentage,25);
 assert.equal(fit.confirmed,1);
 assert.equal(fit.required,4);
 assert.equal(fit.pending,1);
 assert.deepEqual(fit.missingCodes,['M2','M3','M4']);
 assert.deepEqual(fit.confirmedCodes,['M1','M9']);
});
test('no configured role skills is not displayed as full fit',()=>{
 const u=user('emp','MISSING');
 const fit=makeSkillFit('emp',u.data,new Map(),[proposal('x','emp','M1','approved')]);
 assert.equal(fit.percentage,null);
 assert.equal(fit.required,0);
 assert.equal(fit.confirmed,0);
});
test('multiple primary role skills combine without double counting',()=>{
 const data={assignments:[
   {type:'primary',positionCode:'A'}, {type:'primary',positionCode:'B'},
   {type:'secondary',positionCode:'C'},
 ]};
 const required=requiredRoleSkills(data,new Map([
   ['A',{coreSkills:['A1','COMMON']}],['B',{coreSkills:['B1','COMMON']}],
   ['C',{coreSkills:['INELIGIBLE']}],
 ]));
 assert.deepEqual(required,['A1','COMMON','B1']);
});
