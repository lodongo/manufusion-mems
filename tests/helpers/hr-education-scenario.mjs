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
}),/qualification valid/);
await assert.rejects(()=>checkEducationEntry(org,'employee',{
 levelCode:'BACHELOR',qualificationCode:'NBI_ENGINEERING',gradingSystemCode:'CUSTOM',gradeCode:'Z',
}),/configured grading/);
assert.equal((await call('administrator','/api/org/hr/education/admin',{legalEntityId:'LE2'})).config.qualifications.some(q=>q.code==='NBI_ENGINEERING'),false,
 'One legal entity must not change another legal entity education catalogue');
console.log('HR legal-entity education and grading scenario passed');
