import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Save, LockKeyhole } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { SelectField } from '../components/ui';
import HrEducationRecords from './HrEducationRecords';

type Education={id:string;institution:string;qualification:string;field:string;completionYear:string;levelCode:string;qualificationCode:string;gradingSystemCode:string;gradeCode:string};
type EducationConfig={levels:Array<{code:string;name:string;enabled:boolean;rank:number}>;qualifications:Array<{code:string;levelCode:string;name:string;enabled:boolean}>};
type Family={id:string;name:string;relationship:string;phone:string};
type Kind='education'|'family';
const input='h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold';
export default function HrSelfRecords(props:{kind:Kind;employeeUid:string;readOnly?:boolean;onEducationChange?:(qualification:string)=>void}){
 return props.kind==='education'
  ?<HrEducationRecords employeeUid={props.employeeUid} readOnly={props.readOnly} onEducationChange={props.onEducationChange}/>
  :<HrFamilyRecords employeeUid={props.employeeUid} readOnly={props.readOnly}/>;
}
function HrFamilyRecords({employeeUid,readOnly=false,kind='family'}:{employeeUid:string;readOnly?:boolean;kind?:Kind}){
 const [items,setItems]=useState<Array<Education|Family>>([]);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editing,setEditing]=useState<number|null>(null);
 const [draft,setDraft]=useState<Record<string,string>>({});
 const [eduConfig,setEduConfig]=useState<EducationConfig|null>(null);
 const [legalEntityName,setLegalEntityName]=useState('');
 useEffect(()=>{
   if(kind!=='education')return;
   let alive=true;
   setEduConfig(null);setLegalEntityName('');
   void callBackend<{entity:{id:string;name:string}|null;config:EducationConfig|null}>('/api/org/hr/education/config',{uid:employeeUid})
     .then(result=>{if(alive){setEduConfig(result.config);setLegalEntityName(result.entity?.name||'')}})
     .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Education configuration unavailable.')});
   return()=>{alive=false};
 },[kind,employeeUid]);
 useEffect(()=>{
   let alive=true;setLoading(true);setError('');
   callBackend<{education:Education[];family:Family[]}>('/api/org/hr/private/get',{uid:employeeUid})
    .then(data=>{if(alive)setItems(data[kind])})
    .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Unable to read private records.')})
    .finally(()=>{if(alive)setLoading(false)});
   return()=>{alive=false};
 },[kind,employeeUid]);
 const begin=(idx:number)=>{
   setEditing(idx);
   setDraft(idx<0 ? kind==='education'?{id:'',institution:'',qualification:'',field:'',completionYear:'',levelCode:'',qualificationCode:'',gradingSystemCode:'',gradeCode:''}:{id:'',name:'',relationship:'',phone:''}: {...items[idx]} as Record<string,string>);
   setError('');setNotice('');
 };
 const save=async(next:Array<Education|Family>)=>{
   setBusy(true);setError('');setNotice('');
   try{
     const result=await callBackend<{items:Array<Education|Family>}>('/api/org/hr/private/save',{uid:employeeUid,kind,items:next});
     setItems(result.items);setEditing(null);setNotice('Your records were saved.');
   }catch(e){setError(e instanceof Error?e.message:'Save failed.')}finally{setBusy(false)}
 };
 const remove=(idx:number)=>void save(items.filter((_,i)=>i!==idx));
 const submit=()=>{
   const item=draft as Education|Family;
   const next=editing===-1?[...items,item]:items.map((x,i)=>i===editing?item:x);
   void save(next);
 };
 const label=kind==='education'?'Education':'Family';
 return <section className="min-w-0 space-y-3">
  <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold">{label} records</h3><p className="text-xs text-muted">Private · authorized employee or super administrator</p></div>{!readOnly&&<button type="button" disabled={kind==='education'&&!eduConfig} onClick={()=>begin(-1)} className={btn+' bg-brand text-onbrand disabled:opacity-40'}><Plus className="h-4 w-4"/>Add</button>}</div>
  {loading&&<p className="text-sm text-muted">Loading records…</p>}
  {!loading&&!items.length&&<div className="rounded-2xl border border-dashed border-line bg-panel p-5 text-center text-sm text-muted">No {label.toLowerCase()} records saved.</div>}
  <div className="space-y-2">{items.map((item,idx)=><article key={item.id||idx} className="flex items-start gap-2 rounded-2xl border border-line bg-panel p-3">
   <div className="min-w-0 flex-1"><h4 className="font-semibold">{kind==='education'?(item as Education).qualification:(item as Family).name}</h4><p className="mt-1 text-xs text-muted">{kind==='education'?[(item as Education).institution,(item as Education).field,(item as Education).completionYear].filter(Boolean).join(' · '):[(item as Family).relationship,(item as Family).phone].filter(Boolean).join(' · ')}</p></div>
   {!readOnly&&<><button type="button" aria-label="Edit record" onClick={()=>begin(idx)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line"><Pencil className="h-4 w-4"/></button>
   <button type="button" aria-label="Delete record" disabled={busy} onClick={()=>remove(idx)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-red-500"><Trash2 className="h-4 w-4"/></button></>}
  </article>)}</div>
  {editing!==null&&<div className="rounded-2xl border border-line bg-panel p-4">
   <h3 className="mb-3 font-bold">{editing===-1?'Add':'Update'} {label.toLowerCase()} record</h3>
   {kind==='education'?<div className="grid gap-3 sm:grid-cols-2">
     {!eduConfig&&<p role="alert" className="sm:col-span-2 rounded-xl border border-line p-3 text-sm text-amber-700">This employee has no unambiguous active primary assignment to a legal entity. Organization Admin must assign one before an education record can be saved.</p>}
     <div className="sm:col-span-2 rounded-lg bg-page p-3 text-xs text-muted">Legal entity: <strong>{legalEntityName||'Not assigned'}</strong>. Only education options from this employee's assigned legal entity are available. Education Rank is a qualification hierarchy, not a job grade.</div>
     <label className="block text-sm text-muted">Institution<input className={input} value={draft.institution||''} maxLength={160}
       onChange={e=>setDraft(v=>({...v,institution:e.target.value}))}/></label>
     <SelectField id="employee-education-level" label="Educational level" required
       value={draft.levelCode||''} onChange={e=>setDraft(v=>({...v,levelCode:e.target.value,qualificationCode:'',qualification:'',gradingSystemCode:'',gradeCode:''}))}>
       <option value="">Select educational level</option>
       {eduConfig?.levels.filter(x=>x.enabled||x.code===draft.levelCode).sort((a,b)=>a.rank-b.rank).map(x=><option key={x.code} value={x.code}>Rank {x.rank} · {x.name}</option>)}
     </SelectField>
     <SelectField id="employee-education-qualification" label="Qualification" required
       value={draft.qualificationCode||''} disabled={!draft.levelCode}
       onChange={e=>{
         const qual=eduConfig?.qualifications.find(q=>q.code===e.target.value);
         setDraft(v=>({...v,qualificationCode:e.target.value,qualification:qual?.name||''}));
       }}>
       <option value="">Select qualification</option>
       {eduConfig?.qualifications.filter(x=>x.levelCode===draft.levelCode&&(x.enabled||x.code===draft.qualificationCode))
        .map(x=><option key={x.code} value={x.code}>{x.name}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Field of study / specialization<input className={input} value={draft.field||''} maxLength={140}
       onChange={e=>setDraft(v=>({...v,field:e.target.value}))}/></label>
     <label className="block text-sm text-muted">Completion year<input className={input} type="number" min={1900} max={2100}
       value={draft.completionYear||''} onChange={e=>setDraft(v=>({...v,completionYear:e.target.value}))}/></label>
     {editing!==-1&&!draft.levelCode&&<p className="sm:col-span-2 text-xs text-amber-700">Legacy record: select the educational level and qualification to align it with the legal-entity master.</p>}
   </div>:<div className="grid gap-3 sm:grid-cols-2">
     <label className="block text-sm text-muted">Name<input className={input} maxLength={140} value={draft.name||''} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
     <SelectField id="employee-family-relationship" label="Relationship" value={draft.relationship||''} onChange={e=>setDraft(v=>({...v,relationship:e.target.value}))}>
       <option value="">Choose relationship</option>{['Spouse','Child','Parent','Sibling','Partner','Guardian','Other'].map(x=><option key={x} value={x}>{x}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Contact number (optional)<input className={input} maxLength={32} value={draft.phone||''} onChange={e=>setDraft(v=>({...v,phone:e.target.value}))}/></label>
   </div>}
   <div className="mt-4 flex gap-2"><button type="button" onClick={()=>setEditing(null)} className={btn+' border border-line'}><X className="h-4 w-4"/>Cancel</button><button type="button" disabled={busy||(kind==='education'?(!eduConfig||!draft.institution?.trim()||!draft.levelCode||!draft.qualificationCode):(!draft.name?.trim()||!draft.relationship?.trim()))} onClick={submit} className={btn+' bg-brand text-onbrand disabled:opacity-40'}><Save className="h-4 w-4"/>Save</button></div>
  </div>}
  {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
  {notice&&<p role="status" className="text-sm text-brand">{notice}</p>}
  <p className="flex items-center gap-2 text-xs text-muted"><LockKeyhole className="h-4 w-4"/>These private records are accessible to the employee and authorized Super Administrator. Both may update their own permitted self-service information.</p>
 </section>;
}
