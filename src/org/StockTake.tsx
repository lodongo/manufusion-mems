import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, CalendarClock, CheckCircle2, ClipboardCheck, Download, FileUp, Pencil, Plus, Printer, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Trash2, Undo2, X, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { InfoTip, Screen, Segmented, messageOf, useConfirm, type ConfirmOptions } from '../components/screen';
import { Badge, Button, Card, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { downloadReportPdf } from '../lib/report';

// Stock take (physical inventory, INV).
//   Active sessions     a stock take session (CNT_SES_ + 8 digits) is planned first: configuration, warehouse, start,
//                       end (duration, or the period end for a cycle count), materials to count (or All) and materials
//                       per PI (which give the number of PI documents). Every PI document (PI_ + 8 digits) lives inside its session: opening a session
//                       lists its PI documents, creates the next one (only while it is open, between its start and end
//                       and until the planned number is reached) and shows its progress report.
//   Statistics          all sessions over a period, year to date by default (from the financial year start).
//   PI document         tap one inside a session to work it through its states:
//                       Created → Printed → Awaiting verification → Verified → Awaiting posting approval
//                       → Approved for posting → Reconciled (or Partially posted while a recount PI is open).
//                       Disregarded / Closed end a session.
//   Configuration       reusable count configurations (type, selection order, PI size, cycle, cluster).
// Separation of duties is enforced by the server (the counter cannot verify, approve or post; whoever requests
// posting cannot approve it; nobody approves their own work). Its 403 messages are shown as they come.
// Variances are valued and approved under the Chart of Authority, level by level, by the job roles mapped to them.
// Counting is blind: the system quantity is not shown until counts are submitted.

interface Config {
    id: string;
    name: string;
    warehouseId: string;
    type: string;
    selection: string;
    /** Older configurations only: sessions now set the materials per PI. */
    documentSize?: number | null;
    periodic: boolean;
    period: string;
    durationDays: number | null;
    clusterId: string;
    active?: boolean;
    byCriticality?: boolean;
    criticalityClasses?: string[];
    /** Cycle count: every material must be counted within each session. */
    fullScope?: boolean;
    /** Cluster stock take: the clusters of the warehouse to count (older configurations hold clusterId). */
    clusterIds?: string[];
    sessionCreation?: 'automatic' | 'manual';
    /** Automatic: every planned PI document is generated once the session is complete. */
    piCreation?: 'automatic' | 'manual';
    lastSessionCreatedAt?: string;
    lastSessionId?: string;
    nextSessionDueOn?: string;
}
interface Line {
    binId: string;
    materialId: string;
    materialNumber: string;
    description: string;
    expected: number | null;
    counted: number | null;
    verified: boolean;
    recount: boolean;
    posted: boolean;
    /** Counts of each sheet when several were printed, and whether they disagree (then a recount is mandatory). */
    copyCounts?: Record<string, number> | null;
    copyMismatch?: boolean;
}
interface AttachmentMeta {
    name: string;
    type: string;
    uploadedBy?: string;
    uploadedAt?: string;
}
interface Session {
    id: string;
    piNumber: string;
    sessionName?: string;
    configName: string;
    warehouseId: string;
    type?: string;
    status: string;
    createdAt: string;
    printedAt?: string;
    countedAt?: string;
    verifiedAt?: string;
    updatedAt?: string;
    lines: Line[];
    parentPi?: string;
    recountPi?: string;
    piAttachment?: AttachmentMeta;
    countEditReason?: string;
    disregardReason?: string;
    closureReason?: string;
    campaignId?: string;
    campaignName?: string;
    /** Independent count sheets printed for this PI (_A, _B …) and what each has submitted. */
    copies?: number;
    copyCounts?: Record<string, { countedAt: string; attachment?: AttachmentMeta }>;
    copyMismatches?: number;
    varianceValue?: number;
    approval?: { amount: number; unvalued?: string[]; steps: CoaStep[] } | null;
    postingReturnReason?: string;
    /** Where the signed-in person has a separation-of-duties conflict on this PI, from the server. */
    you?: {
        testMode: boolean;
        counted: boolean;
        requestedPosting: boolean;
        verifyConflict: boolean;
        approveConflict: boolean;
        postConflict: boolean;
        coa?: { routed: boolean; ok: boolean; why: string; level: string; title: string; positionTitle: string; testMode: boolean };
    };
}
interface CoaStep {
    level: string;
    title: string;
    positionTitle: string;
    status: 'pending' | 'approved';
    by: string;
    at: string;
}
interface Stage {
    key: string;
    label: string;
    done: number;
    total: number;
    pct: number;
}
interface Kpi {
    counted: number;
    errors: number;
    pct: number;
    errorPct: number;
    target: number;
    met: boolean | null;
}
interface Progress {
    phase: string;
    piDocuments: { total: number; live: number; originals: number; planned: number; disregarded: number; recounts: number; closed: number; byStatus: Record<string, number> };
    completionPct: number;
    stages: Stage[];
    materials: { target: number; perPi: number; onPis: number; counted: number; posted: number; noBaseline: number; onPisPct: number; countedPct: number; postedPct: number };
    countAccuracy: Kpi;
    stockAccuracy: Kpi;
    variance: { value: number; tolerance: number; within: boolean | null };
    timeUsedPct: number | null;
}
interface CountSession {
    id: string;
    sessionNumber: string;
    name: string;
    configId: string;
    configName: string;
    type: string;
    selection: string;
    documentSize: number;
    warehouseId: string;
    startAt: string;
    endAt: string;
    metrics: { targetMaterials: number; materialsPerPi: number; countAll?: boolean };
    status: 'open' | 'closed' | 'cancelled';
    createdAt: string;
    closedAt?: string;
    closureReason?: string;
    progress: Progress;
    canCreatePi: boolean;
    whyNoPi: string;
    /** Sessions created by the automation: the plan is completed once before any PI document. */
    setupRequired?: boolean;
    /** Why the automatic PI documents could not be generated (kept until a later run succeeds). */
    autoPiError?: string;
    autoPiErrorAt?: string;
    fullScope?: boolean;
    origin?: 'manual' | 'automatic';
    criticalityClasses?: string[];
    durationDays?: number;
}
interface Data {
    warehouses: Array<{ id: string; name: string }>;
    configs: Config[];
    sessions: Session[];
    countSessions?: CountSession[];
}
interface Upload {
    name: string;
    type: string;
    data: string;
}
type Ask = (options: ConfirmOptions, run: (reason: string) => Promise<void>) => void;
type LineRow = { i: number; line: Line };

const API = '/api/org/inventory/stocktake/';
/** "1 line", "2 lines": counts in messages must read correctly. */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TYPES = ['Cycle Count', 'Full Stock Take', 'Cluster Stock Take', 'Random Stock Take'];
const PERIODS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually'];
const CLOSED = ['reconciled', 'disregarded', 'closed_posted'];
const MAX_UPLOAD_BYTES = 450_000;
const UPLOAD_TYPES: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'] };

const STATUS: Record<string, { label: string; tone: 'brand' | 'muted' | 'danger' | 'warn' }> = {
    awaiting_print: { label: 'Created', tone: 'muted' },
    counting: { label: 'Printed', tone: 'muted' },
    verification: { label: 'Awaiting verification', tone: 'warn' },
    verified: { label: 'Verified', tone: 'brand' },
    pending_post_approval: { label: 'Awaiting posting approval', tone: 'warn' },
    approved_for_posting: { label: 'Approved for posting', tone: 'brand' },
    recount_pending: { label: 'Partially posted (recount pending)', tone: 'warn' },
    posted: { label: 'Posted', tone: 'brand' },
    reconciled: { label: 'Reconciled', tone: 'brand' },
    disregarded: { label: 'Disregarded', tone: 'danger' },
    closed_posted: { label: 'Closed', tone: 'muted' },
};
const statusOf = (status: string) => STATUS[status] ?? { label: status.replace(/_/g, ' '), tone: 'muted' as const };
const PHASE: Record<string, { label: string; tone: 'brand' | 'muted' | 'danger' | 'warn' }> = {
    scheduled: { label: 'Scheduled', tone: 'muted' },
    setup_required: { label: 'Setup needed', tone: 'warn' },
    in_progress: { label: 'In progress', tone: 'brand' },
    overdue: { label: 'Past end date', tone: 'warn' },
    closed: { label: 'Closed', tone: 'muted' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
};
const phaseOf = (p: string) => PHASE[p] ?? { label: p.replace(/_/g, ' '), tone: 'muted' as const };
const fmtWhen = (iso: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '');
const money = (n: number) => (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);
const hasVariance = (l: Line) => l.expected !== l.counted;
const isWhole = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

/** Problem with an entered count ('' when fine). */
function countProblem(value: string | undefined): string {
    const v = (value ?? '').trim();
    if (!v) return 'Required';
    if (!/^\d{1,9}(\.\d{1,4})?$/.test(v)) return 'Enter a number of 0 or more';
    return '';
}

/** Checks the signed PI before it is read: type, extension and size. */
function uploadProblem(file: File): string {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const allowed = UPLOAD_TYPES[file.type];
    if (!allowed || !allowed.includes(ext)) return 'Attach a PDF, JPG or PNG file.';
    if (file.size <= 0) return 'The file is empty.';
    if (file.size > MAX_UPLOAD_BYTES) return `The file is ${Math.ceil(file.size / 1024)} KB; the limit is 450 KB.`;
    return '';
}

function readUpload(file: File): Promise<Upload> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const data = typeof reader.result === 'string' ? reader.result : '';
            if (!data.startsWith(`data:${file.type};base64,`)) reject(new Error('The file could not be read. Choose the signed PI again.'));
            else resolve({ name: file.name.slice(0, 120), type: file.type, data });
        };
        reader.onerror = () => reject(new Error('The file could not be read. Choose the signed PI again.'));
        reader.readAsDataURL(file);
    });
}

/** Fetches the signed PI scan (kept out of the list) and saves it as a file. */
/** Count sheet labels of a PI document: none for one sheet, otherwise A, B, … */
const sheetsOf = (s: Session) => (Number(s.copies) > 1 ? ['A', 'B', 'C', 'D', 'E'].slice(0, Math.min(5, Number(s.copies))) : []);

async function downloadAttachment(id: string, copy = '') {
    const file = await callBackend<Upload>(API + 'attachment', copy ? { id, copy } : { id });
    const match = /^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(file.data || '');
    if (!match) throw new Error('The attached document is not a valid PDF or image.');
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
    const ext = UPLOAD_TYPES[match[1]][0];
    const name = (file.name || '').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `${id}.${ext}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** A PDF copy of the PI count sheet. Counting is blind: no system quantities are printed. */
async function downloadPiPdf(s: Session, warehouse: string) {
    // Several sheets: one PDF per sheet (PI_…_A, PI_…_B …), each counted independently.
    const sheets = sheetsOf(s);
    if (!sheets.length) return downloadPiSheet(s, warehouse, s.piNumber);
    for (const c of sheets) await downloadPiSheet(s, warehouse, `${s.piNumber}_${c}`);
}

function downloadPiSheet(s: Session, warehouse: string, label: string) {
    const blind = s.status === 'awaiting_print' || s.status === 'counting';
    return downloadReportPdf({
        title: `PI document ${label}`,
        subtitle: [s.campaignId ? `Session ${s.campaignId}${s.campaignName ? ` - ${s.campaignName}` : ''}` : '', s.sessionName || s.configName].filter(Boolean).join(' · '),
        fileName: label,
        sections: [
            {
                heading: 'Document',
                facts: [
                    ['PI document', label],
                    ...(label !== s.piNumber ? ([['Count sheet', `${label.slice(-1)} of ${sheetsOf(s).length} (counted independently)`]] as Array<[string, string]>) : []),
                    ['Warehouse', warehouse],
                    ['Configuration', s.configName],
                    ['Type', s.type || ''],
                    ['Created', fmtDate(s.createdAt)],
                    ['Locations', String(s.lines.length)],
                ],
            },
            {
                heading: 'Count sheet',
                table: {
                    head: blind ? ['#', 'Physical location', 'Material', 'Description', 'Counted'] : ['#', 'Physical location', 'Material', 'Description', 'System qty', 'Counted'],
                    body: s.lines.map((l, i) => [String(i + 1), l.binId, l.materialNumber, l.description, ...(blind ? [] : [l.expected === null ? '' : String(l.expected)]), blind || label !== s.piNumber ? (label !== s.piNumber && l.copyCounts ? String(l.copyCounts[label.slice(-1)] ?? '') : '') : l.counted === null ? '' : String(l.counted)]),
                },
            },
            { heading: 'Signatures', text: 'Counted by: ______________________  Date: __________\n\nVerified by: _____________________  Date: __________' },
        ],
    });
}

export default function StockTake() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>(API + 'list'));
    const [view, setView] = useState<'sessions' | 'stats' | 'config'>('sessions');
    const [legacyOpen, setLegacyOpen] = useState(false);
    const [showClosedSessions, setShowClosedSessions] = useState(false);
    const [openId, setOpenId] = useState('');
    const [openSessionId, setOpenSessionId] = useState('');
    const [planning, setPlanning] = useState(false);
    const [creating, setCreating] = useState<CountSession | null>(null);
    const [editing, setEditing] = useState<Config | 'new' | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    const warehouseName = useMemo(() => new Map((data?.warehouses ?? []).map((w) => [w.id, w.name])), [data]);
    const allSessions = data?.sessions ?? [];
    // PI documents made before sessions existed: shown together under one entry so none is left unreachable.
    const legacyPis = useMemo(() => (data?.sessions ?? []).filter((s) => !s.campaignId), [data]);
    const configs = useMemo(() => data?.configs ?? [], [data]);
    const opened = allSessions.find((s) => s.id === openId) ?? null;
    const allCountSessions = data?.countSessions ?? [];
    const countSessions = useMemo(() => (data?.countSessions ?? []).filter((c) => showClosedSessions || c.status === 'open'), [data, showClosedSessions]);
    const closedSessionCount = allCountSessions.filter((c) => c.status !== 'open').length;
    const openedSession = allCountSessions.find((c) => c.id === openSessionId) ?? null;

    const done = (message: string) => {
        setNotice(message);
        reload();
    };

    const countSessionColumns = useMemo<Array<Column<CountSession>>>(
        () => [
            { key: 'number', label: 'Session', value: (c) => c.sessionNumber, render: (c) => <span className='font-mono text-xs font-semibold text-brandsoft'>{c.sessionNumber}</span> },
            { key: 'name', label: 'Name', value: (c) => c.name },
            { key: 'phase', label: 'Status', value: (c) => phaseOf(c.progress.phase).label, render: (c) => <Badge tone={phaseOf(c.progress.phase).tone}>{phaseOf(c.progress.phase).label}</Badge> },
            { key: 'warehouse', label: 'Warehouse', value: (c) => warehouseName.get(c.warehouseId) || c.warehouseId },
            { key: 'config', label: 'Configuration', value: (c) => c.configName },
            { key: 'type', label: 'Type', value: (c) => c.type, hidden: true },
            { key: 'start', label: 'Start', type: 'date', value: (c) => c.startAt, render: (c) => fmtWhen(c.startAt) },
            { key: 'end', label: 'End', type: 'date', value: (c) => c.endAt || null, render: (c) => (c.endAt ? fmtWhen(c.endAt) : 'Open-ended') },
            { key: 'pis', label: 'PI documents', type: 'number', value: (c) => c.progress.piDocuments.originals, render: (c) => `${c.progress.piDocuments.originals}/${c.progress.piDocuments.planned}` },
            { key: 'materials', label: 'Materials to count', type: 'number', value: (c) => c.progress.materials.target, hidden: true },
            { key: 'perPi', label: 'Materials per PI', type: 'number', value: (c) => c.progress.materials.perPi, hidden: true },
            { key: 'completion', label: 'Completion %', type: 'number', value: (c) => c.progress.completionPct },
            { key: 'printed', label: 'Printed %', type: 'number', value: (c) => c.progress.stages.find((x) => x.key === 'printing')?.pct ?? 0, hidden: true },
            { key: 'counted', label: 'Counted %', type: 'number', value: (c) => c.progress.stages.find((x) => x.key === 'counting')?.pct ?? 0 },
            { key: 'posted', label: 'Posted %', type: 'number', value: (c) => c.progress.stages.find((x) => x.key === 'posting')?.pct ?? 0 },
            { key: 'countAcc', label: 'Count accuracy %', type: 'number', value: (c) => c.progress.countAccuracy.pct, hidden: true },
            { key: 'stockAcc', label: 'Stock accuracy %', type: 'number', value: (c) => c.progress.stockAccuracy.pct, hidden: true },
            { key: 'variance', label: 'Variance value', type: 'number', value: (c) => c.progress.variance.value, hidden: true },
            { key: 'created', label: 'Created', type: 'date', value: (c) => c.createdAt, render: (c) => fmtDate(c.createdAt), hidden: true },
        ],
        [warehouseName]
    );

    const configColumns = useMemo<Array<Column<Config>>>(
        () => [
            { key: 'id', label: 'Configuration ID', value: (c) => c.id, render: (c) => <span className='font-mono text-xs font-semibold'>{c.id}</span> },
            { key: 'name', label: 'Name', value: (c) => c.name },
            { key: 'type', label: 'Type', value: (c) => c.type },
            { key: 'selection', label: 'Selection', value: (c) => c.selection },
            { key: 'duration', label: 'Duration days', type: 'number', value: (c) => c.durationDays, render: (c) => (c.type === 'Cycle Count' ? 'To period end' : c.durationDays ?? '') },
            { key: 'fullScope', label: 'Full scope', value: (c) => (c.type === 'Cycle Count' ? (c.fullScope ? 'Yes' : 'No') : ''), hidden: true },
            { key: 'clusters', label: 'Clusters', value: (c) => (c.clusterIds?.length ? c.clusterIds : c.clusterId ? [c.clusterId] : []).join(', '), hidden: true },
            { key: 'criticality', label: 'Criticality', value: (c) => (c.byCriticality ? (c.criticalityClasses ?? []).join(', ') : 'All') },
            { key: 'creation', label: 'Sessions', value: (c) => (c.periodic ? (c.sessionCreation === 'automatic' ? 'Automatic' : 'Manual') : 'Manual') },
            { key: 'nextDue', label: 'Next session due', type: 'date', value: (c) => c.nextSessionDueOn || null, hidden: true },
            { key: 'lastCreated', label: 'Last session created', type: 'date', value: (c) => c.lastSessionCreatedAt || null, render: (c) => (c.lastSessionCreatedAt ? fmtWhen(c.lastSessionCreatedAt) : ''), hidden: true },
            { key: 'frequency', label: 'Frequency', value: (c) => (c.periodic ? c.period : 'On demand') },
            { key: 'cluster', label: 'Cluster', value: (c) => c.clusterId || '' },
            { key: 'status', label: 'Status', value: (c) => (c.active === false ? 'Disabled' : 'Enabled'), render: (c) => <Badge tone={c.active === false ? 'muted' : 'brand'}>{c.active === false ? 'Disabled' : 'Enabled'}</Badge> },
        ],
        []
    );

    return (
        <>
            <Screen
                title='Stock take'
                eyebrow='Inventory · INV'
                subtitle='Stock take sessions, PI documents and count configurations'
                actions={
                    view === 'sessions' ? (
                        <Button onClick={() => setPlanning(true)} disabled={!data}>
                            <Plus className='h-4 w-4' /> New session
                        </Button>
                    ) : view === 'config' ? (
                        <Button onClick={() => setEditing('new')} disabled={!data}>
                            <Plus className='h-4 w-4' /> New config
                        </Button>
                    ) : undefined
                }
                toolbar={
                    <Segmented
                        label='Stock take views'
                        value={view}
                        onChange={(v) => {
                            setView(v);
                            setNotice('');
                        }}
                        options={[
                            { value: 'sessions', label: 'Active sessions', count: allCountSessions.length - closedSessionCount },
                            { value: 'stats', label: 'Statistics' },
                            { value: 'config', label: 'Configuration', count: configs.length },
                        ]}
                    />
                }
            >
                {error && <Alert tone='error'>{error}</Alert>}
                {notice && !opened && <Alert tone='success'>{notice}</Alert>}
                {!data && loading ? (
                    <Spinner />
                ) : view === 'sessions' ? (
                    <>
                        <div className='flex items-center gap-1'>
                            <label className='flex min-h-[44px] items-center gap-3'>
                                <Toggle checked={showClosedSessions} onChange={setShowClosedSessions} label='Show closed stock take sessions' />
                                <span className='text-sm text-soft'>Show closed sessions ({closedSessionCount})</span>
                            </label>
                            <InfoTip label='Stock take sessions'>Start every stock take by creating a session: choose the configuration, warehouse, start and optional end, and the targets it is measured against. Open a session to create its PI documents and see its progress report.</InfoTip>
                        </div>
                        <RichTable
                            id='inv.stocktake.countsessions'
                            title='Stock take sessions'
                            fileName='Stock_take_count_sessions'
                            columns={countSessionColumns}
                            rows={countSessions}
                            rowKey={(c) => c.id}
                            onRowClick={(c) => {
                                setNotice('');
                                setOpenSessionId(c.id);
                            }}
                            empty={showClosedSessions ? 'No stock take sessions yet. Tap New session to plan one.' : 'No active stock take sessions. Tap New session to plan one.'}
                            height={legacyPis.length ? 'h-[calc(100dvh-24rem)]' : 'h-[calc(100dvh-20rem)]'}
                        />
                        {legacyPis.length > 0 && (
                            <button type='button' onClick={() => setLegacyOpen(true)} className='flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-line bg-panel px-3 text-left text-sm text-soft active:bg-page'>
                                <span>{count(legacyPis.length, 'PI document')} created before sessions</span>
                                <span className='text-brandsoft'>Open</span>
                            </button>
                        )}
                    </>
                ) : view === 'stats' ? (
                    <Statistics warehouseName={warehouseName} />
                ) : (
                    <RichTable
                        id='inv.stocktake.configs'
                        title='Stock take configurations'
                        fileName='Stock_take_configurations'
                        columns={configColumns}
                        rows={configs}
                        rowKey={(c) => c.id}
                        onRowClick={(c) => {
                            setNotice('');
                            setEditing(c);
                        }}
                        empty='No configurations yet.'
                        height='h-[calc(100dvh-17rem)]'
                    />
                )}
            </Screen>

            {openedSession && data && (
                <CountSessionPanel
                    key={openedSession.id}
                    session={openedSession}
                    pis={allSessions.filter((p) => p.campaignId === openedSession.id)}
                    autoPis={data.configs.find((x) => x.id === openedSession.configId)?.piCreation === 'automatic'}
                    warehouse={warehouseName.get(openedSession.warehouseId) || openedSession.warehouseId}
                    notice={opened ? '' : notice}
                    ask={confirm.ask}
                    onNewPi={() => setCreating(openedSession)}
                    onOpenPi={(id) => {
                        setNotice('');
                        setOpenId(id);
                    }}
                    onDone={done}
                    onClose={() => {
                        setOpenSessionId('');
                        setNotice('');
                    }}
                />
            )}
            {legacyOpen && (
                <LegacyPanel
                    pis={legacyPis}
                    warehouseName={warehouseName}
                    onOpenPi={(id) => {
                        setNotice('');
                        setOpenId(id);
                    }}
                    onClose={() => setLegacyOpen(false)}
                />
            )}
            {planning && data && (
                <PlanSessionPanel
                    data={data}
                    ask={confirm.ask}
                    onClose={() => setPlanning(false)}
                    onCreated={(id, extra) => {
                        setPlanning(false);
                        setNotice(`Stock take session ${id} created.${extra || ' Create its PI documents from here.'}`);
                        setOpenSessionId(id);
                        reload();
                    }}
                />
            )}
            {opened && data && (
                <>
                    <SessionPanel
                        key={`${opened.id}|${opened.status}|${opened.updatedAt ?? ''}`}
                        session={opened}
                        warehouse={warehouseName.get(opened.warehouseId) || opened.warehouseId}
                        notice={notice}
                        ask={confirm.ask}
                        onDone={done}
                        onClose={() => {
                            setOpenId('');
                            setNotice('');
                        }}
                    />
                    <PrintablePi session={opened} warehouse={warehouseName.get(opened.warehouseId) || opened.warehouseId} />
                </>
            )}
            {creating && data && (
                <CreatePanel
                    session={creating}
                    warehouse={warehouseName.get(creating.warehouseId) || creating.warehouseId}
                    onClose={() => setCreating(null)}
                    onCreated={(id) => {
                        setCreating(null);
                        setNotice(`PI ${id} created. Print it, count, then submit the counts with the signed PI.`);
                        setOpenId(id);
                        reload();
                    }}
                />
            )}
            {editing && (
                <ConfigPanel
                    config={editing === 'new' ? null : editing}
                    warehouses={data?.warehouses ?? []}
                    ask={confirm.ask}
                    onClose={() => setEditing(null)}
                    onDone={(message) => {
                        setEditing(null);
                        done(message);
                    }}
                />
            )}
            {confirm.sheet}
        </>
    );
}

/** Full-height panel: a full screen sheet on phones, a side panel on larger screens. Actions stay on top. */
function Panel({ title, eyebrow, subtitle, actions, onClose, children }: { title: string; eyebrow?: string; subtitle?: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode }) {
    return (
        <div className='fixed inset-0 z-[90] flex justify-end' role='presentation'>
            <button type='button' aria-label='Close' tabIndex={-1} className='absolute inset-0 hidden bg-black/60 sm:block' onClick={onClose} />
            <section role='dialog' aria-modal='true' aria-label={title} className='relative flex h-full w-full flex-col bg-page sm:max-w-3xl sm:border-l sm:border-line'>
                <header className='shrink-0 space-y-2 border-b border-line bg-page p-3 pt-[max(0.75rem,env(safe-area-inset-top))]'>
                    <div className='flex items-center gap-2'>
                        <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                            <X className='h-5 w-5' />
                        </button>
                        <div className='min-w-0 flex-1'>
                            {eyebrow && <p className='truncate font-mono text-xs text-brandsoft'>{eyebrow}</p>}
                            <h2 className='truncate text-base font-semibold text-ink'>{title}</h2>
                            {subtitle && <div className='truncate text-xs text-muted'>{subtitle}</div>}
                        </div>
                    </div>
                    {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
                </header>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]'>{children}</div>
            </section>
        </div>
    );
}

function Problems({ items }: { items: string[] }) {
    if (!items.length) return null;
    return (
        <div role='status' className='rounded-lg bg-amber-500/10 p-3 text-sm text-amber-300'>
            <p className='font-medium'>Before you can continue:</p>
            <ul className='mt-1 list-disc space-y-0.5 pl-5'>
                {items.map((p) => (
                    <li key={p}>{p}</li>
                ))}
            </ul>
        </div>
    );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className='min-w-0'>
            <dt className='text-xs text-muted'>{label}</dt>
            <dd className='break-words text-sm text-ink'>{children}</dd>
        </div>
    );
}

// ---------------------------------------------------------------------------
// One PI document: the action for its current status sits on top.
// ---------------------------------------------------------------------------

function SessionPanel({ session: s, warehouse, notice, ask, onDone, onClose }: { session: Session; warehouse: string; notice: string; ask: Ask; onDone: (message: string) => void; onClose: () => void }) {
    const st = s.status;
    const [printed, setPrinted] = useState(false);
    const [editingCounts, setEditingCounts] = useState(false);
    const [counts, setCounts] = useState<Record<number, string>>({});
    // Lines where the count sheets disagree must be recounted: they start selected and cannot be unticked.
    const forced = s.lines.map((l, i) => (l.copyMismatch ? i : -1)).filter((i) => i >= 0);
    const [recounts, setRecounts] = useState<number[]>(forced);
    const sheets = sheetsOf(s);
    const submittedSheets = sheets.filter((c) => !!s.copyCounts?.[c]);
    const [sheet, setSheet] = useState(() => sheets.find((c) => !s.copyCounts?.[c]) ?? '');
    const [upload, setUpload] = useState<Upload | null>(null);
    const [uploadError, setUploadError] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [panelError, setPanelError] = useState('');

    const closed = CLOSED.includes(st);
    const anyPosted = s.lines.some((l) => l.posted);
    const blind = st === 'awaiting_print' || st === 'counting';
    const entering = st === 'counting' || (st === 'verification' && editingCounts);
    const canPrint = !['posted', 'reconciled', 'closed_posted', 'disregarded'].includes(st);
    const canDisregard = !['reconciled', 'disregarded', 'posted', 'recount_pending', 'closed_posted'].includes(st) && !anyPosted;
    const canClosePosted = (st === 'posted' || anyPosted) && !closed;
    const varianceLines = s.lines.filter((l) => hasVariance(l)).length;
    const flagged = s.lines.filter((l) => l.recount && !l.posted).length;
    const postable = s.lines.filter((l) => l.verified && !l.recount && !l.posted).length;
    // Separation of duties: the server enforces it; here the person is told before tapping. In platform test mode a
    // super administrator may complete the step alone (development only; the server records it in the audit trail).
    const you = s.you;
    const testMode = you?.testMode === true;
    const verifyBarred = !!you?.verifyConflict && !testMode;
    // Chart of Authority: where the variances were routed through it, only a holder of the current level's job role
    // (not the counter, the requester or an earlier approver) may approve.
    const coa = you?.coa;
    const coaRouted = !!coa?.routed;
    const coaBarred = coaRouted && st === 'pending_post_approval' && !coa?.ok;
    const approveBarred = (!!you?.approveConflict && !testMode) || coaBarred;
    const steps = s.approval?.steps ?? [];
    const postBarred = !!you?.postConflict && !testMode;
    const whyYou = (c: boolean, r: boolean) => (c && r ? 'counted this PI and submitted it for posting' : c ? 'counted this PI' : 'submitted this PI for posting');

    const missing = s.lines.filter((_, i) => countProblem(counts[i]) === 'Required').length;
    const invalid = s.lines.filter((_, i) => countProblem(counts[i]) && countProblem(counts[i]) !== 'Required').length;
    const countProblems = [
        ...(missing ? [`${missing} of ${count(s.lines.length, 'location')} still ${missing === 1 ? 'needs' : 'need'} a count.`] : []),
        ...(invalid ? [`${count(invalid, 'count')} ${invalid === 1 ? 'is' : 'are'} not a valid number of 0 or more.`] : []),
        ...(st === 'counting' && !upload ? ['Attach the signed PI document (PDF, JPG or PNG, up to 450 KB).'] : []),
    ];
    const countValues = () => s.lines.map((_, i) => (counts[i] ?? '').trim());
    const act = (action: string, extra: Record<string, unknown> = {}) => callBackend<{ ok: boolean; id?: string }>(API + 'action', { id: s.id, action, ...extra });

    const run = (options: ConfirmOptions, action: string, message: (r: { ok: boolean; id?: string }) => string, extra: (reason: string) => Record<string, unknown> = () => ({})) =>
        ask(options, async (reason) => {
            const result = await act(action, extra(reason));
            onDone(message(result));
        });

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file: File | undefined = e.target.files?.[0];
        e.target.value = '';
        setUpload(null);
        setUploadError('');
        if (!file) return;
        const problem = uploadProblem(file);
        if (problem) return setUploadError(problem);
        try {
            setUpload(await readUpload(file));
        } catch (err) {
            setUploadError(messageOf(err));
        }
    };

    const download = async (copy = '') => {
        setDownloading(true);
        setPanelError('');
        try {
            await downloadAttachment(s.id, copy);
        } catch (err) {
            setPanelError(messageOf(err));
        } finally {
            setDownloading(false);
        }
    };

    const startEdit = () => {
        setCounts(Object.fromEntries(s.lines.map((l, i) => [i, l.counted === null ? '' : String(l.counted)])));
        setEditingCounts(true);
    };

    // Actions for the current status: the primary one first.
    const actions: ReactNode[] = [];
    if (st === 'awaiting_print') {
        actions.push(
            <Button
                key='printed'
                disabled={!printed}
                onClick={() =>
                    run({ title: `Confirm ${s.piNumber} printed?`, message: 'The PI moves to Printed and counts can be entered. Confirm only once the printed document is in the counters’ hands.', confirmLabel: 'Confirm printed' }, 'printed', () => `${s.piNumber} marked as printed.`)
                }
            >
                <CheckCircle2 className='h-4 w-4' /> Confirm printed
            </Button>
        );
    }
    if (st === 'counting') {
        actions.push(
            <Button
                key='counts'
                disabled={countProblems.length > 0 || (sheets.length > 0 && (!sheet || !!s.copyCounts?.[sheet]))}
                onClick={() =>
                    run(
                        {
                            title: sheets.length ? `Submit sheet ${s.piNumber}_${sheet}?` : 'Submit counts and signed PI?',
                            message: sheets.length
                                ? `${count(s.lines.length, 'count')} of sheet _${sheet} and its signed copy “${upload?.name ?? ''}” are submitted. Each sheet must be counted by a different person; where the sheets disagree a recount is mandatory.`
                                : `${count(s.lines.length, 'count')} and the signed PI “${upload?.name ?? ''}” are submitted. Another person must verify them; you will not be able to verify, approve or post this PI.`,
                            confirmLabel: 'Submit counts',
                            acknowledge: 'Every location listed was physically counted and the attached document is the signed PI.',
                        },
                        'counts',
                        () => (sheets.length ? `Sheet ${s.piNumber}_${sheet} submitted.${submittedSheets.length + 1 < sheets.length ? ' Waiting for the other sheets.' : ' All sheets are in; ready for verification.'}` : `Counts for ${s.piNumber} submitted for verification.`),
                        () => ({ counts: countValues(), attachment: upload, ...(sheets.length ? { copy: sheet } : {}) })
                    )
                }
            >
                <Send className='h-4 w-4' /> Submit counts
            </Button>
        );
    }
    if (st === 'verification' && editingCounts) {
        actions.push(
            <Button
                key='save-counts'
                disabled={countProblems.length > 0}
                onClick={() =>
                    run(
                        { title: 'Save corrected counts?', message: 'The corrected counts replace the submitted ones. The correction and your reason are recorded in the audit trail; you will not be able to verify this PI.', confirmLabel: 'Save corrections', reason: { label: 'Correction reason', minLength: 10, placeholder: 'Why are the counts being corrected?' } },
                        'edit_counts',
                        () => `Corrected counts saved for ${s.piNumber}.`,
                        (reason) => ({ counts: countValues(), reason })
                    )
                }
            >
                <Save className='h-4 w-4' /> Save corrected counts
            </Button>,
            <Button key='cancel-edit' variant='secondary' onClick={() => setEditingCounts(false)}>
                Cancel edit
            </Button>
        );
    }
    if (st === 'verification' && !editingCounts) {
        actions.push(
            <Button
                key='verify'
                disabled={verifyBarred}
                onClick={() =>
                    run(
                        {
                            title: 'Accept verification?',
                            message: `${recounts.length} of ${count(varianceLines, 'line')} with a variance ${recounts.length === 1 ? 'is' : 'are'} flagged for recount; all other lines become verified and ready to submit for posting. ${testMode && you?.verifyConflict ? 'Test mode is on for your organization, so you may verify counts you made; this is recorded in the audit trail.' : 'Counts must be verified by someone other than the person who counted or corrected them.'}`,
                            confirmLabel: 'Accept verification',
                        },
                        'verify',
                        () => `${s.piNumber} verified.`,
                        () => ({ recountIndices: [...recounts].sort((a, b) => a - b) })
                    )
                }
            >
                <ClipboardCheck className='h-4 w-4' /> Accept verification
            </Button>,
            <Button key='edit' variant='secondary' onClick={startEdit}>
                <Pencil className='h-4 w-4' /> Edit counts
            </Button>
        );
    }
    if (st === 'verified') {
        if (postable > 0) {
            actions.push(
                <Button
                    key='submit-posting'
                    onClick={() =>
                        run(
                            {
                                title: 'Submit for posting approval?',
                                message: `${count(postable, 'verified line')} (not flagged for recount) ${postable === 1 ? 'is' : 'are'} sent for posting approval. Any differences are valued at moving average and approved under the Chart of Authority, level by level. ${testMode ? 'Test mode is on for your organization, so you may approve it yourself; this is recorded in the audit trail.' : 'Someone other than you and the counter must approve before stock is posted.'}`,
                                confirmLabel: 'Submit for approval',
                            },
                            'submit_posting',
                            () => `${s.piNumber} submitted for posting approval.`
                        )
                    }
                >
                    <Send className='h-4 w-4' /> Submit for posting approval
                </Button>
            );
        }
        if (s.lines.some((l) => l.recount) && !s.recountPi) {
            actions.push(
                <Button
                    key='recount'
                    variant='secondary'
                    onClick={() =>
                        run({ title: 'Create recount PI?', message: `A new PI document is created for the ${count(flagged, 'line')} flagged for recount, with the current system quantities.`, confirmLabel: 'Create recount PI' }, 'recount', (r) => `Recount PI ${r.id ?? ''} created.`)
                    }
                >
                    <RotateCcw className='h-4 w-4' /> Create recount PI
                </Button>
            );
        }
        actions.push(
            <Button
                key='baseline'
                variant='secondary'
                onClick={() =>
                    run(
                        { title: 'Recheck stock baseline?', message: 'System quantities are reloaded from current reconciled stock for lines not posted or flagged for recount. The PI returns to Awaiting verification and must be verified again.', confirmLabel: 'Recheck baseline' },
                        'refresh_baseline',
                        () => `Baseline rechecked for ${s.piNumber}; verify it again.`
                    )
                }
            >
                <RefreshCw className='h-4 w-4' /> Recheck baseline
            </Button>
        );
    }
    if (st === 'pending_post_approval') {
        actions.push(
            <Button
                key='approve'
                disabled={approveBarred}
                onClick={() =>
                    run(
                        {
                            title: coaRouted ? `Approve level ${coa?.level ?? ''}?` : 'Approve posting?',
                            message: `${coaRouted ? `You approve level ${coa?.level} (${coa?.title}) for a variance value of ${money(s.varianceValue ?? 0)}. ${steps.filter((x) => x.status === 'pending').length > 1 ? 'The next level must then approve before posting.' : `${count(postable, 'line')} will then be released for posting to the material journal.`}` : `${count(postable, 'line')} will be released for posting to the material journal.`} ${testMode && (you?.approveConflict || coa?.testMode) ? 'Test mode is on for your organization, so you may approve this yourself; this is recorded in the audit trail.' : 'You cannot approve a PI you counted or submitted for posting.'}`,
                            confirmLabel: coaRouted ? `Approve ${coa?.level ?? ''}` : 'Approve posting',
                            acknowledge: 'I have reviewed the counts and variances of this PI and approve them for posting.',
                        },
                        'approve_posting',
                        () => `Posting of ${s.piNumber} approved.`
                    )
                }
            >
                <ShieldCheck className='h-4 w-4' /> {coaRouted ? `Approve ${coa?.level ?? ''}` : 'Approve posting'}
            </Button>,
            <Button
                key='return'
                variant='secondary'
                disabled={approveBarred}
                onClick={() =>
                    run(
                        { title: 'Return for review?', message: 'The posting request is withdrawn and the PI goes back to Verified, so the counts can be rechecked or recounted and submitted again. Approvals already given are cleared.', confirmLabel: 'Return', reason: { label: 'Reason for returning', minLength: 10 } },
                        'reject_posting',
                        () => `${s.piNumber} returned to Verified.`,
                        (reason) => ({ reason })
                    )
                }
            >
                <Undo2 className='h-4 w-4' /> Return
            </Button>
        );
    }
    if (st === 'approved_for_posting') {
        actions.push(
            <Button
                key='post'
                disabled={postBarred}
                onClick={() =>
                    run(
                        {
                            title: 'Post and reconcile?',
                            message: `Stock adjustments for ${count(postable, 'line')} are posted to the material journal and the PI is reconciled${flagged ? ` (${count(flagged, 'recount line')} ${flagged === 1 ? 'stays' : 'stay'} open)` : ''}. Posting cannot be undone.`,
                            confirmLabel: 'Post & reconcile',
                            acknowledge: 'I understand this posts stock adjustments to the material journal and cannot be undone.',
                        },
                        'post',
                        () => `${s.piNumber} posted and reconciled.`
                    )
                }
            >
                <CheckCircle2 className='h-4 w-4' /> Post & reconcile
            </Button>
        );
    }
    // Printing (secondary) follows the status action; closing and disregarding come last.
    if (canPrint) {
        actions.push(
            <Button
                key='print'
                variant='secondary'
                busy={downloading}
                onClick={async () => {
                    setPrinted(true);
                    setPanelError('');
                    setDownloading(true);
                    try {
                        await downloadPiPdf(s, warehouse);
                    } catch (err) {
                        setPanelError(`The PDF copy could not be saved: ${messageOf(err)}`);
                    } finally {
                        setDownloading(false);
                    }
                    window.print();
                }}
            >
                <Printer className='h-4 w-4' /> Print and download PDF
            </Button>
        );
    }
    if (canClosePosted) {
        actions.push(
            <Button
                key='close-posted'
                variant='secondary'
                onClick={() =>
                    run(
                        { title: 'Close this posted PI?', message: 'The PI document is closed. Posted stock movements stay as they are; open recount PIs must be closed first.', confirmLabel: 'Close PI', reason: { label: 'Closure reason', minLength: 10 } },
                        'close_posted',
                        () => `${s.piNumber} closed.`,
                        (reason) => ({ reason })
                    )
                }
            >
                <XCircle className='h-4 w-4' /> Close posted PI
            </Button>
        );
    }
    if (canDisregard) {
        actions.push(
            <Button
                key='disregard'
                variant='danger'
                onClick={() =>
                    run(
                        { title: 'Disregard this PI?', message: 'The PI document is closed without posting any stock. This cannot be reopened.', confirmLabel: 'Disregard PI', tone: 'danger', reason: { label: 'Reason for disregarding', minLength: 10, placeholder: 'Explain why this PI session should be closed' } },
                        'disregard',
                        () => `${s.piNumber} disregarded.`,
                        (reason) => ({ reason })
                    )
                }
            >
                <Trash2 className='h-4 w-4' /> Disregard
            </Button>
        );
    }

    const rows = useMemo<LineRow[]>(() => s.lines.map((line, i) => ({ i, line })), [s]);
    const columns: Array<Column<LineRow>> = [
        { key: 'no', label: '#', type: 'number', value: (r) => r.i + 1 },
        { key: 'bin', label: 'Physical location', value: (r) => r.line.binId, render: (r) => <span className='font-mono text-xs'>{r.line.binId}</span> },
        { key: 'material', label: 'Material', value: (r) => r.line.materialNumber },
        ...(blind
            ? []
            : ([
                  { key: 'expected', label: 'System qty', type: 'number', value: (r) => r.line.expected, render: (r) => (r.line.expected === null ? <span className='text-amber-300'>Unavailable</span> : r.line.expected) },
              ] as Array<Column<LineRow>>)),
        entering
            ? {
                  key: 'count',
                  label: 'Count *',
                  value: (r) => counts[r.i] ?? '',
                  render: (r) => {
                      const problem = countProblem(counts[r.i]);
                      const shown = problem && problem !== 'Required' ? problem : '';
                      return (
                          <span className='block'>
                              <input
                                  aria-label={`Count for ${r.line.binId}`}
                                  aria-invalid={shown ? true : undefined}
                                  inputMode='decimal'
                                  autoComplete='off'
                                  maxLength={14}
                                  value={counts[r.i] ?? ''}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                      const v = e.target.value;
                                      setCounts((c) => ({ ...c, [r.i]: v }));
                                  }}
                                  className={`h-11 w-28 rounded-lg border bg-page px-2 text-base text-ink focus:outline-none ${shown ? 'border-red-500/70' : 'border-line focus:border-brand'}`}
                              />
                              {shown && <span className='mt-0.5 block text-xs text-red-300'>{shown}</span>}
                          </span>
                      );
                  },
              }
            : { key: 'count', label: 'Count', type: 'number', value: (r) => r.line.counted },
        ...(blind
            ? []
            : ([
                  {
                      key: 'variance',
                      label: 'Variance',
                      type: 'number',
                      value: (r) => (r.line.expected === null || r.line.counted === null ? null : r.line.counted - r.line.expected),
                      render: (r) => {
                          if (r.line.counted === null) return '';
                          if (r.line.expected === null) return <span className='text-amber-300'>No baseline</span>;
                          const v = r.line.counted - r.line.expected;
                          return <span className={v === 0 ? 'text-soft' : 'font-semibold text-amber-300'}>{v > 0 ? `+${v}` : v}</span>;
                      },
                  },
              ] as Array<Column<LineRow>>)),
        st === 'verification' && !editingCounts
            ? {
                  key: 'recount',
                  label: 'Recount',
                  value: (r) => (recounts.includes(r.i) ? 'Yes' : ''),
                  render: (r) =>
                      r.line.copyMismatch ? (
                          <span className='flex h-11 items-center gap-2'>
                              <input type='checkbox' className='h-5 w-5 accent-amber-500' checked disabled aria-label='Recount required' />
                              <span className='text-xs font-semibold text-amber-300'>Sheets differ: recount</span>
                          </span>
                      ) : hasVariance(r.line) ? (
                          <label className='flex h-11 items-center gap-2' onClick={(e) => e.stopPropagation()}>
                              <input
                                  type='checkbox'
                                  className='h-5 w-5 accent-emerald-500'
                                  checked={recounts.includes(r.i)}
                                  onChange={(e) => {
                                      const on = e.target.checked;
                                      setRecounts((list) => (on ? [...list.filter((x) => x !== r.i), r.i] : list.filter((x) => x !== r.i || forced.includes(x))));
                                  }}
                              />
                              <span className='text-xs text-soft'>Recount</span>
                          </label>
                      ) : (
                          <span className='text-xs text-muted'>Matches</span>
                      ),
              }
            : { key: 'recount', label: 'Recount', value: (r) => (r.line.recount ? 'Yes' : ''), hidden: blind },
        ...(!blind && sheets.length
            ? sheets.map((c) => ({ key: `sheet-${c}`, label: `Sheet ${c}`, type: 'number' as const, value: (r: LineRow) => r.line.copyCounts?.[c] ?? null }))
            : []),
        { key: 'description', label: 'Description', value: (r) => r.line.description },
        { key: 'posted', label: 'Posted', value: (r) => (r.line.posted ? 'Yes' : 'No'), hidden: blind },
    ];

    const status = statusOf(st);
    return (
        <Panel title={s.sessionName || s.configName} eyebrow={s.piNumber} subtitle={<Badge tone={status.tone}>{status.label}</Badge>} actions={actions.length ? actions : undefined} onClose={onClose}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {panelError && <Alert tone='error'>{panelError}</Alert>}
            {entering && <Problems items={countProblems} />}
            {st === 'awaiting_print' && !printed && <Alert tone='info'>Print the PI first (a PDF copy is downloaded at the same time); then confirm it was printed.</Alert>}
            {st === 'verification' && !editingCounts && verifyBarred && (
                <Alert tone='warn'>You counted or corrected the counts of this PI, so you cannot verify it. Another person with the Stock Take verification permission at this warehouse must verify it.</Alert>
            )}
            {st === 'pending_post_approval' && !!you?.approveConflict && !testMode && (
                <Alert tone='warn'>You {whyYou(!!you?.counted, !!you?.requestedPosting)}, so you cannot approve its posting. Another person with the Stock Take posting approval permission at this warehouse must approve it.</Alert>
            )}
            {st === 'pending_post_approval' && coaBarred && !you?.approveConflict && coa?.why && <Alert tone='warn'>{coa.why}</Alert>}
            {s.postingReturnReason && st === 'verified' && <Alert tone='warn'>Returned from posting approval: {s.postingReturnReason}</Alert>}
            {s.approval && steps.length > 0 && ['pending_post_approval', 'approved_for_posting'].includes(st) && (
                <Card className='space-y-2'>
                    <div className='flex items-baseline justify-between gap-2'>
                        <p className='text-sm font-medium text-ink'>Chart of Authority</p>
                        <p className='text-sm text-soft'>Variance value {money(s.approval.amount)}</p>
                    </div>
                    <ol className='space-y-1.5'>
                        {steps.map((x) => (
                            <li key={x.level} className='flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5'>
                                <span className='min-w-0'>
                                    <span className='block truncate text-sm text-ink'>
                                        {x.level} · {x.title}
                                    </span>
                                    <span className='block truncate text-xs text-muted'>{x.status === 'approved' ? `Approved ${fmtDate(x.at)}` : x.positionTitle}</span>
                                </span>
                                <Badge tone={x.status === 'approved' ? 'brand' : 'warn'}>{x.status === 'approved' ? 'Approved' : 'Pending'}</Badge>
                            </li>
                        ))}
                    </ol>
                    {!!s.approval.unvalued?.length && <p className='text-xs text-amber-300'>No finance cost yet for {s.approval.unvalued.join(', ')}; valued at zero for routing.</p>}
                </Card>
            )}
            {st === 'approved_for_posting' && postBarred && (
                <Alert tone='warn'>You counted this PI, so you cannot post it. Another person with the Stock Take posting permission at this warehouse must post it.</Alert>
            )}
            {testMode &&
                ((st === 'verification' && !editingCounts && you?.verifyConflict) || (st === 'pending_post_approval' && you?.approveConflict) || (st === 'approved_for_posting' && you?.postConflict)) && (
                    <Alert tone='info'>Platform test mode is on for your organization: as super administrator you may complete this step on a PI you worked on yourself. It is recorded in the audit trail.</Alert>
                )}
            {st === 'verification' && !editingCounts && varianceLines > 0 && (
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='min-w-0 flex-1 text-sm text-soft'>
                        {count(varianceLines, 'line')} {varianceLines === 1 ? 'differs' : 'differ'} from the system quantity; tick the ones to recount ({recounts.length} selected).
                    </p>
                    <Button variant='secondary' onClick={() => setRecounts(recounts.length > forced.length ? forced : s.lines.map((l, i) => (hasVariance(l) || l.copyMismatch ? i : -1)).filter((i) => i >= 0))}>
                        {recounts.length > forced.length ? 'Clear selection' : 'Select all variances'}
                    </Button>
                </div>
            )}

            {st === 'counting' && sheets.length > 0 && (
                <Card className='space-y-2'>
                    <p className='text-sm font-medium text-ink'>Count sheets ({submittedSheets.length} of {sheets.length} submitted)</p>
                    <div className='grid grid-cols-3 gap-2'>
                        {sheets.map((c) => {
                            const done = !!s.copyCounts?.[c];
                            return (
                                <button
                                    key={c}
                                    type='button'
                                    disabled={done}
                                    aria-pressed={sheet === c}
                                    onClick={() => {
                                        setSheet(c);
                                        setCounts({});
                                        setUpload(null);
                                    }}
                                    className={`min-h-12 rounded-xl border px-2 text-sm font-semibold ${done ? 'border-line text-emerald-300 opacity-70' : sheet === c ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft active:bg-page'}`}
                                >
                                    {`_${c}`} {done ? '✓' : ''}
                                </button>
                            );
                        })}
                    </div>
                    <p className='text-xs text-muted'>Enter the counts of sheet {s.piNumber}_{sheet || '?'} only. Each sheet is counted by a different person; the system quantities stay hidden until every sheet is in.</p>
                </Card>
            )}
            {st === 'verification' && forced.length > 0 && <Alert tone='warn'>{count(forced.length, 'line')} {forced.length === 1 ? 'differs' : 'differ'} between the count sheets, so a recount is mandatory for {forced.length === 1 ? 'it' : 'them'}.</Alert>}
            {st === 'counting' && (
                <Card className='space-y-2'>
                    <p className='text-sm font-medium text-ink'>Signed PI document *</p>
                    <p className='text-xs text-muted'>Scan or photo of the signed count sheet: PDF, JPG or PNG, up to 450 KB.</p>
                    <label className='flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-medium text-soft active:bg-page'>
                        <FileUp className='h-5 w-5' /> {upload ? 'Replace file' : 'Choose file'}
                        <input type='file' accept='application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png' className='sr-only' onChange={(e) => void onFile(e)} />
                    </label>
                    {uploadError && (
                        <p role='alert' className='text-xs text-red-300'>
                            {uploadError}
                        </p>
                    )}
                    {upload && <p className='break-all text-xs text-emerald-300'>Attached: {upload.name}</p>}
                </Card>
            )}

            <Card>
                <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                    <Detail label='PI document'>{s.piNumber}</Detail>
                    {s.campaignId && <Detail label='Stock take session'>{s.campaignName ? `${s.campaignId} · ${s.campaignName}` : s.campaignId}</Detail>}
                    <Detail label='Configuration'>{s.configName}</Detail>
                    <Detail label='Warehouse'>{warehouse}</Detail>
                    {s.type && <Detail label='Type'>{s.type}</Detail>}
                    <Detail label='Created'>{fmtDate(s.createdAt)}</Detail>
                    {s.printedAt && <Detail label='Printed'>{fmtDate(s.printedAt)}</Detail>}
                    {s.countedAt && <Detail label='Counted'>{fmtDate(s.countedAt)}</Detail>}
                    {s.verifiedAt && <Detail label='Verified'>{fmtDate(s.verifiedAt)}</Detail>}
                    <Detail label='Locations'>{s.lines.length}</Detail>
                    {s.parentPi && <Detail label='Recount of'>{s.parentPi}</Detail>}
                    {s.recountPi && <Detail label='Recount PI'>{s.recountPi}</Detail>}
                </dl>
                {(s.countEditReason || s.disregardReason || s.closureReason) && (
                    <dl className='mt-3 space-y-2 border-t border-line pt-3'>
                        {s.countEditReason && <Detail label='Count correction reason'>{s.countEditReason}</Detail>}
                        {s.disregardReason && <Detail label='Disregard reason'>{s.disregardReason}</Detail>}
                        {s.closureReason && <Detail label='Closure reason'>{s.closureReason}</Detail>}
                    </dl>
                )}
                {s.piAttachment && (
                    <div className='mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3'>
                        <p className='min-w-0 flex-1 break-all text-sm text-soft'>
                            Signed PI: <span className='text-ink'>{s.piAttachment.name}</span>
                            {s.piAttachment.uploadedAt && <span className='block text-xs text-muted'>Uploaded {fmtDate(s.piAttachment.uploadedAt)}</span>}
                        </p>
                        {sheets.length ? (
                            submittedSheets.map((c) => (
                                <Button key={c} variant='secondary' busy={downloading} onClick={() => void download(c)}>
                                    <Download className='h-4 w-4' /> _{c}
                                </Button>
                            ))
                        ) : (
                            <Button variant='secondary' busy={downloading} onClick={() => void download()}>
                                <Download className='h-4 w-4' /> Download
                            </Button>
                        )}
                    </div>
                )}
            </Card>

            <RichTable
                id='inv.stocktake.lines'
                title={`${s.piNumber} lines`}
                fileName={`Stock_take_${s.piNumber}`}
                columns={columns}
                rows={rows}
                rowKey={(r) => String(r.i)}
                empty='This PI has no lines.'
                height='h-[calc(100dvh-14rem)]'
            />
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// New PI document.
// ---------------------------------------------------------------------------

function CreatePanel({ session: c, warehouse, onClose, onCreated }: { session: CountSession; warehouse: string; onClose: () => void; onCreated: (id: string) => void }) {
    const [startBin, setStartBin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const sequence = c.selection === 'Sequence';

    const problems = [...(!c.canCreatePi ? [c.whyNoPi || 'This session is not open for new PI documents.'] : []), ...(startBin.trim().length > 80 ? ['The starting location is too long (80 characters at most).'] : [])];

    const create = async () => {
        if (problems.length) return;
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ ok: boolean; id?: string }>(API + 'start', { sessionId: c.id, startBin: sequence ? startBin.trim() : '' });
            onCreated(r.id ?? '');
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title='New PI document'
            eyebrow={c.sessionNumber}
            subtitle={c.name}
            onClose={onClose}
            actions={
                <Button busy={busy} disabled={problems.length > 0} onClick={() => void create()}>
                    <Plus className='h-4 w-4' /> Create PI
                </Button>
            }
        >
            {error && <Alert tone='error'>{error}</Alert>}
            <Problems items={problems} />
            <Card>
                <dl className='grid grid-cols-2 gap-3'>
                    <Detail label='Stock take session'>{c.sessionNumber}</Detail>
                    <Detail label='Warehouse'>{warehouse}</Detail>
                    <Detail label='Configuration'>{c.configName}</Detail>
                    <Detail label='Type'>{c.type}</Detail>
                    <Detail label='Selection'>{c.selection}</Detail>
                    <Detail label='This PI'>{`${c.progress.piDocuments.originals + 1} of ${c.progress.piDocuments.planned}`}</Detail>
                    <Detail label='Materials on it'>{Math.max(1, Math.min(c.progress.materials.perPi, c.progress.materials.target - c.progress.materials.onPis))}</Detail>
                </dl>
            </Card>
            {sequence ? (
                <Card className='space-y-3'>
                    <Field id='st-new-start' label='Starting physical location' maxLength={80} autoComplete='off' value={startBin} onChange={(e) => setStartBin(e.target.value)} placeholder='First mapped location by default' hint='Leave blank to continue from the first location not yet on a PI of this session.' error={startBin.trim().length > 80 ? 'Too long' : undefined} />
                </Card>
            ) : (
                <Alert tone='info'>Locations are picked at random from the warehouse, so nobody can predict which ones will be counted.</Alert>
            )}
            <Alert tone='info'>Every material picked must already have reconciled stock in this warehouse; otherwise the PI is refused and the materials to fix are named.</Alert>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Stock take session: its PI documents and its progress report.
// ---------------------------------------------------------------------------

function CountSessionPanel({
    session: c,
    pis,
    autoPis,
    warehouse,
    notice,
    ask,
    onNewPi,
    onOpenPi,
    onDone,
    onClose,
}: {
    session: CountSession;
    pis: Session[];
    autoPis: boolean;
    warehouse: string;
    notice: string;
    ask: Ask;
    onNewPi: () => void;
    onOpenPi: (id: string) => void;
    onDone: (message: string) => void;
    onClose: () => void;
}) {
    const [tab, setTab] = useState<'pis' | 'report'>('pis');
    const open = c.status === 'open';
    const openPis = pis.filter((p) => !CLOSED.includes(p.status));
    const anyPosted = pis.some((p) => p.lines.some((l) => l.posted));
    const phase = phaseOf(c.progress.phase);

    const [settingUp, setSettingUp] = useState(false);
    // A session is never closed by hand: it closes itself once all its PI documents are posted. It can be cancelled
    // while nothing is posted and no PI document is open.
    const cancel = () =>
        ask({ title: `Cancel ${c.sessionNumber}?`, message: 'The session is cancelled without any stock posted. No more PI documents can be created in it. This cannot be reopened.', confirmLabel: 'Cancel session', tone: 'danger', reason: { label: 'Reason for cancelling', minLength: 10 } }, async (reason) => {
            await callBackend(API + 'count-session/action', { id: c.id, action: 'cancel', reason });
            onDone(`${c.sessionNumber} cancelled.`);
        });

    const actions: ReactNode[] = [];
    if (open && c.setupRequired) {
        actions.push(
            <Button key='setup' onClick={() => setSettingUp(true)}>
                <Pencil className='h-4 w-4' /> Complete setup
            </Button>
        );
    } else if (open && autoPis) {
        // Automatic configurations: every planned PI document at once (normally done when the session was completed;
        // this retries after a problem such as a missing stock baseline was fixed).
        const remaining = Math.max(0, c.progress.piDocuments.planned - c.progress.piDocuments.originals);
        actions.push(
            <Button
                key='generate'
                disabled={remaining === 0}
                onClick={() =>
                    ask({ title: 'Create PI documents?', message: `The remaining ${count(remaining, 'planned PI document')} of ${c.sessionNumber} are created now from the configuration.`, confirmLabel: 'Create PI documents' }, async () => {
                        const r = await callBackend<{ created: string[] }>(API + 'count-session/generate', { id: c.id });
                        onDone(`${count(r.created.length, 'PI document')} created in ${c.sessionNumber}.`);
                    })
                }
            >
                <Plus className='h-4 w-4' /> Create PI documents{remaining ? ` (${remaining})` : ''}
            </Button>
        );
    } else if (open) {
        actions.push(
            <Button key='new-pi' disabled={!c.canCreatePi} onClick={onNewPi}>
                <Plus className='h-4 w-4' /> New PI document
            </Button>
        );
    }
    if (open && !anyPosted)
        actions.push(
            <Button key='cancel' variant='danger' disabled={openPis.length > 0} onClick={cancel}>
                <Trash2 className='h-4 w-4' /> Cancel session
            </Button>
        );

    const piColumns: Array<Column<Session>> = [
        { key: 'pi', label: 'PI document', value: (p) => p.piNumber, render: (p) => <span className='font-mono text-xs font-semibold text-brandsoft'>{p.piNumber}</span> },
        { key: 'status', label: 'Status', value: (p) => statusOf(p.status).label, render: (p) => <Badge tone={statusOf(p.status).tone}>{statusOf(p.status).label}</Badge> },
        { key: 'lines', label: 'Locations', type: 'number', value: (p) => p.lines.length },
        { key: 'sheets', label: 'Sheets', value: (p) => (sheetsOf(p).length ? sheetsOf(p).map((x) => `_${x}${p.copyCounts?.[x] ? '✓' : ''}`).join(' ') : '1') },
        { key: 'variances', label: 'Variances', type: 'number', value: (p) => p.lines.filter((l) => l.counted !== null && hasVariance(l)).length },
        { key: 'value', label: 'Variance value', type: 'number', value: (p) => p.varianceValue ?? null },
        { key: 'recount', label: 'Recount of', value: (p) => p.parentPi || '', hidden: true },
        { key: 'created', label: 'Created', type: 'date', value: (p) => p.createdAt, render: (p) => fmtDate(p.createdAt) },
    ];

    return (
        <Panel title={c.name} eyebrow={c.sessionNumber} subtitle={<Badge tone={phase.tone}>{phase.label}</Badge>} actions={actions.length ? actions : undefined} onClose={onClose}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {open && c.setupRequired && <Alert tone='warn'>Created automatically on {fmtWhen(c.startAt)}. Complete its setup (name, materials to count, materials per PI and targets) before creating PI documents.</Alert>}
            {open && !c.setupRequired && !c.canCreatePi && <Alert tone='warn'>{c.whyNoPi}</Alert>}
            {open && autoPis && !c.setupRequired && c.autoPiError && (
                <Alert tone='error'>
                    The PI documents could not be generated{c.autoPiErrorAt ? ` (${fmtWhen(c.autoPiErrorAt)})` : ''}: {c.autoPiError} Fix this, then tap Create PI documents; the nightly run also retries.
                </Alert>
            )}
            {open && (
                <Alert tone='info'>
                    {c.progress.piDocuments.live
                        ? `The session closes automatically once all its PI documents are posted (${c.progress.piDocuments.closed} of ${c.progress.piDocuments.live} so far).`
                        : 'The session closes automatically once its PI documents are created and all of them are posted.'}
                </Alert>
            )}
            {settingUp && <SetupSessionPanel session={c} autoPis={autoPis} ask={ask} onClose={() => setSettingUp(false)} onDone={(m) => (setSettingUp(false), onDone(m))} />}
            {c.closureReason && <Alert tone='info'>{c.status === 'cancelled' ? 'Cancelled' : 'Closed'} {c.closedAt ? fmtWhen(c.closedAt) : ''}: {c.closureReason}</Alert>}
            <Segmented
                label='Session views'
                value={tab}
                onChange={setTab}
                options={[
                    { value: 'pis', label: 'PI documents', count: pis.length },
                    { value: 'report', label: 'Progress report' },
                ]}
            />
            {tab === 'pis' ? (
                <>
                    <Card>
                        <dl className='grid grid-cols-2 gap-3'>
                            <Detail label='Warehouse'>{warehouse}</Detail>
                            <Detail label='Configuration'>{c.configName}</Detail>
                            <Detail label='Start'>{fmtWhen(c.startAt)}</Detail>
                            <Detail label='End'>{c.endAt ? fmtWhen(c.endAt) : 'Open-ended'}</Detail>
                            <Detail label='Materials to count'>{c.setupRequired ? 'Not set yet' : c.progress.materials.target}</Detail>
                            <Detail label='PI documents'>{c.setupRequired ? 'Not set yet' : `${c.progress.piDocuments.originals} of ${c.progress.piDocuments.planned} (${c.progress.materials.perPi} per PI)`}</Detail>
                        </dl>
                    </Card>
                    <RichTable
                        id='inv.stocktake.countsession.pis'
                        title={`${c.sessionNumber} PI documents`}
                        fileName={`Stock_take_${c.sessionNumber}_PI_documents`}
                        columns={piColumns}
                        rows={pis}
                        rowKey={(p) => p.id}
                        onRowClick={(p) => onOpenPi(p.id)}
                        empty={open ? (c.setupRequired ? 'Complete the setup first, then create PI documents.' : autoPis ? 'No PI documents yet. They are generated automatically; tap Create PI documents to generate them now.' : 'No PI documents yet. Tap New PI document.') : 'No PI documents were created in this session.'}
                        height='h-[calc(100dvh-22rem)]'
                    />
                </>
            ) : (
                <ProgressReport session={c} warehouse={warehouse} />
            )}
        </Panel>
    );
}

function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad' }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-panel p-3'>
            <p className='truncate text-xs text-muted'>{label}</p>
            <p className={`mt-0.5 truncate text-lg font-semibold ${tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-amber-300' : 'text-ink'}`}>{value}</p>
            {note && <p className='text-xs leading-snug text-soft'>{note}</p>}
        </div>
    );
}

function ProgressReport({ session: c, warehouse }: { session: CountSession; warehouse: string }) {
    const p = c.progress;
    const stageRows = useMemo(() => p.stages, [p]);
    const stageColumns: Array<Column<Stage>> = [
        { key: 'stage', label: 'Stage', value: (r) => r.label },
        { key: 'done', label: 'PI documents', type: 'number', value: (r) => r.done },
        { key: 'total', label: 'Of', type: 'number', value: (r) => r.total },
        { key: 'pct', label: '% complete', type: 'number', value: (r) => r.pct, render: (r) => `${r.pct}%` },
    ];
    const statuses = Object.entries(p.piDocuments.byStatus).sort((a, b) => b[1] - a[1]);
    const kpiTone = (k: Kpi) => (k.met === null ? undefined : k.met ? 'good' : 'bad');
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-2'>
                <Stat label='Completion' value={pctText(p.completionPct)} note={`${p.piDocuments.closed} of ${p.piDocuments.live} complete`} />
                <Stat label='PI documents' value={`${p.piDocuments.originals}/${p.piDocuments.planned}`} note={`${p.materials.perPi} per PI${p.piDocuments.recounts ? ` · ${count(p.piDocuments.recounts, 'recount')}` : ''}`} />
                <Stat label='Count accuracy' value={pctText(p.countAccuracy.pct)} note={`${count(p.countAccuracy.errors, 'recount error')} · ${p.countAccuracy.errorPct}% error`} tone={kpiTone(p.countAccuracy)} />
                <Stat label='Stock accuracy' value={pctText(p.stockAccuracy.pct)} note={`${count(p.stockAccuracy.errors, 'error')} posted · ${p.stockAccuracy.errorPct}% error`} tone={kpiTone(p.stockAccuracy)} />
                <Stat label='Materials on PIs' value={p.materials.onPis} note={`Of ${p.materials.target} to count · ${pctText(p.materials.onPisPct)}`} />
                <Stat label='Materials counted' value={p.materials.counted} note={`${pctText(p.materials.countedPct)} of ${p.materials.target}`} />
                <Stat label='Materials posted' value={p.materials.posted} note={`${pctText(p.materials.postedPct)} of ${p.materials.target}`} />
                <Stat label='Variance value' value={money(p.variance.value)} note='Sent for approval' />
                <Stat label='Time used' value={p.timeUsedPct === null ? 'Open-ended' : pctText(p.timeUsedPct)} note={c.endAt ? `Ends ${fmtWhen(c.endAt)}` : `Started ${fmtWhen(c.startAt)}`} tone={p.phase === 'overdue' ? 'bad' : undefined} />
                <Stat label='Disregarded PIs' value={p.piDocuments.disregarded} note='Not counted in completion' />
            </div>
            <p className='text-xs text-muted'>Count accuracy: counted materials whose count was not changed by a recount. Stock accuracy: counted materials posted with no difference from the system quantity.</p>

            <Card className='space-y-3'>
                <p className='text-sm font-medium text-ink'>Progress by stage</p>
                {p.stages.map((st) => (
                    <div key={st.key}>
                        <div className='flex items-baseline justify-between gap-2 text-sm'>
                            <span className='text-soft'>{st.label}</span>
                            <span className='shrink-0 text-ink'>
                                {st.done}/{st.total} · {st.pct}%
                            </span>
                        </div>
                        <div className='mt-1 h-2 overflow-hidden rounded-full bg-page' role='progressbar' aria-label={st.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={st.pct}>
                            <div className='h-full rounded-full bg-brand' style={{ width: `${Math.min(100, st.pct)}%` }} />
                        </div>
                    </div>
                ))}
                {p.timeUsedPct !== null && (
                    <p className={`text-xs ${p.timeUsedPct > p.completionPct ? 'text-amber-300' : 'text-soft'}`}>
                        {p.timeUsedPct}% of the time is used and {p.completionPct}% of the PI documents are complete{p.timeUsedPct > p.completionPct ? ': behind schedule.' : '.'}
                    </p>
                )}
            </Card>

            {statuses.length > 0 && (
                <Card className='space-y-2'>
                    <p className='text-sm font-medium text-ink'>PI documents by status</p>
                    <div className='grid grid-cols-2 gap-2'>
                        {statuses.map(([k, n]) => (
                            <div key={k} className='flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5'>
                                <Badge tone={statusOf(k).tone}>{statusOf(k).label}</Badge>
                                <span className='text-sm font-semibold text-ink'>{n}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <RichTable
                id='inv.stocktake.countsession.report'
                title={`${c.sessionNumber} progress · ${warehouse}`}
                fileName={`Stock_take_${c.sessionNumber}_progress`}
                columns={stageColumns}
                rows={stageRows}
                rowKey={(r) => r.key}
                empty='No PI documents yet.'
                height='h-80'
            />
        </div>
    );
}

/** What happened to the PI documents of a session that has just been completed. */
const generatedText = (r: { generated?: number; generateError?: string }) =>
    r.generateError ? ` PI documents were not generated: ${r.generateError}` : r.generated ? ` ${count(r.generated, 'PI document')} generated.` : '';

/** Count sheets printed per PI document (copies _A, _B …), 1 to 5. */
function CopiesField({ id, value, error, onChange }: { id: string; value: string; error?: string; onChange: (v: string) => void }) {
    return (
        <SelectField id={id} label='PI documents printed per PI *' value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={Number(value) > 1 ? `Sheets _A to _${'ABCDE'[Number(value) - 1]} are counted independently by different people; a recount is mandatory wherever they differ.` : 'One count sheet per PI document.'}>
            {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                    {n === 1 ? '1 (single count)' : `${n} (sheets _A–_${'ABCDE'[n - 1]})`}
                </option>
            ))}
        </SelectField>
    );
}

/**
 * Materials to count, with "All materials": the server counts the mapped locations of the warehouse that the
 * configuration selects (cluster and criticality applied) and the number is shown read-only. The server counts again
 * when the session is saved, so the figure cannot be altered on the way.
 */
function MaterialsToCount({ id, all, locked = false, value, configId, warehouseId, error, onAll, onValue }: { id: string; all: boolean; locked?: boolean; value: string; configId: string; warehouseId: string; error?: string; onAll: (on: boolean) => void; onValue: (v: string) => void }) {
    const [loading, setLoading] = useState(false);
    const [why, setWhy] = useState('');
    const fetchAll = async () => {
        setWhy('');
        if (!configId || !warehouseId) return setWhy('Choose the configuration and warehouse first.');
        setLoading(true);
        try {
            const r = await callBackend<{ count: number }>(API + 'material-count', { configId, warehouseId });
            onValue(String(r.count));
            if (!r.count) setWhy('No mapped materials match this configuration in the warehouse.');
        } catch (err) {
            setWhy(messageOf(err));
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        if (all) void fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [all, configId, warehouseId]);
    return (
        <div className='space-y-2'>
            <Field id={id} label='Materials to count *' inputMode='numeric' maxLength={7} value={loading ? '…' : value} readOnly={all} onChange={(e) => onValue(e.target.value)} error={why || error} hint={locked ? 'Full scope: every mapped material in scope is counted in this cycle.' : all ? 'All mapped materials in the warehouse for this configuration.' : undefined} />
            <label className='flex min-h-[44px] items-center gap-3'>
                <Toggle checked={all} onChange={(v) => !locked && onAll(v)} label='All materials in the warehouse' />
                <span className='text-sm text-soft'>All materials{locked ? ' (required by the configuration)' : ''}</span>
            </label>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Complete an automatically created session (once, before any PI document).
// ---------------------------------------------------------------------------

function SetupSessionPanel({ session: c, autoPis, ask, onClose, onDone }: { session: CountSession; autoPis: boolean; ask: Ask; onClose: () => void; onDone: (message: string) => void }) {
    const [f, setF] = useState({ name: c.name, targetMaterials: '', materialsPerPi: '20', piCopies: '1' });
    const [all, setAll] = useState(c.fullScope === true);
    const [tried, setTried] = useState(false);
    const e: Record<string, string> = {};
    if (f.name.trim().length < 3 || f.name.trim().length > 80) e.name = '3 to 80 characters';
    if (!isWhole(f.targetMaterials, 1, 1_000_000)) e.targetMaterials = 'Whole number, 1 or more';
    if (!isWhole(f.materialsPerPi, 1, 1000)) e.materialsPerPi = 'Whole number, 1 to 1000';
    else if (!e.targetMaterials && Math.ceil(Number(f.targetMaterials) / Number(f.materialsPerPi)) > 1000) e.materialsPerPi = 'More than 1000 PI documents';
    const problems = Object.keys(e);
    const pis = !e.targetMaterials && !e.materialsPerPi ? Math.ceil(Number(f.targetMaterials) / Number(f.materialsPerPi)) : 0;
    const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
    const show = (k: string) => (tried ? e[k] : undefined);
    const submit = () => {
        setTried(true);
        if (problems.length) return;
        ask(
            {
                title: `Complete ${c.sessionNumber}?`,
                message: `${all ? 'All ' : ''}${count(Number(f.targetMaterials), 'material')} to count, ${f.materialsPerPi} per PI: ${count(pis, 'PI document')}, each printed ${f.piCopies === '1' ? 'once' : `${f.piCopies} times (independent sheets; mismatches are recounted)`}.${autoPis ? ' All PI documents are generated now.' : ''}`,
                confirmLabel: 'Complete setup',
                acknowledge: 'The plan is correct. It cannot be changed once saved.',
            },
            async () => {
                const r = await callBackend<{ generated?: number; generateError?: string }>(API + 'count-session/setup', {
                    id: c.id,
                    name: f.name.trim(),
                    metrics: { countAll: all, targetMaterials: Number(f.targetMaterials), materialsPerPi: Number(f.materialsPerPi), piCopies: Number(f.piCopies) },
                });
                onDone(`${c.sessionNumber} is set up.${autoPis ? generatedText(r) : ' PI documents can now be created.'}`);
            }
        );
    };
    return (
        <Panel
            title='Complete session setup'
            eyebrow={c.sessionNumber}
            subtitle={`${c.configName} · ${fmtWhen(c.startAt)} to ${fmtWhen(c.endAt)}`}
            onClose={onClose}
            actions={
                <Button onClick={submit} disabled={tried && problems.length > 0}>
                    <Save className='h-4 w-4' /> Complete setup
                </Button>
            }
        >
            {tried && problems.length > 0 && <Problems items={problems.map((k) => `${k === 'name' ? 'Session name' : PLAN_LABELS[k as PlanKey]}: ${e[k]}`)} />}
            <Card className='space-y-3'>
                <Field id='sts-setup-name' label='Session name *' maxLength={80} value={f.name} onChange={(x) => set('name', x.target.value)} error={show('name')} />
                <div className='grid grid-cols-2 gap-2'>
                    <MaterialsToCount id='sts-setup-materials' all={all} locked={c.fullScope === true} value={f.targetMaterials} configId={c.configId} warehouseId={c.warehouseId} error={show('targetMaterials')} onAll={setAll} onValue={(v) => set('targetMaterials', v)} />
                    <Field id='sts-setup-per-pi' label='Materials per PI *' inputMode='numeric' maxLength={4} value={f.materialsPerPi} onChange={(x) => set('materialsPerPi', x.target.value)} error={show('materialsPerPi')} />
                    <CopiesField id='sts-setup-copies' value={f.piCopies} onChange={(v) => set('piCopies', v)} />
                    <div className='flex flex-col justify-center rounded-xl border border-line px-3'>
                        <span className='text-xs text-muted'>PI documents</span>
                        <span className='text-lg font-semibold text-ink'>{pis || '—'}</span>
                    </div>
                </div>
            </Card>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Plan a stock take session.
// ---------------------------------------------------------------------------

interface PlanForm {
    name: string;
    configId: string;
    warehouseId: string;
    startAt: string;
    countAll: boolean;
    targetMaterials: string;
    materialsPerPi: string;
    piCopies: string;
}
type PlanKey = keyof PlanForm;

/** End of the calendar period containing a moment, as the server works it out (Nairobi business days). */
function cyclePeriodEnd(ms: number, period: string): string {
    const n = new Date(ms + 3 * 3_600_000);
    const y = n.getUTCFullYear();
    const m = n.getUTCMonth();
    const day = n.getUTCDate();
    const end =
        period === 'Daily' ? Date.UTC(y, m, day + 1)
        : period === 'Weekly' ? Date.UTC(y, m, day + (((8 - n.getUTCDay()) % 7) || 7))
        : period === 'Monthly' ? Date.UTC(y, m + 1, 1)
        : period === 'Quarterly' ? Date.UTC(y, m - (m % 3) + 3, 1)
        : Date.UTC(y + 1, 0, 1);
    return new Date(end - 3 * 3_600_000).toISOString();
}

/** A date-time for the device's datetime-local input, in local time. */
function localInput(d: Date) {
    const z = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
const isNumber = (v: string, min: number, max: number) => /^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

function planErrors(f: PlanForm, cfg: Config | undefined, now: number): Partial<Record<PlanKey, string>> {
    const e: Partial<Record<PlanKey, string>> = {};
    const name = f.name.trim();
    if (name.length < 3 || name.length > 80) e.name = '3 to 80 characters';
    if (!cfg) e.configId = 'Choose a configuration';
    else if (cfg.active === false) e.configId = 'This configuration is disabled';
    if (!f.warehouseId) e.warehouseId = 'Choose a warehouse';
    else if (cfg?.warehouseId && cfg.warehouseId !== f.warehouseId) e.warehouseId = 'Must be the configuration’s warehouse';
    const start = Date.parse(f.startAt);
    if (!f.startAt || !Number.isFinite(start)) e.startAt = 'Enter the start date and time';
    else if (start < now - 10 * 60_000) e.startAt = 'Cannot be in the past';
    else if (start > now + 366 * 86_400_000) e.startAt = 'Must be within 366 days';
    if (cfg && cfg.type !== 'Cycle Count' && !(Number(cfg.durationDays) >= 1)) e.configId = 'Set the duration (days) on this configuration first';
    if (!isWhole(f.targetMaterials, 1, 1_000_000)) e.targetMaterials = 'Whole number, 1 or more';
    if (!isWhole(f.materialsPerPi, 1, 1000)) e.materialsPerPi = 'Whole number, 1 to 1000';
    else if (!e.targetMaterials && Math.ceil(Number(f.targetMaterials) / Number(f.materialsPerPi)) > 1000) e.materialsPerPi = 'More than 1000 PI documents; put more on each PI';
    return e;
}

const PLAN_LABELS: Record<PlanKey, string> = {
    name: 'Session name',
    configId: 'Configuration',
    warehouseId: 'Warehouse',
    startAt: 'Start',
    targetMaterials: 'Materials to count',
    materialsPerPi: 'Materials per PI',
    countAll: 'All materials',
    piCopies: 'PI documents printed per PI',
};

function PlanSessionPanel({ data, ask, onClose, onCreated }: { data: Data; ask: Ask; onClose: () => void; onCreated: (id: string, extra: string) => void }) {
    const [form, setForm] = useState<PlanForm>(() => ({ name: '', configId: '', warehouseId: '', startAt: localInput(new Date()), countAll: false, targetMaterials: '', materialsPerPi: '', piCopies: '1' }));
    const [touched, setTouched] = useState<Partial<Record<PlanKey, boolean>>>({});
    const [tried, setTried] = useState(false);
    const cfg = data.configs.find((c) => c.id === form.configId);
    const errors = planErrors(form, cfg, Date.now());
    const problems = (Object.keys(errors) as PlanKey[]).map((k) => `${PLAN_LABELS[k]}: ${errors[k]}`);
    const shown = (k: PlanKey) => (touched[k] || tried ? errors[k] : undefined);
    const set = (k: PlanKey, v: string) => setForm((f) => ({ ...f, [k]: v }));
    const touch = (k: PlanKey) => setTouched((t) => ({ ...t, [k]: true }));
    const enabledConfigs = data.configs.filter((c) => c.active !== false);
    const startMs = Date.parse(form.startAt);
    const cycleCfg = cfg?.type === 'Cycle Count';
    const endIso = !Number.isFinite(startMs) || !cfg ? '' : cycleCfg ? cyclePeriodEnd(startMs, cfg.period) : cfg.durationDays ? new Date(startMs + cfg.durationDays * 86_400_000).toISOString() : '';
    const piCount = isWhole(form.targetMaterials, 1, 1_000_000) && isWhole(form.materialsPerPi, 1, 1000) ? Math.ceil(Number(form.targetMaterials) / Number(form.materialsPerPi)) : 0;

    const pickConfig = (id: string) => {
        const c = data.configs.find((x) => x.id === id);
        setForm((f) => ({
            ...f,
            configId: id,
            warehouseId: c?.warehouseId || f.warehouseId,
            name: f.name || (c ? c.name : ''),
            countAll: c?.fullScope === true ? true : f.countAll,
            materialsPerPi: touched.materialsPerPi ? f.materialsPerPi : c ? String(c.documentSize || 20) : f.materialsPerPi,
        }));
        touch('configId');
    };

    const submit = () => {
        setTried(true);
        if (problems.length || !cfg) return;
        const warehouse = data.warehouses.find((w) => w.id === form.warehouseId)?.name ?? form.warehouseId;
        ask(
            {
                title: 'Create stock take session?',
                message: (
                    <span className='block space-y-1'>
                        <span className='block'>
                            “{form.name.trim()}” at {warehouse}, configuration {cfg.name}, from {fmtWhen(new Date(form.startAt).toISOString())}
                            {endIso ? ` to ${fmtWhen(endIso)}` : ''}.
                        </span>
                        <span className='block'>
                            {form.countAll ? 'All ' : ''}{count(Number(form.targetMaterials), 'material')} to count, {form.materialsPerPi} per PI: {count(piCount, 'PI document')}.
                        </span>
                    </span>
                ),
                confirmLabel: 'Create session',
                acknowledge: 'The configuration, warehouse, dates and plan are correct. They cannot be changed once the session is created.',
            },
            async () => {
                const r = await callBackend<{ ok: boolean; id?: string; generated?: number; generateError?: string }>(API + 'count-session/create', {
                    name: form.name.trim(),
                    configId: form.configId,
                    warehouseId: form.warehouseId,
                    startAt: new Date(form.startAt).toISOString(),
                    metrics: {
                        countAll: form.countAll,
                        targetMaterials: Number(form.targetMaterials),
                        materialsPerPi: Number(form.materialsPerPi),
                        piCopies: Number(form.piCopies),
                    },
                });
                onCreated(r.id ?? '', cfg?.piCreation === 'automatic' ? generatedText(r) : '');
            }
        );
    };

    return (
        <Panel
            title='New stock take session'
            subtitle='Plan the session first; PI documents are created inside it'
            onClose={onClose}
            actions={
                <Button onClick={submit} disabled={tried && problems.length > 0}>
                    <CalendarClock className='h-4 w-4' /> Create session
                </Button>
            }
        >
            {tried && <Problems items={problems} />}
            {!enabledConfigs.length && <Alert tone='warn'>There is no enabled configuration. Create one under Configuration first.</Alert>}
            <Card className='space-y-3'>
                <Field id='sts-name' label='Session name *' maxLength={80} autoComplete='off' value={form.name} onChange={(e) => set('name', e.target.value)} onBlur={() => touch('name')} error={shown('name')} placeholder='e.g. Main store year-end count' />
                <SelectField id='sts-config' label='Configuration *' value={form.configId} onChange={(e) => pickConfig(e.target.value)} error={shown('configId')} hint={cfg ? `${cfg.type} · ${cfg.selection}${cfg.durationDays ? ` · ${count(cfg.durationDays, 'day')}` : ''}${cfg.byCriticality ? ` · criticality ${(cfg.criticalityClasses ?? []).join(', ')}` : ''}` : undefined}>
                    <option value=''>Select configuration</option>
                    {enabledConfigs.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                </SelectField>
                <SelectField id='sts-warehouse' label='Warehouse *' value={form.warehouseId} onChange={(e) => (set('warehouseId', e.target.value), touch('warehouseId'))} disabled={!!cfg?.warehouseId} error={shown('warehouseId')} hint={cfg?.warehouseId ? 'Fixed by the configuration.' : undefined}>
                    <option value=''>Select accessible warehouse</option>
                    {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </SelectField>
            </Card>
            <Card className='space-y-3'>
                <div className='space-y-3'>
                    <Field id='sts-start' type='datetime-local' label='Start *' value={form.startAt} onChange={(e) => set('startAt', e.target.value)} onBlur={() => touch('startAt')} error={shown('startAt')} />
                    <div className='rounded-xl border border-line px-3 py-2'>
                        <span className='block text-xs text-muted'>{cycleCfg ? `End (end of the ${(cfg?.period || 'period').toLowerCase()} period; the next cycle begins then)` : `End (start + ${cfg?.durationDays ? count(cfg.durationDays, 'day') : 'configuration duration'})`}</span>
                        <span className='block text-base text-ink'>{endIso ? fmtWhen(endIso) : '—'}</span>
                    </div>
                </div>
                <p className='text-xs text-muted'>PI documents can be created only between the start and the end. The end is the start plus the configuration's duration.</p>
            </Card>
            <Card className='space-y-3'>
                <p className='text-sm font-medium text-ink'>Plan</p>
                <div className='grid grid-cols-2 gap-2'>
                    <MaterialsToCount id='sts-materials' all={form.countAll} locked={cfg?.fullScope === true} value={form.targetMaterials} configId={form.configId} warehouseId={form.warehouseId} error={shown('targetMaterials')} onAll={(on) => setForm((x) => ({ ...x, countAll: on }))} onValue={(v) => set('targetMaterials', v)} />
                    <Field id='sts-per-pi' label='Materials per PI *' inputMode='numeric' maxLength={4} value={form.materialsPerPi} onChange={(e) => (set('materialsPerPi', e.target.value), touch('materialsPerPi'))} error={shown('materialsPerPi')} />
                    <CopiesField id='sts-copies' value={form.piCopies} onChange={(v) => set('piCopies', v)} />
                    <div className='flex flex-col justify-center rounded-xl border border-line px-3'>
                        <span className='text-xs text-muted'>PI documents</span>
                        <span className='text-lg font-semibold text-ink'>{piCount || '—'}</span>
                    </div>
                </div>
                <p className='text-xs text-muted'>The number of PI documents is the materials to count divided by the materials per PI, rounded up. Count accuracy, stock accuracy and variance value are measured in the progress report and Statistics.</p>
            </Card>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// PI documents created before stock take sessions existed (read and work through; no new ones).
// ---------------------------------------------------------------------------

function LegacyPanel({ pis, warehouseName, onOpenPi, onClose }: { pis: Session[]; warehouseName: Map<string, string>; onOpenPi: (id: string) => void; onClose: () => void }) {
    const columns: Array<Column<Session>> = [
        { key: 'pi', label: 'PI document', value: (p) => p.piNumber, render: (p) => <span className='font-mono text-xs font-semibold text-brandsoft'>{p.piNumber}</span> },
        { key: 'status', label: 'Status', value: (p) => statusOf(p.status).label, render: (p) => <Badge tone={statusOf(p.status).tone}>{statusOf(p.status).label}</Badge> },
        { key: 'warehouse', label: 'Warehouse', value: (p) => warehouseName.get(p.warehouseId) || p.warehouseId },
        { key: 'lines', label: 'Locations', type: 'number', value: (p) => p.lines.length },
        { key: 'created', label: 'Created', type: 'date', value: (p) => p.createdAt, render: (p) => fmtDate(p.createdAt) },
    ];
    return (
        <Panel title='PI documents without a session' subtitle='Created before stock take sessions' onClose={onClose}>
            <Alert tone='info'>These PI documents can still be worked through or disregarded. New PI documents are created only inside a stock take session.</Alert>
            <RichTable id='inv.stocktake.legacy' title='PI documents without a session' fileName='Stock_take_PI_without_session' columns={columns} rows={pis} rowKey={(p) => p.id} onRowClick={(p) => onOpenPi(p.id)} empty='None.' height='h-[calc(100dvh-14rem)]' />
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Statistics over all sessions in a period (year to date from the financial year start by default).
// ---------------------------------------------------------------------------

interface StatSessionRow {
    id: string;
    name: string;
    warehouseId: string;
    startAt: string;
    phase: string;
    piDocuments: number;
    plannedPis: number;
    counted: number;
    countErrors: number;
    stockErrors: number;
    countAccuracyPct: number;
    stockAccuracyPct: number;
    completionPct: number;
    varianceValue: number;
}
interface StatMonthRow {
    month: string;
    sessions: number;
    counted: number;
    countErrors: number;
    stockErrors: number;
    varianceValue: number;
    countAccuracyPct: number;
    stockAccuracyPct: number;
}
interface StatsData {
    from: string;
    to: string;
    yearStart: string;
    yearStartSource: 'finance' | 'calendar';
    totals: {
        sessions: number;
        open: number;
        closed: number;
        cancelled: number;
        overdue: number;
        piDocuments: number;
        plannedPis: number;
        recounts: number;
        targetMaterials: number;
        counted: number;
        posted: number;
        countErrors: number;
        stockErrors: number;
        countAccuracyPct: number;
        stockAccuracyPct: number;
        completionPct: number;
        varianceValue: number;
    };
    sessions: StatSessionRow[];
    months: StatMonthRow[];
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function Statistics({ warehouseName }: { warehouseName: Map<string, string> }) {
    const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [draft, setDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [part, setPart] = useState<'sessions' | 'months'>('sessions');
    const { data, error, loading } = useLoad(() => callBackend<StatsData>(API + 'statistics', range.from ? range : {}), [range.from, range.to]);
    const shownFrom = draft.from || data?.from || '';
    const shownTo = draft.to || data?.to || '';
    const rangeError = !DAY_RE.test(shownFrom) || !DAY_RE.test(shownTo) ? 'Enter both dates' : shownFrom > shownTo ? 'From must be on or before To' : '';
    const t = data?.totals;

    const sessionColumns: Array<Column<StatSessionRow>> = [
        { key: 'id', label: 'Session', value: (r) => r.id, render: (r) => <span className='font-mono text-xs font-semibold text-brandsoft'>{r.id}</span> },
        { key: 'name', label: 'Name', value: (r) => r.name },
        { key: 'phase', label: 'Status', value: (r) => phaseOf(r.phase).label },
        { key: 'warehouse', label: 'Warehouse', value: (r) => warehouseName.get(r.warehouseId) || r.warehouseId, hidden: true },
        { key: 'start', label: 'Start', type: 'date', value: (r) => r.startAt, render: (r) => fmtWhen(r.startAt) },
        { key: 'pis', label: 'PI documents', type: 'number', value: (r) => r.piDocuments },
        { key: 'planned', label: 'Planned PIs', type: 'number', value: (r) => r.plannedPis, hidden: true },
        { key: 'counted', label: 'Counted', type: 'number', value: (r) => r.counted },
        { key: 'countAcc', label: 'Count accuracy %', type: 'number', value: (r) => r.countAccuracyPct },
        { key: 'stockAcc', label: 'Stock accuracy %', type: 'number', value: (r) => r.stockAccuracyPct },
        { key: 'countErr', label: 'Recount errors', type: 'number', value: (r) => r.countErrors, hidden: true },
        { key: 'stockErr', label: 'Stock errors posted', type: 'number', value: (r) => r.stockErrors, hidden: true },
        { key: 'completion', label: 'Completion %', type: 'number', value: (r) => r.completionPct },
        { key: 'variance', label: 'Variance value', type: 'number', value: (r) => r.varianceValue },
    ];
    const monthColumns: Array<Column<StatMonthRow>> = [
        { key: 'month', label: 'Month', value: (r) => r.month },
        { key: 'sessions', label: 'Sessions', type: 'number', value: (r) => r.sessions },
        { key: 'counted', label: 'Counted', type: 'number', value: (r) => r.counted },
        { key: 'countAcc', label: 'Count accuracy %', type: 'number', value: (r) => r.countAccuracyPct },
        { key: 'stockAcc', label: 'Stock accuracy %', type: 'number', value: (r) => r.stockAccuracyPct },
        { key: 'countErr', label: 'Recount errors', type: 'number', value: (r) => r.countErrors },
        { key: 'stockErr', label: 'Stock errors posted', type: 'number', value: (r) => r.stockErrors },
        { key: 'variance', label: 'Variance value', type: 'number', value: (r) => r.varianceValue },
    ];

    return (
        <div className='space-y-3'>
            <Card className='space-y-2'>
                <div className='grid grid-cols-2 gap-2'>
                    <Field id='st-stats-from' type='date' label='From' value={shownFrom} onChange={(e) => setDraft({ from: e.target.value, to: shownTo })} />
                    <Field id='st-stats-to' type='date' label='To' value={shownTo} onChange={(e) => setDraft({ from: shownFrom, to: e.target.value })} />
                </div>
                {(draft.from || draft.to) && rangeError && <p className='text-xs text-red-300'>{rangeError}</p>}
                <div className='flex flex-wrap gap-2'>
                    <Button disabled={!!rangeError || loading} onClick={() => setRange({ from: shownFrom, to: shownTo })}>
                        <BarChart3 className='h-4 w-4' /> Show
                    </Button>
                    <Button
                        variant='secondary'
                        onClick={() => {
                            setDraft({ from: '', to: '' });
                            setRange({ from: '', to: '' });
                        }}
                    >
                        Year to date
                    </Button>
                </div>
                {data && <p className='text-xs text-muted'>Year to date starts {data.yearStart} ({data.yearStartSource === 'finance' ? 'financial year in Finance' : 'no financial year set up, so 1 January'}). Sessions are included by their start date.</p>}
            </Card>
            {error && <Alert tone='error'>{error}</Alert>}
            {!data && loading ? (
                <Spinner />
            ) : t ? (
                <>
                    <div className='grid grid-cols-2 gap-2'>
                        <Stat label='Sessions' value={t.sessions} note={`${t.open} open · ${t.closed} closed${t.cancelled ? ` · ${t.cancelled} cancelled` : ''}`} />
                        <Stat label='Completion' value={pctText(t.completionPct)} note={t.overdue ? `${t.overdue} past end date` : 'Of PI documents'} tone={t.overdue ? 'bad' : undefined} />
                        <Stat label='Count accuracy' value={pctText(t.countAccuracyPct)} note={`${count(t.countErrors, 'recount error')} in ${t.counted}`} />
                        <Stat label='Stock accuracy' value={pctText(t.stockAccuracyPct)} note={`${count(t.stockErrors, 'error')} posted in ${t.counted}`} />
                        <Stat label='PI documents' value={`${t.piDocuments}`} note={`${t.plannedPis} planned · ${count(t.recounts, 'recount')}`} />
                        <Stat label='Materials counted' value={t.counted} note={`Of ${t.targetMaterials} planned · ${t.posted} posted`} />
                        <Stat label='Variance value' value={money(t.varianceValue)} note='Sent for approval' />
                        <Stat label='Period' value={`${data!.from.slice(5)} → ${data!.to.slice(5)}`} note={`${data!.from.slice(0, 4)}${data!.to.slice(0, 4) !== data!.from.slice(0, 4) ? `–${data!.to.slice(0, 4)}` : ''}`} />
                    </div>
                    <Segmented
                        label='Statistics views'
                        value={part}
                        onChange={setPart}
                        options={[
                            { value: 'sessions', label: 'By session', count: data!.sessions.length },
                            { value: 'months', label: 'By month', count: data!.months.length },
                        ]}
                    />
                    {part === 'sessions' ? (
                        <RichTable id='inv.stocktake.stats.sessions' title={`Sessions ${data!.from} to ${data!.to}`} fileName={`Stock_take_statistics_${data!.from}_${data!.to}`} columns={sessionColumns} rows={data!.sessions} rowKey={(r) => r.id} empty='No sessions started in this period.' height='h-[calc(100dvh-16rem)]' />
                    ) : (
                        <RichTable id='inv.stocktake.stats.months' title={`Months ${data!.from} to ${data!.to}`} fileName={`Stock_take_statistics_by_month_${data!.from}_${data!.to}`} columns={monthColumns} rows={data!.months} rowKey={(r) => r.month} empty='No sessions started in this period.' height='h-[calc(100dvh-16rem)]' />
                    )}
                </>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Configuration form (organization-wide template).
// ---------------------------------------------------------------------------

interface ConfigForm {
    type: string;
    name: string;
    selection: string;
    byCriticality: boolean;
    criticalityClasses: string[];
    durationDays: string;
    fullScope: '' | 'yes' | 'no';
    periodic: boolean;
    period: string;
    sessionCreation: '' | 'automatic' | 'manual';
    piCreation: '' | 'automatic' | 'manual';
    warehouseId: string;
    clusterIds: string[];
}
type FormKey = keyof ConfigForm;
const CLASSES = ['A', 'B', 'C', 'D'];

function formOf(c: Config | null): ConfigForm {
    if (!c) return { type: 'Cycle Count', name: 'Cycle Count', selection: 'Sequence', byCriticality: false, criticalityClasses: [], durationDays: '30', fullScope: '', periodic: true, period: 'Monthly', sessionCreation: '', piCreation: '', warehouseId: '', clusterIds: [] };
    return {
        type: c.type,
        name: c.name,
        selection: c.selection,
        byCriticality: c.byCriticality === true,
        criticalityClasses: c.criticalityClasses ?? [],
        durationDays: c.durationDays ? String(c.durationDays) : '',
        fullScope: c.type === 'Cycle Count' ? (c.fullScope === true ? 'yes' : c.fullScope === false ? 'no' : '') : '',
        periodic: c.type === 'Cycle Count' ? true : c.periodic,
        period: c.period || 'Monthly',
        sessionCreation: c.periodic ? (c.sessionCreation ?? 'manual') : '',
        piCreation: c.piCreation ?? 'manual',
        warehouseId: c.warehouseId || '',
        clusterIds: c.clusterIds?.length ? c.clusterIds : c.clusterId ? [c.clusterId] : [],
    };
}

function configErrors(f: ConfigForm): Partial<Record<FormKey, string>> {
    const e: Partial<Record<FormKey, string>> = {};
    if (!TYPES.includes(f.type)) e.type = 'Choose a stock take type.';
    const name = f.name.trim();
    if (name.length < 3 || name.length > 80) e.name = 'Enter a name of 3 to 80 characters.';
    if (!['Sequence', 'Random'].includes(f.selection)) e.selection = 'Choose a selection order.';
    if (f.byCriticality && !f.criticalityClasses.length) e.criticalityClasses = 'Choose at least one criticality class.';
    const cycle = f.type === 'Cycle Count';
    if (!cycle && !isWhole(f.durationDays, 1, 3650)) e.durationDays = 'Whole number of days from 1 to 3650.';
    if (cycle && !f.fullScope) e.fullScope = 'Say whether the full scope of materials must be counted within each session.';
    if (f.type === 'Cluster Stock Take' && !f.warehouseId) e.warehouseId = 'Choose the warehouse first; its clusters are then listed.';
    else if (f.type === 'Cluster Stock Take' && !f.clusterIds.length) e.clusterIds = 'Choose at least one cluster.';
    if (f.periodic && !PERIODS.includes(f.period)) e.period = 'Choose how often the stock take runs.';
    if (!f.piCreation) e.piCreation = 'Choose whether PI documents are created automatically or manually.';
    if (f.periodic && !f.sessionCreation) e.sessionCreation = 'Choose whether sessions are created automatically or manually.';
    if (f.periodic && f.sessionCreation === 'automatic' && !f.warehouseId) e.warehouseId = 'Choose the warehouse automatic sessions are created for.';
    return e;
}

function ConfigPanel({ config, warehouses, ask, onClose, onDone }: { config: Config | null; warehouses: Array<{ id: string; name: string }>; ask: Ask; onClose: () => void; onDone: (message: string) => void }) {
    const [form, setForm] = useState<ConfigForm>(() => formOf(config));
    const [touched, setTouched] = useState<Partial<Record<FormKey, boolean>>>({});
    // The name starts as the stock take type and follows it until the person types their own.
    const [nameEdited, setNameEdited] = useState(!!config);
    const errors = configErrors(form);
    const problems = Object.values(errors).filter((x): x is string => !!x);
    const changed = JSON.stringify(form) !== JSON.stringify(formOf(config));
    const set = (patch: Partial<ConfigForm>) => setForm((f) => ({ ...f, ...patch }));
    const touch = (k: FormKey) => setTouched((t) => ({ ...t, [k]: true }));
    const err = (k: FormKey) => (touched[k] ? errors[k] : undefined);
    const cycle = form.type === 'Cycle Count';
    const clusterType = form.type === 'Cluster Stock Take';
    const automatic = form.periodic && form.sessionCreation === 'automatic';
    // Clusters of the chosen warehouse, for a cluster stock take.
    const [clusters, setClusters] = useState<Array<{ code: string; name: string; locationCode: string; locations: number }> | null>(null);
    const [clusterError, setClusterError] = useState('');
    useEffect(() => {
        setClusters(null);
        setClusterError('');
        if (!clusterType || !form.warehouseId) return;
        let live = true;
        callBackend<{ clusters: Array<{ code: string; name: string; locationCode: string; locations: number }> }>(API + 'clusters', { warehouseId: form.warehouseId })
            .then((r) => live && setClusters(r.clusters))
            .catch((err) => live && setClusterError(messageOf(err)));
        return () => {
            live = false;
        };
    }, [clusterType, form.warehouseId]);
    const warehouseField = (
        <SelectField
                            id='st-cfg-warehouse'
                            label={automatic || clusterType ? 'Warehouse *' : 'Warehouse'}
                            value={form.warehouseId}
                            onChange={(e) => {
                                const w = warehouses.find((x) => x.id === e.target.value);
                                // Until the name is typed by hand it identifies the warehouse, so configurations can be told apart.
                                set({ warehouseId: e.target.value, clusterIds: [], ...(nameEdited || !w ? {} : { name: `${form.type} – ${w.name}`.slice(0, 80) }) });
                                touch('warehouseId');
                            }} error={err('warehouseId')} hint={clusterType ? 'Choose the warehouse first; its clusters are listed below.' : 'Sessions of this configuration are for this warehouse.'}>
                            <option value=''>{automatic || clusterType ? 'Select warehouse' : 'Any warehouse'}</option>
                            {warehouses.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.name}
                                </option>
                            ))}
                        </SelectField>
    );
    const warehouseName = warehouses.find((w) => w.id === form.warehouseId)?.name ?? form.warehouseId;

    const save = () => {
        const payload = {
            name: form.name.trim(),
            type: form.type,
            selection: form.selection,
            byCriticality: form.byCriticality,
            criticalityClasses: form.byCriticality ? form.criticalityClasses : [],
            durationDays: cycle ? null : Number(form.durationDays),
            fullScope: cycle ? form.fullScope === 'yes' : undefined,
            periodic: cycle ? true : form.periodic,
            period: form.period,
            sessionCreation: form.periodic ? form.sessionCreation : 'manual',
            piCreation: form.piCreation,
            warehouseId: form.warehouseId,
            clusterIds: form.type === 'Cluster Stock Take' ? form.clusterIds : [],
        };
        ask(
            {
                title: config ? `Save changes to ${config.id}?` : 'Create configuration?',
                message: (
                    <span className='block space-y-1'>
                        <span className='block'>
                            {payload.type}, {payload.selection.toLowerCase()} order{payload.byCriticality ? `, criticality ${payload.criticalityClasses.join(', ')}` : ''}
                            {payload.clusterIds.length ? `, clusters ${payload.clusterIds.join(', ')}` : ''}
                            {cycle ? `; each cycle runs to the end of the ${payload.period.toLowerCase()} period and the next begins there${payload.fullScope ? '; every material is counted in each cycle' : ''}.` : `; each session runs ${count(Number(payload.durationDays), 'day')}.`}
                        </span>
                        <span className='block'>
                            PI documents are created {payload.piCreation === 'automatic' ? 'automatically when a session is complete' : 'manually'}.{' '}
                            {payload.periodic ? `${payload.period}; sessions created ${automatic ? `automatically at midnight for ${warehouseName}, each needing its plan completed before PI documents` : 'manually'}.` : 'On demand; sessions are created manually.'}
                        </span>
                        {config && <span className='block'>Existing sessions keep their settings.</span>}
                    </span>
                ),
                confirmLabel: config ? 'Save changes' : 'Create configuration',
            },
            async () => {
                const r = await callBackend<{ ok: boolean; id?: string }>(API + (config ? 'config/edit' : 'config'), config ? { ...payload, id: config.id } : payload);
                onDone(config ? `Configuration ${config.id} saved.` : `Configuration ${r.id ?? payload.name} created.`);
            }
        );
    };

    const remove = () => {
        if (!config) return;
        ask(
            {
                title: `Delete ${config.id}?`,
                message: `“${config.name}” is deleted permanently. Configurations that already have PI documents cannot be deleted.`,
                confirmLabel: 'Delete configuration',
                tone: 'danger',
                phrase: 'DELETE',
            },
            async () => {
                await callBackend(API + 'config/delete', { id: config.id });
                onDone(`Configuration ${config.id} deleted.`);
            }
        );
    };

    return (
        <Panel
            title={config ? config.name : 'New configuration'}
            eyebrow={config?.id}
            subtitle='Stock take configuration'
            onClose={onClose}
            actions={
                <>
                    <Button disabled={problems.length > 0 || !changed} onClick={save}>
                        <Save className='h-4 w-4' /> {config ? 'Save changes' : 'Save configuration'}
                    </Button>
                    {config && (
                        <Button variant='danger' onClick={remove}>
                            <Trash2 className='h-4 w-4' /> Delete
                        </Button>
                    )}
                </>
            }
        >
            <Problems items={problems} />
            <Card className='space-y-3'>
                <SelectField id='st-cfg-type' label='Stock take type *' value={form.type} onChange={(e) => set({ type: e.target.value, ...(e.target.value === 'Cycle Count' ? { periodic: true } : {}), ...(nameEdited ? {} : { name: form.warehouseId ? `${e.target.value} – ${warehouseName}`.slice(0, 80) : e.target.value }) })} error={errors.type}>
                    {TYPES.map((t) => (
                        <option key={t}>{t}</option>
                    ))}
                </SelectField>
                <Field
                    id='st-cfg-name'
                    label='Configuration name *'
                    maxLength={80}
                    autoComplete='off'
                    value={form.name}
                    onChange={(e) => {
                        setNameEdited(true);
                        set({ name: e.target.value });
                    }}
                    onBlur={() => touch('name')}
                    error={err('name')}
                    hint='Starts as the type; add to it, for example “Cycle Count – spares”.'
                />
                <SelectField id='st-cfg-selection' label='Selection order *' value={form.selection} onChange={(e) => set({ selection: e.target.value })} error={errors.selection} hint='Random picks locations unpredictably'>
                    <option>Sequence</option>
                    <option>Random</option>
                </SelectField>
                {clusterType && warehouseField}
                {clusterType && form.warehouseId && (
                    <div className='space-y-1'>
                        <p className='text-sm text-soft'>Clusters * (one or more)</p>
                        {clusterError && <p className='text-xs text-red-300'>{clusterError}</p>}
                        {!clusters && !clusterError && <p className='text-xs text-muted'>Loading clusters…</p>}
                        {clusters && !clusters.length && <p className='text-xs text-amber-300'>This warehouse has no clusters. Create them under Warehouse setup first.</p>}
                        {clusters && clusters.length > 0 && (
                            <>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <Button variant='secondary' onClick={() => (touch('clusterIds'), set({ clusterIds: form.clusterIds.length === clusters.length ? [] : clusters.map((c) => c.code) }))}>
                                        {form.clusterIds.length === clusters.length ? 'Clear all' : 'Select all'}
                                    </Button>
                                    <span className='text-xs text-muted'>{form.clusterIds.length} of {clusters.length} selected</span>
                                </div>
                                <div className='grid max-h-64 grid-cols-2 gap-2 overflow-y-auto overscroll-contain'>
                                    {clusters.map((c) => {
                                        const on = form.clusterIds.includes(c.code);
                                        return (
                                            <button
                                                key={c.code}
                                                type='button'
                                                aria-pressed={on}
                                                onClick={() => (touch('clusterIds'), set({ clusterIds: on ? form.clusterIds.filter((x) => x !== c.code) : [...form.clusterIds, c.code].sort() }))}
                                                className={`min-h-12 rounded-xl border px-2 py-1.5 text-left ${on ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft active:bg-page'}`}
                                            >
                                                <span className='block font-mono text-sm font-semibold'>{c.code}</span>
                                                <span className='block truncate text-xs text-muted'>{[c.name, c.locationCode, c.locations ? count(c.locations, 'location') : ''].filter(Boolean).join(' · ')}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        {err('clusterIds') && <p className='text-xs text-red-300'>{errors.clusterIds}</p>}
                    </div>
                )}
                {cycle ? (
                    <>
                        <SelectField id='st-cfg-full' label='Complete the full scope of materials within each session? *' value={form.fullScope} onChange={(e) => (set({ fullScope: e.target.value as ConfigForm['fullScope'] }), touch('fullScope'))} error={err('fullScope')} hint='Yes: every material in scope is counted in each cycle (materials to count is set to All).'>
                            <option value=''>Choose</option>
                            <option value='yes'>Yes, count every material each cycle</option>
                            <option value='no'>No, the planner sets how many per session</option>
                        </SelectField>
                        <p className='text-xs text-muted'>A cycle count is always periodic. Each cycle runs until the end of its period (for example the end of the month) and the next cycle begins there.</p>
                    </>
                ) : (
                    <Field
                        id='st-cfg-cycle'
                        label='Duration (days) *'
                        inputMode='numeric'
                        maxLength={4}
                        value={form.durationDays}
                        onChange={(e) => set({ durationDays: e.target.value })}
                        onBlur={() => touch('durationDays')}
                        error={err('durationDays')}
                        hint='Each session ends this many days after it starts (1 to 3650).'
                    />
                )}
            </Card>
            <Card className='space-y-3'>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.byCriticality} onChange={(v) => set({ byCriticality: v, criticalityClasses: v ? form.criticalityClasses : [] })} label='Count by criticality' />
                    <span className='text-sm text-soft'>Count by criticality</span>
                </label>
                {form.byCriticality && (
                    <div className='space-y-1'>
                        <p className='text-sm text-soft'>Criticality classes * (one or more)</p>
                        <div className='grid grid-cols-4 gap-2'>
                            {CLASSES.map((c) => {
                                const on = form.criticalityClasses.includes(c);
                                return (
                                    <button
                                        key={c}
                                        type='button'
                                        aria-pressed={on}
                                        onClick={() => {
                                            touch('criticalityClasses');
                                            set({ criticalityClasses: on ? form.criticalityClasses.filter((x) => x !== c) : [...form.criticalityClasses, c].sort() });
                                        }}
                                        className={`h-12 rounded-xl border text-base font-semibold ${on ? 'border-brand bg-brand text-onbrand' : 'border-line text-soft active:bg-page'}`}
                                    >
                                        {c}
                                    </button>
                                );
                            })}
                        </div>
                        {err('criticalityClasses') && <p className='text-xs text-red-300'>{errors.criticalityClasses}</p>}
                        <p className='text-xs text-muted'>Only materials with these classes (Material detail &gt; Inventory Information) are put on PI documents.</p>
                    </div>
                )}
            </Card>
            <Card className='space-y-3'>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={cycle || form.periodic} onChange={(v) => !cycle && set({ periodic: v, sessionCreation: v ? form.sessionCreation : '' })} label='Periodic stock take' />
                    <span className='text-sm text-soft'>Periodic stock take{cycle ? ' (always on for a cycle count)' : ''}</span>
                </label>
                {(cycle || form.periodic) && (
                    <>
                        <SelectField id='st-cfg-period' label='Audit frequency *' value={form.period} onChange={(e) => set({ period: e.target.value })} error={errors.period}>
                            {PERIODS.map((p) => (
                                <option key={p}>{p}</option>
                            ))}
                        </SelectField>
                        <SelectField id='st-cfg-creation' label='Sessions are created *' value={form.sessionCreation} onChange={(e) => (set({ sessionCreation: e.target.value as ConfigForm['sessionCreation'] }), touch('sessionCreation'))} error={err('sessionCreation')}>
                            <option value=''>Choose</option>
                            <option value='automatic'>Automatically, at midnight when due</option>
                            <option value='manual'>Manually</option>
                        </SelectField>
                    </>
                )}
                {!clusterType && (automatic || form.warehouseId) && warehouseField}
                <SelectField id='st-cfg-pis' label='PI documents are created *' value={form.piCreation} onChange={(e) => (set({ piCreation: e.target.value as ConfigForm['piCreation'] }), touch('piCreation'))} error={err('piCreation')} hint='Automatically: as soon as a session is complete (created, or set up for automatic sessions), all its planned PI documents are generated.'>
                    <option value=''>Choose</option>
                    <option value='automatic'>Automatically, all at once when the session is complete</option>
                    <option value='manual'>Manually, one at a time</option>
                </SelectField>
                {automatic && (
                    <Alert tone='warn'>
                        Automatic sessions are created for one warehouse only. Create a separate configuration for each warehouse that should get automatic sessions, and give each an identifiable name that includes the warehouse (for example “Cycle Count – Main store”), because the name is how they are told apart.
                    </Alert>
                )}
                {automatic && <p className='text-xs text-muted'>At midnight on each due day a session is created with this configuration, starting that midnight and ending {cycle ? 'at the end of the period; the first cycle begins at the end of the current period' : 'after the duration'}. A planner then completes its name, materials to count and materials per PI once, before any PI document can be created.</p>}
                {config?.sessionCreation === 'automatic' && (
                    <dl className='grid grid-cols-2 gap-3 border-t border-line pt-3'>
                        <Detail label='Last created'>{config.lastSessionCreatedAt ? fmtWhen(config.lastSessionCreatedAt) : 'Not yet'}</Detail>
                        <Detail label='Last session'>{config.lastSessionId || '—'}</Detail>
                        <Detail label='Next due'>{config.nextSessionDueOn || '—'}</Detail>
                    </dl>
                )}
            </Card>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Printable PI document: rendered into <body>, invisible on screen, the only thing printed.
// ---------------------------------------------------------------------------

const PRINT_CSS = `@media print {
  html, body { height: auto; overflow: visible; background: #fff; }
  body > *:not(.pi-print) { display: none; }
  .pi-print { color: #000; background: #fff; font: 11pt/1.4 system-ui, sans-serif; }
  .pi-print h1 { font-size: 18pt; font-weight: 800; margin: 0 0 8pt; }
  .pi-print table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
  .pi-print th, .pi-print td { border: 1px solid #333; padding: 6pt; text-align: left; vertical-align: top; }
  .pi-print .pi-sign { margin-top: 28pt; }
}`;

function PrintablePi({ session: s, warehouse }: { session: Session; warehouse: string }) {
    return createPortal(
        <div className='pi-print hidden print:block'>
            <style>{PRINT_CSS}</style>
            <h1>PHYSICAL INVENTORY DOCUMENT</h1>
            <p>
                <strong>PI:</strong> {s.piNumber} &nbsp; <strong>Date:</strong> {s.createdAt.slice(0, 10)}
            </p>
            <p>
                <strong>Warehouse:</strong> {warehouse} &nbsp; <strong>Configuration:</strong> {s.configName}
            </p>
            <table>
                <thead>
                    <tr>
                        <th>Physical Location</th>
                        <th>Item Number</th>
                        <th>Description</th>
                        <th>Counted Quantity</th>
                    </tr>
                </thead>
                <tbody>
                    {s.lines.map((l, i) => (
                        <tr key={i}>
                            <td>{l.binId}</td>
                            <td>{l.materialNumber}</td>
                            <td>{l.description}</td>
                            <td style={{ minWidth: 90 }}>&nbsp;</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className='pi-sign'>Counted By: __________________________ Signature: ____________________ Date: _____________</p>
            <p>Verified By: __________________________ Signature: ____________________ Date: _____________</p>
        </div>,
        document.body
    );
}
