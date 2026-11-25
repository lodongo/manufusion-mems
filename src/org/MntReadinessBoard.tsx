import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, Check, ChevronDown, CircleDashed, Clock, Link2, MinusCircle, Plus, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { workspaceNavigate as navigate } from '../lib/route';
import { Alert, Field, SelectField, TextArea } from '../components/ui';
import { Segmented, messageOf } from '../components/screen';
import { appPrompt } from '../components/dialogs';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, useLoad } from '../admin/kit';

// Work order readiness: every readiness area side by side (a waiting spare never hides progress elsewhere), each with
// its sub-steps, their ages against targets, linked documents and the planner's follow-up steps (updated in any order),
// then the opportunity (planning window). Also the prioritised readiness report and the planning windows.

const API = '/api/org/mnt/operations';
type StepState = 'done' | 'in_progress' | 'waiting' | 'blocked' | 'not_needed';
interface Step { key: string; label: string; state: StepState; system: boolean; since: string; doneAt: string; ageDays: number | null; targetDays: number | null; delayed: boolean; ref?: { type: string; id: string; number: string }; note?: string; expectedDate?: string; updatedBy?: string }
interface Item { id: string; label: string; detail?: string; steps: Step[]; state: StepState }
interface Dimension { key: string; label: string; state: StepState | 'delayed'; done: number; total: number; items: Item[]; current: string }
export interface ReadinessModel { phase: 'not_ready' | 'ready_awaiting_opportunity' | 'scheduled'; readinessPct: number; fullyReady: boolean; dimensions: Dimension[]; delays: Array<{ dimensionLabel: string; item: string; label: string; ageDays: number | null; targetDays: number | null; expectedDate: string }>; waitingOn: Array<{ key: string; label: string; current: string; state: string }> }
type Library = Record<string, Array<{ key: string; label: string }>>;
interface PlanningWindow { id: string; name: string; kindLabel: string; start: string; end: string; scopeName: string; status: string; note?: string; mapped?: Array<{ code: string; title: string; scheduledStart: string; scheduledEnd: string; status: string }> }

export const PHASE: Record<string, { label: string; tone: 'brand' | 'warn' | 'muted' }> = {
    not_ready: { label: 'Preparing', tone: 'warn' },
    ready_awaiting_opportunity: { label: 'Fully ready · awaiting opportunity', tone: 'brand' },
    scheduled: { label: 'Scheduled', tone: 'brand' },
};
const STATE_TEXT: Record<string, string> = { done: 'Done', in_progress: 'In progress', waiting: 'Waiting', blocked: 'Blocked', not_needed: 'Not needed', delayed: 'Delayed' };
const tone = (s: string) => (s === 'done' ? 'brand' : s === 'blocked' || s === 'delayed' ? 'danger' : s === 'in_progress' ? 'warn' : 'muted') as 'brand' | 'danger' | 'warn' | 'muted';
const days = (n: number | null) => (n === null ? '' : n < 1 ? '< 1 day' : `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`);

function StepIcon({ s }: { s: Step }) {
    if (s.state === 'done') return <Check aria-hidden className='h-4 w-4 text-brand' />;
    if (s.state === 'blocked') return <X aria-hidden className='h-4 w-4 text-red-500' />;
    if (s.state === 'not_needed') return <MinusCircle aria-hidden className='h-4 w-4 text-muted' />;
    if (s.delayed) return <AlertTriangle aria-hidden className='h-4 w-4 text-red-500' />;
    if (s.state === 'in_progress') return <Clock aria-hidden className='h-4 w-4 text-amber-600' />;
    return <CircleDashed aria-hidden className='h-4 w-4 text-muted' />;
}

function Ring({ pct }: { pct: number }) {
    const r = 26, c = 2 * Math.PI * r;
    return (
        <svg width='64' height='64' viewBox='0 0 64 64' role='img' aria-label={`${pct}% ready`} className='shrink-0'>
            <circle cx='32' cy='32' r={r} fill='none' strokeWidth='7' className='stroke-line' />
            <circle cx='32' cy='32' r={r} fill='none' strokeWidth='7' strokeLinecap='round' className='stroke-brand' strokeDasharray={`${(pct / 100) * c} ${c}`} transform='rotate(-90 32 32)' />
            <text x='32' y='37' textAnchor='middle' className='fill-ink text-[14px] font-semibold'>{pct}%</text>
        </svg>
    );
}

/** Update or add a follow-up (manual) step. */
function StepSheet({ code, dimension, step, library, onClose, onDone }: { code: string; dimension: Dimension; step: Step | null; library: Library; onClose: () => void; onDone: () => void }) {
    const existing = new Set(dimension.items.flatMap((i) => i.steps.filter((s) => !s.system).map((s) => s.key)));
    const options = (library[dimension.key] ?? []).filter((x) => !existing.has(x.key));
    const [key, setKey] = useState(step?.key ?? options[0]?.key ?? 'custom');
    const [label, setLabel] = useState('');
    const [state, setState] = useState<string>(step?.state ?? 'in_progress');
    const [note, setNote] = useState(step?.note ?? '');
    const [expected, setExpected] = useState(step?.expectedDate ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const needsNote = ['blocked', 'not_needed', 'remove'].includes(state);
    const problem = key === 'custom' && !step && (label.trim().length < 3 || label.trim().length > 80) ? 'Name the step (3 to 80 characters).' : needsNote && note.trim().length < 10 ? 'Say why (at least 10 characters).' : '';
    const save = async () => {
        setBusy(true); setError('');
        try {
            await callBackend(API, { action: 'readiness_step', code, dimension: dimension.key, step: key, label: label.trim(), state, note: note.trim(), expectedDate: expected });
            onDone();
        } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
    };
    return (
        <div role='dialog' aria-modal='true' aria-label='Follow-up step' className='fixed inset-0 z-50 flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={onClose}>
            <div className='max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto overscroll-contain rounded-t-2xl bg-page p-4 sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                <p className='text-sm font-semibold text-ink'>{dimension.label} · {step ? step.label : 'Add a follow-up step'}</p>
                {!step && (
                    <SelectField label='Step' value={key} onChange={(e) => setKey(e.target.value)}>
                        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        <option value='custom'>Another step (type it)</option>
                    </SelectField>
                )}
                {!step && key === 'custom' && <Field label='Step name' value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} error={label && problem && key === 'custom' ? problem : undefined} />}
                <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
                    {(['waiting', 'in_progress', 'done', 'blocked', 'not_needed', ...(step ? ['remove'] : [])] as string[]).map((s) => (
                        <button key={s} type='button' aria-pressed={state === s} onClick={() => setState(s)} className={`min-h-11 rounded-xl border px-2 text-sm ${state === s ? 'border-brand bg-brand/15 font-semibold text-ink' : 'border-line text-soft'}`}>{s === 'remove' ? 'Remove' : STATE_TEXT[s]}</button>
                    ))}
                </div>
                <Field label='Expected by' type='date' value={expected} onChange={(e) => setExpected(e.target.value)} hint='Flagged as delayed when this date passes and the step is not done.' />
                <TextArea label={needsNote ? 'Why (required)' : 'Note'} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} error={needsNote && note && note.trim().length < 10 ? 'At least 10 characters.' : undefined} />
                {error && <Alert tone='error'>{error}</Alert>}
                <div className='grid grid-cols-2 gap-2'>
                    <Button variant='secondary' onClick={onClose}>Cancel</Button>
                    <Button disabled={busy || !!problem} busy={busy} onClick={save}>Save</Button>
                </div>
            </div>
        </div>
    );
}

/** Map the work order to a planning window: scheduled dates move inside the window. */
function WindowSheet({ code, current, onClose, onDone }: { code: string; current: string; onClose: () => void; onDone: (t: string) => void }) {
    const { data, loading } = useLoad(() => callBackend<{ windows: PlanningWindow[] }>(API, { action: 'planning_windows' }), []);
    const open = (data?.windows ?? []).filter((w) => w.status === 'open');
    const [id, setId] = useState(current);
    const [start, setStart] = useState('');
    const [reason, setReason] = useState('');
    const [shorter, setShorter] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const w = open.find((x) => x.id === id);
    const run = async (action: 'planning_window_map' | 'planning_window_unmap') => {
        setBusy(true); setError('');
        try {
            const r = await callBackend<{ start?: string; end?: string; costSuperseded?: boolean }>(API, { action, code, windowId: id, start, reason: reason.trim(), acceptShorter: shorter });
            onDone(action === 'planning_window_unmap' ? 'Removed from the planning window.' : `Scheduled ${r.start} to ${r.end}.${r.costSuperseded ? ' The budget period changed, so the cost must be approved again.' : ''}`);
        } catch (e) {
            const m = messageOf(e);
            if (/Confirm to use the whole window/.test(m)) setShorter(true);
            setError(m);
        } finally { setBusy(false); }
    };
    return (
        <div role='dialog' aria-modal='true' aria-label='Planning window' className='fixed inset-0 z-50 flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={onClose}>
            <div className='max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto overscroll-contain rounded-t-2xl bg-page p-4 sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                <p className='text-sm font-semibold text-ink'>Planning window</p>
                <p className='text-xs text-muted'>Mapping sets the scheduled start and end inside the window, keeping the work's duration where it fits. If the start moves to another budget month, the cost approval must be repeated.</p>
                {loading && !data ? <Spinner /> : open.length ? (
                    <SelectField label='Window' value={id} onChange={(e) => setId(e.target.value)}>
                        <option value=''>Choose a window</option>
                        {open.map((x) => <option key={x.id} value={x.id}>{`${x.name} · ${x.start} to ${x.end} · ${x.scopeName}`}</option>)}
                    </SelectField>
                ) : <Alert tone='info'>No open planning window covers your sites yet. Create one under Work orders › Planning windows.</Alert>}
                {w && <Field label='Start on (optional)' type='date' value={start} min={w.start} max={w.end} onChange={(e) => setStart(e.target.value)} hint={`Leave empty to start on ${w.start}.`} />}
                <TextArea label='Reason (required)' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={reason && reason.trim().length < 10 ? 'At least 10 characters.' : undefined} />
                {shorter && <label className='flex min-h-11 items-center gap-2 text-sm text-ink'><input type='checkbox' checked={shorter} onChange={(e) => setShorter(e.target.checked)} className='h-5 w-5' /> Use the whole window although the work is longer</label>}
                {error && <Alert tone='error'>{error}</Alert>}
                <div className='grid grid-cols-2 gap-2'>
                    {current ? <Button variant='secondary' disabled={busy || reason.trim().length < 10} onClick={() => run('planning_window_unmap')}>Remove mapping</Button> : <Button variant='secondary' onClick={onClose}>Cancel</Button>}
                    <Button disabled={busy || !id || reason.trim().length < 10} busy={busy} onClick={() => run('planning_window_map')}><CalendarRange className='h-4 w-4' /> Map and reschedule</Button>
                </div>
            </div>
        </div>
    );
}

/** One work order: readiness areas, sub-steps, follow-ups, opportunity. */
export function ReadinessOverview({ code, model, library, canPlan, windowId, onChanged }: { code: string; model: ReadinessModel; library: Library; canPlan: boolean; windowId?: string; onChanged: () => void }) {
    const [open, setOpen] = useState<string>(() => model.waitingOn[0]?.key ?? '');
    const [sheet, setSheet] = useState<{ dimension: Dimension; step: Step | null } | null>(null);
    const [windowSheet, setWindowSheet] = useState(false);
    const [notice, setNotice] = useState('');
    const phase = PHASE[model.phase];
    const refHref = (r: Step['ref']) => (r?.type === 'purchase_order' ? 'organization_admin/procurement/orders' : r?.type === 'requirement' ? 'organization_admin/procurement/requirements' : '');
    return (
        <section aria-label='Readiness' className='space-y-3'>
            <Card className='space-y-3'>
                <div className='flex items-center gap-3'>
                    <Ring pct={model.readinessPct} />
                    <div className='min-w-0 flex-1'>
                        <p className='text-xs text-muted'>Readiness</p>
                        <p className='text-base font-semibold text-ink'>{phase.label}</p>
                        <p className='text-xs text-soft'>{model.fullyReady ? 'Every area is ready.' : `Waiting on ${model.waitingOn.map((w) => w.label.toLowerCase()).join(', ')}`}{model.delays.length ? ` · ${model.delays.length} delayed step${model.delays.length === 1 ? '' : 's'}` : ''}</p>
                    </div>
                </div>
                <div className='flex flex-wrap gap-1.5'>
                    {model.dimensions.filter((d) => d.key !== 'opportunity').map((d) => (
                        <button key={d.key} type='button' onClick={() => setOpen(open === d.key ? '' : d.key)} className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs ${d.state === 'done' ? 'border-brand/40 bg-brand/10 text-ink' : d.state === 'blocked' || d.state === 'delayed' ? 'border-red-500/50 bg-red-500/10 text-ink' : 'border-line text-soft'}`}>
                            {d.state === 'done' ? <Check aria-hidden className='h-3.5 w-3.5 text-brand' /> : null}{d.label} {d.done}/{d.total}
                        </button>
                    ))}
                </div>
                {model.fullyReady && model.phase === 'ready_awaiting_opportunity' && canPlan && (
                    <Alert tone='success'>Fully ready. Map it to a planning window, or confirm readiness and schedule it in a maintenance window.</Alert>
                )}
                {notice && <Alert tone='success'>{notice}</Alert>}
            </Card>
            {model.dimensions.map((d) => {
                const expanded = open === d.key;
                return (
                    <Card key={d.key} className='space-y-2'>
                        <button type='button' aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : d.key)} className='flex min-h-11 w-full items-center gap-2 text-left'>
                            <span className='min-w-0 flex-1'>
                                <span className='block text-sm font-semibold text-ink'>{d.label}</span>
                                <span className='block truncate text-xs text-soft'>{d.state === 'done' ? 'Ready' : d.current || STATE_TEXT[d.state]}</span>
                            </span>
                            <Badge tone={tone(d.state)}>{STATE_TEXT[d.state]}</Badge>
                            <ChevronDown aria-hidden className={`h-4 w-4 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        <div className='h-1.5 overflow-hidden rounded-full bg-line'><div className={`h-full ${d.state === 'blocked' || d.state === 'delayed' ? 'bg-red-500' : 'bg-brand'}`} style={{ width: `${d.total ? (d.done / d.total) * 100 : 100}%` }} /></div>
                        {expanded && (
                            <div className='space-y-3 pt-1'>
                                {d.items.map((i) => (
                                    <div key={i.id} className='rounded-xl bg-page p-3'>
                                        <p className='text-sm font-medium text-ink'>{i.label}</p>
                                        {i.detail && <p className='text-xs text-muted'>{i.detail}</p>}
                                        <ol className='mt-2 space-y-1.5'>
                                            {i.steps.map((s) => (
                                                <li key={s.key}>
                                                    <button type='button' disabled={s.system || !canPlan} onClick={() => setSheet({ dimension: d, step: s })} className='flex min-h-11 w-full items-start gap-2 rounded-lg px-1 text-left enabled:active:bg-line/40'>
                                                        <span className='mt-0.5'><StepIcon s={s} /></span>
                                                        <span className='min-w-0 flex-1'>
                                                            <span className={`block text-sm ${s.state === 'done' ? 'text-soft' : 'text-ink'}`}>{s.label}{!s.system && <span className='ml-1 text-xs text-muted'>· follow-up</span>}</span>
                                                            <span className='block text-xs text-muted'>
                                                                {s.state === 'done' ? `Done${s.doneAt ? ' ' + new Date(s.doneAt).toLocaleDateString() : ''}` : STATE_TEXT[s.state]}
                                                                {s.state !== 'done' && s.ageDays !== null ? ` · ${days(s.ageDays)}` : ''}
                                                                {s.state !== 'done' && s.targetDays !== null ? ` (target ${s.targetDays} d)` : ''}
                                                                {s.expectedDate ? ` · expected ${s.expectedDate}` : ''}
                                                                {s.note ? ` · ${s.note}` : ''}
                                                            </span>
                                                        </span>
                                                        {s.ref && <a href={'#' + refHref(s.ref)} onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (refHref(s.ref)) navigate(refHref(s.ref)); }} className='flex shrink-0 items-center gap-1 font-mono text-xs text-brand'><Link2 aria-hidden className='h-3 w-3' />{s.ref.number}</a>}
                                                    </button>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                ))}
                                <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                                    {canPlan && <Button variant='secondary' onClick={() => setSheet({ dimension: d, step: null })}><Plus className='h-4 w-4' /> Add follow-up step</Button>}
                                    {canPlan && d.key === 'opportunity' && <Button onClick={() => setWindowSheet(true)}><CalendarRange className='h-4 w-4' /> {windowId ? 'Change planning window' : 'Map to a planning window'}</Button>}
                                </div>
                            </div>
                        )}
                    </Card>
                );
            })}
            {sheet && <StepSheet code={code} dimension={sheet.dimension} step={sheet.step} library={library} onClose={() => setSheet(null)} onDone={() => { setSheet(null); onChanged(); }} />}
            {windowSheet && <WindowSheet code={code} current={windowId ?? ''} onClose={() => setWindowSheet(false)} onDone={(t) => { setWindowSheet(false); setNotice(t); onChanged(); }} />}
        </section>
    );
}

interface ReportRow {
    code: string; title: string; status: string; workflowLabel: string; workflowReason: string; priorityLabel: string; severityLabel: string; sequence: number;
    scheduledStart: string; scheduledEnd: string; unitName: string; siteName: string; maintenanceType: string; planningWindowId: string; readinessAchievedAt: string;
    phase: string; readinessPct: number; fullyReady: boolean; delays: number; dimensions: Array<{ key: string; state: string; done: number; total: number; current: string }>;
    steps: Array<{ d: string; k: string; l: string; s: string; a: number | null; t: number | null; x: boolean; i: string }>;
}
interface Bottleneck { dimension: string; dimensionLabel: string; step: string; label: string; open: number; delayed: number; averageAgeDays: number | null; maxAgeDays: number | null; workOrders: string[] }
interface Report { workOrders: ReportRow[]; bottlenecks: Bottleneck[]; summary: { total: number; fullyReady: number; awaitingOpportunity: number; scheduled: number; withDelays: number; averagePct: number }; dimensions: Array<{ key: string; label: string }> }

/** Readiness report: open work orders in priority sequence, drill down to areas and sub-steps, bottlenecks. */
export function ReadinessReport() {
    const { data, loading, error } = useLoad(() => callBackend<Report>(API, { action: 'readiness_report' }), []);
    const [filter, setFilter] = useState<'all' | 'not_ready' | 'ready_awaiting_opportunity' | 'scheduled' | 'delayed'>('all');
    const [focus, setFocus] = useState<Bottleneck | null>(null);
    const [openRow, setOpenRow] = useState<ReportRow | null>(null);
    const dimLabel = useMemo(() => new Map((data?.dimensions ?? []).map((d) => [d.key, d.label])), [data]);
    const rows = useMemo(() => (data?.workOrders ?? []).filter((r) => (filter === 'all' || (filter === 'delayed' ? r.delays > 0 : r.phase === filter)) && (!focus || focus.workOrders.includes(r.code))), [data, filter, focus]);
    const columns = useMemo<Column<ReportRow>[]>(() => [
        { key: 'seq', label: '#', type: 'number', value: (r) => r.sequence },
        { key: 'code', label: 'Work order', value: (r) => r.code + ' ' + r.title, render: (r) => <span className='block min-w-[11rem] whitespace-normal'><span className='block font-mono text-xs font-semibold text-ink'>{r.code}</span><span className='block text-xs text-soft line-clamp-2'>{r.title}</span></span> },
        { key: 'priority', label: 'Priority', value: (r) => r.priorityLabel },
        { key: 'pct', label: 'Ready %', type: 'number', value: (r) => r.readinessPct, render: (r) => <span className='flex items-center gap-2'><span className='h-1.5 w-12 overflow-hidden rounded-full bg-line'><span className='block h-full bg-brand' style={{ width: `${r.readinessPct}%` }} /></span>{r.readinessPct}%</span> },
        { key: 'phase', label: 'Phase', value: (r) => PHASE[r.phase]?.label ?? r.phase, render: (r) => <Badge tone={PHASE[r.phase]?.tone ?? 'muted'}>{PHASE[r.phase]?.label ?? r.phase}</Badge> },
        { key: 'waiting', label: 'Waiting on', value: (r) => r.dimensions.filter((d) => d.key !== 'opportunity' && d.state !== 'done').map((d) => `${dimLabel.get(d.key) ?? d.key}: ${d.current}`).join('; ') },
        { key: 'delays', label: 'Delayed steps', type: 'number', value: (r) => r.delays, render: (r) => (r.delays ? <span className='font-semibold text-red-500'>{r.delays}</span> : '0') },
        { key: 'start', label: 'Scheduled start', type: 'date', value: (r) => r.scheduledStart },
        { key: 'end', label: 'Scheduled end', type: 'date', value: (r) => r.scheduledEnd, hidden: true },
        { key: 'state', label: 'Workflow state', value: (r) => r.workflowLabel, hidden: true },
        { key: 'unit', label: 'Equipment', value: (r) => r.unitName, hidden: true },
        { key: 'site', label: 'Site', value: (r) => r.siteName, hidden: true },
        { key: 'window', label: 'Planning window', value: (r) => r.planningWindowId, hidden: true },
        { key: 'readyAt', label: 'Fully ready since', type: 'date', value: (r) => r.readinessAchievedAt.slice(0, 10), hidden: true },
    ], [dimLabel]);
    if (loading && !data) return <Spinner />;
    if (!data) return <Alert tone='error'>{error || 'The readiness report could not be loaded.'}</Alert>;
    const s = data.summary;
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6'>
                {[['Open work orders', s.total], ['Average readiness', s.averagePct + '%'], ['Fully ready', s.fullyReady], ['Awaiting opportunity', s.awaitingOpportunity], ['Scheduled', s.scheduled], ['With delays', s.withDelays]].map(([k, v]) => (
                    <div key={String(k)} className='rounded-xl border border-line bg-panel p-3'><p className='text-xs text-muted'>{k}</p><p className='text-lg font-semibold tabular-nums text-ink'>{v}</p></div>
                ))}
            </div>
            {data.bottlenecks.length > 0 && (
                <Card className='space-y-2'>
                    <p className='text-sm font-semibold text-ink'>Where work orders wait</p>
                    <p className='text-xs text-muted'>Open steps across all work orders, most delayed first. Tap one to list its work orders.</p>
                    <ul className='max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                        {data.bottlenecks.slice(0, 15).map((b) => {
                            const max = Math.max(...data.bottlenecks.map((x) => x.open));
                            const on = focus?.dimension === b.dimension && focus.step === b.step;
                            return (
                                <li key={b.dimension + b.step}>
                                    <button type='button' aria-pressed={on} onClick={() => setFocus(on ? null : b)} className={`w-full rounded-lg p-2 text-left ${on ? 'bg-brand/10' : 'active:bg-page'}`}>
                                        <div className='flex items-baseline justify-between gap-2 text-sm'>
                                            <span className='min-w-0 truncate text-ink'>{b.dimensionLabel} · {b.label}</span>
                                            <span className='shrink-0 text-xs text-soft'>{b.open} open{b.delayed ? ` · ${b.delayed} late` : ''}{b.averageAgeDays !== null ? ` · avg ${b.averageAgeDays} d` : ''}</span>
                                        </div>
                                        <div className='mt-1 flex h-1.5 overflow-hidden rounded-full bg-line'>
                                            <span className='bg-red-500' style={{ width: `${(b.delayed / max) * 100}%` }} />
                                            <span className='bg-amber-500' style={{ width: `${((b.open - b.delayed) / max) * 100}%` }} />
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </Card>
            )}
            <Segmented label='Readiness filter' value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All', count: data.workOrders.length },
                { value: 'not_ready', label: 'Preparing', count: data.workOrders.filter((r) => r.phase === 'not_ready').length },
                { value: 'ready_awaiting_opportunity', label: 'Awaiting opportunity', count: s.awaitingOpportunity },
                { value: 'scheduled', label: 'Scheduled', count: s.scheduled },
                { value: 'delayed', label: 'Delayed', count: s.withDelays },
            ]} />
            {focus && <Alert tone='info'>Showing work orders waiting at “{focus.dimensionLabel} · {focus.label}”. <button type='button' className='font-semibold underline' onClick={() => setFocus(null)}>Show all</button></Alert>}
            <RichTable id='mnt.readiness.report' title='Readiness in priority sequence' fileName='Work_order_readiness' columns={columns} rows={rows} rowKey={(r) => r.code} onRowClick={setOpenRow} height='h-[calc(100dvh-26rem)]' empty='No open work orders here.' />
            {openRow && (
                <div role='dialog' aria-modal='true' aria-label={`Readiness of ${openRow.code}`} className='fixed inset-0 z-50 flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={() => setOpenRow(null)}>
                    <div className='max-h-[90dvh] w-full max-w-xl space-y-3 overflow-y-auto overscroll-contain rounded-t-2xl bg-page p-4 sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                        <div className='flex items-start justify-between gap-2'>
                            <div className='min-w-0'>
                                <p className='font-mono text-xs text-muted'>#{openRow.sequence} · {openRow.code} · {openRow.priorityLabel}</p>
                                <p className='text-sm font-semibold text-ink'>{openRow.title}</p>
                                <p className='text-xs text-soft'>{openRow.workflowLabel}{openRow.workflowReason ? ' · ' + openRow.workflowReason : ''}</p>
                            </div>
                            <Badge tone={PHASE[openRow.phase]?.tone ?? 'muted'}>{openRow.readinessPct}%</Badge>
                        </div>
                        {openRow.dimensions.map((d) => (
                            <div key={d.key} className='rounded-xl bg-panel p-3'>
                                <div className='flex items-center justify-between gap-2'>
                                    <p className='text-sm font-medium text-ink'>{dimLabel.get(d.key) ?? d.key}</p>
                                    <Badge tone={tone(d.state)}>{STATE_TEXT[d.state] ?? d.state} · {d.done}/{d.total}</Badge>
                                </div>
                                <ul className='mt-1 space-y-0.5'>
                                    {openRow.steps.filter((x) => x.d === d.key && x.s !== 'done').map((x, i) => (
                                        <li key={i} className={`text-xs ${x.x ? 'text-red-500' : 'text-soft'}`}>{x.l} · {x.i}{x.a !== null ? ` · ${days(x.a)}` : ''}{x.t !== null ? ` (target ${x.t} d)` : ''}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                        <div className='grid grid-cols-2 gap-2'>
                            <Button variant='secondary' onClick={() => setOpenRow(null)}>Close</Button>
                            <Button onClick={() => navigate(`organization_admin/work_orders/${openRow.code}`)}>Open work order</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Planning windows: periods for an opportunity (shutdown, production stop …) that work orders can be mapped to. */
export function PlanningWindows() {
    const { data, loading, error, reload } = useLoad(() => callBackend<{ windows: PlanningWindow[]; kinds: Record<string, string> }>(API, { action: 'planning_windows' }), []);
    const places = useLoad(() => callBackend<{ nodes: Array<{ id: string; name: string; code: string; level: string }> }>(API, { action: 'line_options' }), []);
    const [form, setForm] = useState({ name: '', kind: 'shutdown', start: '', end: '', scopeNodeId: '', note: '' });
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
    const problem = form.name.trim().length < 3 ? 'Name the window.' : !form.start || !form.end ? 'Enter the dates.' : form.end < form.start ? 'The end is before the start.' : !form.scopeNodeId ? 'Choose where it applies.' : '';
    const create = async () => {
        setBusy(true); setMsg(null);
        try { await callBackend(API, { action: 'planning_window_save', ...form }); setShow(false); setForm({ name: '', kind: 'shutdown', start: '', end: '', scopeNodeId: '', note: '' }); setMsg({ tone: 'success', text: 'Planning window created.' }); reload(); }
        catch (e) { setMsg({ tone: 'error', text: messageOf(e) }); } finally { setBusy(false); }
    };
    const close = async (w: PlanningWindow) => {
        const reason = (await appPrompt(`Why close ${w.name}? (at least 10 characters)`)) ?? '';
        if (!reason) return;
        if (reason.trim().length < 10) { setMsg({ tone: 'error', text: 'Give a reason of at least 10 characters.' }); return; }
        try { await callBackend(API, { action: 'planning_window_close', id: w.id, reason }); reload(); } catch (e) { setMsg({ tone: 'error', text: messageOf(e) }); }
    };
    if (loading && !data) return <Spinner />;
    return (
        <div className='space-y-3'>
            {error && <Alert tone='error'>{error}</Alert>}
            {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
            <Button onClick={() => setShow((x) => !x)}><Plus className='h-4 w-4' /> New planning window</Button>
            {show && (
                <Card className='space-y-3'>
                    <Field label='Name' value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    <SelectField label='Kind' value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                        {Object.entries(data?.kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </SelectField>
                    <div className='grid grid-cols-2 gap-2'>
                        <Field label='From' type='date' value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                        <Field label='To' type='date' value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} error={form.end && form.start && form.end < form.start ? 'Before the start.' : undefined} />
                    </div>
                    <SelectField label='Applies to' value={form.scopeNodeId} onChange={(e) => setForm({ ...form, scopeNodeId: e.target.value })} hint='Work orders on this equipment or line (or below it) can be mapped.'>
                        <option value=''>Choose</option>
                        {(places.data?.nodes ?? []).map((n) => <option key={n.id} value={n.id}>{`${n.name}${n.code ? ' · ' + n.code : ''}`}</option>)}
                    </SelectField>
                    <TextArea label='Note' value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    <Button disabled={busy || !!problem} busy={busy} onClick={create}>Create window</Button>
                    {problem && <p className='text-xs text-muted'>{problem}</p>}
                </Card>
            )}
            {(data?.windows ?? []).map((w) => (
                <Card key={w.id} className='space-y-2'>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-ink'>{w.name}</p>
                            <p className='text-xs text-soft'>{w.kindLabel} · {w.start} to {w.end} · {w.scopeName}</p>
                        </div>
                        <Badge tone={w.status === 'open' ? 'brand' : 'muted'}>{w.status === 'open' ? 'Open' : 'Closed'}</Badge>
                    </div>
                    {w.note && <p className='text-xs text-muted'>{w.note}</p>}
                    <ul className='space-y-1'>
                        {(w.mapped ?? []).map((m) => (
                            <li key={m.code}><button type='button' onClick={() => navigate(`organization_admin/work_orders/${m.code}`)} className='flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-page px-3 text-left text-xs'><span className='min-w-0 truncate'><span className='font-mono font-semibold text-ink'>{m.code}</span> · {m.title}</span><span className='shrink-0 text-soft'>{m.scheduledStart} to {m.scheduledEnd}</span></button></li>
                        ))}
                        {!w.mapped?.length && <li className='text-xs text-muted'>No work orders mapped yet.</li>}
                    </ul>
                    {w.status === 'open' && <Button variant='secondary' onClick={() => close(w)}>Close window</Button>}
                </Card>
            ))}
            {!data?.windows.length && <p className='text-sm text-muted'>No planning windows yet.</p>}
        </div>
    );
}
