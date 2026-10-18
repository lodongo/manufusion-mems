import { useState } from 'react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Spinner, useLoad } from './kit';

type Section = {id:string;heading:string;markdown:string};
type Document = {id:string;title:string;category:string;status:string;version:number;sections:Section[];publishedAt:string};
export default function SecurityDocumentationAdmin() {
  const {data,error,loading,reload} = useLoad(()=>callBackend<{documents:Document[]}>('/api/admin/security-docs/list'));
  const [selected,setSelected] = useState<Document|null>(null);
  const [title,setTitle] = useState('MEMS User Roles and Security Management');
  const [sections,setSections] = useState<Section[]>([{id:'overview',heading:'Overview',markdown:''}]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [failure,setFailure] = useState('');
  const work = async (fn:()=>Promise<void>)=>{
    setBusy(true);setFailure('');setMessage('');
    try{await fn();reload();}catch(e){setFailure(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const open=(doc:Document)=>{
    setSelected(doc);setTitle(doc.title);setSections(doc.sections?.map(s=>({...s}))||[]);
  };
  return <main className='mx-auto max-w-5xl space-y-4 p-4 text-ink'>
    <header><h1 className='text-2xl font-semibold'>Security documentation management</h1>
      <p className='text-sm text-muted'>Maintain reviewed versions. Only published documents become visible to organizations.</p></header>
    {error&&<Alert tone='error'>{error}</Alert>}
    {failure&&<Alert tone='error'>{failure}</Alert>}
    {message&&<Alert tone='success'>{message}</Alert>}
    {loading&&!data?<Spinner/>: <section className='rounded-xl border border-line p-3'>
      <h2 className='font-semibold'>Revisions</h2>
      <div className='mt-2 flex flex-wrap gap-2'>
        <Button variant='secondary' onClick={()=>{setSelected(null);setTitle('MEMS User Roles and Security Management');setSections([{id:'overview',heading:'Overview',markdown:''}]);}}>New draft</Button>
        <Button variant='secondary' disabled={busy} onClick={()=>work(async()=>{const r=await callBackend<{sections:Section[]}>('/api/admin/security-docs/standard-preview');setSections(r.sections);setMessage('Loaded current curated rules. Review and save this draft before publishing.');})}>Load standard security rules</Button>
      </div>
      <div className='mt-3 grid gap-2 sm:grid-cols-2'>{data?.documents.map(d=><button key={d.id} onClick={()=>open(d)} className='rounded-xl border border-line p-3 text-left hover:bg-panel'>
        <span className='block font-medium'>{d.title}</span><span className='text-xs text-muted'>v{d.version} · {d.status}{d.publishedAt?' · '+d.publishedAt.slice(0,10):''}</span>
      </button>)}</div>
    </section>}
    <section className='space-y-3 rounded-xl border border-line p-4'>
      <label className='block text-sm font-medium'>Document title
        <input className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' value={title} onChange={e=>setTitle(e.target.value)} disabled={selected?.status==='published'}/>
      </label>
      {sections.map((section,i)=><div key={section.id+'-'+i} className='rounded-xl border border-line p-3'>
        <label className='block text-sm'>Section heading<input className='mt-1 w-full rounded-lg border border-line bg-panel p-2 text-ink' value={section.heading} disabled={selected?.status==='published'} onChange={e=>setSections(v=>v.map((x,j)=>i===j?{...x,heading:e.target.value}:x))}/></label>
        <label className='mt-2 block text-sm'>Content<textarea rows={5} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' value={section.markdown} disabled={selected?.status==='published'} onChange={e=>setSections(v=>v.map((x,j)=>i===j?{...x,markdown:e.target.value}:x))}/></label>
        {selected?.status!=='published'&&<button className='text-sm text-muted underline' onClick={()=>setSections(v=>v.filter((_,j)=>i!==j))}>Remove section</button>}
      </div>)}
      {selected?.status!=='published'&&<div className='flex flex-wrap gap-2'>
        <Button variant='secondary' onClick={()=>setSections(v=>[...v,{id:'section-'+(v.length+1),heading:'New section',markdown:''}])}>Add section</Button>
        <Button disabled={busy||!title.trim()||!sections.length} onClick={()=>work(async()=>{const r=await callBackend<{id:string}>('/api/admin/security-docs/save',{id:selected?.id,title,category:'security',sections});setSelected({id:r.id,title,category:'security',status:'draft',version:selected?.version||1,sections,publishedAt:''});setMessage('Draft saved.');})}>Save draft</Button>
      </div>}
      {selected?.status==='published'&&<Button disabled={busy} onClick={()=>work(async()=>{const r=await callBackend<{id:string}>('/api/admin/security-docs/revise',{id:selected.id});setSelected({...selected,id:r.id,status:'draft',version:selected.version+1,publishedAt:''});setMessage('New editable draft version created.');})}>Create new revision</Button>}
      {selected?.status==='draft'&&<Button variant='secondary' disabled={busy} onClick={()=>work(async()=>{await callBackend('/api/admin/security-docs/approve',{id:selected.id});setSelected({...selected,status:'approved'});setMessage('Approved by an independent super admin.');})}>Approve (independent super admin)</Button>}
      {selected?.status==='approved'&&<Button disabled={busy} onClick={()=>work(async()=>{await callBackend('/api/admin/security-docs/publish',{id:selected.id});setSelected({...selected,status:'published'});setMessage('Published to organization documentation library.');})}>Publish approved version</Button>}
    </section>
  </main>;
}
