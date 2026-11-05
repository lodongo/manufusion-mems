import type {Catalogue,Grade} from './hrGradeTypes';

/** What the grade cards and their menus say, with no screen code so it can be tested on its own. */
export type RoleRef={code:string;title:string};
type Named={code:string;name:string};
export type Cell=string|number|null|undefined;

export const money=(n:number|null|undefined,c='')=>n===null||n===undefined?'—':(c?c+' ':'')+new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
export const namesOf=(items:Named[]|undefined,codes:string[])=>codes.map(c=>items?.find(i=>i.code===c)?.name||c);
export const leaveLines=(g:Grade,cat?:Catalogue|null)=>g.leave.map(l=>(cat?.leave.find(x=>x.code===l.code)?.name||l.code)+' '+l.daysPerYear+
 (l.unit==='months'?' months':l.unit==='calendar_days'?' calendar days':' working days')+(l.accrueMonthly?', earned monthly':''));
export const rolesText=(roles:RoleRef[])=>!roles.length?'None allocated':roles.length+' job role'+(roles.length===1?'':'s')+': '+roles.slice(0,5).map(r=>r.title).join(', ')+(roles.length>5?' and '+(roles.length-5)+' more':'');

export type Fact={label:string;value:string;warn?:boolean};
/** Everything the card leaves out. Pay details only for people who may see pay. */
export function gradeFacts(g:Grade,cat:Catalogue|null|undefined,financial:boolean,currency:string,roles:RoleRef[]):Fact[]{
 const facts:Fact[]=[{label:'Status',value:g.enabled?'Enabled':'Disabled · cannot be given to job roles'}];
 if(financial){
  const salaryOk=(g.minSalary??0)>0;
  facts.push({label:'Minimum monthly salary',value:salaryOk?money(g.minSalary,currency):'Not set',warn:!salaryOk});
  facts.push({label:'Pay model',value:g.payModelCode?namesOf(cat?.payModels,[g.payModelCode])[0]:'Not chosen',warn:!g.payModelCode&&!!cat?.payModels.some(p=>p.enabled)});
  facts.push({label:'Allowances, benefits and incentives',value:g.benefitCodes.length?namesOf(cat?.benefits,g.benefitCodes).join(', '):'None chosen'});
  facts.push({label:'Leave',value:g.leave.length?leaveLines(g,cat).join('; '):'None chosen',warn:!g.leave.length&&!!cat?.leave.some(l=>l.enabled)});
  facts.push({label:'Taxes',value:g.taxCodes.length?namesOf(cat?.taxes,g.taxCodes).join(', '):'None'});
  facts.push({label:'Deductions',value:g.deductionCodes.length?namesOf(cat?.deductions,g.deductionCodes).join(', '):'None'});
 }
 facts.push({label:'Job roles',value:rolesText(roles)});
 if(g.description.trim())facts.push({label:'Description',value:g.description.trim()});
 return facts;
}

export const EXPORT_HEADER=['Grade','Job grade','Code','Status','Minimum monthly salary','Currency','Taxes','Deductions','Pay model','Pay & benefits','Leave','Job roles','Description'];
/** Rows of the Excel copy, in grade order. Text and numbers only. */
export function exportRows(grades:Grade[],cat:Catalogue|null|undefined,currency:string,roles:Record<string,RoleRef[]>):Cell[][]{
 return grades.slice().sort((a,b)=>a.rank-b.rank).map(g=>[g.rank,g.title,g.code,g.enabled?'Enabled':'Disabled',g.minSalary,currency,
  namesOf(cat?.taxes,g.taxCodes).join(', '),namesOf(cat?.deductions,g.deductionCodes).join(', '),
  g.payModelCode?namesOf(cat?.payModels,[g.payModelCode])[0]:'',namesOf(cat?.benefits,g.benefitCodes).join(', '),
  leaveLines(g,cat).join('; '),(roles[g.code]||[]).length,g.description]);
}
