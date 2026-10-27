import {useEffect,useState} from 'react';
import {ArrowLeft,LockKeyhole,ShieldCheck,Save,RotateCcw} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
import {firebaseAuth} from '../firebase';
type RuleKey='selfTabs'|'managerTabs'|'hrTabs';
type Rules={selfTabs:string[];managerTabs:string[];hrTabs:string[];managerIndirectReports:boolean};
type Pending={rules:Rules;proposedBy:string;proposedAt:string;status:string};
const titles:Record<string,string>={
 basic:'Basic Information',education:'Education',family:'Family',skills:'Skills',roleSkills:'Role Skill Requirements',deployment:'Department & Deployment',
 records:'Records',roles:'Roles & Responsibilities',payslips:'Payslips',talent:'Talent Pipeline',
 leave:'Leave Management',capability:'Capability Assessment',performance:'Performance Management',learning:'Learning',history:'Employment History'};
const protectedTabs:Record<RuleKey,string[]>={
 selfTabs:['basic','education','family','skills','roleSkills','deployment','roles','payslips','leave','capability','performance','learning'],
 managerTabs:['basic','skills','deployment','roles','leave','capability','performance'],
 hrTabs:['basic','education','skills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
};
export default function HrAccessRules(){
 const [rules,setRules]=useState<Rules|null>(null);
 const [canConfigure,setCanConfigure]=useState(false),[canApprove,setCanApprove]=useState(false),[saving,setSaving]=useState(false);
 const [pending,setPending]=useState<Pending|null>(null);
 const [simulationDigest,setSimulationDigest]=useState(''),[preview,setPreview]=useState<Record<string,string[]>|null>(null);
 const [reviewNote,setReviewNote]=useState('');
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const reload=async()=>{
  const r=await callBackend<{rules:Rules;canConfigure:boolean;canApprove:boolean;pending:Pending|null}>('/api/org/hr/access-rules/get');
  setRules(r.rules);setCanConfigure(r.canConfigure);setCanApprove(r.canApprove);setPending(r.pending);
 };
 useEffect(()=>{void reload().catch(e=>setError(e instanceof Error?e.message:'Rules unavailable.'))},[]);
 const toggle=(key:RuleKey,id:string,on:boolean)=>{setSimulationDigest('');setPreview(null);setRules(r=>r?{...r,[key]:on?[...r[key],id]:r[key].filter(x=>x!==id)}:r)};
 const simulate=async()=>{
  if(!rules)return;setSaving(true);setError('');setMessage('');
  try{
   const r=await callBackend<{digest:string;preview:Record<string,string[]>}>('/api/org/hr/access-rules/simulate',{rules});
   setSimulationDigest(r.digest);setPreview(r.preview);setMessage('Simulation complete. Check affected portal tabs before submitting.');
  }catch(e){setError(e instanceof Error?e.message:'Simulation failed.')}finally{setSaving(false)}
 };
 const save=async()=>{if(!rules)return;setSaving(true);setError('');setMessage('');
  try{await callBackend('/api/org/hr/access-rules/save',{rules,simulationDigest});
   setSimulationDigest('');setPreview(null);setMessage('Rule changes submitted for independent Privacy Officer approval.');await reload();}
  catch(e){setError(e instanceof Error?e.message:'Could not submit HR access rules.')}finally{setSaving(false)}
 };
 const review=async(decision:'approve'|'reject')=>{
  setSaving(true);setError('');setMessage('');
  try{await callBackend('/api/org/hr/access-rules/review',{decision,note:reviewNote});
   setMessage(decision==='approve'?'Independently approved HR privacy rules activated.':'Privacy change rejected.');
   setReviewNote('');await reload();}
  catch(e){setError(e instanceof Error?e.message:'Review failed.')}finally{setSaving(false)}
 };
 return <div className="min-w-0 space-y-4 px-3 py-4 sm:px-5">
  <header className="flex items-center gap-3"><button type="button" onClick={()=>navigate('organization_home/hr/HR01')} aria-label="Back to HR" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><ArrowLeft className="h-5 w-5"/></button>
   <div className="flex-1"><p className="text-xs font-semibold text-brand">HR · CONFIGURATION</p><h1 className="text-lg font-bold">Privacy & Access Rules</h1></div><ShieldCheck className="h-6 w-6 text-brand"/>
  </header>
  <section className="rounded-2xl border border-line bg-panel p-4">
   <p className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-5 w-5 text-brand"/>Protected permissions</p>
   <p className="mt-2 text-sm text-muted">No rule can expose family or payslip records to managers. Super Administrators retain full access to other employees and may update their own permitted self-service data (education, family, skill proposals and leave applications). They cannot change protected employment fields or approve their own transactions. Access is checked by the backend for each employee.</p>
  </section>
  {!rules&&!error&&<p className="text-sm text-muted">Loading rules…</p>}
  {error&&<p role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-danger">{error}</p>}
  {message&&<p role="status" className="rounded-xl border border-line p-3 text-sm">{message}</p>}
  {rules&&<>
   {([['selfTabs','Employee: My HR Portal'],['managerTabs','Manager: My Reportees'],['hrTabs','Authorized HR practitioner']] as [RuleKey,string][]).map(([key,title])=>
    <section key={key} className="rounded-2xl border border-line bg-panel p-4">
     <h2 className="mb-3 font-semibold">{title}</h2>
     <div className="grid gap-2 sm:grid-cols-2">{protectedTabs[key].map(id=><label key={id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-page px-3 text-sm">
       <input type="checkbox" disabled={!canConfigure||id==='basic'} checked={rules[key].includes(id)} onChange={e=>toggle(key,id,e.target.checked)} className="h-5 w-5 accent-brand"/>
       <span className="min-w-0 flex-1">{titles[id]}</span>{id==='basic'&&<LockKeyhole className="h-4 w-4 text-muted"/>}
      </label>)}</div>
    </section>)}
   <section className="rounded-2xl border border-line bg-panel p-4">
    <label className="flex items-center gap-3"><input type="checkbox" disabled={!canConfigure} className="h-5 w-5 accent-brand" checked={rules.managerIndirectReports}
     onChange={e=>{setSimulationDigest('');setPreview(null);setRules({...rules,managerIndirectReports:e.target.checked})}}/>
     <div><strong>Allow indirect reportee visibility</strong><p className="text-xs text-muted">Direct reportees remain the default. Extended reporting access still requires verified manager hierarchy permissions.</p></div></label>
   </section>
   {canConfigure&&<section className="rounded-2xl border border-line bg-panel p-4">
    <h3 className="mb-2 font-semibold">Mandatory access simulation</h3>
    <p className="mb-3 text-xs text-muted">Simulate the exact proposed settings. Manager Family/Payslips restrictions and the restriction on protected self-edits and self-approval cannot be overridden.</p>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void simulate()} disabled={saving||!!pending} className="min-h-12 rounded-xl border border-line px-4 font-semibold disabled:opacity-40">Simulate rule change</button>
    <button type="button" onClick={()=>void save()} disabled={saving||!simulationDigest||!!pending} className="flex min-h-12 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-onbrand disabled:opacity-40"><Save className="h-5 w-5"/>Submit for independent approval</button></div>
    {preview&&<p className="mt-3 rounded-xl bg-page p-3 text-xs text-muted">Simulated: Employee {preview.employee?.length||0} tabs; Manager {preview.manager?.length||0} tabs; HR {preview.hr?.length||0} tabs; Super Administrator {preview.superadmin?.length||0} tabs.</p>}
   </section>}
   {pending&&<section className="rounded-2xl border border-line bg-panel p-4">
    <h3 className="font-semibold">Pending independent privacy review</h3>
    <p className="mt-1 text-xs text-muted">Submitted by {pending.proposedBy} · {pending.proposedAt}</p>
    {canApprove&&pending.proposedBy!==firebaseAuth.currentUser?.uid&&<div className="mt-3 space-y-3">
     <label className="block text-sm text-muted">Decision note<input value={reviewNote} onChange={e=>setReviewNote(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-ink" maxLength={400}/></label>
     <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void review('reject')} disabled={saving||reviewNote.trim().length<5} className="min-h-11 rounded-xl border border-line px-4 disabled:opacity-40">Reject</button>
      <button type="button" onClick={()=>void review('approve')} disabled={saving} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-onbrand disabled:opacity-40">Approve & activate</button></div>
    </div>}
    {pending.proposedBy===firebaseAuth.currentUser?.uid&&<p className="mt-2 text-sm text-muted">An independent Privacy Officer must approve; the requester cannot approve their own change.</p>}
   </section>}
  </>}
 </div>;
}
