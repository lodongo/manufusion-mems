import {useEffect,useState,type ReactNode} from 'react';
import {CheckCircle2,ShieldCheck,Loader2} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {leaveQuick} from './quickNavigation';

interface Policy {version:string;accepted:boolean;acceptedAt:string;policyText:string}
export default function ChatPolicyGate({children}:{children:ReactNode}){
 const [policy,setPolicy]=useState<Policy|null>(null);
 const [checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let alive=true;void callBackend<Policy>('/api/org/quick/chat/policy/status')
    .then(p=>{if(alive)setPolicy(p)}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Cannot load the Chat policy.')});
    return()=>{alive=false}},[]);
 const acknowledge=async()=>{
    if(!policy||!checked)return;
    setBusy(true);setError('');
    try{
      await callBackend('/api/org/quick/chat/policy/accept',{version:policy.version,acknowledged:true});
      setPolicy({...policy,accepted:true,acceptedAt:new Date().toISOString()});
    }catch(e){setError(e instanceof Error?e.message:'Could not save acknowledgement.')}
    finally{setBusy(false)}
 };
 if(policy?.accepted)return <>{children}</>;
 return <div className='flex h-full w-full min-h-0 items-center justify-center overflow-y-auto p-4 sm:p-8'>
    <section className='w-full max-w-xl space-y-4 rounded-2xl border border-line bg-panel p-5 shadow-sm'>
        <button type='button' onClick={()=>leaveQuick('organization_home/quick')} className='min-h-10 text-xs font-semibold text-brand'>← Quick links</button>
        <header className='flex items-start gap-3'>
          <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'><ShieldCheck className='h-6 w-6'/></span>
          <div><h1 className='text-lg font-bold text-ink'>Chat workplace acknowledgement</h1>
              <p className='text-xs text-muted'>Required once for this version before you use Chat.</p></div>
        </header>
        {!policy&&!error&&<p className='flex items-center gap-2 text-sm text-muted'><Loader2 className='h-4 w-4 animate-spin'/>Loading workplace policy…</p>}
        {policy&&<>
            <p className='rounded-xl border border-line bg-page p-4 text-sm leading-relaxed text-ink'>{policy.policyText}</p>
            <p className='text-xs leading-relaxed text-muted'>This acknowledges workplace notice and business-appropriate Chat use. It does not waive rights under applicable privacy, employment, or data-protection laws. Consult the organization’s approved policies for access, retention, and disclosure details.</p>
            <label className='flex items-start gap-3 rounded-xl border border-line p-3 text-sm text-ink'>
                <input className='mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-brand))]' type='checkbox' checked={checked}
                    onChange={e=>setChecked(e.target.checked)}/>
                <span>I have read and acknowledge the workplace Chat notice. I understand Chat is for organizational work, and that lawful organizational recordkeeping and monitoring may apply.</span>
            </label>
            <button type='button' disabled={!checked||busy} onClick={()=>{void acknowledge()}}
                className='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40'>
                <CheckCircle2 className='h-5 w-5'/>{busy?'Saving…':'Acknowledge and continue to Chat'}
            </button>
        </>}
        {error&&<p role='alert' className='rounded-xl bg-red-500/10 p-3 text-sm text-red-500'>{error}
            {!policy&&<button type='button' onClick={()=>window.location.reload()} className='ml-2 underline'>Retry</button>}
        </p>}
    </section>
 </div>;
}
