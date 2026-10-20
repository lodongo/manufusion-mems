import { useState } from 'react';
import { callBackend } from '../lib/backend';
import { Card, useLoad } from '../admin/kit';

type Doc={documentId:string;title:string;classCode:string;status:string};
type Type={code:string;label:string;parentClass:string};
type Target={id:string;name:string;code:string;type:string};
export default function EngineeringDocumentLinks({documents}:{documents:Doc[]}){
 const types=useLoad(()=>callBackend<{types:Type[]}>('/api/org/drkms/engineering/types',{}),[]);
 const assets=useLoad(()=>callBackend<{targets:Target[]}>('/api/org/drkms/engineering/targets',{}),[]);
 const [id,setId]=useState(''),[type,setType]=useState(''),[target,setTarget]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [modelWide,setModelWide]=useState(false);
 const selected=documents.find(d=>d.documentId===id);
 const choices=(types.data?.types??[]).filter(t=>t.parentClass===selected?.classCode);
 const apply=async()=>{
  if(!id||!type||!target)return;
  setBusy(true);setMessage('');
  const [targetType,targetId]=target.split(':',2);
  try{await callBackend(modelWide?'/api/org/drkms/engineering/model-link':'/api/org/drkms/engineering/link',modelWide?{documentId:id,subtypeCode:type,assetTag:targetId}:{documentId:id,subtypeCode:type,targetType,targetId});setMessage('Technical document linked.');}
  catch(e){setMessage(e instanceof Error?e.message:'Link failed.');}finally{setBusy(false);}
 };
 return <Card><div className='space-y-3'>
  <h2 className='font-semibold text-white'>Engineering document links</h2>
  <p className='text-xs text-slate-400'>Use existing MEMS equipment and assets; no duplicate register.</p>
  <label className='block text-sm text-white'>Draft document
   <select className='mt-1 min-h-11 w-full rounded-lg bg-slate-900 p-2' value={id} onChange={e=>{setId(e.target.value);setType('');}}>
    <option value=''>Choose document</option>{documents.filter(d=>d.status==='draft').map(d=><option key={d.documentId} value={d.documentId}>{d.title}</option>)}
   </select>
  </label>
  <label className='block text-sm text-white'>Codified technical type
   <select className='mt-1 min-h-11 w-full rounded-lg bg-slate-900 p-2' value={type} onChange={e=>setType(e.target.value)}>
    <option value=''>Choose classification</option>{choices.map(t=><option key={t.code} value={t.code}>{t.code}: {t.label}</option>)}
   </select>
  </label>
  <label className='block text-sm text-white'>Asset, equipment or assembly
   <select className='mt-1 min-h-11 w-full rounded-lg bg-slate-900 p-2' value={target} onChange={e=>setTarget(e.target.value)}>
    <option value=''>Choose registered target</option>{(assets.data?.targets??[]).map(t=><option key={t.type+':'+t.id} value={t.type+':'+t.id}>{t.type}: {t.code} {t.name}</option>)}
   </select>
  </label>
  <label className='flex items-center gap-2 text-sm text-slate-200'><input type='checkbox' checked={modelWide} onChange={e=>setModelWide(e.target.checked)} />Reuse for matching asset category, subcategory and class (select an asset above)</label>
  <button type='button' disabled={busy||!id||!type||!target||(modelWide&&!target.startsWith('asset:'))} onClick={()=>void apply()} className='min-h-11 w-full rounded-lg bg-blue-600 p-2 font-semibold text-white disabled:opacity-50'>{busy?'Linking…':'Link document'}</button>
  {message&&<p role='status' className='text-sm text-slate-200'>{message}</p>}
 </div></Card>;
}
