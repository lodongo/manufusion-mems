import {useEffect,useState} from 'react';
import {BellOff,Check,ShieldCheck,UserPlus,Users,X} from 'lucide-react';
import {callBackend} from '../lib/backend';
import type {ChatRoom,ChatPerson} from './chatTypes';
import {ChatAvatar} from './ChatThread';
import { appAlert, appConfirm } from '../components/dialogs';

const field='min-h-11 w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink';
const errorText=(e:unknown)=>e instanceof Error?e.message:'Could not update chat.';
const THEMES=['default','ocean','forest','rose','amber','slate','violet'];

export function ChatMuteAll() {
    const [muted,setMuted]=useState(false),[busy,setBusy]=useState(false);
    useEffect(()=>{let alive=true;void callBackend<{muteAll:boolean}>('/api/org/quick/chat/preferences')
        .then(r=>{if(alive)setMuted(r.muteAll)}).catch(()=>undefined);return()=>{alive=false}},[]);
    const toggle=async()=>{setBusy(true);try{await callBackend('/api/org/quick/chat/preferences/save',{mode:'mute_all',muteAll:!muted});setMuted(v=>!v)}catch(e){void appAlert(errorText(e))}finally{setBusy(false)}};
    return <button type='button' disabled={busy} onClick={()=>{void toggle()}} className='flex min-h-11 items-center gap-1 rounded-xl border border-line px-2.5 text-xs text-muted'>
        <BellOff className='h-3.5 w-3.5'/>{muted?'Unmute all':'Mute all'}</button>;
}
export function ChatWorkNotice({onClose}:{onClose:()=>void}){
    return <div role='note' className='shrink-0 border-b border-line bg-panel px-4 py-3 text-xs leading-relaxed text-ink'>
        <div className='flex items-start justify-between gap-2'>
            <p><strong>Workplace communication notice:</strong> Chat is an organizational work account, not a personal or private messaging service.
            Messages, attachments, assigned actions, and polls constitute workplace records that may be retained, reviewed, or audited according to organizational policy.
            Avoid sharing private personal information. Internal report links still require the viewer’s normal MEMS permissions.</p>
            <button type='button' aria-label='Close workplace notice' onClick={onClose} className='h-11 w-11 shrink-0'><X className='h-4 w-4'/></button>
        </div>
    </div>;
}
export function ChatOptions({uid,room,people,onChanged,onLeave,onClose,onTheme}:{
    uid:string;room:ChatRoom;people:ChatPerson[];
    onChanged:()=>Promise<void>;onLeave:()=>void;onClose:()=>void;onTheme:(theme:string)=>void;
}){
    const [muted,setMuted]=useState(false),[theme,setTheme]=useState('default');
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[msg,setMsg]=useState('');
    const [name,setName]=useState(''),[add,setAdd]=useState<string[]>([]);
    const group=room.kind==='group',manager=group&&room.admins.includes(uid);
    const person=(id:string)=>people.find(p=>p.uid===id);
    const action=async(path:string,data:Record<string,unknown>,success:string,leave=false)=>{
        setBusy(true);setError('');setMsg('');
        try {
            await callBackend(path,data);
            if(leave){onLeave();return}
            await onChanged();setMsg(success);
        }catch(e){setError(errorText(e))}finally{setBusy(false)}
    };
    useEffect(()=>{let alive=true;void callBackend<{muted:boolean;theme:string}>('/api/org/quick/chat/preferences',{roomId:room.id})
        .then(p=>{if(alive){setMuted(p.muted);setTheme(p.theme);onTheme(p.theme)}})
        .catch(e=>{if(alive)setError(errorText(e))});return()=>{alive=false}},[room.id]);
    const pref=async(mode:'mute'|'theme',value:boolean|string)=>{
        setBusy(true);setError('');
        try{
            await callBackend('/api/org/quick/chat/preferences/save',{mode,roomId:room.id,
                ...(mode==='mute'?{muted:value}:{theme:value})});
            if(mode==='mute')setMuted(value===true);else {setTheme(String(value));onTheme(String(value))}
            setMsg('Preference saved.');
        }catch(e){setError(errorText(e))}finally{setBusy(false)}
    };
    return <section className='max-h-[58%] shrink-0 space-y-3 overflow-y-auto border-b border-line bg-panel px-3 py-3 sm:px-6' aria-label='Conversation settings'>
        <div className='flex items-center justify-between gap-2'>
            <h3 className='text-sm font-semibold text-ink'>{group?'Group membership & settings':'Conversation settings'}</h3>
            <button type='button' aria-label='Close settings' onClick={onClose} className='flex h-11 w-11 items-center justify-center'><X className='h-4 w-4'/></button>
        </div>
        {error&&<p role='alert' className='rounded-lg bg-red-500/10 p-2 text-xs text-red-500'>{error}</p>}
        {msg&&<p className='rounded-lg bg-brand/10 p-2 text-xs text-brand'>{msg}</p>}
        <div className='grid grid-cols-2 gap-2'>
            <label className='text-xs text-muted'>Chat theme
                <select className={field+' mt-1'} value={theme} onChange={e=>{void pref('theme',e.target.value)}} disabled={busy}>
                    {THEMES.map(t=><option key={t} value={t}>{t[0].toUpperCase()+t.slice(1)}</option>)}
                </select>
            </label>
            <button type='button' disabled={busy} onClick={()=>{void pref('mute',!muted)}}
                className='mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line text-xs text-brand'>
                <BellOff className='h-4 w-4'/>{muted?'Unmute chat':'Mute chat'}
            </button>
        </div>
        <p className='text-[11px] text-muted'>Your theme and mute preference only affect your account. Chat history remains accessible.</p>
        {group&&<div className='space-y-2'>
            <div className='flex items-center gap-2'>
                <Users className='h-4 w-4 text-brand'/><h4 className='flex-1 text-xs font-semibold text-ink'>Group members ({room.members.length})</h4>
            </div>
            {manager&&<div className='flex gap-2'>
                <input className={field+' min-w-0 flex-1'} value={name} onChange={e=>setName(e.target.value)} maxLength={90} placeholder='Change group name'/>
                <button type='button' disabled={busy||name.trim().length<3} onClick={()=>{void action('/api/org/quick/chat/group/update',{roomId:room.id,action:'rename',title:name},'Name updated.').then(()=>setName(''))}}
                    className='rounded-xl bg-brand px-3 text-xs text-onbrand'>Rename</button>
            </div>}
            {room.members.map(id=><div key={id} className='flex min-h-12 items-center gap-2 rounded-xl border border-line bg-page px-2'>
                <ChatAvatar person={person(id)} size={32}/>
                <span className='min-w-0 flex-1 truncate text-xs text-ink'>{person(id)?.name||'Colleague'}{id===uid?' (you)':''}</span>
                {room.admins.includes(id)&&<ShieldCheck className='h-4 w-4 text-brand'/>}
                {manager&&id!==room.createdBy&&<button type='button' disabled={busy}
                    onClick={()=>{void action('/api/org/quick/chat/group/member',{roomId:room.id,action:room.admins.includes(id)?'demote':'promote',uid:id},'Administrator status updated.')}}
                    className='min-h-11 rounded-lg border border-line px-2 text-[11px] text-brand'>{room.admins.includes(id)?'Demote':'Promote'}</button>}
                {manager&&id!==room.createdBy&&<button type='button' disabled={busy} aria-label='Remove member' onClick={async ()=>{
                    if((await appConfirm('Remove member from this group?')))void action('/api/org/quick/chat/group/update',{roomId:room.id,action:'remove',memberUid:id},'Member removed.');
                }} className='flex h-11 w-8 items-center justify-center text-red-500'><X className='h-4 w-4'/></button>}
            </div>)}
            {manager&&(room.pendingInvites?.length ?? 0)>0&&<div className='space-y-2 rounded-xl border border-line bg-page p-2'>
                <h4 className='text-xs font-semibold text-ink'>Pending invitations</h4>
                {room.pendingInvites?.map(id=><div key={id} className='flex min-h-10 items-center gap-2 text-xs text-muted'>
                    <span className='min-w-0 flex-1 truncate'>{person(id)?.name||'Colleague'}</span>
                    <button type='button' disabled={busy} onClick={()=>{void action('/api/org/quick/chat/group/member',{roomId:room.id,action:'revoke',uid:id},'Invitation revoked.')}}
                        className='min-h-11 rounded-lg border border-line px-2 text-red-500'>Revoke</button>
                </div>)}
            </div>}
            {manager&&<div className='space-y-2 rounded-xl border border-line bg-page p-2'>
                <h4 className='text-xs font-semibold text-ink'>Invite colleagues</h4>
                <div className='max-h-32 space-y-1 overflow-y-auto'>
                    {people.filter(p=>!room.members.includes(p.uid)&&!room.pendingInvites?.includes(p.uid)).map(p=><label key={p.uid} className='flex min-h-9 items-center gap-2 text-xs text-ink'>
                        <input type='checkbox' checked={add.includes(p.uid)} onChange={e=>setAdd(s=>e.target.checked?[...s,p.uid]:s.filter(id=>id!==p.uid))} />
                        <ChatAvatar person={p} size={25}/>{p.name}
                    </label>)}
                </div>
                <button type='button' disabled={busy||!add.length} onClick={()=>{void action('/api/org/quick/chat/group/update',{roomId:room.id,action:'add',memberUids:add},'Invitations sent.').then(()=>setAdd([]))}}
                    className='flex min-h-11 items-center gap-1 rounded-xl bg-brand px-3 text-xs text-onbrand disabled:opacity-40'><UserPlus className='h-4 w-4'/>Send invitations ({add.length})</button>
            </div>}
            {uid===room.createdBy?<p className='text-[11px] text-muted'>As creator, you remain a permanent group administrator.</p>:
                <button type='button' disabled={busy} onClick={async ()=>{
                    if((await appConfirm('Leave this group? Access to the conversation and tracker will end.')))
                        void action('/api/org/quick/chat/group/member',{roomId:room.id,action:'leave'},'Left group.',true);
                }} className='min-h-11 rounded-xl border border-red-500/40 px-3 text-xs text-red-500'>Leave group</button>}
        </div>}
    </section>;
}
