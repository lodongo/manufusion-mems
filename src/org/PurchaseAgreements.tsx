import { useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarClock, FileText, MoreVertical, Paperclip, Plus, Send } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SearchField, SelectField, TextArea } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import Sheet from '../components/Sheet';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { downloadReportPdf } from '../lib/report';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';

// Purchase agreements (PA + 8 digits) for spares bought from one approved supplier for a period.
// Draft -> RFQ to the supplier -> each item's quote recorded (checked against the material's procurement setup)
// -> PDF attachment -> submitted -> approved under the chart of authority -> activated -> active: the agreement's
// parameters are the materials' procurement parameters (shown in blue) -> expired or terminated. Items can be
// overridden. The server decides who may do what; this screen only offers what it is told is allowed.

const BASE = 'organization_home/procurement_agreements';
const API = '/api/org/procurement/agreements';
const PA = /^PA\d{8}$/;
const MAX_PDF = 10 * 1024 * 1024;

type Obj = Record<string, unknown>;
interface Row {
    id: string; number: string; title: string; vendorName: string; vendorNumber: string; status: string; statusLabel: string;
    startDate: string; endDate: string; currency: string; items: number; quoted: number; applied: number; value: number;
    orgCurrency: string; daysRemaining: number | null; inDate: boolean; ownerName: string; updatedAt: string;
}
interface Quote { unitPrice: number; currency: string; uom: string; leadTimeDays: number; minimumOrderQuantity: number | null; orderMultiple: number | null; vendorPartNumber: string; paymentTerms: string; incoterms: string; quotedAt: string; quotedByName: string }
interface Item {
    no: number; materialId: string; materialNumber: string; name: string; warehouseId: string; warehouseCode: string; warehouseName: string;
    purchaseUom: string; expectedQty: number; standard: Obj; quote?: Quote; applied?: boolean; override?: { on: boolean; reason: string; byName: string; at: string };
}
interface Step { level: string; title: string; positionTitle: string; status: string; byName: string; at: string; note: string }
interface Use { no: number; orderedQty: number; receivedQty: number; orderedValue: number; savings: number | null; standardInAgreement: number | null; agreedPrice: number; priceBreaches: number; orders: number }
interface Dash {
    currency: string; active: boolean; totalDays: number; elapsedDays: number; daysRemaining: number; timeUsedPct: number; expectedValue: number;
    orderedValue: number; utilisationPct: number; savings: number; potentialSavings: number; materialsPurchased: number; orders: number;
    priceBreaches: number; itemsApplied: number; itemsOverridden: number; noStandardPrice: number; items: Use[];
}
interface Detail extends Omit<Row, 'items'> {
    notes: string; quoteReference: string; quoteDate: string; vendorEmail: string; rfq: Obj; items: Item[];
    attachments: Array<{ id: string; name: string; bytes: number; sha256: string; uploadedAt: string; uploadedByName: string }>;
    approval: { amount?: number; steps?: Step[] }; history: Array<{ at: string; byName: string; action: string; note: string }>;
    applyProblems: string[]; returnReason: string; rejectReason: string; terminateReason: string; version: number;
}
interface Can { edit: boolean; items: boolean; rfq: boolean; quote: boolean; attach: boolean; submit: boolean; approve: boolean; approveWhy: string; activate: boolean; override: boolean; terminate: boolean; cancel: boolean }

const money = (n: number | null | undefined, cur = '') => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${cur ? `${cur} ` : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (s === 'active' ? 'brand' : ['pending_approval', 'returned', 'rfq_sent'].includes(s) ? 'warn' : ['rejected', 'cancelled', 'terminated'].includes(s) ? 'danger' : 'muted');
const today = () => new Date().toISOString().slice(0, 10);
const blueRow = 'text-blue-300';

export default function PurchaseAgreements({ id }: { id?: string }) {
    if (id === 'new') return <NewAgreement />;
    if (id && PA.test(id)) return <AgreementDetail id={id} />;
    return <AgreementList />;
}

// ----- List -----

function AgreementList() {
    const { data, error, loading } = useLoad(() => callBackend<{ agreements: Row[]; can: { manage: boolean; approve: boolean }; orgCurrency: string }>(`${API}/list`, {}));
    const [view, setView] = useState<'active' | 'progress' | 'ended' | 'all'>('active');
    const rows = useMemo(() => {
        const all = data?.agreements ?? [];
        if (view === 'active') return all.filter((r) => ['active', 'scheduled', 'approved'].includes(r.status));
        if (view === 'progress') return all.filter((r) => ['draft', 'rfq_sent', 'returned', 'pending_approval'].includes(r.status));
        if (view === 'ended') return all.filter((r) => ['expired', 'terminated', 'rejected', 'cancelled'].includes(r.status));
        return all;
    }, [data, view]);
    const columns: Array<Column<Row>> = [
        { key: 'number', label: 'Agreement', value: (r) => r.number, render: (r) => <span className={`font-mono ${r.status === 'active' ? blueRow : ''}`}>{r.number}</span> },
        { key: 'title', label: 'Title', value: (r) => r.title },
        { key: 'vendor', label: 'Supplier', value: (r) => r.vendorName },
        { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
        { key: 'start', label: 'Start', type: 'date', value: (r) => r.startDate },
        { key: 'end', label: 'End', type: 'date', value: (r) => r.endDate },
        { key: 'days', label: 'Days remaining', type: 'number', value: (r) => r.daysRemaining },
        { key: 'items', label: 'Materials', type: 'number', value: (r) => r.items },
        { key: 'applied', label: 'Using agreement', type: 'number', value: (r) => r.applied },
        { key: 'value', label: 'Value (org currency)', type: 'number', value: (r) => r.value || null },
        { key: 'currency', label: 'Currency', value: (r) => r.currency, hidden: true },
        { key: 'owner', label: 'Officer', value: (r) => r.ownerName, hidden: true },
        { key: 'updated', label: 'Updated', type: 'date', value: (r) => r.updatedAt.slice(0, 10), hidden: true },
    ];
    return (
        <Screen
            title='Purchase agreements'
            subtitle='Agreed prices and terms for spares, per supplier and period'
            onBack={() => navigate('organization_home')}
            actions={data?.can.manage ? <Button onClick={() => navigate(`${BASE}/new`)}><Plus className='h-4 w-4' />New</Button> : undefined}
            toolbar={<Segmented label='Agreements' value={view} onChange={setView} options={[{ value: 'active', label: 'Active', count: (data?.agreements ?? []).filter((r) => ['active', 'scheduled', 'approved'].includes(r.status)).length }, { value: 'progress', label: 'In progress' }, { value: 'ended', label: 'Ended' }, { value: 'all', label: 'All' }]} />}
            bodyFlush
        >
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : (
                <RichTable<Row>
                    id='prc.agreements.list'
                    tabKey={view}
                    title='Purchase agreements'
                    columns={columns}
                    rows={rows}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => navigate(`${BASE}/${r.id}`)}
                    rowClassName={(r) => (r.status === 'active' ? blueRow : '')}
                    empty={view === 'active' ? 'No active agreements.' : 'Nothing here.'}
                    fileName='purchase-agreements'
                    height='h-full'
                />
            )}
        </Screen>
    );
}

// ----- New -----

function NewAgreement() {
    const { data, error, loading } = useLoad(() => callBackend<{ vendors: Array<{ id: string; number: string; name: string; currency: string; paymentTerms: string; email: boolean; materialScopes: number }>; currencies: string[]; orgCurrency: string }>(`${API}/options`, {}));
    const [f, setF] = useState({ vendorId: '', title: '', startDate: today(), endDate: '', currency: '', notes: '' });
    const [confirm, setConfirm] = useState(false);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const vendor = data?.vendors.find((v) => v.id === f.vendorId);
    const currency = f.currency || vendor?.currency || data?.orgCurrency || '';
    const problems = [
        ...(f.vendorId ? [] : ['Choose the supplier.']),
        ...(vendor && !vendor.materialScopes ? ['This supplier is not approved for any material category.'] : []),
        ...(f.title.trim().length >= 3 ? [] : ['Give a title of at least 3 characters.']),
        ...(f.startDate ? [] : ['Enter the start date.']),
        ...(f.endDate ? (f.endDate >= f.startDate ? (f.endDate >= today() ? [] : ['The end date has already passed.']) : ['The end date must be on or after the start date.']) : ['Enter the end date.']),
        ...(currency ? [] : ['Choose the agreement currency.']),
        ...(confirm ? [] : ['Confirm the supplier and the period.']),
    ];
    const create = async () => {
        setTried(true);
        setFailure('');
        if (problems.length) return;
        setBusy(true);
        try {
            const r = await callBackend<{ id: string }>(`${API}/create`, { ...f, currency, confirm: true });
            navigate(`${BASE}/${r.id}`);
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Screen title='New purchase agreement' onBack={() => navigate(BASE)} actions={<Button busy={busy} onClick={() => void create()}>Create</Button>}>
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : (
                <div className='mx-auto max-w-xl space-y-3'>
                    <SelectField label='Supplier' value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value, currency: '' })} error={tried && !f.vendorId ? 'Choose the supplier' : undefined} hint='Approved suppliers only. Materials come from the categories the supplier is approved for.'>
                        <option value=''>Choose…</option>
                        {data!.vendors.map((v) => <option key={v.id} value={v.id}>{`${v.number} · ${v.name}`}</option>)}
                    </SelectField>
                    <Field label='Title' value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder='e.g. Pump spares 2027' error={tried && f.title.trim().length < 3 ? 'At least 3 characters' : undefined} />
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                        <Field label='Start date' type='date' value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
                        <Field label='End date' type='date' value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
                    </div>
                    <SelectField label='Agreement currency' value={currency} onChange={(e) => setF({ ...f, currency: e.target.value })} hint={vendor?.currency ? `The supplier trades in ${vendor.currency}.` : undefined}>
                        {data!.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                    <TextArea label='Notes' value={f.notes} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                    <label className='flex min-h-[44px] items-start gap-3 rounded-xl border border-line p-3 text-sm text-soft'>
                        <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0' checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                        <span>The supplier and the period are correct.</span>
                    </label>
                    {tried && problems.length > 0 && <Alert tone='warn'>{problems.join(' ')}</Alert>}
                    {failure && <Alert tone='error'>{failure}</Alert>}
                </div>
            )}
        </Screen>
    );
}

// ----- Detail -----

type Tab = 'overview' | 'items' | 'attachments' | 'approval' | 'history';

function AgreementDetail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ agreement: Detail; can: Can; dashboard: Dash | null; currencies: string[] }>(`${API}/get`, { id }), [id]);
    const [tab, setTab] = useState<Tab>('overview');
    const [menu, setMenu] = useState(false);
    const [item, setItem] = useState<Item | null>(null);
    const [adding, setAdding] = useState(false);
    const [rfq, setRfq] = useState(false);
    const [note, setNote] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const { ask, sheet } = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'The agreement could not be loaded.'}</Alert>;
    const a = data.agreement;
    const can = data.can;
    const d = data.dashboard;
    const call = async (path: string, body: Obj, done: string) => {
        await callBackend(`${API}/${path}`, { id, ...body });
        setNote({ tone: 'success', text: done });
        reload();
    };

    const actions: Array<{ key: string; label: string; run: () => void; danger?: boolean }> = [];
    if (can.rfq) actions.push({ key: 'rfq', label: a.rfq.sentAt ? 'Send the RFQ again' : 'Send RFQ to the supplier', run: () => setRfq(true) });
    if (can.submit) actions.push({ key: 'submit', label: 'Submit for approval', run: () => ask({ title: 'Submit for approval?', message: `Every quote is checked again against the materials' procurement setup and the value (expected quantity × agreed price) goes through the chart of authority.`, confirmLabel: 'Submit', acknowledge: 'The quotes match the supplier\'s quote and the attached document.' }, () => call('submit', { acknowledge: true }, 'Submitted for approval.')) });
    if (can.approve) {
        actions.push({ key: 'approve', label: 'Approve', run: () => ask({ title: `Approve ${a.number}?`, message: `Value ${money(a.approval.amount ?? a.value, a.orgCurrency)} for ${a.items.length} material(s), ${a.startDate} to ${a.endDate}.`, confirmLabel: 'Approve', acknowledge: 'I reviewed the quotes, the attachment and the value.' }, () => call('approve', { acknowledge: true }, 'Approved.')) });
        actions.push({ key: 'return', label: 'Return for correction', run: () => ask({ title: 'Return the agreement?', message: 'It goes back to the officer with your reason.', confirmLabel: 'Return', reason: { label: 'Reason', minLength: 20 } }, (reason) => call('return', { reason }, 'Returned to the officer.')) });
        actions.push({ key: 'reject', label: 'Reject', danger: true, run: () => ask({ title: 'Reject the agreement?', message: 'A rejected agreement cannot be used.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 20 } }, (reason) => call('reject', { reason }, 'Rejected.')) });
    }
    if (can.activate) actions.push({ key: 'activate', label: 'Activate', run: () => ask({ title: `Activate ${a.number}?`, message: a.startDate > today() ? `It starts on ${a.startDate}. From then, its parameters replace the materials' procurement parameters (shown in blue) until ${a.endDate}.` : `From now until ${a.endDate}, its parameters replace the materials' procurement parameters (shown in blue). The materials' own values are kept and come back when it ends.`, confirmLabel: 'Activate', acknowledge: 'The agreement parameters replace the materials\' procurement parameters while it is active.' }, () => call('activate', { acknowledge: true }, 'Activated.')) });
    if (can.terminate) actions.push({ key: 'terminate', label: 'Terminate', danger: true, run: () => ask({ title: 'Terminate the agreement?', message: 'The materials go back to their own procurement parameters at once. This cannot be undone.', confirmLabel: 'Terminate', tone: 'danger', reason: { label: 'Reason', minLength: 20 }, phrase: 'TERMINATE', acknowledge: 'The materials go back to their own procurement parameters.' }, (reason) => call('terminate', { reason, acknowledge: true }, 'Terminated.')) });
    if (can.cancel) actions.push({ key: 'cancel', label: 'Cancel the agreement', danger: true, run: () => ask({ title: 'Cancel the agreement?', message: 'A cancelled agreement cannot be reopened.', confirmLabel: 'Cancel agreement', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, (reason) => call('cancel', { reason }, 'Cancelled.')) });
    actions.push({ key: 'pdf', label: 'Download RFQ / agreement PDF', run: () => void agreementPdf(a) });
    const primary = actions.find((x) => ['approve', 'submit', 'activate', 'rfq'].includes(x.key));

    return (
        <Screen
            eyebrow={a.number}
            title={a.title}
            subtitle={`${a.vendorName} · ${a.statusLabel}`}
            onBack={() => navigate(BASE)}
            actions={
                <>
                    {primary && <Button onClick={primary.run}>{primary.key === 'rfq' ? <Send className='h-4 w-4' /> : null}{primary.label.split(' ')[0]}</Button>}
                    <button type='button' aria-label='Actions' onClick={() => setMenu(true)} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                        <MoreVertical className='h-5 w-5' />
                    </button>
                </>
            }
            toolbar={<Segmented label='Agreement sections' value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'items', label: 'Materials', count: a.items.length }, { value: 'attachments', label: 'Attachments', count: a.attachments.length }, { value: 'approval', label: 'Approval' }, { value: 'history', label: 'History' }]} />}
            bodyFlush={tab === 'items'}
        >
            {note && tab !== 'items' && <Alert tone={note.tone}>{note.text}</Alert>}
            {tab === 'overview' && <Overview a={a} can={can} d={d} currencies={data.currencies} onSaved={(t) => { setNote({ tone: 'success', text: t }); reload(); }} />}
            {tab === 'items' && (
                <ItemsTable a={a} can={can} d={d} onOpen={setItem} onAdd={() => setAdding(true)} />
            )}
            {tab === 'attachments' && <Attachments a={a} can={can} onChange={(t) => { setNote({ tone: 'success', text: t }); reload(); }} ask={ask} />}
            {tab === 'approval' && <Approval a={a} can={can} />}
            {tab === 'history' && (
                <div className='space-y-2'>
                    {a.history.map((h, i) => (
                        <div key={`${h.at}-${i}`} className='rounded-xl border border-line bg-panel p-3 text-sm'>
                            <p className='font-medium text-ink'>{h.action}</p>
                            <p className='text-xs text-muted'>{h.byName} · {fmtDate(h.at)}</p>
                            {h.note && <p className='mt-1 text-soft'>{h.note}</p>}
                        </div>
                    ))}
                </div>
            )}
            {menu && (
                <Sheet title='Actions' onClose={() => setMenu(false)}>
                    {actions.map((x) => (
                        <button key={x.key} type='button' onClick={() => { setMenu(false); x.run(); }} className={`flex min-h-12 w-full items-center rounded-xl border border-line px-3 text-left text-sm font-medium ${x.danger ? 'text-red-400' : 'text-ink'} active:bg-page`}>
                            {x.label}
                        </button>
                    ))}
                    {can.approveWhy && <Alert tone='info'>{can.approveWhy}</Alert>}
                </Sheet>
            )}
            {item && <ItemSheet a={a} can={can} currencies={data.currencies} item={item} use={d?.items.find((u) => u.no === item.no)} ask={ask} onClose={() => setItem(null)} onDone={(t) => { setItem(null); setNote({ tone: 'success', text: t }); reload(); }} />}
            {adding && <AddMaterials a={a} onClose={() => setAdding(false)} onDone={(t) => { setAdding(false); setNote({ tone: 'success', text: t }); reload(); }} />}
            {rfq && <RfqSheet a={a} onClose={() => setRfq(false)} onDone={(t) => { setRfq(false); setNote({ tone: 'success', text: t }); reload(); }} />}
            {sheet}
        </Screen>
    );
}

function Tile({ label, value, hint, blue }: { label: string; value: ReactNode; hint?: string; blue?: boolean }) {
    return (
        <div className={`min-w-0 rounded-xl border p-3 ${blue ? 'border-blue-500/70 bg-blue-500/10' : 'border-line bg-panel'}`}>
            <p className='text-xs text-muted'>{label}</p>
            <p className={`mt-1 truncate text-lg font-semibold ${blue ? 'text-blue-300' : 'text-ink'}`}>{value}</p>
            {hint && <p className='mt-0.5 text-xs text-muted'>{hint}</p>}
        </div>
    );
}

function Overview({ a, can, d, currencies, onSaved }: { a: Detail; can: Can; d: Dash | null; currencies: string[]; onSaved: (t: string) => void }) {
    const [f, setF] = useState({ title: a.title, startDate: a.startDate, endDate: a.endDate, currency: a.currency, notes: a.notes, quoteReference: a.quoteReference, quoteDate: a.quoteDate });
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const editable = can.edit || can.quote;
    const dirty = (Object.keys(f) as Array<keyof typeof f>).some((k) => f[k] !== (a as unknown as Record<string, string>)[k]);
    const problems = [
        ...(f.title.trim().length >= 3 ? [] : ['Title: at least 3 characters.']),
        ...(f.startDate && f.endDate && f.endDate >= f.startDate ? [] : ['The end date must be on or after the start date.']),
        ...(f.quoteDate && f.quoteDate > today() ? ['The quote date cannot be in the future.'] : []),
    ];
    const save = async () => {
        setFailure('');
        if (problems.length) return setFailure(problems.join(' '));
        setBusy(true);
        try {
            await callBackend(`${API}/save`, { id: a.id, version: a.version, ...f });
            onSaved('Agreement details saved.');
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const next =
        a.status === 'draft' ? 'Add the materials, then send the RFQ to the supplier.'
            : a.status === 'rfq_sent' ? 'Record the supplier\'s quote on each material, attach the agreement or signed quote (PDF), then submit for approval.'
                : a.status === 'returned' ? `Returned: ${a.returnReason}. Correct it and submit again.`
                    : a.status === 'pending_approval' ? 'Waiting for approval under the chart of authority.'
                        : a.status === 'approved' ? 'Approved. Activate it so its parameters apply to the materials from the start date.'
                            : a.status === 'scheduled' ? `Activated. It starts on ${a.startDate}.`
                                : a.status === 'active' ? 'Active: materials using the agreement are shown in blue.'
                                    : a.status === 'terminated' ? `Terminated: ${a.terminateReason}` : a.status === 'rejected' ? `Rejected: ${a.rejectReason}` : '';
    return (
        <div className='space-y-3'>
            {next && <Alert tone={a.status === 'returned' || a.status === 'rejected' ? 'warn' : 'info'}>{next}</Alert>}
            {a.applyProblems.length > 0 && <Alert tone='warn'>Not applied: {a.applyProblems.join('; ')}</Alert>}
            {d && (
                <>
                    <h2 className='text-sm font-semibold text-ink'>{d.active ? 'Agreement dashboard' : 'Agreement figures'}</h2>
                    {d.active && (
                        <div className='rounded-xl border border-blue-500/70 bg-blue-500/10 p-3'>
                            <div className='flex items-center gap-2 text-sm text-blue-300'><CalendarClock className='h-4 w-4' />{d.daysRemaining} day{d.daysRemaining === 1 ? '' : 's'} remaining of {d.totalDays}</div>
                            <div className='mt-2 h-2 overflow-hidden rounded-full bg-line' role='progressbar' aria-valuenow={d.timeUsedPct} aria-valuemin={0} aria-valuemax={100} aria-label='Time used'>
                                <div className='h-full bg-blue-500' style={{ width: `${Math.min(100, d.timeUsedPct)}%` }} />
                            </div>
                        </div>
                    )}
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                        <Tile label='Savings vs standard price' value={money(d.savings, d.currency)} hint={`Potential ${money(d.potentialSavings, d.currency)}`} blue={d.active} />
                        <Tile label='Purchased under the agreement' value={money(d.orderedValue, d.currency)} hint={`${d.orders} order(s)`} />
                        <Tile label='Materials purchased' value={`${d.materialsPurchased} of ${a.items.length}`} hint={`${d.itemsApplied} using the agreement`} blue={d.active} />
                        <Tile label='Utilisation' value={`${d.utilisationPct}%`} hint={`of ${money(d.expectedValue, d.currency)} expected`} />
                        <Tile label='Days remaining' value={d.daysRemaining} hint={`${d.timeUsedPct}% of the period used`} />
                        <Tile label='Price above agreement' value={d.priceBreaches} hint='Order lines priced above the agreed price' />
                        <Tile label='Overridden items' value={d.itemsOverridden} />
                        <Tile label='No standard price' value={d.noStandardPrice} hint='Not counted in savings' />
                    </div>
                </>
            )}
            <h2 className='pt-2 text-sm font-semibold text-ink'>Agreement</h2>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <Field label='Supplier' value={`${a.vendorNumber} · ${a.vendorName}`} readOnly onChange={() => undefined} />
                <Field label='Value (organization currency)' value={a.value ? money(a.value, a.orgCurrency) : 'Worked out on submission'} readOnly onChange={() => undefined} />
                <Field label='Title' value={f.title} readOnly={!editable} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} />
                <SelectField label='Agreement currency' value={f.currency} disabled={!can.edit} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                    {[...new Set([f.currency, ...currencies])].map((c) => <option key={c} value={c}>{c}</option>)}
                </SelectField>
                <Field label='Start date' type='date' value={f.startDate} readOnly={!editable} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
                <Field label='End date' type='date' value={f.endDate} readOnly={!editable} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
                <Field label="Supplier's quote reference" value={f.quoteReference} readOnly={!editable} maxLength={80} onChange={(e) => setF({ ...f, quoteReference: e.target.value })} />
                <Field label='Quote date' type='date' value={f.quoteDate} max={today()} readOnly={!editable} onChange={(e) => setF({ ...f, quoteDate: e.target.value })} />
            </div>
            <TextArea label='Notes' value={f.notes} readOnly={!editable} maxLength={2000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            {a.rfq.sentAt ? <p className='text-xs text-muted'>RFQ sent {fmtDate(String(a.rfq.sentAt))} by {String(a.rfq.sentByName)} ({String(a.rfq.method) === 'email' ? 'email' : 'printed'}), quote due {String(a.rfq.dueDate)}.</p> : null}
            {editable && (
                <>
                    {failure && <Alert tone='error'>{failure}</Alert>}
                    <Button busy={busy} disabled={!dirty} onClick={() => void save()} className='w-full'>Save details</Button>
                </>
            )}
        </div>
    );
}

function ItemsTable({ a, can, d, onOpen, onAdd }: { a: Detail; can: Can; d: Dash | null; onOpen: (i: Item) => void; onAdd: () => void }) {
    const use = new Map((d?.items ?? []).map((u) => [u.no, u]));
    const state = (i: Item) => (i.override?.on ? 'Overridden: own parameters' : i.applied ? 'Using the agreement' : i.quote ? 'Quoted' : 'Waiting for the quote');
    const std = (i: Item) => (i.standard.unitPrice === '' || i.standard.unitPrice === undefined || i.standard.unitPrice === null ? null : Number(i.standard.unitPrice));
    const columns: Array<Column<Item>> = [
        { key: 'no', label: 'Item', type: 'number', value: (i) => i.no },
        { key: 'material', label: 'Material', value: (i) => i.materialNumber, render: (i) => <span className={`font-mono ${i.applied ? blueRow : ''}`}>{i.materialNumber}</span> },
        { key: 'name', label: 'Description', value: (i) => i.name },
        { key: 'warehouse', label: 'Warehouse', value: (i) => `${i.warehouseCode} ${i.warehouseName}`.trim() },
        { key: 'state', label: 'Status', value: state, render: (i) => <span className={i.applied ? `font-medium ${blueRow}` : i.override?.on ? 'text-amber-300' : ''}>{state(i)}</span> },
        { key: 'qty', label: 'Expected quantity', type: 'number', value: (i) => i.expectedQty },
        { key: 'uom', label: 'Unit', value: (i) => i.purchaseUom },
        { key: 'std', label: 'Standard price', type: 'number', value: std },
        { key: 'stdcur', label: 'Standard currency', value: (i) => String(i.standard.currency ?? '') },
        { key: 'price', label: 'Agreed price', type: 'number', value: (i) => i.quote?.unitPrice ?? null },
        { key: 'cur', label: 'Currency', value: (i) => i.quote?.currency ?? '' },
        { key: 'lead', label: 'Lead time (days)', type: 'number', value: (i) => i.quote?.leadTimeDays ?? null },
        { key: 'moq', label: 'Minimum order', type: 'number', value: (i) => i.quote?.minimumOrderQuantity ?? null, hidden: true },
        { key: 'mult', label: 'Order multiple', type: 'number', value: (i) => i.quote?.orderMultiple ?? null, hidden: true },
        { key: 'part', label: 'Supplier part number', value: (i) => i.quote?.vendorPartNumber ?? '', hidden: true },
        { key: 'ordered', label: 'Ordered', type: 'number', value: (i) => use.get(i.no)?.orderedQty ?? null },
        { key: 'savings', label: 'Savings', type: 'number', value: (i) => use.get(i.no)?.savings ?? null },
        { key: 'breach', label: 'Lines above agreed price', type: 'number', value: (i) => use.get(i.no)?.priceBreaches ?? null, hidden: true },
    ];
    return (
        <RichTable<Item>
            id='prc.agreements.items'
            title={`${a.number} materials`}
            columns={columns}
            rows={a.items}
            rowKey={(i) => String(i.no)}
            onRowClick={onOpen}
            rowClassName={(i) => (i.applied ? blueRow : '')}
            actions={can.items ? <Button onClick={onAdd}><Plus className='h-4 w-4' />Add</Button> : undefined}
            empty={can.items ? 'No materials yet. Add the spares to buy under this agreement.' : 'No materials.'}
            fileName={`${a.number}-materials`}
            height='h-full'
        />
    );
}

// ----- One item: quote, quantity, override -----

function ItemSheet({ a, can, currencies, item, use, ask, onClose, onDone }: { a: Detail; can: Can; currencies: string[]; item: Item; use?: Use; ask: ReturnType<typeof useConfirm>['ask']; onClose: () => void; onDone: (t: string) => void }) {
    const q = item.quote;
    const [f, setF] = useState({
        unitPrice: q ? String(q.unitPrice) : '', currency: q?.currency || a.currency, leadTimeDays: q ? String(q.leadTimeDays) : '',
        minimumOrderQuantity: q?.minimumOrderQuantity === null || q?.minimumOrderQuantity === undefined ? '' : String(q.minimumOrderQuantity),
        orderMultiple: q?.orderMultiple === null || q?.orderMultiple === undefined ? '' : String(q.orderMultiple),
        vendorPartNumber: q?.vendorPartNumber ?? '', paymentTerms: q?.paymentTerms ?? '', incoterms: q?.incoterms ?? '',
    });
    const [qty, setQty] = useState(String(item.expectedQty));
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const errors: Record<string, string> = {};
    const price = num(f.unitPrice);
    if (price === null || !(price > 0)) errors.unitPrice = 'Above zero';
    const lead = num(f.leadTimeDays);
    if (lead === null || !Number.isInteger(lead) || lead < 0 || lead > 3650) errors.leadTimeDays = 'Whole days, 0 to 3650';
    const moq = num(f.minimumOrderQuantity), mult = num(f.orderMultiple);
    if (moq !== null && !(moq >= 0)) errors.minimumOrderQuantity = '0 or more';
    if (mult !== null && !(mult >= 0)) errors.orderMultiple = '0 or more';
    if (moq && mult && Math.abs(moq / mult - Math.round(moq / mult)) > 1e-9) errors.minimumOrderQuantity = 'Must be a multiple of the order multiple';
    if (!/^[A-Z]{3}$/.test(f.currency)) errors.currency = 'Choose';
    const saveQuote = async () => {
        setTried(true);
        setFailure('');
        if (Object.keys(errors).length) return;
        setBusy(true);
        try {
            await callBackend(`${API}/items/quote`, { id: a.id, no: item.no, quote: { ...f, uom: item.purchaseUom } });
            onDone(`Quote recorded for item ${item.no}.`);
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const saveQty = async () => {
        const n = Number(qty);
        if (!(n > 0)) return setFailure('Enter an expected quantity above zero.');
        setBusy(true);
        try {
            await callBackend(`${API}/items/update`, { id: a.id, no: item.no, expectedQty: n });
            onDone('Expected quantity changed.');
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const s = item.standard;
    const own = (k: string) => (s[k] === '' || s[k] === undefined || s[k] === null ? 'Not set' : String(s[k]));
    const qtyEditable = can.items || can.quote;
    return (
        <Sheet title={`Item ${item.no} · ${item.materialNumber}`} onClose={onClose} footer={can.quote ? <Button className='flex-1' busy={busy} onClick={() => void saveQuote()}>Save quote</Button> : undefined}>
            <p className='text-sm text-soft'>{item.name}</p>
            <p className='text-xs text-muted'>{item.warehouseCode} {item.warehouseName} · bought per {item.purchaseUom || 'unit'}</p>
            {item.applied && <Alert tone='info'>This material uses the agreement parameters now (blue on the material's Procurement Information).</Alert>}
            {item.override?.on && <Alert tone='warn'>Overridden by {item.override.byName}: {item.override.reason}</Alert>}
            <div className='rounded-xl border border-line bg-page p-3 text-sm'>
                <p className='mb-1 text-xs font-semibold text-muted'>Material's own procurement setup (previous figures)</p>
                <p className='text-soft'>Standard price {own('unitPrice')} {String(s.currency ?? '')} · lead time {own('leadTimeDays')} days · minimum order {own('minimumOrderQuantity')} · multiple {own('orderMultiple')}</p>
                <p className='text-soft'>Part number {own('vendorPartNumber')} · payment terms {own('paymentTerms')} · incoterms {own('incoterms')} · supplier {own('preferredVendorName')}</p>
            </div>
            {use && (use.orderedQty > 0 || use.savings !== null) && (
                <p className='text-sm text-soft'>Ordered {use.orderedQty} ({use.orders} order(s)), received {use.receivedQty}. Savings {money(use.savings, a.currency)}.{use.priceBreaches ? ` ${use.priceBreaches} order line(s) above the agreed price.` : ''}</p>
            )}
            {qtyEditable ? (
                <div className='flex items-end gap-2'>
                    <Field className='flex-1' label='Expected quantity over the agreement' inputMode='decimal' value={qty} onChange={(e) => setQty(e.target.value)} hint='Used for the agreement value and the chart of authority.' />
                    <Button variant='secondary' disabled={busy || Number(qty) === item.expectedQty} onClick={() => void saveQty()}>Save</Button>
                </div>
            ) : (
                <p className='text-sm text-soft'>Expected quantity: {item.expectedQty} {item.purchaseUom}</p>
            )}
            <h3 className='pt-1 text-sm font-semibold text-ink'>Supplier's quote</h3>
            {can.quote ? (
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    <Field label={`Unit price per ${item.purchaseUom || 'unit'}`} inputMode='decimal' value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} error={tried ? errors.unitPrice : undefined} />
                    <SelectField label='Currency' value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} error={tried ? errors.currency : undefined}>
                        {[...new Set([f.currency, a.currency, ...currencies].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                    <Field label='Unit of measure' value={item.purchaseUom} readOnly hint="The material's purchase unit; quotes in another unit are refused." onChange={() => undefined} />
                    <Field label='Lead time (days)' inputMode='numeric' value={f.leadTimeDays} onChange={(e) => setF({ ...f, leadTimeDays: e.target.value })} error={tried ? errors.leadTimeDays : undefined} />
                    <Field label='Minimum order quantity' inputMode='decimal' value={f.minimumOrderQuantity} onChange={(e) => setF({ ...f, minimumOrderQuantity: e.target.value })} error={tried ? errors.minimumOrderQuantity : undefined} />
                    <Field label='Order multiple' inputMode='decimal' value={f.orderMultiple} onChange={(e) => setF({ ...f, orderMultiple: e.target.value })} error={tried ? errors.orderMultiple : undefined} />
                    <Field label='Supplier part number' maxLength={120} value={f.vendorPartNumber} onChange={(e) => setF({ ...f, vendorPartNumber: e.target.value })} />
                    <Field label='Payment terms' maxLength={120} value={f.paymentTerms} onChange={(e) => setF({ ...f, paymentTerms: e.target.value })} />
                    <Field label='Incoterms' maxLength={120} value={f.incoterms} onChange={(e) => setF({ ...f, incoterms: e.target.value })} />
                </div>
            ) : q ? (
                <p className={`text-sm ${item.applied ? blueRow : 'text-soft'}`}>{q.currency} {q.unitPrice} per {q.uom} · {q.leadTimeDays} days{q.minimumOrderQuantity ? ` · minimum ${q.minimumOrderQuantity}` : ''}{q.orderMultiple ? ` · multiple ${q.orderMultiple}` : ''}{q.vendorPartNumber ? ` · part ${q.vendorPartNumber}` : ''}{q.paymentTerms ? ` · ${q.paymentTerms}` : ''}{q.incoterms ? ` · ${q.incoterms}` : ''}<span className='block text-xs text-muted'>Recorded by {q.quotedByName} {fmtDate(q.quotedAt)}</span></p>
            ) : (
                <p className='text-sm text-muted'>{a.status === 'draft' ? 'Send the RFQ first; the quote is recorded when the supplier answers.' : 'No quote recorded.'}</p>
            )}
            {failure && <Alert tone='error'>{failure}</Alert>}
            {can.items && (
                <Button variant='danger' className='w-full' onClick={() => ask({ title: `Remove item ${item.no}?`, message: `${item.materialNumber} comes off the agreement.`, confirmLabel: 'Remove', tone: 'danger' }, async () => { await callBackend(`${API}/items/remove`, { id: a.id, no: item.no }); onDone('Material removed.'); })}>Remove from the agreement</Button>
            )}
            {can.override && (
                <Button
                    variant='secondary'
                    className='w-full'
                    onClick={() =>
                        ask(
                            item.override?.on
                                ? { title: 'Use the agreement again?', message: `${item.materialNumber} takes the agreement parameters again while the agreement is active.`, confirmLabel: 'Use the agreement', reason: { label: 'Reason', minLength: 20 } }
                                : { title: 'Override this item?', message: `${item.materialNumber} goes back to its own procurement parameters. The agreement stays active for the other items.`, confirmLabel: 'Override', reason: { label: 'Reason', minLength: 20 } },
                            async (reason) => { await callBackend(`${API}/items/override`, { id: a.id, no: item.no, on: !item.override?.on, reason }); onDone(item.override?.on ? 'The item uses the agreement again.' : 'The item is overridden.'); },
                        )
                    }
                >
                    {item.override?.on ? 'Remove the override' : 'Override: use the material\'s own parameters'}
                </Button>
            )}
        </Sheet>
    );
}

// ----- Add materials -----

interface Candidate { materialId: string; materialNumber: string; name: string; warehouseId: string; warehouseCode: string; warehouseName: string; purchaseUom: string; standardPrice: number | null; standardCurrency: string; leadTimeDays: number | null; preferred: boolean; heldBy: string; onThis: boolean }

function AddMaterials({ a, onClose, onDone }: { a: Detail; onClose: () => void; onDone: (t: string) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ candidates: Candidate[] }>(`${API}/candidates`, { id: a.id }));
    const [q, setQ] = useState('');
    const [picked, setPicked] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const key = (c: Candidate) => `${c.materialId}|${c.warehouseId}`;
    const shown = (data?.candidates ?? []).filter((c) => !c.onThis && (!q.trim() || `${c.materialNumber} ${c.name} ${c.warehouseCode}`.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 150);
    const chosen = Object.entries(picked);
    const bad = chosen.filter(([, v]) => !(Number(v) > 0));
    const add = async () => {
        setFailure('');
        if (!chosen.length) return setFailure('Choose at least one material.');
        if (bad.length) return setFailure('Enter an expected quantity above zero for each chosen material.');
        setBusy(true);
        try {
            await callBackend(`${API}/items/add`, { id: a.id, items: chosen.map(([k, v]) => ({ materialId: k.split('|')[0], warehouseId: k.split('|')[1], expectedQty: Number(v) })) });
            onDone(`${chosen.length} material(s) added.`);
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title='Add materials' onClose={onClose} footer={<Button className='flex-1' busy={busy} onClick={() => void add()}>Add {chosen.length || ''}</Button>}>
            <p className='text-xs text-muted'>Spares {a.vendorName} is approved to supply, in warehouses you work in. The supplier's preferred materials come first.</p>
            <SearchField label='Search materials' value={q} onChange={(e) => setQ(e.target.value)} placeholder='Number, description or warehouse' />
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : !shown.length ? <p className='text-sm text-muted'>No materials found.</p> : (
                <div className='space-y-2'>
                    {shown.map((c) => {
                        const k = key(c);
                        const on = picked[k] !== undefined;
                        return (
                            <div key={k} className={`rounded-xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line bg-page'}`}>
                                <label className='flex cursor-pointer items-start gap-3'>
                                    <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0' disabled={!!c.heldBy} checked={on} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[k] = ''; else delete n[k]; return n; })} />
                                    <span className='min-w-0 flex-1 text-sm'>
                                        <span className='block font-mono text-ink'>{c.materialNumber}{c.preferred && <span className='ml-2 text-xs text-brandsoft'>preferred supplier</span>}</span>
                                        <span className='block text-soft'>{c.name}</span>
                                        <span className='block text-xs text-muted'>{c.warehouseCode} {c.warehouseName} · per {c.purchaseUom || '—'} · standard {c.standardPrice === null ? 'not set' : `${c.standardCurrency} ${c.standardPrice}`}</span>
                                        {c.heldBy && <span className='block text-xs text-blue-300'>Under agreement {c.heldBy}</span>}
                                    </span>
                                </label>
                                {on && <Field className='mt-2' label={`Expected quantity (${c.purchaseUom || 'units'})`} inputMode='decimal' value={picked[k]} onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.value }))} error={picked[k] !== '' && !(Number(picked[k]) > 0) ? 'Above zero' : undefined} />}
                            </div>
                        );
                    })}
                </div>
            )}
            {failure && <Alert tone='error'>{failure}</Alert>}
        </Sheet>
    );
}

// ----- RFQ -----

function RfqSheet({ a, onClose, onDone }: { a: Detail; onClose: () => void; onDone: (t: string) => void }) {
    const [method, setMethod] = useState<'email' | 'print'>(a.vendorEmail ? 'email' : 'print');
    const [dueDate, setDueDate] = useState('');
    const [text, setText] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const send = async () => {
        setFailure('');
        const problems = [...(a.items.length ? [] : ['Add the materials first.']), ...(dueDate && dueDate >= today() ? [] : ['Enter the date the quote is due (today or later).']), ...(confirm ? [] : ['Confirm the materials and quantities.'])];
        if (problems.length) return setFailure(problems.join(' '));
        setBusy(true);
        try {
            if (method === 'print') await agreementPdf(a, dueDate, text);
            await callBackend(`${API}/rfq/send`, { id: a.id, method, dueDate, note: text, confirm: true });
            onDone(method === 'email' ? 'RFQ emailed to the supplier.' : 'RFQ downloaded and recorded as sent.');
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title='Request for quotation' onClose={onClose} footer={<Button className='flex-1' busy={busy} onClick={() => void send()}><Send className='h-4 w-4' />{method === 'email' ? 'Email RFQ' : 'Download and record as sent'}</Button>}>
            <p className='text-sm text-soft'>{a.items.length} material(s) to {a.vendorName}, {a.startDate} to {a.endDate}. The supplier quotes price, lead time, minimum order, multiple, part number, payment terms and incoterms per material.</p>
            <Segmented label='How the RFQ is sent' value={method} onChange={setMethod} options={[{ value: 'email', label: 'Email' }, { value: 'print', label: 'Print / PDF' }]} />
            {method === 'email' && !a.vendorEmail && <Alert tone='warn'>The supplier has no contact email. Use Print / PDF.</Alert>}
            <Field label='Quote due by' type='date' min={today()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <TextArea label='Message to the supplier' value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
            <label className='flex min-h-[44px] items-start gap-3 rounded-xl border border-line p-3 text-sm text-soft'>
                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0' checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                <span>The materials and expected quantities are correct.</span>
            </label>
            {failure && <Alert tone='error'>{failure}</Alert>}
        </Sheet>
    );
}

async function agreementPdf(a: Detail, dueDate = String(a.rfq.dueDate || ''), message = '') {
    const quoted = a.items.some((i) => i.quote);
    await downloadReportPdf({
        title: `${a.number} ${quoted ? 'Purchase agreement' : 'Request for quotation'}`,
        subtitle: `${a.title} · ${a.vendorName}`,
        fileName: `${a.number}-${quoted ? 'agreement' : 'rfq'}`,
        sections: [
            { heading: 'Agreement', facts: [['Supplier', `${a.vendorNumber} ${a.vendorName}`], ['Period', `${a.startDate} to ${a.endDate}`], ['Currency', a.currency], ['Status', a.statusLabel], ...(dueDate ? [['Quote due by', dueDate] as [string, string]] : [])] },
            ...(message ? [{ heading: 'Message', text: message }] : []),
            {
                heading: quoted ? 'Agreed items' : 'Items to quote',
                table: quoted
                    ? { head: ['Item', 'Material', 'Description', 'Qty', 'Unit', 'Price', 'Cur', 'Lead days', 'MOQ', 'Multiple'], body: a.items.map((i) => [String(i.no), i.materialNumber, i.name, String(i.expectedQty), i.purchaseUom, i.quote ? String(i.quote.unitPrice) : '', i.quote?.currency ?? '', i.quote ? String(i.quote.leadTimeDays) : '', String(i.quote?.minimumOrderQuantity ?? ''), String(i.quote?.orderMultiple ?? '')]) }
                    : { head: ['Item', 'Material', 'Description', 'Expected qty', 'Unit', 'Unit price', 'Currency', 'Lead days', 'MOQ', 'Multiple', 'Your part no.'], body: a.items.map((i) => [String(i.no), i.materialNumber, i.name, String(i.expectedQty), i.purchaseUom, '', '', '', '', '', '']) },
            },
        ],
    });
}

// ----- Attachments -----

function Attachments({ a, can, onChange, ask }: { a: Detail; can: Can; onChange: (t: string) => void; ask: ReturnType<typeof useConfirm>['ask'] }) {
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const upload = async (file: File | undefined) => {
        setFailure('');
        if (!file) return setFailure('No file was received from the device. Try again.');
        if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return setFailure('Attach a PDF file.');
        if (file.size > MAX_PDF) return setFailure(`The PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.`);
        setBusy(true);
        try {
            const data = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
                r.onerror = () => reject(new Error('The file could not be read.'));
                r.readAsDataURL(file);
            });
            await callBackend(`${API}/attachment/upload`, { id: a.id, name: file.name, mime: 'application/pdf', data });
            onChange(`${file.name} attached.`);
        } catch (e) {
            setFailure(messageOf(e));
        } finally {
            setBusy(false);
            if (input.current) input.current.value = '';
        }
    };
    const open = async (fileId: string) => {
        try {
            const r = await callBackend<{ url: string }>(`${API}/attachment/file`, { id: a.id, fileId });
            window.open(r.url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            setFailure(messageOf(e));
        }
    };
    return (
        <div className='space-y-3'>
            <Alert tone={a.attachments.length ? 'info' : 'warn'}>{a.attachments.length ? 'Attachments are fixed once the agreement is submitted.' : 'A purchase agreement needs at least one PDF: the signed agreement or the supplier\'s quote (up to 10 MB each).'}</Alert>
            {a.attachments.map((f) => (
                <div key={f.id} className='flex items-center gap-3 rounded-xl border border-line bg-panel p-3'>
                    <FileText className='h-5 w-5 shrink-0 text-muted' />
                    <button type='button' onClick={() => void open(f.id)} className='min-h-[44px] min-w-0 flex-1 text-left'>
                        <span className='block truncate text-sm font-medium text-ink'>{f.name}</span>
                        <span className='block text-xs text-muted'>{Math.round(f.bytes / 1024)} KB · {f.uploadedByName} · {fmtDate(f.uploadedAt)}</span>
                    </button>
                    {can.attach && <Button variant='danger' onClick={() => ask({ title: 'Remove the attachment?', message: f.name, confirmLabel: 'Remove', tone: 'danger', reason: { label: 'Reason', minLength: 5 } }, async (reason) => { await callBackend(`${API}/attachment/remove`, { id: a.id, fileId: f.id, reason }); onChange('Attachment removed.'); })}>Remove</Button>}
                </div>
            ))}
            {can.attach && (
                <>
                    <input ref={input} type='file' accept='application/pdf,.pdf' className='hidden' onChange={(e) => void upload(e.target.files?.[0])} />
                    <Button busy={busy} className='w-full' onClick={() => input.current?.click()}><Paperclip className='h-4 w-4' />Attach PDF</Button>
                </>
            )}
            {failure && <Alert tone='error'>{failure}</Alert>}
        </div>
    );
}

// ----- Approval -----

function Approval({ a, can }: { a: Detail; can: Can }) {
    const list = a.approval.steps ?? [];
    return (
        <div className='space-y-2'>
            <p className='text-sm text-soft'>Approved under the chart of authority on {a.value ? money(a.value, a.orgCurrency) : 'the value worked out on submission'} (expected quantity × agreed price).</p>
            {!list.length && <p className='text-sm text-muted'>Not submitted yet.</p>}
            {list.map((s) => (
                <div key={s.level} className={`rounded-xl border p-3 text-sm ${s.status === 'approved' ? 'border-emerald-500/40' : 'border-line'} bg-panel`}>
                    <p className='font-medium text-ink'>{s.level} · {s.title}</p>
                    <p className='text-xs text-muted'>{s.positionTitle}</p>
                    <p className='mt-1 text-soft'>{s.status === 'approved' ? `Approved by ${s.byName} ${fmtDate(s.at)}${s.note ? `: ${s.note}` : ''}` : 'Waiting'}</p>
                </div>
            ))}
            {can.approveWhy && <Alert tone='info'>{can.approveWhy}</Alert>}
        </div>
    );
}
