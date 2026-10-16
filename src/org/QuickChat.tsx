import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, ChevronRight, CirclePlus, Info, Loader2, MessageCircle, MoreVertical, Plus, Search, ShieldCheck, Trash2, Users, Wifi, WifiOff, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { compressPhoto } from './mntShared';
import { leaveQuick } from './quickNavigation';
import { ChatAvatar } from './ChatThread';
import ChatThread from './ChatThread';
import QuickGroupPicker from './QuickGroupPicker';
import { ChatMuteAll, ChatWorkNotice, ChatOptions } from './ChatSettings';
import { ChatActionsBoard, ChatPollsBoard } from './ChatBoards';
import type { ChatAttachment, ChatLiveEvent, ChatMessage, ChatPerson, ChatRoom, ChatRoomPayload } from './chatTypes';
import { useChatRealtime } from './useChatRealtime';

type ChatMode = 'direct' | 'group';
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Could not complete the chat action.';
const formField = 'min-h-11 w-full rounded-xl border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-brand';
const chatRoute = (id?: string) => 'organization_home/quick/chat' + (id ? '/' + id : '');
function contactFor(room: ChatRoom, people: ChatPerson[], uid: string): ChatPerson | undefined {
    const partner = room.members.find((id) => id !== uid);
    return people.find((p) => p.uid === partner);
}
function titleFor(room: ChatRoom, people: ChatPerson[], uid: string) {
    if (room.kind === 'group') return room.title || 'Group chat';
    return contactFor(room, people, uid)?.name || 'Colleague';
}
function friendlyTime(iso: string) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    const today = new Date();
    return date.toDateString() === today.toDateString()
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function nextClientId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
function mimeFor(file: File): string {
    const ext = file.name.toLowerCase().split('.').pop();
    const mapped: Record<string,string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
        pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        csv: 'text/csv', txt: 'text/plain',
    };
    return mapped[ext || ''] || file.type;
}
async function base64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            if (comma < 0) reject(new Error('Cannot read this file.'));
            else resolve(result.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error('Could not read the selected file.'));
        reader.readAsDataURL(file);
    });
}
interface Props { uid: string; roomId?: string }

export default function QuickChat({ uid, roomId = '' }: Props) {
    const [people, setPeople] = useState<ChatPerson[]>([]);
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [thread, setThread] = useState<ChatRoomPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [roomLoading, setRoomLoading] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [search, setSearch] = useState('');
    const [create, setCreate] = useState(false);
    const [kind, setKind] = useState<ChatMode>('direct');
    const [chosen, setChosen] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [showGroup, setShowGroup] = useState(false);
    const [showWorkNotice,setShowWorkNotice] = useState(false);
    const [roomTheme,setRoomTheme] = useState('default');
    const [invites,setInvites] = useState<Array<{id:string;title:string;count:number}>>([]);
    const [showAssignments,setShowAssignments] = useState(false);
    const [inlineTool,setInlineTool] = useState<'action'|'poll'|''>('');
    const [inlineNew,setInlineNew] = useState(false);
    const [boardRev,setBoardRev] = useState(0);
    const [groupName, setGroupName] = useState('');
    const [newMembers, setNewMembers] = useState<string[]>([]);
    const [typing, setTyping] = useState<Record<string, string>>({});
    const [presence, setPresence] = useState<Record<string, string>>({});
    const lastTyping = useRef(0);
    const roomRef = useRef(roomId);
    roomRef.current = roomId;

    const loadInbox = useCallback(async () => {
        const response = await callBackend<{ rooms: ChatRoom[] }>('/api/org/quick/chat/list');
        setRooms(response.rooms);
        const r=await callBackend<{invitations:Array<{id:string;title:string;count:number}>}>('/api/org/quick/chat/invitations');
        setInvites(r.invitations);
    }, []);

    const refreshThread = useCallback(async (id: string, preserveHistory = false) => {
        const data = await callBackend<ChatRoomPayload>('/api/org/quick/chat/room', { roomId: id });
        if (roomRef.current !== id) return;
        setThread((previous) => {
            if (!preserveHistory || !previous || previous.room.id !== id) return data;
            const merged = new Map(previous.messages.map((message) => [message.id, message]));
            for (const item of data.messages) merged.set(item.id, item);
            return { ...data, messages: [...merged.values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt)),
                before: previous.before, hasMore: previous.hasMore };
        });
        setTyping(Object.fromEntries(data.typing.map((item) => [item.uid, item.until])));
        setPresence(Object.fromEntries(data.presence.map((item) => [item.uid, item.until])));
    }, []);

    useEffect(() => {
        let alive = true;
        void Promise.all([
            callBackend<{ people: ChatPerson[] }>('/api/org/quick/chat/people'),
            callBackend<{ rooms: ChatRoom[] }>('/api/org/quick/chat/list'),
            callBackend<{ invitations: Array<{id:string;title:string;count:number}> }>('/api/org/quick/chat/invitations'),
        ]).then(([persons, chats, requests]) => {
            if (!alive) return;
            setPeople(persons.people); setRooms(chats.rooms);setInvites(requests.invitations);
        }).catch((e: unknown) => { if (alive) setError(errorText(e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [uid]);

    useEffect(() => {
        setShowGroup(false); setCreate(false); setTyping({}); setPresence({});setInlineTool('');
        if (!roomId) { setThread(null); void loadInbox().catch(() => undefined); return; }
        setRoomLoading(true); setError('');
        void refreshThread(roomId).then(() => {
            void callBackend('/api/org/quick/chat/read', { roomId }).catch(() => undefined);
            void callBackend('/api/org/quick/chat/presence', { roomId, active: true }).catch(() => undefined);
        }).catch((e: unknown) => setError(errorText(e)))
            .finally(() => setRoomLoading(false));
        // Presence refresh is a write-only heartbeat, not message polling.
        // The server expires abandoned browser sessions automatically.
        const heartbeat = setInterval(() => {
            if (document.visibilityState !== 'hidden') {
                void callBackend('/api/org/quick/chat/presence', { roomId, active: true }).catch(() => undefined);
            }
        }, 45_000);
        return () => {
            clearInterval(heartbeat);
            void callBackend('/api/org/quick/chat/presence', { roomId, active: false }).catch(() => undefined);
        };
    }, [roomId, refreshThread, loadInbox]);

    const onRoomEvent = useCallback((event: ChatLiveEvent) => {
        if (event.entity_id !== roomRef.current) return;
        if(event.event==='action'||event.event==='poll')setBoardRev(n=>n+1);
        if (event.event === 'typing' && event.uid) {
            setTyping((old) => ({ ...old, [event.uid!]: event.active ? event.until || '' : '' }));
        } else if (event.event === 'presence' && event.uid) {
            setPresence((old) => ({ ...old, [event.uid!]: event.active ? event.until || '' : '' }));
        } else {
            void refreshThread(event.entity_id, true)
                .then(() => { if (event.event !== 'read') void callBackend('/api/org/quick/chat/read', {
                    roomId: event.entity_id,
                }).catch(() => undefined); })
                .catch((e: unknown) => setError(errorText(e)));
        }
    }, [refreshThread]);
    const live = useChatRealtime(uid, roomId, {
        inbox: () => { void loadInbox().catch((e: unknown) => setError(errorText(e))); },
        room: onRoomEvent,
    });
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            setTyping((old) => Object.fromEntries(Object.entries(old).filter(([,until]) => Date.parse(until) > now)));
            setPresence((old) => Object.fromEntries(Object.entries(old).filter(([,until]) => Date.parse(until) > now)));
        }, 1800);
        return () => clearInterval(timer);
    }, []);

    const active = thread?.room ?? rooms.find((room) => room.id === roomId);
    const filteredPeople = people.filter((p) => p.uid !== uid && (p.name + ' ' + (p.email || ''))
        .toLowerCase().includes(search.trim().toLowerCase()));
    const shownRooms = rooms.filter((room) => (
        (titleFor(room, people, uid) + ' ' + room.lastMessage).toLowerCase().includes(search.trim().toLowerCase())
    ));
    const openRoom = (id: string) => leaveQuick(chatRoute(id));
    const back = () => leaveQuick(chatRoute());

    const createRoom = async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
            const r = await callBackend<{ room: ChatRoom }>('/api/org/quick/chat/start', {
                kind, title, memberUids: chosen,
            });
            setCreate(false); setChosen([]); setTitle('');
            await loadInbox();
            openRoom(r.room.id);
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    const hideRoom = async (room: ChatRoom) => {
        if (!window.confirm('Remove this chat from your list? Its history is retained and colleagues are not affected.')) return;
        setBusy(true); setError('');
        try {
            await callBackend('/api/org/quick/chat/hide', { roomId: room.id });
            await loadInbox();
            if (room.id === roomId) back();
            setNotice('Conversation hidden from your list.');
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    const send = async (body: string, attachment: ChatAttachment | null, replyId: string): Promise<boolean> => {
        if (!roomId) return false;
        setBusy(true); setError('');
        try {
            const response = await callBackend<{ message: ChatMessage }>('/api/org/quick/chat/send', {
                roomId, text: body, attachmentId: attachment?.id || '', replyTo: replyId,
                clientId: nextClientId(),
            });
            setThread((previous) => {
                if (!previous || previous.room.id !== roomId) return previous;
                return { ...previous, messages: [...previous.messages.filter((m) => m.id !== response.message.id),
                    response.message].sort((a,b) => a.createdAt.localeCompare(b.createdAt)) };
            });
            void loadInbox().catch(() => undefined);
            return true;
        } catch (e) { setError(errorText(e)); return false; }
        finally { setBusy(false); }
    };
    const upload = async (file: File): Promise<ChatAttachment | null> => {
        if (!roomId) return null;
        let payload = file;
        const mime = mimeFor(file);
        if (!mime || file.size > 5_000_000 && !mime.startsWith('image/')) {
            throw new Error('Use a supported file under 5 MB.');
        }
        let encoded: string, finalMime = mime, name = file.name;
        if (mime.startsWith('image/') && file.size > 3_500_000) {
            encoded = await compressPhoto(file);
            finalMime = 'image/jpeg';
            name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        } else {
            encoded = await base64(payload);
        }
        const response = await callBackend<{ attachment: ChatAttachment }>('/api/org/quick/chat/upload', {
            roomId, name, mime: finalMime, data: encoded,
        });
        return response.attachment;
    };
    const removeMessage = async (messageId: string) => {
        if (!roomId) return;
        setError('');
        try {
            await callBackend('/api/org/quick/chat/delete', { roomId, messageId });
            await refreshThread(roomId, true);
            await loadInbox();
        } catch (e) { setError(errorText(e)); }
    };
    const react = async (messageId: string, emoji: string) => {
        if (!roomId) return;
        try {
            await callBackend('/api/org/quick/chat/react', { roomId, messageId, emoji });
            await refreshThread(roomId, true);
        } catch (e) { setError(errorText(e)); }
    };
    const typingUpdate = (value: boolean) => {
        if (!roomId) return;
        const now = Date.now();
        if (value && now - lastTyping.current < 1400) return;
        lastTyping.current = now;
        void callBackend('/api/org/quick/chat/typing', { roomId, active: value }).catch(() => undefined);
    };
    const older = async () => {
        if (!roomId || !thread?.before || olderLoading) return;
        setOlderLoading(true);
        try {
            const response = await callBackend<ChatRoomPayload>('/api/org/quick/chat/room', {
                roomId, before: thread.before,
            });
            setThread((old) => {
                if (!old || old.room.id !== roomId) return old;
                const merged = new Map([...response.messages, ...old.messages].map((msg) => [msg.id, msg]));
                return { ...old, messages: [...merged.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),
                    before: response.before, hasMore: response.hasMore };
            });
        } catch (e) { setError(errorText(e)); }
        finally { setOlderLoading(false); }
    };
    const respondInvite=async(id:string,decision:'accept'|'decline')=>{
        setBusy(true);setError('');
        try{await callBackend('/api/org/quick/chat/invitation/respond',{roomId:id,decision});
            await loadInbox();setNotice(decision==='accept'?'Joined group.':'Invitation declined.');
            if(decision==='accept')openRoom(id);
        }catch(e){setError(errorText(e))}finally{setBusy(false)}
    };
    const groupAction = async (action: 'rename' | 'add' | 'remove', data: Record<string, unknown>) => {
        if (!roomId) return;
        setBusy(true); setError('');
        try {
            await callBackend('/api/org/quick/chat/group/update', { roomId, action, ...data });
            await refreshThread(roomId, true);
            await loadInbox();
            setNotice('Group updated.');
            if (action === 'add') setNewMembers([]);
        } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };

    const currentPeople = thread?.people || people.filter((p) => active?.members.includes(p.uid));
    const counterpart = active?.kind === 'direct' ? contactFor(active, currentPeople.length ? currentPeople : people, uid) : undefined;
    const canManageGroup = active?.kind === 'group' && active.admins.includes(uid);
    return <div className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-page'>
        {!roomId ? (
            <>
                <div className='shrink-0 border-b border-line bg-panel p-3 sm:px-6'>
                    <div className='flex items-center justify-between gap-2'>
                        <div className='flex min-w-0 items-center gap-2'>
                            <button type='button' aria-label='Back to Quick links'
                                onClick={()=>leaveQuick('organization_home/quick')}
                                className='flex h-11 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-brand'>
                                <ArrowLeft className='h-5 w-5'/>
                            </button>
                            <div>
                            <h2 className='flex items-center gap-2 text-lg font-semibold text-ink'>
                                <MessageCircle className='h-5 w-5 text-brand' /> Chats
                            </h2>
                            <p className='text-[11px] text-muted'>Chat · workplace communication</p>
                            </div>
                        </div>
                        <button type='button' onClick={() => { setCreate((s)=>!s); setChosen([]); setKind('direct'); setSearch(''); }}
                            className='flex min-h-11 items-center gap-2 rounded-xl bg-brand px-3 text-xs font-semibold text-onbrand'>
                            {create ? <X className='h-4 w-4' /> : <CirclePlus className='h-4 w-4' />}
                            {create ? 'Cancel' : 'New chat'}
                        </button>
                    </div>
                    <div className='relative mt-3'>
                        <Search className='absolute left-3 top-3.5 h-4 w-4 text-muted' />
                        <input className={formField + ' pl-9'} value={search} onChange={(e)=>setSearch(e.target.value)}
                            placeholder={create ? 'Find organization colleagues' : 'Search conversations'} />
                    </div>
                    {!create&&<div className='mt-2 flex flex-wrap items-center gap-2'>
                        <button type='button' onClick={()=>setShowAssignments(x=>!x)}
                            className={'min-h-10 rounded-xl border px-3 text-xs font-semibold '+(showAssignments?'border-brand bg-brand/10 text-brand':'border-line text-muted')}>
                            My chat assignments
                        </button>
                        <ChatMuteAll/>
                    </div>}
                    <p className='mt-2 flex items-center gap-2 text-[11px] text-muted'>
                        {live.connected ? <Wifi className='h-3.5 w-3.5 text-brand' /> : <WifiOff className='h-3.5 w-3.5' />}
                        {live.connected ? 'Live messaging connected' : 'Messages refresh every 12 seconds'}
                    </p>
                </div>
                {error && <p role='alert' className='shrink-0 bg-red-500/10 px-4 py-2 text-xs text-red-500'>{error}</p>}
                {notice && <p className='shrink-0 bg-brand/10 px-4 py-2 text-xs text-brand'>{notice}</p>}
                {!create&&showAssignments?<ChatActionsBoard uid={uid} people={people} revision={boardRev}/> : create ? (
                    <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-6'>
                        <div className='grid grid-cols-2 gap-2'>
                            {(['direct','group'] as ChatMode[]).map((mode) => <button key={mode} type='button'
                                onClick={()=>{setKind(mode);setChosen([]);}}
                                className={'min-h-12 rounded-xl border text-xs font-semibold '+
                                (kind===mode?'border-brand bg-brand/10 text-brand':'border-line bg-panel text-soft')}>
                                {mode === 'direct' ? 'Individual chat' : 'Group chat'}
                            </button>)}
                        </div>
                        {kind==='group'&&<QuickGroupPicker available={filteredPeople.map(p=>p.uid)} onSelect={(selected,title)=>{setChosen(selected);setTitle(title);}}/>}
                        {kind === 'group' && <label className='block text-xs font-semibold text-muted'>Group name
                            <input maxLength={90} className={formField} placeholder='e.g. Engineering shift team'
                                value={title} onChange={(e)=>setTitle(e.target.value)} />
                        </label>}
                        <p className='text-xs text-muted'>
                            {kind === 'direct' ? 'Select one colleague.' : 'Select up to 49 colleagues.'}
                            {' '}Only active users in this organization are available. {kind==='group'&&'Invitations require acceptance.'}
                        </p>
                        {loading ? <div className='p-5 text-sm text-muted'>Loading colleagues…</div> :
                            filteredPeople.length === 0 ? <p className='p-4 text-sm text-muted'>No matching colleagues.</p> :
                                filteredPeople.map((p) => <label key={p.uid}
                                    className='flex min-h-14 items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2'>
                                    <input type={kind === 'direct' ? 'radio' : 'checkbox'} name='chat-participants'
                                        className='h-5 w-5 accent-[rgb(var(--c-brand))]' checked={chosen.includes(p.uid)}
                                        onChange={(e)=>setChosen((old)=>kind==='direct'
                                            ? e.target.checked?[p.uid]:[]
                                            : e.target.checked?[...old.filter((x)=>x!==p.uid),p.uid]:old.filter((x)=>x!==p.uid))} />
                                    <ChatAvatar person={p} size={39} />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate text-sm font-semibold text-ink'>{p.name}</span>
                                        <span className='block truncate text-xs text-muted'>{p.email}</span>
                                    </span>
                                </label>)}
                    </div>
                ) : (
                    <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                        {invites.length>0&&<div className='space-y-2 border-b border-line p-3'>
                            <p className='text-xs font-semibold text-brand'>Group invitations ({invites.length})</p>
                            {invites.map(inv=><div key={inv.id} className='flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3'>
                                <Users className='h-5 w-5 text-brand'/>
                                <span className='min-w-0 flex-1 text-xs font-semibold text-ink'>{inv.title}<span className='block text-[11px] font-normal text-muted'>Invitation pending · {inv.count} members</span></span>
                                <button type='button' disabled={busy} onClick={()=>{void respondInvite(inv.id,'accept')}} className='min-h-10 rounded-lg bg-brand px-3 text-xs text-onbrand'>Accept</button>
                                <button type='button' disabled={busy} onClick={()=>{void respondInvite(inv.id,'decline')}} className='min-h-10 rounded-lg border border-line px-3 text-xs text-ink'>Decline</button>
                            </div>)}
                        </div>}
                        {loading ? <div className='flex justify-center p-8'><Loader2 className='h-6 w-6 animate-spin text-brand' /></div>
                            : shownRooms.length === 0 ?
                                <div className='mx-auto max-w-xs space-y-2 p-8 text-center'>
                                    <MessageCircle className='mx-auto h-9 w-9 text-brand' />
                                    <h3 className='font-semibold text-ink'>No chats yet</h3>
                                    <p className='text-xs text-muted'>Start an individual or group conversation with your colleagues.</p>
                                </div> : shownRooms.map((r) => {
                                    const person = contactFor(r,people,uid);
                                    return <div key={r.id} className='flex items-center gap-1 border-b border-line/50 bg-panel/30 px-3 py-2 sm:px-6'>
                                        <button type='button' onClick={()=>openRoom(r.id)}
                                            className='flex min-h-16 min-w-0 flex-1 items-center gap-3 text-left'>
                                            {r.kind==='group'
                                                ? <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand'><Users className='h-5 w-5' /></span>
                                                : <ChatAvatar person={person} size={44} />}
                                            <span className='min-w-0 flex-1'>
                                                <span className='flex items-center gap-2'>
                                                    <span className='block min-w-0 flex-1 truncate text-sm font-semibold text-ink'>{titleFor(r,people,uid)}</span>
                                                    {r.unread && <span className='h-2.5 w-2.5 shrink-0 rounded-full bg-brand' aria-label='Unread messages' />}
                                                </span>
                                                <span className={'block truncate text-xs ' + (r.unread ? 'font-semibold text-ink' : 'text-muted')}>{r.lastMessage || (r.kind==='group' ? r.members.length+' participants' : 'Tap to chat')}</span>
                                            </span>
                                            <span className='shrink-0 text-[10px] text-muted'>{friendlyTime(r.lastMessageAt || r.updatedAt)}</span>
                                            <ChevronRight className='h-4 w-4 shrink-0 text-muted' />
                                        </button>
                                        <button type='button' aria-label={'Hide chat '+titleFor(r,people,uid)}
                                            title='Hide conversation (for me only)' onClick={()=>{void hideRoom(r);}}
                                            className='flex h-11 w-8 shrink-0 items-center justify-center text-muted'>
                                            <MoreVertical className='h-4 w-4' />
                                        </button>
                                    </div>;
                                })}
                    </div>
                )}
                {create && <div className='shrink-0 border-t border-line bg-panel px-3 py-3 sm:px-6'>
                    <button type='button' disabled={busy || (kind==='direct' ? chosen.length !== 1 :
                        chosen.length===0 || chosen.length>49 || title.trim().length<3)}
                        onClick={()=>{void createRoom();}} className='flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-onbrand disabled:opacity-40'>
                        {busy?<Loader2 className='h-5 w-5 animate-spin'/>:<Plus className='h-5 w-5'/>}
                        {kind==='group'?'Create group':'Start individual chat'} ({chosen.length} selected)
                    </button>
                </div>}
            </>
        ) : (
            <>
                <div className='flex min-h-16 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 py-2 sm:px-6'>
                    <button type='button' aria-label='Back to conversations' onClick={back}
                        className='flex h-11 w-10 shrink-0 items-center justify-center rounded-xl text-brand'>
                        <ArrowLeft className='h-5 w-5'/>
                    </button>
                    {active?.kind === 'group' ?
                        <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand'><Users className='h-5 w-5'/></span> :
                        <ChatAvatar person={counterpart} size={40}/>}
                    <button type='button' onClick={()=>setShowGroup((s)=>!s)}
                        className='min-w-0 flex-1 text-left'>
                        <span className='block truncate text-sm font-semibold text-ink'>{active ? titleFor(active,currentPeople,uid):'Opening chat…'}</span>
                        <span className='block truncate text-xs text-muted'>
                            {active?.kind==='group'?active.members.length+' members · tap for details':
                                Object.entries(presence).some(([member,until])=>member!==uid&&Date.parse(until)>Date.now())
                                    ? '● Active now' : 'Tap for conversation details'}
                        </span>
                    </button>
                    <button type='button' onClick={()=>setShowWorkNotice(v=>!v)} aria-label='Workplace chat notice'
                        className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-brand'><Info className='h-5 w-5'/></button>
                </div>
                {error && <div role='alert' className='shrink-0 bg-red-500/10 px-3 py-2 text-xs text-red-500'>{error}</div>}
                {notice && <div className='shrink-0 bg-brand/10 px-3 py-1 text-[11px] text-brand'>{notice}</div>}
                {live.notice && <div className='shrink-0 bg-amber-500/10 px-3 py-1 text-[11px] text-muted'>{live.notice}</div>}
                {showWorkNotice&&<ChatWorkNotice onClose={()=>setShowWorkNotice(false)}/>}
                {showGroup&&active&&<ChatOptions uid={uid} room={active} people={people}
                    onChanged={async()=>{await refreshThread(roomId,true);await loadInbox();}}
                    onLeave={()=>{back();}} onClose={()=>setShowGroup(false)} onTheme={setRoomTheme}/>}
                {roomLoading && !thread ? <div className='flex flex-1 items-center justify-center'><Loader2 className='h-7 w-7 animate-spin text-brand'/></div> :
                    thread?.room.id===roomId ? <ChatThread key={roomId} uid={uid} room={thread.room} people={thread.people}
                        messages={thread.messages} hasMore={thread.hasMore} busy={busy}
                        typing={Object.entries(typing).filter(([,until])=>Date.parse(until)>Date.now()).map(([id])=>id)}
                        presence={Object.entries(presence).filter(([,until])=>Date.parse(until)>Date.now()).map(([id])=>id)}
                        readMarks={thread.readMarks} loadingOlder={olderLoading} onOlder={()=>{void older();}}
                        theme={roomTheme} onSend={send} onUpload={upload} onDelete={removeMessage} onReact={react} onTyping={typingUpdate}
                        inlineTool={inlineTool}
                        inlinePanel={inlineTool==='action'?
                            <ChatActionsBoard key={'action-'+inlineNew} uid={uid} roomId={roomId}
                                people={currentPeople} revision={boardRev} initialCreate={inlineNew}
                                directRecipient={active?.kind==='direct'?counterpart?.uid||'':''}/>:
                            inlineTool==='poll'&&active?.kind==='group'?
                            <ChatPollsBoard key={'poll-'+inlineNew} uid={uid} roomId={roomId}
                                people={currentPeople} revision={boardRev} initialCreate={inlineNew}/>:undefined}
                        onOpenTool={(tool,create=false)=>{setInlineTool(tool);setInlineNew(create);}}
                        onCloseTool={()=>setInlineTool('')}/> :
                        <div className='flex flex-1 items-center justify-center p-5 text-center text-sm text-muted'>
                            {error || 'Conversation not available.'}
                        </div>}
            </>
        )}
    </div>;
}
