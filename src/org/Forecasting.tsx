// ---------------------------------------------------------------------------
// Demand forecasting (Inventory › material detail › Forecasting, and Inventory › Setup › Forecasting setup).
//
// The chart has two sections split by a "Now" line: the past as monthly columns of receipts, issues and reversals (tap
// a month for its movements day by day, tap a movement to mask it) and the future as a line with its 80% band and the
// planned events. The forecast runs in the browser on the same model the server uses; proposed levels are always
// worked out again on the server from the real journal with the saved inputs and need approval.
//
// Simulation: about 100 random movements a year ending today (very light to very high use; random, normal or skewed
// sizes; flat, rising or falling), always with one one-off issue. It is off whenever the page opens and the inputs
// are never saved; levels can still be proposed from it (when the setup allows): the server rebuilds the same data
// from the options and seed and the proposal is marked as simulated for the approvers.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarPlus, CheckCircle2, ChevronLeft, FlaskConical, RefreshCw, Save, Send, Trash2, Undo2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import { Badge, Button, Card, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import {
    LEVEL_FIELDS,
    METHODS,
    daysInMonth,
    localDay,
    monthOf,
    SIM_DISTRIBUTIONS,
    SIM_PROFILES,
    effectiveSource,
    readForecastSetup,
    runForecast,
    simulate,
    type LeadTime,
    type SimDistribution,
    type SimProfile,
    type SimTrend,
    type ForecastResult,
    type ForecastSetup,
    type Instance,
    type Method,
    type MonthRow,
    type PlannedEvent,
} from '../../backend/forecastModel';

const API = '/api/org/inventory/forecast/';
const COLORS = { receipt: '#34d399', issue: '#60a5fa', reversal: '#fbbf24', forecast: '#c084fc', fitted: '#94a3b8', grid: '#334155', text: '#94a3b8', stock: '#2dd4bf', min: '#f87171', max: '#fb923c' };
const KIND_LABEL = { issue: 'Issue', receipt: 'Receipt', reversal: 'Reversal' } as const;
const LEVEL_LABEL: Record<string, string> = { minimumLevel: 'Minimum', maximumLevel: 'Maximum', reorderQuantity: 'Reorder quantity', safetyStock: 'Safety stock', reorderPoint: 'Reorder point' };
const MODE_LABEL: Record<string, string> = { forecast: 'From the forecast', manual: 'Manual', manual_unless_forced: 'Manual unless forced' };
const PATTERN_LABEL: Record<string, string> = { smooth: 'Smooth', erratic: 'Erratic', intermittent: 'Intermittent', lumpy: 'Lumpy', none: 'No demand' };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const methodName = (code: string) => METHODS.find((m) => m.code === code)?.name ?? (code === 'auto' ? 'Automatic (best fit)' : code);
const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n.toFixed(digits)).toLocaleString());

interface Step {
    level: string;
    title: string;
    positionTitle: string;
    status: string;
    by: string;
    at: string;
}
interface Proposal {
    status: string;
    values: Record<string, number>;
    previous: Record<string, number | null>;
    changes: string[];
    value: number;
    steps: Step[];
    method: string;
    historyMonths: number;
    requestedBy: string;
    requestedAt: string;
    simulated?: boolean;
    simulation?: { profile: string; distribution: string; trend: string; years: number } | null;
    lead?: { externalDays: number; internalDays: number; externalSource: string; internalSource: string; statistic: string; samples: number };
    closeReason?: string;
    closedAt?: string;
}
interface ForecastData {
    setup: ForecastSetup;
    setupVersion: number;
    instances: Instance[];
    saved: { masked: Array<{ id: string; reason?: string; at?: string }>; events: PlannedEvent[]; method: string; pastMonths: number | null; futureMonths: number | null; updatedAt: string; reason: string };
    material: { criticalityClass: string; criticalityCell: string; cutoff: string; strategyMode: string; onDemand: string; unitPrice: number | null; unitCost: number; moq: number | null; orderMultiple: number | null; current: Record<string, number | null>; strategy: string; materialExternalDays: number | null; materialInternalDays: number | null };
    lead: LeadTime;
    leadSamples: Array<{ po: string; start: string; startBasis: string; requirementAt: string; deliveredOn: string; internalDays: number | null; externalDays: number | null }>;
    stock: { available: number; openSupply: number; physical: number; openRefs: string[] } | null;
    source: { source: 'forecast' | 'manual'; why: string; levelMode: string; historyMonths: number; forced: boolean; appliedAt: string; appliedMethod: string; appliedSimulated: boolean };
    proposal: Proposal | null;
    can: { edit: boolean; switch: boolean; approve: boolean; approveWhy: string; withdraw: boolean };
}

// ----- Charts -----

function niceMax(v: number) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
}

/** Past monthly columns (receipts, issues, reversals) and the future forecast line, split by the "Now" line. */
function DemandChart({ result, selected, onPick }: { result: ForecastResult; selected: string; onPick: (month: string) => void }) {
    const proj = result.projection;
    const lv = result.levels;
    const past = result.past;
    const future = result.future;
    const W = 32;
    const left = 38;
    const top = 16;
    const plotH = 170;
    const n = past.length + future.length;
    const width = Math.max(340, left + n * W + 12);
    const height = top + plotH + 34;
    const yMax = niceMax(Math.max(1, ...past.flatMap((r) => [r.issues, r.receipts, r.reversals]), ...future.map((f) => f.upper), ...(lv.onDemand ? [] : [lv.maximumLevel]), ...(proj ? [proj.start] : [])) * 1.05);
    const y = (v: number) => top + plotH - (Math.max(0, v) / yMax) * plotH;
    const cx = (i: number) => left + i * W + W / 2;
    const cut = left + past.length * W;
    const fittedBy = new Map(result.fitted.months.map((m, i) => [m, result.fitted.values[i]]));
    const fittedPts = past.map((r, i) => (fittedBy.get(r.month) !== undefined && fittedBy.get(r.month) !== null ? `${cx(i)},${y(fittedBy.get(r.month) as number)}` : '')).filter(Boolean);
    const lastFull = [...past].reverse().find((r) => !r.partial);
    const lastFullIndex = lastFull ? past.indexOf(lastFull) : -1;
    const line = [...(lastFull ? [`${cx(lastFullIndex)},${y(lastFull.demand)}`] : []), ...future.map((f, i) => `${cx(past.length + i)},${y(f.total)}`)].join(' ');
    const band = [...future.map((f, i) => `${cx(past.length + i)},${y(f.upper)}`), ...[...future].reverse().map((f, i) => `${cx(past.length + future.length - 1 - i)},${y(f.lower)}`)].join(' ');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
    // Open with the "Now" line in view: recent months on the left, the forecast on the right.
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = box.current;
        if (el) el.scrollLeft = Math.max(0, cut - el.clientWidth * 0.55);
    }, [cut, past.length]);
    return (
        <div ref={box} className='overflow-x-auto overscroll-contain' role='region' aria-label='Demand chart: past movements and forecast'>
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className='block'>
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={left} x2={width - 6} y1={y(t)} y2={y(t)} stroke={COLORS.grid} strokeWidth={0.5} />
                        <text x={left - 4} y={y(t) + 3} textAnchor='end' fontSize={9} fill={COLORS.text}>
                            {t >= 1000 ? `${Math.round(t / 100) / 10}k` : Math.round(t * 10) / 10}
                        </text>
                    </g>
                ))}
                <rect x={cut} y={top} width={width - 6 - cut} height={plotH} fill={COLORS.forecast} opacity={0.05} />
                {past.map((r, i) => {
                    const x0 = left + i * W;
                    const bars: Array<[number, string, string]> = [
                        [r.receipts, COLORS.receipt, 'receipts'],
                        [r.issues, COLORS.issue, 'issues'],
                        [r.reversals, COLORS.reversal, 'reversals'],
                    ];
                    return (
                        <g key={r.month} opacity={r.partial ? 0.6 : 1}>
                            {selected === r.month && <rect x={x0 + 1} y={top} width={W - 2} height={plotH} fill='#ffffff' opacity={0.07} rx={3} />}
                            {bars.map(([v, c], b) => (
                                <rect key={b} x={x0 + 4 + b * 8} y={y(v)} width={7} height={Math.max(0, top + plotH - y(v))} fill={c} rx={1} />
                            ))}
                            {r.masked > 0 && <circle cx={x0 + W / 2} cy={top + plotH + 25} r={2} fill='#f87171' />}
                            <rect
                                x={x0}
                                y={top}
                                width={W}
                                height={plotH + 20}
                                fill='transparent'
                                className='cursor-pointer outline-none'
                                role='button'
                                tabIndex={0}
                                aria-label={`${monthLabel(r.month)}: receipts ${r.receipts}, issues ${r.issues}, reversals ${r.reversals}, ${r.count} movements. Show day by day.`}
                                onClick={() => onPick(r.month)}
                                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPick(r.month)}
                            />
                        </g>
                    );
                })}
                {fittedPts.length > 1 && <polyline points={fittedPts.join(' ')} fill='none' stroke={COLORS.fitted} strokeWidth={1} strokeDasharray='3 3' />}
                {!lv.onDemand && lv.maximumLevel > 0 && (
                    <>
                        <line x1={cut} x2={width - 6} y1={y(lv.maximumLevel)} y2={y(lv.maximumLevel)} stroke={COLORS.max} strokeWidth={1} strokeDasharray='6 3' />
                        <text x={width - 8} y={y(lv.maximumLevel) - 3} textAnchor='end' fontSize={9} fill={COLORS.max}>
                            Max {fmt(lv.maximumLevel, 0)}
                        </text>
                        <line x1={cut} x2={width - 6} y1={y(lv.minimumLevel)} y2={y(lv.minimumLevel)} stroke={COLORS.min} strokeWidth={1} strokeDasharray='6 3' />
                        <text x={width - 8} y={y(lv.minimumLevel) - 3} textAnchor='end' fontSize={9} fill={COLORS.min}>
                            Min {fmt(lv.minimumLevel, 0)}
                        </text>
                    </>
                )}
                {proj && future.length > 0 && <polyline points={[`${cut},${y(Math.max(0, proj.start))}`, ...proj.rows.map((r, i) => `${cx(past.length + i)},${y(Math.max(0, r.projected))}`)].join(' ')} fill='none' stroke={COLORS.stock} strokeWidth={1.5} strokeDasharray='2 2' />}
                {future.length > 0 && <polygon points={band} fill={COLORS.forecast} opacity={0.18} />}
                {future.length > 0 && <polyline points={line} fill='none' stroke={COLORS.forecast} strokeWidth={2} />}
                {future.map((f, i) => (
                    <g key={f.month}>
                        <circle cx={cx(past.length + i)} cy={y(f.total)} r={2.5} fill={COLORS.forecast}>
                            <title>{`${monthLabel(f.month)}: ${fmt(f.total)} (base ${fmt(f.base)}${f.events ? `, events +${fmt(f.events)}` : ''}; 80% ${fmt(f.lower)}–${fmt(f.upper)})`}</title>
                        </circle>
                        {f.events > 0 && <path d={`M${cx(past.length + i)} ${top + 2} l4 4 l-4 4 l-4 -4 z`} fill={COLORS.reversal} />}
                    </g>
                ))}
                <line x1={cut} x2={cut} y1={top - 6} y2={top + plotH} stroke='#e2e8f0' strokeWidth={1} strokeDasharray='4 3' />
                <text x={cut - 3} y={top - 7} textAnchor='end' fontSize={9} fill='#e2e8f0'>
                    Past
                </text>
                <text x={cut + 3} y={top - 7} fontSize={9} fill='#e2e8f0'>
                    Future
                </text>
                {[...past.map((r) => r.month), ...future.map((f) => f.month)].map((m, i) => (
                    <text key={m} x={cx(i)} y={top + plotH + 12} textAnchor='middle' fontSize={9} fill={selected === m ? '#e2e8f0' : COLORS.text}>
                        {MONTH_NAMES[Number(m.slice(5, 7)) - 1]}
                        {(i === 0 || m.endsWith('-01')) && <tspan x={cx(i)} dy={9}>{m.slice(2, 4)}</tspan>}
                    </text>
                ))}
            </svg>
        </div>
    );
}

/** Every movement of a month as its own column on its day; tapping a column masks or includes it. */
function DayChart({ month, instances, masked, onToggle }: { month: string; instances: Instance[]; masked: Set<string>; onToggle: (id: string) => void }) {
    const days = daysInMonth(month);
    const list = instances.filter((x) => monthOf(x.at) === month);
    const byDay = new Map<number, Instance[]>();
    for (const x of list) {
        const d = Number(localDay(x.at).slice(8, 10));
        byDay.set(d, [...(byDay.get(d) ?? []), x]);
    }
    const D = 24;
    const left = 34;
    const top = 10;
    const plotH = 140;
    const width = Math.max(340, left + days * D + 8);
    const yMax = niceMax(Math.max(1, ...list.map((x) => x.qty)) * 1.05);
    const y = (v: number) => top + plotH - (v / yMax) * plotH;
    const colors = { issue: COLORS.issue, receipt: COLORS.receipt, reversal: COLORS.reversal };
    return (
        <div className='overflow-x-auto overscroll-contain' role='region' aria-label={`Movements of ${monthLabel(month)} day by day`}>
            <svg width={width} height={top + plotH + 22} viewBox={`0 0 ${width} ${top + plotH + 22}`} className='block'>
                {[0, 0.5, 1].map((t) => (
                    <g key={t}>
                        <line x1={left} x2={width - 4} y1={y(t * yMax)} y2={y(t * yMax)} stroke={COLORS.grid} strokeWidth={0.5} />
                        <text x={left - 4} y={y(t * yMax) + 3} textAnchor='end' fontSize={9} fill={COLORS.text}>
                            {Math.round(t * yMax * 10) / 10}
                        </text>
                    </g>
                ))}
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
                    const items = byDay.get(d) ?? [];
                    const x0 = left + (d - 1) * D;
                    const w = Math.max(3, (D - 4) / Math.max(1, items.length));
                    return (
                        <g key={d}>
                            {items.map((x, k) => {
                                const off = masked.has(x.id);
                                return (
                                    <rect
                                        key={x.id}
                                        x={x0 + 2 + k * w}
                                        y={y(x.qty)}
                                        width={Math.max(2, w - 1)}
                                        height={Math.max(1, top + plotH - y(x.qty))}
                                        fill={off ? 'transparent' : colors[x.kind]}
                                        stroke={off ? '#f87171' : 'none'}
                                        strokeDasharray={off ? '2 2' : undefined}
                                        className='cursor-pointer outline-none'
                                        role='button'
                                        tabIndex={0}
                                        aria-pressed={off}
                                        aria-label={`${KIND_LABEL[x.kind]} ${x.qty} on ${localDay(x.at)}, ${x.reference || 'no reference'}${off ? ', masked' : ''}. Tap to ${off ? 'include' : 'mask'}.`}
                                        onClick={() => onToggle(x.id)}
                                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(x.id)}
                                    >
                                        <title>{`${KIND_LABEL[x.kind]} ${x.qty} · ${localDay(x.at)} · ${x.reference}${off ? ' (masked)' : ''}`}</title>
                                    </rect>
                                );
                            })}
                            <text x={x0 + D / 2} y={top + plotH + 12} textAnchor='middle' fontSize={8} fill={items.length ? '#e2e8f0' : COLORS.text}>
                                {d}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

function Legend() {
    const item = (c: string, t: string, line = false) => (
        <span className='flex items-center gap-1'>
            <span className={line ? 'h-0.5 w-3' : 'h-2.5 w-2.5 rounded-sm'} style={{ background: c }} />
            {t}
        </span>
    );
    return (
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted'>
            {item(COLORS.receipt, 'Receipts')}
            {item(COLORS.issue, 'Issues')}
            {item(COLORS.reversal, 'Reversals')}
            {item(COLORS.fitted, 'Model fit', true)}
            {item(COLORS.forecast, 'Forecast (80% band)', true)}
            {item(COLORS.stock, 'Projected stock', true)}
            {item(COLORS.min, 'Min', true)}
            {item(COLORS.max, 'Max', true)}
        </div>
    );
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-panel p-2.5'>
            <p className='text-[11px] text-muted'>{label}</p>
            <p className='truncate text-sm font-semibold text-ink'>{value}</p>
            {note && <p className='text-[11px] leading-snug text-muted'>{note}</p>}
        </div>
    );
}

// ----- Planned events -----

const blankEvent = (): PlannedEvent => ({ id: `EV${Date.now().toString(36)}`, label: '', kind: 'overhaul', recurrence: 'once', month: '', qty: 0, upliftPct: 0 });

function EventsEditor({ events, onChange, disabled }: { events: PlannedEvent[]; onChange: (e: PlannedEvent[]) => void; disabled: boolean }) {
    const [draft, setDraft] = useState<PlannedEvent | null>(null);
    const problems = draft
        ? [
              ...(draft.label.trim().length < 3 ? ['Give the event a name (3 characters or more).'] : []),
              ...(!draft.month ? [draft.recurrence === 'once' ? 'Choose the month.' : 'Choose the month of the year.'] : []),
              ...(!(draft.qty > 0) && !(draft.upliftPct > 0) ? ['Give an extra quantity or an uplift percentage.'] : []),
              ...(draft.qty < 0 || draft.upliftPct < 0 || draft.upliftPct > 1000 ? ['Quantities are 0 or more; uplift is up to 1000%.'] : []),
          ]
        : [];
    return (
        <Card className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
                <p className='text-sm font-semibold text-ink'>Planned demand ({events.length})</p>
                {!draft && !disabled && events.length < 24 && (
                    <Button variant='secondary' onClick={() => setDraft(blankEvent())}>
                        <CalendarPlus className='h-4 w-4' /> Add
                    </Button>
                )}
            </div>
            <p className='text-xs text-muted'>Overhauls, shutdowns, projects or seasonal peaks the history cannot know about. Each adds an extra quantity and/or a percentage on top of the forecast in its month.</p>
            {events.map((e) => (
                <div key={e.id} className='flex items-center gap-2 rounded-xl border border-line px-2 py-1.5'>
                    <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm text-ink'>{e.label}</p>
                        <p className='text-[11px] text-muted'>
                            {e.kind} · {e.recurrence === 'once' ? monthLabel(e.month) : `every ${MONTH_NAMES[Number(e.month) - 1]}`}
                            {e.qty ? ` · +${e.qty}` : ''}
                            {e.upliftPct ? ` · +${e.upliftPct}%` : ''}
                        </p>
                    </div>
                    {!disabled && (
                        <button type='button' aria-label={`Remove ${e.label}`} className='flex h-10 w-10 items-center justify-center rounded-lg border border-line text-muted' onClick={() => onChange(events.filter((x) => x.id !== e.id))}>
                            <Trash2 className='h-4 w-4' />
                        </button>
                    )}
                </div>
            ))}
            {draft && (
                <div className='space-y-2 rounded-xl border border-brand/40 p-2'>
                    <Field id='fc-ev-label' label='Event' maxLength={80} value={draft.label} placeholder='e.g. Boiler overhaul' onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                    <div className='grid grid-cols-2 gap-2'>
                        <SelectField id='fc-ev-kind' label='Kind' value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as PlannedEvent['kind'] })}>
                            <option value='overhaul'>Overhaul / shutdown</option>
                            <option value='peak'>Peak demand</option>
                            <option value='project'>Project</option>
                            <option value='other'>Other</option>
                        </SelectField>
                        <SelectField id='fc-ev-rec' label='Happens' value={draft.recurrence} onChange={(e) => setDraft({ ...draft, recurrence: e.target.value as PlannedEvent['recurrence'], month: '' })}>
                            <option value='once'>Once</option>
                            <option value='yearly'>Every year</option>
                        </SelectField>
                    </div>
                    {draft.recurrence === 'once' ? (
                        <Field id='fc-ev-month' label='Month' type='month' value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} />
                    ) : (
                        <SelectField id='fc-ev-moy' label='Month of the year' value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })}>
                            <option value=''>Choose</option>
                            {MONTH_NAMES.map((m, i) => (
                                <option key={m} value={String(i + 1).padStart(2, '0')}>
                                    {m}
                                </option>
                            ))}
                        </SelectField>
                    )}
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='fc-ev-qty' label='Extra quantity' inputMode='decimal' value={draft.qty ? String(draft.qty) : ''} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) || 0 })} />
                        <Field id='fc-ev-pct' label='Uplift %' inputMode='decimal' value={draft.upliftPct ? String(draft.upliftPct) : ''} onChange={(e) => setDraft({ ...draft, upliftPct: Number(e.target.value) || 0 })} />
                    </div>
                    {problems.length > 0 && <p className='text-xs text-amber-300'>{problems[0]}</p>}
                    <div className='grid grid-cols-2 gap-2'>
                        <Button variant='secondary' onClick={() => setDraft(null)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={problems.length > 0}
                            onClick={() => {
                                onChange([...events, { ...draft, label: draft.label.trim() }]);
                                setDraft(null);
                            }}
                        >
                            Add event
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    );
}

// ----- Material forecast -----

export function MaterialForecast({ materialId, warehouseId, onChanged }: { materialId: string; warehouseId: string; onChanged?: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ForecastData>(API + 'get', { materialId, warehouseId }), [materialId, warehouseId]);
    const confirm = useConfirm();
    // Simulation is never persisted: it starts off every time the screen opens.
    const [sim, setSim] = useState(false);
    const [profile, setProfile] = useState<SimProfile>('moderate');
    const [distribution, setDistribution] = useState<SimDistribution>('uniform');
    const [trend, setTrend] = useState<SimTrend>('none');
    const [years, setYears] = useState(1);
    const [seed, setSeed] = useState(() => Date.now() % 100000);
    // The simulated year always ends at the moment simulation is switched on (any year, not a fixed calendar).
    const [simNow, setSimNow] = useState(() => new Date().toISOString());
    const [masked, setMasked] = useState<Set<string>>(new Set());
    const [simMasked, setSimMasked] = useState<Set<string>>(new Set());
    const [events, setEvents] = useState<PlannedEvent[]>([]);
    const [method, setMethod] = useState('setup');
    const [pastMonths, setPastMonths] = useState('');
    const [futureMonths, setFutureMonths] = useState('');
    const [view, setView] = useState<'chart' | 'table'>('chart');
    const [month, setMonth] = useState('');
    const [notice, setNotice] = useState('');

    const reset = (d: ForecastData) => {
        setMasked(new Set(d.saved.masked.map((m) => m.id)));
        setEvents(d.saved.events);
        setMethod(d.saved.method || 'setup');
        setPastMonths(d.saved.pastMonths ? String(d.saved.pastMonths) : '');
        setFutureMonths(d.saved.futureMonths ? String(d.saved.futureMonths) : '');
    };
    useEffect(() => {
        if (data) reset(data);
    }, [data]);

    const realNow = useMemo(() => new Date().toISOString(), [data]);
    const now = sim ? simNow : realNow;
    const simOptions = useMemo(() => ({ profile, distribution, trend, years, seed, now: simNow }), [profile, distribution, trend, years, seed, simNow]);
    const simData = useMemo(() => (sim ? simulate(simOptions) : []), [sim, simOptions]);
    const instances = sim ? simData : data?.instances ?? [];
    const activeMasked = sim ? simMasked : masked;
    const setup = data?.setup;
    const minPast = setup?.minHistoryMonths ?? 6;
    const inputProblems = [
        ...(pastMonths && !(Number.isInteger(Number(pastMonths)) && Number(pastMonths) >= minPast && Number(pastMonths) <= 36) ? [`Past months: ${minPast} to 36.`] : []),
        ...(futureMonths && !(Number.isInteger(Number(futureMonths)) && Number(futureMonths) >= 1 && Number(futureMonths) <= 24) ? ['Future months: 1 to 24.'] : []),
    ];
    const result = useMemo(() => {
        if (!data || !setup) return null;
        return runForecast({
            instances,
            masked: [...activeMasked],
            setup,
            events,
            now,
            method: method === 'setup' ? undefined : (method as Method),
            pastMonths: Number(pastMonths) >= minPast && Number(pastMonths) <= 36 ? Number(pastMonths) : undefined,
            futureMonths: Number(futureMonths) >= 1 && Number(futureMonths) <= 24 ? Number(futureMonths) : undefined,
            externalLeadDays: data.lead.externalDays,
            internalLeadDays: data.lead.internalDays,
            leadSigmaDays: data.lead.sigmaDays,
            onDemand: data.material.onDemand,
            stock: data.stock,
            criticalityClass: data.material.criticalityClass,
            unitPrice: data.material.unitPrice,
            moq: data.material.moq,
            orderMultiple: data.material.orderMultiple,
        });
    }, [data, setup, instances, activeMasked, events, method, pastMonths, futureMonths, now, minPast]);

    if (!data && loading) return <Spinner />;
    if (!data || !setup || !result) return <Alert tone='error'>{error || 'The forecast could not be loaded.'}</Alert>;

    const toggle = (id: string) => {
        if (!sim && (!data.can.edit || data.proposal?.status === 'pending')) return;
        const next = new Set(activeMasked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (sim) setSimMasked(next);
        else setMasked(next);
    };
    const savedMasks = new Set(data.saved.masked.map((m) => m.id));
    const masksChanged = masked.size !== savedMasks.size || [...masked].some((id) => !savedMasks.has(id));
    const eventsChanged = JSON.stringify(events) !== JSON.stringify(data.saved.events);
    const otherChanged = method !== (data.saved.method || 'setup') || pastMonths !== (data.saved.pastMonths ? String(data.saved.pastMonths) : '') || futureMonths !== (data.saved.futureMonths ? String(data.saved.futureMonths) : '');
    const dirty = masksChanged || eventsChanged || otherChanged;
    const pending = data.proposal?.status === 'pending' ? data.proposal : null;
    const locked = !data.can.edit || !!pending;
    const L = result.levels;
    const monthRow = result.past.find((r) => r.month === month);
    const inMonth = instances.filter((x) => monthOf(x.at) === month);

    const save = () =>
        confirm.ask(
            {
                title: 'Save the forecast inputs?',
                message: `${masked.size} masked movement${masked.size === 1 ? '' : 's'}, ${events.length} planned event${events.length === 1 ? '' : 's'}, method ${methodName(method === 'setup' ? setup.method : method)}. The levels do not change until a proposal is approved.`,
                confirmLabel: 'Save inputs',
                ...(masksChanged || eventsChanged ? { reason: { label: 'Why mask these movements or change the planned demand?', minLength: 10 } } : {}),
            },
            async (reason) => {
                await callBackend(API + 'save', { materialId, warehouseId, masked: [...masked].map((id) => ({ id })), events, method, pastMonths: pastMonths || null, futureMonths: futureMonths || null, reason });
                setNotice('Forecast inputs saved.');
                reload();
            }
        );
    const simSource = effectiveSource(setup, { levelsSource: data.source.forced ? 'forecast' : '' }, result.historyMonths);
    const propose = () =>
        confirm.ask(
            {
                title: sim ? 'Propose levels from simulated data?' : 'Propose the forecast levels?',
                ...(sim ? { acknowledge: 'I understand these levels come from simulated data, not from real movements, and will be marked as simulated for the approvers.' } : {}),
                message: (
                    <span>
                        {sim
                            ? 'The server rebuilds the same simulated data from its options and seed, works the levels out with your current masks, events and method, and sends them for approval by someone else.'
                            : 'The server works the levels out again from the posted journal with the saved inputs and sends them for approval by someone else.'}{' '}
                        A change in the maximum stock value is also routed through the Chart of Authority.
                        <span className='mt-2 block font-mono text-xs'>
                            Min {L.minimumLevel} · Max {L.maximumLevel} · ROQ {L.reorderQuantity} · SS {L.safetyStock} · ROP {L.reorderPoint}
                        </span>
                    </span>
                ),
                confirmLabel: 'Send for approval',
            },
            async () => {
                const r = await callBackend<{ value: number; levels: string[] }>(
                    API + 'propose',
                    sim
                        ? { materialId, warehouseId, simulation: simOptions, inputs: { masked: [...simMasked].map((id) => ({ id })), events, method, pastMonths: pastMonths || null, futureMonths: futureMonths || null } }
                        : { materialId, warehouseId }
                );
                setNotice(`${sim ? 'Simulated levels' : 'Levels'} sent for approval${r.levels.length ? ` (Chart of Authority ${r.levels.join(', ')})` : ''}.`);
                reload();
            }
        );
    const act = (action: 'approve' | 'return' | 'withdraw') =>
        confirm.ask(
            {
                title: action === 'approve' ? 'Approve the forecast levels?' : action === 'return' ? 'Return the proposal?' : 'Withdraw the proposal?',
                message: action === 'approve' ? 'At the last level the levels are written to Inventory Information and used by replenishment.' : action === 'return' ? 'The levels stay as they are; the proposer can change the inputs and propose again.' : 'The levels stay as they are.',
                confirmLabel: action === 'approve' ? 'Approve' : action === 'return' ? 'Return' : 'Withdraw',
                tone: action === 'approve' ? 'primary' : 'danger',
                ...(action === 'approve' && pending?.simulated ? { acknowledge: 'I understand these levels were worked out from simulated data, not from real movements.' } : {}),
                ...(action === 'return' ? { reason: { label: 'Reason', minLength: 10 } } : {}),
            },
            async (reason) => {
                const r = await callBackend<{ outcome?: string }>(API + 'action', { materialId, warehouseId, action, reason });
                setNotice(action === 'approve' ? (r.outcome === 'applied' ? 'Approved: the levels are applied.' : 'Level approved; the next level approves next.') : action === 'return' ? 'Returned.' : 'Withdrawn.');
                reload();
                onChanged?.();
            }
        );
    const switchSource = () => {
        const to = data.source.forced ? 'manual' : 'forecast';
        confirm.ask(
            {
                title: to === 'forecast' ? 'Use forecasting for this material?' : 'Switch this material to manual levels?',
                message: to === 'forecast' ? 'Minimum, maximum, reorder quantity, safety stock and reorder point can then only change through approved forecast proposals.' : 'Planners can then type the levels in Inventory Information. A pending proposal is withdrawn.',
                confirmLabel: to === 'forecast' ? 'Use forecasting' : 'Switch to manual',
                reason: { label: 'Reason', minLength: 10 },
            },
            async (reason) => {
                await callBackend(API + 'source', { materialId, warehouseId, source: to, reason });
                setNotice(to === 'forecast' ? 'The material now uses forecasting.' : 'The material now uses manual levels.');
                reload();
                onChanged?.();
            }
        );
    };

    const columns: Array<Column<Instance>> = [
        { key: 'date', label: 'Date', type: 'date', value: (x) => localDay(x.at), render: (x) => localDay(x.at) },
        { key: 'kind', label: 'Movement', value: (x) => KIND_LABEL[x.kind], render: (x) => <span style={{ color: COLORS[x.kind] }}>{KIND_LABEL[x.kind]}</span> },
        { key: 'qty', label: 'Quantity', type: 'number', value: (x) => x.qty },
        { key: 'status', label: 'In demand', value: (x) => (activeMasked.has(x.id) ? 'Masked' : x.kind === 'receipt' ? 'Not demand' : 'Included'), render: (x) => (activeMasked.has(x.id) ? <Badge tone='danger'>Masked</Badge> : x.kind === 'receipt' ? <span className='text-muted'>Not demand</span> : <Badge tone='brand'>Included</Badge>) },
        { key: 'reference', label: 'Reference', value: (x) => x.reference },
        { key: 'type', label: 'Type', value: (x) => x.type, hidden: true },
        { key: 'month', label: 'Month', value: (x) => monthOf(x.at), hidden: true },
        { key: 'note', label: 'Note', value: (x) => x.note ?? '', hidden: true },
    ];
    const trendIcon = result.trend.direction === 'increasing' ? <ArrowUpRight className='inline h-4 w-4 text-amber-300' /> : result.trend.direction === 'decreasing' ? <ArrowDownRight className='inline h-4 w-4 text-sky-300' /> : <ArrowRight className='inline h-4 w-4 text-muted' />;

    return (
        <div className='space-y-3'>
            {confirm.sheet}
            {sim && data.can.edit && !pending && setup.allowSimulatedLevels && (
                <div className='sticky top-0 z-10 space-y-1 bg-page py-2'>
                    <Button className='w-full' disabled={!!data.material.onDemand || simSource.source !== 'forecast' || inputProblems.length > 0} onClick={propose}>
                        <Send className='h-4 w-4' /> Propose simulated levels
                    </Button>
                    {data.material.onDemand ? <p className='text-[11px] text-muted'>Bought on demand: no levels to propose.</p> : simSource.source !== 'forecast' && <p className='text-[11px] text-muted'>The levels are manual: {simSource.why}</p>}
                </div>
            )}
            {!sim && data.can.edit && !pending && (
                <div className='sticky top-0 z-10 grid grid-cols-2 gap-2 bg-page py-2'>
                    <Button variant='secondary' disabled={!dirty || inputProblems.length > 0} onClick={save}>
                        <Save className='h-4 w-4' /> Save inputs
                    </Button>
                    <Button disabled={dirty || data.source.source !== 'forecast' || !!data.material.onDemand} onClick={propose}>
                        <Send className='h-4 w-4' /> Propose levels
                    </Button>
                    {dirty && <p className='col-span-2 text-[11px] text-muted'>Save the inputs before proposing: the server uses the saved inputs.</p>}
                    {!dirty && data.material.onDemand && <p className='col-span-2 text-[11px] text-muted'>Bought on demand: no minimum or maximum to propose.</p>}
                    {!dirty && !data.material.onDemand && data.source.source !== 'forecast' && <p className='col-span-2 text-[11px] text-muted'>The levels are manual, so this forecast is advisory. {data.can.switch ? 'Switch the material to forecasting to propose them.' : ''}</p>}
                </div>
            )}
            {!sim && dirty && (
                <Button variant='secondary' onClick={() => reset(data)}>
                    Discard changes
                </Button>
            )}
            {notice && <Alert tone='success'>{notice}</Alert>}

            <Card className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='flex items-center gap-1.5 text-sm font-semibold text-ink'>
                        <FlaskConical className='h-4 w-4' /> Simulation
                    </p>
                    <Toggle
                        checked={sim}
                        onChange={(v) => {
                            setSim(v);
                            setSimMasked(new Set());
                            setMonth('');
                            if (v) {
                                setSeed(Date.now() % 100000);
                                setSimNow(new Date().toISOString());
                            }
                        }}
                        label='Simulation with dummy data'
                    />
                </div>
                {sim ? (
                    <>
                        <div className='grid grid-cols-2 gap-2'>
                            <SelectField id='fc-sim-profile' label='Consumption' value={profile} onChange={(e) => { setProfile(e.target.value as SimProfile); setSimMasked(new Set()); }}>
                                {SIM_PROFILES.map((p) => (
                                    <option key={p.code} value={p.code}>
                                        {p.name}
                                    </option>
                                ))}
                            </SelectField>
                            <SelectField id='fc-sim-dist' label='Distribution' value={distribution} onChange={(e) => { setDistribution(e.target.value as SimDistribution); setSimMasked(new Set()); }}>
                                {SIM_DISTRIBUTIONS.map((d) => (
                                    <option key={d.code} value={d.code}>
                                        {d.name}
                                    </option>
                                ))}
                            </SelectField>
                            <SelectField id='fc-sim-trend' label='Trend' value={trend} onChange={(e) => { setTrend(e.target.value as SimTrend); setSimMasked(new Set()); }}>
                                <option value='none'>Flat</option>
                                <option value='rising'>Rising</option>
                                <option value='falling'>Falling</option>
                            </SelectField>
                            <SelectField id='fc-sim-years' label='Period' value={String(years)} onChange={(e) => { setYears(Number(e.target.value)); setSimMasked(new Set()); }}>
                                <option value='1'>Last year</option>
                                <option value='2'>Last 2 years</option>
                                <option value='3'>Last 3 years</option>
                            </SelectField>
                        </div>
                        <p className='text-[11px] text-muted'>{SIM_DISTRIBUTIONS.find((d) => d.code === distribution)?.note}.</p>
                        <Button variant='secondary' className='w-full' onClick={() => { setSeed((s) => (s * 7919 + 13) % 100000); setSimMasked(new Set()); }}>
                            <RefreshCw className='h-4 w-4' /> New random data
                        </Button>
                        <Alert tone='warn'>
                            Dummy data: {simData.length} random movements up to {localDay(simNow)}, including one one-off issue (SIM-BREAKDOWN). The inputs are not saved and it switches off when the page reloads.{' '}
                            {setup.allowSimulatedLevels ? 'Levels proposed from it are marked as simulated for the approvers.' : 'The setup does not allow levels from simulated data.'}
                        </Alert>
                    </>
                ) : (
                    <p className='text-xs text-muted'>Try the forecast on about 100 random movements a year (very light to very high use; random, normal or skewed sizes), always with a one-off issue. Off whenever the page opens.</p>
                )}
            </Card>

            <Card className='space-y-1.5'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='text-sm font-semibold text-ink'>Levels: {data.source.source === 'forecast' ? 'from the forecast' : 'manual'}</p>
                    <Badge tone={data.source.source === 'forecast' ? 'brand' : 'muted'}>{MODE_LABEL[data.source.levelMode] ?? data.source.levelMode}</Badge>
                </div>
                <p className='text-xs text-muted'>{data.source.why}</p>
                {data.source.appliedAt && <p className='text-xs text-muted'>Forecast levels last applied {fmtDate(data.source.appliedAt)} ({methodName(data.source.appliedMethod)}{data.source.appliedSimulated ? ', from simulated data' : ''}).</p>}
                {data.material.onDemand && <Alert tone='info'>{data.material.onDemand} The forecast below shows the expected demand only.</Alert>}
                {!data.material.onDemand && data.material.criticalityCell && (
                    <p className='text-xs text-muted'>
                        Criticality {data.material.criticalityCell} (service level {L.serviceLevel}%){data.material.strategyMode === 'criticality' ? `; cells at or below ${data.material.cutoff} are bought on demand` : ''}.
                    </p>
                )}
                {data.can.switch && (
                    <Button variant='secondary' onClick={switchSource} disabled={sim}>
                        {data.source.forced ? 'Switch to manual levels' : 'Use forecasting for this material'}
                    </Button>
                )}
            </Card>

            {pending && (
                <Card className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                        <p className='text-sm font-semibold text-ink'>Proposed levels waiting for approval</p>
                        <Badge tone='warn'>Pending</Badge>
                    </div>
                    {pending.simulated && (
                        <Alert tone='warn'>
                            From simulated data ({pending.simulation ? `${SIM_PROFILES.find((p) => p.code === pending.simulation!.profile)?.name ?? pending.simulation.profile} use, ${SIM_DISTRIBUTIONS.find((d) => d.code === pending.simulation!.distribution)?.name ?? pending.simulation.distribution}, ${pending.simulation.trend}, ${pending.simulation.years} year${pending.simulation.years === 1 ? '' : 's'}` : 'dummy movements'}), not from real movements.
                        </Alert>
                    )}
                    {pending.lead && <p className='text-xs text-muted'>Lead time {pending.lead.externalDays} + {pending.lead.internalDays} days ({pending.lead.statistic}, {pending.lead.samples} orders)</p>}
                    <p className='text-xs text-muted'>
                        Proposed {fmtDate(pending.requestedAt)} · {methodName(pending.method)} · {pending.historyMonths} months of history · value of change {fmt(pending.value, 2)}
                    </p>
                    <LevelTable current={pending.previous} proposed={pending.values} />
                    {pending.steps.length > 0 ? (
                        <ol className='space-y-1 text-xs'>
                            {pending.steps.map((s) => (
                                <li key={s.level} className='flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1'>
                                    <span className='min-w-0 truncate text-soft'>
                                        {s.level} {s.title} · {s.positionTitle}
                                    </span>
                                    <Badge tone={s.status === 'approved' ? 'brand' : 'muted'}>{s.status === 'approved' ? 'Approved' : 'Pending'}</Badge>
                                </li>
                            ))}
                        </ol>
                    ) : (
                        <p className='text-xs text-muted'>No change in stock value: one independent approval.</p>
                    )}
                    {!data.can.approve && data.can.approveWhy && <p className='text-xs text-amber-300'>{data.can.approveWhy}</p>}
                    <div className='grid grid-cols-2 gap-2'>
                        {data.can.approve && (
                            <>
                                <Button variant='danger' onClick={() => act('return')}>
                                    <Undo2 className='h-4 w-4' /> Return
                                </Button>
                                <Button onClick={() => act('approve')}>
                                    <CheckCircle2 className='h-4 w-4' /> Approve
                                </Button>
                            </>
                        )}
                        {data.can.withdraw && (
                            <Button variant='secondary' onClick={() => act('withdraw')}>
                                Withdraw
                            </Button>
                        )}
                    </div>
                </Card>
            )}
            {!pending && data.proposal && data.proposal.status === 'returned' && <Alert tone='warn'>The last proposal was returned{data.proposal.closeReason ? `: ${data.proposal.closeReason}` : '.'}</Alert>}

            <Card className='space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                    <p className='text-sm font-semibold text-ink'>Demand history and forecast</p>
                    <Segmented<'chart' | 'table'> label='View' value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
                </div>
                {view === 'chart' ? (
                    <>
                        <DemandChart result={result} selected={month} onPick={(m) => setMonth(m === month ? '' : m)} />
                        <Legend />
                        <p className='text-[11px] text-muted'>Tap a month to see each movement day by day; a red dot marks months with masked movements. Demand = issues − reversals; receipts are never demand. The current month is partial and not used for fitting.</p>
                    </>
                ) : (
                    <RichTable<Instance>
                        id='inv.material.forecast.movements'
                        title={sim ? 'Simulated movements' : 'Movements'}
                        fileName={`forecast-movements-${materialId}`}
                        columns={columns}
                        rows={[...instances].reverse()}
                        rowKey={(x) => x.id}
                        onRowClick={(x) => x.kind !== 'receipt' && toggle(x.id)}
                        empty='No receipts, issues or reversals posted yet.'
                        height='h-[60dvh]'
                    />
                )}
            </Card>

            {view === 'chart' && month && monthRow && (
                <Card className='space-y-2'>
                    <div className='flex items-center justify-between gap-2'>
                        <button type='button' className='flex min-h-[44px] items-center gap-1 text-sm font-semibold text-ink' onClick={() => setMonth('')}>
                            <ChevronLeft className='h-4 w-4' /> {monthLabel(month)}
                        </button>
                        <span className='text-xs text-muted'>
                            {inMonth.length} movement{inMonth.length === 1 ? '' : 's'}
                            {monthRow.masked ? ` · ${monthRow.masked} masked` : ''}
                        </span>
                    </div>
                    <MonthSummary row={monthRow} />
                    {inMonth.length ? <DayChart month={month} instances={inMonth} masked={activeMasked} onToggle={toggle} /> : <p className='text-sm text-muted'>No movements in this month.</p>}
                    <p className='text-[11px] text-muted'>{locked && !sim ? 'Read only.' : 'Tap a column to mask it (dashed red) or include it again. Masked movements are left out of the demand.'}</p>
                </Card>
            )}

            {inputProblems.length > 0 && <Alert tone='warn'>{inputProblems.join(' ')}</Alert>}
            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Forecast options</p>
                <SelectField id='fc-method' label='Method' value={method} disabled={locked && !sim} onChange={(e) => setMethod(e.target.value)}>
                    <option value='setup'>As the setup ({methodName(setup.method)})</option>
                    <option value='auto'>Automatic (best fit)</option>
                    {METHODS.map((m) => (
                        <option key={m.code} value={m.code}>
                            {m.name}
                        </option>
                    ))}
                </SelectField>
                <div className='grid grid-cols-2 gap-2'>
                    <Field id='fc-past' label='Past months' inputMode='numeric' maxLength={2} disabled={locked && !sim} placeholder={String(setup.pastMonths)} value={pastMonths} onChange={(e) => setPastMonths(e.target.value.replace(/\D/g, ''))} />
                    <Field id='fc-future' label='Future months' inputMode='numeric' maxLength={2} disabled={locked && !sim} placeholder={String(setup.futureMonths)} value={futureMonths} onChange={(e) => setFutureMonths(e.target.value.replace(/\D/g, ''))} />
                </div>
            </Card>

            <EventsEditor events={events} onChange={setEvents} disabled={locked && !sim} />

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Demand determination</p>
                <div className='grid grid-cols-2 gap-2'>
                    <Tile label='Trend' value={<>{trendIcon} {result.trend.direction === 'stable' ? 'Stable' : result.trend.direction === 'increasing' ? 'Increasing' : 'Decreasing'}</>} note={`${result.trend.pctPerMonth > 0 ? '+' : ''}${result.trend.pctPerMonth}% a month · t ${result.trend.t}${result.trend.direction === 'stable' ? ' (not significant)' : ''}`} />
                    <Tile label='Demand pattern' value={PATTERN_LABEL[result.pattern.pattern]} note={`ADI ${result.pattern.adi} · CV² ${result.pattern.cv2}`} />
                    <Tile label='Method' value={methodName(result.method)} note={result.requested === 'auto' ? 'Chosen by lowest error' : 'Chosen by hand'} />
                    <Tile label='Forecast error' value={`MAE ${fmt(result.accuracy.mae)}`} note={`RMSE ${fmt(result.accuracy.rmse)} · bias ${fmt(result.accuracy.bias)} · ${result.accuracy.points} months`} />
                    <Tile label='Demand per month' value={fmt(L.demandPerMonth)} note={`Next ${result.futureMonths} months incl. planned demand`} />
                    <Tile label='Issue history' value={`${result.historyMonths} months`} note={result.sufficient ? 'Enough for forecasting' : `Below ${setup.minHistoryMonths}: manual by default`} />
                </div>
                {result.outliers.length > 0 && <p className='text-xs text-amber-300'>Unusual months {setup.excludeOutliers ? 'capped' : 'flagged'}: {result.outliers.map(monthLabel).join(', ')}. Mask one-off movements if they will not repeat.</p>}
                {result.seasonal && <p className='text-xs text-muted'>Seasonal month-of-year indices are applied.</p>}
                {result.candidates.length > 1 && (
                    <div className='overflow-x-auto'>
                        <table className='w-full text-xs'>
                            <thead className='text-muted'>
                                <tr>
                                    <th className='py-1 text-left font-normal'>Method</th>
                                    <th className='text-right font-normal'>MAE</th>
                                    <th className='text-right font-normal'>RMSE</th>
                                    <th className='text-right font-normal'>Bias</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.candidates.map((c) => (
                                    <tr key={c.code} className={c.code === result.method ? 'text-ink' : 'text-soft'}>
                                        <td className='py-1'>{methodName(c.code)}{c.code === result.method ? ' ✓' : ''}</td>
                                        <td className='text-right'>{fmt(c.mae)}</td>
                                        <td className='text-right'>{fmt(c.rmse)}</td>
                                        <td className='text-right'>{fmt(c.bias)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <LeadTimeCard lead={data.lead} samples={data.leadSamples} material={data.material} setup={setup} />

            {result.projection && (
                <Card className='space-y-2'>
                    <p className='text-sm font-semibold text-ink'>Supply</p>
                    <div className='grid grid-cols-2 gap-2'>
                        <Tile label='Available stock' value={fmt(result.projection.available)} note={data.stock ? `Physical ${fmt(data.stock.physical)}` : undefined} />
                        <Tile label='Open supply' value={fmt(result.projection.openSupply)} note={data.stock?.openRefs.length ? data.stock.openRefs.slice(0, 3).join(', ') : 'Nothing on order'} />
                        <Tile label='Reorder point reached' value={L.onDemand ? 'On demand' : result.projection.reorderMonth ? monthLabel(result.projection.reorderMonth) : `Not within ${result.futureMonths} months`} note='With no new orders' />
                        <Tile label='Stock runs out' value={result.projection.stockoutMonth ? monthLabel(result.projection.stockoutMonth) : `Not within ${result.futureMonths} months`} note='Projected stock line on the chart' />
                    </div>
                </Card>
            )}

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Minimum, maximum and reorder levels</p>
                {L.onDemand && <p className='text-xs text-amber-300'>Bought on demand: no stock is held, so every level is zero.</p>}
                <LevelTable current={data.material.current} proposed={Object.fromEntries(LEVEL_FIELDS.map((k) => [k, L[k]]))} />
                <div className='space-y-0.5 text-[11px] text-muted'>
                    <p>
                        Lead time {fmt(L.leadDays)} days ({fmt(L.externalLeadDays)} external + {fmt(L.internalLeadDays)} internal) = {fmt(L.leadMonths, 2)} months · service level {L.serviceLevel}% (class {data.material.criticalityClass || 'not assessed'}) → z {L.z}
                    </p>
                    <p>
                        Safety stock = z·√(L·σ² + d²·σL²) with σ {fmt(L.sigma)} and lead time spread σL {fmt(L.sigmaLeadDays)} days ({data.lead.sigmaDays !== null ? 'from actual orders' : `${setup.leadTimeVariabilityPct}% of the lead time`}) · demand during lead time {fmt(L.demandDuringLead)}
                    </p>
                    <p>Reorder point = demand during lead time + safety stock; minimum = reorder point; maximum = minimum + reorder quantity. Reorder quantity: {L.roqBasis}.</p>
                    {L.notes.map((n) => (
                        <p key={n} className='text-amber-300'>
                            {n}
                        </p>
                    ))}
                </div>
            </Card>

        </div>
    );
}

function LeadTimeCard({ lead, samples, material, setup }: { lead: LeadTime; samples: ForecastData['leadSamples']; material: ForecastData['material']; setup: ForecastSetup }) {
    const src = (s: string, mat: number | null) => (s === 'actual' ? `actual (${lead.statistic === 'worst' ? 'worst case' : lead.statistic === 'best' ? 'best case' : 'average'})` : s === 'material' ? `from the material (${mat} days)` : 'not recorded');
    const range = (r: LeadTime['external']) => (r.average === null ? 'no orders' : `avg ${fmt(r.average)} · worst ${fmt(r.worst)} · best ${fmt(r.best)}`);
    return (
        <Card className='space-y-2'>
            <p className='text-sm font-semibold text-ink'>Lead time</p>
            <div className='grid grid-cols-2 gap-2'>
                <Tile label='Internal (requirement → PO approved or acknowledged)' value={`${fmt(lead.internalDays)} days`} note={`${src(lead.internalSource, material.materialInternalDays)} · ${lead.internalSamples} orders`} />
                <Tile label='External (PO approved or acknowledged → delivered)' value={`${fmt(lead.externalDays)} days`} note={`${src(lead.externalSource, material.materialExternalDays)} · ${lead.externalSamples} orders`} />
            </div>
            <p className='text-[11px] text-muted'>
                Internal {range(lead.internal)}; external {range(lead.external)} (days, last {setup.leadTimeLookbackMonths} months). Actual lead times are used from {setup.leadTimeMinSamples} order{setup.leadTimeMinSamples === 1 ? '' : 's'}; otherwise the material's lead times in Inventory Information.
            </p>
            {samples.length > 0 && (
                <div className='max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-line'>
                    <table className='w-full text-xs'>
                        <thead className='sticky top-0 bg-panel text-muted'>
                            <tr>
                                <th className='px-2 py-1 text-left font-normal'>Order</th>
                                <th className='text-left font-normal'>Delivered</th>
                                <th className='text-right font-normal'>Int.</th>
                                <th className='px-2 text-right font-normal'>Ext.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {samples.map((x, i) => (
                                <tr key={`${x.po}-${i}`} className='border-t border-line text-soft'>
                                    <td className='px-2 py-1 font-mono'>
                                        {x.po}
                                        {x.startBasis === 'acknowledged' ? ' ✓' : ''}
                                    </td>
                                    <td>{x.deliveredOn}</td>
                                    <td className='text-right'>{x.internalDays === null ? '—' : fmt(x.internalDays)}</td>
                                    <td className='px-2 text-right'>{x.externalDays === null ? '—' : fmt(x.externalDays)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {samples.length > 0 && <p className='text-[11px] text-muted'>✓ supplier acknowledgement used as the start; otherwise the final approval.</p>}
        </Card>
    );
}

function MonthSummary({ row }: { row: MonthRow }) {
    return (
        <div className='grid grid-cols-4 gap-1 text-center text-[11px]'>
            {(
                [
                    ['Receipts', row.receipts, COLORS.receipt],
                    ['Issues', row.issues, COLORS.issue],
                    ['Reversals', row.reversals, COLORS.reversal],
                    ['Demand', row.demand, '#e2e8f0'],
                ] as Array<[string, number, string]>
            ).map(([k, v, c]) => (
                <div key={k} className='rounded-lg border border-line py-1'>
                    <p className='text-muted'>{k}</p>
                    <p className='font-semibold' style={{ color: c }}>
                        {fmt(v)}
                    </p>
                </div>
            ))}
        </div>
    );
}

function LevelTable({ current, proposed }: { current: Record<string, number | null>; proposed: Record<string, number> }) {
    return (
        <table className='w-full text-sm'>
            <thead className='text-xs text-muted'>
                <tr>
                    <th className='py-1 text-left font-normal'>Level</th>
                    <th className='text-right font-normal'>Current</th>
                    <th className='text-right font-normal'>Forecast</th>
                </tr>
            </thead>
            <tbody>
                {LEVEL_FIELDS.map((k) => {
                    const changed = current[k] !== proposed[k];
                    return (
                        <tr key={k} className='border-t border-line'>
                            <td className='py-1.5 text-soft'>{LEVEL_LABEL[k]}</td>
                            <td className='text-right text-soft'>{current[k] === null || current[k] === undefined ? '—' : fmt(current[k] as number, 2)}</td>
                            <td className={`text-right font-semibold ${changed ? 'text-brandsoft' : 'text-ink'}`}>{fmt(proposed[k], 2)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

// ----- Setup -----

interface SetupData {
    setup: ForecastSetup;
    version: number;
    updatedAt: string;
    reason: string;
    canEdit: boolean;
}

export function ForecastSetupForm() {
    const { data, error, loading, reload } = useLoad(() => callBackend<SetupData>(API + 'setup/get', {}), []);
    const confirm = useConfirm();
    const [form, setForm] = useState<Record<string, any> | null>(null);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (data) setForm(JSON.parse(JSON.stringify(data.setup)));
    }, [data]);
    if (!data && loading) return <Spinner />;
    if (!data || !form) return <Alert tone='error'>{error || 'The setup could not be loaded.'}</Alert>;
    const edit = data.canEdit;
    let parsed: ForecastSetup | null = null;
    let problem = '';
    try {
        parsed = readForecastSetup(form);
    } catch (e) {
        problem = messageOf(e);
    }
    const changed = !!parsed && JSON.stringify(parsed) !== JSON.stringify(data.setup);
    const set = (patch: Record<string, unknown>) => setForm((f) => (f ? { ...f, ...patch } : f));
    const numField = (key: string, label: string, opts: { hint?: string; mode?: 'numeric' | 'decimal'; max?: number } = {}) => (
        <Field id={`fc-set-${key}`} label={label} inputMode={opts.mode ?? 'numeric'} maxLength={opts.max ?? 5} disabled={!edit} hint={opts.hint} value={String(form[key] ?? '')} onChange={(e) => set({ [key]: e.target.value })} />
    );
    const save = () =>
        parsed &&
        confirm.ask(
            {
                title: 'Save the forecasting setup?',
                message: `Levels: ${MODE_LABEL[parsed.levelMode]}${parsed.levelMode === 'forecast' ? ` (manual below ${parsed.minHistoryMonths} months of issue history)` : ''}. Method ${methodName(parsed.method)}. ${parsed.levelMode === 'manual' && data.setup.levelMode !== 'manual' ? 'Pending forecast proposals are withdrawn.' : ''}`,
                confirmLabel: 'Save setup',
                reason: { label: 'Reason for the change', minLength: 10 },
            },
            async (reason) => {
                const r = await callBackend<{ version: number; withdrawn: number }>(API + 'setup/save', { setup: parsed, reason, version: data.version });
                setNotice(`Setup version ${r.version} saved.${r.withdrawn ? ` ${r.withdrawn} pending proposals withdrawn.` : ''}`);
                reload();
            }
        );
    const modes: Array<[ForecastSetup['levelMode'], string, string]> = [
        ['forecast', 'From the forecast', `Derived from the forecast; with less than the minimum history the levels stay manual.`],
        ['manual', 'Entirely manual', 'Planners type every level; the forecast is advisory.'],
        ['manual_unless_forced', 'Manual unless forced', 'Manual by default; a material can be switched to forecasting.'],
    ];
    return (
        <div className='space-y-3'>
            {confirm.sheet}
            {edit && (
                <div className='sticky top-0 z-10 bg-page pb-2'>
                    <Button disabled={!changed || !!problem} onClick={save}>
                        <Save className='h-4 w-4' /> Save setup
                    </Button>
                </div>
            )}
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='warn'>{problem}</Alert>}
            {!edit && <Alert tone='info'>Read only: changing the setup needs the Forecasting Administrator role.</Alert>}
            <p className='text-xs text-muted'>
                Version {data.version}
                {data.updatedAt ? ` · ${fmtDate(data.updatedAt)}` : ' · defaults (not saved yet)'}
                {data.reason ? ` · ${data.reason}` : ''}
            </p>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Minimum, maximum and reorder quantity</p>
                <div className='grid gap-2'>
                    {modes.map(([m, t, d]) => (
                        <button key={m} type='button' disabled={!edit} aria-pressed={form.levelMode === m} onClick={() => set({ levelMode: m })} className={`min-h-14 rounded-xl border px-3 py-2 text-left text-xs ${form.levelMode === m ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft'}`}>
                            <span className='block text-sm font-semibold'>{t}</span>
                            {d}
                        </button>
                    ))}
                </div>
                {numField('minHistoryMonths', 'Minimum issue history (months)', { hint: 'At least 6; less history means manual', max: 2 })}
                <p className='text-xs text-muted'>Safety stock and reorder point follow the same rule. Forecast levels are proposed on the material's Forecasting tab and need approval (Chart of Authority on the change in stock value).</p>
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Forecast</p>
                <div className='grid grid-cols-2 gap-2'>
                    {numField('pastMonths', 'Past months', { hint: 'Up to 36', max: 2 })}
                    {numField('futureMonths', 'Future months', { hint: 'Up to 24', max: 2 })}
                </div>
                <SelectField id='fc-set-method' label='Default method' value={String(form.method)} disabled={!edit} onChange={(e) => set({ method: e.target.value })}>
                    <option value='auto'>Automatic (lowest one-step-ahead error)</option>
                    {METHODS.map((m) => (
                        <option key={m.code} value={m.code}>
                            {m.name} — {m.note}
                        </option>
                    ))}
                </SelectField>
                <div className='grid grid-cols-3 gap-2'>
                    {numField('window', 'Window (months)', { max: 2 })}
                    {numField('alpha', 'Alpha', { mode: 'decimal' })}
                    {numField('beta', 'Beta (trend)', { mode: 'decimal' })}
                </div>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.seasonal === true} onChange={(v) => edit && set({ seasonal: v })} label='Seasonal indices' />
                    <span className='text-sm text-soft'>Seasonal month-of-year indices (needs 24 months)</span>
                </label>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.excludeOutliers !== false} onChange={(v) => edit && set({ excludeOutliers: v })} label='Cap unusual months' />
                    <span className='text-sm text-soft'>Cap unusual months beyond the outlier limit</span>
                </label>
                {numField('outlierZ', 'Outlier limit (robust z)', { mode: 'decimal', hint: '3.5 is usual' })}
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Service level by criticality class (%)</p>
                <div className='grid grid-cols-5 gap-1.5'>
                    {(['A', 'B', 'C', 'D', 'none'] as const).map((c) => (
                        <Field key={c} id={`fc-sl-${c}`} label={c === 'none' ? 'None' : c} inputMode='decimal' maxLength={4} disabled={!edit} value={String(form.serviceLevels?.[c] ?? '')} onChange={(e) => set({ serviceLevels: { ...form.serviceLevels, [c]: e.target.value } })} />
                    ))}
                </div>
                <p className='text-xs text-muted'>The chance of not running out during the lead time. Higher for critical classes; "None" is for materials without an approved criticality assessment.</p>
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Lead time from purchase orders</p>
                <div className='grid grid-cols-2 gap-2'>
                    {numField('leadTimeLookbackMonths', 'Look back (months)', { hint: 'Received orders in this period', max: 2 })}
                    {numField('leadTimeMinSamples', 'Minimum orders', { hint: 'Fewer: the material lead time', max: 2 })}
                </div>
                <div className='grid grid-cols-3 gap-2'>
                    {(['average', 'worst', 'best'] as const).map((m) => (
                        <button key={m} type='button' disabled={!edit} aria-pressed={form.leadTimeStatistic === m} onClick={() => set({ leadTimeStatistic: m })} className={`min-h-14 rounded-xl border px-2 py-1.5 text-left text-xs ${form.leadTimeStatistic === m ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft'}`}>
                            <span className='block text-sm font-semibold'>{m === 'average' ? 'Average' : m === 'worst' ? 'Worst case' : 'Best case'}</span>
                            {m === 'average' ? 'Mean of the orders' : m === 'worst' ? 'Longest order' : 'Shortest order'}
                        </button>
                    ))}
                </div>
                <p className='text-xs text-muted'>Internal lead time: purchase requirement created → purchase order approved (or acknowledged by the supplier). External: approved or acknowledged → the delivery that completed the line. Lead times are not set here: with too few orders the material's lead times (Inventory Information) are used.</p>
                {numField('leadTimeVariabilityPct', 'Lead time variability % (fewer than 3 orders)', { mode: 'decimal' })}
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Reorder quantity</p>
                <div className='grid grid-cols-2 gap-2'>
                    {(['cover', 'eoq'] as const).map((m) => (
                        <button key={m} type='button' disabled={!edit} aria-pressed={form.roqMethod === m} onClick={() => set({ roqMethod: m })} className={`min-h-14 rounded-xl border px-2 py-1.5 text-left text-xs ${form.roqMethod === m ? 'border-brand bg-brand/15 text-ink' : 'border-line text-soft'}`}>
                            <span className='block text-sm font-semibold'>{m === 'cover' ? 'Cover period' : 'EOQ'}</span>
                            {m === 'cover' ? 'Forecast demand over a number of days.' : 'Economic order quantity from price and costs.'}
                        </button>
                    ))}
                </div>
                {form.roqMethod === 'cover' ? (
                    numField('coverDays', 'Cover period (days)', { max: 3 })
                ) : (
                    <div className='grid grid-cols-2 gap-2'>
                        {numField('orderingCost', 'Cost per order', { mode: 'decimal', max: 12 })}
                        {numField('holdingPct', 'Holding cost % a year', { mode: 'decimal' })}
                    </div>
                )}
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.wholeUnits !== false} onChange={(v) => edit && set({ wholeUnits: v })} label='Whole units' />
                    <span className='text-sm text-soft'>Round levels up to whole units</span>
                </label>
                <p className='text-xs text-muted'>Minimum order quantity and order multiple from Procurement Information are applied to the reorder quantity.</p>
            </Card>

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Simulation</p>
                <label className='flex min-h-[44px] items-center gap-3'>
                    <Toggle checked={form.allowSimulatedLevels !== false} onChange={(v) => edit && set({ allowSimulatedLevels: v })} label='Allow levels from simulated data' />
                    <span className='text-sm text-soft'>Allow minimum and maximum proposed from simulated data</span>
                </label>
                <p className='text-xs text-muted'>The server rebuilds the simulated data from its seed; such proposals are marked as simulated and still need approval and the Chart of Authority.</p>
            </Card>
        </div>
    );
}
