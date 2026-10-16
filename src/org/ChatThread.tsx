import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Clock3, CornerUpLeft, Download, FileText, Image, Link2, Loader2, Paperclip, Send, Smile, Trash2, X, Plus, ClipboardList, BarChart3 } from 'lucide-react';
import type { ChatAttachment, ChatMessage, ChatPerson, ChatRoom } from './chatTypes';
import { EMOJI_PICKER, MEMBER_PALETTE, REACTIONS } from './chatTypes';
import { useQuickLeave } from './quickNavigation';

const timeText = (value: string) => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const clock=d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString()===new Date().toDateString()?clock:d.toLocaleDateString([],{month:'short',day:'numeric'})+' · '+clock;
};
const dateLabel = (value: string) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';
};
function TextLinks({ body }: { body: string }) {
    const parts = body.split(/(https?:\/\/[^\s<>]+|#organization_(?:home|admin)\/[A-Za-z0-9_/-]+)/g);
    return <span className='whitespace-pre-wrap break-words'>{parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) return <a key={i} href={part} target='_blank' rel='noopener noreferrer'
            className='break-all font-semibold underline underline-offset-2'>{part}</a>;
        if (/^#organization_(?:home|admin)\//.test(part)) return <a key={i} href={part}
            className='break-all font-semibold underline underline-offset-2'>{part}</a>;
        return <span key={i}>{part}</span>;
    })}</span>;
}
function Avatar({ person, color, size = 34 }: { person?: ChatPerson; color?: string; size?: number }) {
    const name = person?.name || 'Member';
    return <span className='flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-page text-xs font-bold'
        style={{ width: size, height: size, color: color || 'rgb(var(--c-brand))' }} aria-label={name}>
        {person?.photoUrl ? <img src={person.photoUrl} alt={name} className='h-full w-full object-cover' loading='lazy' /> :
            <span>{name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?'}</span>}
    </span>;
}
export { Avatar as ChatAvatar };

interface Props {
    uid: string;
    room: ChatRoom;
    theme?: string;
    people: ChatPerson[];
    messages: ChatMessage[];
    hasMore: boolean;
    busy: boolean;
    typing: string[];
    presence: string[];
    readMarks: Array<{ uid: string; readAt: string }>;
    loadingOlder: boolean;
    onOlder: () => void;
    onSend: (body: string, attachment: ChatAttachment | null, replyId: string) => Promise<boolean>;
    onUpload: (file: File) => Promise<ChatAttachment | null>;
    onDelete: (id: string) => Promise<void>;
    onReact: (id: string, emoji: string) => Promise<void>;
    onTyping: (active: boolean) => void;
    inlineTool?: 'action' | 'poll' | '';
    inlinePanel?: ReactNode;
    onOpenTool?: (tool: 'action' | 'poll', create?: boolean) => void;
    onCloseTool?: () => void;
}
export default function ChatThread({
    uid, room, theme = 'default', people, messages, hasMore, busy, typing, presence, readMarks, loadingOlder,
    onOlder, onSend, onUpload, onDelete, onReact, onTyping,
    inlineTool='', inlinePanel, onOpenTool, onCloseTool,
}: Props) {
    const draftKey = 'mems.chat.composer.' + uid + '.' + room.id;
    const [body, setBody] = useState(() => {
        try { return localStorage.getItem(draftKey) || ''; } catch { return ''; }
    });
    const [reply, setReply] = useState<ChatMessage | null>(null);
    const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [showCreateMenu,setShowCreateMenu] = useState(false);
    const [reactionFor, setReactionFor] = useState('');
    const [contextMessage,setContextMessage] = useState('');
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [uploading, setUploading] = useState(false);
    const [preview, setPreview] = useState<ChatAttachment | null>(null);
    const [error, setError] = useState('');
    const [clock, setClock] = useState(Date.now());
    const lastTypingAt = useRef(0);
    const bottom = useRef<HTMLDivElement>(null);
    const scrollArea = useRef<HTMLDivElement>(null);
    const wasInitial = useRef(false);
    const lastMessageId = messages[messages.length - 1]?.id;

    useEffect(() => {
        try { localStorage.setItem(draftKey, body); } catch { /* Draft still stays in memory. */ }
    }, [draftKey, body]);
    useQuickLeave(async () => {
        try { localStorage.setItem(draftKey, body); } catch { /* User can still leave. */ }
        onTyping(false);
        return !uploading && !busy;
    });
    useEffect(() => {
        const timer = setInterval(() => setClock(Date.now()), 5000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        if (messages.length && !wasInitial.current) {
            wasInitial.current = true;
            bottom.current?.scrollIntoView({ block: 'end' });
        }
    }, [messages.length]);
    useEffect(() => {
        if (!lastMessageId) return;
        const node = scrollArea.current;
        if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 250) {
            bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [lastMessageId]);

    const personMap = new Map(people.map((p) => [p.uid, p]));
    const shades = new Map(room.members.map((member, i) => [member, MEMBER_PALETTE[i % MEMBER_PALETTE.length]]));
    const typeNames = typing.filter((person) => person !== uid)
        .map((person) => personMap.get(person)?.name || 'Someone');
    const activeNames = presence.filter((person) => person !== uid)
        .map((person) => personMap.get(person)?.name || 'Someone');
    const stopLongPress = () => {if(pressTimer.current){clearTimeout(pressTimer.current);pressTimer.current=null;}};
    const beginLongPress = (id:string) => {stopLongPress();pressTimer.current=setTimeout(()=>{setContextMessage(id);pressTimer.current=null;},510);};
    useEffect(() => () => {if(pressTimer.current)clearTimeout(pressTimer.current)},[]);
    const appendEmoji = (emoji: string) => { setBody((previous) => previous + emoji); setEmojiOpen(false); onTyping(true); };
    const onInput = (value: string) => {
        setBody(value);
        const now = Date.now();
        if (value.trim() && now - lastTypingAt.current > 1700) {
            lastTypingAt.current = now;
            onTyping(true);
        }
        if (!value.trim()) onTyping(false);
    };
    const send = async () => {
        if (!body.trim() && !attachment) return;
        setError('');
        const ok = await onSend(body, attachment, reply?.id || '');
        if (ok) {
            setBody(''); setAttachment(null); setReply(null);
            setEmojiOpen(false); onTyping(false);
            try { localStorage.removeItem(draftKey); } catch { /* In-memory clear completed. */ }
            bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    };
    const attachFile = async (ev: ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file) return;
        setError(''); setUploading(true);
        try {
            const result = await onUpload(file);
            if (result) setAttachment(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not attach that file.');
        } finally { setUploading(false); }
    };

    const palettes: Record<string,{mine:string;other:string;back:string}> = {
        default:{mine:'',other:'',back:''},
        ocean:{mine:'rgba(37,99,235,0.17)',other:'rgba(14,165,233,0.09)',back:'rgba(59,130,246,0.035)'},
        forest:{mine:'rgba(22,163,74,0.18)',other:'rgba(34,197,94,0.07)',back:'rgba(34,197,94,0.032)'},
        rose:{mine:'rgba(244,63,94,0.16)',other:'rgba(251,113,133,0.07)',back:'rgba(244,63,94,0.034)'},
        amber:{mine:'rgba(245,158,11,0.18)',other:'rgba(251,191,36,0.08)',back:'rgba(245,158,11,0.033)'},
        slate:{mine:'rgba(100,116,139,0.23)',other:'rgba(148,163,184,0.08)',back:'rgba(148,163,184,0.04)'},
        violet:{mine:'rgba(139,92,246,0.18)',other:'rgba(167,139,250,0.08)',back:'rgba(139,92,246,0.034)'}
    };
    const palette=palettes[theme]||palettes.default;
    return <div className='flex min-h-0 flex-1 flex-col overflow-hidden' style={palette.back?{backgroundColor:palette.back}:undefined}>
        {(typeNames.length > 0 || activeNames.length > 0) && (
            <div className='flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-3 py-1 text-[11px] text-muted'>
                <span className='min-w-0 truncate'>
                    {typeNames.length > 0 ? <span className='font-semibold text-brand'>{typeNames.slice(0, 2).join(', ')} typing
                        <span className='animate-pulse'>…</span></span>
                        : activeNames.length > 0 ? <span>● {activeNames.slice(0, 2).join(', ')} active now</span> : null}
                </span>
            </div>
        )}
        <div ref={scrollArea} className='min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6'
            role='log' aria-label='Conversation history' aria-live='polite'>
            {hasMore && <button type='button' disabled={loadingOlder} onClick={onOlder}
                className='mx-auto flex min-h-10 items-center gap-2 rounded-full border border-line bg-panel px-4 text-xs font-semibold text-brand'>
                <ArrowUp className='h-4 w-4' /> {loadingOlder ? 'Loading history…' : 'Earlier messages'}
            </button>}
            {!messages.length && <div className='py-12 text-center text-sm text-muted'>
                No messages yet. Start a conversation below.
            </div>}
            {messages.map((message, index) => {
                const mine = message.senderUid === uid;
                const sender = personMap.get(message.senderUid);
                const color = shades.get(message.senderUid) || '#64748b';
                const when = new Date(message.createdAt);
                const previousDate = messages[index - 1]?.createdAt;
                const newDay = !previousDate || new Date(previousDate).toDateString() !== when.toDateString();
                const eligibleDelete = mine && !message.deletedForAll
                    && clock - when.getTime() >= 0 && clock - when.getTime() < 180000;
                const seen = mine && readMarks.some((item) => item.uid !== uid
                    && Date.parse(item.readAt) >= when.getTime());
                if (message.eventKind && message.referenceId) {
                    const isAction=message.eventKind==='action';
                    return <div key={message.id} className='space-y-1'>
                        {newDay&&<p className='my-3 text-center text-[11px] font-semibold text-muted'>{dateLabel(message.createdAt)}</p>}
                        <div className='mx-auto w-fit max-w-[90%] rounded-xl border border-brand/35 bg-brand/5 px-3 py-2'>
                          <p className='text-[10px] font-semibold text-muted'>{personMap.get(message.senderUid)?.name||'Colleague'} shared in this conversation</p>
                          <button type='button' onClick={()=>onOpenTool?.(isAction?'action':'poll',false)}
                            className='mt-1 flex min-h-11 items-center gap-2 text-left text-xs font-semibold text-brand'>
                            {isAction?<ClipboardList className='h-5 w-5 shrink-0'/>:<BarChart3 className='h-5 w-5 shrink-0'/>}
                            <span>{isAction?'Monitored Action · view assignments and progress':'Group Poll · vote or view results'}</span>
                          </button>
                          <p className='text-right text-[10px] text-muted'>{timeText(message.createdAt)}</p>
                        </div>
                    </div>;
                }
                return <div key={message.id}>
                    {newDay && <p className='my-3 text-center text-[11px] font-semibold text-muted'>{dateLabel(message.createdAt)}</p>}
                    <div className={'flex items-end gap-2 ' + (mine ? 'justify-end pl-10' : 'justify-start pr-10')}>
                        {!mine && <Avatar person={sender} color={color} size={28} />}
                        <div className={'flex w-fit min-w-0 max-w-[86%] flex-col ' + (mine ? 'items-end' : 'items-start')}>                           <div role='button' tabIndex={0} aria-label={'Long press for message actions from ' + (sender?.name || 'You')} className={'w-fit max-w-full touch-pan-y select-text rounded-xl border px-2.5 py-1.5 shadow-sm sm:max-w-[100%] ' +
                                    (mine ? 'rounded-br-sm border-brand/40 bg-brand/15' : 'rounded-bl-sm border-line bg-panel')}
                                style={{...(!mine&&room.kind==='group'?{borderLeftColor:color,borderLeftWidth:2}:{}),...(mine&&palette.mine?{backgroundColor:palette.mine}:{}),...(!mine&&palette.other?{backgroundColor:palette.other}:{})}}
                                onPointerDown={(ev) => {if(ev.pointerType!=='mouse'||ev.button===0)beginLongPress(message.id)}}
                                onPointerUp={stopLongPress} onPointerLeave={stopLongPress} onPointerCancel={stopLongPress}
                                onContextMenu={ev=>{ev.preventDefault();stopLongPress();setContextMessage(message.id);}}
                                onKeyDown={ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();setContextMessage(message.id);}}}>
                            {room.kind === 'group' && !mine && <p className='mb-1 text-[11px] font-bold'
                                style={{ color }}>{sender?.name || 'Colleague'}</p>}
                            {message.deletedForAll ? <p className='text-sm italic text-muted'>This message was deleted</p> : <>
                                {message.replyTo && <div className='mb-2 flex max-w-full items-center gap-2 rounded-lg border-l-2 border-brand bg-page/70 px-2 py-1'>
                                    {message.replyTo.imageUrl&&<img src={message.replyTo.imageUrl} alt='Replied photo'
                                        className='h-10 w-10 shrink-0 rounded-md object-cover'/>}
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate text-[10px] font-semibold text-brand'>{personMap.get(message.replyTo.senderUid)?.name || 'Colleague'}</span>
                                        <span className='block truncate text-xs text-muted'>
                                            {message.replyTo.imageUrl?'Photo':message.replyTo.text || message.replyTo.attachment || 'Attachment'}
                                        </span>
                                    </span>
                                </div>}
                                {message.text && <p className='text-sm leading-relaxed text-ink'><TextLinks body={message.text} /></p>}
                                {message.attachment && <div className='mt-2'>
                                    {message.attachment.kind === 'image' ? (
                                        <button type='button' onClick={() => setPreview(message.attachment)}
                                            className='block max-w-full overflow-hidden rounded-xl border border-line'>
                                            <img src={message.attachment.url} alt={message.attachment.name} loading='lazy'
                                                className='max-h-64 w-auto max-w-full object-contain' />
                                        </button>
                                    ) : (
                                        <a href={message.attachment.url} target='_blank' rel='noopener noreferrer'
                                            className='flex max-w-64 items-center gap-2 rounded-lg border border-line bg-page/60 p-2 text-xs text-brand'>
                                            <FileText className='h-6 w-6 shrink-0' />
                                            <span className='min-w-0 flex-1'>
                                                <span className='block truncate font-semibold'>{message.attachment.name}</span>
                                                <span className='block text-[10px] text-muted'>Open report / file</span>
                                            </span>
                                            <Download className='h-4 w-4 shrink-0' />
                                        </a>
                                    )}

                                </div>}
                            </>}
                        </div>
                            <div className='mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted'>
                                <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                                    {timeText(message.createdAt)}
                                </time>
                                {mine && (seen ? <CheckCheck className='h-3.5 w-3.5 text-brand' aria-label='Seen' />
                                    : <CheckCheck className='h-3.5 w-3.5' aria-label='Sent' />)}
                            </div>
                            {Object.entries(message.reactions || {}).some(([,uids]) => Array.isArray(uids) && uids.length>0) && (
                                <div className='mt-0.5 flex flex-wrap gap-1' aria-label='Attached message reactions'>
                                    {Object.entries(message.reactions).filter(([,uids])=>Array.isArray(uids) && uids.length>0)
                                        .map(([emoji,uids]) => <button type='button' key={emoji} onClick={() => void onReact(message.id, emoji)}
                                            className={'rounded-full border px-2 py-0.5 text-xs ' + (uids.includes(uid) ? 'border-brand bg-brand/15' : 'border-line bg-page')}>
                                            {emoji} {uids.length}
                                        </button>)}
                                </div>
                            )}
                            {contextMessage === message.id && !message.deletedForAll && (
                                <div role='menu' aria-label='Message actions'
                                    className='mt-1 flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-lg'>
                                    <button type='button' role='menuitem' onClick={() => { setReply(message); setContextMessage(''); }}
                                        className='flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-ink'>
                                        <CornerUpLeft className='h-4 w-4'/>Reply</button>
                                    <button type='button' role='menuitem' onClick={() => setReactionFor(v => v===message.id?'':message.id)}
                                        className='flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-ink'>
                                        <Smile className='h-4 w-4'/>React</button>
                                    {eligibleDelete && <button type='button' role='menuitem' onClick={() => {
                                        if(window.confirm('Delete this message for everyone?'))void onDelete(message.id);
                                        setContextMessage('');
                                    }} className='flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-red-500'>
                                        <Trash2 className='h-4 w-4'/>Delete</button>}
                                    <button type='button' aria-label='Dismiss message actions' onClick={() => {setContextMessage('');setReactionFor('');}}
                                        className='flex h-10 w-9 items-center justify-center rounded-lg text-muted'><X className='h-4 w-4'/></button>
                                    {reactionFor===message.id&&<div className='flex w-full flex-wrap gap-1 border-t border-line pt-1'>
                                        {REACTIONS.map(emoji=><button key={emoji} type='button' onClick={() => {
                                            void onReact(message.id,emoji);setReactionFor('');setContextMessage('');
                                        }} className='flex h-9 w-9 items-center justify-center rounded-lg bg-page text-lg'>{emoji}</button>)}
                                    </div>}
                                </div>
                            )}
                        </div>
                        {mine && <Avatar person={personMap.get(uid)} size={26} />}
                    </div>
                </div>;
            })}
            <div ref={bottom} />
        </div>
        {error && <div className='shrink-0 bg-red-500/10 px-3 py-2 text-xs text-red-500'>{error}</div>}
        {reply && <div className='flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-2 text-xs'>
            <CornerUpLeft className='h-4 w-4 text-brand' />
            <span className='min-w-0 flex-1 truncate text-muted'>
                Replying to {personMap.get(reply.senderUid)?.name || 'Colleague'}:
                {' '}{reply.attachment?.kind==='image'?'Photo':reply.text || reply.attachment?.name || 'Message'}
                {reply.attachment?.kind==='image'&&<img src={reply.attachment.url} alt='Replied photo' className='ml-2 inline-block h-9 w-9 rounded-md object-cover'/>}
            </span>
            <button type='button' aria-label='Cancel reply' onClick={() => setReply(null)} className='p-1 text-muted'><X className='h-4 w-4' /></button>
        </div>}
        {attachment && <div className='flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-2'>
            {attachment.kind === 'image' ? <img src={attachment.url} alt='Photo to send' className='h-12 w-12 rounded-lg object-cover' />
                : <FileText className='h-9 w-9 text-brand' />}
            <span className='min-w-0 flex-1 truncate text-xs text-ink'>{attachment.name}</span>
            <button type='button' aria-label='Remove attachment' onClick={() => setAttachment(null)}
                className='flex h-10 w-10 items-center justify-center text-muted'><X className='h-5 w-5' /></button>
        </div>}
        {emojiOpen && <div className='flex max-h-28 shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-t border-line bg-panel px-3 py-2'>
            {EMOJI_PICKER.map((emoji) => <button key={emoji} type='button' onClick={() => appendEmoji(emoji)}
                className='flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-page text-xl'>{emoji}</button>)}
        </div>}
        {inlinePanel&&<div className='flex max-h-[58dvh] min-h-[180px] shrink-0 flex-col overflow-hidden border-t border-brand/35 bg-page'>
            <div className='flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1'>
                <span className='text-xs font-semibold text-ink'>{inlineTool==='action'?'Monitored Actions · this conversation':'Group Polls · this conversation'}</span>
                <button type='button' onClick={onCloseTool} aria-label='Close work panel' className='flex h-10 w-10 items-center justify-center rounded-xl text-brand'><X className='h-5 w-5'/></button>
            </div>
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>{inlinePanel}</div>
        </div>}
        {showCreateMenu&&<div className='flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel p-2'>
            <button type='button' onClick={()=>{onOpenTool?.('action',true);setShowCreateMenu(false)}}
                className='flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-brand'>
                <ClipboardList className='h-4 w-4'/>Assign action
            </button>
            <button type='button' onClick={()=>{onOpenTool?.('action',false);setShowCreateMenu(false)}}
                className='flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-brand'>
                <ClipboardList className='h-4 w-4'/>Action tracker
            </button>
            {room.kind==='group'&&<button type='button' onClick={()=>{onOpenTool?.('poll',true);setShowCreateMenu(false)}}
                className='flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-brand'>
                <BarChart3 className='h-4 w-4'/>Create poll
            </button>}
            {room.kind==='group'&&<button type='button' onClick={()=>{onOpenTool?.('poll',false);setShowCreateMenu(false)}}
                className='flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-page px-3 text-xs font-semibold text-brand'>
                <BarChart3 className='h-4 w-4'/>Poll results
            </button>}
        </div>}
        <div className='w-full shrink-0 border-t border-line bg-panel px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6'>
            <div className='flex w-full min-w-0 flex-col rounded-2xl border border-line bg-page shadow-sm focus-within:border-brand'>
                <textarea rows={2} maxLength={4000} value={body} onChange={(e) => onInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 640) {
                        e.preventDefault(); void send();
                    } }}
                    placeholder='Message your colleagues…'
                    aria-label='Write message'
                    className='max-h-32 min-h-14 w-full min-w-0 resize-y rounded-t-2xl bg-transparent px-3 pt-3 pb-1 text-sm text-ink outline-none' />
                <div className='flex min-w-0 items-center justify-between gap-2 px-2 pb-2 pt-1'>
                    <div className='flex min-w-0 items-center gap-1'>
                        <button type='button' onClick={()=>setShowCreateMenu(v=>!v)} title='Actions and polls'
                            aria-label='Open conversation tools' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-brand hover:bg-brand/10'>
                            <Plus className='h-5 w-5'/>
                        </button>
                        <label className='flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-brand hover:bg-brand/10'
                            title='Attach photo or report'>
                            {uploading ? <Loader2 className='h-5 w-5 animate-spin' /> : <Paperclip className='h-5 w-5' />}
                            <input type='file' className='sr-only' disabled={uploading || busy}
                                accept='image/jpeg,image/png,image/webp,application/pdf,.xlsx,.docx,.pptx,.csv,.txt'
                                onChange={(event) => { void attachFile(event); }} />
                        </label>
                        <button type='button' onClick={() => setEmojiOpen((x) => !x)} aria-label='Pick emoji'
                            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-brand hover:bg-brand/10'>
                            <Smile className='h-5 w-5' />
                        </button>
                    </div>
                    <button type='button' disabled={busy || uploading || (!body.trim() && !attachment)}
                        onClick={() => { void send(); }} aria-label='Send message'
                        className='flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand px-3 text-onbrand disabled:opacity-40'>
                        {busy ? <Loader2 className='h-5 w-5 animate-spin' /> : <Send className='h-5 w-5' />}
                        <span className='text-xs font-semibold'>Send</span>
                    </button>
                </div>
            </div>
            <p className='pt-1 text-center text-[10px] text-muted'>Photos and documents · max 5 MB</p>
        </div>
        {preview && <div role='dialog' aria-modal='true' aria-label='Image preview'
            className='fixed inset-0 z-[65] flex flex-col bg-black/95 p-4'>
            <div className='flex shrink-0 items-center justify-between gap-3 text-sm text-white'>
                <span className='min-w-0 truncate'>Photo preview</span>
                <button type='button' onClick={() => setPreview(null)} aria-label='Close preview'
                    className='flex h-12 w-12 items-center justify-center rounded-xl border border-white/30'>
                    <X className='h-5 w-5' />
                </button>
            </div>
            <div className='flex min-h-0 flex-1 items-center justify-center'>
                <img src={preview.url} alt={preview.name} className='max-h-full max-w-full object-contain' />
            </div>
            <a href={preview.url} target='_blank' rel='noopener noreferrer'
                className='flex shrink-0 items-center justify-center gap-2 py-3 text-sm text-white'>
                <Download className='h-4 w-4' /> Open full photo
            </a>
        </div>}
    </div>;
}
