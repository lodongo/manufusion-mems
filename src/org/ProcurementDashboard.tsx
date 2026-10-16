import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen } from '../components/screen';
import { API, PO_BASE, RQ_BASE, Section, money } from './PoExtras';

// Procurement dashboard: open requirements, requisitions and orders from the legal entity down to the cost center,
// by status, month and supplier, with the time each stage takes. Everything drills down to the records behind it.
// The server only counts what this person is allowed to see.

type Dataset = 'requirements' | 'prs' | 'pos';
interface Row {
    status: string;
    label: string;
    count: number;
    value: number;
}
interface Summary {
    currency: string;
    node: { id: string; name: string; level: string } | null;
    trail: Array<{ id: string; name: string; level: string }>;
    children: Array<{ id: string; name: string; level: string; requirements: number; prs: number; pos: number; poValue: number }>;
    unassigned: number;
    requirements: { total: number; byStatus: Row[] };
    prs: { total: number; value: number; byStatus: Row[] };
    pos: { total: number; value: number; byStatus: Row[]; valueHidden: boolean };
    open: { requirements: number; prs: number; pos: number };
    months: Array<{ month: string; requirements: number; prs: number; pos: number; posApproved: number; poValue: number; reqToPr: number | null; prToPo: number | null; poApproval: number | null }>;
    funnel: Array<{ key: string; label: string; count: number }>;
    conversion: { requirementToPr: number | null; prToPo: number | null; poToApproved: number | null };
    stages: Array<{ key: string; label: string; count: number; avgDays: number | null }>;
    ageing: Array<{ key: string; label: string; count: number; value: number }>;
    overdue: number;
    unacknowledged: number;
    leadTime: { delivered: number; avgQuotedDays: number | null; avgActualDays: number | null; onTimePct: number | null };
    vendors: Array<{ vendorId: string; vendorName: string; pos: number; open: number; overdue: number; value: number; delivered: number; onTimePct: number | null; avgQuotedDays: number | null; avgActualDays: number | null; acknowledgedPct: number | null }>;
    types: Array<{ type: string; label: string; pos: number; prs: number; value: number }>;
}
interface Rec {
    id: string;
    number: string;
    title: string;
    status: string;
    statusLabel: string;
    createdAt: string;
    month: string;
    costCenter: string;
    vendorName: string;
    type: string;
    value: number | null;
    ageDays: number;
    owner: string;
    requester: string;
    acknowledged: boolean;
    overdue: boolean;
    due: string;
    ver: number;
}
interface Drill {
    title: string;
    dataset: Dataset;
    status?: string;
    month?: string;
    bucket?: string;
    childId?: string;
    overdue?: boolean;
    unacknowledged?: boolean;
}

const DATASET_LABEL: Record<Dataset, string> = { requirements: 'Requirements', prs: 'Requisitions', pos: 'Orders' };
const num = (n: number | null | undefined, suffix = '') => (n === null || n === undefined ? '-' : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`);

/** Horizontal bars. Each bar is a button so it can be tapped to see the records behind it. */
function Bars({ items, onPick, tone = 'bg-brand' }: { items: Array<{ key: string; label: string; value: number; note?: string }>; onPick?: (key: string) => void; tone?: string }) {
    const max = Math.max(1, ...items.map((i) => i.value));
    if (!items.length) return <p className='text-sm text-muted'>Nothing to show.</p>;
    return (
        <ul className='space-y-1'>
            {items.map((i) => (
                <li key={i.key}>
                    <button type='button' disabled={!onPick} onClick={() => onPick?.(i.key)} className='block min-h-11 w-full rounded-xl px-1 text-left active:bg-page'>
                        <div className='flex items-baseline justify-between gap-2 text-sm'>
                            <span className='min-w-0 truncate text-ink'>{i.label}</span>
                            <span className='shrink-0 font-semibold text-ink'>
                                {num(i.value)}
                                {i.note && <span className='ml-1 text-xs font-normal text-muted'>{i.note}</span>}
                            </span>
                        </div>
                        <div className='mt-1 h-2 overflow-hidden rounded-full bg-page'>
                            <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
                        </div>
                    </button>
                </li>
            ))}
        </ul>
    );
}

function Tile({ label, value, sub, onClick, tone }: { label: string; value: string; sub?: string; onClick?: () => void; tone?: 'danger' }) {
    return (
        <button type='button' onClick={onClick} disabled={!onClick} className={`min-h-11 rounded-2xl border p-3 text-left active:bg-page ${tone === 'danger' ? 'border-red-500/40' : 'border-line'} bg-panel`}>
            <p className='text-xs text-muted'>{label}</p>
            <p className={`text-xl font-semibold ${tone === 'danger' ? 'text-red-400' : 'text-ink'}`}>{value}</p>
            {sub && <p className='text-xs text-soft'>{sub}</p>}
        </button>
    );
}

const goto = (dataset: Dataset, id: string) => navigate(dataset === 'pos' ? `${PO_BASE}/${id}` : dataset === 'prs' ? `${RQ_BASE}/${id}` : `organization_home/purchase_requirements/${id}`);

function Records({ drill, filters, currency }: { drill: Drill; filters: { nodeId: string; type: string; vendorId: string }; currency: string }) {
    const { data, error, loading } = useLoad(
        () => callBackend<{ rows: Rec[]; count: number }>(`${API}/dashboard/records`, { dataset: drill.dataset, status: drill.status, month: drill.month, bucket: drill.bucket, childId: drill.childId, overdue: drill.overdue, unacknowledged: drill.unacknowledged, ...filters }),
        [JSON.stringify(drill), JSON.stringify(filters)]
    );
    const cols: Array<Column<Rec>> = [
        { key: 'number', label: 'Number', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
        { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={r.overdue ? 'danger' : 'muted'}>{r.statusLabel}</Badge> },
        { key: 'title', label: drill.dataset === 'pos' ? 'Supplier' : 'Title', value: (r) => r.title },
        { key: 'cc', label: 'Cost center', value: (r) => r.costCenter },
        { key: 'who', label: drill.dataset === 'pos' ? 'Owner' : 'Requester', value: (r) => (drill.dataset === 'pos' ? r.owner : r.requester) },
        ...(drill.dataset !== 'requirements' ? [{ key: 'vendor', label: 'Supplier', value: (r: Rec) => r.vendorName }, { key: 'value', label: `Value (${currency})`, type: 'number' as const, value: (r: Rec) => r.value, render: (r: Rec) => money(r.value) }] : []),
        { key: 'type', label: 'Kind', value: (r) => r.type },
        { key: 'age', label: 'Age (days)', type: 'number', value: (r) => r.ageDays },
        { key: 'created', label: 'Created', type: 'date', value: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt) },
        ...(drill.dataset === 'pos' ? [{ key: 'ack', label: 'Acknowledged', value: (r: Rec) => (r.acknowledged ? 'Yes' : ''), hidden: true }, { key: 'due', label: 'Due', type: 'date' as const, value: (r: Rec) => r.due, hidden: true }, { key: 'ver', label: 'Version', type: 'number' as const, value: (r: Rec) => r.ver, hidden: true }] : []),
    ];
    return (
        <Section title={`${drill.title}${data ? ` (${data.count})` : ''}`}>
            {loading && !data && <Spinner />}
            {error && <Alert tone='error'>{error}</Alert>}
            {data && <RichTable id={`prc.dash.${drill.dataset}`} columns={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => goto(drill.dataset, r.id)} empty='Nothing matches.' fileName={`procurement-${drill.dataset}`} height='h-[28rem]' rowClassName={(r) => (r.overdue ? 'bg-red-500/10' : '')} />}
        </Section>
    );
}

export default function ProcurementDashboard() {
    const [nodeId, setNodeId] = useState('');
    const [type, setType] = useState('');
    const [vendorId, setVendorId] = useState('');
    const [drill, setDrill] = useState<Drill | null>(null);
    const [monthSet, setMonthSet] = useState<Dataset>('pos');
    const filters = { nodeId, type, vendorId };
    const { data, error, loading, reload } = useLoad(() => callBackend<Summary>(`${API}/dashboard/summary`, filters), [nodeId, type, vendorId]);
    const drillRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (drill) drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [drill]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the dashboard.'}</Alert>;
    const d = data;
    const open = (x: Drill) => setDrill(x);
    const statusItems = (rows: Row[]) => rows.map((r) => ({ key: r.status, label: r.label, value: r.count, note: r.value ? money(r.value) : undefined }));
    const monthItems = d.months.map((m) => ({ key: m.month, label: m.month, value: m[monthSet === 'requirements' ? 'requirements' : monthSet === 'prs' ? 'prs' : 'pos'] }));
    const funnelMax = Math.max(1, ...d.funnel.map((f) => f.count));

    return (
        <Screen
            title='Procurement dashboard'
            subtitle={d.node ? `${d.node.name}` : 'Everything you can see'}
            onBack={() => navigate('organization_home')}
            actions={
                <Button variant='secondary' aria-label='Refresh' onClick={reload}>
                    <RefreshCw className='h-4 w-4' />
                </Button>
            }
            toolbar={
                <div className='flex flex-wrap items-center gap-2'>
                    <nav aria-label='Organization drill-down' className='flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm'>
                        <button type='button' className='min-h-11 text-brand' onClick={() => { setNodeId(''); setDrill(null); }}>
                            All
                        </button>
                        {d.trail.map((t) => (
                            <span key={t.id} className='flex items-center gap-1'>
                                <span className='text-muted'>›</span>
                                <button type='button' className='min-h-11 text-brand' onClick={() => { setNodeId(t.id); setDrill(null); }}>
                                    {t.name}
                                </button>
                            </span>
                        ))}
                    </nav>
                    <div className='w-40'>
                        <SelectField id='dash-type' label='Kind' value={type} onChange={(e) => setType(e.target.value)}>
                            <option value=''>All kinds</option>
                            <option value='material'>Materials</option>
                            <option value='service'>Services</option>
                            <option value='asset'>Assets</option>
                        </SelectField>
                    </div>
                    {vendorId && (
                        <Button variant='secondary' onClick={() => setVendorId('')}>
                            Supplier filter ✕
                        </Button>
                    )}
                </div>
            }
        >
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
                <Tile label='Open requirements' value={String(d.open.requirements)} sub={`${d.requirements.total} in total`} onClick={() => open({ title: 'Requirements', dataset: 'requirements' })} />
                <Tile label='Open requisitions' value={String(d.open.prs)} sub={`${d.prs.total} in total`} onClick={() => open({ title: 'Requisitions', dataset: 'prs' })} />
                <Tile label='Open orders' value={String(d.open.pos)} sub={`${d.pos.total} in total`} onClick={() => open({ title: 'Orders', dataset: 'pos' })} />
                <Tile label={`Order value (${d.currency})`} value={d.pos.valueHidden ? 'Partly hidden' : money(d.pos.value)} sub={`Requisitions ${money(d.prs.value)}`} />
                <Tile label='Overdue deliveries' value={String(d.overdue)} tone={d.overdue ? 'danger' : undefined} onClick={() => open({ title: 'Overdue orders', dataset: 'pos', overdue: true })} />
                <Tile label='Awaiting acknowledgement' value={String(d.unacknowledged)} onClick={() => open({ title: 'Sent, not acknowledged', dataset: 'pos', unacknowledged: true })} />
            </div>

            <Section title={d.node ? `Inside ${d.node.name}` : 'By legal entity, site, department and cost center'}>
                <p className='text-xs text-muted'>Tap a row to go one level down. Counts are requirements · requisitions · orders.</p>
                <Bars
                    items={d.children.map((c) => ({ key: c.id, label: `${c.name} (${c.level.replace('_', ' ')})`, value: c.requirements + c.prs + c.pos, note: `${c.requirements} · ${c.prs} · ${c.pos}${c.poValue ? ` · ${money(c.poValue)}` : ''}` }))}
                    onPick={(k) => {
                        const c = d.children.find((x) => x.id === k);
                        if (c && c.level === 'cost_center') open({ title: `${c.name}: orders`, dataset: 'pos', childId: c.id });
                        else {
                            setNodeId(k);
                            setDrill(null);
                        }
                    }}
                />
                {d.unassigned > 0 && <p className='text-xs text-muted'>{d.unassigned} record(s) have no cost center.</p>}
            </Section>

            <div className='grid grid-cols-1 gap-3 lg:grid-cols-3'>
                <Section title='Requirements by status'>
                    <Bars items={statusItems(d.requirements.byStatus)} onPick={(k) => open({ title: `Requirements: ${d.requirements.byStatus.find((r) => r.status === k)?.label}`, dataset: 'requirements', status: k })} />
                </Section>
                <Section title='Requisitions by status'>
                    <Bars items={statusItems(d.prs.byStatus)} tone='bg-amber-400' onPick={(k) => open({ title: `Requisitions: ${d.prs.byStatus.find((r) => r.status === k)?.label}`, dataset: 'prs', status: k })} />
                </Section>
                <Section title='Orders by status'>
                    <Bars items={statusItems(d.pos.byStatus)} tone='bg-emerald-400' onPick={(k) => open({ title: `Orders: ${d.pos.byStatus.find((r) => r.status === k)?.label}`, dataset: 'pos', status: k })} />
                </Section>
            </div>

            <Section
                title='By month'
                right={
                    <div className='w-36'>
                        <SelectField id='dash-ms' label='Chart' value={monthSet} onChange={(e) => setMonthSet(e.target.value as Dataset)}>
                            {(Object.keys(DATASET_LABEL) as Dataset[]).map((k) => (
                                <option key={k} value={k}>
                                    {DATASET_LABEL[k]}
                                </option>
                            ))}
                        </SelectField>
                    </div>
                }
            >
                <Bars items={monthItems} tone={monthSet === 'prs' ? 'bg-amber-400' : monthSet === 'pos' ? 'bg-emerald-400' : 'bg-brand'} onPick={(k) => open({ title: `${DATASET_LABEL[monthSet]} created in ${k}`, dataset: monthSet, month: k })} />
                <RichTable
                    id='prc.dash.months'
                    columns={[
                        { key: 'm', label: 'Month', value: (m) => m.month },
                        { key: 'rq', label: 'Requirements', type: 'number', value: (m) => m.requirements },
                        { key: 'pr', label: 'Requisitions', type: 'number', value: (m) => m.prs },
                        { key: 'po', label: 'Orders', type: 'number', value: (m) => m.pos },
                        { key: 'pa', label: 'Orders fully approved', type: 'number', value: (m) => m.posApproved },
                        { key: 'pv', label: `Order value (${d.currency})`, type: 'number', value: (m) => m.poValue, render: (m) => money(m.poValue) },
                        { key: 'a', label: 'Requirement to requisition (days)', type: 'number', value: (m) => m.reqToPr },
                        { key: 'b', label: 'Requisition to order (days)', type: 'number', value: (m) => m.prToPo },
                        { key: 'c', label: 'Order approval (days)', type: 'number', value: (m) => m.poApproval },
                    ]}
                    rows={d.months}
                    rowKey={(m) => m.month}
                    onRowClick={(m) => open({ title: `${DATASET_LABEL[monthSet]} created in ${m.month}`, dataset: monthSet, month: m.month })}
                    empty='Nothing yet.'
                    fileName='procurement-by-month'
                    height='h-72'
                />
            </Section>

            <Section title='Requirement to requisition to order to full approval'>
                <ul className='space-y-1'>
                    {d.funnel.map((f) => (
                        <li key={f.key} className='text-sm'>
                            <div className='flex justify-between gap-2'>
                                <span className='text-ink'>{f.label}</span>
                                <span className='font-semibold text-ink'>{f.count}</span>
                            </div>
                            <div className='mt-1 h-2 overflow-hidden rounded-full bg-page'>
                                <div className='h-full rounded-full bg-brand' style={{ width: `${Math.max(2, (f.count / funnelMax) * 100)}%` }} />
                            </div>
                        </li>
                    ))}
                </ul>
                <p className='text-xs text-soft'>
                    Requirements that became requisitions: {num(d.conversion.requirementToPr, '%')} · Requisitions that became orders: {num(d.conversion.prToPo, '%')} · Submitted orders fully approved: {num(d.conversion.poToApproved, '%')}
                </p>
            </Section>

            <Section title='Lead time analysis: average days in each stage'>
                <Bars items={d.stages.map((s) => ({ key: s.key, label: s.label, value: s.avgDays ?? 0, note: `${s.count} record(s)` }))} tone='bg-sky-400' />
                <p className='text-xs text-soft'>
                    Delivered orders: {d.leadTime.delivered} · quoted lead time {num(d.leadTime.avgQuotedDays, ' days')} · actual {num(d.leadTime.avgActualDays, ' days')} · on time {num(d.leadTime.onTimePct, '%')}
                </p>
            </Section>

            <Section title='Age of orders still to be delivered'>
                <Bars items={d.ageing.map((a) => ({ key: a.key, label: a.label, value: a.count, note: a.value ? money(a.value) : undefined }))} tone='bg-red-400' onPick={(k) => open({ title: `Open orders aged ${d.ageing.find((a) => a.key === k)?.label}`, dataset: 'pos', bucket: k })} />
            </Section>

            <Section title='Orders by kind'>
                <Bars items={d.types.map((t) => ({ key: t.type, label: t.label, value: t.pos, note: `${t.prs} requisition(s)${t.value ? ` · ${money(t.value)}` : ''}` }))} onPick={(k) => setType(k)} />
            </Section>

            <Section title='By supplier'>
                <RichTable
                    id='prc.dash.vendors'
                    columns={[
                        { key: 'v', label: 'Supplier', value: (v) => v.vendorName },
                        { key: 'n', label: 'Orders', type: 'number', value: (v) => v.pos },
                        { key: 'o', label: 'Open', type: 'number', value: (v) => v.open },
                        { key: 'od', label: 'Overdue', type: 'number', value: (v) => v.overdue },
                        { key: 'val', label: `Value (${d.currency})`, type: 'number', value: (v) => v.value, render: (v) => money(v.value) },
                        { key: 'dl', label: 'Delivered', type: 'number', value: (v) => v.delivered },
                        { key: 'ot', label: 'On time %', type: 'number', value: (v) => v.onTimePct },
                        { key: 'q', label: 'Quoted lead (days)', type: 'number', value: (v) => v.avgQuotedDays },
                        { key: 'a', label: 'Actual lead (days)', type: 'number', value: (v) => v.avgActualDays },
                        { key: 'ak', label: 'Acknowledged %', type: 'number', value: (v) => v.acknowledgedPct },
                    ]}
                    rows={d.vendors}
                    rowKey={(v) => v.vendorId}
                    onRowClick={(v) => setVendorId(v.vendorId)}
                    empty='No orders yet.'
                    fileName='procurement-by-supplier'
                    height='h-80'
                    rowClassName={(v) => (v.overdue ? 'bg-red-500/10' : '')}
                />
                <p className='text-xs text-muted'>Tap a supplier to filter the whole dashboard to it.</p>
            </Section>

            <div ref={drillRef}>{drill && <Records drill={drill} filters={filters} currency={d.currency} />}</div>
            {drill && (
                <Button variant='secondary' onClick={() => setDrill(null)}>
                    Close the list
                </Button>
            )}
        </Screen>
    );
}
