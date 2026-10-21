import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Card,useLoad} from '../admin/kit';
type Node={id:string;name:string;level:string};
type ReferenceItem={code:string;label:string;description:string};
export default function DigitalRcaDraft({locations,onCreated}:{locations:Node[];onCreated:()=>void}){
 const [title,setTitle]=useState(''),[incidentReference,setReference]=useState(''),[problemStatement,setProblem]=useState('');
 const [scopeNodeId,setScope]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [methodCode,setMethod]=useState('5WHY'),[frameworkCode,setFramework]=useState('5M1W');
 const [triggerTypeCode,setTriggerTypeCode]=useState(''),[triggerRecordId,setTriggerRecordId]=useState('');
 const masters=useLoad(()=>callBackend<{lists:{key:string;items:ReferenceItem[]}[]}>('/api/org/drkms/rca/reference',{}),[]);
 const items=(key:string)=>masters.data?.lists.find(x=>x.key===key)?.items??[];
 const create=async()=>{
  setBusy(true);setNotice('');
  try{
   const r=await callBackend<{document:{documentId:string}}>('/api/org/drkms/rca/create',{title,incidentReference,problemStatement,scopeNodeId,methodCode,frameworkCode,triggerTypeCode,triggerRecordId});
   setNotice('Digital RCA registered as a draft ('+r.document.documentId+'). DMAIC analysis and subsequent independent approval are required.');
   setTitle('');setReference('');setProblem('');onCreated();
  }catch(e){setNotice(e instanceof Error?e.message:'Unable to register investigation.');}finally{setBusy(false);}
 };
 return <Card><div className='space-y-3'>
  <h2 className='font-semibold text-white'>Start RCA investigation</h2>
  <p className='text-xs text-slate-400'>Choose a codified RCA method and causal reference. Every method operates within the mandatory DMAIC workflow; drafts cannot become approved knowledge automatically.</p>
  <label className='block text-sm text-white'>Investigation title<input value={title} onChange={e=>setTitle(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
  <label className='block text-sm text-white'>Incident / failure reference<input value={incidentReference} onChange={e=>setReference(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/></label>
  <label className='block text-sm text-white'>Applicable organizational location<select value={scopeNodeId} onChange={e=>setScope(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    <option value=''>Choose location</option>{locations.map(n=><option value={n.id} key={n.id}>{n.level.replaceAll('_',' ')} · {n.name}</option>)}
  </select></label>
  {masters.error&&<p role='alert' className='text-xs text-amber-300'>Cannot load controlled RCA methods: {masters.error}</p>}
  <label className='block text-sm text-white'>Originating incident / event category
   <select value={triggerTypeCode} onChange={e=>setTriggerTypeCode(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
     <option value=''>Select event category</option>{items('rcaTriggerTypes').map(x=><option key={x.code} value={x.code}>{x.label}</option>)}
   </select>
  </label>
  <label className='block text-sm text-white'>Originating record ID
   <input value={triggerRecordId} onChange={e=>setTriggerRecordId(e.target.value)} placeholder='Existing WO, WR, incident or event reference' className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'/>
  </label>
  <p className='text-xs text-slate-400'>Maintenance and safety records are checked against the organization database. Manufacturing and quality triggers remain explicitly pending source integration until those source registries are connected.</p>
  <label className='block text-sm text-white'>RCA analytical method
   <select value={methodCode} onChange={e=>setMethod(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    {items('rcaMethods').map(x=><option key={x.code} value={x.code}>{x.label}</option>)}
   </select>
  </label>
  <label className='block text-sm text-white'>Standardized causal reference
   <select value={frameworkCode} onChange={e=>setFramework(e.target.value)} className='mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-white'>
    {items('rcaFrameworks').map(x=><option key={x.code} value={x.code}>{x.label}</option>)}
   </select>
  </label>
  <p className='text-xs text-slate-400'>DMAIC: Define → Measure → Analyze → Improve → Control. Methods, 5M1W and other references are governed in MEMS Admin → DOC Metadata.</p>
  <label className='block text-sm text-white'>Problem statement<textarea rows={4} value={problemStatement} onChange={e=>setProblem(e.target.value)} className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white'/></label>
  <button type='button' onClick={()=>void create()} disabled={busy||!masters.data||!items('rcaMethods').some(x=>x.code===methodCode)||!items('rcaFrameworks').some(x=>x.code===frameworkCode)||title.trim().length<3||problemStatement.trim().length<20||!scopeNodeId||!triggerTypeCode||triggerRecordId.trim().length<3} className='min-h-11 w-full rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50'>{busy?'Registering…':'Start RCA investigation'}</button>
  {notice&&<p role='status' className='text-xs text-slate-200'>{notice}</p>}
 </div></Card>;
}
