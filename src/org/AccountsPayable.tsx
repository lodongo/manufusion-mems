import { useMemo, useState } from 'react';
import { Check, Paperclip, Plus, RefreshCw, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { openStored } from './fileTools';

// Finance > Accounts Payable: supplier invoices (matched, approved under the chart of authority, then posted to
// payables), supplier payments (approved, then posted Dr payables Cr bank and withholding tax), receipt corrections
// awaiting approval, and a payables dashboard with ageing.

const AP = '/api/org/fin/ap';
const BASE = 'organization_home/fin_ap';
const money = (n: number | null | undefined, cur = '') => (n === null || n === undefined ? '-' : `${cur ? `${cur} ` : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const today = () => new Date().toISOString().slice(0, 10);
const tone = (s: string) => (['paid', 'posted', 'done'].includes(s) ? 'brand' : ['on_hold', 'rejected', 'cancelled'].includes(s) ? 'danger' : 'warn');

interface InvRow {
    id: string;
    supplierInvoiceNo: string;
    poId: string;
    poNumber: string;
    vendorName: string;
    currency: string;
    amount: number;
    taxAmount: number;
    expected: number;
    variancePct: number;
    outstanding: number;
    paid: number;
    date: string;
    dueDate: string;
    recNos: string[];
    status: string;
    statusLabel: string;
    fails: number;
    warns: number;
    createdByName: string;
    createdAt: string;
    journalId: string;
    canDecide?: boolean;
}
interface StepT {
    level: string;
    title: string;
    positionTitle: string;
    status: string;
    byName: string;
    at: string;
    note: string;
}
interface InvFull extends InvRow {
    lines: Array<{ no: number; qty: number; value: number }>;
    expectedDetail: { goods: number; charges: number; tax: number; total: number };
    varianceReason: string;
    note: string;
    file: { id?: string; name?: string };
    checks: Array<{ code: string; label: string; result: string; detail: string }>;
    steps: StepT[];
    approvalAmount: number;
    orgCurrency: string;
    history: Array<{ at: string; byName: string; action: string; note: string }>;
    payments: Array<{ id: string; amount: number; status: string }>;
    rejectReason: string;
    cancelReason: string;
    can: { decide: boolean; why: string; recheck: boolean; withdraw: boolean; reverse: boolean };
}

function Steps({ steps }: { steps: StepT[] }) {
    if (!steps.length) return <p className='text-xs text-muted'>No approval route yet.</p>;
    return (
        <ol className='space-y-1 text-sm'>
            {steps.map((s) => (
                <li key={s.level} className='flex items-start gap-2'>
                    <Badge tone={s.status === 'approved' ? 'brand' : 'warn'}>{s.level}</Badge>
                    <span className='min-w-0 flex-1 text-ink'>
                        {s.positionTitle}
                        <span className='block text-xs text-muted'>{s.status === 'approved' ? `Approved by ${s.byName}, ${fmtDate(s.at)}${s.note ? `: ${s.note}` : ''}` : 'Waiting'}</span>
                    </span>
                </li>
            ))}
        </ol>
    );
}

function InvoiceDetail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<InvFull>(`${AP}/invoices/get`, { id }), [id]);
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const [why, setWhy] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Invoice not found.'}</Alert>;
    const d = data;
    const act = (title: string, message: string, url: string, body: Record<string, unknown>, done: string, reason?: { label: string; minLength: number }, danger = false) =>
        confirm.ask({ title, message, confirmLabel: title, ...(reason ? { reason } : {}), ...(danger ? { tone: 'danger' as const } : {}) }, async (r) => {
            await callBackend(url, { id, ...body, ...(reason ? { reason: r } : {}) });
            setNotice(done);
            reload();
        });
    return (
        <Screen
            title={d.id}
            eyebrow={`${d.vendorName} · ${d.poNumber}`}
            subtitle={`${d.statusLabel} · ${money(d.amount, d.currency)}`}
            onBack={() => navigate(`${BASE}/invoices`)}
            actions={
                d.file.id ? (
                    <Button variant='secondary' aria-label='Open the invoice document' onClick={() => void openStored(`${AP}/file`, { fileId: d.file.id }).catch((e) => setProblem(messageOf(e)))}>
                        <Paperclip className='h-4 w-4' />
                    </Button>
                ) : undefined
            }
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <dl className='grid grid-cols-1 gap-1 text-sm sm:grid-cols-2'>
                    {[
                        ['Supplier invoice', `${d.supplierInvoiceNo} · ${d.date}`],
                        ['Receipts', d.recNos.join(', ')],
                        ['Amount', `${money(d.amount, d.currency)} (tax ${money(d.taxAmount, d.currency)})`],
                        ['Expected', `${money(d.expectedDetail.total, d.currency)}: goods ${money(d.expectedDetail.goods, d.currency)} + charges ${money(d.expectedDetail.charges, d.currency)} · ${d.variancePct}%`],
                        ['Approval value', money(d.approvalAmount, d.orgCurrency)],
                        ['Due', d.dueDate || '-'],
                        ['Paid / outstanding', `${money(d.paid, d.currency)} / ${money(d.outstanding, d.currency)}`],
                        ['Journal', d.journalId || 'Not posted'],
                        ['Recorded by', `${d.createdByName}, ${fmtDate(d.createdAt)}`],
                        ['Variance reason', d.varianceReason || '-'],
                    ].map(([k, v]) => (
                        <div key={k} className='flex gap-2'>
                            <dt className='w-32 shrink-0 text-muted'>{k}</dt>
                            <dd className='min-w-0 flex-1 break-words text-ink'>{v}</dd>
                        </div>
                    ))}
                </dl>
                {d.rejectReason && <Alert tone='error'>Rejected: {d.rejectReason}</Alert>}
                {d.cancelReason && <Alert tone='warn'>Cancelled: {d.cancelReason}</Alert>}
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Due diligence</h2>
                <ul className='space-y-1 text-sm'>
                    {d.checks.map((c) => (
                        <li key={c.code} className='flex gap-2'>
                            <span className={c.result === 'fail' ? 'text-red-400' : c.result === 'warn' ? 'text-amber-300' : 'text-emerald-400'}>{c.result === 'fail' ? '✗' : c.result === 'warn' ? '!' : '✓'}</span>
                            <span className='min-w-0 flex-1 text-ink'>
                                {c.label}
                                <span className='block text-xs text-muted'>{c.detail}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Chart of authority</h2>
                <Steps steps={d.steps} />
                {d.status === 'pending_approval' && !d.can.decide && d.can.why && <p className='text-xs text-muted'>{d.can.why}</p>}
                <p className='text-[11px] text-muted'>Final approval posts Dr GR/IR, Dr input VAT, the charges and price variance, Cr supplier payables.</p>
            </section>
            <div className='flex flex-wrap gap-2'>
                {d.can.decide && (
                    <>
                        <Button onClick={() => act('Approve', `Approve ${d.id} for ${money(d.amount, d.currency)}. If this is the last level it is posted to payables.`, `${AP}/invoices/decide`, { action: 'approve' }, 'Approved.')}>
                            <Check className='mr-1 h-4 w-4' /> Approve
                        </Button>
                        <Button variant='danger' onClick={() => act('Reject', 'The invoice is rejected and its receipts are free to be invoiced again.', `${AP}/invoices/decide`, { action: 'reject' }, 'Rejected.', { label: 'Reason', minLength: 10 }, true)}>
                            <X className='mr-1 h-4 w-4' /> Reject
                        </Button>
                    </>
                )}
                {d.can.recheck && (
                    <div className='w-full space-y-2'>
                        {d.checks.some((c) => c.code === 'match.price' && c.result === 'fail') && <Field id='rc-why' label='Reason for the price difference (20+ characters)' value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} />}
                        <Button variant='secondary' onClick={() => act('Check again', 'The invoice is matched again; if everything passes it goes for approval.', `${AP}/invoices/recheck`, { varianceReason: why }, 'Checked again.')}>
                            <RefreshCw className='mr-1 h-4 w-4' /> Check again
                        </Button>
                    </div>
                )}
                {d.can.withdraw && (
                    <Button variant='danger' onClick={() => act('Withdraw', 'The invoice is cancelled and its receipts can be invoiced again.', `${AP}/invoices/withdraw`, {}, 'Withdrawn.', { label: 'Reason', minLength: 10 }, true)}>
                        Withdraw
                    </Button>
                )}
                {d.can.reverse && (
                    <Button variant='danger' onClick={() => act('Reverse', 'The payables posting is reversed and the receipts can be invoiced again or corrected.', `${AP}/invoices/reverse`, {}, 'Reversed.', { label: 'Reason', minLength: 20 }, true)}>
                        Reverse posting
                    </Button>
                )}
            </div>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>History</h2>
                <ul className='space-y-1 text-xs text-ink'>
                    {d.history.map((h, i) => (
                        <li key={i}>
                            {fmtDate(h.at)} · {h.byName}: {h.action}
                            {h.note ? ` (${h.note})` : ''}
                        </li>
                    ))}
                </ul>
            </section>
            {confirm.sheet}
        </Screen>
    );
}

const INV_COLS: Array<Column<InvRow>> = [
    { key: 'id', label: 'Invoice', value: (r) => r.id, render: (r) => <span className='font-semibold text-ink'>{r.id}</span> },
    { key: 'supplierInvoiceNo', label: 'Supplier no', value: (r) => r.supplierInvoiceNo },
    { key: 'vendorName', label: 'Supplier', value: (r) => r.vendorName },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'amount', label: 'Amount', type: 'number', value: (r) => r.amount, render: (r) => money(r.amount, r.currency) },
    { key: 'outstanding', label: 'Outstanding', type: 'number', value: (r) => r.outstanding, render: (r) => money(r.outstanding, r.currency) },
    { key: 'date', label: 'Date', type: 'date', value: (r) => r.date },
    { key: 'dueDate', label: 'Due', type: 'date', value: (r) => r.dueDate },
    { key: 'poNumber', label: 'Order', value: (r) => r.poNumber },
    { key: 'recNos', label: 'Receipts', value: (r) => r.recNos.join(', '), hidden: true },
    { key: 'variancePct', label: 'Variance %', type: 'number', value: (r) => r.variancePct, hidden: true },
    { key: 'checks', label: 'Checks', value: (r) => (r.fails ? `${r.fails} failed` : r.warns ? `${r.warns} warning(s)` : 'All passed'), hidden: true },
    { key: 'currency', label: 'Currency', value: (r) => r.currency, hidden: true },
    { key: 'journalId', label: 'Journal', value: (r) => r.journalId, hidden: true },
    { key: 'createdByName', label: 'Recorded by', value: (r) => r.createdByName, hidden: true },
];

function Invoices() {
    const { data, error, loading } = useLoad(() => callBackend<{ rows: InvRow[] }>(`${AP}/invoices/list`, {}), []);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the invoices.'}</Alert>;
    return <RichTable id='fin.ap.invoices' tabKey='invoices' columns={INV_COLS} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/invoices/${r.id}`)} empty='No supplier invoices yet. They are added on a receipt of a purchase order.' fileName='supplier-invoices' height='h-[60dvh]' rowClassName={(r) => (r.canDecide ? 'bg-amber-500/10' : '')} />;
}

interface PayRow {
    id: string;
    vendorName: string;
    currency: string;
    gross: number;
    wht: number;
    net: number;
    date: string;
    method: string;
    reference: string;
    invoices: string;
    status: string;
    statusLabel: string;
    journalId: string;
    createdByName: string;
    createdAt: string;
    canDecide: boolean;
    why: string;
    steps: StepT[];
}

function NewPayment({ onDone, onClose }: { onDone: (m: string) => void; onClose: () => void }) {
    const opts = useLoad(() => callBackend<{ methods: Array<{ value: string; label: string }>; invoices: Array<InvRow & { vendorId: string; legalEntityId: string; legalEntityCode: string; available: number }> }>(`${AP}/payments/options`, {}), []);
    const [group, setGroup] = useState('');
    const [amt, setAmt] = useState<Record<string, string>>({});
    const [date, setDate] = useState(today());
    const [method, setMethod] = useState('bank_transfer');
    const [reference, setReference] = useState('');
    const [wht, setWht] = useState('');
    const [whtNote, setWhtNote] = useState('');
    const [note, setNote] = useState('');
    const confirm = useConfirm();
    const groups = useMemo(() => {
        const m = new Map<string, { key: string; label: string }>();
        for (const i of opts.data?.invoices ?? []) m.set(`${i.vendorId}|${i.currency}|${i.legalEntityId}`, { key: `${i.vendorId}|${i.currency}|${i.legalEntityId}`, label: `${i.vendorName} · ${i.currency} · ${i.legalEntityCode}` });
        return Array.from(m.values());
    }, [opts.data]);
    if (opts.loading && !opts.data) return <Spinner />;
    if (opts.error || !opts.data) return <Alert tone='error'>{opts.error || 'Could not load the invoices.'}</Alert>;
    const list = opts.data.invoices.filter((i) => `${i.vendorId}|${i.currency}|${i.legalEntityId}` === group);
    const chosen = list.map((i) => ({ id: i.id, amount: Number(amt[i.id]) || 0, max: i.available })).filter((x) => x.amount > 0);
    const gross = chosen.reduce((s, x) => s + x.amount, 0);
    const cur = list[0]?.currency ?? '';
    const missing = [
        !chosen.length ? 'At least one invoice and amount' : '',
        chosen.some((x) => x.amount > x.max + 0.005) ? 'Amounts within what is open' : '',
        !date || date < today() ? 'A payment date today or later' : '',
        Number(wht || 0) < 0 || (gross > 0 && Number(wht || 0) >= gross) ? 'Withholding tax below the payment' : '',
        Number(wht || 0) > 0 && whtNote.trim().length < 3 ? 'What the withholding tax is for' : '',
    ].filter(Boolean);
    return (
        <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <div className='flex items-center justify-between'>
                <h2 className='text-sm font-semibold text-ink'>New payment</h2>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center text-muted'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            {!groups.length ? (
                <Alert tone='info'>No approved invoice is open for payment.</Alert>
            ) : (
                <>
                    <SelectField id='py-sup' label='Supplier, currency and legal entity *' value={group} onChange={(e) => { setGroup(e.target.value); setAmt({}); }}>
                        <option value=''>Choose</option>
                        {groups.map((g) => (
                            <option key={g.key} value={g.key}>
                                {g.label}
                            </option>
                        ))}
                    </SelectField>
                    {list.map((i) => (
                        <div key={i.id} className='space-y-1 rounded-xl border border-line p-2'>
                            <p className='text-xs text-muted'>
                                {i.id} · supplier {i.supplierInvoiceNo} · due {i.dueDate || '-'} · open {money(i.available, i.currency)}
                            </p>
                            <div className='flex gap-2'>
                                <Field id={`py-a-${i.id}`} label='Pay' inputMode='decimal' value={amt[i.id] ?? ''} onChange={(e) => setAmt({ ...amt, [i.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                                <Button variant='secondary' onClick={() => setAmt({ ...amt, [i.id]: String(i.available) })}>
                                    All
                                </Button>
                            </div>
                        </div>
                    ))}
                    {group && (
                        <>
                            <Field id='py-date' label='Payment date *' type='date' min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
                            <SelectField id='py-m' label='How it is paid *' value={method} onChange={(e) => setMethod(e.target.value)}>
                                {opts.data.methods.map((m) => (
                                    <option key={m.value} value={m.value}>
                                        {m.label}
                                    </option>
                                ))}
                            </SelectField>
                            <Field id='py-ref' label='Bank or payment reference' value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
                            <Field id='py-wht' label={`Withholding tax kept back (${cur})`} inputMode='decimal' value={wht} onChange={(e) => setWht(e.target.value.replace(/[^\d.]/g, ''))} />
                            {Number(wht) > 0 && <Field id='py-whtn' label='Withholding tax: rate and type *' value={whtNote} maxLength={120} onChange={(e) => setWhtNote(e.target.value)} />}
                            <Field id='py-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                            <p className='text-sm text-ink'>
                                Gross {money(gross, cur)} · withholding {money(Number(wht || 0), cur)} · to the supplier {money(gross - Number(wht || 0), cur)}
                            </p>
                        </>
                    )}
                    {missing.length > 0 && group && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
                    <Button
                        disabled={!group || missing.length > 0}
                        onClick={() =>
                            confirm.ask({ title: 'Send for approval', message: `Payment of ${money(gross, cur)} for ${chosen.length} invoice(s). It is approved under the chart of authority; the final approval posts it.`, confirmLabel: 'Send for approval', acknowledge: 'The supplier bank details were verified independently.' }, async () => {
                                const out = await callBackend<{ id: string }>(`${AP}/payments/create`, { invoices: chosen.map(({ id, amount }) => ({ id, amount })), date, method, reference, whtAmount: Number(wht || 0), whtNote, note });
                                onDone(`${out.id} sent for approval.`);
                            })
                        }
                    >
                        Send for approval
                    </Button>
                    {confirm.sheet}
                </>
            )}
        </section>
    );
}

function Payments({ canPay }: { canPay: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ rows: PayRow[] }>(`${AP}/payments/list`, {}), []);
    const [adding, setAdding] = useState(false);
    const [notice, setNotice] = useState('');
    const [sel, setSel] = useState<PayRow | null>(null);
    const confirm = useConfirm();
    const cols: Array<Column<PayRow>> = [
        { key: 'id', label: 'Payment', value: (r) => r.id, render: (r) => <span className='font-semibold text-ink'>{r.id}</span> },
        { key: 'vendorName', label: 'Supplier', value: (r) => r.vendorName },
        { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
        { key: 'gross', label: 'Gross', type: 'number', value: (r) => r.gross, render: (r) => money(r.gross, r.currency) },
        { key: 'net', label: 'To supplier', type: 'number', value: (r) => r.net, render: (r) => money(r.net, r.currency) },
        { key: 'wht', label: 'Withholding', type: 'number', value: (r) => r.wht, hidden: true },
        { key: 'date', label: 'Date', type: 'date', value: (r) => r.date },
        { key: 'method', label: 'Method', value: (r) => r.method, hidden: true },
        { key: 'reference', label: 'Reference', value: (r) => r.reference, hidden: true },
        { key: 'invoices', label: 'Invoices', value: (r) => r.invoices, hidden: true },
        { key: 'journalId', label: 'Journal', value: (r) => r.journalId, hidden: true },
        { key: 'createdByName', label: 'Prepared by', value: (r) => r.createdByName, hidden: true },
    ];
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the payments.'}</Alert>;
    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {adding && <NewPayment onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setNotice(m); reload(); }} />}
            {sel && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <div className='flex items-center justify-between'>
                        <h2 className='text-sm font-semibold text-ink'>
                            {sel.id} · {sel.vendorName} · {money(sel.gross, sel.currency)}
                        </h2>
                        <button type='button' aria-label='Close' onClick={() => setSel(null)} className='flex h-11 w-11 items-center justify-center text-muted'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                    <p className='text-xs text-muted'>
                        {sel.method} {sel.reference} · invoices {sel.invoices} · withholding {money(sel.wht, sel.currency)} · prepared by {sel.createdByName}
                    </p>
                    <Steps steps={sel.steps} />
                    {!sel.canDecide && sel.why && <p className='text-xs text-muted'>{sel.why}</p>}
                    {sel.canDecide && (
                        <div className='flex gap-2'>
                            <Button onClick={() => confirm.ask({ title: 'Approve payment', message: `Approve ${sel.id}. The last level posts Dr payables, Cr bank and withholding tax.`, confirmLabel: 'Approve' }, async () => { await callBackend(`${AP}/payments/decide`, { id: sel.id, action: 'approve' }); setSel(null); setNotice('Approved.'); reload(); })}>
                                <Check className='mr-1 h-4 w-4' /> Approve
                            </Button>
                            <Button variant='danger' onClick={() => confirm.ask({ title: 'Reject payment', message: 'The invoices become open for payment again.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${AP}/payments/decide`, { id: sel.id, action: 'reject', reason }); setSel(null); setNotice('Rejected.'); reload(); })}>
                                <X className='mr-1 h-4 w-4' /> Reject
                            </Button>
                        </div>
                    )}
                </section>
            )}
            <RichTable
                id='fin.ap.payments'
                tabKey='payments'
                columns={cols}
                rows={data.rows}
                rowKey={(r) => r.id}
                onRowClick={(r) => setSel(r)}
                empty='No payments yet.'
                fileName='supplier-payments'
                height='h-[55dvh]'
                rowClassName={(r) => (r.canDecide ? 'bg-amber-500/10' : '')}
                actions={canPay ? <Button aria-label='New payment' onClick={() => setAdding(true)}><Plus className='h-4 w-4' /></Button> : undefined}
            />
            {confirm.sheet}
        </div>
    );
}

interface AdjRow {
    id: string;
    kind: string;
    kindLabel: string;
    poId: string;
    poNumber: string;
    recNo: string;
    vendorName: string;
    value: number;
    status: string;
    statusLabel: string;
    reason: string;
    createdByName: string;
    createdAt: string;
    lines: Array<Record<string, unknown>>;
    canDecide?: boolean;
    why?: string;
    steps: StepT[];
}

function Corrections({ approver }: { approver: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ rows: AdjRow[] }>(`${AP}/adjust/${approver ? 'queue' : 'list'}`, {}), [approver]);
    const [sel, setSel] = useState<AdjRow | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    const cols: Array<Column<AdjRow>> = [
        { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='font-semibold text-ink'>{r.id}</span> },
        { key: 'kind', label: 'Kind', value: (r) => r.kindLabel },
        { key: 'recNo', label: 'Receipt', value: (r) => r.recNo },
        { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
        { key: 'value', label: 'Value', type: 'number', value: (r) => r.value, render: (r) => money(r.value) },
        { key: 'poNumber', label: 'Order', value: (r) => r.poNumber },
        { key: 'vendorName', label: 'Supplier', value: (r) => r.vendorName, hidden: true },
        { key: 'createdByName', label: 'Requested by', value: (r) => r.createdByName },
        { key: 'createdAt', label: 'Requested', type: 'date', value: (r) => r.createdAt.slice(0, 10), hidden: true },
        { key: 'reason', label: 'Reason', value: (r) => r.reason, hidden: true },
    ];
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the requests.'}</Alert>;
    return (
        <div className='space-y-3'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {sel && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <div className='flex items-center justify-between'>
                        <h2 className='text-sm font-semibold text-ink'>
                            {sel.id} · {sel.kindLabel} · {sel.recNo}
                        </h2>
                        <button type='button' aria-label='Close' onClick={() => setSel(null)} className='flex h-11 w-11 items-center justify-center text-muted'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                    <p className='text-xs text-muted'>{sel.reason}</p>
                    <ul className='text-xs text-ink'>
                        {sel.lines.map((l, i) => (
                            <li key={i}>
                                Line {String(l.no)}: {sel.kind === 'reverse' ? `reverse ${String(l.qty)}` : `${String(l.fromCostCenterCode ?? '')} ${String(l.fromGlCode ?? '')} → ${String(l.costCenterCode ?? '')} ${String(l.glCode ?? '')}`}
                            </li>
                        ))}
                    </ul>
                    <Steps steps={sel.steps} />
                    {sel.why && !sel.canDecide && <p className='text-xs text-muted'>{sel.why}</p>}
                    {sel.canDecide && (
                        <div className='flex gap-2'>
                            <Button onClick={() => confirm.ask({ title: 'Approve', message: `Approve ${sel.id}. The last level posts the correction.`, confirmLabel: 'Approve' }, async () => { await callBackend(`${AP}/adjust/decide`, { id: sel.id, action: 'approve' }); setSel(null); setNotice('Approved.'); reload(); })}>
                                <Check className='mr-1 h-4 w-4' /> Approve
                            </Button>
                            <Button variant='danger' onClick={() => confirm.ask({ title: 'Reject', message: 'Nothing is changed.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${AP}/adjust/decide`, { id: sel.id, action: 'reject', reason }); setSel(null); setNotice('Rejected.'); reload(); })}>
                                <X className='mr-1 h-4 w-4' /> Reject
                            </Button>
                        </div>
                    )}
                    {!approver && sel.status === 'pending_approval' && (
                        <Button variant='secondary' onClick={() => confirm.ask({ title: 'Withdraw', message: 'The request is closed.', confirmLabel: 'Withdraw' }, async () => { await callBackend(`${AP}/adjust/withdraw`, { id: sel.id }); setSel(null); setNotice('Withdrawn.'); reload(); })}>
                            Withdraw
                        </Button>
                    )}
                </section>
            )}
            <RichTable id='fin.ap.adjustments' tabKey='corrections' columns={cols} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => setSel(r)} empty='No receipt corrections.' fileName='receipt-corrections' height='h-[55dvh]' rowClassName={(r) => (r.canDecide ? 'bg-amber-500/10' : '')} />
            {confirm.sheet}
        </div>
    );
}

function Dashboard() {
    const { data, error, loading } = useLoad(() => callBackend<{ counts: Record<string, number>; aging: Record<string, number>; vendors: Array<{ vendor: string; currency: string; outstanding: number; invoices: number }>; paymentsPending: number }>(`${AP}/dashboard`, {}), []);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the dashboard.'}</Alert>;
    const max = Math.max(1, ...Object.values(data.aging));
    const AG: Array<[string, string]> = [['current', 'Not due'], ['d30', '1-30 days late'], ['d60', '31-60'], ['d90', '61-90'], ['over90', 'Over 90']];
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-2'>
                {[
                    ['On hold', data.counts.on_hold ?? 0, 'text-red-400'],
                    ['In approval', data.counts.pending_approval ?? 0, 'text-amber-300'],
                    ['Posted, unpaid', (data.counts.posted ?? 0) + (data.counts.part_paid ?? 0), 'text-ink'],
                    ['Payments in approval', data.paymentsPending, 'text-amber-300'],
                ].map(([k, v, c]) => (
                    <div key={String(k)} className='rounded-xl border border-line p-3'>
                        <p className='text-[11px] text-muted'>{k}</p>
                        <p className={`text-lg font-semibold ${c}`}>{v}</p>
                    </div>
                ))}
            </div>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Payables ageing (by due date)</h2>
                {AG.map(([k, l]) => (
                    <div key={k} className='space-y-1'>
                        <div className='flex justify-between text-xs'>
                            <span className='text-ink'>{l}</span>
                            <span className='text-muted'>{money(data.aging[k] ?? 0)}</span>
                        </div>
                        <div className='h-2 overflow-hidden rounded-full bg-page'>
                            <div className={`h-full rounded-full ${k === 'current' ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${((data.aging[k] ?? 0) / max) * 100}%` }} />
                        </div>
                    </div>
                ))}
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Owed by supplier</h2>
                {!data.vendors.length && <p className='text-xs text-muted'>Nothing owed.</p>}
                <ul className='text-sm'>
                    {data.vendors.map((v) => (
                        <li key={`${v.vendor}|${v.currency}`} className='flex justify-between border-b border-line py-1'>
                            <span className='text-ink'>{v.vendor}</span>
                            <span className='text-muted'>
                                {money(v.outstanding, v.currency)} · {v.invoices}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

type ApTab = 'dashboard' | 'invoices' | 'payments' | 'corrections';

export default function AccountsPayable({ id, sub, permissions }: { id?: string; sub?: string; permissions: string[] }) {
    const has = (p: string) => permissions.includes('*') || permissions.includes(p);
    const tab: ApTab = (['dashboard', 'invoices', 'payments', 'corrections'] as const).includes(id as ApTab) ? (id as ApTab) : 'dashboard';
    if (tab === 'invoices' && sub && /^INV_\d{8}$/.test(sub)) return <InvoiceDetail id={sub} />;
    const approver = has('FIN.receipt.approve');
    return (
        <Screen title='Accounts Payable' eyebrow='Finance' subtitle='Invoices are matched, approved under the chart of authority, then posted to payables' toolbar={<Segmented label='Accounts payable' value={tab} onChange={(v) => navigate(`${BASE}/${v}`)} options={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'invoices', label: 'Invoices' }, { value: 'payments', label: 'Payments' }, ...(approver || has('PRC.receipt.adjust') ? [{ value: 'corrections' as ApTab, label: 'Receipt corrections' }] : [])]} />}>
            {tab === 'dashboard' && <Dashboard />}
            {tab === 'invoices' && <Invoices />}
            {tab === 'payments' && <Payments canPay={has('FIN.ap.pay')} />}
            {tab === 'corrections' && <Corrections approver={approver} />}
        </Screen>
    );
}
