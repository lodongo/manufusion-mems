import {useEffect,useMemo,useState} from 'react';
import {CheckCircle2,Clock3,ClipboardCheck,LockKeyhole,Send,ShieldCheck,Target,TriangleAlert} from 'lucide-react';
import {callBackend} from '../lib/backend';
import HrRoleSkillFit,{type SkillFit} from './HrRoleSkillFit';

type Role={code:string;title:string;requiredSkillCodes:string[]};
type CatalogueSkill={code:string;name:string;category:string;subcategory:string;description:string;enabled:boolean};
type Proposals={managerAssigned:boolean;managerStatus?:'resolved'|'unassigned'|'ambiguous';managerRoleCode?:string};
const limit=25;
export default function HrRoleSkillRequirements({
  employeeUid,roles,fit,canSubmit,onRefresh,
}:{
  employeeUid:string;roles:Role[];fit:SkillFit;canSubmit:boolean;onRefresh:()=>Promise<void>;
}){
 const [skills,setSkills]=useState<CatalogueSkill[]>([]);
 const [catalogueError,setCatalogueError]=useState('');
 const [managerAssigned,setManagerAssigned]=useState(false);
 const [managerProblem,setManagerProblem]=useState('');
 const [selected,setSelected]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  let alive=true;setLoading(true);setCatalogueError('');setSelected([]);setError('');setNotice('');
  const skillRequest=callBackend<{skills:CatalogueSkill[]}>('/api/org/hr/skills/catalog');
  const managerRequest=canSubmit?callBackend<Proposals>('/api/org/hr/skills/proposals',{uid:employeeUid}):Promise.resolve<Proposals>({managerAssigned:false});
  void Promise.all([skillRequest,managerRequest]).then(([s,m])=>{
    if(alive){setSkills(s.skills);setManagerAssigned(m.managerAssigned);setManagerProblem(m.managerStatus==='ambiguous'?'Multiple employees hold the same configured manager role. HR must resolve the manager assignment before approval.':'No unique active employee has been assigned to the configured manager job role at the correct organization level. Ask Organization Admin to check the role holder.')}
  }).catch(e=>{if(alive)setCatalogueError(e instanceof Error?e.message:'Cannot load the skills catalogue.')})
   .finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[employeeUid,canSubmit]);
 const lookup=useMemo(()=>new Map(skills.map(s=>[s.code,s])),[skills]);
 const confirmed=new Set(fit.confirmedCodes),pending=new Set(fit.pendingCodes);
 const missing=useMemo(()=>fit.missingCodes.filter(code=>!pending.has(code)&&!confirmed.has(code)),[fit.missingCodes,fit.pendingCodes,fit.confirmedCodes]);
 const available=missing.filter(code=>lookup.get(code)?.enabled===true);
 const select=(code:string,checked:boolean)=>{
  setSelected(current=>checked
    ?current.includes(code)||current.length>=limit?current:[...current,code]
    :current.filter(x=>x!==code));
 };
 const submit=async()=>{
  if(!canSubmit||busy||!managerAssigned||!selected.length)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await callBackend<{submittedCount:number;skippedCount:number}>('/api/org/hr/skills/role-requirements/propose',{
     employeeUid,skillCodes:selected,
   });
   setNotice(`${result.submittedCount} required skill(s) sent for immediate-manager approval.${result.skippedCount?' '+result.skippedCount+' already pending or confirmed.':''}`);
   setSelected([]);
   await onRefresh();
  }catch(e){setError(e instanceof Error?e.message:'Unable to submit role skill requirements.')}
  finally{setBusy(false)}
 };
 return <div className="min-w-0 space-y-3">
   <HrRoleSkillFit fit={fit}/>
   {loading&&<p role="status" className="rounded-xl border border-line bg-panel p-3 text-sm text-muted">Loading role skill requirements…</p>}
   {catalogueError&&<p role="alert" className="rounded-xl border border-line bg-panel p-3 text-sm text-danger">{catalogueError}</p>}
   {!fit.requiredCodes.length&&<section className="rounded-2xl border border-dashed border-line bg-panel p-5 text-sm text-muted">
    <Target className="mb-2 h-6 w-6 text-brand"/>
    This employee's assigned role has no skills requirements configured. HR can configure them under Job Roles & Position Profiles.
   </section>}
   {roles.filter(r=>r.requiredSkillCodes.length>0).map(role=><section key={role.code} className="min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-4">
    <header className="mb-3 flex min-w-0 items-center justify-between gap-2">
     <div className="min-w-0"><h3 className="break-words text-base font-bold">{role.title}</h3><p className="mt-1 text-xs text-muted">{role.code} · {role.requiredSkillCodes.length} required skills</p></div>
     <ClipboardCheck className="h-5 w-5 shrink-0 text-brand"/>
    </header>
    <div className="space-y-2">{role.requiredSkillCodes.map(code=>{
     const skill=lookup.get(code),approved=confirmed.has(code),awaiting=pending.has(code);
     const enabled=skill?.enabled===true;
     const selectable=canSubmit&&!approved&&!awaiting&&enabled;
     return <div key={code} className="flex min-w-0 items-start gap-3 rounded-xl border border-line bg-page p-3">
      {canSubmit&&<input aria-label={`Select ${skill?.name||code}`} type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-brand" checked={selected.includes(code)}
        disabled={!selectable||busy||(!selected.includes(code)&&selected.length>=limit)}
        onChange={e=>select(code,e.target.checked)}/>}
      <div className="min-w-0 flex-1 space-y-1">
       <div className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm">{skill?.name||code}</strong>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${approved?'bg-emerald-500/10 text-emerald-700':awaiting?'bg-amber-500/10 text-amber-700':'bg-brand/10 text-brand'}`}>
         {approved?'Confirmed':awaiting?'Awaiting manager':enabled?'Not yet confirmed':'Catalogue unavailable'}
        </span>
       </div>
       <p className="break-all font-mono text-xs text-muted">{code}</p>
       {skill&&<p className="text-xs text-muted">{skill.category} · {skill.subcategory}</p>}
       {!!skill?.description&&<p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-soft">{skill.description}</p>}
       {approved&&<p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4"/>Confirmed by the manager</p>}
       {awaiting&&<p className="flex items-center gap-1 text-xs text-amber-700"><Clock3 className="h-4 w-4"/>Already submitted, pending manager review</p>}
       {!enabled&&!approved&&!awaiting&&<p className="flex items-center gap-1 text-xs text-muted"><TriangleAlert className="h-4 w-4"/>Skill is not currently enabled in the HR catalogue</p>}
      </div>
     </div>;
    })}</div>
   </section>)}
   {canSubmit&&fit.requiredCodes.length>0&&<section className="sticky bottom-0 z-10 rounded-2xl border border-line bg-panel p-3 shadow-lg">
    <div className="flex flex-wrap items-center justify-between gap-2">
     <div><p className="font-semibold">{selected.length} selected</p><p className="text-xs text-muted">{available.length} available requirements · maximum {limit} per submission</p></div>
     <button type="button" disabled={!selected.length||!managerAssigned||busy||!!catalogueError}
      onClick={()=>void submit()}
      className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40">
      <Send className="h-4 w-4"/>Submit for approval</button>
    </div>
    {!managerAssigned&&!loading&&<p className="mt-2 text-xs text-amber-700">{managerProblem||'A verified manager role holder is required before submission.'}</p>}
   </section>}
   {!canSubmit&&fit.requiredCodes.length>0&&<p className="flex items-center gap-2 rounded-xl border border-line bg-panel p-3 text-xs text-muted">
    <LockKeyhole className="h-4 w-4"/>This is an authorized read-only view. Only the employee may select and submit their own required skills.
   </p>}
   {error&&<p role="alert" className="rounded-xl border border-line bg-panel p-3 text-sm text-danger">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-line bg-panel p-3 text-sm">{notice}</p>}
   <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Selections do not affect role fit until confirmed by the direct manager.</p>
 </div>;
}
