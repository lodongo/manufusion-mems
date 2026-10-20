import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Info, PanelLeft, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import { Spinner } from '../admin/kit';
import { Screen } from '../components/screen';

// Shared pieces of the Finance screens. Finance is configured PER LEGAL ENTITY. The legal entity is chosen in the main
// menu (under Finance); every finance screen shows it in its action bar with a status dot and a warning badge that
// explains the per-entity scope. Sections of a screen are a side bar next to the content, never chips.
// Colours carry meaning everywhere in Finance:
//   debit  = sky blue    credit = amber
//   entity: live = glowing green dot, not live = red dot, posting blocked = amber dot, closed = slate dot
//   open / live = green  closing / pending = amber  closed / blocked = slate  locked = red

export const FIN_API = '/api/org/fin';
export const HOME = 'organization_home';
export const go = (path: string) => navigate(`${HOME}/${path}`);
export const fmt = (n: number | null | undefined, dp = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
/** Ask the shell to open its menu (where the legal entity is chosen). */
export const OPEN_MENU_EVENT = 'mems-open-menu';
const LE_EVENT = 'mems-fin-le';
const LE_KEY = 'mems.fin.le';

export interface Entity {
    id: string;
    code: string;
    name: string;
    status: string;
    statusLabel: string;
    functionalCurrency: string;
    goLiveAt: string;
    settingsApproved: boolean;
    ownsCostCenters: boolean;
    can: Record<string, boolean>;
}

// One list of legal entities for the menu and every finance screen (refreshed when older than a minute).
let store: { entities: Entity[] | null; error: string; loading: boolean; at: number } = { entities: null, error: '', loading: false, at: 0 };
const subscribers = new Set<() => void>();
const emit = () => subscribers.forEach((f) => f());
function loadEntities(force = false) {
    if (store.loading || (!force && store.entities && Date.now() - store.at < 60_000)) return;
    store = { ...store, loading: true };
    callBackend<{ entities: Entity[] }>(`${FIN_API}/entities`)
        .then((r) => {
            store = { entities: r.entities, error: '', loading: false, at: Date.now() };
            emit();
        })
        .catch((e: unknown) => {
            store = { ...store, error: e instanceof Error ? e.message : 'Could not load the legal entities.', loading: false, at: Date.now() };
            emit();
        });
}
function readLe(): string {
    try {
        return localStorage.getItem(LE_KEY) ?? '';
    } catch {
        return '';
    }
}
/** Choose the legal entity finance works on (from the menu). */
export function chooseEntity(id: string) {
    try {
        localStorage.setItem(LE_KEY, id);
    } catch {
        /* kept for this page only */
    }
    window.dispatchEvent(new Event(LE_EVENT));
}
/** The legal entities the person can use in finance, and the one chosen in the menu. */
export function useEntity() {
    const [, setTick] = useState(0);
    const [leId, setLeId] = useState<string>(readLe);
    useEffect(() => {
        const refresh = () => setTick((t) => t + 1);
        const pick = () => setLeId(readLe());
        subscribers.add(refresh);
        window.addEventListener(LE_EVENT, pick);
        window.addEventListener('storage', pick);
        loadEntities();
        return () => {
            subscribers.delete(refresh);
            window.removeEventListener(LE_EVENT, pick);
            window.removeEventListener('storage', pick);
        };
    }, []);
    const entities = store.entities;
    const le = entities?.find((e) => e.id === leId) ?? entities?.[0] ?? null;
    return { entities, le, choose: chooseEntity, error: store.error, reload: () => loadEntities(true) };
}

/** Finance status of a legal entity as a dot: glowing green when live, red when not live. */
export function StatusDot({ status, label }: { status: string; label?: string }) {
    const tone =
        status === 'active'
            ? 'bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.75)] animate-pulse'
            : status === 'not_live'
              ? 'bg-red-500'
              : status === 'posting_blocked'
                ? 'bg-amber-400'
                : 'bg-slate-500';
    return (
        <span className='inline-flex shrink-0 items-center'>
            <span aria-hidden='true' className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} />
            <span className='sr-only'>{label ?? status.replace(/_/g, ' ')}</span>
        </span>
    );
}

/** The legal entity in the action bar: status dot, code and a warning badge that explains the per-entity scope. */
export function LeBadge({ le }: { le: Entity }) {
    const [open, setOpen] = useState(false);
    return (
        <div className='relative'>
            <button type='button' aria-expanded={open} aria-label={`${le.code} ${le.name}, ${le.statusLabel}. Finance applies to this legal entity only.`} onClick={() => setOpen(!open)} className='flex h-11 items-center gap-2 rounded-full border border-line px-3 active:bg-panel'>
                <StatusDot status={le.status} label={le.statusLabel} />
                <span className='font-mono text-xs text-ink'>{le.code}</span>
                <AlertTriangle className='h-4 w-4 text-amber-400' />
            </button>
            {open && (
                <>
                    <button type='button' aria-label='Close' className='fixed inset-0 z-30 cursor-default' onClick={() => setOpen(false)} />
                    <div role='note' className='absolute right-0 top-full z-40 mt-2 w-72 max-w-[85vw] space-y-2 rounded-xl border border-amber-500/40 bg-panel p-3 text-xs text-soft shadow-xl'>
                        <p className='flex items-center gap-2 text-sm font-semibold text-amber-200'>
                            <AlertTriangle className='h-4 w-4' /> Per legal entity
                        </p>
                        <p>
                            Accounts, periods, mapping, taxes and postings here belong to <span className='text-ink'>{le.code} {le.name}</span> only. Changes take effect after a second person approves them.
                        </p>
                        <p className='flex items-center gap-2 text-ink'>
                            <StatusDot status={le.status} label={le.statusLabel} /> {le.statusLabel} · {le.functionalCurrency || 'no currency yet'}
                        </p>
                        <button type='button' className='min-h-11 text-sm font-medium text-brand' onClick={() => { setOpen(false); window.dispatchEvent(new Event(OPEN_MENU_EVENT)); }}>
                            Change the legal entity in the menu
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

/** Legal entity list for the main menu (under Finance). */
export function FinEntityMenu({ onPick }: { onPick: () => void }) {
    const { entities, le } = useEntity();
    if (!entities?.length) return null;
    return (
        <div className='mb-1 rounded-lg border border-slate-800 p-1'>
            <p className='px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted'>Legal entity</p>
            {entities.map((e) => {
                const on = le?.id === e.id;
                return (
                    <button key={e.id} type='button' aria-current={on ? 'true' : undefined} onClick={() => { chooseEntity(e.id); onPick(); }} className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left ${on ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'}`}>
                        <StatusDot status={e.status} label={e.statusLabel} />
                        <span className='font-mono text-xs'>{e.code}</span>
                        <span className='min-w-0 flex-1 truncate text-xs'>{e.name}</span>
                    </button>
                );
            })}
        </div>
    );
}

const STATUS_TONE: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    open: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    approved: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    clean: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    adjusted: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
    not_live: 'bg-red-500/15 text-red-300 ring-red-500/40',
    future: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
    draft: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
    closing: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
    pending: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
    differences: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
    core: 'bg-violet-500/15 text-violet-300 ring-violet-500/40',
    blocked: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
    posting_blocked: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
    closed: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
    withdrawn: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
    locked: 'bg-red-500/15 text-red-300 ring-red-500/40',
    rejected: 'bg-red-500/15 text-red-300 ring-red-500/40',
    failed: 'bg-red-500/15 text-red-300 ring-red-500/40',
};
export function Pill({ status, label }: { status: string; label?: string }) {
    return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_TONE[status] ?? 'bg-slate-500/20 text-slate-300 ring-slate-500/40'}`}>{label ?? status.replace(/_/g, ' ')}</span>;
}

/** Debit and credit, always the same colours, never colour alone (Dr / Cr is written too). */
export const SIDE = {
    D: { label: 'Dr', text: 'text-sky-300', bar: 'border-l-sky-400', chip: 'bg-sky-500/15 text-sky-300 ring-sky-500/40' },
    C: { label: 'Cr', text: 'text-amber-300', bar: 'border-l-amber-400', chip: 'bg-amber-500/15 text-amber-300 ring-amber-500/40' },
};
export function Amount({ side, value, cur }: { side: 'D' | 'C'; value: number; cur?: string }) {
    const s = SIDE[side];
    return (
        <span className={`inline-flex items-center gap-1 font-mono text-sm tabular-nums ${s.text}`}>
            <span className={`rounded px-1 text-[11px] font-semibold ring-1 ${s.chip}`}>{s.label}</span>
            {cur ? `${cur} ` : ''}
            {fmt(value)}
        </span>
    );
}
/** A signed balance: positive is a debit balance, negative a credit balance. */
export function Balance({ value }: { value: number }) {
    if (!value) return <span className='font-mono text-sm text-muted'>0.00</span>;
    return <Amount side={value > 0 ? 'D' : 'C'} value={Math.abs(value)} />;
}
export function Legend() {
    return (
        <p className='flex flex-wrap items-center gap-2 text-xs'>
            <span className={`rounded px-1.5 py-0.5 font-semibold ring-1 ${SIDE.D.chip}`}>Dr debit</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ring-1 ${SIDE.C.chip}`}>Cr credit</span>
        </p>
    );
}

/** A section of a screen, shown in the side bar. */
export interface NavItem<T extends string> {
    value: T;
    label: string;
    icon?: typeof ShieldCheck;
    count?: number;
}

const RAIL_KEY = 'mems.fin.rail';
function readRail(): boolean {
    try {
        return localStorage.getItem(RAIL_KEY) !== 'collapsed';
    } catch {
        return true;
    }
}
function saveRail(open: boolean) {
    try {
        localStorage.setItem(RAIL_KEY, open ? 'open' : 'collapsed');
    } catch {
        /* kept for this page only */
    }
}

/** Side bar of sections with their names. Over the content on phones, beside it on wider screens. */
export function SideBar<T extends string>({ items, value, onChange }: { items: Array<NavItem<T>>; value: T; onChange: (v: T) => void }) {
    return (
        <nav aria-label='Sections' className='h-full w-56 space-y-1 overflow-y-auto overscroll-contain border-r border-line bg-page py-3 pr-2'>
            {items.map((it) => {
                const on = it.value === value;
                const Icon = it.icon;
                return (
                    <button key={it.value} type='button' aria-current={on ? 'page' : undefined} onClick={() => onChange(it.value)} className={`relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${on ? 'bg-emerald-500/10 font-semibold text-emerald-300' : 'text-soft active:bg-panel'}`}>
                        {on && <span aria-hidden='true' className='absolute inset-y-2 left-0 w-1 rounded-full bg-emerald-400' />}
                        {Icon && <Icon className='h-5 w-5 shrink-0' />}
                        <span className='min-w-0 flex-1 truncate'>{it.label}</span>
                        {it.count !== undefined && <span className={`rounded-full px-1.5 text-[11px] ${on ? 'bg-emerald-500/20' : 'bg-line'}`}>{it.count}</span>}
                    </button>
                );
            })}
        </nav>
    );
}

/**
 * Screen frame: the action bar stays on top and only the content scrolls. Sections (when given) are a side bar that
 * collapses completely once a section is chosen, leaving the content the full width; the sections icon in the action
 * bar opens it again. Open or collapsed is remembered on this device.
 */
export function Frame<T extends string>({ title, subtitle, onBack, actions, nav, navValue, onNav, children }: { title: string; subtitle?: string; onBack?: () => void; actions?: ReactNode; nav?: Array<NavItem<T>>; navValue?: T; onNav?: (v: T) => void; children: ReactNode }) {
    const side = !!(nav && nav.length > 0 && navValue !== undefined && onNav);
    const [open, setOpenState] = useState<boolean>(readRail);
    const setOpen = (v: boolean) => {
        setOpenState(v);
        saveRail(v);
    };
    const current = side ? nav!.find((n) => n.value === navValue) : undefined;
    const waiting = side ? nav!.some((n) => (n.count ?? 0) > 0) : false;
    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <header className='shrink-0 border-b border-line bg-page pb-3'>
                <div className='flex items-center gap-2'>
                    {onBack && (
                        <button type='button' aria-label='Back' onClick={onBack} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                            <ArrowLeft className='h-5 w-5' />
                        </button>
                    )}
                    {side && (
                        <button type='button' aria-expanded={open} aria-label={open ? 'Hide the sections' : `Show the sections (now: ${current?.label ?? ''})`} onClick={() => setOpen(!open)} className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${open ? 'border-brand bg-emerald-500/10 text-emerald-300' : 'border-line text-soft'} active:bg-panel`}>
                            <PanelLeft className='h-5 w-5' />
                            {!open && waiting && <span aria-hidden='true' className='absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400' />}
                        </button>
                    )}
                    <div className='min-w-0 flex-1'>
                        <h1 className='truncate text-base font-semibold text-ink sm:text-lg'>{title}</h1>
                        {(side && current ? `${current.label}${subtitle ? ` · ${subtitle}` : ''}` : subtitle) && <p className='truncate text-xs text-muted'>{side && current ? `${current.label}${subtitle ? ` · ${subtitle}` : ''}` : subtitle}</p>}
                    </div>
                    {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
                </div>
            </header>
            {side ? (
                <div className='relative flex min-h-0 flex-1'>
                    {open && (
                        <>
                            <button type='button' aria-label='Hide the sections' onClick={() => setOpen(false)} className='absolute inset-0 z-10 bg-black/50 sm:hidden' />
                            <div className='absolute inset-y-0 left-0 z-20 shadow-2xl sm:static sm:shadow-none'>
                                <SideBar
                                    items={nav!}
                                    value={navValue!}
                                    onChange={(v) => {
                                        onNav!(v);
                                        setOpen(false);
                                    }}
                                />
                            </div>
                        </>
                    )}
                    <div className={`min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3 ${open ? 'sm:pl-3' : ''}`}>{children}</div>
                </div>
            ) : (
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>{children}</div>
            )}
        </div>
    );
}

/** Finance screen: the legal entity chosen in the menu, as a badge in the action bar; optional side bar of sections. */
export function FinScreen<T extends string>({ title, subtitle, onBack, actions, nav, navValue, onNav, entityState, children }: { title: string; subtitle?: string; onBack?: () => void; actions?: ReactNode; nav?: Array<NavItem<T>>; navValue?: T; onNav?: (v: T) => void; entityState: ReturnType<typeof useEntity>; children: (le: Entity) => ReactNode }) {
    const { entities, le, error } = entityState;
    if (error && !entities) return <Alert tone='error'>{error}</Alert>;
    if (!entities) return <Spinner />;
    if (!entities.length)
        return (
            <Frame title={title} onBack={onBack}>
                <Alert tone='info'>You have no finance access in any legal entity. Finance rights are given per legal entity through your job role or security role.</Alert>
            </Frame>
        );
    return (
        <Frame
            title={title}
            subtitle={subtitle}
            onBack={onBack}
            actions={
                <>
                    {actions}
                    {le && <LeBadge le={le} />}
                </>
            }
            nav={nav}
            navValue={navValue}
            onNav={onNav}
        >
            {le ? children(le) : <Spinner />}
        </Frame>
    );
}

/** Who must approve next: level, role and the people who can decide it now. */
export function NextApprover({ next }: { next: { level: string; levelTitle: string; role: string; people: Array<{ uid: string; name: string; role: string }> } | null | undefined }) {
    if (!next) return null;
    return (
        <section className='space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3'>
            <p className='flex items-center gap-2 text-sm font-semibold text-amber-200'>
                <ShieldCheck className='h-4 w-4' /> Next to approve
            </p>
            <p className='text-sm text-ink'>
                {next.level !== 'A' && <span className='font-mono text-xs text-amber-300'>{next.level} {next.levelTitle} · </span>}
                {next.role}
            </p>
            {next.people.length ? (
                <ul className='space-y-1'>
                    {next.people.map((p) => (
                        <li key={p.uid} className='rounded-lg bg-page/60 px-3 py-2'>
                            <span className='block text-sm font-medium text-ink'>{p.name}</span>
                            <span className='block text-xs text-soft'>{p.role}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className='text-xs text-red-300'>Nobody can approve this level yet. Give the approving right (and job role, for amount levels) to someone other than the proposer.</p>
            )}
        </section>
    );
}

export function Pending({ items }: { items: Array<{ id: string; typeLabel?: string; title: string; makerName: string; next?: string }> }) {
    if (!items.length) return null;
    return (
        <div className='space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3'>
            <p className='flex items-center gap-2 text-sm font-semibold text-amber-200'>
                <ShieldCheck className='h-4 w-4' /> Waiting for approval
            </p>
            {items.map((r) => (
                <button key={r.id} type='button' onClick={() => go(`fin_approvals/${r.id}`)} className='block min-h-11 w-full rounded-lg px-2 py-1 text-left text-sm text-amber-100 active:bg-amber-500/10'>
                    <span className='flex items-center gap-2'>
                        <span className='font-mono text-xs'>{r.id}</span>
                        <span className='min-w-0 flex-1 truncate'>{r.title}</span>
                        <span className='shrink-0 text-xs text-amber-300/80'>by {r.makerName}</span>
                    </span>
                    {r.next && <span className='mt-0.5 block text-xs text-amber-200/90'>Next to approve: {r.next}</span>}
                </button>
            ))}
        </div>
    );
}

export function Card({ title, right, children, tone }: { title?: string; right?: ReactNode; children: ReactNode; tone?: 'warn' | 'danger' }) {
    const border = tone === 'warn' ? 'border-amber-500/40' : tone === 'danger' ? 'border-red-500/50' : 'border-line';
    return (
        <section className={`space-y-2 rounded-2xl border ${border} bg-panel p-3`}>
            {(title || right) && (
                <div className='flex items-center justify-between gap-2'>
                    {title && <h2 className='text-sm font-semibold text-ink'>{title}</h2>}
                    {right}
                </div>
            )}
            {children}
        </section>
    );
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
    return (
        <dl className='grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2'>
            {rows.map(([k, v]) => (
                <div key={k} className='flex gap-2'>
                    <dt className='w-36 shrink-0 text-muted'>{k}</dt>
                    <dd className='min-w-0 flex-1 break-words text-ink'>{v === '' || v === null || v === undefined ? '-' : v}</dd>
                </div>
            ))}
        </dl>
    );
}

/** A two or three way choice inside a form (not for sections: those are the side bar). */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
    return (
        <div role='radiogroup' className='inline-flex gap-1 rounded-xl border border-line p-1'>
            {options.map((o) => (
                <button key={o.value} type='button' role='radio' aria-checked={value === o.value} onClick={() => onChange(o.value)} className={`h-11 shrink-0 rounded-lg px-3 text-sm font-medium ${value === o.value ? 'bg-emerald-500/15 text-emerald-300' : 'text-soft active:bg-panel'}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function NotBuilt({ title, note }: { title: string; note: string }) {
    return (
        <Screen title={title} onBack={() => go('module/FIN')}>
            <div className='flex items-start gap-3 rounded-2xl border border-line bg-panel p-4'>
                <Info className='mt-0.5 h-5 w-5 shrink-0 text-sky-300' />
                <div className='space-y-1'>
                    <p className='text-sm font-semibold text-ink'>Not built yet</p>
                    <p className='text-sm text-soft'>{note}</p>
                </div>
            </div>
        </Screen>
    );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error:\s*/, '') : 'Something went wrong.');
