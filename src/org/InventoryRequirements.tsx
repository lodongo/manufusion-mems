import { useState } from 'react';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, useConfirm } from '../components/screen';

// Inventory > Requirements: every purchase requirement for warehouse stock is reviewed by the stores before
// procurement processes it. Automatic (Replenishment/MRP) and maintenance reservation requirements are released or
// cancelled; those raised by people are released or returned. The stock position guides the decision.

const API = '/api/org/inventory/requirements';
const BASE = 'organization_home/inventory_requirements';

interface Row {
    id: string;
    number: string;
    title: string;
    source: 'automation' | 'maintenance' | 'people';
    sourceLabel: string;
    status: string;
    statusLabel: string;
    queue: 'review' | 'released' | 'closed';
    materialNumber: string;
    material: string;
    warehouse: string;
    quantity: number;
    unit: string;
    lines: number;
    dateRequired: string;
    requester: string;
    createdAt: string;
    releasedBy: string;
    releasedAt: string;
    verdict: string;
    woCode: string;
}
interface Entry {
    stage: string;
    stageLabel: string;
    id: string;
    ref: string;
    status: string;
    qty: number;
    ordered: number;
    received: number;
    date: string;
    note: string;
}
interface Need {
    workOrderId: string;
    taskId: string;
    required: number;
    reserved: number;
    shortage: number;
    plannedDate: string;
    woStatus: string;
    title: string;
}
interface Position {
    lineNo: number;
    materialNumber: string;
    materialName: string;
    warehouseCode: string;
    unit: string;
    requested: number;
    dateRequired: string;
    stock: { physical: number; available: number; reserved: number };
    reservations: Need[];
    shortage: number;
    shortageWithinLead: number;
    pipeline: { qty: number; entries: Entry[] };
    byStage: Record<string, number>;
    lead: { internalDays: number; externalDays: number; totalDays: number; source: string; arrival: string; lateForNeed: boolean };
    strategy: { code: string; name: string; automated: boolean; source: string };
    levels: { minimum: number | null; maximum: number | null; reorderPoint: number | null; reorderQuantity: number | null; safetyStock: number | null; source: string; why: string };
    criticality: { class: string; cell: string };
    projected: number;
    verdict: { action: 'release' | 'reduce' | 'cancel' | 'review'; suggested: number; need: number; reasons: string[] };
    regeneration: string;
    guidance: string[];
}
interface Detail extends Row {
    positions: Position[];
    history: Array<{ at: string; byName: string; action: string; note: string }>;
    can: { release: boolean; changeQty: boolean; cancel: boolean; returnToRequester: boolean };
    note: string;
}

const VERDICT: Record<string, { tone: 'brand' | 'warn' | 'danger'; label: string }> = {
    release: { tone: 'brand', label: 'Release: still needed' },
    reduce: { tone: 'warn', label: 'Reduce: only part is needed' },
    cancel: { tone: 'danger', label: 'Not needed: already covered' },
    review: { tone: 'warn', label: 'Review: no levels to work it out' },
};
const SRC_TONE: Record<string, 'brand' | 'warn'> = { automation: 'warn', maintenance: 'brand', people: 'brand' };

const COLS: Array<Column<Row>> = [
    { key: 'number', label: 'Requirement', value: (r) => r.number, render: (r) => <span className='font-semibold text-ink'>{r.number}</span> },
    { key: 'material', label: 'Material', value: (r) => `${r.materialNumber} ${r.material}`, render: (r) => <span>{r.materialNumber} {r.material}{r.lines > 1 ? ` +${r.lines - 1}` : ''}</span> },
    { key: 'quantity', label: 'Quantity', type: 'number', value: (r) => r.quantity, render: (r) => `${r.quantity} ${r.unit}` },
    { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
    { key: 'source', label: 'Source', value: (r) => r.sourceLabel, render: (r) => <Badge tone={SRC_TONE[r.source]}>{r.sourceLabel}</Badge> },
    { key: 'dateRequired', label: 'Needed by', type: 'date', value: (r) => r.dateRequired },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel },
    { key: 'woCode', label: 'Work order', value: (r) => r.woCode, hidden: true },
    { key: 'requester', label: 'Requester', value: (r) => r.requester, hidden: true },
    { key: 'releasedBy', label: 'Released by', value: (r) => r.releasedBy, hidden: true },
    { key: 'releasedAt', label: 'Released', type: 'date', value: (r) => r.releasedAt.slice(0, 10), hidden: true },
    { key: 'createdAt', label: 'Raised', type: 'date', value: (r) => r.createdAt.slice(0, 10), hidden: true },
];

function Tile({ k, v, tone = 'text-ink' }: { k: string; v: string | number; tone?: string }) {
    return (
        <div className='rounded-xl border border-line p-2'>
            <p className='text-[11px] text-muted'>{k}</p>
            <p className={`text-base font-semibold ${tone}`}>{v}</p>
        </div>
    );
}

function PositionCard({ p }: { p: Position }) {
    const v = VERDICT[p.verdict.action];
    const n = (x: number | null) => (x === null ? '-' : String(x));
    return (
        <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
            <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                    <p className='truncate text-sm font-semibold text-ink'>
                        Line {p.lineNo} · {p.materialNumber} {p.materialName}
                    </p>
                    <p className='text-xs text-muted'>
                        {p.warehouseCode} · requested {p.requested} {p.unit} · needed {p.dateRequired || '-'}
                    </p>
                </div>
                <Badge tone={v.tone}>{v.label}</Badge>
            </div>
            <ul className='space-y-1 text-xs text-ink'>
                {p.verdict.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                ))}
                {p.verdict.action === 'reduce' && <li className='text-amber-300'>• Suggested: {p.verdict.suggested} {p.unit}</li>}
            </ul>
            <div className='grid grid-cols-3 gap-2'>
                <Tile k='Physical' v={p.stock.physical} />
                <Tile k='Available' v={p.stock.available} />
                <Tile k='Reserved (maint.)' v={p.stock.reserved} />
                <Tile k='Short on WOs' v={p.shortage} tone={p.shortage > 0 ? 'text-amber-300' : 'text-ink'} />
                <Tile k='In the pipeline' v={p.pipeline.qty} />
                <Tile k='Projected' v={p.projected} tone={p.projected <= (p.levels.minimum ?? 0) ? 'text-amber-300' : 'text-emerald-400'} />
            </div>
            <p className='text-[11px] text-muted'>
                Projected = available − short on work orders + pipeline. Pipeline by stage:{' '}
                {Object.entries(p.byStage).map(([s, q]) => `${s} ${q}`).join(', ') || 'nothing'}.
            </p>
            <div className='space-y-1 rounded-xl border border-line p-2 text-xs'>
                <p className='text-ink'>
                    Lead time {p.lead.totalDays} days (internal {p.lead.internalDays} + supplier {p.lead.externalDays}; {p.lead.source}). If released today it arrives about {p.lead.arrival}.
                </p>
                {p.lead.lateForNeed && <p className='text-red-400'>That is after the date needed ({p.dateRequired}): expedite, or agree a later date.</p>}
                <p className='text-muted'>
                    Strategy {p.strategy.code} {p.strategy.name} ({p.strategy.automated ? 'automatic' : 'not automatic'}, {p.strategy.source === 'criticality' ? 'set by the criticality analysis' : 'set by hand'}) · min {n(p.levels.minimum)} · max {n(p.levels.maximum)} · ROP {n(p.levels.reorderPoint)} · safety {n(p.levels.safetyStock)} · levels {p.levels.source === 'forecast' ? 'from the forecast' : 'manual'} · criticality {p.criticality.cell || p.criticality.class || 'not assessed'}
                </p>
            </div>
            {p.regeneration && (
                <Alert tone='warn'>
                    <span className='block'>{p.regeneration}</span>
                </Alert>
            )}
            {p.guidance.length > 0 && (
                <ul className='space-y-1 text-xs text-sky-300'>
                    {p.guidance.map((g, i) => (
                        <li key={i}>→ {g}</li>
                    ))}
                </ul>
            )}
            <div className='space-y-1'>
                <h3 className='text-xs font-semibold text-muted'>Already in the pipeline (counted once, at its furthest stage)</h3>
                {!p.pipeline.entries.length ? (
                    <p className='text-xs text-muted'>Nothing else is requested, quoted, on a requisition or on order.</p>
                ) : (
                    <div className='max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-line'>
                        <table className='w-full text-xs'>
                            <thead className='sticky top-0 bg-panel text-muted'>
                                <tr>
                                    <th className='p-2 text-left'>Stage</th>
                                    <th className='p-2 text-left'>Ref</th>
                                    <th className='p-2 text-right'>Open</th>
                                    <th className='p-2 text-left'>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {p.pipeline.entries.map((e, i) => (
                                    <tr key={i} className='border-t border-line text-ink'>
                                        <td className='p-2'>{e.stageLabel}</td>
                                        <td className='p-2'>
                                            {e.ref}
                                            <span className='block text-[10px] text-muted'>
                                                {e.status}
                                                {e.note ? ` · ${e.note}` : ''}
                                            </span>
                                        </td>
                                        <td className='p-2 text-right'>{e.qty}</td>
                                        <td className='p-2'>{e.date || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <div className='space-y-1'>
                <h3 className='text-xs font-semibold text-muted'>Maintenance reservations</h3>
                {!p.reservations.length ? (
                    <p className='text-xs text-muted'>No open work order reserves this material here.</p>
                ) : (
                    <div className='max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-line'>
                        <table className='w-full text-xs'>
                            <thead className='sticky top-0 bg-panel text-muted'>
                                <tr>
                                    <th className='p-2 text-left'>Work order</th>
                                    <th className='p-2 text-right'>Reserved</th>
                                    <th className='p-2 text-right'>Short</th>
                                    <th className='p-2 text-left'>Planned</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...p.reservations].sort((a, b) => (a.plannedDate || '9').localeCompare(b.plannedDate || '9')).map((r, i) => (
                                    <tr key={i} className='border-t border-line text-ink'>
                                        <td className='p-2'>
                                            {r.workOrderId}
                                            <span className='block text-[10px] text-muted'>{r.title || r.taskId}</span>
                                        </td>
                                        <td className='p-2 text-right'>
                                            {r.reserved}/{r.required}
                                        </td>
                                        <td className={`p-2 text-right ${r.shortage > 0 ? 'text-amber-300' : ''}`}>{r.shortage}</td>
                                        <td className={`p-2 ${r.plannedDate && r.plannedDate < p.lead.arrival && r.shortage > 0 ? 'text-red-400' : ''}`}>{r.plannedDate || 'Not planned'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}

function Decide({ d, onDone }: { d: Detail; onDone: (m: string) => void }) {
    const [mode, setMode] = useState<'' | 'release' | 'cancel' | 'return'>('');
    const p0 = d.positions[0];
    const [qty, setQty] = useState(String(p0?.requested ?? ''));
    const [reason, setReason] = useState('');
    const [override, setOverride] = useState('');
    const [note, setNote] = useState('');
    const [reviewed, setReviewed] = useState(false);
    const [understood, setUnderstood] = useState(false);
    const confirm = useConfirm();
    const q = Number(qty);
    const over = d.positions.some((p) => p.verdict.action === 'cancel' || (p.lineNo === p0?.lineNo ? q : p.requested) > p.verdict.suggested + 1e-9);
    const changed = d.can.changeQty && q !== p0?.requested;
    const regen = d.positions.find((p) => p.regeneration);
    const missingRelease = [!reviewed ? 'Confirm the review' : '', !(q > 0) ? 'A quantity' : '', changed && reason.trim().length < 10 ? 'The reason for the new quantity (10+ characters)' : '', over && override.trim().length < 20 ? 'The reason to release beyond what the position shows (20+ characters)' : ''].filter(Boolean);
    if (!d.can.release && !d.can.cancel && !d.can.returnToRequester) return null;
    return (
        <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <p className='text-xs text-muted'>{d.note}</p>
            {!mode && (
                <div className='flex flex-wrap gap-2'>
                    {d.can.release && (
                        <Button onClick={() => setMode('release')}>
                            <Check className='mr-1 h-4 w-4' /> Release to procurement
                        </Button>
                    )}
                    {d.can.cancel && (
                        <Button variant='danger' onClick={() => setMode('cancel')}>
                            <X className='mr-1 h-4 w-4' /> Cancel
                        </Button>
                    )}
                    {d.can.returnToRequester && (
                        <Button variant='secondary' onClick={() => setMode('return')}>
                            <RotateCcw className='mr-1 h-4 w-4' /> Return to requester
                        </Button>
                    )}
                </div>
            )}
            {mode === 'release' && (
                <div className='space-y-2'>
                    {d.can.changeQty ? (
                        <div className='flex items-end gap-2'>
                            <Field id='sr-q' label={`Quantity to release (${p0?.unit ?? ''}) *`} inputMode='decimal' value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} />
                            {p0 && p0.verdict.action === 'reduce' && (
                                <Button variant='secondary' onClick={() => setQty(String(p0.verdict.suggested))}>
                                    Use {p0.verdict.suggested}
                                </Button>
                            )}
                        </div>
                    ) : (
                        <p className='text-xs text-muted'>The quantity is the requester's; return it to them to change it.</p>
                    )}
                    {changed && <Field id='sr-why' label='Reason for the new quantity *' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />}
                    {over && (
                        <>
                            <Alert tone='warn'>The position shows this is {p0?.verdict.action === 'cancel' ? 'already covered' : `more than the ${p0?.verdict.suggested} still needed`}. Releasing anyway needs a reason.</Alert>
                            <Field id='sr-ovr' label='Reason to release anyway *' value={override} maxLength={400} onChange={(e) => setOverride(e.target.value)} />
                        </>
                    )}
                    <Field id='sr-note' label='Note, optional' value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
                    <Toggle checked={reviewed} onChange={setReviewed} label='I reviewed stock, reservations, the pipeline and the lead time' />
                    {missingRelease.length > 0 && <p className='text-xs text-amber-300'>Still needed: {missingRelease.join('; ')}</p>}
                    <div className='flex gap-2'>
                        <Button
                            disabled={missingRelease.length > 0}
                            onClick={() =>
                                confirm.ask({ title: `Release ${d.number}`, message: `${q} ${p0?.unit ?? ''} goes on to ${d.status === 'unverified' ? 'manager approval, then procurement' : 'procurement'}. This is recorded with the stock position.`, confirmLabel: 'Release' }, async () => {
                                    await callBackend(`${API}/release`, { id: d.id, quantity: d.can.changeQty ? q : undefined, reason, overrideReason: override, note, reviewed: true });
                                    onDone(`${d.number} released.`);
                                })
                            }
                        >
                            Release
                        </Button>
                        <Button variant='secondary' onClick={() => setMode('')}>
                            Back
                        </Button>
                    </div>
                </div>
            )}
            {mode === 'cancel' && (
                <div className='space-y-2'>
                    {regen && (
                        <Alert tone='warn'>
                            <AlertTriangle className='mr-1 inline h-4 w-4' />
                            {regen.regeneration}
                        </Alert>
                    )}
                    {regen?.guidance.map((g, i) => (
                        <p key={i} className='text-xs text-sky-300'>
                            → {g}
                        </p>
                    ))}
                    <Field id='sr-cr' label='Reason for cancelling *' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                    {regen && <Toggle checked={understood} onChange={setUnderstood} label='I understand it will be raised again unless the levels or strategy change' />}
                    <div className='flex gap-2'>
                        <Button
                            variant='danger'
                            disabled={reason.trim().length < 10 || (!!regen && !understood)}
                            onClick={() =>
                                confirm.ask({ title: `Cancel ${d.number}`, message: 'The requirement is cancelled and does not go to procurement.', confirmLabel: 'Cancel requirement', tone: 'danger' }, async () => {
                                    await callBackend(`${API}/cancel`, { id: d.id, reason, understood });
                                    onDone(`${d.number} cancelled.${regen ? ' Replenishment will raise it again unless the levels or strategy change.' : ''}`);
                                })
                            }
                        >
                            Cancel requirement
                        </Button>
                        <Button variant='secondary' onClick={() => setMode('')}>
                            Back
                        </Button>
                    </div>
                </div>
            )}
            {mode === 'return' && (
                <div className='space-y-2'>
                    <Field id='sr-rr' label='Reason, for the requester (20+ characters) *' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
                    <div className='flex gap-2'>
                        <Button
                            disabled={reason.trim().length < 20}
                            onClick={() =>
                                confirm.ask({ title: `Return ${d.number}`, message: 'The requirement goes back to the requester with your reason.', confirmLabel: 'Return' }, async () => {
                                    await callBackend(`${API}/return`, { id: d.id, reason });
                                    onDone(`${d.number} returned to the requester.`);
                                })
                            }
                        >
                            Return
                        </Button>
                        <Button variant='secondary' onClick={() => setMode('')}>
                            Back
                        </Button>
                    </div>
                </div>
            )}
            {confirm.sheet}
        </section>
    );
}

function DetailView({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>(`${API}/position`, { id }), [id]);
    const [notice, setNotice] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Requirement not found.'}</Alert>;
    return (
        <Screen title={data.number} eyebrow={`Requirements · ${data.sourceLabel}`} subtitle={`${data.statusLabel}${data.woCode ? ` · ${data.woCode}` : ''}`} onBack={() => navigate(BASE)}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {data.queue === 'released' && <Alert tone='success'>Released by {data.releasedBy || 'the stores'}{data.releasedAt ? `, ${fmtDate(data.releasedAt)}` : ''}.</Alert>}
            {data.positions.map((p) => (
                <PositionCard key={p.lineNo} p={p} />
            ))}
            <Decide d={data} onDone={(m) => { setNotice(m); reload(); }} />
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>History</h2>
                <ul className='space-y-1 text-xs text-ink'>
                    {data.history.map((h, i) => (
                        <li key={i}>
                            {fmtDate(h.at)} · {h.byName}: {h.action}
                            {h.note ? ` (${h.note})` : ''}
                        </li>
                    ))}
                </ul>
            </section>
        </Screen>
    );
}

export default function InventoryRequirements({ id }: { id?: string }) {
    const [queue, setQueue] = useState<'review' | 'released' | 'closed'>('review');
    const { data, error, loading } = useLoad(() => callBackend<{ rows: Row[]; can: { release: boolean } }>(`${API}/list`, {}), []);
    if (id && /^REQ\d{9}$/.test(id)) return <DetailView id={id} />;
    const rows = (data?.rows ?? []).filter((r) => r.queue === queue);
    const count = (q: string) => (data?.rows ?? []).filter((r) => r.queue === q).length;
    return (
        <Screen
            title='Requirements'
            eyebrow='Inventory'
            subtitle='Stores review before procurement: stock, reservations, pipeline and lead time'
            toolbar={<Segmented label='Requirements' value={queue} onChange={setQueue} options={[{ value: 'review', label: 'To review', count: count('review') || undefined }, { value: 'released', label: 'Released', count: count('released') || undefined }, { value: 'closed', label: 'Cancelled', count: count('closed') || undefined }]} />}
            bodyFlush
        >
            {loading && !data ? <Spinner /> : error || !data ? <Alert tone='error'>{error || 'Could not load.'}</Alert> : (
                <RichTable id='inv.requirements' tabKey={queue} columns={COLS} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/${r.id}`)} empty={queue === 'review' ? 'Nothing waits for the stores.' : 'None.'} fileName={`requirements-${queue}`} height='h-full' rowClassName={(r) => (r.source === 'automation' && r.queue === 'review' ? 'bg-amber-500/5' : '')} />
            )}
        </Screen>
    );
}
