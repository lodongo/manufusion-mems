import assert from 'node:assert/strict';
import {seed,snapshot} from './maintenance-fixture.ts';
import {hrCompensationRoutes} from '../../backend/hrCompensationConfig.ts';
import {hrCompensationApprovalRoutes} from '../../backend/hrCompensationApproval.ts';
const org='hr_compensation_fixture',root='organizations/'+org;
seed(root,{status:'active',countryCode:'KE',currencyCode:'KES',modules:{HRM:true}});
seed(root+'/structure/LE_KE',{level:'legal_entity',name:'Kenya Manufacturing',status:'active',
 attributes:{countryCode:'KE',currencyCode:'KES'}});
seed(root+'/structure/LE_UG',{level:'legal_entity',name:'Uganda Trading',status:'active',
 attributes:{countryCode:'UG',currencyCode:'UGX'}});
seed('users/admin',{uid:'admin',orgId:org,status:'active',role:'org_super_admin',firstName:'Admin',
 assignments:[{type:'primary',nodeId:'LE_KE',positionCode:'ROL_000002',startsOn:'2025-01-01'}]});
seed('users/approver',{uid:'approver',orgId:org,status:'active',role:'member',firstName:'Approver',
 assignments:[{type:'primary',nodeId:'LE_KE',positionCode:'ROL_000001',startsOn:'2025-01-01'}]});
seed(root+'/positions/ROL_000001',{title:'Group Finance Director'});
seed(root+'/positions/ROL_000002',{title:'HR Manager',parentCode:'ROL_000001'});
seed('users/member',{uid:'member',orgId:org,status:'active',role:'member',assignments:[]});
const permsOf=uid=>uid==='admin'?['ADM.settings','HRM.shell.view']:uid==='approver'?['HRM.shell.view','HRM.compensation.approve']:['HRM.shell.view'];
const ctx=(uid,body={})=>({
 uid,orgId:org,role:uid==='admin'?'org_super_admin':'member',
 me:snapshot('users/'+uid),org:snapshot(root),body,actor:{uid,orgId:org},
 permissions:permsOf(uid),directPermissions:permsOf(uid),
 grants:uid==='approver'?[{nodeId:'LE_KE',permissions:['HRM.compensation.approve']}]:[],
 meta:{},claims:{email:'test@example.com'},
});
const approval=(uid,path,body={})=>{
 const route=hrCompensationApprovalRoutes['POST '+path]?.[0];
 assert.ok(route,path);
 return route(ctx(uid,body));
};
const call=(uid,path,body={})=>{
 const route=hrCompensationRoutes['POST '+path]?.[0];
 assert.ok(route,path);
 return route(ctx(uid,body));
};
await assert.rejects(()=>call('member','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'}),/permission/i);
const read=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'});
assert.equal(read.currency,'KES');
assert.equal(read.countryCode,'KE');
assert.equal(read.saved,false);
assert.equal(read.config.items.find(x=>x.code==='KE_NSSF').maximum,6480);
const ug=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_UG'});
assert.equal(ug.currency,'UGX');
assert.equal(ug.countryCode,'UG');
assert.equal(ug.config.items.some(x=>x.code.startsWith('KE_')),false);
const policy=structuredClone(read.config);
const incentive=policy.items.find(x=>x.code==='INC_KPI');
incentive.enabled=true;
incentive.method='percent';
incentive.rate=0.1;
incentive.gradeCodes=['JG05','JG06'];
let saved=await call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:policy});
assert.equal(saved.status,'draft');
assert.equal(saved.version,1);
assert.equal(saved.config.items.find(x=>x.code==='INC_KPI').gradeCodes.length,2);
const after=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'});
assert.equal(after.saved,true);
assert.equal(after.config.items.find(x=>x.code==='INC_KPI').rate,0.1);
assert.equal((await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_UG'})).saved,false);
const wrong=structuredClone(policy);
wrong.currency='UGX';
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:wrong}),/Country and currency/);
const illegal=structuredClone(policy);
illegal.items.find(x=>x.code==='KE_AHL').enabled=false;
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:illegal}),/Mandatory Kenya/);
const wronglyScoped=structuredClone(policy);
wronglyScoped.items.find(x=>x.code==='INC_KPI').gradeCodes=['FOREIGN_GRADE'];
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:wronglyScoped}),/job grades/);
await assert.rejects(()=>call('member','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:policy}),/permission/i);

// ---- Activation: maker-checker + Chart of Authority; leave reads only the approved policy ----
assert.equal(snapshot(root+'/hr_compensation_active/LE_KE'),null,'Saving a draft never activates it');
const submitBody=(extra={})=>({legalEntityId:'LE_KE',expectedVersion:1,annualCostImpact:50000,reason:'Annual review of pay and leave policy',acknowledge:true,...extra});
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody({acknowledge:false})),/Confirm/);
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody({reason:'short'})),/reason/i);
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody({expectedVersion:0})),/changed since/);
await assert.rejects(()=>approval('member','/api/org/hr/compensation/submit',submitBody()),/permission|administrator/i);
const first=await approval('admin','/api/org/hr/compensation/submit',submitBody());
assert.match(first.id,/^FCR\d{8}$/);
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody()),/already waiting/);
const queue=await approval('approver','/api/org/hr/compensation/requests');
const row=queue.requests.find(x=>x.id===first.id);
assert.ok(row&&row.canDecide,'Holder of the Chart of Authority level role may decide');
assert.equal(row.steps[0].positionTitle,'Group Finance Director');
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/decide',{id:first.id,decision:'approve',acknowledge:true}),/someone else/);
await assert.rejects(()=>approval('member','/api/org/hr/compensation/decide',{id:first.id,decision:'approve',acknowledge:true}),/needs|approved by|scope/);
await assert.rejects(()=>approval('approver','/api/org/hr/compensation/decide',{id:first.id,decision:'approve'}),/Confirm/);
const decided=await approval('approver','/api/org/hr/compensation/decide',{id:first.id,decision:'approve',acknowledge:true,reason:'Within budget'});
assert.equal(decided.status,'approved');
const active=snapshot(root+'/hr_compensation_active/LE_KE');
assert.equal(active.data.activeVersion,1);assert.equal(active.data.approvalRef,first.id);assert.equal(active.data.sourceDraftVersion,1);
assert.ok(snapshot(root+'/hr_compensation_active/LE_KE/history/v000001'),'Immutable activation history');
const status=await call('admin','/api/org/hr/compensation/get',{legalEntityId:'LE_KE'});
assert.equal(status.activation.active.version,1);
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody()),/already the active policy/);
// A draft that changes after submission cannot be approved.
const next=structuredClone(policy);next.items.find(x=>x.code==='INC_KPI').rate=0.12;
assert.equal((await call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:next,expectedVersion:1})).version,2);
const second=await approval('admin','/api/org/hr/compensation/submit',submitBody({expectedVersion:2}));
next.items.find(x=>x.code==='INC_KPI').rate=0.2;
await call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:next,expectedVersion:2});
await assert.rejects(()=>approval('approver','/api/org/hr/compensation/decide',{id:second.id,decision:'approve',acknowledge:true}),/changed after/);
assert.equal(snapshot(root+'/hr_compensation_active/LE_KE').data.activeVersion,1,'Active policy unchanged');
await approval('approver','/api/org/hr/compensation/decide',{id:second.id,decision:'reject',reason:'Draft changed after submission'});
// Higher cost needs a higher Chart of Authority level; an unmapped level blocks submission.
await assert.rejects(()=>approval('admin','/api/org/hr/compensation/submit',submitBody({expectedVersion:3,annualCostImpact:500000})),/Approval level L2/);
await assert.rejects(()=>call('admin','/api/org/hr/compensation/save',{legalEntityId:'LE_KE',config:next,expectedVersion:1}),/changed since/);
console.log('HR compensation activation maker-checker and Chart of Authority scenario passed');
console.log('HR compensation legal-entity policy and Kenya mandatory scenario passed');
