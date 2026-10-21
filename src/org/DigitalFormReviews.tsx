import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type ReviewItem={id:string;templateTitle:string;submittedAt:string;createdBy:string;values:Record<string,unknown>;scopeNodeId:string};
export default function DigitalFormReviews(){
 const {data,error,reload,loading}=useLoad(()=>callBackend<{records:ReviewItem[]}>('/api/org/drkms/forms/review/inbox',{}),[]);
 const [reasons,setReasons]=useState<Record<string,string>>({}),[busy,setBusy]=useState(''),[notice,setNotice]=useState('');
 const decide=async(row:ReviewItem,decision:'return'|'technical_reviewed')=>{
  setBusy(row.id);setNotice('');
  try{await callBackend('/api/org/drkms/forms/review/decision',{recordId:row.id,decision,reason:reasons[row.id]??''});
   setNotice(decision==='return'?'Returned to creator for amendments.':'Technically reviewed. This is NOT CoA approval or publication.');
   reload();
  }catch(e){setNotice(e instanceof Error?e.message:'Review decision was not recorded.');}
  finally{setBusy('');}
 };
 return <Card><h2 className='text-base font-semibold text-white'>Independent form reviews</h2>
  <p className='text-xs text-slate-300'>Reviewers may return a form or record technical review only. Neither option authorizes issuance or publication.</p>
  {loading&&<p className='text-sm text-slate-400'>Loading review queue…</p>}
  {error&&<p role='alert' className='text-sm text-red-300'>{error}</p>}
  {!loading&&!data?.records.length&&<p className='text-sm text-slate-400'>No submitted forms in your review scope.</p>}
  {data?.records.map(r=><div key={r.id} className='mt-3 min-w-0 space-y-2 rounded-lg border border-slate-700 p-3'>
   <h3 className='break-words text-sm font-semibold text-white'>{r.templateTitle}</h3>
   <p className='break-all text-xs text-slate-400'>Record {r.id} · Submitted {r.submittedAt}</p>
   {Object.entries(r.values??{}).map(([key,value])=><p key={key} className='break-words text-xs text-slate-200'>{key}: {value===null?'—':String(value)}</p>)}
   <label className='block text-xs text-slate-200'>Review justification (minimum 12 characters)
    <textarea value={reasons[r.id]??''} onChange={e=>setReasons(o=>({...o,[r.id]:e.target.value}))} rows={2} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/>
   </label>
   <div className='flex flex-wrap gap-2'>
    <button type='button' disabled={!!busy||(reasons[r.id]??'').trim().length<12} onClick={()=>void decide(r,'return')} className='min-h-11 rounded-lg border border-amber-500 px-3 text-xs text-amber-200 disabled:opacity-40'>Return to author</button>
    <button type='button' disabled={!!busy||(reasons[r.id]??'').trim().length<12} onClick={()=>void decide(r,'technical_reviewed')} className='min-h-11 rounded-lg border border-blue-500 px-3 text-xs text-blue-200 disabled:opacity-40'>Record technical review</button>
   </div>
  </div>)}
  {notice&&<p role='status' className='text-sm text-slate-200'>{notice}</p>}
 </Card>;
}
