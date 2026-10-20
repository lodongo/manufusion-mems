import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card} from '../admin/kit';
type Node={id:string;name:string;level:string};
export default function DigitalRcaDraft({locations,onCreated}:{locations:Node[];onCreated:()=>void}){
 const [title,setTitle]=useState(''),[incidentReference,setReference]=useState(''),[problemStatement,setProblem]=useState('');
 const [scopeNodeId,setScope]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const create=async()=>{
  setBusy(true);setNotice('');
  try{
   const r=await callBackend<{document:{documentId:string}}>('/api/org/drkms/rca/create',{title,incidentReference,problemStatement,scopeNodeId});
   setNotice('Digital RCA registered as an investigation draft ('+r.document.documentId+'). Approval and staging are still required.');
   setTitle('');setReference('');setProblem('');onCreated();
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to register investigation.');}finally{setBusy(false);}
 };
 return <Card><div className='space-y-3'>
  <h2 className='font-semibold text-white'>Digital RCA investigation</h2>
  <p className='text-xs text-slate-400'>Start a structured investigation. A draft never becomes approved equipment knowledge automatically.</p>
  <label className='block text-sm text-white'>Investigation title<input value={title} onChange={e=>setTitle(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
  <label className='block text-sm text-white'>Incident / failure reference<input value={incidentReference} onChange={e=>setReference(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
  <label className='block text-sm text-white'>Applicable organizational location<select value={scopeNodeId} onChange={e=>setScope(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
   <option value=''>Choose location</option>{locations.map(n=><option value={n.id} key={n.id}>{n.level.replaceAll('_',' ')} · {n.name}</option>)}
  </select></label>
  <label className='block text-sm text-white'>Problem statement<textarea rows={4} value={problemStatement} onChange={e=>setProblem(e.target.value)} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/></label>
  <button type='button' onClick={()=>void create()} disabled={busy||title.trim().length<3||problemStatement.trim().length<20||!scopeNodeId} className='min-h-11 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50'>{busy?'Registering…':'Start RCA investigation'}</button>
  {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
 </div></Card>;
}
