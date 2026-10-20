import {useEffect,useState} from 'react';
import {CheckCircle2,ChevronDown,ChevronUp,MessageCircle,ShieldCheck} from 'lucide-react';
import {callBackend} from '../lib/backend';
import {leaveQuick} from './quickNavigation';
import {ChatActionsBoard} from './ChatBoards';
import type {ChatPerson} from './chatTypes';

export default function QuickMonitoredActions({uid}:{uid:string}){
 const [open,setOpen]=useState(true),[policy,setPolicy]=useState<'pending'|'required'|'accepted'>('pending');
 const [people,setPeople]=useState<ChatPerson[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
    let alive=true;
    void callBackend<{accepted:boolean}>('/api/org/quick/chat/policy/status')
        .then(async r=>{
            if(!alive)return;
            setPolicy(r.accepted?'accepted':'required');
            if(r.accepted){
                const roster=await callBackend<{people:ChatPerson[]}>('/api/org/quick/chat/people');
                if(alive)setPeople(roster.people);
            }
        }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Could not load monitored work.')});
    return()=>{alive=false}
 },[uid]);
 return <section aria-label='Monitored Actions in My To-do' className='overflow-hidden rounded-2xl border border-brand/35 bg-panel'>
    <button type='button' onClick={()=>setOpen(x=>!x)}
        className='flex min-h-14 w-full items-center gap-3 px-4 text-left'>
        <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'><ShieldCheck className='h-5 w-5'/></span>
        <span className='min-w-0 flex-1'><strong className='block text-sm text-ink'>Monitored Actions</strong>
            <span className='block text-[11px] text-muted'>Work assigned in Chat · tracked separately from personal actions</span></span>
        {open?<ChevronUp className='h-4 w-4 text-brand'/>:<ChevronDown className='h-4 w-4 text-brand'/>}
    </button>
    {open&&<div className='border-t border-line'>
        {policy==='pending'&&!error&&<p className='p-4 text-xs text-muted'>Loading monitored work…</p>}
        {error&&<p className='p-4 text-xs text-red-500'>{error}</p>}
        {policy==='required'&&<div className='space-y-2 p-4 text-xs text-ink'>
            <p>Acknowledge the Chat workplace notice to access monitored assignments.</p>
            <button type='button' onClick={()=>leaveQuick('organization_home/quick/chat')}
                className='flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-onbrand'><MessageCircle className='h-4 w-4'/>Open Chat</button>
        </div>}
        {policy==='accepted'&&<div className='h-[min(52dvh,540px)] min-h-[220px] overflow-hidden'>
            <ChatActionsBoard uid={uid} people={people}/>
        </div>}
    </div>}
 </section>;
}
