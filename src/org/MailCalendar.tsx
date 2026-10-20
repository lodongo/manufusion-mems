import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import type { WorkGroup, MailColleague } from './MailWorkGroups';
import ActionPhotoInput from './ActionPhotoInput';
import { appConfirm } from '../components/dialogs';

interface CalEvent {
    id:string;title:string;description:string;location:string;startsAt:string;endsAt:string;
    recurrence:string;allDay:boolean;attendeeUids:string[];attendeeStatus:Record<string,string>;
    organizerUid:string;reminderMinutes:number;
}
type Form={id:string;title:string;description:string;location:string;startsAt:string;endsAt:string;allDay:boolean;recurrence:string;attendeeUids:string[];reminderMinutes:number};
const formatLocal=(value:string)=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const off=d.getTimezoneOffset()*60000;return new Date(d.getTime()-off).toISOString().slice(0,16);};
const monthLabel=(day:Date)=>day.toLocaleDateString(undefined,{month:'long',year:'numeric'});
const dayKey=(day:Date)=>[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');
const startOfDay=(d:Date)=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
function newForm(day=new Date()):Form{
    const begin=new Date(day);begin.setHours(9,0,0,0);
    const end=new Date(begin.getTime()+60*60000);
    return {id:'',title:'',description:'',location:'',startsAt:formatLocal(begin.toISOString()),endsAt:formatLocal(end.toISOString()),allDay:false,recurrence:'none',attendeeUids:[],reminderMinutes:15};
}
const field='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink outline-none';
interface ActionMarker {
    id:string;actionId:string;title:string;description:string;date:string;
    kind:'due'|'closed';status:string;source:string;roomId:string;
}
const actionsOnDate=(items:ActionMarker[],day:Date)=>items.filter(item=>item.date===dayKey(day));

function eventsOnDate(events:CalEvent[],day:Date):CalEvent[]{
    const d=startOfDay(day).getTime();
    return events.filter(event=>{
        const start=new Date(event.startsAt),end=new Date(event.endsAt);
        if(!Number.isFinite(start.getTime()))return false;
        const begin=startOfDay(start).getTime(),finish=startOfDay(end).getTime();
        if(event.recurrence==='none')return d>=begin&&d<=finish;
        if(d<begin)return false;
        const days=Math.round((d-begin)/86400_000);
        if(event.recurrence==='daily')return true;
        if(event.recurrence==='weekly')return days%7===0;
        if(event.recurrence==='monthly')return day.getDate()===start.getDate();
        return false;
    }).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
}
export default function MailCalendar({uid,people,groups,onClose}:{uid:string;people:MailColleague[];groups:WorkGroup[];onClose:()=>void}){
    const [events,setEvents]=useState<CalEvent[]>([]);
    const [tab,setTab]=useState<'dashboard'|'calendar'>('dashboard');
    const [actionMarkers,setActionMarkers]=useState<ActionMarker[]>([]);
    const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
    const [chosenDay,setChosenDay]=useState(()=>new Date());
    const [view,setView]=useState<'month'|'agenda'>('month');
    const [form,setForm]=useState<Form|null>(null);
    const [selected,setSelected]=useState<CalEvent|null>(null);
    const [activity,setActivity]=useState<Array<{id:string;actionTitle:string;activity:string;note:string;actorUid:string;createdAt:string}>>([]);
    const [propose,setPropose]=useState(false);
    const [actionTitle,setActionTitle]=useState('');
    const [actionNote,setActionNote]=useState('');
    const [actionPhotoPath,setActionPhotoPath]=useState('');
    const [actionDeadline,setActionDeadline]=useState('');
    const [actionUids,setActionUids]=useState<string[]>([]);
    const [search,setSearch]=useState('');
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState('');
    const [info,setInfo]=useState('');
    const reload=useCallback(async()=>{
        const results=await Promise.allSettled([
            callBackend<{events:CalEvent[]}>('/api/org/mail/calendar/list'),
            callBackend<{items:ActionMarker[]}>('/api/org/actions/calendar'),
        ]);
        if(results[0].status==='fulfilled')setEvents(results[0].value.events);
        if(results[1].status==='fulfilled')setActionMarkers(results[1].value.items);
        if(results.some(r=>r.status==='rejected'))setError('Some calendar information is temporarily unavailable. Refresh to try again.');
        else setError('');
    },[]);
    useEffect(()=>{void reload();const timer=setInterval(()=>{if(document.visibilityState==='visible')void reload()},30000);return()=>clearInterval(timer)},[reload]);
    useEffect(()=>{
        let alive=true;
        if(!selected){setActivity([]);return;}
        void callBackend<{items:typeof activity}>('/api/org/mail/calendar/activity',{id:selected.id})
            .then(r=>{if(alive)setActivity(r.items)}).catch(()=>{if(alive)setActivity([])});
        return()=>{alive=false};
    },[selected?.id]);
    const first=month.getDay()===0?6:month.getDay()-1;
    const firstDay=new Date(month.getFullYear(),month.getMonth(),1-first);
    const days=Array.from({length:42},(_,i)=>new Date(firstDay.getFullYear(),firstDay.getMonth(),firstDay.getDate()+i));
    const [agendaEvents,agendaUntil]=useMemo(()=>{
        const list=Array.from({length:45},(_,i)=>new Date(chosenDay.getFullYear(),chosenDay.getMonth(),chosenDay.getDate()+i))
            .flatMap(d=>eventsOnDate(events,d).map(ev=>({day:d,event:ev})));
        return [list,new Date(chosenDay.getTime()+45*86400_000)];
    },[events,chosenDay]);
    const mySelection=eventsOnDate(events,chosenDay);
    const myActionSelection=actionsOnDate(actionMarkers,chosenDay);
    const todayLocal=dayKey(new Date());
    const overdue=actionMarkers.filter(a=>a.kind==='due'&&a.date<todayLocal&&a.status!=='closed'&&a.status!=='acknowledged').length;
    const dueToday=actionMarkers.filter(a=>a.kind==='due'&&a.date===todayLocal&&a.status!=='closed'&&a.status!=='acknowledged').length;
    const upcoming=actionMarkers.filter(a=>a.kind==='due'&&a.date>=todayLocal&&a.date<=dayKey(new Date(Date.now()+7*86400_000))&&a.status!=='closed').length;
    const overlapping=form?events.filter(ev=>ev.id!==form.id&&Date.parse(ev.startsAt)<Date.parse(form.endsAt)&&Date.parse(ev.endsAt)>Date.parse(form.startsAt)):[];
    const dueAtMeeting=form?actionMarkers.filter(a=>a.kind==='due'&&a.date===form.startsAt.slice(0,10)&&a.status!=='closed').length:0;
    const openCreate=(day=chosenDay)=>{setForm(newForm(day));setSelected(null);setPropose(false);setActionTitle('');setActionUids([]);setActionPhotoPath('');setError('');};
    const upcomingMeetings=events.filter(ev=>Date.parse(ev.endsAt)>=Date.now()).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
    const nextWeekEvents=events.filter(ev=>Date.parse(ev.startsAt)>=Date.now()&&Date.parse(ev.startsAt)<=Date.now()+7*86400_000);
    const myInvites=events.filter(ev=>ev.organizerUid!==uid&&ev.attendeeUids.includes(uid)&&ev.attendeeStatus?.[uid]!=='declined');
    const awaitingRsvp=myInvites.filter(ev=>!ev.attendeeStatus?.[uid]||ev.attendeeStatus?.[uid]==='pending');
    const confirmedClosure=actionMarkers.filter(a=>a.kind==='closed').length;
    const edit=(event:CalEvent)=>{
        setForm({id:event.id,title:event.title,description:event.description,location:event.location,
            startsAt:formatLocal(event.startsAt),endsAt:formatLocal(event.endsAt),
            recurrence:event.recurrence,allDay:event.allDay,attendeeUids:event.attendeeUids,reminderMinutes:event.reminderMinutes||0});
        setSelected(null);setError('');setPropose(false);setActionUids([]);
    };
    const save=async()=>{
        if(!form)return;
        if(propose&&(actionTitle.trim().length<3||actionNote.trim().length<3||!actionUids.length)){setError('A proposed action requires a header, description and assigned participants.');return;}
        setBusy(true);setError('');setInfo('');
        try{
            const r=await callBackend<{event:CalEvent}>('/api/org/mail/calendar/save',{
                ...form,startsAt:new Date(form.startsAt).toISOString(),endsAt:new Date(form.endsAt).toISOString(),
            });
            if(propose){
                if(!actionTitle.trim()||!actionUids.length)throw new Error('Calendar event saved. To propose an action, enter its title and assign colleagues.');
                await callBackend('/api/org/actions/create',{source:'calendar',sourceId:r.event.id,title:actionTitle,
                    description:actionNote,deadline:actionDeadline,recipientUids:actionUids,photoPath:actionPhotoPath});
            }
            setInfo(propose?'Calendar event and monitored action created.':'Calendar event saved.');
            setForm(null);setActionPhotoPath('');await reload();
        }catch(e){setError(e instanceof Error?e.message:'Could not save the calendar event.');}
        finally{setBusy(false);}
    };
    const remove=async(ev:CalEvent)=>{
        if(!(await appConfirm('Delete this calendar event for everyone invited?')))return;
        setBusy(true);
        try{await callBackend('/api/org/mail/calendar/delete',{id:ev.id});setSelected(null);await reload();}
        catch(e){setError(e instanceof Error?e.message:'Could not delete event.');}
        finally{setBusy(false);}
    };
    const rsvp=async(ev:CalEvent,decision:string)=>{
        setBusy(true);
        try{await callBackend('/api/org/mail/calendar/rsvp',{id:ev.id,decision});setSelected(null);await reload();}
        catch(e){setError(e instanceof Error?e.message:'Cannot respond to invitation.');}
        finally{setBusy(false);}
    };
    const selectGroup=(groupId:string)=>{
        const g=groups.find(g=>g.id===groupId);
        if(g&&form)setForm({...form,attendeeUids:[...new Set([...form.attendeeUids,...g.memberUids.filter(id=>id!==uid)])]});
    };
    const members=people.filter(p=>p.uid!==uid&&(p.name+' '+p.email).toLowerCase().includes(search.toLowerCase()));
    return <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-page text-ink'>
        <header className='flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2'>
            <CalendarDays className='h-5 w-5 text-brand'/><h2 className='min-w-0 flex-1 truncate text-base font-bold'>Calendar</h2>
            {tab==='calendar'&&<><button type='button' onClick={()=>setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))} className='min-h-11 rounded-lg border border-line px-3 text-xs'>Today</button>
            <button type='button' aria-label='Previous month' onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))} className='min-h-11 px-2'><ChevronLeft className='h-5 w-5'/></button>
            <span className='min-w-24 text-center text-xs font-semibold'>{monthLabel(month)}</span>
            <button type='button' aria-label='Next month' onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))} className='min-h-11 px-2'><ChevronRight className='h-5 w-5'/></button>
            </>}
            <button type='button' title='Refresh' onClick={()=>{void reload()}} className='min-h-11 px-2'><RefreshCw className='h-4 w-4'/></button>
            <button type='button' onClick={()=>openCreate()} aria-label='Add calendar event' className='flex min-h-11 items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand'><Plus className='h-5 w-5'/><span className='hidden sm:inline'>New event</span></button>
        </header>
        <nav aria-label='Calendar tabs' className='grid shrink-0 grid-cols-2 gap-2 border-b border-line bg-panel p-2'>
            {(['dashboard','calendar'] as const).map(value=><button key={value} type='button' onClick={()=>setTab(value)} aria-current={tab===value?'page':undefined}
                className={'min-h-11 rounded-lg text-sm font-semibold '+(tab===value?'bg-brand text-onbrand':'text-muted')}>{value==='dashboard'?'Dashboard':'Calendar'}</button>)}
        </nav>
        {error&&<p role='alert' className='m-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-500'>{error}</p>}
        {info&&<p role='status' className='m-3 rounded-lg bg-brand/10 p-2 text-xs text-brand'>{info}</p>}
        <div className='min-h-0 flex-1 overflow-y-auto p-3 sm:p-5'>
            {tab==='calendar'?<>
            <div className='mb-3 grid grid-cols-3 gap-2' aria-label='Intelligent calendar action overview'>
                <button type='button' onClick={()=>{setChosenDay(new Date());setMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))}} className='rounded-xl border border-line bg-panel p-2 text-left'><span className='block text-lg font-bold text-ink'>{dueToday}</span><span className='text-[11px] text-muted'>Due today</span></button>
                <button type='button' onClick={()=>setView('agenda')} className='rounded-xl border border-line bg-panel p-2 text-left'><span className='block text-lg font-bold text-ink'>{upcoming}</span><span className='text-[11px] text-muted'>Due next 7 days</span></button>
                <button type='button' onClick={()=>setView('agenda')} className='rounded-xl border border-line bg-panel p-2 text-left'><span className={'block text-lg font-bold '+(overdue?'text-red-500':'text-ink')}>{overdue}</span><span className='text-[11px] text-muted'>Overdue</span></button>
            </div>
            <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                <div className='flex rounded-lg border border-line bg-panel p-1'>
                    {(['month','agenda'] as const).map(v=><button type='button' key={v} onClick={()=>setView(v)} className={'min-h-11 rounded-md px-4 text-xs font-semibold '+(view===v?'bg-brand/10 text-brand':'text-muted')}>{v==='month'?'Month':'Agenda'}</button>)}
                </div><span className='text-xs text-muted'>Select any day to see meetings and actions.</span>
            </div>
            {view==='month'&&<div className='grid grid-cols-7 overflow-hidden rounded-xl border border-line bg-panel'>
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><div key={day} className='border-b border-line bg-brand/5 p-2 text-center text-[11px] font-semibold text-muted'>{day}</div>)}
                {days.map((day,i)=>{
                    const dayEvents=eventsOnDate(events,day);
                    const dayActions=actionsOnDate(actionMarkers,day);
                    return <button type='button' key={i} onClick={()=>setChosenDay(day)}
                        className={'min-h-[74px] min-w-0 border-b border-r border-line p-1 text-left sm:min-h-[100px] sm:p-2 '+(dayKey(day)===dayKey(chosenDay)?'bg-brand/10':'')+(day.getMonth()!==month.getMonth()?' opacity-45':'')}>
                        <span className={'inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold '+(dayKey(day)===dayKey(new Date())?'bg-brand text-onbrand':'text-ink')}>{day.getDate()}</span>
                        {dayEvents.slice(0,2).map(ev=><span key={ev.id} className='mt-1 block truncate rounded bg-brand/15 px-1 py-0.5 text-[11px] text-brand'>{ev.title}</span>)}
                        {!!dayActions.length&&<span className={'mt-0.5 block truncate rounded px-1 py-0.5 text-[11px] '+(dayActions.some(a=>a.kind==='due'&&a.status!=='closed')?'bg-amber-500/15 text-amber-600':'bg-emerald-500/15 text-emerald-600')}>{dayActions.length} action{dayActions.length===1?'':'s'}</span>}
                        {dayEvents.length>2&&<span className='block text-[11px] text-muted'>+{dayEvents.length-2}</span>}
                    </button>;
                })}
            </div>}
            {view==='month'?<section className='mt-4 space-y-2'>
                <h3 className='text-sm font-semibold'>{chosenDay.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h3>
                {!mySelection.length&&!myActionSelection.length&&<p className='text-xs text-muted'>No events or action milestones. Tap New event to schedule one.</p>}
                {myActionSelection.map(action=><button type='button' key={action.id} onClick={()=>navigate('organization_home/quick/todo')} className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-amber-500/30 bg-panel px-3 text-left'><span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm '+(action.kind==='closed'?'bg-emerald-500/10 text-emerald-600':'bg-amber-500/10 text-amber-600')}>{action.kind==='closed'?'✓':'!'}</span><span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold text-ink'>{action.title}</span><span className='block truncate text-xs text-muted'>{action.kind==='closed'?'Actual closure':'Closure due'} · {action.description||'Open in My To-do to update progress'}</span></span><ChevronRight className='h-4 w-4 text-brand'/></button>)}
                {mySelection.map(ev=><button type='button' key={ev.id} onClick={()=>setSelected(ev)} className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'><Clock3 className='h-4 w-4 text-brand'/><span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold'>{ev.title}</span><span className='block truncate text-xs text-muted'>{new Date(ev.startsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {ev.location||'Calendar event'}</span></span><ChevronRight className='h-4 w-4 text-brand'/></button>)}
            </section>:<div className='space-y-2'>
                {agendaEvents.map((row,i)=><button type='button' key={row.event.id+'-'+i} onClick={()=>setSelected(row.event)}
                    className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'>
                    <span className='w-14 shrink-0 text-center text-xs font-semibold text-brand'>{row.day.toLocaleDateString([],{month:'short',day:'numeric'})}</span>
                    <span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold'>{row.event.title}</span><span className='block truncate text-xs text-muted'>{new Date(row.event.startsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {row.event.location||'—'}</span></span>
                    <ChevronRight className='h-4 w-4 text-brand'/>
                </button>)}
                {actionMarkers.filter(a=>a.date>=dayKey(chosenDay)&&a.date<=dayKey(new Date(chosenDay.getTime()+45*86400_000))).map(action=><button key={action.id} type='button' onClick={()=>navigate('organization_home/quick/todo')} className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'><span className='w-14 shrink-0 text-center text-xs font-semibold text-brand'>{action.date.slice(5)}</span><span className='min-w-0 flex-1'><span className='block truncate text-sm font-semibold text-ink'>{action.title}</span><span className='block truncate text-xs text-muted'>{action.kind==='closed'?'Closed':'Action due'} · {action.description||'No description'}</span></span><ChevronRight className='h-4 w-4 text-brand'/></button>)}
                {!agendaEvents.length&&!actionMarkers.some(a=>a.date>=dayKey(chosenDay)&&a.date<=dayKey(new Date(chosenDay.getTime()+45*86400_000)))&&<p className='p-6 text-center text-sm text-muted'>No upcoming events or action milestones in the next 45 days.</p>}
            </div>}
            </>:<section className='space-y-4' aria-label='Calendar dashboard'>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    {[
                        {label:'Meetings · 7 days',value:nextWeekEvents.length,alert:false},
                        {label:'Awaiting RSVP',value:awaitingRsvp.length,alert:awaitingRsvp.length>0},
                        {label:'Actions due today',value:dueToday,alert:false},
                        {label:'Overdue actions',value:overdue,alert:overdue>0},
                    ].map(item=><button type='button' key={item.label} onClick={()=>setTab('calendar')}
                        className='rounded-xl border border-line bg-panel p-4 text-left'>
                        <span className={'block text-3xl font-bold tabular-nums '+(item.alert?'text-red-500':'text-ink')}>{item.value}</span>
                        <span className='text-xs text-muted'>{item.label}</span>
                    </button>)}
                </div>
                <section className='space-y-3 rounded-xl border border-line bg-panel p-4'>
                    <h3 className='font-semibold text-ink'>Action closure outlook</h3>
                    <div className='grid grid-cols-3 gap-2 text-center'>
                        <div><strong className='block text-xl text-brand'>{upcoming}</strong><span className='text-[11px] text-muted'>Due in 7 days</span></div>
                        <div><strong className='block text-xl text-emerald-600'>{confirmedClosure}</strong><span className='text-[11px] text-muted'>Closures confirmed</span></div>
                        <div><strong className='block text-xl text-red-500'>{overdue}</strong><span className='text-[11px] text-muted'>Overdue</span></div>
                    </div>
                    <button type='button' onClick={()=>{setTab('calendar');setView('agenda')}} className='min-h-11 w-full rounded-lg border border-line text-xs font-semibold text-brand'>View action and event agenda →</button>
                </section>
                <section className='space-y-2'>
                    <h3 className='text-sm font-semibold text-ink'>Upcoming meetings</h3>
                    {upcomingMeetings.length===0&&<p className='rounded-xl border border-line bg-panel p-4 text-xs text-muted'>No upcoming meetings recorded.</p>}
                    {upcomingMeetings.slice(0,8).map(ev=><button key={ev.id} type='button' onClick={()=>setSelected(ev)}
                        className='flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'>
                        <span className='w-16 shrink-0 text-center text-xs font-semibold text-brand'>{new Date(ev.startsAt).toLocaleDateString([],{month:'short',day:'numeric'})}</span>
                        <span className='min-w-0 flex-1'><strong className='block truncate text-sm text-ink'>{ev.title}</strong><span className='block truncate text-xs text-muted'>{new Date(ev.startsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {ev.location||'Calendar event'}</span></span>
                        <ChevronRight className='h-4 w-4 text-brand'/>
                    </button>)}
                </section>
                <section className='space-y-2'>
                    <h3 className='text-sm font-semibold text-ink'>Upcoming action deadlines</h3>
                    {actionMarkers.filter(a=>a.kind==='due'&&a.date>=todayLocal).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,8).map(a=><button type='button' key={a.id} onClick={()=>navigate('organization_home/quick/todo')}
                        className='flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left'>
                        <span className='w-16 shrink-0 text-xs font-semibold text-brand'>{a.date.slice(5)}</span>
                        <span className='min-w-0 flex-1'><strong className='block truncate text-sm text-ink'>{a.title}</strong><span className='block truncate text-xs text-muted'>{a.description||'Action due'}</span></span>
                        <ChevronRight className='h-4 w-4 text-brand'/>
                    </button>)}
                </section>
            </section>}
        </div>
        {selected&&<div className='fixed inset-0 z-[95] flex items-center justify-center bg-black/55 sm:p-4' role='dialog' aria-modal='true' aria-label='Calendar event'>
            <div className='w-full max-w-lg space-y-3 overflow-y-auto bg-panel p-5 text-ink sm:max-h-[80dvh] sm:rounded-2xl'>
                <div className='flex items-start gap-2'><CalendarDays className='h-5 w-5 text-brand'/><h3 className='min-w-0 flex-1 text-lg font-bold'>{selected.title}</h3>
                    <button type='button' onClick={()=>setSelected(null)} aria-label='Close event'><X className='h-5 w-5'/></button></div>
                <p className='text-sm text-muted'>{new Date(selected.startsAt).toLocaleString()} – {new Date(selected.endsAt).toLocaleString()}</p>
                {!!selected.location&&<p className='text-sm'><MapPin className='mr-1 inline h-4 w-4 text-brand'/>{selected.location}</p>}
                <p className='whitespace-pre-wrap text-sm'>{selected.description}</p>
                <p className='text-xs text-muted'>{selected.attendeeUids.length} invited participants · {selected.recurrence==='none'?'One-time event':'Repeats '+selected.recurrence}</p>
                {!!activity.length&&<div className='max-h-44 space-y-2 overflow-y-auto rounded-xl border border-line bg-page p-3'><h4 className='text-xs font-bold text-ink'>Action updates recorded against this event</h4>{activity.map(row=><div key={row.id} className='border-t border-line pt-2 text-xs'><p className='font-semibold text-ink'>{row.actionTitle} · {row.activity}</p>{row.note&&<p className='whitespace-pre-wrap text-soft'>{row.note}</p>}<p className='text-[11px] text-muted'>{new Date(row.createdAt).toLocaleString()}</p></div>)}</div>}
                {selected.organizerUid===uid?<div className='flex flex-wrap gap-2'>
                    <button type='button' onClick={()=>edit(selected)} className='min-h-11 rounded-lg bg-brand px-4 text-xs font-semibold text-onbrand'>Edit event / propose action</button>
                    <button type='button' disabled={busy} onClick={()=>{void remove(selected)}} className='min-h-11 rounded-lg border border-line px-4 text-xs text-red-500'>Delete</button>
                </div>:<div className='flex flex-wrap gap-2'>{(['accepted','tentative','declined'] as const).map(r=><button type='button' disabled={busy} onClick={()=>{void rsvp(selected,r)}} key={r} className={'min-h-11 rounded-lg border px-3 text-xs capitalize '+(selected.attendeeStatus?.[uid]===r?'border-brand bg-brand/10 text-brand':'border-line')}>{r}</button>)}</div>}
                <button type='button' onClick={()=>setSelected(null)} className='min-h-11 w-full text-xs text-brand'>Close</button>
            </div>
        </div>}
        {form&&<div className='fixed inset-0 z-[96] flex items-center justify-center bg-black/55 sm:p-4' role='dialog' aria-modal='true' aria-label='Edit calendar event'>
            <div className='flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-panel text-ink sm:h-[min(90dvh,870px)] sm:rounded-2xl'>
                <header className='flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4'><CalendarDays className='h-5 w-5 text-brand'/><h3 className='min-w-0 flex-1 font-bold'>{form.id?'Edit':'New'} event</h3><button type='button' onClick={()=>setForm(null)}><X className='h-5 w-5'/></button></header>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4'>
                    <label className='block text-xs font-semibold text-muted'>Title<input className={field} value={form.title} maxLength={160} onChange={e=>setForm({...form,title:e.target.value})}/></label>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                        <label className='block text-xs font-semibold text-muted'>Starts<input className={field} type='datetime-local' value={form.startsAt} onChange={e=>setForm({...form,startsAt:e.target.value})}/></label>
                        <label className='block text-xs font-semibold text-muted'>Ends<input className={field} type='datetime-local' value={form.endsAt} onChange={e=>setForm({...form,endsAt:e.target.value})}/></label>
                    </div>
                    {!!overlapping.length&&<p role='status' className='rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700'>Schedule conflict: {overlapping.length} existing event{overlapping.length===1?'':'s'} overlap this time. Review your agenda before saving.</p>}
                    {!!dueAtMeeting&&<p className='rounded-lg border border-brand/20 bg-brand/5 p-3 text-xs text-muted'>{dueAtMeeting} action deadline{dueAtMeeting===1?' falls':'s fall'} on this meeting date. Consider allowing time for closure.</p>}
                    <label className='flex gap-2 text-xs text-muted'><input type='checkbox' checked={form.allDay} onChange={e=>setForm({...form,allDay:e.target.checked})}/> All-day event</label>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                        <label className='block text-xs font-semibold text-muted'>Location<input className={field} value={form.location} maxLength={200} onChange={e=>setForm({...form,location:e.target.value})}/></label>
                        <label className='block text-xs font-semibold text-muted'>Repeat<select className={field} value={form.recurrence} onChange={e=>setForm({...form,recurrence:e.target.value})}><option value='none'>Does not repeat</option><option value='daily'>Daily</option><option value='weekly'>Weekly</option><option value='monthly'>Monthly</option></select></label>
                    </div>
                    <label className='block text-xs font-semibold text-muted'>Details<textarea className={field+' resize-y'} rows={3} maxLength={2000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
                    <h4 className='flex items-center gap-2 text-xs font-semibold text-ink'><Users className='h-4 w-4 text-brand'/>Invite colleagues ({form.attendeeUids.length})</h4>
                    {!!groups.length&&<select className={field} defaultValue='' aria-label='Add work group to calendar invite' onChange={e=>{selectGroup(e.target.value);e.target.value=''}}><option value=''>Add a work group</option>{groups.map(g=><option value={g.id} key={g.id}>{g.name}</option>)}</select>}
                    <input aria-label='Find meeting attendees' value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search people' className={field}/>
                    <div className='max-h-36 space-y-1 overflow-y-auto'>{members.map(p=><label key={p.uid} className='flex min-h-10 items-center gap-2 rounded-lg border border-line bg-page px-2 text-xs'><input type='checkbox' checked={form.attendeeUids.includes(p.uid)} onChange={e=>setForm({...form,attendeeUids:e.target.checked?[...form.attendeeUids,p.uid]:form.attendeeUids.filter(uid=>uid!==p.uid)})}/><span className='min-w-0 flex-1 truncate'>{p.name} · {p.email}</span></label>)}</div>
                    <label className='flex items-center gap-2 rounded-xl border border-line bg-page p-3 text-xs font-semibold text-ink'><input type='checkbox' checked={propose} onChange={e=>setPropose(e.target.checked)}/> Propose monitored action associated with this event</label>
                    {propose&&<div className='space-y-2 rounded-xl border border-brand/30 bg-brand/5 p-3'>
                        <label className='block text-xs font-semibold text-muted'>Action title<input className={field} value={actionTitle} onChange={e=>setActionTitle(e.target.value)} placeholder='Work to be completed'/></label>
                        <label className='block text-xs font-semibold text-muted'>Action description<textarea rows={2} className={field+' resize-y'} value={actionNote} onChange={e=>setActionNote(e.target.value)}/></label>
                        <label className='block text-xs font-semibold text-muted'>Deadline<input type='date' className={field} value={actionDeadline} onChange={e=>setActionDeadline(e.target.value)}/></label>
                        <ActionPhotoInput value={actionPhotoPath} onChange={setActionPhotoPath} label='Attach action photo'/>
                        <div className='text-xs font-semibold text-muted'>Assign action to meeting participants</div>
                        {form.attendeeUids.map(m=>{const p=people.find(p=>p.uid===m);return <label key={m} className='flex min-h-9 items-center gap-2 text-xs text-ink'><input type='checkbox' checked={actionUids.includes(m)} onChange={e=>setActionUids(old=>e.target.checked?[...old,m]:old.filter(uid=>uid!==m))}/>{p?.name||m}</label>})}
                    </div>}
                    {error&&<p role='alert' className='rounded-lg bg-red-500/10 p-2 text-xs text-red-500'>{error}</p>}
                </div>
                <footer className='shrink-0 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'><button type='button' disabled={busy||form.title.trim().length<3||!form.startsAt||!form.endsAt} onClick={()=>{void save()}} className='flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-xs font-semibold text-onbrand disabled:opacity-40'><Check className='h-4 w-4'/>{busy?'Saving…':propose?'Save event and propose action':'Save event'}</button></footer>
            </div>
        </div>}
    </div>;
}
