import test from 'node:test';
import assert from 'node:assert/strict';
import {kenyaCompensationTemplate,blankCompensationTemplate,validatePayConfig,PAY_CATEGORIES}
 from '../../backend/hrCompensationConfig.ts';
import {estimateKenyaMonthly} from '../../src/org/hrPayPreview.ts';

const kenya=kenyaCompensationTemplate();
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
test('Kenya illustrative monthly KES 100000 respects statutory employee and employer flows',()=>{
 const result=estimateKenyaMonthly(100000,kenya);
 assert.equal(result.nssf,6000);
 assert.equal(result.shif,2750);
 assert.equal(result.ahl,1500);
 assert.equal(result.taxable,89750);
 assert.ok(Math.abs(result.paye-19308.33)<0.02);
 assert.ok(Math.abs(result.net-70441.67)<0.02);
 assert.equal(result.employerTotal,107550);
 const withoutRelief=estimateKenyaMonthly(100000,kenya,false);
 assert.equal(withoutRelief.paye,result.paye+2400);
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
 assert.equal(estimateKenyaMonthly.bind(null,100000,ug)!==undefined,true);
 assert.throws(()=>estimateKenyaMonthly(100000,ug),/KE legal entity/);
});
