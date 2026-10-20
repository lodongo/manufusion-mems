import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Archive, ArrowLeft, ArrowRight, AtSign, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, Edit3, File, FileText, Filter, Flag, Folder, FolderClosed, FolderPlus, Forward, Inbox, Mail, MailOpen, Menu, MoreHorizontal, Paperclip, Plus, Printer, RefreshCw, Reply, ReplyAll, Save, Search, Send, Settings2, ShieldCheck, Star, Tag, Trash2, Undo2, Upload, UserRound, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import MailRichEditor from './MailRichEditor';
import ActionPhotoInput from './ActionPhotoInput';
import MailSettings, { defaultMailPrefs, type MailPreferences } from './MailSettings';
import MailWorkGroups, {type WorkGroup} from './MailWorkGroups';
import MailCalendar from './MailCalendar';
import UnifiedActions from './UnifiedActions';
import { CalendarDays, Users, ListChecks } from 'lucide-react';
import { appAlert, appConfirm, appPrompt } from '../components/dialogs';

/** Keep message text visible while discarding active/untrusted HTML before rendering it in the page. */
function safeReadHtml(source:string):string {
    const parsed=new DOMParser().parseFromString(source||'', 'text/html');
    const safe=new Set(['p','div','span','br','strong','b','em','i','u','s','h1','h2','h3','h4','ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','td','th','a','sup','sub']);
    const forbidden=new Set(['script','style','iframe','svg','object','embed','form','video','audio','img','input','button','meta','link']);
    const clean=(node:Node):Node|null=>{
        if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||'');
        if(node.nodeType!==Node.ELEMENT_NODE)return null;
        const original=node as Element,tag=original.tagName.toLowerCase();
        if(forbidden.has(tag))return null;
        const box=document.createDocumentFragment();
        if(!safe.has(tag)) {for(const child of Array.from(original.childNodes)){const item=clean(child);if(item)box.appendChild(item);}return box;}
        const next=document.createElement(tag);
        if(tag==='a'){
            const href=original.getAttribute('href')||'';
            if(/^https?:\/\/[^\\s"'<>]+$/i.test(href)){next.setAttribute('href',href);next.setAttribute('target','_blank');next.setAttribute('rel','noopener noreferrer');}
        }
        const styles=original.getAttribute('style')||'';
        for(const item of styles.split(';').map(s=>s.trim())){
            // The viewing surface inherits the active theme. Never replay old
            // inline foreground/background colors: they can make mail unreadable.
            if(/^text-align\s*:\s*(left|center|right|justify)$/i.test(item)
            || /^font-size\s*:\s*(?:1[0-9]|2[0-8])px$/i.test(item)
            || /^font-family\s*:\s*(Arial|Calibri|Georgia|Times New Roman|Verdana|Courier New)$/i.test(item)){
                const [key,...rest]=item.split(':');next.style.setProperty(key.trim(),rest.join(':').trim());
            }
        }
        for(const child of Array.from(original.childNodes)){const item=clean(child);if(item)next.appendChild(item);}
        return next;
    };
    const output=document.createElement('div');
    for(const child of Array.from(parsed.body.childNodes)){const item=clean(child);if(item)output.appendChild(item);}
    return output.innerHTML;
}

type Person={uid:string;email:string;name:string};
type Attachment={id:string;name:string;mime:string;size:number;url:string};
type FolderItem={id:string;name:string};
type MailItem={allowReply?:boolean;allowReplyAll?:boolean;allowDelete?:boolean;action?:MailAction;actionId?:string;id:string;threadId:string;inReplyTo:string;fromUid:string;fromName:string;fromEmail:string;to:string[];cc:string[];bcc:string[];subject:string;excerpt:string;html:string;sentAt:string;updatedAt:string;folder:string;read:boolean;starred:boolean;flagged:boolean;focus:boolean;category:string;priority:string;attachments:Attachment[]};
type Listing={items:MailItem[];folders:FolderItem[];externalSendingEnabled:boolean};
type MailAction={enabled:boolean;title:string;description:string;deadline:string;photoPath:string;recipientUids:string[]};
type ComposeSeed={mode:'new'|'reply'|'replyall'|'forward'|'draft';original?:MailItem;group?:WorkGroup;withAction?:boolean};
const STANDARD=[
    {id:'inbox',label:'Inbox',Icon:Inbox},
    {id:'sent',label:'Sent Items',Icon:Send},
    {id:'drafts',label:'Drafts',Icon:Edit3},
    {id:'archive',label:'Archive',Icon:Archive},
    {id:'junk',label:'Junk Email',Icon:ShieldCheck},
    {id:'deleted',label:'Deleted Items',Icon:Trash2},
];
const fmt=(value:string)=>value?new Date(value).toLocaleDateString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const fullDate=(value:string)=>value?new Date(value).toLocaleString():'';
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const cls='min-h-10 rounded-xl border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-brand';
const titleFor=(person:Person|undefined,email:string)=>person?.name||email;
const safeSeed=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function addr(emails:string[],people:Person[]){return emails.map(e=>people.find(p=>p.email===e)?.name||e).join('; ')}
function Initial({mode,original,me}: {mode:ComposeSeed['mode'];original?:MailItem;me:string}){
    const source=original;
    const re=(prefix:string)=>(source?.subject||'').toLowerCase().startsWith(prefix.toLowerCase())?(source?.subject||''):prefix+(source?.subject||'');
    if(mode==='draft'&&source)return {id:source.id,to:source.to,cc:source.cc,bcc:source.bcc,subject:source.subject,html:source.html,priority:source.priority,threadId:source.threadId,inReplyTo:source.inReplyTo,attachments:source.attachments};
    if((mode==='reply'||mode==='replyall')&&source){
        const quoted=safeReadHtml(source.html||source.excerpt);
        const to=mode==='replyall'?[source.fromEmail,...source.to].filter(e=>e!==me):[source.fromEmail];
        const cc=mode==='replyall'?source.cc.filter(e=>e!==me):[];
        return {id:'d_'+uid(),to:[...new Set(to)],cc:[...new Set(cc)],bcc:[] as string[],subject:re('Re: '),html:'<p><br></p><blockquote><p>On '+safeSeed(fullDate(source.sentAt))+', '+safeSeed(source.fromName||source.fromEmail)+' wrote:</p>'+quoted+'</blockquote>',priority:'normal',threadId:source.threadId||source.id,inReplyTo:source.id,attachments:[] as Attachment[]};
    }
    if(mode==='forward'&&source)return {id:'d_'+uid(),to:[] as string[],cc:[] as string[],bcc:[] as string[],subject:re('FW: '),html:'<p><br></p><blockquote><p>Forwarded message from '+safeSeed(source.fromEmail)+'</p>'+safeReadHtml(source.html||source.excerpt)+'</blockquote>',priority:'normal',threadId:source.threadId||source.id,inReplyTo:source.id,attachments:[] as Attachment[]};
    return {id:'d_'+uid(),to:[] as string[],cc:[] as string[],bcc:[] as string[],subject:'',html:'',priority:'normal',threadId:'',inReplyTo:'',attachments:[] as Attachment[]};
}
type Draft=ReturnType<typeof Initial>;
function RecipientInput({label,value,people,exclude,onChange}:{label:string;value:string[];people:Person[];exclude:string[];onChange:(value:string[])=>void}){
    const [search,setSearch]=useState('');
    const [open,setOpen]=useState(false);
    const eligible=people.filter(p=>!value.includes(p.email)&&!exclude.includes(p.email)
        &&(!search.trim()||p.email.toLowerCase().includes(search.toLowerCase())||p.name.toLowerCase().includes(search.toLowerCase()))).slice(0,8);
    const add=(email:string)=>{if(!value.includes(email))onChange([...value,email]);setSearch('');setOpen(false);};
    const attempt=()=>{
        const p=people.find(p=>p.email===search.trim().toLowerCase());
        if(p&&!exclude.includes(p.email))add(p.email);
        else if(search.trim())void appAlert('Choose an active colleague from this organization. External addresses are disabled.');
    };
    return <div className='relative flex min-h-12 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1'>
        <span className='w-8 shrink-0 text-xs font-semibold text-muted'>{label}</span>
        {value.map(e=><span key={e} className='flex max-w-[190px] items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] text-brand' title={e}><span className='truncate'>{titleFor(people.find(p=>p.email===e),e)}</span>
            <button type='button' aria-label={'Remove '+e} onClick={()=>onChange(value.filter(s=>s!==e))}><X className='h-3 w-3'/></button></span>)}
        <input value={search} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)}
            onChange={e=>{setSearch(e.target.value);setOpen(true)}} aria-label={label+' recipients'}
            onKeyDown={e=>{if(e.key==='Enter'||e.key===','||e.key===';'){e.preventDefault();attempt();}if(e.key==='Backspace'&&!search&&value.length)onChange(value.slice(0,-1));}}
            placeholder={value.length?'Add colleague…':'Type a name or internal email'} className='h-11 min-w-[110px] flex-1 bg-transparent text-xs text-ink outline-none'/>
        {open&&eligible.length>0&&<div className='absolute left-8 right-2 top-[100%] z-30 max-h-60 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-xl'>
            {eligible.map(p=><button key={p.uid} type='button' onMouseDown={e=>e.preventDefault()} onClick={()=>add(p.email)} className='flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left hover:bg-brand/10'>
                <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand'><UserRound className='h-4 w-4'/></span>
                <span className='min-w-0 flex-1'><span className='block truncate text-xs font-semibold text-ink'>{p.name}</span><span className='block truncate text-[11px] text-muted'>{p.email}</span></span>
            </button>)}
        </div>}
    </div>;
}
function Compose({people,groups,me,seed,prefs,onDone,onCancel,onManageGroups}:{people:Person[];groups:WorkGroup[];me:string;seed:ComposeSeed;prefs:MailPreferences;onDone:(result?:{actionWarning?:string;actionId?:string})=>void;onCancel:()=>void;onManageGroups:()=>void}){
    const initial=useMemo(()=>{
        const base=Initial({...seed,me});
        if(seed.group){const emails=seed.group.memberUids.map(uid=>people.find(p=>p.uid===uid)?.email||'').filter(email=>email&&email.toLowerCase()!==me.toLowerCase());base.to=[...new Set([...base.to,...emails])];}
        if(seed.mode!=='draft' && prefs.signatureEnabled && prefs.signatureHtml.trim()) {
            const signature='<p><br></p><div>--<br>'+prefs.signatureHtml+'</div>';
            base.html=base.html.startsWith('<p><br></p>')?'<p><br></p>'+signature+base.html.slice('<p><br></p>'.length):base.html+signature;
        }
        return base;
    },[]);
    const [data,setData]=useState<Draft>(initial);
    const [action,setAction]=useState<MailAction>(()=>{
        const saved=seed.mode==='draft'?seed.original?.action:undefined;
        return {enabled:saved?.enabled===true||seed.withAction===true,title:saved?.title||seed.original?.subject||'',description:saved?.description||'',deadline:saved?.deadline||'',photoPath:saved?.photoPath||'',recipientUids:saved?.recipientUids||[]};
    });
    const [actionExpanded,setActionExpanded]=useState(seed.withAction===true||seed.original?.action?.enabled===true);
    const [messageOptions,setMessageOptions]=useState({
        allowReply:seed.mode==='draft'?seed.original?.allowReply!==false:true,
        allowReplyAll:seed.mode==='draft'?seed.original?.allowReplyAll!==false:true,
        allowDelete:seed.mode==='draft'?seed.original?.allowDelete!==false:true,
    });
    const [showMessageOptions,setShowMessageOptions]=useState(false);
    const [showCc,setShowCc]=useState(initial.cc.length>0);
    const [showBcc,setShowBcc]=useState(initial.bcc.length>0);
    const [dirty,setDirty]=useState(false);
    const [saving,setSaving]=useState(false);
    const [working,setWorking]=useState(false);
    const [error,setError]=useState('');
    const [lastSave,setLastSave]=useState('');
    const [attachBusy,setAttachBusy]=useState(false);
    const finished=useRef(false);
    const patch=(value:Partial<Draft>)=>{setData(d=>({...d,...value}));setDirty(true);};
    const payload=()=>({id:data.id,subject:data.subject,html:data.html,to:data.to,cc:data.cc,bcc:data.bcc,priority:data.priority,attachmentIds:data.attachments.map(a=>a.id),threadId:data.threadId,inReplyTo:data.inReplyTo,replyMode:seed.mode,action,...messageOptions});
    const applyGroup=(groupId:string)=>{
        const selected=groups.find(g=>g.id===groupId);if(!selected)return;
        const emails=selected.memberUids.map(uid=>people.find(p=>p.uid===uid)?.email||'').filter(email=>email&&email.toLowerCase()!==me.toLowerCase());
        patch({to:[...new Set([...data.to,...emails])],cc:data.cc.filter(e=>!emails.includes(e)),bcc:data.bcc.filter(e=>!emails.includes(e))});
    };
    const setAssigned=(uid:string,checked:boolean)=>{
        const employee=people.find(p=>p.uid===uid);if(!employee)return;
        const recipientUids=checked?[...new Set([...action.recipientUids,uid])]:action.recipientUids.filter(id=>id!==uid);
        setAction(v=>({...v,recipientUids}));setDirty(true);
        if(checked){const email=employee.email;patch({to:[...new Set([...data.to,email])],cc:data.cc.filter(s=>s!==email),bcc:data.bcc.filter(s=>s!==email)});}
    };
    const save=async()=>{
        if(finished.current)return;
        setSaving(true);setError('');
        try {await callBackend('/api/org/mail/draft',payload());setDirty(false);setLastSave('Draft saved');}
        catch(e){setError(e instanceof Error?e.message:'Could not save draft');}
        finally{setSaving(false);}
    };
    useEffect(()=>{
        if(!dirty||working||finished.current)return;
        const timer=setTimeout(()=>{void save()},3200);
        return()=>clearTimeout(timer);
    },[data,dirty,working]);
    const send=async()=>{
        if(action.enabled&&(!action.recipientUids.length||action.title.trim().length<3||action.description.trim().length<3)){setError('An email action needs assignees, a header, and a description before sending.');return;}
        if(!data.to.length&&!data.cc.length&&!data.bcc.length&&!action.recipientUids.length){setError('Choose at least one internal recipient.');return;}
        if(!data.html.replace(/<[^>]+>/g,' ').trim()&&!data.attachments.length){setError('Write a message or attach a file.');return;}
        setWorking(true);setError('');
        try{
            const result=await callBackend<{actionWarning?:string;actionId?:string}>('/api/org/mail/send',{...payload(),id:'m_'+uid(),draftId:data.id});
            finished.current=true;onDone(result);
        }catch(e){setError(e instanceof Error?e.message:'Email could not be sent.');}
        finally{setWorking(false);}
    };
    const upload=async(e:ChangeEvent<HTMLInputElement>)=>{
        const files=Array.from(e.target.files||[]);e.target.value='';
        if(!files.length)return;
        setAttachBusy(true);setError('');
        try{
            for(const file of files){
                if(file.size>8_000_000)throw new Error('Each attachment must be under 8 MB.');
                const encoded=await new Promise<string>((resolve,reject)=>{
                    const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(new Error('Cannot read attachment'));reader.readAsDataURL(file);
                });
                const res=await callBackend<{attachment:Attachment}>('/api/org/mail/upload',{name:file.name,mime:file.type||'application/octet-stream',data:encoded});
                setData(old=>({...old,attachments:[...old.attachments,res.attachment]}));setDirty(true);
            }
        }catch(e){setError(e instanceof Error?e.message:'Attachment failed');}finally{setAttachBusy(false);}
    };
    const close=async()=>{if(dirty&&!finished.current)await save();onCancel();};
    return <div role='dialog' aria-modal='true' aria-label='Compose internal email' className='fixed inset-0 z-[85] flex items-center justify-center bg-black/55 p-0 sm:p-4'>
        <div className='flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-panel text-ink shadow-2xl sm:h-[min(92dvh,920px)] sm:min-h-[400px] sm:resize-y sm:rounded-2xl sm:border sm:border-line'>
            <header className='flex min-h-14 shrink-0 items-center gap-3 border-b border-line bg-page px-3 sm:px-5'>
                <Mail className='h-5 w-5 shrink-0 text-brand'/>
                <span className='min-w-0 flex-1 truncate text-sm font-bold'>{seed.mode==='reply'?'Reply':seed.mode==='replyall'?'Reply all':seed.mode==='forward'?'Forward':seed.mode==='draft'?'Edit draft':'New message'}</span>
                <span className='hidden rounded-lg bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand sm:block'>Internal only</span>
                <button type='button' aria-label='Save draft' onClick={()=>{void save()}} className='flex h-11 w-11 items-center justify-center rounded-lg hover:bg-brand/10'><Save className='h-4 w-4'/></button>
                <button type='button' aria-label='Close composer' onClick={()=>{void close()}} className='flex h-11 w-11 items-center justify-center rounded-lg hover:bg-brand/10'><X className='h-5 w-5'/></button>
            </header>
            <div className='min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-5'>
                <div className='flex items-center gap-2 border-b border-line py-1 text-[11px] text-muted'>
                    <span className='w-9 shrink-0 font-semibold'>From</span><span className='min-w-0 flex-1 truncate'>{me}</span>
                    {!showCc&&<button className='min-h-11 px-2 text-brand' onClick={()=>setShowCc(true)}>Cc</button>}
                    {!showBcc&&<button className='min-h-11 px-2 text-brand' onClick={()=>setShowBcc(true)}>Bcc</button>}
                </div>
                <div className='flex flex-wrap items-center gap-2 border-b border-line px-3 py-2'>
                    <Users className='h-4 w-4 shrink-0 text-brand'/>
                    <select aria-label='Quick add work group' className='min-h-11 min-w-0 max-w-[220px] flex-1 rounded-lg border border-line bg-page px-2 text-xs text-ink' defaultValue='' onChange={e=>{applyGroup(e.target.value);e.target.value=''}}><option value=''>Add work group recipients</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.memberUids.length}</option>)}</select>
                    <button type='button' onClick={onManageGroups} className='min-h-11 rounded-lg border border-line px-3 text-xs font-semibold text-brand'>Manage work groups</button>
                </div>
                <RecipientInput label='To' value={data.to} people={people} exclude={[...data.cc,...data.bcc]} onChange={to=>patch({to})}/>
                {showCc&&<RecipientInput label='Cc' value={data.cc} people={people} exclude={[...data.to,...data.bcc]} onChange={cc=>patch({cc})}/>}
                {showBcc&&<RecipientInput label='Bcc' value={data.bcc} people={people} exclude={[...data.to,...data.cc]} onChange={bcc=>patch({bcc})}/>}
                <label className='flex min-h-12 items-center gap-2 border-b border-line px-3'><span className='w-8 shrink-0 text-xs font-semibold text-muted'>Subj.</span>
                    <input value={data.subject} onChange={e=>patch({subject:e.target.value})} placeholder='Add a subject' maxLength={250}
                        className='h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none'/></label>
                <div className='mt-3 rounded-xl border border-line bg-page px-3 py-2'>
                    <button type='button' onClick={()=>setActionExpanded(v=>!v)} className='flex min-h-11 w-full items-center gap-2 text-left text-xs font-semibold text-brand'><ListChecks className='h-4 w-4'/> Propose Monitored Action {action.enabled?'· enabled':''}<span className='ml-auto'>{actionExpanded?'▴':'▾'}</span></button>
                    {actionExpanded&&<div className='space-y-3 border-t border-line pt-2'>
                        <label className='flex items-center gap-2 text-xs font-semibold text-ink'><input type='checkbox' checked={action.enabled} onChange={e=>{setAction(v=>({...v,enabled:e.target.checked}));setDirty(true)}} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>Include monitored action with this email</label>
                        {action.enabled&&<>
                            <label className='block text-xs font-semibold text-muted'>Action title<input maxLength={180} value={action.title} onChange={e=>{setAction(v=>({...v,title:e.target.value}));setDirty(true)}} className={cls+' mt-1 w-full'} placeholder='Task for colleagues to complete'/></label>
                            <label className='block text-xs font-semibold text-muted'>Description<textarea value={action.description} rows={2} maxLength={2400} onChange={e=>{setAction(v=>({...v,description:e.target.value}));setDirty(true)}} className={cls+' mt-1 w-full resize-y'} placeholder='Expected result'/></label>
                            <label className='block text-xs font-semibold text-muted'>Deadline<input type='date' value={action.deadline} onChange={e=>{setAction(v=>({...v,deadline:e.target.value}));setDirty(true)}} className={cls+' mt-1 w-full'}/></label>
                            <ActionPhotoInput value={action.photoPath} onChange={photoPath=>{setAction(v=>({...v,photoPath}));setDirty(true)}} label='Attach action photo'/>
                            {!!groups.length&&<select aria-label='Assign whole work group' defaultValue='' className={cls+' w-full'} onChange={e=>{const g=groups.find(g=>g.id===e.target.value);if(g){applyGroup(g.id);setAction(v=>({...v,recipientUids:[...new Set([...v.recipientUids,...g.memberUids.filter(uid=>people.some(p=>p.uid===uid&&p.email.toLowerCase()!==me.toLowerCase()))])]}));setDirty(true)}e.target.value=''}}><option value=''>Assign to a work group</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
                            <p className='text-[11px] text-muted'>Only employees selected below receive the action. They are automatically added to To and removed from Cc/Bcc if necessary.</p>
                            <div className='max-h-40 space-y-1 overflow-y-auto'>{people.filter(p=>p.email.toLowerCase()!==me.toLowerCase()).map(p=><label key={p.uid} className='flex min-h-10 items-center gap-2 rounded-lg border border-line p-2 text-xs text-ink'><input type='checkbox' checked={action.recipientUids.includes(p.uid)} onChange={e=>setAssigned(p.uid,e.target.checked)} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/><span className='min-w-0 flex-1 truncate'>{p.name} · {p.email}</span></label>)}</div>
                        </>}
                    </div>}
                </div>
                <div className='mt-3 flex min-h-[180px] resize-y flex-col overflow-auto' style={{height:'clamp(220px, 38dvh, 580px)'}} title='Drag the lower edge to resize the rich-text writing area'>
                    <MailRichEditor html={initial.html} onChange={html=>{if(html!==data.html)patch({html})}}/>
                </div>
                {data.attachments.length>0&&<div className='mt-2 flex flex-wrap gap-2'>{data.attachments.map(a=><div key={a.id} className='flex min-w-0 max-w-[230px] items-center gap-2 rounded-xl border border-line bg-page px-2 py-2 text-xs'>
                    <Paperclip className='h-4 w-4 shrink-0 text-brand'/><span className='min-w-0 flex-1 truncate' title={a.name}>{a.name}</span>
                    <button type='button' aria-label={'Remove '+a.name} onClick={()=>patch({attachments:data.attachments.filter(x=>x.id!==a.id)})}><X className='h-4 w-4'/></button>
                </div>)}</div>}
                <div className='mt-3 flex flex-wrap items-center gap-3 text-xs text-muted'>
                    <label className='flex items-center gap-2'>Importance
                        <select aria-label='Email importance' value={data.priority} onChange={e=>patch({priority:e.target.value})} className={cls}>
                            <option value='normal'>Normal</option><option value='high'>High</option><option value='low'>Low</option>
                        </select>
                    </label>
                    <span>Recipients must be active employees in this organization.</span>
                </div>
                <div className='mt-2 rounded-xl border border-line bg-page p-2'>
                    <button type='button' aria-expanded={showMessageOptions} onClick={()=>setShowMessageOptions(v=>!v)} className='flex min-h-11 w-full items-center justify-between text-left text-xs font-semibold text-brand'>Email permissions after Send <span>{showMessageOptions?'▴':'▾'}</span></button>
                    {showMessageOptions&&<div className='grid gap-2 border-t border-line pt-3 sm:grid-cols-3'>
                        {([{key:'allowReply' as const,label:'Allow Reply'},{key:'allowReplyAll' as const,label:'Allow Reply to all'},{key:'allowDelete' as const,label:'Allow recipient deletion'}]).map(option=><label key={option.key} className='flex min-h-11 items-center gap-2 rounded-lg bg-panel px-3 text-xs text-ink'><input type='checkbox' checked={messageOptions[option.key]} onChange={e=>{setMessageOptions(x=>({...x,[option.key]:e.target.checked}));setDirty(true)}} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/>{option.label}</label>)}
                        <p className='col-span-full text-[11px] text-muted'>All three options are enabled by default. These settings apply to this email and its recipients.</p>
                    </div>}
                </div>
                {error&&<p role='alert' className='mt-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-600'>{error}</p>}
            </div>
            <footer className='flex shrink-0 items-center gap-2 border-t border-line bg-page px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-5'>
                <button type='button' disabled={working||attachBusy} onClick={()=>{void send()}} className='flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-onbrand disabled:opacity-40'><Send className='h-4 w-4'/>Send</button>
                <label className='flex h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-semibold text-ink'><Paperclip className='h-4 w-4' />{attachBusy?'Attaching…':'Attach'}<input multiple type='file' className='sr-only' disabled={attachBusy||working} accept='.pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp' onChange={e=>{void upload(e)}}/></label>
                <button type='button' onClick={()=>{void close()}} className='flex h-11 items-center gap-1 rounded-xl border border-line px-3 text-xs'><Save className='h-4 w-4'/>Draft</button>
                <span className='ml-auto truncate text-[11px] text-muted'>{saving?'Saving…':dirty?'Unsaved changes':lastSave||'Internal delivery'}</span>
            </footer>
        </div>
    </div>;
}
export default function OrgMail({myEmail,initialId=''}:{myEmail:string;initialId?:string}){
    const [items,setItems]=useState<MailItem[]>([]);
    const [folders,setFolders]=useState<FolderItem[]>([]);
    const [people,setPeople]=useState<Person[]>([]);
    const [folder,setFolder]=useState('inbox');
    const [selected,setSelected]=useState('');
    const [detail,setDetail]=useState<MailItem|null>(null);
    const [compose,setCompose]=useState<ComposeSeed|null>(null);
    const [loading,setLoading]=useState(true);
    const [refreshing,setRefreshing]=useState(false);
    const [error,setError]=useState('');
    const [search,setSearch]=useState('');
    const [filter,setFilter]=useState('all');
    const [focus,setFocus]=useState<'focused'|'other'>('focused');
    const [menu,setMenu]=useState(false);
    const [checked,setChecked]=useState<string[]>([]);
    const [notice,setNotice]=useState('');
    const [mailPrefs,setMailPrefs]=useState<MailPreferences>(defaultMailPrefs);
    const [showMailSettings,setShowMailSettings]=useState(false);
    const [groups,setGroups]=useState<WorkGroup[]>([]);
    const [showGroupManager,setShowGroupManager]=useState(false);
    const [area,setArea]=useState<'mail'|'calendar'|'actions'>('mail');
    const myUid=people.find(p=>p.email.toLowerCase()===myEmail.toLowerCase())?.uid||'';
    const reloadGroups=useCallback(async()=>{try{const r=await callBackend<{groups:WorkGroup[]}>('/api/org/work-groups/list');setGroups(r.groups);}catch(e){setError(e instanceof Error?e.message:'Could not load work groups');}},[]);
    const refresh=useCallback(async(quiet=false)=>{
        if(!quiet)setRefreshing(true);
        try{
            const result=await callBackend<Listing>('/api/org/mail/list');
            setItems(result.items);setFolders(result.folders);setError('');
        }catch(e){setError(e instanceof Error?e.message:'Could not load mail.');}
        finally{setLoading(false);setRefreshing(false);}
    },[]);
    useEffect(()=>{
        let active=true;
        void Promise.all([refresh(),callBackend<{people:Person[]}>('/api/org/mail/people').then(r=>{if(active)setPeople(r.people)}).catch(()=>undefined),callBackend<{preferences:MailPreferences}>('/api/org/mail/preferences').then(r=>{if(active)setMailPrefs(r.preferences)}).catch(()=>undefined),reloadGroups()]);
        const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(true)},30000);
        return()=>{active=false;clearInterval(timer)};
    },[refresh,reloadGroups]);
    const open=async(id:string)=>{
        setSelected(id);setDetail(null);setChecked([]);
        try{const r=await callBackend<{item:MailItem}>('/api/org/mail/read',{id});setDetail(r.item);
            setItems(old=>old.map(item=>item.id===id?{...item,read:true}:item));}
        catch(e){setError(e instanceof Error?e.message:'Email could not be opened');}
    };
    useEffect(()=>{if(initialId)void open(initialId)},[initialId]);
    const change=async(action:string,ids:string[],more:Record<string,unknown>={})=>{
        if(!ids.length)return;
        try{
            await callBackend('/api/org/mail/change',{action,ids,...more});
            setNotice(action==='delete'?'Moved to Deleted Items':action==='destroy'?'Permanently deleted':'Mailbox updated');
            if(['delete','destroy','move'].includes(action)&&ids.includes(selected)){setSelected('');setDetail(null);}
            setChecked([]);await refresh(true);
        }catch(e){setError(e instanceof Error?e.message:'Cannot update mail');}
    };
    const list=useMemo(()=>{
        const q=search.trim().toLowerCase();
        const all=items.filter(m=>{
            if(m.folder!==folder)return false;
            if(folder==='inbox'&&m.focus!==(focus==='focused'))return false;
            if(filter==='unread'&&m.read)return false;
            if(filter==='starred'&&!m.starred)return false;
            if(filter==='flagged'&&!m.flagged)return false;
            if(filter==='attachments'&&!m.attachments.length)return false;
            if(!q)return true;
            const term=q.replace(/^(from:|subject:)/,'');
            if(q.startsWith('from:'))return m.fromEmail.toLowerCase().includes(term)||m.fromName.toLowerCase().includes(term);
            if(q.startsWith('subject:'))return m.subject.toLowerCase().includes(term);
            if(q==='has:attachment')return !!m.attachments.length;
            return [m.subject,m.fromName,m.fromEmail,m.excerpt,...m.to].join(' ').toLowerCase().includes(q);
        });
        return all.sort((a,b)=>(b.sentAt||b.updatedAt).localeCompare(a.sentAt||a.updatedAt));
    },[items,folder,search,focus,filter]);
    const grouped=useMemo(()=>{
        const m=new Map<string,MailItem>();
        for(const item of list){const k=item.threadId||item.id;if(!m.has(k))m.set(k,item);}
        return [...m.values()];
    },[list]);
    const thread=detail?items.filter(item=>item.threadId===detail.threadId&&item.id!==detail.id&&item.folder!=='deleted').sort((a,b)=>a.sentAt.localeCompare(b.sentAt)):[];
    const count=(key:string)=>items.filter(m=>m.folder===key).length;
    const unread=(key:string)=>items.filter(m=>m.folder===key&&!m.read).length;
    const foldersDisplay=[...STANDARD,...folders.map(f=>({id:f.id,label:f.name,Icon:FolderClosed}))];
    const gotoFolder=(id:string)=>{setFolder(id);setMenu(false);setSelected('');setDetail(null);setChecked([]);setFilter('all');};
    const newFolder=async()=>{
        const name=(await appPrompt('New folder name'));
        if(!name)return;
        try{const r=await callBackend<{id:string}>('/api/org/mail/folder',{action:'create',name});await refresh(true);gotoFolder(r.id);}
        catch(e){setError(e instanceof Error?e.message:'Could not create folder');}
    };
    const renameFolder=async()=>{
        if(!folder.startsWith('f_'))return;
        const name=(await appPrompt('Rename folder', folders.find(f=>f.id===folder)?.name||''));
        if(!name)return;
        try{await callBackend('/api/org/mail/folder',{action:'rename',id:folder,name});await refresh(true);}
        catch(e){setError(e instanceof Error?e.message:'Could not rename folder');}
    };
    const deleteFolder=async()=>{
        if(!folder.startsWith('f_')||!(await appConfirm('Delete folder? Its messages will move to Inbox.')))return;
        try{await callBackend('/api/org/mail/folder',{action:'delete',id:folder});gotoFolder('inbox');await refresh(true);}
        catch(e){setError(e instanceof Error?e.message:'Could not delete folder');}
    };
    const composeMail=(mode:ComposeSeed['mode'],original?:MailItem)=>setCompose({mode,original});
    const bulk=checked.length?checked:selected?[selected]:[];
    const iconButton=(label:string,Icon:typeof Mail,click:()=>void,disabled=false)=><button type='button' aria-label={label} title={label} onClick={click} disabled={disabled} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-brand/10 disabled:opacity-30'><Icon className='h-4 w-4'/></button>;
    return <div className='fixed inset-0 z-[60] flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink' aria-label='Organization internal Email'>
        <header className='flex min-h-[62px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-4'>
            <button type='button' aria-label='Back to organization home' className='flex h-11 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-brand' onClick={()=>navigate('organization_home')}><ArrowLeft className='h-5 w-5'/></button>
            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand'><Mail className='h-6 w-6'/></span>
            <div className='min-w-0 flex-1'><h1 className='truncate text-base font-bold sm:text-lg'>Email</h1><p className='truncate text-[11px] text-muted'>{myEmail} · Internal organization mail</p></div>
            <span className='hidden rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand sm:block'>Internal only</span>
            {iconButton('Work groups',Users,()=>setShowGroupManager(true))}
            {iconButton('Email settings',Settings2,()=>setShowMailSettings(true))}
            {iconButton('Refresh mail',RefreshCw,()=>{void refresh()})}
            <button type='button' onClick={()=>composeMail('new')} className='flex h-11 items-center gap-2 rounded-xl bg-brand px-3 text-sm font-semibold text-onbrand'><Plus className='h-4 w-4'/> <span className='hidden min-[370px]:inline'>New mail</span></button>
        </header>
        <nav aria-label='Email and calendar' className='flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1 sm:px-4'>
            {([{key:'mail' as const,label:'Mail',Icon:Mail},{key:'calendar' as const,label:'Calendar',Icon:CalendarDays},{key:'actions' as const,label:'Monitored Actions',Icon:ListChecks}]).map(x=><button key={x.key} type='button' onClick={()=>setArea(x.key)} className={'flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold '+(area===x.key?'bg-brand/10 text-brand':'text-muted hover:bg-page')}><x.Icon className='h-4 w-4'/><span>{x.label}</span></button>)}
        </nav>
        {area==='calendar'?<MailCalendar uid={myUid} people={people} groups={groups} onClose={()=>setArea('mail')}/>:
            area==='actions'?<div className='min-h-0 flex-1 overflow-y-auto p-3 sm:p-6'><UnifiedActions uid={myUid} mode='sent' sourceFilter='email'/></div>:
        <div className='flex min-h-0 flex-1 overflow-hidden'>
            {menu&&<button type='button' className='fixed inset-0 z-[65] bg-black/40 lg:hidden' aria-label='Close folders' onClick={()=>setMenu(false)}/>}
            <aside className={'z-[66] flex w-[245px] shrink-0 flex-col border-r border-line bg-panel '+(menu?'fixed inset-y-0 left-0 shadow-xl':'hidden')+' lg:static lg:flex'}>
                <div className='flex items-center justify-between border-b border-line px-4 py-3'><span className='text-sm font-bold'>Folders</span><button type='button' title='Add folder' aria-label='Create mail folder' onClick={()=>{void newFolder()}}><FolderPlus className='h-5 w-5 text-brand'/></button></div>
                <div className='min-h-0 flex-1 overflow-y-auto px-2 py-3'>
                    {foldersDisplay.map(f=><button key={f.id} type='button' aria-current={folder===f.id?'page':undefined} onClick={()=>gotoFolder(f.id)}
                        className={'mb-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm '+(folder===f.id?'bg-brand/10 font-semibold text-brand':'text-ink hover:bg-page')}>
                        <f.Icon className='h-4 w-4 shrink-0'/><span className='min-w-0 flex-1 truncate'>{f.label}</span>
                        {!!unread(f.id)&&<span className='rounded-full bg-brand/15 px-1.5 text-[11px] font-semibold text-brand'>{unread(f.id)}</span>}
                        {!unread(f.id)&&!!count(f.id)&&<span className='text-[11px] text-muted'>{count(f.id)}</span>}
                    </button>)}
                    {folder.startsWith('f_')&&<div className='mt-4 flex gap-2 px-2'><button type='button' onClick={()=>{void renameFolder()}} className='text-xs text-brand'>Rename</button><button type='button' onClick={()=>{void deleteFolder()}} className='text-xs text-red-500'>Delete folder</button></div>}
                </div>
                <div className='border-t border-line p-3 text-[11px] leading-5 text-muted'><ShieldCheck className='mr-1 inline h-4 w-4 text-brand'/> Mail remains within your organization. Internet email delivery is not yet enabled.</div>
            </aside>
            <div className={'flex min-h-0 min-w-0 flex-col border-r border-line bg-panel/40 '+(selected?'hidden lg:flex':'flex')+' w-full lg:w-[370px] xl:w-[405px] lg:shrink-0'}>
                <div className='shrink-0 border-b border-line bg-panel p-3'>
                    <div className='mb-2 flex items-center gap-2'>
                        {iconButton('Show folders',Menu,()=>setMenu(true))}
                        <h2 className='min-w-0 flex-1 truncate text-lg font-bold'>{foldersDisplay.find(f=>f.id===folder)?.label||'Mail'}</h2>
                        {loading||refreshing?<RefreshCw className='h-4 w-4 animate-spin text-muted'/>:<span className='text-xs text-muted'>{grouped.length}</span>}
                    </div>
                    <label className='flex h-11 items-center gap-2 rounded-xl border border-line bg-page px-3'><Search className='h-4 w-4 text-muted'/><input value={search} onChange={e=>setSearch(e.target.value)} aria-label='Search your emails' placeholder='Search mail · from: · subject:' className='min-w-0 flex-1 bg-transparent text-xs text-ink outline-none'/>{search&&<button type='button' onClick={()=>setSearch('')} aria-label='Clear search'><X className='h-4 w-4'/></button>}</label>
                    {folder==='inbox'&&<div className='mt-2 grid grid-cols-2 gap-1 rounded-lg bg-page p-1'>{(['focused','other'] as const).map(k=><button type='button' key={k} onClick={()=>setFocus(k)} className={'min-h-11 rounded-md text-xs font-semibold '+(focus===k?'bg-panel text-brand shadow':'text-muted')}>{k==='focused'?'Focused':'Other'}</button>)}</div>}
                    <div className='mt-2 flex items-center gap-2'>
                        <label className='min-w-0 flex-1 text-xs text-muted'>Filter <select aria-label='Filter mail list' value={filter} onChange={e=>setFilter(e.target.value)} className='ml-1 max-w-[135px] rounded-md bg-page px-2 py-1.5 text-xs text-ink'>
                            <option value='all'>All mail</option><option value='unread'>Unread</option><option value='starred'>Starred</option><option value='flagged'>Flagged</option><option value='attachments'>With attachments</option>
                        </select></label>
                        <label className='flex items-center gap-1 text-xs text-muted'><input type='checkbox' aria-label='Select all visible messages' checked={grouped.length>0&&grouped.every(x=>checked.includes(x.id))} onChange={e=>setChecked(e.target.checked?grouped.map(i=>i.id):[])} className='h-4 w-4 accent-[rgb(var(--c-brand))]'/> Select</label>
                    </div>
                    {!!checked.length&&<div className='mt-2 flex items-center justify-between gap-2 rounded-lg bg-brand/10 px-2 py-1 text-xs text-brand'><span>{checked.length} selected</span><span className='flex'>{iconButton('Archive selected',Archive,()=>{void change('move',checked,{folder:'archive'})})}{iconButton('Delete selected',Trash2,()=>{void change('delete',checked)})}{iconButton('Mark read',MailOpen,()=>{void change('read',checked)})}</span></div>}
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                    {error&&<p role='alert' className='bg-red-500/10 px-3 py-2 text-xs text-red-500'>{error}</p>}
                    {notice&&<button type='button' onClick={()=>setNotice('')} className='w-full bg-brand/10 px-3 py-2 text-left text-xs text-brand'>{notice} <X className='ml-2 inline h-3 w-3'/></button>}
                    {!loading&&!grouped.length&&<div className='flex flex-col items-center gap-2 p-10 text-center text-muted'><Mail className='h-9 w-9 text-brand/60'/><p className='text-sm font-semibold'>No messages here</p><p className='text-xs'>Start an internal conversation or check another folder.</p></div>}
                    {grouped.map(m=><div key={m.id} className={'flex items-start gap-1 border-b border-line/60 px-2 py-2 '+(selected===m.id?'bg-brand/10':m.read?'bg-page/40':'bg-panel')}>
                        <input type='checkbox' aria-label={'Select '+m.subject} checked={checked.includes(m.id)} onChange={e=>setChecked(old=>e.target.checked?[...old,m.id]:old.filter(id=>id!==m.id))} className='mt-3 h-4 w-4 shrink-0 accent-[rgb(var(--c-brand))]'/>
                        <button type='button' onClick={()=>{void open(m.id)}} className='min-h-16 min-w-0 flex-1 text-left'>
                            <span className='flex items-baseline gap-1'><span className={'min-w-0 flex-1 truncate text-sm '+(m.read?'font-medium':'font-bold')}>{folder==='sent'?addr(m.to,people)||'Recipient':m.fromName||m.fromEmail}</span><time className='shrink-0 text-[11px] text-muted'>{fmt(m.sentAt||m.updatedAt)}</time></span>
                            <span className={'mt-0.5 block truncate text-xs '+(m.read?'text-ink':'font-bold text-ink')}>{m.priority==='high'?'❗ ':''}{m.subject}</span>
                            <span className='mt-1 block truncate text-[11px] text-muted'>{m.excerpt||'(No preview)'}</span>
                            <span className='mt-1 flex gap-2 text-brand'>{m.attachments.length>0&&<Paperclip className='h-3 w-3'/>}{m.flagged&&<Flag className='h-3 w-3'/>}{m.starred&&<Star className='h-3 w-3' fill='currentColor'/>}</span>
                        </button>
                        <button type='button' aria-label={m.starred?'Unstar':'Star'} onClick={()=>{void change(m.starred?'unstar':'star',[m.id])}} className='mt-1 p-1.5 text-amber-500'><Star className='h-4 w-4' fill={m.starred?'currentColor':'none'}/></button>
                    </div>)}
                </div>
            </div>
            <main className={'min-h-0 min-w-0 flex-1 flex-col bg-page '+(selected?'flex':'hidden lg:flex')}>
                {selected&&!detail?<div className='flex flex-1 items-center justify-center text-sm text-muted'>Opening mail…</div>:
                detail?<div className='flex min-h-0 flex-1 flex-col'>
                    <div className='flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel px-2 py-2 sm:px-4'>
                        <button type='button' className='flex h-11 items-center gap-1 rounded-lg px-2 text-xs text-brand lg:hidden' onClick={()=>{setSelected('');setDetail(null)}}><ChevronLeft className='h-4 w-4'/> Inbox</button>
                        {iconButton('Reply',Reply,()=>composeMail('reply',detail),detail.folder==='drafts'||detail.allowReply===false)}
                        {iconButton('Reply all',ReplyAll,()=>composeMail('replyall',detail),detail.folder==='drafts'||detail.allowReply===false||detail.allowReplyAll===false)}
                        {iconButton('Forward',Forward,()=>composeMail('forward',detail),detail.folder==='drafts')}
                        {iconButton('Archive',Archive,()=>{void change('move',[detail.id],{folder:'archive'})})}
                        {detail.folder==='deleted'&&iconButton('Restore',Undo2,()=>{void change('restore',[detail.id])})}
                        {iconButton('Delete',Trash2,()=>{void change(detail.folder==='deleted'?'destroy':'delete',[detail.id])},detail.allowDelete===false)}
                        {iconButton('Flag',Flag,()=>{void change(detail.flagged?'unflag':'flag',[detail.id])})}
                        {iconButton('Mark unread',Mail,()=>{void change('unread',[detail.id])})}
                        <button type='button' title='Print message' aria-label='Print message' onClick={()=>window.print()} className='flex h-11 w-11 items-center justify-center rounded-lg hover:bg-brand/10'><Printer className='h-4 w-4'/></button>
                    </div>
                    <div className='min-h-0 flex-1 overflow-y-auto p-4 sm:p-6'>
                        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                            <h2 className='min-w-0 break-words text-xl font-semibold'>{detail.subject}</h2>
                            <span className='rounded-full bg-brand/10 px-2 py-1 text-xs font-semibold text-brand'>{detail.priority==='high'?'High importance':detail.category||'Internal'}</span>
                        </div>
                        <div className='mb-4 flex gap-3 rounded-xl border border-line bg-panel p-3'>
                            <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand'><UserRound className='h-5 w-5'/></span>
                            <div className='min-w-0 flex-1 text-xs'>
                                <p className='truncate font-bold'>{detail.fromName} <span className='font-normal text-muted'>{'<'+detail.fromEmail+'>'}</span></p>
                                <p className='mt-1 truncate text-muted'>To: {addr(detail.to,people)||'—'}</p>
                                {!!detail.cc.length&&<p className='mt-0.5 truncate text-muted'>Cc: {addr(detail.cc,people)}</p>}
                                {!!detail.bcc.length&&<p className='mt-0.5 truncate text-muted'>Bcc: {addr(detail.bcc,people)}</p>}
                                <p className='mt-1 text-[11px] text-muted'>{fullDate(detail.sentAt||detail.updatedAt)}</p>
                            </div>
                        </div>
                        {detail.folder==='drafts'?<button type='button' onClick={()=>composeMail('draft',detail)} className='mb-3 flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-xs font-semibold text-onbrand'><Edit3 className='h-4 w-4'/> Continue draft</button>:null}
                        {!!detail.attachments.length&&<div className='mb-4 flex flex-wrap gap-2'>{detail.attachments.map(a=><a key={a.id} href={a.url||undefined} target='_blank' rel='noopener noreferrer' download={a.name} className='flex max-w-[250px] items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-brand'>
                            <Paperclip className='h-4 w-4 shrink-0'/><span className='min-w-0 flex-1 truncate'>{a.name}</span><span className='text-[11px] text-muted'>{Math.ceil(a.size/1024)} KB</span>
                        </a>)}</div>}
                        <div role='document' aria-label='Email message body'
                            className='min-h-[160px] w-full overflow-x-auto break-words rounded-xl border border-line bg-transparent p-4 text-sm leading-relaxed text-ink [&_blockquote]:border-l-4 [&_blockquote]:border-brand/50 [&_blockquote]:pl-3 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_li]:ml-6 [&_ul]:list-disc [&_ol]:list-decimal [&_td]:border [&_td]:border-line [&_td]:p-2 [&_th]:border [&_th]:border-line [&_th]:p-2 [&_a]:text-brand'
                            dangerouslySetInnerHTML={{__html:safeReadHtml(detail.html||detail.excerpt||'')||'<p>'+safeSeed(detail.excerpt||'No message body was provided.')+'</p>'}} />
                        {!!thread.length&&<section className='mt-4'><h3 className='mb-2 text-sm font-semibold'>Conversation ({thread.length+1})</h3>
                            {thread.map(t=><button type='button' key={t.id} onClick={()=>{void open(t.id)}} className='mb-2 flex min-h-12 w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 text-left text-xs'>
                                <Mail className='h-4 w-4 shrink-0 text-brand'/><span className='min-w-0 flex-1'><span className='block truncate font-semibold'>{t.fromName}</span><span className='block truncate text-muted'>{t.excerpt}</span></span><span className='shrink-0 text-muted'>{fmt(t.sentAt)}</span>
                            </button>)}
                        </section>}
                        <div className='mt-4 flex flex-wrap gap-2'>
                            <button type='button' disabled={detail.allowReply===false} onClick={()=>composeMail('reply',detail)} className='flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-xs font-semibold disabled:opacity-35'><Reply className='h-4 w-4'/>Reply</button>
                            <button type='button' disabled={detail.allowReply===false||detail.allowReplyAll===false} onClick={()=>composeMail('replyall',detail)} className='flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-xs font-semibold disabled:opacity-35'><ReplyAll className='h-4 w-4'/>Reply all</button>
                            <button type='button' onClick={()=>composeMail('forward',detail)} className='flex min-h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-xs font-semibold'><Forward className='h-4 w-4'/>Forward</button>
                        </div>
                        <div className='mt-4 flex flex-wrap items-center gap-2 text-xs'>
                            <span className='text-muted'>Move to</span><select aria-label='Move email to folder' defaultValue='' onChange={e=>{if(e.target.value)void change('move',[detail.id],{folder:e.target.value})}} className={cls}><option value=''>Choose folder</option>
                                {foldersDisplay.filter(f=>!['drafts','sent'].includes(f.id)).map(f=><option key={f.id} value={f.id}>{f.label}</option>)}
                            </select>
                            <span className='text-muted'>Category</span><select aria-label='Set mail category' value={detail.category} onChange={e=>{void change('category',[detail.id],{category:e.target.value});setDetail(d=>d?{...d,category:e.target.value}:d)}} className={cls}>
                                <option value=''>None</option><option>Action</option><option>Follow up</option><option>Information</option><option>Urgent</option><option>Project</option><option>Finance</option><option>Maintenance</option>
                            </select>
                            <button type='button' onClick={()=>{void change(detail.focus?'other':'focused',[detail.id])}} className='min-h-11 rounded-xl border border-line px-3 text-xs text-brand'>{detail.focus?'Move to Other':'Move to Focused'}</button>
                        </div>
                    </div>
                </div>:<div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-muted'>
                    <MailOpen className='h-14 w-14 text-brand/40'/><h2 className='text-base font-semibold text-ink'>Select an email to read</h2>
                    <p className='max-w-xs text-sm'>Work with internal correspondence, replies, attachments and folders in one place.</p>
                    <button type='button' onClick={()=>composeMail('new')} className='mt-2 flex h-11 items-center gap-2 rounded-xl border border-brand/30 px-4 text-brand'><Plus className='h-4 w-4'/> New email</button>
                </div>}
            </main>
        </div>}
        {compose&&<Compose key={compose.mode+'-'+(compose.original?.id||'new')+'-'+(compose.group?.id||'')} people={people} groups={groups} me={myEmail} seed={compose} prefs={mailPrefs}
            onDone={(result)=>{setCompose(null);setNotice(result?.actionWarning?'Email sent but action needs attention: '+result.actionWarning:'Email delivered internally'+(result?.actionId?' with monitored action.':'.'));void refresh(true);}}
            onCancel={()=>{setCompose(null);void refresh(true);}}
            onManageGroups={()=>setShowGroupManager(true)}/>}
        {showGroupManager&&<MailWorkGroups people={people} groups={groups} myUid={myUid}
            onApply={(group)=>{setShowGroupManager(false);if(compose){setCompose({...compose,group});}else{setCompose({mode:'new',group});setArea('mail');}}}
            onReload={reloadGroups} onClose={()=>setShowGroupManager(false)}/>}
        {showMailSettings&&<MailSettings value={mailPrefs} onSaved={setMailPrefs} onClose={()=>setShowMailSettings(false)}/>}
    </div>;
}
