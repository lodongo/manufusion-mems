import assert from 'node:assert/strict';
import {seed,listDocs,snapshot} from './maintenance-fixture.ts';
import {hrLeaveRoutes} from '../../backend/hrLeaveRoutes.ts';
import {hrRulesRoutes} from '../../backend/hrRulesRoutes.ts';
import {HR_RULE_DEFAULTS,hrRules,hrVisibleTabs} from '../../backend/hrPrivacyRules.ts';
import {kenyaCompensationTemplate} from '../../backend/hrCompensationConfig.ts';
import {defaultLeaveEntitlement} from '../../src/shared/hrLeaveDefaults.ts';
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
  assignments:[{type:'primary',nodeId:node,positionCode:'P',startsOn:'2025-01-01'}]});
}
seed(root+'/positions/P',{title:'Production Operator',jobGradeByLegalEntity:{LE:'JG01'}});
const leaveConfig=kenyaCompensationTemplate();
for(const item of leaveConfig.items.filter(x=>x.category==='leave')){
 item.leaveEntitlements={JG01:defaultLeaveEntitlement(item.mandatory,item.amount,item.code)};
}
seed(root+'/hr_compensation_config/LE',{...leaveConfig,version:1});

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
// A saved draft alone never grants leave: only the approved (activated) policy does.
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',start:'2026-11-02',end:'2026-11-06',
}),/not been approved/);
seed(root+'/hr_compensation_active/LE',{...leaveConfig,version:1,activeVersion:1,status:'active'});
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',
 start:'2026-11-09',end:'2026-11-13',
}),/approved leave plan/);
const plan=await call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',start:'2026-11-09',end:'2026-11-13'});
assert.ok(plan.id);
assert.equal((await call(hrLeaveRoutes,'manager','/api/org/hr/leave/inbox')).items.length,1);
await assert.rejects(()=>call(hrLeaveRoutes,'hr','/api/org/hr/leave/review',{id:plan.id,decision:'approve'}),/immediate manager/);
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/review',{id:plan.id,decision:'approve'}),/immediate manager|own record/);
await assert.rejects(()=>call(hrLeaveRoutes,'other','/api/org/hr/leave/list',{uid:'employee'}),/outside/);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:plan.id,decision:'approve'});
const approved=(await call(hrLeaveRoutes,'employee','/api/org/hr/leave/list',{uid:'employee'})).items;
assert.equal(approved[0].status,'approved');
// Application cannot refer to an approved plan for a different leave type
// or request dates outside the manager-approved plan.
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_SICK_FULL',
 start:'2026-11-09',end:'2026-11-13',planId:plan.id,
}),/match the approved plan/);
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',
 start:'2026-11-09',end:'2026-11-17',planId:plan.id,
}),/approved dates/);
const actual=await call(hrLeaveRoutes,'hr','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',start:'2026-11-09',end:'2026-11-13',planId:plan.id});
assert.equal((await call(hrLeaveRoutes,'hr','/api/org/hr/leave/list',{uid:'employee'})).items.length,2);
await assert.rejects(()=>call(hrLeaveRoutes,'hr','/api/org/hr/leave/review',{id:actual.id,decision:'approve'}),/immediate manager/);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:actual.id,decision:'approve'});
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',
 start:'2026-11-10',end:'2026-11-11',planId:plan.id,
}),/already covers these dates/);

assert.equal((await call(hrLeaveRoutes,'admin','/api/org/hr/leave/list',{uid:'employee'})).items.length,2);
// A Super Administrator has ordinary self-service rights, but not the right
// to approve their own leave; the configured immediate manager is required.
seed(root+'/structure/SITE_A',{name:'SITE_A',level:'site',parentId:'LE',managerUid:'manager',status:'active'});
const adminLeave=await call(hrLeaveRoutes,'admin','/api/org/hr/leave/create',{
 employeeUid:'admin',kind:'plan',leaveType:'LEAVE_ANNUAL',start:'2026-12-01',end:'2026-12-02',
});
assert.ok(adminLeave.id,'Super Administrator may submit own leave plans');
await assert.rejects(()=>call(hrLeaveRoutes,'admin','/api/org/hr/leave/create',{
 employeeUid:'admin',kind:'application',leaveType:'LEAVE_ANNUAL',start:'2026-12-01',end:'2026-12-02',
}),/approved leave plan/);
assert.equal((await call(hrLeaveRoutes,'admin','/api/org/hr/leave/list',{uid:'admin'})).permissions.canApply,true);
assert.equal((await call(hrLeaveRoutes,'admin','/api/org/hr/leave/list',{uid:'admin'})).permissions.canApprove,false);
await assert.rejects(()=>call(hrLeaveRoutes,'admin','/api/org/hr/leave/review',{
 id:adminLeave.id,decision:'approve',
}),/immediate manager|own record/);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{
 id:adminLeave.id,decision:'approve',
});
const adminActual=await call(hrLeaveRoutes,'admin','/api/org/hr/leave/create',{
 employeeUid:'admin',kind:'application',leaveType:'LEAVE_ANNUAL',start:'2026-12-01',end:'2026-12-02',
 planId:adminLeave.id,
});
assert.ok(adminActual.id);
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:adminActual.id,decision:'approve'});
assert.equal((await call(hrLeaveRoutes,'admin','/api/org/hr/leave/list',{uid:'admin'})).items.some(x=>x.id===adminLeave.id&&x.status==='approved'),true);
// Planning is employee-initiated; even superadmin cannot bypass immediate manager.
await assert.rejects(()=>call(hrLeaveRoutes,'manager','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',
 start:'2026-12-01',end:'2026-12-02',
}),/employee must submit their own/);
await assert.rejects(()=>call(hrLeaveRoutes,'admin','/api/org/hr/leave/review',{
 id:plan.id,decision:'approve',
}),/no longer pending/);
// Plans reserve entitlement at submission, not only once actual leave is booked.
// Existing approved applications must not be counted a second time beside their plan.
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',
 start:'2026-12-07',end:'2026-12-31',
}),/Planned leave exceeds/);
const secondPlan=await call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',
 start:'2026-12-01',end:'2026-12-02',
});
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:secondPlan.id,decision:'approve'});
const teamView=await call(hrLeaveRoutes,'manager','/api/org/hr/leave/team');
assert.ok(teamView.items.some(x=>x.id===secondPlan.id));
assert.ok(teamView.counts.planned>=2);
assert.equal(teamView.items.some(x=>x.note),false,'Leave planning overview must redact private notes');
const changedConfig=structuredClone(leaveConfig);
changedConfig.items.find(x=>x.code==='LEAVE_ANNUAL').leaveEntitlements.JG01.daysPerYear=22;
seed(root+'/hr_compensation_active/LE',{...changedConfig,version:2,activeVersion:2,status:'active'});
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',
 start:'2026-12-01',end:'2026-12-02',planId:secondPlan.id,
}),/entitlement changed/);
seed(root+'/hr_compensation_active/LE',{...leaveConfig,version:1,activeVersion:1,status:'active'});
const resumed=await call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'application',leaveType:'LEAVE_ANNUAL',
 start:'2026-12-01',end:'2026-12-02',planId:secondPlan.id,
});
assert.ok(resumed.id,'Employee can apply only after the previously approved plan is valid again');
await call(hrLeaveRoutes,'manager','/api/org/hr/leave/review',{id:resumed.id,decision:'approve'});

// An employee with no job-grade mapping is never allowed to choose a leave type.
seed(root+'/positions/P',{title:'Production Operator',jobGradeByLegalEntity:{}});
const unable=await call(hrLeaveRoutes,'employee','/api/org/hr/leave/list',{uid:'employee'});
assert.equal(unable.eligibility,null);
assert.match(unable.configurationError,/Assign a job grade/);
await assert.rejects(()=>call(hrLeaveRoutes,'employee','/api/org/hr/leave/create',{
 employeeUid:'employee',kind:'plan',leaveType:'LEAVE_ANNUAL',start:'2026-12-10',end:'2026-12-11',
}),/Assign a job grade/);
console.log('HR leave privacy and manager approval scenario passed');
