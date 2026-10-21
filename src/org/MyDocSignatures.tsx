import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,PageTitle,useLoad} from '../admin/kit';
type Assignment={documentId:string;slotId:string;label:string;title:string;documentStatus:string;signatureStatus:string;signedAt:string};
export default function MyDocSignatures(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<{assignments:Assignment[]}>('/api/org/drkms/signatures/my-inbox',{}),[]);
 const [busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const [previews,setPreviews]=useState<Record<string,Array<{fileId:string;name:string;url:string}>>>({});
 const preview=async(row:Assignment)=>{setBusy(row.slotId+'-preview');setNotice('');
  try{const result=await callBackend<{files:Array<{fileId:string;name:string;url:string}>}>('/api/org/drkms/signatures/preview',{documentId:row.documentId,slotId:row.slotId});
   setPreviews(prev=>({...prev,[row.slotId]:result.files}));
  }catch(e){setNotice(e instanceof Error?e.message:'Source preview is unavailable.');}
  finally{setBusy('')}
 };
 const sign=async(row:Assignment)=>{setBusy(row.slotId);setNotice('');
  try{await callBackend('/api/org/drkms/signatures/sign',{documentId:row.documentId,slotId:row.slotId,attest:true});
   setNotice('Authenticated signature completed. The document still requires all configured approvals.');reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Signature could not be recorded.');}finally{setBusy('')}
 };
 return <div className='space-y-3'>
  <PageTitle title='My document signatures' subtitle='Assigned electronic sign-offs in Documentation & Records'/>
  <Card><p className='text-sm text-slate-300'>Review the originating document before signing. Your authenticated electronic attestation is bound to the independently verified document version; it cannot replace technical review or CoA.</p></Card>
  {loading&&<p className='text-sm text-slate-400'>Loading assigned documents…</p>}
  {error&&<p role='alert' className='text-sm text-red-300'>{error}</p>}
  {!loading&&!data?.assignments.length&&<Card><p className='text-sm text-slate-300'>No document signatures assigned to you.</p></Card>}
  {(data?.assignments??[]).map(item=><Card key={item.slotId}>
   <h2 className='break-words font-semibold text-white'>{item.title}</h2>
   <p className='break-all text-xs text-slate-400'>{item.documentId} · {item.label}</p>
   <p className='text-sm text-slate-200'>Document: {item.documentStatus} · Sign-off: {item.signatureStatus}</p>
   {item.signedAt&&<p className='text-xs text-slate-400'>Signed {item.signedAt}</p>}
   {item.signatureStatus==='pending'&&item.documentStatus==='technical_verified'&&<button type='button' disabled={!!busy} onClick={()=>void preview(item)} className='mt-2 min-h-11 w-full rounded-lg border border-slate-600 px-3 text-sm text-slate-200'>Review verified document before signing</button>}
   {previews[item.slotId]?.map(file=><a key={file.fileId} href={file.url} target='_blank' rel='noopener noreferrer' className='block break-words rounded-lg border border-blue-700 p-3 text-sm text-blue-300'>Open verified source: {file.name}</a>)}
   {item.signatureStatus==='pending'&&<button type='button' disabled={!!busy||item.documentStatus!=='technical_verified'} onClick={()=>void sign(item)} className='mt-2 min-h-11 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50'>{busy===item.slotId?'Signing…':'Confirm my authenticated signature'}</button>}
   {item.documentStatus!=='technical_verified'&&item.signatureStatus==='pending'&&<p className='text-xs text-slate-400'>Available after independent technical verification.</p>}
  </Card>)}
  {notice&&<p role='status' className='text-sm text-slate-200'>{notice}</p>}
 </div>;
}
