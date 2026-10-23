import { useEffect, useMemo, useState } from 'react';
import { Award, Check, ClipboardCheck, Plus, RefreshCw, Search, ShieldCheck, ThumbsUp, Users, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { SelectField } from '../components/ui';
import HrSkillCatalogueBrowser from './HrSkillCatalogueBrowser';
import HrSkillCategoryFields from './HrSkillCategoryFields';
import {MAX_SKILL_NOMINATIONS,otherSkillOptions,selectVisibleSkills,toggleSelectedSkill} from './hrSkillSelection';

type Skill={code:string;name:string;category:string;subcategory:string;description:string;enabled:boolean};
type Proposal={id:string;skillCode:string;skillName:string;status:string;proposedBy:string;proposerName:string;managerUid:string;endorsements:Array<{uid:string;name:string}>;createdAt:string;reviewedAt:string};
type Peer={uid:string;name:string;employeeNumber:string};
type Approval={id:string;employeeUid:string;employeeName:string;skillCode:string;skillName:string;proposedBy:string;proposerName:string;endorsements:number;requiredForRole:boolean;roleFit:number|null;createdAt:string};
const panel='min-w-0 rounded-2xl border border-line bg-panel p-3 sm:p-4';
const button='min-h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40';
const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const status=(s:string)=>s==='approved'?'Confirmed':s==='rejected'?'Not confirmed':'Awaiting manager';
function Message({error,notice}:{error:string;notice:string}){return <>{error&&<p role="alert" className="rounded-xl border border-red-500/40 p-3 text-sm text-red-600">{error}</p>}{notice&&<p role="status" className="rounded-xl border border-line p-3 text-sm text-ink">{notice}</p>}</>}

export function EmployeeSkillPanel({employeeUid,ownUid,requiredCodes=[]}:{employeeUid:string;ownUid:string;requiredCodes?:string[]}){
 const [catalog,setCatalog]=useState<Skill[]>([]);
 const [items,setItems]=useState<Proposal[]>([]);
 const [skillSearch,setSkillSearch]=useState('');
 const [skillPageSize,setSkillPageSize]=useState(40);
 const [selectedSkills,setSelectedSkills]=useState<string[]>([]);
 const [skillCategory,setSkillCategory]=useState('');
 const [skillSubcategory,setSkillSubcategory]=useState('');
 const [loading,setLoading]=useState(true);
 const skillChoices=useMemo(()=>otherSkillOptions(catalog,skillCategory,skillSubcategory,skillSearch,requiredCodes),[catalog,skillCategory,skillSubcategory,skillSearch,requiredCodes.join('|')]);
 const existingCodes=useMemo(()=>new Set(items.filter(item=>item.status==='pending'||item.status==='approved').map(item=>item.skillCode)),[items]);
 const eligibleChoices=useMemo(()=>skillChoices.filter(item=>!existingCodes.has(item.code)),[skillChoices,existingCodes]);
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
 const toggleSkill=(code:string,checked:boolean)=>{
   setSelectedSkills(v=>toggleSelectedSkill(v,code,checked));
 };
 const selectAllVisible=()=>setSelectedSkills(v=>selectVisibleSkills(v,eligibleChoices.map(x=>x.code)));
 useEffect(()=>{setSkillPageSize(40)},[skillCategory,skillSubcategory,skillSearch]);
 useEffect(()=>{
   setSelectedSkills([]);
   setSkillCategory('');setSkillSubcategory('');setSkillSearch('');
 },[employeeUid]);
 const submitSelected=async()=>{
   if(!selectedSkills.length||busy)return;
   setBusy(true);setError('');setNotice('');
   try{
     const result=await callBackend<{submittedCount:number;skippedCount:number}>('/api/org/hr/skills/propose/bulk',{
       employeeUid,skillCodes:selectedSkills,
     });
     setNotice(`${result.submittedCount} skill(s) submitted to the immediate manager.${result.skippedCount?' '+result.skippedCount+' already pending or confirmed.':''}`);
     setSelectedSkills([]);await load();
   }catch(e){setError(e instanceof Error?e.message:'Skill submission failed.')}
   finally{setBusy(false)}
 };
 const act=async(path:string,body:Record<string,unknown>,message:string)=>{
   setBusy(true);setError('');setNotice('');
   try{await callBackend(path,body);setNotice(message);await load()}
   catch(e){setError(e instanceof Error?e.message:'The action could not be completed.')}
   finally{setBusy(false)}
 };
 return <div className="space-y-3">
   <div className={panel}>
     <h3 className="mb-2 text-base font-bold">Other skills — verified and proposed</h3>
     <p className="mb-3 text-xs text-muted">Skills become confirmed only after review by the employee's immediate manager. Colleague endorsements are recorded separately.</p>
     {loading&&<p className="text-sm text-muted">Loading skill records…</p>}
     {items.filter(item=>!requiredCodes.includes(item.skillCode)).length===0&&!loading&&<p className="rounded-xl bg-page p-3 text-sm text-muted">No other skill nominations recorded.</p>}
     <div className="space-y-2">{items.filter(item=>!requiredCodes.includes(item.skillCode)).map(item=><article key={item.id} className="rounded-xl border border-line bg-page p-3">
       <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{item.skillName}</strong><span className="rounded-full border border-line px-2 py-1 text-xs">{status(item.status)}</span></div>
       <p className="mt-1 text-xs text-muted">Proposed by {item.proposerName||'colleague'} · {item.endorsements.length} endorsements</p>
       {item.endorsements.length>0&&<p className="mt-1 text-xs text-muted">Seconded by {item.endorsements.map(x=>x.name).join(', ')}</p>}
       {employeeUid!==ownUid&&item.proposedBy!==ownUid&&!item.endorsements.some(x=>x.uid===ownUid)&&['pending','approved'].includes(item.status)&&
         <button type="button" disabled={busy} onClick={()=>void act('/api/org/hr/skills/endorse',{id:item.id},'Endorsement recorded.')} className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-brand"><ThumbsUp className="h-4 w-4"/>Second this skill</button>}
     </article>)}</div>
   </div>
   {canPropose&&<div className={panel}>
     <h3 className="mb-3 font-bold">{employeeUid===ownUid?'Propose my other skills':'Propose a colleague’s other skills'}</h3>
     <p className="mb-3 text-xs text-muted">Choose a category and subcategory, then tick as many skills as needed. Selections are kept when you move to another subcategory.</p>
     <HrSkillCategoryFields idPrefix={'skill-propose-'+employeeUid} skills={catalog.filter(x=>!requiredCodes.includes(x.code))}
       category={skillCategory} subcategory={skillSubcategory}
       onCategory={v=>{setSkillCategory(v);setSkillSubcategory('');setSkillSearch('')}}
       onSubcategory={v=>{setSkillSubcategory(v);setSkillSearch('')}}/>
     {skillCategory&&skillSubcategory&&<section className="mt-3 space-y-3" aria-label="Select multiple skills">
       <label className="relative block">
         <span className="sr-only">Search skills in the selected subcategory</span>
         <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-muted"/>
         <input type="search" value={skillSearch} onChange={e=>setSkillSearch(e.target.value)}
           placeholder="Search skill names, codes or descriptions" autoComplete="off"
           className="min-h-12 w-full rounded-xl border border-line bg-page py-2 pl-10 pr-3 text-base text-ink"/>
       </label>
       <div className="flex flex-wrap items-center justify-between gap-2">
         <p className="text-xs text-muted">{skillChoices.length} skills in this selection · {eligibleChoices.length} available to propose</p>
         <button type="button" disabled={busy||selectedSkills.length>=MAX_SKILL_NOMINATIONS||!eligibleChoices.length}
           onClick={selectAllVisible}
           className="min-h-11 rounded-xl border border-line bg-panel px-3 text-sm font-semibold text-brand disabled:opacity-40">
           <Check className="mr-1 inline h-4 w-4"/>Select all available (up to {MAX_SKILL_NOMINATIONS})
         </button>
       </div>
       <div className="max-h-[45dvh] space-y-2 overflow-y-auto rounded-xl border border-line bg-page p-2" role="group" aria-label="Skills in selected subcategory">
         {skillChoices.length===0&&<p className="p-3 text-sm text-muted">No other skills match this category and subcategory.</p>}
         {skillChoices.slice(0,skillPageSize).map(entry=>{
           const previouslySubmitted=existingCodes.has(entry.code);
           const selected=selectedSkills.includes(entry.code);
           const disabled=busy||previouslySubmitted||(!selected&&selectedSkills.length>=MAX_SKILL_NOMINATIONS);
           return <label key={entry.code} className={`flex min-w-0 min-h-14 items-start gap-3 rounded-xl border border-line p-3 text-left ${selected?'bg-brand/10 border-brand/40':'bg-panel'} ${disabled?'opacity-65':''}`}>
             <input type="checkbox" aria-label={`Select ${entry.name}`}
               className="mt-1 h-5 w-5 shrink-0 accent-brand" checked={selected} disabled={disabled}
               onChange={e=>toggleSkill(entry.code,e.target.checked)}/>
             <span className="min-w-0 flex-1">
               <span className="block break-words text-sm font-semibold">{entry.name}</span>
               <span className="mt-1 block break-all font-mono text-xs text-brand">{entry.code}</span>
               {entry.description&&<span className="mt-1 block whitespace-pre-wrap break-words text-xs text-muted">{entry.description}</span>}
               {previouslySubmitted&&<span className="mt-1 block text-xs text-muted">Already confirmed or awaiting manager</span>}
             </span>
           </label>;
         })}
         {skillChoices.length>skillPageSize&&<button type="button" className="min-h-11 w-full rounded-xl border border-line text-sm font-semibold text-brand"
           onClick={()=>setSkillPageSize(v=>v+40)}>Show more skills</button>}
       </div>
     </section>}
     <div className="mt-3 rounded-xl border border-line bg-page p-3">
       <h4 className="text-sm font-semibold">Selected other skills ({selectedSkills.length}/{MAX_SKILL_NOMINATIONS})</h4>
       <p className="mt-1 text-xs text-muted">You can select further categories and subcategories without losing previous selections.</p>
       {!selectedSkills.length&&<p className="mt-3 text-sm text-muted">No skills selected yet.</p>}
       <div className="mt-3 flex flex-wrap gap-2">{selectedSkills.map(code=>{
         const entry=catalog.find(x=>x.code===code);
         return <span key={code} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-panel px-2 py-1 text-xs">
           <span className="min-w-0 break-words">{entry?.name||code} <span className="font-mono text-muted">({code})</span></span>
           <button type="button" aria-label={`Remove ${entry?.name||code}`} disabled={busy}
             onClick={()=>setSelectedSkills(v=>v.filter(x=>x!==code))}
             className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted"><X className="h-4 w-4"/></button>
         </span>;
       })}</div>
     </div>
     {!managerAssigned&&<p className="mt-2 text-sm text-amber-600">An immediate manager must be configured in Organization Structure before a proposal can be submitted.</p>}
     <button type="button" className={'mt-3 '+button} disabled={!selectedSkills.length||busy||!managerAssigned}
       onClick={()=>void submitSelected()}><Plus className="mr-1 inline h-4 w-4"/>Submit {selectedSkills.length} skill(s) for manager confirmation</button>
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
 const [bulkCreating,setBulkCreating]=useState(false);
 const [bulkCategory,setBulkCategory]=useState(''),[bulkSubcategory,setBulkSubcategory]=useState('');
 const [bulkRows,setBulkRows]=useState<Array<{name:string;description:string}>>([{name:'',description:''}]);
 const [name,setName]=useState(''),[category,setCategory]=useState(''),[subcategory,setSubcategory]=useState(''),[description,setDescription]=useState(''),[enabled,setEnabled]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [note,setNote]=useState('');
 const load=async()=>{
   setCatalogLoading(true);setError('');
   try{
     const [c,p,i]=await Promise.allSettled([
       callBackend<{skills:Skill[];canManage:boolean}>('/api/org/hr/skills/catalog'),
       callBackend<{employees:Peer[]}>('/api/org/hr/skills/peers'),
       callBackend<{items:Approval[]}>('/api/org/hr/skills/inbox'),
     ]);
     if(c.status==='rejected')throw c.reason;
     setCatalog(c.value.skills);setCanManage(c.value.canManage);
     if(p.status==='fulfilled')setPeers(p.value.employees);
     if(i.status==='fulfilled')setInbox(i.value.items);
   }catch(e){setError(e instanceof Error?e.message:'HR skills unavailable.')}
   finally{setCatalogLoading(false)}
 };
 useEffect(()=>{void load()},[]);
 useEffect(()=>{
   if(tab==='catalog'&&creating)document.getElementById('hr-skill-editor')?.scrollIntoView({behavior:'smooth',block:'start'});
 },[creating,tab]);
 const begin=(s?:Skill)=>{setEdit(s||null);setCreating(true);setName(s?.name||'');setCategory(s?.category||'');setSubcategory(s?.subcategory||'');setDescription(s?.description||'');setEnabled(s?.enabled!==false);setError('');setNotice('')};
 const save=async()=>{
   setBusy(true);setError('');setNotice('');
   try{
     await callBackend('/api/org/hr/skills/catalog/save',{code:edit?.code||'',name,category,subcategory,description,enabled});
     setCreating(false);setNotice('HR skill catalogue updated.');await load();
   }catch(e){setError(e instanceof Error?e.message:'Skill could not be saved.')}finally{setBusy(false)}
 };
 const saveBulk=async()=>{
   if(!bulkCategory.trim()||!bulkSubcategory.trim()||!bulkRows.every(x=>x.name.trim())||busy)return;
   setBusy(true);setError('');setNotice('');
   try{
     const result=await callBackend<{createdCount:number;skippedCount:number}>('/api/org/hr/skills/catalog/save/bulk',{
       category:bulkCategory,subcategory:bulkSubcategory,items:bulkRows,
     });
     setNotice(`${result.createdCount} skill(s) created.${result.skippedCount?' '+result.skippedCount+' already in the HR catalogue.':''}`);
     setBulkCreating(false);setBulkRows([{name:'',description:''}]);await load();
   }catch(e){setError(e instanceof Error?e.message:'Could not add the selected skills.')}
   finally{setBusy(false)}
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
     {canManage&&<div className="flex flex-wrap gap-2">
       <button type="button" onClick={()=>{setBulkCreating(false);begin()}} className={button}><Plus className="mr-1 inline h-4 w-4"/>Add skill</button>
       <button type="button" onClick={()=>{setCreating(false);setBulkCreating(true)}} className="min-h-11 rounded-xl border border-line bg-panel px-4 text-sm font-semibold text-brand"><Plus className="mr-1 inline h-4 w-4"/>Add multiple skills</button>
     </div>}
     {canManage&&bulkCreating&&<section className={panel}>
       <h3 className="mb-3 font-bold">Add multiple HR skills (up to 25)</h3>
       <HrSkillCategoryFields idPrefix="hr-bulk-skill-master" skills={catalog}
         category={bulkCategory} subcategory={bulkSubcategory} allowCreate
         onCategory={v=>{setBulkCategory(v);setBulkSubcategory('')}} onSubcategory={setBulkSubcategory}/>
       <div className="mt-4 space-y-3">{bulkRows.map((row,index)=><div key={index} className="rounded-xl border border-line bg-page p-3">
         <div className="mb-2 flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">Skill {index+1}</h4>
         <button type="button" disabled={bulkRows.length===1||busy}
           className="min-h-11 rounded-lg border border-line px-3 text-xs disabled:opacity-40"
           onClick={()=>setBulkRows(rows=>rows.filter((_,i)=>i!==index))}>Remove</button></div>
         <label className="block text-sm text-muted">Skill name<input className={field} maxLength={160}
           value={row.name} onChange={e=>setBulkRows(rows=>rows.map((x,i)=>i===index?{...x,name:e.target.value}:x))}/></label>
         <label className="mt-2 block text-sm text-muted">Description<textarea className={field+' min-h-20 p-3'}
           maxLength={600} value={row.description}
           onChange={e=>setBulkRows(rows=>rows.map((x,i)=>i===index?{...x,description:e.target.value}:x))}/></label>
       </div>)}</div>
       <button type="button" disabled={bulkRows.length>=25||busy}
         onClick={()=>setBulkRows(rows=>[...rows,{name:'',description:''}])}
         className="mt-3 min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-brand disabled:opacity-40"><Plus className="mr-1 inline h-4 w-4"/>Add another skill</button>
       <div className="mt-4 flex flex-wrap gap-2">
         <button type="button" onClick={()=>setBulkCreating(false)} className="min-h-11 rounded-xl border border-line px-4">Cancel</button>
         <button type="button" onClick={()=>void saveBulk()}
           disabled={busy||!bulkCategory.trim()||!bulkSubcategory.trim()||!bulkRows.every(row=>row.name.trim())}
           className={button}>Save {bulkRows.length} skills</button>
       </div>
     </section>}
     {creating&&<div id="hr-skill-editor" className={panel}>
       <h3 className="mb-3 font-bold">{edit?'Update skill':'Add HR skill'}</h3>
       <div className="grid gap-3 sm:grid-cols-2">
         <label className="block text-sm text-muted">Skill name
           <input className={field} required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/>
         </label>
         <label className="block text-sm text-muted">Description
           <textarea className={field+' min-h-24 p-3'} maxLength={600} value={description} onChange={e=>setDescription(e.target.value)}/>
         </label>
         <div className="sm:col-span-2">
           <HrSkillCategoryFields key={edit?.code||'new-skill'} idPrefix="hr-skill-editor"
             skills={catalog} category={category} subcategory={subcategory}
             onCategory={v=>{setCategory(v);setSubcategory('')}}
             onSubcategory={setSubcategory} allowCreate/>
         </div>
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
       <div className="mt-2 flex flex-wrap items-center gap-2">
         {p.requiredForRole&&<span className="rounded-lg bg-brand/10 px-2 py-1 text-xs font-bold text-brand">Required for role</span>}
         <span className="rounded-lg border border-line px-2 py-1 text-xs">Current confirmed fit: {p.roleFit===null?'Not configured':p.roleFit+'%'}</span>
       </div>
       <p className="mt-1 text-xs text-muted">Proposed by {p.proposerName||'colleague'} · {p.endorsements} endorsements</p>
       <label className="mt-3 block text-sm text-muted">Review note<input className={field} value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason or confirmation note" maxLength={400}/></label>
       <div className="mt-3 flex gap-2"><button type="button" disabled={busy||note.trim().length<5} onClick={()=>void decide(p.id,'reject')} className="flex min-h-11 items-center gap-1 rounded-xl border border-line px-3 text-sm"><X className="h-4 w-4"/>Decline</button><button type="button" disabled={busy||p.proposedBy===ownUid} onClick={()=>void decide(p.id,'approve')} className={button}><Check className="mr-1 inline h-4 w-4"/>Confirm</button></div>
     </div>)}
   </div>}
   <div className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4"/>Skill confirmations are retained with proposer, endorsers and immediate manager decision.</div>
 </div>;
}
