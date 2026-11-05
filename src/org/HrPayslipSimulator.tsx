import {useMemo,useState} from 'react';
import {AlertTriangle,Banknote} from 'lucide-react';
import {availableCircumstances,computePayslip,type PayslipGrade,type PayslipItem,type PayslipSection} from '../shared/hrPayslip';
import type {Grade} from './hrGradeTypes';
import {NumField} from './hrFormParts';
import {messageOf} from '../components/screen';

const money=(n:number,c='')=>(c?c+' ':'')+new Intl.NumberFormat('en',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const SECTIONS:Array<[PayslipSection,string]>=[
 ['earnings','Earnings'],['noncash','Benefits in kind (not paid in cash)'],['preTax','Contributions taken before tax'],['tax','Tax'],
 ['relief','Tax reliefs (reduce the tax)'],['deductions','Deductions'],['employer','Employer costs (not taken from pay)'],
];

/**
 * Payslip preview for one grade, computed from the grade's pay package and the Benefits policy.
 * It is a review aid, not a payroll run: nothing is posted, filed or paid.
 */
export default function PayslipSimulator({grade,items,currency,policyVersion,basic:basicProp,onBasicChange,note}:{grade:Grade;items:PayslipItem[];currency:string;policyVersion:number;
 /** Payroll passes the employee's salary box in, so the box on the card and the one on the payslip are the same one. */
 basic?:number;onBasicChange?:(n:number)=>void;note?:string}){
 const controlled=onBasicChange!==undefined;
 const [localBasic,setLocalBasic]=useState<number>(grade.minSalary&&grade.minSalary>0?grade.minSalary:NaN);
 const basic=controlled?(basicProp??NaN):localBasic;
 const setBasic=controlled?onBasicChange:setLocalBasic;
 const minimum=Number(grade.minSalary)||0;
 const below=Number.isFinite(basic)&&minimum>0&&basic<minimum;
 const [weekday,setWeekday]=useState(0),[rest,setRest]=useState(0);
 const [picked,setPicked]=useState<string[]>([]);
 const [declared,setDeclared]=useState<Record<string,number>>({});
 const [other,setOther]=useState<Record<string,number>>({});

 const pg:PayslipGrade=useMemo(()=>({code:grade.code,title:grade.title,minSalary:Number(grade.minSalary)||0,payModelCode:grade.payModelCode||undefined,
  taxCodes:grade.taxCodes,deductionCodes:grade.deductionCodes,benefitCodes:grade.benefitCodes,benefitValues:grade.benefitValues}),[grade]);
 const circumstances=useMemo(()=>availableCircumstances(pg,items),[pg,items]);
 const overtime=useMemo(()=>({
  weekday:items.some(i=>i.code==='OT_WEEKDAY'&&i.enabled&&grade.benefitCodes.includes(i.code)),
  rest:items.some(i=>i.code==='OT_REST_HOLIDAY'&&i.enabled&&grade.benefitCodes.includes(i.code)),
 }),[items,grade.benefitCodes]);
 const used=useMemo(()=>new Set([...grade.taxCodes,...grade.deductionCodes]),[grade.taxCodes,grade.deductionCodes]);
 const claims=items.filter(i=>i.enabled&&i.category==='taxReliefs'&&used.has(i.code)&&i.base==='eligibleAmount'&&(i.method==='fixed'||i.method==='percent'));
 const optionalDeductions=items.filter(i=>i.enabled&&i.category==='otherDeductions'&&used.has(i.code));
 const clean=(m:Record<string,number>)=>Object.fromEntries(Object.entries(m).filter(([,v])=>Number.isFinite(v)&&v>=0));

 const result=useMemo(()=>{
  if(!Number.isFinite(basic)||basic<=0)return {p:null,error:''};
  try{
   return {p:computePayslip(pg,items,{basicSalary:basic,overtimeWeekdayHours:Number.isFinite(weekday)?weekday:0,overtimeRestHours:Number.isFinite(rest)?rest:0,
    circumstances:picked,declared:clean(declared),otherDeductions:clean(other)}),error:''};
  }catch(e){return {p:null,error:messageOf(e,'The payslip could not be calculated.')}}
 },[pg,items,basic,weekday,rest,picked,declared,other]);
 const p=result.p;

 return <div className="space-y-4">
  <div className="rounded-xl border border-line bg-page p-3">
   <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Banknote className="h-4 w-4 text-brand"/>Payslip preview</p>
   <p className="mt-1 text-xs text-muted">{note??'Built from this grade\'s taxes, deductions, benefits and the draft Benefits policy (v'+policyVersion+'). Change the figures to test cases. It is a review aid, not a payroll run: nothing is posted, filed or paid.'}</p>
  </div>

  <NumField label={'Basic monthly salary ('+currency+')'} value={basic} onChange={setBasic} optional={controlled} invalid={below} hintTone={below?'danger':'normal'}
   hint={below?'Below the grade minimum of '+money(minimum,currency):controlled?(minimum>0?'Grade minimum: '+money(minimum,currency):'This grade has no minimum salary set yet.'):minimum>0?'Starts at the grade minimum. Try higher pay to see the tax bands.':'Enter a salary to test, or set the grade minimum first.'}/>
  {(overtime.weekday||overtime.rest)&&<div className="grid grid-cols-2 gap-3">
   {overtime.weekday&&<NumField label="Overtime hours (weekdays)" value={weekday} max={200} onChange={setWeekday}/>}
   {overtime.rest&&<NumField label="Overtime hours (rest days, holidays)" value={rest} max={200} onChange={setRest}/>}
  </div>}

  {circumstances.length>0&&<details className="rounded-xl border border-line bg-page p-3">
   <summary className="cursor-pointer text-sm font-semibold text-ink">Circumstances to test ({picked.length} of {circumstances.length})</summary>
   <p className="mt-1 text-xs text-muted">Exceptions set up in Benefits. Each applies only to a person who holds the evidence shown.</p>
   <div className="mt-2 space-y-1">{circumstances.map(c=><label key={c.code} className={'flex min-h-12 items-start gap-3 rounded-xl border border-line px-3 py-2 '+(picked.includes(c.code)?'bg-brand/5':'')}>
    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-emerald-500" checked={picked.includes(c.code)} onChange={e=>setPicked(e.target.checked?[...picked,c.code]:picked.filter(x=>x!==c.code))}/>
    <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{c.name}</span>
     <span className="block text-xs text-muted">Changes {c.item} · needs: {c.evidence}</span></span>
   </label>)}</div>
  </details>}

  {claims.length>0&&<details className="rounded-xl border border-line bg-page p-3">
   <summary className="cursor-pointer text-sm font-semibold text-ink">Amounts the person claims</summary>
   <p className="mt-1 text-xs text-muted">Monthly amounts a person declares with proof, such as pension, insurance premiums or mortgage interest.</p>
   <div className="mt-2 grid gap-3">{claims.map(i=><NumField key={i.code} label={i.name+' (per month)'} value={declared[i.code]??NaN} optional placeholder="0" onChange={n=>setDeclared(d=>({...d,[i.code]:n}))}/>)}</div>
  </details>}

  {optionalDeductions.length>0&&<details className="rounded-xl border border-line bg-page p-3">
   <summary className="cursor-pointer text-sm font-semibold text-ink">Other deductions</summary>
   <p className="mt-1 text-xs text-muted">Leave a box empty to use the standard amount. Enter 0 to test without it.</p>
   <div className="mt-2 grid gap-3">{optionalDeductions.map(i=><NumField key={i.code} label={i.name+' (per month)'} value={other[i.code]??NaN} optional
    placeholder={i.method==='percent'?'Standard '+(i.rate*100)+'%':String(i.amount)} onChange={n=>setOther(d=>({...d,[i.code]:n}))}/>)}</div>
  </details>}

  {result.error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{result.error}</p>}
  {!p&&!result.error&&<p className="rounded-xl bg-panel p-3 text-sm text-muted">Enter a basic salary above to see the payslip.</p>}
  {p&&<>
   <div className="grid grid-cols-2 gap-2">
    <div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Gross pay</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{money(p.grossCash,currency)}</p></div>
    <div className="rounded-xl bg-brand/10 p-3"><p className="text-xs text-muted">Net pay (take-home)</p><p className="mt-1 break-words text-sm font-bold tabular-nums text-brand">{money(p.net,currency)}</p></div>
    <div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Tax after reliefs</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{money(p.tax,currency)}</p></div>
    <div className="rounded-xl bg-page p-3"><p className="text-xs text-muted">Total cost to employer</p><p className="mt-1 break-words text-sm font-bold tabular-nums">{money(p.totalCostToEmployer,currency)}</p></div>
   </div>
   {p.warnings.length>0&&<ul role="alert" className="space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700">{p.warnings.map(w=><li key={w} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0"/><span>{w}</span></li>)}</ul>}
   {SECTIONS.map(([key,title])=>{
    const lines=p.lines.filter(l=>l.section===key);
    if(!lines.length)return null;
    return <section key={key} className="rounded-xl border border-line bg-page p-3">
     <h4 className="text-sm font-semibold text-ink">{title}</h4>
     <dl className="mt-2 space-y-1.5 text-sm">{lines.map(l=><div key={l.code+l.label}>
      <div className="flex justify-between gap-3"><dt className="min-w-0 text-muted">{l.label}</dt><dd className="shrink-0 tabular-nums text-ink">{money(l.amount)}</dd></div>
      {l.note&&<p className="text-[11px] text-muted">{l.note}</p>}
     </div>)}</dl>
    </section>;})}
   <section className="rounded-xl border border-line bg-page p-3 text-sm">
    <div className="flex justify-between gap-3"><span className="text-muted">Taxable pay</span><span className="tabular-nums text-ink">{money(p.taxablePay)}</span></div>
    <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-semibold"><span className="text-ink">Net pay</span><span className="tabular-nums text-ink">{money(p.net,currency)}</span></div>
   </section>
   {p.appliedExceptions.length>0&&<div className="rounded-xl border border-line bg-page p-3 text-xs text-muted"><p className="font-semibold text-ink">Exceptions applied</p>
    <ul className="mt-1 list-disc space-y-0.5 pl-5">{p.appliedExceptions.map(a=><li key={a.item+a.exception}>{a.exception} on {a.item}</li>)}</ul></div>}
   {p.notes.length>0&&<ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{p.notes.map(n=><li key={n}>{n}</li>)}</ul>}
  </>}
 </div>;
}
