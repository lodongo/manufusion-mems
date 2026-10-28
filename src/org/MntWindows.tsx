import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Printer, ShieldCheck, Plus, ArrowLeft, RefreshCw } from 'lucide-react';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Card, Spinner, useLoad } from '../admin/kit';
import { workspaceNavigate as navigate } from '../lib/route';
import { MntCheck, MntDialog, MntField, MntRiskTable, mntApi, mntInput, type MntData } from './MntWorkOrder';
import MntGateHint from './MntGateHint';

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
    { key: 'line', label: 'Production line', value: (w) => w.lineName },
    { key: 'start', label: 'Planned start', type: 'date', value: (w) => w.start, render: (w) => new Date(w.start).toLocaleString() },
    { key: 'status', label: 'Status', value: (w) => String(w.status || '').replaceAll('_', ' ') },
    {
        key: 'approvals',
        label: 'Approvals',
        value: (w) => `${w.engineering ? 'Engineering approved' : 'Engineering pending'} · ${w.safety ? 'Safety approved' : 'Safety pending'}`,
        render: (w) => (
            <span className="block whitespace-nowrap">
                {w.engineering ? 'Engineering ✓' : 'Engineering pending'}
                <br />
                {w.safety ? 'Safety ✓' : 'Safety pending'}
            </span>
        ),
    },
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

const localInput = (value: string) => {
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
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

function ProductionLineMapping({ onSaved }: { onSaved: () => void }) {
    const { data, error, loading } = useLoad(() => mntApi({ action: 'line_options' }));
    const [equipmentId, setEquipmentId] = useState(''),
        [lineId, setLineId] = useState(''),
        [note, setNote] = useState(''),
        [failure, setFailure] = useState(''),
        [busy, setBusy] = useState(false);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone="error">{error || 'Line mapping unavailable.'}</Alert>;
    const equipment = data.nodes.find((n: MntData) => n.id === equipmentId),
        current = data.mappings.find((m: MntData) => m.equipmentId === equipmentId);
    const save = async () => {
        setBusy(true);
        setFailure('');
        try {
            await mntApi({ action: 'map_line', equipmentId, lineId, note });
            onSaved();
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Unable to save line association.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="space-y-4">
            <p className="text-sm text-soft">
                Associate equipment with its production line using the existing organization hierarchy. Select the line equipment unit or
                the cost center designated for that line. All equipment in one maintenance window must have the same association.
            </p>
            <label className="block text-sm">
                Equipment
                <select
                    className={mntInput}
                    data-native-select="true"
                    value={equipmentId}
                    onChange={(e) => {
                        setEquipmentId(e.target.value);
                        setLineId('');
                    }}
                >
                    <option value="">Choose equipment</option>
                    {data.nodes
                        .filter((n: MntData) => ['work_center', 'equipment'].includes(n.level))
                        .map((n: MntData) => (
                            <option key={n.id} value={n.id}>
                                {n.code} · {n.name}
                            </option>
                        ))}
                </select>
            </label>
            {equipment && (
                <>
                    <p className="text-sm text-soft">
                        Current production line:{' '}
                        {data.nodes.find((n: MntData) => n.id === (current?.lineId || equipmentId))?.name || 'Not configured'}
                    </p>
                    <label className="block text-sm">
                        Production line in the same site
                        <select className={mntInput} data-native-select="true" value={lineId} onChange={(e) => setLineId(e.target.value)}>
                            <option value="">Choose production line</option>
                            {data.nodes
                                .filter((n: MntData) => n.siteId === equipment.siteId)
                                .map((n: MntData) => (
                                    <option key={n.id} value={n.id}>
                                        {n.code} · {n.name}
                                    </option>
                                ))}
                        </select>
                    </label>
                </>
            )}
            <MntField label="Reason for the production-line association" value={note} multiline onChange={setNote} />
            {!data.canEdit && (
                <Alert tone="info">
                    Maintenance administration or Organization design authority is required to change these associations.
                </Alert>
            )}
            {failure && <MntGateHint message={failure} />}
            <Button busy={busy} disabled={!data.canEdit || !equipmentId || !lineId || note.trim().length < 10} onClick={save}>
                Save line association
            </Button>
        </div>
    );
}

export default function MntWindows() {
    const { data, error, loading, reload } = useLoad(() => mntApi({ action: 'workspace' }));
    const [draft, setDraft] = useState<MntData | null>(null),
        [selected, setSelected] = useState<MntData | null>(null),
        [schedule, setSchedule] = useState<MntData | null>(null),
        [previewError, setPreviewError] = useState(''),
        [failure, setFailure] = useState(''),
        [busy, setBusy] = useState(false),
        [dialog, setDialog] = useState(''),
        [note, setNote] = useState(''),
        [report, setReport] = useState<MntData | null>(null);
    const request = useRef(0);
    useEffect(() => {
        const seq = ++request.current;
        if (!draft?.tasks?.length) {
            setSchedule(null);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const r = await mntApi({ action: 'preview_window', ...draft });
                if (seq === request.current) {
                    setSchedule(r.schedule);
                    setPreviewError('');
                }
            } catch (e) {
                if (seq === request.current) {
                    setPreviewError(e instanceof Error ? e.message : 'Schedule is invalid.');
                    setSchedule(null);
                }
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [draft]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone="error">{error || 'Maintenance windows unavailable.'}</Alert>;
    const orders: MntData[] = data.orders,
        windows: MntData[] = data.windows;
    const patch = (k: string, v: any) => setDraft((old) => ({ ...old, [k]: v }));
    const updateTask = (id: string, key: string, value: any) =>
        patch(
            'tasks',
            draft!.tasks.map((t: MntData) => (t.id === id ? { ...t, [key]: value } : t)),
        );
    const action = async (kind: string, body: MntData = {}) => {
        setBusy(true);
        setFailure('');
        try {
            const r = await mntApi({ action: kind, windowId: selected?.id, ...body });
            if (kind === 'window_report') {
                setReport(r);
            } else {
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
        setPreviewError('');
        setDraft(
            w
                ? {
                      windowId: w.id,
                      title: w.title,
                      start: localInput(w.start),
                      end: localInput(w.end),
                      rangeType: w.rangeType,
                      workOrderIds: w.workOrderIds,
                      tasks: w.tasks,
                      safetyDurations: w.safetyDurations || {},
                      safetyOffsets: w.safetyOffsets || {},
                      reason: '',
                  }
                : { title: '', start: '', end: '', rangeType: 'custom', workOrderIds: [], tasks: [] },
        );
    };
    const chosen = orders.filter((w) => draft?.workOrderIds.includes(w.code));
    const chooseOrder = (wo: MntData, checked: boolean) => {
        const ids = checked ? [...draft!.workOrderIds, wo.code] : draft!.workOrderIds.filter((id: string) => id !== wo.code);
        const additions = checked
            ? (wo.tasks || []).map((t: MntData) => ({
                  id: wo.code + '_' + t.id,
                  woCode: wo.code,
                  taskId: t.id,
                  description: t.title || t.description,
                  hours: t.hours,
                  offset: 0,
                  dependencies: (t.dependencies || []).map((id: string) => wo.code + '_' + id),
                  exclusiveTools: [],
              }))
            : [];
        setDraft({ ...draft, workOrderIds: ids, tasks: [...draft!.tasks.filter((t: MntData) => t.woCode !== wo.code), ...additions] });
    };
    return (
        <div className="space-y-5 text-ink">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <button className="mb-2 flex gap-2 text-sm text-soft" onClick={() => navigate('organization_admin/mnt')}>
                        <ArrowLeft size={16} />
                        Maintenance workspace
                    </button>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <CalendarClock />
                        Maintenance windows
                    </h1>
                    <p className="mt-1 text-sm text-soft">Plan one production line, secure resources, approve and execute.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setDialog('line_mapping')}>
                        Production line mapping
                    </Button>
                    <Button variant="secondary" aria-label="Refresh windows" onClick={reload}>
                        <RefreshCw size={16} />
                    </Button>
                    <Button onClick={() => edit()}>
                        <Plus size={16} />
                        New maintenance window
                    </Button>
                </div>
            </div>
            {failure && <MntGateHint message={failure} />}
            {draft ? (
                <Card className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <MntField label="Maintenance window name" value={draft.title} onChange={(v) => patch('title', v)} />
                        <label className="text-sm text-soft">
                            Planning range
                            <select
                                data-native-select="true"
                                className={mntInput}
                                value={draft.rangeType}
                                onChange={(e) => {
                                    const type = e.target.value,
                                        hours = ({ hours: 4, shift: 8, day: 24, week: 168 } as Record<string, number>)[type];
                                    setDraft({
                                        ...draft,
                                        rangeType: type,
                                        ...(hours && draft.start
                                            ? { end: localInput(new Date(Date.parse(draft.start) + hours * 3600000).toISOString()) }
                                            : {}),
                                    });
                                }}
                            >
                                {['hours', 'shift', 'day', 'week', 'custom'].map((v) => (
                                    <option key={v} value={v}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <MntField label="Planned start" type="datetime-local" value={draft.start} onChange={(v) => patch('start', v)} />
                        <MntField label="Planned completion" type="datetime-local" value={draft.end} onChange={(v) => patch('end', v)} />
                    </div>
                    <fieldset className="space-y-2">
                        <legend className="mb-2 font-semibold">Select work orders from one production line</legend>
                        {orders
                            .filter((w) => ['plan_ready', 'released', 'scheduled', 'in_progress'].includes(w.status))
                            .map((wo) => (
                                <MntCheck
                                    key={wo.code}
                                    label={`${wo.code} · ${wo.title} · ${wo.line.name || 'Line mapping required'}`}
                                    value={draft.workOrderIds.includes(wo.code)}
                                    onChange={(v) => chooseOrder(wo, v)}
                                />
                            ))}
                        {!orders.some((w) => ['plan_ready', 'released', 'scheduled', 'in_progress'].includes(w.status)) && (
                            <p className="text-sm text-soft">Submit a task-assessed work order plan to make it available here.</p>
                        )}
                    </fieldset>
                    <section className="space-y-3">
                        <h2 className="font-semibold">Individual task schedule</h2>
                        {chosen.map((wo) => (
                            <section key={wo.code} className="space-y-3">
                                <h3 className="text-sm font-semibold text-muted">
                                    {wo.code} · {wo.title}
                                </h3>
                                {(wo.tasks || []).map((t: MntData) => {
                                    const id = wo.code + '_' + t.id,
                                        s = draft.tasks.find((s: MntData) => s.id === id);
                                    return (
                                        <div key={id} className="space-y-3 rounded-xl border border-line p-3">
                                            <MntCheck
                                                label={t.title || t.description}
                                                value={!!s}
                                                onChange={(v) =>
                                                    patch(
                                                        'tasks',
                                                        v
                                                            ? [
                                                                  ...draft.tasks,
                                                                  {
                                                                      id,
                                                                      woCode: wo.code,
                                                                      taskId: t.id,
                                                                      description: t.title || t.description,
                                                                      hours: t.hours,
                                                                      offset: 0,
                                                                      dependencies: (t.dependencies || []).map(
                                                                          (d: string) => wo.code + '_' + d,
                                                                      ),
                                                                      exclusiveTools: [],
                                                                  },
                                                              ]
                                                            : draft.tasks.filter((s: MntData) => s.id !== id),
                                                    )
                                                }
                                            />
                                            {s && (
                                                <>
                                                    <div className="grid gap-3 sm:grid-cols-3">
                                                        <MntField
                                                            label="Execution priority (1 highest)"
                                                            type="number"
                                                            value={s.executionPriority ?? 50}
                                                            onChange={(v) => updateTask(id, 'executionPriority', Number(v))}
                                                        />
                                                        <MntField
                                                            label="Duration (hours)"
                                                            type="number"
                                                            value={s.hours}
                                                            onChange={(v) => updateTask(id, 'hours', Number(v))}
                                                        />
                                                        <MntField
                                                            label="Earliest start offset (hours)"
                                                            type="number"
                                                            value={s.offset}
                                                            onChange={(v) => updateTask(id, 'offset', Number(v))}
                                                        />
                                                        <MntField
                                                            label="Exclusive tools / equipment (comma separated)"
                                                            value={(s.exclusiveTools || []).join(', ')}
                                                            onChange={(v) =>
                                                                updateTask(
                                                                    id,
                                                                    'exclusiveTools',
                                                                    v
                                                                        .split(',')
                                                                        .map((x) => x.trim())
                                                                        .filter(Boolean),
                                                                )
                                                            }
                                                        />
                                                    </div>
                                                    <details>
                                                        <summary className="cursor-pointer text-sm font-semibold">
                                                            Predecessor tasks
                                                        </summary>
                                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                            {draft.tasks
                                                                .filter((p: MntData) => p.id !== id)
                                                                .map((p: MntData) => (
                                                                    <MntCheck
                                                                        key={p.id}
                                                                        label={p.woCode + ' · ' + p.description}
                                                                        value={s.dependencies?.includes(p.id) || false}
                                                                        onChange={(v) =>
                                                                            updateTask(
                                                                                id,
                                                                                'dependencies',
                                                                                v
                                                                                    ? [...(s.dependencies || []), p.id]
                                                                                    : (s.dependencies || []).filter(
                                                                                          (d: string) => d !== p.id,
                                                                                      ),
                                                                            )
                                                                        }
                                                                    />
                                                                ))}
                                                        </div>
                                                    </details>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </section>
                        ))}
                    </section>
                    {previewError && <Alert tone="error">{previewError}</Alert>}
                    {schedule && (
                        <>
                            <h2 className="font-semibold">Gantt schedule and critical path</h2>
                            <p className="text-xs text-soft">
                                Drag a bar to change its earliest start. Duration and offset fields provide keyboard and mobile controls.
                                Dependencies recalculate automatically.
                            </p>
                            <Gantt
                                schedule={schedule}
                                start={draft.start}
                                onMove={(id, offset) =>
                                    id.startsWith('SAFE_')
                                        ? patch('safetyOffsets', { ...draft.safetyOffsets, [id.slice(5)]: offset })
                                        : updateTask(id, 'offset', offset)
                                }
                            />
                            <details>
                                <summary className="cursor-pointer text-sm font-semibold">Safety prerequisite durations</summary>
                                <div className="mt-3 space-y-3">
                                    {schedule.tasks
                                        .filter((t: MntData) => t.safety)
                                        .map((t: MntData) => (
                                            <MntField
                                                key={t.id}
                                                label={t.description + ' (hours)'}
                                                type="number"
                                                value={draft.safetyDurations?.[t.taskId] ?? 0.25}
                                                onChange={(v) =>
                                                    patch('safetyDurations', { ...draft.safetyDurations, [t.taskId]: Number(v) })
                                                }
                                            />
                                        ))}
                                </div>
                            </details>
                            {schedule.conflicts?.length > 0 && <Alert tone="error">{schedule.conflicts.join(' ')}</Alert>}
                        </>
                    )}
                    {draft.windowId && (
                        <MntField
                            label="Reason for schedule or scope revision (existing approvals will be invalidated)"
                            value={draft.reason}
                            multiline
                            onChange={(v) => patch('reason', v)}
                        />
                    )}
                    <div className="flex gap-2">
                        <Button
                            busy={busy}
                            disabled={
                                !schedule ||
                                !!previewError ||
                                schedule.conflicts?.length > 0 ||
                                (draft.title || '').trim().length < 3 ||
                                !draft.start ||
                                !draft.end
                            }
                            onClick={() => action('save_window', draft)}
                        >
                            Save maintenance window
                        </Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>
                            Cancel
                        </Button>
                    </div>
                </Card>
            ) : selected ? (
                <div className="space-y-4">
                    <button className="text-sm underline" onClick={() => setSelected(null)}>
                        ← All maintenance windows
                    </button>
                    <Card className="space-y-4">
                        <div>
                            <p className="font-mono text-xs text-muted">
                                {selected.id} · Revision {selected.revision}
                            </p>
                            <h2 className="text-xl font-semibold">{selected.title}</h2>
                            <p className="mt-1 text-sm text-soft">
                                {selected.lineName} · Week {selected.isoWeek}/{selected.isoWeekYear} · {selected.timeZone} ·{' '}
                                {new Date(selected.start).toLocaleString()} → {new Date(selected.end).toLocaleString()}
                            </p>
                            <p className="mt-1 text-sm capitalize">
                                {selected.status.replaceAll('_', ' ')} · {selected.progress || 0}% of selected tasks completed
                            </p>
                        </div>
                        <Gantt schedule={selected.liveSchedule || selected.schedule} start={selected.start} onMove={() => {}} />
                        <div className="grid gap-3 sm:grid-cols-2">
                            {['engineering', 'safety'].map((g) => (
                                <div className="rounded-xl border border-line p-3" key={g}>
                                    <p className="font-semibold capitalize">{g} approval</p>
                                    <p className="mt-1 text-sm text-soft">
                                        {selected[g] ? selected[g].name + ' · ' + new Date(selected[g].at).toLocaleString() : 'Pending'}
                                    </p>
                                </div>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {!['in_progress', 'completed'].includes(selected.status) && (
                                <Button variant="secondary" onClick={() => edit(selected)}>
                                    Revise scope / schedule
                                </Button>
                            )}
                            {['draft', 'awaiting_approval'].includes(selected.status) && (
                                <>
                                    <Button variant="secondary" onClick={() => setDialog('approve_engineering')}>
                                        Engineering approval
                                    </Button>
                                    <Button variant="secondary" onClick={() => setDialog('approve_safety')}>
                                        Safety approval
                                    </Button>
                                    <Button variant="secondary" onClick={() => setDialog('reject_window')}>
                                        Return for revision
                                    </Button>
                                    <Button onClick={() => action('authorize_window')}>Authorize maintenance execution</Button>
                                </>
                            )}
                            <Button variant="secondary" onClick={() => action('window_report')}>
                                <Printer size={16} />
                                Print Consolidated Risk Assessment
                            </Button>
                        </div>
                    </Card>
                    <Card className="space-y-3">
                        <h2 className="flex items-center gap-2 font-semibold">
                            <ShieldCheck size={18} />
                            Mandatory safety prerequisites
                        </h2>
                        {(selected.safetySteps || []).map((s: MntData) => (
                            <div key={s.id} className="space-y-2 rounded-xl border border-line p-3">
                                <p className="whitespace-pre-wrap text-sm">{s.instruction}</p>
                                <p className="text-xs text-soft">
                                    {s.completedAt ? 'Verified ' + new Date(s.completedAt).toLocaleString() : 'Pending safety verification'}
                                </p>
                                {!s.completedAt && ['authorized', 'in_progress'].includes(selected.status) && (
                                    <Button variant="secondary" onClick={() => setDialog('safety_prerequisite:' + s.id)}>
                                        Record safety verification
                                    </Button>
                                )}
                            </div>
                        ))}
                        {!selected.safetySteps?.length && (
                            <p className="text-sm text-soft">
                                No additional isolation prerequisites were identified by the equipment and selected-task assessments.
                            </p>
                        )}
                    </Card>
                    <Card>
                        <h2 className="mb-3 font-semibold">Work orders</h2>
                        <div className="flex flex-wrap gap-2">
                            {selected.workOrderIds.map((id: string) => (
                                <button
                                    key={id}
                                    className="rounded-xl border border-line px-4 py-3 text-sm underline"
                                    onClick={() => navigate('organization_admin/work_orders/' + id)}
                                >
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
                    empty="No maintenance windows yet. Start with an assessed work-order plan."
                />
            )}
            {dialog === 'line_mapping' && (
                <MntDialog title="Production line mapping" onClose={() => setDialog('')}>
                    <ProductionLineMapping
                        onSaved={() => {
                            setDialog('');
                            reload();
                        }}
                    />
                </MntDialog>
            )}
            {dialog && dialog !== 'line_mapping' && (
                <MntDialog title={dialog.split(':')[0].replaceAll('_', ' ')} onClose={() => setDialog('')}>
                    <div className="space-y-4">
                        {dialog === 'reject_window' && (
                            <p className="text-sm text-soft">This returns the window for revision and clears its approvals.</p>
                        )}
                        <MntField label="Review notes / evidence" value={note} multiline onChange={setNote} />
                        <Button
                            busy={busy}
                            onClick={() => action(dialog.split(':')[0], { note, stepId: dialog.split(':')[1], gate: 'engineering' })}
                        >
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
