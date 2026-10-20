import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Sds={id:string;materialCode:string;chemicalName:string;manufacturer:string;revisionDate:string;sourceUrl:string;validationStatus:string;reviewDue:string};
export default function SheqSdsRegistry({canConfigure}:{canConfigure:boolean}){
 const {data,error,reload}=useLoad(()=>callBackend<{items:Sds[]}>('/api/org/drkms/sds/list',{}),[]);
 const [materialCode,setMaterial]=useState(''),[chemicalName,setChemical]=useState(''),[manufacturer,setManufacturer]=useState(''),[sourceUrl,setSource]=useState(''),[revisionDate,setRevision]=useState(''),[reviewDue,setReview]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const save=async()=>{
  setBusy(true);setNotice('');
  try{await callBackend('/api/org/drkms/sds/register',{materialCode,chemicalName,manufacturer,sourceUrl,revisionDate,reviewDue});setNotice('SDS reference recorded. SHEQ verification is still required.');reload();}
  catch(e){setNotice(e instanceof Error?e.message:'Could not save SDS.');}finally{setBusy(false);}
 };
 return <Card><div className='space-y-3'>
  <h2 className='font-semibold text-white'>SHEQ — Safety Data Sheet register</h2>
  <p className='text-xs text-slate-400'>Controlled chemical document references. A source link is not confirmation of the latest approved SDS.</p>
  {canConfigure&&<div className='space-y-2 rounded-lg border border-slate-700 p-3'>
   <p className='text-sm font-medium text-white'>Register manufacturer SDS</p>
   {([
    ['Material code',materialCode,setMaterial],['Chemical/product name',chemicalName,setChemical],
    ['Manufacturer',manufacturer,setManufacturer],['Current manufacturer HTTPS source URL',sourceUrl,setSource],
    ['SDS revision date (YYYY-MM-DD)',revisionDate,setRevision],['Review due (YYYY-MM-DD)',reviewDue,setReview],
   ] as Array<[string,string,(s:string)=>void]>).map(([label,value,set])=><label key={label} className='block text-xs text-slate-200'>{label}
    <input value={value} onChange={e=>set(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white'/>
   </label>)}
   <button type='button' disabled={busy||!materialCode||!chemicalName||!manufacturer||!sourceUrl||!revisionDate} onClick={()=>void save()} className='min-h-11 w-full rounded-lg bg-blue-600 p-2 text-sm font-semibold text-white disabled:opacity-50'>{busy?'Saving…':'Register SDS reference'}</button>
   {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
  </div>}
  {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
  {(data?.items??[]).map(x=><div key={x.id} className='rounded-lg border border-slate-700 p-3'>
   <p className='text-sm font-semibold text-white'>{x.materialCode} · {x.chemicalName}</p>
   <p className='text-xs text-slate-400'>{x.manufacturer} · Revised {x.revisionDate}</p>
   <p className='text-xs text-amber-200'>{x.validationStatus.replaceAll('_',' ')}</p>
   <a target='_blank' rel='noopener noreferrer' href={x.sourceUrl} className='mt-2 inline-block break-all text-xs text-blue-300 underline'>Open manufacturer SDS URL</a>
  </div>)}
 </div></Card>;
}
