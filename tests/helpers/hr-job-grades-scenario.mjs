import assert from 'node:assert/strict';
import {seed,snapshot} from './maintenance-fixture.ts';
import {hrJobGradeRoutes} from '../../backend/hrJobGrades.ts';
import {getEducationConfig} from '../../backend/hrEducationConfig.ts';
import {resolveMinEducation} from '../../backend/roleMinEducation.ts';

const org='hr_job_grades_fixture',root='organizations/'+org;
seed(root,{status:'active',countryCode:'KE',currencyCode:'KES',modules:{HRM:true}});
seed(root+'/structure/LE_KE',{level:'legal_entity',name:'Kenya Manufacturing',status:'active',attributes:{countryCode:'KE',currencyCode:'KES'}});
seed(root+'/structure/LE_UG',{level:'legal_entity',name:'Uganda Trading',status:'active',attributes:{countryCode:'UG',currencyCode:'UGX'}});
seed(root+'/positions/ROL_000001',{title:'Group Finance Director'});
seed(root+'/positions/ROL_000002',{title:'HR Manager',parentCode:'ROL_000001'});
seed(root+'/positions/ROL_000003',{title:'Production Operator',parentCode:'ROL_000002',jobGradeByLegalEntity:{LE_KE:'JG02'},minEducationByLegalEntity:{LE_KE:'SECONDARY'}});
const user=(uid,role,positionCode)=>seed('users/'+uid,{uid,orgId:org,status:'active',role,firstName:uid,
 assignments:positionCode?[{type:'primary',nodeId:'LE_KE',positionCode,startsOn:'2025-01-01'}]:[]});
user('admin','org_super_admin','ROL_000002');
user('maker','member','ROL_000002');
user('approver','member','ROL_000001');
user('member','member','');
const permsOf=uid=>uid==='maker'?['HRM.shell.view','HRM.grades.manage']:uid==='approver'?['HRM.shell.view','HRM.grades.approve']:['HRM.shell.view'];
const ctx=(uid,body={})=>({
 uid,orgId:org,role:uid==='admin'?'org_super_admin':'member',
 me:snapshot('users/'+uid),org:snapshot(root),body,actor:{uid,orgId:org},
 permissions:uid==='admin'?['ADM.settings','HRM.shell.view']:permsOf(uid),
 directPermissions:uid==='admin'?['ADM.settings','HRM.shell.view']:permsOf(uid),
 grants:uid==='approver'?[{nodeId:'LE_KE',permissions:['HRM.grades.approve']}]:[],
 meta:{},claims:{email:'test@example.com'},
});
const call=(uid,name,body={})=>{
 const route=hrJobGradeRoutes['POST /api/org/hr/job-grades/'+name]?.[0];
 assert.ok(route,name);
 return route(ctx(uid,body));
};
const get=(uid,entity='LE_KE')=>call(uid,'get',{legalEntityId:entity});

// ---- Reading: pay information is redacted for people who neither maintain nor approve grades ----
const plain=await get('member');
assert.equal(plain.financial,false);
assert.equal(plain.draft.grades.length,9,'Older grade list seeds the draft');
assert.ok(plain.draft.grades.every(g=>g.minSalary===null&&g.taxCodes.length===0&&g.deductionCodes.length===0));
assert.equal(plain.catalogue,null);assert.equal(plain.payConfig,null);
const seeded=await get('maker');
assert.equal(seeded.financial,true);
assert.equal(seeded.draft.saved,false);
assert.equal(seeded.entity.currency,'KES');
const grade1=seeded.draft.grades.find(g=>g.code==='JG01');
assert.equal(grade1.minSalary,0);
for(const code of ['KE_PAYE'])assert.ok(grade1.taxCodes.includes(code),'Kenya PAYE applies to every grade');
for(const code of ['KE_NSSF','KE_SHIF','KE_AHL'])assert.ok(grade1.deductionCodes.includes(code),code+' applies to every grade');
assert.ok(seeded.catalogue.deductions.some(x=>x.code==='DED_SACCO'),'Optional deductions come from Compensation & Benefits');
assert.equal(seeded.roles.JG02.length,1,'Roles allocated to a grade are listed');
assert.equal(seeded.roles.JG02[0].title,'Production Operator');
assert.ok(seeded.payConfig,'Kenya rates are provided for the take-home preview');

// ---- Draft rules ----
await assert.rejects(()=>call('member','save',{legalEntityId:'LE_KE',grades:seeded.draft.grades}),/permission/i);
const priced=seeded.draft.grades.map(g=>({...g,minSalary:20000+g.rank*10000,taxCodes:[],deductionCodes:g.rank===3?['DED_SACCO']:[]}));
const withNew=[...priced,{code:'',rank:10,title:'Director',description:'Board-reporting leader',enabled:true,minSalary:300000,taxCodes:[],deductionCodes:[]}];
const saved=await call('maker','save',{legalEntityId:'LE_KE',grades:withNew,expectedVersion:0});
assert.equal(saved.version,1);
const director=saved.grades.find(g=>g.title==='Director');
assert.equal(director.code,'JG10','New grades are numbered by the server');
for(const g of saved.grades){
 assert.ok(g.taxCodes.includes('KE_PAYE'),'Mandatory taxes are always included');
 for(const code of ['KE_NSSF','KE_SHIF','KE_AHL'])assert.ok(g.deductionCodes.includes(code),'Mandatory deductions are always included');
}
assert.ok(saved.grades.find(g=>g.code==='JG03').deductionCodes.includes('DED_SACCO'),'A chosen optional deduction is kept');
assert.equal(snapshot(root+'/hr_job_grades_active/LE_KE'),null,'Saving a draft never activates it');
assert.equal((await getEducationConfig(org,'LE_KE')).jobGrades.length,9,'Live readers still use the older list until approval');
const reject=(patch,pattern,expectedVersion=1)=>assert.rejects(()=>call('maker','save',{legalEntityId:'LE_KE',expectedVersion,grades:patch(structuredClone(saved.grades))}),pattern);
await reject(g=>{g[1].rank=g[0].rank;return g;},/used twice/);
await reject(g=>{g[0].taxCodes=['NOT_A_TAX'];return g;},/Compensation & Benefits/);
await reject(g=>{g[0].deductionCodes=['KE_PAYE'];return g;},/Compensation & Benefits/);
await reject(g=>g.slice(1),/cannot be removed/);
await reject(g=>{g[0].minSalary=1000.123;return g;},/2 decimal/);
await reject(g=>{g[0].minSalary=-5;return g;},/minimum salary/);
await reject(g=>{g[0].title='';return g;},/title/);
await reject(g=>{g[1].title=g[0].title;return g;},/used twice/);
await assert.rejects(()=>call('maker','save',{legalEntityId:'LE_KE',expectedVersion:0,grades:saved.grades}),/changed since/);

// ---- Submission needs a complete, ordered, cost-stated draft ----
const body=(extra={})=>({legalEntityId:'LE_KE',expectedVersion:1,annualCostImpact:80000,reason:'Annual grading review for the new financial year',acknowledge:true,...extra});
await assert.rejects(()=>call('member','submit',body()),/permission/i);
await assert.rejects(()=>call('maker','submit',body({acknowledge:false})),/Confirm/);
await assert.rejects(()=>call('maker','submit',body({reason:'short'})),/reason/i);
await assert.rejects(()=>call('maker','submit',body({annualCostImpact:-1})),/annual cost/);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:0})),/changed since/);
const unpriced=structuredClone(saved.grades);unpriced.find(g=>g.code==='JG04').minSalary=0;
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:1,grades:unpriced})).version,2);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:2})),/minimum monthly salary/);
const inverted=structuredClone(saved.grades);inverted.find(g=>g.code==='JG06').minSalary=1000;
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:2,grades:inverted})).version,3);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:3})),/lower minimum salary/);
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:3,grades:saved.grades})).version,4);

// Another legal entity with no tax catalogue cannot be activated: every grade needs taxes and deductions.
const ugSeed=await get('maker','LE_UG');
const ugGrades=ugSeed.draft.grades.map(g=>({...g,minSalary:1000000+g.rank*500000}));
await call('maker','save',{legalEntityId:'LE_UG',expectedVersion:0,grades:ugGrades});
await assert.rejects(()=>call('maker','submit',{...body({expectedVersion:1}),legalEntityId:'LE_UG'}),/select the taxes/);

// ---- Activation: maker-checker, Chart of Authority, fingerprint ----
const first=await call('maker','submit',body({expectedVersion:4}));
assert.match(first.id,/^FCR\d{8}$/);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:4})),/already waiting/);
const queue=await call('approver','requests');
const row=queue.requests.find(x=>x.id===first.id);
assert.ok(row&&row.canDecide,'Holder of the Chart of Authority level role may decide');
assert.equal(row.steps[0].positionTitle,'Group Finance Director');
assert.equal(row.enabledCount,10);assert.equal(row.currency,'KES');
assert.equal(row.lowestSalary,30000);assert.equal(row.highestSalary,300000);
assert.ok(row.changes.some(c=>c.code==='JG10'&&c.kind==='new'),'Approver sees the new grade');
assert.ok(row.changes.some(c=>c.code==='JG05'&&c.from===0&&c.to===70000),'Approver sees each minimum salary change');
assert.equal((await call('member','requests')).requests.length,0,'Pay requests are hidden from people without a role in them');
await assert.rejects(()=>call('maker','decide',{id:first.id,decision:'approve',acknowledge:true}),/someone else|needs/);
await assert.rejects(()=>call('member','decide',{id:first.id,decision:'approve',acknowledge:true}),/needs|approved by|scope/);
await assert.rejects(()=>call('approver','decide',{id:first.id,decision:'approve'}),/Confirm/);
await assert.rejects(()=>call('approver','decide',{id:first.id,decision:'reject',reason:'no'}),/reason/i);
const decided=await call('approver','decide',{id:first.id,decision:'approve',acknowledge:true,reason:'Within the budget'});
assert.equal(decided.status,'approved');
const active=snapshot(root+'/hr_job_grades_active/LE_KE');
assert.equal(active.data.activeVersion,1);assert.equal(active.data.approvalRef,first.id);assert.equal(active.data.sourceDraftVersion,4);
assert.equal(active.data.annualCostImpact,80000);
assert.ok(snapshot(root+'/hr_job_grades_active/LE_KE/history/v000001'),'Immutable activation history');
const live=(await getEducationConfig(org,'LE_KE')).jobGrades;
assert.equal(live.length,10,'After approval every reader sees the governed grades');
assert.ok(live.some(g=>g.code==='JG10'&&g.title==='Director'));
const after=await get('maker');
assert.equal(after.active.version,1);assert.equal(after.changedSinceActive,false);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:4})),/already the active policy/);

// ---- A grade in use by a role cannot be disabled; a draft that changes after submission cannot be approved ----
const disabled=structuredClone(saved.grades);disabled.find(g=>g.code==='JG02').enabled=false;
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:4,grades:disabled})).version,5);
await assert.rejects(()=>call('maker','submit',body({expectedVersion:5,annualCostImpact:1000})),/1 job role uses it/);
const raised=structuredClone(saved.grades);raised.find(g=>g.code==='JG05').minSalary=75000;
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:5,grades:raised})).version,6);
const second=await call('maker','submit',body({expectedVersion:6,annualCostImpact:1000}));
const edited=structuredClone(raised);edited.find(g=>g.code==='JG05').minSalary=76000;
assert.equal((await call('maker','save',{legalEntityId:'LE_KE',expectedVersion:6,grades:edited})).version,7);
await assert.rejects(()=>call('approver','decide',{id:second.id,decision:'approve',acknowledge:true}),/changed after/);
assert.equal(snapshot(root+'/hr_job_grades_active/LE_KE').data.activeVersion,1,'Active grades unchanged');
await call('approver','decide',{id:second.id,decision:'reject',reason:'Draft changed after submission'});
// The maker can withdraw their own pending request; nobody else can.
const third=await call('maker','submit',body({expectedVersion:7,annualCostImpact:1000}));
await assert.rejects(()=>call('approver','withdraw',{id:third.id,reason:'Not mine to withdraw'}),/not found/i);
await call('maker','withdraw',{id:third.id,reason:'Needs another review first'});
// Higher cost needs a higher Chart of Authority level; an unmapped level blocks submission.
await assert.rejects(()=>call('maker','submit',body({expectedVersion:7,annualCostImpact:500000000})),/Approval level L|Nobody other than you/);

// ---- Job role minimum education: required wherever the role has a grade ----
const levels=async()=>[{code:'SECONDARY',enabled:true},{code:'BACHELOR',enabled:true},{code:'OLD',enabled:false}];
const entities=[{id:'LE_KE',name:'Kenya Manufacturing'},{id:'LE_UG',name:'Uganda Trading'}];
assert.deepEqual(await resolveMinEducation({LE_KE:'BACHELOR'},{LE_KE:'JG05'},entities,levels),{LE_KE:'BACHELOR'});
await assert.rejects(()=>resolveMinEducation({},{LE_KE:'JG05'},entities,levels),/minimum level of education.*Kenya Manufacturing/);
await assert.rejects(()=>resolveMinEducation({LE_KE:'DOCTORATE'},{LE_KE:'JG05'},entities,levels),/enabled education level/);
await assert.rejects(()=>resolveMinEducation({LE_KE:'OLD'},{LE_KE:'JG05'},entities,levels),/enabled education level/);
await assert.rejects(()=>resolveMinEducation({LE_XX:'BACHELOR'},{},entities,levels),/Unknown legal entity/);
await assert.rejects(()=>resolveMinEducation('BACHELOR',{},entities,levels),/mapped by legal entity/);
assert.deepEqual(await resolveMinEducation({LE_UG:'SECONDARY'},{},entities,levels),{LE_UG:'SECONDARY'},'A requirement may be set without a grade');
assert.deepEqual(await resolveMinEducation({},{},entities,levels),{},'A role with no grade needs no requirement');

console.log('HR job grades governance, pay rules and role minimum education scenario passed');
