// ---------------------------------------------------------------------------
// Material criticality analysis (INV).
//
//   MaterialCriticality   Material detail > Criticality Analysis: rate the consequence and supply-risk factors declared
//                         in setup (1 insignificant, 2 moderately significant, 3 very significant), see the movement
//                         worked out from twelve months of issues (or choose it when there is too little history), see
//                         the material on the 4 × 4 grid, save, submit, and approve or return (a different person).
//   InventorySetup        Inventory > Setup: the criticality setup (declared factors and weights, high-consequence
//                         rule, movement thresholds, cutoff cell, whether the procurement strategy follows the analysis)
//                         and the criticality grid of all assessed materials.
// The server repeats every rule and records every step in the audit trail.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Grid3X3, Save, Send, Undo2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { Badge, Button, Card, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { ForecastSetupForm } from './Forecasting';

const API = '/api/org/inventory/criticality/';

interface Factor {
    code: string;
    group: string;
    name: string;
    question: string;
    levels: [string, string, string];
    hse?: boolean;
}
interface Setup {
    factors: Record<string, { enabled: boolean; weight: 1 | 2 | 3 }>;
    hseOverride: boolean;
    strategyMode: 'manual' | 'criticality';
    cutoff: string;
    minHistoryMonths: number;
    thresholds: { m4: number; m3: number; m2: number };
    reviewMonths: number;
}
interface Movement {
    enough: boolean;
    coveredMonths: number;
    monthsWithIssues: number;
    monthsWithIssuesPerYear: number;
    annualQuantity: number;
    concentrationPct: number;
    level: number | null;
}
interface Assessment {
    status: 'draft' | 'submitted' | 'approved' | 'returned';
    ratings: Record<string, number>;
    movementManual: number | null;
    movementReason: string;
    notes: string;
    cell: string;
    returnReason?: string;
    submittedAt?: string;
    approvedAt?: string;
    strategyChange?: string;
    approved?: { cell: string; approvedAt: string } | null;
    score?: number;
    max?: number;
    scaled?: number;
    overrideBy?: string[];
}
interface MaterialData {
    setup: Setup;
    factors: Factor[];
    movementLabels: string[];
    onDemandStrategy: string;
    movementData: { months: Array<{ month: string; quantity: number }>; historyMonths: number };
    movement: Movement;
    assessment: Assessment | null;
    current: { criticalityClass: string; movementClass: number | null; cell: string; reviewDue: string; strategy: string; strategySource: string };
    leadTimeDays: number | null;
    can: { assess: boolean; approve: boolean };
    you: { assessed: boolean; testMode: boolean };
}

const CLASSES = ['A', 'B', 'C', 'D'] as const;
const CLASS_LABEL: Record<string, string> = { A: 'Very critical', B: 'Critical', C: 'Moderately critical', D: 'Non-critical' };
const RATING_LABEL = ['', 'Insignificant', 'Moderately significant', 'Very significant'];
const rank = (c: string) => ({ A: 4, B: 3, C: 2, D: 1 } as Record<string, number>)[c] ?? 0;
const onDemand = (cell: string, cutoff: string) => /^[ABCD][1-4]$/.test(cell) && /^[ABCD][1-4]$/.test(cutoff) && rank(cell[0]) <= rank(cutoff[0]) && Number(cell[1]) <= Number(cutoff[1]);

/** The same score the server computes: weighted ratings scaled from 1 to 4, high-consequence override to A. */
function score(setup: Setup, factors: Factor[], ratings: Record<string, number>) {
    const used = factors.filter((f) => setup.factors[f.code]?.enabled);
    let s = 0;
    let min = 0;
    let max = 0;
    for (const f of used) {
        const w = setup.factors[f.code].weight;
        min += w;
        max += 3 * w;
        s += w * (ratings[f.code] || 1);
    }
    const scaled = max > min ? 1 + (3 * (s - min)) / (max - min) : 1;
    const level = Math.min(4, Math.max(1, Math.round(scaled)));
    const overrideBy = setup.hseOverride ? used.filter((f) => f.hse && ratings[f.code] === 3).map((f) => f.name) : [];
    const cls = overrideBy.length ? 'A' : (['D', 'C', 'B', 'A'][level - 1] as string);
    const missing = used.filter((f) => ![1, 2, 3].includes(ratings[f.code])).length;
    return { used, score: s, min, max, scaled: Math.round(scaled * 100) / 100, cls, overrideBy, missing };
}

// ---------------------------------------------------------------------------
// The 4 × 4 grid: class A (top) to D, movement 1 (left, very slow) to 4 (very fast).
// ---------------------------------------------------------------------------

export function CriticalityGrid({ cutoff, marks = {}, counts, onPick, compact = false }: { cutoff: string; marks?: Record<string, 'current' | 'pending'>; counts?: Record<string, number>; onPick?: (cell: string) => void; compact?: boolean }) {
    return (
        <div className='space-y-1' role='grid' aria-label='Criticality grid'>
            {CLASSES.map((c) => (
                <div key={c} className='grid grid-cols-[1.75rem_repeat(4,minmax(0,1fr))] gap-1' role='row'>
                    <span className='flex items-center justify-center text-xs font-semibold text-muted'>{c}</span>
                    {[1, 2, 3, 4].map((m) => {
                        const cell = `${c}${m}`;
                        const od = onDemand(cell, cutoff);
                        const mark = marks[cell];
                        const n = counts?.[cell];
                        const Tag = onPick ? 'button' : 'div';
                        return (
                            <Tag
                                key={cell}
                                {...(onPick ? { type: 'button' as const, onClick: () => onPick(cell), 'aria-pressed': cell === cutoff } : {})}
                                role='gridcell'
                                aria-label={`${cell}${od ? ', bought on demand' : ''}${n !== undefined ? `, ${n} materials` : ''}`}
                                className={`flex ${compact ? 'h-10' : 'h-12'} flex-col items-center justify-center rounded-lg border text-xs ${od ? 'border-line bg-amber-500/10 text-amber-200' : 'border-line bg-panel text-soft'} ${
                                    mark === 'current' ? 'ring-2 ring-brand' : mark === 'pending' ? 'ring-2 ring-dashed ring-amber-400' : ''
                                } ${cell === cutoff ? 'font-bold outline outline-1 outline-amber-400' : ''}`}
                            >
                                <span className='font-mono'>{cell}</span>
                                {n !== undefined && <span className='text-[11px] font-semibold text-ink'>{n}</span>}
                            </Tag>
                        );
                    })}
                </div>
            ))}
            <div className='grid grid-cols-[1.75rem_repeat(4,minmax(0,1fr))] gap-1 text-center text-[11px] text-muted'>
                <span />
                <span>1 very slow</span>
                <span>2 slow</span>
                <span>3 fast</span>
                <span>4 very fast</span>
            </div>
            <p className='text-[11px] text-muted'>Shaded cells are at or below the cutoff {cutoff} (lower class and slower movement): bought on demand when the strategy follows the analysis.</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Material detail > Criticality Analysis
// ---------------------------------------------------------------------------

export function MaterialCriticality({ materialId, warehouseId, onChanged }: { materialId: string; warehouseId: string; onChanged?: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<MaterialData>(API + 'get', { materialId, warehouseId }), [materialId, warehouseId]);
    const confirm = useConfirm();
    const [ratings, setRatings] = useState<Record<string, number>>({});
    const [manual, setManual] = useState<number | null>(null);
    const [manualReason, setManualReason] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [fail, setFail] = useState('');
    const [tried, setTried] = useState(false);

    useEffect(() => {
        const a = data?.assessment;
        setRatings(a?.ratings ?? {});
        setManual(a?.movementManual ?? null);
        setManualReason(a?.movementReason ?? '');
        setNotes(a?.notes ?? '');
        setTried(false);
    }, [data]);

    if (!data && loading) return <Spinner />;
    if (!data) return <Alert tone='error'>{error || 'Criticality analysis could not be loaded.'}</Alert>;

    const { setup, factors, movement, assessment: a, current } = data;
    const s = score(setup, factors, ratings);
    const movementLevel = manual ?? movement.level;
    const overriding = manual !== null && movement.level !== null && manual !== movement.level;
    const cell = movementLevel ? `${s.cls}${movementLevel}` : '';
    const locked = a?.status === 'submitted';
    const editable = data.can.assess && !locked;
    const problems = [
        ...(s.missing ? [`Rate every declared factor (${s.missing} left).`] : []),
        ...(!movementLevel ? [`Choose the movement: there are less than ${setup.minHistoryMonths} months of issue history.`] : []),
        ...((movement.level === null || overriding) && manualReason.trim().length < 10 ? [`Give a reason of at least 10 characters for the movement ${overriding ? 'override' : 'chosen by hand'}.`] : []),
    ];
    const groups = [...new Set(s.used.map((f) => f.group))];
    const marks: Record<string, 'current' | 'pending'> = {};
    if (current.cell) marks[current.cell] = 'current';
    if (cell && cell !== current.cell) marks[cell] = 'pending';

    const save = async (submit: boolean) => {
        setTried(true);
        if (submit && problems.length) return;
        const go = async () => {
            setBusy(true);
            setFail('');
            try {
                await callBackend(API + 'save', { materialId, warehouseId, ratings, movementManual: manual, movementReason: manualReason, notes, submit });
                setNotice(submit ? `Submitted for approval: cell ${cell}.` : 'Draft saved.');
                reload();
            } catch (err) {
                setFail(messageOf(err));
            } finally {
                setBusy(false);
            }
        };
        if (!submit) return void go();
        confirm.ask(
            {
                title: `Submit cell ${cell}?`,
                message: `Class ${s.cls} (${CLASS_LABEL[s.cls]}${s.overrideBy.length ? `, forced by ${s.overrideBy.join(', ')}` : ''}), movement ${movementLevel} (${data.movementLabels[movementLevel ?? 0]}). ${
                    setup.strategyMode === 'criticality' ? (onDemand(cell, setup.cutoff) ? `At or below the cutoff ${setup.cutoff}: once approved the strategy becomes ${data.onDemandStrategy} (bought on demand).` : `Above the cutoff ${setup.cutoff}: the planner chooses the strategy.`) : 'The procurement strategy stays manual.'
                } Someone else must approve it.`,
                confirmLabel: 'Submit for approval',
                acknowledge: 'The ratings reflect the material’s real consequence of failure and supply risk.',
            },
            async () => go()
        );
    };

    const act = (action: 'approve' | 'return') =>
        confirm.ask(
            action === 'approve'
                ? {
                      title: `Approve cell ${a?.cell}?`,
                      message: `The material becomes class ${a?.cell?.[0]}, movement ${a?.cell?.[1]}.${setup.strategyMode === 'criticality' && a?.cell && onDemand(a.cell, setup.cutoff) ? ` Its procurement strategy is set to ${data.onDemandStrategy} (bought on demand, never replenished automatically) and locked.` : ''}`,
                      confirmLabel: 'Approve',
                  }
                : { title: 'Return the assessment?', message: 'The assessor can change it and submit it again.', confirmLabel: 'Return', reason: { label: 'Reason for returning', minLength: 10 } },
            async (reason) => {
                const r = await callBackend<{ strategyChange?: string }>(API + 'action', { materialId, warehouseId, action, reason });
                setNotice(action === 'approve' ? `Approved.${r.strategyChange ? ` Strategy ${r.strategyChange}.` : ''}` : 'Returned to the assessor.');
                reload();
                onChanged?.();
            }
        );

    const months = data.movementData.months;
    const peak = Math.max(1, ...months.map((m) => m.quantity));

    return (
        <div className='space-y-3'>
            {confirm.sheet}
            <div className='sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 bg-page px-1 pb-2'>
                {editable && (
                    <>
                        <Button busy={busy} variant='secondary' onClick={() => void save(false)}>
                            <Save className='h-4 w-4' /> Save draft
                        </Button>
                        <Button busy={busy} disabled={tried && problems.length > 0} onClick={() => void save(true)}>
                            <Send className='h-4 w-4' /> Submit
                        </Button>
                    </>
                )}
                {locked && data.can.approve && (
                    <>
                        <Button onClick={() => act('approve')}>
                            <CheckCircle2 className='h-4 w-4' /> Approve
                        </Button>
                        <Button variant='secondary' onClick={() => act('return')}>
                            <Undo2 className='h-4 w-4' /> Return
                        </Button>
                    </>
                )}
            </div>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {fail && <Alert tone='error'>{fail}</Alert>}
            {tried && problems.length > 0 && (
                <Alert tone='warn'>
                    {problems.map((p) => (
                        <span key={p} className='block'>
                            {p}
                        </span>
                    ))}
                </Alert>
            )}
            {a?.status === 'submitted' && <Alert tone='info'>Waiting for approval{a.submittedAt ? ` since ${fmtDate(a.submittedAt)}` : ''}.{data.you.assessed && !data.you.testMode ? ' You made this assessment, so someone else must approve it.' : ''}</Alert>}
            {a?.status === 'returned' && <Alert tone='warn'>Returned: {a.returnReason}</Alert>}
            {!data.can.assess && !a && <Alert tone='info'>This material has not been assessed yet. Assessing needs the Criticality Assessor role for this warehouse.</Alert>}

            <Card className='space-y-3'>
                <div className='grid grid-cols-2 gap-2'>
                    <Result label='Approved cell' value={current.cell || 'Not assessed'} note={current.cell ? `${CLASS_LABEL[current.cell[0]]} · ${data.movementLabels[Number(current.cell[1])]}` : 'Procurement strategy stays manual'} />
                    <Result label='This assessment' value={cell || '—'} note={cell ? `Score ${s.score} of ${s.max} → ${s.scaled}` : 'Movement still needed'} />
                    <Result label='Procurement strategy' value={current.strategy || 'Not set'} note={current.strategySource === 'criticality' ? 'Set by the analysis (locked)' : setup.strategyMode === 'criticality' ? `Follows the analysis below ${setup.cutoff}` : 'Manual'} />
                    <Result label='Review due' value={current.reviewDue || '—'} note={`Every ${setup.reviewMonths} months`} />
                </div>
                {s.overrideBy.length > 0 && <p className='text-xs text-amber-300'>Class A because {s.overrideBy.join(', ')} {s.overrideBy.length === 1 ? 'is' : 'are'} rated very significant.</p>}
                <CriticalityGrid cutoff={setup.cutoff} marks={marks} compact />
            </Card>

            {groups.map((g) => (
                <Card key={g} className='space-y-3'>
                    <p className='text-sm font-semibold text-ink'>{g}</p>
                    {s.used
                        .filter((f) => f.group === g)
                        .map((f) => {
                            const r = ratings[f.code];
                            const suggest = f.code === 'LDT' && data.leadTimeDays ? (data.leadTimeDays <= 7 ? 1 : data.leadTimeDays <= 42 ? 2 : 3) : 0;
                            return (
                                <fieldset key={f.code} className='space-y-1.5'>
                                    <legend className='text-sm text-ink'>
                                        {f.name}
                                        {setup.factors[f.code].weight > 1 && <span className='ml-1 text-xs text-muted'>×{setup.factors[f.code].weight}</span>}
                                        {f.hse && setup.hseOverride && <span className='ml-1 text-xs text-amber-300'>3 forces A</span>}
                                    </legend>
                                    <p className='text-xs text-muted'>
                                        {f.question}
                                        {suggest ? ` Lead time in Inventory Information is ${data.leadTimeDays} days, which suggests ${suggest}.` : ''}
                                    </p>
                                    <div className='grid grid-cols-3 gap-1.5'>
                                        {[1, 2, 3].map((n) => (
                                            <button
                                                key={n}
                                                type='button'
                                                disabled={!editable}
                                                aria-pressed={r === n}
                                                onClick={() => setRatings((x) => ({ ...x, [f.code]: n }))}
                                                className={`min-h-16 rounded-xl border px-1.5 py-1 text-left text-xs leading-snug ${
                                                    r === n ? (n === 3 ? 'border-red-400 bg-red-500/15 text-ink' : n === 2 ? 'border-amber-400 bg-amber-500/15 text-ink' : 'border-emerald-400 bg-emerald-500/15 text-ink') : 'border-line text-soft'
                                                } ${!editable ? 'opacity-80' : 'active:bg-page'} ${tried && !r ? 'border-red-400/60' : ''}`}
                                            >
                                                <span className='block font-semibold'>
                                                    {n} · {RATING_LABEL[n]}
                                                </span>
                                                <span className='block'>{f.levels[n - 1]}</span>
                                            </button>
                                        ))}
                                    </div>
                                </fieldset>
                            );
                        })}
                </Card>
            ))}

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Movement</p>
                <div className='flex h-20 items-end gap-1' aria-label='Issues per month, last twelve months'>
                    {months.map((m) => (
                        <div key={m.month} className='flex flex-1 flex-col items-center gap-0.5'>
                            <div className={`w-full rounded-t ${m.quantity > 0 ? 'bg-brand' : 'bg-line'}`} style={{ height: `${Math.max(4, (m.quantity / peak) * 64)}px` }} title={`${m.month}: ${m.quantity}`} />
                            <span className='text-[9px] text-muted'>{m.month.slice(5)}</span>
                        </div>
                    ))}
                </div>
                <div className='grid grid-cols-2 gap-2'>
                    <Result label='Months with issues' value={`${movement.monthsWithIssues} of ${movement.coveredMonths || 0}`} note={`${movement.monthsWithIssuesPerYear} per year`} />
                    <Result label='Annual quantity' value={movement.annualQuantity} note={movement.concentrationPct >= 60 ? `${movement.concentrationPct}% in one month: one-off buying` : `Busiest month ${movement.concentrationPct}%`} />
                </div>
                <p className='text-xs text-muted'>
                    Movement follows how many months of the year the material is issued (very fast ≥ {setup.thresholds.m4}, fast ≥ {setup.thresholds.m3}, slow ≥ {setup.thresholds.m2}, otherwise very slow), so one large issue does not make it fast moving.
                </p>
                {movement.level !== null ? (
                    <Alert tone='info'>
                        From {data.movementData.historyMonths} months of issue history: movement {movement.level} ({data.movementLabels[movement.level]}).
                    </Alert>
                ) : (
                    <Alert tone='warn'>
                        Only {data.movementData.historyMonths} months of issue history (at least {setup.minHistoryMonths} are needed), so choose the movement by hand.
                    </Alert>
                )}
                <div className='grid grid-cols-4 gap-1.5'>
                    {[1, 2, 3, 4].map((n) => (
                        <button
                            key={n}
                            type='button'
                            disabled={!editable}
                            aria-pressed={movementLevel === n}
                            onClick={() => setManual(movement.level === n ? null : n)}
                            className={`min-h-14 rounded-xl border px-1 text-xs ${movementLevel === n ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft'} ${!editable ? 'opacity-80' : 'active:bg-page'}`}
                        >
                            <span className='block text-base font-semibold'>{n}</span>
                            {data.movementLabels[n]}
                        </button>
                    ))}
                </div>
                {(movement.level === null || overriding) && (
                    <Field
                        id='crit-movement-reason'
                        label={overriding ? 'Reason for overriding the calculated movement *' : 'Reason for the movement chosen *'}
                        maxLength={500}
                        value={manualReason}
                        disabled={!editable}
                        onChange={(e) => setManualReason(e.target.value)}
                        error={tried && manualReason.trim().length < 10 ? 'At least 10 characters' : undefined}
                        hint='For example the expected yearly use from the maintenance plan.'
                    />
                )}
            </Card>

            <Card>
                <Field id='crit-notes' label='Notes' maxLength={1000} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} hint='Evidence: failure history, equipment, supplier information.' />
            </Card>
        </div>
    );
}

function Result({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-panel p-2.5'>
            <p className='truncate text-xs text-muted'>{label}</p>
            <p className='truncate text-base font-semibold text-ink'>{value}</p>
            {note && <p className='text-[11px] leading-snug text-soft'>{note}</p>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inventory > Setup
// ---------------------------------------------------------------------------

interface SetupData {
    setup: Setup;
    version: number;
    updatedAt: string;
    reason: string;
    factors: Factor[];
    movementLabels: string[];
    onDemandStrategy: string;
    canEdit: boolean;
}
interface RegisterRow {
    id: string;
    materialId: string;
    materialNumber: string;
    description: string;
    warehouse: string;
    status: string;
    cell: string;
    criticalityClass: string;
    movement: number | null;
    pendingCell: string;
    onDemand: boolean;
    approvedAt: string;
    reviewDue: string;
    overdue: boolean;
}

/**
 * Criticality results for the material Overview: shown only once an assessment has been approved. The grid marks the
 * approved cell (and a newer cell waiting for approval), with the factor ratings and the 12-month issue profile.
 */
export function CriticalitySummary({ materialId, warehouseId, onOpen }: { materialId: string; warehouseId: string; onOpen: () => void }) {
    const { data } = useLoad(() => callBackend<MaterialData>(API + 'get', { materialId, warehouseId }).catch(() => null), [materialId, warehouseId]);
    if (!data || !data.current.cell) return null;
    const { current, assessment: a, setup, factors } = data;
    const marks: Record<string, 'current' | 'pending'> = { [current.cell]: 'current' };
    if (a && a.status === 'submitted' && a.cell && a.cell !== current.cell) marks[a.cell] = 'pending';
    const od = onDemand(current.cell, setup.cutoff);
    const rated = a && a.status === 'approved' ? factors.filter((f) => setup.factors[f.code]?.enabled && a.ratings[f.code]) : [];
    const months = data.movementData.months;
    const peak = Math.max(1, ...months.map((m) => m.quantity));
    return (
        <Card className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
                <p className='flex items-center gap-1.5 text-sm font-semibold text-ink'>
                    <Grid3X3 className='h-4 w-4' /> Criticality analysis
                </p>
                <Badge tone={od ? 'warn' : 'brand'}>{current.cell}</Badge>
            </div>
            <div className='grid grid-cols-2 gap-2 text-xs'>
                <Result label='Class' value={`${current.criticalityClass} · ${CLASS_LABEL[current.criticalityClass] ?? ''}`} />
                <Result label='Movement' value={current.movementClass ? `${current.movementClass} · ${data.movementLabels[current.movementClass] ?? ''}` : '—'} />
                <Result label='Procurement' value={od && setup.strategyMode === 'criticality' ? `On demand (${data.onDemandStrategy})` : current.strategy || 'Manual'} note={current.strategySource === 'criticality' ? 'Set by the analysis' : 'Manual strategy'} />
                <Result label='Review due' value={current.reviewDue || '—'} note={current.reviewDue && current.reviewDue < new Date().toISOString().slice(0, 10) ? 'Overdue' : undefined} />
            </div>
            <CriticalityGrid cutoff={setup.cutoff} marks={marks} compact />
            {rated.length > 0 && (
                <div className='space-y-1'>
                    <p className='text-xs font-semibold text-muted'>
                        Factor ratings{a?.score !== undefined && a?.max ? ` · score ${a.score} of ${a.max}` : ''}
                    </p>
                    {rated.map((f) => (
                        <div key={f.code} className='flex items-center gap-2 text-[11px]'>
                            <span className='w-28 shrink-0 truncate text-soft'>{f.name}</span>
                            <span className='h-2 flex-1 rounded bg-slate-800'>
                                <span className={`block h-2 rounded ${a!.ratings[f.code] === 3 ? 'bg-red-400' : a!.ratings[f.code] === 2 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${(a!.ratings[f.code] / 3) * 100}%` }} />
                            </span>
                            <span className='w-4 text-right text-ink'>{a!.ratings[f.code]}</span>
                        </div>
                    ))}
                </div>
            )}
            {months.some((m) => m.quantity > 0) && (
                <div className='space-y-1'>
                    <p className='text-xs font-semibold text-muted'>Issues per month (last 12)</p>
                    <div className='flex h-14 items-end gap-0.5' role='img' aria-label='Net issues per month over the last twelve months'>
                        {months.map((m) => (
                            <span key={m.month} title={`${m.month}: ${m.quantity}`} className='flex-1 rounded-t bg-sky-400/80' style={{ height: `${Math.max(2, (m.quantity / peak) * 100)}%` }} />
                        ))}
                    </div>
                </div>
            )}
            {a && a.status === 'submitted' && <p className='text-xs text-amber-300'>A new assessment ({a.cell}) is waiting for approval.</p>}
            <Button variant='secondary' onClick={onOpen}>
                Open criticality analysis
            </Button>
        </Card>
    );
}

export default function InventorySetup() {
    const [tab, setTab] = useState<'setup' | 'grid' | 'forecast'>('setup');
    return (
        <Screen
            title='Inventory setup'
            subtitle={tab === 'forecast' ? 'Forecasting' : 'Criticality analysis'}
            toolbar={
                <Segmented
                    label='Setup views'
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'setup', label: 'Criticality setup' },
                        { value: 'grid', label: 'Criticality grid' },
                        { value: 'forecast', label: 'Forecasting setup' },
                    ]}
                />
            }
        >
            {tab === 'setup' ? <CriticalitySetupForm /> : tab === 'grid' ? <CriticalityRegister /> : <ForecastSetupForm />}
        </Screen>
    );
}

function CriticalitySetupForm() {
    const { data, error, loading, reload } = useLoad(() => callBackend<SetupData>(API + 'setup/get', {}), []);
    const confirm = useConfirm();
    const [form, setForm] = useState<Setup | null>(null);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (data) setForm(JSON.parse(JSON.stringify(data.setup)));
    }, [data]);
    if (!data && loading) return <Spinner />;
    if (!data || !form) return <Alert tone='error'>{error || 'The setup could not be loaded.'}</Alert>;
    const edit = data.canEdit;
    const enabled = data.factors.filter((f) => form.factors[f.code]?.enabled);
    const t = form.thresholds;
    const problems = [
        ...(enabled.length < 3 ? ['Declare at least three factors.'] : []),
        ...(!(t.m4 > t.m3 && t.m3 > t.m2) ? ['Movement thresholds must decrease: very fast > fast > slow.'] : []),
        ...([t.m4, t.m3, t.m2].some((x) => !Number.isInteger(x) || x < 1 || x > 12) ? ['Movement thresholds are months per year, 1 to 12.'] : []),
        ...(!Number.isInteger(form.minHistoryMonths) || form.minHistoryMonths < 6 || form.minHistoryMonths > 24 ? ['Minimum issue history is 6 to 24 months.'] : []),
        ...(!Number.isInteger(form.reviewMonths) || form.reviewMonths < 3 || form.reviewMonths > 60 ? ['Review interval is 3 to 60 months.'] : []),
    ];
    const changed = JSON.stringify(form) !== JSON.stringify(data.setup);
    const maxScore = enabled.reduce((n, f) => n + 3 * form.factors[f.code].weight, 0);
    const set = (patch: Partial<Setup>) => setForm((f) => (f ? { ...f, ...patch } : f));
    const setFactor = (code: string, patch: Partial<{ enabled: boolean; weight: 1 | 2 | 3 }>) => setForm((f) => (f ? { ...f, factors: { ...f.factors, [code]: { ...f.factors[code], ...patch } } } : f));
    const num = (v: string) => (v === '' ? NaN : Number(v));

    const save = () =>
        confirm.ask(
            {
                title: 'Save the criticality setup?',
                message: `${enabled.length} declared factors (maximum score ${maxScore}). Strategy: ${form.strategyMode === 'criticality' ? `follows the analysis; materials at or below ${form.cutoff} are bought on demand (${data.onDemandStrategy}).` : 'manual for every material.'} ${
                    form.strategyMode !== data.setup.strategyMode || form.cutoff !== data.setup.cutoff ? 'Approved assessments are applied again under the new rule.' : ''
                }`,
                confirmLabel: 'Save setup',
                reason: { label: 'Reason for the change', minLength: 10 },
            },
            async (reason) => {
                const r = await callBackend<{ version: number; strategiesChanged: number }>(API + 'setup/save', { setup: form, reason, version: data.version });
                setNotice(`Setup version ${r.version} saved.${r.strategiesChanged ? ` ${r.strategiesChanged} material strategies updated.` : ''}`);
                reload();
            }
        );

    const groups = [...new Set(data.factors.map((f) => f.group))];
    return (
        <div className='space-y-3'>
            {confirm.sheet}
            {edit && (
                <div className='sticky top-0 z-10 bg-page pb-2'>
                    <Button disabled={!changed || problems.length > 0} onClick={save}>
                        <Save className='h-4 w-4' /> Save setup
                    </Button>
                </div>
            )}
            {notice && <Alert tone='success'>{notice}</Alert>}
            {changed && problems.length > 0 && (
                <Alert tone='warn'>
                    {problems.map((p) => (
                        <span key={p} className='block'>
                            {p}
                        </span>
                    ))}
                </Alert>
            )}
            {!edit && <Alert tone='info'>Read only: changing the setup needs the Criticality Administrator role.</Alert>}
            <p className='text-xs text-muted'>
                Version {data.version}
                {data.updatedAt ? ` · ${fmtDate(data.updatedAt)}` : ' · defaults (not saved yet)'}
                {data.reason ? ` · ${data.reason}` : ''}
            </p>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Procurement strategy</p>
                <div className='grid grid-cols-2 gap-2'>
                    {(['manual', 'criticality'] as const).map((m) => (
                        <button
                            key={m}
                            type='button'
                            disabled={!edit}
                            aria-pressed={form.strategyMode === m}
                            onClick={() => set({ strategyMode: m })}
                            className={`min-h-16 rounded-xl border px-2 py-1.5 text-left text-xs ${form.strategyMode === m ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft'}`}
                        >
                            <span className='block text-sm font-semibold'>{m === 'manual' ? 'Manual' : 'Dependent on criticality'}</span>
                            {m === 'manual' ? 'Planners choose every strategy.' : `Materials at or below the cutoff are bought on demand (${data.onDemandStrategy}) and locked.`}
                        </button>
                    ))}
                </div>
                <p className='text-xs text-muted'>A material without an approved assessment always stays manual. {data.onDemandStrategy} Direct purchase never starts automatic replenishment, whether set by hand or by the analysis.</p>
                <p className='text-sm text-ink'>Cutoff cell: {form.cutoff} {edit && <span className='text-xs text-muted'>(tap a cell)</span>}</p>
                <CriticalityGrid cutoff={form.cutoff} onPick={edit ? (cell) => set({ cutoff: cell }) : undefined} />
            </Card>

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Declared factors ({enabled.length})</p>
                <p className='text-xs text-muted'>
                    Each declared factor is rated 1 (insignificant), 2 (moderately significant) or 3 (very significant) and multiplied by its weight. The total is scaled from 1 to 4 between the lowest and the highest possible score and rounded: 4 A, 3 B, 2 C, 1 D.
                </p>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.hseOverride} onChange={(v) => edit && set({ hseOverride: v })} label='High-consequence override' />
                    <span className='text-sm text-soft'>A very significant safety, food safety, environment or legal rating makes the material A</span>
                </label>
                {groups.map((g) => (
                    <div key={g} className='space-y-1.5'>
                        <p className='pt-2 text-xs font-semibold uppercase tracking-wide text-muted'>{g}</p>
                        {data.factors
                            .filter((f) => f.group === g)
                            .map((f) => {
                                const fs = form.factors[f.code];
                                return (
                                    <div key={f.code} className='flex items-center gap-2 rounded-xl border border-line px-2 py-1.5'>
                                        <Toggle checked={fs.enabled} onChange={(v) => edit && setFactor(f.code, { enabled: v })} label={`Use ${f.name}`} />
                                        <div className='min-w-0 flex-1'>
                                            <p className='truncate text-sm text-ink'>
                                                {f.name}
                                                {f.hse && <span className='ml-1 text-[11px] text-amber-300'>HSE</span>}
                                            </p>
                                            <p className='text-[11px] leading-snug text-muted'>{f.question}</p>
                                        </div>
                                        <div className='flex shrink-0 gap-1' aria-label={`Weight of ${f.name}`}>
                                            {([1, 2, 3] as const).map((w) => (
                                                <button key={w} type='button' disabled={!edit || !fs.enabled} aria-pressed={fs.weight === w} onClick={() => setFactor(f.code, { weight: w })} className={`h-9 w-9 rounded-lg border text-xs ${fs.weight === w && fs.enabled ? 'border-brand bg-brand/15 text-ink' : 'border-line text-muted'}`}>
                                                    ×{w}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                ))}
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Movement</p>
                <p className='text-xs text-muted'>Months with issues in a year decide the movement, so regular use counts, not one-off buying.</p>
                <div className='grid grid-cols-3 gap-2'>
                    <Field id='crit-m4' label='4 very fast ≥' inputMode='numeric' maxLength={2} disabled={!edit} value={Number.isNaN(t.m4) ? '' : String(t.m4)} onChange={(e) => set({ thresholds: { ...t, m4: num(e.target.value) } })} />
                    <Field id='crit-m3' label='3 fast ≥' inputMode='numeric' maxLength={2} disabled={!edit} value={Number.isNaN(t.m3) ? '' : String(t.m3)} onChange={(e) => set({ thresholds: { ...t, m3: num(e.target.value) } })} />
                    <Field id='crit-m2' label='2 slow ≥' inputMode='numeric' maxLength={2} disabled={!edit} value={Number.isNaN(t.m2) ? '' : String(t.m2)} onChange={(e) => set({ thresholds: { ...t, m2: num(e.target.value) } })} />
                </div>
                <div className='grid grid-cols-2 gap-2'>
                    <Field id='crit-history' label='Minimum issue history (months)' inputMode='numeric' maxLength={2} disabled={!edit} value={Number.isNaN(form.minHistoryMonths) ? '' : String(form.minHistoryMonths)} onChange={(e) => set({ minHistoryMonths: num(e.target.value) })} hint='Less history: chosen by hand' />
                    <Field id='crit-review' label='Review every (months)' inputMode='numeric' maxLength={2} disabled={!edit} value={Number.isNaN(form.reviewMonths) ? '' : String(form.reviewMonths)} onChange={(e) => set({ reviewMonths: num(e.target.value) })} hint='Assessments become due again' />
                </div>
            </Card>
        </div>
    );
}

function CriticalityRegister() {
    const { data, error, loading } = useLoad(() => callBackend<{ rows: RegisterRow[]; cutoff: string; strategyMode: string; onDemandStrategy: string }>(API + 'register', {}), []);
    const [cell, setCell] = useState('');
    const counts = useMemo(() => {
        const c: Record<string, number> = {};
        for (const r of data?.rows ?? []) if (r.cell) c[r.cell] = (c[r.cell] ?? 0) + 1;
        for (const k of CLASSES.flatMap((x) => [1, 2, 3, 4].map((m) => `${x}${m}`))) c[k] = c[k] ?? 0;
        return c;
    }, [data]);
    const rows = useMemo(() => (data?.rows ?? []).filter((r) => !cell || r.cell === cell), [data, cell]);
    const columns: Array<Column<RegisterRow>> = [
        { key: 'material', label: 'Material', value: (r) => r.materialNumber, render: (r) => <span className='font-mono text-xs font-semibold text-brandsoft'>{r.materialNumber}</span> },
        { key: 'description', label: 'Description', value: (r) => r.description },
        { key: 'cell', label: 'Cell', value: (r) => r.cell || '', render: (r) => (r.cell ? <Badge tone={r.onDemand ? 'warn' : 'brand'}>{r.cell}</Badge> : '—') },
        { key: 'status', label: 'Status', value: (r) => r.status },
        { key: 'pending', label: 'Pending cell', value: (r) => r.pendingCell, hidden: true },
        { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
        { key: 'onDemand', label: 'On demand', value: (r) => (r.onDemand ? 'Yes' : 'No'), hidden: true },
        { key: 'approved', label: 'Approved', type: 'date', value: (r) => r.approvedAt || null, render: (r) => (r.approvedAt ? fmtDate(r.approvedAt) : ''), hidden: true },
        { key: 'review', label: 'Review due', type: 'date', value: (r) => r.reviewDue || null, render: (r) => (r.reviewDue ? <span className={r.overdue ? 'text-amber-300' : ''}>{r.reviewDue}</span> : '') },
    ];
    if (!data && loading) return <Spinner />;
    if (!data) return <Alert tone='error'>{error || 'The grid could not be loaded.'}</Alert>;
    const overdue = data.rows.filter((r) => r.overdue).length;
    return (
        <div className='space-y-3'>
            <Card className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='flex items-center gap-1.5 text-sm font-semibold text-ink'>
                        <Grid3X3 className='h-4 w-4' /> {data.rows.filter((r) => r.cell).length} assessed materials
                    </p>
                    {cell && (
                        <Button variant='secondary' onClick={() => setCell('')}>
                            Show all
                        </Button>
                    )}
                </div>
                <CriticalityGrid cutoff={data.cutoff} counts={counts} onPick={(c) => setCell(c === cell ? '' : c)} />
                <p className='text-xs text-muted'>
                    Tap a cell to list its materials. Strategy {data.strategyMode === 'criticality' ? `follows the analysis (${data.onDemandStrategy} at or below ${data.cutoff})` : 'is manual'}.{overdue ? ` ${overdue} assessments are due for review.` : ''}
                </p>
            </Card>
            <RichTable id='inv.criticality.register' title={cell ? `Cell ${cell}` : 'Criticality register'} fileName='Criticality_register' columns={columns} rows={rows} rowKey={(r) => r.id} empty='No assessments yet. Assess materials from Material detail > Criticality Analysis.' height='h-[calc(100dvh-26rem)]' />
        </div>
    );
}
