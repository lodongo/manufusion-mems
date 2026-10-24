import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCorporateStructure,modelFor,validateCorporateStructure,
  type StructureReferences,type CorporateHomeAssignment,type ModelOverride,
} from './corporateStructure';

const refs:StructureReferences={
 nodes:[
  {id:'leA',code:'LEA',name:'Entity A',level:'legal_entity',parentId:'',status:'active'},
  {id:'leB',code:'LEB',name:'Entity B',level:'legal_entity',parentId:'',status:'active'},
  {id:'siteA',code:'SITA',name:'A Site',level:'site',parentId:'leA',status:'active'},
  {id:'siteB',code:'SITB',name:'B Site',level:'site',parentId:'leB',status:'active'},
  {id:'depA',code:'DPA',name:'A Dept',level:'department',parentId:'siteA',status:'active'},
  {id:'depB',code:'DPB',name:'B Dept',level:'department',parentId:'siteB',status:'active'},
  {id:'ccA',code:'CCA',name:'A Cost Center',level:'cost_center',parentId:'depA',status:'active'},
  {id:'ccB',code:'CCB',name:'B Cost Center',level:'cost_center',parentId:'depB',status:'active'},
  {id:'ccDead',code:'INACTIVE',name:'Inactive',level:'cost_center',parentId:'depA',status:'inactive'},
 ],
 functions:[{code:'ENG',name:'Group Engineering',enabled:true},{code:'HR',name:'Group HR',enabled:true}],
 positions:[{code:'PDIR',name:'Group Engineering Director'}],
};
const assignment=():CorporateHomeAssignment=>({
 id:'a1',subjectType:'position',subjectCode:'PDIR',operatingNodeIds:['leA','leB'],
 reportingFunctionCode:'ENG',employingLegalEntityId:'leA',administrativeNodeId:'depA',
 payrollLegalEntityId:'leA',payingLegalEntityId:'leA',
 financialLegalEntityId:'leA',financialCostCenterId:'ccA',
 budgetLegalEntityId:'leB',budgetCostCenterId:'ccB',
 fundingLegalEntityId:'leB',
 beneficiaries:[{legalEntityId:'leA',costCenterId:'ccA',percentage:20},{legalEntityId:'leB',costCenterId:'ccB',percentage:80}],
 effectiveFrom:'2026-11-01',effectiveTo:'2027-10-31',rationale:'Shared services recorded independently of oversight.',
});
const override=(scope:ModelOverride['scope'],legalEntityId:string,functionCode:string,model:ModelOverride['model']):ModelOverride=>({
 id:scope,scope,legalEntityId,functionCode,model,effectiveFrom:'2026-01-01',effectiveTo:'',
});
test('P1 defaults to hybrid without creating any accounting authorization',()=>{
 const d=defaultCorporateStructure();
 assert.equal(d.defaultModel,'HYB');
 assert.equal(d.status,'draft');
 assert.equal(d.assignments.length,0);
 assert.deepEqual(validateCorporateStructure(d,refs).assignments,[]);
});
test('P1 can map one group position to two overseen entities but only one employer',()=>{
 const d=defaultCorporateStructure();d.assignments=[assignment()];
 const v=validateCorporateStructure(d,refs);
 assert.equal(v.assignments[0].employingLegalEntityId,'leA');
 assert.equal(v.assignments[0].financialLegalEntityId,'leA');
 assert.equal(v.assignments[0].budgetLegalEntityId,'leB');
 assert.deepEqual(v.assignments[0].operatingNodeIds,['leA','leB']);
});
test('P1 refuses cross-entity cost centre and inactive units',()=>{
 const d=defaultCorporateStructure();const a=assignment();d.assignments=[{...a,financialCostCenterId:'ccB'}];
 assert.throws(()=>validateCorporateStructure(d,refs),/cost centre/);
 d.assignments=[{...a,financialCostCenterId:'ccDead'}];
 assert.throws(()=>validateCorporateStructure(d,refs),/cost centre/);
});
test('P1 refuses beneficiary splits not summing to 100%',()=>{
 const d=defaultCorporateStructure();const a=assignment();
 d.assignments=[{...a,beneficiaries:a.beneficiaries.map(b=>({...b,percentage:45}))}];
 assert.throws(()=>validateCorporateStructure(d,refs),/total 100/);
});
test('P1 blocks overlapping primary homes, permits sequential scheduled periods',()=>{
 const d=defaultCorporateStructure();const a=assignment();
 d.assignments=[a,{...a,id:'a2',effectiveFrom:'2027-01-01'}];
 assert.throws(()=>validateCorporateStructure(d,refs),/Overlapping/);
 d.assignments=[a,{...a,id:'a2',effectiveFrom:'2027-11-01',effectiveTo:'2028-10-31'}];
 assert.equal(validateCorporateStructure(d,refs).assignments.length,2);
});
test('P1 resolves model precedence function+entity > function > entity > tenant',()=>{
 const d=defaultCorporateStructure();
 d.overrides=[
  override('legal_entity','leB','','DEC'),
  override('function','','ENG','FED'),
  override('function_entity','leB','ENG','CEN'),
 ];
 assert.equal(modelFor(d,'leB','ENG','2026-11-01'),'CEN');
 assert.equal(modelFor(d,'leA','ENG','2026-11-01'),'FED');
 assert.equal(modelFor(d,'leB','HR','2026-11-01'),'DEC');
 assert.equal(modelFor(d,'leA','HR','2026-11-01'),'HYB');
 assert.equal(validateCorporateStructure(d,refs).overrides.length,3);
});
test('P1 rejects overlapping overrides and invalid effective date',()=>{
 const d=defaultCorporateStructure();d.overrides=[
  override('function','','ENG','FED'),{...override('function','','ENG','CEN'),id:'another'},
 ];
 assert.throws(()=>validateCorporateStructure(d,refs),/cannot overlap/);
 d.overrides=[{...override('function','','ENG','FED'),effectiveFrom:'2026-02-30'}];
 assert.throws(()=>validateCorporateStructure(d,refs),/Effective dates/);
});
test('P1 does not allow arbitrary role or function identifiers',()=>{
 const d=defaultCorporateStructure();d.assignments=[{...assignment(),subjectCode:'MISSING'}];
 assert.throws(()=>validateCorporateStructure(d,refs),/must exist/);
});
