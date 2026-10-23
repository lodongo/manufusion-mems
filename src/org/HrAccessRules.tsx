import {useEffect,useState} from 'react';
import {ArrowLeft,LockKeyhole,ShieldCheck,Save,RotateCcw} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {navigate} from '../lib/route';
type RuleKey='selfTabs'|'managerTabs'|'hrTabs';
type Rules={selfTabs:string[];managerTabs:string[];hrTabs:string[];managerIndirectReports:boolean};
const titles:Record<string,string>={
 basic:'Basic Information',education:'Education',family:'Family',skills:'Skills',deployment:'Department & Deployment',
 records:'Records',roles:'Roles & Responsibilities',payslips:'Payslips',talent:'Talent Pipeline',
 leave:'Leave Management',capability:'Capability Assessment',performance:'Performance Management',learning:'Learning',history:'Employment History'};
const protectedTabs:Record<RuleKey,string[]>={
 selfTabs:['basic','education','family','skills','deployment','roles','payslips','leave','capability','performance','learning'],
 managerTabs:['basic','skills','deployment','roles','leave','capability','performance'],
 hrTabs:['basic','education','skills','deployment','records','roles','talent','leave','capability','performance','learning','history'],
};
export default function HrAccessRules(){
 const [rules,setRules]=useState<Rules|null>(null);
 const [canConfigure,setCanConfigure]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;callBackend<{rules:Rules;canConfigure:boolean}>('/api/org/hr/access-rules/get')
  .then(r=>{if(active){setRules(r.rules);setCanConfigure(r.canConfigure)}})
  .catch(e=>{if(active)setError(e instanceof Error?e.message:'Rules unavailable.')});return()=>{active=false}},[]);
 const toggle=(key:RuleKey,id:string,on:boolean)=>setRules(r=>r?{...r,[key]:on?[...r[key],id]:r[key].filter(x=>x!==id)}:r);
 const save=async()=>{if(!rules)return;setSaving(true);setError('');setMessage('');
  try{const result=await callBackend<{rules:Rules}>('/api/org/hr/access-rules/save',{rules});
    setRules(result.rules);setMessage('Privacy rules saved and audited.');}
  catch(e){setError(e instanceof Error?e.message:'Could not save HR access rules.')}finally{setSaving(false)}};
 return <div className="min-w-0 space-y-4 px-3 py-4 sm:px-5">
  <header className="flex items-center gap-3"><button type="button" onClick={()=>navigate('organization_home/hr/HR01')} aria-label="Back to HR" className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"><ArrowLeft className="h-5 w-5"/></button>
   <div className="flex-1"><p className="text-xs font-semibold text-brand">HR · CONFIGURATION</p><h1 className="text-lg font-bold">Privacy & Access Rules</h1></div><ShieldCheck className="h-6 w-6 text-brand"/>
  </header>
  <section className="rounded-2xl border border-line bg-panel p-4">
   <p className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-5 w-5 text-brand"/>Protected permissions</p>
   <p className="mt-2 text-sm text-muted">No rule can expose family or payslip records to managers. Super Administrators have organization-wide access, but cannot modify or approve their own employee records. Access is checked by the backend for each employee.</p>
  </section>
  {!rules&&!error&&<p className="text-sm text-muted">Loading rules…</p>}
  {error&&<p role="alert" className="rounded-xl border border-red-500/40 p-3 text-sm text-red-600">{error}</p>}
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
     onChange={e=>setRules({...rules,managerIndirectReports:e.target.checked})}/>
     <div><strong>Allow indirect reportee visibility</strong><p className="text-xs text-muted">Direct reportees remain the default. Extended reporting access still requires verified manager hierarchy permissions.</p></div></label>
   </section>
   {canConfigure&&<button type="button" onClick={()=>void save()} disabled={saving} className="flex min-h-12 items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-onbrand disabled:opacity-40"><Save className="h-5 w-5"/>{saving?'Saving…':'Save access rules'}</button>}
  </>}
 </div>;
}
