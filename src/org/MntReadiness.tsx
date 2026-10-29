import { useState } from 'react';
import { CheckCircle2, Circle, ClipboardCheck, Lock, ShieldCheck, Wallet } from 'lucide-react';
import { Alert } from '../components/ui';
import { Badge, Button, Card } from '../admin/kit';
import { workspaceNavigate as navigate } from '../lib/route';
import { mntApi, mntInput, type MntData } from './MntWorkOrder';
import MntGateHint from './MntGateHint';

// The planner's readiness checklist on a work order: spares, services and people come from the task tabs; the
// schedule is locked here, the assessment risks reviewed, and the estimated cost sent for Chart of Authority approval
// (someone other than the planner approves it). Readiness can be confirmed only when every item is done; the work
// order then waits for a maintenance window. The server recomputes everything on each read and on confirmation.

const money = (n: number, currency: string) => `${currency} ${Number(n || 0).toLocaleString('en', { maximumFractionDigits: 2 })}`;
const COST_LABEL: Record<string, string> = { none: 'Not submitted', pending: 'Waiting for approval', approved: 'Approved', stale: 'Changed since approval: submit again', rejected: 'Rejected: submit again', withdrawn: 'Withdrawn', superseded: 'Dates moved to another period: submit again' };

export default function MntReadiness({ code, wo, checklist, canPlan, currency, onDone }: { code: string; wo: MntData; checklist: MntData; canPlan: boolean; currency: string; onDone: () => void }) {
    const [start, setStart] = useState<string>(wo.scheduledStart || '');
    const [end, setEnd] = useState<string>(wo.scheduledEnd || '');
    const [dateNote, setDateNote] = useState('');
    const [riskNote, setRiskNote] = useState('');
    const [allowance, setAllowance] = useState<string>(String(checklist.estimate?.allowance ?? 0));
    const [reason, setReason] = useState('');
    const [justification, setJustification] = useState('');
    const [busy, setBusy] = useState('');
    const [failure, setFailure] = useState('');
    const [info, setInfo] = useState('');
    const items: MntData[] = checklist.items || [];
    const done = (key: string) => !!items.find((i) => i.key === key)?.done;
    const est = checklist.estimate || {};
    const cost = checklist.cost || {};
    const budget = checklist.budget || {};
    const datesChanged = start !== (wo.scheduledStart || '') || end !== (wo.scheduledEnd || '');
    const allowanceNum = Number(allowance) || 0;
    const total = Number(est.total || 0) - Number(est.allowance || 0) + allowanceNum;
    const overBudget = budget.available === null || budget.available === undefined || total > Number(budget.available);
    const editable = canPlan && ['planning', 'plan_ready'].includes(wo.status);

    const act = async (action: string, body: MntData, ok: string) => {
        setBusy(action);
        setFailure('');
        setInfo('');
        try {
            const r = await mntApi({ code, action, ...body });
            setInfo(r.requestId ? `${ok} (${r.requestId}).` : ok);
            onDone();
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'Could not save.');
        } finally {
            setBusy('');
        }
    };

    if (!['planning', 'plan_ready'].includes(wo.status))
        return wo.readiness?.at ? (
            <Card className='space-y-1 text-sm'>
                <p className='flex items-center gap-2 font-semibold text-ink'><CheckCircle2 className='h-4 w-4 text-brand' />Ready · confirmed by {wo.readiness.name}</p>
                <p className='text-soft'>Estimate {money(wo.readiness.estimate, currency)} · cost approved {wo.costApproval?.approvedByName ? `by ${wo.costApproval.approvedByName}` : ''}</p>
                {wo.windowStart ? <p className='text-soft'>Window {new Date(wo.windowStart).toLocaleString()} to {new Date(wo.windowEnd).toLocaleString()}</p> : <Button variant='secondary' onClick={() => navigate('organization_admin/maintenance_windows')}>Put it in a maintenance window</Button>}
            </Card>
        ) : null;

    return (
        <Card className='space-y-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                    <p className='text-xs font-semibold uppercase tracking-wide text-brand'>Planning</p>
                    <h2 className='text-lg font-semibold text-ink'>Readiness checklist</h2>
                </div>
                <Badge tone={checklist.ready ? 'brand' : 'warn'}>{items.filter((i) => i.done).length} of {items.length} done</Badge>
            </div>
            <ul className='space-y-1.5'>
                {items.map((i) => (
                    <li key={i.key} className='flex items-start gap-2 text-sm'>
                        {i.done ? <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0 text-brand' /> : <Circle className='mt-0.5 h-4 w-4 shrink-0 text-muted' />}
                        <span className='min-w-0'><span className='text-ink'>{i.label}</span>{i.detail ? <span className='block text-xs text-soft'>{i.detail}</span> : null}</span>
                    </li>
                ))}
            </ul>
            {(checklist.problems || []).length > 0 && (
                <details className='rounded-xl border border-line p-3 text-sm'>
                    <summary className='cursor-pointer text-soft'>Open items from the task tabs ({checklist.problems.length})</summary>
                    <ul className='mt-2 list-disc space-y-1 pl-5 text-xs text-soft'>{checklist.problems.map((p: string, k: number) => <li key={k}>{p}</li>)}</ul>
                    <p className='mt-2 text-xs text-muted'>Reserve spares, engage procurement for services and allocate people on each task's Spares, Services and Personnel tabs.</p>
                </details>
            )}

            {editable && (
                <>
                    <section className='space-y-2 rounded-xl border border-line p-3'>
                        <p className='flex items-center gap-2 text-sm font-semibold text-ink'><Lock className='h-4 w-4' />Schedule dates {done('schedule') && <Badge tone='brand'>Locked</Badge>}</p>
                        <div className='grid grid-cols-2 gap-2'>
                            <label className='text-sm text-soft'>Start<input type='date' className={mntInput} value={start} onChange={(e) => setStart(e.target.value)} /></label>
                            <label className='text-sm text-soft'>End<input type='date' className={mntInput} min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
                        </div>
                        {datesChanged && <label className='block text-sm text-soft'>Why do the dates change? *<input className={mntInput} value={dateNote} onChange={(e) => setDateNote(e.target.value)} /></label>}
                        <Button variant='secondary' busy={busy === 'lock_schedule'} disabled={!start || !end || end < start || (datesChanged && dateNote.trim().length < 10)}
                            onClick={() => act('lock_schedule', { scheduledStart: start, scheduledEnd: end, note: dateNote.trim() }, 'Dates locked')}>{done('schedule') && !datesChanged ? 'Locked' : 'Lock dates'}</Button>
                    </section>

                    <section className='space-y-2 rounded-xl border border-line p-3'>
                        <p className='flex items-center gap-2 text-sm font-semibold text-ink'><ShieldCheck className='h-4 w-4' />Risk assessment {done('risk') && <Badge tone='brand'>Reviewed</Badge>}</p>
                        <p className='text-xs text-soft'>Review each task's hazards, machine status, LOTO and permits on the Risk assessment tab, then record the review.</p>
                        {!done('risk') && <label className='block text-sm text-soft'>Review notes *<textarea rows={2} className={mntInput} value={riskNote} onChange={(e) => setRiskNote(e.target.value)} /></label>}
                        {!done('risk') && <Button variant='secondary' busy={busy === 'review_risk'} disabled={riskNote.trim().length < 10} onClick={() => act('review_risk', { note: riskNote.trim() }, 'Risk review recorded')}>Confirm risk review</Button>}
                    </section>

                    <section className='space-y-2 rounded-xl border border-line p-3'>
                        <p className='flex items-center gap-2 text-sm font-semibold text-ink'><Wallet className='h-4 w-4' />Cost and budget <Badge tone={cost.current ? 'brand' : cost.status === 'pending' ? 'warn' : 'muted'}>{COST_LABEL[cost.status] || cost.status}</Badge></p>
                        <dl className='grid grid-cols-2 gap-x-3 gap-y-1 text-sm'>
                            <dt className='text-soft'>Labour</dt><dd className='text-right text-ink'>{money(est.labour, currency)}</dd>
                            <dt className='text-soft'>Spares</dt><dd className='text-right text-ink'>{money(est.spares, currency)}</dd>
                            <dt className='text-soft'>Services</dt><dd className='text-right text-ink'>{money(est.services, currency)}</dd>
                            <dt className='text-soft'>Allowance</dt><dd className='text-right text-ink'>{money(allowanceNum, currency)}</dd>
                            <dt className='font-semibold text-ink'>Estimate</dt><dd className='text-right font-semibold text-ink'>{money(total, currency)}</dd>
                        </dl>
                        <p className='text-xs text-soft'>
                            {wo.costCenterCode} budget for {budget.period}: {budget.budget === null || budget.budget === undefined ? 'not set' : `${money(budget.budget, currency)} · committed ${money(budget.committed, currency)} · available ${money(budget.available, currency)}`}
                        </p>
                        {(est.uncosted || []).length > 0 && (
                            <p className='rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-ink'>No cost yet for: {est.uncosted.map((u: MntData) => u.item).join(', ')}. Cover them with the allowance.</p>
                        )}
                        {cost.status !== 'pending' && !cost.current && (
                            <>
                                <label className='block text-sm text-soft'>Allowance for items without a cost<input type='number' inputMode='decimal' min={0} className={mntInput} value={allowance} onChange={(e) => setAllowance(e.target.value)} /></label>
                                {overBudget && <label className='block text-sm text-soft'>{budget.budget === null || budget.budget === undefined ? 'No budget is set for this period: why must the work go ahead? *' : 'Over budget: why? *'}<textarea rows={2} className={mntInput} value={justification} onChange={(e) => setJustification(e.target.value)} /></label>}
                                <label className='block text-sm text-soft'>Reason for the request *<input className={mntInput} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                                <Button busy={busy === 'submit_cost'} disabled={reason.trim().length < 10 || (overBudget && justification.trim().length < 20) || allowanceNum < 0}
                                    onClick={() => act('submit_cost', { allowance: allowanceNum, reason: reason.trim(), justification: justification.trim() }, 'Sent for Chart of Authority approval')}>Submit cost for approval</Button>
                            </>
                        )}
                        {cost.status === 'pending' && <p className='text-xs text-soft'>{cost.requestId} is with the Chart of Authority approvers (Maintenance › Budgets & cost approvals).</p>}
                    </section>
                </>
            )}
            {failure && <MntGateHint message={failure} />}
            {info && <Alert tone='success'>{info}</Alert>}
            {editable && (
                <Button className='w-full' busy={busy === 'confirm_readiness'} disabled={!checklist.ready} onClick={() => act('confirm_readiness', {}, 'Readiness confirmed: add it to a maintenance window')}>
                    <ClipboardCheck className='h-4 w-4' />Confirm readiness
                </Button>
            )}
        </Card>
    );
}
