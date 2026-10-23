import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Save, LockKeyhole } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { SelectField } from '../components/ui';

type Education={id:string;institution:string;qualification:string;field:string;completionYear:string};
type Family={id:string;name:string;relationship:string;phone:string};
type Kind='education'|'family';
const input='h-11 w-full rounded-xl border border-line bg-page px-3 text-base text-ink';
const btn='flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold';
export default function HrSelfRecords({kind,employeeUid,readOnly=false}:{kind:Kind;employeeUid:string;readOnly?:boolean}){
 const [items,setItems]=useState<Array<Education|Family>>([]);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editing,setEditing]=useState<number|null>(null);
 const [draft,setDraft]=useState<Record<string,string>>({});
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
   setDraft(idx<0 ? kind==='education'?{id:'',institution:'',qualification:'',field:'',completionYear:''}:{id:'',name:'',relationship:'',phone:''}: {...items[idx]} as Record<string,string>);
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
  <div className="flex items-center justify-between gap-2"><div><h3 className="font-bold">{label} records</h3><p className="text-xs text-muted">Private · authorized employee or super administrator</p></div>{!readOnly&&<button type="button" onClick={()=>begin(-1)} className={btn+' bg-brand text-onbrand'}><Plus className="h-4 w-4"/>Add</button>}</div>
  {loading&&<p className="text-sm text-muted">Loading records…</p>}
  {!loading&&!items.length&&<div className="rounded-2xl border border-dashed border-line bg-panel p-5 text-center text-sm text-muted">No {label.toLowerCase()} records saved.</div>}
  <div className="space-y-2">{items.map((item,idx)=><article key={item.id||idx} className="flex items-start gap-2 rounded-2xl border border-line bg-panel p-3">
   <div className="min-w-0 flex-1"><h4 className="font-semibold">{kind==='education'?(item as Education).qualification:(item as Family).name}</h4><p className="mt-1 text-xs text-muted">{kind==='education'?[(item as Education).institution,(item as Education).field,(item as Education).completionYear].filter(Boolean).join(' · '):[(item as Family).relationship,(item as Family).phone].filter(Boolean).join(' · ')}</p></div>
   {!readOnly&&<button type="button" aria-label="Edit record" onClick={()=>begin(idx)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line"><Pencil className="h-4 w-4"/></button>
   <button type="button" aria-label="Delete record" disabled={busy} onClick={()=>remove(idx)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-red-500"><Trash2 className="h-4 w-4"/></button>}
  </article>)}</div>
  {editing!==null&&<div className="rounded-2xl border border-line bg-panel p-4">
   <h3 className="mb-3 font-bold">{editing===-1?'Add':'Update'} {label.toLowerCase()} record</h3>
   {kind==='education'?<div className="grid gap-3 sm:grid-cols-2">
     {([['institution','Institution'],['qualification','Qualification'],['field','Field of study'],['completionYear','Completion year']] as const).map(([key,title])=><label key={key} className="block text-sm text-muted">{title}<input className={input} type={key==='completionYear'?'number':'text'} maxLength={key==='completionYear'?4:160} value={draft[key]||''} onChange={e=>setDraft(v=>({...v,[key]:e.target.value}))}/></label>)}
   </div>:<div className="grid gap-3 sm:grid-cols-2">
     <label className="block text-sm text-muted">Name<input className={input} maxLength={140} value={draft.name||''} onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
     <SelectField id="employee-family-relationship" label="Relationship" value={draft.relationship||''} onChange={e=>setDraft(v=>({...v,relationship:e.target.value}))}>
       <option value="">Choose relationship</option>{['Spouse','Child','Parent','Sibling','Partner','Guardian','Other'].map(x=><option key={x} value={x}>{x}</option>)}
     </SelectField>
     <label className="block text-sm text-muted">Contact number (optional)<input className={input} maxLength={32} value={draft.phone||''} onChange={e=>setDraft(v=>({...v,phone:e.target.value}))}/></label>
   </div>}
   <div className="mt-4 flex gap-2"><button type="button" onClick={()=>setEditing(null)} className={btn+' border border-line'}><X className="h-4 w-4"/>Cancel</button><button type="button" disabled={busy||(kind==='education'?(!draft.institution?.trim()||!draft.qualification?.trim()):(!draft.name?.trim()||!draft.relationship?.trim()))} onClick={submit} className={btn+' bg-brand text-onbrand disabled:opacity-40'}><Save className="h-4 w-4"/>Save</button></div>
  </div>}
  {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
  {notice&&<p role="status" className="text-sm text-brand">{notice}</p>}
  <p className="flex items-center gap-2 text-xs text-muted"><LockKeyhole className="h-4 w-4"/>These records are restricted to the employee and organization super administrator. A Super Administrator may not change their own HR records.</p>
 </section>;
}
