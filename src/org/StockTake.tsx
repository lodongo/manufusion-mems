import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ClipboardCheck, Download, FileUp, Pencil, Plus, Printer, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Trash2, X, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { InfoTip, Screen, Segmented, messageOf, useConfirm, type ConfirmOptions } from '../components/screen';
import { Badge, Button, Card, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';

// Stock take (physical inventory, INV).
//   Stock take process  PI documents (sessions) per warehouse; tap one to work it through its states:
//                       Created → Printed → Awaiting verification → Verified → Awaiting posting approval
//                       → Approved for posting → Reconciled (or Partially posted while a recount PI is open).
//                       Disregarded / Closed end a session.
//   Configuration       reusable count configurations (type, selection order, PI size, cycle, cluster).
// Separation of duties is enforced by the server (the counter cannot verify, approve or post; whoever requests
// posting cannot approve it; nobody approves their own work). Its 403 messages are shown as they come.
// Counting is blind: the system quantity is not shown until counts are submitted.

interface Config {
    id: string;
    name: string;
    warehouseId: string;
    type: string;
    selection: string;
    documentSize: number;
    periodic: boolean;
    period: string;
    durationDays: number | null;
    clusterId: string;
    active?: boolean;
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
}
interface Data {
    warehouses: Array<{ id: string; name: string }>;
    configs: Config[];
    sessions: Session[];
}
interface Upload {
    name: string;
    type: string;
    data: string;
}
type Ask = (options: ConfirmOptions, run: (reason: string) => Promise<void>) => void;
type LineRow = { i: number; line: Line };

const API = '/api/org/inventory/stocktake/';
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
async function downloadAttachment(id: string) {
    const file = await callBackend<Upload>(API + 'attachment', { id });
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

export default function StockTake() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>(API + 'list'));
    const [view, setView] = useState<'process' | 'config'>('process');
    const [showClosed, setShowClosed] = useState(false);
    const [openId, setOpenId] = useState('');
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<Config | 'new' | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    const warehouseName = useMemo(() => new Map((data?.warehouses ?? []).map((w) => [w.id, w.name])), [data]);
    const allSessions = data?.sessions ?? [];
    const closedCount = allSessions.filter((s) => CLOSED.includes(s.status)).length;
    const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => showClosed || !CLOSED.includes(s.status)), [data, showClosed]);
    const configs = useMemo(() => data?.configs ?? [], [data]);
    const opened = allSessions.find((s) => s.id === openId) ?? null;

    const done = (message: string) => {
        setNotice(message);
        reload();
    };

    const sessionColumns = useMemo<Array<Column<Session>>>(
        () => [
            { key: 'pi', label: 'PI document', value: (s) => s.piNumber, render: (s) => <span className='font-mono text-xs font-semibold text-brandsoft'>{s.piNumber}</span> },
            { key: 'name', label: 'Session', value: (s) => s.sessionName || s.configName },
            { key: 'config', label: 'Configuration', value: (s) => s.configName, hidden: true },
            { key: 'warehouse', label: 'Warehouse', value: (s) => warehouseName.get(s.warehouseId) || s.warehouseId },
            { key: 'status', label: 'Status', value: (s) => statusOf(s.status).label, render: (s) => <Badge tone={statusOf(s.status).tone}>{statusOf(s.status).label}</Badge> },
            { key: 'lines', label: 'Locations', type: 'number', value: (s) => s.lines.length },
            { key: 'variances', label: 'Variances', type: 'number', value: (s) => s.lines.filter((l) => l.counted !== null && hasVariance(l)).length },
            { key: 'parent', label: 'Parent PI', value: (s) => s.parentPi || '', hidden: true },
            { key: 'recount', label: 'Recount PI', value: (s) => s.recountPi || '', hidden: true },
            { key: 'created', label: 'Created', type: 'date', value: (s) => s.createdAt, render: (s) => fmtDate(s.createdAt) },
        ],
        [warehouseName]
    );

    const configColumns = useMemo<Array<Column<Config>>>(
        () => [
            { key: 'id', label: 'Configuration ID', value: (c) => c.id, render: (c) => <span className='font-mono text-xs font-semibold'>{c.id}</span> },
            { key: 'name', label: 'Name', value: (c) => c.name },
            { key: 'type', label: 'Type', value: (c) => c.type },
            { key: 'selection', label: 'Selection', value: (c) => c.selection },
            { key: 'size', label: 'PI size', type: 'number', value: (c) => c.documentSize },
            { key: 'frequency', label: 'Frequency', value: (c) => (c.periodic ? c.period : 'On demand') },
            { key: 'cycle', label: 'Cycle days', type: 'number', value: (c) => (c.type === 'Cycle Count' ? c.durationDays : null) },
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
                subtitle='Physical inventory documents and count configurations'
                actions={
                    view === 'process' ? (
                        <Button onClick={() => setCreating(true)} disabled={!data}>
                            <Plus className='h-4 w-4' /> New PI
                        </Button>
                    ) : (
                        <Button onClick={() => setEditing('new')} disabled={!data}>
                            <Plus className='h-4 w-4' /> New config
                        </Button>
                    )
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
                            { value: 'process', label: 'Stock take process', count: allSessions.length - closedCount },
                            { value: 'config', label: 'Configuration', count: configs.length },
                        ]}
                    />
                }
            >
                {error && <Alert tone='error'>{error}</Alert>}
                {notice && !opened && <Alert tone='success'>{notice}</Alert>}
                {!data && loading ? (
                    <Spinner />
                ) : view === 'process' ? (
                    <>
                        <div className='flex items-center gap-1'>
                            <label className='flex min-h-[44px] items-center gap-3'>
                                <Toggle checked={showClosed} onChange={setShowClosed} label='Show closed sessions' />
                                <span className='text-sm text-soft'>Show closed sessions ({closedCount})</span>
                            </label>
                            <InfoTip label='Closed sessions'>Reconciled, disregarded and closed PI documents are hidden unless this is on.</InfoTip>
                        </div>
                        <RichTable
                            id='inv.stocktake.sessions'
                            title='PI sessions'
                            fileName='Stock_take_sessions'
                            columns={sessionColumns}
                            rows={sessions}
                            rowKey={(s) => s.id}
                            onRowClick={(s) => {
                                setNotice('');
                                setOpenId(s.id);
                            }}
                            empty={showClosed ? 'No PI sessions yet.' : 'No active PI sessions.'}
                            height='h-[calc(100dvh-20rem)]'
                        />
                    </>
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
                    data={data}
                    onClose={() => setCreating(false)}
                    onCreated={(id) => {
                        setCreating(false);
                        setNotice(`PI ${id} created. Print it, count, then submit the counts with the signed PI.`);
                        setOpenId(id);
                        reload();
                    }}
                />
            )}
            {editing && (
                <ConfigPanel
                    config={editing === 'new' ? null : editing}
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
    const [recounts, setRecounts] = useState<number[]>([]);
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

    const missing = s.lines.filter((_, i) => countProblem(counts[i]) === 'Required').length;
    const invalid = s.lines.filter((_, i) => countProblem(counts[i]) && countProblem(counts[i]) !== 'Required').length;
    const countProblems = [
        ...(missing ? [`${missing} of ${s.lines.length} locations still need a count.`] : []),
        ...(invalid ? [`${invalid} counts are not valid numbers of 0 or more.`] : []),
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

    const download = async () => {
        setDownloading(true);
        setPanelError('');
        try {
            await downloadAttachment(s.id);
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
                disabled={countProblems.length > 0}
                onClick={() =>
                    run(
                        {
                            title: 'Submit counts and signed PI?',
                            message: `${s.lines.length} counts and the signed PI “${upload?.name ?? ''}” are submitted. Another person must verify them; you will not be able to verify, approve or post this PI.`,
                            confirmLabel: 'Submit counts',
                            acknowledge: 'Every location listed was physically counted and the attached document is the signed PI.',
                        },
                        'counts',
                        () => `Counts for ${s.piNumber} submitted for verification.`,
                        () => ({ counts: countValues(), attachment: upload })
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
                onClick={() =>
                    run(
                        {
                            title: 'Accept verification?',
                            message: `${recounts.length} of ${varianceLines} lines with a variance are flagged for recount; all other lines become verified and ready to submit for posting. Counts must be verified by someone other than the person who counted or corrected them.`,
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
                            { title: 'Submit for posting approval?', message: `${postable} verified lines (not flagged for recount) are sent for posting approval. Someone other than you and the counter must approve before stock is posted.`, confirmLabel: 'Submit for approval' },
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
                        run({ title: 'Create recount PI?', message: `A new PI document is created for the ${flagged} lines flagged for recount, with the current system quantities.`, confirmLabel: 'Create recount PI' }, 'recount', (r) => `Recount PI ${r.id ?? ''} created.`)
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
                onClick={() =>
                    run(
                        {
                            title: 'Approve posting?',
                            message: `${postable} lines will be released for posting to the material journal. You cannot approve a PI you counted or submitted for posting.`,
                            confirmLabel: 'Approve posting',
                            acknowledge: 'I have reviewed the counts and variances of this PI and approve them for posting.',
                        },
                        'approve_posting',
                        () => `Posting of ${s.piNumber} approved.`
                    )
                }
            >
                <ShieldCheck className='h-4 w-4' /> Approve posting
            </Button>
        );
    }
    if (st === 'approved_for_posting') {
        actions.push(
            <Button
                key='post'
                onClick={() =>
                    run(
                        {
                            title: 'Post and reconcile?',
                            message: `Stock adjustments for ${postable} lines are posted to the material journal and the PI is reconciled${flagged ? ` (${flagged} recount lines stay open)` : ''}. Posting cannot be undone.`,
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
                onClick={() => {
                    setPrinted(true);
                    window.print();
                }}
            >
                <Printer className='h-4 w-4' /> Print / save PI as PDF
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
                        { title: 'Close posted session?', message: 'The session is closed. Posted stock movements stay as they are; open recount PIs must be closed first.', confirmLabel: 'Close session', reason: { label: 'Closure reason', minLength: 10 } },
                        'close_posted',
                        () => `${s.piNumber} closed.`,
                        (reason) => ({ reason })
                    )
                }
            >
                <XCircle className='h-4 w-4' /> Close posted session
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
                      hasVariance(r.line) ? (
                          <label className='flex h-11 items-center gap-2' onClick={(e) => e.stopPropagation()}>
                              <input
                                  type='checkbox'
                                  className='h-5 w-5 accent-emerald-500'
                                  checked={recounts.includes(r.i)}
                                  onChange={(e) => {
                                      const on = e.target.checked;
                                      setRecounts((list) => (on ? [...list.filter((x) => x !== r.i), r.i] : list.filter((x) => x !== r.i)));
                                  }}
                              />
                              <span className='text-xs text-soft'>Recount</span>
                          </label>
                      ) : (
                          <span className='text-xs text-muted'>Matches</span>
                      ),
              }
            : { key: 'recount', label: 'Recount', value: (r) => (r.line.recount ? 'Yes' : ''), hidden: blind },
        { key: 'description', label: 'Description', value: (r) => r.line.description },
        { key: 'posted', label: 'Posted', value: (r) => (r.line.posted ? 'Yes' : 'No'), hidden: blind },
    ];

    const status = statusOf(st);
    return (
        <Panel title={s.sessionName || s.configName} eyebrow={s.piNumber} subtitle={<Badge tone={status.tone}>{status.label}</Badge>} actions={actions.length ? actions : undefined} onClose={onClose}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {panelError && <Alert tone='error'>{panelError}</Alert>}
            {entering && <Problems items={countProblems} />}
            {st === 'awaiting_print' && !printed && <Alert tone='info'>Print the PI (or save it as PDF) first; then confirm it was printed.</Alert>}
            {st === 'verification' && !editingCounts && varianceLines > 0 && (
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='min-w-0 flex-1 text-sm text-soft'>
                        {varianceLines} lines differ from the system quantity; tick the ones to recount ({recounts.length} selected).
                    </p>
                    <Button variant='secondary' onClick={() => setRecounts(recounts.length ? [] : s.lines.map((l, i) => (hasVariance(l) ? i : -1)).filter((i) => i >= 0))}>
                        {recounts.length ? 'Clear selection' : 'Select all variances'}
                    </Button>
                </div>
            )}

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
                        <Button variant='secondary' busy={downloading} onClick={() => void download()}>
                            <Download className='h-4 w-4' /> Download
                        </Button>
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

function CreatePanel({ data, onClose, onCreated }: { data: Data; onClose: () => void; onCreated: (id: string) => void }) {
    const [configId, setConfigId] = useState('');
    const [warehouseId, setWarehouseId] = useState('');
    const [startBin, setStartBin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const cfg = data.configs.find((c) => c.id === configId);

    const problems = [
        ...(!cfg ? ['Choose a configuration.'] : cfg.active === false ? ['This configuration is disabled.'] : []),
        ...(!warehouseId ? ['Choose a warehouse.'] : []),
        ...(startBin.trim().length > 80 ? ['The starting location is too long.'] : []),
    ];

    const create = async () => {
        if (problems.length) return;
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ ok: boolean; id?: string }>(API + 'start', { configId, warehouseId, startBin: cfg?.selection === 'Sequence' ? startBin.trim() : '' });
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
            subtitle='Locations are picked from the configuration'
            onClose={onClose}
            actions={
                <Button busy={busy} disabled={problems.length > 0} onClick={() => void create()}>
                    <Plus className='h-4 w-4' /> Create PI
                </Button>
            }
        >
            {error && <Alert tone='error'>{error}</Alert>}
            <Problems items={problems} />
            <Card className='space-y-3'>
                <SelectField
                    id='st-new-config'
                    label='Configuration *'
                    value={configId}
                    onChange={(e) => {
                        setConfigId(e.target.value);
                        setStartBin('');
                    }}
                    hint={cfg ? `${cfg.type} · ${cfg.selection} · ${cfg.documentSize} locations` : undefined}
                >
                    <option value=''>Select configuration</option>
                    {data.configs.map((c) => (
                        <option key={c.id} value={c.id} disabled={c.active === false}>
                            {c.name}
                            {c.active === false ? ' (disabled)' : ''}
                        </option>
                    ))}
                </SelectField>
                <SelectField id='st-new-warehouse' label='Warehouse *' value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={!cfg}>
                    <option value=''>Select accessible warehouse</option>
                    {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                            {w.name}
                        </option>
                    ))}
                </SelectField>
                {cfg?.selection === 'Sequence' && (
                    <Field id='st-new-start' label='Starting physical location' maxLength={80} autoComplete='off' value={startBin} onChange={(e) => setStartBin(e.target.value)} placeholder='First mapped location by default' hint='Leave blank to start at the first mapped location.' />
                )}
            </Card>
        </Panel>
    );
}

// ---------------------------------------------------------------------------
// Configuration form (organization-wide template).
// ---------------------------------------------------------------------------

interface ConfigForm {
    name: string;
    type: string;
    selection: string;
    periodic: boolean;
    period: string;
    durationDays: string;
    documentSize: string;
    clusterId: string;
}
type FormKey = keyof ConfigForm;

function formOf(c: Config | null): ConfigForm {
    if (!c) return { name: '', type: 'Cycle Count', selection: 'Sequence', periodic: false, period: 'Monthly', durationDays: '30', documentSize: '20', clusterId: '' };
    return {
        name: c.name,
        type: c.type,
        selection: c.selection,
        periodic: c.periodic,
        period: c.period || 'Monthly',
        durationDays: String(c.durationDays || 30),
        documentSize: String(c.documentSize),
        clusterId: c.clusterId || '',
    };
}

function configErrors(f: ConfigForm): Partial<Record<FormKey, string>> {
    const e: Partial<Record<FormKey, string>> = {};
    const name = f.name.trim();
    if (name.length < 3 || name.length > 80) e.name = 'Enter a name of 3 to 80 characters.';
    if (!TYPES.includes(f.type)) e.type = 'Choose a stock take type.';
    if (!['Sequence', 'Random'].includes(f.selection)) e.selection = 'Choose a selection order.';
    if (!isWhole(f.documentSize, 1, 1000)) e.documentSize = 'Whole number of locations from 1 to 1000.';
    if (f.type === 'Cycle Count' && !isWhole(f.durationDays, 1, 3650)) e.durationDays = 'Whole number of days from 1 to 3650.';
    if (f.type === 'Cluster Stock Take' && !/^CL-\d{4}$/.test(f.clusterId.trim().toUpperCase())) e.clusterId = 'Use the cluster code, for example CL-0001.';
    if (f.periodic && !PERIODS.includes(f.period)) e.period = 'Choose how often the stock take runs.';
    return e;
}

function ConfigPanel({ config, ask, onClose, onDone }: { config: Config | null; ask: Ask; onClose: () => void; onDone: (message: string) => void }) {
    const [form, setForm] = useState<ConfigForm>(() => formOf(config));
    const [touched, setTouched] = useState<Partial<Record<FormKey, boolean>>>({});
    const errors = configErrors(form);
    const problems = Object.values(errors).filter((x): x is string => !!x);
    const changed = JSON.stringify(form) !== JSON.stringify(formOf(config));
    const set = (patch: Partial<ConfigForm>) => setForm((f) => ({ ...f, ...patch }));
    const touch = (k: FormKey) => setTouched((t) => ({ ...t, [k]: true }));
    const err = (k: FormKey) => (touched[k] ? errors[k] : undefined);

    const save = () => {
        const payload = {
            name: form.name.trim(),
            type: form.type,
            selection: form.selection,
            periodic: form.periodic,
            period: form.period,
            durationDays: Number(form.durationDays),
            documentSize: Number(form.documentSize),
            clusterId: form.clusterId.trim().toUpperCase(),
        };
        ask(
            {
                title: config ? `Save changes to ${config.id}?` : 'Create configuration?',
                message: config ? 'The configuration is shared across the organization; new PI documents use the changed settings. Existing PIs keep their lines.' : `“${payload.name}” becomes available to everyone who creates stock take PIs.`,
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
                message: `“${config.name}” is deleted permanently. Configurations that already have PI sessions cannot be deleted.`,
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
            <Card className='grid gap-3 sm:grid-cols-2'>
                <Field id='st-cfg-name' label='Configuration name *' maxLength={80} autoComplete='off' value={form.name} onChange={(e) => set({ name: e.target.value })} onBlur={() => touch('name')} error={err('name')} hint='3 to 80 characters' />
                <SelectField id='st-cfg-type' label='Stock take type *' value={form.type} onChange={(e) => set({ type: e.target.value })} error={errors.type}>
                    {TYPES.map((t) => (
                        <option key={t}>{t}</option>
                    ))}
                </SelectField>
                <SelectField id='st-cfg-selection' label='Selection order *' value={form.selection} onChange={(e) => set({ selection: e.target.value })} error={errors.selection} hint='Random picks locations unpredictably'>
                    <option>Sequence</option>
                    <option>Random</option>
                </SelectField>
                {form.type === 'Cluster Stock Take' && (
                    <Field
                        id='st-cfg-cluster'
                        label='Cluster code *'
                        maxLength={7}
                        autoComplete='off'
                        placeholder='CL-0001'
                        value={form.clusterId}
                        onChange={(e) => set({ clusterId: e.target.value.toUpperCase() })}
                        onBlur={() => touch('clusterId')}
                        error={err('clusterId')}
                        hint='Format CL-0001'
                    />
                )}
                <Field
                    id='st-cfg-size'
                    label='PI document size (physical locations) *'
                    inputMode='numeric'
                    maxLength={4}
                    value={form.documentSize}
                    onChange={(e) => set({ documentSize: e.target.value })}
                    onBlur={() => touch('documentSize')}
                    error={err('documentSize')}
                    hint='1 to 1000'
                />
                {form.type === 'Cycle Count' && (
                    <Field
                        id='st-cfg-cycle'
                        label='Cycle duration (days) *'
                        inputMode='numeric'
                        maxLength={4}
                        value={form.durationDays}
                        onChange={(e) => set({ durationDays: e.target.value })}
                        onBlur={() => touch('durationDays')}
                        error={err('durationDays')}
                        hint='1 to 3650'
                    />
                )}
                <label className='flex min-h-[44px] items-center gap-3 sm:col-span-2'>
                    <Toggle checked={form.periodic} onChange={(v) => set({ periodic: v })} label='Periodic stock take' />
                    <span className='text-sm text-soft'>Periodic stock take</span>
                </label>
                {form.periodic && (
                    <SelectField id='st-cfg-period' label='Audit frequency *' value={form.period} onChange={(e) => set({ period: e.target.value })} error={errors.period}>
                        {PERIODS.map((p) => (
                            <option key={p}>{p}</option>
                        ))}
                    </SelectField>
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
