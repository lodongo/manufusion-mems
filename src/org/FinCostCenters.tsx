import { useEffect, useState } from 'react';
import { BookOpen, Boxes, Coins, FileText, LayoutDashboard, Search, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { restoredTableTab } from '../lib/tableTabs';
import { Button, Spinner, useLoad } from '../admin/kit';
import { useConfirm } from '../components/screen';
import { Balance, Card, FIN_API, FinScreen, Facts, Pending, Pill, fmt, go, useEntity, type Entity } from './finKit';
import { JournalFeed } from './FinJournal';

// Cost centers of a legal entity in finance: every cost center of the entity with its posting status (open, blocked,
// closed), its account list (a narrower set of the approved profit and loss accounts, which can be imported from another
// cost center), the cost center journal, its stock valuation when it is a warehouse, and placeholders for its budget and
// reports. Changes are proposed and approved; cost center owners see their own cost centers.

interface CcRow {
    id: string;
    code: string;
    name: string;
    department: string;
    site: string;
    costType: string;
    structureStatus: string;
    status: string;
    statusLabel: string;
    restricted: number;
    warehouse: boolean;
    owned: boolean;
    actual: number;
}
const COLS: Array<Column<CcRow>> = [
    { key: 'code', label: 'Cost center', value: (r) => r.code, render: (r) => <span className='font-mono text-xs'>{r.code}</span> },
    { key: 'name', label: 'Name', value: (r) => r.name },
    { key: 'st', label: 'Posting', value: (r) => r.status, render: (r) => <Pill status={r.status} label={r.statusLabel} /> },
    { key: 'act', label: 'Actual this year', type: 'number', value: (r) => r.actual, render: (r) => <Balance value={r.actual} /> },
    { key: 'dep', label: 'Department', value: (r) => r.department },
    { key: 'site', label: 'Site', value: (r) => r.site, hidden: true },
    { key: 'type', label: 'Type', value: (r) => r.costType, hidden: true },
    { key: 'list', label: 'Account list', type: 'number', value: (r) => r.restricted, render: (r) => (r.restricted ? `${r.restricted} accounts` : 'All open') },
    { key: 'wh', label: 'Warehouse', value: (r) => (r.warehouse ? 'Yes' : '') },
    { key: 'own', label: 'Mine', value: (r) => (r.owned ? 'Yes' : ''), hidden: true },
    { key: 'ss', label: 'Structure status', value: (r) => r.structureStatus, hidden: true },
];

function List({ le }: { le: Entity }) {
    const { data, error, loading } = useLoad(() => callBackend<{ fy: number; costCenters: CcRow[] }>(`${FIN_API}/cc/list`, { leId: le.id }), [le.id]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the cost centers.'}</Alert>;
    return <RichTable id='fin.cc' title={`Cost centers of ${le.code} · actual FY ${data.fy}`} columns={COLS} rows={data.costCenters} rowKey={(r) => r.id} onRowClick={(r) => go(`fin_cc/${r.id}`)} empty='No cost centers in this legal entity.' fileName={`cost-centers-${le.code}`} height='h-[calc(100dvh-19rem)]' rowClassName={(r) => (r.status !== 'open' ? 'opacity-70' : '')} />;
}

interface CcData {
    cc: { id: string; code: string; name: string; costType: string; structureStatus: string; department: string; site: string; managerRoleCode: string; warehouse: boolean };
    status: string;
    statusLabel: string;
    statuses: Record<string, string>;
    allowedGl: Array<{ code: string; name: string; status: string }>;
    choosable: Array<{ code: string; name: string }>;
    importFrom: Array<{ id: string; code: string; name: string; count: number }>;
    version: number;
    pending: Array<{ id: string; title: string; makerName: string; next: string }>;
    owned: boolean;
    can: Record<string, boolean>;
}

function Settings({ le, d, onDone }: { le: Entity; d: CcData; onDone: (m: string) => void }) {
    const [status, setStatus] = useState(d.status);
    const [list, setList] = useState<string[]>(d.allowedGl.map((g) => g.code));
    const [q, setQ] = useState('');
    const [from, setFrom] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        setStatus(d.status);
        setList(d.allowedGl.map((g) => g.code));
    }, [d]);
    const can = d.can.cc_manage;
    const changed = status !== d.status || JSON.stringify([...list].sort()) !== JSON.stringify(d.allowedGl.map((g) => g.code).sort());
    const options = d.choosable.filter((a) => !list.includes(a.code) && `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
    const nameOf = (c: string) => d.choosable.find((a) => a.code === c)?.name ?? d.allowedGl.find((a) => a.code === c)?.name ?? '';
    return (
        <>
            <Card title='Posting status'>
                <SelectField id='fcc-st' label='Status' value={status} disabled={!can} onChange={(e) => setStatus(e.target.value)} hint='Open: takes postings. Blocked: no new postings for now. Closed: no postings any more.'>
                    {Object.entries(d.statuses).map(([k, v]) => (
                        <option key={k} value={k}>
                            {v}
                        </option>
                    ))}
                </SelectField>
            </Card>
            <Card title={`Account list (${list.length ? `${list.length} accounts` : 'every open profit and loss account'})`}>
                <p className='text-xs text-soft'>Narrow the profit and loss accounts people may charge to this cost center. Balance sheet and system accounts are not affected. Leave empty to allow every approved open account.</p>
                <ul className='space-y-1'>
                    {list.map((c) => (
                        <li key={c} className='flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm'>
                            <span className='font-mono text-xs text-muted'>{c}</span>
                            <span className='min-w-0 flex-1 truncate text-ink'>{nameOf(c)}</span>
                            {can && (
                                <button type='button' aria-label={`Remove ${c}`} onClick={() => setList(list.filter((x) => x !== c))} className='flex h-10 w-10 items-center justify-center text-soft'>
                                    <X className='h-4 w-4' />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                {can && (
                    <>
                        <label className='flex h-12 items-center gap-2 rounded-xl border border-line bg-page px-3'>
                            <Search className='h-4 w-4 text-muted' />
                            <input aria-label='Find an approved account' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Find an approved profit and loss account' className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
                        </label>
                        {q.trim().length > 0 && (
                            <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                {options.map((a) => (
                                    <li key={a.code}>
                                        <button type='button' onClick={() => setList([...list, a.code])} className='flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm active:bg-page'>
                                            <span className='font-mono text-xs text-muted'>{a.code}</span>
                                            <span className='min-w-0 flex-1 truncate text-ink'>{a.name}</span>
                                        </button>
                                    </li>
                                ))}
                                {!options.length && <li className='p-3 text-xs text-muted'>No match.</li>}
                            </ul>
                        )}
                    </>
                )}
            </Card>
            {can && (
                <Button disabled={!changed} onClick={() => confirm.ask({ title: `Propose changes to ${d.cc.code}`, message: 'A person with FIN.cc.approve must approve before they apply.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/cc/propose`, { leId: le.id, ccId: d.cc.id, status, allowedGl: list, reason }); onDone('Proposed for approval.'); })}>
                    Propose changes
                </Button>
            )}
            {can && d.importFrom.length > 0 && (
                <Card title='Import the account list of another cost center'>
                    <SelectField id='fcc-imp' label='Import from' value={from} onChange={(e) => setFrom(e.target.value)}>
                        <option value=''>Choose</option>
                        {d.importFrom.map((x) => (
                            <option key={x.id} value={x.id}>
                                {x.code} {x.name} ({x.count} accounts)
                            </option>
                        ))}
                    </SelectField>
                    <div className='flex flex-wrap gap-2'>
                        <Button variant='secondary' disabled={!from} onClick={() => confirm.ask({ title: 'Propose replacing the list', message: 'This cost center gets exactly the other cost center\'s account list.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/cc/propose`, { leId: le.id, ccId: d.cc.id, status, fromCcId: from, merge: false, reason }); setFrom(''); onDone('Import proposed for approval.'); })}>
                            Replace with it
                        </Button>
                        <Button variant='secondary' disabled={!from} onClick={() => confirm.ask({ title: 'Propose adding its accounts', message: 'The other cost center\'s accounts are added to this list.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/cc/propose`, { leId: le.id, ccId: d.cc.id, status, fromCcId: from, merge: true, reason }); setFrom(''); onDone('Import proposed for approval.'); })}>
                            Add to this list
                        </Button>
                    </div>
                </Card>
            )}
            {confirm.sheet}
        </>
    );
}

interface StockItem {
    materialId: string;
    materialNumber: string;
    name: string;
    physical: number;
    valuedQty: number;
    value: number;
    avg: number;
    gap: number;
}
function Stock({ le, ccId, onDone }: { le: Entity; ccId: string; onDone: (m: string) => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ items: StockItem[]; total: number; canPropose: boolean; finance: string }>(`${FIN_API}/stock/list`, { leId: le.id, warehouseId: ccId }), [le.id, ccId]);
    const [cost, setCost] = useState<Record<string, string>>({});
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the stock valuation.'}</Alert>;
    const gaps = data.items.filter((i) => i.gap > 0);
    const filled = gaps.filter((i) => Number(cost[i.materialId]) > 0);
    return (
        <>
            <Card title={`Stock valuation (moving average) · ${fmt(data.total)} ${le.functionalCurrency}`}>
                <RichTable
                    id='fin.stock'
                    tabKey='stock'
                    columns={[
                        { key: 'm', label: 'Material', value: (i: StockItem) => `${i.materialNumber} ${i.name}` },
                        { key: 'p', label: 'Physical', type: 'number', value: (i) => i.physical },
                        { key: 'vq', label: 'Valued quantity', type: 'number', value: (i) => i.valuedQty },
                        { key: 'v', label: 'Value', type: 'number', value: (i) => i.value, render: (i) => fmt(i.value) },
                        { key: 'a', label: 'Average cost', type: 'number', value: (i) => i.avg, render: (i) => fmt(i.avg, 4) },
                        { key: 'g', label: 'Not valued', type: 'number', value: (i) => i.gap, render: (i) => <span className={i.gap ? 'font-semibold text-amber-300' : 'text-muted'}>{i.gap}</span> },
                    ]}
                    rows={data.items}
                    rowKey={(i) => i.materialId}
                    empty='No stock in this warehouse.'
                    fileName={`stock-valuation-${le.code}-${ccId}`}
                    height='h-72'
                />
            </Card>
            {gaps.length > 0 && (
                <Card title='Value stock that has no cost yet' tone='warn'>
                    <p className='text-xs text-soft'>Stock that existed before finance went live has quantities but no value. Enter the unit cost ({le.functionalCurrency}) of each; the valuation is posted (Dr inventory, Cr opening balance) once approved under the finance chart of authority.</p>
                    {data.finance !== 'live' && <Alert tone='info'>The legal entity must be live in finance first.</Alert>}
                    {gaps.map((i) => (
                        <Field key={i.materialId} id={`fsv-${i.materialId}`} label={`${i.materialNumber} ${i.name}: ${i.gap} not valued`} inputMode='decimal' value={cost[i.materialId] ?? ''} disabled={!data.canPropose} onChange={(e) => setCost({ ...cost, [i.materialId]: e.target.value.replace(/[^\d.]/g, '') })} hint={Number(cost[i.materialId]) > 0 ? `Value ${fmt(i.gap * Number(cost[i.materialId]))}` : undefined} />
                    ))}
                    {data.canPropose && (
                        <Button disabled={!filled.length || data.finance !== 'live'} onClick={() => confirm.ask({ title: `Propose valuing ${filled.length} material(s)`, message: `Total ${fmt(filled.reduce((s, i) => s + i.gap * Number(cost[i.materialId]), 0))} ${le.functionalCurrency}.`, confirmLabel: 'Propose', acknowledge: 'The unit costs come from supporting documents (last purchase invoices or an approved valuation).', reason: { label: 'Basis of the valuation', minLength: 15 } }, async (reason) => { await callBackend(`${FIN_API}/stock/opening/propose`, { leId: le.id, warehouseId: ccId, items: filled.map((i) => ({ materialId: i.materialId, unitCost: Number(cost[i.materialId]) })), reason }); setCost({}); reload(); onDone('Valuation proposed for approval.'); })}>
                            Propose valuation
                        </Button>
                    )}
                </Card>
            )}
            {confirm.sheet}
        </>
    );
}

type CcTab = 'overview' | 'journal' | 'budget' | 'stock' | 'reports';
function Detail({ le, ccId, tab }: { le: Entity; ccId: string; tab: CcTab }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<CcData>(`${FIN_API}/cc/get`, { leId: le.id, ccId }), [le.id, ccId]);
    const [msg, setMsg] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Cost center not found.'}</Alert>;
    const d = data;
    const done = (m: string) => {
        setMsg(m);
        reload();
    };
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            {tab === 'overview' ? (
                <Card title={`${d.cc.code} ${d.cc.name}`} right={<Pill status={d.status} label={d.statusLabel} />}>
                    <Facts rows={[['Department', d.cc.department], ['Site', d.cc.site], ['Type', d.cc.costType], ['Structure status', d.cc.structureStatus], ['Warehouse', d.cc.warehouse ? 'Yes' : 'No'], ['You own it', d.owned ? 'Yes' : 'No'], ['Settings version', String(d.version)]]} />
                </Card>
            ) : (
                <p className='flex items-center gap-2 text-sm text-ink'>
                    <span className='font-mono text-xs text-muted'>{d.cc.code}</span>
                    <span className='min-w-0 flex-1 truncate'>{d.cc.name}</span>
                    <Pill status={d.status} label={d.statusLabel} />
                </p>
            )}
            <Pending items={d.pending.map((p) => ({ ...p, typeLabel: 'Cost center' }))} />
            {tab === 'overview' && <Settings le={le} d={d} onDone={done} />}
            {tab === 'journal' && (d.can.journal ? <JournalFeed le={le} ccId={ccId} height='h-[calc(100dvh-24rem)]' /> : <Alert tone='info'>The cost center journal needs FIN.journal.view or owning the cost center.</Alert>)}
            {tab === 'budget' && <Alert tone='info'>Budgeting is not built yet. The active budget of this cost center will show here with actual against budget.</Alert>}
            {tab === 'reports' && <Alert tone='info'>Cost center reports are not built yet.</Alert>}
            {tab === 'stock' && (d.cc.warehouse ? <Stock le={le} ccId={ccId} onDone={done} /> : <Alert tone='info'>This cost center is not a warehouse, so it holds no stock.</Alert>)}
        </>
    );
}

export default function FinCostCenters({ id }: { id?: string }) {
    const ent = useEntity();
    const [tab, setTab] = useState<CcTab>(() => restoredTableTab<CcTab>(['overview','journal','budget','stock','reports'], 'overview'));
    return (
        <FinScreen
            title={id ? 'Cost center' : 'Cost Centers'}
            subtitle={id ? 'Finance settings, journal and stock' : 'Every cost center of the legal entity'}
            onBack={() => (id ? go('fin_cc') : go('module/FIN'))}
            entityState={ent}
            nav={id ? [{ value: 'overview', label: 'Overview', icon: LayoutDashboard }, { value: 'journal', label: 'Journal', icon: BookOpen }, { value: 'budget', label: 'Active budget', icon: Coins }, { value: 'stock', label: 'Stock', icon: Boxes }, { value: 'reports', label: 'Reports', icon: FileText }] : undefined}
            navValue={id ? tab : undefined}
            onNav={setTab}
        >
            {(le) => (id ? <Detail le={le} ccId={id} tab={tab} /> : <List le={le} />)}
        </FinScreen>
    );
}
