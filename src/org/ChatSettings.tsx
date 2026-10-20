import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, BellOff, Check, ChevronRight, ClipboardList, Eye, FileText, Image as ImageIcon, Keyboard, Link2, Lock, LogOut, Moon, Palette, Pin, Search, ShieldCheck, Type, UserPlus, Users, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import type { ChatLiveState, ChatMediaItem, ChatPerson, ChatRoom, ChatSettingsValue } from './chatTypes';
import { WALLPAPERS, WaAvatar, WaPage, WaRow, WaSection, WaSheet, chatIsDark, fileSize, inboxTime, lastSeenText, wallStyle } from './chatUi';
import { appConfirm } from '../components/dialogs';

// ---------------------------------------------------------------------------
// Chat sub-pages: Settings (Chats, Notifications, Privacy), Contact / Group info (media, mute, wallpaper,
// group permissions, participants) and New chat (contacts, new group, automatic teams).
// Every setting is validated on the server and recorded in the audit trail.
// ---------------------------------------------------------------------------

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Could not update chat.');

export function ChatWorkNotice({ onClose }: { onClose: () => void }) {
    return (
        <div role='note' className='px-4 py-3 text-[0.85em] leading-relaxed wa-ink'>
            <div className='flex items-start justify-between gap-2'>
                <p>
                    <strong>Workplace communication notice:</strong> Chat is an organizational work account, not a personal or private messaging service. Messages, attachments, assigned actions and polls are workplace records that may be retained, reviewed or audited according to organizational policy. Avoid sharing private
                    personal information. Internal report links still require the viewer’s normal MEMS permissions.
                </p>
                <button type='button' aria-label='Close workplace notice' onClick={onClose} className='h-11 w-11 shrink-0'>
                    <X className='h-4 w-4' />
                </button>
            </div>
        </div>
    );
}

function Choice<T extends string>({ title, value, options, onPick, onClose }: { title: string; value: T; options: Array<[T, string]>; onPick: (v: T) => void; onClose: () => void }) {
    return (
        <WaSheet title={title} onClose={onClose}>
            <div className='pb-3'>
                {options.map(([v, label]) => (
                    <button key={v} type='button' onClick={() => { onPick(v); onClose(); }} className='flex min-h-[52px] w-full items-center gap-4 px-5 text-left wa-hover'>
                        <span className='flex h-5 w-5 items-center justify-center rounded-full border-2' style={{ borderColor: v === value ? 'var(--wa-accent)' : 'var(--wa-sub)' }}>
                            {v === value && <span className='h-2.5 w-2.5 rounded-full' style={{ background: 'var(--wa-accent)' }} />}
                        </span>
                        <span className='wa-ink'>{label}</span>
                    </button>
                ))}
            </div>
        </WaSheet>
    );
}

function WallpaperPicker({ value, dark, onPick, onClose }: { value: string; dark: boolean; onPick: (id: string) => void; onClose: () => void }) {
    return (
        <WaSheet title='Wallpaper' onClose={onClose}>
            <div className='grid grid-cols-3 gap-3 px-5 pb-6'>
                {WALLPAPERS.map((w) => {
                    const s = wallStyle(w.id, dark);
                    return (
                        <button key={w.id} type='button' onClick={() => { onPick(w.id); onClose(); }} className='flex flex-col items-center gap-1.5'>
                            <span className={`relative block h-24 w-full overflow-hidden rounded-xl border-2 ${s.className}`} style={{ ...s.style, borderColor: value === w.id ? 'var(--wa-accent)' : 'var(--wa-line)' }}>
                                <span className='absolute right-2 top-3 h-3 w-10 rounded wa-out' />
                                <span className='absolute left-2 top-8 h-3 w-12 rounded wa-in' />
                                {value === w.id && <Check className='absolute bottom-1 right-1 h-4 w-4 wa-green' />}
                            </span>
                            <span className='text-[0.78em] wa-sub'>{w.label}</span>
                        </button>
                    );
                })}
            </div>
        </WaSheet>
    );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function ChatSettingsPage({ uid, people, settings, onSave, onBack }: { uid: string; people: ChatPerson[]; settings: ChatSettingsValue; onSave: (patch: Partial<ChatSettingsValue>) => Promise<void>; onBack: () => void }) {
    const [pick, setPick] = useState<'' | 'appearance' | 'font' | 'wallpaper'>('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(false);
    const me = people.find((p) => p.uid === uid);
    const save = (patch: Partial<ChatSettingsValue>) => {
        setError('');
        void onSave(patch).catch((e) => setError(errorText(e)));
    };
    const appearance: Record<ChatSettingsValue['appearance'], string> = { system: 'System default', light: 'Light', dark: 'Dark' };
    const font: Record<ChatSettingsValue['fontSize'], string> = { small: 'Small', medium: 'Medium', large: 'Large' };
    return (
        <WaPage title='Settings' onBack={onBack}>
            {error && <p role='alert' className='px-4 py-2 text-[0.85em] wa-danger'>{error}</p>}
            <WaSection>
                <div className='flex items-center gap-4 px-4 py-4'>
                    <WaAvatar person={me} size={64} />
                    <div className='min-w-0'>
                        <p className='truncate text-[1.2em] wa-ink'>{me?.name || 'You'}</p>
                        <p className='truncate text-[0.85em] wa-sub'>{me?.email || 'Workplace account'}</p>
                    </div>
                </div>
            </WaSection>
            <WaSection title='Chats'>
                <WaRow icon={<Moon className='h-5 w-5' />} title='Theme' detail={appearance[settings.appearance]} onClick={() => setPick('appearance')} />
                <WaRow icon={<Palette className='h-5 w-5' />} title='Default wallpaper' detail={WALLPAPERS.find((w) => w.id === settings.wallpaper)?.label || 'Default'} onClick={() => setPick('wallpaper')} />
                <WaRow icon={<Type className='h-5 w-5' />} title='Font size' detail={font[settings.fontSize]} onClick={() => setPick('font')} />
                <WaRow icon={<Keyboard className='h-5 w-5' />} title='Enter is send' detail='The Enter key sends your message' toggle={settings.enterToSend} onClick={() => save({ enterToSend: !settings.enterToSend })} />
            </WaSection>
            <WaSection title='Notifications'>
                <WaRow icon={<Bell className='h-5 w-5' />} title='Conversation tones' detail='Play a sound for incoming messages' toggle={settings.sound} onClick={() => save({ sound: !settings.sound })} />
                <WaRow icon={<Eye className='h-5 w-5' />} title='Show previews' detail='Show message text in the chat list' toggle={settings.showPreviews} onClick={() => save({ showPreviews: !settings.showPreviews })} />
                <WaRow icon={<BellOff className='h-5 w-5' />} title='Mute all chats' detail='No tones or alerts from any conversation' toggle={settings.muteAll} onClick={() => save({ muteAll: !settings.muteAll })} />
            </WaSection>
            <WaSection title='Privacy'>
                <WaRow icon={<Eye className='h-5 w-5' />} title='Last seen and online' detail={settings.lastSeen ? 'Colleagues can see when you were last online' : "Hidden: you also can't see others' last seen"} toggle={settings.lastSeen} onClick={() => save({ lastSeen: !settings.lastSeen })} />
                <WaRow
                    icon={<Check className='h-5 w-5' />}
                    title='Read receipts'
                    detail={settings.readReceipts ? 'Blue ticks show when your messages are read' : "Off: you won't send or see read receipts in individual chats. Group read receipts are always sent."}
                    toggle={settings.readReceipts}
                    onClick={() => save({ readReceipts: !settings.readReceipts })}
                />
            </WaSection>
            <WaSection title='Workplace'>
                <WaRow icon={<ShieldCheck className='h-5 w-5' />} title='Workplace chat notice' detail='How chat records are retained and audited' onClick={() => setNotice((v) => !v)} right={<ChevronRight className='h-5 w-5 wa-sub' />} />
                {notice && <ChatWorkNotice onClose={() => setNotice(false)} />}
                <WaRow icon={<Lock className='h-5 w-5' />} title='Security' detail='Messages and files are encrypted in transit and at rest, access is membership-checked on every request, and every change is audited.' />
            </WaSection>
            {pick === 'appearance' && <Choice title='Choose theme' value={settings.appearance} options={Object.entries(appearance) as Array<[ChatSettingsValue['appearance'], string]>} onPick={(v) => save({ appearance: v })} onClose={() => setPick('')} />}
            {pick === 'font' && <Choice title='Font size' value={settings.fontSize} options={Object.entries(font) as Array<[ChatSettingsValue['fontSize'], string]>} onPick={(v) => save({ fontSize: v })} onClose={() => setPick('')} />}
            {pick === 'wallpaper' && <WallpaperPicker value={settings.wallpaper} dark={chatIsDark(settings)} onPick={(v) => save({ wallpaper: v })} onClose={() => setPick('')} />}
        </WaPage>
    );
}

// ---------------------------------------------------------------------------
// Contact / group info
// ---------------------------------------------------------------------------

export function ChatInfoPage({
    uid, room, people, allPeople, live, wallpaper, onWallpaper, onChanged, onLeave, onBack, onOpenTool,
}: {
    uid: string; room: ChatRoom; people: ChatPerson[]; allPeople: ChatPerson[]; live: ChatLiveState; wallpaper: string;
    onWallpaper: (id: string) => void; onChanged: () => Promise<void>; onLeave: () => void; onBack: () => void; onOpenTool: (tool: 'action' | 'poll') => void;
}) {
    const group = room.kind === 'group';
    const admin = group && room.admins.includes(uid);
    const canEditInfo = group && (admin || room.infoPolicy === 'all');
    const partner = !group ? people.find((p) => p.uid !== uid && room.members.includes(p.uid)) ?? allPeople.find((p) => p.uid !== uid && room.members.includes(p.uid)) : undefined;
    const person = (id: string) => people.find((p) => p.uid === id) ?? allPeople.find((p) => p.uid === id);
    const [pref, setPref] = useState<{ muted: boolean; muteUntil: string; pinned: boolean }>({ muted: false, muteUntil: '', pinned: false });
    const [media, setMedia] = useState<{ media: ChatMediaItem[]; links: Array<{ messageId: string; url: string; createdAt: string }> } | null>(null);
    const [tab, setTab] = useState<'' | 'media' | 'docs' | 'links'>('');
    const [sheet, setSheet] = useState<'' | 'mute' | 'wallpaper' | 'send' | 'info' | 'add' | 'name' | 'about'>('');
    const [member, setMember] = useState<string>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(false);
    const [text, setText] = useState('');
    const [add, setAdd] = useState<string[]>([]);
    const [q, setQ] = useState('');
    const dark = document.querySelector('.wa')?.classList.contains('wa-dark') ?? false;

    useEffect(() => {
        let alive = true;
        void callBackend<{ muted: boolean; muteUntil: string; pinned: boolean }>('/api/org/quick/chat/preferences', { roomId: room.id }).then((p) => alive && setPref({ muted: p.muted, muteUntil: p.muteUntil || '', pinned: p.pinned })).catch(() => undefined);
        void callBackend<{ media: ChatMediaItem[]; links: Array<{ messageId: string; url: string; createdAt: string }> }>('/api/org/quick/chat/room', { roomId: room.id, media: true }).then((m) => alive && setMedia(m)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [room.id]);

    const run = async (path: string, body: Record<string, unknown>, after?: () => void) => {
        setBusy(true);
        setError('');
        try {
            await callBackend(path, body);
            after?.();
            await onChanged();
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    const mute = (duration: string) => run('/api/org/quick/chat/preferences/save', { mode: 'mute', roomId: room.id, duration }, () => setPref((p) => ({ ...p, muted: duration !== 'off' })));
    const images = media?.media.filter((m) => m.kind === 'image') ?? [];
    const docs = media?.media.filter((m) => m.kind !== 'image') ?? [];
    const o = live.online.find((x) => x.uid === partner?.uid);
    const candidates = allPeople.filter((p) => p.uid !== uid && !room.members.includes(p.uid) && !room.pendingInvites?.includes(p.uid) && (p.name + ' ' + (p.email || '')).toLowerCase().includes(q.trim().toLowerCase()));

    if (tab) {
        return (
            <WaPage title={group ? room.title : partner?.name || 'Contact'} subtitle='Media, links and docs' onBack={() => setTab('')}>
                <div className='sticky top-0 z-[1] flex border-b wa-panel wa-line'>
                    {(['media', 'docs', 'links'] as const).map((t) => (
                        <button key={t} type='button' onClick={() => setTab(t)} className='h-12 flex-1 text-[0.9em] font-medium' style={tab === t ? { color: 'var(--wa-accent-text)', borderBottom: '3px solid var(--wa-accent)' } : { color: 'var(--wa-sub)' }}>
                            {t === 'media' ? 'Media' : t === 'docs' ? 'Docs' : 'Links'}
                        </button>
                    ))}
                </div>
                {tab === 'media' && (
                    <div className='grid grid-cols-3 gap-0.5 p-0.5 sm:grid-cols-5'>
                        {images.map((m) => (
                            <a key={m.messageId} href={m.url} target='_blank' rel='noopener noreferrer' className='aspect-square overflow-hidden'>
                                <img src={m.url} alt={m.name} loading='lazy' className='h-full w-full object-cover' />
                            </a>
                        ))}
                        {!images.length && <p className='col-span-3 p-8 text-center text-[0.9em] wa-sub'>No media</p>}
                    </div>
                )}
                {tab === 'docs' && (
                    <div>
                        {docs.map((m) => (
                            <a key={m.messageId} href={m.url} target='_blank' rel='noopener noreferrer' className='flex min-h-[64px] items-center gap-3 border-b px-4 wa-line wa-hover'>
                                <FileText className='h-8 w-8 shrink-0 wa-green' />
                                <span className='min-w-0 flex-1'>
                                    <span className='block truncate wa-ink'>{m.name}</span>
                                    <span className='block text-[0.8em] wa-sub'>
                                        {fileSize(m.size)} · {inboxTime(m.createdAt)}
                                    </span>
                                </span>
                            </a>
                        ))}
                        {!docs.length && <p className='p-8 text-center text-[0.9em] wa-sub'>No docs</p>}
                    </div>
                )}
                {tab === 'links' && (
                    <div>
                        {(media?.links ?? []).map((l) => (
                            <a key={l.messageId + l.url} href={l.url} target='_blank' rel='noopener noreferrer' className='flex min-h-[56px] items-center gap-3 border-b px-4 wa-line wa-hover'>
                                <Link2 className='h-5 w-5 shrink-0 wa-sub' />
                                <span className='min-w-0 flex-1 truncate' style={{ color: 'var(--wa-read)' }}>
                                    {l.url}
                                </span>
                            </a>
                        ))}
                        {!media?.links.length && <p className='p-8 text-center text-[0.9em] wa-sub'>No links</p>}
                    </div>
                )}
            </WaPage>
        );
    }

    return (
        <WaPage title={group ? 'Group info' : 'Contact info'} onBack={onBack}>
            {error && <p role='alert' className='px-4 py-2 text-[0.85em] wa-danger'>{error}</p>}
            <WaSection>
                <div className='flex flex-col items-center px-4 pb-4 pt-6 text-center'>
                    {group ? <WaAvatar group size={112} /> : <WaAvatar person={partner} size={112} />}
                    <button type='button' disabled={!canEditInfo} onClick={() => { setText(room.title); setSheet('name'); }} className='mt-3 text-[1.45em] wa-ink'>
                        {group ? room.title : partner?.name || 'Colleague'}
                    </button>
                    <p className='text-[0.95em] wa-sub'>{group ? `Group · ${room.members.length} member${room.members.length === 1 ? '' : 's'}` : partner?.email || ''}</p>
                    {!group && <p className='mt-0.5 text-[0.85em] wa-sub'>{o?.online ? 'online' : o?.lastSeen ? lastSeenText(o.lastSeen) : ''}</p>}
                </div>
                {group && (
                    <button type='button' disabled={!canEditInfo} onClick={() => { setText(room.description || ''); setSheet('about'); }} className='block w-full px-4 pb-4 text-left'>
                        {room.description ? <p className='whitespace-pre-wrap text-[0.95em] wa-ink'>{room.description}</p> : <p className='text-[0.95em] wa-green'>{canEditInfo ? 'Add group description' : 'No description'}</p>}
                    </button>
                )}
            </WaSection>
            <WaSection>
                <button type='button' onClick={() => setTab('media')} className='flex w-full items-center justify-between px-4 pt-3 text-[0.9em] wa-sub'>
                    <span>Media, links and docs</span>
                    <span className='flex items-center gap-1'>
                        {(media?.media.length ?? 0) + (media?.links.length ?? 0)} <ChevronRight className='h-4 w-4' />
                    </span>
                </button>
                <div className='flex gap-1.5 overflow-x-auto px-4 pb-4 pt-3 wa-noscroll'>
                    {images.slice(0, 12).map((m) => (
                        <button key={m.messageId} type='button' onClick={() => setTab('media')} className='h-20 w-20 shrink-0 overflow-hidden rounded-lg'>
                            <img src={m.url} alt={m.name} loading='lazy' className='h-full w-full object-cover' />
                        </button>
                    ))}
                    {!images.length && <span className='text-[0.85em] wa-sub'>{media ? 'No photos shared yet' : 'Loading…'}</span>}
                </div>
            </WaSection>
            <WaSection>
                <WaRow icon={<BellOff className='h-5 w-5' />} title='Mute notifications' detail={pref.muted ? (pref.muteUntil ? 'Until ' + new Date(pref.muteUntil).toLocaleString() : 'Always') : 'Off'} toggle={pref.muted} onClick={() => (pref.muted ? void mute('off') : setSheet('mute'))} />
                <WaRow icon={<Pin className='h-5 w-5' />} title='Pin chat' detail='Keep this chat at the top of your list' toggle={pref.pinned} onClick={() => void run('/api/org/quick/chat/preferences/save', { mode: 'pin', roomId: room.id, pinned: !pref.pinned }, () => setPref((p) => ({ ...p, pinned: !p.pinned })))} />
                <WaRow icon={<Palette className='h-5 w-5' />} title='Chat wallpaper' detail={WALLPAPERS.find((w) => w.id === wallpaper)?.label || 'Default'} onClick={() => setSheet('wallpaper')} />
                <WaRow icon={<ClipboardList className='h-5 w-5' />} title='Monitored actions' detail='Assignments and progress in this chat' onClick={() => onOpenTool('action')} right={<ChevronRight className='h-5 w-5 wa-sub' />} />
                {group && <WaRow icon={<ImageIcon className='h-5 w-5' />} title='Polls' detail='Vote or view results' onClick={() => onOpenTool('poll')} right={<ChevronRight className='h-5 w-5 wa-sub' />} />}
            </WaSection>
            {group && admin && (
                <WaSection title='Group permissions'>
                    <WaRow icon={<Users className='h-5 w-5' />} title='Send messages' detail={room.sendPolicy === 'admins' ? 'Only admins' : 'All members'} onClick={() => setSheet('send')} />
                    <WaRow icon={<Type className='h-5 w-5' />} title='Edit group info' detail={room.infoPolicy === 'all' ? 'All members' : 'Only admins'} onClick={() => setSheet('info')} />
                </WaSection>
            )}
            {group && (
                <WaSection title={`${room.members.length} members`}>
                    {admin && <WaRow icon={<span className='flex h-10 w-10 items-center justify-center rounded-full wa-btn'><UserPlus className='h-5 w-5' /></span>} title='Add members' onClick={() => setSheet('add')} />}
                    {room.members.map((id) => (
                        <button key={id} type='button' onClick={() => admin && id !== uid && setMember(id)} className='flex min-h-[64px] w-full items-center gap-3 px-4 text-left wa-hover'>
                            <WaAvatar person={person(id)} size={40} online={live.online.find((x) => x.uid === id)?.online} />
                            <span className='min-w-0 flex-1'>
                                <span className='block truncate wa-ink'>{id === uid ? 'You' : person(id)?.name || 'Colleague'}</span>
                                <span className='block truncate text-[0.82em] wa-sub'>{person(id)?.email || ''}</span>
                            </span>
                            {room.admins.includes(id) && <span className='rounded-md px-1.5 py-0.5 text-[0.72em] font-medium wa-green' style={{ background: 'rgba(0,168,132,0.14)' }}>Group admin</span>}
                        </button>
                    ))}
                    {(room.pendingInvites?.length ?? 0) > 0 && (
                        <div className='px-4 pb-3'>
                            <p className='pb-1 pt-2 text-[0.82em] wa-sub'>Invited · waiting to accept</p>
                            {room.pendingInvites!.map((id) => (
                                <div key={id} className='flex min-h-[48px] items-center gap-3'>
                                    <WaAvatar person={person(id)} size={32} />
                                    <span className='min-w-0 flex-1 truncate text-[0.92em] wa-ink'>{person(id)?.name || 'Colleague'}</span>
                                    {admin && (
                                        <button type='button' disabled={busy} onClick={() => void run('/api/org/quick/chat/group/member', { roomId: room.id, action: 'revoke', uid: id })} className='h-9 rounded-full px-3 text-[0.85em] wa-danger'>
                                            Revoke
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </WaSection>
            )}
            <WaSection>
                <WaRow icon={<ShieldCheck className='h-5 w-5' />} title='Workplace chat' detail='Messages are organization records, retained and auditable' onClick={() => setNotice((v) => !v)} />
                {notice && <ChatWorkNotice onClose={() => setNotice(false)} />}
                <WaRow icon={<X className='h-5 w-5' />} danger title='Hide chat' detail='Remove from your list; history is kept' onClick={async () => { if (await appConfirm('Hide this chat from your list? Its history is kept and other members are not affected.')) void run('/api/org/quick/chat/hide', { roomId: room.id }, onLeave); }} />
                {group && room.createdBy !== uid && <WaRow icon={<LogOut className='h-5 w-5' />} danger title='Exit group' onClick={async () => { if (await appConfirm('Exit this group? You will lose access to the conversation and its tracker.')) void run('/api/org/quick/chat/group/member', { roomId: room.id, action: 'leave' }, onLeave); }} />}
                {group && room.createdBy === uid && <p className='px-4 pb-4 text-[0.8em] wa-sub'>You created this group and stay its permanent admin.</p>}
            </WaSection>

            {sheet === 'mute' && <Choice title='Mute notifications for…' value={'8h'} options={[['8h', '8 hours'], ['1w', '1 week'], ['always', 'Always']]} onPick={(v) => void mute(v)} onClose={() => setSheet('')} />}
            {sheet === 'wallpaper' && (
                <WallpaperPicker
                    value={wallpaper}
                    dark={dark}
                    onPick={(id) => void run('/api/org/quick/chat/preferences/save', { mode: 'theme', roomId: room.id, theme: id }, () => onWallpaper(id === 'default' ? '' : id))}
                    onClose={() => setSheet('')}
                />
            )}
            {sheet === 'send' && <Choice title='Who can send messages' value={room.sendPolicy || 'all'} options={[['all', 'All members'], ['admins', 'Only admins']]} onPick={(v) => void run('/api/org/quick/chat/group/update', { roomId: room.id, action: 'policy', sendPolicy: v, infoPolicy: room.infoPolicy || 'admins' })} onClose={() => setSheet('')} />}
            {sheet === 'info' && <Choice title='Who can edit group info' value={room.infoPolicy || 'admins'} options={[['all', 'All members'], ['admins', 'Only admins']]} onPick={(v) => void run('/api/org/quick/chat/group/update', { roomId: room.id, action: 'policy', sendPolicy: room.sendPolicy || 'all', infoPolicy: v })} onClose={() => setSheet('')} />}
            {(sheet === 'name' || sheet === 'about') && (
                <WaSheet title={sheet === 'name' ? 'Group name' : 'Group description'} onClose={() => setSheet('')}>
                    <div className='space-y-3 px-5 pb-5'>
                        {sheet === 'name' ? (
                            <input value={text} maxLength={90} autoFocus onChange={(e) => setText(e.target.value)} className='h-12 w-full border-b-2 bg-transparent text-[1.05em] outline-none' style={{ borderColor: 'var(--wa-accent)' }} aria-label='Group name' />
                        ) : (
                            <textarea value={text} maxLength={500} rows={4} autoFocus onChange={(e) => setText(e.target.value)} className='w-full resize-none rounded-lg border-2 bg-transparent p-2 outline-none' style={{ borderColor: 'var(--wa-accent)' }} aria-label='Group description' />
                        )}
                        <p className='text-right text-[0.75em] wa-sub'>
                            {sheet === 'name' ? (text.trim().length < 3 ? 'At least 3 characters' : `${text.length}/90`) : `${text.length}/500`}
                        </p>
                        <div className='flex justify-end gap-2'>
                            <button type='button' onClick={() => setSheet('')} className='h-10 rounded-full px-4 wa-green'>
                                Cancel
                            </button>
                            <button
                                type='button'
                                disabled={busy || (sheet === 'name' && (text.trim().length < 3 || text.trim().length > 90))}
                                onClick={() => void run('/api/org/quick/chat/group/update', sheet === 'name' ? { roomId: room.id, action: 'rename', title: text.trim() } : { roomId: room.id, action: 'describe', description: text.trim() }, () => setSheet(''))}
                                className='h-10 rounded-full px-5 font-medium wa-btn disabled:opacity-50'
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </WaSheet>
            )}
            {sheet === 'add' && (
                <WaSheet title='Add members' onClose={() => setSheet('')}>
                    <div className='px-4 pb-2'>
                        <label className='flex h-11 items-center gap-2 rounded-full px-3 wa-panel2'>
                            <Search className='h-4 w-4 wa-sub' />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search colleagues' className='min-w-0 flex-1 bg-transparent outline-none' />
                        </label>
                    </div>
                    <div className='max-h-[45dvh] overflow-y-auto'>
                        {candidates.map((p) => {
                            const on = add.includes(p.uid);
                            return (
                                <button key={p.uid} type='button' onClick={() => setAdd((s) => (on ? s.filter((x) => x !== p.uid) : [...s, p.uid]))} className='flex min-h-[60px] w-full items-center gap-3 px-4 text-left wa-hover'>
                                    <span className='relative'>
                                        <WaAvatar person={p} size={40} />
                                        {on && <span className='absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 wa-btn' style={{ borderColor: 'var(--wa-panel)' }}><Check className='h-3 w-3' /></span>}
                                    </span>
                                    <span className='min-w-0 flex-1'>
                                        <span className='block truncate wa-ink'>{p.name}</span>
                                        <span className='block truncate text-[0.8em] wa-sub'>{p.email}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div className='flex justify-end px-4 py-3'>
                        <button type='button' disabled={busy || !add.length} onClick={() => void run('/api/org/quick/chat/group/update', { roomId: room.id, action: 'add', memberUids: add }, () => { setAdd([]); setSheet(''); })} className='flex h-11 items-center gap-2 rounded-full px-5 font-medium wa-btn disabled:opacity-50'>
                            Invite {add.length || ''}
                        </button>
                    </div>
                </WaSheet>
            )}
            {member && (
                <WaSheet title={person(member)?.name || 'Member'} onClose={() => setMember('')}>
                    <div className='pb-3'>
                        {member !== room.createdBy && (
                            <button type='button' onClick={() => { const id = member; setMember(''); void run('/api/org/quick/chat/group/member', { roomId: room.id, action: room.admins.includes(id) ? 'demote' : 'promote', uid: id }); }} className='flex min-h-[52px] w-full items-center gap-4 px-5 text-left wa-ink wa-hover'>
                                <ShieldCheck className='h-5 w-5 wa-sub' />
                                {room.admins.includes(member) ? 'Dismiss as admin' : 'Make group admin'}
                            </button>
                        )}
                        {member !== room.createdBy && (
                            <button
                                type='button'
                                onClick={async () => {
                                    const id = member;
                                    setMember('');
                                    if (await appConfirm(`Remove ${person(id)?.name || 'this member'} from the group?`)) void run('/api/org/quick/chat/group/update', { roomId: room.id, action: 'remove', memberUid: id });
                                }}
                                className='flex min-h-[52px] w-full items-center gap-4 px-5 text-left wa-danger wa-hover'
                            >
                                <X className='h-5 w-5' />
                                Remove from group
                            </button>
                        )}
                        {member === room.createdBy && <p className='px-5 pb-3 text-[0.9em] wa-sub'>The group creator stays a permanent admin.</p>}
                    </div>
                </WaSheet>
            )}
        </WaPage>
    );
}

// ---------------------------------------------------------------------------
// New chat: contacts, new group, and teams (automatic teams from reporting lines + shared work groups)
// ---------------------------------------------------------------------------

interface Team { id: string; name: string; memberUids: string[]; ownerUid: string; chatRoomId: string; automatic?: string; detail?: string }

export function NewChatPage({ uid, people, onBack, onOpen }: { uid: string; people: ChatPerson[]; onBack: () => void; onOpen: (roomId: string) => void }) {
    const [step, setStep] = useState<'contacts' | 'members' | 'name'>('contacts');
    const [q, setQ] = useState('');
    const [chosen, setChosen] = useState<string[]>([]);
    const [title, setTitle] = useState('');
    const [team, setTeam] = useState<Team | null>(null);
    const [teams, setTeams] = useState<Team[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let alive = true;
        void callBackend<{ groups: Team[] }>('/api/org/work-groups/list').then((r) => alive && setTeams(r.groups)).catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);
    const term = q.trim().toLowerCase();
    const others = useMemo(() => people.filter((p) => p.uid !== uid && (!term || (p.name + ' ' + (p.email || '')).toLowerCase().includes(term))), [people, uid, term]);
    const start = async (kind: 'direct' | 'group', members: string[], name = '', workGroupId = '') => {
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ room: ChatRoom }>('/api/org/quick/chat/start', { kind, title: name, memberUids: members, workGroupId });
            onOpen(r.room.id);
        } catch (e) {
            setError(errorText(e));
        } finally {
            setBusy(false);
        }
    };
    const openTeam = (t: Team) => {
        if (t.chatRoomId) return onOpen(t.chatRoomId);
        setTeam(t);
        setChosen(t.memberUids.filter((m) => m !== uid));
        setTitle(t.name);
        setStep('name');
    };
    const person = (id: string) => people.find((p) => p.uid === id);
    // Teams I can start a chat for (my own) or whose chat already exists.
    const shownTeams = teams.filter((t) => t.chatRoomId || t.ownerUid === uid);

    if (step === 'name')
        return (
            <WaPage title='New group' subtitle={team ? (team.automatic ? 'Automatic team · from reporting lines' : 'Shared work group') : 'Add group name'} onBack={() => (team ? (setTeam(null), setStep('contacts')) : setStep('members'))}>
                {error && <p role='alert' className='px-4 py-2 text-[0.85em] wa-danger'>{error}</p>}
                <div className='flex items-center gap-4 px-4 py-6'>
                    <WaAvatar group size={56} />
                    <input value={title} maxLength={90} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder='Group name (required)' aria-label='Group name' className='h-12 min-w-0 flex-1 border-b-2 bg-transparent text-[1.05em] outline-none' style={{ borderColor: 'var(--wa-accent)' }} />
                </div>
                <p className='px-4 pb-2 text-[0.85em] wa-sub'>
                    Members: {chosen.length} · colleagues receive an invitation to join{team?.automatic ? '. Membership follows the reporting lines and stays in sync.' : '.'}
                </p>
                <div className='flex flex-wrap gap-4 px-4 pb-24'>
                    {chosen.map((id) => (
                        <span key={id} className='flex w-16 flex-col items-center gap-1 text-center'>
                            <WaAvatar person={person(id)} size={48} />
                            <span className='w-full truncate text-[0.75em] wa-sub'>{person(id)?.name.split(' ')[0] || 'Colleague'}</span>
                        </span>
                    ))}
                </div>
                <button type='button' aria-label='Create group' disabled={busy || title.trim().length < 3 || !chosen.length || chosen.length > 49} onClick={() => void start('group', chosen, title.trim(), team?.id || '')} className='fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg wa-btn disabled:opacity-50'>
                    <Check className='h-6 w-6' />
                </button>
            </WaPage>
        );

    if (step === 'members')
        return (
            <WaPage title='New group' subtitle={chosen.length ? `${chosen.length} of 49 selected` : 'Add members'} onBack={() => setStep('contacts')}>
                {chosen.length > 0 && (
                    <div className='flex gap-3 overflow-x-auto border-b px-4 py-3 wa-line wa-noscroll'>
                        {chosen.map((id) => (
                            <button key={id} type='button' onClick={() => setChosen((s) => s.filter((x) => x !== id))} className='relative flex w-14 shrink-0 flex-col items-center gap-1'>
                                <WaAvatar person={person(id)} size={46} />
                                <span className='absolute right-0 top-8 flex h-5 w-5 items-center justify-center rounded-full border-2' style={{ background: 'var(--wa-sub)', borderColor: 'var(--wa-panel)' }}>
                                    <X className='h-3 w-3 text-[#fff]' />
                                </span>
                                <span className='w-full truncate text-[0.72em] wa-sub'>{person(id)?.name.split(' ')[0]}</span>
                            </button>
                        ))}
                    </div>
                )}
                <div className='px-4 py-2'>
                    <label className='flex h-11 items-center gap-2 rounded-full px-3 wa-panel2'>
                        <Search className='h-4 w-4 wa-sub' />
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search name or email' className='min-w-0 flex-1 bg-transparent outline-none' />
                    </label>
                </div>
                {others.map((p) => {
                    const on = chosen.includes(p.uid);
                    return (
                        <button key={p.uid} type='button' disabled={!on && chosen.length >= 49} onClick={() => setChosen((s) => (on ? s.filter((x) => x !== p.uid) : [...s, p.uid]))} className='flex min-h-[64px] w-full items-center gap-3 px-4 text-left wa-hover disabled:opacity-50'>
                            <span className='relative'>
                                <WaAvatar person={p} size={44} />
                                {on && <span className='absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 wa-btn' style={{ borderColor: 'var(--wa-panel)' }}><Check className='h-3 w-3' /></span>}
                            </span>
                            <span className='min-w-0 flex-1'>
                                <span className='block truncate wa-ink'>{p.name}</span>
                                <span className='block truncate text-[0.82em] wa-sub'>{p.email}</span>
                            </span>
                        </button>
                    );
                })}
                <div className='h-24' />
                <button type='button' aria-label='Next' disabled={!chosen.length} onClick={() => setStep('name')} className='fixed bottom-[max(20px,env(safe-area-inset-bottom))] right-4 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg wa-btn disabled:opacity-50'>
                    <ArrowRight className='h-6 w-6' />
                </button>
            </WaPage>
        );

    return (
        <WaPage title='Select contact' subtitle={`${people.filter((p) => p.uid !== uid).length} colleagues`} onBack={onBack}>
            {error && <p role='alert' className='px-4 py-2 text-[0.85em] wa-danger'>{error}</p>}
            <div className='px-4 py-2'>
                <label className='flex h-11 items-center gap-2 rounded-full px-3 wa-panel2'>
                    <Search className='h-4 w-4 wa-sub' />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search name or email' className='min-w-0 flex-1 bg-transparent outline-none' />
                </label>
            </div>
            {!term && (
                <WaRow icon={<span className='flex h-10 w-10 items-center justify-center rounded-full wa-btn'><Users className='h-5 w-5' /></span>} title='New group' onClick={() => { setChosen([]); setTeam(null); setStep('members'); }} />
            )}
            {!term && shownTeams.length > 0 && (
                <>
                    <p className='px-4 pb-1 pt-3 text-[0.85em] wa-sub'>Teams</p>
                    {shownTeams.map((t) => (
                        <button key={t.id} type='button' disabled={busy} onClick={() => openTeam(t)} className='flex min-h-[64px] w-full items-center gap-3 px-4 text-left wa-hover'>
                            <WaAvatar group size={44} />
                            <span className='min-w-0 flex-1'>
                                <span className='flex items-center gap-1.5'>
                                    <span className='truncate wa-ink'>{t.name}</span>
                                    {t.automatic && <span className='shrink-0 rounded px-1 text-[0.68em] font-medium wa-green' style={{ background: 'rgba(0,168,132,0.14)' }}>AUTO</span>}
                                </span>
                                <span className='block truncate text-[0.82em] wa-sub'>
                                    {t.memberUids.length} members · {t.chatRoomId ? 'Open team chat' : 'Create team chat'}
                                    {t.detail ? ' · ' + t.detail : ''}
                                </span>
                            </span>
                        </button>
                    ))}
                </>
            )}
            <p className='px-4 pb-1 pt-3 text-[0.85em] wa-sub'>Colleagues on MEMS</p>
            {others.map((p) => (
                <button key={p.uid} type='button' disabled={busy} onClick={() => void start('direct', [p.uid])} className='flex min-h-[64px] w-full items-center gap-3 px-4 text-left wa-hover'>
                    <WaAvatar person={p} size={44} />
                    <span className='min-w-0 flex-1'>
                        <span className='block truncate wa-ink'>{p.name}</span>
                        <span className='block truncate text-[0.82em] wa-sub'>{p.email}</span>
                    </span>
                </button>
            ))}
            {!others.length && <p className='p-8 text-center text-[0.9em] wa-sub'>No colleagues match “{q}”.</p>}
        </WaPage>
    );
}
