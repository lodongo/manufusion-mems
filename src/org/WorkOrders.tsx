import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Ban, CalendarClock, Check, CheckCircle2, ClipboardCheck, Clock, Cog, HardHat, Lock, PackagePlus, Play, Plus, RotateCcw, Search, Send, ShieldCheck, Trash2, Wrench, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { restoredTableTab } from '../lib/tableTabs';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { AssemblyPicker, GroupPicker, Info, critColor, money, type MntLists, type MntSetup, type Place } from './mntShared';
import { HistoryCard, NotEnabled, useMntSetup } from './WorkRequests';

// Maintenance (MNT): work orders. Created from a converted work request or directly (breakdown, preventive),
// numbered WO + 8 digits. Lifecycle: planning -> plan ready (tasks, people, spares, services, safety assessment)
// -> released (not by the planner) -> scheduled -> in progress (time and spares booked) -> completed -> verified
// (not by anyone who worked on it) -> closed. Every activity is its own permission, checked on the server.

interface Est {
    labourHours: number;
    labour: number;
    spares: number;
    services: number;
    total: number;
}
interface Row {
    code: string;
    title: string;
    status: string;
    statusLabel: string;
    origin: string;
    wrCode: string;
    assemblyCode: string;
    assemblyName: string;
    unitCode: string;
    unitName: string;
    costCenterCode: string;
    costCenterName: string;
    assetTag: string;
    assetName: string;
    assetClass: string;
    criticalityCode: string;
    criticalityLabel: string;
    criticalityColor: string;
    priorityLabel: string;
    maintenanceTypeLabel: string;
    workTypeLabel: string;
    disciplineLabel: string;
    plannerName: string;
    scheduledStart: string;
    scheduledEnd: string;
    assigneeNames: string[];
    estimate: Est;
    createdByName: string;
    createdAt: string;
}
interface Task {
    id?: string;
    description: string;
    disciplineCode: string;
    disciplineLabel?: string;
    resourceTypeCode: string;
    resourceTypeLabel?: string;
    persons: number;
    hours: number;
    rate: number;
}
interface Spare {
    id?: string;
    source: string;
    catalogCode: string;
    description: string;
    qty: number;
    uom: string;
    unitCost: number;
}
interface Service {
    id?: string;
    catalogCode: string;
    description: string;
    cost: number;
}
interface WoCan {
    view: boolean;
    plan: boolean;
    safety: boolean;
    submitPlan: boolean;
    release: boolean;
    schedule: boolean;
    start: boolean;
    execute: boolean;
    verify: boolean;
    close: boolean;
    cancel: boolean;
    reopen: boolean;
    highRisk: boolean;
    isPlanner: boolean;
    didWork: boolean;
}
interface Detail extends Row {
    description: string;
    failureModeLabel: string;
    tasks: Task[];
    spares: Spare[];
    services: Service[];
    tools: string;
    executionLocationCode: string;
    executionLocationLabel: string;
    downtimeHours: number;
    targetDate: string;
    plannedByName: string;
    plannedAt: string;
    safety: { riskCode: string; riskLabel: string; hazards: string[]; permits: string[]; ppe: string[]; isolation: boolean; controls: string; assessedByName: string; assessedAt: string };
    releasedByName: string;
    releasedAt: string;
    assignees: Array<{ uid: string; name: string }>;
    supervisorName: string;
    startedAt: string;
    timeLogs: Array<{ id: string; name: string; date: string; hours: number; note: string }>;
    sparesUsed: Array<{ id: string; description: string; qty: number; uom: string; unitCost: number; name: string }>;
    completion: { findings: string; rootCauseLabel: string; solutionLabel: string; outcomeLabel: string; downtimeClassLabel: string; actualDowntimeHours: number; completedByName: string; completedAt: string };
    verification: { typeLabel: string; note: string; byName: string; at: string };
    actuals: Est;
    closeNote: string;
    cancelReason: string;
    history: Array<{ at: string; name: string; action: string; note: string }>;
    currency: string;
    can: WoCan;
}

const TONE: Record<string, 'brand' | 'muted' | 'danger' | 'warn'> = { planning: 'warn', plan_ready: 'warn', released: 'brand', scheduled: 'brand', in_progress: 'brand', completed: 'warn', verified: 'brand', closed: 'muted', cancelled: 'muted' };
const STAGES: Array<[string, string[]]> = [
    ['Plan', ['planning', 'plan_ready']],
    ['Release', ['released']],
    ['Schedule', ['scheduled']],
    ['Execute', ['in_progress']],
    ['Verify', ['completed']],
    ['Close', ['verified', 'closed']],
];

export default function WorkOrders({ id, sub }: { id?: string; sub?: string }) {
    const setup = useMntSetup();
    if (setup.loading && !setup.data) return <Spinner />;
    if (setup.error || !setup.data) return <Alert tone='error'>{setup.error || 'Could not load maintenance.'}</Alert>;
    const s = setup.data;
    if (!s.enabled) return <NotEnabled />;
    if (id === 'new') return s.can.WO_create ? <NewWorkOrder key={sub ?? 'new'} setup={s} assemblyId={sub} /> : <Alert tone='error'>Your job role or security role does not include creating work orders directly.</Alert>;
    if (id && /^WO\d{8}$/.test(id)) return <OrderDetail key={id} code={id} setup={s} />;
    return <OrderList setup={s} />;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function OrderList({ setup }: { setup: MntSetup }) {
    type Tab = 'planning' | 'execution' | 'verification' | 'mine' | 'closed' | 'all';
    const [tab, setTab] = useState<Tab>(() => restoredTableTab<Tab>(['planning', 'execution', 'verification', 'mine', 'closed', 'all'], 'planning'));
    const { data, error, loading } = useLoad(() => callBackend<{ rows: Row[] }>('/api/org/mnt/wo/list', { view: tab }), [tab]);
    const cur = setup.currency;
    const columns = useMemo<Array<Column<Row>>>(
        () => [
            { key: 'code', label: 'WO number', value: (r) => r.code, className: 'font-mono whitespace-nowrap' },
            { key: 'title', label: 'Title', value: (r) => r.title },
            { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={TONE[r.status] ?? 'muted'}>{r.statusLabel}</Badge> },
            { key: 'priority', label: 'Priority', value: (r) => r.priorityLabel },
            {
                key: 'criticality',
                label: 'Criticality',
                value: (r) => r.criticalityLabel,
                render: (r) => (
                    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                        <span className='h-2.5 w-2.5 rounded-full' style={{ background: critColor(r.criticalityCode, r.criticalityColor) }} />
                        {r.criticalityLabel}
                    </span>
                ),
            },
            { key: 'asset', label: 'Asset', value: (r) => `${r.assetTag} ${r.assetName}` },
            { key: 'assembly', label: 'Assembly', value: (r) => `${r.assemblyCode} ${r.assemblyName}`, hidden: true },
            { key: 'unit', label: 'Equipment unit', value: (r) => `${r.unitCode} ${r.unitName}` },
            { key: 'cc', label: 'Cost center', value: (r) => `${r.costCenterCode} ${r.costCenterName}`, hidden: true },
            { key: 'mtype', label: 'Maintenance type', value: (r) => r.maintenanceTypeLabel },
            { key: 'wtype', label: 'Work type', value: (r) => r.workTypeLabel, hidden: true },
            { key: 'disc', label: 'Discipline', value: (r) => r.disciplineLabel, hidden: true },
            { key: 'origin', label: 'From request', value: (r) => r.wrCode || 'Direct', className: 'font-mono whitespace-nowrap' },
            { key: 'planner', label: 'Planner', value: (r) => r.plannerName, hidden: true },
            { key: 'start', label: 'Scheduled start', type: 'date', value: (r) => r.scheduledStart, render: (r) => (r.scheduledStart ? fmtDate(r.scheduledStart) : '') },
            { key: 'team', label: 'Assigned', value: (r) => r.assigneeNames.join(', '), hidden: true },
            { key: 'hours', label: 'Planned hours', type: 'number', value: (r) => r.estimate.labourHours, hidden: true },
            { key: 'est', label: `Estimate${cur ? ` (${cur})` : ''}`, type: 'number', value: (r) => r.estimate.total },
            { key: 'created', label: 'Created', type: 'date', value: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt), hidden: true },
        ],
        [cur]
    );
    const tabs: Array<[Tab, string]> = [
        ['planning', 'Planning'],
        ['execution', 'Execution'],
        ['verification', 'Verify & close'],
        ['mine', 'Mine'],
        ['closed', 'Closed'],
        ['all', 'All'],
    ];
    return (
        <div className='space-y-3'>
            <div className='flex gap-1 overflow-x-auto rounded-xl border border-slate-800 p-1'>
                {tabs.map(([k, label]) => (
                    <button key={k} type='button' onClick={() => setTab(k)} className={`h-9 shrink-0 rounded-lg px-3 text-sm ${tab === k ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                        {label}
                    </button>
                ))}
            </div>
            {error && <Alert tone='error'>{error}</Alert>}
            {loading && !data ? (
                <Spinner />
            ) : (
                <RichTable
                    id={`mnt.wo.${tab}`}
                    tabKey={tab}
                    title='Work orders'
                    fileName={`work_orders_${tab}`}
                    columns={columns}
                    rows={data?.rows ?? []}
                    rowKey={(r) => r.code}
                    onRowClick={(r) => navigate(`organization_admin/work_orders/${r.code}`)}
                    empty='No work orders here.'
                    height='h-[calc(100dvh-12rem)]'
                    actions={
                        setup.can.WO_create ? (
                            <Button onClick={() => navigate('organization_admin/work_orders/new')}>
                                <Plus className='h-4 w-4' />
                                New
                            </Button>
                        ) : undefined
                    }
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Direct work order (breakdown, preventive): where, asset, details, confirm
// ---------------------------------------------------------------------------

function NewWorkOrder({ setup, assemblyId }: { setup: MntSetup; assemblyId?: string }) {
    const lists = setup.lists!;
    const [step, setStep] = useState(0);
    const [place, setPlace] = useState<Place | null>(null);
    const [placeError, setPlaceError] = useState('');
    const [assetTag, setAssetTag] = useState('');
    const [f, setF] = useState({ title: '', description: '', maintenanceTypeCode: '', workTypeCode: '', priorityCode: '', disciplineCode: '', criticalityCode: '', failureModeCode: '' });
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

    const choose = async (id: string) => {
        setPlaceError('');
        try {
            const p = await callBackend<Place>('/api/org/mnt/assembly', { assemblyId: id, purpose: 'wo' });
            setPlace(p);
            setAssetTag(p.linkedTag && p.assets.some((a) => a.tag === p.linkedTag) ? p.linkedTag : p.assets.length === 1 ? p.assets[0].tag : '');
            setStep(1);
        } catch (err) {
            setPlaceError(err instanceof Error ? err.message : 'Could not open the assembly.');
        }
    };
    useEffect(() => {
        if (assemblyId) void choose(assemblyId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assemblyId]);

    const detailsOk = f.title.trim().length >= 5 && f.description.trim().length >= 10 && f.maintenanceTypeCode && f.workTypeCode && f.priorityCode && f.disciplineCode && f.criticalityCode;
    const canNext = [!!place, !!assetTag, !!detailsOk, confirmed][step];
    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ code: string }>('/api/org/mnt/wo/create', { assemblyId: place?.assembly.id, assetTag, ...f, confirm: confirmed });
            navigate(`organization_admin/work_orders/${res.code}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'The work order could not be created.');
            setBusy(false);
        }
    };
    const sel = (id: string, label: string, key: keyof typeof f, items: Array<{ code: string; label: string }>) => (
        <SelectField id={id} label={label} value={f[key]} onChange={(e) => set(key, e.target.value)}>
            <option value=''>Select…</option>
            {items.map((i) => (
                <option key={i.code} value={i.code}>
                    {i.label}
                </option>
            ))}
        </SelectField>
    );
    const titles = ['Where', 'Asset', 'Details', 'Confirm'];

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={() => (step === 0 ? navigate('organization_admin/work_orders') : setStep(step - 1))}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='text-xs text-slate-500'>
                            New work order · step {step + 1} of 4
                        </p>
                        <p className='truncate font-semibold text-white'>{titles[step]}</p>
                    </div>
                    {step < 3 ? (
                        <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
                            Next
                            <ArrowRight className='h-4 w-4' />
                        </Button>
                    ) : (
                        <Button busy={busy} disabled={!canNext} onClick={submit}>
                            <Check className='h-4 w-4' />
                            Create
                        </Button>
                    )}
                </div>
                <div className='flex gap-1'>
                    {titles.map((t, i) => (
                        <span key={t} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-500' : i === step ? 'bg-emerald-300' : 'bg-slate-800'}`} />
                    ))}
                </div>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {step === 0 && (
                    <>
                        {placeError && <Alert tone='error'>{placeError}</Alert>}
                        <AssemblyPicker purpose='wo' selected={place?.assembly.id} onPick={choose} />
                    </>
                )}
                {step === 1 && place && (
                    <ul className='space-y-2'>
                        {place.assets.length === 0 && <Alert tone='error'>No asset is registered here yet. Configure the equipment unit's asset first.</Alert>}
                        {place.assets.map((a) => (
                            <li key={a.tag}>
                                <button type='button' onClick={() => setAssetTag(a.tag)} className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left ${assetTag === a.tag ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-800 bg-slate-900'}`}>
                                    <Cog className='mt-0.5 h-6 w-6 shrink-0 text-amber-400' />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block font-mono text-xs text-emerald-300'>{a.tag}</span>
                                        <span className='block font-medium text-white'>{a.name}</span>
                                        <span className='block text-xs text-slate-400'>{a.className}</span>
                                    </span>
                                    {assetTag === a.tag && <CheckCircle2 className='h-6 w-6 shrink-0 text-emerald-400' />}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {step === 2 && (
                    <>
                        <Field id='wo-title' label='Short title *' maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} />
                        <TextArea id='wo-desc' label='Work to be done *' rows={4} maxLength={2000} value={f.description} onChange={(e) => set('description', e.target.value)} />
                        <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                            {lists.criticality.map((c) => {
                                const color = critColor(c.code, c.color, lists.criticality);
                                const on = f.criticalityCode === c.code;
                                return (
                                    <button key={c.code} type='button' onClick={() => set('criticalityCode', c.code)} className={`h-12 rounded-xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`} style={{ borderColor: color, background: on ? color : `${color}22` }}>
                                        {c.label}
                                    </button>
                                );
                            })}
                        </div>
                        {sel('wo-mtype', 'Maintenance type *', 'maintenanceTypeCode', lists.maintenanceTypes)}
                        {sel('wo-wtype', 'Work type *', 'workTypeCode', lists.workTypes)}
                        {sel('wo-prio', 'Priority *', 'priorityCode', lists.priorities)}
                        {sel('wo-disc', 'Discipline *', 'disciplineCode', lists.disciplines)}
                        <GroupPicker title='Failure mode (optional)' groups={lists.failureModes} selected={f.failureModeCode ? [f.failureModeCode] : []} onToggle={(c) => set('failureModeCode', c === f.failureModeCode ? '' : c)} collapsed />
                    </>
                )}
                {step === 3 && place && (
                    <>
                        <Card className='space-y-2 text-sm'>
                            <Info label='Assembly' value={`${place.assembly.code} · ${place.assembly.name}`} />
                            <Info label='Asset' value={place.assets.find((a) => a.tag === assetTag)?.name ?? assetTag} sub={assetTag} />
                            <Info label='Title' value={f.title} />
                            <Info label='Classification' value={[lists.maintenanceTypes, lists.workTypes, lists.priorities, lists.disciplines].map((l, i) => l.find((x) => x.code === [f.maintenanceTypeCode, f.workTypeCode, f.priorityCode, f.disciplineCode][i])?.label).join(' · ')} />
                        </Card>
                        <label className='flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-slate-200'>
                            <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                            I confirm the details. The work order is numbered and goes to planning.
                        </label>
                        {error && <Alert tone='error'>{error}</Alert>}
                    </>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Detail: one screen per work order, actions on top, sections by stage
// ---------------------------------------------------------------------------

type Panel = '' | 'plan' | 'safety' | 'release' | 'schedule' | 'time' | 'spare' | 'complete' | 'verify' | 'close' | 'cancel' | 'reopen';

function OrderDetail({ code, setup }: { code: string; setup: MntSetup }) {
    const lists = setup.lists!;
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>('/api/org/mnt/wo/get', { code }), [code]);
    const [panel, setPanel] = useState<Panel>('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the work order.'}</Alert>;
    const w = data;
    const can = w.can;
    const cur = w.currency;
    const run = async (action: string, body: Record<string, unknown> = {}) => {
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/mnt/wo/action', { code: w.code, action, ...body });
            setPanel('');
            reload();
            return true;
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'The action failed.');
            return false;
        } finally {
            setBusy(false);
        }
    };
    const close = () => {
        setPanel('');
        setActionError('');
    };

    const buttons: Array<{ key: Panel | 'submit' | 'start'; label: string; icon: ReactNode; variant?: 'primary' | 'secondary' | 'danger' }> = [];
    if (can.plan) buttons.push({ key: 'plan', label: w.tasks.length ? 'Edit plan' : 'Plan', icon: <Wrench className='h-4 w-4' />, variant: w.tasks.length ? 'secondary' : 'primary' });
    if (can.safety) buttons.push({ key: 'safety', label: w.safety.assessedAt ? 'Update safety' : 'Safety assessment', icon: <ShieldCheck className='h-4 w-4' />, variant: w.safety.assessedAt ? 'secondary' : 'primary' });
    if (can.submitPlan) buttons.push({ key: 'submit', label: 'Plan ready', icon: <Send className='h-4 w-4' /> });
    if (can.release) buttons.push({ key: 'release', label: 'Release', icon: <Check className='h-4 w-4' /> });
    if (can.schedule) buttons.push({ key: 'schedule', label: w.scheduledStart ? 'Reschedule' : 'Schedule', icon: <CalendarClock className='h-4 w-4' />, variant: w.status === 'scheduled' ? 'secondary' : 'primary' });
    if (can.start) buttons.push({ key: 'start', label: 'Start work', icon: <Play className='h-4 w-4' /> });
    if (can.execute) {
        buttons.push({ key: 'time', label: 'Book time', icon: <Clock className='h-4 w-4' />, variant: 'secondary' });
        buttons.push({ key: 'spare', label: 'Spare used', icon: <PackagePlus className='h-4 w-4' />, variant: 'secondary' });
        buttons.push({ key: 'complete', label: 'Complete', icon: <CheckCircle2 className='h-4 w-4' /> });
    }
    if (can.verify) buttons.push({ key: 'verify', label: 'Verify', icon: <ClipboardCheck className='h-4 w-4' /> });
    if (can.close) buttons.push({ key: 'close', label: 'Close', icon: <Lock className='h-4 w-4' /> });
    if (can.reopen) buttons.push({ key: 'reopen', label: 'Reopen', icon: <RotateCcw className='h-4 w-4' />, variant: 'secondary' });
    if (can.cancel) buttons.push({ key: 'cancel', label: 'Cancel', icon: <Ban className='h-4 w-4' />, variant: 'danger' });
    const press = (k: string) => (k === 'submit' ? void run('submit_plan') : k === 'start' ? void run('start') : setPanel(k as Panel));

    if (panel === 'plan') return <PlanEditor wo={w} lists={lists} onSaved={() => (setPanel(''), reload())} onCancel={close} />;

    const stageIndex = STAGES.findIndex(([, s]) => s.includes(w.status));
    const notes: string[] = [];
    if (w.status === 'plan_ready' && can.isPlanner) notes.push('You planned this work order, so another person must release it.');
    if (['planning', 'plan_ready'].includes(w.status) && can.highRisk && can.isPlanner) notes.push('High-risk work: the safety assessment must be done by someone other than the planner.');
    if (w.status === 'completed' && can.didWork) notes.push('You worked on this order, so someone else must verify it.');

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={() => navigate('organization_admin/work_orders')}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-sm font-bold tracking-wider text-emerald-300'>{w.code}</p>
                        <p className='truncate text-xs text-slate-400'>{w.statusLabel}</p>
                    </div>
                    {w.wrCode && (
                        <Button variant='secondary' onClick={() => navigate(`organization_admin/work_requests/${w.wrCode}`)}>
                            {w.wrCode}
                        </Button>
                    )}
                </div>
                {w.status !== 'cancelled' && (
                    <div className='flex gap-1'>
                        {STAGES.map(([label], i) => (
                            <div key={label} className='flex-1'>
                                <div className={`h-1.5 rounded-full ${i < stageIndex || w.status === 'closed' ? 'bg-emerald-500' : i === stageIndex ? 'bg-emerald-300' : 'bg-slate-800'}`} />
                                <p className={`mt-1 truncate text-center text-[10px] ${i === stageIndex ? 'text-emerald-300' : 'text-slate-500'}`}>{label}</p>
                            </div>
                        ))}
                    </div>
                )}
                {buttons.length > 0 && !panel && (
                    <div className='flex gap-2 overflow-x-auto pb-1'>
                        {buttons.map((b) => (
                            <Button key={b.key} variant={b.variant ?? 'primary'} busy={busy && (b.key === 'submit' || b.key === 'start')} className='shrink-0' onClick={() => press(b.key)}>
                                {b.icon}
                                {b.label}
                            </Button>
                        ))}
                    </div>
                )}
                {notes.map((n) => (
                    <p key={n} className='text-xs text-amber-300'>
                        {n}
                    </p>
                ))}
            </div>

            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {actionError && !panel && <Alert tone='error'>{actionError}</Alert>}
                {panel === 'safety' && <SafetyEditor wo={w} lists={lists} busy={busy} error={actionError} onSave={(b) => run('save_safety', b)} onCancel={close} />}
                {panel === 'schedule' && <ScheduleEditor wo={w} busy={busy} error={actionError} onSave={(b) => run('schedule', b)} onCancel={close} />}
                {panel === 'time' && <TimeEditor busy={busy} error={actionError} onSave={(b) => run('log_time', b)} onCancel={close} />}
                {panel === 'spare' && <SpareUseEditor wo={w} busy={busy} error={actionError} onSave={(b) => run('use_spare', b)} onCancel={close} />}
                {panel === 'complete' && <CompleteEditor lists={lists} busy={busy} error={actionError} onSave={(b) => run('complete', b)} onCancel={close} />}
                {panel === 'verify' && <VerifyEditor lists={lists} busy={busy} error={actionError} onSave={(b) => run('verify', b)} onCancel={close} />}
                {(panel === 'release' || panel === 'close' || panel === 'cancel' || panel === 'reopen') && (
                    <ConfirmPanel
                        code={w.code}
                        title={panel === 'release' ? `Release for execution · estimate ${money(w.estimate.total, cur)}` : panel === 'close' ? `Close · actual ${money(w.actuals.total, cur)} to cost center ${w.costCenterCode}` : panel === 'cancel' ? 'Cancel this work order' : 'Reopen this work order'}
                        noteLabel={panel === 'release' || panel === 'close' ? 'Note (optional)' : 'Reason *'}
                        noteRequired={panel === 'cancel' || panel === 'reopen'}
                        danger={panel === 'cancel'}
                        busy={busy}
                        error={actionError}
                        onConfirm={(note, confirm) => run(panel, { note, confirm })}
                        onCancel={close}
                    />
                )}

                <Card>
                    <div className='flex items-start gap-3'>
                        <span className='mt-1 h-10 w-2 shrink-0 rounded-full' style={{ background: critColor(w.criticalityCode, w.criticalityColor) }} />
                        <div className='min-w-0 flex-1'>
                            <h2 className='text-lg font-semibold text-white'>{w.title}</h2>
                            <div className='mt-2 flex flex-wrap gap-1'>
                                <Badge tone={TONE[w.status] ?? 'muted'}>{w.statusLabel}</Badge>
                                <Badge>{w.priorityLabel}</Badge>
                                <Badge>{w.maintenanceTypeLabel}</Badge>
                                <Badge>{w.workTypeLabel}</Badge>
                            </div>
                        </div>
                    </div>
                    <p className='mt-3 whitespace-pre-wrap text-sm text-slate-300'>{w.description}</p>
                </Card>

                <Card className='space-y-2 text-sm'>
                    <Info label='Asset' value={`${w.assetTag} · ${w.assetName}`} sub={w.assetClass} />
                    <Info label='Assembly' value={`${w.assemblyCode} · ${w.assemblyName}`} />
                    <Info label='Equipment unit' value={`${w.unitCode} · ${w.unitName}`} />
                    <Info label='Cost center' value={`${w.costCenterCode} · ${w.costCenterName}`} />
                    <Info label='Discipline' value={w.disciplineLabel} />
                    {w.failureModeLabel && <Info label='Failure mode' value={w.failureModeLabel} />}
                    <Info label='Created' value={`${w.createdByName} · ${fmtDate(w.createdAt)}`} sub={w.wrCode ? `From ${w.wrCode}` : 'Created directly'} />
                </Card>

                <Section title='Plan' empty={!w.tasks.length && !w.spares.length && !w.services.length ? 'Not planned yet.' : ''}>
                    {w.tasks.map((t, i) => (
                        <div key={t.id ?? i} className='rounded-xl border border-slate-800 p-2 text-sm'>
                            <p className='text-white'>
                                {i + 1}. {t.description}
                            </p>
                            <p className='text-xs text-slate-400'>
                                {t.disciplineLabel} · {t.resourceTypeLabel} · {t.persons} × {t.hours} h{t.rate ? ` @ ${money(t.rate, cur)}/h` : ''}
                            </p>
                        </div>
                    ))}
                    {w.spares.length > 0 && <p className='pt-1 text-xs font-semibold text-slate-500'>Spares</p>}
                    {w.spares.map((s, i) => (
                        <p key={s.id ?? i} className='text-sm text-slate-200'>
                            {s.qty} {s.uom} × {s.description} {s.catalogCode && <span className='font-mono text-xs text-slate-500'>{s.catalogCode}</span>} {s.unitCost ? <span className='text-xs text-slate-400'>@ {money(s.unitCost, cur)}</span> : null}
                        </p>
                    ))}
                    {w.services.length > 0 && <p className='pt-1 text-xs font-semibold text-slate-500'>Services</p>}
                    {w.services.map((s, i) => (
                        <p key={s.id ?? i} className='text-sm text-slate-200'>
                            {s.description} · {money(s.cost, cur)}
                        </p>
                    ))}
                    {w.tools && <Info label='Tools' value={w.tools} />}
                    {w.executionLocationLabel && <Info label='Done at' value={w.executionLocationLabel} />}
                    {w.downtimeHours > 0 && <Info label='Downtime needed' value={`${w.downtimeHours} h`} />}
                    {w.targetDate && <Info label='Target date' value={fmtDate(w.targetDate)} />}
                    {w.plannedByName && <Info label='Planner' value={`${w.plannedByName} · ${fmtDate(w.plannedAt)}`} />}
                    <EstimateGrid est={w.estimate} actual={['in_progress', 'completed', 'verified', 'closed'].includes(w.status) ? w.actuals : null} cur={cur} />
                </Section>

                <Section title='Safety assessment' empty={w.safety.assessedAt ? '' : 'Not assessed yet.'}>
                    {w.safety.assessedAt && (
                        <>
                            <Info label='Risk' value={w.safety.riskLabel} />
                            <Info label='Hazards' value={w.safety.hazards.join(', ') || 'None listed'} />
                            <Info label='Permits' value={w.safety.permits.join(', ') || 'None required'} />
                            <Info label='PPE' value={w.safety.ppe.join(', ')} />
                            <Info label='Isolation' value={w.safety.isolation ? 'Required' : 'Not required'} />
                            <Info label='Controls' value={w.safety.controls} />
                            <Info label='Assessed by' value={`${w.safety.assessedByName} · ${fmtDate(w.safety.assessedAt)}`} />
                        </>
                    )}
                </Section>

                {(w.releasedByName || w.scheduledStart) && (
                    <Section title='Release and schedule'>
                        {w.releasedByName && <Info label='Released by' value={`${w.releasedByName} · ${fmtDate(w.releasedAt)}`} />}
                        {w.scheduledStart && <Info label='Scheduled' value={`${fmtDate(w.scheduledStart)} → ${fmtDate(w.scheduledEnd)}`} />}
                        {w.assignees.length > 0 && <Info label='Assigned' value={w.assignees.map((a) => a.name).join(', ')} />}
                        {w.supervisorName && <Info label='Supervisor' value={w.supervisorName} />}
                    </Section>
                )}

                {(w.timeLogs.length > 0 || w.sparesUsed.length > 0 || w.completion.completedAt) && (
                    <Section title='Execution'>
                        {w.startedAt && <Info label='Started' value={fmtDate(w.startedAt)} />}
                        {w.timeLogs.map((t) => (
                            <p key={t.id} className='text-sm text-slate-200'>
                                <Clock className='mr-1 inline h-3.5 w-3.5 text-slate-500' />
                                {t.name} · {t.hours} h · {t.date}
                                {t.note && <span className='text-xs text-slate-400'> · {t.note}</span>}
                            </p>
                        ))}
                        {w.sparesUsed.map((s, i) => (
                            <p key={`${s.id}${i}`} className='text-sm text-slate-200'>
                                <PackagePlus className='mr-1 inline h-3.5 w-3.5 text-slate-500' />
                                {s.qty} {s.uom} × {s.description} · {s.name}
                            </p>
                        ))}
                        {w.completion.completedAt && (
                            <div className='space-y-2 border-t border-slate-800 pt-2'>
                                <Info label='Findings' value={w.completion.findings} />
                                <Info label='Cause' value={w.completion.rootCauseLabel} />
                                <Info label='Action taken' value={w.completion.solutionLabel} />
                                <Info label='Outcome' value={w.completion.outcomeLabel} />
                                <Info label='Downtime' value={`${w.completion.downtimeClassLabel} · ${w.completion.actualDowntimeHours} h`} />
                                <Info label='Completed by' value={`${w.completion.completedByName} · ${fmtDate(w.completion.completedAt)}`} />
                            </div>
                        )}
                    </Section>
                )}

                {(w.verification.byName || w.closeNote || w.cancelReason) && (
                    <Section title='Verification and closure'>
                        {w.verification.byName && <Info label='Verified' value={`${w.verification.typeLabel} · ${w.verification.byName} · ${fmtDate(w.verification.at)}`} sub={w.verification.note} />}
                        {w.closeNote && <Info label='Close note' value={w.closeNote} />}
                        {w.cancelReason && <Info label='Cancelled' value={w.cancelReason} />}
                    </Section>
                )}

                <HistoryCard history={w.history} />
            </div>
        </div>
    );
}

function Section({ title, empty, children }: { title: string; empty?: string; children?: ReactNode }) {
    return (
        <Card className='space-y-2 text-sm'>
            <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>{title}</p>
            {empty ? <p className='text-sm text-slate-500'>{empty}</p> : children}
        </Card>
    );
}

function EstimateGrid({ est, actual, cur }: { est: Est; actual: Est | null; cur: string }) {
    const rows: Array<[string, keyof Est]> = [
        ['Labour hours', 'labourHours'],
        ['Labour', 'labour'],
        ['Spares', 'spares'],
        ['Services', 'services'],
        ['Total', 'total'],
    ];
    return (
        <div className='mt-2 overflow-hidden rounded-xl border border-slate-800 text-xs'>
            <div className={`grid ${actual ? 'grid-cols-3' : 'grid-cols-2'} bg-slate-950 px-3 py-1.5 font-semibold text-slate-400`}>
                <span />
                <span className='text-right'>Estimate</span>
                {actual && <span className='text-right'>Actual</span>}
            </div>
            {rows.map(([label, k]) => (
                <div key={k} className={`grid ${actual ? 'grid-cols-3' : 'grid-cols-2'} border-t border-slate-800 px-3 py-1.5 ${k === 'total' ? 'font-semibold text-white' : 'text-slate-300'}`}>
                    <span>{label}</span>
                    <span className='text-right'>{k === 'labourHours' ? `${est[k]} h` : money(est[k], cur)}</span>
                    {actual && <span className='text-right'>{k === 'labourHours' ? `${actual[k]} h` : money(actual[k], cur)}</span>}
                </div>
            ))}
        </div>
    );
}

function PanelShell({ title, children, busy, error, ok, onSave, onCancel, saveLabel = 'Save', danger = false }: { title: string; children: ReactNode; busy: boolean; error: string; ok: boolean; onSave: () => void; onCancel: () => void; saveLabel?: string; danger?: boolean }) {
    return (
        <Card className='space-y-3 border-emerald-500/40'>
            <div className='flex items-center justify-between'>
                <p className='font-medium text-white'>{title}</p>
                <button type='button' aria-label='Close' onClick={onCancel} className='flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            {children}
            {error && <Alert tone='error'>{error}</Alert>}
            <Button className='w-full' variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!ok} onClick={onSave}>
                {saveLabel}
            </Button>
        </Card>
    );
}

function ConfirmPanel({ code, title, noteLabel, noteRequired, danger, busy, error, onConfirm, onCancel }: { code: string; title: string; noteLabel: string; noteRequired: boolean; danger?: boolean; busy: boolean; error: string; onConfirm: (note: string, confirm: string) => void; onCancel: () => void }) {
    const [note, setNote] = useState('');
    const [typed, setTyped] = useState('');
    return (
        <PanelShell title={title} busy={busy} error={error} ok={typed.trim() === code && (!noteRequired || note.trim().length >= 5)} onSave={() => onConfirm(note.trim(), typed.trim())} onCancel={onCancel} saveLabel='Confirm' danger={danger}>
            <TextArea id='wo-note' label={noteLabel} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            <Field id='wo-confirm' label={`Type ${code} to confirm`} autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} />
        </PanelShell>
    );
}

// ----- Planning -----

function PlanEditor({ wo, lists, onSaved, onCancel }: { wo: Detail; lists: MntLists; onSaved: () => void; onCancel: () => void }) {
    const [tasks, setTasks] = useState<Task[]>(wo.tasks.length ? wo.tasks : [{ description: '', disciplineCode: '', resourceTypeCode: '', persons: 1, hours: 1, rate: 0 }]);
    const [spares, setSpares] = useState<Spare[]>(wo.spares);
    const [services, setServices] = useState<Service[]>(wo.services);
    const [tools, setTools] = useState(wo.tools);
    const [execLoc, setExecLoc] = useState(wo.executionLocationCode);
    const [downtime, setDowntime] = useState(String(wo.downtimeHours || ''));
    const [targetDate, setTargetDate] = useState(wo.targetDate);
    const [search, setSearch] = useState<'' | 'materials' | 'services'>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const cur = wo.currency;
    const est = useMemo(() => {
        const labourHours = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0), 0);
        const labour = tasks.reduce((s, t) => s + (Number(t.persons) || 0) * (Number(t.hours) || 0) * (Number(t.rate) || 0), 0);
        const sp = spares.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.unitCost) || 0), 0);
        const sv = services.reduce((s, x) => s + (Number(x.cost) || 0), 0);
        return { labourHours, labour, spares: sp, services: sv, total: labour + sp + sv };
    }, [tasks, spares, services]);
    const ok = tasks.length > 0 && tasks.every((t) => t.description.trim().length >= 3 && t.disciplineCode && t.resourceTypeCode && t.persons >= 1 && t.hours > 0) && spares.every((s) => s.description.trim().length >= 2 && s.qty > 0) && services.every((s) => s.description.trim().length >= 3);
    const upd = <T,>(list: T[], set: (v: T[]) => void, i: number, patch: Partial<T>) => set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/mnt/wo/action', { code: wo.code, action: 'save_plan', tasks, spares, services, tools, executionLocationCode: execLoc, downtimeHours: Number(downtime) || 0, targetDate });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the plan.');
        } finally {
            setBusy(false);
        }
    };
    const num = (v: string) => (v === '' ? 0 : Number(v));

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-1 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={onCancel}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-emerald-300'>{wo.code}</p>
                        <p className='truncate font-semibold text-white'>Plan the work</p>
                    </div>
                    <Button busy={busy} disabled={!ok} onClick={save}>
                        <Check className='h-4 w-4' />
                        Save plan
                    </Button>
                </div>
                <p className='text-xs text-slate-400'>
                    Estimate {money(est.total, cur)} · {est.labourHours} labour hours{wo.safety.assessedAt ? ' · saving changes requires the safety assessment again' : ''}
                </p>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {error && <Alert tone='error'>{error}</Alert>}
                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>Tasks, people and duration</p>
                    {tasks.map((t, i) => (
                        <div key={i} className='space-y-2 rounded-xl border border-slate-800 p-3'>
                            <div className='flex items-center gap-2'>
                                <span className='text-xs font-semibold text-slate-500'>Task {i + 1}</span>
                                <span className='flex-1' />
                                <button type='button' aria-label='Remove task' onClick={() => setTasks(tasks.filter((_, j) => j !== i))} className='text-red-300'>
                                    <Trash2 className='h-4 w-4' />
                                </button>
                            </div>
                            <TextArea id={`t-d-${i}`} label='What to do *' rows={2} maxLength={300} value={t.description} onChange={(e) => upd(tasks, setTasks, i, { description: e.target.value })} />
                            <div className='grid grid-cols-2 gap-2'>
                                <SelectField id={`t-dis-${i}`} label='Discipline *' value={t.disciplineCode} onChange={(e) => upd(tasks, setTasks, i, { disciplineCode: e.target.value })}>
                                    <option value=''>Select…</option>
                                    {lists.disciplines.map((d) => (
                                        <option key={d.code} value={d.code}>
                                            {d.label}
                                        </option>
                                    ))}
                                </SelectField>
                                <SelectField id={`t-res-${i}`} label='Resource *' value={t.resourceTypeCode} onChange={(e) => upd(tasks, setTasks, i, { resourceTypeCode: e.target.value })}>
                                    <option value=''>Select…</option>
                                    {lists.resourceTypes.map((d) => (
                                        <option key={d.code} value={d.code}>
                                            {d.label}
                                        </option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className='grid grid-cols-3 gap-2'>
                                <Field id={`t-p-${i}`} label='People' type='number' inputMode='numeric' min={1} value={String(t.persons)} onChange={(e) => upd(tasks, setTasks, i, { persons: num(e.target.value) })} />
                                <Field id={`t-h-${i}`} label='Hours each' type='number' inputMode='decimal' min={0.25} step={0.25} value={String(t.hours)} onChange={(e) => upd(tasks, setTasks, i, { hours: num(e.target.value) })} />
                                <Field id={`t-r-${i}`} label={`Rate/h ${cur}`} type='number' inputMode='decimal' min={0} value={String(t.rate)} onChange={(e) => upd(tasks, setTasks, i, { rate: num(e.target.value) })} />
                            </div>
                        </div>
                    ))}
                    <Button variant='secondary' className='w-full' onClick={() => setTasks([...tasks, { description: '', disciplineCode: tasks[tasks.length - 1]?.disciplineCode ?? '', resourceTypeCode: tasks[tasks.length - 1]?.resourceTypeCode ?? '', persons: 1, hours: 1, rate: tasks[tasks.length - 1]?.rate ?? 0 }])}>
                        <Plus className='h-4 w-4' />
                        Add task
                    </Button>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>Spares and materials</p>
                    {spares.map((s, i) => (
                        <div key={i} className='space-y-2 rounded-xl border border-slate-800 p-3'>
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate font-mono text-xs text-slate-500'>{s.catalogCode || 'Not from catalog'}</span>
                                <button type='button' aria-label='Remove spare' onClick={() => setSpares(spares.filter((_, j) => j !== i))} className='text-red-300'>
                                    <Trash2 className='h-4 w-4' />
                                </button>
                            </div>
                            <Field id={`s-d-${i}`} label='Item *' maxLength={200} value={s.description} onChange={(e) => upd(spares, setSpares, i, { description: e.target.value })} />
                            <div className='grid grid-cols-3 gap-2'>
                                <Field id={`s-q-${i}`} label='Qty' type='number' inputMode='decimal' min={0} value={String(s.qty)} onChange={(e) => upd(spares, setSpares, i, { qty: num(e.target.value) })} />
                                <Field id={`s-u-${i}`} label='Unit' maxLength={12} value={s.uom} onChange={(e) => upd(spares, setSpares, i, { uom: e.target.value })} />
                                <Field id={`s-c-${i}`} label={`Unit cost ${cur}`} type='number' inputMode='decimal' min={0} value={String(s.unitCost)} onChange={(e) => upd(spares, setSpares, i, { unitCost: num(e.target.value) })} />
                            </div>
                        </div>
                    ))}
                    {search === 'materials' ? (
                        <CatalogSearch kind='materials' onPick={(item) => (setSpares([...spares, { source: 'catalog', catalogCode: item.code, description: item.name, qty: 1, uom: 'EA', unitCost: 0 }]), setSearch(''))} onClose={() => setSearch('')} />
                    ) : (
                        <div className='grid grid-cols-2 gap-2'>
                            <Button variant='secondary' onClick={() => setSearch('materials')}>
                                <Search className='h-4 w-4' />
                                From catalog
                            </Button>
                            <Button variant='secondary' onClick={() => setSpares([...spares, { source: 'manual', catalogCode: '', description: '', qty: 1, uom: 'EA', unitCost: 0 }])}>
                                <Plus className='h-4 w-4' />
                                Other item
                            </Button>
                        </div>
                    )}
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>Services (contractors)</p>
                    {services.map((s, i) => (
                        <div key={i} className='space-y-2 rounded-xl border border-slate-800 p-3'>
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate font-mono text-xs text-slate-500'>{s.catalogCode || 'Not from catalog'}</span>
                                <button type='button' aria-label='Remove service' onClick={() => setServices(services.filter((_, j) => j !== i))} className='text-red-300'>
                                    <Trash2 className='h-4 w-4' />
                                </button>
                            </div>
                            <Field id={`v-d-${i}`} label='Service *' maxLength={200} value={s.description} onChange={(e) => upd(services, setServices, i, { description: e.target.value })} />
                            <Field id={`v-c-${i}`} label={`Estimated cost ${cur}`} type='number' inputMode='decimal' min={0} value={String(s.cost)} onChange={(e) => upd(services, setServices, i, { cost: num(e.target.value) })} />
                        </div>
                    ))}
                    {search === 'services' ? (
                        <CatalogSearch kind='services' onPick={(item) => (setServices([...services, { catalogCode: item.code, description: item.name, cost: 0 }]), setSearch(''))} onClose={() => setSearch('')} />
                    ) : (
                        <div className='grid grid-cols-2 gap-2'>
                            <Button variant='secondary' onClick={() => setSearch('services')}>
                                <Search className='h-4 w-4' />
                                From catalog
                            </Button>
                            <Button variant='secondary' onClick={() => setServices([...services, { catalogCode: '', description: '', cost: 0 }])}>
                                <Plus className='h-4 w-4' />
                                Other service
                            </Button>
                        </div>
                    )}
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>Logistics</p>
                    <SelectField id='p-loc' label='Where the work is done' value={execLoc} onChange={(e) => setExecLoc(e.target.value)}>
                        <option value=''>Select…</option>
                        {lists.executionLocations.map((d) => (
                            <option key={d.code} value={d.code}>
                                {d.label}
                            </option>
                        ))}
                    </SelectField>
                    <Field id='p-down' label='Equipment downtime needed (hours)' type='number' inputMode='decimal' min={0} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
                    <Field id='p-date' label='Target completion date' type='date' value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
                    <TextArea id='p-tools' label='Special tools and equipment' rows={2} maxLength={1000} value={tools} onChange={(e) => setTools(e.target.value)} />
                </Card>
            </div>
        </div>
    );
}

function CatalogSearch({ kind, onPick, onClose }: { kind: 'materials' | 'services'; onPick: (item: { code: string; name: string }) => void; onClose: () => void }) {
    const [q, setQ] = useState('');
    const [items, setItems] = useState<Array<{ code: string; name: string; family: string }>>([]);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const term = q.trim();
        if (term.length < 2) {
            setItems([]);
            return;
        }
        const t = window.setTimeout(async () => {
            setBusy(true);
            try {
                const res = await callBackend<{ items: Array<{ code: string; name: string; family: string }> }>('/api/org/mnt/catalog-search', { kind, q: term });
                setItems(res.items);
            } catch {
                setItems([]);
            } finally {
                setBusy(false);
            }
        }, 300);
        return () => window.clearTimeout(t);
    }, [q, kind]);
    return (
        <div className='space-y-2 rounded-xl border border-emerald-500/40 p-3'>
            <div className='flex items-center gap-2'>
                <Search className='h-4 w-4 text-slate-500' />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'materials' ? 'Search the material catalog…' : 'Search the service catalog…'} className='h-10 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white' />
                <button type='button' aria-label='Close search' onClick={onClose} className='text-slate-400'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            {busy && <p className='text-xs text-slate-500'>Searching…</p>}
            <ul className='max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                {items.map((i) => (
                    <li key={i.code}>
                        <button type='button' onClick={() => onPick(i)} className='w-full rounded-lg px-2 py-2 text-left text-sm text-slate-200 active:bg-slate-800'>
                            {i.name}
                            <span className='block font-mono text-xs text-slate-500'>
                                {i.code} · {i.family}
                            </span>
                        </button>
                    </li>
                ))}
                {!busy && q.trim().length >= 2 && !items.length && <p className='text-xs text-slate-500'>Nothing found. Add it as another item instead.</p>}
            </ul>
        </div>
    );
}

// ----- Safety -----

function Chips({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
    return (
        <div className='flex flex-wrap gap-2'>
            {options.map((o) => {
                const on = selected.includes(o);
                return (
                    <button key={o} type='button' onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])} className={`rounded-full px-3 py-2 text-xs ${on ? 'bg-emerald-500 text-onbrand' : 'bg-slate-800 text-slate-300'}`}>
                        {o}
                    </button>
                );
            })}
        </div>
    );
}

function SafetyEditor({ wo, lists, busy, error, onSave, onCancel }: { wo: Detail; lists: MntLists; busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const s = wo.safety;
    const [risk, setRisk] = useState(s.riskCode);
    const [hazards, setHazards] = useState(s.hazards);
    const [permits, setPermits] = useState(s.permits);
    const [ppe, setPpe] = useState(s.ppe);
    const [isolation, setIsolation] = useState(s.isolation);
    const [controls, setControls] = useState(s.controls);
    const high = permits.length > 0 || lists.criticality.slice(0, 2).some((c) => c.code === risk);
    return (
        <PanelShell title='Safety assessment' busy={busy} error={error} ok={!!risk && ppe.length > 0 && controls.trim().length >= 10} onSave={() => onSave({ riskCode: risk, hazards, permits, ppe, isolation, controls })} onCancel={onCancel}>
            <p className='text-sm text-slate-300'>Risk level *</p>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
                {lists.criticality.map((c) => {
                    const color = critColor(c.code, c.color, lists.criticality);
                    const on = risk === c.code;
                    return (
                        <button key={c.code} type='button' onClick={() => setRisk(c.code)} className={`h-11 rounded-xl border-2 text-sm font-semibold ${on ? 'text-white' : 'text-slate-200'}`} style={{ borderColor: color, background: on ? color : `${color}22` }}>
                            {c.label}
                        </button>
                    );
                })}
            </div>
            <p className='text-sm text-slate-300'>Hazards</p>
            <Chips options={lists.hazards} selected={hazards} onChange={setHazards} />
            <p className='text-sm text-slate-300'>Permits required</p>
            <Chips options={lists.permits} selected={permits} onChange={setPermits} />
            <p className='text-sm text-slate-300'>PPE *</p>
            <Chips options={lists.ppe} selected={ppe} onChange={setPpe} />
            <label className='flex items-center gap-3 text-sm text-slate-200'>
                <input type='checkbox' className='h-5 w-5 accent-emerald-500' checked={isolation} onChange={(e) => setIsolation(e.target.checked)} />
                Energy isolation required
            </label>
            <TextArea id='sf-controls' label='Control measures *' rows={3} maxLength={1500} value={controls} onChange={(e) => setControls(e.target.value)} />
            {high && (
                <p className='flex items-center gap-2 text-xs text-amber-300'>
                    <HardHat className='h-4 w-4' />
                    High-risk work: the planner cannot sign this assessment.
                </p>
            )}
        </PanelShell>
    );
}

// ----- Schedule -----

function ScheduleEditor({ wo, busy, error, onSave, onCancel }: { wo: Detail; busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const { data } = useLoad(() => callBackend<{ people: Array<{ uid: string; name: string }> }>('/api/org/mnt/wo/people'));
    const [start, setStart] = useState(wo.scheduledStart || (wo.targetDate ? `${wo.targetDate}T08:00` : ''));
    const [end, setEnd] = useState(wo.scheduledEnd);
    const [assignees, setAssignees] = useState<string[]>(wo.assignees.map((a) => a.uid));
    const [supervisor, setSupervisor] = useState('');
    const [q, setQ] = useState('');
    const people = (data?.people ?? []).filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
    const orderOk = !!start && !!end && Date.parse(end) >= Date.parse(start);
    return (
        <PanelShell title='Schedule and assign' busy={busy} error={error} ok={orderOk && assignees.length > 0} onSave={() => onSave({ scheduledStart: start, scheduledEnd: end, assignees, supervisor })} onCancel={onCancel}>
            <div className='grid grid-cols-2 gap-2'>
                <Field id='sc-start' label='Start *' type='datetime-local' value={start} onChange={(e) => setStart(e.target.value)} />
                <Field id='sc-end' label='Finish *' type='datetime-local' value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            {start && end && !orderOk && <p className='text-xs text-amber-300'>The finish must be after the start.</p>}
            <p className='text-sm text-slate-300'>
                Assign people * ({assignees.length}) · planned {wo.estimate.labourHours} labour hours
            </p>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search people…' className='h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white' />
            <ul className='max-h-56 space-y-1 overflow-y-auto overscroll-contain'>
                {people.map((p) => {
                    const on = assignees.includes(p.uid);
                    return (
                        <li key={p.uid}>
                            <button type='button' onClick={() => setAssignees(on ? assignees.filter((x) => x !== p.uid) : [...assignees, p.uid])} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${on ? 'bg-emerald-500/15 text-white' : 'text-slate-300'}`}>
                                <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'}`}>{on && <Check className='h-3.5 w-3.5 text-white' />}</span>
                                {p.name}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <SelectField id='sc-sup' label='Supervisor (optional)' value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
                <option value=''>None</option>
                {(data?.people ?? []).map((p) => (
                    <option key={p.uid} value={p.uid}>
                        {p.name}
                    </option>
                ))}
            </SelectField>
        </PanelShell>
    );
}

// ----- Execution -----

function TimeEditor({ busy, error, onSave, onCancel }: { busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [hours, setHours] = useState('');
    const [note, setNote] = useState('');
    const h = Number(hours);
    return (
        <PanelShell title='Book time worked' busy={busy} error={error} ok={!!date && h >= 0.25 && h <= 24} onSave={() => onSave({ date, hours: h, note })} onCancel={onCancel}>
            <div className='grid grid-cols-2 gap-2'>
                <Field id='tm-date' label='Date *' type='date' value={date} onChange={(e) => setDate(e.target.value)} />
                <Field id='tm-hours' label='Hours *' type='number' inputMode='decimal' min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <Field id='tm-note' label='What was done (optional)' maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </PanelShell>
    );
}

function SpareUseEditor({ wo, busy, error, onSave, onCancel }: { wo: Detail; busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const [spareId, setSpareId] = useState(wo.spares[0]?.id ?? '');
    const [description, setDescription] = useState('');
    const [qty, setQty] = useState('1');
    const [uom, setUom] = useState('EA');
    const other = !spareId;
    return (
        <PanelShell title='Record a spare used' busy={busy} error={error} ok={Number(qty) > 0 && (!other || description.trim().length >= 2)} onSave={() => onSave({ spareId, description, qty: Number(qty), uom })} onCancel={onCancel}>
            <SelectField id='su-item' label='Item' value={spareId} onChange={(e) => setSpareId(e.target.value)}>
                {wo.spares.map((s) => (
                    <option key={s.id} value={s.id}>
                        {s.description} (planned {s.qty} {s.uom})
                    </option>
                ))}
                <option value=''>Another item (not planned)</option>
            </SelectField>
            {other && <Field id='su-desc' label='Item used *' maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />}
            <div className='grid grid-cols-2 gap-2'>
                <Field id='su-qty' label='Quantity *' type='number' inputMode='decimal' min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
                {other && <Field id='su-uom' label='Unit' maxLength={12} value={uom} onChange={(e) => setUom(e.target.value)} />}
            </div>
        </PanelShell>
    );
}

function CompleteEditor({ lists, busy, error, onSave, onCancel }: { lists: MntLists; busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const [findings, setFindings] = useState('');
    const [cause, setCause] = useState('');
    const [solution, setSolution] = useState('');
    const [outcome, setOutcome] = useState('');
    const [downtimeClass, setDowntimeClass] = useState('');
    const [downtime, setDowntime] = useState('');
    return (
        <PanelShell
            title='Complete the work'
            busy={busy}
            error={error}
            ok={findings.trim().length >= 10 && !!cause && !!solution && !!outcome && !!downtimeClass}
            onSave={() => onSave({ findings, rootCauseCode: cause, solutionCode: solution, outcomeCode: outcome, downtimeClassCode: downtimeClass, actualDowntimeHours: Number(downtime) || 0 })}
            onCancel={onCancel}
            saveLabel='Mark as completed'
        >
            <TextArea id='cp-find' label='What was found and done *' rows={4} maxLength={2000} value={findings} onChange={(e) => setFindings(e.target.value)} />
            <GroupPicker title='Cause *' groups={lists.rootCauses} selected={cause ? [cause] : []} onToggle={(c) => setCause(c === cause ? '' : c)} />
            <GroupPicker title='Action taken *' groups={lists.solutions} selected={solution ? [solution] : []} onToggle={(c) => setSolution(c === solution ? '' : c)} />
            <SelectField id='cp-out' label='Outcome *' value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                <option value=''>Select…</option>
                {lists.outcomes.map((o) => (
                    <option key={o.code} value={o.code}>
                        {o.label}
                    </option>
                ))}
            </SelectField>
            <div className='grid grid-cols-2 gap-2'>
                <SelectField id='cp-dc' label='Downtime class *' value={downtimeClass} onChange={(e) => setDowntimeClass(e.target.value)}>
                    <option value=''>Select…</option>
                    {lists.downtimeClasses.map((o) => (
                        <option key={o.code} value={o.code}>
                            {o.label}
                        </option>
                    ))}
                </SelectField>
                <Field id='cp-dh' label='Actual downtime (h)' type='number' inputMode='decimal' min={0} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
            </div>
        </PanelShell>
    );
}

function VerifyEditor({ lists, busy, error, onSave, onCancel }: { lists: MntLists; busy: boolean; error: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
    const [type, setType] = useState('');
    const [result, setResult] = useState<'' | 'accepted' | 'rework'>('');
    const [note, setNote] = useState('');
    return (
        <PanelShell title='Verify the completed work' busy={busy} error={error} ok={!!type && !!result && (result === 'accepted' || note.trim().length >= 5)} onSave={() => onSave({ verificationTypeCode: type, result, note })} onCancel={onCancel} saveLabel={result === 'rework' ? 'Send back for rework' : 'Confirm verification'} danger={result === 'rework'}>
            <SelectField id='vf-type' label='How was it verified? *' value={type} onChange={(e) => setType(e.target.value)}>
                <option value=''>Select…</option>
                {lists.verificationTypes.map((o) => (
                    <option key={o.code} value={o.code}>
                        {o.label}
                    </option>
                ))}
            </SelectField>
            <div className='grid grid-cols-2 gap-2'>
                <button type='button' onClick={() => setResult('accepted')} className={`h-12 rounded-xl border-2 text-sm font-semibold ${result === 'accepted' ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-emerald-500/40 text-emerald-200'}`}>
                    Accepted
                </button>
                <button type='button' onClick={() => setResult('rework')} className={`h-12 rounded-xl border-2 text-sm font-semibold ${result === 'rework' ? 'border-red-400 bg-red-500 text-white' : 'border-red-500/40 text-red-200'}`}>
                    Rework needed
                </button>
            </div>
            <TextArea id='vf-note' label={result === 'rework' ? 'What must be redone? *' : 'Note (optional)'} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </PanelShell>
    );
}
