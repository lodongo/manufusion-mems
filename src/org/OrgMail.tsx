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
import { MAIL_CATEGORIES } from '../../backend/mailRules';
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
const AVATAR_TONES=['#0f6cbd','#c239b3','#e3008c','#038387','#8764b8','#ca5010','#498205','#986f0b'];
function tone(seed:string){let h=0;for(let i=0;i<seed.length;i++)h=(h*31+seed.charCodeAt(i))|0;return AVATAR_TONES[Math.abs(h)%AVATAR_TONES.length];}
function Persona({name,email,size=36}:{name:string;email:string;size?:number}){
    const initials=(name||email).split(/[\s@.]+/).filter(Boolean).map(x=>x[0]).slice(0,2).join('').toUpperCase()||'?';
    return <span className='flex shrink-0 items-center justify-center rounded-full font-semibold text-[#fff]' style={{width:size,height:size,background:tone(email||name),fontSize:Math.round(size*0.38)}} aria-hidden='true'>{initials}</span>;
}
/** Outlook-style date groups for the message list. */
function dateGroup(iso:string):string{
    const d=new Date(iso);if(!Number.isFinite(d.getTime()))return 'Older';
    const now=new Date();const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const day=86400_000;const t=d.getTime();
    if(t>=start.getTime())return 'Today';
    if(t>=start.getTime()-day)return 'Yesterday';
    const weekStart=start.getTime()-((start.getDay()+6)%7)*day;
    if(t>=weekStart)return 'This week';
    if(t>=weekStart-7*day)return 'Last week';
    if(d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear())return 'Earlier this month';
    return 'Older';
}
function listTime(iso:string):string{
    const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';
    const now=new Date();
    if(d.toDateString()===now.toDateString())return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    if(now.getTime()-d.getTime()<6*86400_000)return d.toLocaleDateString([],{weekday:'short'})+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString();
}
function prefersDark(appearance:MailPreferences['appearance']):boolean{
    if(appearance==='dark')return true;
    if(appearance==='light')return false;
    try{
        const raw=getComputedStyle(document.documentElement).getPropertyValue('--c-page').trim().split(/\s+/).map(Number);
        return raw.length>=3&&0.2126*raw[0]+0.7152*raw[1]+0.0722*raw[2]<128;
    }catch{return false}
}

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
    return <div className='relative flex min-h-11 flex-wrap items-center gap-1.5 border-b px-1 py-1 ol-line'>
        <span className='w-10 shrink-0 text-[13px] ol-sub'>{label}</span>
        {value.map(e=><span key={e} className='flex max-w-[210px] items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[12px] ol-chip' title={e}>
            <Persona name={titleFor(people.find(p=>p.email===e),e)} email={e} size={20}/><span className='truncate'>{titleFor(people.find(p=>p.email===e),e)}</span>
            <button type='button' aria-label={'Remove '+e} onClick={()=>onChange(value.filter(s=>s!==e))}><X className='h-3 w-3'/></button></span>)}
        <input value={search} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)}
            onChange={e=>{setSearch(e.target.value);setOpen(true)}} aria-label={label+' recipients'}
            onKeyDown={e=>{if(e.key==='Enter'||e.key===','||e.key===';'){e.preventDefault();attempt();}if(e.key==='Backspace'&&!search&&value.length)onChange(value.slice(0,-1));}}
            className='h-10 min-w-[110px] flex-1 bg-transparent text-[14px] outline-none'/>
        {open&&eligible.length>0&&<div className='absolute left-10 right-0 top-[100%] z-30 max-h-64 overflow-y-auto rounded-md border p-1 shadow-xl ol-surface ol-line'>
            <p className='px-3 pb-1 pt-2 text-[11px] font-semibold ol-sub'>Suggested contacts</p>
            {eligible.map(p=><button key={p.uid} type='button' onMouseDown={e=>e.preventDefault()} onClick={()=>add(p.email)} className='flex min-h-12 w-full items-center gap-3 rounded px-3 text-left ol-hover'>
                <Persona name={p.name} email={p.email} size={32}/>
                <span className='min-w-0 flex-1'><span className='block truncate text-[14px] ol-ink'>{p.name}</span><span className='block truncate text-[12px] ol-sub'>{p.email}</span></span>
            </button>)}
        </div>}
    </div>;
}

function Compose({people,groups,me,seed,prefs,dark,onDone,onCancel,onManageGroups}:{people:Person[];groups:WorkGroup[];me:string;seed:ComposeSeed;prefs:MailPreferences;dark:boolean;onDone:(result?:{actionWarning?:string;actionId?:string})=>void;onCancel:()=>void;onManageGroups:()=>void}){
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
    const [queued,setQueued]=useState(0);
    const queueTimer=useRef<ReturnType<typeof setInterval>|null>(null);
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
        try {await callBackend('/api/org/mail/draft',payload());setDirty(false);setLastSave('Draft saved at '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));}
        catch(e){setError(e instanceof Error?e.message:'Could not save draft');}
        finally{setSaving(false);}
    };
    useEffect(()=>{
        if(!dirty||working||queued||finished.current)return;
        const timer=setTimeout(()=>{void save()},3200);
        return()=>clearTimeout(timer);
    },[data,dirty,working,queued]);
    useEffect(()=>()=>{if(queueTimer.current)clearInterval(queueTimer.current)},[]);
    const deliver=async()=>{
        setWorking(true);setError('');
        try{
            const result=await callBackend<{actionWarning?:string;actionId?:string}>('/api/org/mail/send',{...payload(),id:'m_'+uid(),draftId:data.id});
            finished.current=true;onDone(result);
        }catch(e){setError(e instanceof Error?e.message:'Email could not be sent.');setQueued(0);}
        finally{setWorking(false);}
    };
    const send=async()=>{
        if(action.enabled&&(!action.recipientUids.length||action.title.trim().length<3||action.description.trim().length<3)){setError('An email action needs assignees, a header, and a description before sending.');return;}
        if(!data.to.length&&!data.cc.length&&!data.bcc.length&&!action.recipientUids.length){setError('Choose at least one internal recipient.');return;}
        if(!data.html.replace(/<[^>]+>/g,' ').trim()&&!data.attachments.length){setError('Write a message or attach a file.');return;}
        if(!data.subject.trim()&&!(await appConfirm('Send this message without a subject?')))return;
        // Undo send: hold the message in this browser for the chosen seconds before it is delivered.
        const wait=prefs.undoSendSeconds||0;
        if(!wait){void deliver();return;}
        setQueued(wait);
        let left=wait;
        queueTimer.current=setInterval(()=>{
            left-=1;setQueued(left);
            if(left<=0){if(queueTimer.current)clearInterval(queueTimer.current);queueTimer.current=null;void deliver();}
        },1000);
    };
    const undo=()=>{if(queueTimer.current)clearInterval(queueTimer.current);queueTimer.current=null;setQueued(0);};
    const upload=async(e:ChangeEvent<HTMLInputElement>)=>{
        const files=Array.from(e.target.files||[]) as File[];e.target.value='';
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
    const discard=async()=>{if(await appConfirm('Discard this message? The saved draft stays in Drafts.')){finished.current=true;onCancel();}};
    const title=seed.mode==='reply'?'Reply':seed.mode==='replyall'?'Reply all':seed.mode==='forward'?'Forward':seed.mode==='draft'?'Draft':'New message';
    if(queued>0||(working&&prefs.undoSendSeconds))return <div className={'ol fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-4 rounded-md px-4 py-3 shadow-2xl '+(dark?'ol-dark':'')} style={{background:'#323130',color:'#fff'}} role='status'>
        <span className='text-[14px]'>{working?'Sending…':'Sending in '+queued+'s'}</span>
        {!working&&<button type='button' onClick={undo} className='text-[14px] font-semibold' style={{color:'#9ccbf3'}}>Undo</button>}
    </div>;
    return <div role='dialog' aria-modal='true' aria-label='Compose internal email' className={'ol fixed inset-0 z-[85] flex items-center justify-center bg-[rgba(0,0,0,0.4)] p-0 sm:p-4 '+(dark?'ol-dark':'')}>
        <div className='flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden shadow-2xl ol-surface sm:h-[min(92dvh,920px)] sm:rounded-lg'>
            <header className='flex min-h-12 shrink-0 items-center gap-1 border-b px-2 ol-line sm:px-3'>
                <button type='button' aria-label='Close composer' onClick={()=>{void close()}} className='flex h-10 w-10 items-center justify-center rounded ol-hover sm:hidden'><X className='h-5 w-5'/></button>
                <button type='button' disabled={working||attachBusy} onClick={()=>{void send()}} className='hidden h-9 items-center gap-2 rounded px-4 text-[14px] font-semibold ol-primary disabled:opacity-40 sm:flex'><Send className='h-4 w-4'/>Send</button>
                <button type='button' onClick={()=>{void discard()}} className='hidden h-9 items-center gap-1.5 rounded px-3 text-[14px] ol-hover sm:flex'><Trash2 className='h-4 w-4'/>Discard</button>
                <span className='min-w-0 flex-1 truncate px-2 text-[15px] font-semibold sm:text-[14px] sm:font-normal sm:ol-sub'>{title}</span>
                <label className='flex h-10 cursor-pointer items-center gap-1.5 rounded px-2.5 text-[14px] ol-hover' title='Attach file'><Paperclip className='h-[18px] w-[18px]'/><span className='hidden sm:inline'>{attachBusy?'Attaching…':'Attach'}</span><input multiple type='file' className='hidden' disabled={attachBusy||working} accept='.pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp' onChange={e=>{void upload(e)}}/></label>
                <button type='button' aria-label='Save draft' title='Save draft' onClick={()=>{void save()}} className='flex h-10 w-10 items-center justify-center rounded ol-hover'><Save className='h-[18px] w-[18px]'/></button>
                <button type='button' aria-label='Send' disabled={working||attachBusy} onClick={()=>{void send()}} className='flex h-10 w-10 items-center justify-center rounded ol-link disabled:opacity-40 sm:hidden'><Send className='h-5 w-5'/></button>
                <button type='button' aria-label='Close composer' onClick={()=>{void close()}} className='hidden h-10 w-10 items-center justify-center rounded ol-hover sm:flex'><X className='h-5 w-5'/></button>
            </header>
            <div className='min-h-0 flex-1 overflow-y-auto px-3 py-1 sm:px-5'>
                <div className='flex min-h-11 items-center gap-2 border-b text-[13px] ol-line'>
                    <span className='w-10 shrink-0 ol-sub'>From</span><span className='min-w-0 flex-1 truncate ol-ink'>{me}</span>
                    {!showCc&&<button type='button' className='min-h-10 px-2 text-[13px] ol-link' onClick={()=>setShowCc(true)}>Cc</button>}
                    {!showBcc&&<button type='button' className='min-h-10 px-2 text-[13px] ol-link' onClick={()=>setShowBcc(true)}>Bcc</button>}
                </div>
                <RecipientInput label='To' value={data.to} people={people} exclude={[...data.cc,...data.bcc]} onChange={to=>patch({to})}/>
                {showCc&&<RecipientInput label='Cc' value={data.cc} people={people} exclude={[...data.to,...data.bcc]} onChange={cc=>patch({cc})}/>}
                {showBcc&&<RecipientInput label='Bcc' value={data.bcc} people={people} exclude={[...data.to,...data.cc]} onChange={bcc=>patch({bcc})}/>}
                <input value={data.subject} onChange={e=>patch({subject:e.target.value})} placeholder='Add a subject' aria-label='Subject' maxLength={250}
                    className='h-12 w-full border-b bg-transparent px-1 text-[16px] outline-none ol-line'/>
                <div className='flex flex-wrap items-center gap-2 border-b py-2 ol-line'>
                    <Users className='h-4 w-4 shrink-0 ol-sub'/>
                    <select aria-label='Quick add team recipients' className='h-9 min-w-0 max-w-[240px] flex-1 rounded bg-transparent px-2 text-[13px] ol-input' defaultValue='' onChange={e=>{applyGroup(e.target.value);e.target.value=''}}><option value=''>Add a team…</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.memberUids.length}</option>)}</select>
                    <button type='button' onClick={onManageGroups} className='h-9 rounded px-2 text-[13px] ol-link'>Manage teams</button>
                    <label className='ml-auto flex items-center gap-1.5 text-[13px] ol-sub'>Importance
                        <select aria-label='Email importance' value={data.priority} onChange={e=>patch({priority:e.target.value})} className='h-9 rounded bg-transparent px-2 text-[13px] ol-input'>
                            <option value='normal'>Normal</option><option value='high'>High</option><option value='low'>Low</option>
                        </select>
                    </label>
                </div>
                {data.attachments.length>0&&<div className='mt-2 flex flex-wrap gap-2'>{data.attachments.map(a=><div key={a.id} className='flex min-w-0 max-w-[260px] items-center gap-2 rounded border px-2 py-2 text-[13px] ol-line'>
                    <FileText className='h-6 w-6 shrink-0 ol-link'/><span className='min-w-0 flex-1'><span className='block truncate ol-ink' title={a.name}>{a.name}</span><span className='block text-[11px] ol-sub'>{Math.ceil(a.size/1024)} KB</span></span>
                    <button type='button' aria-label={'Remove '+a.name} onClick={()=>patch({attachments:data.attachments.filter(x=>x.id!==a.id)})}><X className='h-4 w-4'/></button>
                </div>)}</div>}
                <div className='mt-2 flex min-h-[180px] flex-col' title='Drag the lower edge to resize the writing area'>
                    <MailRichEditor html={initial.html} onChange={html=>{if(html!==data.html)patch({html})}}/>
                </div>
                <div className='mt-3 rounded border ol-line'>
                    <button type='button' onClick={()=>setActionExpanded(v=>!v)} className='flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] font-semibold ol-link'><ListChecks className='h-4 w-4'/> Monitored action {action.enabled?'· on':''}<ChevronDown className={'ml-auto h-4 w-4 transition-transform '+(actionExpanded?'rotate-180':'')}/></button>
                    {actionExpanded&&<div className='space-y-3 border-t px-3 py-3 ol-line'>
                        <label className='flex items-center gap-2 text-[13px] ol-ink'><input type='checkbox' checked={action.enabled} onChange={e=>{setAction(v=>({...v,enabled:e.target.checked}));setDirty(true)}} className='h-4 w-4 accent-[#0f6cbd]'/>Include a monitored action with this email</label>
                        {action.enabled&&<>
                            <label className='block text-[12px] ol-sub'>Action title<input maxLength={180} value={action.title} onChange={e=>{setAction(v=>({...v,title:e.target.value}));setDirty(true)}} className='mt-1 h-10 w-full px-2 text-[14px] ol-input' placeholder='Task for colleagues to complete'/></label>
                            <label className='block text-[12px] ol-sub'>Description<textarea value={action.description} rows={2} maxLength={2400} onChange={e=>{setAction(v=>({...v,description:e.target.value}));setDirty(true)}} className='mt-1 w-full resize-y p-2 text-[14px] ol-input' placeholder='Expected result'/></label>
                            <label className='block text-[12px] ol-sub'>Deadline<input type='date' value={action.deadline} onChange={e=>{setAction(v=>({...v,deadline:e.target.value}));setDirty(true)}} className='mt-1 h-10 w-full px-2 text-[14px] ol-input'/></label>
                            <ActionPhotoInput value={action.photoPath} onChange={photoPath=>{setAction(v=>({...v,photoPath}));setDirty(true)}} label='Attach action photo'/>
                            {!!groups.length&&<select aria-label='Assign whole team' defaultValue='' className='h-10 w-full px-2 text-[14px] ol-input' onChange={e=>{const g=groups.find(g=>g.id===e.target.value);if(g){applyGroup(g.id);setAction(v=>({...v,recipientUids:[...new Set([...v.recipientUids,...g.memberUids.filter(uid=>people.some(p=>p.uid===uid&&p.email.toLowerCase()!==me.toLowerCase()))])]}));setDirty(true)}e.target.value=''}}><option value=''>Assign to a team</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>}
                            <p className='text-[11px] ol-sub'>Only the colleagues ticked below receive the action; they are added to To automatically.</p>
                            <div className='max-h-40 space-y-1 overflow-y-auto'>{people.filter(p=>p.email.toLowerCase()!==me.toLowerCase()).map(p=><label key={p.uid} className='flex min-h-10 items-center gap-2 rounded px-2 text-[13px] ol-hover'><input type='checkbox' checked={action.recipientUids.includes(p.uid)} onChange={e=>setAssigned(p.uid,e.target.checked)} className='h-4 w-4 accent-[#0f6cbd]'/><Persona name={p.name} email={p.email} size={24}/><span className='min-w-0 flex-1 truncate ol-ink'>{p.name}</span></label>)}</div>
                        </>}
                    </div>}
                </div>
                <div className='mt-2 rounded border ol-line'>
                    <button type='button' aria-expanded={showMessageOptions} onClick={()=>setShowMessageOptions(v=>!v)} className='flex min-h-11 w-full items-center justify-between px-3 text-left text-[13px] font-semibold ol-link'>Message permissions <ChevronDown className={'h-4 w-4 transition-transform '+(showMessageOptions?'rotate-180':'')}/></button>
                    {showMessageOptions&&<div className='grid gap-1 border-t px-3 py-2 ol-line sm:grid-cols-3'>
                        {([{key:'allowReply' as const,label:'Allow reply'},{key:'allowReplyAll' as const,label:'Allow reply all'},{key:'allowDelete' as const,label:'Allow recipients to delete'}]).map(option=><label key={option.key} className='flex min-h-10 items-center gap-2 text-[13px] ol-ink'><input type='checkbox' checked={messageOptions[option.key]} onChange={e=>{setMessageOptions(x=>({...x,[option.key]:e.target.checked}));setDirty(true)}} className='h-4 w-4 accent-[#0f6cbd]'/>{option.label}</label>)}
                    </div>}
                </div>
                {error&&<p role='alert' className='mt-3 rounded border-l-4 px-3 py-2 text-[13px] ol-danger' style={{borderColor:'var(--ol-danger)',background:'rgba(197,15,31,0.08)'}}>{error}</p>}
                <p className='py-3 text-[11px] ol-sub'>{saving?'Saving…':dirty?'Unsaved changes':lastSave||'Internal delivery to colleagues in your organization'}{prefs.undoSendSeconds?' · Undo send: '+prefs.undoSendSeconds+'s':''}</p>
            </div>
        </div>
    </div>;
}

type Swipe=MailPreferences['swipeLeft'];
const SWIPE_STYLE:Record<Swipe,{label:string;color:string;Icon:typeof Mail}>={
    archive:{label:'Archive',color:'#107c10',Icon:Archive},delete:{label:'Delete',color:'#c50f1f',Icon:Trash2},
    flag:{label:'Flag',color:'#ca5010',Icon:Flag},read:{label:'Read / unread',color:'#0f6cbd',Icon:MailOpen},
    move:{label:'Move',color:'#5c2e91',Icon:FolderClosed},none:{label:'',color:'transparent',Icon:Mail},
};

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
    const [searchOpen,setSearchOpen]=useState(false);
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
    const [more,setMore]=useState(false);
    const [moveFor,setMoveFor]=useState<string[]|null>(null);
    const [swipe,setSwipe]=useState<{id:string;dx:number}|null>(null);
    const swipeStart=useRef<{id:string;x:number;y:number;on:boolean}|null>(null);
    const readTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
    const myUid=people.find(p=>p.email.toLowerCase()===myEmail.toLowerCase())?.uid||'';
    const dark=prefersDark(mailPrefs.appearance);
    const reloadGroups=useCallback(async()=>{try{const r=await callBackend<{groups:WorkGroup[]}>('/api/org/work-groups/list');setGroups(r.groups);}catch(e){setError(e instanceof Error?e.message:'Could not load teams');}},[]);
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
        void Promise.all([refresh(),callBackend<{people:Person[]}>('/api/org/mail/people').then(r=>{if(active)setPeople(r.people)}).catch(()=>undefined),callBackend<{preferences:MailPreferences}>('/api/org/mail/preferences').then(r=>{if(active)setMailPrefs({...defaultMailPrefs,...r.preferences})}).catch(()=>undefined),reloadGroups()]);
        const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(true)},30000);
        return()=>{active=false;clearInterval(timer)};
    },[refresh,reloadGroups]);
    const open=async(id:string)=>{
        setSelected(id);setDetail(null);setChecked([]);setMore(false);
        if(readTimer.current)clearTimeout(readTimer.current);
        // Mark as read: when opened, after a delay, or only by hand (Settings › Message handling).
        const markNow=mailPrefs.markRead==='select'||(mailPrefs.markRead==='delay'&&mailPrefs.markReadDelay===0);
        try{const r=await callBackend<{item:MailItem}>('/api/org/mail/read',{id,markRead:markNow});setDetail(r.item);
            if(markNow)setItems(old=>old.map(item=>item.id===id?{...item,read:true}:item));
            else if(mailPrefs.markRead==='delay'&&!r.item.read)readTimer.current=setTimeout(()=>{void change('read',[id],{},true)},mailPrefs.markReadDelay*1000);
        }
        catch(e){setError(e instanceof Error?e.message:'Email could not be opened');}
    };
    useEffect(()=>{if(initialId)void open(initialId)},[initialId]);
    useEffect(()=>()=>{if(readTimer.current)clearTimeout(readTimer.current)},[]);
    const change=async(action:string,ids:string[],extra:Record<string,unknown>={},quiet=false)=>{
        if(!ids.length)return;
        try{
            await callBackend('/api/org/mail/change',{action,ids,...extra});
            if(!quiet)setNotice(action==='delete'?'Moved to Deleted Items':action==='destroy'?'Permanently deleted':action==='move'?'Moved':action==='read'?'Marked as read':action==='unread'?'Marked as unread':'Updated');
            if(['delete','destroy','move'].includes(action)&&ids.includes(selected)){setSelected('');setDetail(null);}
            if(action==='read'||action==='unread')setDetail(d=>d&&ids.includes(d.id)?{...d,read:action==='read'}:d);
            if(action==='flag'||action==='unflag')setDetail(d=>d&&ids.includes(d.id)?{...d,flagged:action==='flag'}:d);
            setChecked([]);await refresh(true);
        }catch(e){setError(e instanceof Error?e.message:'Cannot update mail');}
    };
    const list=useMemo(()=>{
        const q=search.trim().toLowerCase();
        const all=items.filter(m=>{
            if(!q&&m.folder!==folder)return false;
            if(q&&m.folder==='deleted'&&folder!=='deleted')return false;
            if(!q&&folder==='inbox'&&mailPrefs.focusedInbox&&m.focus!==(focus==='focused'))return false;
            if(filter==='unread'&&m.read)return false;
            if(filter==='starred'&&!m.starred)return false;
            if(filter==='flagged'&&!m.flagged)return false;
            if(filter==='attachments'&&!m.attachments.length)return false;
            if(filter==='mentions'&&!(m.to.includes(myEmail.toLowerCase())))return false;
            if(!q)return true;
            const term=q.replace(/^(from:|subject:)/,'');
            if(q.startsWith('from:'))return m.fromEmail.toLowerCase().includes(term)||m.fromName.toLowerCase().includes(term);
            if(q.startsWith('subject:'))return m.subject.toLowerCase().includes(term);
            if(q==='has:attachment')return !!m.attachments.length;
            return [m.subject,m.fromName,m.fromEmail,m.excerpt,...m.to].join(' ').toLowerCase().includes(q);
        });
        return all.sort((a,b)=>(b.sentAt||b.updatedAt).localeCompare(a.sentAt||a.updatedAt));
    },[items,folder,search,focus,filter,mailPrefs.focusedInbox,myEmail]);
    const grouped=useMemo(()=>{
        if(!mailPrefs.conversationView)return list.map(m=>({lead:m,count:1,unread:!m.read}));
        const m=new Map<string,{lead:MailItem;count:number;unread:boolean}>();
        for(const item of list){const k=item.threadId||item.id;const g=m.get(k);if(!g)m.set(k,{lead:item,count:1,unread:!item.read});else{g.count++;g.unread=g.unread||!item.read;}}
        return [...m.values()];
    },[list,mailPrefs.conversationView]);
    const sections=useMemo(()=>{
        const out:Array<{label:string;rows:typeof grouped}>=[];
        for(const g of grouped){const label=dateGroup(g.lead.sentAt||g.lead.updatedAt);const last=out[out.length-1];if(last&&last.label===label)last.rows.push(g);else out.push({label,rows:[g]});}
        return out;
    },[grouped]);
    const thread=detail?items.filter(item=>item.threadId===detail.threadId&&item.id!==detail.id&&item.folder!=='deleted').sort((a,b)=>a.sentAt.localeCompare(b.sentAt)):[];
    const count=(key:string)=>items.filter(m=>m.folder===key).length;
    const unread=(key:string)=>items.filter(m=>m.folder===key&&!m.read&&(key!=='inbox'||!mailPrefs.focusedInbox||m.focus)).length;
    const foldersDisplay=[...STANDARD,...folders.map(f=>({id:f.id,label:f.name,Icon:FolderClosed}))];
    const gotoFolder=(id:string)=>{setFolder(id);setMenu(false);setSelected('');setDetail(null);setChecked([]);setFilter('all');setSearch('');setSearchOpen(false);};
    const newFolder=async()=>{
        const name=(await appPrompt('New folder name'));
        if(!name)return;
        if(name.trim().length<2)return setError('A folder name needs at least 2 characters.');
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
    const bulkItems=items.filter(m=>bulk.includes(m.id));
    const swipeDo=(kind:Swipe,m:MailItem)=>{
        if(kind==='archive')void change('move',[m.id],{folder:'archive'});
        else if(kind==='delete')void change(m.folder==='deleted'?'destroy':'delete',[m.id]);
        else if(kind==='flag')void change(m.flagged?'unflag':'flag',[m.id]);
        else if(kind==='read')void change(m.read?'unread':'read',[m.id]);
        else if(kind==='move')setMoveFor([m.id]);
    };
    const pad=mailPrefs.density==='compact'?'py-1.5':mailPrefs.density==='full'?'py-3.5':'py-2.5';
    const avatar=mailPrefs.showSenderImage&&mailPrefs.density!=='compact';
    const cmd=(label:string,Icon:typeof Mail,click:()=>void,disabled=false,text=true)=><button type='button' aria-label={label} title={label} onClick={click} disabled={disabled} className='flex h-9 shrink-0 items-center gap-1.5 rounded px-2 text-[14px] ol-hover disabled:opacity-35'><Icon className='h-[18px] w-[18px]'/>{text&&<span className='hidden xl:inline'>{label}</span>}</button>;
    const pane=mailPrefs.readingPane;
    const currentFolder=search.trim()?'Search results':foldersDisplay.find(f=>f.id===folder)?.label||'Mail';
    return <div className={'ol fixed inset-0 z-[60] flex h-[100dvh] w-full flex-col overflow-hidden '+(dark?'ol-dark':'')} aria-label='Organization internal Email'>
        {/* App bar: always on top */}
        <header className='flex min-h-12 shrink-0 items-center gap-1 px-1.5 pt-[env(safe-area-inset-top)] ol-appbar sm:gap-2 sm:px-3'>
            <button type='button' aria-label='Back to organization home' className='flex h-10 w-10 shrink-0 items-center justify-center rounded hover:bg-[rgba(255,255,255,0.12)]' onClick={()=>navigate('organization_home')}><ArrowLeft className='h-5 w-5'/></button>
            <button type='button' aria-label='Show folders' className='flex h-10 w-10 shrink-0 items-center justify-center rounded hover:bg-[rgba(255,255,255,0.12)] lg:hidden' onClick={()=>setMenu(true)}><Menu className='h-5 w-5'/></button>
            <span className='hidden text-[16px] font-semibold sm:block'>Mail</span>
            <label className='mx-auto hidden h-8 w-full max-w-[480px] items-center gap-2 rounded px-3 sm:flex' style={{background:'rgba(255,255,255,0.92)',color:'#242424'}}>
                <Search className='h-4 w-4 text-[#616161]'/><input value={search} onChange={e=>setSearch(e.target.value)} aria-label='Search mail' placeholder='Search · from: · subject: · has:attachment' className='min-w-0 flex-1 bg-transparent text-[14px] text-[#242424] outline-none placeholder:text-[#616161]'/>{search&&<button type='button' onClick={()=>setSearch('')} aria-label='Clear search'><X className='h-4 w-4'/></button>}
            </label>
            <span className='flex-1 sm:hidden'/>
            <button type='button' aria-label='Search mail' onClick={()=>setSearchOpen(v=>!v)} className='flex h-10 w-10 items-center justify-center rounded hover:bg-[rgba(255,255,255,0.12)] sm:hidden'><Search className='h-5 w-5'/></button>
            <button type='button' aria-label='Teams' title='Teams' onClick={()=>setShowGroupManager(true)} className='flex h-10 w-10 items-center justify-center rounded hover:bg-[rgba(255,255,255,0.12)]'><Users className='h-5 w-5'/></button>
            <button type='button' aria-label='Settings' title='Settings' onClick={()=>setShowMailSettings(true)} className='flex h-10 w-10 items-center justify-center rounded hover:bg-[rgba(255,255,255,0.12)]'><Settings2 className='h-5 w-5'/></button>
            <span className='hidden sm:block'><Persona name={people.find(p=>p.uid===myUid)?.name||myEmail} email={myEmail} size={30}/></span>
        </header>
        {searchOpen&&<div className='flex shrink-0 items-center gap-2 border-b px-3 py-2 ol-surface ol-line sm:hidden'><Search className='h-4 w-4 ol-sub'/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} aria-label='Search mail' placeholder='Search mail' className='min-w-0 flex-1 bg-transparent text-[15px] outline-none'/>{search&&<button type='button' onClick={()=>setSearch('')} aria-label='Clear search'><X className='h-4 w-4'/></button>}</div>}
        {area==='calendar'?<div className='flex min-h-0 flex-1 flex-col bg-page text-ink'><MailCalendar uid={myUid} people={people} groups={groups} onClose={()=>setArea('mail')}/></div>:
            area==='actions'?<div className='min-h-0 flex-1 overflow-y-auto bg-page p-3 text-ink sm:p-6'><UnifiedActions uid={myUid} mode='sent' sourceFilter='email'/></div>:
        <div className='flex min-h-0 flex-1 overflow-hidden'>
            {menu&&<button type='button' className='fixed inset-0 z-[65] bg-[rgba(0,0,0,0.4)] lg:hidden' aria-label='Close folders' onClick={()=>setMenu(false)}/>}
            {/* Folder pane */}
            <aside className={'z-[66] flex w-[260px] shrink-0 flex-col ol-surface2 '+(menu?'fixed inset-y-0 left-0 shadow-2xl':'hidden')+' lg:static lg:flex'}>
                <div className='p-3'><button type='button' onClick={()=>{setMenu(false);composeMail('new')}} className='flex h-9 w-full items-center justify-center gap-2 rounded text-[14px] font-semibold ol-primary'><Edit3 className='h-4 w-4'/>New mail</button></div>
                <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
                    <p className='flex items-center justify-between px-2 pb-1 pt-2 text-[13px] font-semibold ol-ink'><span className='flex items-center gap-1'><ChevronDown className='h-4 w-4'/>Folders</span><button type='button' title='Create folder' aria-label='Create mail folder' onClick={()=>{void newFolder()}} className='flex h-8 w-8 items-center justify-center rounded ol-hover'><FolderPlus className='h-4 w-4'/></button></p>
                    {foldersDisplay.map(f=>{const n=unread(f.id);const on=folder===f.id&&!search.trim();return <button key={f.id} type='button' aria-current={on?'page':undefined} onClick={()=>gotoFolder(f.id)}
                        className={'relative mb-0.5 flex min-h-10 w-full items-center gap-3 rounded px-3 text-left text-[14px] '+(on?'ol-selected font-semibold':'ol-hover')}>
                        {on&&<span className='absolute left-0 top-2 bottom-2 w-[3px] rounded' style={{background:'var(--ol-brand)'}}/>}
                        <f.Icon className='h-[18px] w-[18px] shrink-0'/><span className='min-w-0 flex-1 truncate'>{f.label}</span>
                        {n>0?<span className='text-[13px] font-semibold ol-link'>{n}</span>:f.id==='drafts'&&count('drafts')?<span className='text-[12px] ol-sub'>{count('drafts')}</span>:null}
                    </button>})}
                    {folder.startsWith('f_')&&<div className='mt-3 flex gap-3 px-3'><button type='button' onClick={()=>{void renameFolder()}} className='text-[13px] ol-link'>Rename</button><button type='button' onClick={()=>{void deleteFolder()}} className='text-[13px] ol-danger'>Delete folder</button></div>}
                    <div className='mt-4 border-t pt-3 ol-line'>
                        {([{key:'calendar' as const,label:'Calendar',Icon:CalendarDays},{key:'actions' as const,label:'Monitored actions',Icon:ListChecks}]).map(x=><button key={x.key} type='button' onClick={()=>{setArea(x.key);setMenu(false);}} className='flex min-h-10 w-full items-center gap-3 rounded px-3 text-left text-[14px] ol-hover'><x.Icon className='h-[18px] w-[18px]'/>{x.label}</button>)}
                    </div>
                </div>
                <div className='border-t p-3 text-[11px] leading-5 ol-line ol-sub'><ShieldCheck className='mr-1 inline h-4 w-4'/> Mail stays inside your organization. Internet email delivery is not enabled.</div>
            </aside>
            <div className={'flex min-h-0 min-w-0 flex-1 '+(pane==='bottom'?'flex-col':'flex-row')}>
            {/* Message list */}
            <section className={'flex min-h-0 min-w-0 flex-col ol-surface '+(selected?'hidden lg:flex':'flex')+(pane==='right'?' w-full lg:w-[380px] xl:w-[420px] lg:shrink-0 lg:border-r ol-line':pane==='bottom'?' w-full lg:h-[45%] lg:shrink-0 lg:border-b ol-line':' w-full'+(selected?' lg:hidden':''))} aria-label='Message list'>
                <div className='shrink-0 border-b px-3 pb-1 pt-2 ol-line'>
                    <div className='flex items-center gap-2'>
                        {mailPrefs.focusedInbox&&folder==='inbox'&&!search.trim()?<div className='flex min-w-0 flex-1 gap-4' role='tablist'>
                            {(['focused','other'] as const).map(k=>{const n=items.filter(m=>m.folder==='inbox'&&!m.read&&m.focus===(k==='focused')).length;return <button type='button' key={k} role='tab' aria-selected={focus===k} onClick={()=>setFocus(k)} className={'relative h-9 text-[14px] '+(focus===k?'font-semibold ol-ink':'ol-sub')}>
                                {k==='focused'?'Focused':'Other'}{k==='other'&&n>0?<span className='ml-1 text-[12px] ol-link'>{n}</span>:null}
                                {focus===k&&<span className='absolute inset-x-0 bottom-0 h-[3px] rounded' style={{background:'var(--ol-brand)'}}/>}
                            </button>})}
                        </div>:<h2 className='min-w-0 flex-1 truncate text-[16px] font-semibold'>{currentFolder}</h2>}
                        {(loading||refreshing)&&<RefreshCw className='h-4 w-4 animate-spin ol-sub'/>}
                        <label className='flex items-center gap-1 text-[13px] ol-sub' title='Filter'><Filter className='h-4 w-4'/>
                            <select aria-label='Filter mail list' value={filter} onChange={e=>setFilter(e.target.value)} className='h-9 max-w-[120px] bg-transparent text-[13px] outline-none'>
                                <option value='all'>All</option><option value='unread'>Unread</option><option value='flagged'>Flagged</option><option value='starred'>Pinned</option><option value='mentions'>To me</option><option value='attachments'>Has files</option>
                            </select></label>
                        <label className='flex h-9 w-9 items-center justify-center' title='Select all'><input type='checkbox' aria-label='Select all visible messages' checked={grouped.length>0&&grouped.every(x=>checked.includes(x.lead.id))} onChange={e=>setChecked(e.target.checked?grouped.map(g=>g.lead.id):[])} className='h-4 w-4 accent-[#0f6cbd]'/></label>
                    </div>
                    {!!checked.length&&<div className='mt-1 flex items-center gap-1 rounded px-1 py-0.5 ol-selected'><span className='px-2 text-[13px] font-semibold'>{checked.length} selected</span><span className='flex-1'/>
                        {cmd('Archive',Archive,()=>{void change('move',checked,{folder:'archive'})},false,false)}{cmd('Delete',Trash2,()=>{void change('delete',checked)},false,false)}{cmd('Mark as read',MailOpen,()=>{void change('read',checked)},false,false)}{cmd('Move to',FolderClosed,()=>setMoveFor(checked),false,false)}{cmd('Clear selection',X,()=>setChecked([]),false,false)}</div>}
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                    {error&&<p role='alert' className='border-l-4 px-3 py-2 text-[13px] ol-danger' style={{borderColor:'var(--ol-danger)',background:'rgba(197,15,31,0.08)'}}>{error}</p>}
                    {!loading&&!grouped.length&&<div className='flex flex-col items-center gap-2 p-10 text-center'><Inbox className='h-12 w-12 ol-sub'/><p className='text-[15px] font-semibold'>{search.trim()?'No results':'All caught up'}</p><p className='text-[13px] ol-sub'>{search.trim()?'Try other words or filters.':folder==='inbox'&&mailPrefs.focusedInbox&&focus==='focused'?'Nothing in Focused. Check Other.':'No messages in this folder.'}</p></div>}
                    {sections.map(sec=><div key={sec.label}>
                        <p className='sticky top-0 z-[1] px-4 py-1.5 text-[12px] font-semibold ol-surface ol-sub'>{sec.label}</p>
                        {sec.rows.map(({lead:m,count:n,unread:isUnread})=>{
                            const sent=folder==='sent'||m.folder==='sent';
                            const who=sent?addr(m.to,people)||'Recipient':m.fromName||m.fromEmail;
                            const dx=swipe?.id===m.id?swipe.dx:0;
                            const side:Swipe=dx>0?mailPrefs.swipeRight:mailPrefs.swipeLeft;
                            const ss=SWIPE_STYLE[side];
                            return <div key={m.id} className='relative overflow-hidden'>
                                {dx!==0&&side!=='none'&&<div className={'absolute inset-0 flex items-center px-5 text-[#fff] '+(dx>0?'justify-start':'justify-end')} style={{background:ss.color}}><ss.Icon className='h-5 w-5'/><span className='ml-2 text-[13px] font-semibold'>{ss.label}</span></div>}
                                <div className={'group relative flex items-start gap-3 border-b pl-4 pr-2 transition-colors ol-line '+pad+' '+(selected===m.id?'ol-selected':checked.includes(m.id)?'ol-selected':'ol-surface ol-hover')}
                                    style={{transform:dx?`translateX(${dx}px)`:undefined,touchAction:'pan-y'}}
                                    onPointerDown={e=>{if(e.pointerType!=='mouse')swipeStart.current={id:m.id,x:e.clientX,y:e.clientY,on:false}}}
                                    onPointerMove={e=>{const s=swipeStart.current;if(!s||s.id!==m.id)return;const ddx=e.clientX-s.x,ddy=e.clientY-s.y;if(!s.on&&Math.abs(ddx)>14&&Math.abs(ddy)<12)s.on=true;if(s.on)setSwipe({id:m.id,dx:Math.max(-140,Math.min(140,ddx))});}}
                                    onPointerUp={()=>{const s=swipeStart.current;swipeStart.current=null;if(s?.on&&swipe&&Math.abs(swipe.dx)>90)swipeDo(swipe.dx>0?mailPrefs.swipeRight:mailPrefs.swipeLeft,m);setSwipe(null);}}
                                    onPointerCancel={()=>{swipeStart.current=null;setSwipe(null);}}>
                                    {isUnread&&<span className='absolute left-0 top-0 bottom-0 w-[3px]' style={{background:'var(--ol-brand)'}} aria-label='Unread'/>}
                                    {avatar?<label className='relative mt-0.5 shrink-0 cursor-pointer'>
                                        <span className={checked.includes(m.id)?'hidden':'group-hover:hidden'}><Persona name={who} email={sent?m.to[0]||'':m.fromEmail} size={34}/></span>
                                        <input type='checkbox' aria-label={'Select '+m.subject} checked={checked.includes(m.id)} onChange={e=>setChecked(old=>e.target.checked?[...old,m.id]:old.filter(id=>id!==m.id))} className={(checked.includes(m.id)?'':'hidden group-hover:block ')+'m-2 h-[18px] w-[18px] accent-[#0f6cbd]'}/>
                                    </label>:<input type='checkbox' aria-label={'Select '+m.subject} checked={checked.includes(m.id)} onChange={e=>setChecked(old=>e.target.checked?[...old,m.id]:old.filter(id=>id!==m.id))} className='mt-1 h-4 w-4 shrink-0 accent-[#0f6cbd]'/>}
                                    <button type='button' onClick={()=>{if(!swipe)void open(m.id)}} className='min-w-0 flex-1 text-left'>
                                        <span className='flex items-baseline gap-2'><span className={'min-w-0 flex-1 truncate text-[14px] '+(isUnread?'font-semibold ol-ink':'ol-ink')}>{who}{n>1&&<span className='ml-1 font-normal ol-sub'>({n})</span>}</span>
                                            <span className='flex shrink-0 items-center gap-1 text-[12px] ol-sub'>
                                                {m.attachments.length>0&&<Paperclip className='h-3.5 w-3.5'/>}
                                                {m.priority==='high'&&<span className='font-bold ol-danger' aria-label='High importance'>!</span>}
                                                <time className={isUnread?'font-semibold ol-link':''}>{listTime(m.sentAt||m.updatedAt)}</time></span></span>
                                        <span className={'block truncate text-[13px] '+(isUnread?'font-semibold ol-link':'ol-ink')}>{m.subject||'(No subject)'}</span>
                                        {mailPrefs.showPreview&&mailPrefs.density!=='compact'&&<span className='block truncate text-[13px] ol-sub'>{m.excerpt||'(No preview)'}</span>}
                                        {(m.category||m.flagged)&&<span className='mt-1 flex items-center gap-1.5'>{m.category&&<span className='rounded px-1.5 text-[11px] ol-chip'>{m.category}</span>}{m.flagged&&<Flag className='h-3.5 w-3.5' style={{color:'var(--ol-flag)'}} fill='currentColor'/>}</span>}
                                    </button>
                                    <span className='hidden shrink-0 flex-col gap-0.5 group-hover:flex'>
                                        <button type='button' aria-label='Delete' title='Delete' onClick={()=>{void change(m.folder==='deleted'?'destroy':'delete',[m.id])}} className='flex h-7 w-7 items-center justify-center rounded ol-hover'><Trash2 className='h-4 w-4'/></button>
                                        <button type='button' aria-label={m.read?'Mark as unread':'Mark as read'} title={m.read?'Mark as unread':'Mark as read'} onClick={()=>{void change(m.read?'unread':'read',[m.id])}} className='flex h-7 w-7 items-center justify-center rounded ol-hover'>{m.read?<Mail className='h-4 w-4'/>:<MailOpen className='h-4 w-4'/>}</button>
                                        <button type='button' aria-label={m.flagged?'Clear flag':'Flag'} title={m.flagged?'Clear flag':'Flag'} onClick={()=>{void change(m.flagged?'unflag':'flag',[m.id])}} className='flex h-7 w-7 items-center justify-center rounded ol-hover'><Flag className='h-4 w-4'/></button>
                                    </span>
                                </div>
                            </div>;
                        })}
                    </div>)}
                    <div className='h-20 lg:hidden'/>
                </div>
            </section>
            {/* Reading pane */}
            <main className={'min-h-0 min-w-0 flex-1 flex-col ol-surface '+(selected?'flex':pane==='off'?'hidden':'hidden lg:flex')} aria-label='Reading pane'>
                {selected&&!detail?<div className='flex flex-1 items-center justify-center text-[14px] ol-sub'><RefreshCw className='mr-2 h-4 w-4 animate-spin'/>Opening…</div>:
                detail?<div className='flex min-h-0 flex-1 flex-col'>
                    <div className='flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1 py-1 ol-line sm:px-2'>
                        <button type='button' className='flex h-9 items-center gap-1 rounded px-2 text-[14px] ol-link lg:hidden' onClick={()=>{setSelected('');setDetail(null)}}><ChevronLeft className='h-5 w-5'/></button>
                        {cmd('Delete',Trash2,()=>{void change(detail.folder==='deleted'?'destroy':'delete',[detail.id])},detail.allowDelete===false)}
                        {cmd('Archive',Archive,()=>{void change('move',[detail.id],{folder:'archive'})})}
                        {cmd('Move to',FolderClosed,()=>setMoveFor([detail.id]))}
                        {detail.folder==='deleted'&&cmd('Restore',Undo2,()=>{void change('restore',[detail.id])})}
                        <span className='mx-1 h-5 w-px shrink-0' style={{background:'var(--ol-line)'}}/>
                        {cmd(detail.read?'Mark as unread':'Mark as read',detail.read?Mail:MailOpen,()=>{void change(detail.read?'unread':'read',[detail.id])})}
                        {cmd(detail.flagged?'Clear flag':'Flag',Flag,()=>{void change(detail.flagged?'unflag':'flag',[detail.id])})}
                        {cmd(detail.starred?'Unpin':'Pin',Star,()=>{void change(detail.starred?'unstar':'star',[detail.id])})}
                        <span className='flex-1'/>
                        <div className='relative'>
                            {cmd('More actions',MoreHorizontal,()=>setMore(v=>!v),false,false)}
                            {more&&<div className='absolute right-0 top-10 z-20 w-56 overflow-hidden rounded-md border py-1 shadow-2xl ol-surface ol-line' role='menu'>
                                {[
                                    ['Print',()=>window.print()],
                                    [detail.focus?'Move to Other':'Move to Focused',()=>{void change(detail.focus?'other':'focused',[detail.id])}],
                                    ...MAIL_CATEGORIES.map(c=>['Categorize: '+c,()=>{void change('category',[detail.id],{category:c});setDetail(d=>d?{...d,category:c}:d)}] as [string,()=>void]),
                                    ['Clear category',()=>{void change('category',[detail.id],{category:''});setDetail(d=>d?{...d,category:''}:d)}],
                                    ['Block sender',async()=>{if(!(await appConfirm('Block '+detail.fromEmail+'? Their future mail goes to Junk Email.')))return;try{const r=await callBackend<{preferences:MailPreferences}>('/api/org/mail/preferences/save',{blockedSenders:[...new Set([...mailPrefs.blockedSenders,detail.fromEmail.toLowerCase()])],safeSenders:mailPrefs.safeSenders.filter(e=>e!==detail.fromEmail.toLowerCase())});setMailPrefs({...defaultMailPrefs,...r.preferences});void change('move',[detail.id],{folder:'junk'});}catch(e){setError(e instanceof Error?e.message:'Could not block sender')}}],
                                ].map(([label,act])=><button key={label as string} type='button' role='menuitem' onClick={()=>{setMore(false);void (act as ()=>void)()}} className='block w-full px-4 py-2 text-left text-[14px] ol-hover'>{label as string}</button>)}
                            </div>}
                        </div>
                    </div>
                    <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6'>
                        <h1 className='break-words text-[20px] font-semibold leading-snug'>{detail.subject||'(No subject)'}</h1>
                        {(detail.category||detail.priority==='high')&&<div className='mt-2 flex flex-wrap gap-1.5'>{detail.priority==='high'&&<span className='rounded px-2 py-0.5 text-[12px] font-semibold ol-danger' style={{background:'rgba(197,15,31,0.1)'}}>High importance</span>}{detail.category&&<span className='rounded px-2 py-0.5 text-[12px] ol-chip'>{detail.category}</span>}</div>}
                        <div className='mt-4 rounded-md border p-3 ol-line'>
                            <div className='flex items-start gap-3'>
                                <Persona name={detail.fromName} email={detail.fromEmail} size={40}/>
                                <div className='min-w-0 flex-1 text-[13px]'>
                                    <p className='truncate text-[14px] font-semibold'>{detail.fromName} <span className='font-normal ol-sub'>{'<'+detail.fromEmail+'>'}</span></p>
                                    <p className='mt-0.5 truncate ol-sub'>To: {addr(detail.to,people)||'—'}</p>
                                    {!!detail.cc.length&&<p className='truncate ol-sub'>Cc: {addr(detail.cc,people)}</p>}
                                    {!!detail.bcc.length&&<p className='truncate ol-sub'>Bcc: {addr(detail.bcc,people)}</p>}
                                </div>
                                <div className='hidden shrink-0 items-center gap-0.5 sm:flex'>
                                    <button type='button' aria-label='Reply' title='Reply' disabled={detail.folder==='drafts'||detail.allowReply===false} onClick={()=>composeMail('reply',detail)} className='flex h-9 w-9 items-center justify-center rounded ol-hover disabled:opacity-35'><Reply className='h-[18px] w-[18px]'/></button>
                                    <button type='button' aria-label='Reply all' title='Reply all' disabled={detail.folder==='drafts'||detail.allowReply===false||detail.allowReplyAll===false} onClick={()=>composeMail('replyall',detail)} className='flex h-9 w-9 items-center justify-center rounded ol-hover disabled:opacity-35'><ReplyAll className='h-[18px] w-[18px]'/></button>
                                    <button type='button' aria-label='Forward' title='Forward' disabled={detail.folder==='drafts'} onClick={()=>composeMail('forward',detail)} className='flex h-9 w-9 items-center justify-center rounded ol-hover disabled:opacity-35'><Forward className='h-[18px] w-[18px]'/></button>
                                </div>
                            </div>
                            <p className='mt-2 text-[12px] ol-sub'>{fullDate(detail.sentAt||detail.updatedAt)}</p>
                        </div>
                        {detail.folder==='junk'&&<p className='mt-3 rounded border-l-4 px-3 py-2 text-[13px]' style={{borderColor:'#ca5010',background:'rgba(202,80,16,0.1)'}}>This message is in Junk Email. <button type='button' className='font-semibold ol-link' onClick={()=>{void change('move',[detail.id],{folder:'inbox'})}}>It's not junk</button></p>}
                        {detail.folder==='drafts'?<button type='button' onClick={()=>composeMail('draft',detail)} className='mt-3 flex h-9 items-center gap-2 rounded px-4 text-[14px] font-semibold ol-primary'><Edit3 className='h-4 w-4'/> Continue editing</button>:null}
                        {!!detail.attachments.length&&<div className='mt-3 flex flex-wrap gap-2'>{detail.attachments.map(a=><a key={a.id} href={a.url||undefined} target='_blank' rel='noopener noreferrer' download={a.name} className='flex max-w-[260px] items-center gap-2 rounded border px-2 py-2 text-[13px] ol-line ol-hover'>
                            <FileText className='h-7 w-7 shrink-0 ol-link'/><span className='min-w-0 flex-1'><span className='block truncate ol-ink'>{a.name}</span><span className='block text-[11px] ol-sub'>{Math.ceil(a.size/1024)} KB</span></span>
                        </a>)}</div>}
                        <div role='document' aria-label='Email message body'
                            className='mt-4 min-h-[140px] w-full overflow-x-auto break-words text-[14px] leading-relaxed [&_a]:text-[color:var(--ol-link)] [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:[border-color:var(--ol-line)] [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_li]:ml-6 [&_ol]:list-decimal [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc'
                            dangerouslySetInnerHTML={{__html:safeReadHtml(detail.html||detail.excerpt||'')||'<p>'+safeSeed(detail.excerpt||'No message body was provided.')+'</p>'}} />
                        {!!thread.length&&<section className='mt-6'><h3 className='mb-2 text-[13px] font-semibold ol-sub'>Conversation · {thread.length+1} messages</h3>
                            {thread.map(t=><button type='button' key={t.id} onClick={()=>{void open(t.id)}} className='mb-1 flex min-h-12 w-full items-center gap-3 rounded border px-3 text-left text-[13px] ol-line ol-hover'>
                                <Persona name={t.fromName} email={t.fromEmail} size={28}/><span className='min-w-0 flex-1'><span className='block truncate font-semibold'>{t.fromName}</span><span className='block truncate ol-sub'>{t.excerpt}</span></span><span className='shrink-0 ol-sub'>{fmt(t.sentAt)}</span>
                            </button>)}
                        </section>}
                        <div className='mt-6 flex flex-wrap gap-2 pb-6'>
                            <button type='button' disabled={detail.folder==='drafts'||detail.allowReply===false} onClick={()=>composeMail('reply',detail)} className='flex h-9 items-center gap-2 rounded border px-4 text-[14px] ol-line ol-hover disabled:opacity-35'><Reply className='h-4 w-4'/>Reply</button>
                            <button type='button' disabled={detail.folder==='drafts'||detail.allowReply===false||detail.allowReplyAll===false} onClick={()=>composeMail('replyall',detail)} className='flex h-9 items-center gap-2 rounded border px-4 text-[14px] ol-line ol-hover disabled:opacity-35'><ReplyAll className='h-4 w-4'/>Reply all</button>
                            <button type='button' disabled={detail.folder==='drafts'} onClick={()=>composeMail('forward',detail)} className='flex h-9 items-center gap-2 rounded border px-4 text-[14px] ol-line ol-hover disabled:opacity-35'><Forward className='h-4 w-4'/>Forward</button>
                        </div>
                    </div>
                </div>:<div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center ol-bg'>
                    <MailOpen className='h-14 w-14 ol-sub'/><h2 className='text-[16px] font-semibold'>Select an item to read</h2>
                    <p className='max-w-xs text-[13px] ol-sub'>Nothing is selected.</p>
                </div>}
            </main>
            </div>
        </div>}
        {notice&&<div role='status' className='fixed bottom-20 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-md px-4 py-2.5 text-[14px] shadow-2xl lg:bottom-6' style={{background:'#323130',color:'#fff'}}>{notice}<button type='button' aria-label='Dismiss' onClick={()=>setNotice('')}><X className='h-4 w-4'/></button></div>}
        {/* Mobile: new mail button and bottom navigation */}
        {area==='mail'&&!selected&&<button type='button' aria-label='New mail' onClick={()=>composeMail('new')} className='fixed bottom-[calc(64px+env(safe-area-inset-bottom))] right-4 z-[61] flex h-14 items-center gap-2 rounded-2xl px-5 text-[15px] font-semibold shadow-xl ol-primary lg:hidden'><Edit3 className='h-5 w-5'/>New mail</button>}
        <nav aria-label='Mail, calendar and actions' className='flex shrink-0 border-t pb-[env(safe-area-inset-bottom)] ol-surface ol-line lg:hidden'>
            {([{key:'mail' as const,label:'Mail',Icon:Mail},{key:'calendar' as const,label:'Calendar',Icon:CalendarDays},{key:'actions' as const,label:'Actions',Icon:ListChecks}]).map(x=><button key={x.key} type='button' onClick={()=>setArea(x.key)} aria-current={area===x.key?'page':undefined} className={'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] '+(area===x.key?'font-semibold ol-link':'ol-sub')}><x.Icon className='h-5 w-5'/>{x.label}</button>)}
        </nav>
        {moveFor&&<div role='dialog' aria-modal='true' aria-label='Move to folder' className={'ol fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(0,0,0,0.4)] sm:items-center '+(dark?'ol-dark':'')} onClick={()=>setMoveFor(null)}>
            <div className='w-full max-w-sm rounded-t-xl pb-[env(safe-area-inset-bottom)] ol-surface sm:rounded-lg' onClick={e=>e.stopPropagation()}>
                <p className='px-5 pb-2 pt-4 text-[16px] font-semibold'>Move {moveFor.length>1?moveFor.length+' items':'item'} to</p>
                {foldersDisplay.filter(f=>!['drafts','sent'].includes(f.id)&&!(bulkItems.length===1&&bulkItems[0]?.folder===f.id)).map(f=><button key={f.id} type='button' onClick={()=>{const ids=moveFor;setMoveFor(null);void change('move',ids,{folder:f.id})}} className='flex min-h-12 w-full items-center gap-3 px-5 text-left text-[14px] ol-hover'><f.Icon className='h-[18px] w-[18px]'/>{f.label}</button>)}
                <button type='button' onClick={()=>{setMoveFor(null);void newFolder()}} className='flex min-h-12 w-full items-center gap-3 border-t px-5 text-left text-[14px] ol-link ol-line ol-hover'><FolderPlus className='h-[18px] w-[18px]'/>New folder</button>
            </div>
        </div>}
        {compose&&<Compose key={compose.mode+'-'+(compose.original?.id||'new')+'-'+(compose.group?.id||'')} people={people} groups={groups} me={myEmail} seed={compose} prefs={mailPrefs} dark={dark}
            onDone={(result)=>{setCompose(null);setNotice(result?.actionWarning?'Sent, but the action needs attention: '+result.actionWarning:'Sent'+(result?.actionId?' with a monitored action':''));void refresh(true);}}
            onCancel={()=>{setCompose(null);void refresh(true);}}
            onManageGroups={()=>setShowGroupManager(true)}/>}
        {showGroupManager&&<div className='bg-page text-ink'><MailWorkGroups people={people} groups={groups} myUid={myUid}
            onApply={(group)=>{setShowGroupManager(false);if(compose){setCompose({...compose,group});}else{setCompose({mode:'new',group});setArea('mail');}}}
            onReload={reloadGroups} onClose={()=>setShowGroupManager(false)}/></div>}
        {showMailSettings&&<MailSettings value={mailPrefs} people={people} folders={folders} dark={dark} onSaved={p=>setMailPrefs({...defaultMailPrefs,...p})} onClose={()=>setShowMailSettings(false)}/>}
    </div>;
}
