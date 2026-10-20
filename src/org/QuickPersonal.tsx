import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Archive, ArchiveRestore, Brush, FileImage, FileText, ImagePlus, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Button, Spinner } from '../admin/kit';
import MailRichEditor, { type RichEditorApi } from './MailRichEditor';
import NoteSketchPad from './NoteSketchPad';
import { compressPhoto } from './mntShared';
import { useQuickLeave } from './quickNavigation';
import { appConfirm } from '../components/dialogs';

type Attachment={id:string;path:string;name:string;mime:string;size:number;url:string;inline?:boolean};
type Note={id:string;topic:string;body:string;format?:string;attachments?:Attachment[];archivedAt?:string;updatedAt:string};
type Draft={id:string;topic:string;html:string;attachments:Attachment[];dirty:boolean};
const empty:Draft={id:'',topic:'',html:'',attachments:[],dirty:false};
const field='min-h-12 w-full rounded-xl border border-line bg-page px-3 text-sm text-ink';
const errorText=(e:unknown)=>e instanceof Error?e.message:'Could not complete the operation.';
const safeText=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
/** Inline photos and drawings are stored as references to the note's own files; show them with their signed links. */
function resolveInline(html:string,files:Attachment[]):string{
    if(!html.includes('data-note-file'))return html;
    const box=document.createElement('div');
    box.innerHTML=html;
    const urls=new Map(files.map(f=>[f.id,f.url]));
    for(const img of Array.from(box.querySelectorAll('img[data-note-file]'))){
        const url=urls.get(img.getAttribute('data-note-file')||'');
        if(url)img.setAttribute('src',url);else img.remove();
    }
    return box.innerHTML;
}
const inlineIds=(html:string)=>new Set([...html.matchAll(/data-note-file="([^"]+)"/g)].map(m=>m[1]));
const noteHtml=(n:Note)=>n.format==='html'?resolveInline(n.body,n.attachments||[]):'<p>'+safeText(n.body).replaceAll('\n','<br>')+'</p>';
const textOnly=(html:string)=>html.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const storageKey=(uid:string)=>'mems.quick.notepad.draft.v2.'+uid;
function initial(uid:string):Draft{
    try {
        const v=JSON.parse(localStorage.getItem(storageKey(uid))||'null') as Partial<Draft>|null;
        return v&&typeof v.html==='string'?{...empty,...v,attachments:Array.isArray(v.attachments)?v.attachments:[]}:empty;
    }catch{return empty}
}
const fileData=(file:File):Promise<string>=>new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
    reader.onerror=()=>reject(new Error('Could not read the chosen file.'));
    reader.readAsDataURL(file);
});
export function QuickNotepad({uid}:{uid:string}){
    const [items,setItems]=useState<Note[]>([]);
    const [tab,setTab]=useState<'active'|'archive'>('active');
    const [search,setSearch]=useState('');
    const [draft,setDraft]=useState<Draft>(()=>initial(uid));
    const [editing,setEditing]=useState(()=>initial(uid).dirty);
    const [loading,setLoading]=useState(true);
    const [busy,setBusy]=useState(false);
    const [uploading,setUploading]=useState(false);
    const [error,setError]=useState('');
    const [info,setInfo]=useState('');
    const [sketch,setSketch]=useState(false);
    const [activeImg,setActiveImg]=useState<HTMLElement|null>(null);
    const api=useRef<RichEditorApi|null>(null);
    const photoInput=useRef<HTMLInputElement>(null);
    const reload=useCallback(async()=>{
        try {
            const r=await callBackend<{items:Note[]}>('/api/org/quick/note/list');
            setItems(r.items);
        }catch(e){setError(errorText(e))}
        finally{setLoading(false)}
    },[]);
    useEffect(()=>{void reload()},[reload]);
    useEffect(()=>{
        try{localStorage.setItem(storageKey(uid),JSON.stringify(editing?draft:empty))}
        catch{/* Local draft recovery is best effort. */}
    },[draft,editing,uid]);
    const close=()=>{setEditing(false);setDraft({...empty});setError('')};
    const start=()=>{setDraft({...empty});setEditing(true);setError('');setInfo('')};
    const edit=(n:Note)=>{setDraft({id:n.id,topic:n.topic,html:noteHtml(n),
        attachments:n.attachments||[],dirty:false});setEditing(true);setError('');setInfo('')};
    const save=async(silent=false):Promise<boolean>=>{
        if(!editing||(!draft.dirty&&silent))return true;
        if(!draft.topic.trim()){
            if(!silent)setError('Enter a topic for this note.');
            return silent;
        }
        setBusy(true);setError('');
        try {
            // Inline photos removed from the text are dropped with the note; other files stay attached.
            const used=inlineIds(draft.html);
            await callBackend('/api/org/quick/note/save',{
                id:draft.id||undefined,topic:draft.topic,body:draft.html,format:'html',
                attachments:draft.attachments.filter(a=>!a.inline||used.has(a.id)).map(({id,path,name,mime,size})=>({id,path,name,mime,size})),
            });
            close();await reload();
            if(!silent)setInfo('Your note and attachments were saved.');
            return true;
        }catch(e){setError(errorText(e)+' Your note remains available in the editor.');return false}
        finally{setBusy(false)}
    };
    useQuickLeave(()=>save(true));
    const archive=async(n:Note,archiveNote:boolean)=>{
        setBusy(true);setError('');
        try {
            await callBackend('/api/org/quick/note/archive',{id:n.id,archive:archiveNote});
            await reload();setInfo(archiveNote?'Note archived. You can restore it from Archived.':'Note restored.');
        }catch(e){setError(errorText(e))}finally{setBusy(false)}
    };
    const remove=async(n:Note)=>{
        if(!(await appConfirm('Permanently delete this note? This cannot be undone.')))return;
        setBusy(true);
        try{
            await callBackend('/api/org/quick/note/delete',{id:n.id});
            await reload();setInfo('Note deleted.');
        }catch(e){setError(errorText(e))}finally{setBusy(false)}
    };
    const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
        const chosen=[...(event.target.files||[])];event.target.value='';
        if(!chosen.length)return;
        if(draft.attachments.length+chosen.length>12)return setError('A note may contain up to 12 attachments.');
        setUploading(true);setError('');
        try{
            for(const file of chosen){
                if(file.size>8_000_000)throw new Error('Keep each attachment below 8 MB.');
                const data=await fileData(file);
                const r=await callBackend<{item:Attachment}>('/api/org/quick/note/upload',{data,name:file.name,mime:file.type||'application/octet-stream'});
                setDraft(prev=>({...prev,attachments:[...prev.attachments,r.item],dirty:true}));
            }
        }catch(e){setError(errorText(e))}
        finally{setUploading(false)}
    };
    /** Upload a photo or drawing and place it in the note text where the cursor was. */
    const embed=async(data:string,name:string,mime:string)=>{
        if(draft.attachments.length>=12){setError('A note may contain up to 12 photos and files.');return;}
        setUploading(true);setError('');
        try{
            const r=await callBackend<{item:Attachment}>('/api/org/quick/note/upload',{data,name,mime});
            const item={...r.item,inline:true};
            setDraft(prev=>({...prev,attachments:[...prev.attachments,item],dirty:true}));
            const img=document.createElement('img');
            img.setAttribute('src',item.url);img.setAttribute('data-note-file',item.id);img.setAttribute('data-width','100');img.setAttribute('alt','');
            api.current?.insertHtml(img.outerHTML+'<p><br></p>');
        }catch(e){setError(errorText(e))}
        finally{setUploading(false)}
    };
    const insertPhoto=async(event:ChangeEvent<HTMLInputElement>)=>{
        const file=event.target.files?.[0];event.target.value='';
        if(!file)return;
        if(!/^image\/(jpeg|png|webp)$/.test(file.type))return setError('Insert a JPG, PNG or WebP photo.');
        const big=file.size>4_500_000;
        const data=big?await compressPhoto(file):await fileData(file);
        await embed(data,big?file.name.replace(/\.[^.]+$/,'')+'.jpg':file.name,big?'image/jpeg':file.type);
    };
    const insertDrawing=async(png:Blob)=>{
        const data=await fileData(new File([png],'drawing.png',{type:'image/png'}));
        await embed(data,'Drawing '+new Date().toLocaleString().replace(/[/:]/g,'-')+'.png','image/png');
        setSketch(false);
    };
    const imageSize=(width:string)=>{
        if(!activeImg)return;
        if(width==='remove')activeImg.remove();else activeImg.setAttribute('data-width',width);
        activeImg.classList.remove('note-img-active');
        setActiveImg(null);
        api.current?.sync();
    };
    const used=inlineIds(draft.html);
    const visible=items.filter(n=>Boolean(n.archivedAt)===(tab==='archive')
        &&(n.topic+' '+textOnly(n.body)).toLowerCase().includes(search.toLowerCase()));
    return <section className='space-y-4 pb-5' aria-label='Private Notepad'>
        <div className='flex items-center justify-between gap-3'>
            <div><h2 className='text-lg font-bold text-ink'>Notepad</h2><p className='text-xs text-muted'>Private, formatted notes and reference documents</p></div>
            <button type='button' onClick={start} aria-label='Add new note' className='flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-onbrand'><Plus className='h-6 w-6'/></button>
        </div>
        <div className='grid grid-cols-2 gap-2 rounded-xl border border-line bg-panel p-1' role='tablist' aria-label='Notepad folders'>
            {(['active','archive'] as const).map(value=><button key={value} type='button' role='tab' aria-selected={tab===value} onClick={()=>setTab(value)}
                className={'min-h-12 rounded-lg text-sm font-semibold '+(tab===value?'bg-brand text-onbrand':'text-muted')}>
                {value==='active'?'Active notes':'Archived'} ({items.filter(n=>Boolean(n.archivedAt)===(value==='archive')).length})
            </button>)}
        </div>
        <div className='relative'>
            <Search className='absolute left-3 top-3.5 h-4 w-4 text-muted'/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search note topics and contents' className={field+' pl-10'} aria-label='Search notes'/>
        </div>
        {error&&!editing&&<Alert tone='error'>{error}</Alert>}
        {info&&<Alert tone='success'>{info}</Alert>}
        {loading?<Spinner/>:!visible.length?<p className='rounded-xl border border-line bg-panel p-5 text-sm text-muted'>No {tab==='archive'?'archived':'active'} notes.</p>:
            <div className='space-y-2'>{visible.map(n=><article key={n.id} className='flex items-center gap-2 rounded-xl border border-line bg-panel p-3'>
                <button type='button' onClick={()=>edit(n)} className='min-w-0 flex-1 text-left'>
                    <span className='block truncate text-sm font-semibold text-ink'>{n.topic}</span>
                    <span className='mt-1 block truncate text-xs text-muted'>{textOnly(n.body)||'Blank note'}</span>
                    <span className='mt-1 flex items-center gap-1 text-[11px] text-muted'>
                        {inlineIds(n.body).size?<><ImagePlus className='h-3.5 w-3.5'/>{inlineIds(n.body).size} in text · </>:null}
                        {n.attachments?.length?<><FileText className='h-3.5 w-3.5'/>{n.attachments.length} files · </>:null}
                        {new Date(n.updatedAt).toLocaleDateString()}
                    </span>
                </button>
                <button type='button' aria-label={(n.archivedAt?'Restore':'Archive')+' '+n.topic}
                    onClick={()=>{void archive(n,!n.archivedAt)}} disabled={busy}
                    className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-brand'>
                    {n.archivedAt?<ArchiveRestore className='h-4 w-4'/>:<Archive className='h-4 w-4'/>}
                </button>
                <button type='button' aria-label={'Delete '+n.topic} onClick={()=>{void remove(n)}} disabled={busy}
                    className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-red-500'>
                    <Trash2 className='h-4 w-4'/>
                </button>
            </article>)}</div>}
        {editing&&<div className='fixed inset-0 z-[94] flex h-[100dvh] w-full flex-col overflow-hidden bg-page text-ink' role='dialog' aria-modal='true' aria-label='Full-screen rich text note editor'>
            <header className='flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 pt-[env(safe-area-inset-top)]'>
                <div className='min-w-0 flex-1'><h3 className='truncate text-base font-bold'>{draft.id?'Edit note':'New note'}</h3>
                    <p className='text-xs text-muted'>Rich text · photos · attachments</p></div>
                <button type='button' aria-label='Close note editor' onClick={async ()=>{
                    if(draft.dirty&&!(await appConfirm('Close without saving? Your unfinished draft will be cleared.')))return;
                    close();
                }} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-brand'><X className='h-5 w-5'/></button>
            </header>
            <div className='min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:mx-auto sm:w-full sm:max-w-4xl'>
                {error&&<Alert tone='error'>{error}</Alert>}
                <label className='block text-sm font-semibold text-muted'>Note topic
                    <input value={draft.topic} maxLength={140} onChange={e=>setDraft(d=>({...d,topic:e.target.value,dirty:true}))}
                        placeholder='Topic, meeting or working notes' className={field+' mt-2'}/>
                </label>
                <div className='space-y-2'>
                    <p className='text-sm font-semibold text-muted'>Note content</p>
                    {activeImg&&<div className='sticky top-0 z-10 flex flex-wrap items-center gap-1 rounded-xl border border-brand/40 bg-panel p-1.5 shadow' role='toolbar' aria-label='Inline photo'>
                        <span className='px-2 text-xs font-semibold text-muted'>Photo size</span>
                        {[['25','S'],['50','M'],['75','L'],['100','Full']].map(([w,label])=><button key={w} type='button' onClick={()=>imageSize(w)}
                            className={'min-h-10 min-w-10 rounded-lg px-2 text-xs font-semibold '+(activeImg.getAttribute('data-width')===w?'bg-brand text-onbrand':'text-ink')}>{label}</button>)}
                        <span className='flex-1'/>
                        <button type='button' onClick={()=>imageSize('remove')} className='flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-500'><Trash2 className='h-4 w-4'/>Remove</button>
                        <button type='button' aria-label='Close photo tools' onClick={()=>{activeImg.classList.remove('note-img-active');setActiveImg(null);}} className='flex h-10 w-10 items-center justify-center'><X className='h-4 w-4'/></button>
                    </div>}
                    <MailRichEditor key={draft.id||'new'} html={draft.html} placeholder='Write and format your notes…'
                        ariaLabel='Rich text note' apiRef={api} onChange={html=>setDraft(d=>({...d,html,dirty:true}))}
                        onEditorClick={el=>{
                            activeImg?.classList.remove('note-img-active');
                            if(el.tagName==='IMG'&&el.hasAttribute('data-note-file')){el.classList.add('note-img-active');setActiveImg(el);}
                            else setActiveImg(null);
                        }}
                        extraTools={<>
                            <button type='button' title='Insert photo' aria-label='Insert photo in the note' disabled={uploading}
                                onMouseDown={e=>{e.preventDefault();api.current?.saveSelection();}} onClick={()=>photoInput.current?.click()}
                                className='flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-brand/10'>
                                <ImagePlus className='h-[18px] w-[18px]'/><span className='hidden sm:inline'>Photo</span></button>
                            <button type='button' title='Draw' aria-label='Draw on a canvas and insert it' disabled={uploading}
                                onMouseDown={e=>{e.preventDefault();api.current?.saveSelection();}} onClick={()=>setSketch(true)}
                                className='flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand hover:bg-brand/10'>
                                <Brush className='h-[18px] w-[18px]'/><span className='hidden sm:inline'>Draw</span></button>
                            <span className='mx-0.5 h-6 w-px shrink-0 bg-line'/>
                        </>}/>
                    <input ref={photoInput} type='file' accept='image/jpeg,image/png,image/webp' className='hidden' onChange={e=>{void insertPhoto(e)}}/>
                    <p className='text-[11px] text-muted'>Tap <b>Photo</b> or <b>Draw</b> to place a picture inside the text. Tap a picture to resize or remove it.</p>
                </div>
                <section className='space-y-3 rounded-xl border border-line bg-panel p-3'>
                    <h4 className='flex items-center gap-2 text-sm font-semibold text-ink'><FileImage className='h-5 w-5 text-brand'/>Photos and documents</h4>
                    <label className='flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-brand/40 bg-brand/5 p-3 text-xs font-semibold text-brand'>
                        <Plus className='h-5 w-5'/>{uploading?'Uploading files…':'Attach photos, PDFs, Word, Excel, PowerPoint or text files'}
                        <input type='file' multiple disabled={uploading||busy} accept='image/jpeg,image/png,image/webp,.pdf,.docx,.xlsx,.pptx,.txt,.csv'
                            className='sr-only' onChange={e=>{void upload(e)}}/>
                    </label>
                    {draft.attachments.filter(file=>!file.inline&&!used.has(file.id)).map(file=><div key={file.path} className='flex items-center gap-3 rounded-lg border border-line bg-page p-2'>
                        {file.mime.startsWith('image/')&&file.url?<img src={file.url} alt={file.name} className='h-14 w-14 rounded-lg object-cover'/>:<FileText className='h-6 w-6 shrink-0 text-brand'/>}
                        <a className='min-w-0 flex-1 truncate text-xs font-semibold text-brand underline' href={file.url} target='_blank' rel='noopener noreferrer'>{file.name}</a>
                        <button type='button' aria-label={'Remove '+file.name} onClick={()=>setDraft(d=>({...d,attachments:d.attachments.filter(a=>a.path!==file.path),dirty:true}))}
                            className='flex h-11 w-11 items-center justify-center text-red-500'><Trash2 className='h-4 w-4'/></button>
                    </div>)}
                    <p className='text-[11px] text-muted'>Up to 12 files. Images up to 5 MB, documents up to 8 MB each. Only your account can read your note files.</p>
                </section>
            </div>
            <footer className='shrink-0 border-t border-line bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
                <div className='mx-auto max-w-4xl'><Button className='min-h-14 w-full' disabled={busy||uploading} busy={busy} onClick={()=>{void save()}}>
                    <Save className='h-5 w-5'/> Save note
                </Button></div>
            </footer>
            {sketch&&<NoteSketchPad busy={uploading} onCancel={()=>setSketch(false)} onSave={png=>{void insertDrawing(png)}}/>}
        </div>}
    </section>;
}
