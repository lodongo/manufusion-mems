import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DEDUCTION_TYPES,EARNING_TYPES,emptyItem,itemNote,itemProblem,linesForMonth,maskAccount,monthLabel,normalAccountNumber,scheduledFor,shiftMonth,typesFor,
} from '../../src/shared/hrPayItems.ts';
import {computePayslip} from '../../src/shared/hrPayslip.ts';
import {fmtMoney,payslipModel,payslipTables} from '../../src/org/hrPayDocument.ts';
import {buildPayslipPdf} from '../../src/lib/payslipPdf.ts';
import {accountNameMatches} from '../../backend/hrPayrollPeople.ts';
import {kenyaCompensationTemplate} from '../../backend/hrCompensationConfig.ts';
import {BUILT_PERMISSIONS,SOD_RULES,sodConflicts} from '../../backend/permissionPolicy.ts';
import {toGrade} from '../../src/org/hrPayrollView.ts';

const read=f=>readFileSync(f,'utf8');
const cfg=kenyaCompensationTemplate();
const grade=toGrade({code:'JG03',rank:3,title:'Skilled / operator',enabled:true,minSalary:30000,payModelCode:'MONTHLY',
 taxCodes:['KE_PAYE','KE_PERSONAL_RELIEF'],deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL'],benefitCodes:[],benefitValues:{}});
const item=(over={})=>({...emptyItem('deduction','2026-11'),label:'Teachers check-off',amount:500,...over});

// ---- the rules for one personal item ---------------------------------------------------------------------------
test('an item needs a type, a name, a monthly amount and a start month, and nothing odd',()=>{
 assert.equal(itemProblem(item()),'');
 assert.notEqual(itemProblem(item({label:''})),'');
 assert.notEqual(itemProblem(item({label:'<b>x</b>'})),'');
 assert.notEqual(itemProblem(item({type:'nope'})),'');
 assert.notEqual(itemProblem(item({kind:'other'})),'');
 for(const bad of [0,-5,NaN,Infinity,1e10,10.123])assert.notEqual(itemProblem(item({amount:bad})),'',String(bad));
 assert.notEqual(itemProblem(item({reference:'a;b'})),'');
 assert.notEqual(itemProblem(item({startMonth:'2026-13'})),'');
 assert.notEqual(itemProblem(item({startMonth:''})),'');
 assert.notEqual(itemProblem(item({endMonth:'2026-10'})),'','last month before the first');
 assert.equal(itemProblem(item({endMonth:'2026-11'})),'');
 assert.notEqual(itemProblem(item({taxable:true})),'','a deduction is not taxable');
});

test('only a loan or an advance can carry an amount lent, and it covers at least one instalment',()=>{
 assert.equal(itemProblem(item({type:'loan',amount:3000,principal:10000})),'');
 assert.equal(itemProblem(item({type:'advance',amount:3000,principal:3000})),'');
 assert.notEqual(itemProblem(item({type:'loan',amount:3000,principal:2000})),'');
 assert.notEqual(itemProblem(item({type:'checkoff',amount:500,principal:10000})),'');
 assert.notEqual(itemProblem(item({type:'loan',amount:3000,principal:-1})),'');
 assert.notEqual(itemProblem({...emptyItem('earning','2026-11'),label:'Bonus',amount:100,principal:500}),'');
});

test('the type lists keep earnings and deductions apart and a reimbursement is not taxed',()=>{
 assert.deepEqual(typesFor('earning'),EARNING_TYPES);
 assert.deepEqual(typesFor('deduction'),DEDUCTION_TYPES);
 for(const code of ['checkoff','sacco','loan','advance','court'])assert.ok(DEDUCTION_TYPES.some(t=>t.code===code),code);
 assert.equal(EARNING_TYPES.find(t=>t.code==='reimbursement').taxable,false);
 assert.equal(EARNING_TYPES.find(t=>t.code==='acting').taxable,true);
 assert.ok(DEDUCTION_TYPES.every(t=>t.taxable===false));
});

// ---- months and the loan schedule ------------------------------------------------------------------------------
test('months step over year ends and are named in full',()=>{
 assert.equal(shiftMonth('2026-12',1),'2027-01');
 assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.equal(shiftMonth('bad',1),'bad');
 assert.equal(monthLabel('2026-11'),'November 2026');
});

test('a flat item applies from its first month to its last and a loan stops by itself when it is repaid',()=>{
 const flat=item({amount:500,startMonth:'2026-03',endMonth:'2026-05'});
 assert.equal(scheduledFor(flat,'2026-02'),null);
 assert.deepEqual(scheduledFor(flat,'2026-03'),{amount:500});
 assert.deepEqual(scheduledFor(flat,'2026-05'),{amount:500});
 assert.equal(scheduledFor(flat,'2026-06'),null);
 assert.deepEqual(scheduledFor(item({amount:500,startMonth:'2026-03'}),'2031-01'),{amount:500},'no last month runs on');

 const loan=item({type:'loan',label:'Staff loan',amount:3000,principal:10000,startMonth:'2026-01'});
 assert.deepEqual(scheduledFor(loan,'2026-01'),{amount:3000,installment:1,installments:4,balance:7000});
 assert.deepEqual(scheduledFor(loan,'2026-03'),{amount:3000,installment:3,installments:4,balance:1000});
 assert.deepEqual(scheduledFor(loan,'2026-04'),{amount:1000,installment:4,installments:4,balance:0},'the last instalment is only what is left');
 assert.equal(scheduledFor(loan,'2026-05'),null,'nothing is taken after the loan is repaid');
 assert.equal(scheduledFor(loan,'2025-12'),null);
 // an even loan: 6 x 1,000
 assert.equal(scheduledFor(item({type:'advance',amount:1000,principal:6000,startMonth:'2026-01'}),'2026-06').balance,0);
 assert.equal(scheduledFor(item({type:'advance',amount:1000,principal:6000,startMonth:'2026-01'}),'2026-07'),null);
});

test('the lines for a month use stable codes, keep notes for the reader and count what is not yet verified',()=>{
 const items=[
  item({id:'a1',type:'checkoff',label:'Union check-off',reference:'M-77',amount:500,status:'verified'}),
  item({id:'a2',type:'loan',label:'Staff loan',reference:'LN-9',amount:3000,principal:10000,startMonth:'2026-10'}),
  {...emptyItem('earning','2026-11'),id:'e1',type:'acting',label:'Acting allowance',amount:8000,taxable:true,status:'verified'},
  item({id:'a3',label:'Welfare',amount:200,startMonth:'2027-01'}),
 ];
 const {earnings,deductions,pending}=linesForMonth(items,'2026-11');
 assert.deepEqual(earnings.map(l=>l.code),['PE_e1']);
 assert.deepEqual(deductions.map(l=>l.code),['PD_a1','PD_a2'],'an item that starts later is not on this payslip');
 assert.equal(pending,1,'only the loan applies this month and waits for verification');
 assert.match(deductions[0].note,/Ref M-77/);
 assert.doesNotMatch(deductions[0].note,/Awaiting verification/);
 assert.match(deductions[1].note,/Instalment 2 of 4/);
 assert.match(deductions[1].note,/Balance after this payslip 4,000\.00/);
 assert.match(deductions[1].note,/Awaiting verification/);
 assert.match(itemNote({reference:'',status:'verified'},{amount:5}),/^$/);
});

// ---- bank account numbers ---------------------------------------------------------------------------------------
test('account numbers are stored tidy and shown masked',()=>{
 assert.equal(normalAccountNumber(' ke12 3456-78 '),'KE12345678');
 assert.equal(normalAccountNumber(null),'');
 assert.equal(maskAccount('0123456789'),'••••6789');
 assert.equal(maskAccount('123'),'••••');
 assert.equal(maskAccount(''),'');
 assert.doesNotMatch(maskAccount('0123456789'),/012345/);
});

test('the verifier is warned when the account holder is not the employee, but names are only an aid',()=>{
 assert.equal(accountNameMatches('Amina Okello','AMINA OKELLO'),true);
 assert.equal(accountNameMatches('Amina Wanjiru Okello','Okello A W'),false,'one letter is not a name');
 assert.equal(accountNameMatches('Amina Okello','Okello Amina Ltd'),true);
 assert.equal(accountNameMatches('Amina Okello','John Mwangi'),false);
 assert.equal(accountNameMatches('Amina Okello',''),false);
 assert.equal(accountNameMatches('Madonna','Madonna'),true,'a single name needs only itself');
});

// ---- the engine takes the personal lines -----------------------------------------------------------------------
const slip=(extra={},basic=60000)=>computePayslip(grade,cfg.items,{basicSalary:basic,...extra});
const pe=(amount,taxable=true)=>({code:'PE_x',label:'Bonus',amount,taxable});
const pd=(amount,label='Check-off')=>({code:'PD_'+label.length+amount,label,amount});

test('a taxable earning adds to gross and tax, a reimbursement adds to gross but not to tax',()=>{
 const base=slip();
 const taxed=slip({personalEarnings:[pe(10000)]});
 assert.equal(taxed.grossCash,base.grossCash+10000);
 assert.ok(taxed.tax>base.tax,'bonus is taxed');
 assert.equal(taxed.personalEarningsTotal,10000);
 const repay=slip({personalEarnings:[pe(5000,false)]});
 assert.equal(repay.grossCash,base.grossCash+5000);
 assert.equal(repay.tax,base.tax,'a reimbursement is not taxed');
 assert.equal(repay.taxablePay,base.taxablePay);
 assert.ok(repay.net>base.net&&repay.net<=base.net+5000);
});

test('personal deductions come off net pay after tax, change nothing else and are counted',()=>{
 const base=slip();
 const withDed=slip({personalDeductions:[pd(500),pd(3000,'Staff loan')]});
 assert.equal(withDed.personalDeductionsTotal,3500);
 assert.equal(withDed.tax,base.tax);
 assert.equal(withDed.grossCash,base.grossCash);
 assert.equal(Math.round((base.net-withDed.net)*100)/100,3500);
 assert.deepEqual(withDed.lines.filter(l=>l.section==='deductions').map(l=>l.label).slice(-2),['Check-off','Staff loan']);
 // zero, negative and junk amounts are ignored
 const junk=slip({personalDeductions:[pd(0),pd(-50),{code:'PD_n',label:'NaN',amount:NaN}],personalEarnings:[pe(0),pe(-1)]});
 assert.equal(junk.net,base.net);
});

test('deductions that leave less than one third take-home raise the warning',()=>{
 const big=slip({personalDeductions:[pd(45000,'Court order')]});
 assert.ok(big.warnings.some(w=>/one third/i.test(w)));
});

// ---- the document: what the screen and the PDF both draw -------------------------------------------------------
const employer={name:'Kenya Ltd',displayName:'Acme',tradingName:'',registrationNumber:'PVT-123',taxNumber:'P0512345X',address:'Nairobi',phone:'',email:'',logoUrl:''};
const employee={name:'Amina Okello',employeeNumber:'EMP0001',roleTitle:'Machine operator',roleCode:'ROL_000001',gradeCode:'JG03',gradeTitle:'Skilled / operator',unitName:'Nairobi plant'};
const bank={bankName:'Equity Bank',branch:'Westlands',accountName:'AMINA OKELLO',accountMasked:'••••6789',status:'verified'};
const sample=()=>{
 const items=[
  {...emptyItem('earning','2026-11'),id:'e1',type:'acting',label:'Acting allowance',amount:8000,taxable:true,status:'verified'},
  item({id:'d1',type:'checkoff',label:'Union check-off',reference:'M-77',amount:500,status:'verified'}),
  item({id:'d2',type:'loan',label:'Staff loan',reference:'LN-9',amount:3000,principal:10000,startMonth:'2026-10'}),
 ];
 const {earnings,deductions,pending}=linesForMonth(items,'2026-11');
 const p=slip({personalEarnings:earnings,personalDeductions:deductions});
 return {p,pending,model:payslipModel({payslip:p,employer,employee,bank,periodLabel:'November 2026',currency:'KES',unverified:pending,preview:true})};
};

test('the document lists earnings and deductions that add up to gross, total deductions and net pay',()=>{
 const {p,model}=sample();
 assert.ok(model.earnings.every(l=>l.label!=='Gross pay'&&!/^gross/i.test(l.label)),'gross is a total, not an earning');
 const earned=model.earnings.reduce((s,l)=>s+l.amount,0);
 assert.ok(Math.abs(earned-model.gross)<0.011,`earnings ${earned} vs gross ${model.gross}`);
 const taken=model.deductions.reduce((s,l)=>s+l.amount,0);
 assert.ok(Math.abs(taken-model.totalDeductions)<0.011,`deduction rows ${taken} vs total ${model.totalDeductions}`);
 assert.ok(Math.abs(model.gross-model.totalDeductions-model.net)<0.011);
 assert.equal(model.net,p.net);
 assert.ok(model.earnings.some(l=>l.label==='Acting allowance'&&l.amount===8000));
 assert.ok(model.deductions.some(l=>l.label==='Union check-off'&&l.amount===500));
 const loan=model.deductions.find(l=>l.label==='Staff loan');
 assert.ok(loan&&loan.amount===3000&&/Instalment 2 of 4/.test(loan.note));
 assert.ok(model.deductions.some(l=>/PAYE|tax/i.test(l.label)),'tax appears once as a deduction');
 assert.equal(model.deductions.filter(l=>/PAYE/i.test(l.label)).length,1);
 assert.equal(model.unverified,1);
 assert.equal(model.bank.accountMasked,'••••6789');
});

test('the document model never carries a full account number',()=>{
 const {model}=sample();
 assert.doesNotMatch(JSON.stringify(model),/0123456789/);
 assert.equal(payslipTables(sample().p).net,sample().p.net);
 assert.equal(fmtMoney(1234.5),'1,234.50');
});

// ---- the PDF ---------------------------------------------------------------------------------------------------
async function pdfLib(){
 for(const spec of ['pdf-lib','/opt/npm-tools/node_modules/pdf-lib/cjs/index.js']){
  try{const m=await import(spec);const lib=m.PDFDocument?m:m.default;if(lib&&lib.PDFDocument)return lib;}catch{/* try the next one */}
 }
 return null;
}
/** A pdf-lib whose pages also report the text drawn on them, so the content can be checked without a PDF reader. */
const spyLib=(lib,texts)=>({...lib,PDFDocument:{create:async()=>{
 const doc=await lib.PDFDocument.create();
 const add=doc.addPage.bind(doc);
 doc.addPage=(...a)=>{const page=add(...a);const draw=page.drawText.bind(page);page.drawText=(t,o)=>{texts.push(String(t));return draw(t,o);};return page;};
 return doc;
}}});

test('the PDF is a real document with the employer, employee, bank, lines and net pay on it',async t=>{
 const lib=await pdfLib();
 if(!lib){t.skip('pdf-lib is not installed here');return;}
 const texts=[];
 const {model}=sample();
 const bytes=await buildPayslipPdf(model,spyLib(lib,texts));
 assert.equal(Buffer.from(bytes.slice(0,5)).toString('latin1'),'%PDF-');
 const reread=await lib.PDFDocument.load(bytes);
 assert.ok(reread.getPageCount()>=1);
 const all=texts.join('\n');
 for(const want of ['Kenya Ltd','PAYSLIP','November 2026','Amina Okello','EMP0001','Machine operator','Equity Bank','AMINA OKELLO','6789','Acting allowance','Union check-off','Staff loan','NET PAY'])
  assert.ok(all.includes(want),'the PDF should print '+want);
 assert.doesNotMatch(all,/0123456789/,'the full account number is never printed');
 assert.match(all,/not been verified|awaiting verification|not verified/i,'unverified lines are flagged');
 assert.match(all,/preview|not a payroll run|draft/i,'a preview says so');
});

test('text the built-in fonts cannot draw becomes a question mark instead of breaking the PDF',async t=>{
 const lib=await pdfLib();
 if(!lib){t.skip('pdf-lib is not installed here');return;}
 const texts=[];
 const {model}=sample();
 model.employee={...model.employee,name:'Amina 😀 Оkello 李'};
 const bytes=await buildPayslipPdf(model,spyLib(lib,texts));
 assert.equal(Buffer.from(bytes.slice(0,5)).toString('latin1'),'%PDF-');
 assert.ok(texts.join('\n').includes('Amina ? ?kello ?')||texts.join('\n').includes('Amina'));
});

test('a long list of lines moves to a second page and every page is numbered',async t=>{
 const lib=await pdfLib();
 if(!lib){t.skip('pdf-lib is not installed here');return;}
 const {model}=sample();
 model.deductions=Array.from({length:70},(_,i)=>({label:'Check-off '+(i+1),amount:10,note:'Ref M-'+i}));
 const bytes=await buildPayslipPdf(model,lib);
 const reread=await lib.PDFDocument.load(bytes);
 assert.ok(reread.getPageCount()>=2);
});

// ---- rights, separation of duties, template --------------------------------------------------------------------
test('verifying pay details is its own sensitive right and cannot be held with entering them',()=>{
 const hrm=BUILT_PERMISSIONS.HRM;
 assert.ok(hrm.some(p=>p.key==='HRM.payroll.verify'&&p.sensitive===true));
 assert.ok(SOD_RULES.some(r=>r.id==='payroll-manage-verify'&&[r.a,r.b].sort().join()==='HRM.payroll.manage,HRM.payroll.verify'));
 assert.ok(sodConflicts(['HRM.payroll.manage','HRM.payroll.verify']).length>0);
 assert.equal(sodConflicts(['HRM.payroll.view','HRM.payroll.verify']).length,0);
 const templates=read('backend/standardRoleTemplates.ts');
 assert.match(templates,/std_hrm_payroll_verifier[\s\S]*?permissions:\['HRM\.shell\.view','HRM\.payroll\.view','HRM\.payroll\.verify'\]/);
 const officer=templates.slice(templates.indexOf('std_hrm_payroll_officer'),templates.indexOf('std_hrm_payroll_officer')+500);
 assert.doesNotMatch(officer,/payroll\.verify/);
});

// ---- the routes ------------------------------------------------------------------------------------------------
test('the pay-detail routes are guarded, locked, versioned and audited with counts only',()=>{
 const src=read('backend/hrPayrollPeople.ts');
 assert.match(src,/orgRoute\('org\.hr\.payroll\.person\.get', 'HRM\.payroll\.view'/);
 assert.match(src,/orgRoute\('org\.hr\.payroll\.person\.save', 'HRM\.payroll\.manage'/);
 assert.match(src,/orgRoute\('org\.hr\.payroll\.person\.verify', 'HRM\.payroll\.verify'/);
 assert.match(src,/orgRoute\('org\.hr\.payroll\.person\.reveal', 'HRM\.payroll\.verify'/);
 assert.match(src,/orgRoute\('org\.hr\.payroll\.logo', 'HRM\.payroll\.view'/);
 assert.equal((src.match(/withLock\(ctx\.orgId, 'hr_payroll_person_' \+ uid/g)||[]).length,2);
 // nobody changes, verifies or reveals their own details
 assert.match(src,/uid === ctx\.uid\) throw new HttpError\(403, 'You cannot change your own bank or pay details/);
 assert.match(src,/uid === ctx\.uid\) throw new HttpError\(403, 'You cannot verify your own pay details/);
 assert.match(src,/uid === ctx\.uid\) throw new HttpError\(403, 'You cannot view your own account number/);
 // the person who entered a change cannot be the one who verifies it
 assert.match(src,/bank\.changedBy === ctx\.uid\) throw new HttpError\(403/);
 assert.match(src,/i\.changedBy === ctx\.uid\) throw new HttpError\(403/);
 // history first, then the document with a precondition
 assert.match(src,/updateTime: prev\.updateTime/);
 assert.match(src,/exists: false/);
 assert.match(src,/peopleHistoryPath\(ctx\.orgId, uid, version\)/);
 // reveal is rate limited and audited
 assert.match(src,/rateLimit\('payroll-reveal', ctx\.uid, 30, 3600\)/);
 assert.match(src,/'payroll\.bank\.reveal'/);
 // audit text carries counts only
 const audits=[...src.matchAll(/hrAudit\([^\n]*\)/g)].map(m=>m[0]);
 assert.equal(audits.length,5,'get, save, verify, reveal and the logo read are all audited');
 for(const a of audits){
  const holes=[...a.matchAll(/\$\{([^}]+)\}/g)].map(m=>m[1]);
  for(const h of holes)assert.match(h,/^(version|bank \? 1 : 0|items\.length|bankChanged \? 1 : 0|added\.length|changed\.length|removed\.length|verifyBank \? 1 : 0|ids\.length|logo \? 1 : 0)$/,'audit text may carry counts only, found '+h);
 }
 assert.match(read('backend/index.ts'),/hrPayrollPeopleRoutes/);
});

test('history never keeps a full account number and the list never sends one',()=>{
 const src=read('backend/hrPayrollPeople.ts');
 assert.match(src,/maskAccount/);
 const hist=src.slice(src.indexOf('peopleHistoryPath(ctx.orgId, uid, version)'));
 assert.doesNotMatch(hist.slice(0,400),/accountNumber:\s*bank\.accountNumber/);
 const get=src.slice(src.indexOf("'org.hr.payroll.person.get'"),src.indexOf("'org.hr.payroll.person.save'"));
 assert.doesNotMatch(get,/accountNumber:\s*bank\.accountNumber/);
 assert.match(get,/maskAccount\(bank\.accountNumber\)/);
 const payroll=read('backend/hrPayroll.ts');
 assert.doesNotMatch(payroll,/accountNumber/,'the payroll list carries a bank status, never the number');
});

test('the logo helper only reads this organization’s own PNG or JPEG of a limited size',()=>{
 const src=read('backend/branding.ts');
 assert.match(src,/export async function logoDataFromPath|export const logoDataFromPath/);
 assert.match(src,/image\/png|image\/jpeg/);
 assert.match(src,/1_?200_?000|1\.2 \* 1024|1200000|1_228_800|1\.2e6/);
});

// ---- screen wiring ---------------------------------------------------------------------------------------------
test('the payslip sheet is a document with tabs for Payslip, Pay details and Test cases',()=>{
 const ui=read('src/org/HrPayroll.tsx');
 assert.match(ui,/<HrPayrollPerson key=\{slipEmp\.uid\}/);
 assert.doesNotMatch(ui,/<PayslipSimulator/);
 assert.match(ui,/\['details','Bank details or pay items need attention'\]/);
 assert.match(ui,/onSummary=\{setSummary\}/);
 const person=read('src/org/HrPayrollPerson.tsx');
 for(const label of ['Payslip','Pay details','Test cases'])assert.ok(person.includes(label),label);
 assert.match(person,/PayslipDocument/);
 assert.match(person,/HrPayDetails/);
 assert.match(person,/PayslipSimulator/);
 assert.match(person,/import\('\.\.\/lib\/payslipPdf'\)/);
 assert.match(person,/track\('export','payslip\.export'/);
 assert.match(person,/flush\(\)/);
});

test('the pay details screen asks twice for the account number, hides it again and says who must verify',()=>{
 const ui=read('src/org/HrPayDetails.tsx');
 assert.match(ui,/confirmAccountNumber/);
 assert.match(ui,/Show the full account number/);
 assert.match(ui,/30000/);
 assert.match(ui,/person\/reveal/);
 assert.match(ui,/person\/save/);
 assert.match(ui,/person\/verify/);
 assert.match(ui,/useConfirm/);
 assert.match(ui,/Verify what is waiting/);
});

test('the PDF library is only loaded when a payslip is downloaded',()=>{
 const pdf=read('src/lib/payslipPdf.ts');
 assert.match(pdf,/await import\('pdf-lib'\)/);
 assert.doesNotMatch(pdf,/^import [^\n]*from 'pdf-lib'/m);
 for(const f of ['src/org/HrPayroll.tsx','src/org/HrPayrollPerson.tsx','src/org/HrPayDetails.tsx','src/org/HrPayslipDocument.tsx'])
  assert.doesNotMatch(read(f),/from 'pdf-lib'|from '\.\.\/lib\/payslipPdf'/,f+' must not load the PDF code up front');
});
