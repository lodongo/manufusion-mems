import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Ban, CalendarClock, Check, CheckCircle2, ClipboardCheck, Clock, Cog, HardHat, Lock, PackagePlus, Play, Plus, RotateCcw, Search, Send, ShieldCheck, Trash2, Wrench, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import MntTaskAssessment from './MntTaskAssessment';
import MntWorkOrder from './MntWorkOrder';
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
    assessmentTasks?: Array<Task & {tools?:string;spares?:Spare[];services?:Service[];risk?:Array<{hazard:string;impact:string;controls:string;before:string;after:string}>}>;
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

function OrderDetail({code}: {code:string;setup:MntSetup}){return <MntWorkOrder code={code}/>;}

