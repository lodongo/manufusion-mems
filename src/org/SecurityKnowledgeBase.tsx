import { useState } from 'react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';

type Section={id:string;heading:string;markdown:string};
type Doc={id:string;title:string;category:string;status:string;version:number;sections:Section[];publishedAt:string};
type Snapshot={capturedAt:string;roles:Array<{id:string;name:string;permissions:string[]}>;positions:Array<{id:string;title:string;securityRoles:string[]}>};
export default function SecurityKnowledgeBase({canInspect=false}:{canInspect?:boolean}) {
  const {data,error,loading}=useLoad(()=>callBackend<{documents:Doc[]}>('/api/org/security-docs/list'));
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string>('');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [failure,setFailure]=useState('');
  const [working,setWorking]=useState(false);
  const docs=(data?.documents||[]).filter(d=>!search||[d.title,...(d.sections||[]).flatMap(s=>[s.heading,s.markdown])].join(' ').toLowerCase().includes(search.toLowerCase()));
  const doc=docs.find(d=>d.id===selected)||docs[0];
  const loadSnapshot=async()=>{
    setWorking(true);setFailure('');
    try{setSnapshot(await callBackend<Snapshot>('/api/org/security-docs/configuration'));}
    catch(e){setFailure(e instanceof Error?e.message:String(e));}finally{setWorking(false);}
  };
  return <main className='mx-auto max-w-6xl space-y-4 p-4 text-ink'>
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <div><h1 className='text-2xl font-semibold'>Roles and security documentation</h1><p className='text-sm text-muted'>Published, versioned security rules and organizational guidance</p></div>
      <Button variant='secondary' onClick={()=>window.print()}>Print / save PDF</Button>
    </div>
    {error&&<Alert tone='error'>{error}</Alert>}{failure&&<Alert tone='error'>{failure}</Alert>}
    <label className='block text-sm'>Search documents and sections<input type='search' value={search} onChange={e=>setSearch(e.target.value)} className='mt-1 w-full rounded-lg border border-line bg-panel p-3 text-ink' placeholder='Find a module, responsibility, role or permission'/></label>
    {loading&&!data?<Spinner/>:<div className='grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]'>
      <aside className='space-y-2 rounded-xl border border-line p-3'>
        <h2 className='font-semibold'>Contents</h2>
        {docs.map(d=><div key={d.id}>
          <button className={'w-full rounded-lg p-2 text-left text-sm '+(doc?.id===d.id?'bg-panel font-semibold':'')} onClick={()=>setSelected(d.id)}>{d.title}<span className='block text-xs text-muted'>Version {d.version}</span></button>
          {doc?.id===d.id&&(d.sections||[]).map(s=><a key={s.id} className='block px-3 py-1 text-xs text-muted underline-offset-2 hover:underline' href={'#doc-section-'+s.id}>{s.heading}</a>)}
        </div>)}
        {!docs.length&&<p className='text-sm text-muted'>No published documentation matches your search. MEMS Admin can publish reviewed manuals.</p>}
      </aside>
      <article className='min-w-0 space-y-5 rounded-xl border border-line p-4'>
        {doc?<><header><h2 className='text-xl font-semibold'>{doc.title}</h2><p className='text-xs text-muted'>Published revision {doc.version} · {doc.publishedAt?.slice(0,10)}</p></header>
          {doc.sections?.map(s=><section id={'doc-section-'+s.id} key={s.id} className='scroll-mt-6 space-y-2 border-t border-line pt-4'>
            <h3 className='font-semibold'>{s.heading}</h3>
            <div className='whitespace-pre-wrap break-words text-sm leading-7'>{s.markdown}</div>
          </section>)}
          </>:<p className='text-sm text-muted'>Select a published document to read its rules.</p>}
      </article>
    </div>}
    {canInspect&&<section className='rounded-xl border border-line p-4'>
      <h2 className='font-semibold'>Current organization security configuration</h2>
      <p className='mb-3 text-sm text-muted'>Live tenant-scoped role-to-permission information. This is a configuration preview, not a published document or approval.</p>
      <Button variant='secondary' disabled={working} onClick={loadSnapshot}>{working?'Loading…':'View current configuration'}</Button>
      {snapshot&&<div className='mt-4 space-y-4'>
        <p className='text-xs text-muted'>Captured: {snapshot.capturedAt}</p>
        <div className='overflow-x-auto'><table className='w-full min-w-[400px] text-left text-sm'><thead><tr><th className='p-2'>Security role</th><th className='p-2'>Permissions</th></tr></thead><tbody>{snapshot.roles.map(r=><tr key={r.id} className='border-t border-line'><td className='p-2'>{r.name}</td><td className='break-words p-2'>{r.permissions.join(', ')||'Self-service baseline only'}</td></tr>)}</tbody></table></div>
        <h3 className='font-semibold'>User role assignments</h3>
        <div className='overflow-x-auto'><table className='w-full min-w-[400px] text-left text-sm'><tbody>{snapshot.positions.map(p=><tr key={p.id} className='border-t border-line'><td className='p-2'>{p.title}</td><td className='p-2'>{p.securityRoles.join(', ')}</td></tr>)}</tbody></table></div>
      </div>}
    </section>}
  </main>;
}
