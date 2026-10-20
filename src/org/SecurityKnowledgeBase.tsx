import { useState } from 'react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';

type Section={id:string;heading:string;markdown:string};
type Doc={id:string;title:string;category:string;status:string;version:number;sections:Section[];publishedAt:string};
type Snapshot={capturedAt:string;roles:Array<{id:string;name:string;permissions:string[]}>;positions:Array<{id:string;title:string;securityRoles:string[]}>};
type SnapshotRole=Snapshot['roles'][number];
type SnapshotPosition=Snapshot['positions'][number];
const roleColumns:Array<Column<SnapshotRole>>=[
  {key:'name',label:'Security role',value:(r)=>r.name},
  {key:'count',label:'Permissions',type:'number',value:(r)=>r.permissions.length},
  {key:'permissions',label:'Permission codes',value:(r)=>r.permissions.join(', ')||'Self-service baseline only',
    render:(r)=><span className='block max-w-[20rem] whitespace-normal break-words'>{r.permissions.join(', ')||'Self-service baseline only'}</span>},
];
const assignmentColumns:Array<Column<SnapshotPosition>>=[
  {key:'title',label:'Job role',value:(p)=>p.title},
  {key:'roles',label:'Security roles',value:(p)=>p.securityRoles.join(', '),
    render:(p)=><span className='block max-w-[20rem] whitespace-normal break-words'>{p.securityRoles.join(', ')||'None'}</span>},
];
export default function SecurityKnowledgeBase({canInspect=false}:{canInspect?:boolean}) {
  const {data,error,loading}=useLoad(()=>callBackend<{documents:Doc[]}>('/api/org/security-docs/list'));
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<string>('');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [failure,setFailure]=useState('');
  const [working,setWorking]=useState(false);
  const [signedCopies,setSignedCopies]=useState<Array<{id:string;documentId:string;version:number;filename:string;uploadedAt:string}>>([]);
  const [signoffMessage,setSignoffMessage]=useState('');
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
    {canInspect&&doc&&<section className='space-y-3 rounded-xl border border-line p-4'>
      <h2 className='font-semibold'>Physical approval and signed copies</h2>
      <p className='text-sm text-muted'>Print the immutable published revision above, collect authorized signatures, and attach the scanned copy to this exact document version. Supported: PDF, JPEG or PNG up to 8 MB.</p>
      <input type='file' accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png' disabled={working} onChange={async e=>{
        const file=e.target.files?.[0];
        if(!file)return;
        if(file.size>8_000_000){setSignoffMessage('Files must be 8 MB or smaller.');return;}
        setWorking(true);setSignoffMessage('');
        try{
          const base64=await new Promise<string>((resolve,reject)=>{
            const reader=new FileReader();
            reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
            reader.onerror=()=>reject(new Error('Unable to read file.'));
            reader.readAsDataURL(file);
          });
          await callBackend('/api/org/security-docs/signoff/upload',{id:doc.id,content:base64,mime:file.type,filename:file.name});
          setSignoffMessage('Signed copy attached to the published revision.');
        }catch(err){setSignoffMessage(err instanceof Error?err.message:'Upload failed.');}
        finally{setWorking(false);}
      }}/>
      <Button variant='secondary' disabled={working} onClick={async()=>{
        setWorking(true);try{
          const r=await callBackend<{signoffs:typeof signedCopies}>('/api/org/security-docs/signoff/list');
          setSignedCopies(r.signoffs.filter(x=>x.documentId===doc.id));
        }catch(err){setSignoffMessage(err instanceof Error?err.message:'Could not load files.');}
        finally{setWorking(false);}
      }}>View signed copies</Button>
      {signoffMessage&&<p className='text-sm'>{signoffMessage}</p>}
      {signedCopies.map(x=><button key={x.id} type='button' className='block text-left text-sm underline' onClick={async()=>{
        try{const r=await callBackend<{url:string}>('/api/org/security-docs/signoff/open',{id:x.id});window.open(r.url,'_blank','noopener,noreferrer');}
        catch(err){setSignoffMessage(err instanceof Error?err.message:'Unable to open signed copy.');}
      }}>{x.filename||'Signed document'} · v{x.version} · {x.uploadedAt.slice(0,10)}</button>)}
    </section>}
    {canInspect&&<section className='rounded-xl border border-line p-4'>
      <h2 className='font-semibold'>Current organization security configuration</h2>
      <p className='mb-3 text-sm text-muted'>Live tenant-scoped role-to-permission information. This is a configuration preview, not a published document or approval.</p>
      <Button variant='secondary' disabled={working} onClick={loadSnapshot}>{working?'Loading…':'View current configuration'}</Button>
      {snapshot&&<div className='mt-4 space-y-4'>
        <p className='text-xs text-muted'>Captured: {snapshot.capturedAt}</p>
        <RichTable id='security-config-roles' title='Security roles' fileName='security_roles_snapshot' height='h-[28rem]'
          columns={roleColumns} rows={snapshot.roles} rowKey={(r)=>r.id} empty='No security roles configured.' />
        <RichTable id='security-config-assignments' title='User role assignments' fileName='security_role_assignments_snapshot' height='h-[28rem]'
          columns={assignmentColumns} rows={snapshot.positions} rowKey={(p)=>p.id} empty='No role assignments yet.' />
      </div>}
    </section>}
  </main>;
}
