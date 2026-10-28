import { useMemo, useState } from 'react';
import { FileText, PackageCheck, Printer } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { downloadReportPdf } from '../lib/report';
import { ConfirmBox, StepSection } from './materialCreateUi';

/**
 * Stores Issue Voucher (SIV + 8 digits): the maintenance document stores issue materials against.
 * Raised by the planner or technician from the work order's reserved spares, issued by stores (INV.issue),
 * fully or in part. Each issue posts a goods issue (GI) against the task reservation. The server re-checks
 * every quantity, right and status; this screen only offers what it is told is allowed.
 */

export interface VoucherLine { no: number; taskId: string; taskName: string; materialId: string; materialNumber: string; materialName: string; uom: string; qty: number; issuedQty: number }
export interface Voucher {
    id: string; number: string; status: string; statusLabel: string; workOrderId: string; workOrderTitle: string;
    warehouseId: string; warehouseCode: string; warehouseName: string; requiredDate: string; requestedByName: string;
    receivedBy: string; receivedByName: string; note: string; createdAt: string; updatedAt: string; version: number;
    items: number; outstanding: number; lines: VoucherLine[];
    issues: Array<{ goodsIssueId: string; journalId: string; taskId: string; at: string; byName: string }>;
    history: Array<{ at: string; byName: string; action: string; note: string }>;
    can?: { issue: boolean; cancel: boolean; close: boolean };
    canIssue?: boolean;
}
interface Available { reservationId: string; taskId: string; taskName: string; materialNumber: string; materialName: string; uom: string; warehouseId: string; warehouseCode: string; qty: number }

const API = '/api/org/mnt/siv';
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (s === 'issued' ? 'brand' : s === 'partial' ? 'warn' : s === 'cancelled' ? 'danger' : 'muted');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const today = () => new Date().toISOString().slice(0, 10);

export async function voucherPdf(v: Voucher) {
    await downloadReportPdf({
        title: `${v.number} Stores Issue Voucher`,
        subtitle: `${v.workOrderId} ${v.workOrderTitle} · ${v.statusLabel}`,
        fileName: v.number,
        sections: [
            {
                heading: 'Voucher',
                facts: [
                    ['Work order', `${v.workOrderId} ${v.workOrderTitle}`.trim()],
                    ['Warehouse', `${v.warehouseCode} ${v.warehouseName}`.trim()],
                    ['Needed by', v.requiredDate],
                    ['Raised by', `${v.requestedByName} · ${fmtDate(v.createdAt)}`],
                    ['Collected by', v.receivedByName],
                    ['Status', v.statusLabel],
                ],
            },
            { heading: 'Materials', table: { head: ['Line', 'Task', 'Material', 'Description', 'Requested', 'Issued', 'Unit'], body: v.lines.map((l) => [String(l.no), l.taskName, l.materialNumber, l.materialName, String(l.qty), String(l.issuedQty), l.uom]) } },
            ...(v.issues.length ? [{ heading: 'Goods issues posted', table: { head: ['Goods issue', 'Journal', 'Task', 'When', 'Issued by'], body: v.issues.map((i) => [i.goodsIssueId, i.journalId || 'Not posted', i.taskId, fmtDate(i.at), i.byName]) } }] : []),
            { heading: 'Signatures', facts: [['Issued by (stores)', ''], ['Received by', v.receivedByName], ['Date', '']] },
        ],
    });
}

// ----- On the work order: raise and follow vouchers -----

export function WorkOrderVouchers({ code }: { code: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ canRaise: boolean; workOrderStatus: string; available: Available[]; vouchers: Voucher[]; people: Array<{ uid: string; name: string }> }>(`${API}/for-wo`, { code }), [code]);
    const [raising, setRaising] = useState(false);
    const [picked, setPicked] = useState<Record<string, string>>({});
    const [receivedBy, setReceivedBy] = useState('');
    const [requiredDate, setRequiredDate] = useState(today());
    const [note, setNote] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [done, setDone] = useState('');
    const [openId, setOpenId] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Stores issue vouchers could not be loaded.'}</Alert>;
    if (openId) return <VoucherDetail id={openId} onBack={() => { setOpenId(''); reload(); }} />;

    const chosen = data.available.filter((a) => picked[a.reservationId] !== undefined);
    const lineErrors = chosen.filter((a) => { const q = Number(picked[a.reservationId]); return !(q > 0) || q > a.qty + 1e-9; });
    const problems = [
        ...(chosen.length ? [] : ['Choose at least one reserved line.']),
        ...lineErrors.map((a) => `${a.materialNumber}: request between 0 and ${a.qty} ${a.uom}.`),
        ...(receivedBy ? [] : ['Choose who collects the materials.']),
        ...(requiredDate && requiredDate >= today() ? [] : ['Enter the date needed (today or later).']),
        ...(confirm ? [] : ['Confirm the materials and the person collecting them.']),
    ];
    const raise = async () => {
        setTried(true);
        setFailure('');
        if (problems.length) return;
        setBusy(true);
        try {
            const r = await callBackend<{ ids: string[] }>(`${API}/create`, { code, receivedBy, requiredDate, note, confirm: true, lines: chosen.map((a) => ({ reservationId: a.reservationId, qty: Number(picked[a.reservationId]) })) });
            setDone(`${r.ids.join(', ')} raised. Stores will issue the materials against ${r.ids.length === 1 ? 'it' : 'them'}.`);
            setRaising(false); setPicked({}); setConfirm(false); setTried(false); setNote('');
            reload();
        } catch (e) {
            setFailure(msg(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='space-y-3'>
            {done && <Alert tone='success'>{done}</Alert>}
            <StepSection title='Stores issue vouchers' hint='Stores issue reserved task spares only against a voucher (SIV). Each issue posts a goods issue to this work order.'
                aside={data.canRaise && data.available.length > 0 && !raising ? <Button onClick={() => { setRaising(true); setDone(''); setPicked(Object.fromEntries(data.available.map((a) => [a.reservationId, String(a.qty)]))); }}>Raise voucher</Button> : undefined}>
                {!data.canRaise && <p className='text-xs text-muted'>{['released', 'scheduled', 'in_progress'].includes(data.workOrderStatus) ? 'You cannot raise vouchers here (MNT.WO.plan or MNT.WO.execute is needed at this location).' : 'Vouchers are raised once the work order is released.'}</p>}
                {data.canRaise && !data.available.length && !raising && <p className='text-xs text-muted'>No reserved spares are waiting for a voucher.</p>}
                {raising && (
                    <div className='space-y-3'>
                        <div className='space-y-2'>
                            {data.available.map((a) => {
                                const on = picked[a.reservationId] !== undefined;
                                const bad = tried && on && lineErrors.includes(a);
                                return (
                                    <div key={a.reservationId} className={`rounded-xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line bg-page'}`}>
                                        <label className='flex cursor-pointer items-start gap-3'>
                                            <input type='checkbox' className='mt-1 h-5 w-5 shrink-0' checked={on} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[a.reservationId] = String(a.qty); else delete n[a.reservationId]; return n; })} />
                                            <span className='min-w-0 flex-1'>
                                                <span className='block text-sm font-medium text-ink'><span className='font-mono text-xs text-brand'>{a.materialNumber}</span> {a.materialName}</span>
                                                <span className='block text-xs text-muted'>{a.taskName} · {a.warehouseCode} · reserved {a.qty} {a.uom}</span>
                                            </span>
                                        </label>
                                        {on && <div className='mt-2 max-w-[12rem]'><Field id={`siv-q-${a.reservationId}`} label={`Quantity (${a.uom})`} type='number' inputMode='decimal' min='0' step='any' value={picked[a.reservationId]} error={bad ? `0 to ${a.qty}` : ''} onChange={(e) => setPicked((p) => ({ ...p, [a.reservationId]: e.target.value }))} /></div>}
                                    </div>
                                );
                            })}
                        </div>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <SelectField id='siv-receiver' label='Collected by' required value={receivedBy} error={tried && !receivedBy ? 'Choose who collects the materials.' : ''} onChange={(e) => setReceivedBy(e.target.value)}>
                                <option value=''>Choose</option>
                                {data.people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                            </SelectField>
                            <Field id='siv-date' label='Needed by' required type='date' min={today()} value={requiredDate} error={tried && !(requiredDate >= today()) ? 'Today or later' : ''} onChange={(e) => setRequiredDate(e.target.value)} />
                        </div>
                        <Field id='siv-note' label='Note for stores (optional)' maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        <ConfirmBox checked={confirm} onChange={setConfirm}>The materials, quantities and the person collecting them are correct. Stores cannot issue to the person who issues.</ConfirmBox>
                        {tried && problems.length > 0 && <Alert tone='warn'>{problems[0]}</Alert>}
                        {failure && <Alert tone='error'>{failure}</Alert>}
                        <div className='flex gap-2'>
                            <Button busy={busy} onClick={() => void raise()}>Raise stores issue voucher</Button>
                            <Button variant='secondary' onClick={() => { setRaising(false); setTried(false); setFailure(''); }}>Cancel</Button>
                        </div>
                    </div>
                )}
            </StepSection>
            {data.vouchers.map((v) => (
                <button key={v.id} type='button' onClick={() => setOpenId(v.id)} className='flex w-full items-start gap-3 rounded-2xl border border-line bg-panel p-3 text-left active:bg-page'>
                    <PackageCheck className='mt-0.5 h-5 w-5 shrink-0 text-brand' />
                    <span className='min-w-0 flex-1'>
                        <span className='flex flex-wrap items-center gap-2'><span className='font-mono text-sm font-semibold text-ink'>{v.number}</span><Badge tone={tone(v.status)}>{v.statusLabel}</Badge></span>
                        <span className='block text-xs text-muted'>{v.items} line(s) from {v.warehouseCode} · collected by {v.receivedByName} · needed {v.requiredDate}{v.outstanding > 0 && v.status !== 'cancelled' ? ` · ${v.outstanding} still to issue` : ''}</span>
                    </span>
                </button>
            ))}
        </div>
    );
}

// ----- One voucher: issue (stores), cancel or short-close, print -----

export function VoucherDetail({ id, onBack }: { id: string; onBack: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Voucher>(`${API}/get`, { id }), [id]);
    const [qty, setQty] = useState<Record<number, string>>({});
    const [ack, setAck] = useState(false);
    const [note, setNote] = useState('');
    const [reason, setReason] = useState('');
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [done, setDone] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Voucher not found.'}</Alert>;
    const v = data;
    const left = (l: VoucherLine) => Math.max(0, Math.round((l.qty - l.issuedQty) * 10000) / 10000);
    const value = (l: VoucherLine) => qty[l.no] ?? String(left(l));
    const given = v.lines.filter((l) => left(l) > 0).map((l) => ({ l, q: Number(value(l)) })).filter((x) => x.q > 0);
    const bad = v.lines.filter((l) => left(l) > 0 && (Number.isNaN(Number(value(l))) || Number(value(l)) < 0 || Number(value(l)) > left(l) + 1e-9));
    const problems = [...(given.length ? [] : ['Enter the quantity issued on at least one line.']), ...bad.map((l) => `Line ${l.no}: 0 to ${left(l)} ${l.uom}.`), ...(ack ? [] : ['Confirm the physical hand-over.'])];
    const issue = async () => {
        setTried(true);
        setFailure('');
        if (problems.length) return;
        setBusy(true);
        try {
            const r = await callBackend<{ status: string; goodsIssues: string[] }>(`${API}/issue`, { id, expectedVersion: v.version, acknowledge: true, note, lines: given.map((x) => ({ no: x.l.no, qty: x.q })) });
            setDone(`${r.status === 'issued' ? 'Issued in full' : 'Issued in part'}: ${r.goodsIssues.join(', ')}.`);
            setQty({}); setAck(false); setTried(false); setNote('');
            reload();
        } catch (e) {
            setFailure(msg(e));
        } finally {
            setBusy(false);
        }
    };
    const stop = async (mode: 'cancel' | 'close') => {
        setFailure('');
        if (reason.trim().length < 10) return setFailure('Give a reason of at least 10 characters.');
        setBusy(true);
        try {
            await callBackend(`${API}/cancel`, { id, reason: reason.trim(), mode });
            setDone(mode === 'close' ? 'Voucher short-closed.' : 'Voucher cancelled.');
            setReason('');
            reload();
        } catch (e) {
            setFailure(msg(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className='space-y-3'>
            <div className='sticky top-0 z-10 flex items-center gap-2 rounded-2xl border border-line bg-panel/95 p-3 backdrop-blur'>
                <button type='button' aria-label='Back' onClick={onBack} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-page'>←</button>
                <div className='min-w-0 flex-1'>
                    <p className='flex min-w-0 items-center gap-2'><span className='truncate font-mono text-sm font-semibold text-ink'>{v.number}</span><Badge tone={tone(v.status)}>{v.statusLabel}</Badge></p>
                    <p className='truncate text-xs text-muted'>{v.workOrderId} {v.workOrderTitle} · {v.warehouseCode}</p>
                </div>
                <Button variant='secondary' aria-label='Download voucher PDF' onClick={() => void voucherPdf(v).catch((e) => setFailure(msg(e)))}><Printer className='h-4 w-4' /><span className='hidden sm:inline'>Print</span></Button>
                {v.can?.issue && <Button busy={busy} onClick={() => void issue()}>Issue</Button>}
            </div>
            {done && <Alert tone='success'>{done}</Alert>}
            {failure && <Alert tone='error'>{failure}</Alert>}
            <dl className='grid gap-2 rounded-2xl border border-line bg-panel p-3 text-sm sm:grid-cols-3'>
                {([['Collected by', v.receivedByName], ['Needed by', v.requiredDate], ['Raised by', `${v.requestedByName} · ${fmtDate(v.createdAt)}`], ['Warehouse', `${v.warehouseCode} ${v.warehouseName}`], ['Note', v.note || '—']] as const).map(([k, x]) => (
                    <div key={k} className='min-w-0'><dt className='text-xs text-muted'>{k}</dt><dd className='break-words text-ink'>{x}</dd></div>
                ))}
            </dl>
            <StepSection title='Materials' hint={v.can?.issue ? 'Enter what you physically hand over now. The rest stays open on the voucher.' : undefined}>
                <div className='space-y-2'>
                    {v.lines.map((l) => (
                        <div key={l.no} className='rounded-xl border border-line bg-page p-3'>
                            <p className='text-sm text-ink'><span className='mr-1 font-mono text-xs text-brand'>{l.no}</span><span className='font-mono text-xs'>{l.materialNumber}</span> {l.materialName}</p>
                            <p className='text-xs text-muted'>{l.taskName} · requested {l.qty} · issued {l.issuedQty} {l.uom}</p>
                            {v.can?.issue && left(l) > 0 && (
                                <div className='mt-2 max-w-[12rem]'>
                                    <Field id={`siv-issue-${l.no}`} label={`Issue now (${l.uom})`} type='number' inputMode='decimal' min='0' step='any' value={value(l)} error={tried && bad.includes(l) ? `0 to ${left(l)}` : ''} onChange={(e) => setQty((q) => ({ ...q, [l.no]: e.target.value }))} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </StepSection>
            {v.can?.issue && (
                <StepSection title='Hand-over'>
                    <div className='space-y-3'>
                        <Field id='siv-issue-note' label='Note (optional)' maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                        <ConfirmBox checked={ack} onChange={setAck}>I physically handed these quantities to {v.receivedByName}. I am not the person collecting them.</ConfirmBox>
                        {tried && problems.length > 0 && <Alert tone='warn'>{problems[0]}</Alert>}
                        <Button busy={busy} onClick={() => void issue()}>Issue materials</Button>
                    </div>
                </StepSection>
            )}
            {(v.can?.cancel || v.can?.close) && (
                <StepSection title={v.can.close ? 'Short-close' : 'Cancel voucher'} hint={v.can.close ? 'The rest is no longer needed. What was issued stays posted.' : 'Nothing has been issued yet.'}>
                    <div className='space-y-2'>
                        <Field id='siv-reason' label='Reason (at least 10 characters)' maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button variant='danger' busy={busy} onClick={() => void stop(v.can?.close ? 'close' : 'cancel')}>{v.can.close ? 'Short-close voucher' : 'Cancel voucher'}</Button>
                    </div>
                </StepSection>
            )}
            {v.issues.length > 0 && (
                <StepSection title='Goods issues posted'>
                    <ul className='space-y-1 text-sm'>
                        {v.issues.map((i) => <li key={i.goodsIssueId} className='flex flex-wrap items-center gap-2'><FileText className='h-4 w-4 text-muted' /><span className='font-mono'>{i.goodsIssueId}</span><span className='text-xs text-muted'>{i.journalId ? `journal ${i.journalId}` : 'not posted (finance not live)'} · {fmtDate(i.at)} · {i.byName}</span></li>)}
                    </ul>
                </StepSection>
            )}
            <StepSection title='History'>
                <ol className='space-y-2 text-sm'>
                    {v.history.map((h, i) => <li key={i}><span className='text-ink'>{h.action}</span> <span className='text-xs text-muted'>by {h.byName} · {fmtDate(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}
                </ol>
            </StepSection>
        </div>
    );
}

// ----- Stores queue (Goods issue page) -----

const COLS: Array<Column<Voucher>> = [
    { key: 'number', label: 'Voucher', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'needed', label: 'Needed by', type: 'date', value: (r) => r.requiredDate },
    { key: 'wo', label: 'Work order', value: (r) => r.workOrderId },
    { key: 'title', label: 'Work', value: (r) => r.workOrderTitle },
    { key: 'wh', label: 'Warehouse', value: (r) => r.warehouseCode },
    { key: 'items', label: 'Lines', type: 'number', value: (r) => r.items },
    { key: 'left', label: 'To issue', type: 'number', value: (r) => r.outstanding },
    { key: 'to', label: 'Collected by', value: (r) => r.receivedByName },
    { key: 'by', label: 'Raised by', value: (r) => r.requestedByName, hidden: true },
    { key: 'created', label: 'Raised', type: 'date', value: (r) => r.createdAt.slice(0, 10), hidden: true },
];

export function VoucherQueue() {
    const [view, setView] = useState<'open' | 'all'>('open');
    const { data, error, loading } = useLoad(() => callBackend<{ rows: Voucher[]; counts: { open: number; all: number } }>(`${API}/list`, { view }), [view]);
    const [openId, setOpenId] = useState('');
    const rows = useMemo(() => data?.rows ?? [], [data]);
    if (openId) return <VoucherDetail id={openId} onBack={() => setOpenId('')} />;
    if (loading && !data) return <Spinner />;
    if (error) return <Alert tone='error'>{error}</Alert>;
    return (
        <RichTable
            id={`inv.siv.${view}`}
            tabKey='vouchers'
            title='Stores issue vouchers'
            columns={COLS}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            actions={
                <div role='radiogroup' className='inline-flex gap-1 rounded-xl border border-line p-1'>
                    {(['open', 'all'] as const).map((k) => (
                        <button key={k} type='button' role='radio' aria-checked={view === k} onClick={() => setView(k)} className={`h-9 rounded-lg px-3 text-xs font-medium ${view === k ? 'bg-brand/15 text-brand' : 'text-soft'}`}>
                            {k === 'open' ? `Waiting (${data?.counts.open ?? 0})` : `All (${data?.counts.all ?? 0})`}
                        </button>
                    ))}
                </div>
            }
            empty={view === 'open' ? 'No vouchers are waiting for stores.' : 'No stores issue vouchers yet.'}
            fileName={`stores-issue-vouchers-${view}`}
            height='h-[calc(100dvh-11rem)]'
        />
    );
}
