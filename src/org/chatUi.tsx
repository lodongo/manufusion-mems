import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CheckCheck, Clock3, Users } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { DEFAULT_CHAT_SETTINGS, type ChatPerson, type ChatSettingsValue } from './chatTypes';

// ---------------------------------------------------------------------------
// Shared pieces of the WhatsApp-style chat: settings, colours, avatars, ticks and time labels.
// ---------------------------------------------------------------------------

/** True when the organization theme behind the chat is dark (used by the "System" appearance). */
function tenantIsDark(): boolean {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-page').trim().split(/\s+/).map(Number);
        if (raw.length < 3 || raw.some((n) => !Number.isFinite(n))) return true;
        const [r, g, b] = raw;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    } catch {
        return false;
    }
}

export function chatIsDark(settings: ChatSettingsValue): boolean {
    return settings.appearance === 'dark' || (settings.appearance === 'system' && tenantIsDark());
}

export const FONT_PX: Record<ChatSettingsValue['fontSize'], number> = { small: 14, medium: 15.5, large: 17.5 };

/** Personal chat settings with optimistic saving; every change is validated and audited on the server. */
export function useChatSettings() {
    const [settings, setSettings] = useState<ChatSettingsValue>(DEFAULT_CHAT_SETTINGS);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        let alive = true;
        void callBackend<{ settings: ChatSettingsValue }>('/api/org/quick/chat/preferences')
            .then((r) => { if (alive && r.settings) setSettings({ ...DEFAULT_CHAT_SETTINGS, ...r.settings }); })
            .catch(() => undefined)
            .finally(() => { if (alive) setLoaded(true); });
        return () => { alive = false; };
    }, []);
    const save = useCallback(async (patch: Partial<ChatSettingsValue>) => {
        let before: ChatSettingsValue | null = null;
        setSettings((s) => { before = s; return { ...s, ...patch }; });
        try {
            await callBackend('/api/org/quick/chat/preferences/save', { mode: 'settings', settings: patch });
        } catch (e) {
            if (before) setSettings(before);
            throw e;
        }
    }, []);
    return { settings, loaded, save };
}

/** Root of every chat screen: the WhatsApp palette in light or dark. */
export function WaShell({ settings, className = '', children }: { settings: ChatSettingsValue; className?: string; children: ReactNode }) {
    return (
        <div className={`wa ${chatIsDark(settings) ? 'wa-dark' : ''} ${className}`} style={{ fontSize: FONT_PX[settings.fontSize] } as CSSProperties}>
            {children}
        </div>
    );
}

export const WALLPAPERS: Array<{ id: string; label: string; light: string; dark: string }> = [
    { id: 'default', label: 'Default', light: '', dark: '' },
    { id: 'ocean', label: 'Ocean', light: '#dbeafe', dark: '#0c1d33' },
    { id: 'forest', label: 'Forest', light: '#dcfce7', dark: '#0d2016' },
    { id: 'rose', label: 'Rose', light: '#ffe4e6', dark: '#2a1218' },
    { id: 'amber', label: 'Sand', light: '#fef3c7', dark: '#271d0a' },
    { id: 'slate', label: 'Slate', light: '#e2e8f0', dark: '#151c26' },
    { id: 'violet', label: 'Lavender', light: '#ede9fe', dark: '#1b1430' },
];
/** Background of a conversation: the patterned default, or a solid wallpaper colour. */
export function wallStyle(id: string, dark: boolean): { className: string; style?: CSSProperties } {
    const w = WALLPAPERS.find((x) => x.id === id);
    if (!w || !w.light) return { className: 'wa-wall' };
    return { className: 'wa-wall', style: { backgroundColor: dark ? w.dark : w.light } };
}

const AVATAR_TONES = ['#25d366', '#53bdeb', '#ff8a65', '#ba68c8', '#ffd54f', '#4db6ac', '#f06292', '#7986cb'];
function toneOf(seed: string) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

export function WaAvatar({ person, size = 40, group = false, online = false }: { person?: ChatPerson; size?: number; group?: boolean; online?: boolean }) {
    const name = person?.name || 'Member';
    const initials = name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
    return (
        <span className='relative inline-flex shrink-0' style={{ width: size, height: size }}>
            <span className='flex h-full w-full items-center justify-center overflow-hidden rounded-full font-semibold text-[#fff]' style={{ background: group ? '#8696a0' : toneOf(person?.uid || name), fontSize: Math.round(size * 0.38) }} aria-label={group ? 'Group' : name}>
                {group ? <Users style={{ width: size * 0.5, height: size * 0.5 }} /> : person?.photoUrl ? <img src={person.photoUrl} alt={name} className='h-full w-full object-cover' loading='lazy' /> : initials}
            </span>
            {online && <span className='absolute bottom-0 right-0 rounded-full border-2' style={{ width: size * 0.28, height: size * 0.28, background: 'var(--wa-badge)', borderColor: 'var(--wa-panel)' }} aria-label='Online' />}
        </span>
    );
}

export type TickState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export function Ticks({ state, onImage = false }: { state: TickState; onImage?: boolean }) {
    const base = onImage ? '#ffffff' : 'var(--wa-sub)';
    if (state === 'pending') return <Clock3 className='h-[14px] w-[14px] shrink-0' style={{ color: base }} aria-label='Sending' />;
    if (state === 'failed') return <span className='text-[11px] font-semibold' style={{ color: 'var(--wa-danger)' }}>!</span>;
    if (state === 'sent') return <Check className='h-[15px] w-[15px] shrink-0' style={{ color: base }} aria-label='Sent' />;
    return <CheckCheck className='h-[16px] w-[16px] shrink-0' style={{ color: state === 'read' ? 'var(--wa-read)' : base }} aria-label={state === 'read' ? 'Read' : 'Delivered'} />;
}

/** Delivery state of my message: read / delivered by everyone else in the conversation, else sent. */
export function tickState(createdAt: string, others: string[], readMarks: Array<{ uid: string; readAt: string }>, deliveryMarks: Array<{ uid: string; at: string }>): TickState {
    if (!others.length) return 'sent';
    const t = Date.parse(createdAt);
    const read = new Map(readMarks.map((r) => [r.uid, Date.parse(r.readAt)]));
    const got = new Map(deliveryMarks.map((r) => [r.uid, Date.parse(r.at)]));
    if (others.every((u) => (read.get(u) ?? 0) >= t)) return 'read';
    if (others.every((u) => Math.max(got.get(u) ?? 0, read.get(u) ?? 0) >= t)) return 'delivered';
    return 'sent';
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export function clock(iso: string): string {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
/** Inbox time: time today, "Yesterday", weekday this week, else the date. */
export function inboxTime(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const now = new Date();
    if (sameDay(d, now)) return clock(iso);
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString();
}
/** Centered date chip inside a conversation. */
export function dayChip(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const now = new Date();
    if (sameDay(d, now)) return 'Today';
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export function lastSeenText(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const now = new Date();
    if (sameDay(d, now)) return 'last seen today at ' + clock(iso);
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'last seen yesterday at ' + clock(iso);
    return 'last seen ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' at ' + clock(iso);
}

/** Short, soft notification tone (no audio file needed). Silently does nothing where audio is blocked. */
export function playTone() {
    try {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!Ctx) return;
        const ctx = new Ctx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(880, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.09);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.24);
        setTimeout(() => void ctx.close().catch(() => undefined), 400);
    } catch {
        /* Audio unavailable: the badge still shows the new message. */
    }
}

/** A message made of 1–3 emoji only is shown large, without a bubble, as in WhatsApp. */
export function isEmojiOnly(text: string): boolean {
    const t = text.trim();
    if (!t || t.length > 24) return false;
    try {
        return /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\s*){1,3}$/u.test(t);
    } catch {
        return false;
    }
}

export function fileSize(n: number): string {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' kB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Full-screen sheet used by chat sub-pages (settings, info, new chat). Header stays on top, content scrolls. */
export function WaPage({ title, subtitle, onBack, actions, children }: { title: ReactNode; subtitle?: ReactNode; onBack: () => void; actions?: ReactNode; children: ReactNode }) {
    return (
        <div className='flex h-full min-h-0 flex-col wa-panel'>
            <header className='flex min-h-14 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)] wa-bar'>
                <button type='button' aria-label='Back' onClick={onBack} className='flex h-11 w-11 items-center justify-center rounded-full wa-hover'>
                    <svg viewBox='0 0 24 24' className='h-6 w-6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M19 12H5' /><path d='M12 19l-7-7 7-7' /></svg>
                </button>
                <div className='min-w-0 flex-1'>
                    <h2 className='truncate text-[1.1em] font-medium'>{title}</h2>
                    {subtitle && <p className='truncate text-[0.8em] wa-sub'>{subtitle}</p>}
                </div>
                {actions}
            </header>
            <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain wa-scroll'>{children}</div>
        </div>
    );
}

/** WhatsApp-style settings row with an optional switch. */
export function WaRow({ icon, title, detail, onClick, toggle, danger = false, right }: { icon?: ReactNode; title: ReactNode; detail?: ReactNode; onClick?: () => void; toggle?: boolean; danger?: boolean; right?: ReactNode }) {
    const content = (
        <>
            {icon && <span className={`flex w-10 shrink-0 justify-center ${danger ? 'wa-danger' : 'wa-sub'}`}>{icon}</span>}
            <span className='min-w-0 flex-1 text-left'>
                <span className={`block text-[1em] ${danger ? 'wa-danger' : 'wa-ink'}`}>{title}</span>
                {detail && <span className='block text-[0.82em] leading-snug wa-sub'>{detail}</span>}
            </span>
            {toggle !== undefined && (
                <span role='switch' aria-checked={toggle} className='relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors' style={{ background: toggle ? 'var(--wa-accent)' : 'var(--wa-line)' }}>
                    <span className='inline-block h-5 w-5 rounded-full bg-[#fff] shadow transition-transform' style={{ transform: toggle ? 'translateX(22px)' : 'translateX(2px)' }} />
                </span>
            )}
            {right}
        </>
    );
    return onClick ? (
        <button type='button' onClick={onClick} className='flex min-h-[64px] w-full items-center gap-3 px-4 py-2 wa-hover'>
            {content}
        </button>
    ) : (
        <div className='flex min-h-[64px] w-full items-center gap-3 px-4 py-2'>{content}</div>
    );
}

export function WaSection({ title, children }: { title?: string; children: ReactNode }) {
    return (
        <section className='border-b-[8px] wa-line' style={{ borderColor: 'var(--wa-panel2)' }}>
            {title && <h3 className='px-4 pb-1 pt-4 text-[0.82em] font-medium wa-green'>{title}</h3>}
            {children}
        </section>
    );
}

/** Bottom sheet with a dimmed backdrop. */
export function WaSheet({ title, onClose, children }: { title?: ReactNode; onClose: () => void; children: ReactNode }) {
    return (
        <div className='fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(11,20,26,0.55)] sm:items-center' role='dialog' aria-modal='true' onClick={onClose}>
            <div className='wa-pop max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)] wa-panel sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                {title && <div className='px-5 pb-2 pt-5 text-[1.05em] font-medium wa-ink'>{title}</div>}
                {children}
            </div>
        </div>
    );
}
