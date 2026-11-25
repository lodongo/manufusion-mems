import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { messageOf, useConfirm } from '../components/screen';

// Workflow actions from every module (PR, PO, invoices, stock take, work requests and orders, plans …). Each was sent
// to the person as an internal email, a To-do and a chat message, and closes only when the step is completed in its
// module: nothing here (or in the email, To-do or chat) can close it by hand.

export interface WorkflowAction {
    id: string; module: string; label: string; ref: string; title: string; stage: string; link: string; linkLabel: string;
    status: 'open' | 'closed'; createdAt: string; closedAt: string; outcome: string; testMode: boolean; ageHours: number;
    recipients: Array<{ uid: string; name: string; withdrawn: boolean }>; intended: Array<{ uid: string; name: string }>;
}
export const openWorkflowLink = (link: string) => navigate(`organization_home/${link || 'my_workflow'}`);
const age = (h: number) => (h < 1 ? 'under 1 h' : h < 48 ? `${h} h` : `${Math.round(h / 24)} d`);

export default function WorkflowActionsPanel() {
    // Organization view and reconcile are for workflow administrators (ADM.workflows); the server says who that is.
    const [canManage, setCanManage] = useState(false);
    const [scope, setScope] = useState<'mine' | 'all'>('mine');
    const [rows, setRows] = useState<WorkflowAction[]>([]);
    const [show, setShow] = useState<'open' | 'closed' | 'all'>('open');
    const [open, setOpen] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const confirm = useConfirm();
    const load = useCallback(async () => {
        try {
            const r = await callBackend<{ actions: WorkflowAction[]; canManage?: boolean }>(scope === 'mine' ? '/api/org/workflow/actions/mine' : '/api/org/workflow/actions/all');
            setRows(r.actions);
            if (scope === 'mine') setCanManage(r.canManage === true);
            setError('');
        } catch (e) {
            setError(messageOf(e));
        }
    }, [scope]);
    useEffect(() => {
        void load();
        const t = setInterval(() => document.visibilityState === 'visible' && void load(), 60_000);
        return () => clearInterval(t);
    }, [load]);
    const visible = useMemo(() => rows.filter((r) => show === 'all' || r.status === show), [rows, show]);
    const openCount = rows.filter((r) => r.status === 'open').length;
    const columns: Array<Column<WorkflowAction>> = [
        { key: 'status', label: 'Status', value: (r) => (r.status === 'open' ? 'Open' : 'Closed'), render: (r) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'open' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-brand/10 text-brand'}`}>{r.status === 'open' ? 'Open' : 'Closed'}</span> },
        { key: 'module', label: 'Module', value: (r) => r.module },
        { key: 'ref', label: 'Reference', value: (r) => r.ref },
        { key: 'title', label: 'What', value: (r) => r.title },
        { key: 'stage', label: 'Step', value: (r) => r.stage },
        { key: 'age', label: 'Age', type: 'number', value: (r) => r.ageHours, render: (r) => age(r.ageHours) },
        { key: 'who', label: 'Assigned to', value: (r) => r.recipients.filter((x) => !x.withdrawn).map((x) => x.name).join(', '), hidden: scope === 'mine' },
        { key: 'test', label: 'Test mode', value: (r) => (r.testMode ? `Yes · normally ${r.intended.map((x) => x.name).join(', ') || 'nobody'}` : ''), hidden: true },
        { key: 'created', label: 'Created', type: 'date', value: (r) => r.createdAt.slice(0, 10) },
        { key: 'closed', label: 'Closed', type: 'date', value: (r) => r.closedAt.slice(0, 10), hidden: show === 'open' },
        { key: 'outcome', label: 'Outcome', value: (r) => r.outcome, hidden: show === 'open' },
        { key: 'open', label: '', value: () => '', render: (r) => <button type='button' onClick={(e) => { e.stopPropagation(); openWorkflowLink(r.link); }} className='inline-flex min-h-11 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-brand'><ExternalLink className='h-3.5 w-3.5' /> Open</button> },
    ];
    const reconcile = () =>
        confirm.ask({ title: 'Reconcile workflow actions', message: 'Creates the actions of any step still missing them (for example after role or chart of authority changes) and closes actions whose step is complete. It is audited.', confirmLabel: 'Reconcile' }, async () => {
            setBusy(true);
            try {
                const r = await callBackend<{ created: number; closed: number }>('/api/org/workflow/actions/reconcile');
                setNotice(`${r.created} action(s) created and ${r.closed} closed.`);
                await load();
            } finally {
                setBusy(false);
            }
        });
    return (
        <section aria-label='Workflow actions' className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            {confirm.sheet}
            <button type='button' aria-expanded={open} onClick={() => setOpen((x) => !x)} className='flex min-h-11 w-full items-center gap-2 text-left'>
                <BellRing className='h-5 w-5 text-brand' />
                <span className='min-w-0 flex-1'>
                    <span className='block text-sm font-semibold text-ink'>Workflow actions{openCount ? ` · ${openCount} open` : ''}</span>
                    <span className='block text-xs text-muted'>Sent to you by email, To-do and chat. Each closes only when its step is completed in its module.</span>
                </span>
                {open ? <ChevronUp className='h-4 w-4 text-brand' /> : <ChevronDown className='h-4 w-4 text-brand' />}
            </button>
            {open && (
                <div className='space-y-2'>
                    <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2'>
                        <div className='min-w-0'>
                            <SelectField id='wf-actions-show' label='Show' hideLabel value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
                                <option value='open'>Open</option>
                                <option value='closed'>Closed (90 days)</option>
                                <option value='all'>All</option>
                            </SelectField>
                        </div>
                        {canManage && (
                            <div className='min-w-0'>
                                <SelectField id='wf-actions-scope' label='Whose actions' hideLabel value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                                    <option value='mine'>Mine</option>
                                    <option value='all'>Whole organization</option>
                                </SelectField>
                            </div>
                        )}
                        <button type='button' aria-label='Refresh workflow actions' title='Refresh' onClick={() => void load()} className='flex h-11 w-11 items-center justify-center rounded-lg border border-line text-brand'><RefreshCw className='h-4 w-4' /></button>
                                            </div>
                    {canManage && <button type='button' disabled={busy} onClick={reconcile} className='min-h-11 w-full rounded-lg border border-line px-3 text-sm font-semibold text-ink disabled:opacity-50 sm:w-auto'>Reconcile now</button>}
                    {error && <Alert tone='error'>{error}</Alert>}
                    {notice && <Alert tone='success'>{notice}</Alert>}
                    <RichTable id={`wf.actions.${scope}`} title={scope === 'mine' ? 'My workflow actions' : 'Organization workflow actions'} fileName={scope === 'mine' ? 'My_workflow_actions' : 'Workflow_actions'} columns={columns} rows={visible} rowKey={(r) => r.id} onRowClick={(r) => openWorkflowLink(r.link)} empty={show === 'open' ? 'Nothing is waiting for you.' : 'No workflow actions.'} height='h-[min(28rem,calc(100dvh-22rem))]' />
                </div>
            )}
        </section>
    );
}
