import { useState, type ChangeEvent } from 'react';
import { callBackend } from '../lib/backend';

type DocumentRow = { documentId:string; title:string; status:string };
const MAX=8_000_000;
const TYPES=new Set([
 'application/pdf','image/png','image/jpeg',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
export default function DocumentSourceStaging({documents}:{documents:DocumentRow[]}){
 const [documentId,setDocumentId]=useState('');
 const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [problem,setProblem]=useState('');
 const pick=(ev:ChangeEvent<HTMLInputElement>)=>{
   const next=ev.target.files?.[0]??null;
   setProblem('');setFile(null);
   if(next&&(!TYPES.has(next.type)||next.size>MAX||next.size<1)){
     setProblem('Choose a PDF, JPG, PNG, Word, Excel or PowerPoint file up to 8 MB.');
     return;
   }
   setFile(next);
 };
 const upload=async()=>{
   if(!file||!documentId||busy)return;
   setBusy(true);setProblem('');setNotice('');
   try{
     const base64=await new Promise<string>((resolve,reject)=>{
       const reader=new FileReader();
       reader.onerror=()=>reject(new Error('Could not read the selected file.'));
       reader.onload=()=>resolve(String(reader.result??'').split(',')[1]??'');
       reader.readAsDataURL(file);
     });
     await callBackend('/api/org/drkms/files/stage',{documentId,mime:file.type,name:file.name,data:base64});
     setNotice('Source file preserved in quarantine. Security screening and publication are pending.');
     setFile(null);
   }catch(error){setProblem(error instanceof Error?error.message:'Upload failed.');}
   finally{setBusy(false);}
 };
 return <section className='space-y-3 rounded-xl border border-slate-700 p-4'>
  <h2 className='font-semibold text-white'>Preserve a source file</h2>
  <p className='text-xs text-slate-400'>For draft documents only. Files remain private and quarantined until the security and document approval workflows are ready.</p>
  <label className='block text-sm text-slate-200'>Draft document
   <select value={documentId} onChange={e=>setDocumentId(e.target.value)}
    className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    <option value=''>Choose a draft document</option>
    {documents.filter(d=>d.status==='draft').map(d=><option value={d.documentId} key={d.documentId}>{d.title}</option>)}
   </select>
  </label>
  <label className='block text-sm text-slate-200'>File (up to 8 MB)
   <input type='file' onChange={pick} accept='.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx'
    className='mt-1 block w-full min-w-0 rounded-lg border border-slate-600 p-3 text-xs text-white file:mr-2 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white'/>
  </label>
  <button type='button' onClick={()=>void upload()} disabled={busy||!file||!documentId}
    className='min-h-11 w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50'>
    {busy?'Preserving…':'Preserve source file'}
  </button>
  {problem&&<p role='alert' className='text-sm text-red-300'>{problem}</p>}
  {notice&&<p role='status' className='text-sm text-green-300'>{notice}</p>}
 </section>;
}
