import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {useLoad} from '../admin/kit';

type ApprovedFile={fileId:string;name:string;mime:string;bytes:number};
type Listing={documentId:string;revisionId:string;files:ApprovedFile[]};

/** User-triggered signed URLs are never retained in Firestore, logs, or a client cache. */
export default function EffectiveDocumentFiles({documentId}:{documentId:string}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const {data,loading}=useLoad(()=>open?callBackend<Listing>('/api/org/drkms/documents/effective-files',{documentId}):Promise.resolve(null),[documentId,open]);
 const download=async(fileId:string)=>{
  setBusy(fileId);setError('');
  try{
   const result=await callBackend<{url:string}>('/api/org/drkms/documents/revision-download',{
    documentId,revisionId:data?.revisionId,fileId,
   });
   if(!result.url.startsWith('https://'))throw new Error('A secure download address could not be generated.');
   window.location.assign(result.url);
  }catch(e){setError(e instanceof Error?e.message:'Download is unavailable.');}
  finally{setBusy('');}
 };
 return <div className='mt-2 space-y-2'>
  <button type='button' className='min-h-10 rounded-lg border border-blue-500 px-3 text-xs text-blue-200' onClick={()=>setOpen(!open)}>{open?'Hide approved files':'View approved files'}</button>
  {open&&<>
   {loading&&<p className='text-xs text-slate-400'>Checking approved revision…</p>}
   {!loading&&!data?.files.length&&<p className='text-xs text-slate-400'>No downloadable approved revision files are available.</p>}
   {data?.files.map(f=><div key={f.fileId} className='flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 p-2'>
    <p className='min-w-0 break-all text-xs text-slate-200'>{f.name} · {Math.round(f.bytes/1024)} KB</p>
    <button type='button' disabled={!!busy} className='min-h-10 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white disabled:opacity-50' onClick={()=>void download(f.fileId)}>{busy===f.fileId?'Opening…':'Open securely'}</button>
   </div>)}
   {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
  </>}
 </div>;
}
