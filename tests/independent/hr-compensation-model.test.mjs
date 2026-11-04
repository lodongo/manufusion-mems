import test from 'node:test';
import assert from 'node:assert/strict';
import {kenyaCompensationTemplate,blankCompensationTemplate,validatePayConfig,PAY_CATEGORIES}
 from '../../backend/hrCompensationConfig.ts';
import {computePayslip} from '../../src/shared/hrPayslip.ts';

const kenya=kenyaCompensationTemplate();
const grade={code:'JG01',title:'Reference',minSalary:100000,payModelCode:'MONTHLY',taxCodes:['KE_PAYE','KE_PERSONAL_RELIEF'],deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL'],benefitCodes:[],benefitValues:{}};
const at=(config,code)=>config.items.find(x=>x.code===code);
test('Kenya template covers pay models, overtime, benefits, leave, incentives, taxes and deduction references',()=>{
 for(const category of PAY_CATEGORIES){
  assert.ok(kenya.items.some(x=>x.category===category),category+' missing');
 }
 assert.ok(kenya.items.some(x=>x.code==='KE_NSSF'&&x.mandatory&&x.maximum===6480));
 assert.ok(kenya.items.some(x=>x.code==='KE_SHIF'&&x.minimum===300&&x.rate===0.0275));
 assert.ok(kenya.items.some(x=>x.code==='KE_AHL'&&x.employerRate===0.015&&x.rate===0.015));
 assert.ok(kenya.items.some(x=>x.code==='KE_NITA'&&x.payrollTreatment==='employer_cost'));
 assert.ok(kenya.items.some(x=>x.code==='LEAVE_ANNUAL'&&x.amount===21));
 assert.ok(kenya.items.filter(x=>x.mandatory).every(x=>x.reference.length>5));
});
test('Kenya monthly KES 100000 respects statutory employee and employer flows',()=>{
 const slip=computePayslip(grade,kenya.items,{basicSalary:100000});
 const amount=code=>slip.lines.find(l=>l.code===code)?.amount;
 assert.equal(amount('KE_NSSF'),6000);
 assert.equal(amount('KE_SHIF'),2750);
 assert.equal(amount('KE_AHL'),1500);
 assert.equal(slip.taxablePay,89750);
 assert.ok(Math.abs(slip.tax-19308.33)<0.05);
 assert.ok(Math.abs(slip.net-70441.67)<0.05);
 assert.equal(amount('KE_NSSF_ER'),6000);
 assert.equal(amount('KE_AHL_ER'),1500);
 const noRelief=structuredClone(kenya.items);
 at({items:noRelief},'KE_PERSONAL_RELIEF').enabled=false;
 assert.ok(Math.abs(computePayslip(grade,noRelief,{basicSalary:100000}).tax-(slip.tax+2400))<0.05);
});
test('Kenya mandatory statutory rows cannot be disabled or restricted by grade',()=>{
 const chosen=new Set(['JG01','JG02']);
 const modified=structuredClone(kenya);
 const nssf=modified.items.find(x=>x.code==='KE_NSSF');
 nssf.enabled=false;
 assert.throws(()=>validatePayConfig(modified,chosen,'KE','KES'),/Mandatory Kenya components cannot be disabled/);
 nssf.enabled=true;nssf.gradeCodes=['JG01'];
 const valid=validatePayConfig(modified,chosen,'KE','KES');
 assert.deepEqual(valid.items.find(x=>x.code==='KE_NSSF').gradeCodes,[]);
});
test('Company incentives and allowances can target selected job grades',()=>{
 const chosen=new Set(['JG01','JG03']);
 const modified=structuredClone(kenya);
 const target=modified.items.find(x=>x.code==='INC_PRODUCTION');
 target.enabled=true;target.gradeCodes=['JG03'];target.method='percent';target.rate=0.05;
 const validated=validatePayConfig(modified,chosen,'KE','KES');
 assert.deepEqual(validated.items.find(x=>x.code==='INC_PRODUCTION').gradeCodes,['JG03']);
 target.gradeCodes=['NONEXISTENT'];
 assert.throws(()=>validatePayConfig(modified,chosen,'KE','KES'),/job grades/);
});
test('Unconfigured African country gets no invented Kenya statutory rates',()=>{
 const ug=blankCompensationTemplate('UG','UGX');
 assert.equal(ug.countryCode,'UG');
 assert.ok(ug.items.every(x=>!x.code.startsWith('KE_')));
 assert.ok(ug.items.every(x=>!x.enabled));
 assert.ok(ug.items.every(x=>!(x.exceptions||[]).length),'no Kenya exceptions are seeded for another country');
 const slip=computePayslip({...grade,taxCodes:[],deductionCodes:[]},ug.items,{basicSalary:100000});
 assert.equal(slip.tax,0,'no tax is invented for a country without configuration');
 assert.equal(slip.employeeStatutory,0);
});
