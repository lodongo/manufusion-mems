import {HttpError,getDoc,isObj,listDocs,nowIso,str,writeDoc} from './core';
import {hasPerm,orgRoute,type OrgContext} from './guards';
import {withLock} from './finCore';
import {getEducationConfig} from './hrEducationConfig';

export type PayCategory='payModels'|'overtime'|'allowances'|'benefits'|'incentives'|
 'leave'|'statutory'|'taxes'|'taxReliefs'|'otherDeductions'|'employerCosts'|'controls';
export const PAY_CATEGORIES:PayCategory[]=[
 'payModels','overtime','allowances','benefits','incentives','leave',
 'statutory','taxes','taxReliefs','otherDeductions','employerCosts','controls',
];
export type PayBase='none'|'basic'|'gross'|'taxable'|'pensionable'|'net'|'hourly'|'daily'|'units'|'eligibleAmount';
export type PayMethod='fixed'|'percent'|'progressive'|'multiplier'|'formula'|'days'|'manual';
export type LeaveGradeEntitlement={eligible:boolean;daysPerYear:number;accrueMonthly:boolean;unit:'working_days'|'calendar_days'|'months';carryForwardDays:number;requiresApprovedPlan:boolean};
export const defaultLeaveEntitlement=(mandatory:boolean,amount:number,code:string):LeaveGradeEntitlement=>({
 eligible:mandatory,daysPerYear:amount,accrueMonthly:code==='LEAVE_ANNUAL',
 unit:code==='LEAVE_MATERNITY'?'months':code==='LEAVE_ANNUAL'?'working_days':'calendar_days',
 carryForwardDays:0,requiresApprovedPlan:true,
});
export type PayItem={
 code:string;name:string;description:string;category:PayCategory;
 mandatory:boolean;enabled:boolean;gradeCodes:string[];
 leaveEntitlements?:Record<string,LeaveGradeEntitlement>;
 amount:number;rate:number;minimum:number;maximum:number;currency:string;
 method:PayMethod;base:PayBase;employerRate:number;employerAmount:number;
 effectiveFrom:string;effectiveTo:string;
 applicability:string;exemption:string;reference:string;dueRule:string;
 payrollTreatment:'earning'|'employee_deduction'|'employer_cost'|'noncash'|'informational';
 taxable:boolean;bands:Array<{upTo:number|null;rate:number}>;
 options:Record<string,string|number|boolean>;
};
export type PayConfig={countryCode:string;currency:string;version:number;status:'draft';lastReviewed:string;items:PayItem[]};
const sc=(x:unknown,n=180)=>str(x).trim().slice(0,n);
const collection=(org:string,entity:string)=>`organizations/${org}/hr_compensation_config/${entity}`;
const codeOk=(s:string)=>/^[A-Z0-9_]{2,72}$/.test(s);
const sources={
 kraPAYE:'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye',
 kraTax:'https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions%2C-reliefs-and-exemptions',
 kraAHL:'https://www.kra.go.ke/news-center/public-notices/2099-collection-of-the-affordable-housing-levy-by-kenya-revenue-authority',
 nssf:'https://taxsummaries.pwc.com/kenya/individual/other-taxes',
 sha:'https://health.go.ke/sites/default/files/2024-11/Social%20Health%20Insurance%20%28General%29%20Regulations%2C%202024_0.pdf',
 wages:'https://new.kenyalaw.org/akn/ke/act/ln/1982/120/eng@2022-12-31/source',
 employment:'https://www.labour.go.ke/sites/default/files/2022-10/The_Employment_Act_2007.pdf',
 nita:'https://www.nita.go.ke/our-services/levy-inspectorate.html',
};
function item(category:PayCategory,code:string,name:string,over:Partial<PayItem>={}):PayItem{
 return {code,name,description:'',category,mandatory:false,enabled:true,gradeCodes:[],
 amount:0,rate:0,minimum:0,maximum:0,currency:'KES',method:'manual',base:'none',
 employerRate:0,employerAmount:0,effectiveFrom:'2026-01-01',effectiveTo:'',
 applicability:'By eligible contract, approved policy or applicable legislation.',
 exemption:'',reference:'',dueRule:'',
 payrollTreatment:'informational',taxable:false,bands:[],options:{},...over};
}
const policy=(category:PayCategory,code:string,name:string,description:string,extra:Partial<PayItem>={})=>
 item(category,code,name,{description,enabled:false,...extra});
const legal=(category:PayCategory,code:string,name:string,description:string,extra:Partial<PayItem>={})=>
 item(category,code,name,{description,mandatory:true,enabled:true,gradeCodes:[],...extra});
export function kenyaCompensationTemplate():PayConfig{
 const items:PayItem[]=[
  ...[
   ['MONTHLY','Monthly salaried','Monthly fixed salary, proration by calendar or working days.'],
   ['DAILY','Daily wages','Daily contract rate; minimum wage and working days apply.'],
   ['HOURLY','Hourly wages','Approved hourly rate times verified timesheet hours.'],
   ['PIECE','Piecework / output','Approved units multiplied by agreed unit rate subject to minimum-wage rules.'],
   ['SHIFT','Shift / roster','Rostered work including rotating shifts and premium hours.'],
   ['COMMISSION','Commission-based','Basic or guaranteed pay plus verified commission.'],
   ['CONTRACT','Fixed-term / seasonal','Employment contract with a defined term and entitlements.'],
   ['CASUAL','Casual employment','Daily/short-term work; statutory rights and conversion tests require legal review.'],
  ].map(([code,name,description])=>policy('payModels',code,name,description,{enabled:code==='MONTHLY',method:'manual',base:'basic',payrollTreatment:'earning'})),
  legal('overtime','OT_WEEKDAY','Ordinary overtime','Reference 1.5× normal hourly rate for applicable wage orders.',{
    method:'multiplier',base:'hourly',rate:1.5,reference:sources.wages,payrollTreatment:'earning',taxable:true,
    applicability:'Subject to applicable sector wage order, CBA, contract and recorded hours.',
    options:{requiresApproval:true,contractExemptionReview:true}}),
  legal('overtime','OT_REST_HOLIDAY','Rest day / public holiday','Reference 2× normal hourly rate under the General Wages Order.',{
    method:'multiplier',base:'hourly',rate:2,reference:sources.wages,payrollTreatment:'earning',taxable:true,
    applicability:'Applicable wage order and verified roster, actual holidays and attendance.',
    options:{requiresApproval:true}}),
  policy('overtime','OT_NIGHT','Night / shift premium','Additional contractual night work premium.',{method:'multiplier',base:'hourly',rate:1.15,payrollTreatment:'earning',taxable:true}),
  ...[
   ['HOUSING','Housing / house allowance','Provide accommodation, consolidated wage or housing allowance as legally applicable.'],
   ['TRANSPORT','Commuter / transport','Regular taxable cash commuter or travel allowance.'],
   ['MEALS','Meal allowance','Cash allowance or in-kind meals; tax treatment depends on caps and conditions.'],
   ['HARDSHIP','Hardship / remote-area','Remote deployment or hardship allowance.'],
   ['ACTING','Acting / responsibility','Temporary responsibility allowance.'],
   ['SHIFT','Shift allowance','Roster or irregular shift allowance.'],
   ['DUTY','On-call / standby','Standby or duty retainer.'],
   ['PHONE','Communication','Phone, airtime and data; distinguish reimbursement from taxable benefit.'],
   ['TRAVEL','Per diem / subsistence','Business travel allowances subject to prevailing substantiation limits.'],
   ['UNIFORM','Uniform / protective clothing','Uniform or clothing allowance where policy permits.'],
   ['RELOCATION','Relocation / transfer','Transfer and settling-in allowances.'],
   ['EDUCATION','School / education','Employee dependent education allowance where approved.'],
  ].map(([code,name,desc])=>policy('allowances','AL_'+code,name,desc,{
    base:'basic',method:'percent',rate:0,payrollTreatment:'earning',taxable:true})),
  ...[
   ['MEDICAL','Medical insurance','Employer health cover, dependent coverage and tax review.'],
   ['LIFE','Group life / death in service','Life insurance coverage; sum assured and eligible beneficiaries.'],
   ['ACCIDENT','Personal accident / WIBA','Workers injury and accident cover, employer responsibilities.'],
   ['PENSION','Occupational pension','Supplementary registered retirement scheme; matching, ceilings and vesting.'],
   ['SAVINGS','Savings / provident','Employer and employee voluntary savings arrangement.'],
   ['HOUSING','Staff housing','In-kind housing and taxable valuation when applicable.'],
   ['CAR','Company car / fuel','Vehicle benefit valuation, business-use apportionment.'],
   ['MEALS','Subsidised meals','Meal benefit with tax-exempt threshold tests.'],
   ['WELLNESS','Wellness / EAP','Employee assistance and preventive care.'],
   ['TRAINING','Training / study support','Continuing professional development assistance.'],
   ['CHILDCARE','Childcare support','Care assistance and policy eligibility.'],
   ['LOAN','Staff loan subsidy','Preferential loan benefit and interest tax rules.'],
  ].map(([code,name,desc])=>policy('benefits','BEN_'+code,name,desc,{method:'manual',payrollTreatment:'noncash'})),
  ...[
   ['KPI','Individual KPI bonus','Performance weighted incentive; approved KPI period and thresholds.'],
   ['TEAM','Team performance','Team productivity, uptime, quality and safety gates.'],
   ['SALES','Sales commission','Commission after verified revenue, returns and clawback window.'],
   ['PRODUCTION','Production / output','Volume / OEE / scrap weighted incentive.'],
   ['ATTEND','Attendance / punctuality','Attendance reward subject to leave and nondiscrimination laws.'],
   ['RETENTION','Retention / sign-on','Contractual retention or signing payment with vesting.'],
   ['PROFIT','Profit sharing','Annual or quarterly profit pool with approval.'],
   ['REFERRAL','Employee referral','Successful eligible recruitment referral.'],
   ['INNOVATION','Ideas / innovation','Approved cost-saving or quality-improvement incentive.'],
   ['SERVICE','Service milestone','Long-service award and applicable tax treatment.'],
   ['GRATUITY','Gratuity / severance','Contractual and legally required terminal dues governed separately.'],
  ].map(([code,name,desc])=>policy('incentives','INC_'+code,name,desc,{
   base:'basic',method:'percent',payrollTreatment:'earning',taxable:true,
   options:{requiresApproval:true,safetyGate:true,qualityGate:true}})),
  legal('leave','LEAVE_ANNUAL','Annual leave','Not less than 21 working days for 12 consecutive months of service.',{
    method:'days',amount:21,base:'none',reference:sources.employment,
    options:{accrualPerMonth:1.75,paid:true,planningManagerApproval:true,applicationManagerApproval:true}}),
  legal('leave','LEAVE_SICK_FULL','Sick leave at full pay','At least seven days full pay after two months service, subject to evidence.',{
    method:'days',amount:7,reference:sources.employment,options:{paidFraction:1,qualificationMonths:2}}),
  legal('leave','LEAVE_SICK_HALF','Sick leave at half pay','Seven days half pay after the full-pay period.',{
    method:'days',amount:7,reference:sources.employment,options:{paidFraction:0.5,qualificationMonths:2}}),
  legal('leave','LEAVE_MATERNITY','Maternity leave','Three months maternity leave with full pay under the Employment Act.',{
    method:'manual',amount:3,reference:sources.employment,options:{durationMonths:3,paid:true}}),
  legal('leave','LEAVE_PATERNITY','Paternity leave','Two weeks paternity leave with full pay.',{
    method:'days',amount:14,reference:sources.employment,options:{calendarWeeks:2,paid:true}}),
  ...[
   ['COMPASSION','Compassionate / bereavement','Organization-approved days and eligibility.'],
   ['STUDY','Study / examination','Study time with manager approval.'],
   ['PARENTAL','Additional parental / adoption','Local law, company policy or CBA entitlements.'],
   ['UNPAID','Leave without pay','Unpaid time off and contribution impacts.'],
   ['TIME_OFF','Time off in lieu','Roster/OT conversion subject to applicable law.'],
   ['PUBLIC','Public holidays','Public holiday calendar by location and applicable employee terms.'],
  ].map(([code,name,desc])=>policy('leave','LEAVE_'+code,name,desc,{method:'days',options:{managerApproval:true}})),
  legal('statutory','KE_NSSF','NSSF employee and employer pension','From Feb 2026 employee 6% up to KES 108,000 pensionable earnings; employer matches. Max KES 6,480 each.',{
   base:'pensionable',method:'percent',rate:0.06,employerRate:0.06,maximum:6480,
   reference:sources.nssf,applicability:'Qualifying employment; permitted pension tier routing needs scheme-specific verification.',
   exemption:'Require documented legally recognized pension exemption/alternative scheme approval.',
   dueRule:'Generally by ninth day of following month',payrollTreatment:'employee_deduction',
   options:{upperEarningsLimit:108000,lowerEarningsLimit:9000,tiers:true}}),
  legal('statutory','KE_SHIF','Social Health Insurance Fund','Employee health contribution of 2.75% of gross salary; applicable minimum KES 300. No regular matching employer contribution.',{
   base:'gross',method:'percent',rate:0.0275,minimum:300,reference:sources.sha,
   payrollTreatment:'employee_deduction',dueRule:'By ninth day of following month',
   exemption:'Only statutory exemptions backed by valid documentation.'}),
  legal('statutory','KE_AHL','Affordable Housing Levy','Employee 1.5% of gross and matching employer 1.5%.',{
   base:'gross',method:'percent',rate:0.015,employerRate:0.015,reference:sources.kraAHL,
   payrollTreatment:'employee_deduction',dueRule:'Ninth working day after month end',
   exemption:'Income/person exemptions require applicable Gazette notice and evidence.'}),
  legal('taxes','KE_PAYE','PAYE income tax','Progressive resident employment income tax after statutory allowable deductions and reliefs.',{
   base:'taxable',method:'progressive',reference:sources.kraPAYE,
   payrollTreatment:'employee_deduction',dueRule:'By ninth day of following month',
   exemption:'Valid KRA exemption certificate, eligible claims, residency and primary employment status.',
   bands:[{upTo:24000,rate:0.10},{upTo:32333.33,rate:0.25},
    {upTo:500000,rate:0.30},{upTo:800000,rate:0.325},{upTo:null,rate:0.35}],
   options:{residentsEligiblePersonalRelief:true,nonresidentNoPersonalRelief:true}}),
  legal('taxReliefs','KE_PERSONAL_RELIEF','Resident personal relief','KES 2,400 monthly against PAYE for eligible primary resident employment.',{
   base:'taxable',method:'fixed',amount:2400,reference:sources.kraPAYE,
   applicability:'Resident taxpayer with primary employment and compliant eligibility.',
   exemption:'Non-residents and ineligible secondary employment not entitled to this relief.',
   options:{applyTo:'PAYE',primaryEmploymentOnly:true}}),
  legal('taxReliefs','KE_INSURANCE_RELIEF','Eligible insurance relief','15% eligible premium paid, capped at KES 5,000 per month and subject to proof.',{
   base:'eligibleAmount',method:'percent',rate:0.15,maximum:5000,
   reference:sources.kraTax,applicability:'Qualifying supported premiums; employee declaration and evidence required.',
   options:{requiresProof:true}}),
  legal('taxReliefs','KE_PENSION_DEDUCTION','Registered pension tax deduction','Qualifying employee pension contribution deduction capped at KES 30,000 monthly.',{
   base:'eligibleAmount',method:'fixed',maximum:30000,
   reference:sources.kraPAYE,applicability:'Registered eligible funds and employer withholding evidence.'}),
  legal('taxReliefs','KE_MORTGAGE_DEDUCTION','Qualifying mortgage interest','Deduct eligible owner-occupied residential mortgage interest up to KES 30,000 monthly.',{
   base:'eligibleAmount',method:'fixed',maximum:30000,reference:sources.kraTax,
   applicability:'Qualifying institutions, mortgage documentation and statutory conditions.',
   options:{requiresProof:true}}),
  legal('taxReliefs','KE_POST_RETIREMENT_MEDICAL','Post-retirement medical fund','Eligible registered post-retirement medical contributions up to KES 15,000 monthly.',{
   base:'eligibleAmount',method:'fixed',maximum:15000,reference:sources.kraTax,
   options:{requiresProof:true}}),
  policy('taxReliefs','KE_TAX_EXEMPTION','Certified tax exemption','Only validated disability or other legally qualifying exemption certificates; controlled start and expiry.',{
   base:'taxable',method:'manual',reference:sources.kraTax,options:{requiresCertificate:true,expiryReview:true}}),
  legal('employerCosts','KE_NITA','NITA industrial training levy','KES 50 monthly per employee payable by applicable employers, not from employee pay.',{
   method:'fixed',amount:50,base:'none',payrollTreatment:'employer_cost',reference:sources.nita,
   dueRule:'Last working day of month',
   applicability:'Applicable employer registration and levy categories.'}),
  policy('employerCosts','KE_WIBA','Occupational injury cover','Employer cost of work injury benefit or insurance; premium depends on policy and risk.',{
   method:'manual',payrollTreatment:'employer_cost',
   reference:'https://www.labour.go.ke/',options:{requiresInsurerOrLegalReview:true}}),
  ...[
   ['PENSION','Employee voluntary pension','Voluntary pension beyond statutory minimum with employee authority.'],
   ['SACCO','SACCO contribution','Employee-elected cooperative saving with written mandate.'],
   ['LOAN','Loan repayment','Documented loan balance, interest, recovery limit and consent.'],
   ['SALARY_ADVANCE','Salary advance','Approved recoverable wage advance.'],
   ['UNION','Trade union dues','Applicable membership/check-off and legal authority.'],
   ['COURT','Court / garnishment order','Verified judicial order and statutory limits.'],
   ['WELFARE','Welfare / benevolent fund','Authorized staff fund contribution.'],
   ['OTHER','Other authorized deduction','Document legal authority and employee consent, with take-home cap.'],
  ].map(([code,name,desc])=>policy('otherDeductions','DED_'+code,name,desc,{
   base:'net',method:'fixed',payrollTreatment:'employee_deduction',
   options:{requiresAuthorization:true,protectNetPay:true}})),
  policy('controls','MINIMUM_WAGE','Minimum wage compliance','Compare occupation, locality, wage order, housing and contract before pay approval.',{
   reference:'https://labour.go.ke/sites/default/files/2025-01/Regulation%20of%20Wages%20%28General%29%20%28Amendment%29%20Order%202024%20full.pdf',
   options:{occupationRequired:true,localityRequired:true,wageOrderRequired:true}}),
  policy('controls','NET_PAY_GUARD','Protected net pay / deduction limits','Run employee consent and legal deduction-limit validation before posting.',{
   options:{makerChecker:true,noNegativeNetPay:true}}),
  policy('controls','PAYROLL_CALENDAR','Payroll cutoffs and pay dates','Configure timesheet cutoff, approval, payday, banking and holidays.',{
   options:{approvalRequired:true,bankFileReview:true}}),
  policy('controls','GL_MAPPING','Finance and cost-center posting','Configure payroll expense, payable, liability, accrual and employer-cost GL assignments.',{
   options:{financeApproval:true,legalEntityCostCenters:true}}),
  policy('controls','FX_AND_CURRENCY','Multi-currency pay and FX','Specify contract, functional and settlement currency and rate source.',{
   options:{lockedPeriodFx:true,requireApproval:true}}),
  policy('controls','EXIT_SETTLEMENT','Final pay / termination','Unused leave, notice, gratuity, severance, recoveries and certificate of service review.',{
   options:{financeApproval:true,hrApproval:true}}),
 ];
 return {countryCode:'KE',currency:'KES',version:0,status:'draft',lastReviewed:'2026-10-23',items};
}
export const blankCompensationTemplate=(countryCode:string,currency:string):PayConfig=>{
 const reference=kenyaCompensationTemplate();
 // Non-Kenyan country templates deliberately have no Kenyan statutory rates.
 const items=reference.items.filter(x=>!x.code.startsWith('KE_')).map(x=>({
  ...x,mandatory:false,enabled:false,currency,reference:'',dueRule:'',
  amount:0,rate:0,employerRate:0,employerAmount:0,minimum:0,maximum:0,
  bands:[],options:{...x.options},
 }));
 return {countryCode,currency,version:0,status:'draft',lastReviewed:'',items};
};
export function defaultPayConfig(countryCode:string,currency:string){
 return countryCode==='KE'?kenyaCompensationTemplate():blankCompensationTemplate(countryCode,currency);
}
const docPath=(org:string,entity:string)=>collection(org,entity);
export async function readPayConfig(org:string,entity:string,countryCode:string,currency:string){
 const d=await getDoc(docPath(org,entity));
 return d?d.data as unknown as PayConfig:defaultPayConfig(countryCode,currency);
}
const entities=async(org:string)=>(await listDocs(`organizations/${org}/structure`))
 .filter(d=>str(d.data.level)==='legal_entity'&&str(d.data.status)!=='inactive')
 .map(d=>({id:d.id,name:str(d.data.name),
  countryCode:sc((isObj(d.data.attributes)?d.data.attributes.countryCode:'')||d.data.countryCode||d.data.country,2).toUpperCase(),
  currency:sc((isObj(d.data.attributes)?d.data.attributes.currencyCode:'')||d.data.currencyCode||d.data.currency,3).toUpperCase()}))
 .sort((a,b)=>a.name.localeCompare(b.name));
function normalizeItem(x:unknown,grades:Set<string>,countryCode:string,currency:string):PayItem{
 if(!isObj(x))throw new HttpError(400,'Invalid compensation component.');
 const code=sc(x.code,72),name=sc(x.name,160);
 const category=sc(x.category) as PayCategory,method=sc(x.method) as PayMethod;
 const base=sc(x.base) as PayBase, treatment=sc(x.payrollTreatment) as PayItem['payrollTreatment'];
 if(!codeOk(code)||!name||!PAY_CATEGORIES.includes(category)||
  !['fixed','percent','progressive','multiplier','formula','days','manual'].includes(method)||
  !['none','basic','gross','taxable','pensionable','net','hourly','daily','units','eligibleAmount'].includes(base)||
  !['earning','employee_deduction','employer_cost','noncash','informational'].includes(treatment))
  throw new HttpError(400,'A component needs a valid code, name, category, method, base and payroll treatment.');
 const stat=countryCode==='KE'&&kenyaCompensationTemplate().items
  .some(row=>row.mandatory&&row.code===code&&row.category===category);
 const n=(v:unknown,key:string)=>{
  const a=Number(v??0);
  if(!Number.isFinite(a)||a<0||a>1e12)throw new HttpError(400,'Invalid '+key);
  return a;
 };
 const values=Array.isArray(x.gradeCodes)?x.gradeCodes.map(v=>sc(v,72)):[];
 if(values.some(v=>!grades.has(v))||new Set(values).size!==values.length)
  throw new HttpError(400,'Select only job grades in the target legal entity.');
 // Statutory obligations must not be disabled by job-grade applicability or
 // by a tenant user. Valid exemptions belong on individual employee records.
 const gradeCodes=stat?[]:values;
 if(stat&&x.enabled===false)throw new HttpError(400,'Mandatory Kenya components cannot be disabled; use documented legal exemptions where applicable.');
 const options=isObj(x.options)?Object.fromEntries(Object.entries(x.options)
  .slice(0,30).filter(([k,v])=>k.length<=75&&['string','number','boolean'].includes(typeof v))
  .map(([k,v])=>[k,v as string|number|boolean])):{};
 const bands=Array.isArray(x.bands)?x.bands.map(v=>{
  if(!isObj(v))throw new HttpError(400,'Invalid tax band.');
  return {upTo:v.upTo===null?null:n(v.upTo,'band ceiling'),rate:n(v.rate,'band rate')};
 }):[];
 if(bands.length>12||bands.some(b=>b.rate>1))throw new HttpError(400,'Tax rates must be decimal fractions from 0 to 1.');
 let leaveEntitlements:Record<string,LeaveGradeEntitlement>|undefined;
 if(category==='leave'){
   const raw=isObj(x.leaveEntitlements)?x.leaveEntitlements:{};
   if(Object.keys(raw).some(g=>!grades.has(g)))throw new HttpError(400,'Leave entitlement references an unknown job grade.');
   leaveEntitlements={};
   for(const grade of grades){
     const record=isObj(raw[grade])?raw[grade]:{};
     const defaults=defaultLeaveEntitlement(stat||x.mandatory===true,n(x.amount,'annual entitlement'),code);
     const eligible=record.eligible===undefined?defaults.eligible:record.eligible===true;
     const daysPerYear=record.daysPerYear===undefined?defaults.daysPerYear:n(record.daysPerYear,'annual leave entitlement');
     const accrueMonthly=record.accrueMonthly===undefined?defaults.accrueMonthly:record.accrueMonthly===true;
     const unit=record.unit==='months'||record.unit==='calendar_days'||record.unit==='working_days'?record.unit:defaults.unit;
     const carryForwardDays=record.carryForwardDays===undefined?0:n(record.carryForwardDays,'carry forward days');
     if(daysPerYear>366||carryForwardDays>366)throw new HttpError(400,'Leave entitlement is outside the supported annual range.');
     if(stat&&countryCode==='KE'&&category==='leave'&&!eligible)
       throw new HttpError(400,'Mandatory Kenya leave cannot be made ineligible by job grade.');
     if(code==='LEAVE_ANNUAL'&&countryCode==='KE'&&daysPerYear<21)
       throw new HttpError(400,'Annual leave must not be below the Kenya statutory 21 working days.');
     leaveEntitlements[grade]={eligible,daysPerYear,accrueMonthly,unit,carryForwardDays,requiresApprovedPlan:true};
   }
 }
 const item:PayItem={code,name,category,description:sc(x.description,600),
  mandatory:stat||x.mandatory===true,enabled:stat||x.enabled!==false,gradeCodes,leaveEntitlements,
  amount:n(x.amount,'amount'),rate:n(x.rate,'rate'),minimum:n(x.minimum,'minimum'),
  maximum:n(x.maximum,'maximum'),employerRate:n(x.employerRate,'employer rate'),
  employerAmount:n(x.employerAmount,'employer amount'),currency,
  method,base,payrollTreatment:treatment,taxable:x.taxable===true,
  effectiveFrom:sc(x.effectiveFrom,10),effectiveTo:sc(x.effectiveTo,10),
  applicability:sc(x.applicability,400),exemption:sc(x.exemption,400),
  reference:sc(x.reference,600),dueRule:sc(x.dueRule,200),bands,options};
 if(item.rate>2||item.employerRate>2)throw new HttpError(400,'Unreasonable rate; percentages must be decimal fractions.');
 return item;
}
export function validatePayConfig(raw:unknown,grades:Set<string>,countryCode:string,currency:string):PayConfig{
 if(!isObj(raw)||!Array.isArray(raw.items)||raw.items.length>250)
  throw new HttpError(400,'Select no more than 250 compensation components.');
 if(sc(raw.countryCode,2).toUpperCase()!==countryCode||sc(raw.currency,3).toUpperCase()!==currency)
  throw new HttpError(400,'Country and currency must match the target legal entity configuration.');
 const items=raw.items.map(x=>normalizeItem(x,grades,countryCode,currency));
 if(new Set(items.map(x=>x.code)).size!==items.length)throw new HttpError(400,'Duplicate compensation codes.');
 if(countryCode==='KE'){
  const mandatory=kenyaCompensationTemplate().items.filter(x=>x.mandatory);
  if(mandatory.some(x=>!items.some(a=>a.code===x.code&&a.category===x.category&&a.mandatory)))
   throw new HttpError(400,'Kenya mandatory reference rows must remain present and mandatory.');
 }
 return {countryCode,currency,items,version:0,status:'draft',lastReviewed:sc(raw.lastReviewed,10)};
}
function countryOf(entity:{countryCode:string;currency:string},orgCountry:string){
 return entity.countryCode||orgCountry||'';
}
export const hrCompensationRoutes={
 'POST /api/org/hr/compensation/get':[orgRoute('org.hr.compensation.get','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const all=await entities(ctx.orgId);
  const id=sc(ctx.body.legalEntityId,128);
  const current=all.find(e=>e.id===id)||(!id?all[0]:undefined);
  const orgCountry=sc(ctx.org.data.countryCode||ctx.org.data.country,2).toUpperCase();
  const country=current?countryOf(current,orgCountry):'';
  const currency=current?.currency||sc(ctx.org.data.currencyCode||ctx.org.data.currency,3)||(country==='KE'?'KES':'');
  return {entities:all,current:current||null,countryCode:country,currency,
   config:current?await readPayConfig(ctx.orgId,current.id,country,currency):null,
   saved:!!(current&&await getDoc(docPath(ctx.orgId,current.id))),
  };
 })],
 'POST /api/org/hr/compensation/save':[orgRoute('org.hr.compensation.save','ADM.settings',async ctx=>{
  if(ctx.role!=='org_super_admin'&&!hasPerm(ctx.directPermissions,'ADM.settings'))
   throw new HttpError(403,'Organization settings administrator required.');
  const id=sc(ctx.body.legalEntityId,128),all=await entities(ctx.orgId);
  const current=all.find(e=>e.id===id);
  if(!current)throw new HttpError(404,'Select an active legal entity.');
  const country=countryOf(current,sc(ctx.org.data.countryCode||ctx.org.data.country,2).toUpperCase());
  const currency=current.currency||sc(ctx.org.data.currencyCode||ctx.org.data.currency,3)||(country==='KE'?'KES':'');
  if(!country||!currency)throw new HttpError(409,'Configure legal-entity country and currency before compensation.');
  const gradeConfig=await getEducationConfig(ctx.orgId,id);
  const valid=validatePayConfig(ctx.body.config,new Set(gradeConfig.jobGrades.filter(g=>g.enabled).map(g=>g.code)),country,currency);
  return withLock(ctx.orgId,'hr_compensation_'+id,async()=>{
   const prev=await getDoc(docPath(ctx.orgId,id));
   const version=Number(prev?.data.version||0)+1;
   await writeDoc(docPath(ctx.orgId,id),{...valid,version,status:'draft',
    updatedAt:nowIso(),updatedBy:ctx.uid});
   return {ok:true,version,status:'draft',config:{...valid,version}};
  });
 })],
};
