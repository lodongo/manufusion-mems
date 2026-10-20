import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';

type PointerInfo = { pointerType: string; button: number; clientX: number; clientY: number };
import { ArrowDown, BarChart3, Camera, ChevronDown, ChevronUp, ClipboardList, Copy, CornerUpLeft, Download, FileText, Image as ImageIcon, Info, Loader2, Paperclip, Plus, Search, Send, Smile, Trash2, X } from 'lucide-react';
import type { ChatAttachment, ChatMessage, ChatPerson, ChatRoom, ChatSettingsValue } from './chatTypes';
import { EMOJI_PICKER, MEMBER_PALETTE, REACTIONS } from './chatTypes';
import { useQuickLeave } from './quickNavigation';
import { appConfirm } from '../components/dialogs';
import { Ticks, WaAvatar, WaSheet, chatIsDark, clock, dayChip, fileSize, isEmojiOnly, tickState, wallStyle, type TickState } from './chatUi';

// ---------------------------------------------------------------------------
// Conversation view, presented like WhatsApp: tailed bubbles, time and ticks inside the bubble,
// photo layouts and albums, reactions overlaid on the bubble, swipe or long-press actions.
// ---------------------------------------------------------------------------

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const DELETE_WINDOW = 180_000;
const ALBUM_MIN = 4;

export function ChatAvatar({ person, size = 34 }: { person?: ChatPerson; color?: string; size?: number }) {
    return <WaAvatar person={person} size={size} />;
}

function TextLinks({ body, term }: { body: string; term?: string }) {
    const parts = body.split(/(https?:\/\/[^\s<>]+|#organization_(?:home|admin)\/[A-Za-z0-9_/-]+)/g);
    const mark = (text: string, key: string | number) => {
        if (!term) return <Fragment key={key}>{text}</Fragment>;
        const pieces = text.split(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'));
        return <Fragment key={key}>{pieces.map((p, i) => (p.toLowerCase() === term.toLowerCase() ? <mark key={i} className='rounded bg-[#ffd279] text-[#111b21]'>{p}</mark> : p))}</Fragment>;
    };
    return (
        <span className='whitespace-pre-wrap break-words'>
            {parts.map((part, i) => {
                if (/^https?:\/\//.test(part)) return <a key={i} href={part} target='_blank' rel='noopener noreferrer' className='break-all underline underline-offset-2' style={{ color: 'var(--wa-read)' }} onClick={(e) => e.stopPropagation()}>{part}</a>;
                if (/^#organization_(?:home|admin)\//.test(part)) return <a key={i} href={part} className='break-all underline underline-offset-2' style={{ color: 'var(--wa-read)' }} onClick={(e) => e.stopPropagation()}>{part}</a>;
                return mark(part, i);
            })}
        </span>
    );
}

type Row =
    | { kind: 'day'; key: string; label: string }
    | { kind: 'unread'; key: string; count: number }
    | { kind: 'event'; key: string; message: ChatMessage }
    | { kind: 'message'; key: string; message: ChatMessage; first: boolean; last: boolean }
    | { kind: 'album'; key: string; messages: ChatMessage[]; first: boolean; last: boolean };

const isImageOnly = (m: ChatMessage) => !m.deletedForAll && !m.text && !m.replyTo && m.attachment?.kind === 'image';

/** Build the rendered rows: date chips, the unread divider, single messages and photo albums. */
function buildRows(messages: ChatMessage[], uid: string, unreadAfter: string): Row[] {
    const rows: Row[] = [];
    let unreadPlaced = !unreadAfter;
    const unreadTotal = unreadAfter ? messages.filter((m) => m.senderUid !== uid && m.createdAt > unreadAfter && !m.pending).length : 0;
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const prev = messages[i - 1];
        const day = new Date(m.createdAt).toDateString();
        if (!prev || new Date(prev.createdAt).toDateString() !== day) rows.push({ kind: 'day', key: 'day_' + m.id, label: dayChip(m.createdAt) });
        if (!unreadPlaced && unreadTotal && m.senderUid !== uid && m.createdAt > unreadAfter) {
            rows.push({ kind: 'unread', key: 'unread', count: unreadTotal });
            unreadPlaced = true;
        }
        if (m.eventKind && m.referenceId) {
            rows.push({ kind: 'event', key: m.id, message: m });
            continue;
        }
        const startsRun = !prev || prev.senderUid !== m.senderUid || !!prev.eventKind || new Date(prev.createdAt).toDateString() !== day;
        // Albums: four or more photos in a row from one sender, a couple of minutes apart at most.
        if (isImageOnly(m)) {
            const run = [m];
            for (let j = i + 1; j < messages.length; j++) {
                const n = messages[j];
                if (!isImageOnly(n) || n.senderUid !== m.senderUid || Date.parse(n.createdAt) - Date.parse(run[run.length - 1].createdAt) > 120_000) break;
                run.push(n);
            }
            if (run.length >= ALBUM_MIN) {
                const next = messages[i + run.length];
                rows.push({ kind: 'album', key: 'album_' + m.id, messages: run, first: startsRun, last: !next || next.senderUid !== m.senderUid });
                i += run.length - 1;
                continue;
            }
        }
        const next = messages[i + 1];
        rows.push({ kind: 'message', key: m.id, message: m, first: startsRun, last: !next || next.senderUid !== m.senderUid || !!next.eventKind });
    }
    return rows;
}

interface Props {
    uid: string;
    room: ChatRoom;
    people: ChatPerson[];
    messages: ChatMessage[];
    hasMore: boolean;
    busy: boolean;
    typing: string[];
    readMarks: Array<{ uid: string; readAt: string }>;
    deliveryMarks: Array<{ uid: string; at: string }>;
    loadingOlder: boolean;
    settings: ChatSettingsValue;
    wallpaper: string;
    /** My read mark when the conversation was opened: places the "unread messages" divider. */
    unreadAfter: string;
    canSend: boolean;
    header: ReactNode;
    searchOpen: boolean;
    onCloseSearch: () => void;
    onOlder: () => void;
    onSend: (body: string, attachment: ChatAttachment | null, replyId: string) => Promise<boolean>;
    onUpload: (file: File) => Promise<ChatAttachment | null>;
    onDelete: (id: string) => Promise<void>;
    onReact: (id: string, emoji: string) => Promise<void>;
    onTyping: (active: boolean) => void;
    onRetry: (message: ChatMessage) => void;
    inlineTool?: 'action' | 'poll' | '';
    inlinePanel?: ReactNode;
    onOpenTool?: (tool: 'action' | 'poll', create?: boolean) => void;
    onCloseTool?: () => void;
}

export default function ChatThread(props: Props) {
    const { uid, room, people, messages, hasMore, busy, typing, readMarks, deliveryMarks, loadingOlder, settings, wallpaper, unreadAfter, canSend, header, searchOpen, onCloseSearch, onOlder, onSend, onUpload, onDelete, onReact, onTyping, onRetry, inlineTool = '', inlinePanel, onOpenTool, onCloseTool } = props;
    const draftKey = 'mems.chat.composer.' + uid + '.' + room.id;
    const [body, setBody] = useState(() => {
        try {
            return localStorage.getItem(draftKey) || '';
        } catch {
            return '';
        }
    });
    const [reply, setReply] = useState<ChatMessage | null>(null);
    const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
    const [panel, setPanel] = useState<'' | 'emoji' | 'attach'>('');
    const [selected, setSelected] = useState<ChatMessage | null>(null);
    const [moreReactions, setMoreReactions] = useState(false);
    const [reactionInfo, setReactionInfo] = useState<ChatMessage[] | null>(null);
    const [messageInfo, setMessageInfo] = useState<ChatMessage | null>(null);
    const [uploading, setUploading] = useState(false);
    const [viewer, setViewer] = useState<{ list: ChatMessage[]; index: number } | null>(null);
    const [mediaDraft, setMediaDraft] = useState<File[] | null>(null);
    const [error, setError] = useState('');
    const [atBottom, setAtBottom] = useState(true);
    const [missed, setMissed] = useState(0);
    const [query, setQuery] = useState('');
    const [hit, setHit] = useState(0);
    const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
    const [clockNow, setClockNow] = useState(Date.now());
    const lastTypingAt = useRef(0);
    const scrollArea = useRef<HTMLDivElement>(null);
    const bottom = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const docInput = useRef<HTMLInputElement>(null);
    const galleryInput = useRef<HTMLInputElement>(null);
    const cameraInput = useRef<HTMLInputElement>(null);
    const press = useRef<{ id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; swiping: boolean } | null>(null);
    const longPressed = useRef(false);
    const initialised = useRef(false);
    const lastCount = useRef(messages.length);
    const dark = chatIsDark(settings);
    const wall = wallStyle(wallpaper, dark);

    useEffect(() => {
        try {
            localStorage.setItem(draftKey, body);
        } catch {
            /* The draft stays in memory. */
        }
    }, [draftKey, body]);
    useQuickLeave(async () => {
        try {
            localStorage.setItem(draftKey, body);
        } catch {
            /* User can still leave. */
        }
        onTyping(false);
        return !uploading && !busy;
    });
    useEffect(() => {
        const t = setInterval(() => setClockNow(Date.now()), 15_000);
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        const el = input.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 6 * 24 + 16) + 'px';
    }, [body]);

    const personMap = useMemo(() => new Map(people.map((p) => [p.uid, p])), [people]);
    const shades = useMemo(() => new Map(room.members.map((m, i) => [m, MEMBER_PALETTE[i % MEMBER_PALETTE.length]])), [room.members]);
    const others = room.members.filter((m) => m !== uid);
    const rows = useMemo(() => buildRows(messages, uid, unreadAfter), [messages, uid, unreadAfter]);
    const images = useMemo(() => messages.filter((m) => !m.deletedForAll && m.attachment?.kind === 'image'), [messages]);
    const term = searchOpen ? query.trim() : '';
    const hits = useMemo(() => (term.length >= 2 ? messages.filter((m) => !m.deletedForAll && m.text.toLowerCase().includes(term.toLowerCase())).map((m) => m.id) : []), [messages, term]);

    // First render: open at the unread divider, else at the latest message. Later: follow new messages when at the bottom.
    useEffect(() => {
        if (!messages.length) return;
        if (!initialised.current) {
            initialised.current = true;
            const divider = scrollArea.current?.querySelector('[data-unread]');
            if (divider) divider.scrollIntoView({ block: 'center' });
            else bottom.current?.scrollIntoView({ block: 'end' });
            lastCount.current = messages.length;
            return;
        }
        const added = messages.length - lastCount.current;
        lastCount.current = messages.length;
        if (added <= 0) return;
        const mineLast = messages[messages.length - 1]?.senderUid === uid;
        if (atBottom || mineLast) requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
        else setMissed((n) => n + added);
    }, [messages, uid, atBottom]);
    useEffect(() => {
        if (!hits.length) return;
        const id = hits[Math.min(hit, hits.length - 1)];
        scrollArea.current?.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [hit, hits]);

    const onScroll = () => {
        const el = scrollArea.current;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        setAtBottom(near);
        if (near) setMissed(0);
        if (el.scrollTop < 80 && hasMore && !loadingOlder) onOlder();
    };

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
        const text = body;
        const att = attachment;
        const replyId = reply?.id || '';
        // Clear at once (WhatsApp feel); the message shows with a clock until the server confirms it.
        setBody('');
        setAttachment(null);
        setReply(null);
        setPanel('');
        onTyping(false);
        try {
            localStorage.removeItem(draftKey);
        } catch {
            /* In-memory clear completed. */
        }
        const ok = await onSend(text, att, replyId);
        if (!ok && !att) setBody((b) => b || text);
        requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    };
    const attachDocument = async (ev: ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        setPanel('');
        if (!file) return;
        setError('');
        setUploading(true);
        try {
            const result = await onUpload(file);
            if (result) setAttachment(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not attach that file.');
        } finally {
            setUploading(false);
        }
    };
    const pickImages = (ev: ChangeEvent<HTMLInputElement>) => {
        const files = (Array.from(ev.target.files ?? []) as File[]).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)).slice(0, 30);
        ev.target.value = '';
        setPanel('');
        if (files.length) setMediaDraft(files);
        else if (ev.target.files?.length) setError('Choose JPG, PNG or WebP photos.');
    };
    const sendMedia = async (items: Array<{ file: File; caption: string }>) => {
        setUploading(true);
        setError('');
        const replyId = reply?.id || '';
        setReply(null);
        try {
            for (let i = 0; i < items.length; i++) {
                const att = await onUpload(items[i].file);
                if (att) await onSend(items[i].caption, att, i === 0 ? replyId : '');
            }
            setMediaDraft(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send the photos.');
        } finally {
            setUploading(false);
        }
    };

    // Long press selects a message; a swipe to the right replies to it.
    const down = (m: ChatMessage, e: PointerInfo) => {
        if (m.deletedForAll || m.pending) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const timer = setTimeout(() => {
            if (press.current && !press.current.swiping) {
                longPressed.current = true;
                setSelected(m);
                setMoreReactions(false);
                try {
                    navigator.vibrate?.(15);
                } catch {
                    /* Vibration is optional. */
                }
            }
        }, 430);
        press.current = { id: m.id, x: e.clientX, y: e.clientY, timer, swiping: false };
    };
    const move = (e: PointerInfo) => {
        const p = press.current;
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            if (p.timer) clearTimeout(p.timer);
            p.timer = null;
        }
        if (!p.swiping && dx > 14 && Math.abs(dy) < 12) p.swiping = true;
        if (p.swiping) setSwipe({ id: p.id, dx: Math.max(0, Math.min(80, dx)) });
    };
    const up = (m: ChatMessage) => {
        const p = press.current;
        if (p?.timer) clearTimeout(p.timer);
        if (p?.swiping && swipe && swipe.dx > 56 && canSend) {
            setReply(m);
            input.current?.focus();
        }
        press.current = null;
        setSwipe(null);
    };
    const tap = (m: ChatMessage) => {
        // The click that ends a long press must not undo the selection it just made.
        if (longPressed.current) {
            longPressed.current = false;
            return;
        }
        if (selected) setSelected(selected.id === m.id ? null : m);
    };
    const eligibleDelete = (m: ChatMessage) => m.senderUid === uid && !m.deletedForAll && !m.pending && clockNow - Date.parse(m.createdAt) < DELETE_WINDOW && !m.eventKind;
    const stateOf = (m: ChatMessage): TickState => (m.failed ? 'failed' : m.pending ? 'pending' : tickState(m.createdAt, others, readMarks, deliveryMarks));
    const typeNames = typing.filter((p) => p !== uid).map((p) => personMap.get(p)?.name?.split(' ')[0] || 'Someone');

    const react = (emoji: string) => {
        if (!selected) return;
        void onReact(selected.id, emoji);
        setSelected(null);
        setMoreReactions(false);
    };

    const reactionPill = (list: ChatMessage[], mine: boolean) => {
        const all = new Map<string, number>();
        for (const m of list) for (const [e, u] of Object.entries(m.reactions || {})) if (Array.isArray(u) && u.length) all.set(e, (all.get(e) ?? 0) + u.length);
        if (!all.size) return null;
        const total = [...all.values()].reduce((a, b) => a + b, 0);
        return (
            <button
                type='button'
                aria-label={`Reactions: ${[...all.keys()].join(' ')}`}
                onClick={(e) => {
                    e.stopPropagation();
                    setReactionInfo(list);
                }}
                className={`wa-pop absolute -bottom-[19px] z-[1] flex h-[24px] items-center gap-0.5 rounded-full border-2 px-1.5 text-[13px] leading-none shadow-sm ${mine ? 'right-2' : 'left-2'}`}
                style={{ background: 'var(--wa-panel)', borderColor: 'var(--wa-chat-bg)' }}
            >
                {[...all.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => (
                    <span key={e}>{e}</span>
                ))}
                {total > 1 && <span className='ml-0.5 text-[11px] wa-sub'>{total}</span>}
            </button>
        );
    };

    const meta = (m: ChatMessage, onImage = false) => (
        <span className={`flex items-center gap-[3px] whitespace-nowrap text-[11px] leading-none ${onImage ? 'text-[#fff]' : 'wa-sub'}`}>
            {m.failed ? (
                <button type='button' onClick={(e) => (e.stopPropagation(), onRetry(m))} className='font-semibold' style={{ color: 'var(--wa-danger)' }}>
                    Not sent · Retry
                </button>
            ) : (
                <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>
                    {clock(m.createdAt)}
                </time>
            )}
            {m.senderUid === uid && !m.deletedForAll && <Ticks state={stateOf(m)} onImage={onImage} />}
        </span>
    );

    const quote = (m: ChatMessage, mine: boolean) => {
        if (!m.replyTo) return null;
        const who = m.replyTo.senderUid === uid ? 'You' : personMap.get(m.replyTo.senderUid)?.name || 'Colleague';
        const color = m.replyTo.senderUid === uid ? 'var(--wa-accent-text)' : shades.get(m.replyTo.senderUid) || '#06cf9c';
        return (
            <button
                type='button'
                onClick={(e) => {
                    e.stopPropagation();
                    scrollArea.current?.querySelector(`[data-mid="${m.replyTo?.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
                className='mb-1 flex w-full min-w-0 items-stretch overflow-hidden rounded-[6px] text-left'
                style={{ background: mine ? 'var(--wa-quote-out)' : 'var(--wa-quote-in)' }}
            >
                <span className='w-1 shrink-0' style={{ background: color }} />
                <span className='min-w-0 flex-1 px-2 py-1'>
                    <span className='block truncate text-[0.82em] font-medium' style={{ color }}>
                        {who}
                    </span>
                    <span className='block truncate text-[0.82em] wa-sub'>{m.replyTo.imageUrl ? '📷 Photo' : m.replyTo.text || (m.replyTo.attachment ? '📄 ' + m.replyTo.attachment : 'Message')}</span>
                </span>
                {m.replyTo.imageUrl && <img src={m.replyTo.imageUrl} alt='' className='h-12 w-12 shrink-0 object-cover' />}
            </button>
        );
    };

    const bubbleRow = (key: string, mids: ChatMessage[], first: boolean, last: boolean, content: ReactNode, opts: { plain?: boolean } = {}) => {
        const m = mids[0];
        const mine = m.senderUid === uid;
        const isSel = !!selected && mids.some((x) => x.id === selected.id);
        const hasReactions = mids.some((x) => Object.values(x.reactions || {}).some((u) => Array.isArray(u) && u.length));
        const dx = swipe && mids.some((x) => x.id === swipe.id) ? swipe.dx : 0;
        const sender = personMap.get(m.senderUid);
        return (
            <div
                key={key}
                data-mid={m.id}
                className={`relative flex px-[4%] sm:px-[7%] ${mine ? 'justify-end' : 'justify-start'} ${first ? 'mt-2' : 'mt-[2px]'} ${hasReactions ? 'mb-[20px]' : ''} ${isSel ? 'wa-selected' : ''}`}
                style={{ touchAction: 'pan-y' }}
                onPointerDown={(e) => down(mids[mids.length - 1], e)}
                onPointerMove={move}
                onPointerUp={() => up(mids[mids.length - 1])}
                onPointerCancel={() => up(mids[mids.length - 1])}
                onPointerLeave={() => {
                    if (press.current?.timer) clearTimeout(press.current.timer);
                    if (!press.current?.swiping) press.current = null;
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (!m.deletedForAll && !m.pending) setSelected(mids[mids.length - 1]);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    tap(mids[mids.length - 1]);
                }}
            >
                {dx > 0 && (
                    <span className='absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full wa-panel' style={{ opacity: dx / 60 }}>
                        <CornerUpLeft className='h-4 w-4 wa-sub' />
                    </span>
                )}
                {room.kind === 'group' && !mine && (
                    <span className='mr-1 mt-[2px] w-7 shrink-0'>{first && <WaAvatar person={sender} size={28} />}</span>
                )}
                <div
                    className={`${opts.plain ? 'relative' : `wa-bubble ${mine ? 'wa-out' : 'wa-in'} ${first ? (mine ? 'wa-tail-out' : 'wa-tail-in') : ''}`} max-w-[min(85%,560px)] transition-transform`}
                    style={{ transform: dx ? `translateX(${dx}px)` : undefined, marginBottom: last ? 4 : 0 }}
                    role='group'
                    tabIndex={0}
                    aria-label={`${mine ? 'You' : sender?.name || 'Colleague'} at ${clock(m.createdAt)}`}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !m.deletedForAll) setSelected(mids[mids.length - 1]);
                    }}
                >
                    {room.kind === 'group' && !mine && first && !opts.plain && (
                        <p className='truncate px-[9px] pt-[5px] text-[0.84em] font-medium' style={{ color: shades.get(m.senderUid) }}>
                            {sender?.name || 'Colleague'}
                        </p>
                    )}
                    {content}
                    {isSel && !m.deletedForAll && (
                        <div className={`wa-pop absolute -top-[54px] z-10 flex items-center gap-1 rounded-full px-2 py-1.5 shadow-lg wa-panel ${mine ? 'right-0' : 'left-0'}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                            {QUICK_REACTIONS.map((e) => {
                                const on = (selected?.reactions?.[e] ?? []).includes(uid);
                                return (
                                    <button key={e} type='button' aria-label={'React ' + e} onClick={() => react(e)} className={`flex h-10 w-10 items-center justify-center rounded-full text-[24px] ${on ? 'wa-panel2' : ''}`}>
                                        {e}
                                    </button>
                                );
                            })}
                            <button type='button' aria-label='More reactions' onClick={() => setMoreReactions(true)} className='flex h-9 w-9 items-center justify-center rounded-full wa-panel2'>
                                <Plus className='h-5 w-5 wa-sub' />
                            </button>
                        </div>
                    )}
                    {reactionPill(mids, mine)}
                </div>
            </div>
        );
    };

    const renderMessage = (m: ChatMessage, first: boolean, last: boolean) => {
        const mine = m.senderUid === uid;
        if (m.deletedForAll) {
            return bubbleRow(m.id, [m], first, last, (
                <p className='flex items-center gap-1.5 px-[9px] py-[6px] italic wa-sub'>
                    <span aria-hidden='true'>⊘</span> {mine ? 'You deleted this message' : 'This message was deleted'}
                    <span className='ml-2 not-italic'>
                        {meta(m)}
                    </span>
                </p>
            ));
        }
        if (m.text && !m.attachment && !m.replyTo && isEmojiOnly(m.text)) {
            return bubbleRow(m.id, [m], first, last, (
                <div className='px-1'>
                    <p className='text-[2.6em] leading-tight'>{m.text}</p>
                    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <span className='rounded-full px-1.5 py-0.5 wa-chip'>
                            {meta(m)}
                        </span>
                    </div>
                </div>
            ), { plain: true });
        }
        const att = m.attachment;
        if (att?.kind === 'image') {
            return bubbleRow(m.id, [m], first, last, (
                <div className='p-[3px]'>
                    {quote(m, mine)}
                    <button type='button' onClick={(e) => { if (selected) return; e.stopPropagation(); setViewer({ list: images, index: Math.max(0, images.findIndex((x) => x.id === m.id)) }); }} className='relative block overflow-hidden rounded-[6px]'>
                        <img src={att.url} alt={att.name} loading='lazy' className='block max-h-[340px] min-h-[120px] w-[min(300px,68vw)] object-cover' />
                        {!m.text && (
                            <span className='absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-[rgba(0,0,0,0.5)] to-transparent px-2 pb-1 pt-6'>
                                {meta(m, true)}
                            </span>
                        )}
                    </button>
                    {m.text && (
                        <p className='relative px-[6px] pb-[5px] pt-[5px] text-[1em] leading-[1.35] wa-ink'>
                            <TextLinks body={m.text} term={term} />
                            <span className={`inline-block ${mine ? 'w-[74px]' : 'w-[52px]'}`} aria-hidden='true' />
                            <span className='absolute bottom-[3px] right-[6px]'>{meta(m)}</span>
                        </p>
                    )}
                </div>
            ));
        }
        return bubbleRow(m.id, [m], first, last, (
            <div className='px-[9px] pb-[6px] pt-[6px]'>
                {quote(m, mine)}
                {att && (
                    <a href={att.url} target='_blank' rel='noopener noreferrer' onClick={(e) => { if (selected) e.preventDefault(); e.stopPropagation(); }} className='mb-1 flex min-w-[220px] max-w-[300px] items-center gap-2.5 rounded-[6px] p-2' style={{ background: mine ? 'var(--wa-quote-out)' : 'var(--wa-quote-in)' }}>
                        <span className='flex h-10 w-8 shrink-0 items-end justify-center rounded-[3px] pb-0.5 text-[9px] font-bold uppercase text-[#fff]' style={{ background: /pdf/.test(att.mime) ? '#e53935' : /sheet|csv/.test(att.mime) ? '#1e8e3e' : /presentation/.test(att.mime) ? '#e8710a' : '#1a73e8' }}>
                            {(att.name.split('.').pop() || 'file').slice(0, 4)}
                        </span>
                        <span className='min-w-0 flex-1'>
                            <span className='block truncate text-[0.92em] wa-ink'>{att.name}</span>
                            <span className='block text-[0.75em] wa-sub'>
                                {fileSize(att.size)} · {(att.name.split('.').pop() || '').toUpperCase()}
                            </span>
                        </span>
                        <Download className='h-5 w-5 shrink-0 wa-sub' />
                    </a>
                )}
                {m.text ? (
                    <p className='relative text-[1em] leading-[1.35] wa-ink'>
                        <TextLinks body={m.text} term={term} />
                        <span className={`inline-block ${mine ? 'w-[74px]' : 'w-[52px]'}`} aria-hidden='true' />
                        <span className='absolute -bottom-[3px] right-0'>{meta(m)}</span>
                    </p>
                ) : (
                    <div className='flex justify-end'>
                        {meta(m)}
                    </div>
                )}
            </div>
        ));
    };

    const renderAlbum = (row: Extract<Row, { kind: 'album' }>) => {
        const list = row.messages;
        const last = list[list.length - 1];
        const open = (i: number) => setViewer({ list: images, index: Math.max(0, images.findIndex((x) => x.id === list[i].id)) });
        return bubbleRow(row.key, list, row.first, row.last, (
            <div className='grid w-[min(300px,68vw)] grid-cols-2 gap-[3px] p-[3px]'>
                {list.slice(0, 4).map((m, i) => (
                    <button key={m.id} type='button' onClick={(e) => { if (selected) return; e.stopPropagation(); open(i); }} className='relative aspect-square overflow-hidden rounded-[5px]'>
                        <img src={m.attachment!.url} alt={m.attachment!.name} loading='lazy' className='h-full w-full object-cover' />
                        {i === 3 && list.length > 4 && <span className='absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.45)] text-[26px] font-light text-[#fff]'>+{list.length - 4}</span>}
                        {i === Math.min(3, list.length - 1) && (
                            <span className='absolute inset-x-0 bottom-0 flex justify-end bg-gradient-to-t from-[rgba(0,0,0,0.5)] to-transparent px-1.5 pb-1 pt-5'>
                                {meta(last, true)}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        ));
    };

    const selectedMine = selected?.senderUid === uid;
    // The history is re-rendered only when something it shows changes (not on every keystroke in the composer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const renderedRows = useMemo(() => rows.map((row) => {
                    if (row.kind === 'day')
                        return (
                            <div key={row.key} className='my-2 flex justify-center'>
                                <span className='rounded-[7px] px-3 py-1 text-[0.78em] uppercase tracking-wide wa-chip'>{row.label}</span>
                            </div>
                        );
                    if (row.kind === 'unread')
                        return (
                            <div key={row.key} data-unread className='my-2 py-1 text-center text-[0.8em] font-medium uppercase tracking-wide' style={{ background: 'rgba(134,150,160,0.16)', color: 'var(--wa-sub)' }}>
                                <span className='rounded-full px-3 py-1 wa-chip'>
                                    {row.count} unread message{row.count === 1 ? '' : 's'}
                                </span>
                            </div>
                        );
                    if (row.kind === 'event') {
                        const m = row.message;
                        const isAction = m.eventKind === 'action';
                        return (
                            <div key={row.key} data-mid={m.id} className='my-2 flex justify-center px-4'>
                                <button type='button' onClick={() => onOpenTool?.(isAction ? 'action' : 'poll', false)} className='flex max-w-[90%] items-center gap-2 rounded-[7px] px-3 py-2 text-left text-[0.85em] wa-chip'>
                                    {isAction ? <ClipboardList className='h-4 w-4 shrink-0 wa-green' /> : <BarChart3 className='h-4 w-4 shrink-0 wa-green' />}
                                    <span className='wa-ink'>
                                        <b>{m.senderUid === uid ? 'You' : personMap.get(m.senderUid)?.name || 'Colleague'}</b> {isAction ? 'assigned a monitored action' : 'created a poll'} · <span className='wa-green'>View</span>
                                    </span>
                                    <span className='text-[0.8em] wa-sub'>{clock(m.createdAt)}</span>
                                </button>
                            </div>
                        );
                    }
                    if (row.kind === 'album') return renderAlbum(row);
                    return renderMessage(row.message, row.first, row.last);
                }), [rows, selected, swipe, term, readMarks, deliveryMarks, clockNow, personMap, shades, images, canSend, dark]);
    return (
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
            {selected ? (
                <div className='flex min-h-14 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] wa-bar'>
                    <button type='button' aria-label='Clear selection' onClick={() => setSelected(null)} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                        <X className='h-6 w-6' />
                    </button>
                    <span className='flex-1 text-[1.1em] font-medium'>1</span>
                    {canSend && (
                        <button type='button' aria-label='Reply' onClick={() => { setReply(selected); setSelected(null); input.current?.focus(); }} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                            <CornerUpLeft className='h-5 w-5' />
                        </button>
                    )}
                    {selected.text && (
                        <button type='button' aria-label='Copy' onClick={() => { void navigator.clipboard?.writeText(selected.text).catch(() => undefined); setSelected(null); }} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                            <Copy className='h-5 w-5' />
                        </button>
                    )}
                    {selectedMine && (
                        <button type='button' aria-label='Message info' onClick={() => { setMessageInfo(selected); setSelected(null); }} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                            <Info className='h-5 w-5' />
                        </button>
                    )}
                    {eligibleDelete(selected) && (
                        <button
                            type='button'
                            aria-label='Delete for everyone'
                            onClick={async () => {
                                const target = selected;
                                setSelected(null);
                                if (await appConfirm('Delete this message for everyone? Deleting is possible for three minutes after sending and is recorded in the audit trail.')) void onDelete(target.id);
                            }}
                            className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'
                        >
                            <Trash2 className='h-5 w-5' />
                        </button>
                    )}
                </div>
            ) : searchOpen ? (
                <div className='flex min-h-14 shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] wa-bar'>
                    <button type='button' aria-label='Close search' onClick={() => { setQuery(''); onCloseSearch(); }} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                        <X className='h-5 w-5' />
                    </button>
                    <Search className='h-4 w-4 wa-sub' />
                    <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setHit(0); }} placeholder='Search…' aria-label='Search this conversation' className='min-w-0 flex-1 bg-transparent px-2 py-2 text-[1em] outline-none' />
                    <span className='text-[0.8em] wa-sub'>{term.length >= 2 ? `${hits.length ? Math.min(hit, hits.length - 1) + 1 : 0}/${hits.length}` : ''}</span>
                    <button type='button' aria-label='Previous match' disabled={!hits.length} onClick={() => setHit((h) => (h + 1) % Math.max(1, hits.length))} className='flex h-10 w-10 items-center justify-center rounded-full wa-hover disabled:opacity-40'>
                        <ChevronUp className='h-5 w-5' />
                    </button>
                    <button type='button' aria-label='Next match' disabled={!hits.length} onClick={() => setHit((h) => (h - 1 + hits.length) % Math.max(1, hits.length))} className='flex h-10 w-10 items-center justify-center rounded-full wa-hover disabled:opacity-40'>
                        <ChevronDown className='h-5 w-5' />
                    </button>
                </div>
            ) : (
                header
            )}

            <div
                ref={scrollArea}
                onScroll={onScroll}
                onClick={() => selected && setSelected(null)}
                className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pt-3 wa-scroll ${wall.className}`}
                style={wall.style}
                role='log'
                aria-label='Conversation history'
                aria-live='polite'
            >
                {loadingOlder && (
                    <div className='flex justify-center py-2'>
                        <Loader2 className='h-5 w-5 animate-spin wa-sub' />
                    </div>
                )}
                {!hasMore && (
                    <div className='mx-auto mb-3 max-w-[85%] rounded-[7px] px-3 py-1.5 text-center text-[0.78em] leading-snug' style={{ background: 'var(--wa-system)', color: dark ? '#ffd279' : '#54656f' }}>
                        🔒 Workplace chat: messages and files are organization records, retained and auditable under your organization&apos;s policy.
                    </div>
                )}
                {renderedRows}
                {typeNames.length > 0 && (
                    <div className='mt-2 flex justify-start px-[4%] sm:px-[7%]'>
                        <div className='wa-bubble wa-in wa-tail-in flex items-center gap-2 px-3 py-2.5'>
                            {room.kind === 'group' && <span className='text-[0.8em] wa-sub'>{typeNames.slice(0, 2).join(', ')}</span>}
                            <span className='wa-typing' aria-label='Typing'>
                                <span />
                                <span />
                                <span />
                            </span>
                        </div>
                    </div>
                )}
                <div ref={bottom} className='h-1' />
            </div>

            {!atBottom && (
                <button type='button' aria-label='Scroll to latest message' onClick={() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); setMissed(0); }} className='absolute bottom-[84px] right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-lg wa-panel'>
                    <ArrowDown className='h-5 w-5 wa-sub' />
                    {missed > 0 && <span className='absolute -top-2 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold wa-badge'>{missed}</span>}
                </button>
            )}

            {error && (
                <div role='alert' className='shrink-0 px-3 py-2 text-[0.8em]' style={{ background: 'rgba(234,0,56,0.1)', color: 'var(--wa-danger)' }}>
                    {error}
                </div>
            )}

            {inlinePanel && (
                <div className='flex max-h-[62dvh] min-h-[200px] shrink-0 flex-col overflow-hidden rounded-t-2xl wa-panel' style={{ boxShadow: '0 -6px 18px rgba(0,0,0,0.15)' }}>
                    <div className='flex shrink-0 items-center justify-between gap-2 px-4 py-1'>
                        <span className='text-[0.9em] font-medium wa-ink'>{inlineTool === 'action' ? 'Monitored actions · this chat' : 'Polls · this chat'}</span>
                        <button type='button' onClick={onCloseTool} aria-label='Close panel' className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                            <X className='h-5 w-5 wa-sub' />
                        </button>
                    </div>
                    <div className='flex min-h-0 flex-1 flex-col overflow-hidden bg-page text-ink'>{inlinePanel}</div>
                </div>
            )}

            {panel === 'attach' && (
                <div className='wa-pop absolute bottom-[70px] left-2 right-2 z-20 grid grid-cols-4 gap-y-4 rounded-2xl px-2 py-5 shadow-2xl wa-panel sm:left-auto sm:w-[360px]'>
                    {[
                        { label: 'Document', color: '#7f66ff', icon: <FileText className='h-6 w-6' />, act: () => docInput.current?.click() },
                        { label: 'Camera', color: '#ff2e74', icon: <Camera className='h-6 w-6' />, act: () => cameraInput.current?.click() },
                        { label: 'Gallery', color: '#c861fa', icon: <ImageIcon className='h-6 w-6' />, act: () => galleryInput.current?.click() },
                        { label: 'Assign action', color: '#02a698', icon: <ClipboardList className='h-6 w-6' />, act: () => onOpenTool?.('action', true) },
                        { label: 'Actions', color: '#009de2', icon: <ClipboardList className='h-6 w-6' />, act: () => onOpenTool?.('action', false) },
                        ...(room.kind === 'group'
                            ? [
                                  { label: 'Poll', color: '#ffbc38', icon: <BarChart3 className='h-6 w-6' />, act: () => onOpenTool?.('poll', true) },
                                  { label: 'Poll results', color: '#fc9e2c', icon: <BarChart3 className='h-6 w-6' />, act: () => onOpenTool?.('poll', false) },
                              ]
                            : []),
                    ].map((x) => (
                        <button key={x.label} type='button' onClick={() => { setPanel(''); x.act(); }} className='flex flex-col items-center gap-1.5'>
                            <span className='flex h-[54px] w-[54px] items-center justify-center rounded-full text-[#fff]' style={{ background: x.color }}>
                                {x.icon}
                            </span>
                            <span className='text-[0.75em] wa-sub'>{x.label}</span>
                        </button>
                    ))}
                </div>
            )}
            <input ref={docInput} type='file' className='hidden' accept='application/pdf,.xlsx,.docx,.pptx,.csv,.txt' onChange={(e) => void attachDocument(e)} />
            <input ref={galleryInput} type='file' multiple className='hidden' accept='image/jpeg,image/png,image/webp' onChange={pickImages} />
            <input ref={cameraInput} type='file' className='hidden' accept='image/*' capture='environment' onChange={pickImages} />

            {canSend ? (
                <div className={`shrink-0 px-1.5 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 ${wall.className}`} style={wall.style}>
                    <div className='flex items-end gap-1.5'>
                        <div className='flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] shadow-sm wa-panel'>
                            {reply && (
                                <div className='m-1.5 mb-0 flex items-stretch overflow-hidden rounded-[8px] wa-panel2'>
                                    <span className='w-1 shrink-0' style={{ background: reply.senderUid === uid ? 'var(--wa-accent-text)' : shades.get(reply.senderUid) }} />
                                    <span className='min-w-0 flex-1 px-2 py-1.5'>
                                        <span className='block truncate text-[0.82em] font-medium' style={{ color: reply.senderUid === uid ? 'var(--wa-accent-text)' : shades.get(reply.senderUid) }}>
                                            {reply.senderUid === uid ? 'You' : personMap.get(reply.senderUid)?.name || 'Colleague'}
                                        </span>
                                        <span className='block truncate text-[0.82em] wa-sub'>{reply.attachment?.kind === 'image' ? '📷 Photo' : reply.text || reply.attachment?.name || 'Message'}</span>
                                    </span>
                                    {reply.attachment?.kind === 'image' && <img src={reply.attachment.url} alt='' className='h-12 w-12 object-cover' />}
                                    <button type='button' aria-label='Cancel reply' onClick={() => setReply(null)} className='flex w-9 items-start justify-center pt-1.5'>
                                        <X className='h-4 w-4 wa-sub' />
                                    </button>
                                </div>
                            )}
                            {attachment && (
                                <div className='m-1.5 mb-0 flex items-center gap-2 rounded-[8px] p-2 wa-panel2'>
                                    <FileText className='h-7 w-7 shrink-0 wa-green' />
                                    <span className='min-w-0 flex-1 truncate text-[0.85em] wa-ink'>{attachment.name}</span>
                                    <button type='button' aria-label='Remove attachment' onClick={() => setAttachment(null)} className='flex h-9 w-9 items-center justify-center'>
                                        <X className='h-4 w-4 wa-sub' />
                                    </button>
                                </div>
                            )}
                            <div className='flex items-end'>
                                <button type='button' aria-label='Emoji' onClick={() => setPanel((p) => (p === 'emoji' ? '' : 'emoji'))} className='flex h-12 w-11 shrink-0 items-center justify-center'>
                                    <Smile className='h-6 w-6 wa-sub' />
                                </button>
                                <textarea
                                    ref={input}
                                    rows={1}
                                    maxLength={4000}
                                    value={body}
                                    onChange={(e) => onInput(e.target.value)}
                                    onFocus={() => panel === 'emoji' && setPanel('')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey && (settings.enterToSend || window.innerWidth >= 640)) {
                                            e.preventDefault();
                                            void send();
                                        }
                                    }}
                                    placeholder='Message'
                                    aria-label='Write message'
                                    className='max-h-40 min-h-12 min-w-0 flex-1 resize-none bg-transparent py-3 text-[1em] leading-6 outline-none wa-scroll'
                                />
                                <button type='button' aria-label='Attach' disabled={uploading} onClick={() => setPanel((p) => (p === 'attach' ? '' : 'attach'))} className='flex h-12 w-10 shrink-0 items-center justify-center'>
                                    {uploading ? <Loader2 className='h-5 w-5 animate-spin wa-sub' /> : <Paperclip className='h-[22px] w-[22px] -rotate-45 wa-sub' />}
                                </button>
                                {!body.trim() && !attachment && (
                                    <button type='button' aria-label='Camera' disabled={uploading} onClick={() => cameraInput.current?.click()} className='flex h-12 w-11 shrink-0 items-center justify-center'>
                                        <Camera className='h-[22px] w-[22px] wa-sub' />
                                    </button>
                                )}
                            </div>
                        </div>
                        <button type='button' aria-label='Send message' disabled={uploading || (!body.trim() && !attachment)} onClick={() => void send()} className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow wa-btn disabled:opacity-60'>
                            <Send className='ml-0.5 h-[22px] w-[22px]' />
                        </button>
                    </div>
                    {panel === 'emoji' && (
                        <div className='mt-1.5 grid max-h-[240px] grid-cols-8 gap-1 overflow-y-auto rounded-2xl p-2 wa-panel wa-scroll'>
                            {EMOJI_PICKER.map((e) => (
                                <button key={e} type='button' onClick={() => { setBody((b) => b + e); onTyping(true); }} className='flex h-11 items-center justify-center rounded-lg text-[26px] wa-hover'>
                                    {e}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className='shrink-0 px-4 py-4 text-center text-[0.85em] wa-panel wa-sub pb-[max(16px,env(safe-area-inset-bottom))]'>Only admins can send messages</div>
            )}

            {moreReactions && selected && (
                <WaSheet title='React' onClose={() => setMoreReactions(false)}>
                    <div className='grid grid-cols-6 gap-1 px-3 pb-5'>
                        {REACTIONS.map((e) => (
                            <button key={e} type='button' onClick={() => react(e)} className='flex h-12 items-center justify-center rounded-xl text-[28px] wa-hover'>
                                {e}
                            </button>
                        ))}
                    </div>
                </WaSheet>
            )}
            {reactionInfo && (
                <WaSheet title={`${reactionInfo.reduce((n, m) => n + Object.values(m.reactions || {}).reduce((a, u) => a + (Array.isArray(u) ? u.length : 0), 0), 0)} reactions`} onClose={() => setReactionInfo(null)}>
                    <ul className='pb-4'>
                        {reactionInfo.flatMap((m) =>
                            Object.entries(m.reactions || {}).flatMap(([emoji, list]) =>
                                (Array.isArray(list) ? list : []).map((who) => (
                                    <li key={m.id + emoji + who}>
                                        <button type='button' disabled={who !== uid} onClick={() => { void onReact(m.id, emoji); setReactionInfo(null); }} className='flex min-h-[60px] w-full items-center gap-3 px-5 text-left wa-hover disabled:cursor-default'>
                                            <WaAvatar person={personMap.get(who)} size={40} />
                                            <span className='min-w-0 flex-1'>
                                                <span className='block truncate wa-ink'>{who === uid ? 'You' : personMap.get(who)?.name || 'Colleague'}</span>
                                                {who === uid && <span className='block text-[0.8em] wa-sub'>Tap to remove</span>}
                                            </span>
                                            <span className='text-[24px]'>{emoji}</span>
                                        </button>
                                    </li>
                                )),
                            ),
                        )}
                    </ul>
                </WaSheet>
            )}
            {messageInfo && (
                <WaSheet title='Message info' onClose={() => setMessageInfo(null)}>
                    <div className='px-5 pb-5'>
                        <p className='mb-3 line-clamp-3 rounded-lg p-3 text-[0.9em] wa-panel2 wa-ink'>{messageInfo.text || messageInfo.attachment?.name || 'Message'}</p>
                        {others.map((o) => {
                            const t = Date.parse(messageInfo.createdAt);
                            const r = readMarks.find((x) => x.uid === o && Date.parse(x.readAt) >= t);
                            const d = deliveryMarks.find((x) => x.uid === o && Date.parse(x.at) >= t);
                            return (
                                <div key={o} className='flex min-h-[56px] items-center gap-3 border-b wa-line'>
                                    <WaAvatar person={personMap.get(o)} size={36} />
                                    <span className='min-w-0 flex-1 truncate wa-ink'>{personMap.get(o)?.name || 'Colleague'}</span>
                                    <span className='flex items-center gap-1 text-[0.8em] wa-sub'>
                                        <Ticks state={r ? 'read' : d ? 'delivered' : 'sent'} />
                                        {r ? 'Read' : d ? 'Delivered' : 'Sent'}
                                    </span>
                                </div>
                            );
                        })}
                        <p className='mt-3 text-[0.75em] wa-sub'>Read receipts may be hidden by personal privacy settings in individual chats.</p>
                    </div>
                </WaSheet>
            )}
            {viewer && <MediaViewer list={viewer.list} index={viewer.index} uid={uid} people={personMap} onClose={() => setViewer(null)} onReply={canSend ? (m) => { setReply(m); setViewer(null); } : undefined} />}
            {mediaDraft && <MediaComposer files={mediaDraft} busy={uploading} onCancel={() => setMediaDraft(null)} onSend={(items) => void sendMedia(items)} />}
        </div>
    );
}

/** Full-screen photo viewer with swipe between the conversation's photos. */
function MediaViewer({ list, index, uid, people, onClose, onReply }: { list: ChatMessage[]; index: number; uid: string; people: Map<string, ChatPerson>; onClose: () => void; onReply?: (m: ChatMessage) => void }) {
    const [i, setI] = useState(index);
    const start = useRef<number | null>(null);
    const m = list[i];
    if (!m?.attachment) return null;
    const go = (d: number) => setI((x) => Math.max(0, Math.min(list.length - 1, x + d)));
    return (
        <div className='fixed inset-0 z-[90] flex flex-col bg-[#000] text-[#fff]' role='dialog' aria-modal='true' aria-label='Photo viewer'>
            <div className='flex min-h-14 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)]'>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center'>
                    <X className='h-6 w-6' />
                </button>
                <div className='min-w-0 flex-1'>
                    <p className='truncate font-medium'>{m.senderUid === uid ? 'You' : people.get(m.senderUid)?.name || 'Colleague'}</p>
                    <p className='text-[0.8em] opacity-70'>
                        {dayChip(m.createdAt)}, {clock(m.createdAt)} · {i + 1} of {list.length}
                    </p>
                </div>
                {onReply && (
                    <button type='button' aria-label='Reply' onClick={() => onReply(m)} className='flex h-11 w-11 items-center justify-center'>
                        <CornerUpLeft className='h-5 w-5' />
                    </button>
                )}
                <a href={m.attachment.url} target='_blank' rel='noopener noreferrer' aria-label='Download' className='flex h-11 w-11 items-center justify-center'>
                    <Download className='h-5 w-5' />
                </a>
            </div>
            <div
                className='flex min-h-0 flex-1 items-center justify-center'
                onPointerDown={(e) => (start.current = e.clientX)}
                onPointerUp={(e) => {
                    if (start.current === null) return;
                    const dx = e.clientX - start.current;
                    start.current = null;
                    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
                }}
            >
                <img src={m.attachment.url} alt={m.attachment.name} className='max-h-full max-w-full select-none object-contain' draggable={false} />
            </div>
            {m.text && <p className='shrink-0 px-4 py-3 text-center'>{m.text}</p>}
            <div className='flex shrink-0 justify-center gap-6 pb-[max(12px,env(safe-area-inset-bottom))]'>
                <button type='button' aria-label='Previous photo' disabled={i === 0} onClick={() => go(-1)} className='h-11 px-4 disabled:opacity-30'>
                    ‹ Prev
                </button>
                <button type='button' aria-label='Next photo' disabled={i === list.length - 1} onClick={() => go(1)} className='h-11 px-4 disabled:opacity-30'>
                    Next ›
                </button>
            </div>
        </div>
    );
}

/** Photo send screen: preview each photo, add a caption to each, then send them in order. */
function MediaComposer({ files, busy, onCancel, onSend }: { files: File[]; busy: boolean; onCancel: () => void; onSend: (items: Array<{ file: File; caption: string }>) => void }) {
    const [list, setList] = useState(files);
    const [current, setCurrent] = useState(0);
    const [captions, setCaptions] = useState<string[]>(files.map(() => ''));
    const urls = useMemo(() => list.map((f) => URL.createObjectURL(f)), [list]);
    useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
    const remove = (i: number) => {
        const next = list.filter((_, j) => j !== i);
        if (!next.length) return onCancel();
        setList(next);
        setCaptions((c) => c.filter((_, j) => j !== i));
        setCurrent((c) => Math.min(c, next.length - 1));
    };
    return (
        <div className='fixed inset-0 z-[90] flex flex-col bg-[#0b141a] text-[#e9edef]' role='dialog' aria-modal='true' aria-label='Send photos'>
            <div className='flex min-h-14 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)]'>
                <button type='button' aria-label='Cancel' onClick={onCancel} disabled={busy} className='flex h-11 w-11 items-center justify-center'>
                    <X className='h-6 w-6' />
                </button>
                <span className='flex-1 text-[0.9em] opacity-80'>
                    {list.length} photo{list.length === 1 ? '' : 's'}
                </span>
                <button type='button' aria-label='Remove this photo' onClick={() => remove(current)} disabled={busy} className='flex h-11 w-11 items-center justify-center'>
                    <Trash2 className='h-5 w-5' />
                </button>
            </div>
            <div className='flex min-h-0 flex-1 items-center justify-center p-2'>
                <img src={urls[current]} alt={list[current]?.name} className='max-h-full max-w-full object-contain' />
            </div>
            <div className='shrink-0 space-y-2 px-2 pb-[max(10px,env(safe-area-inset-bottom))]'>
                {list.length > 1 && (
                    <div className='flex gap-1.5 overflow-x-auto wa-noscroll'>
                        {urls.map((u, i) => (
                            <button key={u} type='button' onClick={() => setCurrent(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 ${i === current ? 'border-[#00a884]' : 'border-transparent'}`}>
                                <img src={u} alt='' className='h-full w-full object-cover' />
                            </button>
                        ))}
                    </div>
                )}
                <div className='flex items-end gap-2'>
                    <input
                        value={captions[current] ?? ''}
                        maxLength={1000}
                        onChange={(e) => setCaptions((c) => c.map((x, i) => (i === current ? e.target.value : x)))}
                        placeholder='Add a caption…'
                        aria-label='Caption'
                        className='min-h-12 min-w-0 flex-1 rounded-full bg-[#202c33] px-4 text-[1em] text-[#e9edef] outline-none'
                    />
                    <button type='button' aria-label='Send photos' disabled={busy} onClick={() => onSend(list.map((file, i) => ({ file, caption: captions[i] ?? '' })))} className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-[#111b21]'>
                        {busy ? <Loader2 className='h-5 w-5 animate-spin' /> : <Send className='ml-0.5 h-5 w-5' />}
                    </button>
                </div>
            </div>
        </div>
    );
}
