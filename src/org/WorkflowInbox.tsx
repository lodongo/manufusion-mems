import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CheckSquare, Circle, Clock3, ExternalLink, X, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { InfoTip, Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { Badge, Button, Card, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';

// My workflow: everything waiting in approval chains that concerns the signed-in person.
//   Awaiting my action   approvals assigned to me (approve, reject with a comment, or reconcile approved stock)
//   My submissions       my own requests on their way through the chain
//   Conflicts            steps mapped to me for my own requests (nobody approves their own request)
//   Others               visible for tracking only
// Approvals go to the module's own endpoint (material creation, extension, stock isolation). The server enforces
// the chain of authority and separation of duties; its messages are shown as they come.

interface Item {
    id: string;
    type: string;
    label: string;
    name: string;
    status?: string;
    approvalLevel: number;
    submittedAt: string;
    isMine: boolean;
    canApprove: boolean;
    conflict: boolean;
    configurationOnly: boolean;
    needsReconciliation?: boolean;
    sourceId: string;
    creatorName: string;
    creatorEmail: string;
}
interface Inbox {
    items: Item[];
    warning?: string;
}
type Filter = 'all' | 'action' | 'mine' | 'conflict' | 'others' | 'passed';

/** Key figures and the approval trail of one request (from /api/org/workflows/describe and /passed). */
interface Trail {
    key: string;
    type: string;
    id: string;
    label: string;
    title: string;
    status: string;
    statusLabel: string;
    level: number;
    totalLevels: number;
    submittedAt: string;
    requester: string;
    isMine: boolean;
    details: Array<{ label: string; value: string }>;
    source: { path: string; label: string } | null;
    steps: Array<{ level: number; approver: string; state: 'done' | 'current' | 'waiting' | 'rejected'; by: string; at: string; comment: string }>;
}
const summary = (t?: Trail) => (t ? t.details.slice(0, 3).map((d) => `${d.label}: ${d.value}`).join(' · ') : '');
/** A request I already decided that is still open, shaped like an inbox row. */
const asItem = (t: Trail): Item => ({
    id: t.id, type: t.type, label: t.label, name: t.title, status: t.status, approvalLevel: t.level, submittedAt: t.submittedAt, isMine: t.isMine,
    canApprove: false, conflict: false, configurationOnly: false, sourceId: '', creatorName: t.requester, creatorEmail: '',
});
type Tone = 'brand' | 'muted' | 'danger' | 'warn';

const keyOf = (x: Item) => `${x.type}:${x.id}`;
const endpointOf = (x: Item) => (x.type === 'stock_adjustment' ? '/api/org/inventory/material/isolation/approve' : '/api/org/procurement/materials/' + (x.type === 'extension' ? 'extension/approve' : 'approve'));
/** Nobody approves their own request, whatever the server lists. */
const approvable = (x: Item) => x.canApprove && !x.isMine;
/** Stock isolation approvals only support approve. */
const rejectable = (x: Item) => approvable(x) && x.type !== 'stock_adjustment' && !x.needsReconciliation;
/** Bulk approval covers plain approvals only; stock reconciliation is done one by one. */
const bulkable = (x: Item) => approvable(x) && !x.needsReconciliation;

function stateOf(x: Item): { label: string; tone: Tone } {
    if (x.needsReconciliation) return { label: 'Approved · reconcile stock', tone: 'warn' };
    if (x.conflict) return { label: 'Self-approval conflict', tone: 'danger' };
    if (approvable(x)) return { label: 'Awaiting your approval', tone: 'warn' };
    if (x.configurationOnly) return { label: 'Mapped, not yet executable', tone: 'muted' };
    if (x.isMine) return { label: 'Awaiting approval', tone: 'brand' };
    return { label: 'Pending with others', tone: 'muted' };
}

const FILTERS: Record<Filter, (x: Item) => boolean> = {
    all: () => true,
    action: approvable,
    mine: (x) => x.isMine,
    conflict: (x) => x.conflict,
    others: (x) => !x.isMine && !approvable(x) && !x.conflict,
    passed: () => false,
};

export default function WorkflowInbox() {
    const { data, loading, error, reload } = useLoad(() => callBackend<Inbox>('/api/org/procurement/workflows/inbox'));
    const passedLoad = useLoad(() => callBackend<{ items: Trail[] }>('/api/org/workflows/passed').catch(() => ({ items: [] as Trail[] })));
    const [trails, setTrails] = useState<Record<string, Trail>>({});
    const [filter, setFilter] = useState<Filter>('all');
    const chosen = useRef(false);
    const [selected, setSelected] = useState<string[]>([]);
    const [openKey, setOpenKey] = useState('');
    const [notice, setNotice] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);
    const confirm = useConfirm();

    const items = useMemo(() => data?.items ?? [], [data]);
    const passedTrails = useMemo(() => passedLoad.data?.items ?? [], [passedLoad.data]);
    const passedItems = useMemo(() => passedTrails.filter((t) => !items.some((i) => keyOf(i) === t.key)).map(asItem), [passedTrails, items]);
    const rows = useMemo(() => (filter === 'passed' ? passedItems : items.filter(FILTERS[filter])), [items, passedItems, filter]);

    // Key figures and trail for what is on screen.
    useEffect(() => {
        if (!items.length) return;
        let alive = true;
        callBackend<{ items: Trail[] }>('/api/org/workflows/describe', { items: items.slice(0, 60).map((x) => ({ type: x.type, id: x.id })) })
            .then((r) => alive && setTrails((cur) => ({ ...cur, ...Object.fromEntries(r.items.map((t) => [t.key, t])) })))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [items]);
    useEffect(() => {
        if (passedTrails.length) setTrails((cur) => ({ ...cur, ...Object.fromEntries(passedTrails.map((t) => [t.key, t])) }));
    }, [passedTrails]);

    // Work waiting for me always comes first. When nothing is waiting, show what has passed through me and is still open.
    useEffect(() => {
        if (chosen.current || loading || passedLoad.loading || !data) return;
        chosen.current = true;
        if (items.some(approvable)) setFilter('action');
        else if (passedItems.length) setFilter('passed');
    }, [loading, passedLoad.loading, data, items, passedItems]);
    const count = (f: Filter) => items.filter(FILTERS[f]).length;
    const targets = items.filter((x) => bulkable(x) && selected.includes(keyOf(x)));
    const selectableInView = rows.filter(bulkable);
    const allInViewSelected = selectableInView.length > 0 && selectableInView.every((x) => selected.includes(keyOf(x)));
    const opened = [...items, ...passedItems].find((x) => keyOf(x) === openKey) ?? null;

    const toggle = (x: Item, on: boolean) => setSelected((list) => (on ? [...list.filter((k) => k !== keyOf(x)), keyOf(x)] : list.filter((k) => k !== keyOf(x))));
    const finished = (x: Item, text: string) => {
        passedLoad.reload();
        setNotice({ tone: 'success', text });
        setSelected((list) => list.filter((k) => k !== keyOf(x)));
        setOpenKey('');
        reload();
    };

    const approve = (x: Item) =>
        confirm.ask(
            {
                title: x.needsReconciliation ? `Reconcile stock for ${x.id}?` : `Approve ${x.id}?`,
                message: (
                    <>
                        <p>
                            {x.label}: {x.name || x.sourceId || x.id}
                        </p>
                        <p className='mt-1 text-xs text-muted'>
                            Requested by {x.creatorName || 'unknown'} · stage {x.approvalLevel}
                        </p>
                        <p className='mt-2'>{x.needsReconciliation ? 'The approved stock adjustment is posted to the material journal.' : 'Your approval is recorded at this stage; the request moves to the next approver or completes.'}</p>
                    </>
                ),
                confirmLabel: x.needsReconciliation ? 'Reconcile stock' : 'Approve',
                acknowledge: x.needsReconciliation ? 'I understand this posts the approved adjustment to stock and cannot be undone.' : undefined,
            },
            async () => {
                const r = await callBackend<{ ok?: boolean; message?: string }>(endpointOf(x), { id: x.id, decision: 'approve' });
                finished(x, r?.message || (x.needsReconciliation ? `Stock adjustment ${x.id} reconciled.` : `Approved ${x.id}.`));
            }
        );

    const reject = (x: Item) =>
        confirm.ask(
            {
                title: `Reject ${x.id}?`,
                message: `${x.label}: ${x.name || x.sourceId || x.id}. The request is rejected and your comment is sent to ${x.creatorName || 'the requester'} and kept in the audit trail.`,
                confirmLabel: 'Reject request',
                tone: 'danger',
                reason: { label: 'Rejection comment', minLength: 10, placeholder: 'What must the requester correct?' },
            },
            async (comment) => {
                await callBackend(endpointOf(x), { id: x.id, decision: 'reject', comment });
                finished(x, `Rejected ${x.id}.`);
            }
        );

    const approveSelected = () => {
        const list = targets;
        if (!list.length) return;
        confirm.ask(
            {
                title: `Approve ${list.length} request${list.length === 1 ? '' : 's'}?`,
                message: (
                    <>
                        <p>Each request is approved at your stage, one after the other:</p>
                        <ul className='mt-2 list-disc space-y-0.5 pl-5 text-xs'>
                            {list.slice(0, 8).map((x) => (
                                <li key={keyOf(x)}>
                                    {x.id} · {x.label}
                                </li>
                            ))}
                            {list.length > 8 && <li>and {list.length - 8} more</li>}
                        </ul>
                    </>
                ),
                confirmLabel: `Approve ${list.length}`,
                acknowledge: 'I have reviewed every selected request.',
            },
            async () => {
                const failed: Array<{ x: Item; message: string }> = [];
                for (const x of list) {
                    try {
                        await callBackend(endpointOf(x), { id: x.id, decision: 'approve' });
                    } catch (err) {
                        failed.push({ x, message: messageOf(err) });
                    }
                }
                setSelected(failed.map((f) => keyOf(f.x)));
                reload();
                const ok = list.length - failed.length;
                if (!ok) throw new Error(`None approved. ${failed[0].x.id}: ${failed[0].message}`);
                const details = failed.slice(0, 5).map((f) => `${f.x.id}: ${f.message}`).join(' · ');
                setNotice(failed.length ? { tone: 'warn', text: `Approved ${ok} of ${list.length}. Not approved: ${details}` } : { tone: 'success', text: `Approved ${ok} request${ok === 1 ? '' : 's'}.` });
            }
        );
    };

    const columns = useMemo<Array<Column<Item>>>(
        () => [
            {
                key: 'select',
                label: 'Select',
                value: (x) => (selected.includes(keyOf(x)) ? 'Selected' : ''),
                render: (x) =>
                    bulkable(x) ? (
                        <label className='flex h-11 w-11 items-center justify-center' onClick={(e) => e.stopPropagation()}>
                            <input type='checkbox' aria-label={`Select ${x.id}`} className='h-5 w-5 accent-emerald-500' checked={selected.includes(keyOf(x))} onChange={(e) => toggle(x, e.target.checked)} />
                        </label>
                    ) : (
                        ''
                    ),
            },
            { key: 'id', label: 'Reference', value: (x) => x.id, render: (x) => <span className='font-mono text-xs font-semibold text-ink'>{x.id}</span> },
            { key: 'label', label: 'Transaction', value: (x) => x.label },
            { key: 'name', label: 'Description / material', value: (x) => x.name || x.sourceId, className: 'max-w-80 truncate' },
            { key: 'figures', label: 'Key details', value: (x) => summary(trails[keyOf(x)]), className: 'max-w-96 truncate' },
            { key: 'progress', label: 'Progress', value: (x) => { const t = trails[keyOf(x)]; return t ? `${t.steps.filter((s) => s.state === 'done').length} of ${t.totalLevels} approved` : ''; } },
            { key: 'source', label: 'Source', value: (x) => x.sourceId, hidden: true },
            { key: 'creator', label: 'Creator', value: (x) => x.creatorName },
            { key: 'email', label: 'Creator email', value: (x) => x.creatorEmail, hidden: true },
            { key: 'submitted', label: 'Submitted', type: 'date', value: (x) => x.submittedAt, render: (x) => fmtDate(x.submittedAt) },
            { key: 'stage', label: 'Stage', type: 'number', value: (x) => x.approvalLevel, render: (x) => `Level ${x.approvalLevel}` },
            { key: 'state', label: 'Current status', value: (x) => stateOf(x).label, render: (x) => <Badge tone={stateOf(x).tone}>{stateOf(x).label}</Badge> },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selected, trails]
    );

    const options: Array<{ value: Filter; label: string; count: number }> = [
        { value: 'all', label: 'All', count: count('all') },
        { value: 'action', label: 'Awaiting my action', count: count('action') },
        { value: 'mine', label: 'My submissions', count: count('mine') },
        { value: 'conflict', label: 'Conflicts', count: count('conflict') },
        { value: 'others', label: 'Others', count: count('others') },
        { value: 'passed', label: 'Passed through me', count: passedItems.length },
    ];

    return (
        <>
            <Screen
                title='My workflow'
                subtitle='Active transactions, approval assignments and outstanding requests'
                actions={
                    <Button disabled={!targets.length} onClick={approveSelected}>
                        <CheckCircle2 className='h-4 w-4' /> Approve{targets.length ? ` (${targets.length})` : ''}
                    </Button>
                }
                toolbar={<Segmented label='Workflow views' value={filter} options={options} onChange={setFilter} />}
            >
                {error && <Alert tone='error'>{error}</Alert>}
                {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
                {count('conflict') > 0 && <Alert tone='warn'>Nobody can approve their own request. Ask an administrator to map another authorized approver to the conflicting steps.</Alert>}
                {!data && loading ? (
                    <Spinner />
                ) : (
                    <RichTable
                        id='wf.inbox'
                        title='My workflow'
                        fileName='My_workflow'
                        columns={columns}
                        rows={rows}
                        rowKey={keyOf}
                        onRowClick={(x) => setOpenKey(keyOf(x))}
                        empty={filter === 'passed' ? 'Nothing you approved is still open.' : 'No active workflow items match this view.'}
                        height='h-[calc(100dvh-18rem)]'
                        actions={
                            selectableInView.length > 0 ? (
                                <Button
                                    variant='secondary'
                                    onClick={() =>
                                        setSelected((list) => {
                                            const keys = selectableInView.map(keyOf);
                                            return allInViewSelected ? list.filter((k) => !keys.includes(k)) : [...new Set([...list, ...keys])];
                                        })
                                    }
                                >
                                    <CheckSquare className='h-4 w-4' /> {allInViewSelected ? 'Clear' : 'Select all'}
                                </Button>
                            ) : undefined
                        }
                    />
                )}
                <div className='flex items-start gap-1'>
                    <p className='min-w-0 flex-1 pt-3 text-xs text-muted'>Integrated approval requests and registered cross-module workflow submissions.</p>
                    <InfoTip label='Tracking only items'>Transactions without an executable approval handler are visible for tracking but cannot be approved until their module is connected. Stock reconciliations are approved one at a time.</InfoTip>
                </div>
            </Screen>

            {opened && <ItemSheet item={opened} trail={trails[keyOf(opened)]} onClose={() => setOpenKey('')} onApprove={() => approve(opened)} onReject={() => reject(opened)} />}
            {confirm.sheet}
        </>
    );
}

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
    return (
        <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
            <dt className='text-xs text-muted'>{label}</dt>
            <dd className='break-words text-sm text-ink'>{children}</dd>
        </div>
    );
}

/** Request details: a full screen sheet on phones, a side panel on larger screens; decisions on top. */
function ItemSheet({ item: x, trail, onClose, onApprove, onReject }: { item: Item; trail?: Trail; onClose: () => void; onApprove: () => void; onReject: () => void }) {
    const state = stateOf(x);
    return (
        <div className='fixed inset-0 z-[90] flex justify-end' role='presentation'>
            <button type='button' aria-label='Close' tabIndex={-1} className='absolute inset-0 hidden bg-black/60 sm:block' onClick={onClose} />
            <section role='dialog' aria-modal='true' aria-label={`Request ${x.id}`} className='relative flex h-full w-full flex-col bg-page sm:max-w-xl sm:border-l sm:border-line'>
                <header className='shrink-0 space-y-2 border-b border-line bg-page p-3 pt-[max(0.75rem,env(safe-area-inset-top))]'>
                    <div className='flex items-center gap-2'>
                        <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                            <X className='h-5 w-5' />
                        </button>
                        <div className='min-w-0 flex-1'>
                            <p className='truncate font-mono text-xs text-brandsoft'>{x.id}</p>
                            <h2 className='truncate text-base font-semibold text-ink'>{x.label}</h2>
                        </div>
                        <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    {approvable(x) && (
                        <div className='flex flex-wrap gap-2'>
                            <Button onClick={onApprove}>
                                <CheckCircle2 className='h-4 w-4' /> {x.needsReconciliation ? 'Reconcile approved stock' : 'Approve request'}
                            </Button>
                            {rejectable(x) && (
                                <Button variant='danger' onClick={onReject}>
                                    <XCircle className='h-4 w-4' /> Reject
                                </Button>
                            )}
                        </div>
                    )}
                </header>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                    {x.conflict && <Alert tone='warn'>This approval step is mapped to you for your own request. Another authorized approver must be assigned.</Alert>}
                    {x.isMine && x.canApprove && !x.conflict && <Alert tone='warn'>You submitted this request, so you cannot approve it.</Alert>}
                    {x.configurationOnly && <Alert tone='info'>This transaction is mapped to a workflow but its module is not connected yet; it is shown for tracking only.</Alert>}
                    {x.type === 'stock_adjustment' && approvable(x) && !x.needsReconciliation && <Alert tone='info'>Stock isolation requests can only be approved here.</Alert>}
                    {trail && trail.details.length > 0 && (
                        <Card>
                            <h3 className='mb-2 text-sm font-semibold text-ink'>Key details</h3>
                            <dl className='grid grid-cols-2 gap-3'>
                                {trail.details.map((d) => (
                                    <Detail key={d.label} label={d.label}>{d.value}</Detail>
                                ))}
                            </dl>
                        </Card>
                    )}
                    {trail && trail.source && (
                        <Button variant='secondary' onClick={() => navigate(`organization_home/${trail.source!.path}`)}>
                            <ExternalLink className='h-4 w-4' /> {trail.source.label}
                        </Button>
                    )}
                    {trail && (
                        <Card>
                            <h3 className='mb-1 text-sm font-semibold text-ink'>Approval trail</h3>
                            <p className='mb-2 text-xs text-muted'>
                                Submitted {fmtDate(trail.submittedAt)}
                                {trail.requester ? ` by ${trail.requester}` : ''}
                            </p>
                            <ol className='space-y-3'>
                                {trail.steps.map((s) => (
                                    <li key={s.level} className='flex gap-3'>
                                        <span className='mt-0.5 shrink-0'>
                                            {s.state === 'done' ? <CheckCircle2 className='h-5 w-5 text-emerald-500' /> : s.state === 'rejected' ? <XCircle className='h-5 w-5 text-red-500' /> : s.state === 'current' ? <Clock3 className='h-5 w-5 text-amber-500' /> : <Circle className='h-5 w-5 text-muted' />}
                                        </span>
                                        <div className='min-w-0'>
                                            <p className='text-sm text-ink'>
                                                Level {s.level} · {s.approver}
                                            </p>
                                            <p className='text-xs text-muted'>
                                                {s.state === 'done' ? `Approved by ${s.by || 'unknown'} · ${fmtDate(s.at)}` : s.state === 'rejected' ? `Rejected by ${s.by || 'unknown'} · ${fmtDate(s.at)}` : s.state === 'current' ? 'Waiting for this approver' : 'Not reached yet'}
                                            </p>
                                            {s.comment && <p className='mt-0.5 whitespace-pre-wrap break-words text-xs text-soft'>{s.comment}</p>}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        </Card>
                    )}
                    <Card>
                        <dl className='grid grid-cols-2 gap-3'>
                            <Detail label='Reference'>{x.id}</Detail>
                            <Detail label='Transaction'>{x.label}</Detail>
                            <Detail label='Description / material' wide>
                                {x.name || '—'}
                            </Detail>
                            {x.sourceId && <Detail label='Source'>{x.sourceId}</Detail>}
                            <Detail label='Stage'>Level {x.approvalLevel}</Detail>
                            <Detail label='Created by'>{x.creatorName || '—'}</Detail>
                            <Detail label='Email'>{x.creatorEmail || '—'}</Detail>
                            <Detail label='Submitted'>{fmtDate(x.submittedAt)}</Detail>
                            {x.status && <Detail label='Request status'>{x.status.replace(/_/g, ' ')}</Detail>}
                        </dl>
                    </Card>
                </div>
            </section>
        </div>
    );
}
