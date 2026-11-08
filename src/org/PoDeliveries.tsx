import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Paperclip, Plus, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { messageOf, useConfirm } from '../components/screen';
import { API, money, todayIso, Facts, Section, FilePick } from './PoExtras';
import { openStored, type Upload } from './fileTools';

// Deliveries of a purchase order: what is received and what is pending, a + to record a delivery, each receipt
// (REC_) opening to its documents, posting, invoice (INV_) and correction requests; and a delivery dashboard.

export interface DLine {
    no: number;
    itemName?: string;
    requirement?: string;
    unit: string;
    quantity: number;
    receivedQty?: number;
    outstanding?: number;
    netUnitPrice?: number;
    dateRequired: string;
    costCenterName?: string;
}
export interface DReceipt {
    id: string;
    recNo: string;
    status: string;
    kind: string;
    via: string;
    at: string;
    date: string;
    ref: string;
    byName: string;
    note: string;
    journals: string[];
    financeNote: string;
    lines: Array<{ no: number; qty: number; reversedQty: number }>;
    posted: Array<{ no: number; costCenterId: string; glCode: string; warehouse: boolean; type: string; leId: string }>;
    files: Array<{ id: string; kind: string; name: string }>;
    invoiceId: string;
    realigned: string[];
    postingReason: string;
}
export interface DInvoice {
    id: string;
    supplierInvoiceNo: string;
    status: string;
    statusLabel: string;
    date: string;
    recNos: string[];
    scope: string;
    deliveryIds: string[];
    fileId: string;
    amount?: number;
    taxAmount?: number;
    expected?: number;
    variancePct?: number;
    outstanding?: number;
    paid?: number;
}
export interface DAdjust {
    id: string;
    kind: string;
    kindLabel: string;
    recNo: string;
    status: string;
    statusLabel: string;
    reason: string;
    createdByName: string;
    createdAt: string;
}
export interface DPo {
    id: string;
    number: string;
    status: string;
    currency: string;
    total: number | null;
    approvedAt: string;
    lines: DLine[];
    deliveries: DReceipt[];
    seesPrices: boolean;
    ap: { invoices: DInvoice[]; adjustments: DAdjust[]; canCaptureInvoice: boolean; canAdjust: boolean };
    chargesTotal: number | null;
    grandTotal: number | null;
}

const LIVE = ['on_hold', 'pending_approval', 'posted', 'part_paid', 'paid'];
const invTone = (s: string) => (s === 'paid' ? 'brand' : s === 'posted' || s === 'part_paid' ? 'brand' : s === 'on_hold' || s === 'rejected' ? 'danger' : 'warn');
const remaining = (r: DReceipt) => r.lines.reduce((s, l) => s + Math.max(0, l.qty - (l.reversedQty || 0)), 0);
const label = (l: DLine) => l.itemName || l.requirement || `Line ${l.no}`;

function Bar({ pct }: { pct: number }) {
    return (
        <div className='h-2 w-full overflow-hidden rounded-full bg-page' aria-hidden>
            <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
    );
}

export function progressOf(lines: DLine[]) {
    const rows = lines.map((l) => {
        const received = l.receivedQty ?? 0;
        return { l, received, pending: Math.max(0, l.quantity - received), pct: l.quantity > 0 ? Math.min(100, Math.round((received / l.quantity) * 100)) : 0 };
    });
    const ordered = lines.reduce((s, l) => s + l.quantity, 0);
    const got = rows.reduce((s, r) => s + Math.min(r.received, r.l.quantity), 0);
    return { rows, pct: ordered > 0 ? Math.round((got / ordered) * 100) : 0, pending: rows.filter((r) => r.pending > 0).length };
}

// ----- Invoice for a receipt or for the whole order -----

function InvoiceForm({ po, receipt, onDone, onClose }: { po: DPo; receipt: DReceipt; onDone: (m: string) => void; onClose: () => void }) {
    const [scope, setScope] = useState<'receipt' | 'order'>('receipt');
    const prep = useLoad(() => callBackend<{ expected: { goods: number; charges: number; tax: number; total: number }; recNos: string[]; tolerancePct: number; orderScopeAllowed: boolean; blocking: Array<{ label: string; detail: string }> }>(`/api/org/fin/ap/invoices/prepare`, { poId: po.id, scope, deliveryId: receipt.id }), [po.id, scope, receipt.id]);
    const [number, setNumber] = useState('');
    const [date, setDate] = useState(todayIso());
    const [amount, setAmount] = useState('');
    const [tax, setTax] = useState('');
    const [reason, setReason] = useState('');
    const [note, setNote] = useState('');
    const [file, setFile] = useState<Upload | null>(null);
    const [problem, setProblem] = useState('');
    const [result, setResult] = useState<{ id: string; status: string; checks: Array<{ label: string; result: string; detail: string }> } | null>(null);
    const confirm = useConfirm();
    const exp = prep.data?.expected.total ?? 0;
    const tol = prep.data?.tolerancePct ?? 0;
    const a = Number(amount);
    const variance = exp > 0 && a > 0 ? Math.round(((a - exp) / exp) * 10000) / 100 : 0;
    const out = Math.abs(variance) > tol;
    const missing = [
        number.trim().length < 2 ? "The supplier's invoice number" : '',
        !date || date > todayIso() ? 'An invoice date that is not in the future' : '',
        !(a > 0) ? 'The amount including tax' : '',
        Number(tax || 0) < 0 || (a > 0 && Number(tax || 0) >= a) ? 'Tax of zero or more, below the amount' : '',
        !file ? 'The invoice document' : '',
        out && reason.trim().length < 20 ? `A reason (20+ characters) for the ${variance}% difference` : '',
        prep.data?.blocking.length ? prep.data.blocking.map((b) => b.detail).join(' ') : '',
    ].filter(Boolean);
    if (result)
        return (
            <div className='space-y-2 rounded-xl border border-line p-2'>
                <p className='text-sm font-semibold text-ink'>
                    {result.id}: {result.status === 'pending_approval' ? 'matched and sent for approval' : 'on hold: matching found problems'}
                </p>
                <ul className='space-y-1 text-xs'>
                    {result.checks.map((c) => (
                        <li key={c.label} className={c.result === 'fail' ? 'text-red-400' : c.result === 'warn' ? 'text-amber-300' : 'text-muted'}>
                            {c.result === 'fail' ? '✗' : c.result === 'warn' ? '!' : '✓'} {c.label}: {c.detail}
                        </li>
                    ))}
                </ul>
                <p className='text-[11px] text-muted'>Nothing is posted to payables until the last chart-of-authority approval.</p>
                <Button variant='secondary' onClick={() => onDone(`Invoice ${result.id} recorded.`)}>
                    Done
                </Button>
            </div>
        );
    return (
        <div className='space-y-2 rounded-xl border border-line p-2'>
            <div className='flex items-center justify-between'>
                <p className='text-sm font-semibold text-ink'>Add the supplier's invoice</p>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center text-muted'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <div className='space-y-1' role='radiogroup' aria-label='The invoice covers'>
                {(['receipt', 'order'] as const).map((s) => {
                    const disabled = s === 'order' && po.status !== 'full';
                    return (
                        <label key={s} className={`flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm ${disabled ? 'text-muted' : 'text-ink'}`}>
                            <input type='radio' name='inv-scope' className='h-5 w-5 accent-emerald-500' disabled={disabled} checked={scope === s} onChange={() => setScope(s)} />
                            <span>{s === 'receipt' ? `This receipt only (${receipt.recNo})` : `The whole order: every receipt not yet invoiced${disabled ? ' (only when delivered in full)' : ''}`}</span>
                        </label>
                    );
                })}
            </div>
            {prep.loading && !prep.data ? <Spinner /> : prep.error ? <Alert tone='error'>{prep.error}</Alert> : null}
            {prep.data && (
                <p className='text-xs text-muted'>
                    Covers {prep.data.recNos.join(', ')}. Expected {money(prep.data.expected.total, po.currency)}: goods {money(prep.data.expected.goods, po.currency)}, taxes and charges {money(prep.data.expected.charges, po.currency)} (of which tax {money(prep.data.expected.tax, po.currency)}). Tolerance {tol}%.
                </p>
            )}
            <Field id='iv-no' label="Supplier's invoice number *" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />
            <Field id='iv-date' label='Invoice date *' type='date' max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            <Field id='iv-amt' label={`Amount including tax (${po.currency}) *`} inputMode='decimal' value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
            <Field id='iv-tax' label={`Tax on the invoice (${po.currency})`} inputMode='decimal' value={tax} onChange={(e) => setTax(e.target.value.replace(/[^\d.]/g, ''))} />
            {a > 0 && <p className={`text-xs ${out ? 'text-amber-300' : 'text-muted'}`}>Difference from expected: {variance}%</p>}
            {out && <Field id='iv-why' label='Reason for the difference *' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
            <Field id='iv-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            <FilePick label='Invoice document *' value={file} onPick={setFile} onError={setProblem} />
            {problem && <Alert tone='error'>{problem}</Alert>}
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
            <Button
                disabled={missing.length > 0}
                onClick={() =>
                    confirm.ask({ title: 'Record the invoice', message: `${number.trim()} for ${money(a, po.currency)} on ${scope === 'order' ? 'the whole order' : receipt.recNo}. It is matched against the requirement, requisition, order and receipts, then goes for chart-of-authority approval.`, confirmLabel: 'Record invoice', acknowledge: 'The attached document is the supplier’s own invoice.' }, async () => {
                        const out2 = await callBackend<{ id: string; status: string; checks: Array<{ label: string; result: string; detail: string }> }>(`/api/org/fin/ap/invoices/create`, { poId: po.id, scope, deliveryId: receipt.id, number, date, amount: a, taxAmount: Number(tax || 0), varianceReason: reason, note, file: { kind: 'invoice', ...file } });
                        setResult(out2);
                    })
                }
            >
                Record invoice
            </Button>
            {confirm.sheet}
        </div>
    );
}

// ----- Request to reverse a receipt or change where it posted -----

function GlSearch({ id, costCenterId, value, onChange }: { id: string; costCenterId: string; value: string; onChange: (v: string) => void }) {
    const [q, setQ] = useState('');
    const found = useLoad(() => (q.trim().length >= 2 && costCenterId ? callBackend<{ items: Array<{ code: string; name: string }> }>(`${API}/req/gl`, { costCenterId, q }) : Promise.resolve({ items: [] })), [costCenterId, q]);
    return (
        <div className='space-y-1'>
            <Field id={id} label={`GL account${value ? `: ${value}` : ' *'}`} placeholder='Type 2+ characters to search' value={q} onChange={(e) => setQ(e.target.value)} />
            {(found.data?.items ?? []).length > 0 && (
                <div className='max-h-40 overflow-y-auto overscroll-contain rounded-xl border border-line'>
                    {found.data!.items.map((x) => (
                        <button key={x.code} type='button' className='block min-h-11 w-full px-3 text-left text-sm text-ink active:bg-page' onClick={() => { onChange(x.code); setQ(''); }}>
                            {x.code} {x.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function AdjustForm({ po, receipt, kind, onDone, onClose }: { po: DPo; receipt: DReceipt; kind: 'reverse' | 'repost'; onDone: (m: string) => void; onClose: () => void }) {
    type CcList = { costCenters: Record<string, Array<{ id: string; code: string; name: string }>> };
    const cc = useLoad<CcList>(() => (kind === 'repost' ? callBackend<CcList>(`${API}/orders/receive/prepare`, { id: po.id }) : Promise.resolve({ costCenters: {} })), [po.id, kind]);
    const [qty, setQty] = useState<Record<number, string>>({});
    const [chg, setChg] = useState<Record<number, { cc: string; gl: string }>>({});
    const [reason, setReason] = useState('');
    const confirm = useConfirm();
    const lineOf = (no: number) => po.lines.find((l) => l.no === no);
    const rows = receipt.lines.filter((l) => l.qty - (l.reversedQty || 0) > 0);
    const movable = rows.filter((l) => !receipt.posted.find((p) => p.no === l.no)?.warehouse);
    const reverse = rows.map((l) => ({ no: l.no, qty: Number(qty[l.no]) || 0 })).filter((x) => x.qty > 0);
    const changes = Object.entries(chg).map(([no, v]) => ({ no: Number(no), costCenterId: v.cc, glCode: v.gl })).filter((x) => x.costCenterId);
    const missing = [
        kind === 'reverse' && !reverse.length ? 'A quantity to reverse' : '',
        kind === 'reverse' && rows.some((l) => (Number(qty[l.no]) || 0) > l.qty - (l.reversedQty || 0)) ? 'Quantities within what was received' : '',
        kind === 'repost' && !changes.length ? 'A new cost center for at least one line' : '',
        kind === 'repost' && changes.some((c) => receipt.posted.find((p) => p.no === c.no)?.type !== 'asset' && !c.glCode) ? 'A GL account for each changed line' : '',
        reason.trim().length < 20 ? 'The reason (20+ characters)' : '',
    ].filter(Boolean);
    return (
        <div className='space-y-2 rounded-xl border border-line p-2'>
            <div className='flex items-center justify-between'>
                <p className='text-sm font-semibold text-ink'>{kind === 'reverse' ? `Reverse ${receipt.recNo}` : `Change cost center or GL of ${receipt.recNo}`}</p>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center text-muted'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <p className='text-xs text-muted'>The request is approved under the chart of authority on its value. Approval posts the correction; stock must still be in the warehouse to reverse it. Not possible once paid.</p>
            {kind === 'reverse' &&
                rows.map((l) => (
                    <Field key={l.no} id={`ad-q-${l.no}`} label={`Line ${l.no} · ${label(lineOf(l.no) ?? ({ no: l.no } as DLine))} (up to ${l.qty - (l.reversedQty || 0)})`} inputMode='decimal' value={qty[l.no] ?? ''} onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                ))}
            {kind === 'repost' && (cc.loading && !cc.data ? <Spinner /> : cc.error ? <Alert tone='error'>{cc.error}</Alert> : null)}
            {kind === 'repost' && !movable.length && <Alert tone='info'>Every line of this receipt is warehouse stock. Stock posts to its warehouse; reverse it instead.</Alert>}
            {kind === 'repost' &&
                movable.map((l) => {
                    const p = receipt.posted.find((x) => x.no === l.no);
                    const list = cc.data?.costCenters[p?.leId ?? ''] ?? Object.values(cc.data?.costCenters ?? {}).flat();
                    const v = chg[l.no];
                    return (
                        <div key={l.no} className='space-y-1 rounded-xl border border-line p-2'>
                            <p className='text-xs text-muted'>
                                Line {l.no} · {label(lineOf(l.no) ?? ({ no: l.no } as DLine))}: now {p?.costCenterId}
                                {p?.type !== 'asset' ? ` / ${p?.glCode}` : ' (asset clearing)'}
                            </p>
                            <SelectField id={`ad-cc-${l.no}`} label='New cost center (same legal entity)' value={v?.cc ?? ''} onChange={(e) => setChg({ ...chg, [l.no]: { cc: e.target.value, gl: '' } })}>
                                <option value=''>Keep</option>
                                {list.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.code} {c.name}
                                    </option>
                                ))}
                            </SelectField>
                            {v?.cc && p?.type !== 'asset' && <GlSearch id={`ad-gl-${l.no}`} costCenterId={v.cc} value={v.gl} onChange={(gl) => setChg({ ...chg, [l.no]: { cc: v.cc, gl } })} />}
                        </div>
                    );
                })}
            <Field id='ad-why' label='Reason *' value={reason} maxLength={400} onChange={(e) => setReason(e.target.value)} />
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
            <Button
                disabled={missing.length > 0}
                onClick={() =>
                    confirm.ask({ title: 'Send the request', message: `${kind === 'reverse' ? 'Reversal' : 'Re-posting'} of ${receipt.recNo} goes for chart-of-authority approval.`, confirmLabel: 'Send for approval', acknowledge: 'The reason is true and the receipt has not been paid.' }, async () => {
                        const out = await callBackend<{ id: string }>(`/api/org/fin/ap/adjust/request`, { poId: po.id, deliveryId: receipt.id, kind, reason, ...(kind === 'reverse' ? { lines: reverse } : { changes }) });
                        onDone(`${out.id} sent for approval.`);
                    })
                }
            >
                Send for approval
            </Button>
            {confirm.sheet}
        </div>
    );
}

// ----- One receipt (tap to open) -----

function ReceiptEvent({ po, r, onDone }: { po: DPo; r: DReceipt; onDone: (m: string) => void }) {
    const [open, setOpen] = useState(false);
    const [panel, setPanel] = useState<'' | 'invoice' | 'reverse' | 'repost'>('');
    const [problem, setProblem] = useState('');
    const inv = po.ap.invoices.find((i) => i.id === r.invoiceId || i.deliveryIds.includes(r.id));
    const liveInv = inv && LIVE.includes(inv.status) ? inv : undefined;
    const adj = po.ap.adjustments.filter((x) => x.recNo === r.recNo);
    const pendingAdj = adj.some((x) => x.status === 'pending_approval');
    const reversed = remaining(r) <= 0;
    const qty = r.lines.map((l) => `L${l.no}: ${l.qty}${l.reversedQty ? ` (−${l.reversedQty})` : ''}`).join(' · ');
    const badge = reversed ? <Badge tone='danger'>Reversed</Badge> : liveInv ? <Badge tone={invTone(liveInv.status)}>{liveInv.statusLabel}</Badge> : r.invoiceId && !inv ? <Badge tone='brand'>Invoiced</Badge> : <Badge tone='warn'>Not invoiced</Badge>;
    const done = (m: string) => {
        setPanel('');
        onDone(m);
    };
    return (
        <li className='rounded-xl border border-line'>
            <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className='flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left'>
                {open ? <ChevronDown className='h-4 w-4 shrink-0 text-muted' /> : <ChevronRight className='h-4 w-4 shrink-0 text-muted' />}
                <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-semibold text-ink'>
                        {r.recNo} · {r.date}
                    </p>
                    <p className='truncate text-xs text-muted'>
                        {r.kind === 'service' ? 'Service' : 'Delivery note'} {r.ref} · {qty}
                    </p>
                </div>
                {badge}
            </button>
            {open && (
                <div className='space-y-2 border-t border-line p-3'>
                    <Facts
                        rows={[
                            ['Received by', `${r.byName}, ${fmtDate(r.at)}${r.via === 'inventory' ? ' (in the warehouse)' : ''}`],
                            ['Journal', r.journals.join(', ') || r.financeNote || 'Not posted'],
                            ['Posted to', r.posted.length ? r.posted.map((p) => `L${p.no} ${p.warehouse ? `stock ${p.costCenterId}` : p.type === 'asset' ? `asset clearing ${p.costCenterId}` : `${p.costCenterId} / ${p.glCode}`}`).join('; ') : '-'],
                            ['Note', r.note],
                        ]}
                    />
                    {r.realigned.length > 0 && <p className='text-xs text-sky-300'>Posting aligned at receipt: {r.realigned.join('; ')}{r.postingReason ? ` (${r.postingReason})` : ''}</p>}
                    <div className='flex flex-wrap gap-2'>
                        {r.files.map((f) => (
                            <Button key={f.id} variant='secondary' onClick={() => void openStored(`${API}/orders/file`, { fileId: f.id }).catch((e) => setProblem(messageOf(e)))}>
                                <Paperclip className='mr-1 h-4 w-4' /> {f.kind === 'invoice' ? 'Invoice' : f.kind === 'delivery_note' ? 'Delivery note' : f.name}
                            </Button>
                        ))}
                        {inv?.fileId && (
                            <Button variant='secondary' onClick={() => void openStored(`${API}/orders/file`, { fileId: inv.fileId }).catch((e) => setProblem(messageOf(e)))}>
                                <Paperclip className='mr-1 h-4 w-4' /> Invoice {inv.supplierInvoiceNo}
                            </Button>
                        )}
                    </div>
                    {problem && <Alert tone='error'>{problem}</Alert>}
                    <section className='space-y-1'>
                        <h3 className='text-xs font-semibold text-muted'>Invoice</h3>
                        {liveInv ? (
                            <Facts
                                rows={[
                                    ['Invoice', `${liveInv.id} · supplier ${liveInv.supplierInvoiceNo} · ${liveInv.date}`],
                                    ['Status', liveInv.statusLabel],
                                    ['Covers', `${liveInv.scope === 'order' ? 'Whole order: ' : ''}${liveInv.recNos.join(', ')}`],
                                    ['Amount', liveInv.amount !== undefined ? `${money(liveInv.amount, po.currency)} (tax ${money(liveInv.taxAmount ?? 0, po.currency)}; ${liveInv.variancePct}% against expected)` : 'Hidden'],
                                    ['Paid', liveInv.paid !== undefined ? `${money(liveInv.paid, po.currency)}, outstanding ${money(liveInv.outstanding ?? 0, po.currency)}` : 'Hidden'],
                                ]}
                            />
                        ) : reversed ? (
                            <p className='text-xs text-muted'>Reversed receipts are not invoiced.</p>
                        ) : r.invoiceId && !inv ? (
                            <p className='text-xs text-muted'>Invoiced ({r.invoiceId}).</p>
                        ) : po.ap.canCaptureInvoice ? (
                            panel === 'invoice' ? (
                                <InvoiceForm po={po} receipt={r} onDone={done} onClose={() => setPanel('')} />
                            ) : (
                                <Button onClick={() => setPanel('invoice')}>
                                    <Plus className='mr-1 h-4 w-4' /> Add invoice
                                </Button>
                            )
                        ) : (
                            <p className='text-xs text-muted'>Not invoiced yet. Accounts payable records the supplier's invoice.</p>
                        )}
                    </section>
                    {adj.length > 0 && (
                        <section className='space-y-1'>
                            <h3 className='text-xs font-semibold text-muted'>Correction requests</h3>
                            <ul className='space-y-1 text-xs text-ink'>
                                {adj.map((x) => (
                                    <li key={x.id}>
                                        {x.id} · {x.kindLabel} · {x.statusLabel} · {x.createdByName}: {x.reason}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                    {po.ap.canAdjust && !reversed && !liveInv && !pendingAdj && r.kind !== 'service' && (
                        panel === 'reverse' || panel === 'repost' ? (
                            <AdjustForm po={po} receipt={r} kind={panel} onDone={done} onClose={() => setPanel('')} />
                        ) : (
                            <div className='flex flex-wrap gap-2'>
                                <Button variant='secondary' onClick={() => setPanel('reverse')}>
                                    Request reversal
                                </Button>
                                <Button variant='secondary' onClick={() => setPanel('repost')}>
                                    Change cost center / GL
                                </Button>
                            </div>
                        )
                    )}
                    {po.ap.canAdjust && liveInv && !['paid', 'part_paid'].includes(liveInv.status) && <p className='text-[11px] text-muted'>To reverse or re-post, the invoice must first be withdrawn or reversed by accounts payable.</p>}
                </div>
            )}
        </li>
    );
}

// ----- Deliveries tab -----

export function DeliveriesTab({ po, canReceive, receiveForm, onDone }: { po: DPo; canReceive: boolean; receiveForm: ReactNode; onDone: (m: string) => void }) {
    const [adding, setAdding] = useState(false);
    const prog = progressOf(po.lines);
    const history = [...po.deliveries].sort((a, b) => b.at.localeCompare(a.at));
    return (
        <div className='space-y-3'>
            <Section
                title={`Received ${prog.pct}%`}
                right={
                    canReceive && prog.pending > 0 ? (
                        <Button aria-label='Record a delivery' onClick={() => setAdding(!adding)}>
                            {adding ? <X className='h-4 w-4' /> : <Plus className='h-4 w-4' />}
                        </Button>
                    ) : prog.pending === 0 ? (
                        <Badge tone='brand'>Delivered in full</Badge>
                    ) : null
                }
            >
                <ul className='space-y-2'>
                    {prog.rows.map(({ l, received, pending, pct }) => (
                        <li key={l.no} className='space-y-1'>
                            <div className='flex items-baseline justify-between gap-2 text-sm'>
                                <span className='min-w-0 flex-1 truncate text-ink'>
                                    {l.no} · {label(l)}
                                </span>
                                <span className={`shrink-0 text-xs ${pending > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                                    {received}/{l.quantity} {l.unit}
                                    {pending > 0 ? ` · ${pending} pending` : ' · received'}
                                </span>
                            </div>
                            <Bar pct={pct} />
                        </li>
                    ))}
                </ul>
            </Section>
            {adding && receiveForm}
            <Section title={`History (${history.length})`}>
                {history.length === 0 ? <p className='text-sm text-muted'>No deliveries recorded yet.{canReceive ? ' Tap + to record one.' : ''}</p> : (
                    <ul className='space-y-2'>
                        {history.map((r) => (
                            <ReceiptEvent key={r.id} po={po} r={r} onDone={onDone} />
                        ))}
                    </ul>
                )}
            </Section>
        </div>
    );
}

// ----- Delivery dashboard -----

export function DeliveryDashboard({ po }: { po: DPo }) {
    const prog = progressOf(po.lines);
    const live = po.deliveries.filter((r) => remaining(r) > 0);
    const receivedValue = po.lines.reduce((s, l) => s + (l.receivedQty ?? 0) * (l.netUnitPrice ?? 0), 0);
    const invs = po.ap.invoices.filter((i) => LIVE.includes(i.status));
    const invoiced = invs.reduce((s, i) => s + (i.amount ?? 0), 0);
    const paid = invs.reduce((s, i) => s + (i.paid ?? 0), 0);
    const notInvoiced = live.filter((r) => !r.invoiceId || !po.ap.invoices.some((i) => i.id === r.invoiceId && LIVE.includes(i.status)));
    const today = todayIso();
    const late = prog.rows.filter((r) => r.pending > 0 && r.l.dateRequired && r.l.dateRequired < today);
    const onTime = prog.rows.filter((r) => r.pending === 0 && r.l.dateRequired).length;
    const firstAt = [...po.deliveries].sort((a, b) => a.at.localeCompare(b.at))[0]?.date;
    const days = po.approvedAt && firstAt ? Math.max(0, Math.round((Date.parse(firstAt) - Date.parse(po.approvedAt.slice(0, 10))) / 86_400_000)) : null;
    const tile = (k: string, v: ReactNode, tone = 'text-ink') => (
        <div className='rounded-xl border border-line p-3'>
            <p className='text-[11px] text-muted'>{k}</p>
            <p className={`text-lg font-semibold ${tone}`}>{v}</p>
        </div>
    );
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-2'>
                {tile('Received', `${prog.pct}%`, prog.pct >= 100 ? 'text-emerald-400' : 'text-ink')}
                {tile('Lines pending', prog.pending, prog.pending ? 'text-amber-300' : 'text-emerald-400')}
                {tile('Receipts', `${live.length}${po.deliveries.length > live.length ? ` (+${po.deliveries.length - live.length} reversed)` : ''}`)}
                {tile('Overdue lines', late.length, late.length ? 'text-red-400' : 'text-emerald-400')}
                {tile('Not invoiced', `${notInvoiced.length} receipt(s)`, notInvoiced.length ? 'text-amber-300' : 'text-emerald-400')}
                {tile('First delivery', days === null ? '-' : `${days} day(s) after approval`)}
                {po.seesPrices && tile('Received value', money(Math.round(receivedValue * 100) / 100, po.currency))}
                {po.seesPrices && tile('Invoiced / paid', `${money(invoiced, po.currency)} / ${money(paid, po.currency)}`)}
            </div>
            <Section title='Received against ordered'>
                <ul className='space-y-2'>
                    {prog.rows.map(({ l, received, pending, pct }) => (
                        <li key={l.no} className='space-y-1'>
                            <div className='flex justify-between gap-2 text-xs'>
                                <span className='min-w-0 flex-1 truncate text-ink'>{label(l)}</span>
                                <span className='text-muted'>
                                    {received}/{l.quantity} · needed {l.dateRequired || '-'}
                                    {pending > 0 && l.dateRequired && l.dateRequired < today ? ' · late' : ''}
                                </span>
                            </div>
                            <Bar pct={pct} />
                        </li>
                    ))}
                </ul>
                <p className='text-[11px] text-muted'>{onTime} line(s) complete.</p>
            </Section>
            <Section title='Receipts and invoices'>
                <ul className='space-y-1 text-xs'>
                    {[...po.deliveries].sort((a, b) => a.at.localeCompare(b.at)).map((r) => {
                        const i = po.ap.invoices.find((x) => x.id === r.invoiceId || x.deliveryIds.includes(r.id));
                        return (
                            <li key={r.id} className='flex flex-wrap items-center justify-between gap-1 border-b border-line py-1'>
                                <span className='text-ink'>
                                    {r.recNo} · {r.date}
                                </span>
                                <span className='text-muted'>{remaining(r) <= 0 ? 'Reversed' : i ? `${i.id} ${i.statusLabel}` : 'Not invoiced'}</span>
                            </li>
                        );
                    })}
                    {!po.deliveries.length && <li className='text-muted'>No receipts yet.</li>}
                </ul>
            </Section>
        </div>
    );
}
