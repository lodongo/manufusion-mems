import assert from 'node:assert/strict';
import {seed,snapshot} from './maintenance-fixture.ts';
import {hrEducationConfigRoutes,DEFAULT_EDUCATION,checkEducationEntry,legalEntityForEmployee} from '../../backend/hrEducationConfig.ts';
const org='hr_education_fixture',root='organizations/'+org;
seed(root,{status:'active',modules:{HRM:true}});
seed(root+'/structure/LE1',{level:'legal_entity',parentId:'root',name:'Nairobi Operations',status:'active'});
seed(root+'/structure/SITE1',{level:'site',parentId:'LE1',name:'Embakasi',status:'active'});
seed(root+'/structure/LE2',{level:'legal_entity',parentId:'root',name:'Regional Operations',status:'active'});
seed('users/administrator',{uid:'administrator',orgId:org,status:'active',firstName:'HR',lastName:'Officer',assignments:[]});
seed('users/employee',{uid:'employee',orgId:org,status:'active',assignments:[{nodeId:'SITE1',type:'primary',positionCode:'ROL_001'}]});
const ctx=(uid,body={})=>({
 uid,orgId:org,role:uid==='administrator'?'org_super_admin':'org_user',
 me:snapshot('users/'+uid),org:snapshot(root),body,actor:{uid,orgId:org},
 permissions:uid==='administrator'?['ADM.settings','HRM.shell.view']:['HRM.shell.view'],
 directPermissions:uid==='administrator'?['ADM.settings','HRM.shell.view']:['HRM.shell.view'],
 meta:{},claims:{email:'test@example.com'},
});
const call=(uid,path,body={})=>{
 const h=hrEducationConfigRoutes['POST '+path]?.[0];assert.ok(h,path);
 return h(ctx(uid,body));
};
// Corporate job roles are above legal entities. Recording their private
// education must not force a fabricated subsidiary/site assignment.
seed(root+'/structure/GRP',{level:'group',parentId:'root',name:'Group Office',status:'active'});
seed('users/executive',{uid:'executive',orgId:org,status:'active',
 assignments:[{nodeId:'GRP',type:'primary',positionCode:'ROL_CEO'}]});
const groupConfig=await call('executive','/api/org/hr/education/config');
assert.equal(groupConfig.scope,'corporate');
assert.equal(groupConfig.entity.id,'__corporate__');
assert.equal(groupConfig.config.levels.some(x=>x.code==='DOCTORATE'),true);
await checkEducationEntry(org,'executive',{levelCode:'DOCTORATE',qualificationCode:'DOCTORATE_GENERAL'});
await assert.rejects(()=>checkEducationEntry(org,'executive',{levelCode:'BACHELOR',qualificationCode:'NBI_ENGINEERING'}),/qualification belonging/);
const entity=await legalEntityForEmployee(org,snapshot('users/employee').data);
assert.equal(entity.id,'LE1');
const employeeConfig=await call('employee','/api/org/hr/education/config');
assert.equal(employeeConfig.entity.id,'LE1');
assert.ok(employeeConfig.config.levels.some(x=>x.code==='BACHELOR'));
await assert.rejects(()=>call('employee','/api/org/hr/education/admin/save',{legalEntityId:'LE1',config:DEFAULT_EDUCATION}),/permission/i);
const adminView=await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE2'});
assert.equal(adminView.entity.id,'LE2');
const configured={...DEFAULT_EDUCATION,
 qualifications:[...DEFAULT_EDUCATION.qualifications,{
  code:'NBI_ENGINEERING',levelCode:'BACHELOR',name:'Engineering degree',description:'Legal entity configured',enabled:true,
 }],
 gradingSystems:[...DEFAULT_EDUCATION.gradingSystems,{
  code:'CUSTOM',name:'Custom grades',description:'Legal entity grading',enabled:true,
  grades:[{code:'A',name:'Excellent'},{code:'B',name:'Good'}],
 }],
};
await call('administrator','/api/org/hr/education/admin/save',{legalEntityId:'LE1',config:configured});
assert.equal((await call('employee','/api/org/hr/education/config')).config.qualifications.at(-1).code,'NBI_ENGINEERING');
await checkEducationEntry(org,'employee',{
 levelCode:'BACHELOR',qualificationCode:'NBI_ENGINEERING',gradingSystemCode:'CUSTOM',gradeCode:'A',
});
await assert.rejects(()=>checkEducationEntry(org,'employee',{
 levelCode:'BACHELOR',qualificationCode:'DIPLOMA_GENERAL',
}),/qualification belonging/);
await assert.rejects(()=>checkEducationEntry(org,'employee',{
 levelCode:'BACHELOR',qualificationCode:'NBI_ENGINEERING',gradingSystemCode:'CUSTOM',gradeCode:'Z',
}),/legacy academic grade/);
assert.equal((await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE2'})).config.qualifications.some(q=>q.code==='NBI_ENGINEERING'),false,
 'One legal entity must not change another legal entity education catalogue');
// Education Rank is ordered, but job grading is an independent employment catalogue.
const ranks=(await call('employee','/api/org/hr/education/config')).config.levels;
assert.ok(ranks.find(x=>x.code==='MASTER').rank>ranks.find(x=>x.code==='BACHELOR').rank);
assert.ok(ranks.find(x=>x.code==='DOCTORATE').rank>ranks.find(x=>x.code==='MASTER').rank);
assert.equal((await call('employee','/api/org/hr/education/config')).config.jobGrades[0].title,'Unskilled / casual');
// An employee assigned to a different entity cannot retrieve another entity's
// qualifications, even when their organization contains only one active entity.
seed('users/unassigned',{uid:'unassigned',orgId:org,status:'active',assignments:[]});
assert.equal(await legalEntityForEmployee(org,snapshot('users/unassigned').data),null);
await assert.rejects(()=>checkEducationEntry(org,'unassigned',{
 levelCode:'BACHELOR',qualificationCode:'NBI_ENGINEERING',
}),/primary legal-entity assignment/);
seed('users/employee',{...snapshot('users/employee').data,
 assignments:[{nodeId:'SITE1',type:'primary',positionCode:'ROL_001'},
 {nodeId:'LE2',type:'primary',positionCode:'ROL_010'}]});
assert.equal(await legalEntityForEmployee(org,snapshot('users/employee').data),null,
 'Two conflicting legal entities must fail closed');
seed('users/employee',{...snapshot('users/employee').data,
 assignments:[{nodeId:'SITE1',type:'primary',positionCode:'ROL_001'}]});
await assert.rejects(()=>call('employee','/api/org/hr/education/admin/adopt',{
 sourceLegalEntityId:'LE1',targetLegalEntityId:'LE2',confirmAdoption:true,
}),/permission/i);
await assert.rejects(()=>call('administrator','/api/org/hr/education/admin/adopt',{
 sourceLegalEntityId:'LE1',targetLegalEntityId:'LE1',confirmAdoption:true,
}),/different active legal entities/);
await assert.rejects(()=>call('administrator','/api/org/hr/education/admin/adopt',{
 sourceLegalEntityId:'LE1',targetLegalEntityId:'LE2',
}),/Confirm copying/);
const adopted=await call('administrator','/api/org/hr/education/admin/adopt',{
 sourceLegalEntityId:'LE1',targetLegalEntityId:'LE2',confirmAdoption:true,
});
assert.equal(adopted.config.qualifications.some(x=>x.code==='NBI_ENGINEERING'),true);
assert.equal((await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE2'})).config.jobGrades.length,
 configured.jobGrades.length);
const sourceBefore=(await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE1'})).config;
const modifiedTarget={...adopted.config,levels:adopted.config.levels.map(x=>x.code==='DOCTORATE'?{...x,rank:10}:x)};
await call('administrator','/api/org/hr/education/admin/save',{legalEntityId:'LE2',config:modifiedTarget});
const sourceAfter=(await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE1'})).config;
assert.deepEqual(sourceAfter,sourceBefore,'Target updates must never affect source education master');
assert.equal((await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE2'})).config.levels
 .find(x=>x.code==='DOCTORATE').rank,10);
console.log('HR legal-entity education and grading scenario passed');
