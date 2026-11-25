import { useMemo, useState } from 'react';
import { Check, CornerUpLeft, Pencil, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Screen, Segmented, useConfirm } from '../components/screen';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import MaterialIdentity from './materialIdentity';

// Material record: one approved or requested organization material.
// Action bar on top (the decision or next step that applies to you), the three linked numbers, a lifecycle strip,
// then sections: Overview, Approvals, Warehouses and stock, Attributes, History.
// Approve, return for correction and reject are confirmed; returning and rejecting need a reason (verified here and
// on the server). Every decision is audited by the server.

type Tab = 'overview' | 'approvals' | 'warehouses' | 'attributes' | 'history';

interface MaterialSummary {
    id: string; name: string; shortText: string; status: string;
    materialNumber: string; materialCode: string; categoryCode: string; subcategoryCode: string;
    familyCode: string; workflowStage: string; workflowCode: string;
    supplyType: string; uom: string; vendorId: string;
    oemPartNumber: string; ocmPartNumber: string; generalPartNumber: string;
    createdBy: string; createdByName?: string; createdAt: string; submittedAt: string; submittedBy: string; updatedAt: string; approvedAt?: string;
    warehouseId: string; pushedAt: string; warehouseRestrictionCodes: string[];
    canEdit: boolean; canDelete: boolean; canSubmit: boolean; canApprove: boolean;
    canExtend: boolean; canLifecycle: boolean; testOverride: boolean; masterDataId: string;
    requestId?: string; materialNumberAliases?: string[]; returned?: boolean; returnReason?: string; returnedAt?: string; returnCount?: number;
    extensionRequests?: Array<{ id: string; warehouseName: string; status: string }>;
}
interface WarehouseRow {
    warehouseId: string; warehouseName: string; warehouseCode: string;
    relation: 'Created here' | 'Extended' | 'Existing mapping';
    status: string; requestedAt: string; approvedAt: string; requestId: string; requestedBy: string;
    mapped: boolean; accessible: boolean; canApprove?: boolean;
}
type AvailabilityRow = WarehouseRow & {
    ledgerState: 'Tracked' | 'Not tracked' | 'Unreconciled' | 'Unavailable' | 'Restricted';
    physicalStock: number | null; reservedStock: number | null; quarantinedStock: number | null;
    damagedStock: number | null; expiredStock: number | null; otherStock: number | null;
    availableStock: number | null; onOrder: number | null; inTransit: number | null; journalEntries: number;
};
interface HistoryRow { id: string; at: string; action: string; by: string; details: string; origin: 'Audit' | 'Workflow' | 'Record' }
interface Decision { decision: string; by: string; at: string; comment: string; action?: string; stepIndex?: number }
interface Extension {
    requestId: string; warehouseId: string; warehouseName: string; status: string; canApprove: boolean; workflowCode: string; workflowStage: string;
    justification?: string; returnReason?: string; requestedBy?: string; canResubmit?: boolean; decisions: Decision[];
}
interface MaterialDashboardData {
    material: MaterialSummary;
    attributes: Array<{ code: string; label: string; value: string; unit: string }>;
    warehouses: WarehouseRow[];
    availability: AvailabilityRow[];
    history: HistoryRow[];
    historyNote: string; ledgerNote: string;
    approvals: {
        requestId: string; masterDataId: string; code: string; name: string; approvalMode: string; approvalRule: string;
        steps: Array<{ number: number; action: string; mode: string; assignee: string; decisions: Decision[] }>;
        extensions: Extension[];
    };
}
interface Props { id: string; onBack: () => void; onChanged: () => void; onEdit: (id: string) => void; onExtend: (id: string) => void }

const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'warehouses', label: 'Warehouses' },
    { key: 'attributes', label: 'Attributes' },
    { key: 'history', label: 'History' },
];
const showDate = (date: string) => (date ? new Date(date).toLocaleString() : '—');
const qty = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 3 }));
const words = (status: string) => (status || '').replaceAll('_', ' ');
const statusTone = (s: string) => (['approved', 'active'].includes(s) ? 'brand' : s === 'pending_approval' ? 'warn' : ['rejected', 'workflow_terminated'].includes(s) ? 'danger' : 'muted') as 'brand' | 'warn' | 'danger' | 'muted';
const decisionTone = (d: string) => (d === 'approve' ? 'brand' : d === 'return' ? 'warn' : d === 'reject' ? 'danger' : 'muted') as 'brand' | 'warn' | 'danger' | 'muted';
const decisionWord = (d: string) => (d === 'approve' ? 'Approved' : d === 'return' ? 'Returned' : d === 'reject' ? 'Rejected' : words(d));

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
    return (
        <div className='min-w-0 border-b border-line/60 py-2'>
            <dt className='text-xs text-muted'>{label}</dt>
            <dd className='mt-1 break-words text-sm font-medium text-ink'>{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
    );
}
function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-page p-3'>
            <p className='text-xs text-soft'>{label}</p>
            <p className='mt-1 break-words text-xl font-semibold tabular-nums text-ink'>{value}</p>
            {note && <p className='mt-1 text-xs text-muted'>{note}</p>}
        </div>
    );
}

/** Draft → Submitted → each approval level → Approved → Published. */
function Lifecycle({ m, steps }: { m: MaterialSummary; steps: MaterialDashboardData['approvals']['steps'] }) {
    const approved = ['approved', 'active', 'disabled'].includes(m.status);
    const items: Array<{ label: string; state: 'done' | 'now' | 'todo' | 'stop' }> = [
        { label: m.returned ? 'Returned' : 'Draft', state: m.status === 'draft' ? (m.returned ? 'stop' : 'now') : 'done' },
        { label: 'Submitted', state: m.status === 'draft' ? 'todo' : 'done' },
        ...steps.map((s) => {
            const last = s.decisions[s.decisions.length - 1]?.decision;
            return { label: `L${s.number} ${s.action === 'review' ? 'review' : 'approval'}`, state: (last === 'approve' ? 'done' : last === 'reject' ? 'stop' : m.status === 'pending_approval' && !last ? 'now' : approved ? 'done' : 'todo') as 'done' | 'now' | 'todo' | 'stop' };
        }),
        { label: m.status === 'rejected' ? 'Rejected' : 'Approved', state: approved ? 'done' : m.status === 'rejected' ? 'stop' : 'todo' },
        { label: 'In warehouse', state: m.pushedAt ? 'done' : 'todo' },
    ];
    // Only the first pending approval level is "now".
    let seenNow = false;
    for (const it of items) if (it.state === 'now') { if (seenNow) it.state = 'todo'; seenNow = true; }
    return (
        <ol aria-label='Lifecycle' className='flex gap-1 overflow-x-auto pb-1'>
            {items.map((it, i) => (
                <li key={i} className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium ${it.state === 'done' ? 'border-brand/40 bg-brand/10 text-ink' : it.state === 'now' ? 'border-amber-500 bg-amber-500/10 text-ink' : it.state === 'stop' ? 'border-red-500/50 bg-red-500/10 text-ink' : 'border-line text-muted'}`}>
                    {it.state === 'done' ? <Check aria-hidden className='h-3.5 w-3.5 text-brand' /> : it.state === 'stop' ? <X aria-hidden className='h-3.5 w-3.5 text-red-500' /> : <span aria-hidden className={`h-2 w-2 rounded-full ${it.state === 'now' ? 'bg-amber-500' : 'bg-line'}`} />}
                    {it.label}
                </li>
            ))}
        </ol>
    );
}

export default function MaterialMasterDashboard({ id, onBack, onChanged, onEdit, onExtend }: Props) {
    const { data, loading, error, reload } = useLoad(() => callBackend<MaterialDashboardData>('/api/org/procurement/materials/dashboard', { id }));
    const [tab, setTab] = useState<Tab>('overview');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    const m = data?.material;
    const published = useMemo(() => data?.warehouses.filter((x) => x.mapped) ?? [], [data]);
    const pendingExt = useMemo(() => data?.approvals.extensions.filter((x) => x.status.toLowerCase().includes('pending')) ?? [], [data]);
    const tracked = useMemo(() => data?.availability.filter((x) => x.ledgerState === 'Tracked') ?? [], [data]);
    const availableTotal = tracked.reduce((n, x) => n + (x.availableStock || 0), 0);
    const incomplete = (data?.availability ?? []).some((x) => x.mapped && x.ledgerState !== 'Tracked');

    const run = async (work: () => Promise<unknown>, done: string, close = false) => {
        setBusy(true); setFailure(''); setNotice('');
        try {
            await work();
            onChanged();
            if (close) onBack();
            else { setNotice(done); reload(); }
        } catch (e) { setFailure(e instanceof Error ? e.message : 'Unable to complete the material action.'); }
        finally { setBusy(false); }
    };

    /** Approve, return or reject one stage of a creation (PRC-001) or extension (PRC-002) request. */
    const decide = (choice: 'approve' | 'return' | 'reject', target: { kind: 'creation' } | { kind: 'extension'; ext: Extension }) => {
        if (!m) return;
        const ext = target.kind === 'extension' ? target.ext : null;
        const subject = ext ? `the extension of ${m.name} to ${ext.warehouseName} (${ext.requestId})` : `${m.name} (${m.requestId || m.id})`;
        const review = !ext && m.workflowStage.startsWith('Review');
        confirm.ask(
            {
                title: choice === 'approve' ? (review ? 'Complete review' : 'Approve') : choice === 'return' ? 'Return for correction' : 'Reject',
                message: choice === 'approve'
                    ? `${review ? 'Complete your review of' : 'Approve'} ${subject}? ${!ext && m.testOverride && !data?.approvals.steps.length ? 'This older request has no workflow snapshot; an audited one-step test recovery is used.' : 'The next level, if any, is notified through the workflow.'}`
                    : choice === 'return'
                        ? `Send ${subject} back to the requester to correct. The approval starts again from level 1 when it is resubmitted.`
                        : `Reject ${subject}? This closes the request. The requester must raise a new one.`,
                confirmLabel: choice === 'approve' ? (review ? 'Complete review' : 'Approve') : choice === 'return' ? 'Return to requester' : 'Reject',
                tone: choice === 'reject' ? 'danger' : 'primary',
                ...(choice === 'approve' ? {} : { reason: { label: choice === 'return' ? 'What must be corrected' : 'Reason for rejection', minLength: 10, placeholder: choice === 'return' ? 'For example: the bore size attribute is wrong' : 'For example: duplicates material MECH000012' } }),
            },
            async (comment) =>
                run(
                    () => callBackend(ext ? '/api/org/procurement/materials/extension/approve' : '/api/org/procurement/materials/approve', { id: ext ? ext.requestId : id, decision: choice, comment }),
                    choice === 'approve' ? 'Decision recorded.' : choice === 'return' ? 'Returned to the requester.' : 'Rejected.'
                )
        );
    };
    const resubmitExtension = (ext: Extension, action: 'resubmit' | 'withdraw') =>
        confirm.ask(
            {
                title: action === 'resubmit' ? 'Resubmit extension' : 'Withdraw extension',
                message: action === 'resubmit' ? `Send ${ext.requestId} for approval again. It restarts at level 1.` : `Withdraw ${ext.requestId}? It is closed and stays on record.`,
                confirmLabel: action === 'resubmit' ? 'Resubmit' : 'Withdraw',
                tone: action === 'withdraw' ? 'danger' : 'primary',
                reason: { label: action === 'resubmit' ? 'What you corrected' : 'Why it is withdrawn', minLength: 10 },
            },
            async (note) => run(() => callBackend('/api/org/procurement/materials/extension/resubmit', { id: ext.requestId, action, note }), action === 'resubmit' ? 'Extension resubmitted.' : 'Extension withdrawn.')
        );
    const draftAction = (choice: 'submit' | 'delete') =>
        confirm.ask(
            {
                title: choice === 'delete' ? 'Delete draft' : 'Submit for approval',
                message: choice === 'delete' ? `Delete the unsubmitted draft ${m?.name}? Its audit history is kept.` : `Submit ${m?.name} for approval under PRC-001? Editing is locked while it is under approval.`,
                confirmLabel: choice === 'delete' ? 'Delete draft' : 'Submit',
                tone: choice === 'delete' ? 'danger' : 'primary',
            },
            async () => run(() => callBackend('/api/org/procurement/materials/' + choice, { id }), choice === 'submit' ? 'Submitted for approval.' : 'Draft deleted.', choice === 'delete')
        );
    const lifecycle = (action: 'disable' | 'delete') =>
        confirm.ask(
            { title: action === 'delete' ? 'Delete approved material' : 'Disable material', message: `${action === 'delete' ? 'Delete' : 'Disable'} ${m?.name}? This is recorded in the audit trail.`, confirmLabel: action === 'delete' ? 'Delete' : 'Disable', tone: 'danger' },
            async () => run(() => callBackend('/api/org/procurement/materials/lifecycle', { id, action }), 'Material ' + (action === 'delete' ? 'deleted.' : 'disabled.'), action === 'delete')
        );

    const myExtensionDecision = data?.approvals.extensions.find((x) => x.canApprove);
    const primary = !m ? null : m.canApprove ? (
        <Button testOverride={m.testOverride} disabled={busy} onClick={() => decide('approve', { kind: 'creation' })}><Check className='h-4 w-4' /> {m.workflowStage.startsWith('Review') ? 'Complete review' : 'Approve'}</Button>
    ) : myExtensionDecision ? (
        <Button testOverride={m.testOverride} disabled={busy} onClick={() => decide('approve', { kind: 'extension', ext: myExtensionDecision })}><Check className='h-4 w-4' /> Approve extension</Button>
    ) : m.canSubmit ? (
        <Button testOverride={m.testOverride} disabled={busy} onClick={() => draftAction('submit')}><Send className='h-4 w-4' /> Submit</Button>
    ) : m.canEdit ? (
        <Button testOverride={m.testOverride} disabled={busy} onClick={() => onEdit(id)}><Pencil className='h-4 w-4' /> Edit</Button>
    ) : m.canExtend ? (
        <Button testOverride={m.testOverride} disabled={busy} onClick={() => onExtend(id)}><Plus className='h-4 w-4' /> Extend</Button>
    ) : null;

    return (
        <>
            <Screen
                title={m?.name || 'Material'}
                eyebrow={m ? m.materialNumber && m.masterDataId ? m.materialNumber : m.requestId || m.id : id}
                subtitle={m ? `${words(m.status)}${m.workflowStage ? ' · ' + m.workflowStage : ''}` : 'Loading…'}
                onBack={onBack}
                actions={<>
                    <button type='button' aria-label='Refresh' onClick={reload} disabled={busy} className='hidden h-11 w-11 items-center justify-center rounded-xl border border-line text-soft active:bg-panel sm:flex'><RefreshCw className='h-4 w-4' /></button>
                    {primary}
                </>}
                toolbar={<Segmented label='Material sections' value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t.key, label: t.label, ...(t.key === 'approvals' && pendingExt.length + (m?.status === 'pending_approval' ? 1 : 0) ? { count: pendingExt.length + (m?.status === 'pending_approval' ? 1 : 0) } : {}) }))} />}
            >
                {failure && <Alert tone='error'>{failure}</Alert>}
                {notice && <Alert tone='success'>{notice}</Alert>}
                {error && <Alert tone='error'>{error}</Alert>}
                {loading && !data && <Spinner />}
                {m && data && <>
                    {m.returned && m.status === 'draft' && <Alert tone='warn'>Returned for correction{m.returnedAt ? ' on ' + showDate(m.returnedAt) : ''}: {m.returnReason}. Correct it and submit again.</Alert>}
                    {m.testOverride && (m.canApprove || myExtensionDecision) && <p className='text-xs text-blue-500'>Development test mode: blue-bordered actions can bypass workflow assignment and maker–checker. Every bypass is audited.</p>}

                    {tab === 'overview' && <>
                        <Lifecycle m={m} steps={data.approvals.steps} />
                        <MaterialIdentity m={m} />
                        <div className='grid grid-cols-2 gap-2 lg:grid-cols-4'>
                            <Metric label='Warehouses' value={String(published.length)} note='Original and extensions' />
                            <Metric label='Pending extensions' value={String(pendingExt.length)} note='Awaiting approval' />
                            <Metric label='Available' value={tracked.length ? qty(availableTotal) : '—'} note={incomplete ? 'Some balances withheld' : tracked.length ? `${m.uom || ''} in warehouses you can see` : 'No tracked stock'} />
                            <Metric label='Stock ledgers' value={`${tracked.length} / ${published.length}`} note='Reconciled balances' />
                        </div>
                        <section className='rounded-2xl border border-line bg-panel p-3'>
                            <h2 className='text-sm font-semibold text-ink'>Material</h2>
                            <dl className='grid gap-x-5 sm:grid-cols-2'>
                                <Fact label='Short text' value={m.shortText} />
                                <Fact label='Classification' value={[m.categoryCode, m.subcategoryCode, m.familyCode].filter(Boolean).join(' / ')} />
                                <Fact label='Catalogue material' value={m.materialCode} />
                                <Fact label='Unit of measure' value={m.uom} />
                                <Fact label='Supply relationship' value={m.supplyType} />
                                <Fact label='Part number' value={m.oemPartNumber || m.ocmPartNumber || m.generalPartNumber} />
                                <Fact label='Created' value={`${showDate(m.createdAt)}${m.createdByName ? ' · ' + m.createdByName : ''}`} />
                                <Fact label='Approved' value={showDate(m.approvedAt || '')} />
                            </dl>
                        </section>
                        {(m.canEdit || m.canDelete || m.canExtend || m.canLifecycle) && (
                            <section className='flex flex-wrap gap-2 rounded-2xl border border-line bg-panel p-3'>
                                <h2 className='w-full text-sm font-semibold text-ink'>More actions</h2>
                                {m.canEdit && <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={() => onEdit(id)}><Pencil className='h-4 w-4' /> Edit draft</Button>}
                                {m.canDelete && <Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={() => draftAction('delete')}><Trash2 className='h-4 w-4' /> Delete draft</Button>}
                                {m.canExtend && <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={() => onExtend(id)}><Plus className='h-4 w-4' /> Extend to a warehouse</Button>}
                                {m.canLifecycle && ['approved', 'active'].includes(m.status) && <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={() => lifecycle('disable')}>Disable</Button>}
                                {m.canLifecycle && m.status === 'approved' && !m.pushedAt && <Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={() => lifecycle('delete')}>Delete approved material</Button>}
                            </section>
                        )}
                    </>}

                    {tab === 'approvals' && <>
                        <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                                <h2 className='text-sm font-semibold text-ink'>New material · {data.approvals.requestId}</h2>
                                <Badge tone={statusTone(m.status)}>{words(m.status)}</Badge>
                            </div>
                            <dl className='grid gap-x-5 sm:grid-cols-2'>
                                <Fact label='Creation request ID' value={data.approvals.requestId} />
                                <Fact label='Approved master data ID' value={data.approvals.masterDataId || 'Issued at final approval'} />
                                <Fact label='Workflow' value={data.approvals.name ? `${data.approvals.code} · ${data.approvals.name}` : m.status === 'pending_approval' ? (m.testOverride ? 'Test recovery · PRC-001' : 'Snapshot missing') : 'Not under approval'} />
                                <Fact label='Order and threshold' value={[data.approvals.approvalMode, data.approvals.approvalRule === 'any' ? 'any one approver' : data.approvals.approvalRule ? 'all levels' : ''].filter(Boolean).join(' · ')} />
                                <Fact label='Submitted' value={showDate(m.submittedAt)} />
                                <Fact label='Returned for correction' value={m.returnCount ? `${m.returnCount} time${m.returnCount === 1 ? '' : 's'}` : 'Never'} />
                            </dl>
                            {m.canApprove && (
                                <div className='grid grid-cols-3 gap-2 border-t border-line pt-3'>
                                    <Button testOverride={m.testOverride} disabled={busy} onClick={() => decide('approve', { kind: 'creation' })}><Check className='h-4 w-4' /> {m.workflowStage.startsWith('Review') ? 'Reviewed' : 'Approve'}</Button>
                                    <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={() => decide('return', { kind: 'creation' })}><CornerUpLeft className='h-4 w-4' /> Return</Button>
                                    <Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={() => decide('reject', { kind: 'creation' })}><X className='h-4 w-4' /> Reject</Button>
                                </div>
                            )}
                            {!data.approvals.steps.length && m.status === 'pending_approval' && (m.testOverride
                                ? <Alert tone='info'>This older request has no workflow snapshot. In development test mode a decision performs an audited one-step recovery.</Alert>
                                : <Alert tone='warn'>This request has no valid workflow snapshot. A workflow administrator must resolve it under PRC-001.</Alert>)}
                            {data.approvals.steps.length > 0 && (
                                <ol className='space-y-2 border-t border-line pt-3'>
                                    {data.approvals.steps.map((step) => {
                                        const last = step.decisions[step.decisions.length - 1];
                                        return (
                                            <li key={step.number} className='rounded-xl border border-line bg-page p-3'>
                                                <div className='flex flex-wrap items-center justify-between gap-2'>
                                                    <p className='text-sm font-medium text-ink'>Level {step.number} · {step.action === 'review' ? 'Review' : 'Approval'}</p>
                                                    <Badge tone={last ? decisionTone(last.decision) : 'muted'}>{last ? decisionWord(last.decision) : 'Waiting'}</Badge>
                                                </div>
                                                <p className='mt-1 text-xs text-soft'>{step.assignee}</p>
                                                {step.decisions.map((d, i) => <p key={i} className='mt-1 text-xs text-muted'>{showDate(d.at)} · {d.by || 'Unknown'} · {decisionWord(d.decision)}{d.comment ? ' · ' + d.comment : ''}</p>)}
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}
                        </section>
                        {data.approvals.extensions.map((ext) => (
                            <section key={ext.requestId} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                                <div className='flex flex-wrap items-start justify-between gap-2'>
                                    <div className='min-w-0'>
                                        <h2 className='text-sm font-semibold text-ink'>Extension to {ext.warehouseName}</h2>
                                        <p className='font-mono text-xs text-muted'>{ext.requestId} · {ext.workflowCode || 'PRC-002'}</p>
                                        <p className='text-xs text-soft'>{ext.workflowStage}{ext.requestedBy ? ' · requested by ' + ext.requestedBy : ''}</p>
                                    </div>
                                    <Badge tone={statusTone(ext.status.toLowerCase().replaceAll(' ', '_'))}>{ext.status}</Badge>
                                </div>
                                {ext.justification && <p className='text-xs text-soft'>Why: {ext.justification}</p>}
                                {ext.returnReason && ext.canResubmit && <Alert tone='warn'>Returned: {ext.returnReason}</Alert>}
                                {ext.canApprove && (
                                    <div className='grid grid-cols-3 gap-2'>
                                        <Button testOverride={m.testOverride} disabled={busy} onClick={() => decide('approve', { kind: 'extension', ext })}><Check className='h-4 w-4' /> Approve</Button>
                                        <Button testOverride={m.testOverride} variant='secondary' disabled={busy} onClick={() => decide('return', { kind: 'extension', ext })}><CornerUpLeft className='h-4 w-4' /> Return</Button>
                                        <Button testOverride={m.testOverride} variant='danger' disabled={busy} onClick={() => decide('reject', { kind: 'extension', ext })}><X className='h-4 w-4' /> Reject</Button>
                                    </div>
                                )}
                                {ext.canResubmit && (
                                    <div className='grid grid-cols-2 gap-2'>
                                        <Button disabled={busy} onClick={() => resubmitExtension(ext, 'resubmit')}><Send className='h-4 w-4' /> Resubmit</Button>
                                        <Button variant='secondary' disabled={busy} onClick={() => resubmitExtension(ext, 'withdraw')}>Withdraw</Button>
                                    </div>
                                )}
                                {ext.decisions.map((d, i) => <p key={i} className='text-xs text-muted'>{showDate(d.at)} · {d.action || 'Workflow'} · {decisionWord(d.decision)} · {d.by}{d.comment ? ' · ' + d.comment : ''}</p>)}
                            </section>
                        ))}
                    </>}

                    {tab === 'warehouses' && <>
                        <p className='text-xs text-muted'>{data.ledgerNote} Quantities show only for warehouses you can access; pending extensions hold no stock.</p>
                        {data.availability.length ? data.availability.map((w) => (
                            <section key={w.warehouseId} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                                <div className='flex flex-wrap items-start justify-between gap-2'>
                                    <div className='min-w-0'>
                                        <h2 className='text-sm font-semibold text-ink'>{w.warehouseName}</h2>
                                        <p className='text-xs text-muted'>{w.warehouseCode} · {w.relation} · {w.requestId}</p>
                                    </div>
                                    <Badge tone={w.ledgerState === 'Tracked' ? 'brand' : w.ledgerState === 'Unreconciled' ? 'warn' : 'muted'}>{w.mapped ? w.ledgerState : w.status || 'Not published'}</Badge>
                                </div>
                                {w.ledgerState === 'Tracked' ? (
                                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                                        <Metric label='Available' value={qty(w.availableStock)} />
                                        <Metric label='Physical' value={qty(w.physicalStock)} />
                                        <Metric label='Reserved' value={qty(w.reservedStock)} />
                                        <Metric label='On order' value={qty(w.onOrder)} />
                                        <Metric label='In transit' value={qty(w.inTransit)} />
                                        <Metric label='Quarantined, damaged, expired' value={qty((w.quarantinedStock || 0) + (w.damagedStock || 0) + (w.expiredStock || 0))} />
                                    </div>
                                ) : (
                                    <p className='text-sm text-muted'>{w.ledgerState === 'Restricted' ? 'Outside your warehouse scope.' : w.ledgerState === 'Unavailable' ? 'Not yet published to this warehouse.' : w.ledgerState === 'Unreconciled' ? 'Some journal entries are unreconciled, so quantities are withheld.' : 'No posted stock yet.'}</p>
                                )}
                                <dl className='grid gap-x-4 sm:grid-cols-3'>
                                    <Fact label='Requested' value={showDate(w.requestedAt)} />
                                    <Fact label='Approved' value={showDate(w.approvedAt)} />
                                    <Fact label='Requested by' value={w.requestedBy} />
                                </dl>
                            </section>
                        )) : <p className='text-sm text-muted'>No warehouse association recorded.</p>}
                    </>}

                    {tab === 'attributes' && (
                        <section className='rounded-2xl border border-line bg-panel p-3'>
                            <h2 className='text-sm font-semibold text-ink'>Classification and technical attributes</h2>
                            <dl className='grid gap-x-5 sm:grid-cols-2'>
                                <Fact label='Category' value={m.categoryCode} />
                                <Fact label='Subcategory' value={m.subcategoryCode} />
                                <Fact label='Family' value={m.familyCode} />
                                <Fact label='Warehouse restrictions' value={m.warehouseRestrictionCodes.join(', ')} />
                                {data.attributes.map((a) => <Fact key={a.code} label={a.label} value={a.value + (a.unit ? ' ' + a.unit : '')} />)}
                            </dl>
                            {!data.attributes.length && <p className='mt-2 text-sm text-muted'>No technical attribute values saved.</p>}
                        </section>
                    )}

                    {tab === 'history' && <>
                        <p className='text-xs text-muted'>{data.historyNote}</p>
                        <ol className='space-y-2'>
                            {data.history.map((h) => (
                                <li key={h.id} className='rounded-xl border border-line bg-panel p-3'>
                                    <div className='flex flex-wrap items-center justify-between gap-2'>
                                        <p className='text-sm font-semibold text-ink'>{h.action}</p>
                                        <span className='text-xs tabular-nums text-soft'>{showDate(h.at)}</span>
                                    </div>
                                    <p className='break-words text-xs text-soft'>{h.by || 'System'} · {h.origin}</p>
                                    {h.details && <p className='break-words text-xs text-muted'>{h.details}</p>}
                                </li>
                            ))}
                        </ol>
                        {!data.history.length && <p className='text-sm text-muted'>No history recorded.</p>}
                    </>}
                </>}
            </Screen>
            {confirm.sheet}
        </>
    );
}
