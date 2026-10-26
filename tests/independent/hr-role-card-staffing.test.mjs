import test from 'node:test';
import assert from 'node:assert/strict';
import {computeRoleStaffing} from '../../backend/hrRoleStaffingOutlook.ts';
import {roleHierarchy,roleTrail,vacancyOutlook} from '../../src/org/hrRoleHierarchy.ts';
const person=(id,role,node,status='active',other=[])=>({
 id,data:{status,assignments:[{positionCode:role,nodeId:node,type:'primary'},...other]},
});
test('counts distinct mapped employees and vacancies per approved unit, not a misleading net offset',()=>{
 const people=[
  person('u1','ROL_1','NBO'),person('u2','ROL_1','NBO'),person('u3','ROL_1','MSA'),
  person('u4','ROL_1','OLD'),person('u5','ROL_1','NBO','disabled'),
  person('u6','ROL_2','NBO'),
 ];
 const summary=computeRoleStaffing('ROL_1',[
  {nodeId:'NBO',enabled:true,required:1},{nodeId:'MSA',enabled:true,required:3},
  {nodeId:'OLD',enabled:false,required:1},
 ],people,new Map([['NBO','Nairobi'],['MSA','Mombasa']]),'2026-10-26');
 assert.equal(summary.mappedEmployees,4);
 assert.equal(summary.approved,4);
 assert.equal(summary.filledInPlan,3);
 assert.equal(summary.vacant,2);
 assert.equal(summary.surplus,1);
 assert.equal(summary.unplanned,1);
 assert.equal(summary.enabledUnits,2);
 assert.deepEqual(summary.units.map(u=>u.name),['Mombasa','Nairobi']);
});
test('unknown headcount is not reported as zero vacancies; temporary acting is separate',()=>{
 const summary=computeRoleStaffing('ROL_1',[],[
  person('u1','ROL_1','NBO','active',[{positionCode:'ROL_1',nodeId:'NBO',type:'acting',startsOn:'2026-10-01',endsOn:'2026-11-01'}]),
 ],new Map(),'2026-10-26');
 assert.equal(summary.mappedEmployees,1);
 assert.equal(summary.temporaryAssignments,1);
 assert.equal(summary.unplanned,1);
 assert.equal(summary.approved,null);
 assert.equal(summary.vacant,null);
 assert.equal(summary.surplus,null);
});
test('role hierarchy starts at highest reporting roles and handles unknown parents',()=>{
 const roles=[
  {code:'ROOT',title:'CEO',parentCode:'',operatingLevel:'group'},
  {code:'COO',title:'COO',parentCode:'ROOT',operatingLevel:'group'},
  {code:'ENG',title:'Engineer',parentCode:'COO',operatingLevel:'site'},
  {code:'ORPHAN',title:'Orphan',parentCode:'MISSING',operatingLevel:'site'},
 ].map(x=>({...x,description:'',defaultNodeId:'',requiredSkillCount:0,gradeMappings:0,staffing:null}));
 const index=roleHierarchy([...roles].reverse());
 assert.deepEqual(index.roots.map(x=>x.code),['ROOT','ORPHAN']);
 assert.deepEqual(index.children.get('ROOT').map(x=>x.code),['COO']);
 assert.deepEqual(roleTrail('ENG',index),['ROOT','COO','ENG']);
 assert.equal(vacancyOutlook(roles[0]).label,'Staffing restricted');
 assert.equal(vacancyOutlook({...roles[0],staffing:{approved:null}}).label,'Plan not configured');
});
test('cyclic reporting references remain discoverable without infinite traversal',()=>{
 const roles=['A','B'].map((code,i)=>({code,title:code,parentCode:i?'A':'B',operatingLevel:'',description:'',defaultNodeId:'',requiredSkillCount:0,gradeMappings:0,staffing:null}));
 const index=roleHierarchy(roles);
 assert.ok(index.roots.length>0);
 assert.equal(new Set(roleTrail('A',index)).size,2);
});
