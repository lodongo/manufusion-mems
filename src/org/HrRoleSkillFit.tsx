import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Target, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';

export type SkillFit={
 percentage:number|null;confirmed:number;required:number;pending:number;
 confirmedCodes:string[];requiredCodes:string[];missingCodes:string[];pendingCodes:string[];
};
export const fitLabel=(fit?:SkillFit|null)=>
 !fit||fit.percentage===null?'Not configured':`${fit.percentage}%`;
export default function HrRoleSkillFit({fit,detailed=false}:{fit?:SkillFit|null;detailed?:boolean}){
 const [labels,setLabels]=useState<Record<string,string>>({});
 useEffect(()=>{
  if(!detailed||!fit?.requiredCodes.length)return;
  let mounted=true;
  callBackend<{skills:Array<{code:string;name:string}>}>('/api/org/hr/skills/catalog')
   .then(r=>{if(mounted)setLabels(Object.fromEntries(r.skills.map(s=>[s.code,s.name])))})
   .catch(()=>{});
  return()=>{mounted=false};
 },[detailed,fit?.requiredCodes.join('|')]);
 if(!fit)return null;
 return <section aria-label="Role skill fit" className="rounded-2xl border border-line bg-panel p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="flex items-center gap-2"><Target className="h-5 w-5 text-brand"/><div>
    <h3 className="font-semibold">Required skills for my role</h3>
    <p className="text-xs text-muted">Confirmed skills only · manager verified</p>
   </div></div>
   <strong className="text-2xl font-bold text-brand">{fitLabel(fit)}</strong>
  </div>
  {fit.percentage===null?<p className="mt-3 text-sm text-muted">No required skills have been configured for the assigned role. A fit percentage is not available.</p>:<>
   <div role="progressbar" aria-label="Confirmed role skill fit" aria-valuenow={fit.percentage} aria-valuemin={0} aria-valuemax={100}
     className="mt-3 h-3 overflow-hidden rounded-full bg-page">
     <div className="h-full rounded-full bg-brand transition-all" style={{width:`${fit.percentage}%`}}/>
   </div>
   <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
    <span><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600"/>{fit.confirmed} of {fit.required} confirmed</span>
    <span><Clock3 className="mr-1 inline h-4 w-4 text-amber-600"/>{fit.pending} missing skills pending review</span>
    <span><XCircle className="mr-1 inline h-4 w-4"/>{fit.missingCodes.length} gaps</span>
   </div>
   {detailed&&<div className="mt-4 grid gap-2 sm:grid-cols-2">
    {fit.requiredCodes.map(code=>{
     const approved=fit.confirmedCodes.includes(code),pending=fit.pendingCodes.includes(code);
     return <div key={code} className="flex min-w-0 items-start gap-2 rounded-xl border border-line bg-page p-3">
      {approved?<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>:pending?
       <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"/>:
       <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted"/>}
      <div className="min-w-0"><p className="break-words text-sm font-semibold">{labels[code]||code}</p>
       <p className="mt-1 break-all font-mono text-xs text-muted">{code}</p>
       <p className="mt-1 text-xs text-muted">{approved?'Confirmed':pending?'Awaiting manager confirmation':'Skill gap'}</p>
      </div>
     </div>;
    })}
   </div>}
  </>}
 </section>;
}
