import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Source={sourceType:string;sourceId:string;title:string;status?:string;failureModeCode?:string;subtypeCode?:string;updatedAt?:string;revision?:string;evidenceRef:string};
type Context={asset:{tag:string;name:string};history:Source[];references:Source[];limitations:string[]};
export default function TroubleshootingContext({assetTag}:{assetTag:string}){
 const [expanded,setExpanded]=useState(false);
 const {data,loading,error,reload}=useLoad(()=>expanded?callBackend<Context>('/api/org/drkms/troubleshoot/context',{assetTag}):Promise.resolve(null),[assetTag,expanded]);
 return <Card><div className='space-y-3'>
  <button type='button' className='flex min-h-11 w-full items-center justify-between gap-2 text-left font-semibold text-white' onClick={()=>setExpanded(!expanded)}>
   <span>Equipment troubleshooting knowledge</span><span className='text-xs text-blue-300'>{expanded?'Hide':'Explore'}</span>
  </button>
  {expanded&&<>
   <p className='text-xs text-slate-400'>Equipment-specific maintenance history and approved document references. AI diagnosis and full manual text search are not yet connected.</p>
   {loading&&<p className='text-xs text-slate-300'>Loading history…</p>}
   {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
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
