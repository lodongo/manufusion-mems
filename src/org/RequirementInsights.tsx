import { useState, type ReactNode } from 'react';
import { AlarmClock, Bell, Check, ChevronRight, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { messageOf } from '../components/screen';
import { Pie, PALETTE } from './PoConsolidation';

// Trace of a released requirement to delivery and payment, its own dashboard, and the requirements dashboard with
// clickable sections (each opens the details), reminders and the delay pyramid.

const API = '/api/org/inventory/requirements';
const BASE = 'organization_home/inventory_requirements';
const GROUP_COLOR: Record<string, string> = { internal: '#3b82f6', external: '#f59e0b', finance: '#10b981' };
const GROUP_LABEL: Record<string, string> = { internal: 'Internal', external: 'External (supplier)', finance: 'Finance' };
const d1 = (n: number) => `${Math.round(n * 10) / 10} d`;

interface Milestone {
    key: string;
    label: string;
    party: string;
    group: string;
    at: string;
}
interface StepRow {
    key: string;
    from: string;
    to: string;
    party: string;
    group: string;
    days: number;
    ongoing: boolean;
}
export interface Trace {
    id: string;
    number: string;
    materialNumber: string;
    material: string;
    warehouse: string;
    unit: string;
    requested: number;
    ordered: number;
    received: number;
    outstanding: number;
    needDate: string;
    expectedDelivery: string;
    plannedSendBy: string;
    supplierLead: number;
    vendor: string;
    orders: string[];
    deliveries: Array<{ po: string; id: string; recNo: string; at: string; date: string; qty: number; ref: string }>;
    invoices: Array<{ id: string; status: string; amount: number; currency: string }>;
    milestones: Milestone[];
    steps: StepRow[];
    byGroup: { internal: number; external: number; finance: number };
    byParty: Array<{ party: string; days: number; pct: number }>;
    totalDays: number;
    stage: string;
    stageLabel: string;
    delivered: boolean;
    deliveredAt: string;
    paid: boolean;
    deliveryExpired: boolean;
    dueSoon: boolean;
    internalDelay: number;
    externalDelay: number;
    overallDelay: number;
    onTime: boolean;
}
interface Reminder {
    id: string;
    requirementId: string;
    number: string;
    date: string;
    note: string;
    due: boolean;
}

function Tile({ k, v, tone = 'text-ink', onClick, hint }: { k: string; v: ReactNode; tone?: string; onClick?: () => void; hint?: string }) {
    const body = (
        <>
            <p className='text-[11px] text-muted'>{k}</p>
            <p className={`text-lg font-semibold ${tone}`}>{v}</p>
            {hint && <p className='text-[10px] text-muted'>{hint}</p>}
        </>
    );
    return onClick ? (
        <button type='button' onClick={onClick} className='flex min-h-16 flex-col items-start rounded-xl border border-line p-2 text-left active:bg-page'>
            {body}
            <span className='mt-auto flex items-center text-[10px] text-brand'>
                Details <ChevronRight className='h-3 w-3' />
            </span>
        </button>
    ) : (
        <div className='rounded-xl border border-line p-2'>{body}</div>
    );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
    return (
        <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <div className='flex items-center justify-between gap-2'>
                <h2 className='text-sm font-semibold text-ink'>{title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}

/** A pop-up with the details of a section: its own action bar, the table scrolls inside. */
export function DetailSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    return (
        <div className='fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center' role='dialog' aria-modal='true' aria-label={title}>
            <div className='flex h-[85dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-page sm:rounded-2xl'>
                <div className='flex shrink-0 items-center justify-between gap-2 border-b border-line p-3'>
                    <h2 className='text-sm font-semibold text-ink'>{title}</h2>
                    <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center text-muted'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <div className='min-h-0 flex-1 overflow-hidden p-2'>{children}</div>
            </div>
        </div>
    );
}

function Bars({ rows, max, color = 'bg-sky-500', onClick }: { rows: Array<{ label: string; value: number; text?: string }>; max?: number; color?: string; onClick?: (label: string) => void }) {
    const m = max ?? Math.max(1, ...rows.map((r) => r.value));
    return (
        <ul className='space-y-1'>
            {rows.map((r) => (
                <li key={r.label}>
                    <button type='button' disabled={!onClick} onClick={() => onClick?.(r.label)} className='w-full text-left'>
                        <div className='flex justify-between text-xs'>
                            <span className='min-w-0 flex-1 truncate text-ink'>{r.label}</span>
                            <span className='shrink-0 text-muted'>{r.text ?? r.value}</span>
                        </div>
                        <div className='h-2 overflow-hidden rounded-full bg-page'>
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, (r.value / m) * 100)}%` }} />
                        </div>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function Legend({ items }: { items: Array<{ label: string; value: string; color: string }> }) {
    return (
        <ul className='space-y-1 text-xs'>
            {items.map((i) => (
                <li key={i.label} className='flex items-center gap-2'>
                    <span className='inline-block h-3 w-3 shrink-0 rounded-sm' style={{ background: i.color }} />
                    <span className='min-w-0 flex-1 text-ink'>{i.label}</span>
                    <span className='text-muted'>{i.value}</span>
                </li>
            ))}
        </ul>
    );
}

// ----- One requirement: trace and dashboard -----

function Reminders({ requirementId, reminders, onChange }: { requirementId: string; reminders: Reminder[]; onChange: () => void }) {
    const [date, setDate] = useState('');
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState('');
    const today = new Date().toISOString().slice(0, 10);
    const save = async () => {
        setProblem('');
        try {
            await callBackend(`${API}/reminder`, { action: 'set', requirementId, date, note });
            setDate('');
            setNote('');
            onChange();
        } catch (e) {
            setProblem(messageOf(e));
        }
    };
    return (
        <Card title='My reminders' right={<Bell className='h-4 w-4 text-muted' />}>
            {reminders.map((r) => (
                <div key={r.id} className={`flex items-center gap-2 rounded-xl border p-2 text-xs ${r.due ? 'border-amber-500 text-amber-300' : 'border-line text-ink'}`}>
                    <AlarmClock className='h-4 w-4 shrink-0' />
                    <span className='min-w-0 flex-1'>
                        {r.date}: {r.note}
                    </span>
                    <button type='button' aria-label='Done' onClick={() => void callBackend(`${API}/reminder`, { action: 'done', id: r.id }).then(onChange)} className='flex h-11 w-11 items-center justify-center text-emerald-400'>
                        <Check className='h-4 w-4' />
                    </button>
                </div>
            ))}
            <div className='grid grid-cols-2 gap-2'>
                <Field id='rm-date' label='Remind me on' type='date' min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                <Field id='rm-note' label='What to follow up' value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            </div>
            {problem && <Alert tone='error'>{problem}</Alert>}
            <Button variant='secondary' disabled={!date || date < today || note.trim().length < 3} onClick={() => void save()}>
                <Bell className='mr-1 h-4 w-4' /> Set reminder
            </Button>
        </Card>
    );
}

export function RequirementTrace({ id, view }: { id: string; view: 'trace' | 'dashboard' }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ trace: Trace; reminders: Reminder[]; released: boolean }>(`${API}/trace`, { id }), [id]);
    const [by, setBy] = useState<'group' | 'step' | 'party'>('group');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Trace not available.'}</Alert>;
    const t = data.trace;
    const slices =
        by === 'group'
            ? (['internal', 'external', 'finance'] as const).filter((g) => t.byGroup[g] > 0).map((g) => ({ label: GROUP_LABEL[g], value: t.byGroup[g], color: GROUP_COLOR[g] }))
            : by === 'party'
              ? t.byParty.filter((p) => p.days > 0).map((p, i) => ({ label: p.party, value: p.days, color: PALETTE[i % PALETTE.length] }))
              : t.steps.filter((s) => s.days > 0).map((s, i) => ({ label: s.to, value: s.days, color: PALETTE[i % PALETTE.length] }));
    const total = slices.reduce((s, x) => s + x.value, 0);
    const delayTone = (n: number) => (n > 0 ? 'text-red-400' : 'text-emerald-400');
    const banner = !data.released ? <Alert tone='info'>Not released by the stores yet: the trace grows as it moves on.</Alert> : t.deliveryExpired ? <Alert tone='error'>Expected delivery {t.expectedDelivery} has passed and {t.outstanding} {t.unit} is still outstanding.</Alert> : t.dueSoon ? <Alert tone='warn'>Delivery expected {t.expectedDelivery}.</Alert> : null;
    if (view === 'dashboard')
        return (
            <div className='space-y-3'>
                {banner}
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                    <Tile k='Stage now' v={t.stageLabel} />
                    <Tile k='Total elapsed' v={d1(t.totalDays)} />
                    <Tile k='Internal' v={d1(t.byGroup.internal)} />
                    <Tile k='External (supplier)' v={d1(t.byGroup.external)} />
                    <Tile k='Internal delay' v={d1(t.internalDelay)} tone={delayTone(t.internalDelay)} hint={t.plannedSendBy ? `Order should go out by ${t.plannedSendBy}` : undefined} />
                    <Tile k='External delay' v={d1(t.externalDelay)} tone={delayTone(t.externalDelay)} hint={t.expectedDelivery ? `Expected ${t.expectedDelivery}` : 'Not ordered yet'} />
                    <Tile k='Against need date' v={t.overallDelay > 0 ? `${d1(t.overallDelay)} late` : t.delivered ? 'On time' : `${d1(-t.overallDelay)} left`} tone={delayTone(t.overallDelay)} hint={t.needDate ? `Needed ${t.needDate}` : undefined} />
                    <Tile k='Finance' v={t.paid ? `Paid in ${d1(t.byGroup.finance)}` : t.invoices.length ? 'Invoiced' : t.delivered ? 'Not invoiced' : '-'} />
                </div>
                <Card title='Quantities'>
                    <Bars rows={[{ label: 'Requested', value: t.requested }, { label: 'Ordered', value: t.ordered }, { label: 'Received', value: t.received }, { label: 'Outstanding', value: t.outstanding }]} color='bg-emerald-500' />
                    <p className='text-[11px] text-muted'>
                        {t.unit} · supplier {t.vendor || '-'} · orders {t.orders.join(', ') || '-'} · lead time {t.supplierLead || '-'} d
                    </p>
                </Card>
                <Card title='Internal against external'>
                    <div className='grid grid-cols-1 items-center gap-3 sm:grid-cols-2'>
                        <Pie slices={(['internal', 'external', 'finance'] as const).filter((g) => t.byGroup[g] > 0).map((g) => ({ label: GROUP_LABEL[g], value: t.byGroup[g], color: GROUP_COLOR[g] }))} size={160} />
                        <Legend items={(['internal', 'external', 'finance'] as const).map((g) => ({ label: GROUP_LABEL[g], value: d1(t.byGroup[g]), color: GROUP_COLOR[g] }))} />
                    </div>
                </Card>
                <Reminders requirementId={id} reminders={data.reminders} onChange={reload} />
            </div>
        );
    return (
        <div className='space-y-3'>
            {banner}
            <Card
                title={`Where the ${d1(t.totalDays)} went`}
                right={
                    <div role='tablist' aria-label='Split by' className='flex gap-1 rounded-xl border border-line p-1 text-xs'>
                        {(['group', 'step', 'party'] as const).map((k) => (
                            <button key={k} type='button' role='tab' aria-selected={by === k} onClick={() => setBy(k)} className={`min-h-9 rounded-lg px-2 ${by === k ? 'bg-brand text-white' : 'text-muted'}`}>
                                {k === 'group' ? 'Internal / external' : k === 'step' ? 'Step' : 'Who'}
                            </button>
                        ))}
                    </div>
                }
            >
                {total > 0 ? (
                    <div className='grid grid-cols-1 items-center gap-3 sm:grid-cols-2'>
                        <Pie slices={slices} size={170} />
                        <Legend items={slices.map((s) => ({ label: s.label, value: `${d1(s.value)} · ${Math.round((s.value / total) * 1000) / 10}%`, color: s.color }))} />
                    </div>
                ) : (
                    <p className='text-sm text-muted'>The breakdown appears once a second milestone is reached.</p>
                )}
            </Card>
            <Card title='Trace'>
                <ol className='space-y-2'>
                    {t.milestones.map((m, i) => {
                        const step = t.steps.find((s) => s.key === m.key && !s.ongoing);
                        return (
                            <li key={m.key} className='flex gap-2'>
                                <span className='mt-1 inline-block h-3 w-3 shrink-0 rounded-full' style={{ background: GROUP_COLOR[m.group] }} />
                                <div className='min-w-0 flex-1'>
                                    <p className='text-sm text-ink'>{m.label}</p>
                                    <p className='text-xs text-muted'>
                                        {fmtDate(m.at)} · {m.party}
                                        {i > 0 && step ? ` · ${d1(step.days)} after the previous step` : ''}
                                    </p>
                                </div>
                            </li>
                        );
                    })}
                    {t.steps.filter((s) => s.ongoing).map((s) => (
                        <li key={`now-${s.key}`} className='flex gap-2'>
                            <span className='mt-1 inline-block h-3 w-3 shrink-0 animate-pulse rounded-full border-2' style={{ borderColor: GROUP_COLOR[s.group] }} />
                            <div className='min-w-0 flex-1'>
                                <p className='text-sm text-amber-300'>{s.to}</p>
                                <p className='text-xs text-muted'>
                                    {s.party} · waiting {d1(s.days)} so far
                                </p>
                            </div>
                        </li>
                    ))}
                </ol>
            </Card>
            {t.deliveries.length > 0 && (
                <Card title='Deliveries'>
                    <ul className='space-y-1 text-xs text-ink'>
                        {t.deliveries.map((x) => (
                            <li key={x.id} className='flex justify-between border-b border-line py-1'>
                                <span>
                                    {x.recNo} · {x.date} · {x.ref}
                                </span>
                                <span className='text-muted'>
                                    {x.qty} {t.unit}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

// ----- Requirements dashboard -----

interface Brief {
    id: string;
    number: string;
    materialNumber: string;
    material: string;
    warehouse: string;
    unit: string;
    requested: number;
    ordered: number;
    received: number;
    outstanding: number;
    needDate: string;
    expectedDelivery: string;
    vendor: string;
    orders: string;
    stageLabel: string;
    internalDays: number;
    externalDays: number;
    financeDays: number;
    internalDelay: number;
    externalDelay: number;
    overallDelay: number;
    bucket: string;
    delivered: boolean;
    paid: boolean;
    deliveryExpired: boolean;
    dueSoon: boolean;
}
interface Dash {
    counts: { traced: number; delivered: number; awaiting: number; expired: number; dueSoon: number; notOrdered: number; awaitingPayment: number; paid: number };
    averages: { internalDays: number; externalDays: number; financeDays: number; internalDelay: number; externalDelay: number; overallDelay: number; onTimePct: number; cycleDays: number };
    split: Array<{ key: string; label: string; days: number }>;
    steps: Array<{ key: string; label: string; group: string; avgDays: number; count: number }>;
    pyramid: Array<{ key: string; label: string; count: number }>;
    funnel: Array<{ label: string; count: number }>;
    vendors: Array<{ vendor: string; deliveries: number; onTimePct: number; avgDelay: number; avgDays: number }>;
    trend: Array<{ month: string; internal: number; external: number }>;
    rows: Brief[];
    awaitingMaterials: Array<{ materialNumber: string; material: string; warehouse: string; unit: string; outstanding: number; nextExpected: string; expired: boolean; requirements: string; physical: number }>;
    emptyBins: Array<{ bin: string; materialNumber: string; material: string; warehouse: string; outstanding: number; nextExpected: string; expired: boolean; requirements: string; physical: number }>;
    reminders: Reminder[];
    autoReminders: Array<{ id: string; number: string; material: string; expectedDelivery: string; kind: string; vendor: string }>;
}

const BRIEF_COLS: Array<Column<Brief>> = [
    { key: 'number', label: 'Requirement', value: (r) => r.number, render: (r) => <span className='font-semibold text-ink'>{r.number}</span> },
    { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.material}` },
    { key: 'stageLabel', label: 'Stage', value: (r) => r.stageLabel },
    { key: 'expectedDelivery', label: 'Expected', type: 'date', value: (r) => r.expectedDelivery, render: (r) => <span className={r.deliveryExpired ? 'text-red-400' : r.dueSoon ? 'text-amber-300' : ''}>{r.expectedDelivery || '-'}</span> },
    { key: 'outstanding', label: 'Outstanding', type: 'number', value: (r) => r.outstanding, render: (r) => `${r.outstanding} ${r.unit}` },
    { key: 'overallDelay', label: 'Delay (days)', type: 'number', value: (r) => r.overallDelay, render: (r) => <span className={r.overallDelay > 0 ? 'text-red-400' : 'text-emerald-400'}>{r.overallDelay}</span> },
    { key: 'internalDelay', label: 'Internal delay', type: 'number', value: (r) => r.internalDelay, hidden: true },
    { key: 'externalDelay', label: 'External delay', type: 'number', value: (r) => r.externalDelay, hidden: true },
    { key: 'internalDays', label: 'Internal days', type: 'number', value: (r) => r.internalDays, hidden: true },
    { key: 'externalDays', label: 'External days', type: 'number', value: (r) => r.externalDays, hidden: true },
    { key: 'financeDays', label: 'Finance days', type: 'number', value: (r) => r.financeDays, hidden: true },
    { key: 'vendor', label: 'Supplier', value: (r) => r.vendor },
    { key: 'orders', label: 'Orders', value: (r) => r.orders, hidden: true },
    { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse, hidden: true },
    { key: 'needDate', label: 'Needed by', type: 'date', value: (r) => r.needDate, hidden: true },
];

type Sheet = { title: string; kind: 'rows'; rows: Brief[] } | { title: string; kind: 'materials'; rows: Dash['awaitingMaterials'] } | { title: string; kind: 'bins'; rows: Dash['emptyBins'] } | null;

export function RequirementsDashboard() {
    const [from, setFrom] = useState('');
    const { data, error, loading, reload } = useLoad(() => callBackend<Dash>(`${API}/dashboard`, { from }), [from]);
    const [sheet, setSheet] = useState<Sheet>(null);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the dashboard.'}</Alert>;
    const rowsWhere = (title: string, f: (r: Brief) => boolean) => setSheet({ title, kind: 'rows', rows: data.rows.filter(f) });
    const a = data.averages;
    const c = data.counts;
    const splitTotal = data.split.reduce((s, x) => s + x.days, 0);
    const pyMax = Math.max(1, ...data.pyramid.map((p) => p.count));
    const trendMax = Math.max(1, ...data.trend.flatMap((t) => [t.internal, t.external]));
    return (
        <div className='h-full space-y-3 overflow-y-auto overscroll-contain pb-6'>
            <div className='flex items-end gap-2'>
                <Field id='rd-from' label='Raised from (optional)' type='date' value={from} onChange={(e) => setFrom(e.target.value)} />
                <Button variant='secondary' onClick={reload}>
                    Refresh
                </Button>
            </div>
            {(data.reminders.some((r) => r.due) || data.autoReminders.length > 0) && (
                <Card title='Reminders' right={<Bell className='h-4 w-4 text-amber-300' />}>
                    <ul className='space-y-1 text-xs'>
                        {data.reminders.filter((r) => r.due).map((r) => (
                            <li key={r.id}>
                                <button type='button' className='w-full text-left text-amber-300' onClick={() => navigate(`${BASE}/${r.requirementId}`)}>
                                    ⏰ {r.number} · {r.date}: {r.note}
                                </button>
                            </li>
                        ))}
                        {data.autoReminders.slice(0, 8).map((r) => (
                            <li key={r.id}>
                                <button type='button' className={`w-full text-left ${r.kind === 'expired' ? 'text-red-400' : 'text-ink'}`} onClick={() => navigate(`${BASE}/${r.id}`)}>
                                    {r.kind === 'expired' ? '⚠ Overdue' : '• Due soon'} · {r.number} · {r.material} · {r.expectedDelivery}
                                    {r.vendor ? ` · ${r.vendor}` : ''}
                                </button>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Tile k='Avg internal' v={d1(a.internalDays)} tone='text-sky-300' hint={`delay ${d1(a.internalDelay)}`} onClick={() => rowsWhere('Internal delays', (r) => r.internalDelay > 0)} />
                <Tile k='Avg external (supplier)' v={d1(a.externalDays)} tone='text-amber-300' hint={`delay ${d1(a.externalDelay)}`} onClick={() => rowsWhere('External delays', (r) => r.externalDelay > 0)} />
                <Tile k='On time' v={`${a.onTimePct}%`} tone={a.onTimePct >= 80 ? 'text-emerald-400' : 'text-amber-300'} hint={`${c.delivered} delivered`} onClick={() => rowsWhere('Delivered', (r) => r.delivered)} />
                <Tile k='Raise to payment' v={d1(a.cycleDays)} hint={`finance ${d1(a.financeDays)}`} onClick={() => rowsWhere('Paid', (r) => r.paid)} />
                <Tile k='Undelivered' v={c.awaiting} tone={c.awaiting ? 'text-amber-300' : 'text-emerald-400'} onClick={() => rowsWhere('Undelivered', (r) => !r.delivered)} />
                <Tile k='Expired delivery dates' v={c.expired} tone={c.expired ? 'text-red-400' : 'text-emerald-400'} onClick={() => rowsWhere('Expired delivery dates', (r) => r.deliveryExpired)} />
                <Tile k='Due in 7 days' v={c.dueSoon} onClick={() => rowsWhere('Due in the next 7 days', (r) => r.dueSoon)} />
                <Tile k='Not yet ordered' v={c.notOrdered} onClick={() => rowsWhere('Released, not yet ordered', (r) => !r.ordered)} />
                <Tile k='Materials awaiting delivery' v={data.awaitingMaterials.length} onClick={() => setSheet({ title: 'Materials awaiting delivery', kind: 'materials', rows: data.awaitingMaterials })} />
                <Tile k='Empty bins awaiting delivery' v={data.emptyBins.length} tone={data.emptyBins.length ? 'text-red-400' : 'text-emerald-400'} onClick={() => setSheet({ title: 'Empty bins awaiting delivery', kind: 'bins', rows: data.emptyBins })} />
                <Tile k='Delivered, not paid' v={c.awaitingPayment} onClick={() => rowsWhere('Delivered, not paid', (r) => r.delivered && !r.paid)} />
                <Tile k='Traced requirements' v={c.traced} onClick={() => rowsWhere('All released requirements', () => true)} />
            </div>
            <Card title='Where the time goes: internal against external'>
                {splitTotal > 0 ? (
                    <div className='grid grid-cols-1 items-center gap-3 sm:grid-cols-2'>
                        <Pie slices={data.split.filter((s) => s.days > 0).map((s) => ({ label: s.label, value: s.days, color: GROUP_COLOR[s.key] }))} size={170} />
                        <Legend items={data.split.map((s) => ({ label: s.label, value: `${Math.round((s.days / splitTotal) * 1000) / 10}%`, color: GROUP_COLOR[s.key] }))} />
                    </div>
                ) : (
                    <p className='text-sm text-muted'>No elapsed time yet.</p>
                )}
            </Card>
            <Card title='Delay pyramid (against the date needed)'>
                <div className='space-y-1'>
                    {[...data.pyramid].reverse().map((p) => (
                        <button key={p.key} type='button' onClick={() => rowsWhere(p.label, (r) => r.bucket === p.key && (r.delivered || r.overallDelay > 0))} className='flex w-full items-center justify-center'>
                            <div className={`flex min-h-9 items-center justify-center rounded-md text-xs text-white ${p.key === 'on_time' ? 'bg-emerald-600' : p.key === 'd1_7' ? 'bg-amber-500' : p.key === 'd8_14' ? 'bg-orange-500' : 'bg-red-600'}`} style={{ width: `${30 + (p.count / pyMax) * 70}%` }}>
                                {p.label}: {p.count}
                            </div>
                        </button>
                    ))}
                </div>
            </Card>
            <Card title='Slowest steps (average days)'>
                <Bars rows={data.steps.slice(0, 10).map((s) => ({ label: `${s.label} · ${GROUP_LABEL[s.group] ?? s.group}`, value: s.avgDays, text: `${d1(s.avgDays)} (${s.count})` }))} color='bg-sky-500' />
            </Card>
            <Card title='Where requirements are now'>
                <Bars rows={data.funnel.map((f) => ({ label: f.label, value: f.count }))} color='bg-emerald-500' onClick={(label) => rowsWhere(label, (r) => r.stageLabel === label)} />
            </Card>
            <Card title='Suppliers: delivery performance'>
                {!data.vendors.length ? (
                    <p className='text-sm text-muted'>No delivered requirements yet.</p>
                ) : (
                    <ul className='space-y-1 text-xs'>
                        {data.vendors.map((v) => (
                            <li key={v.vendor}>
                                <button type='button' className='flex w-full justify-between border-b border-line py-1 text-left' onClick={() => rowsWhere(v.vendor, (r) => r.vendor === v.vendor)}>
                                    <span className='text-ink'>{v.vendor}</span>
                                    <span className={v.onTimePct >= 80 ? 'text-emerald-400' : 'text-amber-300'}>
                                        {v.onTimePct}% on time · {d1(v.avgDays)} · late {d1(v.avgDelay)} · {v.deliveries}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            {data.trend.length > 0 && (
                <Card title='Trend by month delivered (average days)'>
                    <div className='flex h-36 items-end gap-2 overflow-x-auto'>
                        {data.trend.map((t) => (
                            <div key={t.month} className='flex min-w-10 flex-col items-center gap-1'>
                                <div className='flex h-28 items-end gap-0.5'>
                                    <div className='w-3 rounded-t bg-sky-500' style={{ height: `${(t.internal / trendMax) * 100}%` }} title={`Internal ${t.internal}`} />
                                    <div className='w-3 rounded-t bg-amber-500' style={{ height: `${(t.external / trendMax) * 100}%` }} title={`External ${t.external}`} />
                                </div>
                                <span className='text-[10px] text-muted'>{t.month.slice(2)}</span>
                            </div>
                        ))}
                    </div>
                    <Legend items={[{ label: 'Internal', value: '', color: GROUP_COLOR.internal }, { label: 'External (supplier)', value: '', color: GROUP_COLOR.external }]} />
                </Card>
            )}
            {sheet && (
                <DetailSheet title={`${sheet.title} (${sheet.rows.length})`} onClose={() => setSheet(null)}>
                    {sheet.kind === 'rows' && <RichTable id='inv.requirements.dash.rows' tabKey='rows' columns={BRIEF_COLS} rows={sheet.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/${r.id}`)} empty='Nothing here.' fileName='requirements-detail' height='h-full' rowClassName={(r) => (r.deliveryExpired ? 'bg-red-500/10' : '')} />}
                    {sheet.kind === 'materials' && (
                        <RichTable
                            id='inv.requirements.dash.materials'
                            tabKey='materials'
                            columns={[
                                { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.material}` },
                                { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
                                { key: 'outstanding', label: 'Outstanding', type: 'number', value: (r) => r.outstanding, render: (r) => `${r.outstanding} ${r.unit}` },
                                { key: 'physical', label: 'In stock', type: 'number', value: (r) => r.physical },
                                { key: 'nextExpected', label: 'Next expected', type: 'date', value: (r) => r.nextExpected, render: (r) => <span className={r.expired ? 'text-red-400' : ''}>{r.nextExpected || '-'}</span> },
                                { key: 'requirements', label: 'Requirements', value: (r) => r.requirements },
                            ]}
                            rows={sheet.rows}
                            rowKey={(r) => `${r.materialNumber}-${r.warehouse}`}
                            empty='Nothing awaiting delivery.'
                            fileName='materials-awaiting-delivery'
                            height='h-full'
                        />
                    )}
                    {sheet.kind === 'bins' && (
                        <RichTable
                            id='inv.requirements.dash.bins'
                            tabKey='bins'
                            columns={[
                                { key: 'bin', label: 'Bin', value: (r) => r.bin },
                                { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.material}` },
                                { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
                                { key: 'outstanding', label: 'On its way', type: 'number', value: (r) => r.outstanding },
                                { key: 'nextExpected', label: 'Expected', type: 'date', value: (r) => r.nextExpected, render: (r) => <span className={r.expired ? 'text-red-400' : ''}>{r.nextExpected || '-'}</span> },
                                { key: 'requirements', label: 'Requirements', value: (r) => r.requirements },
                            ]}
                            rows={sheet.rows}
                            rowKey={(r) => `${r.bin}-${r.materialNumber}`}
                            empty='No empty bins are waiting for a delivery.'
                            fileName='empty-bins-awaiting-delivery'
                            height='h-full'
                        />
                    )}
                </DetailSheet>
            )}
            <p className='text-[11px] text-muted'>
                Internal: from the requirement being raised until the order goes to the supplier. External: from the order going out until delivered in full. Delays: internal against need date − supplier lead time; external against the expected delivery. <Badge tone='brand'>Tap any tile for details</Badge>
            </p>
        </div>
    );
}
