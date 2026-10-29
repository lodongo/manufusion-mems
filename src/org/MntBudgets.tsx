import { Fragment, useMemo, useState } from 'react';
import { CheckCircle2, Wallet } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import RichTable, { type Column } from '../components/RichTable';
import { Alert, Field } from '../components/ui';
import { Screen, useConfirm } from '../components/screen';
import Sheet from '../components/Sheet';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';

// Maintenance › Budgets & cost approvals.
//  Budgets: the period (month) maintenance budget per cost center, with what approved work order estimates already
//  commit. A new or changed budget is proposed with a reason (MNT.budget.manage) and approved by Finance under the
//  Chart of Authority (Finance › Requests); nothing changes until it is approved.
//  Cost approvals: work order estimates waiting at your Chart of Authority level (MNT.WO.costApprove). You never
//  approve an estimate you made, and a person approves one level only. Every step is audited.

interface BudgetRow {
    ccId: string; ccCode: string; ccName: string; leCode: string; period: string;
    budget: number | null; committed: number; available: number | null; pendingRequestId: string; pendingAmount: number | null; canPropose: boolean;
}
interface CostRow {
    id: string; status: string; title: string; summary: string; reason: string; woCode: string; amount: number; currency: string; period: string;
    estimate: Record<string, number>; budget: Record<string, number | null>; maker: string; createdAt: string; level: string; canDecide: boolean; whyNot: string; mine: boolean;
}
const money = (n: number | null | undefined, c: string) => (n === null || n === undefined ? 'Not set' : `${c} ${Number(n).toLocaleString('en', { maximumFractionDigits: 2 })}`);
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function MntBudgets() {
    const [tab, setTab] = useState<'budgets' | 'approvals'>('budgets');
    return (
        <Screen
            title='Budgets & cost approvals'
            eyebrow='Maintenance'
            subtitle='Period budgets per cost center and work order estimates under the Chart of Authority.'
            onBack={() => navigate('organization_admin/mnt')}
            toolbar={
                <div role='tablist' className='grid grid-cols-2 gap-1 rounded-xl border border-line p-1'>
                    {([['budgets', 'Budgets'], ['approvals', 'Cost approvals']] as const).map(([k, label]) => (
                        <button key={k} role='tab' type='button' aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 rounded-lg text-sm font-medium ${tab === k ? 'bg-brand text-onbrand' : 'text-soft'}`}>{label}</button>
                    ))}
                </div>
            }
        >
            {tab === 'budgets' ? <Budgets /> : <Approvals />}
        </Screen>
    );
}

function Budgets() {
    const [period, setPeriod] = useState(thisMonth());
    const { data, error, loading, reload } = useLoad(() => callBackend<{ period: string; currency: string; rows: BudgetRow[] }>('/api/org/mnt/budget/list', { period }), [period]);
    const [editing, setEditing] = useState<BudgetRow | null>(null);
    const [info, setInfo] = useState('');
    const currency = data?.currency ?? '';
    const columns = useMemo<Array<Column<BudgetRow>>>(() => [
        { key: 'cc', label: 'Cost center', value: (r) => `${r.ccCode} ${r.ccName}` },
        { key: 'le', label: 'Legal entity', value: (r) => r.leCode, hidden: true },
        { key: 'budget', label: 'Budget', type: 'number', value: (r) => r.budget, render: (r) => money(r.budget, currency) },
        { key: 'committed', label: 'Committed', type: 'number', value: (r) => r.committed, render: (r) => money(r.committed, currency) },
        { key: 'available', label: 'Available', type: 'number', value: (r) => r.available, render: (r) => <span className={r.available !== null && r.available < 0 ? 'text-danger' : ''}>{money(r.available, currency)}</span> },
        { key: 'pending', label: 'Pending change', value: (r) => (r.pendingRequestId ? `${r.pendingRequestId} ${r.pendingAmount}` : ''), render: (r) => (r.pendingRequestId ? <Badge tone='warn'>{money(r.pendingAmount, currency)} · {r.pendingRequestId}</Badge> : '') },
    ], [currency]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Budgets could not be loaded.'}</Alert>;
    return (
        <div className='space-y-2'>
            <Field id='budget-period' type='month' label='Period' value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())} />
            {info && <Alert tone='success'>{info}</Alert>}
            {data.rows.some((r) => r.canPropose) && <p className='text-xs text-soft'>Tap a cost center to set or change its budget for {data.period}.</p>}
            <RichTable
                id='mnt.budgets'
                title={`Maintenance budgets ${data.period}`}
                fileName={`maintenance_budgets_${data.period}`}
                columns={columns}
                rows={data.rows}
                rowKey={(r) => r.ccId}
                onRowClick={(r) => (r.canPropose ? setEditing(r) : undefined)}
                empty='No cost centers in your maintenance scope.'
                height='h-[calc(100dvh-20rem)]'
            />
            {editing && <ProposeBudget row={editing} currency={currency} onClose={() => setEditing(null)} onDone={(id) => { setEditing(null); setInfo(`Budget change ${id} sent to Finance for approval under the Chart of Authority.`); reload(); }} />}
        </div>
    );
}

function ProposeBudget({ row, currency, onClose, onDone }: { row: BudgetRow; currency: string; onClose: () => void; onDone: (id: string) => void }) {
    const [amount, setAmount] = useState(row.budget === null ? '' : String(row.budget));
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const value = Number(amount);
    const problem = amount === '' || !Number.isFinite(value) || value < 0 ? 'Enter the amount (0 or more).' : value < row.committed ? `Approved estimates already commit ${money(row.committed, currency)}.` : reason.trim().length < 10 ? 'Give the reason (at least 10 characters).' : '';
    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ id: string }>('/api/org/mnt/budget/propose', { ccId: row.ccId, period: row.period, amount: value, reason: reason.trim() });
            onDone(r.id);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not propose the budget.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title={`${row.ccCode} · ${row.period}`} onClose={onClose} footer={<Button className='flex-1' busy={busy} disabled={!!problem || !!row.pendingRequestId} onClick={save}><Wallet className='h-4 w-4' />Send for approval</Button>}>
            <p className='text-sm text-soft'>{row.ccName}. Current budget {money(row.budget, currency)}, committed {money(row.committed, currency)}.</p>
            {row.pendingRequestId && <Alert tone='warn'>{row.pendingRequestId} is already waiting for approval for this period.</Alert>}
            <Field id='budget-amount' type='number' inputMode='decimal' min={0} label={`Maintenance budget for ${row.period} (${currency}) *`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Field id='budget-reason' label='Reason *' value={reason} onChange={(e) => setReason(e.target.value)} />
            {problem && amount !== '' && <p className='text-xs text-amber-300'>{problem}</p>}
            <p className='text-xs text-muted'>Finance approves it level by level under the Chart of Authority; you cannot approve your own proposal.</p>
            {error && <Alert tone='error'>{error}</Alert>}
        </Sheet>
    );
}

function Approvals() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ requests: CostRow[]; canApprove: boolean }>('/api/org/mnt/cost/requests'));
    const [open, setOpen] = useState<CostRow | null>(null);
    const [info, setInfo] = useState('');
    const columns = useMemo<Array<Column<CostRow>>>(() => [
        { key: 'id', label: 'Request', value: (r) => r.id, className: 'font-mono whitespace-nowrap' },
        { key: 'wo', label: 'Work order', value: (r) => r.woCode, className: 'font-mono whitespace-nowrap' },
        { key: 'amount', label: 'Estimate', type: 'number', value: (r) => r.amount, render: (r) => money(r.amount, r.currency) },
        { key: 'status', label: 'Status', value: (r) => (r.canDecide ? 'Waiting for you' : r.status), render: (r) => <Badge tone={r.canDecide ? 'warn' : r.status === 'approved' ? 'brand' : 'muted'}>{r.canDecide ? 'Waiting for you' : r.status}</Badge> },
        { key: 'level', label: 'Level', value: (r) => r.level },
        { key: 'period', label: 'Period', value: (r) => r.period },
        { key: 'maker', label: 'Planner', value: (r) => r.maker },
        { key: 'created', label: 'Submitted', type: 'date', value: (r) => r.createdAt, render: (r) => new Date(r.createdAt).toLocaleDateString() },
    ], []);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Cost approvals could not be loaded.'}</Alert>;
    return (
        <div className='space-y-2'>
            {info && <Alert tone='success'>{info}</Alert>}
            {!data.canApprove && <Alert tone='info'>You can see the estimates you submitted. Approving needs MNT.WO.costApprove and the job role of a Chart of Authority level.</Alert>}
            <RichTable id='mnt.cost.approvals' title='Work order cost approvals' fileName='maintenance_cost_approvals' columns={columns} rows={data.requests} rowKey={(r) => r.id} onRowClick={setOpen} empty='No work order estimates.' height='h-[calc(100dvh-18rem)]' />
            {open && <Decide row={open} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setInfo(m); reload(); }} />}
        </div>
    );
}

function Decide({ row, onClose, onDone }: { row: CostRow; onClose: () => void; onDone: (m: string) => void }) {
    const { ask, sheet } = useConfirm();
    const [error, setError] = useState('');
    const decide = (decision: 'approve' | 'reject') =>
        ask(
            decision === 'approve'
                ? { title: `Approve ${row.woCode} estimate?`, message: `${money(row.amount, row.currency)} at level ${row.level}. I have checked the estimate and the budget.`, confirmLabel: 'Approve', reason: { label: 'Note (optional)', minLength: 0 } }
                : { title: `Reject ${row.woCode} estimate?`, message: 'The planner revises and submits again.', confirmLabel: 'Reject', reason: { label: 'Reason', minLength: 10 } },
            async (reason) => {
                try {
                    const r = await callBackend<{ status: string }>('/api/org/mnt/cost/decide', { id: row.id, decision, reason, acknowledge: decision === 'approve' });
                    onDone(decision === 'reject' ? `${row.id} rejected.` : r.status === 'approved' ? `${row.woCode} cost approved.` : `${row.id} approved at your level; the next level decides.`);
                } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not record the decision.');
                }
            },
        );
    const e = row.estimate || {};
    const b = row.budget || {};
    return (
        <Sheet title={row.id} onClose={onClose} footer={row.canDecide ? <div className='flex w-full gap-2'><Button className='flex-1' onClick={() => decide('approve')}><CheckCircle2 className='h-4 w-4' />Approve</Button><Button variant='secondary' onClick={() => decide('reject')}>Reject</Button></div> : undefined}>
            <p className='text-base font-semibold text-ink'>{row.title}</p>
            <dl className='grid grid-cols-2 gap-x-3 gap-y-1 text-sm'>
                {(['labour', 'spares', 'services', 'allowance', 'total'] as const).map((k) => <Fragment key={k}><dt className='capitalize text-soft'>{k}</dt><dd className='text-right text-ink'>{money(e[k] ?? 0, row.currency)}</dd></Fragment>)}
            </dl>
            <p className='text-sm text-soft'>Budget {row.period}: {money(b.budget as number | null, row.currency)} · committed {money(b.committed as number, row.currency)} · available {money(b.available as number | null, row.currency)}</p>
            <p className='whitespace-pre-wrap text-sm text-soft'>{row.summary}</p>
            <p className='text-sm text-soft'>Reason: {row.reason}</p>
            <Button variant='secondary' onClick={() => navigate(`organization_admin/work_orders/${row.woCode}`)}>Open {row.woCode}</Button>
            {!row.canDecide && row.status === 'pending' && <p className='text-xs text-muted'>{row.whyNot}</p>}
            {error && <Alert tone='error'>{error}</Alert>}
            {sheet}
        </Sheet>
    );
}
