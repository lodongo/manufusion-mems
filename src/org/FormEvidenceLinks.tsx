import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {useLoad} from '../admin/kit';
type Document={documentId:string;title:string;status:string};
type File={fileId:string;name:string;mime:string;bytes:number};
export default function FormEvidenceLinks({recordId,locked,onLinked}:{recordId:string;locked:boolean;onLinked:()=>void}){
 const docs=useLoad(()=>callBackend<{documents:Document[]}>('/api/org/drkms/documents/list',{}),[]);
 const [documentId,setDocumentId]=useState(''),[selectedFile,setSelectedFile]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const files=useLoad(()=>documentId?callBackend<{files:File[]}>('/api/org/drkms/documents/effective-files',{documentId}):Promise.resolve(null),[documentId]);
 const link=async()=>{setBusy(true);setNotice('');
  try{await callBackend('/api/org/drkms/forms/records/evidence/link',{recordId,documentId,fileId:selectedFile});
   setNotice('Controlled evidence linked to the draft, with its immutable source revision and checksum.');onLinked();setSelectedFile('');
  }catch(e){setNotice(e instanceof Error?e.message:'Could not link controlled evidence.');}finally{setBusy(false);}
 };
 return <div className='space-y-2 rounded-lg border border-slate-700 p-3'>
  <h3 className='text-sm font-semibold text-white'>Supporting controlled evidence</h3>
  <p className='text-xs text-slate-400'>Link files from previously approved DOC revisions. New uploads remain unavailable until the trusted scanner in Milestone A is operational.</p>
  <label className='block text-xs text-slate-200'>Approved source document
   <select value={documentId} disabled={locked} onChange={e=>{setDocumentId(e.target.value);setSelectedFile('')}} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    <option value=''>Choose controlled document</option>{docs.data?.documents.filter(d=>d.status==='effective').map(d=><option key={d.documentId} value={d.documentId}>{d.title}</option>)}
   </select>
  </label>
  {files.error&&<p role='alert' className='text-xs text-red-300'>{files.error}</p>}
  {documentId&&<label className='block text-xs text-slate-200'>Approved source file
   <select disabled={locked||files.loading} value={selectedFile} onChange={e=>setSelectedFile(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    <option value=''>Choose source file</option>{files.data?.files.map(v=><option key={v.fileId} value={v.fileId}>{v.name}</option>)}
   </select>
  </label>}
  <button type='button' disabled={busy||locked||!recordId||!documentId||!selectedFile} onClick={()=>void link()} className='min-h-11 rounded-lg border border-blue-500 px-3 text-xs text-blue-200 disabled:opacity-50'>Link verified evidence</button>
  {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
 </div>;
}
