import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {useLoad} from '../admin/kit';
type Slot={slotId:string;label:string;signerUid:string;position:{page:number;xPercent:number;yPercent:number;widthPercent:number};status:string;signedAt?:string};
export default function DocumentSigning({documentId,creatorDraft}:{documentId:string;creatorDraft:boolean}){
 const [open,setOpen]=useState(false),[signerUid,setSigner]=useState(''),[label,setLabel]=useState('Approved by');
 const [page,setPage]=useState(1),[x,setX]=useState(60),[y,setY]=useState(75),[width,setWidth]=useState(35);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const {data,reload,error}=useLoad(()=>open?callBackend<{slots:Slot[]}>('/api/org/drkms/signatures/list',{documentId}):Promise.resolve(null),[open,documentId]);
 const assign=async()=>{setBusy(true);setNotice('');
  try{await callBackend('/api/org/drkms/signatures/assign',{documentId,signerUid:signerUid.trim(),label:label.trim(),
    position:{page,xPercent:x,yPercent:y,widthPercent:width}});
    setNotice('Signature assignment saved. The assigned authority must sign after technical verification.');reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Assignment unsuccessful.')}finally{setBusy(false)}
 };
 const sign=async(slotId:string)=>{setBusy(true);setNotice('');
  try{await callBackend('/api/org/drkms/signatures/sign',{documentId,slotId,attest:true});
    setNotice('Authenticated attestation recorded against the verified revision.');reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Signing unsuccessful.')}finally{setBusy(false)}
 };
 return <div className='mt-2 space-y-2'>
  <button type='button' onClick={()=>setOpen(!open)} className='min-h-10 rounded-lg border border-blue-500 px-3 text-xs text-blue-200'>{open?'Hide sign-off':'Document sign-off'}</button>
  {open&&<div className='space-y-3 rounded-lg border border-slate-700 p-3'>
   <p className='text-xs text-slate-400'>Signatures are assigned by the document creator, tied to the reviewed source and independently authenticated. Position percentages refer to the original document page; no signature is applied to an unverified file.</p>
   {creatorDraft&&<div className='space-y-2'>
    <label className='block text-xs text-slate-200'>Signatory MEMS user ID<input value={signerUid} onChange={e=>setSigner(e.target.value)} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
    <label className='block text-xs text-slate-200'>Signature authority / role<input value={label} onChange={e=>setLabel(e.target.value)} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
    <div className='grid grid-cols-2 gap-2'>
     {([['Page',page,setPage,1,10000],['X %',x,setX,0,90],['Y %',y,setY,0,90],['Width %',width,setWidth,10,100-x]] as const).map(([name,value,set,min,max])=><label key={name} className='text-xs text-slate-200'>{name}
      <input type='number' value={value} min={min} max={max} onChange={e=>set(Number(e.target.value))} className='mt-1 min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 text-white'/>
     </label>)}
    </div>
    <button type='button' onClick={()=>void assign()} disabled={busy||signerUid.trim().length<6||label.trim().length<3} className='min-h-10 rounded-lg bg-blue-600 px-3 text-sm text-white disabled:opacity-50'>Assign signature space</button>
   </div>}
   {error&&<p role='alert' className='text-xs text-red-300'>{error}</p>}
   {data?.slots.map(s=><div key={s.slotId} className='space-y-1 rounded-lg border border-slate-700 p-2'>
     <p className='break-all text-xs text-white'>{s.label} · {s.signerUid}</p>
     <p className='text-xs text-slate-400'>Page {s.position.page}, position {s.position.xPercent}% × {s.position.yPercent}% · {s.status}{s.signedAt?' · '+s.signedAt:''}</p>
     {s.status==='pending'&&<button type='button' disabled={busy} onClick={()=>void sign(s.slotId)} className='min-h-10 rounded-lg border border-blue-500 px-3 text-xs text-blue-200'>I am the assigned signatory — authenticate and sign</button>}
   </div>)}
   {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
  </div>}
 </div>;
}
