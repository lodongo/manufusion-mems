import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, ListChecks, Send } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, useConfirm } from '../components/screen';
import { Card, FIN_API, Facts, Frame, NextApprover, Pill, fmt, go } from './finKit';

// Finance approvals: every change to finance configuration and every posting that needs approval is a request
// (FCR + 8 digits) made by one person and decided by another who holds the approving right for that legal entity.
// Value-bearing requests are approved level by level under the finance chart of authority.

interface Row {
    id: string;
    leCode: string;
    type: string;
    typeLabel: string;
    title: string;
    status: string;
    makerName: string;
    createdAt: string;
    decidedAt: string;
    amount: number | null;
    mine: boolean;
    canDecide: boolean;
    step: string;
    next: string;
}

const COLS: Array<Column<Row>> = [
    { key: 'id', label: 'Request', value: (r) => r.id, render: (r) => <span className='font-mono text-xs'>{r.id}</span> },
    { key: 'st', label: 'Status', value: (r) => r.status, render: (r) => <Pill status={r.status} /> },
    { key: 'le', label: 'Legal entity', value: (r) => r.leCode },
    { key: 'type', label: 'Type', value: (r) => r.typeLabel },
    { key: 'title', label: 'What', value: (r) => r.title },
    { key: 'amt', label: 'Amount', type: 'number', value: (r) => r.amount ?? null, render: (r) => (r.amount === null ? '' : fmt(r.amount)) },
    { key: 'next', label: 'Next to approve', value: (r) => r.next, render: (r) => (r.next ? <span className='text-xs text-amber-200'>{r.next}</span> : '') },
    { key: 'by', label: 'Proposed by', value: (r) => r.makerName },
    { key: 'at', label: 'Proposed', type: 'date', value: (r) => r.createdAt, render: (r) => fmtDate(r.createdAt) },
    { key: 'step', label: 'Waiting for', value: (r) => r.step, hidden: true },
    { key: 'dec', label: 'Decided', type: 'date', value: (r) => r.decidedAt, hidden: true },
];

function List() {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ requests: Row[] }>(`${FIN_API}/requests/list`));
    const [view, setView] = useState<'me' | 'mine' | 'all'>('me');
    const rows = useMemo(() => (data?.requests ?? []).filter((r) => (view === 'me' ? r.canDecide : view === 'mine' ? r.mine : true)), [data, view]);
    return (
        <Frame
            title='Finance approvals'
            subtitle='Changes and postings waiting for a second person'
            onBack={() => go('module/FIN')}
            actions={<Button variant='secondary' onClick={reload}>Refresh</Button>}
            nav={[{ value: 'me', label: 'Waiting for me', icon: Clock3, count: (data?.requests ?? []).filter((r) => r.canDecide).length }, { value: 'mine', label: 'Proposed by me', icon: Send }, { value: 'all', label: 'All', icon: ListChecks }]}
            navValue={view}
            onNav={setView}
        >
            {loading && !data ? <Spinner /> : error ? <Alert tone='error'>{error}</Alert> : <RichTable id='fin.requests' columns={COLS} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => go(`fin_approvals/${r.id}`)} empty={view === 'me' ? 'Nothing is waiting for you.' : 'No requests.'} fileName='finance-requests' height='h-[calc(100dvh-12rem)]' />}
        </Frame>
    );
}

interface Detail {
    id: string;
    leCode: string;
    leName: string;
    type: string;
    typeLabel: string;
    title: string;
    summary: string;
    reason: string;
    status: string;
    amount: number | null;
    makerName: string;
    createdAt: string;
    payload: Record<string, unknown>;
    steps: Array<{ level: string; title: string; positionTitle: string; status: string; byName: string; at: string; note: string }>;
    history: Array<{ at: string; byName: string; action: string; note: string }>;
    result?: Record<string, unknown>;
    canDecide: boolean;
    whyNot: string;
    canWithdraw: boolean;
    next: { level: string; levelTitle: string; role: string; people: Array<{ uid: string; name: string; role: string }>; text: string } | null;
}

function show(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? Object.entries(x as Record<string, unknown>).map(([k, y]) => `${k}: ${show(y)}`).join(', ') : String(x))).join(' | ');
    if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, y]) => `${k}: ${show(y)}`).join('; ');
    return String(v);
}

function DetailView({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Detail>(`${FIN_API}/requests/get`, { id }), [id]);
    const confirm = useConfirm();
    const [done, setDone] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Request not found.'}</Alert>;
    const d = data;
    const journal = String(d.result?.journalId ?? '');
    return (
        <Screen
            title={d.id}
            subtitle={`${d.typeLabel} · ${d.leCode}`}
            onBack={() => go('fin_approvals')}
            actions={
                d.canDecide ? (
                    <>
                        <Button variant='danger' onClick={() => confirm.ask({ title: `Reject ${d.id}`, message: 'Nothing changes. The proposer sees your reason.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/requests/decide`, { id, decision: 'reject', reason }); setDone('Rejected.'); reload(); })}>
                            Reject
                        </Button>
                        <Button onClick={() => confirm.ask({ title: `Approve ${d.id}`, message: <span>{d.title}. {d.steps.filter((s) => s.status === 'pending').length > 1 ? 'Your level is approved; the next level decides next.' : 'This is the last approval: the change is applied (or the posting is made) now.'}</span>, confirmLabel: 'Approve', acknowledge: 'I have checked what this request changes or posts and I approve it.', reason: { label: 'Note, optional', minLength: 0 } }, async (reason) => { await callBackend(`${FIN_API}/requests/decide`, { id, decision: 'approve', reason, acknowledge: true }); setDone('Approved.'); reload(); })}>
                            Approve
                        </Button>
                    </>
                ) : d.canWithdraw ? (
                    <Button variant='secondary' onClick={() => confirm.ask({ title: `Withdraw ${d.id}`, message: 'The request is closed without any change.', confirmLabel: 'Withdraw', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/requests/withdraw`, { id, reason }); setDone('Withdrawn.'); reload(); })}>
                        Withdraw
                    </Button>
                ) : undefined
            }
        >
            {done && <Alert tone='success'>{done}</Alert>}
            {d.status === 'pending' && <NextApprover next={d.next} />}
            {!d.canDecide && d.status === 'pending' && d.whyNot && <Alert tone='info'>{d.whyNot}</Alert>}
            <Card title={d.title} right={<Pill status={d.status} />}>
                <Facts rows={[['Legal entity', `${d.leCode} ${d.leName}`], ['Type', d.typeLabel], ['Amount', d.amount === null ? '' : fmt(d.amount)], ['Proposed by', `${d.makerName}, ${fmtDate(d.createdAt)}`], ['Reason', d.reason]]} />
                <p className='whitespace-pre-wrap rounded-lg bg-page p-3 text-sm text-soft'>{d.summary}</p>
                {journal && (
                    <button type='button' className='min-h-11 text-sm text-brand' onClick={() => go(`fin_journal/${journal}`)}>
                        Posted as journal entry {journal}
                    </button>
                )}
            </Card>
            <Card title='Approval levels'>
                <ol className='space-y-2'>
                    {d.steps.map((s) => (
                        <li key={s.level} className='flex gap-3 rounded-xl border border-line p-3'>
                            {s.status === 'approved' ? <CheckCircle2 className='h-5 w-5 shrink-0 text-emerald-400' /> : <Clock3 className='h-5 w-5 shrink-0 text-amber-300' />}
                            <div className='min-w-0 text-sm'>
                                <p className='text-ink'>
                                    {s.level} · {s.title}
                                </p>
                                <p className='text-xs text-soft'>{s.positionTitle}</p>
                                {s.status === 'approved' ? <p className='text-xs text-muted'>Approved by {s.byName}, {fmtDate(s.at)}{s.note ? `: ${s.note}` : ''}</p> : <p className='text-xs text-amber-300'>Waiting</p>}
                            </div>
                        </li>
                    ))}
                </ol>
            </Card>
            <Card title='What it contains'>
                <Facts rows={Object.entries(d.payload ?? {}).map(([k, v]) => [k, show(v).slice(0, 1200)])} />
            </Card>
            <Card title='History'>
                <ul className='space-y-1 text-sm'>
                    {d.history.map((h, i) => (
                        <li key={i} className='text-soft'>
                            <span className='text-muted'>{fmtDate(h.at)}</span> {h.byName}: {h.action}
                            {h.note ? `. ${h.note}` : ''}
                        </li>
                    ))}
                </ul>
            </Card>
            {confirm.sheet}
        </Screen>
    );
}

export default function FinApprovals({ id }: { id?: string }) {
    return id && /^FCR\d{8}$/.test(id) ? <DetailView id={id} /> : <List />;
}
