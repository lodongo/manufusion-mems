import { useState, type ReactNode } from 'react';
import { FileUp, Paperclip } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { messageOf, useConfirm } from '../components/screen';
import RichTable from '../components/RichTable';
import { openStored, readUpload, type Upload } from './fileTools';

// Pieces of the purchase order screens that belong to the second half of the process: the supplier's quotes, the
// acknowledgement, services rendered and accepted, hand-over to another owner, line changes and who may see what.

export const API = '/api/org/procurement';
export const PO_BASE = 'organization_home/procurement_orders';
export const RQ_BASE = 'organization_home/procurement_requisitions';
export const money = (n: number | null | undefined, cur = '') => (n === null || n === undefined ? 'Hidden' : `${cur ? `${cur} ` : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
    return (
        <dl className='grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2'>
            {rows.map(([k, v]) => (
                <div key={k} className='flex gap-2'>
                    <dt className='w-36 shrink-0 text-muted'>{k}</dt>
                    <dd className='min-w-0 flex-1 break-words text-ink'>{v || '-'}</dd>
                </div>
            ))}
        </dl>
    );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
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

/** A document chosen on the device. The file is read here and checked again on the server. */
export function FilePick({ label, value, onPick, onError }: { label: string; value: Upload | null; onPick: (u: Upload | null) => void; onError: (m: string) => void }) {
    return (
        <div className='space-y-1'>
            <p className='text-xs text-muted'>{label}</p>
            <label className='flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm text-ink active:bg-page'>
                {value ? <Paperclip className='h-4 w-4 text-brand' /> : <FileUp className='h-4 w-4 text-soft' />}
                <span className='min-w-0 flex-1 truncate'>{value ? value.name : 'Choose a PDF, JPEG or PNG'}</span>
                <input
                    type='file'
                    className='sr-only'
                    accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        readUpload(f).then(onPick).catch((err) => onError(messageOf(err)));
                    }}
                />
            </label>
        </div>
    );
}

// ----- Shapes -----

export interface XLine {
    no: number;
    itemName?: string;
    requirement?: string;
    quantity: number;
    unit: string;
    netUnitPrice?: number;
    total?: number;
    dateRequired: string;
    requisitionId?: string;
    reqQuantity?: number;
    receivedQty?: number;
    outstanding?: number;
    quoteValidUntil?: string;
    costCenterName?: string;
    priceRevised?: boolean;
}
export interface Receipt {
    id: string;
    status: string;
    periodFrom: string;
    periodTo: string;
    renderedByName: string;
    renderedAt: string;
    invoiceNo: string;
    invoiceAmount: number;
    amount: number;
    journalId: string;
    lines: Array<{ no: number; itemName: string; unit: string; qty: number; amount: number; what: string }>;
    files: Array<{ id: string; kind: string; name: string }>;
    decidedByName: string;
    decidedAt: string;
    decisionNote: string;
    mine: boolean;
}
export interface PoLite {
    id: string;
    number: string;
    currency: string;
    orgCurrency: string;
    status: string;
    lines: XLine[];
    receipts: Receipt[];
    payableReady: boolean;
    ownerName: string;
    ack: { at: string; byName: string; ref: string; date: string; note: string; fileName: string; fileId: string };
    can: { acknowledge: boolean; renderService: boolean; acceptService: boolean; reassign: boolean; edit: boolean };
}

const tone = (s: string) => (s === 'accepted' ? 'brand' : s === 'rejected' ? 'danger' : 'warn');

// ----- Supplier acknowledgement -----

export function AckPanel({ po, onDone }: { po: PoLite; onDone: (m: string) => void }) {
    const [ref, setRef] = useState('');
    const [date, setDate] = useState(todayIso());
    const [note, setNote] = useState('');
    const [file, setFile] = useState<Upload | null>(null);
    const [problem, setProblem] = useState('');
    const confirm = useConfirm();
    if (po.ack.at)
        return (
            <Section title='Supplier acknowledgement' right={<Badge tone='brand'>Acknowledged</Badge>}>
                <Facts rows={[['Supplier reference', po.ack.ref], ['Dated', po.ack.date], ['Recorded by', `${po.ack.byName}, ${fmtDate(po.ack.at)}`], ['Note', po.ack.note]]} />
                {po.ack.fileId && (
                    <Button variant='secondary' onClick={() => void openStored(`${API}/orders/file`, { fileId: po.ack.fileId }).catch((e) => setProblem(messageOf(e)))}>
                        <Paperclip className='mr-1 h-4 w-4' /> {po.ack.fileName || 'Open the acknowledgement'}
                    </Button>
                )}
                {problem && <Alert tone='error'>{problem}</Alert>}
            </Section>
        );
    if (!po.can.acknowledge) return null;
    const missing = [ref.trim().length < 2 ? "The supplier's reference" : '', !date || date > todayIso() ? 'The acknowledgement date' : '', !file ? 'The supplier’s acknowledgement document' : ''].filter(Boolean);
    return (
        <Section title='Attach the supplier’s acknowledgement'>
            <p className='text-xs text-muted'>Only the owner of the order records this, once the supplier has confirmed they received it.</p>
            <Field id='ak-ref' label='Supplier reference *' value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} />
            <Field id='ak-date' label='Date on the acknowledgement *' type='date' max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            <Field id='ak-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            <FilePick label='Acknowledgement document *' value={file} onPick={setFile} onError={setProblem} />
            {problem && <Alert tone='error'>{problem}</Alert>}
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
            <Button
                disabled={missing.length > 0}
                onClick={() =>
                    confirm.ask({ title: 'Record the acknowledgement', message: `${po.number} is recorded as acknowledged by the supplier. This is logged and cannot be undone.`, confirmLabel: 'Record', acknowledge: 'The attached document is the supplier’s own acknowledgement of this order.' }, async () => {
                        await callBackend(`${API}/orders/acknowledge`, { id: po.id, ref, date, note, file: { kind: 'acknowledgement', ...file } });
                        onDone('Acknowledgement recorded.');
                    })
                }
            >
                Record acknowledgement
            </Button>
            {confirm.sheet}
        </Section>
    );
}

// ----- Services: rendered by the requester, accepted by the cost center owner -----

export function ServicePanel({ po, onDone }: { po: PoLite; onDone: (m: string) => void }) {
    const open = po.lines.filter((l) => (l.outstanding ?? 0) > 0);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState(todayIso());
    const [qty, setQty] = useState<Record<number, string>>({});
    const [what, setWhat] = useState<Record<number, string>>({});
    const [invNo, setInvNo] = useState('');
    const [invDate, setInvDate] = useState(todayIso());
    const [invAmt, setInvAmt] = useState('');
    const [files, setFiles] = useState<Record<string, Upload | null>>({ timesheet: null, report: null, invoice: null });
    const [note, setNote] = useState('');
    const [problem, setProblem] = useState('');
    const confirm = useConfirm();
    const given = open.map((l) => ({ no: l.no, qty: Number(qty[l.no]) || 0, what: what[l.no] ?? '' })).filter((x) => x.qty > 0);
    const over = open.filter((l) => (Number(qty[l.no]) || 0) > (l.outstanding ?? 0));
    const value = given.reduce((s, g) => s + g.qty * (po.lines.find((l) => l.no === g.no)?.netUnitPrice ?? 0), 0);
    const missing = [
        !from || !to || from > to || to > todayIso() ? 'The period the service was rendered' : '',
        !given.length ? 'How much of at least one service was rendered' : '',
        over.length ? `Quantities within what is outstanding (line ${over.map((l) => l.no).join(', ')})` : '',
        invNo.trim().length < 2 || !(Number(invAmt) > 0) ? 'The invoice number and amount' : '',
        !files.timesheet ? 'The signed and stamped timesheet' : '',
        !files.report ? 'The service report' : '',
        !files.invoice ? 'The supplier’s invoice' : '',
    ].filter(Boolean);
    const view = (fileId: string) => void openStored(`${API}/orders/file`, { fileId }).catch((e) => setProblem(messageOf(e)));
    const decide = (r: Receipt, accept: boolean) =>
        confirm.ask(
            accept
                ? {
                      title: `Accept ${r.id}`,
                      message: `${money(r.amount, po.currency)} of service for ${r.periodFrom} to ${r.periodTo}, invoice ${r.invoiceNo} ${money(r.invoiceAmount, po.currency)}. Accepting reconciles the order and posts a journal to your cost center straight away.`,
                      confirmLabel: 'Accept and post journal',
                      acknowledge: 'I opened the signed and stamped timesheet, the report and the invoice and they agree with the service received.',
                  }
                : { title: `Reject ${r.id}`, message: 'The requester can record the service again with corrected documents.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 10, placeholder: 'What is wrong' } },
            async (reason) => {
                const out = await callBackend<{ journalId?: string }>(`${API}/orders/service/${accept ? 'accept' : 'reject'}`, { id: po.id, receiptId: r.id, ...(accept ? { acknowledge: true, verified: true } : { reason }) });
                onDone(accept ? `Accepted. Journal ${out.journalId} posted.` : 'Receipt rejected.');
            }
        );

    return (
        <div className='space-y-3'>
            {problem && <Alert tone='error'>{problem}</Alert>}
            {!po.payableReady && po.can.acceptService && <Alert tone='warn'>Finance has not set the payable GL account yet, so acceptance cannot post a journal. Ask the procurement setup administrator.</Alert>}
            {po.receipts.length === 0 && <p className='text-sm text-muted'>No service has been recorded yet.</p>}
            {po.receipts.map((r) => (
                <Section key={r.id} title={`${r.id} · ${r.periodFrom} to ${r.periodTo}`} right={<Badge tone={tone(r.status)}>{r.status === 'submitted' ? 'Waiting for acceptance' : r.status === 'accepted' ? 'Accepted' : 'Rejected'}</Badge>}>
                    <Facts
                        rows={[
                            ['Recorded by', `${r.renderedByName}, ${fmtDate(r.renderedAt)}`],
                            ['Value of service', money(r.amount, po.currency)],
                            ['Invoice', `${r.invoiceNo}, ${money(r.invoiceAmount, po.currency)}${Math.abs(r.invoiceAmount - r.amount) > 0.01 ? ` (differs by ${money(Math.abs(r.invoiceAmount - r.amount), po.currency)})` : ''}`],
                            ['Lines', r.lines.map((l) => `${l.no} ${l.itemName}: ${l.qty} ${l.unit}`).join('; ')],
                            ['Decision', r.decidedAt ? `${r.decidedByName}, ${fmtDate(r.decidedAt)}${r.decisionNote ? `: ${r.decisionNote}` : ''}` : ''],
                            ['Journal', r.journalId ? <button key='j' type='button' className='min-h-11 text-brand' onClick={() => navigate(`organization_home/finance_journals/${r.journalId}`)}>{r.journalId}</button> : ''],
                        ]}
                    />
                    <div className='flex flex-wrap gap-2'>
                        {r.files.map((f) => (
                            <Button key={f.id} variant='secondary' onClick={() => view(f.id)}>
                                <Paperclip className='mr-1 h-4 w-4' /> {f.kind === 'timesheet' ? 'Timesheet' : f.kind === 'report' ? 'Report' : 'Invoice'}
                            </Button>
                        ))}
                    </div>
                    {r.status === 'submitted' && po.can.acceptService && (
                        <div className='flex flex-wrap gap-2'>
                            <Button onClick={() => decide(r, true)}>Accept</Button>
                            <Button variant='danger' onClick={() => decide(r, false)}>
                                Reject
                            </Button>
                        </div>
                    )}
                </Section>
            ))}
            {po.can.renderService && (
                <Section title='Record a service rendered'>
                    <p className='text-xs text-muted'>You asked for this service. Record what was rendered with the signed and stamped timesheet, the report and the supplier’s invoice. The owner of the cost center then accepts it.</p>
                    <Field id='sv-from' label='Rendered from *' type='date' max={todayIso()} value={from} onChange={(e) => setFrom(e.target.value)} />
                    <Field id='sv-to' label='Rendered to *' type='date' max={todayIso()} value={to} onChange={(e) => setTo(e.target.value)} />
                    {open.map((l) => (
                        <div key={l.no} className='space-y-1 rounded-xl border border-line p-2'>
                            <Field id={`sv-q-${l.no}`} label={`Line ${l.no} · ${l.itemName || l.requirement} (outstanding ${l.outstanding} ${l.unit})`} inputMode='decimal' value={qty[l.no] ?? ''} error={(Number(qty[l.no]) || 0) > (l.outstanding ?? 0) ? `Only ${l.outstanding} ${l.unit} is outstanding.` : ''} onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                            <Field id={`sv-w-${l.no}`} label='What was done, optional' value={what[l.no] ?? ''} maxLength={200} onChange={(e) => setWhat({ ...what, [l.no]: e.target.value })} />
                        </div>
                    ))}
                    <p className='text-sm text-ink'>Value of the service: {money(value, po.currency)}</p>
                    <Field id='sv-in' label='Supplier invoice number *' value={invNo} maxLength={60} onChange={(e) => setInvNo(e.target.value)} />
                    <Field id='sv-id' label='Invoice date *' type='date' max={todayIso()} value={invDate} onChange={(e) => setInvDate(e.target.value)} />
                    <Field id='sv-ia' label={`Invoice amount (${po.currency}) *`} inputMode='decimal' value={invAmt} onChange={(e) => setInvAmt(e.target.value.replace(/[^\d.]/g, ''))} error={Number(invAmt) > 0 && value > 0 && Math.abs(Number(invAmt) - value) > value * 0.05 ? 'The invoice differs from the value rendered. The cost center owner will not be able to accept it unless it agrees within the matching tolerance.' : ''} />
                    <FilePick label='Signed and stamped timesheet *' value={files.timesheet} onPick={(u) => setFiles({ ...files, timesheet: u })} onError={setProblem} />
                    <FilePick label='Service report *' value={files.report} onPick={(u) => setFiles({ ...files, report: u })} onError={setProblem} />
                    <FilePick label='Supplier invoice *' value={files.invoice} onPick={(u) => setFiles({ ...files, invoice: u })} onError={setProblem} />
                    <Field id='sv-n' label='Note, optional' value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
                    {missing.length > 0 && (
                        <div className='text-xs text-amber-300'>
                            <p className='font-semibold'>Still needed:</p>
                            <ul className='list-disc pl-5'>
                                {missing.map((m) => (
                                    <li key={m}>{m}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <Button
                        disabled={missing.length > 0}
                        onClick={() =>
                            confirm.ask({ title: 'Record the service', message: `${given.length} line(s), ${money(value, po.currency)}, invoice ${invNo.trim()}. It goes to the cost center owner for acceptance.`, confirmLabel: 'Record service', acknowledge: 'The timesheets and reports are signed and stamped and the service was received.' }, async () => {
                                await callBackend(`${API}/orders/service/render`, {
                                    id: po.id,
                                    periodFrom: from,
                                    periodTo: to,
                                    lines: given,
                                    invoiceNo: invNo,
                                    invoiceDate: invDate,
                                    invoiceAmount: Number(invAmt),
                                    signedStamped: true,
                                    note,
                                    files: (['timesheet', 'report', 'invoice'] as const).map((k) => ({ kind: k, ...files[k]! })),
                                });
                                setQty({});
                                setWhat({});
                                setFiles({ timesheet: null, report: null, invoice: null });
                                onDone('Service recorded. It waits for the cost center owner to accept.');
                            })
                        }
                    >
                        Record service
                    </Button>
                </Section>
            )}
            {confirm.sheet}
        </div>
    );
}

// ----- Hand an order over -----

export function ReassignPanel({ po, onDone }: { po: PoLite; onDone: (m: string) => void }) {
    const [open, setOpen] = useState(false);
    const [to, setTo] = useState('');
    const confirm = useConfirm();
    const people = useLoad(() => (open ? callBackend<{ items: Array<{ uid: string; name: string }> }>(`${API}/orders/owners`, { id: po.id }) : Promise.resolve({ items: [] })), [open, po.id]);
    if (!po.can.reassign) return null;
    return (
        <Section title='Hand over this order' right={<Button variant='secondary' onClick={() => setOpen(!open)}>{open ? 'Close' : 'Reassign'}</Button>}>
            <p className='text-xs text-muted'>Now with {po.ownerName}. Only the owner can change an order. If they are away, the owner or a delegate holding the reassign right hands it to a colleague who can manage purchase orders.</p>
            {open && (
                <>
                    {people.loading && <Spinner />}
                    <SelectField id='re-to' label='New owner' value={to} onChange={(e) => setTo(e.target.value)}>
                        <option value=''>Choose a colleague</option>
                        {(people.data?.items ?? []).map((p) => (
                            <option key={p.uid} value={p.uid}>
                                {p.name}
                            </option>
                        ))}
                    </SelectField>
                    <Button
                        disabled={!to}
                        onClick={() =>
                            confirm.ask({ title: `Reassign ${po.number}`, message: 'The new owner takes over editing, sending, acknowledging and amending. This is logged.', confirmLabel: 'Reassign', reason: { label: 'Why', minLength: 10, placeholder: 'For example: owner on leave until 30 June' } }, async (reason) => {
                                await callBackend(`${API}/orders/reassign`, { id: po.id, toUid: to, reason });
                                setOpen(false);
                                setTo('');
                                onDone('Order reassigned.');
                            })
                        }
                    >
                        Reassign
                    </Button>
                </>
            )}
            {confirm.sheet}
        </Section>
    );
}

// ----- Lines of a draft order -----

export function LinesEditor({ po, onDone }: { po: PoLite; onDone: (m: string) => void }) {
    const [qty, setQty] = useState<Record<number, string>>({});
    const [date, setDate] = useState<Record<number, string>>({});
    const [price, setPrice] = useState<Record<number, string>>({});
    const confirm = useConfirm();
    if (!po.can.edit) return null;
    const changed = po.lines
        .map((l) => ({
            no: l.no,
            ...(qty[l.no] !== undefined && Number(qty[l.no]) !== l.quantity ? { quantity: Number(qty[l.no]) } : {}),
            ...(date[l.no] !== undefined && date[l.no] !== l.dateRequired ? { dateRequired: date[l.no] } : {}),
            ...(price[l.no] !== undefined && Number(price[l.no]) !== (l.netUnitPrice ?? 0) ? { netUnitPrice: Number(price[l.no]) } : {}),
        }))
        .filter((x) => Object.keys(x).length > 1);
    const rqs = Array.from(new Set(po.lines.map((l) => l.requisitionId).filter(Boolean))) as string[];
    return (
        <Section title='Change lines'>
            <p className='text-xs text-muted'>Quantity cannot exceed the requisition. A price above the quotation fails validation. Every change needs a reason and is logged; the order must be validated again.</p>
            {po.lines.map((l) => (
                <div key={l.no} className='space-y-1 rounded-xl border border-line p-2'>
                    <p className='text-sm text-ink'>
                        {l.no} · {l.itemName || l.requirement} <span className='text-xs text-muted'>({l.requisitionId}, max {l.reqQuantity ?? l.quantity} {l.unit})</span>
                    </p>
                    <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                        <Field id={`le-q-${l.no}`} label={`Quantity (${l.unit})`} inputMode='decimal' value={qty[l.no] ?? String(l.quantity)} onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                        <Field id={`le-p-${l.no}`} label='Net unit price' inputMode='decimal' value={price[l.no] ?? String(l.netUnitPrice ?? '')} onChange={(e) => setPrice({ ...price, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                        <Field id={`le-d-${l.no}`} label='Needed by' type='date' value={date[l.no] ?? l.dateRequired} onChange={(e) => setDate({ ...date, [l.no]: e.target.value })} />
                    </div>
                </div>
            ))}
            <Button
                disabled={!changed.length}
                onClick={() =>
                    confirm.ask({ title: 'Save line changes', message: `${changed.length} line(s) will change. The validation lapses.`, confirmLabel: 'Save changes', reason: { label: 'Reason for the change', minLength: 10 } }, async (reason) => {
                        await callBackend(`${API}/orders/lines/edit`, { id: po.id, lines: changed, reason });
                        setQty({});
                        setDate({});
                        setPrice({});
                        onDone('Lines changed. Validate the order again.');
                    })
                }
            >
                Save line changes
            </Button>
            {rqs.length > 0 && (
                <div className='space-y-1 border-t border-line pt-2'>
                    <p className='text-xs text-muted'>Take a whole requisition out of this order (it returns to confirmed):</p>
                    <div className='flex flex-wrap gap-2'>
                        {rqs.map((r) => (
                            <Button
                                key={r}
                                variant='secondary'
                                onClick={() =>
                                    confirm.ask({ title: `Remove ${r}`, message: 'Its lines leave this order and the requisition can be used again.', confirmLabel: 'Remove', tone: 'danger', reason: { label: 'Why', minLength: 10 } }, async (reason) => {
                                        await callBackend(`${API}/orders/lines/drop`, { id: po.id, requisitionId: r, reason });
                                        onDone(`${r} removed from the order.`);
                                    })
                                }
                            >
                                Remove {r}
                            </Button>
                        ))}
                    </div>
                </div>
            )}
            {confirm.sheet}
        </Section>
    );
}

// ----- Quotes and quotation analysis -----

interface QuotesOut {
    cases: Array<{
        id: string;
        number: string;
        requirementTitle: string;
        mode: string;
        recommendation: { vendorName: string; at: string; reason: string; shortfallReason: string };
        quotes: Array<{ id: string; vendorName: string; ref: string; currency: string; validUntil: string; leadTimeDays: number; paymentTermsLabel: string; recommended: boolean; bids: number; total: number }>;
        comparison: Array<{ no: number; itemName: string; quantity: number; unit: string; prices: Array<{ quoteId: string; net: number | null }> }>;
        orderPrices: Array<{ no: number; itemName: string; orderNet: number; quotedNet: number; variancePct: number | null; revised: boolean; validUntil: string }>;
    }>;
}

export function QuotesView({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<QuotesOut>(`${API}/orders/quotes`, { id }), [id]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You are not allowed to see the quotes behind this order.'}</Alert>;
    if (!data.cases.length) return <p className='text-sm text-muted'>No quotation is linked to this order.</p>;
    return (
        <div className='space-y-3'>
            {data.cases.map((c) => (
                <div key={c.id} className='space-y-3'>
                    <Section title={`${c.number} · ${c.requirementTitle}`}>
                        <Facts rows={[['Mode of procurement', c.mode], ['Recommended', `${c.recommendation.vendorName}${c.recommendation.at ? `, ${fmtDate(c.recommendation.at)}` : ''}`], ['Reason', c.recommendation.reason], ['Fewer quotes than asked', c.recommendation.shortfallReason]]} />
                    </Section>
                    <Section title='Quotes received'>
                        <RichTable
                            id='prc.order.quotes'
                            columns={[
                                { key: 'vendor', label: 'Supplier', value: (q) => q.vendorName, render: (q) => <span>{q.vendorName} {q.recommended && <Badge tone='brand'>Recommended</Badge>}</span> },
                                { key: 'ref', label: 'Reference', value: (q) => q.ref },
                                { key: 'total', label: 'Total', type: 'number', value: (q) => q.total, render: (q) => money(q.total, q.currency) },
                                { key: 'lead', label: 'Lead time (days)', type: 'number', value: (q) => q.leadTimeDays },
                                { key: 'valid', label: 'Valid until', type: 'date', value: (q) => q.validUntil },
                                { key: 'terms', label: 'Payment terms', value: (q) => q.paymentTermsLabel, hidden: true },
                                { key: 'bids', label: 'Items quoted', type: 'number', value: (q) => q.bids, hidden: true },
                            ]}
                            rows={c.quotes}
                            rowKey={(q) => q.id}
                            empty='No quotes.'
                            fileName={`${c.number}-quotes`}
                            height='h-64'
                            rowClassName={(q) => (q.recommended ? 'bg-emerald-500/10' : '')}
                        />
                    </Section>
                    <Section title='Price by item'>
                        <RichTable
                            id='prc.order.compare'
                            columns={[
                                { key: 'no', label: 'No', type: 'number', value: (r) => r.no },
                                { key: 'item', label: 'Item', value: (r) => r.itemName },
                                { key: 'qty', label: 'Quantity', type: 'number', value: (r) => r.quantity, render: (r) => `${r.quantity} ${r.unit}` },
                                ...c.quotes.map((q) => ({ key: `q${q.id}`, label: `${q.vendorName}${q.recommended ? ' *' : ''}`, type: 'number' as const, value: (r: QuotesOut['cases'][number]['comparison'][number]) => r.prices.find((p) => p.quoteId === q.id)?.net ?? null })),
                            ]}
                            rows={c.comparison}
                            rowKey={(r) => String(r.no)}
                            empty='Nothing to compare.'
                            fileName={`${c.number}-comparison`}
                            height='h-64'
                        />
                    </Section>
                    <Section title='Order price against the recommended quote'>
                        <RichTable
                            id='prc.order.pricecheck'
                            columns={[
                                { key: 'no', label: 'No', type: 'number', value: (r) => r.no },
                                { key: 'item', label: 'Item', value: (r) => r.itemName },
                                { key: 'order', label: 'Order price', type: 'number', value: (r) => r.orderNet },
                                { key: 'quote', label: 'Quoted price', type: 'number', value: (r) => r.quotedNet },
                                { key: 'var', label: 'Variance %', type: 'number', value: (r) => r.variancePct, render: (r) => (r.variancePct === null ? '' : `${r.variancePct}%${r.revised ? ' (revised)' : ''}`) },
                                { key: 'valid', label: 'Price valid until', type: 'date', value: (r) => r.validUntil },
                            ]}
                            rows={c.orderPrices}
                            rowKey={(r) => String(r.no)}
                            empty='No lines.'
                            fileName={`${c.number}-price-check`}
                            height='h-56'
                            rowClassName={(r) => ((r.variancePct ?? 0) > 0 ? 'bg-red-500/10' : '')}
                        />
                    </Section>
                </div>
            ))}
        </div>
    );
}

// ----- Settings: who sees what, and the payable account -----

const AUDIENCES: Array<[string, string]> = [
    ['owner', 'The owner of the order'],
    ['approver', 'Approvers in the route'],
    ['viewer', 'Buyers who hold the view right'],
    ['requester', 'People who asked for something in the order'],
];

export function VisibilitySettings({ onDone }: { onDone: (m: string) => void }) {
    const { data, loading, reload } = useLoad(() => callBackend<{ quotes: string[]; prices: string[]; canSet: boolean }>(`${API}/orders/visibility`, {}));
    const [quotes, setQuotes] = useState<string[] | null>(null);
    const [prices, setPrices] = useState<string[] | null>(null);
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (!data) return null;
    const q = quotes ?? data.quotes;
    const p = prices ?? data.prices;
    const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    const box = (list: string[], set: (v: string[]) => void, id: string) =>
        AUDIENCES.map(([k, label]) => (
            <label key={`${id}-${k}`} className='flex min-h-11 items-center gap-2 text-sm text-ink'>
                <input type='checkbox' className='h-5 w-5' checked={list.includes(k)} disabled={!data.canSet || k === 'owner'} onChange={() => set(toggle(list, k))} />
                {label}
            </label>
        ));
    return (
        <Section title='Who sees the quotes and prices'>
            <p className='text-xs text-muted'>The owner of a cost center sees everything in orders charged to it, and anyone holding the “see quotes” right sees quotes. Everyone else sees what is ticked.</p>
            <p className='text-sm font-semibold text-ink'>Quotes and quotation analysis</p>
            {box(q, setQuotes, 'q')}
            <p className='text-sm font-semibold text-ink'>Prices and values</p>
            {box(p, setPrices, 'p')}
            {data.canSet && (
                <Button
                    disabled={quotes === null && prices === null}
                    onClick={() =>
                        confirm.ask({ title: 'Change who sees order details', message: 'This applies to every order straight away and is logged.', confirmLabel: 'Save', reason: { label: 'Reason', minLength: 10 } }, async (reason) => {
                            await callBackend(`${API}/orders/visibility`, { set: true, quotes: q, prices: p, reason });
                            setQuotes(null);
                            setPrices(null);
                            reload();
                            onDone('Visibility saved.');
                        })
                    }
                >
                    Save
                </Button>
            )}
            {confirm.sheet}
        </Section>
    );
}

export function FinanceSettings({ onDone }: { onDone: (m: string) => void }) {
    void onDone;
    return (
        <Section title='Accounts for receipts and services'>
            <p className='text-sm text-soft'>Deliveries and accepted services post to the journal of the cost center's legal entity through the approved GL account mapping (inventory, line account or asset clearing against GR/IR). The separate payable account is no longer used.</p>
            <Button variant='secondary' onClick={() => navigate('organization_home/fin_gl/mapping')}>
                Open the GL account mapping
            </Button>
        </Section>
    );
}

/** Kept for reference: the payable account used before the finance module posted receipts. */
export function LegacyFinanceSettings({ onDone }: { onDone: (m: string) => void }) {
    const { data, loading, reload } = useLoad(() => callBackend<{ payableGlCode: string; payableName: string; glAccounts: Array<{ code: string; name: string }>; canSet: boolean }>(`${API}/finance/settings`, {}));
    const [code, setCode] = useState('');
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (!data) return null;
    return (
        <Section title='Payable account for accepted services'>
            <p className='text-sm text-ink'>{data.payableGlCode ? `${data.payableGlCode} ${data.payableName}` : 'Not set. Accepted services cannot post a journal until it is.'}</p>
            {data.canSet && (
                <>
                    <SelectField id='fin-gl' label='GL account' value={code} onChange={(e) => setCode(e.target.value)}>
                        <option value=''>Choose from the GL account master</option>
                        {data.glAccounts.map((g) => (
                            <option key={g.code} value={g.code}>
                                {g.code} {g.name}
                            </option>
                        ))}
                    </SelectField>
                    <Button
                        disabled={!code}
                        onClick={() =>
                            confirm.ask({ title: 'Set the payable account', message: `Accepted services will be credited to ${code}.`, confirmLabel: 'Save', reason: { label: 'Reason', minLength: 10 } }, async (reason) => {
                                await callBackend(`${API}/finance/settings`, { set: true, payableGlCode: code, reason });
                                setCode('');
                                reload();
                                onDone('Payable account saved.');
                            })
                        }
                    >
                        Save
                    </Button>
                </>
            )}
            {confirm.sheet}
        </Section>
    );
}
