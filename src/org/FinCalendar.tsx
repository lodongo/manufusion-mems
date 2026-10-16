import { useMemo, useState } from 'react';
import { CalendarCheck, ChevronRight, ClipboardCheck, Coins, Lock, Plus, RefreshCw, Table2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { restoredTableTab } from '../lib/tableTabs';
import { Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { useConfirm } from '../components/screen';
import { Balance, Card, FIN_API, FinScreen, Facts, Pending, Pill, errText, fmt, go, useEntity, type Entity } from './finKit';

// Financial calendar of a legal entity: financial years from last year up to five years ahead, their periods generated
// from the approved setup (calendar months, 4-4-5, 4-5-4, 5-4-4 or 13 x 4 weeks), the active period, and the life of
// each period: not yet open, open, closing (period-end work), closed and locked. Inside a period: the trial balance,
// the inventory and GR/IR reconciliation, cost reallocation, the year-end close, and the requests to close and lock it.

interface PeriodRow {
    no: number;
    name: string;
    start: string;
    end: string;
    special: boolean;
    weeks: number | null;
    status: string;
    statusLabel: string;
    history: Array<{ at: string; from: string; to: string; byName: string; note?: string }>;
}
interface YearRow {
    fy: number;
    label: string;
    status: string;
    start: string;
    end: string;
    weeks: number | null;
    calendarType: string;
    yearEndJournal: string;
    periods: PeriodRow[];
}
interface CalData {
    settings: unknown;
    status: string;
    years: YearRow[];
    active: { fy: number; no: number; name: string; status: string } | null;
    canAdd: number[];
    pending: Array<{ id: string; typeLabel: string; title: string; makerName: string }>;
    can: Record<string, boolean>;
}

function YearCard({ le, y, active, can, onDone }: { le: Entity; y: YearRow; active: CalData['active']; can: Record<string, boolean>; onDone: (m: string) => void }) {
    const [pick, setPick] = useState<number[]>([]);
    const [preview, setPreview] = useState<null | { start: string; end: string; label: string; weeks: number | null; calendarType: string; calendarNote: string; periods: Array<{ no: number; name: string; start: string; end: string; weeks: number | null; special: boolean }> }>(null);
    const [err, setErr] = useState('');
    const [typeOk, setTypeOk] = useState(false);
    const [datesOk, setDatesOk] = useState(false);
    const confirm = useConfirm();
    const openable = y.periods.filter((p) => p.status === 'future' || p.status === 'closed');
    const toggle = (no: number) => setPick(pick.includes(no) ? pick.filter((x) => x !== no) : [...pick, no].sort((a, b) => a - b));
    if (y.status === 'draft')
        return (
            <Card title={`${y.label}: not initialised`} right={<Pill status='draft' />}>
                {err && <Alert tone='error'>{err}</Alert>}
                {!preview ? (
                    <Button variant='secondary' onClick={() => callBackend<typeof preview>(`${FIN_API}/calendar/year/preview`, { leId: le.id, fy: y.fy }).then((p) => { setPreview(p); setErr(''); }).catch((e) => setErr(errText(e)))}>
                        Generate the periods
                    </Button>
                ) : (
                    <div className='space-y-2'>
                        <Facts rows={[['Calendar type', preview.calendarType], ['Year', `${preview.start} to ${preview.end}${preview.weeks ? ` · ${preview.weeks} weeks` : ''}`], ['Periods', String(preview.periods.length)]]} />
                        <p className='text-xs text-muted'>{preview.calendarNote}</p>
                        <div className='max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-line'>
                            <table className='w-full text-sm'>
                                <thead className='sticky top-0 bg-panel text-xs text-muted'>
                                    <tr>
                                        <th className='p-2 text-left'>Period</th>
                                        <th className='p-2 text-left'>From</th>
                                        <th className='p-2 text-left'>To</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.periods.map((p) => (
                                        <tr key={p.no} className='border-t border-line'>
                                            <td className='p-2 text-ink'>{p.name}</td>
                                            <td className='p-2 font-mono text-xs'>{p.start}</td>
                                            <td className='p-2 font-mono text-xs'>{p.end}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {can.calendar_manage && (
                            <>
                                <label className='flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm text-soft'>
                                    <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={typeOk} onChange={(e) => setTypeOk(e.target.checked)} />
                                    <span>I confirm the calendar type in use: {preview.calendarType}.</span>
                                </label>
                                <label className='flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm text-soft'>
                                    <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={datesOk} onChange={(e) => setDatesOk(e.target.checked)} />
                                    <span>I have checked every period's dates above.</span>
                                </label>
                                <Button disabled={!typeOk || !datesOk} onClick={() => confirm.ask({ title: `Initialise ${preview.label}`, message: `${preview.periods.length} periods from ${preview.start} to ${preview.end}. A person with FIN.calendar.approve must approve it. Periods are then opened through approval.`, confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/calendar/year/init`, { leId: le.id, fy: y.fy, reason, confirmType: true, confirmDates: true }); setPreview(null); onDone('Proposed for approval.'); })}>
                                    Propose initialisation
                                </Button>
                            </>
                        )}
                    </div>
                )}
                {confirm.sheet}
            </Card>
        );
    return (
        <Card title={`${y.label} · ${y.start} to ${y.end}`} right={<Pill status={y.status} />}>
            <ul className='divide-y divide-line overflow-hidden rounded-xl border border-line'>
                {y.periods.map((p) => {
                    const isActive = active?.fy === y.fy && active.no === p.no;
                    return (
                        <li key={p.no} className={`flex items-center gap-2 px-2 ${isActive ? 'bg-emerald-500/10' : ''}`}>
                            {can.calendar_manage && openable.some((x) => x.no === p.no) && <input type='checkbox' aria-label={`Select ${p.name}`} className='h-5 w-5 shrink-0 accent-emerald-500' checked={pick.includes(p.no)} onChange={() => toggle(p.no)} />}
                            <button type='button' onClick={() => go(`fin_calendar/${y.fy}/${p.no}`)} className='flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left'>
                                <span className='min-w-0 flex-1'>
                                    <span className='block truncate text-sm text-ink'>
                                        {p.name}
                                        {isActive && <span className='ml-2 text-xs font-semibold text-emerald-300'>Active period</span>}
                                    </span>
                                    <span className='block font-mono text-[11px] text-muted'>
                                        {p.start} to {p.end}
                                        {p.weeks ? ` · ${p.weeks} weeks` : ''}
                                    </span>
                                </span>
                                <Pill status={p.status} label={p.statusLabel} />
                                {p.status === 'locked' && <Lock className='h-4 w-4 text-red-300' />}
                                <ChevronRight className='h-4 w-4 text-muted' />
                            </button>
                        </li>
                    );
                })}
            </ul>
            {y.yearEndJournal && (
                <button type='button' className='min-h-11 text-sm text-brand' onClick={() => go(`fin_journal/${y.yearEndJournal}`)}>
                    Year-end close posted: {y.yearEndJournal}
                </button>
            )}
            {can.calendar_manage && pick.length > 0 && (
                <Button onClick={() => confirm.ask({ title: `Open ${pick.length} period(s)`, message: 'Periods open in order. A closed period can be reopened until it is locked. A person with FIN.calendar.approve must approve.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${FIN_API}/calendar/period/status`, { leId: le.id, fy: y.fy, nos: pick, to: 'open', reason }); setPick([]); onDone('Proposed for approval.'); })}>
                    <CalendarCheck className='h-4 w-4' /> Propose opening {pick.length} period(s)
                </Button>
            )}
            {confirm.sheet}
        </Card>
    );
}

function Years({ le }: { le: Entity }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<CalData>(`${FIN_API}/calendar/get`, { leId: le.id }), [le.id]);
    const [add, setAdd] = useState('');
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the calendar.'}</Alert>;
    const done = (m: string) => {
        setMsg(m);
        reload();
    };
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            {err && <Alert tone='error'>{err}</Alert>}
            {!data.settings && <Alert tone='warn'>Finance setup is not approved yet. Approve the calendar rules in Finance &gt; Setup before initialising years.</Alert>}
            <Pending items={data.pending} />
            <Card title='Active period'>
                {data.active ? (
                    <p className='text-sm text-ink'>
                        {data.active.name} of FY {data.active.fy} <Pill status={data.active.status} />
                    </p>
                ) : (
                    <p className='text-sm text-soft'>No initialised year covers today.</p>
                )}
            </Card>
            {data.can.calendar_manage && data.canAdd.length > 0 && (
                <Card title='Add a financial year'>
                    <div className='flex items-end gap-2'>
                        <div className='min-w-0 flex-1'>
                            <SelectField id='fc-add' label='Financial year' value={add} onChange={(e) => setAdd(e.target.value)} hint='From last year up to five years ahead.'>
                                <option value=''>Choose</option>
                                {data.canAdd.map((y) => (
                                    <option key={y} value={y}>
                                        FY {y}
                                    </option>
                                ))}
                            </SelectField>
                        </div>
                        <Button disabled={!add} onClick={() => callBackend(`${FIN_API}/calendar/year/add`, { leId: le.id, fy: Number(add) }).then(() => { setAdd(''); setErr(''); done(`FY ${add} added. Generate and propose its periods.`); }).catch((e) => setErr(errText(e)))}>
                            <Plus className='h-4 w-4' /> Add
                        </Button>
                    </div>
                </Card>
            )}
            {[...data.years].reverse().map((y) => (
                <YearCard key={y.fy} le={le} y={y} active={data.active} can={data.can} onDone={done} />
            ))}
            {!data.years.length && <p className='text-sm text-muted'>No financial years yet.</p>}
        </>
    );
}

// ----- One period: period-end work -----

interface CloseStatus {
    period: { fy: number; no: number; name: string; label: string; status: string; start: string; end: string; special: boolean; last: boolean };
    yearEndJournal: string;
    yearEndNotNeeded: boolean;
    runs: Array<{ id: string; kind: string; at: string; byName: string; balanced: boolean; clean: boolean; status: string; journalId: string; lines: Array<{ ccCode: string; ccName: string; glCode: string; ledger: number; stock: number; diff: number }>; grir: Array<{ po: string; amount: number; since: string; ageDays: number }> }>;
    requests: Array<{ id: string; typeLabel: string; title: string; status: string; result: Record<string, unknown>; next: string }>;
    can: { run: boolean; journal: boolean };
}
interface TbRow {
    glCode: string;
    glName: string;
    statement: string;
    ccCode: string;
    ccName: string;
    open: number;
    dr: number;
    cr: number;
    close: number;
}
const TB_COLS: Array<Column<TbRow>> = [
    { key: 'gl', label: 'Account', value: (r) => r.glCode, render: (r) => <span className='font-mono text-xs'>{r.glCode}</span> },
    { key: 'name', label: 'Name', value: (r) => r.glName },
    { key: 'st', label: 'BS / PL', value: (r) => r.statement },
    { key: 'cc', label: 'Cost center', value: (r) => `${r.ccCode} ${r.ccName}`.trim(), hidden: true },
    { key: 'open', label: 'Opening', type: 'number', value: (r) => r.open, render: (r) => <Balance value={r.open} /> },
    { key: 'dr', label: 'Debits', type: 'number', value: (r) => r.dr, render: (r) => <span className='font-mono text-sky-300'>{fmt(r.dr)}</span> },
    { key: 'cr', label: 'Credits', type: 'number', value: (r) => r.cr, render: (r) => <span className='font-mono text-amber-300'>{fmt(r.cr)}</span> },
    { key: 'close', label: 'Closing', type: 'number', value: (r) => r.close, render: (r) => <Balance value={r.close} /> },
];

function Trial({ le, fy, no, canSave, onSaved }: { le: Entity; fy: number; no: number; canSave: boolean; onSaved: () => void }) {
    const [byCc, setByCc] = useState(() => { try { return !!sessionStorage.getItem('mems.table.open.fin.tb.cc'); } catch { return false; } });
    const { data, error, loading, reload } = useLoad(() => callBackend<{ rows: TbRow[]; totals: { open: number; dr: number; cr: number; close: number }; balanced: boolean }>(`${FIN_API}/close/tb`, { leId: le.id, fy, no, byCc }), [le.id, fy, no, byCc]);
    const [err, setErr] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the trial balance.'}</Alert>;
    return (
        <div className='space-y-2'>
            <div className='flex flex-wrap items-center gap-2'>
                <Pill status={data.balanced ? 'clean' : 'failed'} label={data.balanced ? 'Balanced' : 'Does not balance'} />
                <span className='text-xs text-muted'>
                    Debits {fmt(data.totals.dr)} · Credits {fmt(data.totals.cr)}
                </span>
                <Button variant='secondary' onClick={() => setByCc(!byCc)}>
                    {byCc ? 'By account' : 'By account and cost center'}
                </Button>
                {canSave && (
                    <Button variant='secondary' onClick={() => callBackend(`${FIN_API}/close/tb`, { leId: le.id, fy, no, save: true }).then(() => { setErr(''); reload(); onSaved(); }).catch((e) => setErr(errText(e)))}>
                        Record for period-end
                    </Button>
                )}
            </div>
            {err && <Alert tone='error'>{err}</Alert>}
            <RichTable id={`fin.tb.${byCc ? 'cc' : 'gl'}`} tabKey='tb' columns={byCc ? TB_COLS.map((c) => (c.key === 'cc' ? { ...c, hidden: false } : c)) : TB_COLS} rows={data.rows} rowKey={(r) => `${r.glCode}|${r.ccCode}`} empty='No balances in this period.' fileName={`trial-balance-${le.code}-${fy}-P${no}`} height='h-96' />
        </div>
    );
}

function Realloc({ le, fy, no, onDone }: { le: Entity; fy: number; no: number; onDone: (m: string) => void }) {
    const [sender, setSender] = useState('');
    const [ccQ, setCcQ] = useState('');
    const prev = useLoad(() => (sender ? callBackend<{ accounts: Array<{ code: string; name: string; amount: number }>; receivers: Array<{ id: string; code: string; name: string }> }>(`${FIN_API}/close/realloc/preview`, { leId: le.id, fy, no, senderCc: sender }) : Promise.resolve(null)), [sender]);
    const all = useLoad(() => callBackend<{ costCenters: Array<{ id: string; code: string; name: string }> }>(`${FIN_API}/cc/list`, { leId: le.id }), [le.id]);
    const [gls, setGls] = useState<string[]>([]);
    const [recv, setRecv] = useState<Array<{ ccId: string; pct: string }>>([{ ccId: '', pct: '100' }]);
    const [note, setNote] = useState('');
    const confirm = useConfirm();
    const total = recv.reduce((s, r) => s + (Number(r.pct) || 0), 0);
    const ccs = (all.data?.costCenters ?? []).filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(ccQ.toLowerCase()));
    const ok = sender && gls.length && recv.every((r) => r.ccId && Number(r.pct) > 0) && Math.abs(total - 100) < 0.001;
    return (
        <div className='space-y-2'>
            <Field id='ra-q' label='Find the sending cost center' value={ccQ} onChange={(e) => setCcQ(e.target.value)} />
            <SelectField id='ra-s' label='Sending cost center' value={sender} onChange={(e) => { setSender(e.target.value); setGls([]); }}>
                <option value=''>Choose</option>
                {ccs.map((c) => (
                    <option key={c.id} value={c.id}>
                        {c.code} {c.name}
                    </option>
                ))}
            </SelectField>
            {prev.loading && sender && <Spinner />}
            {prev.error && <Alert tone='error'>{prev.error}</Alert>}
            {prev.data && (
                <>
                    {!prev.data.accounts.length && <p className='text-sm text-muted'>No debit balance on profit and loss accounts in this period.</p>}
                    {prev.data.accounts.map((a) => (
                        <label key={a.code} className='flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm'>
                            <input type='checkbox' className='h-5 w-5 accent-emerald-500' checked={gls.includes(a.code)} onChange={() => setGls(gls.includes(a.code) ? gls.filter((x) => x !== a.code) : [...gls, a.code])} />
                            <span className='min-w-0 flex-1 truncate text-ink'>
                                {a.code} {a.name}
                            </span>
                            <span className='font-mono text-sky-300'>{fmt(a.amount)}</span>
                        </label>
                    ))}
                    <p className='text-xs text-muted'>Receiving cost centers and their share (must add up to 100%).</p>
                    {recv.map((r, i) => (
                        <div key={i} className='flex items-end gap-2'>
                            <div className='min-w-0 flex-1'>
                                <SelectField id={`ra-r-${i}`} label={`Receiver ${i + 1}`} value={r.ccId} onChange={(e) => setRecv(recv.map((x, k) => (k === i ? { ...x, ccId: e.target.value } : x)))}>
                                    <option value=''>Choose</option>
                                    {prev.data!.receivers.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.code} {c.name}
                                        </option>
                                    ))}
                                </SelectField>
                            </div>
                            <div className='w-24'>
                                <Field id={`ra-p-${i}`} label='%' inputMode='decimal' value={r.pct} onChange={(e) => setRecv(recv.map((x, k) => (k === i ? { ...x, pct: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                            </div>
                        </div>
                    ))}
                    <div className='flex gap-2'>
                        <Button variant='secondary' onClick={() => setRecv([...recv, { ccId: '', pct: '' }])}>
                            Add receiver
                        </Button>
                        {recv.length > 1 && (
                            <Button variant='secondary' onClick={() => setRecv(recv.slice(0, -1))}>
                                Remove last
                            </Button>
                        )}
                    </div>
                    <p className={`text-xs ${Math.abs(total - 100) < 0.001 ? 'text-muted' : 'text-amber-300'}`}>Total {fmt(total)}%</p>
                    <Field id='ra-n' label='Basis of the reallocation (e.g. headcount, floor area)' value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
                    <Button disabled={!ok} onClick={() => confirm.ask({ title: 'Propose the reallocation', message: 'The system computes the amounts from the balances of this period; they are checked again at approval. Approval follows the finance chart of authority.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 15 } }, async (reason) => { await callBackend(`${FIN_API}/close/realloc/propose`, { leId: le.id, fy, no, senderCc: sender, glCodes: gls, receivers: recv.map((r) => ({ ccId: r.ccId, pct: Number(r.pct) })), note, reason }); onDone('Reallocation proposed for approval.'); })}>
                        Propose reallocation
                    </Button>
                </>
            )}
            {confirm.sheet}
        </div>
    );
}

type PeriodTab = 'checklist' | 'tb' | 'recon' | 'realloc';
function PeriodView({ le, fy, no, tab }: { le: Entity; fy: number; no: number; tab: PeriodTab }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<CloseStatus>(`${FIN_API}/close/status`, { leId: le.id, fy, no }), [le.id, fy, no]);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const confirm = useConfirm();
    const lastRecon = useMemo(() => data?.runs.find((r) => r.kind === 'inventory'), [data]);
    const lastTb = useMemo(() => data?.runs.find((r) => r.kind === 'trial_balance'), [data]);
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the period.'}</Alert>;
    const p = data.period;
    const done = (m: string) => {
        setMsg(m);
        setErr('');
        reload();
    };
    const act = (to: string, title: string, message: string, url = 'calendar/period/status') =>
        confirm.ask({ title, message, confirmLabel: 'Confirm', tone: to === 'locked' ? 'danger' : 'primary', reason: { label: 'Reason', minLength: 10 }, ...(to === 'locked' ? { phrase: 'LOCK' } : {}) }, async (reason) => {
            await callBackend(`${FIN_API}/${url}`, { leId: le.id, fy, no, to, reason });
            done(to === 'closing' ? 'Period-end work started: operational postings into this period stop.' : to === 'reopen_from_closing' ? 'The period is open again.' : 'Proposed for approval.');
        });
    const work = ['open', 'closing'].includes(p.status);
    return (
        <>
            {msg && <Alert tone='success'>{msg}</Alert>}
            {err && <Alert tone='error'>{err}</Alert>}
            <Card title={`${p.name} · ${p.label}`} right={<Pill status={p.status} />}>
                <Facts rows={[['Dates', `${p.start} to ${p.end}`], ['Kind', p.special ? 'Year-end adjustment period' : 'Normal period'], ['Last trial balance', lastTb ? `${fmtDate(lastTb.at)}, ${lastTb.balanced ? 'balanced' : 'NOT balanced'}` : 'Not run'], ['Last inventory reconciliation', lastRecon ? `${fmtDate(lastRecon.at)}, ${lastRecon.status}` : 'Not run']]} />
                {data.can.run && (
                    <div className='flex flex-wrap gap-2'>
                        {p.status === 'open' && <Button variant='secondary' onClick={() => act('closing', 'Start period-end work', 'Operational postings dated in this period are refused from now on; only period-end postings (reconciliation, reallocation, year-end close) can be made.')}>Start period-end</Button>}
                        {p.status === 'closing' && <Button variant='secondary' onClick={() => act('reopen_from_closing', 'Stop period-end work', 'The period becomes open again for operational postings.')}>Back to open</Button>}
                        {work && <Button onClick={() => act('closed', 'Propose closing the period', 'Needs a recorded balanced trial balance and a clean (or adjusted) inventory reconciliation for this period, with nothing pending. A person with FIN.close.approve decides.')}>Propose close</Button>}
                        {p.status === 'closed' && <Button variant='danger' onClick={() => act('locked', 'Propose locking the period', 'A locked period can never be reopened. Earlier periods must be locked first; the last period of the year needs the year-end close.')}>Propose lock</Button>}
                        {p.status === 'closed' && <Button variant='secondary' onClick={() => act('open', 'Propose reopening', 'The period opens for postings again until it is closed. Needs approval.')}>Propose reopen</Button>}
                    </div>
                )}
            </Card>
            {tab === 'checklist' && (
                <>
                    <Card title='Before closing'>
                        <ul className='space-y-1 text-sm'>
                            <li className={lastTb?.balanced ? 'text-emerald-300' : 'text-amber-300'}>{lastTb?.balanced ? '✓' : '•'} Trial balance recorded and balanced</li>
                            <li className={lastRecon && (lastRecon.clean || lastRecon.status === 'adjusted') ? 'text-emerald-300' : 'text-amber-300'}>{lastRecon && (lastRecon.clean || lastRecon.status === 'adjusted') ? '✓' : '•'} Inventory agrees with the ledger (or the difference is approved and posted)</li>
                            <li className={data.requests.some((r) => r.status === 'pending') ? 'text-amber-300' : 'text-emerald-300'}>{data.requests.some((r) => r.status === 'pending') ? '•' : '✓'} No period-end request waiting</li>
                            {p.last && <li className={data.yearEndJournal || data.yearEndNotNeeded ? 'text-emerald-300' : 'text-amber-300'}>{data.yearEndJournal || data.yearEndNotNeeded ? '✓' : '•'} Year-end close posted (needed before locking the last period)</li>}
                        </ul>
                        {p.last && !data.yearEndJournal && !data.yearEndNotNeeded && data.can.run && work && (
                            <Button onClick={() => confirm.ask({ title: 'Propose the year-end close', message: 'Every profit and loss balance of the year is closed to retained earnings in this period. Earlier periods must be closed. Approval follows the finance chart of authority.', confirmLabel: 'Propose', reason: { label: 'Reason', minLength: 15 } }, async (reason) => { await callBackend(`${FIN_API}/close/yearend/propose`, { leId: le.id, fy, reason }); done('Year-end close proposed for approval.'); })}>
                                Propose year-end close
                            </Button>
                        )}
                        {data.yearEndJournal && (
                            <button type='button' className='min-h-11 text-sm text-brand' onClick={() => go(`fin_journal/${data.yearEndJournal}`)}>
                                Year-end close: {data.yearEndJournal}
                            </button>
                        )}
                    </Card>
                    <Card title='Requests for this period'>
                        {!data.requests.length && <p className='text-sm text-muted'>None.</p>}
                        {data.requests.map((r) => (
                            <button key={r.id} type='button' onClick={() => go(`fin_approvals/${r.id}`)} className='block min-h-11 w-full py-1 text-left text-sm'>
                                <span className='flex items-center gap-2'>
                                    <span className='font-mono text-xs text-muted'>{r.id}</span>
                                    <span className='min-w-0 flex-1 truncate text-ink'>{r.title}</span>
                                    <Pill status={r.status} />
                                </span>
                                {r.status === 'pending' && r.next && <span className='mt-0.5 block text-xs text-amber-200'>Next to approve: {r.next}</span>}
                            </button>
                        ))}
                    </Card>
                    <Card title='History of this period'>
                        {!data.runs.length && <p className='text-sm text-muted'>No routines run yet.</p>}
                        {data.runs.map((r) => (
                            <p key={r.id} className='text-xs text-soft'>
                                {fmtDate(r.at)} · {r.kind === 'inventory' ? 'Inventory reconciliation' : 'Trial balance'} by {r.byName}: {r.kind === 'inventory' ? r.status : r.balanced ? 'balanced' : 'not balanced'}
                                {r.journalId ? ` · ${r.journalId}` : ''}
                            </p>
                        ))}
                    </Card>
                </>
            )}
            {tab === 'tb' && <Trial le={le} fy={fy} no={no} canSave={data.can.run} onSaved={() => done('Trial balance recorded.')} />}
            {tab === 'recon' && (
                <Card title='Inventory and GR/IR'>
                    {data.can.run && work && (
                        <Button onClick={() => callBackend(`${FIN_API}/close/recon/run`, { leId: le.id, fy, no }).then(() => done('Reconciliation run.')).catch((e) => setErr(errText(e)))}>
                            Run reconciliation now
                        </Button>
                    )}
                    {!lastRecon && <p className='text-sm text-muted'>Not run for this period.</p>}
                    {lastRecon && (
                        <div className='space-y-2'>
                            <p className='text-xs text-muted'>
                                {fmtDate(lastRecon.at)} by {lastRecon.byName} · <Pill status={lastRecon.status} />
                            </p>
                            <RichTable
                                id='fin.recon'
                                tabKey='recon'
                                columns={[
                                    { key: 'cc', label: 'Warehouse', value: (l: CloseStatus['runs'][number]['lines'][number]) => `${l.ccCode} ${l.ccName}` },
                                    { key: 'gl', label: 'Account', value: (l) => l.glCode },
                                    { key: 'led', label: 'Ledger', type: 'number', value: (l) => l.ledger, render: (l) => fmt(l.ledger) },
                                    { key: 'stk', label: 'Stock valuation', type: 'number', value: (l) => l.stock, render: (l) => fmt(l.stock) },
                                    { key: 'diff', label: 'Difference', type: 'number', value: (l) => l.diff, render: (l) => <span className={l.diff ? 'font-semibold text-red-300' : 'text-emerald-300'}>{fmt(l.diff)}</span> },
                                ]}
                                rows={lastRecon.lines}
                                rowKey={(l) => `${l.ccCode}|${l.glCode}`}
                                empty='No inventory in the ledger or in stock.'
                                fileName={`inventory-reconciliation-${le.code}-${fy}-P${no}`}
                                height='h-64'
                            />
                            {lastRecon.status === 'differences' && data.can.run && (
                                <Button onClick={() => confirm.ask({ title: 'Propose the adjustment', message: 'The ledger is brought to the stock valuation; the difference goes to the reconciliation differences account. It is checked again at approval and approved under the finance chart of authority.', confirmLabel: 'Propose', reason: { label: 'Explanation of the difference', minLength: 15 } }, async (reason) => { await callBackend(`${FIN_API}/close/recon/propose`, { leId: le.id, runId: lastRecon.id, reason }); done('Adjustment proposed for approval.'); })}>
                                    Propose adjustment
                                </Button>
                            )}
                            <p className='text-sm font-semibold text-ink'>GR/IR: received or accepted, not yet invoiced</p>
                            <RichTable
                                id='fin.grir'
                                tabKey='recon'
                                columns={[
                                    { key: 'po', label: 'Purchase order', value: (g: CloseStatus['runs'][number]['grir'][number]) => g.po },
                                    { key: 'amt', label: 'Open amount', type: 'number', value: (g) => g.amount, render: (g) => <span className='font-mono text-amber-300'>{fmt(g.amount)}</span> },
                                    { key: 'since', label: 'Since', type: 'date', value: (g) => g.since },
                                    { key: 'age', label: 'Age (days)', type: 'number', value: (g) => g.ageDays },
                                ]}
                                rows={lastRecon.grir}
                                rowKey={(g) => g.po}
                                onRowClick={(g) => go(`procurement_orders/${g.po}`)}
                                empty='Nothing open.'
                                fileName={`grir-${le.code}-${fy}-P${no}`}
                                height='h-64'
                            />
                            <p className='text-xs text-muted'>GR/IR items are cleared by supplier invoices in Accounts Payable (not built yet).</p>
                        </div>
                    )}
                </Card>
            )}
            {tab === 'realloc' && (data.can.run && work ? <Card title='Reallocate costs between cost centers'><Realloc le={le} fy={fy} no={no} onDone={done} /></Card> : <Alert tone='info'>Reallocation needs FIN.close.run and an open or closing period.</Alert>)}
            {confirm.sheet}
        </>
    );
}

export default function FinCalendar({ fy, no }: { fy?: string; no?: string }) {
    const ent = useEntity();
    const period = fy && no && /^\d{4}$/.test(fy) && /^\d{1,2}$/.test(no);
    const [tab, setTab] = useState<PeriodTab>(() => restoredTableTab<PeriodTab>(['checklist','tb','recon','realloc'], 'checklist'));
    return (
        <FinScreen
            title={period ? `Period ${no} of FY ${fy}` : 'Financial calendar'}
            subtitle={period ? 'Period-end work' : 'Years, periods and the active period'}
            onBack={() => (period ? go('fin_calendar') : go('module/FIN'))}
            entityState={ent}
            nav={period ? [{ value: 'checklist', label: 'Checklist', icon: ClipboardCheck }, { value: 'tb', label: 'Trial balance', icon: Table2 }, { value: 'recon', label: 'Reconciliation', icon: RefreshCw }, { value: 'realloc', label: 'Reallocation', icon: Coins }] : undefined}
            navValue={period ? tab : undefined}
            onNav={setTab}
        >
            {(le) => (period ? <PeriodView le={le} fy={Number(fy)} no={Number(no)} tab={tab} /> : <Years le={le} />)}
        </FinScreen>
    );
}
