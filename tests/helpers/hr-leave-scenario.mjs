import assert from 'node:assert/strict';
import {seed,listDocs,snapshot} from './maintenance-fixture.ts';
import {hrLeaveRoutes} from '../../backend/hrLeaveRoutes.ts';
import {hrRulesRoutes} from '../../backend/hrRulesRoutes.ts';
import {HR_RULE_DEFAULTS,hrRules,hrVisibleTabs} from '../../backend/hrPrivacyRules.ts';
const org='hr_leave_fixture',root='organizations/'+org;
seed(root,{status:'active',modules:{HRM:true}});
for(const [id,level,parent,managerUid] of [
 ['LE','legal_entity','',''],
 ['SITE_A','site','LE',''],
 ['DEPT_A','department','SITE_A','manager'],
 ['TEAM_A','cost_center','DEPT_A',''],
 ['SITE_B','site','LE',''],
 ['TEAM_B','cost_center','SITE_B',''],
]){
 seed(root+'/structure/'+id,{name:id,level,parentId:parent,managerUid,status:'active'});
}
for(const [uid,node,role] of [
 ['manager','DEPT_A','member'],['employee','TEAM_A','member'],
 ['hr','TEAM_A','member'],['dpo','TEAM_A','member'],['other','TEAM_B','member'],['admin','SITE_A','org_super_admin'],
]){
 seed('users/'+uid,{uid,orgId:org,status:'active',role,firstName:uid,lastName:'Fixture',
  assignments:[{type:'primary',nodeId:node,positionCode:'P'}]});
}
const ctx=(uid,body={})=>({
 uid,orgId:org,role:uid==='admin'?'org_super_admin':'member',
 me:snapshot('users/'+uid),org:snapshot(root),
 permissions:['HRM.shell.view',...(uid==='hr'?['HRM.employee.site.read']:[]),...(uid==='admin'?['HRM.rules.manage']:[]),...(uid==='dpo'?['HRM.rules.approve']:[])],
 directPermissions:['HRM.shell.view',...(uid==='hr'?['HRM.employee.site.read']:[]),...(uid==='admin'?['HRM.rules.manage']:[]),...(uid==='dpo'?['HRM.rules.approve']:[])],
 body,actor:{uid,orgId:org},meta:{},claims:{email:'test@example.com'},
});
const call=(routes,uid,path,body={})=>{
 const h=routes['POST '+path]?.[0];assert.ok(h,path+' exists');
 return h(ctx(uid,body));
};
assert.equal(hrVisibleTabs('manager',hrRules({...HR_RULE_DEFAULTS,managerTabs:['basic','payslips','family','leave']})).includes('payslips'),false);
assert.equal(hrVisibleTabs('superadmin',hrRules({})).includes('payslips'),true);
assert.equal(hrVisibleTabs('self',hrRules({})).includes('family'),true);
assert.equal((await call(hrRulesRoutes,'manager','/api/org/hr/reportees')).employees.length,3,'Manager sees all three verified direct reports');
assert.equal((await call(hrRulesRoutes,'other','/api/org/hr/reportees')).employees.length,0);
await assert.rejects(()=>call(hrRulesRoutes,'employee','/api/org/hr/access-rules/save',{rules:HR_RULE_DEFAULTS}),/permission/);
const simulated=await call(hrRulesRoutes,'admin','/api/org/hr/access-rules/simulate',{rules:HR_RULE_DEFAULTS});
await assert.rejects(()=>call(hrRulesRoutes,'admin','/api/org/hr/access-rules/save',{rules:HR_RULE_DEFAULTS}),/Simulate/);
await call(hrRulesRoutes,'admin','/api/org/hr/access-rules/save',{rules:HR_RULE_DEFAULTS,simulationDigest:simulated.digest});
await assert.rejects(()=>call(hrRulesRoutes,'admin','/api/org/hr/access-rules/review',{decision:'approve'}),/own privacy rule/);
await call(hrRulesRoutes,'dpo','/api/org/hr/access-rules/review',{decision:'approve'});
assert.equal((await call(hrRulesRoutes,'admin','/api/org/hr/access-rules/get')).rules.managerTabs.includes('leave'),true);
const plan=await call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'annual',start:'2026-11-09',end:'2026-11-13'});
assert.ok(plan.id);
assert.equal((await call(hrLeaveRoutes,'manager','/api/org/hr/leave/inbox')).items.length,1);
await assert.rejects(()=>call(hrLeaveRoutes,'hr','/api/org/hr/leave/review',{id:plan.id,decision:'approve'}),/immediate manager/);
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/review',{id:plan.id,decision:'approve'}),/immediate manager|own record/);
await assert.rejects(()=>call(hrLeaveRoutes,'other','/api/org/hr/leave/list',{uid:'employee'}),/outside/);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:plan.id,decision:'approve'});
const approved=(await call(hrLeaveRoutes,'employee','/api/org/hr/leave/list',{uid:'employee'})).items;
assert.equal(approved[0].status,'approved');
const actual=await call(hrLeaveRoutes,'hr','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'annual',start:'2026-11-09',end:'2026-11-13',planId:plan.id});
assert.equal((await call(hrLeaveRoutes,'hr','/api/org/hr/leave/list',{uid:'employee'})).items.length,2);
await assert.rejects(()=>call(hrLeaveRoutes,'hr','/api/org/hr/leave/review',{id:actual.id,decision:'approve'}),/immediate manager/);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:actual.id,decision:'approve'});
assert.equal((await call(hrLeaveRoutes,'admin','/api/org/hr/leave/list',{uid:'employee'})).items.length,2);
await assert.rejects(()=>call(hrLeaveRoutes,'admin','/api/org/hr/leave/create',{employeeUid:'admin',kind:'plan',leaveType:'annual',start:'2026-12-01',end:'2026-12-02'}),/cannot apply/);
const mgrProposed=await call(hrLeaveRoutes,'manager','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'annual',start:'2026-12-01',end:'2026-12-02'});
await assert.rejects(()=>call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:mgrProposed.id,decision:'approve'}),/submitter cannot approve/);
await call(hrLeaveRoutes,'admin','/api/org/hr/leave/review',{id:mgrProposed.id,decision:'approve'});
console.log('HR leave privacy and manager approval scenario passed');
