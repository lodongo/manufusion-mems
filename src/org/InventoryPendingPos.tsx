import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, Toggle, useLoad } from '../admin/kit';
import { Screen, useConfirm } from '../components/screen';
import { FilePick } from './PoExtras';
import { type Upload } from './fileTools';

// Inventory > Pending POs: purchase orders waiting for the warehouses this person receives into (stock lines of the
// warehouse, and non-stock materials and assets of the categories the warehouse is mapped to). A mirror of receiving:
// stores receive here with inventory rights only, see no prices, and never change posting.

const API = '/api/org/inventory/receipts';
const BASE = 'organization_home/inventory_pending_pos';
const today = () => new Date().toISOString().slice(0, 10);

interface Row {
    poId: string;
    poNumber: string;
    vendorName: string;
    status: string;
    approvedAt: string;
    warehouses: string;
    lines: number;
    pendingLines: number;
    progressPct: number;
    dueDate: string;
    overdue: boolean;
    receipts: number;
}
interface Line {
    no: number;
    item: string;
    itemCode: string;
    unit: string;
    ordered: number;
    received: number;
    outstanding: number;
    dateRequired: string;
    kind: string;
    warehouseCode: string;
    materialId: string;
    materialNumber: string;
    materialName: string;
    options: Array<{ id: string; number: string; name: string }>;
    finance: string;
    costCenterCode: string;
}
interface Detail {
    poId: string;
    poNumber: string;
    vendorName: string;
    status: string;
    receivable: boolean;
    lines: Line[];
    receipts: Array<{ id: string; recNo: string; date: string; ref: string; byName: string; status: string; via: string; lines: Array<{ no: number; qty: number; reversedQty: number }> }>;
    progress: { pct: number };
}

const COLS: Array<Column<Row>> = [
    { key: 'poNumber', label: 'Order', value: (r) => r.poNumber, render: (r) => <span className='font-semibold text-ink'>{r.poNumber}</span> },
    { key: 'vendorName', label: 'Supplier', value: (r) => r.vendorName },
    { key: 'warehouses', label: 'Warehouse', value: (r) => r.warehouses },
    { key: 'pendingLines', label: 'Lines pending', type: 'number', value: (r) => r.pendingLines },
    { key: 'progressPct', label: 'Received %', type: 'number', value: (r) => r.progressPct, render: (r) => `${r.progressPct}%` },
    { key: 'dueDate', label: 'Needed by', type: 'date', value: (r) => r.dueDate, render: (r) => <span className={r.overdue ? 'text-red-400' : ''}>{r.dueDate || '-'}</span> },
    { key: 'receipts', label: 'Receipts', type: 'number', value: (r) => r.receipts, hidden: true },
    { key: 'approvedAt', label: 'Approved', type: 'date', value: (r) => r.approvedAt.slice(0, 10), hidden: true },
    { key: 'lines', label: 'Lines', type: 'number', value: (r) => r.lines, hidden: true },
];

function Receive({ d, onDone, onClose }: { d: Detail; onDone: (m: string) => void; onClose: () => void }) {
    const [ref, setRef] = useState('');
    const [date, setDate] = useState(today());
    const [note, setNote] = useState('');
    const [file, setFile] = useState<Upload | null>(null);
    const [qty, setQty] = useState<Record<number, string>>({});
    const [mat, setMat] = useState<Record<number, string>>({});
    const [problem, setProblem] = useState('');
    const confirm = useConfirm();
    const open = d.lines.filter((l) => l.outstanding > 0);
    const given = open.map((l) => ({ no: l.no, qty: Number(qty[l.no]) || 0, materialId: mat[l.no] ?? '' })).filter((g) => g.qty > 0);
    const missing = [
        ref.trim().length < 2 ? 'The delivery note number' : '',
        !date || date > today() ? 'A delivery date that is not in the future' : '',
        !file ? "The supplier's delivery note document" : '',
        !given.length ? 'A quantity for at least one line' : '',
        open.some((l) => (Number(qty[l.no]) || 0) > l.outstanding) ? 'Quantities within what is outstanding' : '',
        given.some((g) => { const l = open.find((x) => x.no === g.no)!; return l.kind === 'stock' && !l.materialId && !g.materialId; }) ? 'The warehouse material for each stock line' : '',
    ].filter(Boolean);
    return (
        <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <div className='flex items-center justify-between'>
                <h2 className='text-sm font-semibold text-ink'>Record a delivery</h2>
                <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center text-muted'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <Field id='ip-ref' label='Delivery note number *' value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} />
            <Field id='ip-date' label='Delivery date *' type='date' max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            <FilePick label='Delivery note document *' value={file} onPick={setFile} onError={setProblem} />
            {open.map((l) => (
                <div key={l.no} className='space-y-1'>
                    <Field id={`ip-q-${l.no}`} label={`Line ${l.no} · ${l.item} (outstanding ${l.outstanding} ${l.unit}) · ${l.kind === 'stock' ? `stock ${l.warehouseCode}` : l.kind === 'asset' ? 'asset' : `direct to ${l.costCenterCode}`}`} inputMode='decimal' value={qty[l.no] ?? ''} error={(Number(qty[l.no]) || 0) > l.outstanding ? `Only ${l.outstanding} is outstanding.` : ''} onChange={(e) => setQty({ ...qty, [l.no]: e.target.value.replace(/[^\d.]/g, '') })} />
                    {l.kind === 'stock' && (l.materialId ? (
                        <p className='text-xs text-muted'>Into stock as {l.materialNumber} {l.materialName}</p>
                    ) : (
                        <SelectField id={`ip-m-${l.no}`} label='Received as warehouse material *' value={mat[l.no] ?? ''} onChange={(e) => setMat({ ...mat, [l.no]: e.target.value })}>
                            <option value=''>Choose the material</option>
                            {l.options.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.number} {m.name}
                                </option>
                            ))}
                        </SelectField>
                    ))}
                </div>
            ))}
            <Field id='ip-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
            {problem && <Alert tone='error'>{problem}</Alert>}
            {missing.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missing.join('; ')}</p>}
            <Button
                disabled={missing.length > 0}
                onClick={() =>
                    confirm.ask({ title: 'Record the delivery', message: `${given.length} line(s) on delivery note ${ref.trim()}. Stock and the ledger are posted now.`, confirmLabel: 'Record delivery', acknowledge: 'The quantities were physically received and counted, and the delivery note is the supplier’s.' }, async () => {
                        const out = await callBackend<{ recNo?: string }>(`${API}/receive`, { poId: d.poId, ref, date, note, lines: given, deliveryNote: { kind: 'delivery_note', ...file } });
                        onDone(`${out.recNo ?? 'Delivery'} recorded.`);
                    })
                }
            >
                Record delivery
            </Button>
            {confirm.sheet}
        </section>
    );
}

function PoView({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>(`${API}/po`, { poId: id }), [id]);
    const [adding, setAdding] = useState(false);
    const [notice, setNotice] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Order not found.'}</Alert>;
    const pending = data.lines.some((l) => l.outstanding > 0);
    return (
        <Screen
            title={data.poNumber}
            eyebrow='Pending PO'
            subtitle={`${data.vendorName} · received ${data.progress.pct}%`}
            onBack={() => navigate(BASE)}
            actions={data.receivable && pending ? <Button aria-label='Record a delivery' onClick={() => setAdding(!adding)}>{adding ? <X className='h-4 w-4' /> : <Plus className='h-4 w-4' />}</Button> : undefined}
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {adding && <Receive d={data} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setNotice(m); reload(); }} />}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Lines for your warehouses</h2>
                <ul className='space-y-2'>
                    {data.lines.map((l) => {
                        const pct = l.ordered > 0 ? Math.min(100, Math.round((l.received / l.ordered) * 100)) : 0;
                        return (
                            <li key={l.no} className='space-y-1'>
                                <div className='flex justify-between gap-2 text-sm'>
                                    <span className='min-w-0 flex-1 truncate text-ink'>
                                        {l.no} · {l.item}
                                    </span>
                                    <span className={`shrink-0 text-xs ${l.outstanding > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>
                                        {l.received}/{l.ordered} {l.unit}
                                    </span>
                                </div>
                                <div className='h-2 overflow-hidden rounded-full bg-page'>
                                    <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className='text-[11px] text-muted'>
                                    {l.kind === 'stock' ? `Stock · ${l.warehouseCode}` : l.kind === 'asset' ? `Asset · received at ${l.warehouseCode}` : `Direct charge · received at ${l.warehouseCode}`} · needed {l.dateRequired || '-'}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            </section>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Receipts</h2>
                {!data.receipts.length && <p className='text-sm text-muted'>None yet.</p>}
                <ul className='space-y-1 text-sm'>
                    {data.receipts.map((r) => (
                        <li key={r.id} className='flex items-center justify-between gap-2 border-b border-line py-1'>
                            <span className='min-w-0 flex-1 text-ink'>
                                {r.recNo} · {r.date} · {r.ref}
                                <span className='block text-xs text-muted'>
                                    {r.byName}
                                    {r.via === 'inventory' ? ' (warehouse)' : ''} · {r.lines.map((x) => `L${x.no}: ${x.qty}${x.reversedQty ? ` (−${x.reversedQty})` : ''}`).join(' · ')}
                                </span>
                            </span>
                            <Badge tone={r.status === 'reversed' ? 'danger' : 'brand'}>{r.status === 'reversed' ? 'Reversed' : 'Posted'}</Badge>
                        </li>
                    ))}
                </ul>
            </section>
        </Screen>
    );
}

export default function InventoryPendingPos({ id }: { id?: string }) {
    const [done, setDone] = useState(false);
    const { data, error, loading } = useLoad(() => callBackend<{ rows: Row[]; warehouses: Array<{ id: string; code: string; name: string }> }>(`${API}/pending`, { includeDone: done }), [done]);
    if (id) return <PoView id={id} />;
    return (
        <Screen title='Pending POs' eyebrow='Inventory' subtitle={data ? `${data.rows.length} order(s) for ${data.warehouses.map((w) => w.code).join(', ') || 'no warehouse'}` : undefined} toolbar={<Toggle checked={done} onChange={setDone} label='Show fully received' />} bodyFlush>
            {loading && !data ? <Spinner /> : error || !data ? <Alert tone='error'>{error || 'Could not load.'}</Alert> : !data.warehouses.length ? <Alert tone='info'>You do not receive into any warehouse. Ask for the Goods Receiver role at your warehouse.</Alert> : (
                <RichTable id='inv.pending_pos' tabKey='pending' columns={COLS} rows={data.rows} rowKey={(r) => r.poId} onRowClick={(r) => navigate(`${BASE}/${r.poId}`)} empty='Nothing is waiting for your warehouses.' fileName='pending-pos' height='h-full' rowClassName={(r) => (r.overdue ? 'bg-red-500/10' : '')} />
            )}
        </Screen>
    );
}
