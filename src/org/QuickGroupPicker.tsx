import {useState} from 'react';
import {Users,UserRoundPlus} from 'lucide-react';
import {callBackend} from '../lib/backend';

export default function QuickGroupPicker({available,onSelect}:{available:string[];onSelect:(selected:string[],title:string)=>void}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[count,setCount]=useState(0);
 const select=async(kind:'direct'|'team')=>{
    setBusy(true);setError('');
    try{
      const r=await callBackend<{direct:string[];team:string[]}>('/api/org/quick/chat/reporting');
      const allowed=new Set(available);
      const selected=(kind==='direct'?r.direct:r.team).filter(id=>allowed.has(id));
      if(!selected.length){setError('No matching employees with verified reporting-role assignments. Review the job-role hierarchy.');return;}
      if(selected.length>49){setError('More than 49 reports. Select a smaller group manually.');return;}
      onSelect(selected,kind==='direct'?'My direct reports':'My team');setCount(selected.length);
    }catch(e){setError(e instanceof Error?e.message:'Could not load your reporting team.')}
    finally{setBusy(false)}
 };
 return <div className='space-y-2 rounded-xl border border-line bg-panel p-3'>
    <p className='text-xs font-semibold text-ink'>Quick groups</p>
    <p className='text-[11px] text-muted'>Based on assigned job roles and organizational reporting hierarchy. Colleagues must accept invitations.</p>
    <div className='grid grid-cols-2 gap-2'>
        <button type='button' disabled={busy} onClick={()=>{void select('direct')}} className='flex min-h-12 items-center justify-center gap-1 rounded-xl border border-line bg-page px-2 text-xs font-semibold text-brand'>
            <UserRoundPlus className='h-4 w-4'/>Direct reports
        </button>
        <button type='button' disabled={busy} onClick={()=>{void select('team')}} className='flex min-h-12 items-center justify-center gap-1 rounded-xl border border-line bg-page px-2 text-xs font-semibold text-brand'>
            <Users className='h-4 w-4'/>My team
        </button>
    </div>
    {busy&&<p className='text-xs text-muted'>Checking employee reporting assignments…</p>}
    {count>0&&<p className='text-xs text-brand'>{count} colleagues selected · edit below before inviting</p>}
    {error&&<p role='alert' className='text-xs text-red-500'>{error}</p>}
 </div>;
}
