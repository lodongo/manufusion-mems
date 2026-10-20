import { useState } from 'react';
import { callBackend } from '../lib/backend';
import { Card, useLoad } from '../admin/kit';

type DossierRow={documentId:string;title:string;classCode:string;subtypeCode:string;status:string};
export default function AssetTechnicalDossier({assetTag,equipmentId}:{assetTag:string;equipmentId?:string}){
 const [view,setView]=useState<'asset'|'work_center'>('asset');
 const [refresh,setRefresh]=useState(0);
 const targetId=view==='asset'?assetTag:(equipmentId||'');
 const result=useLoad(
  ()=>targetId?callBackend<{documents:DossierRow[];publicationEnabled:boolean}>('/api/org/drkms/engineering/dossier',{targetType:view,targetId}):Promise.resolve({documents:[],publicationEnabled:false}),
  [targetId,view,refresh]
 );
 return <Card>
  <div className='space-y-3'>
   <div className='flex items-center justify-between gap-2'>
    <div className='min-w-0'><h2 className='font-semibold text-white'>Equipment technical dossier</h2>
     <p className='text-xs text-slate-400'>Linked OEM manuals, drawings, RCAs and locally generated work instructions</p></div>
    <button type='button' onClick={()=>setRefresh(x=>x+1)} className='min-h-10 rounded-lg border border-slate-600 px-3 text-xs text-white'>Refresh</button>
   </div>
   {equipmentId&&<div className='flex flex-wrap gap-2'>
    <button type='button' aria-pressed={view==='asset'} onClick={()=>setView('asset')} className={'min-h-10 rounded-lg px-3 text-xs '+(view==='asset'?'bg-blue-600 text-white':'border border-slate-600 text-slate-200')}>Asset documents</button>
    <button type='button' aria-pressed={view==='work_center'} onClick={()=>setView('work_center')} className={'min-h-10 rounded-lg px-3 text-xs '+(view==='work_center'?'bg-blue-600 text-white':'border border-slate-600 text-slate-200')}>Equipment documents</button>
   </div>}
   {result.loading&&<p className='text-sm text-slate-400'>Loading technical references…</p>}
   {result.error&&<p className='text-sm text-amber-200'>The technical dossier is not available to this role or has not been configured.</p>}
   {!result.loading&&!result.error&&!result.data?.documents.length&&<p className='text-sm text-slate-400'>No technical documents linked to this item yet.</p>}
   {(result.data?.documents??[]).map(row=><div key={row.documentId+row.subtypeCode} className='min-w-0 rounded-lg border border-slate-700 p-3'>
     <p className='break-words text-sm font-semibold text-white'>{row.title}</p>
     <p className='mt-1 text-xs text-slate-400'>{row.subtypeCode} · {row.classCode} · {row.status}</p>
     <p className='mt-1 text-xs text-amber-200'>Metadata only — file access is not enabled</p>
   </div>)}
   <p className='text-xs text-slate-500'>This dossier shows controlled technical links only. No unpublished source files are accessible here.</p>
  </div>
 </Card>;
}
