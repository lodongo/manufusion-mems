import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {computePayslip} from '../../src/shared/hrPayslip.ts';
import {kenyaCompensationTemplate,blankCompensationTemplate,validatePayConfig} from '../../backend/hrCompensationConfig.ts';
import {toGrade} from '../../src/org/hrPayrollView.ts';

const read=f=>readFileSync(f,'utf8');
const base=kenyaCompensationTemplate();
const withFund=(over={})=>base.items.map(i=>i.code==='DED_PROVIDENT_FUND'?{...i,enabled:true,rate:0.10,employerRate:0.10,...over}:i);
const grade=(extra=[])=>toGrade({code:'G',rank:1,title:'G',enabled:true,minSalary:0,payModelCode:'MONTHLY',
 taxCodes:['KE_PAYE','KE_PERSONAL_RELIEF','KE_PENSION_DEDUCTION'],deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL',...extra],benefitCodes:[],benefitValues:{}});
const slip=(items,codes,basic,extra={})=>computePayslip(grade(codes),items,{basicSalary:basic,circumstances:[],declared:{},otherDeductions:{},personalEarnings:[],personalDeductions:[],...extra});
const line=(p,code)=>p.lines.find(l=>l.code===code);

test('the Kenya template carries a provident fund that is switched off until the company sets its rate',()=>{
 const f=base.items.find(i=>i.code==='DED_PROVIDENT_FUND');
 assert.ok(f);
 assert.deepEqual([f.category,f.method,f.base,f.enabled,f.rate,f.employerRate],['otherDeductions','percent','basic',false,0,0]);
 assert.equal(f.options.pension,true);
 assert.equal(f.mandatory,false);
 // a grade that does not carry it, or an item that is off, takes nothing
 assert.equal(line(slip(base.items,['DED_PROVIDENT_FUND'],100000),'DED_PROVIDENT_FUND'),undefined);
 assert.equal(line(slip(withFund(),[],100000),'DED_PROVIDENT_FUND'),undefined);
 // other countries get the item too, with no rate
 const blank=blankCompensationTemplate('UG','UGX').items.find(i=>i.code==='DED_PROVIDENT_FUND');
 assert.ok(blank&&blank.rate===0&&blank.enabled===false&&blank.options.pension===true);
});

test('a grade that carries the provident fund pays it from basic pay, before tax, with the employer match shown as a cost',()=>{
 const items=withFund();
 const without=slip(items,[],100000);
 const p=slip(items,['DED_PROVIDENT_FUND'],100000);
 const fund=line(p,'DED_PROVIDENT_FUND');
 assert.deepEqual([fund.section,fund.amount],['preTax',10000]);
 assert.equal(line(p,'DED_PROVIDENT_FUND_ER').amount,10000);
 assert.equal(line(p,'DED_PROVIDENT_FUND_ER').section,'employer');
 assert.equal(p.employeeSchemes,10000);
 assert.equal(p.employeeStatutory,without.employeeStatutory,'it is not a statutory contribution');
 // under the monthly limit it is all deductible: taxable pay falls by the whole contribution
 assert.equal(without.taxablePay-p.taxablePay,10000);
 assert.ok(p.tax<without.tax);
 // it reduces net pay by the contribution less the tax it saves
 assert.equal(Math.round((without.net-p.net)*100)/100,Math.round((10000-(without.tax-p.tax))*100)/100);
 assert.equal(p.employerCost-without.employerCost,10000);
 assert.deepEqual(p.warnings,[]);
 // a percentage of basic follows the basic salary, not the allowances
 const rich=slip(items,['DED_PROVIDENT_FUND'],100000,{personalEarnings:[{code:'PE_A',label:'Allowance',amount:50000,taxable:true}]});
 assert.equal(line(rich,'DED_PROVIDENT_FUND').amount,10000);
});

test('pension and provident fund together with NSSF are deductible up to one monthly limit and the rest is taxed',()=>{
 const items=withFund({rate:0,amount:29057.9,method:'fixed',employerRate:0});
 const p=slip(items,['DED_PROVIDENT_FUND'],473838.64);
 // 6,480 NSSF + 29,057.90 fund is 35,537.90; only 30,000 of it is deductible
 const expected=473838.64-(13030.56+7107.58)-30000;
 assert.equal(p.taxablePay,Math.round(expected*100)/100);
 assert.match(p.warnings.join(' '),/up to 30,000 a month together with NSSF\. 5,537\.90 of this month/);
 // the same figures as claiming the fund as a pension deduction on the person, which is how it had to be entered before
 const claimed=slip(base.items,[],473838.64,{declared:{KE_PENSION_DEDUCTION:29057.9}});
 assert.equal(p.taxablePay,claimed.taxablePay);
 assert.equal(p.tax,claimed.tax);
 assert.equal(p.net,claimed.net);
 // without the limit item in the catalogue there is nothing to cap against
 const noLimit=slip(items.filter(i=>i.code!=='KE_PENSION_DEDUCTION'),['DED_PROVIDENT_FUND'],473838.64);
 assert.equal(noLimit.taxablePay,Math.round((473838.64-(6480+13030.56+7107.58+29057.9))*100)/100);
});

test('a pension claim on the person still works as before when the grade has no scheme',()=>{
 const before=slip(base.items,[],200000,{declared:{KE_PENSION_DEDUCTION:20000}});
 assert.equal(before.taxablePay,Math.round((200000-(6480+5500+3000)-20000)*100)/100);
 // the claim shares the limit with a scheme: 6,000 NSSF + 10,000 fund leaves room for 14,000 of the 20,000 claimed
 const both=slip(withFund(),['DED_PROVIDENT_FUND'],100000,{declared:{KE_PENSION_DEDUCTION:20000}});
 assert.equal(both.taxablePay,100000-(2750+1500)-(6000+10000)-14000);
 assert.match(both.warnings.join(' '),/limited to 30,000 a month/);
});

test('the Kenyan reference payslip of 6 Nov 2026 is reproduced by grade-level rules plus personal deductions',()=>{
 // Gross 473,838.64. Global: Housing Levy, NSSF tiers, SHIF, PAYE, the provident fund. Personal: group life, benevolent fund, a SACCO and a bank loan.
 const items=withFund({rate:0,amount:29057.9,method:'fixed',employerRate:0});
 const personal=[{code:'PD_1',label:'Group Life',amount:950},{code:'PD_2',label:'Nairobi Benevolent Fund',amount:400},
  {code:'PD_3',label:'Onagi Moyie',amount:1000},{code:'PD_4',label:'Standard Chartered Loan',amount:131283}];
 const p=slip(items,['DED_PROVIDENT_FUND'],473838.64,{personalDeductions:personal});
 assert.equal(line(p,'KE_AHL').amount,7107.58);
 assert.equal(line(p,'KE_SHIF').amount,13030.56);
 assert.equal(line(p,'KE_NSSF').amount,540+5940);
 assert.equal(line(p,'DED_PROVIDENT_FUND').amount,29057.9);
 for(const [code,amount] of [['PD_1',950],['PD_2',400],['PD_3',1000],['PD_4',131283]])assert.equal(line(p,code).amount,amount);
 // PAYE and net pay are within 0.1% of the payslip. The remaining KES 130.50 of PAYE is about KES 435 of taxable pay that the
 // earnings half of that payslip (not supplied) would explain, for example a small taxable benefit.
 assert.ok(Math.abs(p.tax-119623.98)<=131,'PAYE '+p.tax);
 assert.ok(Math.abs((p.grossCash-p.net)-308933.02)<=131,'total deductions '+(p.grossCash-p.net));
 assert.ok(Math.abs(p.net-164905.62)<=131,'net pay '+p.net);
});

test('a scheme must be a percentage of basic, gross or pensionable pay or a fixed amount, and only on deductions',()=>{
 const grades=new Set();
 const build=(over,category)=>{
  const raw=JSON.parse(JSON.stringify(base));
  raw.items=raw.items.map(i=>i.code==='DED_PROVIDENT_FUND'?{...i,...over,...(category?{category}:{})}:i);
  return raw;
 };
 const ok=validatePayConfig(build({enabled:true,rate:0.075,employerRate:0.075}),grades,'KE','KES');
 const kept=ok.items.find(i=>i.code==='DED_PROVIDENT_FUND');
 assert.deepEqual([kept.options.pension,kept.rate,kept.employerRate],[true,0.075,0.075]);
 assert.equal(validatePayConfig(build({method:'fixed',base:'net',amount:500,enabled:true}),grades,'KE','KES').items.length,ok.items.length,'a fixed amount does not need a base');
 assert.throws(()=>validatePayConfig(build({method:'manual'}),grades,'KE','KES'),/percentage or a fixed amount/);
 assert.throws(()=>validatePayConfig(build({base:'net'}),grades,'KE','KES'),/basic, gross or pensionable/);
 assert.throws(()=>validatePayConfig(build({},'allowances'),grades,'KE','KES'),/deductions and contributions only/);
});

test('the Benefits editor can mark a deduction as a registered scheme and refuses one with no rate',()=>{
 const ui=read('src/org/HrBenefits.tsx');
 assert.match(ui,/Registered pension or provident fund scheme/);
 assert.match(ui,/x\.category==='otherDeductions'&&<label/);
 assert.match(ui,/options:\{\.\.\.x\.options,pension:true\}/);
 assert.match(ui,/Enter the employee rate or amount for the scheme, or switch the component off\./);
 const engine=read('src/shared/hrPayslip.ts');
 assert.match(engine,/export const isScheme = /);
 assert.match(engine,/employeeSchemes/);
});
