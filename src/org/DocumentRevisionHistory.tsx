import {useState} from 'react';
import {callBackend} from '../lib/backend';
type Entry={revisionId:string;revision:string;status:string;publishedAt:string;fingerprint:string};
export default function DocumentRevisionHistory({documentId}:{documentId:string}){
 const [opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [result,setResult]=useState<{currentStatus:string;predecessorId:string;successorId:string;revisions:Entry[]}|null>(null);
 const load=async()=>{if(opened){setOpened(false);return;}setBusy(true);setError('');
  try{setResult(await callBackend('/api/org/drkms/documents/revision-history',{documentId}));setOpened(true);}
  catch(e){setError(e instanceof Error?e.message:'Could not load revision history.');}finally{setBusy(false);}
 };
 return <div className='mt-2 space-y-2'>
  <button type='button' onClick={()=>void load()} disabled={busy} className='min-h-10 rounded-lg border border-slate-600 px-3 text-xs text-slate-200'>{busy?'Loading…':opened?'Hide revision history':'Revision history'}</button>
  {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
  {opened&&result&&<div className='space-y-2 rounded-lg border border-slate-700 p-3'>
    {result.predecessorId&&<p className='break-all text-xs text-slate-300'>Predecessor: {result.predecessorId}</p>}
    {result.successorId&&<p className='break-all text-xs text-slate-300'>Successor: {result.successorId}</p>}
    {!result.revisions.length&&<p className='text-xs text-slate-400'>No published revisions yet.</p>}
    {result.revisions.map(r=><div className='rounded-md border border-slate-700 p-2' key={r.revisionId}>
      <p className='text-xs font-semibold text-white'>Revision {r.revision} · {r.status}</p>
      <p className='text-xs text-slate-300'>{r.publishedAt}</p>
      <p className='break-all text-xs text-slate-400'>SHA-256 fingerprint: {r.fingerprint}</p>
    </div>)}
    <p className='text-xs text-slate-400'>History is read-only. Historical file retrieval requires a separate controlled-access policy.</p>
  </div>}
 </div>;
}
