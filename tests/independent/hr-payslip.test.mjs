import test from 'node:test';
import assert from 'node:assert/strict';
import {computePayslip,availableCircumstances,progressiveTax,benefitValue} from '../../src/shared/hrPayslip.ts';
import {kenyaCompensationTemplate,KENYA_EXCEPTION_DEFAULTS,seedKenyaDefaults} from '../../backend/hrCompensationConfig.ts';

const catalogue=()=>structuredClone(kenyaCompensationTemplate().items);
const grade=(extra={})=>({code:'JG03',title:'Skilled / operator',minSalary:20000,payModelCode:'MONTHLY',
 taxCodes:['KE_PAYE','KE_PERSONAL_RELIEF','KE_INSURANCE_RELIEF','KE_PENSION_DEDUCTION','KE_MORTGAGE_DEDUCTION','KE_POST_RETIREMENT_MEDICAL'],
 deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL'],benefitCodes:[],benefitValues:{},...extra});
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<=0.05,`${message||''} expected ${b} got ${a}`);
const line=(slip,code)=>slip.lines.find(l=>l.code===code);

test('Kenya reference payslip: contributions are taken before PAYE, then personal relief',()=>{
 const slip=computePayslip(grade(),catalogue(),{basicSalary:50000});
 // Worked example published by payroll providers for KES 50,000 (they round the 25% band to 32,333, so allow a few cents).
 near(line(slip,'KE_NSSF').amount,3000,'NSSF');
 near(line(slip,'KE_SHIF').amount,1375,'SHIF');
 near(line(slip,'KE_AHL').amount,750,'Housing Levy');
 near(slip.taxablePay,44875,'taxable pay');
 near(slip.tax,5845.85,'PAYE after personal relief');
 near(slip.net,39029.15,'net pay');
 near(slip.reliefTotal,2400,'personal relief');
 assert.equal(slip.warnings.length,0);
});

test('NSSF Tier I and Tier II follow the 2026 limits and the KES 6,480 ceiling',()=>{
 const low=computePayslip(grade(),catalogue(),{basicSalary:20000});
 near(line(low,'KE_NSSF').amount,1200,'6% of 20,000 across both tiers');
 near(low.tax,0,'taxable pay is under the relief threshold');
 const high=computePayslip(grade(),catalogue(),{basicSalary:200000});
 near(line(high,'KE_NSSF').amount,6480,'capped at 6% of 108,000');
 near(line(high,'KE_SHIF').amount,5500,'SHIF has no ceiling');
 near(line(high,'KE_AHL').amount,3000,'Housing Levy has no ceiling');
 near(high.taxablePay,185020,'taxable pay');
 near(high.tax,47889.33,'PAYE');
 near(line(high,'KE_NSSF_ER').amount,6480,'employer matches the employee');
});

test('SHIF never falls below its minimum contribution',()=>{
 const slip=computePayslip(grade(),catalogue(),{basicSalary:5000});
 near(line(slip,'KE_SHIF').amount,300,'minimum of KES 300');
});

test('statutory exceptions change one line for people in that circumstance',()=>{
 const base=computePayslip(grade(),catalogue(),{basicSalary:200000});
 // Disability exemption: the first KES 150,000 of taxable pay is not taxed.
 const pwd=computePayslip(grade(),catalogue(),{basicSalary:200000,circumstances:['PAYE_PWD']});
 near(pwd.tax,2889.33,'PAYE with the disability exemption');
 assert.ok(base.tax>pwd.tax);
 assert.ok(pwd.appliedExceptions.some(e=>e.exception.includes('disability')&&e.effect==='exempt_first'));
 assert.ok(pwd.notes.some(n=>/150,000 is exempt/.test(n)));
 // The exemption only removes tax on that slice: a small salary becomes tax-free, nothing goes negative.
 near(computePayslip(grade(),catalogue(),{basicSalary:90000,circumstances:['PAYE_PWD']}).tax,0);
 // Non-resident: no personal relief.
 const resident=computePayslip(grade(),catalogue(),{basicSalary:50000});
 const nonResident=computePayslip(grade(),catalogue(),{basicSalary:50000,circumstances:['RELIEF_NON_RESIDENT']});
 near(nonResident.tax-resident.tax,2400,'the relief is simply not given');
 assert.equal(line(nonResident,'KE_PERSONAL_RELIEF').amount,0);
 // Tier II contracted out: the deduction is unchanged, the destination of Tier II changes.
 const out=computePayslip(grade(),catalogue(),{basicSalary:50000,circumstances:['NSSF_TIER2_CONTRACTED_OUT']});
 near(out.net,resident.net,'net pay is unchanged');
 near(line(out,'KE_NSSF_T1').amount,540,'Tier I stays with the fund');
 near(line(out,'KE_NSSF_T2').amount,2460,'Tier II goes to the approved scheme');
 assert.equal(line(out,'KE_NSSF'),undefined);
});

test('an exception that is switched off, or a circumstance nobody holds, changes nothing',()=>{
 const items=catalogue();
 const plain=computePayslip(grade(),items,{basicSalary:50000});
 // The Housing Levy exemptions ship switched off: selecting them has no effect.
 const off=computePayslip(grade(),items,{basicSalary:50000,circumstances:['AHL_GAZETTE_EXEMPTION','SHIF_DOCUMENTED_EXEMPTION']});
 assert.deepEqual(off.lines,plain.lines);
 // Once legal review switches one on, it applies.
 const on=catalogue();
 on.find(i=>i.code==='KE_AHL').exceptions.find(e=>e.code==='AHL_GAZETTE_EXEMPTION').enabled=true;
 const exempt=computePayslip(grade(),on,{basicSalary:50000,circumstances:['AHL_GAZETTE_EXEMPTION']});
 assert.equal(line(exempt,'KE_AHL').amount,0);
 assert.match(line(exempt,'KE_AHL').note,/Exempt/);
 assert.ok(exempt.net>plain.net);
});

test('a replacement rate or cap applies to a statutory contribution',()=>{
 const items=catalogue();
 items.find(i=>i.code==='KE_SHIF').exceptions=[{code:'SHIF_HALF',name:'Half rate',description:'',effect:'rate',value:0.01375,evidence:'Letter',reference:'',enabled:true}];
 items.find(i=>i.code==='KE_AHL').exceptions=[{code:'AHL_CAP',name:'Capped',description:'',effect:'cap',value:500,evidence:'Letter',reference:'',enabled:true}];
 const slip=computePayslip(grade(),items,{basicSalary:50000,circumstances:['SHIF_HALF','AHL_CAP']});
 near(line(slip,'KE_SHIF').amount,687.5);
 near(line(slip,'KE_AHL').amount,500);
});

test('allowances, benefits and overtime follow the grade selection and its own values',()=>{
 const items=catalogue();
 const housing=items.find(i=>i.code==='AL_HOUSING');Object.assign(housing,{enabled:true,method:'percent',rate:0.15,taxable:true});
 const transport=items.find(i=>i.code==='AL_TRANSPORT');Object.assign(transport,{enabled:true,method:'fixed',amount:3000,taxable:false});
 const medical=items.find(i=>i.code==='BEN_MEDICAL');Object.assign(medical,{enabled:true,amount:4000,taxable:false});
 const g=grade({benefitCodes:['AL_HOUSING','AL_TRANSPORT','BEN_MEDICAL','OT_WEEKDAY','AL_CAR_NOT_IN_CATALOGUE'],benefitValues:{AL_HOUSING:{rate:0.2}}});
 const slip=computePayslip(g,items,{basicSalary:22500,overtimeWeekdayHours:10});
 near(line(slip,'AL_HOUSING').amount,4500,'the grade rate (20%) overrides the catalogue rate (15%)');
 near(line(slip,'AL_TRANSPORT').amount,3000);
 near(line(slip,'OT_WEEKDAY').amount,10*(22500/225)*1.5,'10 hours at 1.5 times the hourly rate');
 near(slip.grossCash,22500+4500+3000+1500);
 assert.equal(line(slip,'BEN_MEDICAL').section,'noncash');
 assert.ok(slip.grossCash<slip.totalCostToEmployer,'non-cash benefit adds to the cost to the employer, not to pay');
 // Tax-free allowance is excluded from taxable pay; the taxable one is included.
 near(slip.taxableGross,22500+4500+1500,'transport is not taxed');
 assert.ok(slip.warnings.some(w=>/AL_CAR_NOT_IN_CATALOGUE/.test(w)),'a missing catalogue item is reported, not silently ignored');
 // A switched-off item is skipped.
 const off=catalogue();
 assert.equal(line(computePayslip(grade({benefitCodes:['AL_HOUSING']}),off,{basicSalary:22500}),'AL_HOUSING'),undefined);
 assert.equal(benefitValue(housing,g,10000),2000);
 assert.equal(benefitValue(transport,grade({benefitValues:{AL_TRANSPORT:{amount:1234.5}}}),10000),1234.5);
});

test('reliefs the person declares with proof reduce taxable pay or tax within their limits',()=>{
 const slip=computePayslip(grade(),catalogue(),{basicSalary:100000,declared:{KE_MORTGAGE_DEDUCTION:50000,KE_INSURANCE_RELIEF:60000,KE_PENSION_DEDUCTION:40000}});
 near(line(slip,'KE_MORTGAGE_DEDUCTION').amount,30000,'mortgage interest limited to KES 30,000 a month');
 near(line(slip,'KE_INSURANCE_RELIEF').amount,5000,'insurance relief 15% limited to KES 5,000 a month');
 near(line(slip,'KE_PENSION_DEDUCTION').amount,40000,'voluntary pension is deducted from pay');
 assert.ok(slip.warnings.some(w=>/limited to 30,000/.test(w)));
 // Pension deduction together with NSSF is limited to 30,000, so NSSF (6,000) leaves 24,000 for the voluntary part.
 near(slip.taxablePay,100000-6000-2750-1500-24000-30000,'taxable pay');
 near(slip.net,100000-6000-2750-1500-slip.tax-40000,'net pay');
});

test('optional deductions come off net pay and a thin take-home is flagged',()=>{
 const g=grade({deductionCodes:['KE_NSSF','KE_SHIF','KE_AHL','DED_SACCO','DED_LOAN']});
 const items=catalogue();
 for(const code of ['DED_SACCO','DED_LOAN'])items.find(i=>i.code===code).enabled=true;
 const slip=computePayslip(g,items,{basicSalary:30000,otherDeductions:{DED_SACCO:2000,DED_LOAN:15000}});
 near(slip.otherDeductionsTotal,17000);
 assert.ok(slip.warnings.some(w=>/one third/.test(w)));
 const fine=computePayslip(g,items,{basicSalary:30000,otherDeductions:{DED_SACCO:2000}});
 assert.equal(fine.warnings.length,0);
});

test('employer cost includes the matching contributions and the levy',()=>{
 const slip=computePayslip(grade(),catalogue(),{basicSalary:50000});
 near(slip.employerCost,3000+750+50,'NSSF + Housing Levy + NITA');
 near(slip.totalCostToEmployer,50000+3000+750+50);
});

test('the simulator lists only circumstances for items the grade uses and that are switched on',()=>{
 const items=catalogue();
 const list=availableCircumstances(grade(),items).map(c=>c.code);
 assert.ok(list.includes('PAYE_PWD')&&list.includes('RELIEF_NON_RESIDENT')&&list.includes('NSSF_TIER2_CONTRACTED_OUT'));
 assert.ok(!list.includes('AHL_GAZETTE_EXEMPTION'),'switched-off exceptions are not offered');
 const noRelief=availableCircumstances(grade({taxCodes:['KE_PAYE']}),items).map(c=>c.code);
 assert.ok(!noRelief.includes('RELIEF_NON_RESIDENT'),'only exceptions of items on the grade');
});

test('progressive tax uses the band ceilings in order',()=>{
 const bands=catalogue().find(i=>i.code==='KE_PAYE').bands;
 near(progressiveTax(24000,bands),2400);
 near(progressiveTax(32333.33,bands),4483.33);
 near(progressiveTax(0,bands),0);
 near(progressiveTax(1000000,bands),2400+2083.33+(500000-32333.33)*0.3+300000*0.325+200000*0.35);
});

test('Kenya defaults are applied once, only to Kenya, and never over an edited list',()=>{
 const stripped=catalogue().map(({exceptions,...rest})=>rest);
 const config={countryCode:'KE',currency:'KES',version:3,status:'draft',lastReviewed:'',items:stripped};
 const seeded=seedKenyaDefaults(config);
 assert.equal(seeded.exceptionsSeeded,true);
 for(const code of Object.keys(KENYA_EXCEPTION_DEFAULTS))assert.ok(seeded.items.find(i=>i.code===code).exceptions.length>0,code);
 assert.equal(seeded.items.find(i=>i.code==='KE_NSSF').options.preTax,true);
 // Idempotent, and a list the user already edited (even emptied) is left alone.
 assert.equal(seedKenyaDefaults(seeded),seeded);
 const edited={...config,items:config.items.map(i=>i.code==='KE_AHL'?{...i,exceptions:[]}:i)};
 assert.deepEqual(seedKenyaDefaults(edited).items.find(i=>i.code==='KE_AHL').exceptions,[]);
 assert.equal(seedKenyaDefaults({...config,countryCode:'UG'}).exceptionsSeeded,undefined);
 // Everything not verified in force ships switched off.
 const off=Object.entries(KENYA_EXCEPTION_DEFAULTS).flatMap(([item,list])=>list.filter(e=>!e.enabled).map(e=>item+':'+e.code)).sort();
 assert.deepEqual(off,['KE_AHL:AHL_GAZETTE_EXEMPTION','KE_AHL:AHL_HOST_COUNTRY_AGREEMENT','KE_NSSF:NSSF_DOCUMENTED_EXEMPTION','KE_SHIF:SHIF_DOCUMENTED_EXEMPTION']);
 // Every enabled default names its evidence and a web reference.
 for(const list of Object.values(KENYA_EXCEPTION_DEFAULTS))for(const e of list.filter(x=>x.enabled)){assert.ok(e.evidence.length>=10,e.code);assert.match(e.reference,/^https:\/\//,e.code);}
});
