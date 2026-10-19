import {useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
import {workspaceNavigate as navigate} from '../lib/route';
type Task={description:string;tools:string;spares:Array<{description:string;qty:number;source:string}>;services:Array<{description:string}>;risk:Array<{hazard:string;impact:string;controls:string;before:string;after:string}>};
type Item={id:string;wrCode:string;taskId:string;description:string;assemblyId:string;assetTag:string;createdBy:string;task:Task};
export default function MntTaskValidation(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<{items:Item[];configurationNeeded:boolean}>('/api/org/mnt/tasks/pending'));
 const [busy,setBusy]=useState(''),[message,setMessage]=useState('');
 const approve=async(id:string)=>{setBusy(id);setMessage('');
  try{await callBackend('/api/org/mnt/tasks/validate',{id});setMessage('Task validated and added to the reusable assembly task registry.');reload();}
  catch(e){setMessage(e instanceof Error?e.message:'Validation failed.');}finally{setBusy('');}
 };
 return <div className='space-y-4'>
  <button className='text-sm text-emerald-300 underline' onClick={()=>navigate('organization_admin/mnt')}>← Maintenance workspace</button>
  <PageTitle title='Task template validation' subtitle='Approve assessed tasks before they can be reused on equipment or assemblies'/>
  {loading&&!data?<Spinner/>:error?<Alert tone='error'>{error}</Alert>:<>
   {data?.configurationNeeded&&<Alert tone='info'>Assign the asset-task validation job role under Maintenance → Workflows and approval roles.</Alert>}
   <p className='text-sm text-slate-300'>{data?.items.length||0} task proposals awaiting independent validation.</p>
   {(data?.items||[]).map(item=><Card key={item.id} className='space-y-3'>
    <p className='text-xs text-emerald-300'>{item.wrCode} · Assembly {item.assemblyId} · {item.assetTag}</p>
    <h3 className='font-semibold text-white'>{item.task.description}</h3>
    <p className='text-sm text-slate-300'>Tools: {item.task.tools||'Not specified'}</p>
    <p className='text-sm text-slate-300'>Spares: {item.task.spares?.length||0} · Services: {item.task.services?.length||0} · Risk items: {item.task.risk?.length||0}</p>
    {(item.task.risk||[]).map((r,i)=><div key={i} className='rounded-lg border border-slate-700 p-2 text-sm'>
      <p className='font-medium text-white'>{r.hazard} · {r.impact}</p>
      <p className='text-slate-300'>Controls: {r.controls}</p><p className='text-xs text-slate-400'>Initial {r.before} → Residual {r.after}</p>
    </div>)}
    {(item.task.spares||[]).map((v,i)=><p className='text-sm text-slate-300' key={i}>Spare: {v.description} × {v.qty} ({v.source})</p>)}
    {(item.task.services||[]).map((v,i)=><p className='text-sm text-slate-300' key={i}>Service: {v.description}</p>)}
    <Button disabled={!!busy||item.createdBy===''} busy={busy===item.id} onClick={()=>approve(item.id)}>Validate and publish reusable task</Button>
   </Card>)}
   {!data?.items.length&&!data?.configurationNeeded&&<Card><p className='text-sm text-slate-300'>No task proposals need your validation.</p></Card>}
  </>}
  {message&&<Alert tone='info'>{message}</Alert>}
 </div>;
}
