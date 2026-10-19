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
    if (id === 'new') return <Alert tone='info'>Work orders are created only from approved work request assessments. Open Work Requests to begin.</Alert>;
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

                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Work orders can only be generated by converting independently approved assessments.
// ---------------------------------------------------------------------------
// Detail: one screen per work order, actions on top, sections by stage
// ---------------------------------------------------------------------------

type Panel = '' | 'plan' | 'safety' | 'release' | 'schedule' | 'time' | 'spare' | 'complete' | 'verify' | 'close' | 'cancel' | 'reopen';

function OrderDetail({code}: {code:string;setup:MntSetup}){return <MntWorkOrder code={code}/>;}

