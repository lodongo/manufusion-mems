import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';
import { Segmented } from '../components/screen';
import { scoreColor } from './srmVisuals';
import { BAND_WORD, bandColor, type Band } from './AgreementScorecard';

// A supplier's purchase orders over a period: how many, what they cost, how many are open, overdue or part delivered,
// and how much of what the supplier promised was delivered on time. Every order and line is in a scrolling table that can
// be maximised, and a click opens the purchase order.

const API = '/api/org/procurement/vendors';
const PO_BASE = 'organization_home/procurement_orders';
type Verdict = 'on_time' | 'late' | 'overdue' | 'pending' | 'untimed';

interface Summary {
    orders: number; open: number; overdue: number; partial: number; closed: number; lines: number; value: number; paid: number; pending: number;
    honouredPct: number | null; band: Band; dueOrders: number; honouredOrders: number; lateOrders: number; overdueOrders: number; pendingOrders: number;
    lineHonouredPct: number | null; dueLines: number; honouredLines: number; lateLines: number; overdueLines: number; pendingLines: number;
    avgDaysLate: number | null; fillRatePct: number | null; avgQuotedLead: number | null; avgActualLead: number | null;
    agreementOrders: number; agreementLines: number; agreementValue: number;
}
interface Prev { orders: number; value: number; honouredPct: number | null; avgDaysLate: number | null; fillRatePct: number | null }
interface OrderRow {
    id: string; number: string; status: string; statusLabel: string; live: boolean; partial: boolean; overdue: boolean; orderDate: string; sentOn: string;
    promiseOn: string; deliveredOn: string; verdict: Verdict; verdictLabel: string; daysLate: number; poType: string; lines: number; currency: string;
    total: number; value: number; paid: number; pending: number; agreements: string; receivedPct: number;
}
interface LineRow {
    key: string; orderId: string; orderNumber: string; statusLabel: string; orderDate: string; no: number; item: string; itemCode: string; quantity: number;
    received: number; outstanding: number; unit: string; currency: string; netUnitPrice: number; total: number; base: number; promiseOn: string;
    firstDeliveryOn: string; deliveredOn: string; verdict: Verdict; verdictLabel: string; daysLate: number; quotedLeadDays: number; actualLeadDays: number | null;
    agreementNumber: string; aboveAgreed: boolean; live: boolean; partial: boolean;
}
interface Group { key: string; orders: number; lines: number; value: number; due: number; honoured: number; honouredPct: number | null }
interface Out {
    allowed: boolean; currency: string; period: { key: string; label: string; from: string; to: string };
    thresholds?: { good: number; watch: number }; summary?: Summary; previous?: Prev | null; byMonth?: Group[]; byType?: Group[];
    topItems?: Array<{ item: string; code: string; lines: number; qty: number; value: number; unit: string }>;
    orders?: OrderRow[]; lines?: LineRow[]; truncated?: boolean;
}

const PERIODS = [
    { value: '30d', label: 'Last month' },
    { value: '90d', label: 'Last 3 months' },
    { value: '180d', label: 'Last 6 months' },
    { value: '365d', label: 'Last year' },
    { value: 'ytd', label: 'This year so far' },
    { value: 'all', label: 'All time' },
    { value: 'custom', label: 'Choose dates' },
];
const num = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));
const today = () => new Date().toISOString().slice(0, 10);
/** A calendar day (2026-11-28) as 28 Nov 2026, with no time or time zone shift. */
export const fmtDay = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** Green on time, amber late, red overdue, grey not yet due or no promise date. */
const VERDICT_SCORE: Record<Verdict, number | null> = { on_time: 100, late: 36, overdue: 4, pending: null, untimed: null };
const verdictColor = (v: Verdict, alpha = 1) => scoreColor(VERDICT_SCORE[v], alpha);
export function VerdictChip({ verdict, label, days }: { verdict: Verdict; label: string; days?: number }) {
    return (
        <span className='whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold' style={{ background: verdictColor(verdict, 0.16), color: verdictColor(verdict) }}>
            {label}{days && days > 0 && (verdict === 'late' || verdict === 'overdue') ? ` · ${days} d` : ''}
        </span>
    );
}
/** Row colours for whether the promise was kept. Green is spelled out because the theme's own green follows the organization's brand colour. */
export const rowTint = (v: Verdict) => (v === 'overdue' ? 'bg-red-500/10' : v === 'late' ? 'bg-amber-500/10' : v === 'on_time' ? 'bg-[rgba(34,197,94,0.12)]' : '');

function Tile({ label, value, hint, onClick, color, trend }: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; color?: string; trend?: ReactNode }) {
    const body = (
        <>
            <p className='text-xs text-muted'>{label}</p>
            <p className='mt-1 truncate text-lg font-semibold text-ink' style={color ? { color } : undefined}>{value}</p>
            {(hint || trend) && <p className='mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted'>{trend}{hint}</p>}
        </>
    );
    const cls = 'min-w-0 rounded-xl border border-line bg-panel p-3 text-left';
    return onClick ? <button type='button' onClick={onClick} className={`${cls} active:bg-line/40`}>{body}</button> : <div className={cls}>{body}</div>;
}

/** Up or down against the stretch before, in green when it is better. */
function Delta({ now, before, better = 'higher', unit = '', digits = 0 }: { now: number | null; before: number | null | undefined; better?: 'higher' | 'lower'; unit?: string; digits?: number }) {
    if (now === null || before === null || before === undefined) return null;
    const d = Math.round((now - before) * 10 ** digits) / 10 ** digits;
    if (d === 0) return <span className='inline-flex items-center gap-0.5'><Minus className='h-3 w-3' />same</span>;
    const good = better === 'higher' ? d > 0 : d < 0;
    const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
    return <span className='inline-flex items-center gap-0.5 font-medium' style={{ color: scoreColor(good ? 100 : 5) }}><Icon className='h-3 w-3' />{num(Math.abs(d), digits)}{unit}</span>;
}

function PromiseCard({ s, prev, good, watch }: { s: Summary; prev: Prev | null | undefined; good: number; watch: number }) {
    const due = Math.max(1, s.dueOrders);
    const seg = [
        { key: 'on_time' as Verdict, n: s.honouredOrders, label: 'On time' },
        { key: 'late' as Verdict, n: s.lateOrders, label: 'Delivered late' },
        { key: 'overdue' as Verdict, n: s.overdueOrders, label: 'Overdue' },
    ];
    return (
        <section className='rounded-xl border border-line bg-panel p-3' aria-label='Deliveries honoured'>
            <div className='flex items-end justify-between gap-3'>
                <div>
                    <p className='text-xs text-muted'>Purchase order deliveries honoured</p>
                    <p className='text-4xl font-bold' style={{ color: bandColor(s.band) }}>{s.honouredPct === null ? '—' : `${num(s.honouredPct, 1)}%`}</p>
                </div>
                <div className='text-right text-xs text-muted'>
                    <p className='font-semibold' style={{ color: bandColor(s.band) }}>{BAND_WORD[s.band]}</p>
                    <p>{s.honouredOrders} of {s.dueOrders} that fell due</p>
                    {prev && prev.honouredPct !== null && s.honouredPct !== null && <p className='mt-0.5'><Delta now={s.honouredPct} before={prev.honouredPct} unit=' pts' digits={1} /> vs the period before</p>}
                </div>
            </div>
            <div className='mt-3 flex h-3 w-full overflow-hidden rounded-full bg-line' role='img' aria-label={`${s.honouredOrders} on time, ${s.lateOrders} late, ${s.overdueOrders} overdue`}>
                {s.dueOrders > 0 && seg.map((x) => x.n > 0 && <div key={x.key} style={{ width: `${(x.n / due) * 100}%`, background: verdictColor(x.key) }} title={`${x.label}: ${x.n}`} />)}
            </div>
            <ul className='mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-soft'>
                {seg.map((x) => (
                    <li key={x.key} className='flex items-center gap-1.5'><span className='h-2.5 w-2.5 rounded-full' style={{ background: verdictColor(x.key) }} />{x.label}: <strong className='text-ink'>{x.n}</strong></li>
                ))}
                <li className='flex items-center gap-1.5'><span className='h-2.5 w-2.5 rounded-full bg-line' />Not yet due: <strong className='text-ink'>{s.pendingOrders}</strong></li>
            </ul>
            <p className='mt-2 text-xs text-muted'>A delivery is honoured when every line is fully received by the promised date: the day the order was sent plus the quoted lead time. Green from {good}%, amber from {watch}%, red below.</p>
        </section>
    );
}

function MonthBars({ rows }: { rows: Group[] }) {
    const list = rows.slice(0, 12).reverse();
    if (!list.length) return null;
    const max = Math.max(1, ...list.map((m) => m.orders));
    return (
        <section className='rounded-xl border border-line bg-panel p-3' aria-label='Deliveries by month'>
            <p className='text-sm font-semibold text-ink'>By month</p>
            <ul className='mt-2 space-y-1.5'>
                {list.map((m) => (
                    <li key={m.key} className='grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-xs'>
                        <span className='text-soft'>{m.key}</span>
                        <div className='h-3 overflow-hidden rounded-full bg-line' role='img' aria-label={`${m.key}: ${m.orders} orders, ${m.honouredPct ?? 'no'} percent honoured`}>
                            <div className='h-full rounded-full' style={{ width: `${(m.orders / max) * 100}%`, background: m.honouredPct === null ? scoreColor(null) : scoreColor(m.honouredPct) }} />
                        </div>
                        <span className='text-right font-medium text-ink'>{m.orders} · {m.honouredPct === null ? '—' : `${num(m.honouredPct)}%`}</span>
                    </li>
                ))}
            </ul>
            <p className='mt-2 text-xs text-muted'>Bar length is the number of orders; the colour and the figure are the share honoured.</p>
        </section>
    );
}

export function VendorOrders({ vendorId, payments }: { vendorId: string; payments?: ReactNode }) {
    const [period, setPeriod] = useState('365d');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [applied, setApplied] = useState({ from: '', to: '' });
    const [tab, setTab] = useState<'dashboard' | 'open' | 'overdue' | 'partial' | 'closed' | 'payments'>('dashboard');
    const [view, setView] = useState<'orders' | 'lines'>('orders');
    const [breakdown, setBreakdown] = useState<'type' | 'items' | 'months'>('type');
    const custom = period === 'custom';
    const ready = !custom || (!!applied.from && !!applied.to);
    const { data, error, loading } = useLoad(
        () => (ready ? callBackend<Out>(`${API}/po/dashboard`, { id: vendorId, period, from: applied.from, to: applied.to }) : Promise.resolve(null)),
        [vendorId, period, applied.from, applied.to, ready],
    );
    const rangeProblem = custom && (from || to) ? (!from || !to ? 'Enter the first and last day.' : to < from ? 'The period cannot end before it starts.' : to > today() ? 'The period cannot end in the future.' : '') : '';

    const orders = data?.orders ?? [];
    const lines = data?.lines ?? [];
    const cur = data?.currency ?? '';
    const filters: Record<string, (r: { live: boolean; partial: boolean; verdict: Verdict }) => boolean> = {
        open: (r) => r.live,
        overdue: (r) => r.verdict === 'overdue',
        partial: (r) => r.partial,
        closed: (r) => !r.live,
    };
    const orderColumns = useMemo<Array<Column<OrderRow>>>(
        () => [
            { key: 'number', label: 'PO number', value: (r) => r.number, render: (r) => <span className='font-mono text-xs font-semibold'>{r.number}</span> },
            { key: 'verdict', label: 'Promise kept?', value: (r) => r.verdictLabel, render: (r) => <VerdictChip verdict={r.verdict} label={r.verdictLabel} days={r.daysLate} /> },
            { key: 'status', label: 'Stage', value: (r) => r.statusLabel },
            { key: 'date', label: 'Order date', type: 'date', value: (r) => r.orderDate },
            { key: 'promise', label: 'Promised by', type: 'date', value: (r) => r.promiseOn },
            { key: 'delivered', label: 'Delivered on', type: 'date', value: (r) => r.deliveredOn },
            { key: 'late', label: 'Days late', type: 'number', value: (r) => r.daysLate },
            { key: 'received', label: 'Received %', type: 'number', value: (r) => r.receivedPct, render: (r) => `${num(r.receivedPct, 1)}%` },
            { key: 'lines', label: 'PO lines', type: 'number', value: (r) => r.lines },
            { key: 'value', label: `Value (${cur})`, type: 'number', value: (r) => r.value, render: (r) => num(r.value, 2) },
            { key: 'paid', label: `Paid (${cur})`, type: 'number', value: (r) => r.paid, render: (r) => num(r.paid, 2), hidden: true },
            { key: 'pending', label: `Pending (${cur})`, type: 'number', value: (r) => r.pending, render: (r) => num(r.pending, 2), hidden: true },
            { key: 'pa', label: 'Purchase agreement', value: (r) => r.agreements, render: (r) => (r.agreements ? <span className='font-mono text-xs font-semibold text-blue-300'>{r.agreements}</span> : '') },
            { key: 'type', label: 'Type', value: (r) => r.poType, hidden: true },
            { key: 'sent', label: 'Sent on', type: 'date', value: (r) => r.sentOn, hidden: true },
            { key: 'orderCur', label: 'Order currency', value: (r) => r.currency, hidden: true },
            { key: 'total', label: 'Order total (order currency)', type: 'number', value: (r) => r.total, render: (r) => `${r.currency} ${num(r.total, 2)}`, hidden: true },
        ],
        [cur],
    );
    const lineColumns = useMemo<Array<Column<LineRow>>>(
        () => [
            { key: 'number', label: 'PO number', value: (r) => r.orderNumber, render: (r) => <span className='font-mono text-xs font-semibold'>{r.orderNumber}</span> },
            { key: 'no', label: 'Line', type: 'number', value: (r) => r.no },
            { key: 'item', label: 'Item', value: (r) => r.item },
            { key: 'pa', label: 'Purchase agreement', value: (r) => r.agreementNumber, render: (r) => (r.agreementNumber ? <span className='font-mono text-xs font-semibold text-blue-300'>{r.agreementNumber}{r.aboveAgreed ? ' · above agreed price' : ''}</span> : '') },
            { key: 'verdict', label: 'Promise kept?', value: (r) => r.verdictLabel, render: (r) => <VerdictChip verdict={r.verdict} label={r.verdictLabel} days={r.daysLate} /> },
            { key: 'qty', label: 'Ordered', type: 'number', value: (r) => r.quantity, render: (r) => `${num(r.quantity, 2)} ${r.unit}` },
            { key: 'rec', label: 'Received', type: 'number', value: (r) => r.received, render: (r) => num(r.received, 2) },
            { key: 'out', label: 'Outstanding', type: 'number', value: (r) => r.outstanding, render: (r) => num(r.outstanding, 2) },
            { key: 'promise', label: 'Promised by', type: 'date', value: (r) => r.promiseOn },
            { key: 'delivered', label: 'Delivered on', type: 'date', value: (r) => r.deliveredOn },
            { key: 'late', label: 'Days late', type: 'number', value: (r) => r.daysLate },
            { key: 'price', label: 'Net unit price', type: 'number', value: (r) => r.netUnitPrice, render: (r) => `${r.currency} ${num(r.netUnitPrice, 2)}` },
            { key: 'total', label: 'Line total', type: 'number', value: (r) => r.total, render: (r) => `${r.currency} ${num(r.total, 2)}` },
            { key: 'base', label: `Value (${cur})`, type: 'number', value: (r) => r.base, render: (r) => num(r.base, 2), hidden: true },
            { key: 'code', label: 'Item code', value: (r) => r.itemCode, hidden: true },
            { key: 'status', label: 'Stage', value: (r) => r.statusLabel, hidden: true },
            { key: 'date', label: 'Order date', type: 'date', value: (r) => r.orderDate, hidden: true },
            { key: 'first', label: 'First delivery', type: 'date', value: (r) => r.firstDeliveryOn, hidden: true },
            { key: 'quoted', label: 'Quoted lead (days)', type: 'number', value: (r) => r.quotedLeadDays, hidden: true },
            { key: 'actual', label: 'Actual lead (days)', type: 'number', value: (r) => r.actualLeadDays ?? '', hidden: true },
        ],
        [cur],
    );

    const s = data?.summary;
    const counts = { open: s?.open ?? 0, overdue: s?.overdue ?? 0, partial: s?.partial ?? 0, closed: s?.closed ?? 0 };
    const go = (t: typeof tab) => () => setTab(t);

    return (
        <div className='space-y-3'>
            <SelectField id='vpo-period' label='Period' value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </SelectField>
            {custom && (
                <div className='grid grid-cols-2 gap-2'>
                    <Field id='vpo-from' label='From' type='date' max={today()} value={from} onChange={(e) => setFrom(e.target.value)} />
                    <Field id='vpo-to' label='To' type='date' max={today()} value={to} onChange={(e) => setTo(e.target.value)} />
                    {rangeProblem && <div className='col-span-2'><Alert tone='error'>{rangeProblem}</Alert></div>}
                    <Button className='col-span-2' disabled={!from || !to || !!rangeProblem} onClick={() => setApplied({ from, to })}>Show this period</Button>
                </div>
            )}
            {data?.period?.from && <p className='text-xs text-muted'>{fmtDay(data.period.from)} to {fmtDay(data.period.to)}, by the day each order was placed.</p>}
            <Segmented
                label='Purchase order views'
                value={tab}
                onChange={setTab}
                options={[
                    { value: 'dashboard', label: 'Dashboard' },
                    { value: 'open', label: 'Open', count: counts.open },
                    { value: 'overdue', label: 'Overdue', count: counts.overdue },
                    { value: 'partial', label: 'Partial', count: counts.partial },
                    { value: 'closed', label: 'Closed', count: counts.closed },
                    ...(payments ? [{ value: 'payments' as const, label: 'Payments' }] : []),
                ]}
            />
            {tab === 'payments' && payments}
            {tab !== 'payments' && (
                <>
                    {!ready && <Alert tone='info'>Choose the first and last day, then show the period.</Alert>}
                    {ready && loading && !data && <Spinner />}
                    {ready && error && <Alert tone='error'>{error}</Alert>}
                    {ready && data && !data.allowed && <Alert tone='info'>Purchase order values and delivery performance are shown only to people who can view purchase orders.</Alert>}
                    {ready && data?.allowed && s && data.thresholds && (
                        <>
                            {data.truncated && <Alert tone='warn'>The period holds more orders than can be listed here. Choose a shorter period to see them all; the totals above are complete.</Alert>}
                            {tab === 'dashboard' && (
                                <div className='space-y-3'>
                                    {s.orders === 0 && <Alert tone='info'>No purchase orders were placed with this supplier in this period.</Alert>}
                                    <PromiseCard s={s} prev={data.previous} good={data.thresholds.good} watch={data.thresholds.watch} />
                                    <div className='grid grid-cols-2 gap-2'>
                                        <Tile label='Purchase orders' value={s.orders} trend={data.previous && <Delta now={s.orders} before={data.previous.orders} />} hint={data.previous ? 'vs period before' : undefined} />
                                        <Tile label={`Total PO cost (${cur})`} value={num(s.value)} trend={data.previous && <Delta now={s.value} before={data.previous.value} />} hint={`Paid ${num(s.paid)} · pending ${num(s.pending)}`} />
                                        <Tile label='Open' value={s.open} hint='Tap to list' onClick={go('open')} />
                                        <Tile label='Overdue' value={s.overdue} color={s.overdue ? scoreColor(4) : undefined} hint='Tap to list' onClick={go('overdue')} />
                                        <Tile label='Partial deliveries' value={s.partial} color={s.partial ? scoreColor(36) : undefined} hint='Tap to list' onClick={go('partial')} />
                                        <Tile label='Closed' value={s.closed} hint='Delivered in full' onClick={go('closed')} />
                                        <Tile label='PO lines' value={s.lines} hint={`${s.lineHonouredPct === null ? 'No line has fallen due' : `${num(s.lineHonouredPct, 1)}% of due lines on time`}`} />
                                        <Tile label='Quantity received' value={s.fillRatePct === null ? '—' : `${num(s.fillRatePct, 1)}%`} trend={data.previous && <Delta now={s.fillRatePct} before={data.previous.fillRatePct} unit=' pts' digits={1} />} hint='of the quantity ordered' />
                                        <Tile label='Average days late' value={s.avgDaysLate === null ? '—' : num(s.avgDaysLate, 1)} trend={data.previous && <Delta now={s.avgDaysLate} before={data.previous.avgDaysLate} better='lower' digits={1} />} hint='late and overdue lines' />
                                        <Tile label='Lead time' value={s.avgActualLead === null ? '—' : `${num(s.avgActualLead, 1)} d`} hint={s.avgQuotedLead === null ? 'No delivered line yet' : `promised ${num(s.avgQuotedLead, 1)} d on average`} color={s.avgActualLead !== null && s.avgQuotedLead !== null ? scoreColor(s.avgActualLead <= s.avgQuotedLead ? 100 : s.avgActualLead <= s.avgQuotedLead * 1.25 ? 36 : 4) : undefined} />
                                        <Tile label='Bought on agreements' value={`${s.agreementOrders} order(s)`} hint={`${s.agreementLines} line(s) · ${cur} ${num(s.agreementValue)}`} color={s.agreementOrders ? '#3b82f6' : undefined} />
                                        <Tile label='Not yet due' value={s.pendingOrders} hint='Order(s) still inside the promised time' />
                                    </div>
                                    <MonthBars rows={data.byMonth ?? []} />
                                    <Segmented label='Breakdown' value={breakdown} onChange={setBreakdown} options={[{ value: 'type', label: 'By type' }, { value: 'items', label: 'Top items' }, { value: 'months', label: 'By month' }]} />
                                    {breakdown === 'items' ? (
                                        <RichTable
                                            id='prc.vendor.po.items'
                                            title='Top items by value'
                                            fileName={`vendor-${vendorId}-top-items`}
                                            height='h-80'
                                            columns={[
                                                { key: 'item', label: 'Item', value: (r: NonNullable<Out['topItems']>[number]) => r.item },
                                                { key: 'code', label: 'Item code', value: (r) => r.code },
                                                { key: 'lines', label: 'PO lines', type: 'number', value: (r) => r.lines },
                                                { key: 'qty', label: 'Quantity', type: 'number', value: (r) => r.qty, render: (r) => `${num(r.qty, 2)} ${r.unit}` },
                                                { key: 'value', label: `Value (${cur})`, type: 'number', value: (r) => r.value, render: (r) => num(r.value, 2) },
                                            ]}
                                            rows={data.topItems ?? []}
                                            rowKey={(r) => r.code || r.item}
                                            empty='Nothing bought in this period.'
                                        />
                                    ) : (
                                        <RichTable
                                            id={`prc.vendor.po.${breakdown}`}
                                            title={breakdown === 'type' ? 'By order type' : 'By month'}
                                            fileName={`vendor-${vendorId}-orders-by-${breakdown}`}
                                            height='h-80'
                                            columns={[
                                                { key: 'key', label: breakdown === 'type' ? 'Type' : 'Month', value: (r: Group) => r.key },
                                                { key: 'orders', label: 'POs', type: 'number', value: (r) => r.orders },
                                                { key: 'lines', label: 'PO lines', type: 'number', value: (r) => r.lines },
                                                { key: 'value', label: `Value (${cur})`, type: 'number', value: (r) => r.value, render: (r) => num(r.value, 2) },
                                                { key: 'due', label: 'Fell due', type: 'number', value: (r) => r.due },
                                                { key: 'honoured', label: 'Honoured', type: 'number', value: (r) => r.honoured },
                                                { key: 'pct', label: 'Honoured %', type: 'number', value: (r) => r.honouredPct ?? '', render: (r) => (r.honouredPct === null ? '—' : <span className='font-semibold' style={{ color: scoreColor(r.honouredPct) }}>{num(r.honouredPct, 1)}%</span>) },
                                            ]}
                                            rows={(breakdown === 'type' ? data.byType : data.byMonth) ?? []}
                                            rowKey={(r) => r.key}
                                            empty='Nothing to show in this period.'
                                        />
                                    )}
                                </div>
                            )}
                            {tab !== 'dashboard' && (
                                <div className='space-y-2'>
                                    <Segmented
                                        label='Show'
                                        value={view}
                                        onChange={setView}
                                        options={[
                                            { value: 'orders', label: 'Orders', count: orders.filter(filters[tab]).length },
                                            { value: 'lines', label: 'PO lines', count: lines.filter(filters[tab]).length },
                                        ]}
                                    />
                                    {view === 'orders' ? (
                                        <RichTable
                                            id={`prc.vendor.po.${tab}.orders`}
                                            title={`${TAB_TITLE[tab]} orders`}
                                            fileName={`vendor-${vendorId}-${tab}-orders`}
                                            height='h-[calc(100dvh-19rem)] min-h-80'
                                            columns={orderColumns}
                                            rows={orders.filter(filters[tab])}
                                            rowKey={(r) => r.id}
                                            onRowClick={(r) => navigate(`${PO_BASE}/${r.id}`)}
                                            rowClassName={(r) => rowTint(r.verdict)}
                                            empty={`No ${TAB_TITLE[tab].toLowerCase()} orders in this period.`}
                                        />
                                    ) : (
                                        <RichTable
                                            id={`prc.vendor.po.${tab}.lines`}
                                            title={`${TAB_TITLE[tab]} PO lines`}
                                            fileName={`vendor-${vendorId}-${tab}-po-lines`}
                                            height='h-[calc(100dvh-19rem)] min-h-80'
                                            columns={lineColumns}
                                            rows={lines.filter(filters[tab])}
                                            rowKey={(r) => r.key}
                                            onRowClick={(r) => navigate(`${PO_BASE}/${r.orderId}`)}
                                            rowClassName={(r) => rowTint(r.verdict)}
                                            empty={`No ${TAB_TITLE[tab].toLowerCase()} lines in this period.`}
                                        />
                                    )}
                                    <p className='text-xs text-muted'>Tap a row to open the purchase order. Red rows are overdue, amber were delivered late and green were on time.</p>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

const TAB_TITLE: Record<string, string> = { open: 'Open', overdue: 'Overdue', partial: 'Partly delivered', closed: 'Closed' };
