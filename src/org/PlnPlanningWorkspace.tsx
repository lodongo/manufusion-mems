import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Boxes, CalendarRange, Check, ChevronDown, ChevronRight, MapPin, ClipboardCheck, Factory, Gauge, Layers, Plus, RefreshCw, Rocket, Send, Settings2, Trash2, Undo2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SearchField, SelectField, TextArea } from '../components/ui';
import { messageOf, useConfirm } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';

// S&OP planning cycle (ASCM practice): annual demand per SKU for the financial year (balance periods when part-way) →
// detailed SKU forecast → independent demand review → BOM unitisation, multi-level MRP and rough-cut capacity →
// executive S&OP approval on the Chart of Authority (planned purchase value) → release as the plan of record.
// The server enforces every rule (site scope, maker-checker, Chart of Authority, audit); this screen only guides.

const API = '/api/org/pln/planning/';
type Status = 'draft' | 'demand_review' | 'supply_planning' | 'sop_review' | 'approved' | 'released' | 'superseded' | 'cancelled';
type Action = 'edit_demand' | 'run_forecast' | 'submit_demand' | 'approve_demand' | 'return_demand' | 'run_supply' | 'submit_supply' | 'approve_sop' | 'return_sop' | 'release' | 'cancel';
interface Bucket { key: string; no: number; name: string; start: string; end: string; month: string; days: number; fraction: number; state: 'past' | 'current' | 'future' }
interface Balance { periods: number; open: number; past: number; firstOpen: string; share: number }
interface Year { fy: number; label: string; start: string; end: string; source: 'finance' | 'settings' | 'calendar'; leName: string; status: string; buckets: Bucket[]; balance: Balance }
interface Sku { id: string; name: string; uom: string; category: string; processClassId: string; whole: boolean }
interface Indivisible { key: string; packSize: number; note: string }
interface Setup {
    demandSource: 'ANNUAL_PLAN'; currentPeriodRule: 'prorate' | 'include' | 'exclude'; defaultAnnualBasis: 'FULL_YEAR' | 'BALANCE'; defaultProfile: Profile; customProfile: number[];
    defaultForecastBasis: Basis; blendPct: number; historyMonths: number; discreteUoms: string[]; indivisible: Indivisible[]; unitTolerancePct: number; processBatchRule: 'runs' | 'multiple';
    hoursPerDay: number; workingDaysPerWeek: number; oeePct: number; overloadPct: number;
}
type Profile = 'FLAT' | 'DAYS' | 'HISTORY' | 'CUSTOM';
type Basis = 'ANNUAL' | 'STATISTICAL' | 'BLENDED';
interface Line { skuId: string; annualQty: number | string; annualBasis: 'FULL_YEAR' | 'BALANCE'; profile: Profile; forecastBasis: Basis; blendPct: number | string; overrides: Record<string, { qty: number; reason: string }>; note: string }
interface Context { setup: Setup; version: number; setupUpdatedAt: string; setupHistory: Array<{ at: string; byName: string; version: number; reason: string }>; sites: Array<{ id: string; name: string }>; siteId: string; years: Year[]; skus: Sku[]; can: Record<string, boolean>; steps: Array<{ status: Status; label: string; role: string }>; today: string }
interface Brief { id: string; siteId: string; siteName: string; fy: number; fyLabel: string; status: Status; revision: number; lines: number; updatedAt: string; createdByName: string; kpis: Kpis | null; demandTotals: { annual: number; balance: number; demand: number; firm: number } | null }
interface Kpis { skus: number; demand: number; production: number; unitisationExcess: number; purchaseValue: number; materials: number; pastDue: number; overloaded: number; peakUtilisation: number; withoutBom: number }
interface Step { level: string; title: string; positionTitle: string; status: 'pending' | 'approved'; byName: string; at: string; note: string }
interface Plan {
    id: string; siteId: string; siteName: string; fy: number; fyLabel: string; leName: string; yearSource: string; status: Status; revision: number; lines: Line[]; buckets: Bucket[]; balance: Balance;
    forecastRunAt: string; forecastStale?: boolean; supplyRunAt: string; kpis?: Kpis; demandTotals?: Brief['demandTotals']; demandReturnReason?: string; coa?: { amount: number; steps: Step[]; returnReason?: string };
    history: Array<{ at: string; byName: string; action: string; note: string; status: string }>; copiedFrom?: string; readinessGaps?: number;
}
interface FBucket { key: string; month: string; fraction: number; annual: number; statistical: number | null; lower: number | null; upper: number | null; consensus: number; override: number | null; firm: number; demand: number }
interface Forecast { skuId: string; uom: string; whole: boolean; basis: Basis; effectiveBasis: Basis; buckets: FBucket[]; totals: { annual: number; balance: number; statistical: number | null; firm: number; demand: number }; stat: { method: string; pattern: string; trend: string; mase: number | null; historyMonths: number; seasonal: boolean } | null; notes: string[] }
interface MrpRow { key: string; gross: number; scheduled: number; projected: number; net: number; receipt: number; release: number }
interface MrpItem { key: string; kind: 'sku' | 'material' | 'utility'; id: string; warehouseId: string; name: string; uom: string; level: number; lot: number; leadBuckets: number; rows: MrpRow[]; totals: { gross: number; receipts: number; value: number; excess: number }; pastDue: number; parents: string[]; unitCost: number; notes: string[] }
interface UnitLine { line: number; key: string; kind: string; uom: string; perOutput: number; indivisible: boolean; packSize: number; why: string; batchQty: number; packs: number | null; deviationPct: number }
interface Unit { bomId: string; outputUom: string; minimalBatch: number; exactBatch: number; processBatch: number | null; lot: number; lines: UnitLine[]; notes: string[] }
interface UnitRow { skuId: string; name: string; uom: string; bomId: string; bomName: string; routingId: string; routingName: string; unit: Unit | null }
interface CapRow { routingId: string; name: string; skus: string[]; ratePerHour: number; bottleneck: string; buckets: Array<{ key: string; required: number; available: number; utilisation: number | null; runs: number }>; peak: number | null; overloaded: string[] }
interface Supply { mrp: { items: MrpItem[]; issues: string[]; truncated: boolean }; capacity: CapRow[]; units: UnitRow[]; sop: { families: Array<{ family: string; skus: number; buckets: Array<{ key: string; demand: number; production: number; inventory: number }> }>; kpis: Kpis; purchaseByBucket: number[] }; readiness: Array<{ skuId: string; bom: boolean; routing: boolean }> }
interface Detail { plan: Plan; forecast: Forecast[]; supply: Supply | null; actions: Action[] }

type View = 'overview' | 'demand' | 'forecast' | 'unit' | 'mrp' | 'capacity' | 'sop';
const VIEWS: Array<{ key: View; label: string; Icon: typeof Gauge }> = [
    { key: 'overview', label: 'Overview', Icon: Gauge },
    { key: 'demand', label: 'Annual demand', Icon: CalendarRange },
    { key: 'forecast', label: 'SKU forecast', Icon: BarChart3 },
    { key: 'unit', label: 'Unitisation', Icon: Boxes },
    { key: 'mrp', label: 'MRP', Icon: Layers },
    { key: 'capacity', label: 'Capacity', Icon: Factory },
    { key: 'sop', label: 'S&OP & approval', Icon: ClipboardCheck },
];
const STATUS_LABEL: Record<Status, string> = { draft: 'Demand planning', demand_review: 'Demand review', supply_planning: 'Supply planning', sop_review: 'S&OP review', approved: 'Approved', released: 'Released', superseded: 'Superseded', cancelled: 'Cancelled' };
const BASIS_LABEL: Record<Basis, string> = { ANNUAL: 'Annual plan', STATISTICAL: 'Statistical', BLENDED: 'Blend' };
const PROFILE_LABEL: Record<Profile, string> = { FLAT: 'Even per period', DAYS: 'By calendar days', HISTORY: 'From order history', CUSTOM: 'Custom monthly %' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(v));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${fmt(v, 1)}%`);
const short = (b: Bucket) => `${MONTHS[Number(b.month.slice(5, 7)) - 1]} ${b.month.slice(2, 4)}`;
const post = <T,>(path: string, body: Record<string, unknown> = {}) => callBackend<T>(API + path, body);

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <section className={`min-w-0 rounded-2xl border border-line bg-panel p-3 text-ink sm:p-4 ${className}`}>{children}</section>;
}
function Btn({ children, onClick, disabled, variant = 'primary', busy, className = '', title, 'aria-label': ariaLabel }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger'; busy?: boolean; className?: string; title?: string; 'aria-label'?: string }) {
    const tone = variant === 'primary' ? 'bg-brand text-onbrand' : variant === 'danger' ? 'border border-red-500/50 text-red-600 dark:text-red-400' : 'border border-line text-ink';
    return <button type='button' title={title} aria-label={ariaLabel} disabled={disabled || busy} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${tone} ${className}`}>{busy && <RefreshCw className='h-4 w-4 animate-spin' />}{children}</button>;
}
function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'brand' | 'warn' | 'danger' }) {
    const t = tone === 'brand' ? 'bg-brand/10 text-brand ring-brand/30' : tone === 'warn' ? 'bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400' : tone === 'danger' ? 'bg-red-500/10 text-red-600 ring-red-500/30 dark:text-red-400' : 'bg-page text-soft ring-line';
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${t}`}>{children}</span>;
}
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'danger' }) {
    return (
        <div className={`min-w-0 rounded-xl border p-3 ${tone === 'danger' ? 'border-red-500/40' : tone === 'warn' ? 'border-amber-500/40' : 'border-line'} bg-page`}>
            <p className='truncate text-xs text-muted'>{label}</p>
            <p className='mt-1 truncate text-lg font-semibold tabular-nums text-ink'>{value}</p>
            {hint && <p className='truncate text-xs text-soft'>{hint}</p>}
        </div>
    );
}
function Select<T extends string>({ label, value, onChange, options, disabled }: { label: string; value: T; onChange: (v: T) => void; options: Array<[T, string]>; disabled?: boolean }) {
    const id = useId();
    return <SelectField id={id} label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>;
}
function Num({ label, value, onChange, disabled, hint, step = 'any' }: { label: string; value: number | string; onChange: (v: string) => void; disabled?: boolean; hint?: string; step?: string }) {
    const id = useId();
    return <Field id={id} label={label} type='number' inputMode='decimal' step={step} value={value} hint={hint} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
    return (
        <div role='dialog' aria-modal='true' aria-label={title} className='fixed inset-0 z-50 flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={onClose}>
            <div className='flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-page sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                <div className='flex items-center justify-between gap-2 border-b border-line p-4'>
                    <h2 className='min-w-0 truncate text-base font-semibold text-ink'>{title}</h2>
                    <button type='button' aria-label='Close' onClick={onClose} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-soft'><X className='h-4 w-4' /></button>
                </div>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4'>{children}</div>
                {footer && <div className='flex flex-wrap gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>{footer}</div>}
            </div>
        </div>
    );
}

/** A short list of options as one-tap choices (a menu) instead of a dropdown. */
function Choice<T extends string>({ label, value, onChange, options, disabled }: { label: string; value: T; onChange: (v: T) => void; options: Array<[T, string]>; disabled?: boolean }) {
    return (
        <div role='radiogroup' aria-label={label} className='min-w-0'>
            <p className='mb-1 text-sm text-soft'>{label}</p>
            <div className='flex flex-wrap gap-1.5'>
                {options.map(([k, l]) => (
                    <button key={k} type='button' role='radio' aria-checked={value === k} disabled={disabled} onClick={() => onChange(k)} className={`min-h-11 rounded-xl px-3 text-sm font-medium disabled:opacity-60 ${value === k ? 'bg-brand text-onbrand' : 'border border-line text-ink hover:bg-page'}`}>{l}</button>
                ))}
            </div>
        </div>
    );
}
function MenuSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section aria-label={title} className='space-y-1'>
            <p className='px-1 text-xs font-semibold uppercase tracking-wide text-muted'>{title}</p>
            <div role='menu' className='space-y-1'>{children}</div>
        </section>
    );
}
function MenuItem({ label, hint, selected, onClick }: { label: string; hint?: string; selected: boolean; onClick: () => void }) {
    return (
        <button type='button' role='menuitemradio' aria-checked={selected} onClick={onClick} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${selected ? 'bg-brand/10 ring-1 ring-brand' : 'hover:bg-page'}`}>
            <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-semibold text-ink'>{label}</span>
                {hint && <span className='block text-xs text-muted'>{hint}</span>}
            </span>
            {selected && <Check className='h-4 w-4 shrink-0 text-brand' />}
        </button>
    );
}

/** The plan's place in the cycle: where it is, what is done and who acts next. */
function Cycle({ steps, status }: { steps: Context['steps']; status: Status }) {
    const order: Status[] = ['draft', 'demand_review', 'supply_planning', 'sop_review', 'approved', 'released'];
    const at = order.indexOf(status === 'superseded' ? 'released' : status);
    return (
        <ol aria-label='Planning cycle' className='flex gap-1 overflow-x-auto pb-1'>
            {steps.map((s, i) => {
                const done = at > i || status === 'released';
                const current = at === i && status !== 'released';
                return (
                    <li key={s.status} aria-current={current ? 'step' : undefined} className={`min-w-[8.5rem] flex-1 rounded-xl border p-2 ${current ? 'border-brand bg-brand/10' : done ? 'border-line bg-panel' : 'border-dashed border-line'}`}>
                        <p className='flex items-center gap-1 text-xs font-semibold text-ink'>{done ? <Check className='h-3.5 w-3.5 text-brand' /> : <span className='text-muted'>{i + 1}</span>} {s.label}</p>
                        {s.role && <p className='mt-0.5 truncate text-xs text-muted'>{s.role}</p>}
                    </li>
                );
            })}
        </ol>
    );
}

/** Per-period bars of planned demand with the statistical forecast and firm orders. */
function DemandChart({ rows, buckets }: { rows: FBucket[]; buckets: Bucket[] }) {
    const max = Math.max(1, ...rows.map((r) => Math.max(r.demand, r.upper ?? 0, r.firm, r.annual)));
    const W = 52;
    const H = 120;
    const width = rows.length * W;
    return (
        <div className='overflow-x-auto'>
            <svg role='img' aria-label='Planned demand per period, with the statistical forecast and firm orders' width={width} height={H + 28} className='text-brand'>
                {rows.map((r, i) => {
                    const h = (r.demand / max) * H;
                    const x = i * W + 6;
                    const st = r.statistical === null ? null : H - (r.statistical / max) * H;
                    const firm = r.firm > 0 ? H - (r.firm / max) * H : null;
                    return (
                        <g key={r.key}>
                            <title>{`${short(buckets[i])}: plan ${fmt(r.demand)} · annual ${fmt(r.annual)} · statistical ${fmt(r.statistical)} · firm ${fmt(r.firm)}`}</title>
                            {r.lower !== null && r.upper !== null && <rect x={x - 2} y={H - (r.upper / max) * H} width={W - 8} height={Math.max(1, ((r.upper - r.lower) / max) * H)} className='fill-current opacity-10' />}
                            <rect x={x} y={H - h} width={W - 12} height={Math.max(r.demand > 0 ? 1 : 0, h)} rx={3} className={`fill-current ${r.fraction === 0 ? 'opacity-20' : r.fraction < 1 ? 'opacity-60' : ''}`} />
                            {st !== null && <circle cx={x + (W - 12) / 2} cy={st} r={3} className='fill-amber-500' />}
                            {firm !== null && <line x1={x - 2} x2={x + W - 10} y1={firm} y2={firm} className='stroke-red-500' strokeWidth={2} />}
                            <text x={x + (W - 12) / 2} y={H + 16} textAnchor='middle' className='fill-current text-xs text-muted'>{short(buckets[i])}</text>
                        </g>
                    );
                })}
            </svg>
            <p className='mt-1 flex flex-wrap gap-3 text-xs text-muted'><span><span className='inline-block h-2 w-2 rounded-sm bg-brand' /> Planned demand</span><span><span className='inline-block h-2 w-2 rounded-full bg-amber-500' /> Statistical</span><span><span className='inline-block h-0.5 w-3 bg-red-500 align-middle' /> Firm orders</span><span>Shaded: 80% band · faded: past or part period</span></p>
        </div>
    );
}

export default function PlnPlanningWorkspace({ onOpenSetup }: { onOpenSetup?: () => void } = {}) {
    const [ctx, setCtx] = useState<Context | null>(null);
    const [siteId, setSiteId] = useState('');
    const [fy, setFy] = useState<number>(0);
    const [plans, setPlans] = useState<Brief[]>([]);
    const [planId, setPlanId] = useState('');
    const [detail, setDetail] = useState<Detail | null>(null);
    const [view, setView] = useState<View>('overview');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState('');
    const [picker, setPicker] = useState(false);
    const confirm = useConfirm();

    const loadContext = async (site = siteId) => {
        const c = await post<Context>('context', site ? { siteId: site } : {});
        setCtx(c);
        setSiteId(c.siteId);
        setFy((f) => (c.years.some((y) => y.fy === f) ? f : c.years[0]?.fy ?? 0));
        return c;
    };
    const loadPlans = async () => setPlans((await post<{ plans: Brief[] }>('plans')).plans);
    const loadPlan = async (id = planId) => {
        if (!id) return setDetail(null);
        setDetail(await post<Detail>('plan/get', { id }));
    };
    useEffect(() => {
        (async () => {
            try {
                await Promise.all([loadContext(), loadPlans()]);
            } catch (e) {
                setError(messageOf(e));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const sitePlans = useMemo(() => plans.filter((p) => p.siteId === siteId && (!fy || p.fy === fy)), [plans, siteId, fy]);
    useEffect(() => {
        const open = sitePlans.find((p) => !['released', 'superseded', 'cancelled'].includes(p.status)) ?? sitePlans[0];
        setPlanId((cur) => (sitePlans.some((p) => p.id === cur) ? cur : open?.id ?? ''));
    }, [sitePlans]);
    useEffect(() => {
        setError('');
        loadPlan(planId).catch((e) => setError(messageOf(e)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planId]);

    const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
        setBusy(key);
        setError('');
        setNotice('');
        try {
            await fn();
            if (done) setNotice(done);
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy('');
        }
    };
    const refresh = async () => {
        await Promise.all([loadPlans(), loadPlan()]);
    };
    const year = ctx?.years.find((y) => y.fy === fy) ?? null;
    const plan = detail?.plan ?? null;
    const can = (a: Action) => !!detail?.actions.includes(a);
    const rev = plan?.revision;

    const decide = (path: string, decision: 'approve' | 'return', title: string, message: string) =>
        confirm.ask(
            { title, message, confirmLabel: decision === 'approve' ? 'Approve' : 'Return', tone: decision === 'return' ? 'danger' : 'primary', reason: decision === 'return' ? { label: 'Reason for returning', minLength: 10 } : { label: 'Comment (optional)', minLength: 0 } },
            async (reason) => {
                await post(path, { id: plan!.id, decision, reason, expectedRevision: rev });
                await refresh();
                setNotice(decision === 'approve' ? 'Approved.' : 'Returned with your reason.');
            }
        );
    const simple = (path: string, title: string, message: string, label: string, opts: { reasonMin?: number; done: string; tone?: 'danger' } = { done: 'Done.' }) =>
        confirm.ask(
            { title, message, confirmLabel: label, tone: opts.tone ?? 'primary', reason: opts.reasonMin ? { label: 'Reason', minLength: opts.reasonMin } : { label: 'Note (optional)', minLength: 0 } },
            async (note) => {
                await post(path, { id: plan!.id, note, reason: note, expectedRevision: rev });
                await refresh();
                setNotice(opts.done);
            }
        );

    if (!ctx) return error ? <Alert tone='error'>{error}</Alert> : <p className='p-6 text-center text-sm text-muted'>Loading the planning workspace…</p>;
    const newPlan = () =>
        confirm.ask({ title: 'New S&OP plan', message: `${year?.label ?? ''} at ${ctx.sites.find((s) => s.id === siteId)?.name ?? ''}: ${year ? `${year.balance.open} of ${year.balance.periods} periods are open (${fmt(year.balance.share * 100)}% of the year).` : ''} The lines of the last released plan are copied.`, confirmLabel: 'Create' }, async () => {
            const r = await post<{ plan: Plan }>('plan/create', { siteId, fy });
            await loadPlans();
            setPlanId(r.plan.id);
            setView('demand');
            setNotice(`Plan ${r.plan.id} created.`);
        });

    const next = (() => {
        if (!plan) return null;
        if (can('run_forecast') && (!plan.forecastRunAt || plan.forecastStale)) return { label: 'Run SKU forecast', Icon: BarChart3, go: () => run('forecast', async () => { await post('plan/forecast', { id: plan.id }); await refresh(); setView('forecast'); }, 'Forecast updated for every SKU.') };
        if (can('submit_demand')) return { label: 'Submit demand for review', Icon: Send, go: () => simple('plan/demand/submit', 'Submit the demand plan', 'An independent Demand Manager reviews it. You cannot change it while it is in review.', 'Submit', { done: 'Submitted for demand review.' }) };
        if (can('approve_demand')) return { label: 'Review demand', Icon: ClipboardCheck, go: () => decide('plan/demand/decide', 'approve', 'Approve the demand plan', 'Approved demand goes to supply planning (unitisation, MRP and capacity).') };
        if (can('run_supply') && !plan.supplyRunAt) return { label: 'Run supply planning', Icon: Layers, go: () => run('supply', async () => { await post('plan/supply/run', { id: plan.id }); await refresh(); setView('mrp'); }, 'Unitisation, MRP and capacity are up to date.') };
        if (can('submit_supply')) return { label: 'Submit to S&OP', Icon: Send, go: () => simple('plan/supply/submit', 'Submit the supply plan', `The planned purchase value of ${fmt(plan.kpis?.purchaseValue, 2)} is routed through the Chart of Authority.`, 'Submit', { done: 'Submitted for executive S&OP approval.' }) };
        if (can('approve_sop')) return { label: 'Approve S&OP level', Icon: ClipboardCheck, go: () => decide('plan/sop/decide', 'approve', 'Approve this S&OP level', 'Your approval is recorded against your Chart of Authority level.') };
        if (can('release')) return { label: 'Release plan', Icon: Rocket, go: () => simple('plan/release', 'Release the plan', 'It becomes the plan of record for this site and financial year; an earlier released plan is superseded.', 'Release', { done: 'Released as the plan of record.' }) };
        return null;
    })();

    return (
        <div className='flex h-[calc(100dvh-13rem)] min-h-[32rem] flex-col gap-2'>
            {confirm.sheet}
            {picker && (
                <Sheet title='Site, financial year and plan' onClose={() => setPicker(false)} footer={<Btn className='ml-auto' onClick={() => setPicker(false)}>Done</Btn>}>
                    <MenuSection title='Site'>
                        {ctx.sites.map((s) => <MenuItem key={s.id} selected={s.id === siteId} label={s.name} onClick={() => run('site', async () => { setPlanId(''); await loadContext(s.id); })} />)}
                        {!ctx.sites.length && <p className='px-1 text-sm text-muted'>You have no planning access at any site.</p>}
                    </MenuSection>
                    <MenuSection title='Financial year'>
                        {ctx.years.map((y) => <MenuItem key={y.fy} selected={y.fy === fy} label={y.label} hint={`${y.start} → ${y.end} · ${y.balance.open} of ${y.balance.periods} periods open · ${y.source === 'finance' ? 'Finance calendar' : y.source === 'settings' ? 'from Finance settings' : 'calendar year (no Finance calendar)'}`} onClick={() => setFy(y.fy)} />)}
                    </MenuSection>
                    <MenuSection title='Plan'>
                        {sitePlans.map((p) => <MenuItem key={p.id} selected={p.id === planId} label={`${p.id} · ${STATUS_LABEL[p.status]}`} hint={`${p.lines} SKUs · updated ${p.updatedAt.slice(0, 10)}${p.createdByName ? ` · by ${p.createdByName}` : ''}`} onClick={() => { setPlanId(p.id); setPicker(false); }} />)}
                        {!sitePlans.length && <p className='px-1 text-sm text-muted'>No plan for this site and year yet.</p>}
                    </MenuSection>
                </Sheet>
            )}
            {/* Action bar: always on top; only the content below scrolls. */}
            <div className='sticky top-0 z-20 space-y-2 rounded-2xl border border-line bg-panel/95 p-2 backdrop-blur sm:p-3'>
                {/* One context button (site · year · plan) opens a menu; new plan and reload stay at hand. */}
                <div className='flex items-center gap-2'>
                    <button type='button' aria-haspopup='menu' aria-expanded={picker} onClick={() => setPicker(true)} className='flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-page px-3 text-left'>
                        <MapPin className='h-4 w-4 shrink-0 text-brand' />
                        <span className='min-w-0 flex-1'>
                            <span className='block truncate text-sm font-semibold text-ink'>{ctx.sites.find((s) => s.id === siteId)?.name ?? 'Choose a site'} · {year?.label ?? 'Financial year'}</span>
                            <span className='block truncate text-xs text-muted'>{plan ? `${plan.id} · ${STATUS_LABEL[plan.status]}` : sitePlans.length ? 'Choose a plan' : 'No plan yet'}{year ? ` · ${year.balance.open} of ${year.balance.periods} periods open` : ''}</span>
                        </span>
                        <ChevronDown className='h-4 w-4 shrink-0 text-muted' />
                    </button>
                    {ctx.can['PLN.demand.plan'] && <Btn aria-label='New plan' title='New plan' className='px-3' busy={busy === 'create'} disabled={!siteId || !fy} onClick={newPlan}><Plus className='h-4 w-4' /><span className='hidden sm:inline'>New plan</span></Btn>}
                    <Btn variant='secondary' aria-label='Reload' title='Reload' className='px-3' busy={busy === 'reload'} onClick={() => run('reload', async () => { await loadContext(); await refresh(); })}><RefreshCw className='h-4 w-4' /></Btn>
                </div>
                {plan && (
                    <div className='flex items-center gap-2'>
                        <Pill tone={plan.status === 'released' ? 'brand' : plan.status === 'cancelled' ? 'danger' : 'warn'}>{STATUS_LABEL[plan.status]}</Pill>
                        <span className='text-xs text-muted'>Rev {plan.revision}</span>
                        {next && <Btn className='ml-auto min-w-0 truncate' busy={busy === 'forecast' || busy === 'supply'} onClick={next.go}><next.Icon className='h-4 w-4' /> {next.label}</Btn>}
                    </div>
                )}
                <nav aria-label='Planning views' className='flex gap-1 overflow-x-auto'>
                    {VIEWS.filter((v) => v.key === 'overview' || plan).map(({ key, label, Icon }) => (
                        <button key={key} type='button' aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm ${view === key ? 'bg-brand text-onbrand' : 'text-soft hover:bg-page'}`}><Icon className='h-4 w-4' />{label}</button>
                    ))}
                </nav>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-6'>
                {error && <Alert tone='error'>{error}</Alert>}
                {notice && <Alert tone='success'>{notice}</Alert>}
                {!plan ? (
                    <Panel className='space-y-3'>
                        <Cycle steps={ctx.steps} status='draft' />
                        <p className='text-sm text-soft'>{ctx.sites.length ? 'No plan for this site and year yet.' : 'You have no planning access at any site.'} A plan takes the annual demand of every SKU for the financial year configured in Finance; part-way through the year only the balance periods are planned.</p>
                        {!ctx.can['PLN.demand.plan'] && <p className='text-xs text-muted'>A Demand Planner creates plans.</p>}
                        {onOpenSetup && <button type='button' onClick={onOpenSetup} className='inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand'><Settings2 className='h-4 w-4' /> Planning rules are in S&OP setup</button>}
                    </Panel>
                ) : view === 'overview' ? (
                    <Overview ctx={ctx} detail={detail!} />
                ) : view === 'demand' ? (
                    <DemandView ctx={ctx} detail={detail!} onSaved={async (t) => { await refresh(); setNotice(t); }} />
                ) : view === 'forecast' ? (
                    <ForecastView detail={detail!} ctx={ctx} onSaved={async (t) => { await refresh(); setNotice(t); }} />
                ) : view === 'unit' ? (
                    <UnitView ctx={ctx} detail={detail!} siteId={siteId} />
                ) : view === 'mrp' ? (
                    <MrpView detail={detail!} />
                ) : view === 'capacity' ? (
                    <CapacityView detail={detail!} />
                ) : (
                    <SopView detail={detail!} can={can} onDecide={(d) => decide('plan/sop/decide', d, d === 'approve' ? 'Approve this S&OP level' : 'Return the plan to supply planning', d === 'approve' ? 'Your approval is recorded against your Chart of Authority level.' : 'Every approval level starts again after the supply planner resubmits.')} onRelease={() => simple('plan/release', 'Release the plan', 'It becomes the plan of record for this site and financial year; an earlier released plan is superseded.', 'Release', { done: 'Released as the plan of record.' })} onReturnDemand={() => decide('plan/demand/decide', 'return', 'Return the demand plan', 'The demand planner revises it and submits again.')} onCancel={() => simple('plan/cancel', 'Cancel the plan', 'The plan is closed and cannot be reopened.', 'Cancel plan', { reasonMin: 10, done: 'Plan cancelled.', tone: 'danger' })} />
                )}
            </div>
        </div>
    );
}

function Overview({ ctx, detail }: { ctx: Context; detail: Detail }) {
    const { plan, supply } = detail;
    const k = plan.kpis;
    const d = plan.demandTotals;
    return (
        <div className='space-y-3'>
            <Panel className='space-y-3'>
                <div className='flex flex-wrap items-baseline justify-between gap-2'>
                    <h2 className='text-base font-semibold'>{plan.id} · {plan.siteName} · {plan.fyLabel}</h2>
                    {plan.copiedFrom && <span className='text-xs text-muted'>Lines copied from {plan.copiedFrom}</span>}
                </div>
                <Cycle steps={ctx.steps} status={plan.status} />
                {plan.status === 'draft' && plan.demandReturnReason && <Alert tone='warn'>Returned by the Demand Manager: {plan.demandReturnReason}</Alert>}
                {plan.status === 'supply_planning' && plan.coa?.returnReason && <Alert tone='warn'>Returned at S&OP: {plan.coa.returnReason}</Alert>}
                {plan.forecastStale && <Alert tone='info'>The demand lines changed: run the SKU forecast again before submitting.</Alert>}
            </Panel>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5'>
                <Stat label='SKUs planned' value={fmt(plan.lines.length)} hint={`${plan.balance?.open ?? 0} open periods`} />
                <Stat label='Annual demand' value={fmt(d?.annual)} hint={`Balance ${fmt(d?.balance)}`} />
                <Stat label='Planned demand' value={fmt(d?.demand)} hint={`Firm orders ${fmt(d?.firm)}`} />
                <Stat label='Planned production' value={fmt(k?.production)} hint={`Unitisation excess ${fmt(k?.unitisationExcess)}`} />
                <Stat label='Planned purchases' value={fmt(k?.purchaseValue, 2)} hint={`${fmt(k?.materials)} materials`} />
                <Stat label='Order now (past due)' value={fmt(k?.pastDue)} tone={k && k.pastDue > 0 ? 'warn' : undefined} hint='Lead time reaches before the plan' />
                <Stat label='Overloaded routings' value={fmt(k?.overloaded)} tone={k && k.overloaded > 0 ? 'danger' : undefined} hint={`Peak ${pct(k?.peakUtilisation)}`} />
                <Stat label='SKUs without BOM' value={fmt(k?.withoutBom)} tone={k && k.withoutBom > 0 ? 'danger' : undefined} />
                <Stat label='Readiness gaps' value={fmt(supply?.readiness.length ?? plan.readinessGaps)} hint='Missing BOM or routing' tone={(supply?.readiness.length ?? 0) > 0 ? 'warn' : undefined} />
                <Stat label='Approval levels' value={plan.coa ? `${plan.coa.steps.filter((s) => s.status === 'approved').length}/${plan.coa.steps.length}` : '—'} hint={plan.coa ? `On ${fmt(plan.coa.amount, 2)}` : 'After supply submission'} />
            </div>
            <Panel>
                <h3 className='mb-2 text-sm font-semibold'>History</h3>
                <ol className='space-y-2'>
                    {plan.history.map((h, i) => (
                        <li key={i} className='flex gap-2 text-sm'>
                            <ChevronRight className='mt-0.5 h-4 w-4 shrink-0 text-muted' />
                            <div className='min-w-0'>
                                <p className='text-ink'><span className='font-medium'>{h.action.replace(/[._]/g, ' ')}</span> · {h.byName}</p>
                                <p className='text-xs text-muted'>{new Date(h.at).toLocaleString()}{h.note ? ` · ${h.note}` : ''}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </Panel>
        </div>
    );
}

/** Annual demand per SKU: what the quantity covers, seasonality and forecast basis. Draft plans only. */
function DemandView({ ctx, detail, onSaved }: { ctx: Context; detail: Detail; onSaved: (t: string) => Promise<void> }) {
    const { plan } = detail;
    const editable = detail.actions.includes('edit_demand');
    const [lines, setLines] = useState<Line[]>(() => plan.lines.map((l) => ({ ...l })));
    const [picking, setPicking] = useState(false);
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => setLines(plan.lines.map((l) => ({ ...l }))), [plan.id, plan.revision]); // eslint-disable-line react-hooks/exhaustive-deps
    const sku = (id: string) => ctx.skus.find((s) => s.id === id);
    const dirty = JSON.stringify(lines) !== JSON.stringify(plan.lines);
    const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    const fresh = (skuId: string): Line => ({ skuId, annualQty: '', annualBasis: ctx.setup.defaultAnnualBasis, profile: ctx.setup.defaultProfile, forecastBasis: ctx.setup.defaultForecastBasis, blendPct: ctx.setup.blendPct, overrides: {}, note: '' });
    const verify = () => {
        const e: Record<string, string> = {};
        for (const l of lines) {
            const q = Number(l.annualQty);
            if (l.annualQty === '' || !Number.isFinite(q) || q < 0) e[l.skuId] = 'Enter the annual quantity (0 or more).';
            else if (sku(l.skuId)?.whole && !Number.isInteger(q)) e[l.skuId] = `${sku(l.skuId)?.uom} is a whole unit: enter a whole number.`;
            const b = Number(l.blendPct);
            if (l.forecastBasis === 'BLENDED' && (!Number.isFinite(b) || b < 0 || b > 100)) e[l.skuId] = 'The statistical weight must be 0 to 100%.';
        }
        setErrors(e);
        return !Object.keys(e).length;
    };
    const save = async () => {
        if (!verify()) return setError('Fix the highlighted lines.');
        setBusy(true);
        setError('');
        try {
            await post('plan/lines/save', { id: plan.id, expectedRevision: plan.revision, lines: lines.map((l) => ({ ...l, annualQty: Number(l.annualQty), blendPct: Number(l.blendPct) })) });
            await onSaved('Annual demand saved. Run the SKU forecast to update the plan.');
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const available = ctx.skus.filter((s) => !lines.some((l) => l.skuId === s.id) && `${s.id} ${s.name}`.toLowerCase().includes(query.trim().toLowerCase()));
    const total = lines.reduce((t, l) => t + (Number(l.annualQty) || 0), 0);
    const columns: Array<Column<Line>> = [
        { key: 'sku', label: 'SKU', value: (l) => `${l.skuId} ${sku(l.skuId)?.name ?? ''}`, render: (l) => <span><span className='font-mono text-xs'>{l.skuId}</span><br />{sku(l.skuId)?.name}</span> },
        { key: 'cat', label: 'Category', value: (l) => sku(l.skuId)?.category ?? '' },
        { key: 'annual', label: 'Annual qty', type: 'number', value: (l) => Number(l.annualQty) || 0 },
        { key: 'uom', label: 'UoM', value: (l) => sku(l.skuId)?.uom ?? '' },
        { key: 'covers', label: 'Covers', value: (l) => (l.annualBasis === 'FULL_YEAR' ? 'Full year' : 'Balance only') },
        { key: 'profile', label: 'Seasonality', value: (l) => PROFILE_LABEL[l.profile] },
        { key: 'basis', label: 'Forecast basis', value: (l) => BASIS_LABEL[l.forecastBasis] + (l.forecastBasis === 'BLENDED' ? ` ${l.blendPct}%` : '') },
        { key: 'overrides', label: 'Overrides', type: 'number', value: (l) => Object.keys(l.overrides ?? {}).length },
    ];
    if (!editable) return (
        <div className='space-y-2'>
            <Alert tone='info'>The demand plan is {STATUS_LABEL[plan.status].toLowerCase()}: it can only be changed in demand planning by a Demand Planner.</Alert>
            <RichTable id='pln.sop.lines' title='Annual demand' fileName={`${plan.id}_annual_demand`} columns={columns} rows={plan.lines} rowKey={(l) => l.skuId} height='h-[calc(100dvh-24rem)]' />
        </div>
    );
    return (
        <div className='space-y-3'>
            <Panel className='space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                    <p className='min-w-0 flex-1 text-sm text-soft'>{lines.length} SKUs · {fmt(total)} annual units. A full-year quantity plans only the share of the open periods ({fmt((plan.balance?.share ?? 1) * 100)}% of the year); a balance quantity is spread over the open periods only.</p>
                    <Btn variant='secondary' onClick={() => { setChosen(new Set()); setPicking(true); }}><Plus className='h-4 w-4' /> Add SKUs</Btn>
                    <Btn busy={busy} disabled={!dirty} onClick={save}><Check className='h-4 w-4' /> Save</Btn>
                </div>
                {error && <Alert tone='error'>{error}</Alert>}
            </Panel>
            {!lines.length && <Panel><p className='text-sm text-soft'>Add the finished and intermediate SKUs this site makes, with their annual quantity.</p></Panel>}
            <ul className='space-y-2'>
                {lines.map((l, i) => (
                    <li key={l.skuId}>
                        <Panel className={`space-y-2 ${errors[l.skuId] ? 'border-red-500/60' : ''}`}>
                            <div className='flex items-start justify-between gap-2'>
                                <div className='min-w-0'>
                                    <p className='font-mono text-xs text-muted'>{l.skuId} · {sku(l.skuId)?.category}</p>
                                    <p className='truncate text-sm font-semibold'>{sku(l.skuId)?.name ?? 'Unknown SKU'}</p>
                                </div>
                                <button type='button' aria-label={`Remove ${l.skuId}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft'><Trash2 className='h-4 w-4' /></button>
                            </div>
                            <div className='grid grid-cols-2 gap-2 lg:grid-cols-5'>
                                <Num label={`Annual quantity (${sku(l.skuId)?.uom ?? ''})`} value={l.annualQty} step={sku(l.skuId)?.whole ? '1' : 'any'} onChange={(v) => set(i, { annualQty: v })} />
                                <Select label='Quantity covers' value={l.annualBasis} onChange={(v) => set(i, { annualBasis: v })} options={[['FULL_YEAR', 'The full financial year'], ['BALANCE', 'Only the balance periods']]} />
                                <Select label='Seasonality' value={l.profile} onChange={(v) => set(i, { profile: v })} options={(Object.keys(PROFILE_LABEL) as Profile[]).map((p) => [p, PROFILE_LABEL[p]])} />
                                <Select label='Forecast basis' value={l.forecastBasis} onChange={(v) => set(i, { forecastBasis: v })} options={(Object.keys(BASIS_LABEL) as Basis[]).map((b) => [b, BASIS_LABEL[b]])} />
                                {l.forecastBasis === 'BLENDED' && <Num label='Statistical weight %' value={l.blendPct} onChange={(v) => set(i, { blendPct: v })} />}
                            </div>
                            {errors[l.skuId] && <p className='text-xs text-red-600 dark:text-red-400'>{errors[l.skuId]}</p>}
                        </Panel>
                    </li>
                ))}
            </ul>
            {picking && (
                <Sheet title='Add SKUs to the plan' onClose={() => setPicking(false)} footer={<><Btn variant='secondary' onClick={() => setChosen(new Set(available.map((s) => s.id)))}>Select all shown</Btn><Btn className='ml-auto' disabled={!chosen.size} onClick={() => { setLines((ls) => [...ls, ...[...chosen].map(fresh)]); setPicking(false); }}>Add {chosen.size || ''}</Btn></>}>
                    <SearchField label='Search SKUs' value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Code or name' />
                    <ul className='divide-y divide-line rounded-xl border border-line'>
                        {available.map((s) => (
                            <li key={s.id}>
                                <label className='flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2'>
                                    <input type='checkbox' className='h-5 w-5' checked={chosen.has(s.id)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                                    <span className='min-w-0'><span className='block truncate text-sm text-ink'>{s.name}</span><span className='block font-mono text-xs text-muted'>{s.id} · {s.category} · {s.uom}</span></span>
                                </label>
                            </li>
                        ))}
                        {!available.length && <li className='p-3 text-sm text-muted'>No more SKUs.</li>}
                    </ul>
                </Sheet>
            )}
        </div>
    );
}

function ForecastView({ detail, ctx, onSaved }: { detail: Detail; ctx: Context; onSaved: (t: string) => Promise<void> }) {
    const { plan, forecast } = detail;
    const [open, setOpen] = useState<Forecast | null>(null);
    const name = (id: string) => ctx.skus.find((s) => s.id === id)?.name ?? id;
    const columns: Array<Column<Forecast>> = [
        { key: 'sku', label: 'SKU', value: (f) => `${f.skuId} ${name(f.skuId)}`, render: (f) => <span><span className='font-mono text-xs'>{f.skuId}</span><br />{name(f.skuId)}</span> },
        { key: 'annual', label: 'Annual', type: 'number', value: (f) => f.totals.annual },
        { key: 'balance', label: 'Balance plan', type: 'number', value: (f) => f.totals.balance },
        { key: 'stat', label: 'Statistical', type: 'number', value: (f) => f.totals.statistical },
        { key: 'firm', label: 'Firm orders', type: 'number', value: (f) => f.totals.firm },
        { key: 'demand', label: 'Planned demand', type: 'number', value: (f) => f.totals.demand },
        { key: 'basis', label: 'Basis', value: (f) => BASIS_LABEL[f.effectiveBasis] + (f.effectiveBasis !== f.basis ? ` (asked ${BASIS_LABEL[f.basis]})` : '') },
        { key: 'method', label: 'Method', value: (f) => f.stat?.method ?? '' },
        { key: 'mase', label: 'MASE', type: 'number', value: (f) => f.stat?.mase ?? null },
        { key: 'pattern', label: 'Pattern', value: (f) => f.stat?.pattern ?? '' },
        { key: 'trend', label: 'Trend', value: (f) => f.stat?.trend ?? '', hidden: true },
        { key: 'history', label: 'History months', type: 'number', value: (f) => f.stat?.historyMonths ?? 0, hidden: true },
        ...plan.buckets.filter((b) => b.fraction > 0).map((b) => ({ key: `b_${b.key}`, label: short(b), type: 'number' as const, value: (f: Forecast) => f.buckets.find((x) => x.key === b.key)?.demand ?? 0, hidden: true })),
    ];
    if (!plan.forecastRunAt) return <Panel><p className='text-sm text-soft'>Run the SKU forecast from the action bar once the annual demand is saved.</p></Panel>;
    return (
        <div className='space-y-2'>
            {plan.forecastStale && <Alert tone='info'>The demand lines changed after this forecast: run it again.</Alert>}
            <p className='text-xs text-muted'>Forecast {new Date(plan.forecastRunAt).toLocaleString()} · statistical methods from confirmed-order history (SMA, WMA, SES, Holt, regression, Croston, TSB ranked by MASE). Firm orders consume the forecast. Open a SKU for its periods and overrides.</p>
            <RichTable id='pln.sop.forecast' title='SKU forecast' fileName={`${plan.id}_sku_forecast`} columns={columns} rows={forecast} rowKey={(f) => f.skuId} onRowClick={setOpen} height='h-[calc(100dvh-24rem)]' />
            {open && <ForecastSheet f={open} plan={plan} name={name(open.skuId)} editable={detail.actions.includes('edit_demand')} onClose={() => setOpen(null)} onSaved={async (t) => { setOpen(null); await onSaved(t); }} />}
        </div>
    );
}

function ForecastSheet({ f, plan, name, editable, onClose, onSaved }: { f: Forecast; plan: Plan; name: string; editable: boolean; onClose: () => void; onSaved: (t: string) => Promise<void> }) {
    const line = plan.lines.find((l) => l.skuId === f.skuId);
    const [edits, setEdits] = useState<Record<string, { qty: string; reason: string }>>(() => Object.fromEntries(Object.entries(line?.overrides ?? {}).map(([k, o]) => [k, { qty: String(o.qty), reason: o.reason }])));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async () => {
        const overrides: Record<string, { qty: number; reason: string }> = {};
        for (const [k, e] of Object.entries(edits)) {
            if (e.qty === '') continue;
            const q = Number(e.qty);
            if (!Number.isFinite(q) || q < 0) return setError(`${k}: enter a quantity of 0 or more.`);
            if (f.whole && !Number.isInteger(q)) return setError(`${k}: ${f.uom} is a whole unit.`);
            if (e.reason.trim().length < 5) return setError(`${k}: give a reason of at least 5 characters.`);
            overrides[k] = { qty: q, reason: e.reason.trim() };
        }
        setBusy(true);
        setError('');
        try {
            await post('plan/lines/save', { id: plan.id, expectedRevision: plan.revision, lines: plan.lines.map((l) => (l.skuId === f.skuId ? { ...l, overrides } : l)) });
            await onSaved('Overrides saved. Run the SKU forecast again to apply them.');
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Sheet title={`${f.skuId} · ${name}`} onClose={onClose} footer={editable ? <Btn className='ml-auto' busy={busy} onClick={save}><Check className='h-4 w-4' /> Save overrides</Btn> : undefined}>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat label='Balance plan' value={fmt(f.totals.balance)} hint={`Annual ${fmt(f.totals.annual)}`} />
                <Stat label='Statistical' value={fmt(f.totals.statistical)} hint={f.stat ? `${f.stat.method} · MASE ${fmt(f.stat.mase, 2)}` : 'Not enough history'} />
                <Stat label='Firm orders' value={fmt(f.totals.firm)} />
                <Stat label='Planned demand' value={fmt(f.totals.demand)} hint={BASIS_LABEL[f.effectiveBasis]} />
            </div>
            <DemandChart rows={f.buckets} buckets={plan.buckets} />
            {f.notes.map((n) => <p key={n} className='text-xs text-soft'>• {n}</p>)}
            <div className='overflow-x-auto rounded-xl border border-line'>
                <table className='w-full min-w-[40rem] text-sm'>
                    <thead className='bg-panel text-xs text-muted'><tr>{['Period', 'Open', 'Annual', 'Statistical', 'Firm', 'Consensus', 'Planned', 'Override'].map((h) => <th key={h} className='px-2 py-2 text-right font-normal first:text-left'>{h}</th>)}</tr></thead>
                    <tbody>
                        {f.buckets.map((b, i) => (
                            <tr key={b.key} className={`border-t border-line ${b.fraction === 0 ? 'text-muted' : ''}`}>
                                <td className='px-2 py-1.5'>{short(plan.buckets[i])}</td>
                                <td className='px-2 text-right tabular-nums'>{fmt(b.fraction * 100)}%</td>
                                <td className='px-2 text-right tabular-nums'>{fmt(b.annual)}</td>
                                <td className='px-2 text-right tabular-nums'>{fmt(b.statistical)}</td>
                                <td className='px-2 text-right tabular-nums'>{fmt(b.firm)}</td>
                                <td className='px-2 text-right tabular-nums'>{fmt(b.consensus)}</td>
                                <td className='px-2 text-right font-semibold tabular-nums'>{fmt(b.demand)}</td>
                                <td className='px-2 py-1 text-right'>
                                    {editable && b.fraction > 0 ? (
                                        <Field id={`ovr_${b.key}`} label={`Override ${short(plan.buckets[i])}`} hideLabel type='number' min={0} step={f.whole ? 1 : 'any'} inputMode='decimal' className='w-28' value={edits[b.key]?.qty ?? ''} onChange={(e) => setEdits((x) => ({ ...x, [b.key]: { qty: e.target.value, reason: x[b.key]?.reason ?? '' } }))} />
                                    ) : fmt(b.override)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {editable && Object.entries(edits).filter(([, e]) => e.qty !== '').map(([k, e]) => (
                <TextArea key={k} id={`reason_${k}`} label={`Reason for the ${k} override`} rows={2} value={e.reason} onChange={(ev) => setEdits((x) => ({ ...x, [k]: { ...x[k], reason: ev.target.value } }))} />
            ))}
            {error && <Alert tone='error'>{error}</Alert>}
        </Sheet>
    );
}

function UnitView({ ctx, detail, siteId }: { ctx: Context; detail: Detail; siteId: string }) {
    const [open, setOpen] = useState<UnitRow | null>(null);
    const [sku, setSku] = useState('');
    const [qty, setQty] = useState('');
    const [whatIf, setWhatIf] = useState<{ unit: Unit | null; bom: { id: string; name: string } | null; check: { qty: number; lots: number; excess: number } | null; message?: string } | null>(null);
    const [error, setError] = useState('');
    const rows = detail.supply?.units ?? [];
    const columns: Array<Column<UnitRow>> = [
        { key: 'sku', label: 'SKU', value: (r) => `${r.skuId} ${r.name}`, render: (r) => <span><span className='font-mono text-xs'>{r.skuId}</span><br />{r.name}</span> },
        { key: 'bom', label: 'BOM', value: (r) => r.bomId || 'None effective' },
        { key: 'min', label: 'Minimal batch', type: 'number', value: (r) => r.unit?.minimalBatch ?? null },
        { key: 'exact', label: 'Exact (no tolerance)', type: 'number', value: (r) => r.unit?.exactBatch ?? null },
        { key: 'vessel', label: 'Process batch', type: 'number', value: (r) => r.unit?.processBatch ?? null },
        { key: 'lot', label: 'Planning lot', type: 'number', value: (r) => r.unit?.lot ?? null },
        { key: 'uom', label: 'UoM', value: (r) => r.unit?.outputUom ?? r.uom },
        { key: 'indiv', label: 'Indivisible lines', type: 'number', value: (r) => r.unit?.lines.filter((l) => l.indivisible).length ?? 0 },
        { key: 'routing', label: 'Routing', value: (r) => r.routingName || 'None effective' },
    ];
    const tryIt = async () => {
        if (!sku) return setError('Choose a SKU.');
        if (qty !== '' && !(Number(qty) > 0)) return setError('The quantity must be above zero.');
        setError('');
        try {
            setWhatIf(await post('unitise', { siteId, skuId: sku, quantity: qty === '' ? 0 : Number(qty) }));
        } catch (e) {
            setError(messageOf(e));
        }
    };
    return (
        <div className='space-y-3'>
            <details open={!detail.supply} className='group min-w-0 rounded-2xl border border-line bg-panel p-3 text-ink sm:p-4'>
                <summary className='flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold'><ChevronRight className='h-4 w-4 transition-transform group-open:rotate-90' /> What-if unitisation</summary>
                <div className='mt-2 space-y-2'>
                <p className='text-xs text-soft'>The smallest batch that keeps every indivisible component whole (pieces, bags, drums and the packs listed in Setup). Production is planned in multiples of it.</p>
                <div className='grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto]'>
                    <Select label='SKU' value={sku} onChange={setSku} options={[['', 'Choose a SKU'], ...ctx.skus.map((s) => [s.id, `${s.name} (${s.id})`] as [string, string])]} />
                    <Num label='Quantity to check' value={qty} onChange={setQty} />
                    <div className='flex items-end'><Btn className='w-full' onClick={tryIt}>Check</Btn></div>
                </div>
                {error && <Alert tone='error'>{error}</Alert>}
                {whatIf && (whatIf.unit ? <UnitDetail unit={whatIf.unit} check={whatIf.check} title={whatIf.bom ? `${whatIf.bom.id} · ${whatIf.bom.name}` : ''} /> : <Alert tone='warn'>{whatIf.message}</Alert>)}
                </div>
            </details>
            {detail.supply ? <RichTable id='pln.sop.units' title='Unitisation by SKU' fileName={`${detail.plan.id}_unitisation`} columns={columns} rows={rows} rowKey={(r) => r.skuId} onRowClick={setOpen} height='h-[calc(100dvh-30rem)]' /> : <Panel><p className='text-sm text-soft'>Unitisation by SKU appears after supply planning runs.</p></Panel>}
            {open && <Sheet title={`${open.skuId} · ${open.name}`} onClose={() => setOpen(null)}>{open.unit ? <UnitDetail unit={open.unit} check={null} title={`${open.bomId} · ${open.bomName}`} /> : <Alert tone='warn'>No approved BOM is effective for this SKU at this site.</Alert>}</Sheet>}
        </div>
    );
}
function UnitDetail({ unit, check, title }: { unit: Unit; check: { qty: number; lots: number; excess: number } | null; title: string }) {
    return (
        <div className='space-y-2'>
            {title && <p className='text-xs text-muted'>{title}</p>}
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat label='Minimal batch' value={`${fmt(unit.minimalBatch, 3)} ${unit.outputUom}`} hint={unit.exactBatch !== unit.minimalBatch ? `Exact ${fmt(unit.exactBatch)}` : 'Exact'} />
                <Stat label='Planning lot' value={`${fmt(unit.lot, 3)} ${unit.outputUom}`} />
                <Stat label='Process batch' value={unit.processBatch ? fmt(unit.processBatch, 3) : '—'} />
                {check && <Stat label='Planned for the check' value={`${fmt(check.qty, 3)}`} hint={`${check.lots} lots · excess ${fmt(check.excess, 3)}`} />}
            </div>
            {unit.notes.map((n) => <p key={n} className='text-xs text-soft'>• {n}</p>)}
            <div className='overflow-x-auto rounded-xl border border-line'>
                <table className='w-full min-w-[36rem] text-sm'>
                    <thead className='bg-panel text-xs text-muted'><tr>{['Component', 'Per output', 'In minimal batch', 'Whole packs', 'Rounding', 'Rule'].map((h) => <th key={h} className='px-2 py-2 text-left font-normal'>{h}</th>)}</tr></thead>
                    <tbody>
                        {unit.lines.map((l) => (
                            <tr key={l.line} className='border-t border-line'>
                                <td className='px-2 py-1.5 font-mono text-xs'>{l.key}</td>
                                <td className='px-2 tabular-nums'>{fmt(l.perOutput, 6)} {l.uom}</td>
                                <td className='px-2 tabular-nums'>{fmt(l.batchQty, 3)} {l.uom}</td>
                                <td className='px-2 tabular-nums'>{l.packs === null ? '—' : fmt(l.packs)}</td>
                                <td className='px-2 tabular-nums'>{l.deviationPct ? `${fmt(l.deviationPct, 2)}%` : '—'}</td>
                                <td className='px-2 text-xs'>{l.indivisible ? <Pill tone='warn'>Indivisible</Pill> : <Pill>Divisible</Pill>} <span className='text-muted'>{l.why}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function BucketTable({ rows, buckets, cols }: { rows: Array<Record<string, number | string>>; buckets: Bucket[]; cols: Array<[string, string]> }) {
    return (
        <div className='overflow-x-auto rounded-xl border border-line'>
            <table className='w-full text-sm'>
                <thead className='bg-panel text-xs text-muted'><tr><th className='px-2 py-2 text-left font-normal'>Row</th>{buckets.map((b) => <th key={b.key} className={`px-2 py-2 text-right font-normal ${b.fraction === 0 ? 'opacity-50' : ''}`}>{short(b)}</th>)}</tr></thead>
                <tbody>
                    {cols.map(([k, label]) => (
                        <tr key={k} className='border-t border-line'>
                            <td className='whitespace-nowrap px-2 py-1.5 text-soft'>{label}</td>
                            {rows.map((r, i) => <td key={i} className='px-2 text-right tabular-nums'>{typeof r[k] === 'number' ? fmt(r[k] as number, 2) : r[k]}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function MrpView({ detail }: { detail: Detail }) {
    const [open, setOpen] = useState<MrpItem | null>(null);
    const s = detail.supply;
    if (!s) return <Panel><p className='text-sm text-soft'>MRP runs in supply planning, after the demand plan is approved.</p></Panel>;
    const columns: Array<Column<MrpItem>> = [
        { key: 'kind', label: 'Type', value: (i) => (i.kind === 'sku' ? 'Make' : i.kind === 'material' ? 'Buy' : 'Utility') },
        { key: 'item', label: 'Item', value: (i) => `${i.id} ${i.name}`, render: (i) => <span><span className='font-mono text-xs'>{i.id}</span><br />{i.name}</span> },
        { key: 'wh', label: 'Warehouse', value: (i) => i.warehouseId },
        { key: 'level', label: 'Level', type: 'number', value: (i) => i.level },
        { key: 'gross', label: 'Gross requirement', type: 'number', value: (i) => i.totals.gross },
        { key: 'receipts', label: 'Planned receipts', type: 'number', value: (i) => i.totals.receipts },
        { key: 'uom', label: 'UoM', value: (i) => i.uom },
        { key: 'value', label: 'Planned value', type: 'number', value: (i) => i.totals.value },
        { key: 'pastDue', label: 'Order now', type: 'number', value: (i) => i.pastDue },
        { key: 'lot', label: 'Lot / multiple', type: 'number', value: (i) => i.lot, hidden: true },
        { key: 'lead', label: 'Lead (periods)', type: 'number', value: (i) => i.leadBuckets },
        { key: 'excess', label: 'Ending stock', type: 'number', value: (i) => i.totals.excess, hidden: true },
        { key: 'parents', label: 'Used by', value: (i) => i.parents.join(', '), hidden: true },
        { key: 'notes', label: 'Notes', value: (i) => i.notes.join(' '), hidden: true },
    ];
    return (
        <div className='space-y-2'>
            {s.mrp.issues.map((x) => <Alert key={x} tone='warn'>{x}</Alert>)}
            {s.mrp.truncated && <Alert tone='info'>Only the first 1,500 items are shown.</Alert>}
            <p className='text-xs text-muted'>Multi-level explosion with scrap, netted against available stock less safety stock and open supply; made items in whole planning lots, bought items at MOQ and order multiples, released a lead time earlier. Open an item for its periods.</p>
            <RichTable id='pln.sop.mrp' title='MRP requirements' fileName={`${detail.plan.id}_mrp`} columns={columns} rows={s.mrp.items} rowKey={(i) => i.key} onRowClick={setOpen} height='h-[calc(100dvh-24rem)]' />
            {open && (
                <Sheet title={`${open.kind === 'sku' ? 'Make' : open.kind === 'material' ? 'Buy' : 'Utility'} · ${open.name}`} onClose={() => setOpen(null)}>
                    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                        <Stat label='Gross' value={`${fmt(open.totals.gross, 2)} ${open.uom}`} />
                        <Stat label='Planned receipts' value={fmt(open.totals.receipts, 2)} />
                        <Stat label='Value' value={fmt(open.totals.value, 2)} hint={open.unitCost ? `@ ${fmt(open.unitCost, 2)}` : undefined} />
                        <Stat label='Order now' value={fmt(open.pastDue, 2)} tone={open.pastDue > 0 ? 'warn' : undefined} />
                    </div>
                    {open.notes.map((n) => <p key={n} className='text-xs text-soft'>• {n}</p>)}
                    {open.parents.length > 0 && <p className='text-xs text-muted'>Used by {open.parents.join(', ')}</p>}
                    <BucketTable rows={open.rows as unknown as Array<Record<string, number>>} buckets={detail.plan.buckets} cols={[['gross', 'Gross requirement'], ['scheduled', 'Open supply'], ['net', 'Net requirement'], ['receipt', 'Planned receipt'], ['release', 'Planned release'], ['projected', 'Projected stock']]} />
                </Sheet>
            )}
        </div>
    );
}

function CapacityView({ detail }: { detail: Detail }) {
    const [open, setOpen] = useState<CapRow | null>(null);
    const s = detail.supply;
    if (!s) return <Panel><p className='text-sm text-soft'>Rough-cut capacity runs with supply planning.</p></Panel>;
    const columns: Array<Column<CapRow>> = [
        { key: 'routing', label: 'Routing', value: (r) => `${r.routingId} ${r.name}`, render: (r) => <span><span className='font-mono text-xs'>{r.routingId}</span><br />{r.name}</span> },
        { key: 'rate', label: 'Rate / hour', type: 'number', value: (r) => r.ratePerHour },
        { key: 'bottleneck', label: 'Bottleneck', value: (r) => r.bottleneck },
        { key: 'peak', label: 'Peak utilisation %', type: 'number', value: (r) => r.peak, render: (r) => <span className={r.overloaded.length ? 'font-semibold text-red-600 dark:text-red-400' : ''}>{pct(r.peak)}</span> },
        { key: 'over', label: 'Overloaded periods', value: (r) => r.overloaded.join(', ') },
        { key: 'skus', label: 'SKUs', value: (r) => r.skus.join(', '), hidden: true },
    ];
    return (
        <div className='space-y-2'>
            <p className='text-xs text-muted'>Required hours = planned production ÷ bottleneck rate + set-ups per process run; available = days × working days × hours × OEE (Setup).</p>
            <RichTable id='pln.sop.capacity' title='Rough-cut capacity' fileName={`${detail.plan.id}_capacity`} columns={columns} rows={s.capacity} rowKey={(r) => r.routingId} onRowClick={setOpen} height='h-[calc(100dvh-24rem)]' empty='No effective routing for the planned SKUs.' />
            {open && <Sheet title={open.name} onClose={() => setOpen(null)}><BucketTable rows={open.buckets.map((b) => ({ ...b, utilisation: b.utilisation ?? '—' }))} buckets={detail.plan.buckets} cols={[['required', 'Required hours'], ['available', 'Available hours'], ['utilisation', 'Utilisation %'], ['runs', 'Process runs']]} /></Sheet>}
        </div>
    );
}

function SopView({ detail, can, onDecide, onRelease, onReturnDemand, onCancel }: { detail: Detail; can: (a: Action) => boolean; onDecide: (d: 'approve' | 'return') => void; onRelease: () => void; onReturnDemand: () => void; onCancel: () => void }) {
    const { plan, supply } = detail;
    const fam = supply?.sop.families ?? [];
    return (
        <div className='space-y-3'>
            <Panel className='space-y-2'>
                <h3 className='text-sm font-semibold'>Decisions</h3>
                <div className='flex flex-wrap gap-2'>
                    {can('approve_sop') && <Btn onClick={() => onDecide('approve')}><Check className='h-4 w-4' /> Approve level</Btn>}
                    {can('return_sop') && <Btn variant='secondary' onClick={() => onDecide('return')}><Undo2 className='h-4 w-4' /> Return to supply planning</Btn>}
                    {can('return_demand') && <Btn variant='secondary' onClick={onReturnDemand}><Undo2 className='h-4 w-4' /> Return demand</Btn>}
                    {can('release') && <Btn onClick={onRelease}><Rocket className='h-4 w-4' /> Release</Btn>}
                    {can('cancel') && <Btn variant='danger' onClick={onCancel}><X className='h-4 w-4' /> Cancel plan</Btn>}
                    {!['approve_sop', 'return_sop', 'return_demand', 'release', 'cancel'].some((a) => can(a as Action)) && <p className='text-sm text-muted'>Nothing for you to decide at this stage.</p>}
                </div>
            </Panel>
            <Panel>
                <h3 className='mb-2 text-sm font-semibold'>Chart of Authority</h3>
                {plan.coa ? (
                    <ol className='space-y-2'>
                        <li className='text-xs text-muted'>Planned purchase value {fmt(plan.coa.amount, 2)}</li>
                        {plan.coa.steps.map((s) => (
                            <li key={s.level} className='flex items-start gap-2 rounded-xl border border-line p-2'>
                                {s.status === 'approved' ? <Check className='mt-0.5 h-4 w-4 text-brand' /> : <span className='mt-0.5 h-4 w-4 rounded-full border border-line' />}
                                <div className='min-w-0 text-sm'>
                                    <p className='font-medium text-ink'>{s.level} · {s.title}</p>
                                    <p className='text-xs text-muted'>{s.positionTitle}{s.status === 'approved' ? ` · ${s.byName} · ${new Date(s.at).toLocaleString()}` : ' · pending'}{s.note ? ` · ${s.note}` : ''}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                ) : <p className='text-sm text-muted'>Approval levels are set when the supply plan is submitted.</p>}
            </Panel>
            {supply && (
                <Panel className='space-y-3'>
                    <h3 className='text-sm font-semibold'>S&OP by family</h3>
                    {fam.map((f) => (
                        <div key={f.family} className='space-y-1'>
                            <p className='text-xs font-medium text-soft'>{f.family} · {f.skus} SKU{f.skus === 1 ? '' : 's'}</p>
                            <BucketTable rows={f.buckets} buckets={plan.buckets} cols={[['demand', 'Demand'], ['production', 'Production'], ['inventory', 'Projected inventory']]} />
                        </div>
                    ))}
                    <div className='space-y-1'>
                        <p className='text-xs font-medium text-soft'>Planned purchases (value)</p>
                        <BucketTable rows={supply.sop.purchaseByBucket.map((v) => ({ v }))} buckets={plan.buckets} cols={[['v', 'Purchase value']]} />
                    </div>
                </Panel>
            )}
        </div>
    );
}

/** Planning setup (organization-wide, PLN.configure in the person's own role, reason required, versioned). */
function SetupView({ ctx, onSaved }: { ctx: Context; onSaved: (t: string) => Promise<void> }) {
    const editable = !!ctx.can['PLN.configure'];
    const [s, setS] = useState<Setup>(ctx.setup);
    const [uoms, setUoms] = useState(ctx.setup.discreteUoms.join(', '));
    const [materials, setMaterials] = useState<Array<{ id: string; name: string; materialNumber: string; uom: string }>>([]);
    const [error, setError] = useState('');
    const confirm = useConfirm();
    useEffect(() => {
        setS(ctx.setup);
        setUoms(ctx.setup.discreteUoms.join(', '));
    }, [ctx.setup]);
    useEffect(() => {
        if (!editable) return;
        callBackend<{ materials: typeof materials }>('/api/org/pln-mfg/foundation/references').then((r) => setMaterials(r.materials ?? [])).catch(() => setMaterials([]));
    }, [editable]);
    const n = (k: keyof Setup) => (v: string) => setS((x) => ({ ...x, [k]: v === '' ? '' : Number(v) }) as Setup);
    const keyOptions: Array<[string, string]> = [['', 'Choose a component'], ...ctx.skus.map((k) => [`SKU:${k.id}`, `SKU · ${k.name} (${k.id})`] as [string, string]), ...materials.map((m) => [`MAT:${m.id}`, `Material · ${m.materialNumber || m.id} ${m.name} (${m.uom})`] as [string, string])];
    const verify = (): string => {
        const nums: Array<[keyof Setup, number, number]> = [['blendPct', 0, 100], ['historyMonths', 6, 36], ['unitTolerancePct', 0, 10], ['hoursPerDay', 1, 24], ['workingDaysPerWeek', 1, 7], ['oeePct', 10, 100], ['overloadPct', 50, 200]];
        for (const [k, lo, hi] of nums) { const v = Number(s[k]); if (!Number.isFinite(v) || v < lo || v > hi) return `${k}: enter ${lo} to ${hi}.`; }
        if (s.defaultProfile === 'CUSTOM' && s.customProfile.reduce((a, b) => a + Number(b || 0), 0) <= 0) return 'The custom seasonality needs at least one month above zero.';
        for (const [i, x] of s.indivisible.entries()) { if (!x.key) return `Indivisible line ${i + 1}: choose a component.`; if (!(Number(x.packSize) > 0)) return `Indivisible line ${i + 1}: the pack size must be above zero.`; }
        if (new Set(s.indivisible.map((x) => x.key)).size !== s.indivisible.length) return 'A component is listed twice as indivisible.';
        return '';
    };
    const save = () => {
        const why = verify();
        if (why) return setError(why);
        setError('');
        confirm.ask({ title: 'Save the planning setup', message: 'Plans recalculate with the new rules the next time their forecast or supply planning runs. The change is versioned and audited.', confirmLabel: 'Save', reason: { label: 'Reason for the change', minLength: 10 } }, async (reason) => {
            await post('setup/save', { expectedVersion: ctx.version, reason, setup: { ...s, discreteUoms: uoms.split(/[,\s]+/).map((u) => u.trim().toUpperCase()).filter(Boolean) } });
            await onSaved('Planning setup saved.');
        });
    };
    const dirty = JSON.stringify({ ...s, discreteUoms: uoms.split(/[,\s]+/).map((u) => u.trim().toUpperCase()).filter(Boolean) }) !== JSON.stringify(ctx.setup);
    return (
        <div className='flex h-[calc(100dvh-13rem)] min-h-[32rem] flex-col gap-2'>
            {confirm.sheet}
            {/* Focus: the setup alone, its save always in reach; only the form scrolls. */}
            <div className='sticky top-0 z-20 flex items-center gap-2 rounded-2xl border border-line bg-panel/95 p-2 backdrop-blur sm:p-3'>
                <Settings2 className='h-5 w-5 shrink-0 text-brand' />
                <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-semibold text-ink'>S&OP planning setup</p>
                    <p className='truncate text-xs text-muted'>Version {ctx.version}{dirty ? ' · unsaved changes' : ''}{!editable ? ' · read only' : ''}</p>
                </div>
                {editable && <Btn disabled={!dirty} onClick={save}><Check className='h-4 w-4' /> Save</Btn>}
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-6'>
            {error && <Alert tone='error'>{error}</Alert>}
            {!editable && <Alert tone='info'>Only a Planning Administrator (PLN.configure in their own role) changes the setup.</Alert>}
            <Panel className='space-y-3'>
                <h3 className='text-sm font-semibold'>Demand and forecast</h3>
                <Alert tone='info'>Planned demand comes from the annual demand plan per SKU. Commercial confirmed demand will replace it when Commercial is linked; approved firm orders already consume the forecast.</Alert>
                <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                    <Choice label='Current period (part-way)' disabled={!editable} value={s.currentPeriodRule} onChange={(v) => setS({ ...s, currentPeriodRule: v })} options={[['prorate', 'Prorate the days left'], ['include', 'Plan the whole period'], ['exclude', 'Start from the next period']]} />
                    <Choice label='Annual quantity covers (default)' disabled={!editable} value={s.defaultAnnualBasis} onChange={(v) => setS({ ...s, defaultAnnualBasis: v })} options={[['FULL_YEAR', 'The full financial year'], ['BALANCE', 'Only the balance periods']]} />
                    <Choice label='Seasonality (default)' disabled={!editable} value={s.defaultProfile} onChange={(v) => setS({ ...s, defaultProfile: v })} options={(Object.keys(PROFILE_LABEL) as Profile[]).map((p) => [p, PROFILE_LABEL[p]])} />
                    <Choice label='Forecast basis (default)' disabled={!editable} value={s.defaultForecastBasis} onChange={(v) => setS({ ...s, defaultForecastBasis: v })} options={(Object.keys(BASIS_LABEL) as Basis[]).map((b) => [b, BASIS_LABEL[b]])} />
                    <Num label='Statistical weight in a blend %' disabled={!editable} value={s.blendPct} onChange={n('blendPct')} />
                    <Num label='History months' step='1' disabled={!editable} value={s.historyMonths} onChange={n('historyMonths')} />
                </div>
                {s.defaultProfile === 'CUSTOM' && (
                    <div className='grid grid-cols-3 gap-2 sm:grid-cols-6'>
                        {MONTHS.map((m, i) => <Num key={m} label={`${m} %`} disabled={!editable} value={s.customProfile[i]} onChange={(v) => setS({ ...s, customProfile: s.customProfile.map((x, j) => (j === i ? (v === '' ? 0 : Number(v)) : x)) })} />)}
                    </div>
                )}
            </Panel>
            <Panel className='space-y-3'>
                <h3 className='text-sm font-semibold'>BOM unitisation</h3>
                <TextArea id='pln-discrete-uoms' label='Units that can never be split' rows={2} disabled={!editable} value={uoms} onChange={(e) => setUoms(e.target.value)} hint='Comma separated, e.g. EA, BAG, DRUM' />
                <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    <Num label='Rounding tolerance % (0 = exact)' disabled={!editable} value={s.unitTolerancePct} onChange={n('unitTolerancePct')} />
                    <Choice label='Process batches (vessels)' disabled={!editable} value={s.processBatchRule} onChange={(v) => setS({ ...s, processBatchRule: v })} options={[['runs', 'Count runs only'], ['multiple', 'Plan full batches only']]} />
                </div>
                <div className='space-y-2'>
                    <p className='text-xs font-medium text-soft'>Components kept whole (optionally in packs)</p>
                    {s.indivisible.map((x, i) => (
                        <div key={i} className='grid grid-cols-1 gap-2 rounded-xl border border-line p-2 sm:grid-cols-[1fr_8rem_1fr_auto]'>
                            <Select label='Component' disabled={!editable} value={x.key} onChange={(v) => setS({ ...s, indivisible: s.indivisible.map((y, j) => (j === i ? { ...y, key: v } : y)) })} options={keyOptions.some(([k]) => k === x.key) ? keyOptions : [...keyOptions, [x.key, x.key]]} />
                            <Num label='Pack size' disabled={!editable} value={x.packSize} onChange={(v) => setS({ ...s, indivisible: s.indivisible.map((y, j) => (j === i ? { ...y, packSize: v === '' ? 0 : Number(v) } : y)) })} />
                            <Field id={`ind-note-${i}`} label='Note' disabled={!editable} value={x.note} onChange={(e) => setS({ ...s, indivisible: s.indivisible.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })} />
                            {editable && <div className='flex items-end'><button type='button' aria-label='Remove' onClick={() => setS({ ...s, indivisible: s.indivisible.filter((_, j) => j !== i) })} className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-soft'><Trash2 className='h-4 w-4' /></button></div>}
                        </div>
                    ))}
                    {editable && <Btn variant='secondary' onClick={() => setS({ ...s, indivisible: [...s.indivisible, { key: '', packSize: 1, note: '' }] })}><Plus className='h-4 w-4' /> Add component</Btn>}
                </div>
            </Panel>
            <Panel className='space-y-3'>
                <h3 className='text-sm font-semibold'>Rough-cut capacity calendar</h3>
                <div className='grid grid-cols-2 gap-2 lg:grid-cols-4'>
                    <Num label='Hours per day' disabled={!editable} value={s.hoursPerDay} onChange={n('hoursPerDay')} />
                    <Num label='Working days per week' disabled={!editable} value={s.workingDaysPerWeek} onChange={n('workingDaysPerWeek')} />
                    <Num label='OEE %' disabled={!editable} value={s.oeePct} onChange={n('oeePct')} />
                    <Num label='Overload above %' disabled={!editable} value={s.overloadPct} onChange={n('overloadPct')} />
                </div>
            </Panel>
            <Panel>
                <h3 className='mb-2 text-sm font-semibold'>Setup history</h3>
                {ctx.setupHistory.length ? <ul className='space-y-1 text-xs text-soft'>{ctx.setupHistory.map((h) => <li key={h.version}>v{h.version} · {new Date(h.at).toLocaleString()} · {h.byName} · {h.reason}</li>)}</ul> : <p className='text-xs text-muted'>Default setup, never changed.</p>}
            </Panel>
            </div>
        </div>
    );
}

/** S&OP setup as its own tab: organization-wide rules, no site, year or plan in the way. */
export function PlnPlanningSetup() {
    const [ctx, setCtx] = useState<Context | null>(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const load = async () => setCtx(await post<Context>('context'));
    useEffect(() => { load().catch((e) => setError(messageOf(e))); }, []);
    if (!ctx) return error ? <Alert tone='error'>{error}</Alert> : <p className='p-6 text-center text-sm text-muted'>Loading the planning setup…</p>;
    return (
        <div className='space-y-2'>
            {notice && <Alert tone='success'>{notice}</Alert>}
            <SetupView ctx={ctx} onSaved={async (m) => { await load(); setNotice(m); }} />
        </div>
    );
}
