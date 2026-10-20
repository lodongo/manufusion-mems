import { useEffect, useMemo, useState } from 'react';
import { BellRing, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { callBackend } from '../lib/backend';
import RichTable, { type Column } from '../components/RichTable';
import { Alert, Field, SelectField } from '../components/ui';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import { Badge, Button, PageTitle, Spinner, useLoad } from '../admin/kit';

// Inventory › Replenishment
// The replenishment engine plans every warehouse material with an automated strategy (Min-Max, Reorder Point, EOQ, JIT,
// demand-driven, MRP-controlled, emergency, rotable, seasonal, strategic, supplier-replenished, two-bin, kanban,
// periodic review, order-up-to, forecast-driven) whenever the material, its settings or its stock change.
//   Company-owned standard buying → an UNVERIFIED purchase requirement: a planner verifies it (then the manager approves,
//   chart of authority applies) or dismisses it.
//   Consignment, VMI, customer / third-party / intercompany stock, subcontracting, loans and pools → a SIGNAL to the
//   supplier or owner: a planner acknowledges it with the call-off or notification reference.

type Hist = Array<{ at: string; byName: string; action: string; note: string }>;
type Req = {
    id: string; status: string; title: string; materialId: string; materialNumber: string; materialName: string;
    warehouseId: string; warehouseCode: string; warehouseName: string; quantity: number; unit: string; uomCode: string;
    dateRequired: string; urgency: string; budget: number | null; glCode: string; method: string; methodName: string;
    physical: number; available: number; openSupply: number; consumed: number; consumedDays: number; supplyRefs: string[]; projected: number; trigger: number | null; target: number | null;
    basis: string; leadTimeDays: number; plannedAt: string; createdAt: string; updatedAt: string; verifiedBy: string; verifiedAt: string; dismissReason: string; history: Hist;
};
type Signal = {
    id: string; status: string; signal: string; signalLabel: string; action: string; materialId: string; materialNumber: string; materialName: string;
    warehouseId: string; warehouseCode: string; warehouseName: string; quantity: number; unit: string; urgency: string; dateRequired: string;
    method: string; methodName: string; ownership: string; arrangement: string; available: number; openSupply: number; projected: number; basis: string;
    acknowledgedBy: string; acknowledgedAt: string; reference: string; createdAt: string; updatedAt: string; closeReason: string; history: Hist;
};
type Run = { id: string; at: string; outcome: string; reason: string; method: string; channel: string; materialId: string; materialNumber: string; warehouseId: string; warehouse: string; trigger: string; route: string; source: string; prId: string; available: number | null; openSupply: number | null };
type Method = { code: string; name: string; automated: boolean; explain: string };
type Data = { items: Req[]; signals: Signal[]; runs: Run[]; warehouses: Array<{ id: string; name: string }>; methods: Method[]; can: { run: boolean; verify: boolean } };
type View = 'verify' | 'signals' | 'processed' | 'runs' | 'strategies';

const STATUS: Record<string, { label: string; tone: 'brand' | 'warn' | 'muted' | 'danger' }> = {
    unverified: { label: 'Unverified', tone: 'warn' },
    pending_approval: { label: 'Verified · manager approval', tone: 'brand' },
    approved: { label: 'Approved', tone: 'brand' },
    acknowledged: { label: 'Acknowledged', tone: 'brand' },
    converted: { label: 'Converted', tone: 'muted' },
    cancelled: { label: 'Cancelled / dismissed', tone: 'muted' },
    rejected: { label: 'Rejected', tone: 'danger' },
    returned_user: { label: 'Returned to planner', tone: 'warn' },
    open: { label: 'Open', tone: 'warn' },
    closed: { label: 'Closed', tone: 'muted' },
};
const OUTCOME: Record<string, string> = {
    created: 'Purchase request raised', replanned: 'Request re-planned', unchanged: 'Still needed (no change)', cancelled: 'Request or signal closed',
    signalled: 'Signal raised', signal_updated: 'Signal re-planned', signal_closed: 'Signal closed (supply received)',
    no_need: 'Stock sufficient', not_due: 'Review not due', incomplete: 'Settings incomplete', blocked: 'Blocked', dismissed: 'Dismissed by planner',
    busy: 'Skipped (busy)', skipped: 'Skipped', failed: 'Failed', not_planned: 'Not planned',
};
const TRIGGER: Record<string, string> = { change: 'Material changed', sweep: 'Scheduled sweep', manual: 'Run on demand' };
const fmt = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 3 }));
const when = (s: string) => (s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString() : '');

export default function ReplenishmentRequests({ id }: { id?: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>('/api/org/inventory/replenishment/list', {}), []);
    const [view, setView] = useState<View>('verify');
    const [selected, setSelected] = useState<Req | null>(null);
    const [signal, setSignal] = useState<Signal | null>(null);
    const [running, setRunning] = useState(false);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (id && data) setSelected(data.items.find((r) => r.id === id) ?? null);
    }, [id, data]);
    const rows = useMemo(() => (data?.items ?? []).filter((r) => (view === 'verify' ? r.status === 'unverified' : r.status !== 'unverified')), [data, view]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load replenishment.'}</Alert>;
    const toVerify = data.items.filter((r) => r.status === 'unverified').length;
    const openSignals = data.signals.filter((s) => s.status === 'open').length;
    const strategy = (code: string, name: string) => (code ? `${code} ${name}` : '');
    const columns: Array<Column<Req>> = [
        { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='whitespace-nowrap font-mono text-xs font-semibold'>{r.id}</span> },
        { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label ?? r.status, render: (r) => <Badge tone={STATUS[r.status]?.tone ?? 'muted'}>{STATUS[r.status]?.label ?? r.status}</Badge> },
        { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.materialName}`, render: (r) => <span className='block min-w-[11rem] max-w-[18rem] whitespace-normal'><span className='font-mono text-xs'>{r.materialNumber}</span> {r.materialName}</span> },
        { key: 'warehouse', label: 'Warehouse', value: (r) => `${r.warehouseCode} ${r.warehouseName}` },
        { key: 'quantity', label: 'Quantity', type: 'number', value: (r) => r.quantity, render: (r) => <span className='whitespace-nowrap tabular-nums'>{fmt(r.quantity)} {r.unit}</span> },
        { key: 'urgency', label: 'Urgency', value: (r) => r.urgency, render: (r) => <Badge tone={r.urgency === 'high' ? 'danger' : 'warn'}>{r.urgency}</Badge> },
        { key: 'needed', label: 'Needed by', type: 'date', value: (r) => r.dateRequired },
        { key: 'strategy', label: 'Strategy', value: (r) => strategy(r.method, r.methodName) },
        { key: 'available', label: 'Available', type: 'number', value: (r) => r.available },
        { key: 'supply', label: 'Open supply', type: 'number', value: (r) => r.openSupply },
        { key: 'projected', label: 'Projected', type: 'number', value: (r) => r.projected, hidden: true },
        { key: 'budget', label: 'Indicative budget', type: 'number', value: (r) => r.budget ?? '', hidden: true },
        { key: 'planned', label: 'Last planned', type: 'date', value: (r) => r.plannedAt, render: (r) => when(r.plannedAt) },
        { key: 'basis', label: 'Basis', value: (r) => r.basis, hidden: true },
    ];
    const signalColumns: Array<Column<Signal>> = [
        { key: 'status', label: 'Status', value: (s) => STATUS[s.status]?.label ?? s.status, render: (s) => <Badge tone={STATUS[s.status]?.tone ?? 'muted'}>{STATUS[s.status]?.label ?? s.status}</Badge> },
        { key: 'signal', label: 'Signal', value: (s) => s.signalLabel, render: (s) => <span className='block min-w-[10rem] whitespace-normal'>{s.signalLabel}</span> },
        { key: 'material', label: 'Material', value: (s) => `${s.materialNumber} ${s.materialName}`, render: (s) => <span className='block min-w-[11rem] max-w-[18rem] whitespace-normal'><span className='font-mono text-xs'>{s.materialNumber}</span> {s.materialName}</span> },
        { key: 'warehouse', label: 'Warehouse', value: (s) => `${s.warehouseCode} ${s.warehouseName}` },
        { key: 'quantity', label: 'Quantity', type: 'number', value: (s) => s.quantity, render: (s) => <span className='whitespace-nowrap tabular-nums'>{fmt(s.quantity)} {s.unit}</span> },
        { key: 'urgency', label: 'Urgency', value: (s) => s.urgency, render: (s) => <Badge tone={s.urgency === 'high' ? 'danger' : 'warn'}>{s.urgency}</Badge> },
        { key: 'needed', label: 'Needed by', type: 'date', value: (s) => s.dateRequired },
        { key: 'strategy', label: 'Strategy', value: (s) => strategy(s.method, s.methodName) },
        { key: 'reference', label: 'Reference', value: (s) => s.reference },
        { key: 'updated', label: 'Updated', type: 'date', value: (s) => s.updatedAt, render: (s) => when(s.updatedAt) },
        { key: 'ownership', label: 'Ownership / arrangement', value: (s) => `${s.ownership} ${s.arrangement}`, hidden: true },
        { key: 'basis', label: 'Basis', value: (s) => s.basis, hidden: true },
    ];
    const runColumns: Array<Column<Run>> = [
        { key: 'at', label: 'When', type: 'date', value: (r) => r.at, render: (r) => <span className='whitespace-nowrap text-xs'>{when(r.at)}</span> },
        { key: 'outcome', label: 'Outcome', value: (r) => OUTCOME[r.outcome] ?? r.outcome, render: (r) => <Badge tone={['created', 'replanned', 'signalled', 'signal_updated'].includes(r.outcome) ? 'brand' : r.outcome === 'failed' ? 'danger' : ['incomplete', 'cancelled', 'blocked'].includes(r.outcome) ? 'warn' : 'muted'}>{OUTCOME[r.outcome] ?? r.outcome}</Badge> },
        { key: 'material', label: 'Material', value: (r) => r.materialNumber || r.materialId, render: (r) => <span className='font-mono text-xs'>{r.materialNumber || r.materialId}</span> },
        { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
        { key: 'strategy', label: 'Strategy', value: (r) => r.method },
        { key: 'channel', label: 'Action by', value: (r) => (r.channel === 'purchase' ? 'Purchase' : r.channel ? r.channel.replace(/_/g, ' ') : '') },
        { key: 'trigger', label: 'Trigger', value: (r) => TRIGGER[r.trigger] ?? r.trigger },
        { key: 'reason', label: 'Detail', value: (r) => r.reason, render: (r) => <span className='block min-w-[14rem] max-w-[24rem] whitespace-normal text-xs'>{r.reason}</span> },
        { key: 'prId', label: 'Request', value: (r) => r.prId, render: (r) => <span className='font-mono text-xs'>{r.prId}</span> },
        { key: 'available', label: 'Available', type: 'number', value: (r) => r.available ?? '', hidden: true },
        { key: 'supply', label: 'Open supply', type: 'number', value: (r) => r.openSupply ?? '', hidden: true },
        { key: 'route', label: 'Changed by', value: (r) => `${r.route} ${r.source}`.trim(), hidden: true },
    ];
    const methodColumns: Array<Column<Method>> = [
        { key: 'code', label: 'Code', value: (m) => m.code, render: (m) => <span className='font-mono text-xs font-semibold'>{m.code}</span> },
        { key: 'name', label: 'Strategy', value: (m) => m.name },
        { key: 'automated', label: 'Planning', value: (m) => (m.automated ? 'Automatic' : 'Not automatic'), render: (m) => <Badge tone={m.automated ? 'brand' : 'muted'}>{m.automated ? 'Automatic' : 'Not automatic'}</Badge> },
        { key: 'explain', label: 'How it works', value: (m) => m.explain, render: (m) => <span className='block min-w-[16rem] max-w-[30rem] whitespace-normal text-xs'>{m.explain}</span> },
    ];
    return (
        <div className='min-w-0 space-y-3'>
            <PageTitle
                title='Replenishment'
                subtitle='Automatic purchase requests and supplier or owner signals for warehouse materials, under every replenishment strategy'
                action={
                    <>
                        <Button variant='secondary' onClick={reload} aria-label='Refresh'>
                            <RefreshCw className='h-4 w-4' />
                        </Button>
                        {data.can.run && (
                            <Button onClick={() => setRunning(true)}>
                                <Play className='h-4 w-4' /> Run now
                            </Button>
                        )}
                    </>
                }
            />
            {notice && <Alert tone='success'>{notice}</Alert>}
            <Segmented label='View' value={view} onChange={setView} options={[
                { value: 'verify', label: 'To verify', count: toVerify },
                { value: 'signals', label: 'Signals', count: openSignals },
                { value: 'processed', label: 'Processed', count: data.items.length - toVerify },
                { value: 'runs', label: 'Run log', count: data.runs.length },
                { value: 'strategies', label: 'Strategies' },
            ]} />
            {view === 'runs' && <RichTable id='replenishment-runs' title='Replenishment run log' fileName='replenishment_run_log' columns={runColumns} rows={data.runs} rowKey={(r) => r.id} height='h-[calc(100dvh-16rem)]' empty='Replenishment has not run yet. It runs when a material with an automated strategy changes.' />}
            {view === 'signals' && <RichTable id='replenishment-signals' title='Signals to suppliers and owners' fileName='replenishment_signals' columns={signalColumns} rows={data.signals} rowKey={(s) => s.id} onRowClick={setSignal} height='h-[calc(100dvh-16rem)]' empty='No signals. Signals are raised for consignment, VMI, customer, third-party, intercompany, subcontract, loan and pool stock.' />}
            {view === 'strategies' && <RichTable id='replenishment-strategies' title='Replenishment strategies' fileName='replenishment_strategies' columns={methodColumns} rows={data.methods} rowKey={(m) => m.code} height='h-[calc(100dvh-16rem)]' />}
            {(view === 'verify' || view === 'processed') && (
                <RichTable id={`replenishment-requests-${view}`} title={view === 'verify' ? 'Purchase requests waiting for a planner' : 'Verified, dismissed or cancelled'} fileName={`replenishment_requests_${view}`} columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setSelected} height='h-[calc(100dvh-16rem)]' empty={view === 'verify' ? 'Nothing to verify. Planned materials are above their trigger levels.' : 'No processed replenishment requests yet.'} />
            )}
            <p className='flex items-start gap-2 text-xs text-muted'>
                <ShieldCheck className='h-4 w-4 shrink-0' />
                Verifying (INV.replenishment.verify) makes you the requester; your manager then approves under the chart of authority. Signals never create purchases. Every run, verification, dismissal and acknowledgement is audited.
            </p>
            {selected && <RequestSheet req={selected} canVerify={data.can.verify} onClose={() => setSelected(null)} onDone={(m) => { setSelected(null); setNotice(m); reload(); }} />}
            {signal && <SignalSheet signal={signal} canAct={data.can.verify} onClose={() => setSignal(null)} onDone={(m) => { setSignal(null); setNotice(m); reload(); }} />}
            {running && <RunSheet warehouses={data.warehouses} onClose={() => setRunning(false)} onDone={(m) => { setRunning(false); setNotice(m); setView('verify'); reload(); }} />}
        </div>
    );
}

function Numbers({ items }: { items: Array<[string, number | null | undefined]> }) {
    return (
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
            {items.filter(([, v]) => v !== null && v !== undefined).map(([label, value]) => (
                <div key={label} className='rounded-xl border border-line p-2'>
                    <p className='text-[11px] text-muted'>{label}</p>
                    <p className='font-semibold tabular-nums text-ink'>{fmt(value as number)}</p>
                </div>
            ))}
        </div>
    );
}
function History({ items }: { items: Hist }) {
    return (
        <section className='space-y-1'>
            <h3 className='text-sm font-semibold text-ink'>History</h3>
            <ul className='space-y-1'>
                {items.slice().reverse().map((h, i) => (
                    <li key={i} className='rounded-lg border border-line px-3 py-2 text-xs'>
                        <span className='font-semibold text-ink'>{h.action}</span> · {h.byName} · {when(h.at)}
                        {h.note && <span className='block text-soft'>{h.note}</span>}
                    </li>
                ))}
            </ul>
        </section>
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
                const r = await callBackend<{ approver: string }>('/api/org/inventory/replenishment/verify', { id: req.id, quantity: qty, dateRequired: date, urgency, glCode: gl, uomCode: uom, reason: reason.trim() });
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
        confirm.ask({ title: `Dismiss ${req.id}?`, message: 'The scheduled sweep will not raise it again for 7 days. Any change to the material or its stock plans it again.', confirmLabel: 'Dismiss', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (why) => {
            await callBackend('/api/org/inventory/replenishment/dismiss', { id: req.id, reason: why });
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
                <span className='text-xs text-muted'>{req.method} {req.methodName} · lead time {req.leadTimeDays} days</span>
            </div>
            <p className='text-base font-semibold text-ink'>{req.materialName}</p>
            <p className='text-sm text-soft'>{req.warehouseCode} {req.warehouseName}</p>
            <Numbers items={[['Physical', req.physical], ['Available', req.available], ['Open supply', req.openSupply], ['Projected', req.projected], ['Trigger', req.trigger], ['Target', req.target], ['Used', req.consumedDays ? req.consumed : null]]} />
            <p className='rounded-xl bg-page p-3 text-sm text-soft'>{req.basis}</p>
            {req.supplyRefs.length > 0 && <p className='text-xs text-muted'>Open supply counted: {req.supplyRefs.join(', ')}</p>}
            {req.dismissReason && <Alert tone='info'>{req.dismissReason}</Alert>}
            {open ? (
                <section className='space-y-3'>
                    <h3 className='text-sm font-semibold text-ink'>Verify</h3>
                    <Field id='rpl-qty' label={`Quantity (${req.unit || 'unit'})`} inputMode='decimal' required value={quantity} error={show('quantity')} onChange={(e) => setQuantity(e.target.value)} />
                    {changed && <Field id='rpl-reason' label='Why the quantity changes' required maxLength={300} value={reason} error={show('reason')} onChange={(e) => setReason(e.target.value)} />}
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='rpl-date' label='Needed by' type='date' min={minDate} required value={date} error={show('date')} onChange={(e) => setDate(e.target.value)} />
                        <SelectField id='rpl-urgency' label='Urgency' value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                            <option value='low'>Low</option>
                            <option value='medium'>Medium</option>
                            <option value='high'>High</option>
                        </SelectField>
                    </div>
                    {!req.uomCode && (
                        <SelectField id='rpl-uom' label='Unit of measure' required value={uom} error={show('uom')} onChange={(e) => setUom(e.target.value)}>
                            <option value=''>Choose…</option>
                            {units.map((u) => (
                                <option key={u.code} value={u.code}>{u.group} · {u.label} ({u.symbol})</option>
                            ))}
                        </SelectField>
                    )}
                    <div className='space-y-1'>
                        <Field id='rpl-gl' label={gl ? `GL account: ${gl}` : 'GL account'} required placeholder='Type to search approved accounts' value={glQuery} error={show('gl')} onChange={(e) => setGlQuery(e.target.value)} />
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
                req.status === 'unverified' && <p className='text-sm text-muted'>Verifying needs INV.replenishment.verify for this warehouse.</p>
            )}
            <History items={req.history} />
            {confirm.sheet}
        </Sheet>
    );
}

function SignalSheet({ signal, canAct, onClose, onDone }: { signal: Signal; canAct: boolean; onClose: () => void; onDone: (m: string) => void }) {
    const open = signal.status === 'open' && canAct;
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const issues = {
        reference: reference.trim().length < 2 || reference.trim().length > 80 ? 'Enter the call-off, notification or transfer reference (2 to 80 characters).' : '',
        note: note.trim().length < 10 || note.trim().length > 300 ? 'Describe what was done (10 to 300 characters).' : '',
    };
    const show = (k: keyof typeof issues) => (submitted ? issues[k] || undefined : undefined);
    const acknowledge = async () => {
        setSubmitted(true);
        setError('');
        if (Object.values(issues).some(Boolean)) return;
        setBusy(true);
        try {
            await callBackend('/api/org/inventory/replenishment/signal/acknowledge', { id: signal.id, reference: reference.trim(), note: note.trim() });
            onDone(`${signal.signalLabel} for ${signal.materialNumber} acknowledged.`);
        } catch (e) {
            setError(messageOf(e, 'Could not acknowledge the signal.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title={`${signal.signalLabel} · ${signal.materialNumber}`} onClose={onClose} footer={open ? <Button className='flex-1' onClick={() => void acknowledge()} busy={busy}><BellRing className='h-4 w-4' /> Acknowledge</Button> : undefined}>
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={STATUS[signal.status]?.tone ?? 'muted'}>{STATUS[signal.status]?.label ?? signal.status}</Badge>
                <span className='text-xs text-muted'>{signal.method} {signal.methodName} · {signal.ownership} · {signal.arrangement}</span>
            </div>
            <p className='text-base font-semibold text-ink'>{signal.materialName}</p>
            <p className='text-sm text-soft'>{signal.warehouseCode} {signal.warehouseName} · {fmt(signal.quantity)} {signal.unit} needed by {signal.dateRequired}</p>
            <Alert tone='info'>{signal.action}</Alert>
            <Numbers items={[['Available', signal.available], ['Open supply', signal.openSupply], ['Projected', signal.projected]]} />
            <p className='rounded-xl bg-page p-3 text-sm text-soft'>{signal.basis}</p>
            {signal.reference && <p className='text-sm text-soft'>Reference {signal.reference} · {signal.acknowledgedBy} · {when(signal.acknowledgedAt)}</p>}
            {signal.closeReason && <Alert tone='info'>{signal.closeReason}</Alert>}
            {open && (
                <section className='space-y-3'>
                    <h3 className='text-sm font-semibold text-ink'>Acknowledge</h3>
                    <p className='text-xs text-muted'>Record that the call-off, notification or transfer request has been made. The quantity then counts as supply on its way until stock covers the need.</p>
                    <Field id='sig-ref' label='Reference' required maxLength={80} placeholder='Call-off, e-mail or transfer number' value={reference} error={show('reference')} onChange={(e) => setReference(e.target.value)} />
                    <Field id='sig-note' label='What was done' required maxLength={300} value={note} error={show('note')} onChange={(e) => setNote(e.target.value)} />
                    {error && <Alert tone='error'>{error}</Alert>}
                </section>
            )}
            <History items={signal.history} />
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
            const r = await callBackend<{ planned: number; total: number; outcomes: Record<string, number> }>('/api/org/inventory/replenishment/run', { warehouseId });
            const parts = Object.entries(r.outcomes).map(([k, v]) => `${v} ${(OUTCOME[k] ?? k).toLowerCase()}`);
            onDone(r.total ? `Replenishment planned ${r.planned} of ${r.total} material(s): ${parts.join(', ')}.` : 'No material in this warehouse has an automated replenishment strategy.');
        } catch (e) {
            setError(messageOf(e, 'Replenishment could not run.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title='Run replenishment' onClose={onClose} footer={<Button className='flex-1' onClick={() => void run()} busy={busy} disabled={!warehouses.length}><Play className='h-4 w-4' /> Run now</Button>}>
            <p className='text-sm text-soft'>Plans every material of the warehouse that has an automated replenishment strategy, now. Replenishment also runs by itself whenever such a material, its settings or its stock change.</p>
            {warehouses.length ? (
                <SelectField id='rpl-run-wh' label='Warehouse' value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
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
