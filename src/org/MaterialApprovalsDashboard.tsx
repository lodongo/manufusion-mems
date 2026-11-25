import { useMemo, useState } from 'react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Segmented } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Spinner, useLoad } from '../admin/kit';

// Approvals dashboard for the Materials Master: new materials (NWREQ, PRC-001) and warehouse extensions (EXREQ, PRC-002).
// Time filter (presets or custom dates, up to two years), KPIs, a trend chart, and rich tables by requester, approver,
// level, warehouse and category, the open queue, returns awaiting correction and every event. Each table exports to Excel.
// Administrators see the organization; anyone else sees only requests they raised or decided (enforced by the server).

type Grain = 'day' | 'week' | 'month';
interface Totals { created: number; submitted: number; approved: number; rejected: number; returned: number; stepDecisions: number }
interface Group { key: string; decisions: number; approved: number; rejected: number; returned: number; avgWaitHours: number | null; p90WaitHours: number | null }
interface Person { uid: string; name: string; created: number; submitted: number; approved: number; rejected: number; returned: number; creations: number; extensions: number; returnRate: number | null }
interface Approver { uid: string; name: string; decisions: number; approved: number; reviewed: number; rejected: number; returned: number; avgHours: number | null; medianHours: number | null; p90Hours: number | null }
interface Pending { type: string; id: string; name: string; stage: string; level: number; submittedAt: string; requester: string; warehouseId: string; ageHours: number | null; waitingHours: number | null; returnCount: number }
interface Returned { type: string; id: string; name: string; returnedAt: string; returnedBy: string; reason: string; requester: string; ageHours: number | null }
interface Event { at: string; type: string; event: string; id: string; name: string; byName: string; level: number; waitHours: number | null; comment: string; warehouseId: string; categoryCode: string; requesterName: string }
interface Analytics {
    range: { from: string; to: string; grain: Grain };
    totals: Totals & { pendingNow: number; awaitingCorrection: number; approvalRate: number | null; returnRate: number | null };
    byType: { creation: Totals; extension: Totals };
    cycle: { n: number; avg: number | null; median: number | null; p90: number | null; max: number | null };
    series: Array<{ period: string; creation: number; extension: number; approved: number; rejected: number; returned: number; submitted: number }>;
    creators: Person[]; approvers: Approver[]; levels: Group[]; warehouses: Group[]; categories: Group[];
    pending: Pending[]; returned: Returned[]; events: Event[]; eventsTruncated: boolean;
    scope: 'organization' | 'own'; warehouseNames: Record<string, string>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));
const PRESETS: Array<{ value: string; label: string; from: () => string }> = [
    { value: '7', label: 'Last 7 days', from: () => daysAgo(6) },
    { value: '30', label: 'Last 30 days', from: () => daysAgo(29) },
    { value: '90', label: 'Last 90 days', from: () => daysAgo(89) },
    { value: 'ytd', label: 'This year', from: () => new Date().getUTCFullYear() + '-01-01' },
    { value: '365', label: 'Last 12 months', from: () => daysAgo(364) },
    { value: 'custom', label: 'Custom dates', from: () => daysAgo(29) },
];
const dur = (h: number | null | undefined) => (h == null ? '—' : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} d`);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const EVENT_WORD: Record<string, string> = { created: 'Created', submitted: 'Submitted', reviewed: 'Reviewed', approved_step: 'Level approved', approved: 'Approved (final)', rejected: 'Rejected', returned: 'Returned' };
const TYPE_WORD: Record<string, string> = { creation: 'New material', extension: 'Extension' };

function Kpi({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'warn' | 'danger' | 'brand' }) {
    const bar = tone === 'warn' ? 'bg-amber-500' : tone === 'danger' ? 'bg-red-500' : tone === 'brand' ? 'bg-brand' : 'bg-line';
    return (
        <div className='relative min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-3'>
            <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
            <p className='truncate text-xs text-muted'>{label}</p>
            <p className='mt-1 text-xl font-semibold tabular-nums text-ink'>{value}</p>
            {note && <p className='mt-0.5 truncate text-xs text-soft'>{note}</p>}
        </div>
    );
}

/** Decisions per period: approved, returned and rejected stacked; submissions as a marker line. */
function Trend({ series }: { series: Analytics['series'] }) {
    if (!series.length) return <p className='p-3 text-sm text-muted'>No activity in this period.</p>;
    const max = Math.max(1, ...series.map((s) => Math.max(s.approved + s.returned + s.rejected, s.submitted)));
    const w = Math.max(320, series.length * 22), h = 160, pad = 18, bw = Math.max(6, Math.min(16, (w - pad * 2) / series.length - 6));
    const x = (i: number) => pad + (i + 0.5) * ((w - pad * 2) / series.length);
    const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
    const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.submitted).toFixed(1)}`).join(' ');
    return (
        <figure className='space-y-2'>
            <div className='overflow-x-auto'>
                <svg role='img' aria-label='Decisions and submissions over time' width={w} height={h} className='block'>
                    <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} className='stroke-line' />
                    {series.map((s, i) => {
                        let base = h - pad;
                        return (
                            <g key={s.period}>
                                <title>{`${s.period}: ${s.submitted} submitted, ${s.approved} approved, ${s.returned} returned, ${s.rejected} rejected`}</title>
                                {([['approved', 'fill-brand'], ['returned', 'fill-amber-500'], ['rejected', 'fill-red-500']] as const).map(([k, cls]) => {
                                    const v = s[k];
                                    if (!v) return null;
                                    const hh = (v / max) * (h - pad * 2);
                                    base -= hh;
                                    return <rect key={k} x={x(i) - bw / 2} y={base} width={bw} height={hh} rx={2} className={cls} />;
                                })}
                            </g>
                        );
                    })}
                    <path d={line} fill='none' strokeWidth={2} className='stroke-ink/60' />
                    <text x={pad} y={12} className='fill-muted text-[12px]'>{max}</text>
                    <text x={pad} y={h - 4} className='fill-muted text-[12px]'>{series[0].period}</text>
                    <text x={w - pad} y={h - 4} textAnchor='end' className='fill-muted text-[12px]'>{series[series.length - 1].period}</text>
                </svg>
            </div>
            <figcaption className='flex flex-wrap gap-3 text-xs text-soft'>
                <span className='flex items-center gap-1'><span className='h-2.5 w-2.5 rounded-sm bg-brand' />Approved</span>
                <span className='flex items-center gap-1'><span className='h-2.5 w-2.5 rounded-sm bg-amber-500' />Returned</span>
                <span className='flex items-center gap-1'><span className='h-2.5 w-2.5 rounded-sm bg-red-500' />Rejected</span>
                <span className='flex items-center gap-1'><span className='h-0.5 w-4 bg-ink/60' />Submitted</span>
            </figcaption>
        </figure>
    );
}

type View = 'summary' | 'people' | 'levels' | 'queue' | 'events';

export default function MaterialApprovalsDashboard({ onOpen }: { onOpen?: (type: string, id: string) => void }) {
    const [preset, setPreset] = useState('30');
    const [from, setFrom] = useState(daysAgo(29));
    const [to, setTo] = useState(iso(new Date()));
    const [type, setType] = useState<'all' | 'creation' | 'extension'>('all');
    const [view, setView] = useState<View>('summary');
    const rangeError = !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ? 'Enter both dates.' : from > to ? 'The start date must be on or before the end date.' : (Date.parse(to) - Date.parse(from)) / 864e5 > 731 ? 'Choose two years or less.' : '';
    const { data, loading, error } = useLoad(() => (rangeError ? Promise.resolve(null) : callBackend<Analytics>('/api/org/procurement/materials/approvals/analytics', { from, to })), [from, to, rangeError]);
    const wh = (id: string) => data?.warehouseNames[id] || id || '—';
    const ofType = <T extends { type: string }>(rows: T[]) => (type === 'all' ? rows : rows.filter((r) => r.type === type));
    const t = data ? (type === 'all' ? data.totals : { ...data.totals, ...data.byType[type] }) : null;

    const approverCols = useMemo<Column<Approver>[]>(() => [
        { key: 'name', label: 'Approver', value: (r) => r.name },
        { key: 'decisions', label: 'Decisions', type: 'number', value: (r) => r.decisions },
        { key: 'approved', label: 'Approved', type: 'number', value: (r) => r.approved },
        { key: 'reviewed', label: 'Reviewed', type: 'number', value: (r) => r.reviewed },
        { key: 'returned', label: 'Returned', type: 'number', value: (r) => r.returned },
        { key: 'rejected', label: 'Rejected', type: 'number', value: (r) => r.rejected },
        { key: 'median', label: 'Median response (h)', type: 'number', value: (r) => r.medianHours },
        { key: 'p90', label: '90th percentile (h)', type: 'number', value: (r) => r.p90Hours },
        { key: 'avg', label: 'Average (h)', type: 'number', value: (r) => r.avgHours, hidden: true },
    ], []);
    const creatorCols = useMemo<Column<Person>[]>(() => [
        { key: 'name', label: 'Requester', value: (r) => r.name },
        { key: 'created', label: 'Created', type: 'number', value: (r) => r.created },
        { key: 'creations', label: 'New materials', type: 'number', value: (r) => r.creations, hidden: true },
        { key: 'extensions', label: 'Extensions', type: 'number', value: (r) => r.extensions, hidden: true },
        { key: 'submitted', label: 'Submitted', type: 'number', value: (r) => r.submitted },
        { key: 'approved', label: 'Approved', type: 'number', value: (r) => r.approved },
        { key: 'returned', label: 'Returned', type: 'number', value: (r) => r.returned },
        { key: 'rejected', label: 'Rejected', type: 'number', value: (r) => r.rejected },
        { key: 'rate', label: 'Return rate %', type: 'number', value: (r) => r.returnRate },
    ], []);
    const groupCols = (label: string, name?: (k: string) => string): Column<Group>[] => [
        { key: 'key', label, value: (r) => (name ? name(r.key) : r.key) },
        { key: 'decisions', label: 'Decisions', type: 'number', value: (r) => r.decisions },
        { key: 'approved', label: 'Approved or reviewed', type: 'number', value: (r) => r.approved },
        { key: 'returned', label: 'Returned', type: 'number', value: (r) => r.returned },
        { key: 'rejected', label: 'Rejected', type: 'number', value: (r) => r.rejected },
        { key: 'avg', label: 'Average wait (h)', type: 'number', value: (r) => r.avgWaitHours },
        { key: 'p90', label: '90th percentile wait (h)', type: 'number', value: (r) => r.p90WaitHours },
    ];
    const pendingCols = useMemo<Column<Pending>[]>(() => [
        { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='font-mono text-xs font-semibold text-ink'>{r.id}</span> },
        { key: 'type', label: 'Type', value: (r) => TYPE_WORD[r.type] },
        { key: 'name', label: 'Material', value: (r) => r.name },
        { key: 'stage', label: 'Waiting at', value: (r) => r.stage },
        { key: 'waiting', label: 'Waiting (h)', type: 'number', value: (r) => r.waitingHours, render: (r) => <span className={(r.waitingHours ?? 0) > 72 ? 'font-semibold text-red-500' : (r.waitingHours ?? 0) > 24 ? 'text-amber-600' : ''}>{dur(r.waitingHours)}</span> },
        { key: 'age', label: 'Since submitted (h)', type: 'number', value: (r) => r.ageHours },
        { key: 'requester', label: 'Requester', value: (r) => r.requester },
        { key: 'warehouse', label: 'Warehouse', value: (r) => wh(r.warehouseId) },
        { key: 'returns', label: 'Times returned', type: 'number', value: (r) => r.returnCount, hidden: true },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [data]);
    const returnedCols = useMemo<Column<Returned>[]>(() => [
        { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='font-mono text-xs font-semibold text-ink'>{r.id}</span> },
        { key: 'type', label: 'Type', value: (r) => TYPE_WORD[r.type] },
        { key: 'name', label: 'Material', value: (r) => r.name },
        { key: 'reason', label: 'What to correct', value: (r) => r.reason },
        { key: 'by', label: 'Returned by', value: (r) => r.returnedBy },
        { key: 'requester', label: 'Requester', value: (r) => r.requester },
        { key: 'at', label: 'Returned', type: 'date', value: (r) => r.returnedAt.slice(0, 10) },
        { key: 'age', label: 'Waiting for correction (h)', type: 'number', value: (r) => r.ageHours },
    ], []);
    const eventCols = useMemo<Column<Event>[]>(() => [
        { key: 'at', label: 'When', type: 'date', value: (r) => r.at.slice(0, 16).replace('T', ' ') },
        { key: 'event', label: 'Event', value: (r) => EVENT_WORD[r.event] || r.event },
        { key: 'type', label: 'Type', value: (r) => TYPE_WORD[r.type] },
        { key: 'id', label: 'Request', value: (r) => r.id },
        { key: 'name', label: 'Material', value: (r) => r.name },
        { key: 'by', label: 'By', value: (r) => r.byName },
        { key: 'level', label: 'Level', type: 'number', value: (r) => r.level || null },
        { key: 'wait', label: 'Waited (h)', type: 'number', value: (r) => r.waitHours },
        { key: 'requester', label: 'Requester', value: (r) => r.requesterName, hidden: true },
        { key: 'warehouse', label: 'Warehouse', value: (r) => wh(r.warehouseId), hidden: true },
        { key: 'category', label: 'Category', value: (r) => r.categoryCode, hidden: true },
        { key: 'comment', label: 'Comment', value: (r) => r.comment },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [data]);

    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                <SelectField label='Period' value={preset} onChange={(e) => { const p = PRESETS.find((x) => x.value === e.target.value)!; setPreset(p.value); if (p.value !== 'custom') { setFrom(p.from()); setTo(iso(new Date())); } }}>
                    {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </SelectField>
                <SelectField label='Requests' value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                    <option value='all'>New materials and extensions</option>
                    <option value='creation'>New materials (NWREQ)</option>
                    <option value='extension'>Warehouse extensions (EXREQ)</option>
                </SelectField>
                {preset === 'custom' ? (
                    <div className='grid grid-cols-2 gap-2'>
                        <Field label='From' type='date' value={from} max={to} onChange={(e) => setFrom(e.target.value)} error={rangeError || undefined} />
                        <Field label='To' type='date' value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                    </div>
                ) : <p className='self-end pb-3 text-xs text-muted'>{from} to {to}</p>}
            </div>
            {data?.scope === 'own' && <Alert tone='info'>You see the requests you raised or decided. Materials Master and workflow administrators see the whole organization.</Alert>}
            {error && <Alert tone='error'>{error}</Alert>}
            {loading && !data && <Spinner />}
            {data && t && <>
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8'>
                    <Kpi label='Created' value={t.created} note={type === 'all' ? `${data.byType.creation.created} new · ${data.byType.extension.created} ext.` : undefined} />
                    <Kpi label='Submitted' value={t.submitted} />
                    <Kpi label='Approved' value={t.approved} tone='brand' note={'Approval rate ' + pct(data.totals.approvalRate)} />
                    <Kpi label='Returned' value={t.returned} tone='warn' note={'Return rate ' + pct(data.totals.returnRate)} />
                    <Kpi label='Rejected' value={t.rejected} tone='danger' />
                    <Kpi label='Waiting now' value={ofType(data.pending).length} tone={ofType(data.pending).some((p) => (p.waitingHours ?? 0) > 72) ? 'danger' : 'warn'} note={ofType(data.pending).filter((p) => (p.waitingHours ?? 0) > 72).length + ' over 3 days'} />
                    <Kpi label='With requester' value={ofType(data.returned).length} note='Returned, not resubmitted' />
                    <Kpi label='Cycle time' value={dur(data.cycle.median)} note={`median · 90% within ${dur(data.cycle.p90)}`} />
                </div>
                <Segmented label='Dashboard views' value={view} onChange={setView} options={[
                    { value: 'summary', label: 'Trend' },
                    { value: 'people', label: 'People' },
                    { value: 'levels', label: 'Levels & warehouses' },
                    { value: 'queue', label: 'Waiting & returned', count: ofType(data.pending).length + ofType(data.returned).length },
                    { value: 'events', label: 'All events' },
                ]} />
                {view === 'summary' && (
                    <section className='rounded-2xl border border-line bg-panel p-3'>
                        <h2 className='mb-2 text-sm font-semibold text-ink'>Decisions per {data.range.grain}</h2>
                        <Trend series={data.series} />
                        <dl className='mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4'>
                            {[['Level decisions', t.stepDecisions], ['Cycle time · average', dur(data.cycle.avg)], ['Cycle time · longest', dur(data.cycle.max)], ['Closed requests measured', data.cycle.n]].map(([k, v]) => (
                                <div key={String(k)} className='rounded-xl bg-page p-3'><dt className='text-xs text-muted'>{k}</dt><dd className='text-sm font-semibold text-ink'>{v}</dd></div>
                            ))}
                        </dl>
                    </section>
                )}
                {view === 'people' && <>
                    <RichTable id='prc.materials.approvals.approvers' title='By approver' fileName='Material_approvals_by_approver' columns={approverCols} rows={data.approvers} rowKey={(r) => r.uid} height='h-[50dvh]' empty='No decisions in this period.' />
                    <RichTable id='prc.materials.approvals.requesters' title='By requester' fileName='Material_requests_by_requester' columns={creatorCols} rows={data.creators} rowKey={(r) => r.uid} height='h-[50dvh]' empty='No requests in this period.' />
                </>}
                {view === 'levels' && <>
                    <RichTable id='prc.materials.approvals.levels' title='By workflow level' fileName='Material_approvals_by_level' columns={groupCols('Workflow and level', (k) => k.replace('creation', 'New material').replace('extension', 'Extension'))} rows={data.levels} rowKey={(r) => r.key} height='h-[40dvh]' />
                    <RichTable id='prc.materials.approvals.warehouses' title='By warehouse' fileName='Material_approvals_by_warehouse' columns={groupCols('Warehouse', wh)} rows={data.warehouses} rowKey={(r) => r.key} height='h-[40dvh]' />
                    <RichTable id='prc.materials.approvals.categories' title='By material category' fileName='Material_approvals_by_category' columns={groupCols('Category')} rows={data.categories} rowKey={(r) => r.key} height='h-[40dvh]' />
                </>}
                {view === 'queue' && <>
                    <RichTable id='prc.materials.approvals.pending' title='Waiting for a decision' fileName='Material_requests_waiting' columns={pendingCols} rows={ofType(data.pending)} rowKey={(r) => r.id} onRowClick={onOpen ? (r) => onOpen(r.type, r.id) : undefined} height='h-[45dvh]' empty='Nothing is waiting.' />
                    <RichTable id='prc.materials.approvals.returned' title='Returned, waiting for the requester' fileName='Material_requests_returned' columns={returnedCols} rows={ofType(data.returned)} rowKey={(r) => r.id} onRowClick={onOpen ? (r) => onOpen(r.type, r.id) : undefined} height='h-[45dvh]' empty='Nothing is waiting for correction.' />
                </>}
                {view === 'events' && <>
                    {data.eventsTruncated && <Alert tone='info'>Showing the latest 3,000 events. Narrow the period to see the rest.</Alert>}
                    <RichTable id='prc.materials.approvals.events' title='Approval events' fileName='Material_approval_events' columns={eventCols} rows={ofType(data.events)} rowKey={(r) => r.id + r.event + r.at} onRowClick={onOpen ? (r) => onOpen(r.type, r.id) : undefined} height='h-[calc(100dvh-24rem)]' empty='No events in this period.' />
                </>}
            </>}
        </div>
    );
}
