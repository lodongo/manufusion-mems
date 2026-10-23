import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { hrEmployeeRoutes } from '../../backend/hrEmployeeRoutes.ts';
const org='hr_skill_fixture',root='organizations/'+org;
seed(root,{status:'active',modules:{HRM:true}});
const nodes=[
 ['LE','legal_entity',''],
 ['SITE_A','site','LE'],
 ['DEPT_A','department','SITE_A'],
 ['TEAM_A','cost_center','DEPT_A'],
 ['SITE_B','site','LE'],
 ['DEPT_B','department','SITE_B'],
];
for(const [id,level,parentId] of nodes){
  seed(root+'/structure/'+id,{code:id,level,parentId,name:id,status:'active',managerUid:id==='DEPT_A'?'manager':''});
}
const users={
 manager:{uid:'manager',node:'DEPT_A',name:'Maintenance Lead'},
 employee:{uid:'employee',node:'TEAM_A',name:'Employee'},
 peer:{uid:'peer',node:'TEAM_A',name:'Colleague'},
 outsider:{uid:'outsider',node:'DEPT_B',name:'External colleague'},
 admin:{uid:'admin',node:'SITE_A',name:'HR Officer'},
};
for(const user of Object.values(users)){
 seed('users/'+user.uid,{uid:user.uid,orgId:org,status:'active',
   firstName:user.name,lastName:'Fixture',employeeNumber:user.uid,role:'member',
   assignments:[{nodeId:user.node,type:'primary',positionCode:'ROLE',startsOn:'2020-01-01'}]});
}
const context=(who,body={})=>({
  uid:who,orgId:org,role:who==='admin'?'org_super_admin':'member',
  me:snapshot('users/'+who),org:snapshot(root),
  permissions:['HRM.shell.view',...(who==='admin'?['HRM.skills.manage']:[])],
  directPermissions:['HRM.shell.view',...(who==='admin'?['HRM.skills.manage']:[])],
  body,query:{},actor:{uid:who,orgId:org,role:'member'},meta:{ip:'test'},claims:{email:'test@example.com'},
});
const call=(who,path,body={})=>{
 const h=hrEmployeeRoutes['POST '+path]?.[0];assert.ok(h,'Route not found '+path);
 return h(context(who,body));
};
const education=[{institution:'Technical College',qualification:'Diploma',field:'Electrical',completionYear:'2023'}];
await call('employee','/api/org/hr/private/save',{kind:'education',items:education});
await call('employee','/api/org/hr/private/save',{kind:'family',items:[{name:'Family Member',relationship:'Parent',phone:'+254700000000'}]});
const mine=await call('employee','/api/org/hr/private/get');
assert.equal(mine.education.length,1);assert.equal(mine.family.length,1);
await assert.rejects(()=>call('peer','/api/org/hr/private/get',{uid:'employee'}),/Only the employee/);
await assert.rejects(()=>call('peer','/api/org/hr/private/save',{uid:'employee',kind:'family',items:[]}),/Only the employee/);
assert.equal((await call('admin','/api/org/hr/private/get',{uid:'employee'})).family.length,1,'Organization super administrator can inspect audited employee records');
const catalog=await call('employee','/api/org/hr/skills/catalog');
assert.ok(catalog.skills.some(s=>s.code==='HR_SK_001_001'),'Existing standard skills must remain available');
await assert.rejects(()=>call('peer','/api/org/hr/skills/catalog/save',{name:'Unsafe',category:'A',subcategory:'B'}),/permission|manage/i);
const added=await call('admin','/api/org/hr/skills/catalog/save',{name:'Machine commissioning',category:'Engineering',subcategory:'Reliability',description:'Qualified commissioning practice'});
assert.match(added.code,/^HR_SK_LOCAL_/);
await call('employee','/api/org/hr/skills/propose',{employeeUid:'employee',skillCode:added.code});
let docs=await listDocs(root+'/hr_skill_proposals');assert.equal(docs.length,1);
assert.equal(docs[0].data.status,'pending');
assert.equal(docs[0].data.managerUid,'manager');
await assert.rejects(()=>call('outsider','/api/org/hr/skills/propose',{employeeUid:'employee',skillCode:'HR_SK_001_001'}),/same site/);
await assert.rejects(()=>call('peer','/api/org/hr/skills/propose',{employeeUid:'employee',skillCode:added.code}),/already has a pending/);
await call('peer','/api/org/hr/skills/endorse',{id:docs[0].id});
await assert.rejects(()=>call('peer','/api/org/hr/skills/endorse',{id:docs[0].id}),/already seconded/);
await assert.rejects(()=>call('employee','/api/org/hr/skills/endorse',{id:docs[0].id}),/own skill/);
assert.equal((await call('manager','/api/org/hr/skills/inbox')).items.length,1);
assert.equal((await call('outsider','/api/org/hr/skills/inbox')).items.length,0);
await assert.rejects(()=>call('peer','/api/org/hr/skills/decide',{id:docs[0].id,action:'approve'}),/immediate manager/);
await call('manager','/api/org/hr/skills/decide',{id:docs[0].id,action:'approve',note:'Confirmed on the job'});
assert.equal((await listDocs(root+'/hr_skill_proposals'))[0].data.status,'approved');
await assert.rejects(()=>call('manager','/api/org/hr/skills/decide',{id:docs[0].id,action:'reject',note:'No'}),/no longer pending/);
assert.equal((await call('peer','/api/org/hr/skills/proposals',{uid:'employee'})).proposals[0].endorsements.length,1);
seed(root+'/positions/ROLE',{title:'Engineering Technician',coreSkills:[added.code,'HR_SK_001_001']});
const firstBulk=await call('employee','/api/org/hr/skills/propose/bulk',{
 employeeUid:'employee',skillCodes:[added.code,'HR_SK_001_001','HR_SK_001_002'],
});
assert.equal(firstBulk.submittedCount,2);
assert.equal(firstBulk.skippedCount,1,'Already approved skills do not create duplicates');
let afterBulk=await listDocs(root+'/hr_skill_proposals');
assert.equal(afterBulk.length,3);
await assert.rejects(()=>call('employee','/api/org/hr/skills/propose/bulk',{
 employeeUid:'employee',skillCodes:['HR_SK_001_003','HR_SK_001_003']
}),/only once/);
await assert.rejects(()=>call('outsider','/api/org/hr/skills/propose/bulk',{
 employeeUid:'employee',skillCodes:['HR_SK_001_003']
}),/same site/);
const roleFitModule=await import('../../backend/hrSkillFit.ts');
const positionDoc={id:'ROLE',data:{coreSkills:[added.code,'HR_SK_001_001']}};
let fit=roleFitModule.makeSkillFit('employee',snapshot('users/employee').data,
 new Map([['ROLE',positionDoc.data]]),afterBulk);
assert.equal(fit.percentage,50,'Pending skills do not count toward confirmed role fit');
const pendingRequired=afterBulk.find(x=>x.data.skillCode==='HR_SK_001_001');
assert.ok(pendingRequired);
await call('manager','/api/org/hr/skills/decide',{id:pendingRequired.id,action:'approve'});
afterBulk=await listDocs(root+'/hr_skill_proposals');
fit=roleFitModule.makeSkillFit('employee',snapshot('users/employee').data,
 new Map([['ROLE',positionDoc.data]]),afterBulk);
assert.equal(fit.percentage,100,'Role fit increases only after manager confirmation');
console.log('HR skills and self-service scenario passed');
