import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BellOff, Check, Loader2, MessageSquarePlus, MoreVertical, Pin, Search, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { compressPhoto } from './mntShared';
import { leaveQuick } from './quickNavigation';
import ChatThread from './ChatThread';
import { ChatInfoPage, ChatSettingsPage, NewChatPage } from './ChatSettings';
import { ChatActionsBoard, ChatPollsBoard } from './ChatBoards';
import type { ChatAttachment, ChatLiveState, ChatMessage, ChatPerson, ChatRoom, ChatRoomPayload } from './chatTypes';
import { useChatLive } from './useChatLive';
import { Ticks, WaAvatar, WaSheet, WaShell, inboxTime, lastSeenText, playTone, useChatSettings } from './chatUi';
import { appConfirm } from '../components/dialogs';

// ---------------------------------------------------------------------------
// Chat, presented like WhatsApp: the chat list with filters and unread badges, live conversations,
// contact / group info, chat settings and a new-chat screen with automatic teams.
// ---------------------------------------------------------------------------

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Could not complete the chat action.');
const chatRoute = (id?: string) => 'organization_home/quick/chat' + (id ? '/' + id : '');
type Filter = 'all' | 'unread' | 'groups';
type Overlay = '' | 'settings' | 'new' | 'info' | 'assignments';

function contactFor(room: ChatRoom, people: ChatPerson[], uid: string): ChatPerson | undefined {
    const partner = room.members.find((id) => id !== uid);
    return people.find((p) => p.uid === partner);
}
function titleFor(room: ChatRoom, people: ChatPerson[], uid: string) {
    if (room.kind === 'group') return room.title || 'Group chat';
    return contactFor(room, people, uid)?.name || 'Colleague';
}
function nextClientId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
function mimeFor(file: File): string {
    const ext = file.name.toLowerCase().split('.').pop();
    const mapped: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
        pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        csv: 'text/csv', txt: 'text/plain',
    };
    return mapped[ext || ''] || file.type;
}
async function base64(file: Blob): Promise<string> {
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
const EMPTY_LIVE: ChatLiveState = { typing: [], presence: [], readMarks: [], deliveryMarks: [], online: [] };

interface Props {
    uid: string;
    roomId?: string;
}

export default function QuickChat({ uid, roomId = '' }: Props) {
    const { settings, save: saveSettings } = useChatSettings();
    const [people, setPeople] = useState<ChatPerson[]>([]);
    const [rooms, setRooms] = useState<ChatRoom[]>([]);
    const [thread, setThread] = useState<ChatRoomPayload | null>(null);
    const [live, setLive] = useState<ChatLiveState>(EMPTY_LIVE);
    const [unreadAfter, setUnreadAfter] = useState('');
    const [loading, setLoading] = useState(true);
    const [roomLoading, setRoomLoading] = useState(false);
    const [olderLoading, setOlderLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [overlay, setOverlay] = useState<Overlay>('');
    const [menu, setMenu] = useState<'' | 'inbox' | 'room'>('');
    const [rowMenu, setRowMenu] = useState<ChatRoom | null>(null);
    const [roomSearch, setRoomSearch] = useState(false);
    const [wallpaper, setWallpaper] = useState('default');
    const [invites, setInvites] = useState<Array<{ id: string; title: string; count: number }>>([]);
    const [inlineTool, setInlineTool] = useState<'action' | 'poll' | ''>('');
    const [inlineNew, setInlineNew] = useState(false);
    const [boardRev, setBoardRev] = useState(0);
    const lastTyping = useRef(0);
    const roomRef = useRef(roomId);
    roomRef.current = roomId;
    const seenMessages = useRef<Set<string>>(new Set());
    const soundOn = useRef(settings);
    soundOn.current = settings;

    const loadInbox = useCallback(async () => {
        const [response, r] = await Promise.all([
            callBackend<{ rooms: ChatRoom[] }>('/api/org/quick/chat/list'),
            callBackend<{ invitations: Array<{ id: string; title: string; count: number }> }>('/api/org/quick/chat/invitations'),
        ]);
        setRooms((old) => {
            // Tone for a new message in another conversation (not muted, sound on).
            const before = new Map(old.map((x) => [x.id, x.lastMessageAt || '']));
            const fresh = response.rooms.some((x) => x.id !== roomRef.current && x.unread && !x.muted && before.has(x.id) && (x.lastMessageAt || '') > (before.get(x.id) || ''));
            if (fresh && soundOn.current.sound && !soundOn.current.muteAll) playTone();
            return response.rooms;
        });
        setInvites(r.invitations);
    }, []);

    const refreshThread = useCallback(async (id: string, preserveHistory = false) => {
        const data = await callBackend<ChatRoomPayload>('/api/org/quick/chat/room', { roomId: id });
        if (roomRef.current !== id) return;
        setThread((previous) => {
            if (!preserveHistory || !previous || previous.room.id !== id) return data;
            const merged = new Map(previous.messages.filter((m) => !m.pending && !m.failed).map((m) => [m.id, m]));
            for (const item of data.messages) merged.set(item.id, item);
            const keep = previous.messages.filter((m) => (m.pending || m.failed) && !merged.has(m.id));
            return { ...data, messages: [...merged.values(), ...keep].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), before: previous.before, hasMore: previous.hasMore };
        });
        setLive({ typing: data.typing, presence: data.presence, readMarks: data.readMarks, deliveryMarks: data.deliveryMarks ?? [], online: data.online ?? [] });
        // Tone for a new incoming message in the open conversation.
        const incoming = data.messages.filter((m) => m.senderUid !== uid && !seenMessages.current.has(m.id));
        if (preserveHistory && incoming.length && soundOn.current.sound && !soundOn.current.muteAll) playTone();
        data.messages.forEach((m) => seenMessages.current.add(m.id));
        return data;
    }, [uid]);

    useEffect(() => {
        let alive = true;
        void Promise.all([callBackend<{ people: ChatPerson[] }>('/api/org/quick/chat/people'), loadInbox()])
            .then(([persons]) => {
                if (alive) setPeople(persons.people);
            })
            .catch((e: unknown) => {
                if (alive) setError(errorText(e));
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [uid, loadInbox]);

    useEffect(() => {
        setOverlay('');
        setMenu('');
        setRoomSearch(false);
        setInlineTool('');
        setLive(EMPTY_LIVE);
        seenMessages.current = new Set();
        if (!roomId) {
            setThread(null);
            return;
        }
        setRoomLoading(true);
        setError('');
        void refreshThread(roomId)
            .then((data) => {
                setUnreadAfter(data?.readMarks.find((r) => r.uid === uid)?.readAt || '');
                void callBackend('/api/org/quick/chat/read', { roomId }).catch(() => undefined);
                void callBackend('/api/org/quick/chat/presence', { roomId, active: true }).catch(() => undefined);
            })
            .catch((e: unknown) => setError(errorText(e)))
            .finally(() => setRoomLoading(false));
        void callBackend<{ theme: string }>('/api/org/quick/chat/preferences', { roomId })
            .then((p) => setWallpaper(p.theme && p.theme !== 'default' ? p.theme : ''))
            .catch(() => undefined);
        // Presence heartbeat ("online in this chat"); the server expires it if the browser disappears.
        const heartbeat = setInterval(() => {
            if (document.visibilityState !== 'hidden') void callBackend('/api/org/quick/chat/presence', { roomId, active: true }).catch(() => undefined);
        }, 45_000);
        return () => {
            clearInterval(heartbeat);
            void callBackend('/api/org/quick/chat/presence', { roomId, active: false }).catch(() => undefined);
        };
    }, [roomId, refreshThread, uid]);

    const connection = useChatLive(roomId, {
        inbox: () => void loadInbox().catch(() => undefined),
        roomData: () => {
            const id = roomRef.current;
            if (!id) return;
            setBoardRev((n) => n + 1);
            void refreshThread(id, true)
                .then(() => callBackend('/api/org/quick/chat/read', { roomId: id }))
                .catch(() => undefined);
        },
        roomLive: (state) => setLive(state),
    });

    const active = thread?.room ?? rooms.find((room) => room.id === roomId);
    const counterpart = active?.kind === 'direct' ? contactFor(active, thread?.people?.length ? thread.people : people, uid) : undefined;
    const currentPeople = thread?.people || people.filter((p) => active?.members.includes(p.uid));
    const typingNow = live.typing.filter((t) => Date.parse(t.until) > Date.now() && t.uid !== uid).map((t) => t.uid);
    const status = useMemo(() => {
        if (!active) return '';
        if (typingNow.length) {
            if (active.kind === 'direct') return 'typing…';
            return (currentPeople.find((p) => p.uid === typingNow[0])?.name.split(' ')[0] || 'Someone') + ' is typing…';
        }
        if (active.kind === 'group') {
            const names = active.members.map((m) => (m === uid ? 'You' : currentPeople.find((p) => p.uid === m)?.name.split(' ')[0] || 'Member'));
            return names.join(', ');
        }
        const o = live.online.find((x) => x.uid === counterpart?.uid);
        if (o?.online) return 'online';
        return o?.lastSeen ? lastSeenText(o.lastSeen) : 'tap here for contact info';
    }, [active, typingNow, live.online, counterpart, currentPeople, uid]);

    const openRoom = (id: string) => leaveQuick(chatRoute(id));
    const back = () => leaveQuick(chatRoute());

    const send = async (body: string, attachment: ChatAttachment | null, replyId: string, clientId = nextClientId()): Promise<boolean> => {
        if (!roomId) return false;
        setError('');
        const tempId = 'tmp_' + clientId;
        const replyTo = replyId ? thread?.messages.find((m) => m.id === replyId) : undefined;
        const optimistic: ChatMessage = {
            id: tempId, roomId, senderUid: uid, text: body.trim(), createdAt: new Date().toISOString(), deletedForAll: false, deletedAt: '',
            attachment, replyTo: replyTo ? { id: replyTo.id, senderUid: replyTo.senderUid, text: replyTo.text, attachment: replyTo.attachment?.name || '', imageUrl: replyTo.attachment?.kind === 'image' ? replyTo.attachment.url : '' } : null,
            reactions: {}, pending: true,
        };
        setThread((p) => (p && p.room.id === roomId ? { ...p, messages: [...p.messages.filter((m) => m.id !== tempId), optimistic] } : p));
        try {
            const response = await callBackend<{ message: ChatMessage }>('/api/org/quick/chat/send', { roomId, text: body, attachmentId: attachment?.id || '', replyTo: replyId, clientId });
            seenMessages.current.add(response.message.id);
            setThread((previous) => {
                if (!previous || previous.room.id !== roomId) return previous;
                return { ...previous, messages: [...previous.messages.filter((m) => m.id !== response.message.id && m.id !== tempId), response.message].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
            });
            void loadInbox().catch(() => undefined);
            return true;
        } catch (e) {
            setError(errorText(e));
            // Keep the text so it can be sent again; the same client id makes the retry idempotent.
            setThread((p) => (p ? { ...p, messages: p.messages.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true, referenceId: clientId } : m)) } : p));
            return false;
        }
    };
    const retry = (m: ChatMessage) => {
        setThread((p) => (p ? { ...p, messages: p.messages.filter((x) => x.id !== m.id) } : p));
        void send(m.text, m.attachment, m.replyTo?.id || '', m.referenceId || nextClientId());
    };
    const upload = async (file: File): Promise<ChatAttachment | null> => {
        if (!roomId) return null;
        const mime = mimeFor(file);
        if (!mime || (file.size > 5_000_000 && !mime.startsWith('image/'))) throw new Error('Use a supported file under 5 MB.');
        let encoded: string;
        let finalMime = mime;
        let name = file.name;
        if (mime.startsWith('image/') && file.size > 3_500_000) {
            encoded = await compressPhoto(file);
            finalMime = 'image/jpeg';
            name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        } else {
            encoded = await base64(file);
        }
        const response = await callBackend<{ attachment: ChatAttachment }>('/api/org/quick/chat/upload', { roomId, name, mime: finalMime, data: encoded });
        return response.attachment;
    };
    const removeMessage = async (messageId: string) => {
        if (!roomId) return;
        try {
            await callBackend('/api/org/quick/chat/delete', { roomId, messageId });
            await refreshThread(roomId, true);
            await loadInbox();
        } catch (e) {
            setError(errorText(e));
        }
    };
    const react = async (messageId: string, emoji: string) => {
        if (!roomId) return;
        // Show the reaction at once; the server result (and other people's) arrives through the live channel.
        setThread((p) =>
            p
                ? {
                      ...p,
                      messages: p.messages.map((m) => {
                          if (m.id !== messageId) return m;
                          const had = (m.reactions[emoji] ?? []).includes(uid);
                          const next: Record<string, string[]> = {};
                          for (const [e, list] of Object.entries(m.reactions)) next[e] = list.filter((x) => x !== uid);
                          if (!had) next[emoji] = [...(next[emoji] ?? []), uid];
                          return { ...m, reactions: next };
                      }),
                  }
                : p,
        );
        try {
            // One reaction per person, as in WhatsApp: remove a different earlier reaction first.
            const m = thread?.messages.find((x) => x.id === messageId);
            const previous = m ? Object.entries(m.reactions).find(([e, list]) => e !== emoji && list.includes(uid))?.[0] : undefined;
            if (previous) await callBackend('/api/org/quick/chat/react', { roomId, messageId, emoji: previous });
            await callBackend('/api/org/quick/chat/react', { roomId, messageId, emoji });
        } catch (e) {
            setError(errorText(e));
            void refreshThread(roomId, true).catch(() => undefined);
        }
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
            const response = await callBackend<ChatRoomPayload>('/api/org/quick/chat/room', { roomId, before: thread.before });
            setThread((old) => {
                if (!old || old.room.id !== roomId) return old;
                const merged = new Map([...response.messages, ...old.messages].map((msg) => [msg.id, msg]));
                return { ...old, messages: [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), before: response.before, hasMore: response.hasMore };
            });
        } catch (e) {
            setError(errorText(e));
        } finally {
            setOlderLoading(false);
        }
    };
    const respondInvite = async (id: string, decision: 'accept' | 'decline') => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/quick/chat/invitation/respond', { roomId: id, decision });
            await loadInbox();
            setNotice(decision === 'accept' ? 'Joined group.' : 'Invitation declined.');
            if (decision === 'accept') openRoom(id);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    const roomPref = async (room: ChatRoom, mode: 'pin' | 'mute', value: boolean | string) => {
        try {
            await callBackend('/api/org/quick/chat/preferences/save', mode === 'pin' ? { mode, roomId: room.id, pinned: value } : { mode, roomId: room.id, duration: value });
            await loadInbox();
        } catch (e) {
            setError(errorText(e));
        }
    };
    const hideRoom = async (room: ChatRoom) => {
        if (!(await appConfirm('Hide this chat from your list? Its history is kept as an organization record and other members are not affected.'))) return;
        try {
            await callBackend('/api/org/quick/chat/hide', { roomId: room.id });
            await loadInbox();
            if (room.id === roomId) back();
        } catch (e) {
            setError(errorText(e));
        }
    };

    const term = search.trim().toLowerCase();
    const shownRooms = rooms
        .filter((r) => (filter === 'unread' ? r.unread : filter === 'groups' ? r.kind === 'group' : true))
        .filter((r) => !term || (titleFor(r, people, uid) + ' ' + r.lastMessage).toLowerCase().includes(term))
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.lastMessageAt || b.updatedAt).localeCompare(a.lastMessageAt || a.updatedAt));
    const unreadChats = rooms.filter((r) => r.unread).length;
    const canSend = !active || active.kind !== 'group' || active.sendPolicy !== 'admins' || active.admins.includes(uid);

    // ---- Sub-pages ----------------------------------------------------------
    if (overlay === 'settings')
        return (
            <WaShell settings={settings} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
                <ChatSettingsPage uid={uid} people={people} settings={settings} onSave={saveSettings} onBack={() => setOverlay('')} />
            </WaShell>
        );
    if (overlay === 'new')
        return (
            <WaShell settings={settings} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
                <NewChatPage uid={uid} people={people} onBack={() => setOverlay('')} onOpen={(id) => { setOverlay(''); void loadInbox(); openRoom(id); }} />
            </WaShell>
        );
    if (overlay === 'assignments')
        return (
            <WaShell settings={settings} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
                <div className='flex min-h-14 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)] wa-bar'>
                    <button type='button' aria-label='Back' onClick={() => setOverlay('')} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                        <ArrowLeft className='h-6 w-6' />
                    </button>
                    <h2 className='flex-1 text-[1.1em] font-medium'>My chat assignments</h2>
                </div>
                <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-page text-ink'>
                    <ChatActionsBoard uid={uid} people={people} revision={boardRev} />
                </div>
            </WaShell>
        );
    if (overlay === 'info' && active && roomId)
        return (
            <WaShell settings={settings} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
                <ChatInfoPage
                    uid={uid}
                    room={active}
                    people={currentPeople.length ? currentPeople : people}
                    allPeople={people}
                    live={live}
                    wallpaper={wallpaper || 'default'}
                    onWallpaper={setWallpaper}
                    onChanged={async () => {
                        await refreshThread(roomId, true);
                        await loadInbox();
                    }}
                    onLeave={() => back()}
                    onBack={() => setOverlay('')}
                    onOpenTool={(tool) => {
                        setOverlay('');
                        setInlineTool(tool);
                        setInlineNew(false);
                    }}
                />
            </WaShell>
        );

    // ---- Conversation --------------------------------------------------------
    if (roomId) {
        const header = (
            <div className='relative flex min-h-14 shrink-0 items-center gap-1 px-1 pt-[env(safe-area-inset-top)] wa-bar'>
                <button type='button' aria-label='Back to chats' onClick={back} className='flex h-11 items-center gap-0.5 rounded-full pl-1 pr-0.5 wa-hover'>
                    <ArrowLeft className='h-6 w-6' />
                    {active?.kind === 'group' ? <WaAvatar group size={38} /> : <WaAvatar person={counterpart} size={38} />}
                </button>
                <button type='button' onClick={() => setOverlay('info')} className='min-w-0 flex-1 px-1.5 text-left'>
                    <span className='block truncate text-[1.05em] font-medium'>{active ? titleFor(active, currentPeople.length ? currentPeople : people, uid) : 'Opening chat…'}</span>
                    <span className={`block truncate text-[0.78em] ${typingNow.length || status === 'online' ? 'wa-green' : 'wa-sub'}`}>{status}</span>
                </button>
                <button type='button' aria-label='Search in chat' onClick={() => setRoomSearch(true)} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                    <Search className='h-5 w-5' />
                </button>
                <button type='button' aria-label='More options' onClick={() => setMenu((m) => (m === 'room' ? '' : 'room'))} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                    <MoreVertical className='h-5 w-5' />
                </button>
                {menu === 'room' && (
                    <div className='wa-pop absolute right-2 top-[calc(100%-6px)] z-30 w-56 overflow-hidden rounded-xl py-1.5 shadow-2xl wa-panel' role='menu'>
                        {[
                            [active?.kind === 'group' ? 'Group info' : 'Contact info', () => setOverlay('info')],
                            ['Search', () => setRoomSearch(true)],
                            ['Monitored actions', () => { setInlineTool('action'); setInlineNew(false); }],
                            ...(active?.kind === 'group' ? [['Polls', () => { setInlineTool('poll'); setInlineNew(false); }] as const] : []),
                            [active?.muted ? 'Unmute notifications' : 'Mute notifications', () => active && void roomPref(active, 'mute', active.muted ? 'off' : '8h')],
                            ['Wallpaper', () => setOverlay('info')],
                        ].map(([label, act]) => (
                            <button key={label as string} type='button' role='menuitem' onClick={() => { setMenu(''); (act as () => void)(); }} className='block w-full px-5 py-3 text-left text-[0.95em] wa-ink wa-hover'>
                                {label as string}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
        return (
            <WaShell settings={settings} className='flex h-full min-h-0 w-full flex-col overflow-hidden'>
                {menu && <div className='fixed inset-0 z-20' onClick={() => setMenu('')} />}
                {error && (
                    <div role='alert' className='shrink-0 px-3 py-1.5 text-[0.8em]' style={{ background: 'rgba(234,0,56,0.1)', color: 'var(--wa-danger)' }}>
                        {error}
                    </div>
                )}
                {!connection.connected && thread && <div className='shrink-0 px-3 py-1 text-center text-[0.75em] wa-panel2 wa-sub'>Connecting…</div>}
                {roomLoading && !thread ? (
                    <div className='flex flex-1 flex-col'>
                        {header}
                        <div className='flex flex-1 items-center justify-center wa-wall'>
                            <Loader2 className='h-7 w-7 animate-spin wa-green' />
                        </div>
                    </div>
                ) : thread?.room.id === roomId ? (
                    <ChatThread
                        key={roomId}
                        uid={uid}
                        room={thread.room}
                        people={thread.people}
                        messages={thread.messages}
                        hasMore={thread.hasMore}
                        busy={busy}
                        typing={typingNow}
                        readMarks={live.readMarks}
                        deliveryMarks={live.deliveryMarks}
                        loadingOlder={olderLoading}
                        settings={settings}
                        wallpaper={wallpaper || settings.wallpaper}
                        unreadAfter={unreadAfter}
                        canSend={canSend}
                        header={header}
                        searchOpen={roomSearch}
                        onCloseSearch={() => setRoomSearch(false)}
                        onOlder={() => void older()}
                        onSend={send}
                        onUpload={upload}
                        onDelete={removeMessage}
                        onReact={react}
                        onTyping={typingUpdate}
                        onRetry={retry}
                        inlineTool={inlineTool}
                        inlinePanel={
                            inlineTool === 'action' ? (
                                <ChatActionsBoard key={'action-' + inlineNew} uid={uid} roomId={roomId} people={currentPeople} revision={boardRev} initialCreate={inlineNew} directRecipient={active?.kind === 'direct' ? counterpart?.uid || '' : ''} />
                            ) : inlineTool === 'poll' && active?.kind === 'group' ? (
                                <ChatPollsBoard key={'poll-' + inlineNew} uid={uid} roomId={roomId} people={currentPeople} revision={boardRev} initialCreate={inlineNew} />
                            ) : undefined
                        }
                        onOpenTool={(tool, create = false) => {
                            setInlineTool(tool);
                            setInlineNew(create);
                        }}
                        onCloseTool={() => setInlineTool('')}
                    />
                ) : (
                    <div className='flex flex-1 flex-col'>
                        {header}
                        <div className='flex flex-1 items-center justify-center p-5 text-center text-[0.9em] wa-sub'>{error || 'Conversation not available.'}</div>
                    </div>
                )}
            </WaShell>
        );
    }

    // ---- Chat list -----------------------------------------------------------
    return (
        <WaShell settings={settings} className='relative flex h-full min-h-0 w-full flex-col overflow-hidden'>
            {menu && <div className='fixed inset-0 z-20' onClick={() => setMenu('')} />}
            <header className='relative shrink-0 px-2 pt-[env(safe-area-inset-top)] wa-bar'>
                <div className='flex min-h-14 items-center gap-1'>
                    {searching ? (
                        <>
                            <button type='button' aria-label='Close search' onClick={() => { setSearching(false); setSearch(''); }} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                                <ArrowLeft className='h-6 w-6' />
                            </button>
                            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search…' aria-label='Search chats' className='min-w-0 flex-1 bg-transparent px-2 py-2 text-[1.05em] outline-none' />
                        </>
                    ) : (
                        <>
                            <button type='button' aria-label='Back to Quick links' onClick={() => leaveQuick('organization_home/quick')} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                                <ArrowLeft className='h-6 w-6' />
                            </button>
                            <h1 className='flex-1 text-[1.45em] font-semibold wa-green'>Chats</h1>
                            <button type='button' aria-label='Search chats' onClick={() => setSearching(true)} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                                <Search className='h-5 w-5' />
                            </button>
                            <button type='button' aria-label='More options' onClick={() => setMenu((m) => (m === 'inbox' ? '' : 'inbox'))} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                                <MoreVertical className='h-5 w-5' />
                            </button>
                        </>
                    )}
                </div>
                {menu === 'inbox' && (
                    <div className='wa-pop absolute right-2 top-[calc(100%-10px)] z-30 w-60 overflow-hidden rounded-xl py-1.5 shadow-2xl wa-panel' role='menu'>
                        {[
                            ['New group', () => setOverlay('new')],
                            ['My chat assignments', () => setOverlay('assignments')],
                            [settings.muteAll ? 'Unmute all chats' : 'Mute all chats', () => void saveSettings({ muteAll: !settings.muteAll }).catch((e) => setError(errorText(e)))],
                            ['Settings', () => setOverlay('settings')],
                        ].map(([label, act]) => (
                            <button key={label as string} type='button' role='menuitem' onClick={() => { setMenu(''); (act as () => void)(); }} className='block w-full px-5 py-3 text-left text-[0.95em] wa-ink wa-hover'>
                                {label as string}
                            </button>
                        ))}
                    </div>
                )}
            </header>
            <div className='shrink-0 px-3 pb-2 pt-1 wa-bar'>
                {!searching && (
                    <button type='button' onClick={() => setSearching(true)} className='flex h-11 w-full items-center gap-3 rounded-full px-4 text-left wa-panel2'>
                        <Search className='h-5 w-5 wa-sub' />
                        <span className='wa-sub'>Ask or search</span>
                    </button>
                )}
                <div className='mt-2 flex gap-2 overflow-x-auto wa-noscroll'>
                    {(
                        [
                            ['all', 'All'],
                            ['unread', unreadChats ? `Unread ${unreadChats}` : 'Unread'],
                            ['groups', 'Groups'],
                        ] as Array<[Filter, string]>
                    ).map(([k, label]) => (
                        <button key={k} type='button' onClick={() => setFilter(k)} aria-pressed={filter === k} className='h-8 shrink-0 rounded-full px-3.5 text-[0.88em]' style={filter === k ? { background: 'rgba(0,168,132,0.18)', color: 'var(--wa-accent-text)' } : { background: 'var(--wa-panel2)', color: 'var(--wa-sub)' }}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
            {!connection.connected && !loading && <div className='shrink-0 px-3 py-1 text-center text-[0.75em] wa-panel2 wa-sub'>Connecting…</div>}
            {settings.muteAll && <div className='flex shrink-0 items-center justify-center gap-1.5 px-3 py-1 text-[0.78em] wa-panel2 wa-sub'><BellOff className='h-3.5 w-3.5' /> All chats are muted</div>}
            {error && <p role='alert' className='shrink-0 px-4 py-2 text-[0.8em]' style={{ background: 'rgba(234,0,56,0.1)', color: 'var(--wa-danger)' }}>{error}</p>}
            {notice && <p className='shrink-0 px-4 py-2 text-[0.8em] wa-green' style={{ background: 'rgba(0,168,132,0.1)' }}>{notice}</p>}
            <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain wa-panel wa-scroll'>
                {invites.length > 0 && (
                    <div className='border-b wa-line'>
                        {invites.map((inv) => (
                            <div key={inv.id} className='flex items-center gap-3 px-4 py-3'>
                                <WaAvatar group size={49} />
                                <span className='min-w-0 flex-1'>
                                    <span className='block truncate font-medium wa-ink'>{inv.title}</span>
                                    <span className='block text-[0.82em] wa-sub'>Group invitation · {inv.count} members</span>
                                </span>
                                <button type='button' disabled={busy} onClick={() => void respondInvite(inv.id, 'decline')} className='h-9 rounded-full px-3 text-[0.85em] wa-sub'>
                                    Decline
                                </button>
                                <button type='button' disabled={busy} onClick={() => void respondInvite(inv.id, 'accept')} className='h-9 rounded-full px-3.5 text-[0.85em] font-medium wa-btn'>
                                    Join
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {loading ? (
                    <div className='flex justify-center p-8'>
                        <Loader2 className='h-6 w-6 animate-spin wa-green' />
                    </div>
                ) : shownRooms.length === 0 ? (
                    <div className='mx-auto max-w-xs space-y-2 p-10 text-center'>
                        <MessageSquarePlus className='mx-auto h-10 w-10 wa-green' />
                        <h3 className='font-medium wa-ink'>{filter === 'all' && !term ? 'No chats yet' : 'No chats found'}</h3>
                        <p className='text-[0.85em] wa-sub'>{filter === 'all' && !term ? 'Start a conversation with a colleague or one of your teams.' : 'Try another filter or search.'}</p>
                    </div>
                ) : (
                    shownRooms.map((r) => {
                        const person = contactFor(r, people, uid);
                        const mineLast = r.lastSenderUid === uid;
                        const sender = r.kind === 'group' && r.lastSenderUid && !mineLast ? people.find((p) => p.uid === r.lastSenderUid)?.name.split(' ')[0] : '';
                        const preview = settings.showPreviews ? r.lastMessage || (r.kind === 'group' ? r.members.length + ' participants' : 'Tap to chat') : r.lastMessage ? 'New message' : 'Tap to chat';
                        let press: ReturnType<typeof setTimeout> | null = null;
                        return (
                            <div key={r.id} className='relative'>
                                <button
                                    type='button'
                                    onClick={() => openRoom(r.id)}
                                    onContextMenu={(e) => { e.preventDefault(); setRowMenu(r); }}
                                    onPointerDown={() => { press = setTimeout(() => setRowMenu(r), 480); }}
                                    onPointerUp={() => press && clearTimeout(press)}
                                    onPointerLeave={() => press && clearTimeout(press)}
                                    className='flex w-full items-center gap-3 px-4 py-2.5 text-left wa-hover'
                                >
                                    {r.kind === 'group' ? <WaAvatar group size={50} /> : <WaAvatar person={person} size={50} />}
                                    <span className='min-w-0 flex-1 border-b py-1 wa-line'>
                                        <span className='flex items-baseline gap-2'>
                                            <span className='min-w-0 flex-1 truncate text-[1.03em] font-medium wa-ink'>{titleFor(r, people, uid)}</span>
                                            <span className={`shrink-0 text-[0.75em] ${r.unread && !r.muted ? 'font-medium wa-green' : 'wa-sub'}`}>{inboxTime(r.lastMessageAt || r.updatedAt)}</span>
                                        </span>
                                        <span className='mt-0.5 flex items-center gap-1.5'>
                                            {mineLast && r.lastMessage && r.lastMessage !== 'Message deleted' && <Ticks state={r.lastStatus || 'sent'} />}
                                            <span className='min-w-0 flex-1 truncate text-[0.9em] wa-sub'>
                                                {sender && <span>{sender}: </span>}
                                                {r.lastMessageKind === 'image' && settings.showPreviews ? '📷 Photo' : preview}
                                            </span>
                                            {r.pinned && <Pin className='h-4 w-4 shrink-0 rotate-45 wa-sub' aria-label='Pinned' />}
                                            {r.muted && <BellOff className='h-4 w-4 shrink-0 wa-sub' aria-label='Muted' />}
                                            {r.unread && (
                                                <span className='flex h-[21px] min-w-[21px] shrink-0 items-center justify-center rounded-full px-1.5 text-[0.72em] font-semibold' style={{ background: r.muted ? 'var(--wa-sub)' : 'var(--wa-badge)', color: 'var(--wa-accent-ink)' }} aria-label={`${r.unreadCount || 1} unread`}>
                                                    {r.unreadCount && r.unreadCount > 0 ? (r.unreadCount > 98 ? '99+' : r.unreadCount) : ''}
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                </button>
                            </div>
                        );
                    })
                )}
                <p className='flex items-center justify-center gap-1.5 px-6 py-6 text-center text-[0.75em] wa-sub'>
                    🔒 Workplace chat · conversations are organization records
                </p>
            </div>
            <button type='button' aria-label='New chat' onClick={() => setOverlay('new')} className='absolute bottom-[max(20px,env(safe-area-inset-bottom))] right-4 z-10 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg wa-btn'>
                <MessageSquarePlus className='h-6 w-6' />
            </button>
            {rowMenu && (
                <WaSheet title={titleFor(rowMenu, people, uid)} onClose={() => setRowMenu(null)}>
                    <div className='pb-3'>
                        {[
                            { label: rowMenu.pinned ? 'Unpin chat' : 'Pin chat', icon: <Pin className='h-5 w-5' />, act: () => void roomPref(rowMenu, 'pin', !rowMenu.pinned) },
                            { label: rowMenu.muted ? 'Unmute notifications' : 'Mute for 8 hours', icon: <BellOff className='h-5 w-5' />, act: () => void roomPref(rowMenu, 'mute', rowMenu.muted ? 'off' : '8h') },
                            ...(rowMenu.muted ? [] : [{ label: 'Mute for 1 week', icon: <BellOff className='h-5 w-5' />, act: () => void roomPref(rowMenu, 'mute', '1w') }, { label: 'Mute always', icon: <BellOff className='h-5 w-5' />, act: () => void roomPref(rowMenu, 'mute', 'always') }]),
                            { label: 'Open chat', icon: <Check className='h-5 w-5' />, act: () => openRoom(rowMenu.id) },
                            { label: 'Hide chat (for me)', icon: <X className='h-5 w-5' />, act: () => void hideRoom(rowMenu) },
                        ].map((x) => (
                            <button key={x.label} type='button' onClick={() => { setRowMenu(null); x.act(); }} className='flex min-h-[52px] w-full items-center gap-4 px-5 text-left wa-ink wa-hover'>
                                <span className='wa-sub'>{x.icon}</span>
                                {x.label}
                            </button>
                        ))}
                    </div>
                </WaSheet>
            )}
        </WaShell>
    );
}

