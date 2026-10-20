import { useEffect,useMemo,useState } from 'react';
import { Check,CheckCircle2,ClipboardList,MessageSquarePlus,Plus,RefreshCw,Send,ShieldCheck,X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import type { ChatPerson } from './chatTypes';
import ActionPhotoInput from './ActionPhotoInput';
import { appConfirm, appPrompt } from '../components/dialogs';

type Assigned={uid:string;decision:string;status:string;acknowledgedAt?:string;acknowledgementNote?:string;reviewNote?:string;progressNotes?:Array<{note:string;at:string;by:string}>;updatedAt:string};
type Comment={id:string;by:string;text:string;createdAt:string};
interface Action {photoUrl?:string;id:string;roomId:string;requesterUid:string;recipientUids:string[];title:string;description:string;deadline:string;canceled:boolean;cancelReason?:string;createdAt:string;assignments:Assigned[];comments:Comment[]}
interface Poll {id:string;question:string;options:string[];createdBy:string;createdAt:string;closed:boolean;anonymous:boolean;instantResults:boolean;multiple:boolean;hasVoted:boolean;ownVotes:number[];totalVoters:number|null;counts:number[]|null;voters:Array<{uid:string;indices:number[]}>}
const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink';
const failure=(e:unknown)=>e instanceof Error?e.message:'Could not complete this action.';
const nm=(people:ChatPerson[],uid:string)=>people.find(p=>p.uid===uid)?.name||'Colleague';
const stamp=(iso:string)=>{const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString():''};

export function ChatActionsBoard({uid,roomId,people,revision=0,initialCreate=false,directRecipient=''}:{uid:string;roomId?:string;people:ChatPerson[];revision?:number;initialCreate?:boolean;directRecipient?:string}) {
 const [items,setItems]=useState<Action[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState(''),[error,setError]=useState('');
 const [showForm,setShowForm]=useState(initialCreate);
 const [title,setTitle]=useState(''),[description,setDescription]=useState(''),[deadline,setDeadline]=useState('');
 const [photoPath,setPhotoPath]=useState('');
 const [recipients,setRecipients]=useState<string[]>(directRecipient?[directRecipient]:[]);
 const [note,setNote]=useState<Record<string,string>>({});
 const [decisions,setDecisions]=useState<Record<string,'review'|'decline'|''>>({});
 const [status,setStatus]=useState<Record<string,string>>({});
 const [revise,setRevise]=useState<Record<string,boolean>>({});
 const [revisedText,setRevisedText]=useState<Record<string,string>>({});
 const refresh=async()=>{
    const r=await callBackend<{actions:Action[]}>('/api/org/quick/chat/action/list',{roomId:roomId||''});
    setItems(roomId?r.actions:r.actions.filter(a=>a.requesterUid===uid||a.recipientUids.includes(uid)));
    setLoading(false);
 };
 useEffect(()=>{let ok=true;setLoading(true);void refresh().catch(e=>{if(ok)setError(failure(e))}).finally(()=>{if(ok)setLoading(false)});return()=>{ok=false}},[roomId,revision,uid]);
 const apply=async(path:string,body:Record<string,unknown>,success:string)=>{
    setBusy(true);setError('');setMessage('');
    try {await callBackend('/api/org/quick/chat/action/'+path,body);await refresh();setNote({});setMessage(success);return true;}
    catch(e){setError(failure(e));return false}finally{setBusy(false)}
 };
 const available=people.filter(p=>p.uid!==uid);
 const assignmentsForRate=items.filter(a=>!a.canceled).flatMap(a=>a.assignments.filter(v=>v.decision!=='declined'&&v.status!=='canceled'&&(!!roomId||v.uid===uid)));
 const acknowledged=assignmentsForRate.filter(a=>!!a.acknowledgedAt);
 const completionPct=assignmentsForRate.length?Math.round(100*acknowledged.length/assignmentsForRate.length):0;
 const individualRates=Array.from(new Set(assignmentsForRate.map(a=>a.uid))).map(personUid=>{
    const own=assignmentsForRate.filter(a=>a.uid===personUid);
    const closed=own.filter(a=>!!a.acknowledgedAt).length;
    return {uid:personUid,closed,total:own.length,percent:own.length?Math.round(100*closed/own.length):0};
 }).sort((a,b)=>a.percent-b.percent);

 const newAction=async()=>{
    const good=await apply('create',{roomId,title,description,deadline,photoPath,recipientUids:recipients},'Action request sent to the selected colleagues.');
    if(good){setShowForm(false);setTitle('');setDescription('');setDeadline('');setPhotoPath('');setRecipients(directRecipient?[directRecipient]:[])}
 };
 return <section className='flex min-h-0 flex-1 flex-col bg-page'>
    <header className='shrink-0 border-b border-line bg-panel p-3'>
      <div className='flex items-center justify-between gap-2'>
        <div><h3 className='flex items-center gap-2 text-sm font-semibold text-ink'><ClipboardList className='h-4 w-4 text-brand'/> {roomId?'Action tracker':'My chat assignments'}</h3>
        <p className='text-[11px] text-muted'>Monitored Action · recipient completion requires requester acknowledgement</p></div>
        {roomId&&<button type='button' onClick={()=>setShowForm(s=>!s)} className='flex min-h-11 items-center gap-1 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand'><Plus className='h-4 w-4'/>Assign</button>}
      </div>
    </header>
    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-5'>
      {!loading&&items.length>0&&<div className='space-y-2 rounded-xl border border-line bg-panel p-3' aria-label='Monitored action closure rates'>
        <div className='flex items-center justify-between gap-2'>
            <div><p className='text-xs font-semibold text-ink'>{roomId?'Group closure rate':'Monitored closure rate'}</p>
                 <p className='text-[11px] text-muted'>Only requester-acknowledged closures count</p></div>
            <span className='text-xl font-bold tabular-nums text-brand'>{completionPct}%</span>
        </div>
        <div className='h-2 overflow-hidden rounded-full bg-page'><div className='h-full rounded-full bg-brand' style={{width:completionPct+'%'}}/></div>
        <p className='text-[11px] text-muted'>{acknowledged.length} acknowledged of {assignmentsForRate.length} eligible assignments</p>
        {roomId&&individualRates.length>0&&<div className='flex flex-wrap gap-1.5 border-t border-line pt-2'>
            {individualRates.map(p=><span key={p.uid} className='rounded-lg border border-line bg-page px-2 py-1 text-[11px] text-ink'>
               {nm(people,p.uid)} · {p.percent}% ({p.closed}/{p.total})
            </span>)}
        </div>}
      </div>}
      {showForm&&roomId&&<div className='space-y-3 rounded-2xl border border-brand/40 bg-panel p-3'>
        <h4 className='text-sm font-semibold text-ink'>Request an action</h4>
        <label className='block text-xs text-muted'>Action<input className={field+' mt-1'} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder='What needs to be done?'/></label>
        <label className='block text-xs text-muted'>Details<textarea className={field+' mt-1'} rows={3} value={description} maxLength={2400} onChange={e=>setDescription(e.target.value)} placeholder='Background or instructions'/></label>
        <label className='block text-xs text-muted'>Deadline<input type='date' className={field+' mt-1'} value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
        <ActionPhotoInput value={photoPath} onChange={setPhotoPath} label='Add photo to action'/>
        {directRecipient ? <p className='rounded-lg border border-line bg-page px-3 py-2 text-xs text-muted'>
            Assigned to <strong className='text-ink'>{nm(people,directRecipient)}</strong> in this conversation.
        </p> : <>
        <p className='text-xs font-semibold text-muted'>Assign to one or more group members</p>
        <div className='max-h-36 space-y-1 overflow-y-auto'>
         {available.map(p=><label key={p.uid} className='flex min-h-10 items-center gap-2 rounded-lg border border-line px-2 text-xs text-ink'>
           <input className='h-4 w-4' type='checkbox' checked={recipients.includes(p.uid)} onChange={e=>setRecipients(v=>e.target.checked?[...v,p.uid]:v.filter(x=>x!==p.uid))}/>{p.name}
         </label>)}
        </div></>}
        <button type='button' onClick={()=>{void newAction()}} disabled={busy||title.trim().length<3||!recipients.length}
         className='flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-xs font-semibold text-onbrand disabled:opacity-40'><Send className='h-4 w-4'/>Send action request</button>
      </div>}
      {error&&<p role='alert' className='rounded-lg bg-red-500/10 p-3 text-xs text-red-500'>{error}</p>}
      {message&&<p className='rounded-lg bg-brand/10 p-3 text-xs text-brand'>{message}</p>}
      {loading?<p className='p-5 text-center text-sm text-muted'>Loading tracked actions…</p>:!items.length?<p className='p-6 text-center text-sm text-muted'>No chat-assigned actions yet.</p>:items.map(a=>{
       const requester=a.requesterUid===uid;
       const myState=a.assignments.find(p=>p.uid===uid);
       return <article key={a.id} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
         <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'><h4 className='text-sm font-semibold text-ink'>{a.title}</h4>
          <p className='text-[11px] text-muted'>Requested by {nm(people,a.requesterUid)}{a.deadline?' · Due '+a.deadline:''}</p></div>
          {a.canceled?<span className='text-xs text-red-500'>Canceled</span>:<span className='text-[11px] text-brand'>{a.assignments.filter(v=>!!v.acknowledgedAt).length}/{a.assignments.length} acknowledged</span>}
         </div>
         {a.description&&<p className='whitespace-pre-wrap text-xs text-soft'>{a.description}</p>}
         {a.photoUrl&&<img src={a.photoUrl} alt='Monitored action photo' className='max-h-44 w-full rounded-xl object-contain'/>}
         {a.canceled&&<p className='text-xs text-red-500'>Reason: {a.cancelReason}</p>}
         {a.assignments.map(v=><div key={v.uid} className='space-y-2 rounded-xl border border-line bg-page p-2.5'>
            <div className='flex flex-wrap items-center justify-between gap-1 text-xs'>
                <strong className='text-ink'>{nm(people,v.uid)}</strong>
                <span className='font-semibold text-brand'>{v.decision==='pending'?'Awaiting response':v.decision==='review'?'Review requested':v.decision==='declined'?'Declined':v.status==='closed'?(v.acknowledgedAt?'Acknowledged closed':'Awaiting requester acknowledgement'):v.status==='canceled'?'Canceled':'Open'}</span>
            </div>
            {v.reviewNote&&<p className='text-xs italic text-muted'>{v.reviewNote}</p>}
            {v.acknowledgementNote&&<p className='text-xs italic text-muted'>Requester feedback: {v.acknowledgementNote}</p>}
            {!a.canceled&&requester&&v.decision==='accepted'&&v.status==='closed'&&!v.acknowledgedAt&&
             <div className='flex flex-wrap gap-2 rounded-lg border border-brand/40 bg-brand/5 p-2'>
                 <p className='w-full text-xs text-ink'>Completion submitted. Review the work before confirming closure.</p>
                 <button type='button' disabled={busy} onClick={()=>{void apply('acknowledge',{actionId:a.id,uid:v.uid,decision:'acknowledge'},'Closure acknowledged.')}} 
                     className='min-h-11 rounded-lg bg-brand px-3 text-xs font-semibold text-onbrand'>Acknowledge closure</button>
                 <button type='button' disabled={busy} onClick={async ()=>{
                     const reason=(await appPrompt('What must be corrected or completed before you can acknowledge?'));
                     if(reason&&reason.trim().length>=5)void apply('acknowledge',{actionId:a.id,uid:v.uid,decision:'return',note:reason},'Returned for additional work.');
                     else if(reason!==null)setError('Provide a reason of at least five characters.');
                 }} className='min-h-11 rounded-lg border border-line px-3 text-xs text-ink'>Request more work</button>
             </div>}
            {v.progressNotes?.slice(-3).map((p,i)=><p key={i} className='text-xs text-soft'>• {p.note} <span className='text-muted'>{stamp(p.at)}</span></p>)}
            {!a.canceled&&v.uid===uid&&v.decision==='pending'&&<>
                <div className='grid grid-cols-3 gap-1'>
                    <button type='button' disabled={busy} onClick={()=>{void apply('respond',{actionId:a.id,decision:'accept'},'Action accepted and added to your Chat assignments.')}} className='min-h-11 rounded-lg bg-brand px-1 text-[11px] font-semibold text-onbrand'>Accept</button>
                    <button type='button' onClick={()=>setDecisions(m=>({...m,[a.id]:'review'}))} className='min-h-11 rounded-lg border border-line px-1 text-[11px] text-ink'>Review</button>
                    <button type='button' onClick={()=>setDecisions(m=>({...m,[a.id]:'decline'}))} className='min-h-11 rounded-lg border border-line px-1 text-[11px] text-red-500'>Decline</button>
                </div>
                {decisions[a.id]&&<div className='space-y-2'>
                    <textarea className={field} rows={2} placeholder={decisions[a.id]==='review'?'What needs clarification or more information?':'Why do you decline?'}
                        value={note[a.id]||''} onChange={e=>setNote(v=>({...v,[a.id]:e.target.value}))}/>
                    <button type='button' disabled={busy||(note[a.id]||'').trim().length<5}
                        onClick={()=>{void apply('respond',{actionId:a.id,decision:decisions[a.id],note:note[a.id]},'Your response has been shared.')}}
                        className='min-h-11 rounded-lg bg-brand px-3 text-xs font-semibold text-onbrand'>Submit response</button>
                </div>}
            </>}
            {!a.canceled&&requester&&v.decision==='review'&&<>
                <p className='text-[11px] text-muted'>The assignee requested clarification. Revise and resend or cancel the request.</p>
                <button type='button' onClick={()=>{setRevise(s=>({...s,[v.uid+a.id]:!s[v.uid+a.id]}));setRevisedText(t=>({...t,[v.uid+a.id]:a.description}))}}
                    className='min-h-11 rounded-lg border border-line px-3 text-xs text-brand'>Revise instructions</button>
                {revise[v.uid+a.id]&&<div className='space-y-2'>
                    <textarea className={field} rows={3} value={revisedText[v.uid+a.id]||''} onChange={e=>setRevisedText(m=>({...m,[v.uid+a.id]:e.target.value}))}/>
                    <button type='button' disabled={busy} onClick={()=>{void apply('revise',{actionId:a.id,uid:v.uid,title:a.title,description:revisedText[v.uid+a.id],deadline:a.deadline},'Revised request sent.')}}
                        className='min-h-11 rounded-lg bg-brand px-3 text-xs text-onbrand'>Resend for acceptance</button>
                </div>}
            </>}
            {!a.canceled&&v.uid===uid&&v.decision==='accepted'&&!v.acknowledgedAt&&<div className='space-y-2'>
                <select className={field} value={status[a.id]||v.status} onChange={e=>setStatus(s=>({...s,[a.id]:e.target.value}))}>
                    <option value='open'>Open</option><option value='closed'>Closed</option><option value='canceled'>Canceled</option>
                </select>
                <textarea className={field} value={note[a.id]||''} onChange={e=>setNote(s=>({...s,[a.id]:e.target.value}))}
                    rows={2} placeholder='Your progress update (required if canceling)'/>
                <button type='button' disabled={busy} onClick={()=>{void apply('progress',{actionId:a.id,status:status[a.id]||v.status,note:note[a.id]||''},'Your progress is now visible to participants.')}}
                    className='min-h-11 rounded-lg bg-brand px-3 text-xs text-onbrand'>Update my progress</button>
            </div>}
          </div>)}
         <div className='space-y-2 border-t border-line pt-2'>
             {a.comments.slice(-5).map(c=><p key={c.id} className='text-xs text-soft'><strong>{nm(people,c.by)}:</strong> {c.text}</p>)}
             <div className='flex items-end gap-2'>
              <input className={field+' min-w-0 flex-1'} placeholder='Comment to check progress…' maxLength={1400}
                value={note['comment'+a.id]||''} onChange={e=>setNote(s=>({...s,['comment'+a.id]:e.target.value}))}/>
              <button type='button' disabled={busy||!(note['comment'+a.id]||'').trim()} onClick={()=>{void apply('comment',{actionId:a.id,text:note['comment'+a.id]},'Comment shared.')}}
                className='flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-onbrand'><Send className='h-4 w-4'/></button>
             </div>
         </div>
         {requester&&!a.canceled&&<button type='button' disabled={busy} onClick={async ()=>{
            const reason=(await appPrompt('Why cancel this action request for all participants?'));
            if(reason&&reason.trim().length>=5)void apply('cancel',{actionId:a.id,reason},'Request canceled.');
            else if(reason!==null)setError('A reason of five or more characters is required.');
         }} className='min-h-11 rounded-lg border border-line px-3 text-xs text-red-500'>Cancel request</button>}
       </article>;
      })}
    </div>
 </section>;
}

export function ChatPollsBoard({uid,roomId,people,revision=0,initialCreate=false}:{uid:string;roomId:string;people:ChatPerson[];revision?:number;initialCreate?:boolean}) {
 const [polls,setPolls]=useState<Poll[]>([]);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [show,setShow]=useState(initialCreate),[question,setQuestion]=useState('');
 const [options,setOptions]=useState(['','']),[anonymous,setAnonymous]=useState(false),[instant,setInstant]=useState(true),[multiple,setMultiple]=useState(false);
 const [selections,setSelections]=useState<Record<string,number[]>>({});
 const refresh=async()=>{const r=await callBackend<{polls:Poll[]}>('/api/org/quick/chat/poll/list',{roomId});setPolls(r.polls);};
 useEffect(()=>{let alive=true;setLoading(true);void refresh().catch(e=>{if(alive)setError(failure(e))}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[roomId,revision]);
 const apply=async(path:string,data:Record<string,unknown>,ok:string)=>{setBusy(true);setError('');setNotice('');try{
    await callBackend('/api/org/quick/chat/poll/'+path,{roomId,...data});await refresh();setNotice(ok);return true;
 }catch(e){setError(failure(e));return false}finally{setBusy(false)}};
 const createPoll=async()=>{const good=await apply('create',{question,options,anonymous,instantResults:instant,multiple},'Poll published to group.');if(good){setShow(false);setQuestion('');setOptions(['','']);}};
 return <section className='flex min-h-0 flex-1 flex-col bg-page'>
    <header className='flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3 py-3'>
      <div><h3 className='text-sm font-semibold text-ink'>Group polls</h3><p className='text-[11px] text-muted'>Vote once · results depend on poll settings</p></div>
      <button type='button' onClick={()=>setShow(x=>!x)} className='min-h-11 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand'><Plus className='inline h-4 w-4'/> Poll</button>
    </header>
    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-3'>
      {show&&<div className='space-y-3 rounded-2xl border border-brand/40 bg-panel p-3'>
        <label className='block text-xs text-muted'>Voting question<input className={field+' mt-1'} maxLength={260} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
        <p className='text-xs font-semibold text-muted'>Options</p>
        {options.map((option,i)=><div key={i} className='flex gap-2'>
            <input className={field+' flex-1'} value={option} maxLength={130} onChange={e=>setOptions(o=>o.map((x,j)=>j===i?e.target.value:x))} placeholder={'Option '+(i+1)}/>
            {options.length>2&&<button type='button' aria-label='Remove option' onClick={()=>setOptions(o=>o.filter((_,j)=>i!==j))} className='px-2 text-red-500'><X className='h-4 w-4'/></button>}
        </div>)}
        {options.length<10&&<button type='button' className='min-h-11 text-xs font-semibold text-brand' onClick={()=>setOptions(o=>[...o,''])}>+ Add option</button>}
        <label className='flex items-center gap-2 text-xs text-ink'><input type='checkbox' checked={anonymous} onChange={e=>setAnonymous(e.target.checked)}/> Anonymous voting</label>
        <label className='flex items-center gap-2 text-xs text-ink'><input type='checkbox' checked={instant} onChange={e=>setInstant(e.target.checked)}/> Show results immediately</label>
        <label className='flex items-center gap-2 text-xs text-ink'><input type='checkbox' checked={multiple} onChange={e=>setMultiple(e.target.checked)}/> Allow multiple options</label>
        <button type='button' disabled={busy||question.trim().length<5||options.some(x=>!x.trim())} onClick={()=>{void createPoll()}}
            className='min-h-11 w-full rounded-xl bg-brand text-xs font-semibold text-onbrand disabled:opacity-40'>Publish poll</button>
      </div>}
      {error&&<p className='rounded-lg bg-red-500/10 p-3 text-xs text-red-500'>{error}</p>}
      {notice&&<p className='rounded-lg bg-brand/10 p-3 text-xs text-brand'>{notice}</p>}
      {loading?<p className='p-5 text-center text-sm text-muted'>Loading group polls…</p>:!polls.length?<p className='p-5 text-center text-sm text-muted'>No polls in this group yet.</p>:polls.map(p=><article key={p.id} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
          <div className='flex items-start justify-between gap-2'><div><h4 className='text-sm font-semibold text-ink'>{p.question}</h4>
          <p className='text-[11px] text-muted'>By {nm(people,p.createdBy)} · {p.anonymous?'Anonymous':'Identified'} · {p.closed?'Closed':'Open'}</p></div>
          {p.hasVoted&&<CheckCircle2 className='h-4 w-4 text-brand'/>}</div>
          {p.options.map((opt,i)=>{
            const total=(p.counts||[]).reduce((a,b)=>a+b,0);const count=p.counts?.[i]||0;const percent=total?Math.round(count/total*100):0;
            return <button key={i} type='button' disabled={busy||p.closed||p.hasVoted} onClick={()=>setSelections(old=>{
                const prev=old[p.id]||[],next=p.multiple?(prev.includes(i)?prev.filter(x=>x!==i):[...prev,i]):[i];
                return {...old,[p.id]:next};
            })} className={'relative min-h-11 w-full overflow-hidden rounded-xl border p-3 text-left text-xs '+((selections[p.id]||p.ownVotes).includes(i)?'border-brand':'border-line')}>
              {p.counts&&<span className='absolute inset-y-0 left-0 bg-brand/10' style={{width:percent+'%'}}/>}
              <span className='relative flex items-center justify-between gap-2'><span>{(selections[p.id]||p.ownVotes).includes(i)?'✓ ':''}{opt}</span><span className='font-semibold'>{p.counts?count+' · '+percent+'%':''}</span></span>
            </button>;
          })}
          {!p.closed&&!p.hasVoted&&<button type='button' disabled={busy||!(selections[p.id]||[]).length}
              onClick={()=>{void apply('vote',{pollId:p.id,indices:selections[p.id]},'Vote recorded.')}}
              className='min-h-11 w-full rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand disabled:opacity-40'>Cast vote</button>}
          {p.counts?<p className='text-[11px] text-muted'>{p.totalVoters} voters · {p.closed?'Final results':'Live results'}</p>:
              <p className='text-[11px] text-muted'>Results will be visible after the poll closes.</p>}
          {p.createdBy===uid&&!p.closed&&<button type='button' disabled={busy} onClick={async ()=>{if((await appConfirm('Close this poll and publish final results?')))void apply('close',{pollId:p.id},'Poll closed.')}}
              className='min-h-11 rounded-xl border border-line px-3 text-xs text-brand'>Close poll</button>}
       </article>)}
    </div>
 </section>;
}
