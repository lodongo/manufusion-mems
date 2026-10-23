import { useEffect, useMemo, useState } from 'react';
import { Award, Check, ClipboardCheck, Plus, RefreshCw, ShieldCheck, ThumbsUp, Users, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { SelectField } from '../components/ui';
import HrSkillCatalogueBrowser from './HrSkillCatalogueBrowser';

type Skill={code:string;name:string;category:string;subcategory:string;description:string;enabled:boolean};
type Proposal={id:string;skillCode:string;skillName:string;status:string;proposedBy:string;proposerName:string;managerUid:string;endorsements:Array<{uid:string;name:string}>;createdAt:string;reviewedAt:string};
type Peer={uid:string;name:string;employeeNumber:string};
type Approval={id:string;employeeUid:string;employeeName:string;skillCode:string;skillName:string;proposedBy:string;proposerName:string;endorsements:number;createdAt:string};
const panel='min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-4';
const button='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40';
const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const status=(s:string)=>s==='approved'?'Confirmed':s==='rejected'?'Not confirmed':'Awaiting manager';
function Message({error,notice}:{error:string;notice:string}){return <>{error&&<p role="alert" className="rounded-xl border border-red-500/40 p-3 text-sm text-red-600">{error}</p>}{notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-ink">{notice}</p>}</>}

export function EmployeeSkillPanel({employeeUid,ownUid}:{employeeUid:string;ownUid:string}){
 const [catalog,setCatalog]=useState<Skill[]>([]);
 const [items,setItems]=useState<Proposal[]>([]);
 const [skill,setSkill]=useState('');
 const [loading,setLoading]=useState(true);
 const [canPropose,setCanPropose]=useState(false);
 const [managerAssigned,setManagerAssigned]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{
   setLoading(true);setError('');
   try{
     const [c,p]=await Promise.all([
       callBackend<{skills:Skill[]}>('/api/org/hr/skills/catalog'),
       callBackend<{proposals:Proposal[];canPropose:boolean;managerAssigned:boolean}>('/api/org/hr/skills/proposals',{uid:employeeUid}),
     ]);
     setCatalog(c.skills.filter(x=>x.enabled));setItems(p.proposals);setCanPropose(p.canPropose);setManagerAssigned(p.managerAssigned);
   }catch(e){setError(e instanceof Error?e.message:'Skill records unavailable.')}finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[employeeUid]);
 const act=async(path:string,body:Record<string,unknown>,message:string)=>{
   setBusy(true);setError('');setNotice('');
   try{await callBackend(path,body);setNotice(message);await load()}
   catch(e){setError(e instanceof Error?e.message:'The action could not be completed.')}
   finally{setBusy(false)}
 };
 return <div className="space-y-3">
   <div className={panel}>
     <h3 className="mb-2 text-base font-bold">Verified and proposed skills</h3>
     <p className="mb-3 text-xs text-muted">Skills become confirmed only after review by the employee's immediate manager. Colleague endorsements are recorded separately.</p>
     {loading&&<p className="text-sm text-muted">Loading skill records…</p>}
     {items.length===0&&!loading&&<p className="rounded-xl bg-page p-3 text-sm text-muted">No skill nominations recorded.</p>}
     <div className="space-y-2">{items.map(item=><article key={item.id} className="rounded-xl border border-line bg-page p-3">
       <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.skillName}</strong><span className="rounded-full border border-line px-2 py-1 text-xs">{status(item.status)}</span></div>
       <p className="mt-1 text-xs text-muted">Proposed by {item.proposerName||'colleague'} · {item.endorsements.length} endorsements</p>
       {item.endorsements.length>0&&<p className="mt-1 text-xs text-muted">Seconded by {item.endorsements.map(x=>x.name).join(', ')}</p>}
       {employeeUid!==ownUid&&item.proposedBy!==ownUid&&!item.endorsements.some(x=>x.uid===ownUid)&&['pending','approved'].includes(item.status)&&
         <button type="button" disabled={busy} onClick={()=>void act('/api/org/hr/skills/endorse',{id:item.id},'Endorsement recorded.')} className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-brand"><ThumbsUp className="h-4 w-4"/>Second this skill</button>}
     </article>)}</div>
   </div>
   {canPropose&&<div className={panel}>
     <h3 className="mb-3 font-bold">{employeeUid===ownUid?'Propose my skill':'Propose a colleague’s skill'}</h3>
     <SelectField id={'skill-propose-'+employeeUid} label="Skill from approved catalogue" value={skill} onChange={e=>setSkill(e.target.value)}>
       <option value="">Select a skill</option>
       {catalog.map(x=><option key={x.code} value={x.code}>{x.name} · {x.category} / {x.subcategory}</option>)}
     </SelectField>
     {!managerAssigned&&<p className="mt-2 text-sm text-amber-600">An immediate manager must be configured in Organization Structure before a proposal can be submitted.</p>}
     <button type="button" className={'mt-3 '+button} disabled={!skill||busy||!managerAssigned} onClick={()=>void act('/api/org/hr/skills/propose',{employeeUid,skillCode:skill},'Skill sent to the immediate manager for confirmation.')}> <Plus className="mr-1 inline h-4 w-4"/>Submit skill proposal</button>
   </div>}
   <Message error={error} notice={notice}/>
 </div>;
}

export default function HrSkillsWorkspace({ownUid}:{ownUid:string}){
 const [tab,setTab]=useState<'catalog'|'peers'|'approvals'>('catalog');
 const [catalog,setCatalog]=useState<Skill[]>([]);
 const [catalogLoading,setCatalogLoading]=useState(true);
 const [canManage,setCanManage]=useState(false);
 const [peers,setPeers]=useState<Peer[]>([]);
 const [selected,setSelected]=useState('');
 const [inbox,setInbox]=useState<Approval[]>([]);
 const [edit,setEdit]=useState<Skill|null>(null),[creating,setCreating]=useState(false);
 const [name,setName]=useState(''),[category,setCategory]=useState(''),[subcategory,setSubcategory]=useState(''),[description,setDescription]=useState(''),[enabled,setEnabled]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [note,setNote]=useState('');
 const load=async()=>{
   setCatalogLoading(true);
   try{
     const [c,p,i]=await Promise.all([
       callBackend<{skills:Skill[];canManage:boolean}>('/api/org/hr/skills/catalog'),
       callBackend<{employees:Peer[]}>('/api/org/hr/skills/peers'),
       callBackend<{items:Approval[]}>('/api/org/hr/skills/inbox'),
     ]);
     setCatalog(c.skills);setCanManage(c.canManage);setPeers(p.employees);setInbox(i.items);
   }catch(e){setError(e instanceof Error?e.message:'HR skills unavailable.')}
   finally{setCatalogLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 const begin=(s?:Skill)=>{setEdit(s||null);setCreating(true);setName(s?.name||'');setCategory(s?.category||'');setSubcategory(s?.subcategory||'');setDescription(s?.description||'');setEnabled(s?.enabled!==false);setError('');setNotice('')};
 const save=async()=>{
   setBusy(true);setError('');setNotice('');
   try{
     await callBackend('/api/org/hr/skills/catalog/save',{code:edit?.code||'',name,category,subcategory,description,enabled});
     setCreating(false);setNotice('HR skill catalogue updated.');await load();
   }catch(e){setError(e instanceof Error?e.message:'Skill could not be saved.')}finally{setBusy(false)}
 };
 const decide=async(id:string,action:'approve'|'reject')=>{
   setBusy(true);setError('');setNotice('');
   try{await callBackend('/api/org/hr/skills/decide',{id,action,note});setNote('');setNotice(action==='approve'?'Skill confirmed by manager.':'Skill proposal returned as not confirmed.');await load()}
   catch(e){setError(e instanceof Error?e.message:'Review failed.')}finally{setBusy(false)}
 };
 const selectedPeer=useMemo(()=>peers.find(x=>x.uid===selected),[peers,selected]);
 return <div className="min-w-0 space-y-3">
   <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1">
    {[{key:'catalog',label:'Skills catalogue',icon:Award},{key:'peers',label:'Colleagues',icon:Users},{key:'approvals',label:'Manager approval',icon:ClipboardCheck}].map(({key,label,icon:Icon})=>
      <button key={key} onClick={()=>setTab(key as typeof tab)} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[11px] ${tab===key?'bg-blue-500/10 font-bold text-blue-600':'text-muted'}`}><Icon className="h-4 w-4"/>{label}{key==='approvals'&&inbox.length>0?' ('+inbox.length+')':''}</button>)}
   </div>
   <Message error={error} notice={notice}/>
   {tab==='catalog'&&<>
     {canManage&&<button onClick={()=>begin()} className={button}><Plus className="mr-1 inline h-4 w-4"/>Add skill</button>}
     {creating&&<div id="hr-skill-editor" className={panel}>
       <h3 className="mb-3 font-bold">{edit?'Update skill':'Add HR skill'}</h3>
       <div className="grid gap-3 sm:grid-cols-2">
         {[['Skill name',name,setName],['Category',category,setCategory],['Subcategory',subcategory,setSubcategory],['Description',description,setDescription]] .map(([label,value,setter])=>
           <label key={label as string} className="block text-sm text-muted">{label as string}<input className={field} value={value as string} onChange={e=>(setter as (v:string)=>void)(e.target.value)} maxLength={label==='Description'?600:160}/></label>)}
         <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enabled</label>
       </div>
       <div className="mt-3 flex gap-2"><button type="button" onClick={()=>setCreating(false)} className="min-h-11 rounded-xl border border-line px-4">Cancel</button><button type="button" disabled={busy||!name.trim()||!category.trim()||!subcategory.trim()} onClick={()=>void save()} className={button}>Save skill</button></div>
     </div>}
     <div className={panel}>
       {catalogLoading&&<p role="status" className="mb-3 text-sm text-muted">Loading HR skills catalogue…</p>}
       {!catalogLoading&&<HrSkillCatalogueBrowser skills={catalog} canManage={canManage} onEdit={begin}/>}
     </div>
   </>}
   {tab==='peers'&&<div className={panel}>
     <h3 className="mb-3 font-bold">Propose or second a colleague’s skills</h3>
     <SelectField id="hr-skill-peer" label="Employee at my site" value={selected} onChange={e=>setSelected(e.target.value)}>
       <option value="">Select colleague</option>
       {peers.map(p=><option key={p.uid} value={p.uid}>{p.name} · {p.employeeNumber||p.uid}</option>)}
     </SelectField>
     {selectedPeer&&<div className="mt-3"><h4 className="mb-2 font-semibold">{selectedPeer.name}</h4><EmployeeSkillPanel key={selectedPeer.uid} employeeUid={selectedPeer.uid} ownUid={ownUid}/></div>}
   </div>}
   {tab==='approvals'&&<div className="space-y-2">
     <div className={panel}><h3 className="font-bold">Immediate manager confirmations ({inbox.length})</h3><p className="mt-1 text-xs text-muted">Only proposals for your verified direct reports appear here. You cannot approve a proposal you submitted.</p></div>
     {inbox.length===0&&<div className={panel}><p className="text-sm text-muted">No skills awaiting your confirmation.</p></div>}
     {inbox.map(p=><div key={p.id} className={panel}>
       <h3 className="font-semibold">{p.employeeName} · {p.skillName}</h3>
       <p className="mt-1 text-xs text-muted">Proposed by {p.proposerName||'colleague'} · {p.endorsements} endorsements</p>
       <label className="mt-3 block text-sm text-muted">Review note<input className={field} value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason or confirmation note" maxLength={400}/></label>
       <div className="mt-3 flex gap-2"><button type="button" disabled={busy||note.trim().length<5} onClick={()=>void decide(p.id,'reject')} className="flex min-h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm"><X className="h-4 w-4"/>Decline</button><button type="button" disabled={busy||p.proposedBy===ownUid} onClick={()=>void decide(p.id,'approve')} className={button}><Check className="mr-1 inline h-4 w-4"/>Confirm</button></div>
     </div>)}
   </div>}
   <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Skill confirmations are retained with proposer, endorsers and immediate manager decision.</div>
 </div>;
}
