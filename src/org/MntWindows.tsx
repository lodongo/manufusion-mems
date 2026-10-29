import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Printer, ShieldCheck, Plus, ArrowLeft, RefreshCw } from 'lucide-react';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { workspaceNavigate as navigate } from '../lib/route';
import { MntDialog, MntField, MntRiskTable, mntApi, mntInput, type MntData } from './MntWorkOrder';
import MntGateHint from './MntGateHint';

const statusLabel = (w: MntData) => (w.model === 'equipment_v2' ? '' : 'older line window · ') + String(w.status || '').replaceAll('_', ' ');
const windowColumns: Array<Column<MntData>> = [
    {
        key: 'title',
        label: 'Window',
        value: (w) => `${w.title} ${w.id}`,
        render: (w) => (
            <span className="block min-w-[10rem]">
                <span className="block font-semibold text-ink">{w.title}</span>
                <span className="block font-mono text-xs text-muted">{w.id}</span>
            </span>
        ),
    },
    { key: 'equipment', label: 'Equipment', value: (w) => (w.equipmentCode ? `${w.equipmentCode} ${w.equipmentName}` : w.lineName) },
    { key: 'start', label: 'Start', type: 'date', value: (w) => w.start, render: (w) => new Date(w.start).toLocaleString() },
    { key: 'duration', label: 'Duration (h)', type: 'number', value: (w) => w.durationHours ?? (Date.parse(w.end) - Date.parse(w.start)) / 3600000 },
    { key: 'end', label: 'End', type: 'date', value: (w) => w.end, render: (w) => new Date(w.end).toLocaleString(), hidden: true },
    { key: 'orders', label: 'Work orders', value: (w) => (w.workOrderIds || []).join(', ') },
    { key: 'status', label: 'Status', value: (w) => statusLabel(w) },
    { key: 'progress', label: 'Progress %', type: 'number', value: (w) => w.progress || 0 },
    { key: 'planner', label: 'Planner', value: (w) => w.plannedByName, hidden: true },
];

function RiskReport({ report, onClose }: { report: MntData; onClose: () => void }) {
    const w = report.window,
        snapshot = report.approvedSnapshot,
        approved = snapshot?.fingerprint === report.fingerprint;
    const equipment = approved ? snapshot.equipment : report.equipment,
        orders = approved ? snapshot.workOrders : report.workOrders;
    const lookup = (kind: string, code: string) => report.safetyCatalogue?.[kind]?.find((x: MntData) => x.code === code)?.label || code;
    return (
        <MntDialog title="Consolidated Maintenance Risk Assessment" onClose={onClose}>
            <div className="mb-4 flex gap-2 print:hidden">
                <Button onClick={() => window.print()}>
                    <Printer size={16} />
                    Print consolidated risk assessment
                </Button>
            </div>
            <article className="mnt-print-report space-y-5 bg-white p-3 text-slate-950">
                <header className="border-b-2 border-slate-800 pb-4">
                    <p className="text-xs font-bold uppercase tracking-widest">Manufusion MEMS · Maintenance Management</p>
                    <h1 className="mt-2 text-2xl font-bold">Consolidated Maintenance Risk Assessment</h1>
                    <p className="mt-2 text-sm">
                        {w.id} · Revision {w.revision} · {approved ? 'Approved snapshot' : 'Review copy — current approvals required'}
                    </p>
                </header>
                <section>
                    <h2 className="text-lg font-semibold">{w.title}</h2>
                    <p className="text-sm">
                        Production line: {w.lineName} · Site: {w.siteId}
                    </p>
                    <p className="text-sm">
                        {new Date(w.start).toLocaleString()} → {new Date(w.end).toLocaleString()}
                    </p>
                </section>
                <section className="space-y-4">
                    <h2 className="text-lg font-bold">A. Equipment-level safety and isolation</h2>
                    {equipment.map((e: MntData) => (
                        <section key={e.equipmentId} className="space-y-3 break-inside-avoid">
                            <h3 className="font-semibold">
                                {e.name} · {e.equipmentId}
                            </h3>
                            {!(e.storedEnergy.items || []).length && (
                                <p className="text-sm">
                                    Equipment assessment recorded with no stored-energy sources. Review equipment-specific controls and task
                                    isolation requirements below.
                                </p>
                            )}
                            {(e.storedEnergy.items || []).map((source: MntData, i: number) => (
                                <div key={i} className="space-y-2">
                                    <p className="font-semibold">
                                        Energy: {lookup('hazardousEnergy', source.energyCode)}
                                        {source.utilityCode ? ' · Utility ' + source.utilityCode : ''}
                                    </p>
                                    {source.notes && <p className="text-sm">{source.notes}</p>}
                                    {(source.hazards || []).map((hazard: MntData, j: number) => (
                                        <div key={j} className="text-sm">
                                            <p className="font-semibold">{lookup('hazards', hazard.code)}</p>
                                            {(hazard.impacts || []).map((impact: MntData, k: number) => (
                                                <div key={k} className="mb-2 grid gap-1 rounded border border-slate-300 p-2">
                                                    <p>Consequence: {lookup('impacts', impact.code)}</p>
                                                    <p>
                                                        Initial risk: {impact.initialRisk?.score ?? '—'} · {impact.initialRisk?.band || ''}
                                                    </p>
                                                    <p>
                                                        Controls:{' '}
                                                        {(impact.controls || [])
                                                            .map((c: string) => lookup('controlMeasures', c))
                                                            .join('; ')}
                                                    </p>
                                                    <p>
                                                        Residual risk: {impact.residualRisk?.score ?? '—'} ·{' '}
                                                        {impact.residualRisk?.band || ''}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </section>
                    ))}
                </section>
                <section className="space-y-4">
                    <h2 className="text-lg font-bold">B. Selected maintenance task assessments</h2>
                    {orders.map((wo: MntData) => (
                        <section key={wo.code} className="space-y-4">
                            <h3 className="font-bold">
                                {wo.code} · {wo.title}
                            </h3>
                            {wo.assetTag && (
                                <p className="text-sm">
                                    Asset: {wo.assetTag} · {wo.unitName}
                                </p>
                            )}
                            {(wo.tasks || []).map((t: MntData) => (
                                <section key={t.id} className="space-y-2">
                                    <h4 className="font-semibold">{t.title || t.description}</h4>
                                    <p className="text-sm">
                                        Equipment: {t.equipmentId} · Assembly: {t.assemblyId}
                                    </p>
                                    <p className="text-sm">Isolation / LOTO: {t.isolation || 'See task permits and equipment controls'}</p>
                                    <p className="text-sm">Safety equipment: {t.safetyEquipment || 'See task controls'}</p>
                                    <MntRiskTable risks={t.risk || []} />
                                </section>
                            ))}
                        </section>
                    ))}
                </section>
                <section className="space-y-2">
                    <h2 className="text-lg font-bold">C. Mandatory execution prerequisites</h2>
                    {(w.safetySteps || []).map((s: MntData) => (
                        <p key={s.id} className="text-sm">
                            {s.instruction} · {s.completedAt ? 'Verified ' + s.completedAt : 'Verify before physical work'}
                        </p>
                    ))}
                </section>
                <footer className="grid grid-cols-2 gap-4 border-t-2 border-slate-800 pt-3 text-sm">
                    {['engineering', 'safety'].map((g) => (
                        <div key={g}>
                            <p className="font-bold capitalize">{g} approval</p>
                            <p>{w[g]?.name || 'Pending'}</p>
                            <p>{w[g]?.at ? new Date(w[g].at).toLocaleString() : ''}</p>
                            <p>{w[g]?.note}</p>
                        </div>
                    ))}
                </footer>
            </article>
        </MntDialog>
    );
}

function Gantt({ schedule, start, onMove }: { schedule: MntData; start: string; onMove: (id: string, offset: number) => void }) {
    const scale = Math.max(1, Number(schedule.duration) || 1),
        groups = [...new Set((schedule.tasks || []).map((t: MntData) => t.woCode))] as string[];
    return (
        <div className="overflow-x-auto rounded-xl border border-line">
            <div className="min-w-[720px]">
                <div className="grid grid-cols-[240px_1fr] border-b border-line bg-panel p-3 text-xs text-soft">
                    <p>Work order / task</p>
                    <div className="flex justify-between">
                        {Array.from({ length: 5 }, (_, i) => (
                            <span key={i}>{((scale * i) / 4).toFixed(1)} h</span>
                        ))}
                    </div>
                </div>
                {groups.map((wo) => (
                    <section key={wo}>
                        <h3 className="border-b border-line bg-brand/5 px-3 py-2 text-sm font-semibold">{wo}</h3>
                        {(schedule.tasks || [])
                            .filter((t: MntData) => t.woCode === wo)
                            .map((t: MntData) => (
                                <div key={t.id} className="grid grid-cols-[240px_1fr] items-center gap-2 border-b border-line px-3 py-3">
                                    <div>
                                        <p className="truncate text-sm font-medium">{t.description}</p>
                                        <p className="text-xs text-muted">
                                            {t.start.toFixed(1)}–{t.finish.toFixed(1)} h · Float {t.float.toFixed(1)} h
                                        </p>
                                    </div>
                                    <div
                                        className="relative h-9 rounded bg-panel"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            const id = e.dataTransfer.getData('text/plain');
                                            if (id) {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                onMove(id, Math.max(0, Math.round(((e.clientX - rect.left) / rect.width) * scale * 4) / 4));
                                            }
                                        }}
                                    >
                                        <button
                                            draggable
                                            onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                                            title={`${t.description}: ${t.critical ? 'Critical path' : 'Parallel / float available'}. Drag to reschedule.`}
                                            className={`absolute top-0 h-11 min-w-5 cursor-grab truncate rounded px-2 text-left text-xs text-white text-onbrand ${t.critical ? 'bg-red-600' : 'bg-emerald-600'}`}
                                            style={{
                                                left: (100 * t.start) / scale + '%',
                                                width: Math.max(2, (100 * t.hours) / scale) + '%',
                                            }}
                                        >
                                            {t.hours} h
                                        </button>
                                    </div>
                                </div>
                            ))}
                    </section>
                ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2 p-3 text-xs text-soft">
                <span>
                    <span className="mr-1 inline-block h-2 w-2 bg-red-600" />
                    Critical path <span className="ml-3 mr-1 inline-block h-2 w-2 bg-emerald-600" />
                    Parallel / float
                </span>
                <span>
                    Expected duration: {scale.toFixed(2)} h
                    {start ? ' · Finish ' + new Date(Date.parse(start) + scale * 3600000).toLocaleString() : ''}
                </span>
            </div>
        </div>
    );
}

interface Draft {
    windowId?: string;
    title: string;
    equipmentId: string;
    date: string;
    startTime: string;
    durationHours: number;
    workOrderIds: string[];
    reason: string;
    timeZone: string;
}
const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const today = () => new Date().toISOString().slice(0, 10);

// Maintenance windows: one piece of equipment on one date (start date, start time, duration; the end follows). The
// planner fills a window with ready work orders of that equipment (readiness confirmed, cost approved). No separate
// approval. Before physical work starts, the isolation and permit prerequisites are verified by the people doing it.
export default function MntWindows() {
    const { data, error, loading, reload } = useLoad(() => mntApi({ action: 'workspace' }));
    const [draft, setDraft] = useState<Draft | null>(null),
        [selected, setSelected] = useState<MntData | null>(null),
        [preview, setPreview] = useState<MntData | null>(null),
        [previewError, setPreviewError] = useState(''),
        [failure, setFailure] = useState(''),
        [busy, setBusy] = useState(false),
        [dialog, setDialog] = useState(''),
        [note, setNote] = useState(''),
        [report, setReport] = useState<MntData | null>(null);
    const request = useRef(0);
    const valid = !!draft && !!draft.equipmentId && !!draft.date && /^\d{2}:\d{2}$/.test(draft.startTime) && draft.durationHours >= 0.25 && draft.workOrderIds.length > 0;
    useEffect(() => {
        const seq = ++request.current;
        if (!draft || !valid) {
            setPreview(null);
            setPreviewError('');
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const r = await mntApi({ action: 'preview_window', ...draft });
                if (seq === request.current) {
                    setPreview(r);
                    setPreviewError('');
                }
            } catch (e) {
                if (seq === request.current) {
                    setPreview(null);
                    setPreviewError(e instanceof Error ? e.message : 'The window is not valid.');
                }
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [draft, valid]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone="error">{error || 'Maintenance windows unavailable.'}</Alert>;
    const orders: MntData[] = data.orders,
        windows: MntData[] = data.windows;
    const patch = (next: Partial<Draft>) => setDraft((old) => (old ? { ...old, ...next } : old));
    const available = (d: Draft) => orders.filter((o) => o.status === 'released' || (d.windowId && o.windowId === d.windowId && ['scheduled'].includes(o.status)));
    const equipmentOptions = (d: Draft) => {
        const seen = new Map<string, string>();
        for (const o of available(d)) if (o.unitId) seen.set(o.unitId, `${o.unitCode} · ${o.unitName}`);
        return [...seen.entries()];
    };
    const action = async (kind: string, body: MntData = {}) => {
        setBusy(true);
        setFailure('');
        try {
            const r = await mntApi({ action: kind, windowId: selected?.id, ...body });
            if (kind === 'window_report') setReport(r);
            else {
                reload();
                if (r.windowId) {
                    setDraft(null);
                    setSelected(null);
                } else if (selected) {
                    const fresh = await mntApi({ action: 'workspace' });
                    setSelected(fresh.windows.find((w: MntData) => w.id === selected.id) || null);
                }
            }
            setDialog('');
            setNote('');
            return true;
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Unable to update the maintenance window.');
            return false;
        } finally {
            setBusy(false);
        }
    };
    const edit = (w?: MntData) => {
        setSelected(null);
        setFailure('');
        setPreviewError('');
        setDraft(
            w
                ? { windowId: w.id, title: w.title, equipmentId: w.equipmentId, date: w.date, startTime: w.startTime, durationHours: Number(w.durationHours) || 1, workOrderIds: w.workOrderIds || [], reason: '', timeZone: w.timeZone || ZONE }
                : { title: '', equipmentId: '', date: today(), startTime: '07:00', durationHours: 8, workOrderIds: [], reason: '', timeZone: ZONE },
        );
    };
    const needed = Number(preview?.neededHours || 0);
    return (
        <div className="space-y-4 text-ink">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button className="mb-2 flex min-h-11 items-center gap-2 text-sm text-soft" onClick={() => navigate('organization_admin/mnt')}>
                        <ArrowLeft size={16} />
                        Maintenance workspace
                    </button>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <CalendarClock />
                        Maintenance windows
                    </h1>
                    <p className="mt-1 text-sm text-soft">One piece of equipment, one date: start time and duration. Fill it with ready work orders.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" aria-label="Refresh windows" onClick={reload}>
                        <RefreshCw size={16} />
                    </Button>
                    <Button onClick={() => edit()}>
                        <Plus size={16} />
                        New window
                    </Button>
                </div>
            </div>
            {failure && <MntGateHint message={failure} />}
            {draft ? (
                <Card className="space-y-4">
                    <h2 className="font-semibold">{draft.windowId ? 'Change maintenance window' : 'New maintenance window'}</h2>
                    <label className="block text-sm text-soft">
                        Equipment *
                        <select data-native-select="true" className={mntInput} value={draft.equipmentId} disabled={!!draft.windowId} onChange={(e) => patch({ equipmentId: e.target.value, workOrderIds: [] })}>
                            <option value="">Choose the equipment…</option>
                            {equipmentOptions(draft).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                            {draft.windowId && !equipmentOptions(draft).some(([id]) => id === draft.equipmentId) && <option value={draft.equipmentId}>{draft.equipmentId}</option>}
                        </select>
                    </label>
                    {!equipmentOptions(draft).length && <Alert tone="info">No work order is ready yet. Confirm readiness on a work order (Plan: spares, services, people, dates, risk review and cost approval) first.</Alert>}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <MntField label="Date *" type="date" value={draft.date} onChange={(v) => patch({ date: v })} />
                        <MntField label="Start time *" type="time" value={draft.startTime} onChange={(v) => patch({ startTime: v })} />
                        <MntField label="Duration (hours) *" type="number" value={draft.durationHours} onChange={(v) => patch({ durationHours: Number(v) })} />
                    </div>
                    <p className="text-xs text-soft">
                        {preview?.end ? `Ends ${new Date(preview.end).toLocaleString()}` : 'The end time follows from the start and the duration.'} · Time zone {draft.timeZone}
                    </p>
                    <MntField label="Name (optional)" value={draft.title} onChange={(v) => patch({ title: v })} />
                    {draft.equipmentId && (
                        <section className="space-y-2">
                            <p className="text-sm font-semibold">Ready work orders on this equipment</p>
                            {available(draft).filter((o) => o.unitId === draft.equipmentId).map((o) => {
                                const on = draft.workOrderIds.includes(o.code);
                                const hours = (o.tasks || []).reduce((n: number, t: MntData) => n + (Number(t.hours) || 0), 0);
                                return (
                                    <label key={o.code} className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 ${on ? 'border-brand bg-brand/5' : 'border-line'}`}>
                                        <input type="checkbox" className="h-5 w-5" checked={on} onChange={(e) => patch({ workOrderIds: e.target.checked ? [...draft.workOrderIds, o.code] : draft.workOrderIds.filter((x) => x !== o.code) })} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{o.code} · {o.title}</span>
                                            <span className="block text-xs text-soft">{(o.tasks || []).length} task(s) · {hours} h of work · planned {o.scheduledStart || '—'} to {o.scheduledEnd || '—'}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </section>
                    )}
                    {valid && preview && (
                        <div className="space-y-1">
                            <div className="h-3 overflow-hidden rounded-full bg-panel" aria-label="Window filled">
                                <div className={`h-full ${needed > draft.durationHours ? 'bg-red-600' : 'bg-emerald-600'}`} style={{ width: Math.min(100, (100 * needed) / Math.max(draft.durationHours, 0.25)) + '%' }} />
                            </div>
                            <p className={`text-xs ${needed > draft.durationHours ? 'text-danger' : 'text-soft'}`}>
                                The work needs {needed.toFixed(2)} h of the {draft.durationHours} h window{needed > draft.durationHours ? ': lengthen the window or remove a work order.' : '.'}
                            </p>
                            <Gantt schedule={preview.schedule} start={preview.start} onMove={() => {}} />
                        </div>
                    )}
                    {previewError && <Alert tone="error">{previewError}</Alert>}
                    {draft.windowId && <MntField label="Reason for the change *" value={draft.reason} multiline onChange={(v) => patch({ reason: v })} />}
                    <div className="flex gap-2">
                        <Button
                            busy={busy}
                            disabled={!valid || !preview || needed > draft.durationHours || (preview.schedule?.conflicts?.length ?? 0) > 0 || (!!draft.windowId && draft.reason.trim().length < 10)}
                            onClick={() => action('save_window', draft)}
                        >
                            {draft.windowId ? 'Save changes' : 'Schedule window'}
                        </Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>
                            Cancel
                        </Button>
                    </div>
                </Card>
            ) : selected ? (
                <div className="space-y-4">
                    <button className="min-h-11 text-sm underline" onClick={() => setSelected(null)}>
                        ← All maintenance windows
                    </button>
                    <Card className="space-y-3">
                        <div>
                            <p className="font-mono text-xs text-muted">
                                {selected.id} · Revision {selected.revision}
                            </p>
                            <h2 className="text-xl font-semibold">{selected.title}</h2>
                            <p className="mt-1 text-sm text-soft">
                                {selected.equipmentCode ? `${selected.equipmentCode} · ${selected.equipmentName}` : selected.lineName} · {new Date(selected.start).toLocaleString()} → {new Date(selected.end).toLocaleString()}
                                {selected.durationHours ? ` · ${selected.durationHours} h` : ''} · {selected.timeZone}
                            </p>
                            <p className="mt-1 text-sm capitalize">
                                {statusLabel(selected)} · {selected.progress || 0}% of tasks completed · planned by {selected.plannedByName}
                            </p>
                        </div>
                        {selected.model !== 'equipment_v2' && ['draft', 'awaiting_approval'].includes(selected.status) && (
                            <Alert tone="info">This older production-line window was never authorized. Create an equipment window for its work orders; this one is then replaced.</Alert>
                        )}
                        <Gantt schedule={selected.liveSchedule || selected.schedule} start={selected.start} onMove={() => {}} />
                        <div className="flex flex-wrap gap-2">
                            {selected.model === 'equipment_v2' && ['scheduled', 'draft'].includes(selected.status) && (
                                <Button variant="secondary" onClick={() => edit(selected)}>
                                    Change window
                                </Button>
                            )}
                            <Button variant="secondary" onClick={() => action('window_report')}>
                                <Printer size={16} />
                                Print consolidated risk assessment
                            </Button>
                        </div>
                    </Card>
                    <Card className="space-y-3">
                        <h2 className="flex items-center gap-2 font-semibold">
                            <ShieldCheck size={18} />
                            Safety prerequisites before work starts
                        </h2>
                        {(selected.safetySteps || []).map((s: MntData) => (
                            <div key={s.id} className="space-y-2 rounded-xl border border-line p-3">
                                <p className="whitespace-pre-wrap text-sm">{s.instruction}</p>
                                <p className="text-xs text-soft">{s.completedAt ? 'Verified ' + new Date(s.completedAt).toLocaleString() : 'To verify'}</p>
                                {!s.completedAt && ['authorized', 'scheduled', 'in_progress'].includes(selected.status) && (
                                    <Button variant="secondary" onClick={() => setDialog('safety_prerequisite:' + s.id)}>
                                        Record verification
                                    </Button>
                                )}
                            </div>
                        ))}
                        {!selected.safetySteps?.length && <p className="text-sm text-soft">No isolation or permit prerequisites were identified for this window.</p>}
                    </Card>
                    <Card>
                        <h2 className="mb-3 font-semibold">Work orders</h2>
                        <div className="flex flex-wrap gap-2">
                            {selected.workOrderIds.map((id: string) => (
                                <button key={id} className="min-h-11 rounded-xl border border-line px-4 text-sm underline" onClick={() => navigate('organization_admin/work_orders/' + id)}>
                                    {id}
                                </button>
                            ))}
                        </div>
                    </Card>
                </div>
            ) : (
                <RichTable
                    id="mnt-windows"
                    title="Maintenance windows"
                    fileName="maintenance_windows"
                    columns={windowColumns}
                    rows={windows}
                    rowKey={(w) => w.id}
                    onRowClick={(w) => setSelected(w)}
                    empty="No maintenance windows yet. Confirm readiness on a work order, then schedule a window."
                />
            )}
            {dialog && (
                <MntDialog title="Record safety verification" onClose={() => setDialog('')}>
                    <div className="space-y-4">
                        <MntField label="Evidence (what was checked, by whom)" value={note} multiline onChange={setNote} />
                        <Button busy={busy} disabled={note.trim().length < 5} onClick={() => action('safety_prerequisite', { note, stepId: dialog.split(':')[1] })}>
                            Confirm
                        </Button>
                        {failure && <MntGateHint message={failure} />}
                    </div>
                </MntDialog>
            )}
            {report && <RiskReport report={report} onClose={() => setReport(null)} />}
        </div>
    );
}
