import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Edit3, Plus, Search, Users, X } from 'lucide-react';
import { callBackend } from '../lib/backend';

export interface WorkGroup {id:string;name:string;memberUids:string[];ownerUid:string;chatRoomId:string;updatedAt:string}
export interface MailColleague {uid:string;name:string;email:string}
export default function MailWorkGroups({people,groups,myUid,onApply,onReload,onClose}:{
    people:MailColleague[];groups:WorkGroup[];myUid:string;
    onApply:(group:WorkGroup)=>void;onReload:()=>Promise<void>;onClose:()=>void;
}){
    const [editing,setEditing]=useState<WorkGroup|null>(null);
    const [name,setName]=useState('');
    const [chosen,setChosen]=useState<string[]>([]);
    const [search,setSearch]=useState('');
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState('');
    const change=(group?:WorkGroup)=>{
        setEditing(group||null);setName(group?.name||'');
        setChosen(group?.memberUids.filter(uid=>uid!==myUid)||[]);setSearch('');setError('');
    };
    const matches=people.filter(p=>p.uid!==myUid&&(p.name+' '+p.email).toLowerCase().includes(search.toLowerCase()));
    const save=async()=>{
        setBusy(true);setError('');
        try{
            await callBackend(editing?'/api/org/work-groups/update':'/api/org/work-groups/create',{
                ...(editing?{groupId:editing.id}:{}),name,memberUids:chosen,
            });
            await onReload();change();
        }catch(e){setError(e instanceof Error?e.message:'Unable to save work group.');}
        finally{setBusy(false);}
    };
    return <div role='dialog' aria-modal='true' aria-label='Shared work groups' className='fixed inset-0 z-[100] flex items-center justify-center bg-black/55 sm:p-4'>
        <div className='flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-panel shadow-xl sm:h-[min(88dvh,780px)] sm:rounded-2xl sm:border sm:border-line'>
            <header className='flex min-h-14 items-center gap-3 border-b border-line px-4'>
                <Users className='h-5 w-5 text-brand'/><span className='min-w-0 flex-1 font-semibold text-ink'>Work groups</span>
                <button type='button' onClick={()=>change()} className='flex min-h-11 items-center gap-1 rounded-lg bg-brand/10 px-3 text-xs font-semibold text-brand'><Plus className='h-4 w-4'/>New group</button>
                <button type='button' onClick={onClose} aria-label='Close work groups' className='flex h-11 w-11 items-center justify-center'><X className='h-5 w-5'/></button>
            </header>
            <div className='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-2 sm:overflow-hidden'>
                <section className='space-y-2 border-b border-line p-3 sm:overflow-y-auto sm:border-b-0 sm:border-r'>
                    <h3 className='text-xs font-semibold uppercase text-muted'>Shared with me · {groups.length}</h3>
                    {groups.length===0&&<p className='text-xs text-muted'>No work groups yet. Create one to reuse across Email and Chat.</p>}
                    {groups.map(g=><div key={g.id} className='space-y-2 rounded-xl border border-line bg-page p-3'>
                        <p className='truncate text-sm font-semibold text-ink'>{g.name}</p>
                        <p className='text-[11px] text-muted'>{g.memberUids.length} colleagues · {g.chatRoomId?'Linked to Chat':'Email group'}</p>
                        <div className='flex gap-2'>
                            <button type='button' onClick={()=>onApply(g)} className='min-h-11 flex-1 rounded-lg bg-brand px-3 text-xs font-semibold text-onbrand'>Use recipients</button>
                            {g.ownerUid===myUid&&<button type='button' onClick={()=>change(g)} className='flex min-h-11 items-center gap-1 rounded-lg border border-line px-2 text-xs text-brand'><Edit3 className='h-4 w-4'/>Edit</button>}
                        </div>
                    </div>)}
                </section>
                <section className='space-y-3 p-3 sm:min-h-0 sm:overflow-y-auto'>
                    <h3 className='text-sm font-semibold text-ink'>{editing?'Edit group':'Create work group'}</h3>
                    <label className='block text-xs font-semibold text-muted'>Group name
                        <input value={name} maxLength={90} onChange={e=>setName(e.target.value)}
                            className='mt-1 h-11 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink outline-none' placeholder='e.g. Maintenance planners'/>
                    </label>
                    <label className='flex h-11 items-center gap-2 rounded-xl border border-line bg-page px-3'>
                        <Search className='h-4 w-4 text-muted'/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search colleagues' className='min-w-0 flex-1 bg-transparent text-sm text-ink outline-none'/>
                    </label>
                    <p className='text-[11px] text-muted'>{chosen.length} selected · All members must belong to your organization.</p>
                    <div className='max-h-[240px] space-y-1 overflow-y-auto'>
                        {matches.map(p=><label key={p.uid} className='flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-page px-2 text-xs'>
                            <input type='checkbox' checked={chosen.includes(p.uid)} onChange={e=>setChosen(old=>e.target.checked?[...old,p.uid]:old.filter(uid=>uid!==p.uid))}
                                className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>
                            <span className='min-w-0 flex-1'><span className='block truncate font-semibold text-ink'>{p.name}</span><span className='block truncate text-[11px] text-muted'>{p.email}</span></span>
                        </label>)}
                    </div>
                    {error&&<p role='alert' className='rounded-lg bg-red-500/10 p-2 text-xs text-red-500'>{error}</p>}
                    <button type='button' disabled={busy||name.trim().length<3||!chosen.length} onClick={()=>{void save()}} className='flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand disabled:opacity-40'><Check className='h-4 w-4'/>{busy?'Saving…':editing?'Save changes':'Create group'}</button>
                </section>
            </div>
        </div>
    </div>;
}
