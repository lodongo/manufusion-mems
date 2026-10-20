import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Filter, Inbox, Mail, MailOpen, Palette, PenLine, Plus, Reply, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import MailRichEditor from './MailRichEditor';
import { MAIL_CATEGORIES, SWIPE_ACTIONS, type MailRule } from '../../backend/mailRules';
import { appConfirm } from '../components/dialogs';

// ---------------------------------------------------------------------------
// Mail settings, organised like Outlook: General (appearance), Mail › Layout, Compose and reply,
// Automatic replies, Rules, Junk email, Message handling and Swipe actions.
// Every section is verified here and again on the server, and each save is audited.
// ---------------------------------------------------------------------------

export type MailPreferences = {
    signatureEnabled: boolean;
    signatureHtml: string;
    autoReplyEnabled: boolean;
    autoReplySubject: string;
    autoReplyHtml: string;
    autoReplyStart: string;
    autoReplyEnd: string;
    appearance: 'system' | 'light' | 'dark';
    focusedInbox: boolean;
    conversationView: boolean;
    readingPane: 'right' | 'bottom' | 'off';
    density: 'full' | 'medium' | 'compact';
    showSenderImage: boolean;
    showPreview: boolean;
    markRead: 'select' | 'delay' | 'manual';
    markReadDelay: number;
    undoSendSeconds: number;
    swipeLeft: (typeof SWIPE_ACTIONS)[number];
    swipeRight: (typeof SWIPE_ACTIONS)[number];
    blockedSenders: string[];
    safeSenders: string[];
    rules: MailRule[];
};
export const defaultMailPrefs: MailPreferences = {
    signatureEnabled: false, signatureHtml: '', autoReplyEnabled: false, autoReplySubject: 'Automatic reply', autoReplyHtml: '',
    autoReplyStart: '', autoReplyEnd: '', appearance: 'system', focusedInbox: true, conversationView: true, readingPane: 'right', density: 'medium',
    showSenderImage: true, showPreview: true, markRead: 'select', markReadDelay: 5, undoSendSeconds: 5, swipeLeft: 'delete', swipeRight: 'archive',
    blockedSenders: [], safeSenders: [], rules: [],
};

type Section = 'appearance' | 'layout' | 'compose' | 'auto' | 'rules' | 'junk' | 'handling' | 'swipe';
const SECTIONS: Array<{ id: Section; group: string; label: string; Icon: typeof Mail }> = [
    { id: 'appearance', group: 'General', label: 'Appearance', Icon: Palette },
    { id: 'layout', group: 'Mail', label: 'Layout', Icon: Inbox },
    { id: 'compose', group: 'Mail', label: 'Compose and reply', Icon: PenLine },
    { id: 'auto', group: 'Mail', label: 'Automatic replies', Icon: Reply },
    { id: 'rules', group: 'Mail', label: 'Rules', Icon: Filter },
    { id: 'junk', group: 'Mail', label: 'Junk email', Icon: ShieldCheck },
    { id: 'handling', group: 'Mail', label: 'Message handling', Icon: MailOpen },
    { id: 'swipe', group: 'Mail', label: 'Swipe actions', Icon: Mail },
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blankRule = (): MailRule => ({ id: '', name: '', enabled: true, from: '', subjectContains: '', bodyContains: '', hasAttachment: false, highImportance: false, sentOnlyToMe: false, moveTo: '', markRead: false, flag: false, category: '', focus: '', stop: false });
const toLocal = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');

function Radio<T extends string | number>({ name, value, options, onChange }: { name: string; value: T; options: Array<[T, string, string?]>; onChange: (v: T) => void }) {
    return (
        <div role='radiogroup' aria-label={name} className='space-y-1'>
            {options.map(([v, label, hint]) => (
                <label key={String(v)} className='flex min-h-10 cursor-pointer items-start gap-3 rounded px-2 py-1.5 ol-hover'>
                    <input type='radio' name={name} checked={value === v} onChange={() => onChange(v)} className='mt-1 h-4 w-4 accent-[#0f6cbd]' />
                    <span>
                        <span className='block text-[14px] ol-ink'>{label}</span>
                        {hint && <span className='block text-[12px] ol-sub'>{hint}</span>}
                    </span>
                </label>
            ))}
        </div>
    );
}
function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button type='button' role='switch' aria-checked={value} onClick={() => onChange(!value)} className='flex min-h-12 w-full items-center gap-3 rounded px-2 py-1.5 text-left ol-hover'>
            <span className='min-w-0 flex-1'>
                <span className='block text-[14px] ol-ink'>{label}</span>
                {hint && <span className='block text-[12px] ol-sub'>{hint}</span>}
            </span>
            <span className='relative inline-flex h-5 w-10 shrink-0 items-center rounded-full border' style={{ background: value ? 'var(--ol-brand)' : 'transparent', borderColor: value ? 'var(--ol-brand)' : 'var(--ol-sub)' }}>
                <span className='inline-block h-3 w-3 rounded-full transition-transform' style={{ background: value ? '#fff' : 'var(--ol-sub)', transform: value ? 'translateX(23px)' : 'translateX(4px)' }} />
            </span>
        </button>
    );
}
const H = ({ children }: { children: string }) => <h3 className='mb-2 mt-5 text-[14px] font-semibold ol-ink first:mt-0'>{children}</h3>;

export default function MailSettings({ value, people = [], folders = [], dark = false, onSaved, onClose }: { value: MailPreferences; people?: Array<{ uid: string; email: string; name: string }>; folders?: Array<{ id: string; name: string }>; dark?: boolean; onSaved: (v: MailPreferences) => void; onClose: () => void }) {
    const [prefs, setPrefs] = useState<MailPreferences>({ ...defaultMailPrefs, ...value });
    const [section, setSection] = useState<Section | ''>(() => (typeof window !== 'undefined' && window.innerWidth >= 768 ? 'layout' : ''));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [dirty, setDirty] = useState(false);
    const [rule, setRule] = useState<{ index: number; value: MailRule } | null>(null);
    const [sender, setSender] = useState({ blocked: '', safe: '' });
    const patch = (fields: Partial<MailPreferences>) => {
        setPrefs((p) => ({ ...p, ...fields }));
        setDirty(true);
        setNotice('');
    };
    const folderChoices = useMemo(() => [['', 'Don’t move'], ['inbox', 'Inbox'], ['archive', 'Archive'], ['junk', 'Junk Email'], ['deleted', 'Deleted Items'], ...folders.map((f) => [f.id, f.name])] as Array<[string, string]>, [folders]);

    // Client checks mirror the server so mistakes are shown before saving.
    const problems = (() => {
        const out: string[] = [];
        if (prefs.autoReplyEnabled && !prefs.autoReplyHtml.replace(/<[^>]*>/g, ' ').trim()) out.push('Write the automatic reply message.');
        if (prefs.autoReplyStart && prefs.autoReplyEnd && prefs.autoReplyEnd <= prefs.autoReplyStart) out.push('Automatic replies: the end time must be after the start time.');
        if (prefs.signatureEnabled && !prefs.signatureHtml.replace(/<[^>]*>/g, ' ').trim()) out.push('Write your signature or turn it off.');
        if (prefs.blockedSenders.some((e) => prefs.safeSenders.includes(e))) out.push('An address cannot be both blocked and safe.');
        return out;
    })();
    const save = async () => {
        if (problems.length) {
            setError(problems[0]);
            return;
        }
        setSaving(true);
        setError('');
        setNotice('');
        try {
            const r = await callBackend<{ preferences: MailPreferences }>('/api/org/mail/preferences/save', prefs);
            setPrefs({ ...defaultMailPrefs, ...r.preferences });
            onSaved({ ...defaultMailPrefs, ...r.preferences });
            setDirty(false);
            setNotice('Settings saved.');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to save settings');
        } finally {
            setSaving(false);
        }
    };
    const close = async () => {
        if (dirty && !(await appConfirm('Discard unsaved changes to your mail settings?'))) return;
        onClose();
    };
    const ruleProblems = (r: MailRule) => {
        const out: string[] = [];
        if (r.name.trim().length < 2) out.push('Name the rule.');
        if (r.from && !EMAIL.test(r.from)) out.push('The sender must be an email address.');
        if (!(r.from || r.subjectContains.trim() || r.bodyContains.trim() || r.hasAttachment || r.highImportance || r.sentOnlyToMe)) out.push('Add at least one condition.');
        if (!(r.moveTo || r.markRead || r.flag || r.category || r.focus)) out.push('Add at least one action.');
        return out;
    };
    const addSender = (kind: 'blocked' | 'safe') => {
        const email = sender[kind].trim().toLowerCase();
        if (!EMAIL.test(email)) return setError('Enter a valid email address.');
        const list = kind === 'blocked' ? prefs.blockedSenders : prefs.safeSenders;
        const other = kind === 'blocked' ? prefs.safeSenders : prefs.blockedSenders;
        if (other.includes(email)) return setError(email + ' is already on the ' + (kind === 'blocked' ? 'safe' : 'blocked') + ' senders list.');
        if (!list.includes(email)) patch(kind === 'blocked' ? { blockedSenders: [...list, email] } : { safeSenders: [...list, email] });
        setSender((s) => ({ ...s, [kind]: '' }));
        setError('');
    };
    const current = SECTIONS.find((s) => s.id === section);

    const body = (() => {
        switch (section) {
            case 'appearance':
                return (
                    <>
                        <H>Theme</H>
                        <Radio name='Theme' value={prefs.appearance} onChange={(v) => patch({ appearance: v })} options={[['system', 'Use organization theme'], ['light', 'Light'], ['dark', 'Dark']]} />
                    </>
                );
            case 'layout':
                return (
                    <>
                        <H>Focused Inbox</H>
                        <Toggle label='Sort messages into Focused and Other' hint='Rules can send messages to Other; safe senders and high importance stay in Focused.' value={prefs.focusedInbox} onChange={(v) => patch({ focusedInbox: v })} />
                        <H>Message organisation</H>
                        <Radio name='Message organisation' value={prefs.conversationView ? 'conv' : 'single'} onChange={(v) => patch({ conversationView: v === 'conv' })} options={[['conv', 'Show email grouped by conversation'], ['single', 'Show email as individual messages']]} />
                        <H>Reading pane</H>
                        <Radio name='Reading pane' value={prefs.readingPane} onChange={(v) => patch({ readingPane: v })} options={[['right', 'Show on the right'], ['bottom', 'Show on the bottom'], ['off', 'Hide reading pane', 'Messages open full screen']]} />
                        <H>Density</H>
                        <Radio name='Density' value={prefs.density} onChange={(v) => patch({ density: v })} options={[['full', 'Full', 'Sender image, preview and roomy spacing'], ['medium', 'Medium'], ['compact', 'Compact', 'More messages on screen']]} />
                        <H>Message list</H>
                        <Toggle label='Show sender images' value={prefs.showSenderImage} onChange={(v) => patch({ showSenderImage: v })} />
                        <Toggle label='Show preview text' value={prefs.showPreview} onChange={(v) => patch({ showPreview: v })} />
                    </>
                );
            case 'compose':
                return (
                    <>
                        <H>Email signature</H>
                        <Toggle label='Add my signature to new messages, replies and forwards' value={prefs.signatureEnabled} onChange={(v) => patch({ signatureEnabled: v })} />
                        <div className='mt-2 bg-page text-ink'>
                            <MailRichEditor html={prefs.signatureHtml} ariaLabel='Signature editor' placeholder='Name · Job title · Department · Phone' onChange={(signatureHtml) => patch({ signatureHtml })} />
                        </div>
                        <H>Undo send</H>
                        <p className='mb-1 text-[12px] ol-sub'>Wait before sending, so you can cancel a message you sent by mistake.</p>
                        <select aria-label='Undo send delay' value={prefs.undoSendSeconds} onChange={(e) => patch({ undoSendSeconds: Number(e.target.value) })} className='h-9 w-48 px-2 text-[14px] ol-input'>
                            {[0, 5, 10, 15, 30].map((n) => (
                                <option key={n} value={n}>
                                    {n ? n + ' seconds' : 'Off'}
                                </option>
                            ))}
                        </select>
                    </>
                );
            case 'auto':
                return (
                    <>
                        <Toggle label='Turn on automatic replies' hint='Colleagues receive one reply per day while this is on.' value={prefs.autoReplyEnabled} onChange={(v) => patch({ autoReplyEnabled: v })} />
                        <H>Send replies only during a time period</H>
                        <div className='grid gap-2 sm:grid-cols-2'>
                            <label className='text-[12px] ol-sub'>
                                Start
                                <input type='datetime-local' value={toLocal(prefs.autoReplyStart)} onChange={(e) => patch({ autoReplyStart: fromLocal(e.target.value) })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                            </label>
                            <label className='text-[12px] ol-sub'>
                                End
                                <input type='datetime-local' value={toLocal(prefs.autoReplyEnd)} onChange={(e) => patch({ autoReplyEnd: fromLocal(e.target.value) })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                            </label>
                        </div>
                        <p className='mt-1 text-[12px] ol-sub'>Leave both empty to reply for as long as automatic replies are on.</p>
                        <H>Subject</H>
                        <input value={prefs.autoReplySubject} maxLength={180} onChange={(e) => patch({ autoReplySubject: e.target.value })} aria-label='Automatic reply subject' className='h-9 w-full px-2 text-[14px] ol-input' />
                        <H>Message</H>
                        <div className='bg-page text-ink'>
                            <MailRichEditor html={prefs.autoReplyHtml} ariaLabel='Automatic reply editor' placeholder='I am away until … For urgent matters contact …' onChange={(autoReplyHtml) => patch({ autoReplyHtml })} />
                        </div>
                    </>
                );
            case 'rules':
                return (
                    <>
                        <p className='mb-3 text-[13px] ol-sub'>Rules act on messages as they arrive, in the order shown. Up to 25 rules.</p>
                        <button type='button' disabled={prefs.rules.length >= 25} onClick={() => setRule({ index: -1, value: blankRule() })} className='mb-3 flex h-9 items-center gap-2 rounded px-3 text-[14px] ol-link ol-hover disabled:opacity-40'>
                            <Plus className='h-4 w-4' />
                            Add new rule
                        </button>
                        {!prefs.rules.length && <p className='rounded border border-dashed p-4 text-center text-[13px] ol-line ol-sub'>No rules yet.</p>}
                        {prefs.rules.map((r, i) => (
                            <div key={r.id || i} className='mb-2 flex items-center gap-2 rounded border px-3 py-2 ol-line'>
                                <input type='checkbox' aria-label={'Enable ' + r.name} checked={r.enabled} onChange={(e) => patch({ rules: prefs.rules.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} className='h-4 w-4 accent-[#0f6cbd]' />
                                <button type='button' onClick={() => setRule({ index: i, value: { ...r } })} className='min-w-0 flex-1 text-left'>
                                    <span className='block truncate text-[14px] ol-ink'>{r.name}</span>
                                    <span className='block truncate text-[12px] ol-sub'>
                                        {[r.from && 'from ' + r.from, r.subjectContains && 'subject has “' + r.subjectContains + '”', r.bodyContains && 'body has “' + r.bodyContains + '”', r.hasAttachment && 'has attachment', r.highImportance && 'high importance', r.sentOnlyToMe && 'sent only to me'].filter(Boolean).join(' · ')} →{' '}
                                        {[r.moveTo && 'move to ' + (folderChoices.find((f) => f[0] === r.moveTo)?.[1] || 'folder'), r.markRead && 'mark read', r.flag && 'flag', r.category && 'categorise ' + r.category, r.focus && 'to ' + r.focus, r.stop && 'stop'].filter(Boolean).join(' · ')}
                                    </span>
                                </button>
                                <button type='button' aria-label='Move rule up' disabled={i === 0} onClick={() => { const next = [...prefs.rules]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; patch({ rules: next }); }} className='h-8 w-8 rounded ol-hover disabled:opacity-30'>
                                    ↑
                                </button>
                                <button type='button' aria-label={'Delete rule ' + r.name} onClick={() => patch({ rules: prefs.rules.filter((_, j) => j !== i) })} className='flex h-8 w-8 items-center justify-center rounded ol-danger ol-hover'>
                                    <Trash2 className='h-4 w-4' />
                                </button>
                            </div>
                        ))}
                    </>
                );
            case 'junk':
                return (
                    <>
                        {(['blocked', 'safe'] as const).map((kind) => {
                            const list = kind === 'blocked' ? prefs.blockedSenders : prefs.safeSenders;
                            return (
                                <div key={kind}>
                                    <H>{kind === 'blocked' ? 'Blocked senders' : 'Safe senders'}</H>
                                    <p className='mb-2 text-[12px] ol-sub'>{kind === 'blocked' ? 'Messages from these colleagues go straight to Junk Email.' : 'Messages from these colleagues never go to Junk Email and stay in Focused.'}</p>
                                    <div className='flex gap-2'>
                                        <input list='mail-settings-people' value={sender[kind]} onChange={(e) => setSender((s) => ({ ...s, [kind]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && addSender(kind)} placeholder='name@organization.com' aria-label={kind + ' sender'} className='h-9 min-w-0 flex-1 px-2 text-[14px] ol-input' />
                                        <button type='button' onClick={() => addSender(kind)} className='h-9 rounded px-3 text-[14px] ol-primary'>
                                            Add
                                        </button>
                                    </div>
                                    <ul className='mt-2'>
                                        {list.map((e) => (
                                            <li key={e} className='flex min-h-10 items-center gap-2 border-b text-[14px] ol-line'>
                                                <span className='min-w-0 flex-1 truncate'>{people.find((p) => p.email === e)?.name ? `${people.find((p) => p.email === e)?.name} · ${e}` : e}</span>
                                                <button type='button' aria-label={'Remove ' + e} onClick={() => patch(kind === 'blocked' ? { blockedSenders: list.filter((x) => x !== e) } : { safeSenders: list.filter((x) => x !== e) })} className='flex h-8 w-8 items-center justify-center rounded ol-hover'>
                                                    <X className='h-4 w-4' />
                                                </button>
                                            </li>
                                        ))}
                                        {!list.length && <li className='py-2 text-[13px] ol-sub'>None</li>}
                                    </ul>
                                </div>
                            );
                        })}
                    </>
                );
            case 'handling':
                return (
                    <>
                        <H>Mark as read</H>
                        <Radio
                            name='Mark as read'
                            value={prefs.markRead}
                            onChange={(v) => patch({ markRead: v })}
                            options={[
                                ['select', 'Mark items as read when viewed in the reading pane'],
                                ['delay', 'Wait before marking items as read'],
                                ['manual', 'Don’t automatically mark items as read'],
                            ]}
                        />
                        {prefs.markRead === 'delay' && (
                            <select aria-label='Seconds before marking as read' value={prefs.markReadDelay} onChange={(e) => patch({ markReadDelay: Number(e.target.value) })} className='ml-9 mt-1 h-9 w-40 px-2 text-[14px] ol-input'>
                                {[0, 1, 3, 5, 10, 15, 30].map((n) => (
                                    <option key={n} value={n}>
                                        {n} seconds
                                    </option>
                                ))}
                            </select>
                        )}
                    </>
                );
            case 'swipe':
                return (
                    <>
                        <p className='mb-3 text-[13px] ol-sub'>On phones and tablets, swipe a message in the list to act on it.</p>
                        {(['swipeRight', 'swipeLeft'] as const).map((k) => (
                            <label key={k} className='mb-3 block text-[13px] ol-sub'>
                                {k === 'swipeRight' ? 'Swipe right' : 'Swipe left'}
                                <select value={prefs[k]} onChange={(e) => patch({ [k]: e.target.value } as Partial<MailPreferences>)} className='mt-1 block h-9 w-56 px-2 text-[14px] ol-input'>
                                    {SWIPE_ACTIONS.map((a) => (
                                        <option key={a} value={a}>
                                            {a === 'read' ? 'Mark as read / unread' : a === 'none' ? 'No action' : a[0].toUpperCase() + a.slice(1)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ))}
                    </>
                );
            default:
                return null;
        }
    })();

    return (
        <div role='dialog' aria-modal='true' aria-label='Mail settings' className={'ol fixed inset-0 z-[95] flex items-center justify-center bg-[rgba(0,0,0,0.4)] sm:p-4 ' + (dark ? 'ol-dark' : '')}>
            <div className='flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden shadow-2xl ol-surface sm:h-[min(90dvh,820px)] sm:rounded-lg'>
                <header className='flex min-h-12 shrink-0 items-center gap-2 border-b px-2 ol-line sm:px-4'>
                    {section && (
                        <button type='button' aria-label='Back to settings' onClick={() => setSection('')} className='flex h-10 w-10 items-center justify-center rounded ol-hover md:hidden'>
                            <ArrowLeft className='h-5 w-5' />
                        </button>
                    )}
                    <h2 className='min-w-0 flex-1 truncate text-[16px] font-semibold'>
                        <span className={section ? 'hidden md:inline' : ''}>Settings</span>
                        {current && <span className='md:hidden'>{current.label}</span>}
                    </h2>
                    <button type='button' aria-label='Close settings' onClick={() => void close()} className='flex h-10 w-10 items-center justify-center rounded ol-hover'>
                        <X className='h-5 w-5' />
                    </button>
                </header>
                <div className='flex min-h-0 flex-1'>
                    <nav aria-label='Settings sections' className={(section ? 'hidden md:block' : 'block') + ' w-full shrink-0 overflow-y-auto border-r py-2 ol-surface2 ol-line md:w-[240px]'}>
                        {['General', 'Mail'].map((g) => (
                            <div key={g} className='mb-2'>
                                <p className='px-4 py-2 text-[12px] font-semibold uppercase tracking-wide ol-sub'>{g}</p>
                                {SECTIONS.filter((s) => s.group === g).map((s) => (
                                    <button key={s.id} type='button' aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)} className={'relative flex min-h-11 w-full items-center gap-3 px-4 text-left text-[14px] ' + (section === s.id ? 'font-semibold ol-selected' : 'ol-hover')}>
                                        {section === s.id && <span className='absolute bottom-2 left-0 top-2 w-[3px] rounded' style={{ background: 'var(--ol-brand)' }} />}
                                        <s.Icon className='h-[18px] w-[18px] shrink-0' />
                                        <span className='flex-1'>{s.label}</span>
                                        <ChevronRight className='h-4 w-4 ol-sub md:hidden' />
                                    </button>
                                ))}
                            </div>
                        ))}
                    </nav>
                    <section className={(section ? 'flex' : 'hidden md:flex') + ' min-w-0 flex-1 flex-col'}>
                        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6'>
                            {current && <h2 className='mb-4 hidden text-[20px] font-semibold md:block'>{current.label}</h2>}
                            {body}
                        </div>
                        <footer className='flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ol-line'>
                            <button type='button' disabled={saving || !dirty} onClick={() => void save()} className='flex h-9 items-center gap-2 rounded px-5 text-[14px] font-semibold ol-primary disabled:opacity-40'>
                                <Save className='h-4 w-4' />
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button type='button' disabled={saving || !dirty} onClick={() => { setPrefs({ ...defaultMailPrefs, ...value }); setDirty(false); setError(''); }} className='h-9 rounded border px-4 text-[14px] ol-line ol-hover disabled:opacity-40'>
                                Discard
                            </button>
                            {error && <p role='alert' className='text-[13px] ol-danger'>{error}</p>}
                            {notice && !error && <p className='text-[13px]' style={{ color: '#107c10' }}>{notice}</p>}
                            {!error && !notice && problems[0] && dirty && <p className='text-[13px] ol-danger'>{problems[0]}</p>}
                        </footer>
                    </section>
                </div>
            </div>
            <datalist id='mail-settings-people'>
                {people.map((p) => (
                    <option key={p.uid} value={p.email}>
                        {p.name}
                    </option>
                ))}
            </datalist>
            {rule && (
                <div role='dialog' aria-modal='true' aria-label='Edit rule' className='fixed inset-0 z-[96] flex items-end justify-center bg-[rgba(0,0,0,0.4)] sm:items-center' onClick={() => setRule(null)}>
                    <div className='flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl ol-surface sm:rounded-lg' onClick={(e) => e.stopPropagation()}>
                        <div className='flex min-h-12 shrink-0 items-center border-b px-4 ol-line'>
                            <h3 className='flex-1 text-[16px] font-semibold'>{rule.index < 0 ? 'Add rule' : 'Edit rule'}</h3>
                            <button type='button' aria-label='Close' onClick={() => setRule(null)} className='flex h-10 w-10 items-center justify-center rounded ol-hover'>
                                <X className='h-5 w-5' />
                            </button>
                        </div>
                        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3'>
                            {(() => {
                                const r = rule.value;
                                const set = (f: Partial<MailRule>) => setRule((x) => (x ? { ...x, value: { ...x.value, ...f } } : x));
                                return (
                                    <>
                                        <label className='block text-[12px] ol-sub'>
                                            Name your rule *<input value={r.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                                        </label>
                                        <p className='pt-1 text-[13px] font-semibold'>When all of these are true</p>
                                        <label className='block text-[12px] ol-sub'>
                                            From
                                            <input list='mail-settings-people' value={r.from} onChange={(e) => set({ from: e.target.value.trim().toLowerCase() })} placeholder='Any sender' className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                                        </label>
                                        <label className='block text-[12px] ol-sub'>
                                            Subject includes
                                            <input value={r.subjectContains} maxLength={120} onChange={(e) => set({ subjectContains: e.target.value })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                                        </label>
                                        <label className='block text-[12px] ol-sub'>
                                            Message body includes
                                            <input value={r.bodyContains} maxLength={120} onChange={(e) => set({ bodyContains: e.target.value })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input' />
                                        </label>
                                        <div className='grid gap-1 sm:grid-cols-3'>
                                            {([['hasAttachment', 'Has attachment'], ['highImportance', 'High importance'], ['sentOnlyToMe', 'Sent only to me']] as const).map(([k, label]) => (
                                                <label key={k} className='flex min-h-9 items-center gap-2 text-[13px]'>
                                                    <input type='checkbox' checked={r[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<MailRule>)} className='h-4 w-4 accent-[#0f6cbd]' />
                                                    {label}
                                                </label>
                                            ))}
                                        </div>
                                        <p className='pt-2 text-[13px] font-semibold'>Do all of the following</p>
                                        <label className='block text-[12px] ol-sub'>
                                            Move to
                                            <select value={r.moveTo} onChange={(e) => set({ moveTo: e.target.value })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input'>
                                                {folderChoices.map(([id, name]) => (
                                                    <option key={id} value={id}>
                                                        {name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className='block text-[12px] ol-sub'>
                                            Categorise
                                            <select value={r.category} onChange={(e) => set({ category: e.target.value })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input'>
                                                <option value=''>No category</option>
                                                {MAIL_CATEGORIES.map((c) => (
                                                    <option key={c}>{c}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className='block text-[12px] ol-sub'>
                                            Focused Inbox
                                            <select value={r.focus} onChange={(e) => set({ focus: e.target.value as MailRule['focus'] })} className='mt-1 h-9 w-full px-2 text-[14px] ol-input'>
                                                <option value=''>Leave as is</option>
                                                <option value='focused'>Always Focused</option>
                                                <option value='other'>Move to Other</option>
                                            </select>
                                        </label>
                                        <div className='grid gap-1 sm:grid-cols-3'>
                                            {([['markRead', 'Mark as read'], ['flag', 'Flag'], ['stop', 'Stop processing more rules']] as const).map(([k, label]) => (
                                                <label key={k} className='flex min-h-9 items-center gap-2 text-[13px]'>
                                                    <input type='checkbox' checked={r[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<MailRule>)} className='h-4 w-4 accent-[#0f6cbd]' />
                                                    {label}
                                                </label>
                                            ))}
                                        </div>
                                        {ruleProblems(r).length > 0 && <p className='text-[13px] ol-danger'>{ruleProblems(r)[0]}</p>}
                                    </>
                                );
                            })()}
                        </div>
                        <div className='flex shrink-0 justify-end gap-2 border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ol-line'>
                            <button type='button' onClick={() => setRule(null)} className='h-9 rounded border px-4 text-[14px] ol-line ol-hover'>
                                Cancel
                            </button>
                            <button
                                type='button'
                                disabled={ruleProblems(rule.value).length > 0}
                                onClick={() => {
                                    const v = rule.value;
                                    patch({ rules: rule.index < 0 ? [...prefs.rules, v] : prefs.rules.map((x, j) => (j === rule.index ? v : x)) });
                                    setRule(null);
                                }}
                                className='h-9 rounded px-5 text-[14px] font-semibold ol-primary disabled:opacity-40'
                            >
                                {rule.index < 0 ? 'Add rule' : 'Update rule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
