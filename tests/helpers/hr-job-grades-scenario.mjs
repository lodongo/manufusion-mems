import assert from 'node:assert/strict';
import {seed,snapshot} from './maintenance-fixture.ts';
import {hrJobGradeRoutes,catalogueOf,catalogueProblems} from '../../backend/hrJobGrades.ts';
import {getEducationConfig} from '../../backend/hrEducationConfig.ts';
import {hrCompensationRoutes,kenyaCompensationTemplate} from '../../backend/hrCompensationConfig.ts';
import {leaveEligibility} from '../../backend/hrLeaveEligibility.ts';
import {commonEducationLevels,resolveMinEducation,universalMinEducation} from '../../backend/roleMinEducation.ts';

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
assert.ok(seeded.payConfig,'The pay catalogue (rates, bands, exceptions) is provided for the payslip simulator');
assert.ok(seeded.payConfig.items.find(x=>x.code==='KE_PAYE').exceptions.some(e=>e.code==='PAYE_PWD'),'Exceptions reach the simulator');
assert.equal(grade1.payModelCode,'MONTHLY','A single enabled pay model is preselected');
const mandatoryLeave=['LEAVE_ANNUAL','LEAVE_SICK_FULL','LEAVE_SICK_HALF','LEAVE_MATERNITY','LEAVE_PATERNITY'];
for(const code of mandatoryLeave)assert.ok(grade1.leave.some(l=>l.code===code),code+' is in every grade leave package');
assert.deepEqual(grade1.leave.find(l=>l.code==='LEAVE_ANNUAL'),{code:'LEAVE_ANNUAL',daysPerYear:21,accrueMonthly:true,unit:'working_days',carryForwardDays:0});
assert.equal(grade1.leave.find(l=>l.code==='LEAVE_MATERNITY').unit,'months');
assert.ok(seeded.catalogue.leave.every(l=>l.legacy===undefined),'Legacy per-grade history is not sent to the screen');
assert.ok(plain.draft.grades.every(g=>g.leave.length===0&&g.benefitCodes.length===0&&g.payModelCode===''),'The benefit package is pay information too');

// ---- Benefits catalogue: enable a housing allowance and a compassionate leave type for the grade packages ----
const comp=(name,body)=>hrCompensationRoutes['POST /api/org/hr/compensation/'+name][0](ctx('admin',body));
const payDraft=(await comp('get',{legalEntityId:'LE_KE'})).config;
const housing=payDraft.items.find(x=>x.code==='AL_HOUSING');Object.assign(housing,{enabled:true,method:'percent',rate:0.15,taxable:true});
const compassion=payDraft.items.find(x=>x.code==='LEAVE_COMPASSION');Object.assign(compassion,{enabled:true,amount:3});
Object.assign(payDraft.items.find(x=>x.code==='DED_SACCO'),{enabled:true});
await comp('save',{legalEntityId:'LE_KE',config:payDraft});

// ---- Draft rules ----
await assert.rejects(()=>call('member','save',{legalEntityId:'LE_KE',grades:seeded.draft.grades}),/permission/i);
const compassionLeave={code:'LEAVE_COMPASSION',daysPerYear:4,accrueMonthly:false,unit:'working_days',carryForwardDays:0};
const package3={benefitCodes:['AL_HOUSING','OT_WEEKDAY'],benefitValues:{AL_HOUSING:{rate:0.2}},leave:[...seeded.draft.grades.find(g=>g.code==='JG03').leave,compassionLeave]};
const priced=seeded.draft.grades.map(g=>({...g,minSalary:20000+g.rank*10000,taxCodes:[],deductionCodes:g.rank===3?['DED_SACCO']:[],...(g.code==='JG03'?package3:{})}));
const withNew=[...priced,{code:'',rank:10,title:'Director',description:'Board-reporting leader',enabled:true,minSalary:300000,taxCodes:[],deductionCodes:[],payModelCode:'MONTHLY'}];
const saved=await call('maker','save',{legalEntityId:'LE_KE',grades:withNew,expectedVersion:0});
assert.equal(saved.version,1);
const director=saved.grades.find(g=>g.title==='Director');
assert.equal(director.code,'JG10','New grades are numbered by the server');
for(const g of saved.grades){
 assert.ok(g.taxCodes.includes('KE_PAYE'),'Mandatory taxes are always included');
 for(const code of ['KE_NSSF','KE_SHIF','KE_AHL'])assert.ok(g.deductionCodes.includes(code),'Mandatory deductions are always included');
}
assert.ok(saved.grades.find(g=>g.code==='JG03').deductionCodes.includes('DED_SACCO'),'A chosen optional deduction is kept');
const g3=saved.grades.find(g=>g.code==='JG03');
assert.deepEqual(g3.benefitCodes.slice().sort(),['AL_HOUSING','OT_WEEKDAY']);
assert.deepEqual(g3.benefitValues,{AL_HOUSING:{rate:0.2}});
assert.equal(g3.leave.find(l=>l.code==='LEAVE_COMPASSION').daysPerYear,4);
assert.equal(director.leave.length,5,'A grade submitted without leave still receives every mandatory leave type');
assert.equal(director.payModelCode,'MONTHLY');
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
await reject(g=>{g[0].benefitCodes=['NOT_A_BENEFIT'];return g;},/allowances, benefits or overtime/);
await reject(g=>{g[0].payModelCode='NOT_A_MODEL';return g;},/pay model/);
await reject(g=>{g[0].benefitCodes=['OT_WEEKDAY'];g[0].benefitValues={OT_WEEKDAY:{amount:-1}};return g;},/out of range/);
await reject(g=>{g[0].benefitCodes=['AL_HOUSING'];g[0].benefitValues={AL_HOUSING:{rate:5}};return g;},/fraction/);
await reject(g=>{g[0].leave.find(l=>l.code==='LEAVE_ANNUAL').daysPerYear=20;return g;},/legal minimum of 21/);
await reject(g=>{g[0].leave.find(l=>l.code==='LEAVE_ANNUAL').unit='calendar_days';return g;},/by law/);
await reject(g=>{g[0].leave.find(l=>l.code==='LEAVE_MATERNITY').daysPerYear=2;return g;},/legal minimum of 3 months/);
await reject(g=>{g[0].leave.push({code:'LEAVE_NOT_REAL',daysPerYear:1,unit:'working_days'});return g;},/Benefits catalogue/);
await reject(g=>{g[0].leave.push({...g[0].leave[0]});return g;},/listed twice/);
await reject(g=>{g[0].leave[0].carryForwardDays=500;return g;},/carry forward/);
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

// ---- Leave eligibility reads the APPROVED grade package, falling back to older per-grade entitlements ----
seed(root+'/hr_compensation_active/LE_KE',{...snapshot(root+'/hr_compensation_config/LE_KE').data,status:'active',activeVersion:1,version:1});
seed(root+'/positions/ROL_000004',{title:'Shift Supervisor',jobGradeByLegalEntity:{LE_KE:'JG03'}});
const eligibility=await leaveEligibility(org,{assignments:[{type:'primary',nodeId:'LE_KE',positionCode:'ROL_000004'}]});
const optionOf=code=>eligibility.options.find(o=>o.code===code);
assert.equal(optionOf('LEAVE_ANNUAL').daysPerYear,21);assert.equal(optionOf('LEAVE_ANNUAL').accrueMonthly,true);
assert.equal(optionOf('LEAVE_COMPASSION').daysPerYear,4,'A leave type chosen for the grade is offered with the grade allowance');
assert.equal(optionOf('LEAVE_STUDY'),undefined,'A leave type not selected for the grade is not offered');
seed(root+'/structure/LE_ZM',{level:'legal_entity',name:'Zambia Ltd',status:'active',attributes:{countryCode:'ZM',currencyCode:'ZMW'}});
seed(root+'/hr_job_grades_active/LE_ZM',{status:'active',activeVersion:1,currency:'ZMW',countryCode:'ZM',grades:[{code:'JG01',rank:1,title:'Only',description:'',enabled:true,minSalary:1,taxCodes:['T'],deductionCodes:['D']}]});
seed(root+'/hr_compensation_active/LE_ZM',{status:'active',version:1,items:[{code:'LEAVE_ANNUAL',name:'Annual leave',category:'leave',enabled:true,mandatory:true,description:'',leaveEntitlements:{JG01:{eligible:true,daysPerYear:25,accrueMonthly:true,unit:'working_days',carryForwardDays:0,requiresApprovedPlan:true}}}]});
seed(root+'/positions/ROL_000005',{title:'Clerk',jobGradeByLegalEntity:{LE_ZM:'JG01'}});
const older=await leaveEligibility(org,{assignments:[{type:'primary',nodeId:'LE_ZM',positionCode:'ROL_000005'}]});
assert.equal(older.options[0].daysPerYear,25,'Grades approved before leave moved to the grade keep their per-grade entitlements');

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

// ---- Job role minimum education: one universal level, required when the role has a grade ----
const everywhere=async()=>[{code:'SECONDARY',enabled:true},{code:'BACHELOR',enabled:true},{code:'OLD',enabled:false}];
const entities=[{id:'LE_KE',name:'Kenya Manufacturing'},{id:'LE_UG',name:'Uganda Trading'}];
assert.equal(await resolveMinEducation('BACHELOR','',true,entities,everywhere),'BACHELOR');
await assert.rejects(()=>resolveMinEducation('','',true,entities,everywhere),/minimum level of education.*required when the role has a job grade/);
await assert.rejects(()=>resolveMinEducation(undefined,'',true,entities,everywhere),/required when the role has a job grade/);
assert.equal(await resolveMinEducation(undefined,'SECONDARY',true,entities,everywhere),'SECONDARY','Older clients that omit the field keep the saved level');
await assert.rejects(()=>resolveMinEducation('DOCTORATE','',true,entities,everywhere),/not enabled in Kenya Manufacturing/);
await assert.rejects(()=>resolveMinEducation('OLD','',true,entities,everywhere),/not enabled in Kenya Manufacturing/);
// A level missing from just one legal entity is refused, naming that entity.
const ugLacks=async id=>id==='LE_UG'?[{code:'SECONDARY',enabled:true}]:[{code:'SECONDARY',enabled:true},{code:'BACHELOR',enabled:true}];
await assert.rejects(()=>resolveMinEducation('BACHELOR','',false,entities,ugLacks),/not enabled in Uganda Trading/);
assert.equal(await resolveMinEducation('SECONDARY','',false,entities,ugLacks),'SECONDARY');
await assert.rejects(()=>resolveMinEducation({LE_KE:'BACHELOR'},'',false,entities,everywhere),/one minimum level of education/);
assert.equal(await resolveMinEducation('','',false,entities,everywhere),'','A role with no grade needs no requirement');
assert.equal(await resolveMinEducation('SECONDARY','',false,entities,everywhere),'SECONDARY','A requirement may be set without a grade');

// Roles saved while education was per legal entity keep working: same level everywhere carries over, a mix does not.
assert.equal(universalMinEducation({minEducationByLegalEntity:{LE_KE:'SECONDARY',LE_UG:'SECONDARY'}}),'SECONDARY');
assert.equal(universalMinEducation({minEducationByLegalEntity:{LE_KE:'SECONDARY',LE_UG:'BACHELOR'}}),'');
assert.equal(universalMinEducation({minEducation:'BACHELOR',minEducationByLegalEntity:{LE_KE:'SECONDARY'}}),'BACHELOR','The universal field wins');
assert.equal(universalMinEducation({minEducation:'',minEducationByLegalEntity:{LE_KE:'SECONDARY'}}),'','Clearing the level is not undone by the old map');
assert.equal(universalMinEducation({}),'');
assert.equal(universalMinEducation(snapshot(root+'/positions/ROL_000003').data),'SECONDARY','The seeded role saved per entity reads as its single level');

// The picker offers only levels enabled in every legal entity, ordered by rank, and shows a rank only when entities agree.
const lv=(code,name,rank,enabled=true)=>({code,name,rank,enabled});
const common=commonEducationLevels([
 [lv('SECONDARY','Secondary',2),lv('BACHELOR','Bachelor degree',5),lv('MASTER','Master',6),lv('OLD','Old',1,false)],
 [lv('BACHELOR','Bachelor degree',5),lv('SECONDARY','Secondary',2),lv('MASTER','Master',7),lv('OLD','Old',1)],
]);
assert.deepEqual(common,[{code:'SECONDARY',name:'Secondary',rank:2},{code:'BACHELOR',name:'Bachelor degree',rank:5},{code:'MASTER',name:'Master',rank:null}]);
assert.deepEqual(commonEducationLevels([]),[]);

// ---- A grade cannot be approved while it uses a Benefits item that was switched off or removed ----
{
 const policy=kenyaCompensationTemplate();
 policy.items.find(x=>x.code==='AL_HOUSING').enabled=false;
 const cat=catalogueOf(policy);
 const grade={rank:4,title:'Supervisor',enabled:true,taxCodes:[],deductionCodes:[],benefitCodes:['AL_HOUSING'],leave:[],payModelCode:''};
 const off=catalogueProblems([grade],cat);
 assert.equal(off.length,1);
 assert.match(off[0],/AL_HOUSING.*switched off in Benefits/);
 const gone=catalogueProblems([{...grade,benefitCodes:['AL_REMOVED']}],cat);
 assert.match(gone[0],/AL_REMOVED.*no longer in the Benefits catalogue/);
 assert.deepEqual(catalogueProblems([{...grade,enabled:false}],cat),[],'a disabled grade is not held to the catalogue');
 policy.items.find(x=>x.code==='AL_HOUSING').enabled=true;
 assert.deepEqual(catalogueProblems([grade],catalogueOf(policy)),[]);
}

console.log('HR job grades governance, pay rules and universal role minimum education scenario passed');
