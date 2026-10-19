import {useEffect,useMemo,useState} from 'react';
import {callBackend} from '../lib/backend';
import {Alert} from '../components/ui';
import {Button,Card,PageTitle,Spinner,useLoad} from '../admin/kit';
import {workspaceNavigate as navigate} from '../lib/route';
type Gate={code:string;stage:string;label:string;owner:string;permission?:string|null;status:'existing'|'pending_implementation';requires:string[];configuredRole:string;roleRequired:boolean;ready:boolean};
type Response={gates:Gate[];jobRoles:{id:string;label:string}[];revision:number;configuredAt:string;note:string};
const stages=['request','assessment','conversion','planning','scheduling','execution','closure'];
export default function MntWorkflowSettings(){
 const {data,error,loading,reload}=useLoad(()=>callBackend<Response>('/api/org/mnt/workflow/configuration'));
 const [roles,setRoles]=useState<Record<string,string>|null>(null);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const current=useMemo(()=>roles??Object.fromEntries((data?.gates||[]).map(g=>[g.code,g.configuredRole||''])),[roles,data]);
 useEffect(()=>{setRoles(null);},[data?.revision]);
 const changed=!!data&&data.gates.some(g=>(current[g.code]||'')!==(g.configuredRole||''));
 if(loading&&!data)return <Spinner/>;
 if(error||!data)return <Alert tone='error'>{error||'Workflow setup could not be loaded.'}</Alert>;
 const save=async()=>{
  setBusy(true);setMessage('');
  try{
   const result=await callBackend<{version:number}>('/api/org/mnt/workflow/configuration/save',{
     approverRoles:current,expectedVersion:data.revision,reason
   });
   setMessage('Saved role assignments as configuration revision '+result.version+'. Operational transitions enforce these organizational role assignments.');
   setReason('');setRoles(null);reload();
  }catch(e){setMessage(e instanceof Error?e.message:'Unable to save workflow.');}
  finally{setBusy(false);}
 };
 return <div className='space-y-4'>
   <button type='button' onClick={()=>navigate('organization_admin/mnt_home')} className='text-sm text-emerald-400 underline'>← Maintenance</button>
   <PageTitle title='Maintenance workflows & approvals' subtitle='Assign accountable job roles to the operational maintenance workflow'/>
   <Alert tone='info'>Each stage is enforced by its business handler. Required roles must be configured and assigned at the maintenance location. Changes invalidate earlier window approvals.</Alert>
   {stages.map(stage=>{
    const gates=data.gates.filter(g=>g.stage===stage);
    if(!gates.length)return null;
    return <Card key={stage}>
      <h2 className='mb-3 text-base font-semibold capitalize text-white'>{stage}</h2>
      <div className='space-y-3'>{gates.map(g=><div key={g.code} className='rounded-xl border border-slate-700 p-3'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <div><p className='text-sm font-semibold text-white'>{g.label}</p><p className='text-xs text-slate-400'>{g.code} · {g.owner}{g.permission?` · Security activity: ${g.permission}`:''}</p></div>
          <span className={g.status==='existing'?'text-xs text-emerald-400':'text-xs text-amber-400'}>{g.status==='existing'?'Operational handler':'Pending implementation'}</span>
        </div>
        {g.roleRequired&&<label className='mt-2 block text-sm text-slate-300'>Assigned organizational job role
          <select data-native-select='true' value={current[g.code]||''} onChange={e=>setRoles({...current,[g.code]:e.target.value})}
            className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-base text-white'>
            <option value=''>Not configured</option>
            {data.jobRoles.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>}
        <p className='mt-2 text-xs text-slate-400'>Prerequisites: {g.requires.length?g.requires.join(' · '):'None'}</p>
      </div>)}</div>
    </Card>;
   })}
   <Card>
    <p className='text-sm text-slate-300'>Revision {data.revision}. {changed?'Unsaved configuration changes':'No pending changes'}.</p>
    <label className='mt-2 block text-sm text-slate-300'>Reason for changes
      <textarea value={reason} onChange={e=>setReason(e.target.value)} rows={3}
        className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-base text-white'
        placeholder='Why are these approval role assignments appropriate?'/>
    </label>
    <div className='mt-3'><Button disabled={busy||!changed||reason.trim().length<10} onClick={save}>{busy?'Saving…':'Save workflow configuration'}</Button></div>
    {message&&<p className='mt-2 text-sm text-slate-200'>{message}</p>}
   </Card>
 </div>;
}

