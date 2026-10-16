import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Camera, FileImage, Plus, Save, Trash2, X, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Spinner } from '../admin/kit';
import RichTable, { type Column } from '../components/RichTable';
import { compressPhoto } from './mntShared';
import { useQuickLeave } from './quickNavigation';

type Status = 'open'|'closed'|'canceled';
type Period = 'mtd'|'ytd'|'all';
type Photo={path:string;url:string};
type Progress={note:string;at:string;by:string;photoPath?:string;photoUrl?:string};
type Personal={
    id:string;action:string;description:string;deadline:string;status:Status;
    cancellationReason:string;photoPath?:string;photoUrl?:string;progressNotes:Progress[];
    createdAt:string;updatedAt:string;closedAt:string;
};
type Assignment={
    uid:string;decision:string;status:string;acknowledgedAt:string;
    reviewNote:string;progressNotes:Progress[];
};
type Monitored={
    id:string;header:string;body:string;title:string;description:string;source:string;
    deadline:string;requesterUid:string;recipientUids:string[];assignments:Assignment[];
    createdAt:string;updatedAt:string;canceled:boolean;photoUrl?:string;
};
type ActionRow={
    id:string;key:string;title:string;description:string;deadline:string;status:string;
    complete:boolean;canceled:boolean;source:string;responsibility:string;
    photoUrl:string;createdAt:string;personal?:Personal;monitored?:Monitored;
};
type Draft={
    id:string;action:string;description:string;deadline:string;status:Status;
    progressNote:string;cancellationReason:string;photoPath:string;photoUrl:string;
};
const empty:Draft={id:'',action:'',description:'',deadline:'',status:'open',progressNote:'',cancellationReason:'',photoPath:'',photoUrl:''};
const field='mt-1 min-h-11 w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none';
const problem=(e:unknown)=>e instanceof Error?e.message:'Could not complete action.';
const freshId=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():'todo_'+Date.now().toString(36)+Math.random().toString(36).slice(2,11);
function monitoredRow(a:Monitored,uid:string):ActionRow{
    const own=a.assignments.find(x=>x.uid===uid);
    const relevant=a.assignments.filter(x=>x.decision!=='declined'&&x.status!=='canceled');
    const allDone=relevant.length>0&&relevant.every(x=>!!x.acknowledgedAt);
    const complete=own?!!own.acknowledgedAt:allDone;
    const canceled=a.canceled||own?.status==='canceled'||own?.decision==='declined';
    const status=canceled?'Canceled':complete?'Closed':own?.status==='closed'
        ?'Awaiting acknowledgement':own?.decision==='pending'?'Awaiting acceptance'
        :own?.decision==='review'?'Clarification':!own&&a.assignments.some(x=>x.status==='closed'&&!x.acknowledgedAt)
        ?'Awaiting acknowledgement':'Open';
    const photo=[...(own?.progressNotes||[])].reverse().find(x=>x.photoUrl)?.photoUrl||a.photoUrl||'';
    return {
        key:'monitored:'+a.id,id:a.id,title:a.header||a.title,description:a.body||a.description||'',
        deadline:a.deadline||'',status,complete,canceled:!!canceled,source:a.source,
        responsibility:own?'Assigned to me': 'Created by me',photoUrl:photo,createdAt:a.createdAt,monitored:a,
    };
}
const inPeriod=(date:string,p:Period)=>{
    if(p==='all')return true;
    const d=new Date(date),now=new Date();
    return !Number.isNaN(d.getTime())&&d.getFullYear()===now.getFullYear()&&(p==='ytd'||d.getMonth()===now.getMonth());
};
function Performance({rows,period,setPeriod}:{rows:ActionRow[];period:Period;setPeriod:(p:Period)=>void}){
    const report=(p:Period)=>{
        const list=rows.filter(row=>inPeriod(row.createdAt,p));
        const closed=list.filter(x=>x.complete).length;
        const canceled=list.filter(x=>x.canceled).length;
        const open=list.length-closed-canceled;
        return {open,closed,canceled,pct:open+closed?Math.round(100*closed/(open+closed)):0};
    };
    const all=(['mtd','ytd','all'] as const).map(p=>({p,...report(p)}));
    const current=report(period),total=current.open+current.closed,circ=2*Math.PI*42;
    return <section aria-label='Action performance charts' className='space-y-3'>
        <div className='grid grid-cols-3 gap-2'>{all.map(s=><button key={s.p} aria-pressed={period===s.p}
            type='button' onClick={()=>setPeriod(s.p)} className={'min-h-24 rounded-xl border p-3 text-left '+(period===s.p?'border-brand bg-brand/10':'border-line bg-panel')}>
            <span className='block text-[10px] font-bold uppercase text-muted'>{s.p==='mtd'?'MTD':s.p==='ytd'?'YTD':'All time'}</span>
            <span className='mt-1 block text-2xl font-bold tabular-nums text-ink'>{s.open+s.closed?s.pct+'%':'—'}</span>
            <span className='text-[10px] text-muted'>{s.closed}/{s.open+s.closed} closed</span>
        </button>)}</div>
        <div className='flex flex-wrap items-center justify-center gap-5 rounded-xl border border-line bg-panel p-3'>
            <div className='relative h-36 w-36 shrink-0'>
                <svg viewBox='0 0 110 110' role='img' aria-label={current.pct+' percent completed'} className='h-full w-full -rotate-90'>
                    <circle cx='55' cy='55' r='42' fill='none' stroke='rgb(var(--c-line))' strokeWidth='12'/>
                    {total>0&&<circle cx='55' cy='55' r='42' fill='none' stroke='#f59e0b' strokeWidth='12'/>}
                    {current.closed>0&&<circle cx='55' cy='55' r='42' fill='none' stroke='rgb(var(--c-brand))' strokeWidth='12' strokeDasharray={circ*current.closed/total+' '+circ}/>}
                </svg>
                <span className='absolute inset-0 flex flex-col items-center justify-center'><strong className='text-3xl text-ink'>{total?current.pct+'%':'—'}</strong><small className='text-muted'>closed</small></span>
            </div>
            <div className='grid grid-cols-3 gap-4 text-center sm:grid-cols-1 sm:text-left'>
                <span><strong className='block text-xl text-amber-500'>{current.open}</strong><small className='text-muted'>Open</small></span>
                <span><strong className='block text-xl text-brand'>{current.closed}</strong><small className='text-muted'>Closed</small></span>
                <span><strong className='block text-xl text-muted'>{current.canceled}</strong><small className='text-muted'>Canceled</small></span>
            </div>
            <p className='w-full text-center text-[10px] text-muted'>Every action is counted once. Requested work is closed only after acknowledgement.</p>
        </div>
    </section>;
}
export default function QuickActions({uid}:{uid:string}){
    const [personal,setPersonal]=useState<Personal[]>([]);
    const [mine,setMine]=useState<Monitored[]>([]);
    const [sent,setSent]=useState<Monitored[]>([]);
    const [loading,setLoading]=useState(true);
    const [busy,setBusy]=useState(false);
    const [uploading,setUploading]=useState(false);
    const [error,setError]=useState('');
    const [info,setInfo]=useState('');
    const [showClosed,setShowClosed]=useState(false);
    const [showCanceled,setShowCanceled]=useState(false);
    const [period,setPeriod]=useState<Period>('all');
    const [tab,setTab]=useState<'dashboard'|'table'>('dashboard');
    const [selected,setSelected]=useState('');
    const [editor,setEditor]=useState(false);
    const [draft,setDraft]=useState<Draft>(empty);
    const [note,setNote]=useState('');
    const [state,setState]=useState<'open'|'closed'>('open');
    const [progressPhoto,setProgressPhoto]=useState<Photo|null>(null);
    const reload=useCallback(async()=>{
        const result=await Promise.allSettled([
            callBackend<{items:Personal[]}>('/api/org/quick/todo/list'),
            callBackend<{actions:Monitored[]}>('/api/org/actions/list'),
            callBackend<{actions:Monitored[]}>('/api/org/actions/sent'),
        ]);
        if(result[0].status==='fulfilled')setPersonal(result[0].value.items);
        if(result[1].status==='fulfilled')setMine(result[1].value.actions);
        if(result[2].status==='fulfilled')setSent(result[2].value.actions);
        if(result.some(x=>x.status==='rejected'))setError('Some action sources could not be loaded. Retry refresh.');
        else setError('');
        setLoading(false);
    },[]);
    useEffect(()=>{void reload();const t=setInterval(()=>{if(document.visibilityState==='visible')void reload()},30000);return()=>clearInterval(t)},[reload]);
    const rows=useMemo(()=>{
        const one=new Map<string,Monitored>();
        for(const a of [...sent,...mine])one.set(a.id,a);
        const result:ActionRow[]=personal.map(a=>({
            id:a.id,key:'personal:'+a.id,title:a.action,description:a.description||'',deadline:a.deadline||'',
            status:a.status==='closed'?'Closed':a.status==='canceled'?'Canceled':'Open',
            complete:a.status==='closed',canceled:a.status==='canceled',source:'todo',responsibility:'My own',
            photoUrl:a.photoUrl||'',createdAt:a.createdAt,personal:a,
        }));
        for(const item of one.values())result.push(monitoredRow(item,uid));
        return result.sort((a,b)=>(a.complete?1:0)-(b.complete?1:0)||(a.deadline||'9999').localeCompare(b.deadline||'9999'));
    },[personal,mine,sent,uid]);
    const visible=rows.filter(row=>(showClosed||!row.complete)&&(showCanceled||!row.canceled));
    const picked=rows.find(row=>row.key===selected);
    const assignment=picked?.monitored?.assignments.find(a=>a.uid===uid);
    const upload=async(event:ChangeEvent<HTMLInputElement>,done:(p:Photo)=>void)=>{
        const file=event.target.files?.[0];event.target.value='';
        if(!file)return;
        setUploading(true);setError('');
        try{
            const data=await compressPhoto(file);
            const r=await callBackend<Photo>('/api/org/actions/photo',{data});
            done(r);
        }catch(e){setError(problem(e))}finally{setUploading(false)}
    };
    const newTask=()=>{setDraft({...empty});setSelected('');setEditor(true);setTab('table');setError('');setInfo('')};
    const editTask=(a:Personal)=>{setDraft({
        id:a.id,action:a.action,description:a.description||'',deadline:a.deadline||'',
        status:a.status,progressNote:'',cancellationReason:a.cancellationReason||'',
        photoPath:a.photoPath||'',photoUrl:a.photoUrl||'',
    });setSelected('');setEditor(true)};
    const save=async()=>{
        if(draft.action.trim().length<3||draft.description.trim().length<3){setError('An action needs a header and description (at least 3 characters each).');return false}
        if(draft.status==='canceled'&&draft.cancellationReason.trim().length<5){setError('Give a cancellation reason.');return false}
        setBusy(true);setError('');
        try{
            await callBackend('/api/org/quick/todo/save',{
                id:draft.id||freshId(),action:draft.action,description:draft.description,
                deadline:draft.deadline,status:draft.status,cancellationReason:draft.cancellationReason,
                progressNote:draft.progressNote,photoPath:draft.photoPath,
            });
            setEditor(false);setDraft({...empty});await reload();setInfo('Action saved.');return true;
        }catch(e){setError(problem(e));return false}finally{setBusy(false)}
    };
    useQuickLeave(async()=>{
        if(!editor||!draft.action.trim()||draft.action.trim().length<3||draft.description.trim().length<3)return true;
        return await save();
    });
    const update=async(endpoint:string,body:Record<string,unknown>)=>{
        setBusy(true);setError('');setInfo('');
        try{
            await callBackend(endpoint,body);
            setNote('');setProgressPhoto(null);await reload();
            setInfo('Action progress synchronized to its source.');
        }catch(e){setError(problem(e))}finally{setBusy(false)}
    };
    const columns:Column<ActionRow>[]=[
        {key:'title',label:'Action',value:a=>a.title,render:a=><span className='flex min-w-[120px] items-center gap-2 font-semibold'>{a.photoUrl&&<FileImage className='h-4 w-4 shrink-0 text-brand'/>}{a.title}</span>},
        {key:'description',label:'Description',value:a=>a.description,render:a=><span className='line-clamp-2 min-w-32 max-w-64 text-xs'>{a.description||'—'}</span>},
        {key:'deadline',label:'Due date',type:'date',value:a=>a.deadline,render:a=><span className={a.deadline&&a.deadline<new Date().toLocaleDateString('en-CA')&&!a.complete?'font-semibold text-red-500':''}>{a.deadline||'—'}</span>},
        {key:'status',label:'Status',value:a=>a.status,render:a=><span className={'rounded-full px-2 py-1 text-xs font-semibold '+(a.complete?'bg-emerald-500/10 text-emerald-600':a.status==='Open'?'bg-amber-500/10 text-amber-600':'bg-brand/10 text-brand')}>{a.status}</span>},
        {key:'responsibility',label:'Type',value:a=>a.responsibility},
        {key:'photo',label:'Photo',value:a=>a.photoUrl?'Photo':'',render:a=>a.photoUrl?<FileImage className='h-4 w-4 text-brand'/>:null},
        {key:'source',label:'Source',value:a=>a.source,hidden:true},
        {key:'created',label:'Created',type:'date',value:a=>a.createdAt,hidden:true},
    ];
    return <div className='space-y-4 pb-8'>
        <header className='flex items-center justify-between gap-2'>
            <span><h2 className='text-lg font-bold text-ink'>My To-do</h2><p className='text-xs text-muted'>My own, assigned and requested actions</p></span>
        </header>
        <nav aria-label='My To-do tabs' className='grid grid-cols-2 gap-2 rounded-xl border border-line bg-panel p-1'>
            {(['dashboard','table'] as const).map(value=><button key={value} type='button' onClick={()=>setTab(value)} aria-current={tab===value?'page':undefined}
                className={'min-h-12 rounded-lg text-sm font-semibold '+(tab===value?'bg-brand text-onbrand':'text-muted')}>{value==='dashboard'?'Dashboard':'Action table'}</button>)}
        </nav>
        {tab==='dashboard'&&<Performance rows={rows} period={period} setPeriod={setPeriod}/>}
        {tab==='dashboard'&&<div className='flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-panel p-3'>
            <p className='text-xs text-muted'>Performance includes active and completed work across every source, counting each action once.</p>
            <button type='button' onClick={()=>setTab('table')} className='min-h-10 rounded-lg bg-brand px-4 text-xs font-semibold text-onbrand'>View action table →</button>
        </div>}
        {error&&<Alert tone='error'>{error}</Alert>}
        {info&&<Alert tone='success'>{info}</Alert>}
        {tab==='table'&&<div className='flex items-center justify-between gap-3'>
            <p className='min-w-0 text-xs text-muted'>Select an action row for status, photos and progress.</p>
            <button type='button' title='Add new action' aria-label='Add new action' onClick={newTask}
                className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-onbrand shadow-sm'><Plus className='h-6 w-6'/></button>
        </div>}
        {tab==='table'&&(loading?<Spinner/>:<RichTable<ActionRow> id='quick-my-consolidated-actions' tabKey='To-do'
            title='Consolidated action list' columns={columns} rows={visible} rowKey={row=>row.key}
            onRowClick={row=>{setSelected(row.key);setEditor(false);setNote('');setProgressPhoto(null);
                setState(row.monitored?.assignments.find(a=>a.uid===uid)?.status==='closed'?'closed':'open')}}
            fileName='MEMS_Consolidated_Actions.xlsx' height='h-[min(54dvh,560px)]'
            empty='No active actions. Select Show closed to view completed items.'
            actions={<div className='flex flex-wrap items-center gap-2'>
                <label className='flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-xs text-ink'>
                    <input type='checkbox' checked={showClosed} onChange={e=>setShowClosed(e.target.checked)} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>Show closed ({rows.filter(x=>x.complete).length})</label>
                <label className='flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-xs text-ink'>
                    <input type='checkbox' checked={showCanceled} onChange={e=>setShowCanceled(e.target.checked)} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>Canceled</label>
                <button aria-label='Refresh actions' onClick={()=>{void reload()}} className='flex h-10 w-10 items-center justify-center rounded-lg border border-line text-brand'><RefreshCw className='h-4 w-4'/></button>
            </div>}/>)}
        {editor&&<section role='dialog' aria-modal='true' aria-label='Full-screen personal action form' className='fixed inset-0 z-[98] flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink'>
            <div className='flex min-h-16 shrink-0 items-center justify-between border-b border-line bg-panel px-4 pt-[env(safe-area-inset-top)]'>
                <span><strong className='block text-base'>{draft.id?'Edit action':'New action'}</strong><span className='block text-xs text-muted'>My To-do · personal action</span></span>
                <button type='button' aria-label='Close full-screen action form' onClick={()=>setEditor(false)} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-brand'><X className='h-5 w-5'/></button>
            </div>
            <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:mx-auto sm:w-full sm:max-w-3xl'>
            <header className='flex items-center justify-between'><h3 className='font-semibold text-ink'>{draft.id?'Edit personal action':'New personal action'}</h3>
                <button aria-label='Close editor' onClick={()=>setEditor(false)}><X className='h-5 w-5 text-muted'/></button></header>
            <label className='block text-xs font-semibold text-muted'>Action header<input value={draft.action} onChange={e=>setDraft(d=>({...d,action:e.target.value}))} maxLength={240} className={field}/></label>
            <label className='block text-xs font-semibold text-muted'>Description<textarea value={draft.description} onChange={e=>setDraft(d=>({...d,description:e.target.value}))} maxLength={2400} rows={3} className={field+' resize-y'}/></label>
            <div className='grid gap-2 sm:grid-cols-2'>
                <label className='block text-xs font-semibold text-muted'>Due date<input type='date' value={draft.deadline} onChange={e=>setDraft(d=>({...d,deadline:e.target.value}))} className={field}/></label>
                <label className='block text-xs font-semibold text-muted'>Status<select value={draft.status} onChange={e=>setDraft(d=>({...d,status:e.target.value as Status}))} className={field}>
                    <option value='open'>Open</option><option value='closed'>Closed</option><option value='canceled'>Canceled</option>
                </select></label>
            </div>
            {draft.status==='canceled'&&<label className='block text-xs font-semibold text-muted'>Cancellation reason<textarea rows={2} value={draft.cancellationReason} onChange={e=>setDraft(d=>({...d,cancellationReason:e.target.value}))} className={field}/></label>}
            <label className='block text-xs font-semibold text-muted'>Progress comment<textarea rows={2} value={draft.progressNote} onChange={e=>setDraft(d=>({...d,progressNote:e.target.value}))} className={field}/></label>
            <label className='flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-page p-3 text-xs font-semibold text-brand'>
                <Camera className='h-4 w-4'/>{uploading?'Uploading photo…':'Attach action photo'}
                <input type='file' accept='image/*' capture='environment' className='sr-only' disabled={busy||uploading}
                    onChange={e=>{void upload(e,p=>setDraft(d=>({...d,photoPath:p.path,photoUrl:p.url})))}}/>
            </label>
            {draft.photoUrl&&<div className='flex items-center gap-3'><img src={draft.photoUrl} alt='Action photo' className='h-24 w-24 rounded-lg object-cover'/>
                <button onClick={()=>setDraft(d=>({...d,photoPath:'',photoUrl:''}))} className='text-xs text-red-500'>Remove</button></div>}
            {draft.id&&personal.find(x=>x.id===draft.id)?.progressNotes.map((p,i)=><div key={p.at+i} className='rounded-lg border border-line p-2 text-xs text-ink'>
                {p.note&&<p>{p.note}</p>}{p.photoUrl&&<img src={p.photoUrl} alt='Action progress' className='mt-2 h-24 w-24 rounded-lg object-cover'/>}
                <small className='text-muted'>{new Date(p.at).toLocaleString()}</small>
            </div>)}
            </div>
            <footer className='shrink-0 border-t border-line bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-[max(12px,calc((100%-768px)/2))]'>
                <Button busy={busy} disabled={busy||uploading} onClick={()=>{void save()}} className='min-h-14 w-full'><Save className='h-4 w-4'/> Save action</Button>
            </footer>
        </section>}
        {picked&&!editor&&<section className='fixed inset-0 z-[82] space-y-3 overflow-y-auto bg-page p-4 pb-20 text-ink sm:static sm:rounded-xl sm:border sm:border-brand/40 sm:bg-panel sm:pb-4' aria-label='Action detail editor'>
            <header className='flex items-center justify-between gap-2'><div><h3 className='font-semibold text-ink'>{picked.title}</h3>
                <p className='text-xs text-muted'>Due {picked.deadline||'—'} · {picked.status}</p></div>
                <button aria-label='Close action detail' onClick={()=>setSelected('')}><X className='h-5 w-5 text-muted'/></button></header>
            <p className='whitespace-pre-wrap text-sm text-ink'>{picked.description}</p>
            {picked.photoUrl&&<img src={picked.photoUrl} alt='Action attachment' className='max-h-44 w-full rounded-xl object-contain'/>}
            {picked.personal&&<div className='flex flex-wrap gap-2'>
                <Button onClick={()=>editTask(picked.personal!)}>Edit action</Button>
                {picked.personal.status==='open'&&<button className='min-h-10 rounded-lg border border-line px-3 text-xs text-brand'
                    onClick={()=>{void callBackend('/api/org/quick/todo/save',{id:picked.id,action:picked.title,description:picked.description,
                        deadline:picked.deadline,status:'closed',photoPath:picked.personal?.photoPath||''}).then(reload).catch(e=>setError(problem(e)))}}>Mark closed</button>}
                <button className='flex min-h-10 items-center gap-1 rounded-lg border border-line px-3 text-xs text-red-500'
                    onClick={()=>{if(!window.confirm('Delete this personal action?'))return;
                        void callBackend('/api/org/quick/todo/delete',{id:picked.id}).then(()=>{setSelected('');void reload()}).catch(e=>setError(problem(e)))}}>
                    <Trash2 className='h-4 w-4'/> Delete</button>
            </div>}
            {picked.monitored&&<>
                {assignment?.reviewNote&&<p className='rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700'>{assignment.reviewNote}</p>}
                {(assignment?.progressNotes||[]).slice(-12).map((n,i)=><div key={n.at+i} className='rounded-lg border border-line bg-page p-2 text-xs'>
                    <p className='whitespace-pre-wrap text-ink'>{n.note}</p>
                    {n.photoUrl&&<img src={n.photoUrl} alt='Progress attachment' className='mt-1 max-h-40 rounded-lg object-contain'/>}
                    <span className='text-[10px] text-muted'>{new Date(n.at).toLocaleString()}</span>
                </div>)}
                {assignment&&assignment.decision==='pending'&&<Button disabled={busy} onClick={()=>{void update('/api/org/actions/respond',{actionId:picked.id,decision:'accept'})}}>Accept assignment</Button>}
                {assignment&&assignment.decision==='accepted'&&!assignment.acknowledgedAt&&<>
                    <label className='block text-xs font-semibold text-muted'>My status<select value={state} onChange={e=>setState(e.target.value as 'open'|'closed')} className={field}>
                        <option value='open'>Open</option><option value='closed'>Closed — requester acknowledgement required</option></select></label>
                    <label className='block text-xs font-semibold text-muted'>Progress comment<textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} maxLength={1400} className={field}/></label>
                    <label className='flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-page p-3 text-xs text-brand'>
                        <Camera className='h-4 w-4'/> {uploading?'Uploading…':'Attach progress photo'}
                        <input type='file' accept='image/*' capture='environment' className='sr-only' disabled={busy||uploading}
                            onChange={e=>{void upload(e,setProgressPhoto)}}/></label>
                    {progressPhoto&&<div className='flex items-center gap-2'><img src={progressPhoto.url} alt='New progress photo' className='h-24 w-24 rounded-xl object-cover'/>
                        <button className='text-xs text-red-500' onClick={()=>setProgressPhoto(null)}>Remove</button></div>}
                    <Button disabled={busy||uploading||(!note.trim()&&!progressPhoto&&state===assignment.status)}
                        onClick={()=>{void update('/api/org/actions/progress',{actionId:picked.id,status:state,note,photoPath:progressPhoto?.path||''})}}>Save progress and status</Button>
                </>}
                {picked.monitored.requesterUid===uid&&<div className='space-y-2 border-t border-line pt-3'>
                    <p className='text-xs font-semibold text-ink'>Recipient progress · {picked.monitored.assignments.filter(a=>a.acknowledgedAt).length}/{picked.monitored.assignments.length} acknowledged</p>
                    {picked.monitored.assignments.map(a=><div key={a.uid} className='flex flex-wrap items-center gap-2 rounded-lg bg-page p-2'>
                        <span className='min-w-0 flex-1 text-xs text-ink'>{a.uid.slice(0,12)} · {a.acknowledgedAt?'Acknowledged':a.status==='closed'?'Needs acknowledgement':a.decision==='pending'?'Pending acceptance':a.status}</span>
                        {a.status==='closed'&&!a.acknowledgedAt&&a.decision==='accepted'&&<>
                            <button className='min-h-9 rounded-lg bg-brand px-2 text-xs text-onbrand' disabled={busy}
                                onClick={()=>{void update('/api/org/actions/acknowledge',{actionId:picked.id,uid:a.uid,decision:'acknowledge'})}}>Acknowledge</button>
                            <button className='min-h-9 rounded-lg border border-line px-2 text-xs' disabled={busy}
                                onClick={()=>{const reason=window.prompt('What still needs to be done?');if(reason&&reason.trim().length>=5)void update('/api/org/actions/acknowledge',{actionId:picked.id,uid:a.uid,decision:'return',note:reason})}}>Return</button>
                        </>}
                    </div>)}
                </div>}
            </>}
        </section>}
    </div>;
}
