import {computePayslip,type PayslipGrade,type PayslipItem} from '../shared/hrPayslip';

/** What the Payroll screen decides, with no screen code so it can be tested on its own. */
export type PayGrade={code:string;rank:number;title:string;enabled:boolean;minSalary:number;taxCodes:string[];deductionCodes:string[];payModelCode:string;benefitCodes:string[];benefitValues:Record<string,{amount?:number;rate?:number}>};
export type Emp={uid:string;name:string;employeeNumber:string;status:string;roleCode:string;roleTitle:string;gradeCode:string;gradeTitle:string;minSalary:number;basic:number|null;problem:string;problemText:string};
export type Edits=Record<string,number>;
export type FilterMode='all'|'below'|'none'|'attention';

export const BASIC_MAX=1e9;
export const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()).join('')||'?';
/** Why a typed salary cannot be saved ('' when it can, or when the box is empty). Below the grade minimum is allowed: it is flagged, not refused. */
export const salaryIssue=(v:number)=>Number.isNaN(v)?'':!Number.isFinite(v)||v<=0?'Enter an amount above 0, or clear the box.':v>BASIC_MAX?'That amount is too large.':Math.abs(v*100-Math.round(v*100))>1e-6?'Use at most 2 decimals.':'';
/** Red when the salary is under the grade minimum. A grade with no minimum has nothing to compare with. */
export const belowMin=(basic:number,minimum:number)=>Number.isFinite(basic)&&minimum>0&&basic<minimum;
/** The salary shown for an employee: what is being typed, else what was saved (NaN when none). */
export const effective=(e:Pick<Emp,'uid'|'basic'>,edits:Edits)=>e.uid in edits?edits[e.uid]:(e.basic??NaN);

/** The changes to send: a number for a new salary, null for a cleared one. Invalid boxes are listed so saving can be refused. */
export function changesOf(emps:Array<Pick<Emp,'uid'|'basic'>>,edits:Edits){
 const base=new Map(emps.map(e=>[e.uid,e.basic??NaN]));
 const changes:Record<string,number|null>={};
 const invalid:string[]=[];
 for(const [uid,v] of Object.entries(edits)){
  if(!base.has(uid)||Object.is(v,base.get(uid)))continue;
  if(Number.isNaN(v)){changes[uid]=null;continue;}
  if(salaryIssue(v)){invalid.push(uid);continue;}
  changes[uid]=v;
 }
 return {changes,invalid};
}

export function matches(e:Emp,edits:Edits,mode:FilterMode){
 const v=effective(e,edits);
 return mode==='all'?true:mode==='below'?belowMin(v,e.minSalary):mode==='none'?!Number.isFinite(v):e.problem!=='';
}
export const countsOf=(emps:Emp[],edits:Edits)=>({
 all:emps.length,
 below:emps.filter(e=>matches(e,edits,'below')).length,
 none:emps.filter(e=>matches(e,edits,'none')).length,
 attention:emps.filter(e=>matches(e,edits,'attention')).length,
});

const toGrade=(g:PayGrade):PayslipGrade=>({code:g.code,title:g.title,minSalary:Number(g.minSalary)||0,payModelCode:g.payModelCode||undefined,
 taxCodes:g.taxCodes,deductionCodes:g.deductionCodes,benefitCodes:g.benefitCodes,benefitValues:g.benefitValues});
/** The payslip headline figures for one employee, or null when there is no grade or no salary to compute from. */
export function payslipOf(grade:PayGrade|undefined,items:PayslipItem[],basic:number){
 if(!grade||!Number.isFinite(basic)||basic<=0)return null;
 try{
  const p=computePayslip(toGrade(grade),items,{basicSalary:basic,overtimeWeekdayHours:0,overtimeRestHours:0,circumstances:[],declared:{},otherDeductions:{}});
  return {gross:p.grossCash,tax:p.tax,net:p.net,cost:p.totalCostToEmployer};
 }catch{return null}
}

export const EXPORT_HEADER=['Employee number','Name','Status','Job role','Grade code','Grade','Grade minimum','Basic salary (draft)','Below grade minimum','Gross pay','Tax after reliefs','Net pay','Total cost to employer','Currency','Needs attention'];
/** Excel copy of the list as it is on screen. Text and numbers only. */
export function exportTable(emps:Emp[],edits:Edits,grades:PayGrade[],items:PayslipItem[],currency:string):Array<Array<string|number|null>>{
 const byCode=new Map(grades.map(g=>[g.code,g]));
 return emps.map(e=>{
  const v=effective(e,edits);
  const slip=payslipOf(byCode.get(e.gradeCode),items,v);
  return [e.employeeNumber,e.name,e.status,e.roleTitle,e.gradeCode,e.gradeTitle,e.minSalary>0?e.minSalary:null,Number.isFinite(v)?v:null,
   belowMin(v,e.minSalary)?'Yes':'No',slip?slip.gross:null,slip?slip.tax:null,slip?slip.net:null,slip?slip.cost:null,currency,e.problemText];
 });
}
