import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPayrollRows,belowMinimum,onPayroll,listRow,salaryState,PROBLEM_TEXT} from '../../backend/hrPayrollRows.ts';
import {BUILT_PERMISSIONS,SOD_RULES,sodConflicts} from '../../backend/permissionPolicy.ts';
import {kenyaCompensationTemplate} from '../../backend/hrCompensationConfig.ts';
import {
 BASIC_MAX,EXPORT_HEADER,belowMin,countsOf,exportTable,initials,matches,salaryIssue,toGrade,
} from '../../src/org/hrPayrollView.ts';
import {computePayslip} from '../../src/shared/hrPayslip.ts';

const read=f=>readFileSync(f,'utf8');

// ---- employee -> role -> grade ---------------------------------------------------------------------------------
const nodes=new Map([
 ['LE1',{level:'legal_entity',name:'Kenya Ltd',status:'active'}],
 ['LE2',{level:'legal_entity',name:'Uganda Ltd',status:'active'}],
 ['S1',{level:'site',name:'Nairobi plant',parentId:'LE1',status:'active'}],
 ['S2',{level:'site',name:'Kampala plant',parentId:'LE2',status:'active'}],
 ['SX',{level:'site',name:'Closed site',parentId:'LE1',status:'inactive'}],
]);
const positions=new Map([
 ['ROL_000001',{title:'Machine operator',jobGradeByLegalEntity:{LE1:'JG03',LE2:'JG02'}}],
 ['ROL_000002',{title:'Supervisor',jobGradeByLegalEntity:{LE1:'JG05'}}],
 ['ROL_000003',{title:'Clerk',jobGradeByLegalEntity:{LE1:'JG99'}}],
 ['ROL_000004',{title:'Cleaner',jobGradeByLegalEntity:{LE1:'JG01'}}],
 ['ROL_000005',{title:'Storekeeper'}],
]);
const grades=[
 {code:'JG01',title:'Casual',enabled:true,minSalary:15000},
 {code:'JG03',title:'Skilled / operator',enabled:true,minSalary:30000},
 {code:'JG05',title:'Supervisor',enabled:false,minSalary:60000},
 {code:'JG06',title:'No minimum',enabled:true,minSalary:0},
];
const user=(id,first,last,assignments,extra={})=>({id,data:{firstName:first,lastName:last,employeeNumber:'EMP'+id,status:'active',assignments,...extra}});
const prim=(nodeId,positionCode)=>({type:'primary',nodeId,positionCode});
const build=(users,salaries={})=>buildPayrollRows({entityId:'LE1',users,nodes,positions,grades,salaries});

test('each employee shows the role they hold and the grade that role has in THIS legal entity',()=>{
 const {rows}=build([user('u1','Amina','Okello',[prim('S1','ROL_000001')])]);
 assert.equal(rows.length,1);
 assert.deepEqual([rows[0].roleCode,rows[0].roleTitle,rows[0].gradeCode,rows[0].gradeTitle,rows[0].minSalary,rows[0].problem],
  ['ROL_000001','Machine operator','JG03','Skilled / operator',30000,'']);
 // the same role is a different grade in the other legal entity
 const other=buildPayrollRows({entityId:'LE2',users:[user('u2','Peter','Ssemwogerere',[prim('S2','ROL_000001')])],nodes,positions,
  grades:[{code:'JG02',title:'Semi-skilled',enabled:true,minSalary:20000}],salaries:{}});
 assert.equal(other.rows[0].gradeCode,'JG02');
 assert.equal(other.rows[0].minSalary,20000);
});

test('employees of other legal entities are left out and nobody is guessed into one',()=>{
 const {rows,unplaced}=build([
  user('u1','Amina','Okello',[prim('S1','ROL_000001')]),
  user('u2','Peter','Ssemwogerere',[prim('S2','ROL_000001')]),
  user('u3','No','Deployment',[]),
  user('u4','Two','Entities',[prim('S1','ROL_000001'),prim('S2','ROL_000001')]),
  user('u5','Closed','Site',[prim('SX','ROL_000001')]),
 ]);
 assert.deepEqual(rows.map(r=>r.uid),['u1']);
 assert.deepEqual(unplaced.map(u=>[u.uid,u.reason]).sort(),[['u3','no_entity'],['u4','several_entities'],['u5','no_entity']]);
});

test('role and grade problems are named, not hidden, and never produce a minimum to check against',()=>{
 const {rows}=build([
  user('a','A','NoRole',[{type:'primary',nodeId:'S1'}]),
  user('b','B','TwoRoles',[prim('S1','ROL_000001'),prim('S1','ROL_000002')]),
  user('c','C','GoneRole',[prim('S1','ROL_009999')]),
  user('d','D','NoGrade',[prim('S1','ROL_000005')]),
  user('e','E','GoneGrade',[prim('S1','ROL_000003')]),
  user('f','F','OffGrade',[prim('S1','ROL_000002')]),
 ]);
 const by=Object.fromEntries(rows.map(r=>[r.uid,r]));
 assert.equal(by.a.problem,'no_role');
 assert.equal(by.b.problem,'several_roles');
 assert.equal(by.c.problem,'role_missing');
 assert.equal(by.d.problem,'no_grade');
 assert.equal(by.e.problem,'grade_missing');
 assert.equal(by.e.gradeCode,'');
 assert.equal(by.f.problem,'grade_disabled');
 for(const code of Object.keys(PROBLEM_TEXT))assert.ok(PROBLEM_TEXT[code].length>5,code);
 for(const r of [by.a,by.b,by.c,by.d,by.e])assert.equal(r.minSalary,0);
});

test('applicants and disabled accounts are not on payroll; saved salaries attach by employee and bad values are ignored',()=>{
 assert.equal(onPayroll({role:'applicant'}),false);
 assert.equal(onPayroll({status:'disabled'}),false);
 assert.equal(onPayroll({role:'employee',status:'active'}),true);
 const {rows}=build([
  user('u1','Zed','Z',[prim('S1','ROL_000001')]),
  user('u2','Abe','A',[prim('S1','ROL_000004')]),
  user('u3','Ann','B',[prim('S1','ROL_000001')],{role:'applicant'}),
  user('u4','Bob','C',[prim('S1','ROL_000001')],{status:'disabled'}),
  user('u5','Cy','D',[prim('S1','ROL_000001')]),
 ],{u1:45000,u2:'lots',u5:-5});
 assert.deepEqual(rows.map(r=>r.name),['Abe A','Cy D','Zed Z']);
 assert.deepEqual(rows.map(r=>r.basic),[null,null,45000]);
});

test('below the minimum is flagged only when there is a minimum to compare with',()=>{
 assert.equal(belowMinimum(20000,30000),true);
 assert.equal(belowMinimum(30000,30000),false);
 assert.equal(belowMinimum(null,30000),false);
 assert.equal(belowMinimum(10,0),false);
});

// ---- what the screen does with the rows -----------------------------------------------------------------------
const emp=(over={})=>({uid:'u1',name:'Amina Okello',employeeNumber:'E1',status:'active',roleCode:'ROL_000001',roleTitle:'Machine operator',
 gradeCode:'JG03',gradeTitle:'Skilled / operator',minSalary:30000,salary:'none',problem:'',problemText:'',...over});

test('the list carries where a salary stands and never the amount',()=>{
 assert.equal(salaryState(null,30000),'none');
 assert.equal(salaryState(20000,30000),'below');
 assert.equal(salaryState(30000,30000),'ok');
 assert.equal(salaryState(10,0),'ok');
 const {rows}=build([user('u1','Amina','Okello',[prim('S1','ROL_000001')]),user('u2','Peter','P',[prim('S1','ROL_000001')])],{u1:45000,u2:12345.67});
 const sent=rows.map(listRow);
 for(const r of sent){
  assert.equal('basic' in r,false,'the amount must not be on a list row');
  assert.deepEqual(Object.keys(r).filter(k=>/salary|basic|net|gross|pay$/i.test(k)&&k!=='minSalary'),['salary']);
 }
 assert.deepEqual(sent.map(r=>r.salary).sort(),['below','ok'].sort());
 const wire=JSON.stringify(sent);
 assert.doesNotMatch(wire,/45000|12345/,'no salary figure anywhere in what the list sends');
});

test('red appears under the minimum and not before anything is entered',()=>{
 assert.equal(belowMin(29999.99,30000),true);
 assert.equal(belowMin(30000,30000),false);
 assert.equal(belowMin(NaN,30000),false);
 assert.equal(belowMin(100,0),false);
});

test('a salary box accepts positive amounts with at most 2 decimals and refuses the rest',()=>{
 assert.equal(salaryIssue(NaN),'');
 assert.equal(salaryIssue(45000.5),'');
 for(const bad of [0,-1,Infinity,BASIC_MAX+1,10.123])assert.notEqual(salaryIssue(bad),'',String(bad));
});

test('the four views count and filter the same way, from the salary state alone',()=>{
 const list=[emp({uid:'a',salary:'below'}),emp({uid:'b',salary:'ok'}),emp({uid:'c'}),emp({uid:'d',problem:'no_grade',problemText:'x',gradeCode:'',minSalary:0})];
 assert.deepEqual(countsOf(list),{all:4,below:1,none:2,attention:1,details:4});
 assert.deepEqual(list.filter(e=>matches(e,'below')).map(e=>e.uid),['a']);
 assert.deepEqual(list.filter(e=>matches(e,'none')).map(e=>e.uid),['c','d']);
 assert.equal(initials('Amina Okello'),'AO');
 assert.equal(initials('  '),'?');
});

// ---- payslip and Excel ----------------------------------------------------------------------------------------
const cfg=kenyaCompensationTemplate();
const payGrade=(over={})=>({code:'JG03',rank:3,title:'Skilled / operator',enabled:true,minSalary:30000,payModelCode:'MONTHLY',
 taxCodes:['KE_PAYE','KE_PERSONAL_RELIEF'],deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL'],benefitCodes:[],benefitValues:{},...over});

test('the payslip inside the opened employee comes from the grade and the typed salary',()=>{
 const slip=basicSalary=>computePayslip(toGrade(payGrade()),cfg.items,{basicSalary,circumstances:[],declared:{},otherDeductions:{},personalEarnings:[],personalDeductions:[]});
 const a=slip(50000);
 assert.ok(a.grossCash>=50000&&a.net>0&&a.net<a.grossCash&&a.totalCostToEmployer>=a.grossCash);
 assert.ok(slip(80000).net>a.net);
});

test('the Excel copy has one cell per heading, holds only text and numbers, and has no salary or pay figures',()=>{
 const list=[emp({uid:'a',salary:'below',payBank:'verified',payItems:2,payPending:1}),emp({uid:'b',name:'=HYPERLINK("x")'})];
 const rows=exportTable(list);
 assert.equal(rows.length,2);
 for(const r of rows){
  assert.equal(r.length,EXPORT_HEADER.length);
  for(const cell of r)assert.ok(cell===null||['string','number'].includes(typeof cell));
 }
 for(const h of EXPORT_HEADER)assert.doesNotMatch(h,/salary|basic|gross|net pay|currency|cost|minimum/i,h);
 const col=n=>EXPORT_HEADER.indexOf(n);
 assert.equal(rows[0][col('Bank details')],'Verified');
 assert.equal(rows[0][col('Personal pay items')],2);
 assert.equal(rows[0][col('Pay items awaiting verification')],1);
 assert.equal(rows[1][col('Bank details')],'None');
});

// ---- rights, separation of duties, templates, catalogue --------------------------------------------------------
test('payroll rights are sensitive, apart from employee administration, and templates keep view and enter separate',()=>{
 const hrm=BUILT_PERMISSIONS.HRM;
 for(const key of ['HRM.payroll.view','HRM.payroll.manage'])assert.ok(hrm.some(p=>p.key===key&&p.sensitive===true),key);
 assert.ok(SOD_RULES.some(r=>r.id==='payroll-employees-manage'&&r.a==='HRM.payroll.manage'&&r.b==='HRM.employees.manage'));
 assert.ok(sodConflicts(['HRM.payroll.manage','HRM.employees.manage']).length>0);
 assert.equal(sodConflicts(['HRM.payroll.view','HRM.employees.manage']).length,0);
 const templates=read('backend/standardRoleTemplates.ts');
 assert.match(templates,/std_hrm_payroll_officer[\s\S]*?permissions:\['HRM\.shell\.view','HRM\.payroll\.view','HRM\.payroll\.manage'\]/);
 assert.match(templates,/std_hrm_payroll_viewer[\s\S]*?permissions:\['HRM\.shell\.view','HRM\.payroll\.view'\]/);
 const viewer=templates.slice(templates.indexOf('std_hrm_payroll_viewer'),templates.indexOf('std_hrm_payroll_viewer')+400);
 assert.doesNotMatch(viewer,/payroll\.manage'\]/);
 assert.match(read('backend/transactionCatalogue.ts'),/\^org\\\/hr\\\/payroll\\\//);
 assert.match(read('backend/transactionBlueprints.ts'),/PRL:Payroll/);
});

test('the payroll routes are guarded, audited without amounts, versioned, locked and refuse self-pay',()=>{
 const src=read('backend/hrPayroll.ts');
 assert.match(src,/orgRoute\('org\.hr\.payroll\.get', 'HRM\.payroll\.view'/);
 assert.match(src,/orgRoute\('org\.hr\.payroll\.save', 'HRM\.payroll\.manage'/);
 assert.match(src,/withLock\(ctx\.orgId, 'hr_payroll_'/);
 assert.match(src,/uid === ctx\.uid[\s\S]*?cannot set your own salary/);
 assert.match(src,/not on this legal entity’s payroll/);
 assert.match(src,/updateTime: prev\.updateTime/);
 assert.match(src,/inputHistoryPath\(ctx\.orgId, entityId, version\)/);
 const audits=[...src.matchAll(/hrAudit\([^\n]*\)/g)].map(m=>m[0]);
 assert.equal(audits.length,2);
 for(const a of audits){
  const holes=[...a.matchAll(/\$\{([^}]+)\}/g)].map(m=>m[1]);
  for(const h of holes)assert.match(h,/^(rows\.length|unplaced\.length|version|changed|cleared|below)$/,'audit text may carry counts only, found '+h);
 }
 assert.match(src,/selfUid: ctx\.uid/);
 assert.match(read('backend/index.ts'),/hrPayrollRoutes/);
});

test('salaries are never added to the employee record or any other HR screen',()=>{
 const src=read('backend/hrPayroll.ts');
 assert.doesNotMatch(src,/organizations\/\$\{[^}]+\}\/users|writeDoc\(`?[^)]*users/);
 assert.match(src,/hr_payroll_inputs/);
 for(const f of ['backend/hrJobGrades.ts','backend/hrEducationConfig.ts'])assert.doesNotMatch(read(f),/hr_payroll_inputs/);
});

// ---- screen wiring ---------------------------------------------------------------------------------------------
test('Payroll opens from the HR menu by permission and keeps the action bar fixed while the cards scroll',()=>{
 const shell=read('src/org/HrShell.tsx'),home=read('src/org/OrgHomePage.tsx');
 assert.match(shell,/\['HR20','Payroll'\]/);
 assert.match(shell,/FIXED_FRAME:readonly string\[\]=\[[^\]]*'HR20'/);
 assert.match(shell,/NOT_LISTED:readonly string\[\]=\[[^\]]*'HR20'/);
 assert.match(shell,/sectionCode==='HR20'&&<HrPayroll\/>/);
 assert.match(home,/label: 'Payroll', path: 'hr\/HR20', permission: 'HRM\.payroll\.view'/);
 assert.match(home,/id === 'HR20' && \(hasPerm\(data\.permissions,'HRM\.payroll\.view'\)\|\|hasPerm\(data\.permissions,'HRM\.payroll\.manage'\)\)/);
 const ui=read('src/org/HrPayroll.tsx');
 assert.match(ui,/shrink-0[^\n]*border-b[\s\S]*?overflow-y-auto overscroll-contain/);
 assert.match(ui,/IntersectionObserver/);
 assert.match(ui,/aria-label="Payroll menu"/);
 assert.match(ui,/<Sheet title="Payroll"/);
});

test('the list never holds a salary: the server strips it and the amount is read and saved one employee at a time',()=>{
 const route=read('backend/hrPayroll.ts');
 assert.match(route,/\.\.\.listRow\(r\)/);
 assert.doesNotMatch(route.slice(route.indexOf("'org.hr.payroll.get'"),route.indexOf("'org.hr.payroll.save'")),/basic\s*[:,]/);
 assert.match(route,/This salary was changed by someone else since you opened it/);
 const people=read('backend/hrPayrollPeople.ts');
 assert.match(people,/const entered = isObj\(input\?\.data\.salaries\)[^\n]*\[uid\]/);
 assert.match(people,/\n\s+salary,\n/);
 assert.match(people,/bank=\$\{[^}]+\} items=\$\{[^}]+\} salary=\$\{/);
 const list=read('src/org/HrPayroll.tsx');
 assert.doesNotMatch(list,/NumField|computePayslip|\.basic\b|Save salaries|beforeunload/);
 assert.match(list,/exportTable\(employees\)/);
 assert.match(list,/e\.uid!==data\?\.selfUid/);
 assert.match(list,/track\('export','table\.export','hr-payroll'/);
 assert.match(list,/shrink-0[^\n]*border-b[\s\S]*?overflow-y-auto overscroll-contain/);
});

test('the salary slot sits inside the opened employee: red under the minimum, never your own, saved with the value it opened with',()=>{
 const ui=read('src/org/HrPayrollPerson.tsx');
 assert.match(ui,/invalid=\{below\|\|!!issue\}/);
 assert.match(ui,/disabled=\{!canEditSalary\|\|!salaryReady\|\|savingSalary\}/);
 assert.match(ui,/callBackend\('\/api\/org\/hr\/payroll\/save',\{legalEntityId:entity\.id,salaries:\{\[emp\.uid\]:value\},expected:\{\[emp\.uid\]:base\}\}\)/);
 assert.match(ui,/You cannot set your own salary/);
 assert.match(read('src/org/hrFormParts.tsx'),/hintTone/);
 const sim=read('src/org/HrPayslipSimulator.tsx');
 assert.match(sim,/onBasicChange/);
 assert.match(sim,/invalid=\{below\}/);
});
