import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CalendarDays, Check, CheckCheck, ChevronDown, ChevronUp, Clock3, MessageSquareText, RefreshCw, Users } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { RecordCards } from '../components/RecordRefs';
import { plainRefs } from '../lib/recordRefs';
import { navigate } from '../lib/route';
import { appPrompt } from '../components/dialogs';

interface Assignment {uid:string;decision:string;status:string;reviewNote:string;updatedAt:string;acknowledgedAt:string;acknowledgementNote?:string;progressNotes:Array<{note:string;at:string;by:string}>;}
export interface HubAction {
    id:string;source:string;sourceId:string;roomId:string;title:string;description:string;header?:string;body?:string;
    deadline:string;requesterUid:string;recipientUids:string[];assignments:Assignment[];
    canceled:boolean;createdAt:string;mailThreadId:string;mailSubject:string;
    workflowStatus?:string;workflowLink?:string;workflowLinkLabel?:string;workflowModule?:string;workflowStage?:string;workflowOutcome?:string;
}
const actionLabel=(a:HubAction,me:string,mode:'mine'|'sent')=>{
    if(mode==='sent')return a.recipientUids.length+' assignee'+(a.recipientUids.length===1?'':'s');
    const rec=a.assignments.find(x=>x.uid===me);
    // Workflow actions close only when the step is completed in their module.
    if(a.source==='workflow')return rec?.acknowledgedAt?'Closed · '+(rec.acknowledgementNote||a.workflowOutcome||'step completed'):'Open · complete it in '+(a.workflowLinkLabel||'its module');
    if(!rec)return 'Assigned';
    if(rec.acknowledgedAt)return 'Closed · acknowledged';
    if(rec.status==='closed')return 'Awaiting requester acknowledgement';
    if(rec.decision==='pending')return 'Awaiting acceptance';
    if(rec.decision==='review')return 'Needs clarification';
    if(rec.decision==='declined')return 'Declined';
    return rec.status==='canceled'?'Canceled':rec.status==='closed'?'Closed':'Open';
};
export default function UnifiedActions({uid,mode='mine',sourceFilter=''}:{uid:string;mode?:'mine'|'sent';sourceFilter?:string}){
    const [actions,setActions]=useState<HubAction[]>([]);
    const [busy,setBusy]=useState('');
    const [error,setError]=useState('');
    const [open,setOpen]=useState('');
    const [note,setNote]=useState('');
    const [statusDraft,setStatusDraft]=useState<Record<string,'open'|'closed'>>({});
    const [filter,setFilter]=useState<'active'|'all'|'closed'>('active');
    const reload=useCallback(async()=>{
        try{
            const r=await callBackend<{actions:HubAction[]}>(mode==='mine'?'/api/org/actions/list':'/api/org/actions/sent');
            setActions(r.actions);setError('');
        }catch(e){setError(e instanceof Error?e.message:'Cannot load monitored actions.');}
    },[mode]);
    useEffect(()=>{void reload();const t=setInterval(()=>{if(document.visibilityState==='visible')void reload()},30000);return()=>clearInterval(t)},[reload]);
    const visible=useMemo(()=>actions.filter(a=>(!sourceFilter||a.source===sourceFilter)&&!a.canceled)
        .filter(a=>{
            const relevant=mode==='mine'?a.assignments.filter(x=>x.uid===uid):a.assignments;
            const finished=relevant.length>0&&relevant.every(x=>!!x.acknowledgedAt||x.decision==='declined'||x.status==='canceled');
            return filter==='all'||(filter==='closed'?finished:!finished);
        }),[actions,sourceFilter,uid,filter,mode]);
    const act=async(path:string,payload:Record<string,unknown>)=>{
        setBusy(String(payload.actionId||''));setError('');
        try{await callBackend(path,payload);setNote('');await reload();}
        catch(e){setError(e instanceof Error?e.message:'Action update failed.');}
        finally{setBusy('');}
    };
    const dueToday=new Date().toISOString().slice(0,10);
    return <section aria-label={mode==='mine'?'My monitored assignments':'My sent monitored actions'} className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2'>
            <div className='min-w-0 flex-1'><h3 className='text-sm font-semibold text-ink'>{mode==='mine'?'Assigned to me':'Actions I requested'}</h3>
                <p className='text-xs text-muted'>{mode==='mine'?'One view of actions assigned to you · tap to change status and add progress':'Track progress for each colleague and acknowledge completed work'}</p></div>
            <select aria-label='Filter monitored actions' value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} className='h-11 rounded-lg border border-line bg-page px-2 text-xs text-ink'>
                <option value='active'>Active</option><option value='all'>All</option><option value='closed'>Completed</option>
            </select>
            <button type='button' title='Refresh monitored actions' aria-label='Refresh monitored actions' onClick={()=>{void reload()}} className='flex h-11 w-11 items-center justify-center rounded-lg border border-line text-brand'><RefreshCw className='h-4 w-4'/></button>
        </div>
        {error&&<p role='alert' className='rounded-xl bg-red-500/10 p-3 text-xs text-red-600'>{error}</p>}
        {!visible.length&&<p className='rounded-xl border border-line bg-panel p-4 text-xs text-muted'>No {filter==='active'?'active ':''}monitored actions {mode==='mine'?'assigned to you':'requested by you'}.</p>}
        {visible.map(a=>{
            const mine=a.assignments.find(x=>x.uid===uid);
            const expanded=open===a.id;
            const overdue=!!a.deadline&&a.deadline<dueToday&&mode==='mine'&&mine?.status!=='closed'&&!mine?.acknowledgedAt;
            const completed=a.assignments.filter(x=>!!x.acknowledgedAt).length;
            return <article key={a.id} className='overflow-hidden rounded-xl border border-line bg-panel'>
                <button type='button' onClick={()=>{setOpen(expanded?'':a.id);setNote('');setStatusDraft(s=>({...s,[a.id]:mine?.status==='closed'?'closed':'open'}))}} className='flex min-h-20 w-full items-center gap-3 p-3 text-left'>
                    <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'><CheckCheck className='h-5 w-5'/></span>
                    <span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold text-ink'>{a.header||a.title}</span>
                        <span className='mt-1 block line-clamp-2 whitespace-pre-wrap text-xs text-soft'>{plainRefs(a.body||a.description||'')||'No description recorded'}</span>
                        <span className='mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted'><span className='font-semibold text-brand'>{actionLabel(a,uid,mode)}</span><span>·</span><CalendarDays className='h-3.5 w-3.5'/>{a.deadline?'Due '+a.deadline:'No due date'}</span></span>
                    {overdue&&<span className='rounded-full bg-red-600/10 px-2 py-1 text-[11px] font-bold text-red-500'>Overdue</span>}
                    {expanded?<ChevronUp className='h-4 w-4 text-brand'/>:<ChevronDown className='h-4 w-4 text-brand'/>}
                </button>
                {expanded&&<div className='space-y-3 border-t border-line p-3 text-xs'>
                    {(a.body||a.description)&&<p className='whitespace-pre-wrap text-sm text-ink'>{plainRefs(a.body||a.description||'')}</p>}
                    <p className='flex items-center gap-2 text-muted'><CalendarDays className='h-4 w-4'/> Deadline: {a.deadline||'Not specified'}</p>
                    {(a.description||a.body||'').includes('[[')&&<RecordCards text={a.description||a.body||''} compact/>}
                    {a.source==='workflow'?<div className='space-y-2'>
                        <p className='font-semibold text-brand'>{actionLabel(a,uid,mode)}</p>
                        {a.workflowStage&&<p className='text-ink'>Your step: {a.workflowStage}</p>}
                        <p className='text-muted'>This action was sent by MEMS Workflow. It cannot be accepted, declined or closed here: it closes on its own when the step is completed in {a.workflowLinkLabel||'its module'}.</p>
                        <button type='button' onClick={()=>navigate('organization_home/'+(a.workflowLink||'my_workflow'))} className='inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand px-4 text-xs font-semibold text-onbrand'>Open {a.workflowLinkLabel||'the workflow'} <ArrowRight className='h-4 w-4'/></button>
                    </div>:mode==='mine'&&mine?<>
                        <p className='font-semibold text-brand'>{actionLabel(a,uid,mode)}</p>
                        {mine.reviewNote&&<p className='rounded-lg bg-amber-500/10 p-2 text-amber-600'>{mine.reviewNote}</p>}
                        {(mine.progressNotes||[]).slice(-6).map((n,i)=><p key={i} className='rounded-lg border border-line bg-page p-2'><span className='font-semibold'>{new Date(n.at).toLocaleString()} · </span>{n.note}</p>)}
                        <label className='block text-muted'>Progress note / response<textarea rows={2} maxLength={1400} value={note} onChange={e=>setNote(e.target.value)} className='mt-1 min-h-14 w-full resize-y rounded-lg border border-line bg-page p-2 text-sm text-ink'/></label>
                        <div className='flex flex-wrap gap-2'>
                            {mine.decision==='pending'&&<>
                                <button disabled={!!busy} onClick={()=>{void act('/api/org/actions/respond',{actionId:a.id,decision:'accept'})}} className='min-h-11 rounded-lg bg-brand px-3 text-xs font-semibold text-onbrand'>Accept</button>
                                <button disabled={!!busy||note.trim().length<5} onClick={()=>{void act('/api/org/actions/respond',{actionId:a.id,decision:'review',note})}} className='min-h-11 rounded-lg border border-line px-3 text-xs'>Request clarification</button>
                                <button disabled={!!busy||note.trim().length<5} onClick={()=>{void act('/api/org/actions/respond',{actionId:a.id,decision:'decline',note})}} className='min-h-11 rounded-lg border border-line px-3 text-xs text-red-600'>Decline</button>
                            </>}
                            {mine.decision==='accepted'&&!mine.acknowledgedAt&&<>
                                <label className='w-full text-xs font-semibold text-muted'>Action status
                                    <select value={statusDraft[a.id]||mine.status||'open'} onChange={e=>setStatusDraft(x=>({...x,[a.id]:e.target.value as 'open'|'closed'}))} className='mt-1 min-h-11 w-full rounded-lg border border-line bg-page px-3 text-sm text-ink'>
                                        <option value='open'>Open</option><option value='closed'>Closed — send for acknowledgement</option>
                                    </select>
                                </label>
                                <button disabled={!!busy||((statusDraft[a.id]||mine.status)===mine.status&&!note.trim())} onClick={()=>{void act('/api/org/actions/progress',{actionId:a.id,status:statusDraft[a.id]||mine.status,note})}} className='min-h-11 rounded-lg bg-brand px-4 text-xs font-semibold text-onbrand disabled:opacity-35'>Save status &amp; progress comment</button>
                                <button disabled={!!busy||note.trim().length<5} onClick={()=>{void act('/api/org/actions/progress',{actionId:a.id,status:'canceled',note})}} className='min-h-11 rounded-lg border border-line px-3 text-xs text-red-600'>Cancel with reason</button>
                            </>}
                        </div>
                    </>:<div className='space-y-2'>
                        <p className='font-semibold text-ink'>Group progress · {completed}/{a.assignments.length} acknowledged</p>
                        {a.assignments.map(s=><div key={s.uid} className='flex flex-wrap items-center gap-2 rounded-lg border border-line bg-page p-2'>
                            <span className='min-w-0 flex-1 font-mono text-[11px] text-ink'>{s.uid.slice(0,14)} · {s.acknowledgedAt?'Acknowledged':s.status==='closed'?'Awaiting your confirmation':s.decision==='pending'?'Pending acceptance':s.status}</span>
                            {s.status==='closed'&&!s.acknowledgedAt&&s.decision==='accepted'&&<>
                                <button disabled={!!busy} onClick={()=>{void act('/api/org/actions/acknowledge',{actionId:a.id,uid:s.uid,decision:'acknowledge'})}} className='min-h-11 rounded-lg bg-brand px-2 text-[11px] text-onbrand'>Acknowledge</button>
                                <button disabled={!!busy} onClick={async ()=>{const reason=(await appPrompt('What remains to be completed?'));if(reason&&reason.trim().length>=5)void act('/api/org/actions/acknowledge',{actionId:a.id,uid:s.uid,decision:'return',note:reason})}} className='min-h-11 rounded-lg border border-line px-2 text-[11px] text-ink'>Return</button>
                            </>}
                        </div>)}
                    </div>}
                    {a.source==='chat'&&a.roomId&&<button type='button' onClick={()=>navigate('organization_home/quick/chat/'+a.roomId)} className='min-h-11 text-xs font-semibold text-brand'>Open Chat →</button>}
                    {a.source==='email'&&<button type='button' onClick={()=>navigate('organization_home/mail')} className='min-h-11 text-xs font-semibold text-brand'>Open Email →</button>}
                </div>}
            </article>;
        })}
    </section>;
}
