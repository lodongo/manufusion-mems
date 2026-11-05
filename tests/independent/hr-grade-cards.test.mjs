import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gradeFacts,exportRows,EXPORT_HEADER,rolesText,money} from '../../src/org/hrGradeFacts.ts';

const cat={
 countryCode:'KE',
 taxes:[{code:'KE_PAYE',name:'PAYE'}],deductions:[{code:'KE_NSSF',name:'NSSF'},{code:'DED_SACCO',name:'SACCO'}],
 payModels:[{code:'PM_MONTHLY',name:'Monthly salary',enabled:true}],
 benefits:[{code:'ALW_HOUSE',name:'House allowance'},{code:'BEN_MEDICAL',name:'Medical cover'}],
 leave:[{code:'LV_ANNUAL',name:'Annual leave',enabled:true},{code:'LV_SICK',name:'Sick leave',enabled:true}],
};
const grade=(over={})=>({code:'JG03',rank:3,title:'Skilled / operator',description:'',enabled:true,minSalary:30000,
 taxCodes:['KE_PAYE'],deductionCodes:['KE_NSSF'],payModelCode:'PM_MONTHLY',benefitCodes:['ALW_HOUSE','BEN_MEDICAL'],benefitValues:{},
 leave:[{code:'LV_ANNUAL',daysPerYear:21,accrueMonthly:true,unit:'working_days',carryForwardDays:5}],...over});

test('the card menu spells out pay, benefits, leave, taxes, deductions and roles for pay viewers',()=>{
 const f=Object.fromEntries(gradeFacts(grade(),cat,true,'KES',[{code:'ROL_000001',title:'Machine operator'}]).map(x=>[x.label,x]));
 assert.equal(f['Minimum monthly salary'].value,'KES 30,000');
 assert.equal(f['Pay model'].value,'Monthly salary');
 assert.equal(f['Allowances, benefits and incentives'].value,'House allowance, Medical cover');
 assert.equal(f['Leave'].value,'Annual leave 21 working days, earned monthly');
 assert.equal(f['Taxes'].value,'PAYE');
 assert.equal(f['Deductions'].value,'NSSF');
 assert.equal(f['Job roles'].value,'1 job role: Machine operator');
});

test('people who may not see pay get no pay detail in the menu',()=>{
 const labels=gradeFacts(grade(),cat,false,'KES',[]).map(x=>x.label);
 assert.deepEqual(labels,['Status','Job roles']);
});

test('gaps are flagged: no salary, no pay model, no leave',()=>{
 const f=Object.fromEntries(gradeFacts(grade({minSalary:null,payModelCode:'',leave:[]}),cat,true,'KES',[]).map(x=>[x.label,x]));
 assert.equal(f['Minimum monthly salary'].warn,true);
 assert.equal(f['Minimum monthly salary'].value,'Not set');
 assert.equal(f['Pay model'].warn,true);
 assert.equal(f['Leave'].warn,true);
 const ok=Object.fromEntries(gradeFacts(grade(),cat,true,'KES',[]).map(x=>[x.label,x]));
 assert.ok(!ok['Pay model'].warn&&!ok['Leave'].warn&&!ok['Minimum monthly salary'].warn);
});

test('a disabled grade says so, and a description appears only when there is one',()=>{
 const f=gradeFacts(grade({enabled:false,description:'  Senior operators  '}),cat,false,'KES',[]);
 assert.match(f[0].value,/^Disabled/);
 assert.equal(f.at(-1).value,'Senior operators');
 assert.ok(!gradeFacts(grade(),cat,false,'KES',[]).some(x=>x.label==='Description'));
});

test('roles are summarised, long lists are cut',()=>{
 assert.equal(rolesText([]),'None allocated');
 const many=Array.from({length:7},(_,i)=>({code:'ROL_00000'+i,title:'Role '+i}));
 assert.equal(rolesText(many),'7 job roles: Role 0, Role 1, Role 2, Role 3, Role 4 and 2 more');
 assert.equal(money(1234.5,'KES'),'KES 1,234.5');
 assert.equal(money(null),'—');
});

test('the Excel copy is in grade order, has one cell per heading and holds text or numbers only',()=>{
 const rows=exportRows([grade({code:'JG09',rank:9,title:'=HYPERLINK("x")'}),grade({code:'JG01',rank:1,title:'Casual'})],cat,'KES',{JG01:[{code:'ROL_000001',title:'A'},{code:'ROL_000002',title:'B'}]});
 assert.deepEqual(rows.map(r=>r[0]),[1,9]);
 assert.ok(rows.every(r=>r.length===EXPORT_HEADER.length));
 assert.equal(rows[0][11],2,'job role count');
 assert.ok(rows.flat().every(c=>c===null||c===undefined||typeof c==='string'||typeof c==='number'));
 assert.equal(rows[1][1],'=HYPERLINK("x")','kept as text; the workbook writer never turns values into formulas');
});

test('the cards screen is mobile-first: tap to open, a menu button per card, lazy paging, audited export',()=>{
 const cards=readFileSync('src/org/HrGradeCards.tsx','utf8');
 assert.match(cards,/onClick=\{\(\)=>onOpen\(g\)\}/,'tapping the card opens the grade');
 assert.match(cards,/aria-label=\{'More about grade '\+g\.rank\}/,'each card has its own menu button');
 assert.match(cards,/aria-haspopup="dialog"/);
 assert.match(cards,/w-12 shrink-0/,'the menu button is a full-height touch target');
 assert.match(cards,/IntersectionObserver/,'cards load as the list is scrolled');
 assert.match(cards,/sort\(\(a,b\)=>a\.rank-b\.rank\)/,'cards follow the grade number');
 assert.match(cards,/track\('export','table\.export'/,'every export is audited');
 assert.match(cards,/void flush\(\)/,'the audit record is sent at once');
 assert.doesNotMatch(cards,/<table|RichTable/);
 const screen=readFileSync('src/org/HrJobGrades.tsx','utf8');
 assert.match(screen,/aria-label="Job grades menu"/,'the extra information lives behind one menu button');
 assert.match(screen,/<GradeMenu /);
 assert.match(screen,/onPayslip=\{/,'the card menu opens the payslip preview directly');
 assert.match(screen,/edit\.tab\|\|'basics'/);
 assert.match(screen,/overflow-y-auto overscroll-contain/,'only the content scrolls');
 const menuAt=screen.indexOf('menuOpen&&data?.entity&&<Sheet');
 assert.ok(menuAt>0);
 assert.ok(screen.indexOf('A job grade is an employment band')>menuAt,'the explanation sits inside the menu, not above the cards');
 assert.ok(screen.indexOf('status.map(')>menuAt,'the draft and approval status are listed inside the menu');
 assert.doesNotMatch(screen,/was approved under/,'the old footer line above the cards is gone');
 assert.ok(screen.indexOf('to finish before this can be submitted')>menuAt,'the submit checklist sits inside the menu');
});
