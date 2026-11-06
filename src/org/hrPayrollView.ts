import type {PayslipGrade} from '../shared/hrPayslip';

/** What the Payroll screen decides, with no screen code so it can be tested on its own. */
export type PayGrade={code:string;rank:number;title:string;enabled:boolean;minSalary:number;taxCodes:string[];deductionCodes:string[];payModelCode:string;benefitCodes:string[];benefitValues:Record<string,{amount?:number;rate?:number}>};
export type SalaryState='none'|'below'|'ok';
/** One employee as the list receives it. The salary AMOUNT is never here: only where it stands. The amount is read when the employee is opened. */
export type Emp={uid:string;name:string;employeeNumber:string;status:string;unitName?:string;payBank?:'none'|'pending'|'verified';payItems?:number;payPending?:number;salary?:SalaryState;roleCode:string;roleTitle:string;gradeCode:string;gradeTitle:string;minSalary:number;problem:string;problemText:string};
export type FilterMode='all'|'below'|'none'|'attention'|'details';

export const BASIC_MAX=1e9;
export const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()).join('')||'?';
/** Why a typed salary cannot be saved ('' when it can, or when the box is empty). Below the grade minimum is allowed: it is flagged, not refused. */
export const salaryIssue=(v:number)=>Number.isNaN(v)?'':!Number.isFinite(v)||v<=0?'Enter an amount above 0, or clear the box.':v>BASIC_MAX?'That amount is too large.':Math.abs(v*100-Math.round(v*100))>1e-6?'Use at most 2 decimals.':'';
/** Red when the salary is under the grade minimum. A grade with no minimum has nothing to compare with. */
export const belowMin=(basic:number,minimum:number)=>Number.isFinite(basic)&&minimum>0&&basic<minimum;
/** No bank details yet, bank details or personal pay items waiting for a second person. */
export const detailsNeedAttention=(e:Pick<Emp,'payBank'|'payPending'>)=>(e.payBank||'none')!=='verified'||(e.payPending||0)>0;
export const matches=(e:Emp,mode:FilterMode)=>
 mode==='all'?true:mode==='below'?e.salary==='below':mode==='none'?e.salary==='none':mode==='details'?detailsNeedAttention(e):e.problem!=='';
export const countsOf=(emps:Emp[])=>({
 all:emps.length,
 below:emps.filter(e=>matches(e,'below')).length,
 none:emps.filter(e=>matches(e,'none')).length,
 attention:emps.filter(e=>matches(e,'attention')).length,
 details:emps.filter(e=>matches(e,'details')).length,
});

export const toGrade=(g:PayGrade):PayslipGrade=>({code:g.code,title:g.title,minSalary:Number(g.minSalary)||0,payModelCode:g.payModelCode||undefined,
 taxCodes:g.taxCodes,deductionCodes:g.deductionCodes,benefitCodes:g.benefitCodes,benefitValues:g.benefitValues});
export const EXPORT_HEADER=['Employee number','Name','Status','Job role','Grade code','Grade','Needs attention','Bank details','Personal pay items','Pay items awaiting verification'];
/** Excel copy of the list as it is on screen. Text and numbers only, and no salary or pay figures: those are seen one employee at a time. */
export function exportTable(emps:Emp[]):Array<Array<string|number|null>>{
 return emps.map(e=>[e.employeeNumber,e.name,e.status,e.roleTitle,e.gradeCode,e.gradeTitle,e.problemText,
  e.payBank==='verified'?'Verified':e.payBank==='pending'?'Awaiting verification':'None',e.payItems||0,e.payPending||0]);
}
