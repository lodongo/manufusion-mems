import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, FileDown, Info, Plus, Printer, Send, Settings, ShieldAlert, XCircle, AlertTriangle, BarChart3, BookOpen } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { downloadReportPdf } from '../lib/report';
import { Alert, Field, SelectField } from '../components/ui';
import { API, PO_BASE, RQ_BASE, money, todayIso, Facts, Section, AckPanel, ServicePanel, ReassignPanel, LinesEditor, QuotesView, VisibilitySettings, FinanceSettings, type Receipt } from './PoExtras';
import RichTable, { type Column } from '../components/RichTable';
import { restoredTableTab } from '../lib/tableTabs';
import { Badge, Button, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';

// Purchase requisitions (PRQ + 9 digits) and purchase orders (PO + 9 digits).
//   Requisition: made from a recommended quotation; the person who raised the requirement confirms it (or returns it).
//   Order: a confirmed requisition becomes a new order or is consolidated into a matching draft order. The order is
//   validated (supplier, documents, cost, budget, currency, SLA, open deliveries of the same material from any vendor),
//   confirmed, approved level by level as the chart of authority asks, then sent to the supplier and delivered against.
// The server decides who may do what and checks everything again; this screen shows what it is told is allowed.

const RQ_ID = /^PRQ\d{9}$/;
const PO_ID = /^PO(\d{8}|\d{9})(-V\d{1,3})?$/;

type Tone = 'brand' | 'muted' | 'danger' | 'warn';

const span = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} days`);

const rqTone = (s: string): Tone => (s === 'confirmed' || s === 'converted' ? 'brand' : s === 'returned' || s === 'suspended' ? 'warn' : s === 'cancelled' ? 'danger' : 'muted');
const poTone = (s: string): Tone => (['open', 'sent', 'partial', 'full'].includes(s) ? 'brand' : ['rejected', 'cancelled'].includes(s) ? 'danger' : ['pending_approval', 'returned'].includes(s) ? 'warn' : 'muted');

// ----- Shapes returned by the server -----

interface RqRow {
    id: string;
    number: string;
    status: string;
    statusLabel: string;
    quotationNumber: string;
    requirementId: string;
    requirementTitle: string;
    requesterName: string;
    vendorName: string;
    currency: string;
    total: number;
    items: number;
    groups: string;
    orderNumber: string;
    poType: string;
    poTypeLabel: string;
    rqRev: number;
    validUntil: string;
    expired: boolean;
    createdAt: string;
    updatedAt: string;
}
interface Waiting {
    id: string;
    number: string;
    requirementTitle: string;
    vendorName: string;
    total: number;
    items: number;
    kinds: string[];
    recommendedAt: string;
}
interface RqList {
    rows: RqRow[];
    counts: Record<string, number>;
    waiting: Waiting[];
    can: { manage: boolean; convert: boolean };
}
interface Line {
    no: number;
    itemName?: string;
    requirement?: string;
    itemCode?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    discountPct: number;
    netUnitPrice: number;
    total: number;
    leadTimeDays: number;
    warrantyMonths: number;
    dateRequired: string;
    budget: number | null;
    costCenterName?: string;
    glCode?: string;
    warehouseName?: string;
    categoryName?: string;
    subcategoryName?: string;
    requisitionId?: string;
    receivedQty?: number;
    outstanding?: number;
    reqQuantity?: number;
    quoteValidUntil?: string;
    priceRevised?: boolean;
}
interface Hist {
    at: string;
    byName: string;
    action: string;
    note: string;
}
interface RqFull extends RqRow {
    quotationId: string;
    quoteRef: string;
    vendorId: string;
    paymentTermsLabel: string;
    leadTimeDays: number;
    validUntil: string;
    quoteFxRate: number | null;
    latestRate: number | null;
    latestBase: number | null;
    quoteBase: number | null;
    ratesAsOf: string;
    orgCurrency: string;
    orderId: string;
    returnReason: string;
    suspendReason: string;
    lines: Line[];
    history: Hist[];
    can: { confirm: boolean; cancel: boolean; reopen: boolean; convert: boolean; suspend: boolean; revise: boolean };
    mine: boolean;
}
interface PoRow {
    id: string;
    number: string;
    status: string;
    statusLabel: string;
    vendorName: string;
    currency: string;
    total: number | null;
    baseTotal: number | null;
    baseNumber: string;
    ver: number;
    poType: string;
    poTypeLabel: string;
    ownerName: string;
    acknowledged: boolean;
    acknowledgedAt: string;
    expired: boolean;
    ageDays: number;
    leadQuotedDays: number;
    dueOn: string;
    overdue: boolean;
    groups: string;
    waitingFor: string;
    mine: boolean;
    canApprove: boolean;
    createdByName: string;
    createdAt: string;
    approvedAt: string;
    sentAt: string;
    updatedAt: string;
}
interface PoList {
    rows: PoRow[];
    counts: Record<string, number>;
}
interface Check {
    code: string;
    group: string;
    label: string;
    result: 'pass' | 'warn' | 'fail' | 'info';
    detail: string;
}
interface Step {
    level: string;
    title: string;
    positionTitle: string;
    viaReportingLine: boolean;
    status: 'pending' | 'approved';
    byName: string;
    at: string;
    note: string;
}
interface Delivery {
    id: string;
    at: string;
    date: string;
    ref: string;
    byName: string;
    note: string;
    lines: Array<{ no: number; qty: number }>;
}
interface PoFull extends Omit<PoRow, never> {
    vendorId: string;
    vendorEmail: string;
    paymentTermsLabel: string;
    contractRef: string;
    notes: string;
    fxRate: number | null;
    fxAsOf: string;
    latestRate: number | null;
    latestBase: number | null;
    ratesAsOf: string;
    orgCurrency: string;
    rev: number;
    lines: Line[];
    requisitions: string[];
    validation: { at: string; byName: string; rev: number; current: boolean; fails: number; warns: number; checks: Check[]; ackReason: string };
    approval: { amount: number; steps: Step[]; authorityVersion: number };
    approveWhy: string;
    deliveries: Delivery[];
    history: Hist[];
    returnReason: string;
    rejectReason: string;
    sendError: string;
    sentMethod: string;
    sentByName: string;
    autoSend: boolean;
    emailReady: boolean;
    ownerUid: string;
    amendOf: string;
    amendReason: string;
    prevId: string;
    payableReady: boolean;
    receipts: Receipt[];
    ack: { at: string; byName: string; ref: string; date: string; note: string; fileName: string; fileId: string };
    versions: Array<{ id: string; ver: number; status: string; statusLabel: string; createdAt: string; approvedAt: string; reason: string; current: boolean }>;
    seesQuotes: boolean;
    seesPrices: boolean;
    ownsCostCenter: boolean;
    can: { edit: boolean; validate: boolean; confirm: boolean; reopen: boolean; approve: boolean; send: boolean; receive: boolean; cancel: boolean; amend: boolean; reassign: boolean; acknowledge: boolean; renderService: boolean; acceptService: boolean };
}
interface Trace {
    chain: { requirements: Array<{ id: string; title: string }>; quotations: Array<{ id: string; number: string }>; requisitions: Array<{ id: string; number: string }> };
    timeline: Array<{ at: string; stage: string; ref: string; title: string; byName: string; note: string; hoursSincePrevious: number; hoursSinceStart: number }>;
    milestones: Array<{ key: string; label: string; at: string; hoursFromPrevious: number }>;
    totalHours: number;
    leadTime: { quotedDays: number; actualDays: number | null; elapsedDays: number | null; onTime: boolean | null; since: string };
}
interface Options {
    currency: string;
    autoSend: boolean;
    emailReady: boolean;
    payableGlCode: string;
    can: { manage: boolean; approve: boolean; receive: boolean; settings: boolean; reassign: boolean; journals: boolean };
}

// ----- Small pieces -----

function HistoryList({ items }: { items: Hist[] }) {
    if (!items.length) return <p className='text-sm text-muted'>Nothing recorded yet.</p>;
    return (
        <ul className='divide-y divide-line text-sm'>
            {[...items].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`} className='py-2'>
                    <p className='text-ink'>{h.action}</p>
                    <p className='text-xs text-muted'>
                        {fmtDate(h.at)} · {h.byName || 'System'}
                    </p>
                    {h.note && <p className='text-xs text-soft'>{h.note}</p>}
                </li>
            ))}
        </ul>
    );
}

const LINE_COLUMNS = (cur: string, withReceipt: boolean): Array<Column<Line>> => [
    { key: 'no', label: 'No', type: 'number', value: (l) => l.no },
    { key: 'item', label: 'Item', value: (l) => l.itemName || l.requirement || '' },
    { key: 'code', label: 'Item code', value: (l) => l.itemCode ?? '', hidden: true },
    { key: 'qty', label: 'Quantity', type: 'number', value: (l) => l.quantity, render: (l) => `${l.quantity} ${l.unit}` },
    { key: 'price', label: `Unit price (${cur})`, type: 'number', value: (l) => l.unitPrice },
    { key: 'disc', label: 'Discount %', type: 'number', value: (l) => l.discountPct, hidden: true },
    { key: 'net', label: 'Net price', type: 'number', value: (l) => l.netUnitPrice },
    { key: 'total', label: `Total (${cur})`, type: 'number', value: (l) => l.total, render: (l) => money(l.total) },
    { key: 'lead', label: 'Lead time (days)', type: 'number', value: (l) => l.leadTimeDays },
    { key: 'war', label: 'Warranty (months)', type: 'number', value: (l) => l.warrantyMonths, hidden: true },
    { key: 'need', label: 'Needed by', type: 'date', value: (l) => l.dateRequired },
    { key: 'qv', label: 'Quote valid until', type: 'date', value: (l) => l.quoteValidUntil ?? '', render: (l) => (l.quoteValidUntil && l.quoteValidUntil < todayIso() ? <span className='font-semibold text-red-400'>{l.quoteValidUntil} (expired)</span> : l.quoteValidUntil ?? '') },
    { key: 'cc', label: 'Cost center', value: (l) => l.costCenterName ?? '', hidden: true },
    { key: 'gl', label: 'GL', value: (l) => l.glCode ?? '', hidden: true },
    { key: 'wh', label: 'Deliver to', value: (l) => l.warehouseName ?? '', hidden: true },
    { key: 'cat', label: 'Category', value: (l) => `${l.categoryName ?? ''} / ${l.subcategoryName ?? ''}`, hidden: true },
    ...(withReceipt
        ? [
              { key: 'rec', label: 'Received', type: 'number' as const, value: (l: Line) => l.receivedQty ?? 0 },
              { key: 'out', label: 'Outstanding', type: 'number' as const, value: (l: Line) => l.outstanding ?? 0 },
          ]
        : []),
];

// ===========================================================================
// Requisitions
// ===========================================================================

const RQ_COLUMNS: Array<Column<RqRow>> = [
    { key: 'number', label: 'Requisition', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={rqTone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'req', label: 'Requirement', value: (r) => r.requirementTitle },
    { key: 'who', label: 'Requester', value: (r) => r.requesterName },
    { key: 'vendor', label: 'Vendor', value: (r) => r.vendorName },
    { key: 'kind', label: 'Kind', value: (r) => r.poTypeLabel },
    { key: 'total', label: 'Value', type: 'number', value: (r) => r.total, render: (r) => money(r.total, r.currency) },
    { key: 'valid', label: 'Quote valid until', type: 'date', value: (r) => r.validUntil, render: (r) => (r.expired ? <span className='font-semibold text-red-400'>{r.validUntil} (expired)</span> : r.validUntil) },
    { key: 'rev', label: 'Revision', type: 'number', value: (r) => r.rqRev, hidden: true },
    { key: 'items', label: 'Items', type: 'number', value: (r) => r.items },
    { key: 'qtn', label: 'Quotation', value: (r) => r.quotationNumber, hidden: true },
    { key: 'group', label: 'Buyer group', value: (r) => r.groups, hidden: true },
    { key: 'order', label: 'Order', value: (r) => r.orderNumber, hidden: true },
    { key: 'at', label: 'Created', type: 'date', value: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt), hidden: true },
];

function RequisitionList() {
    const [view, setView] = useState('confirm');
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    const { data, error, loading, reload } = useLoad(() => callBackend<RqList>(`${API}/requisitions/list`, { view: view === 'waiting' ? 'all' : view }), [view]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load requisitions.'}</Alert>;

    const create = (w: Waiting) =>
        confirm.ask(
            {
                title: `Create a requisition from ${w.number}`,
                message: `${w.requirementTitle}: ${w.items} item(s) from ${w.vendorName}, ${money(w.total)}. One requisition is made for each kind of purchase (${w.kinds.join(', ')}), because an order is entirely materials, entirely services or entirely assets. The items, vendor, price and lead time come from the recommended quote, and the person who raised the requirement must then confirm each one.`,
                confirmLabel: 'Create requisition',
            },
            async () => {
                const out = await callBackend<{ id: string; ids: string[] }>(`${API}/requisitions/create`, { quotationId: w.id });
                setNotice(`${out.ids.join(', ')} created. Each waits for the requester to confirm.`);
                reload();
            }
        );

    const views = [
        { value: 'confirm', label: 'For me to confirm', count: data.counts.confirm },
        { value: 'draft', label: 'Draft', count: data.counts.draft },
        { value: 'ready', label: 'Ready for order', count: data.counts.ready },
        { value: 'all', label: 'All', count: data.counts.all },
        ...(data.can.manage ? [{ value: 'waiting', label: 'To requisition', count: data.waiting.length }] : []),
    ];

    return (
        <Screen title='Purchase requisitions' subtitle='From recommended quotation to confirmed requisition' onBack={() => navigate('organization_home')} toolbar={<Segmented label='Requisition views' value={view} options={views} onChange={setView} />}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {view === 'waiting' ? (
                data.waiting.length === 0 ? (
                    <p className='text-sm text-muted'>No recommended quotations are waiting for a requisition.</p>
                ) : (
                    data.waiting.map((w) => (
                        <section key={w.id} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                            <p className='text-sm font-semibold text-ink'>
                                {w.number} · {w.requirementTitle}
                            </p>
                            <p className='text-xs text-muted'>
                                {w.items} item(s) · {w.kinds.join(', ')} · {w.vendorName} · {money(w.total)} · recommended {fmtDate(w.recommendedAt)}
                            </p>
                            <Button onClick={() => create(w)}>
                                <Plus className='mr-1 h-4 w-4' /> Create requisition
                            </Button>
                        </section>
                    ))
                )
            ) : (
                <RichTable id='prc.requisitions' title='Requisitions' columns={RQ_COLUMNS} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${RQ_BASE}/${r.id}`)} empty='No requisitions here.' fileName='purchase-requisitions' height='h-[calc(100dvh-18rem)]' rowClassName={(r) => (r.expired ? 'bg-red-500/10' : '')} />
            )}
            {confirm.sheet}
        </Screen>
    );
}

function RequisitionDetail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<RqFull>(`${API}/requisitions/get`, { id }), [id]);
    const [notice, setNotice] = useState('');
    const [picking, setPicking] = useState(false);
    const [revising, setRevising] = useState(false);
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Requisition not found.'}</Alert>;
    const r = data;
    const done = (m: string) => {
        setNotice(m);
        reload();
    };

    const confirmIt = () =>
        confirm.ask(
            { title: `Confirm ${r.number}`, message: `You raised the requirement. Confirm that the items, quantities, vendor (${r.vendorName}) and price are what you asked for. It can then become a purchase order.`, confirmLabel: 'Confirm', acknowledge: 'The items, quantities, vendor and price are what I asked for.' },
            async () => {
                await callBackend(`${API}/requisitions/confirm`, { id, acknowledge: true });
                done('Requisition confirmed.');
            }
        );
    const act = (title: string, path: string, label: string, message: string, ok: string, danger = false) =>
        confirm.ask({ title, message, confirmLabel: label, tone: danger ? 'danger' : 'primary', reason: { label: 'Reason', minLength: 10, placeholder: 'Say why' } }, async (reason) => {
            await callBackend(`${API}/requisitions/${path}`, { id, reason });
            done(ok);
        });
    const newOrder = () =>
        confirm.ask({ title: 'Create a purchase order', message: `A new draft order will be made from the ${r.items} item(s) of ${r.number}.`, confirmLabel: 'Create order' }, async () => {
            const out = await callBackend<{ id: string }>(`${API}/orders/create`, { requisitionId: id, mode: 'new' });
            navigate(`${PO_BASE}/${out.id}`);
        });

    const primary = r.can.confirm ? (
        <Button onClick={confirmIt}>Confirm</Button>
    ) : r.can.convert ? (
        <Button onClick={newOrder}>
            <Plus className='mr-1 h-4 w-4' /> New order
        </Button>
    ) : undefined;

    return (
        <Screen title={r.number} subtitle={r.requirementTitle} onBack={() => navigate(RQ_BASE)} actions={primary}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={rqTone(r.status)}>{r.statusLabel}</Badge>
                {r.orderId && (
                    <button type='button' className='min-h-11 text-sm text-brand' onClick={() => navigate(`${PO_BASE}/${r.orderId}`)}>
                        Open {r.orderId}
                    </button>
                )}
            </div>
            {r.returnReason && <Alert tone='warn'>Returned: {r.returnReason}</Alert>}
            {r.suspendReason && r.status === 'suspended' && <Alert tone='warn'>Suspended: {r.suspendReason}. Revise it with the supplier’s current price and validity; the requester then confirms it again and the order approval starts afresh.</Alert>}
            {r.expired && <Alert tone='error'>The quote expired on {r.validUntil}. An order cannot be raised or submitted on an expired price. Suspend this requisition and revise it.</Alert>}
            {r.can.confirm && <Alert tone='info'>You raised this requirement. Check the items, quantities, vendor and price, then confirm or return it with a reason.</Alert>}
            <Section title='Requisition'>
                <Facts
                    rows={[
                        ['Quotation', r.quotationNumber],
                        ['Requirement', r.requirementTitle],
                        ['Requester', r.requesterName],
                        ['Vendor', r.vendorName],
                        ['Quote reference', r.quoteRef],
                        ['Payment terms', r.paymentTermsLabel],
                        ['Lead time', r.leadTimeDays ? `${r.leadTimeDays} days` : ''],
                        ['Kind of purchase', r.poTypeLabel],
                        ['Revision', String(r.rqRev)],
                        ['Quote valid until', r.validUntil],
                        ['Buyer group', r.groups],
                    ]}
                />
            </Section>
            <Section title='Value and currency'>
                <Facts
                    rows={[
                        ['Quoted value', money(r.total, r.currency)],
                        ...(r.currency !== r.orgCurrency
                            ? ([
                                  ['At the quote rate', r.quoteBase !== null ? money(r.quoteBase, r.orgCurrency) : ''],
                                  ['At the latest rate', r.latestBase !== null ? `${money(r.latestBase, r.orgCurrency)} (1 ${r.currency} = ${r.latestRate} ${r.orgCurrency}${r.ratesAsOf ? `, ${fmtDate(r.ratesAsOf)}` : ''})` : 'No latest rate on the currency list'],
                              ] as Array<[string, ReactNode]>)
                            : []),
                    ]}
                />
            </Section>
            <Section title={`Items (${r.lines.length})`}>
                <RichTable id='prc.requisition.lines' columns={LINE_COLUMNS(r.currency, false)} rows={r.lines} rowKey={(l) => String(l.no)} empty='No items.' fileName={`${r.number}-items`} height='h-80' />
            </Section>
            <div className='flex flex-wrap gap-2'>
                {r.can.confirm && (
                    <Button variant='secondary' onClick={() => act(`Return ${r.number}`, 'return', 'Return', 'The requisition goes back to procurement with your reason.', 'Requisition returned.')}>
                        Return with a reason
                    </Button>
                )}
                {r.can.convert && (
                    <Button variant='secondary' onClick={() => setPicking(!picking)}>
                        Add to an existing order
                    </Button>
                )}
                {r.can.suspend && (
                    <Button variant='secondary' onClick={() => act(`Suspend ${r.number}`, 'suspend', 'Suspend', r.orderId ? 'It leaves its draft order and waits to be revised. Nothing already submitted can be pulled back this way.' : 'It waits to be revised before it can be used.', 'Requisition suspended.')}>
                        Suspend to revise
                    </Button>
                )}
                {r.can.revise && (
                    <Button onClick={() => setRevising(!revising)}>{revising ? 'Close revision' : 'Revise price and validity'}</Button>
                )}
                {r.can.reopen && (
                    <Button variant='secondary' onClick={() => act(`Send ${r.number} back`, 'reopen', 'Send back', 'The requester is asked to confirm it again.', 'Sent back to the requester.')}>
                        Send back to requester
                    </Button>
                )}
                {r.can.cancel && (
                    <Button variant='danger' onClick={() => act(`Cancel ${r.number}`, 'cancel', 'Cancel requisition', 'The quotation can be made into a new requisition afterwards.', 'Requisition cancelled.', true)}>
                        Cancel
                    </Button>
                )}
            </div>
            {picking && <Consolidate id={id} onDone={(poId) => navigate(`${PO_BASE}/${poId}`)} />}
            {revising && r.can.revise && <ReviseForm r={r} onDone={(m) => { setRevising(false); done(m); }} />}
            <Section title='History'>
                <HistoryList items={r.history} />
            </Section>
            {confirm.sheet}
        </Screen>
    );
}

// Revise a suspended requisition: the supplier's new price, validity and quantity. The requester must confirm it again.
function ReviseForm({ r, onDone }: { r: RqFull; onDone: (m: string) => void }) {
    const [validUntil, setValidUntil] = useState('');
    const [price, setPrice] = useState<Record<number, string>>({});
    const [disc, setDisc] = useState<Record<number, string>>({});
    const [qty, setQty] = useState<Record<number, string>>({});
    const [lead, setLead] = useState<Record<number, string>>({});
    const confirm = useConfirm();
    const lines = r.lines.map((l) => ({ no: l.no, unitPrice: Number(price[l.no] ?? l.unitPrice), discountPct: Number(disc[l.no] ?? l.discountPct), quantity: Number(qty[l.no] ?? l.quantity), leadTimeDays: Number(lead[l.no] ?? l.leadTimeDays) }));
    const bad = lines.filter((l) => !(l.unitPrice > 0) || l.discountPct < 0 || l.discountPct > 100 || !(l.quantity > 0) || l.quantity > (r.lines.find((x) => x.no === l.no)?.reqQuantity ?? r.lines.find((x) => x.no === l.no)?.quantity ?? 0));
    const missing = [!validUntil || validUntil < todayIso() ? 'The new date the quote is valid until' : '', bad.length ? `Valid price, discount and quantity (line ${bad.map((l) => l.no).join(', ')})` : ''].filter(Boolean);
    return (
        <Section title='Revise the requisition'>
            <p className='text-xs text-muted'>Enter what the supplier now offers. The quantity cannot exceed what was asked for. The requester confirms the revision, and the order is validated and approved again from the start.</p>
            <Field id='rv-valid' label='Quote valid until *' type='date' min={todayIso()} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            {r.lines.map((l) => (
                <div key={l.no} className='space-y-1 rounded-xl border border-line p-2'>
                    <p className='text-sm text-ink'>{l.no} · {l.itemName || l.requirement}</p>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                        <Field id={`rv-p-${l.no}`} label='Unit price' inputMode='decimal' value={price[l.no] ?? String(l.unitPrice)} onChange={(e) => setPrice({ ...price, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                        <Field id={`rv-d-${l.no}`} label='Discount %' inputMode='decimal' value={disc[l.no] ?? String(l.discountPct)} onChange={(e) => setDisc({ ...disc, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                        <Field id={`rv-q-${l.no}`} label={`Quantity (max ${l.reqQuantity ?? l.quantity})`} inputMode='decimal' value={qty[l.no] ?? String(l.quantity)} onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                        <Field id={`rv-l-${l.no}`} label='Lead time (days)' inputMode='numeric' value={lead[l.no] ?? String(l.leadTimeDays)} onChange={(e) => setLead({ ...lead, [l.no]: e.target.value.replace(/[^\d]/g, '') })} />
                    </div>
                </div>
            ))}
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
            <Button
                disabled={missing.length > 0}
                onClick={() =>
                    confirm.ask({ title: `Revise ${r.number}`, message: 'The requisition goes back to Draft for the requester to confirm. The change is logged with the old and new prices.', confirmLabel: 'Save revision', reason: { label: 'Reason (for example: supplier re-quoted on 3 March)', minLength: 10 } }, async (reason) => {
                        await callBackend(`${API}/requisitions/revise`, { id: r.id, validUntil, lines, reason });
                        onDone('Requisition revised. The requester must confirm it.');
                    })
                }
            >
                Save revision
            </Button>
            {confirm.sheet}
        </Section>
    );
}

// Draft orders this requisition can join: same vendor, currency, payment terms, buyer group and categories.
function Consolidate({ id, onDone }: { id: string; onDone: (poId: string) => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ items: Array<{ id: string; number: string; lines: number; total: number; currency: string; createdByName: string; status: string }> }>(`${API}/requisitions/targets`, { id }), [id]);
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not look for matching orders.'}</Alert>;
    return (
        <Section title='Matching draft orders'>
            {data.items.length === 0 && <p className='text-sm text-muted'>No draft order matches this requisition. A match needs the same kind of purchase, vendor, currency, payment terms, buyer group and categories. Only your own draft orders are offered.</p>}
            {data.items.map((p) => (
                <button
                    key={p.id}
                    type='button'
                    onClick={() =>
                        confirm.ask({ title: `Add to ${p.number}`, message: `The items of this requisition become lines of ${p.number} (${p.lines} line(s), ${money(p.total, p.currency)}). The order must be validated again.`, confirmLabel: 'Add to order' }, async () => {
                            await callBackend(`${API}/orders/create`, { requisitionId: id, mode: 'consolidate', orderId: p.id });
                            onDone(p.id);
                        })
                    }
                    className='flex min-h-11 w-full items-center gap-2 rounded-xl border border-line px-3 text-left text-sm text-ink active:bg-page'
                >
                    <span className='font-mono text-xs'>{p.number}</span>
                    <span className='min-w-0 flex-1 truncate'>
                        {p.lines} line(s) · {money(p.total, p.currency)} · {p.createdByName}
                    </span>
                    <Badge tone='muted'>{p.status}</Badge>
                </button>
            ))}
            {confirm.sheet}
        </Section>
    );
}

// ===========================================================================
// Orders
// ===========================================================================

const PO_COLUMNS: Array<Column<PoRow>> = [
    { key: 'number', label: 'Order', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={poTone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'ack', label: 'Supplier acknowledged', value: (r) => (r.acknowledged ? 'Yes' : ['sent', 'partial'].includes(r.status) ? 'Not yet' : ''), render: (r) => (r.acknowledged ? <Badge tone='brand'>Acknowledged</Badge> : ['sent', 'partial'].includes(r.status) ? <Badge tone='warn'>Not yet</Badge> : '') },
    { key: 'kind', label: 'Kind', value: (r) => r.poTypeLabel },
    { key: 'vendor', label: 'Vendor', value: (r) => r.vendorName },
    { key: 'total', label: 'Value', type: 'number', value: (r) => r.total, render: (r) => money(r.total, r.currency) },
    { key: 'base', label: 'Value (org currency)', type: 'number', value: (r) => r.baseTotal },
    { key: 'owner', label: 'Owner', value: (r) => r.ownerName },
    { key: 'age', label: 'Age (days)', type: 'number', value: (r) => r.ageDays },
    { key: 'lead', label: 'Quoted lead time (days)', type: 'number', value: (r) => r.leadQuotedDays, hidden: true },
    { key: 'due', label: 'Due', type: 'date', value: (r) => r.dueOn, render: (r) => (r.overdue ? <span className='font-semibold text-red-400'>{r.dueOn} (overdue)</span> : r.dueOn), hidden: true },
    { key: 'ver', label: 'Version', type: 'number', value: (r) => r.ver, hidden: true },
    { key: 'expired', label: 'Quote expired', value: (r) => (r.expired ? 'Yes' : ''), hidden: true },
    { key: 'wait', label: 'Waiting for', value: (r) => r.waitingFor },
    { key: 'group', label: 'Buyer group', value: (r) => r.groups, hidden: true },
    { key: 'by', label: 'Prepared by', value: (r) => r.createdByName, hidden: true },
    { key: 'created', label: 'Created', type: 'date', value: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt), hidden: true },
    { key: 'approved', label: 'Approved', type: 'date', value: (r) => r.approvedAt, render: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : ''), hidden: true },
    { key: 'sent', label: 'Sent', type: 'date', value: (r) => r.sentAt, render: (r) => (r.sentAt ? fmtDate(r.sentAt) : ''), hidden: true },
];

function OrderSettings({ options, onDone }: { options: Options; onDone: (m: string) => void }) {
    const confirm = useConfirm();
    const change = (on: boolean) =>
        confirm.ask(
            {
                title: on ? 'Send approved orders automatically' : 'Stop sending automatically',
                message: on ? 'When the last approval is given, the order is emailed to the supplier contact on record. If the email fails, the order stays open and can be printed and sent.' : 'Approved orders will wait to be sent or printed by a purchase order officer.',
                confirmLabel: on ? 'Switch on' : 'Switch off',
                reason: { label: 'Reason for this change', minLength: 10 },
            },
            async (reason) => {
                await callBackend(`${API}/orders/settings`, { autoSend: on, reason });
                onDone(on ? 'Approved orders are now emailed to the supplier automatically.' : 'Automatic sending is off.');
            }
        );
    return (
        <Section title='Sending approved orders'>
            <div className='flex items-center gap-3'>
                <Toggle label='Send approved orders automatically' checked={options.autoSend} disabled={!options.emailReady && !options.autoSend} onChange={change} />
                <p className='text-sm text-ink'>Email approved orders to the supplier automatically</p>
            </div>
            {!options.emailReady && <p className='text-xs text-amber-300'>No email service is connected yet, so orders are printed and sent by hand. The MEMS administrator connects one by adding the RESEND_API_KEY and PO_FROM_EMAIL secrets.</p>}
            {confirm.sheet}
        </Section>
    );
}

function OrderList() {
    const [view, setView] = useState('approvals');
    const [notice, setNotice] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const options = useLoad(() => callBackend<Options>(`${API}/orders/options`));
    const { data, error, loading, reload } = useLoad(() => callBackend<PoList>(`${API}/orders/list`, { view }), [view]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You do not have permission to view purchase orders.'}</Alert>;
    const views = [
        { value: 'approvals', label: 'For my approval', count: data.counts.approvals },
        { value: 'mine', label: 'Mine', count: data.counts.mine },
        { value: 'draft', label: 'Draft', count: data.counts.draft },
        { value: 'inapproval', label: 'In approval', count: data.counts.inapproval },
        { value: 'open', label: 'Open', count: data.counts.open },
        { value: 'unacknowledged', label: 'Awaiting acknowledgement', count: data.counts.unacknowledged },
        { value: 'acknowledged', label: 'Acknowledged', count: data.counts.acknowledged },
        { value: 'expired', label: 'Expired quotes', count: data.counts.expired },
        { value: 'all', label: 'All', count: data.counts.all },
    ];
    return (
        <Screen
            title='Purchase orders'
            subtitle='Validate, approve, send and receive'
            onBack={() => navigate('organization_home')}
            actions={
                <>
                    <Button variant='secondary' aria-label='Procurement dashboard' onClick={() => navigate('organization_home/procurement_dashboard')}>
                        <BarChart3 className='h-4 w-4' />
                    </Button>
                    {options.data?.can.journals && (
                        <Button variant='secondary' aria-label='Journals' onClick={() => navigate('organization_home/finance_journals')}>
                            <BookOpen className='h-4 w-4' />
                        </Button>
                    )}
                    {options.data?.can.settings && (
                        <Button variant='secondary' aria-label='Order settings' onClick={() => setShowSettings(!showSettings)}>
                            <Settings className='h-4 w-4' />
                        </Button>
                    )}
                </>
            }
            toolbar={<Segmented label='Order views' value={view} options={views} onChange={setView} />}
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {showSettings && options.data && (
                <>
                    <OrderSettings
                        options={options.data}
                        onDone={(m) => {
                            setNotice(m);
                            options.reload();
                        }}
                    />
                    <VisibilitySettings onDone={setNotice} />
                    <FinanceSettings onDone={setNotice} />
                </>
            )}
            <RichTable id='prc.orders' title='Purchase orders' columns={PO_COLUMNS} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${PO_BASE}/${r.id}`)} empty='No orders here.' fileName='purchase-orders' height='h-[calc(100dvh-18rem)]' rowClassName={(r) => (r.expired ? 'bg-red-500/10' : r.overdue ? 'bg-amber-500/10' : r.acknowledged ? 'bg-emerald-500/10' : '')} actions={<Button variant='secondary' onClick={reload}>Refresh</Button>} />
        </Screen>
    );
}

// ----- Validation results -----

const GROUPS = ['Procurement', 'Supplier', 'Cost', 'Service level', 'Deliveries', 'Approval'];
function ResultIcon({ r }: { r: Check['result'] }) {
    if (r === 'pass') return <CheckCircle2 className='h-5 w-5 shrink-0 text-emerald-400' aria-label='Passed' />;
    if (r === 'fail') return <XCircle className='h-5 w-5 shrink-0 text-red-400' aria-label='Failed' />;
    if (r === 'warn') return <AlertTriangle className='h-5 w-5 shrink-0 text-amber-300' aria-label='Warning' />;
    return <Info className='h-5 w-5 shrink-0 text-muted' aria-label='For information' />;
}

function ValidationView({ po }: { po: PoFull }) {
    const v = po.validation;
    if (!v.at) return <Alert tone='info'>This order has not been validated yet. Validation checks the supplier, documents, cost, budget, currency, service levels, open deliveries of the same material from any vendor, whether the order is wholly materials, services or assets, whether the quotes have expired, whether the price equals the quotation, and whether the approval route exists.</Alert>;
    const groups = [...GROUPS, ...Array.from(new Set(v.checks.map((c) => c.group))).filter((g) => !GROUPS.includes(g))];
    return (
        <div className='space-y-3'>
            {!v.current && <Alert tone='warn'>The order has changed since it was validated. Validate it again before confirming.</Alert>}
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={v.fails ? 'danger' : v.warns ? 'warn' : 'brand'}>{v.fails ? `${v.fails} failed` : v.warns ? `${v.warns} warning(s)` : 'All passed'}</Badge>
                <span className='text-xs text-muted'>
                    {fmtDate(v.at)} by {v.byName}
                </span>
            </div>
            {v.ackReason && <Alert tone='info'>Reason given for the warnings: {v.ackReason}</Alert>}
            {groups.map((g) => {
                const list = v.checks.filter((c) => c.group === g);
                if (!list.length) return null;
                return (
                    <Section key={g} title={g}>
                        <ul className='divide-y divide-line'>
                            {list.map((c) => (
                                <li key={c.code} className='flex gap-2 py-2'>
                                    <ResultIcon r={c.result} />
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm text-ink'>{c.label}</p>
                                        <p className='text-xs text-soft'>{c.detail}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Section>
                );
            })}
        </div>
    );
}

// ----- Approval -----

function ApprovalView({ po }: { po: PoFull }) {
    const steps = po.approval.steps;
    if (!steps.length) return <Alert tone='info'>The approval levels are worked out when the order is confirmed, from its value and the chart of authority.</Alert>;
    return (
        <Section title={`Approval of ${money(po.approval.amount, po.orgCurrency)}`}>
            <ol className='space-y-2'>
                {steps.map((s) => (
                    <li key={s.level} className='flex gap-3 rounded-xl border border-line p-3'>
                        {s.status === 'approved' ? <CheckCircle2 className='h-5 w-5 shrink-0 text-emerald-400' /> : <ShieldAlert className='h-5 w-5 shrink-0 text-amber-300' />}
                        <div className='min-w-0 flex-1'>
                            <p className='text-sm text-ink'>
                                {s.level} · {s.title}
                            </p>
                            <p className='text-xs text-soft'>
                                {s.positionTitle}
                                {s.viaReportingLine ? ' (preparer’s manager)' : ''}
                            </p>
                            {s.status === 'approved' ? (
                                <p className='text-xs text-muted'>
                                    Approved by {s.byName}, {fmtDate(s.at)}
                                    {s.note ? `: ${s.note}` : ''}
                                </p>
                            ) : (
                                <p className='text-xs text-amber-300'>Waiting</p>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
            <p className='text-xs text-muted'>Chart of authority version {po.approval.authorityVersion}. Levels are approved in order by people holding the job role shown.</p>
        </Section>
    );
}

// ----- Trace -----

function TraceView({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<Trace>(`${API}/orders/trace`, { id }), [id]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the trace.'}</Alert>;
    const lt = data.leadTime;
    return (
        <div className='space-y-3'>
            <Section title='From requirement to order'>
                <Facts
                    rows={[
                        ['Requirement', data.chain.requirements.map((r) => `${r.id} ${r.title}`).join('; ')],
                        ['Quotation', data.chain.quotations.map((q) => q.number).join(', ')],
                        ['Requisition', data.chain.requisitions.map((q) => q.number).join(', ')],
                        ['Total time', data.totalHours ? span(data.totalHours) : ''],
                    ]}
                />
            </Section>
            <Section title='Lead time'>
                <Facts
                    rows={[
                        ['Quoted lead time', lt.quotedDays ? `${lt.quotedDays} days` : 'Not quoted'],
                        ['Counting from', lt.since ? fmtDate(lt.since) : 'Not sent or approved yet'],
                        ['Days elapsed', lt.elapsedDays !== null ? `${lt.elapsedDays}` : ''],
                        ['Delivered in full after', lt.actualDays !== null ? `${lt.actualDays} days` : ''],
                        ['Against the quote', lt.onTime === null ? '' : lt.onTime ? 'On time' : 'Late'],
                    ]}
                />
            </Section>
            <Section title='Milestones'>
                <ol className='space-y-1'>
                    {data.milestones.map((m) => (
                        <li key={m.key} className='flex items-start gap-2 text-sm'>
                            <span className='mt-2 h-2 w-2 shrink-0 rounded-full bg-brand' />
                            <div className='min-w-0 flex-1'>
                                <p className='text-ink'>{m.label}</p>
                                <p className='text-xs text-muted'>
                                    {fmtDate(m.at)}
                                    {m.hoursFromPrevious ? ` · ${span(m.hoursFromPrevious)} after the step before` : ''}
                                </p>
                            </div>
                        </li>
                    ))}
                </ol>
            </Section>
            <Section title='Every step'>
                <RichTable
                    id='prc.order.trace'
                    columns={[
                        { key: 'at', label: 'When', type: 'date', value: (e) => e.at, render: (e) => fmtDate(e.at) },
                        { key: 'stage', label: 'Stage', value: (e) => e.stage },
                        { key: 'ref', label: 'Reference', value: (e) => e.ref },
                        { key: 'title', label: 'Step', value: (e) => e.title },
                        { key: 'by', label: 'By', value: (e) => e.byName },
                        { key: 'gap', label: 'Hours since previous', type: 'number', value: (e) => e.hoursSincePrevious },
                        { key: 'start', label: 'Hours since start', type: 'number', value: (e) => e.hoursSinceStart, hidden: true },
                        { key: 'note', label: 'Note', value: (e) => e.note, hidden: true },
                    ]}
                    rows={data.timeline}
                    rowKey={(e) => `${e.at}-${e.stage}-${e.title}-${e.ref}`}
                    empty='Nothing recorded.'
                    fileName={`${id}-trace`}
                    height='h-96'
                />
            </Section>
        </div>
    );
}

// ----- Deliveries -----

function ReceiveForm({ po, onDone }: { po: PoFull; onDone: (m: string) => void }) {
    const plan = useLoad(() => callBackend<{ lines: Array<{ no: number; warehouse: boolean; materialId: string; materialNumber: string; materialName: string; options: Array<{ id: string; number: string; name: string }>; finance: string }> }>(`${API}/orders/receive/prepare`, { id: po.id }), [po.id]);
    const [mat, setMat] = useState<Record<number, string>>({});
    const [ref, setRef] = useState('');
    const [date, setDate] = useState(todayIso());
    const [note, setNote] = useState('');
    const [qty, setQty] = useState<Record<number, string>>({});
    const confirm = useConfirm();
    const open = po.lines.filter((l) => (l.outstanding ?? 0) > 0);
    const given = open.map((l) => ({ no: l.no, qty: Number(qty[l.no]) || 0, materialId: mat[l.no] ?? '' })).filter((x) => x.qty > 0);
    const over = open.filter((l) => (Number(qty[l.no]) || 0) > (l.outstanding ?? 0));
    const problems: string[] = [];
    if (ref.trim().length < 2) problems.push('The delivery note number');
    if (!date || date > todayIso()) problems.push('A delivery date that is not in the future');
    if (!given.length) problems.push('A quantity received for at least one line');
    if (over.length) problems.push(`Quantities within what is outstanding (line ${over.map((l) => l.no).join(', ')})`);
    const needMat = given.filter((g) => { const p = plan.data?.lines.find((x) => x.no === g.no); return !!p && p.warehouse && !p.materialId && !g.materialId; });
    if (needMat.length) problems.push(`The warehouse material received on line ${needMat.map((g) => g.no).join(', ')}`);
    const save = () =>
        confirm.ask(
            { title: 'Record the delivery', message: `${given.length} line(s) on delivery note ${ref.trim()}, dated ${date}.`, confirmLabel: 'Record delivery', acknowledge: 'The quantities are what was physically received and counted.' },
            async () => {
                await callBackend(`${API}/orders/receive`, { id: po.id, ref, date, note, lines: given });
                setRef('');
                setNote('');
                setQty({});
                onDone('Delivery recorded.');
            }
        );
    return (
        <Section title='Record a delivery'>
            <Field id='rc-ref' label='Delivery note number *' value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} />
            <Field id='rc-date' label='Delivery date *' type='date' max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            {plan.data && plan.data.lines.some((x) => x.finance === 'live') && <p className='text-xs text-sky-300'>This delivery posts to the journal: Dr inventory (or the line account, or asset clearing), Cr GR/IR.</p>}
            {plan.data && plan.data.lines.some((x) => x.finance === 'blocked') && <Alert tone='error'>Finance is blocked or closed for a legal entity on this order, so the delivery will be refused.</Alert>}
            {open.map((l) => {
                const p = plan.data?.lines.find((x) => x.no === l.no);
                return (
                <div key={l.no} className='space-y-1'>
                <Field
                    id={`rc-q-${l.no}`}
                    label={`Line ${l.no} · ${l.itemName || l.requirement} (outstanding ${l.outstanding} ${l.unit})`}
                    inputMode='decimal'
                    value={qty[l.no] ?? ''}
                    error={(Number(qty[l.no]) || 0) > (l.outstanding ?? 0) ? `Only ${l.outstanding} ${l.unit} is outstanding.` : ''}
                    onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })}
                />
                {p?.warehouse && (p.materialId ? (
                    <p className='text-xs text-muted'>Received into stock as {p.materialNumber} {p.materialName}</p>
                ) : (
                    <SelectField id={`rc-m-${l.no}`} label='Received as warehouse material *' value={mat[l.no] ?? ''} onChange={(e) => setMat({ ...mat, [l.no]: e.target.value })}>
                        <option value=''>Choose the material</option>
                        {p.options.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.number} {m.name}
                            </option>
                        ))}
                    </SelectField>
                ))}
                </div>
                );
            })}
            <Field id='rc-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            {problems.length > 0 && (
                <div className='text-xs text-amber-300'>
                    <p className='font-semibold'>Still needed:</p>
                    <ul className='list-disc pl-5'>
                        {problems.map((p) => (
                            <li key={p}>{p}</li>
                        ))}
                    </ul>
                </div>
            )}
            <Button disabled={problems.length > 0} onClick={save}>
                Record delivery
            </Button>
            {confirm.sheet}
        </Section>
    );
}

// ----- Printable order -----

async function printOrder(po: PoFull) {
    await downloadReportPdf({
        title: `Purchase order ${po.number}`,
        subtitle: `${po.vendorName} · ${po.statusLabel}`,
        fileName: po.number,
        sections: [
            {
                heading: 'Order',
                facts: [
                    ['Supplier', po.vendorName],
                    ['Currency', po.currency],
                    ['Payment terms', po.paymentTermsLabel || '-'],
                    ['Contract reference', po.contractRef || '-'],
                    ['Order total', money(po.total, po.currency)],
                    ['Approved', po.approvedAt ? fmtDate(po.approvedAt) : 'Not yet'],
                ],
            },
            { heading: 'Lines', table: { head: ['No', 'Item', 'Quantity', 'Net price', 'Total', 'Needed by'], body: po.lines.map((l) => [String(l.no), l.itemName || l.requirement || '', `${l.quantity} ${l.unit}`, money(l.netUnitPrice), money(l.total), l.dateRequired]) } },
            { heading: 'Approval', table: { head: ['Level', 'Job role', 'Approved by', 'Date'], body: po.approval.steps.map((s) => [s.level, s.positionTitle, s.byName || '-', s.at ? fmtDate(s.at) : '-']) } },
            ...(po.notes ? [{ heading: 'Notes', text: po.notes }] : []),
        ],
    });
}

// ----- One order -----

type Tab = 'overview' | 'validation' | 'approval' | 'deliveries' | 'quotes' | 'trace' | 'history';

function OrderDetail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<PoFull>(`${API}/orders/get`, { id }), [id]);
    const [tab, setTab] = useState<Tab>(() => restoredTableTab<Tab>(['overview','validation','approval','deliveries','quotes','trace','history'], 'overview'));
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState(false);
    const [contractRef, setContractRef] = useState<string | null>(null);
    const [notes, setNotes] = useState<string | null>(null);
    const confirm = useConfirm();
    const lines = useMemo(() => data?.lines ?? [], [data]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Order not found.'}</Alert>;
    const po = data;
    const c = po.can;
    const done = (m: string) => {
        setNotice(m);
        setProblem('');
        reload();
    };
    const call = async (path: string, body: Record<string, unknown>, ok: string) => {
        await callBackend(`${API}/orders/${path}`, { id, ...body });
        done(ok);
    };

    const validate = async () => {
        setBusy(true);
        setProblem('');
        try {
            const out = await callBackend<{ fails: number; warns: number }>(`${API}/orders/validate`, { id });
            setTab('validation');
            done(out.fails ? `Validation found ${out.fails} failure(s). Fix them, then validate again.` : `Validated with ${out.warns} warning(s).`);
        } catch (e) {
            setProblem(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const confirmOrder = () =>
        confirm.ask(
            {
                title: `Confirm ${po.number}`,
                message: `${po.validation.warns > 0 ? `${po.validation.warns} warning(s) need your written reason. ` : ''}The order goes to approval: ${po.approval.steps.length ? po.approval.steps.map((s) => s.level).join(' then ') : 'the levels the chart of authority sets for its value'}. You will not be able to change it unless an approver returns it.`,
                confirmLabel: 'Confirm for approval',
                acknowledge: 'I have reviewed the lines and the validation results.',
                reason: po.validation.warns > 0 ? { label: 'Why the warnings are acceptable', minLength: 20, placeholder: 'Explain each warning you accept' } : undefined,
            },
            async (reason) => call('confirm', { acknowledge: true, reason }, 'Confirmed and sent for approval.')
        );
    const approve = () =>
        confirm.ask(
            { title: `Approve ${po.number}`, message: `${money(po.total, po.currency)} (${money(po.baseTotal, po.orgCurrency)}) from ${po.vendorName}, at level ${po.waitingFor}.`, confirmLabel: 'Approve', acknowledge: 'I have reviewed the lines, the validation results and the amount.' },
            async () => call('approve', { acknowledge: true }, 'Your approval is recorded.')
        );
    const withReason = (title: string, path: string, label: string, message: string, ok: string, danger = false) =>
        confirm.ask({ title, message, confirmLabel: label, tone: danger ? 'danger' : 'primary', reason: { label: 'Reason', minLength: 10, placeholder: 'Say why' } }, async (reason) => call(path, { reason }, ok));
    // Return, amend: the server makes a new version and we move to it.
    const toNewVersion = (title: string, path: string, label: string, message: string, minLength: number) =>
        confirm.ask({ title, message, confirmLabel: label, reason: { label: 'Reason', minLength, placeholder: 'Say why' } }, async (reason) => {
            const out = await callBackend<{ id: string }>(`${API}/orders/${path}`, { id, reason });
            navigate(`${PO_BASE}/${out.id}`);
        });
    const sendEmail = () =>
        confirm.ask({ title: `Email ${po.number}`, message: `The order is emailed to the supplier contact on record${po.vendorEmail ? ` (${po.vendorEmail})` : ''}.`, confirmLabel: 'Send email' }, async () => call('send', { method: 'email' }, 'Sent to the supplier by email.'));
    const markPrinted = () =>
        confirm.ask({ title: `Printed and sent`, message: `Record that ${po.number} was printed and sent to ${po.vendorName}.`, confirmLabel: 'Record', acknowledge: 'I have printed the order and sent it to the supplier.' }, async () => call('send', { method: 'print', acknowledge: true }, 'Recorded as printed and sent.'));
    const saveDetails = () =>
        confirm.ask({ title: 'Save order details', message: 'Changing the order means it has to be validated again.', confirmLabel: 'Save' }, async () => {
            await call('update', { contractRef: contractRef ?? po.contractRef, notes: notes ?? po.notes }, 'Details saved. Validate the order again.');
            setContractRef(null);
            setNotes(null);
        });

    const primary = c.validate ? (
        <Button busy={busy} onClick={() => void validate()}>
            Validate
        </Button>
    ) : c.confirm ? (
        <Button onClick={confirmOrder}>Confirm</Button>
    ) : c.approve ? (
        <Button onClick={approve}>Approve</Button>
    ) : undefined;
    const secondaryConfirm = c.validate && c.confirm ? (
        <Button onClick={confirmOrder}>Confirm</Button>
    ) : undefined;

    const isService = po.poType === 'service';
    const expiredLines = lines.filter((l) => l.quoteValidUntil && l.quoteValidUntil < todayIso());
    const newest = po.versions.reduce((m, v) => Math.max(m, v.ver), 0);
    const tabs = [
        { value: 'overview' as Tab, label: 'Overview' },
        { value: 'validation' as Tab, label: 'Validation', count: po.validation.checks.length || undefined },
        { value: 'approval' as Tab, label: 'Approval' },
        { value: 'deliveries' as Tab, label: isService ? 'Services' : 'Deliveries', count: (isService ? po.receipts.length : po.deliveries.length) || undefined },
        ...(po.seesQuotes ? [{ value: 'quotes' as Tab, label: 'Quotes' }] : []),
        { value: 'trace' as Tab, label: 'Trace' },
        { value: 'history' as Tab, label: 'History' },
    ];

    return (
        <Screen
            title={po.number}
            subtitle={`${po.vendorName} · ${money(po.total, po.currency)}`}
            onBack={() => navigate(PO_BASE)}
            actions={
                <>
                    {primary}
                    {secondaryConfirm}
                    <Button variant='secondary' aria-label='Download PDF' onClick={() => void printOrder(po).catch((e) => setProblem(messageOf(e)))}>
                        <FileDown className='h-4 w-4' />
                    </Button>
                </>
            }
            toolbar={<Segmented label='Order sections' value={tab} options={tabs} onChange={setTab} />}
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            {po.versions.length > 1 && (
                <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-xs text-muted'>Versions</span>
                    {po.versions.map((v) => (
                        <button key={v.id} type='button' onClick={() => navigate(`${PO_BASE}/${v.id}`)} className={`min-h-11 rounded-xl border px-3 text-xs ${v.current ? 'border-brand text-brand' : 'border-line text-soft'}`}>
                            V{v.ver} · {v.statusLabel}
                        </button>
                    ))}
                </div>
            )}
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={poTone(po.status)}>{po.statusLabel}</Badge>
                <Badge tone='muted'>{po.poTypeLabel}</Badge>
                {po.acknowledged && <Badge tone='brand'>Acknowledged by the supplier</Badge>}
                {['sent', 'partial'].includes(po.status) && !po.acknowledged && <Badge tone='warn'>Not acknowledged yet</Badge>}
                {expiredLines.length > 0 && <Badge tone='danger'>Quote expired</Badge>}
                {po.overdue && <Badge tone='danger'>Overdue</Badge>}
                {po.waitingFor && <Badge tone='warn'>Waiting for {po.waitingFor}</Badge>}
                {po.validation.at && po.status !== 'pending_approval' && <Badge tone={po.validation.fails ? 'danger' : po.validation.warns ? 'warn' : 'brand'}>{po.validation.fails ? `${po.validation.fails} failed` : po.validation.warns ? `${po.validation.warns} warning(s)` : 'Validated'}</Badge>}
            </div>
            {po.status === 'returned' && (
                <Alert tone='warn'>
                    This version was returned by an approver: {po.returnReason}. It is closed. The correction is made in version V{newest}.{' '}
                    <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`${PO_BASE}/${po.baseNumber}`)}>Open the newest version</button>
                </Alert>
            )}
            {po.status === 'superseded' && <Alert tone='info'>A newer version has replaced this one. <button type='button' className='min-h-11 text-brand' onClick={() => navigate(`${PO_BASE}/${po.baseNumber}`)}>Open the newest version</button></Alert>}
            {po.returnReason && po.status === 'draft' && <Alert tone='warn'>Returned by an approver: {po.returnReason}</Alert>}
            {po.amendOf && ['draft', 'validated', 'pending_approval'].includes(po.status) && <Alert tone='info'>This is an amendment of {po.amendOf}: {po.amendReason}. The earlier version stays in force until this one is fully approved.</Alert>}
            {expiredLines.length > 0 && ['draft', 'validated'].includes(po.status) && (
                <Alert tone='error'>
                    The quote expired for line {expiredLines.map((l) => l.no).join(', ')}. An order cannot be submitted on an expired price. Suspend the requisition ({Array.from(new Set(expiredLines.map((l) => l.requisitionId))).join(', ')}), revise it with the supplier’s new price and validity, and the requester confirms it again.
                </Alert>
            )}
            {!po.mine && ['draft', 'validated', 'open', 'sent', 'partial'].includes(po.status) && !po.ownsCostCenter && <p className='text-xs text-muted'>This order belongs to {po.ownerName}. Only the owner can change, send, acknowledge or amend it.</p>}
            {po.rejectReason && <Alert tone='error'>Rejected: {po.rejectReason}</Alert>}
            {po.sendError && <Alert tone='error'>The automatic email failed: {po.sendError}. Print the order and send it, or try again.</Alert>}
            {c.approve && <Alert tone='info'>This order is waiting for your approval at {po.waitingFor}. Review the lines and the Validation tab first.</Alert>}
            {!c.approve && po.approveWhy && <p className='text-xs text-muted'>{po.approveWhy}</p>}

            {tab === 'overview' && (
                <>
                    <Section title='Order'>
                        <Facts
                            rows={[
                                ['Supplier', po.vendorName],
                                ['Supplier email', po.vendorEmail],
                                ['Currency', po.currency],
                                ['Payment terms', po.paymentTermsLabel],
                                ['Buyer group', po.groups],
                                ['Order number', `${po.baseNumber} · version V${po.ver}`],
                                ['Kind of purchase', po.poTypeLabel],
                                ['Owner', po.ownerName],
                                ['Prepared by', po.createdByName],
                                ['Age', `${po.ageDays} days${po.dueOn ? `; due ${po.dueOn}` : ''}`],
                                ['Contract reference', po.contractRef],
                                ['Requisitions', po.requisitions.join(', ')],
                                ['Sent', po.sentAt ? `${fmtDate(po.sentAt)} by ${po.sentByName} (${po.sentMethod === 'email' ? 'email' : 'printed'})` : ''],
                            ]}
                        />
                        {po.notes && <p className='text-sm text-soft'>{po.notes}</p>}
                    </Section>
                    <Section title='Value and currency'>
                        <Facts
                            rows={[
                                ['Order value', money(po.total, po.currency)],
                                ...(po.currency !== po.orgCurrency
                                    ? ([
                                          ['Rate used', po.fxRate ? `1 ${po.currency} = ${po.fxRate} ${po.orgCurrency}${po.fxAsOf ? ` (${fmtDate(po.fxAsOf)})` : ''}` : ''],
                                          ['Latest rate', po.latestRate ? `1 ${po.currency} = ${po.latestRate} ${po.orgCurrency}${po.ratesAsOf ? ` (${fmtDate(po.ratesAsOf)})` : ''}` : 'No latest rate on the currency list'],
                                          ['At the latest rate', po.latestBase !== null ? money(po.latestBase, po.orgCurrency) : ''],
                                      ] as Array<[string, ReactNode]>)
                                    : []),
                                [`Value in ${po.orgCurrency}`, po.baseTotal ? money(po.baseTotal, po.orgCurrency) : 'Worked out when validated'],
                            ]}
                        />
                    </Section>
                    <Section title={`Lines (${lines.length})`}>
                        <RichTable id='prc.order.lines' tabKey='overview' columns={LINE_COLUMNS(po.currency, ['open', 'sent', 'partial', 'full'].includes(po.status))} rows={lines} rowKey={(l) => String(l.no)} empty='No lines.' fileName={`${po.number}-lines`} height='h-96' rowClassName={(l) => (l.quoteValidUntil && l.quoteValidUntil < todayIso() ? 'bg-red-500/10' : '')} />
                    </Section>
                    {c.edit && (
                        <Section title='Details'>
                            <Field id='po-contract' label='Contract reference, optional' value={contractRef ?? po.contractRef} maxLength={60} onChange={(e) => setContractRef(e.target.value)} />
                            <Field id='po-notes' label='Notes to the supplier, optional' value={notes ?? po.notes} maxLength={600} onChange={(e) => setNotes(e.target.value)} />
                            <Button variant='secondary' disabled={contractRef === null && notes === null} onClick={saveDetails}>
                                Save details
                            </Button>
                        </Section>
                    )}
                    {c.send && (
                        <Section title='Send to the supplier'>
                            <p className='text-sm text-soft'>{po.autoSend ? 'Automatic email is on, so this order is normally sent as soon as it is approved.' : 'Send the approved order by email, or print it and send it yourself.'}</p>
                            <div className='flex flex-wrap gap-2'>
                                <Button disabled={!po.emailReady} onClick={sendEmail}>
                                    <Send className='mr-1 h-4 w-4' /> Email to supplier
                                </Button>
                                <Button variant='secondary' onClick={() => void printOrder(po).catch((e) => setProblem(messageOf(e)))}>
                                    <Printer className='mr-1 h-4 w-4' /> Print
                                </Button>
                                <Button variant='secondary' onClick={markPrinted}>
                                    I printed and sent it
                                </Button>
                            </div>
                            {!po.emailReady && <p className='text-xs text-amber-300'>No email service is connected, so print the order and record that you sent it.</p>}
                        </Section>
                    )}
                    {(po.acknowledged || c.acknowledge) && <AckPanel po={po} onDone={done} />}
                    <LinesEditor po={po} onDone={done} />
                    <ReassignPanel po={po} onDone={done} />
                    <div className='flex flex-wrap gap-2'>
                        {c.reopen && (
                            <Button variant='secondary' onClick={() => withReason(`Reopen ${po.number}`, 'reopen', 'Reopen', 'The validation lapses and the order can be edited again. It has not been submitted.', 'Reopened for editing.')}>
                                Reopen before submission
                            </Button>
                        )}
                        {c.amend && (
                            <Button variant='secondary' onClick={() => toNewVersion(`Amend ${po.number}`, 'amend', 'Start amendment', `A new version V${newest + 1} is made as a draft. It is validated and approved again from the start; ${po.number} stays in force until then. Anything already received is kept.`, 15)}>
                                Amend (new version)
                            </Button>
                        )}
                        {c.approve && (
                            <>
                                <Button variant='secondary' onClick={() => toNewVersion(`Return ${po.number}`, 'return', 'Return', `This version is closed with your reason and a new draft version V${newest + 1} is made for the owner to correct. It is then validated, submitted and approved again.`, 10)}>
                                    Return for correction
                                </Button>
                                <Button variant='danger' onClick={() => withReason(`Reject ${po.number}`, 'reject', 'Reject', 'The order is closed for good with your reason, and its requisitions become available again.', 'Order rejected.', true)}>
                                    Reject
                                </Button>
                            </>
                        )}
                        {c.cancel && (
                            <Button variant='danger' onClick={() => withReason(`Cancel ${po.number}`, 'cancel', 'Cancel order', 'The order is closed and its requisitions become available again.', 'Order cancelled.', true)}>
                                Cancel order
                            </Button>
                        )}
                    </div>
                </>
            )}
            {tab === 'validation' && <ValidationView po={po} />}
            {tab === 'approval' && <ApprovalView po={po} />}
            {tab === 'deliveries' && isService && <ServicePanel po={po} onDone={done} />}
            {tab === 'quotes' && po.seesQuotes && <QuotesView id={po.id} />}
            {tab === 'deliveries' && !isService && (
                <div className='space-y-3'>
                    {po.deliveries.length === 0 && <p className='text-sm text-muted'>No deliveries recorded yet.</p>}
                    {po.deliveries.map((d) => (
                        <Section key={d.id} title={`${d.ref} · ${d.date}`}>
                            <p className='text-xs text-muted'>
                                Recorded {fmtDate(d.at)} by {d.byName}
                                {d.note ? `: ${d.note}` : ''}
                            </p>
                            <ul className='text-sm text-ink'>
                                {d.lines.map((l) => (
                                    <li key={l.no}>
                                        Line {l.no}: {l.qty}
                                    </li>
                                ))}
                            </ul>
                        </Section>
                    ))}
                    {c.receive && <ReceiveForm po={po} onDone={done} />}
                </div>
            )}
            {tab === 'trace' && <TraceView id={id} />}
            {tab === 'history' && (
                <Section title='History'>
                    <HistoryList items={po.history} />
                </Section>
            )}
            {confirm.sheet}
        </Screen>
    );
}

export default function PurchaseOrders({ kind, id }: { kind: 'requisitions' | 'orders'; id?: string }) {
    if (kind === 'requisitions') return id && RQ_ID.test(id) ? <RequisitionDetail id={id} /> : <RequisitionList />;
    return id && PO_ID.test(id) ? <OrderDetail id={id} /> : <OrderList />;
}
