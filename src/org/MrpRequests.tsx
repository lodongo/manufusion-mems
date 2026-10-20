import { useEffect, useMemo, useState } from 'react';
import { Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert, Field, SelectField } from '../components/ui';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import { Badge, Button, PageTitle, Spinner, useLoad } from '../admin/kit';

// Inventory › MRP Replenishment Requests
// MRP plans every warehouse material with a Min/max or Reorder point policy whenever the material, its warehouse
// settings or its stock change, and raises an UNVERIFIED purchase requirement when stock is needed. A material planner
// verifies it (it then goes to the planner's manager for approval, chart of authority applies) or dismisses it.

type Req = {
    id: string; status: string; title: string; materialId: string; materialNumber: string; materialName: string;
    warehouseId: string; warehouseCode: string; warehouseName: string; quantity: number; unit: string; uomCode: string;
    dateRequired: string; urgency: string; budget: number | null; glCode: string; policy: string;
    physical: number; available: number; openSupply: number; supplyRefs: string[]; projected: number; trigger: number | null; target: number | null;
    basis: string; leadTimeDays: number; plannedAt: string; createdAt: string; updatedAt: string; verifiedBy: string; verifiedAt: string; dismissReason: string;
    history: Array<{ at: string; byName: string; action: string; note: string }>;
};
type Run = { id: string; at: string; outcome: string; reason: string; materialId: string; materialNumber: string; warehouseId: string; warehouse: string; trigger: string; route: string; source: string; prId: string; available: number | null; openSupply: number | null };
type Data = { items: Req[]; runs: Run[]; warehouses: Array<{ id: string; name: string }>; can: { run: boolean; verify: boolean } };
type View = 'unverified' | 'processed' | 'runs';

const STATUS: Record<string, { label: string; tone: 'brand' | 'warn' | 'muted' | 'danger' }> = {
    unverified: { label: 'Unverified', tone: 'warn' },
    pending_approval: { label: 'Verified · manager approval', tone: 'brand' },
    approved: { label: 'Approved', tone: 'brand' },
    acknowledged: { label: 'With procurement', tone: 'brand' },
    converted: { label: 'Converted', tone: 'muted' },
    cancelled: { label: 'Cancelled / dismissed', tone: 'muted' },
    rejected: { label: 'Rejected', tone: 'danger' },
    returned_user: { label: 'Returned to planner', tone: 'warn' },
};
const OUTCOME: Record<string, string> = {
    created: 'Request raised', replanned: 'Request re-planned', unchanged: 'Still needed (no change)', cancelled: 'Request cancelled',
    no_need: 'Stock sufficient', incomplete: 'Settings incomplete', dismissed: 'Dismissed by planner', busy: 'Skipped (busy)',
    skipped: 'Skipped', failed: 'Failed', not_planned: 'Not planned',
};
const TRIGGER: Record<string, string> = { change: 'Material changed', sweep: 'Scheduled sweep', manual: 'Run on demand' };
const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 }));
const when = (s: string) => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : '');

export default function MrpRequests({ id }: { id?: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>('/api/org/inventory/mrp/list', {}), []);
    const [view, setView] = useState<View>('unverified');
    const [selected, setSelected] = useState<Req | null>(null);
    const [running, setRunning] = useState(false);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (id && data) setSelected(data.items.find((r) => r.id === id) ?? null);
    }, [id, data]);
    const rows = useMemo(() => (data?.items ?? []).filter((r) => (view === 'unverified' ? r.status === 'unverified' : r.status !== 'unverified')), [data, view]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load MRP requests.'}</Alert>;
    const unverified = data.items.filter((r) => r.status === 'unverified').length;
    const columns: Array<Column<Req>> = [
        { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='whitespace-nowrap font-mono text-xs font-semibold'>{r.id}</span> },
        { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label ?? r.status, render: (r) => <Badge tone={STATUS[r.status]?.tone ?? 'muted'}>{STATUS[r.status]?.label ?? r.status}</Badge> },
        { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.materialName}`, render: (r) => <span className='block min-w-[11rem] max-w-[18rem] whitespace-normal'><span className='font-mono text-xs'>{r.materialNumber}</span> {r.materialName}</span> },
        { key: 'warehouse', label: 'Warehouse', value: (r) => `${r.warehouseCode} ${r.warehouseName}` },
        { key: 'quantity', label: 'Quantity', type: 'number', value: (r) => r.quantity, render: (r) => <span className='whitespace-nowrap tabular-nums'>{fmt(r.quantity)} {r.unit}</span> },
        { key: 'urgency', label: 'Urgency', value: (r) => r.urgency, render: (r) => <Badge tone={r.urgency === 'high' ? 'danger' : 'warn'}>{r.urgency}</Badge> },
        { key: 'needed', label: 'Needed by', type: 'date', value: (r) => r.dateRequired },
        { key: 'policy', label: 'Policy', value: (r) => (r.policy === 'MINMAX' ? 'Min/max' : r.policy === 'REORDER' ? 'Reorder point' : r.policy) },
        { key: 'available', label: 'Available', type: 'number', value: (r) => r.available },
        { key: 'supply', label: 'Open supply', type: 'number', value: (r) => r.openSupply },
        { key: 'projected', label: 'Projected', type: 'number', value: (r) => r.projected, hidden: true },
        { key: 'budget', label: 'Indicative budget', type: 'number', value: (r) => r.budget ?? '', hidden: true },
        { key: 'planned', label: 'Last planned', type: 'date', value: (r) => r.plannedAt, render: (r) => when(r.plannedAt) },
        { key: 'basis', label: 'Basis', value: (r) => r.basis, hidden: true },
    ];
    const runColumns: Array<Column<Run>> = [
        { key: 'at', label: 'When', type: 'date', value: (r) => r.at, render: (r) => <span className='whitespace-nowrap text-xs'>{when(r.at)}</span> },
        { key: 'outcome', label: 'Outcome', value: (r) => OUTCOME[r.outcome] ?? r.outcome, render: (r) => <Badge tone={['created', 'replanned'].includes(r.outcome) ? 'brand' : r.outcome === 'failed' ? 'danger' : ['incomplete', 'cancelled'].includes(r.outcome) ? 'warn' : 'muted'}>{OUTCOME[r.outcome] ?? r.outcome}</Badge> },
        { key: 'material', label: 'Material', value: (r) => r.materialNumber || r.materialId, render: (r) => <span className='font-mono text-xs'>{r.materialNumber || r.materialId}</span> },
        { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
        { key: 'trigger', label: 'Trigger', value: (r) => TRIGGER[r.trigger] ?? r.trigger },
        { key: 'reason', label: 'Detail', value: (r) => r.reason, render: (r) => <span className='block min-w-[14rem] max-w-[24rem] whitespace-normal text-xs'>{r.reason}</span> },
        { key: 'prId', label: 'Request', value: (r) => r.prId, render: (r) => <span className='font-mono text-xs'>{r.prId}</span> },
        { key: 'available', label: 'Available', type: 'number', value: (r) => r.available ?? '', hidden: true },
        { key: 'supply', label: 'Open supply', type: 'number', value: (r) => r.openSupply ?? '', hidden: true },
        { key: 'route', label: 'Changed by', value: (r) => `${r.route} ${r.source}`.trim(), hidden: true },
    ];
    return (
        <div className='min-w-0 space-y-3'>
            <PageTitle
                title='MRP Replenishment Requests'
                subtitle='Automatic purchase requirements for warehouse materials with a Min/max or Reorder point policy'
                action={
                    <>
                        <Button variant='secondary' onClick={reload} aria-label='Refresh'>
                            <RefreshCw className='h-4 w-4' />
                        </Button>
                        {data.can.run && (
                            <Button onClick={() => setRunning(true)}>
                                <Play className='h-4 w-4' /> Run MRP
                            </Button>
                        )}
                    </>
                }
            />
            {notice && <Alert tone='success'>{notice}</Alert>}
            <Segmented label='View' value={view} onChange={setView} options={[
                { value: 'unverified', label: 'To verify', count: unverified },
                { value: 'processed', label: 'Processed', count: data.items.length - unverified },
                { value: 'runs', label: 'MRP run log', count: data.runs.length },
            ]} />
            {view === 'runs' ? (
                <RichTable id='mrp-runs' title='MRP run log' fileName='mrp_run_log' columns={runColumns} rows={data.runs} rowKey={(r) => r.id} height='h-[calc(100dvh-16rem)]' empty='MRP has not run yet. It runs when a material with a Min/max or Reorder point policy changes.' />
            ) : (
                <RichTable id={`mrp-requests-${view}`} title={view === 'unverified' ? 'Waiting for a material planner' : 'Verified, dismissed or cancelled'} fileName={`mrp_requests_${view}`} columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setSelected} height='h-[calc(100dvh-16rem)]' empty={view === 'unverified' ? 'Nothing to verify. Stock of planned materials is above its minimum level or reorder point.' : 'No processed MRP requests yet.'} />
            )}
            <p className='flex items-start gap-2 text-xs text-muted'>
                <ShieldCheck className='h-4 w-4 shrink-0' />
                Verifying (INV.mrp.verify) makes you the requester; your manager then approves under the chart of authority. Every MRP run, verification and dismissal is audited.
            </p>
            {selected && <RequestSheet req={selected} canVerify={data.can.verify} onClose={() => setSelected(null)} onDone={(m) => { setSelected(null); setNotice(m); reload(); }} />}
            {running && <RunSheet warehouses={data.warehouses} onClose={() => setRunning(false)} onDone={(m) => { setRunning(false); setNotice(m); setView('unverified'); reload(); }} />}
        </div>
    );
}

function RequestSheet({ req, canVerify, onClose, onDone }: { req: Req; canVerify: boolean; onClose: () => void; onDone: (m: string) => void }) {
    const open = req.status === 'unverified' && canVerify;
    const [quantity, setQuantity] = useState(String(req.quantity));
    const [date, setDate] = useState(req.dateRequired);
    const [urgency, setUrgency] = useState(req.urgency || 'medium');
    const [uom, setUom] = useState(req.uomCode);
    const [gl, setGl] = useState(req.glCode);
    const [glQuery, setGlQuery] = useState('');
    const [glOptions, setGlOptions] = useState<Array<{ code: string; name: string }>>([]);
    const [units, setUnits] = useState<Array<{ code: string; label: string; symbol: string; group: string }>>([]);
    const [reason, setReason] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        if (!open || req.uomCode) return;
        callBackend<{ units: Array<{ name: string; units: Array<{ code: string; label: string; symbol: string }> }> }>('/api/org/procurement/req/options', {})
            .then((r) => setUnits(r.units.flatMap((g) => g.units.map((u) => ({ ...u, group: g.name })))))
            .catch(() => undefined);
    }, [open, req.uomCode]);
    useEffect(() => {
        if (!open || glQuery.trim().length < 2) return setGlOptions([]);
        const t = window.setTimeout(() => {
            callBackend<{ items: Array<{ code: string; name: string }> }>('/api/org/procurement/req/gl', { costCenterId: req.warehouseId, q: glQuery })
                .then((r) => setGlOptions(r.items))
                .catch(() => setGlOptions([]));
        }, 250);
        return () => window.clearTimeout(t);
    }, [glQuery, open, req.warehouseId]);
    const qty = Number(quantity.replace(/,/g, ''));
    const changed = Number.isFinite(qty) && qty !== req.quantity;
    const minDate = new Date().toISOString().slice(0, 10);
    const issues = {
        quantity: !(Number.isFinite(qty) && qty > 0) ? 'Enter a quantity greater than zero.' : '',
        date: !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < minDate ? 'Choose today or a later date.' : '',
        gl: !gl ? 'Choose the GL account.' : '',
        uom: !req.uomCode && !uom ? 'Choose the unit of measure.' : '',
        reason: changed && (reason.trim().length < 10 || reason.trim().length > 300) ? 'Say why the planned quantity changes (10 to 300 characters).' : '',
    };
    const show = (k: keyof typeof issues) => (submitted ? issues[k] || undefined : undefined);
    const verify = () => {
        setSubmitted(true);
        setError('');
        if (Object.values(issues).some(Boolean)) return;
        confirm.ask({ title: `Verify ${req.id}?`, message: `You become the requester of ${fmt(qty)} ${req.unit} of ${req.materialNumber} for ${req.warehouseCode}. It goes to your manager for approval.`, confirmLabel: 'Verify and send for approval' }, async () => {
            setBusy(true);
            try {
                const r = await callBackend<{ approver: string }>('/api/org/inventory/mrp/verify', { id: req.id, quantity: qty, dateRequired: date, urgency, glCode: gl, uomCode: uom, reason: reason.trim() });
                onDone(`${req.id} verified and sent to ${r.approver} for approval.`);
            } catch (e) {
                setError(messageOf(e, 'Could not verify the request.'));
                throw e;
            } finally {
                setBusy(false);
            }
        });
    };
    const dismiss = () =>
        confirm.ask({ title: `Dismiss ${req.id}?`, message: 'MRP will not raise it again from the scheduled sweep for 7 days. Any change to the material or its stock plans it again.', confirmLabel: 'Dismiss', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (why) => {
            await callBackend('/api/org/inventory/mrp/dismiss', { id: req.id, reason: why });
            onDone(`${req.id} dismissed.`);
        });
    return (
        <Sheet
            title={`${req.id} · ${req.materialNumber}`}
            onClose={onClose}
            footer={open ? (
                <>
                    <Button variant='secondary' className='flex-1' onClick={dismiss} disabled={busy}>Dismiss</Button>
                    <Button className='flex-1' onClick={verify} busy={busy}>Verify</Button>
                </>
            ) : undefined}
        >
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={STATUS[req.status]?.tone ?? 'muted'}>{STATUS[req.status]?.label ?? req.status}</Badge>
                <span className='text-xs text-muted'>{req.policy === 'MINMAX' ? 'Min/max' : 'Reorder point'} · lead time {req.leadTimeDays} days</span>
            </div>
            <p className='text-base font-semibold text-ink'>{req.materialName}</p>
            <p className='text-sm text-soft'>{req.warehouseCode} {req.warehouseName}</p>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {([
                    ['Physical', req.physical], ['Available', req.available], ['Open supply', req.openSupply], ['Projected', req.projected],
                    [req.policy === 'MINMAX' ? 'Minimum' : 'Reorder point', req.trigger], ['Maximum', req.target],
                ] as const).filter(([, v]) => v !== null).map(([label, value]) => (
                    <div key={label} className='rounded-xl border border-line p-2'>
                        <p className='text-[11px] text-muted'>{label}</p>
                        <p className='font-semibold tabular-nums text-ink'>{fmt(value as number)}</p>
                    </div>
                ))}
            </div>
            <p className='rounded-xl bg-page p-3 text-sm text-soft'>{req.basis}</p>
            {req.supplyRefs.length > 0 && <p className='text-xs text-muted'>Open supply counted: {req.supplyRefs.join(', ')}</p>}
            {req.dismissReason && <Alert tone='info'>{req.dismissReason}</Alert>}
            {open ? (
                <section className='space-y-3'>
                    <h3 className='text-sm font-semibold text-ink'>Verify</h3>
                    <Field id='mrp-qty' label={`Quantity (${req.unit || 'unit'})`} inputMode='decimal' required value={quantity} error={show('quantity')} onChange={(e) => setQuantity(e.target.value)} />
                    {changed && <Field id='mrp-reason' label='Why the quantity changes' required maxLength={300} value={reason} error={show('reason')} onChange={(e) => setReason(e.target.value)} />}
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='mrp-date' label='Needed by' type='date' min={minDate} required value={date} error={show('date')} onChange={(e) => setDate(e.target.value)} />
                        <SelectField id='mrp-urgency' label='Urgency' value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                            <option value='low'>Low</option>
                            <option value='medium'>Medium</option>
                            <option value='high'>High</option>
                        </SelectField>
                    </div>
                    {!req.uomCode && (
                        <SelectField id='mrp-uom' label='Unit of measure' required value={uom} error={show('uom')} onChange={(e) => setUom(e.target.value)}>
                            <option value=''>Choose…</option>
                            {units.map((u) => (
                                <option key={u.code} value={u.code}>{u.group} · {u.label} ({u.symbol})</option>
                            ))}
                        </SelectField>
                    )}
                    <div className='space-y-1'>
                        <Field id='mrp-gl' label={gl ? `GL account: ${gl}` : 'GL account'} required placeholder='Type to search approved accounts' value={glQuery} error={show('gl')} onChange={(e) => setGlQuery(e.target.value)} />
                        {glOptions.length > 0 && (
                            <ul className='max-h-48 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                                {glOptions.map((a) => (
                                    <li key={a.code}>
                                        <button type='button' onClick={() => { setGl(a.code); setGlQuery(`${a.code} ${a.name}`); setGlOptions([]); }} className='flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm active:bg-page'>
                                            <span className='font-mono text-xs text-muted'>{a.code}</span>
                                            <span className='min-w-0 flex-1 truncate text-ink'>{a.name}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {error && <Alert tone='error'>{error}</Alert>}
                </section>
            ) : (
                req.status === 'unverified' && <p className='text-sm text-muted'>Verifying needs INV.mrp.verify for this warehouse.</p>
            )}
            <section className='space-y-1'>
                <h3 className='text-sm font-semibold text-ink'>History</h3>
                <ul className='space-y-1'>
                    {req.history.slice().reverse().map((h, i) => (
                        <li key={i} className='rounded-lg border border-line px-3 py-2 text-xs'>
                            <span className='font-semibold text-ink'>{h.action}</span> · {h.byName} · {when(h.at)}
                            {h.note && <span className='block text-soft'>{h.note}</span>}
                        </li>
                    ))}
                </ul>
            </section>
            {confirm.sheet}
        </Sheet>
    );
}

function RunSheet({ warehouses, onClose, onDone }: { warehouses: Array<{ id: string; name: string }>; onClose: () => void; onDone: (m: string) => void }) {
    const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const run = async () => {
        if (!warehouseId) return setError('Choose a warehouse.');
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ planned: number; total: number; outcomes: Record<string, number> }>('/api/org/inventory/mrp/run', { warehouseId });
            const parts = Object.entries(r.outcomes).map(([k, v]) => `${v} ${(OUTCOME[k] ?? k).toLowerCase()}`);
            onDone(r.total ? `MRP planned ${r.planned} of ${r.total} material(s): ${parts.join(', ')}.` : 'No material in this warehouse has a Min/max or Reorder point policy.');
        } catch (e) {
            setError(messageOf(e, 'MRP could not run.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title='Run MRP' onClose={onClose} footer={<Button className='flex-1' onClick={() => void run()} busy={busy} disabled={!warehouses.length}><Play className='h-4 w-4' /> Run now</Button>}>
            <p className='text-sm text-soft'>Plans every material of the warehouse that has a Min/max or Reorder point policy, now. MRP also runs by itself whenever such a material, its settings or its stock change.</p>
            {warehouses.length ? (
                <SelectField id='mrp-run-wh' label='Warehouse' value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                    {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                </SelectField>
            ) : (
                <Alert tone='warn'>No warehouse is in your access.</Alert>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
        </Sheet>
    );
}
