import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Source={sourceType:string;sourceId:string;title:string;status?:string;failureModeCode?:string;subtypeCode?:string;updatedAt?:string;revision?:string;evidenceRef:string};
type Context={asset:{tag:string;name:string};history:Source[];references:Source[];limitations:string[]};
export default function TroubleshootingContext({assetTag}:{assetTag:string}){
 const [expanded,setExpanded]=useState(false);
 const [query,setQuery]=useState(''),[searchTerm,setSearchTerm]=useState('');
 const {data,loading,error,reload}=useLoad(()=>expanded?callBackend<Context>('/api/org/drkms/troubleshoot/context',{assetTag}):Promise.resolve(null),[assetTag,expanded]);
 const industrial=useLoad(()=>expanded?callBackend<{records:Array<{id:string;kind:string;title:string;technology:string;utilityKind:string;sourceDocumentId:string;sourceRevisionId:string}>;aiControlEnabled:false;liveTelemetryConnected:false}>('/api/org/drkms/industrial/list',{assetTag}):Promise.resolve(null),[assetTag,expanded]);
 const found=useLoad(()=>expanded&&searchTerm?callBackend<{hits:Array<{reference:string;title:string;excerpt:string;revisionId?:string}>;limitations:string[]}>('/api/org/drkms/troubleshoot/search',{assetTag,query:searchTerm}):Promise.resolve(null),[assetTag,expanded,searchTerm]);
 return <Card><div className='space-y-3'>
  <button type='button' className='flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-white' onClick={()=>setExpanded(!expanded)}>
   <span>Equipment troubleshooting knowledge</span><span className='text-xs text-blue-300'>{expanded?'Hide':'Explore'}</span>
  </button>
  {expanded&&<>
   <p className='text-xs text-slate-400'>Equipment-specific maintenance history and approved document references. AI diagnosis and full manual text search are not yet connected.</p>
   {loading&&<p className='text-xs text-slate-300'>Loading history…</p>}
   {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
   <form className='space-y-2' onSubmit={e=>{e.preventDefault();setSearchTerm(query.trim());}}>
    <label className='block text-xs text-slate-200'>Search maintenance history and approved references
      <input className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white' value={query} onChange={e=>setQuery(e.target.value)} placeholder='e.g. sensor fault, bottle jam'/>
    </label>
    <button type='submit' disabled={query.trim().length<2} className='min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50'>Search evidence</button>
   </form>
   {found.loading&&<p className='text-xs text-slate-400'>Searching records…</p>}
   {found.error&&<p role='alert' className='text-xs text-red-300'>{found.error}</p>}
   {found.data&&<div className='space-y-2'><p className='text-xs font-semibold text-white'>Evidence results ({found.data.hits.length})</p>
    {found.data.hits.map(x=><div key={x.reference} className='rounded-lg border border-slate-700 p-2'>
     <p className='break-words text-xs font-medium text-slate-200'>{x.title||x.reference}</p>
     <p className='break-all text-xs text-slate-400'>{x.reference}</p>
     <p className='text-xs text-slate-300'>{x.excerpt}</p>
    </div>)}
    <p className='text-xs text-amber-200'>Search covers metadata and recorded maintenance text only; full manual extraction and AI diagnosis are not active.</p>
   </div>}
   {industrial.data&&<div className='space-y-2'>
    <p className='font-semibold text-white'>PLC, IoT and utilities knowledge ({industrial.data.records.length})</p>
    {industrial.data.records.map(x=><div key={x.id} className='rounded-lg border border-slate-700 p-2'>
      <p className='break-words text-xs font-medium text-slate-200'>{x.title}</p>
      <p className='text-xs text-slate-400'>{x.kind.replaceAll('_',' ')} · {x.technology||x.utilityKind||'Controlled reference'}</p>
      <p className='break-all text-xs text-slate-500'>Revision: {x.sourceRevisionId.slice(0,12)} · Read-only reference</p>
    </div>)}
    <p className='text-xs text-slate-400'>PLC write access and live telemetry are not connected.</p>
   </div>}
   {data&&<>
    <button type='button' className='min-h-10 rounded-lg border border-slate-600 px-3 text-xs text-white' onClick={reload}>Refresh evidence</button>
    <p className='font-semibold text-white'>Maintenance history ({data.history.length})</p>
    {data.history.slice(0,15).map(x=><div key={x.evidenceRef} className='rounded-lg border border-slate-700 p-2 text-xs'>
      <p className='break-words text-slate-200'>{x.sourceId} · {x.title||x.sourceType}</p>
      <p className='text-slate-400'>{x.failureModeCode||x.status||'Record'} · {x.updatedAt||'Date not supplied'}</p>
    </div>)}
    <p className='font-semibold text-white'>Approved technical references ({data.references.length})</p>
    {data.references.map(x=><div key={x.evidenceRef} className='rounded-lg border border-slate-700 p-2 text-xs text-slate-200'>{x.subtypeCode} · {x.title} · {x.revision}</div>)}
    {!data.history.length&&!data.references.length&&<p className='text-xs text-slate-400'>No matching evidence has been indexed yet.</p>}
   </>}
  </>}
 </div></Card>;
}
