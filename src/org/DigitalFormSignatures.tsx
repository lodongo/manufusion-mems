import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Item={recordId:string;slotId:string;templateTitle:string;status:string;signerStatus:string;label:string;signedAt:string;recordFingerprint:string;values:Record<string,unknown>};
export default function DigitalFormSignatures(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<{assignments:Item[]}>('/api/org/drkms/forms/signatures/inbox',{}),[]);
 const [busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const sign=async(item:Item)=>{setBusy(item.slotId);setNotice('');
  try{await callBackend('/api/org/drkms/forms/signatures/sign',{recordId:item.recordId,slotId:item.slotId,attest:true});
   setNotice('Authenticated signature evidence recorded. This does not publish or approve the form.');reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Could not sign this form.');}finally{setBusy('');}
 };
 return <Card><h2 className='text-base font-semibold text-white'>My form sign-offs</h2>
  <p className='text-xs text-slate-400'>Review all shown answers before signing. A completed sign-off is bound to the independently reviewed record fingerprint; final CoA approval remains separate.</p>
  {loading&&<p className='text-sm text-slate-400'>Loading assigned sign-offs…</p>}
  {error&&<p role='alert' className='text-sm text-red-300'>{error}</p>}
  {!loading&&!data?.assignments.length&&<p className='text-sm text-slate-400'>No assigned form signatures.</p>}
  {data?.assignments.map(item=><div key={item.slotId} className='mt-3 min-w-0 space-y-2 rounded-lg border border-slate-700 p-3'>
   <h3 className='break-words text-sm font-semibold text-white'>{item.templateTitle}</h3>
   <p className='text-xs text-slate-300'>Authority: {item.label} · {item.signerStatus}</p>
   <p className='break-all text-xs text-slate-400'>Record: {item.recordId}</p>
   {Object.entries(item.values??{}).map(([key,value])=><p key={key} className='break-words text-xs text-slate-200'>{key}: {value===null?'—':String(value)}</p>)}
   <p className='break-all text-xs text-slate-400'>SHA-256: {item.recordFingerprint}</p>
   {item.signedAt&&<p className='text-xs text-slate-300'>Signed: {item.signedAt}</p>}
   {item.signerStatus==='pending'&&<button type='button' disabled={!!busy||item.status!=='technical_reviewed'} onClick={()=>void sign(item)} className='min-h-11 w-full rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50'>Confirm authenticated sign-off</button>}
  </div>)}
  {notice&&<p role='status' className='text-sm text-slate-200'>{notice}</p>}
 </Card>;
}
