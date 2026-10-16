import { useState, type UIEvent } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardList, Eraser, Plus, RotateCcw, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Button, Card, Empty, Spinner, useLoad } from '../admin/kit';
import { Screen, Segmented, useConfirm } from '../components/screen';
import ActivityRiskReview from './ActivityRiskReview';

// Activity-based risk assessment for one equipment unit (opened from StructurePage for "activity risk" and
// "stored energy"). Each assembly activity under the unit is assessed as hazards → impacts → mitigations:
//   before mitigation  every factor of the SAF risk matrix is rated (score and band from the configured matrix)
//   mitigations        SAF control measures chosen per impact
//   after mitigation   the residual rating
// Activities list in a table (tap to open the editor); the Hazard review view embeds ActivityRiskReview.
// Save is enabled only when the open activity is complete enough for the server (once an impact is rated, both
// ratings are complete for every factor; a residual rating needs at least one mitigation) and is confirmed with an
// acknowledgement. Clear assessment, Remove hazard and Remove impact are confirmed in-app. The server recalculates
// scores with the current matrix and answers 403 with a message when the person lacks access at this unit.
// Safety-screening flags of an activity preselect matching SAF hazards, impacts and controls when it is opened
// (never invented codes, never altered ratings).

interface Ref {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    description: string;
}
interface Assessment {
    ratings: Record<string, number>;
    score?: number;
    band?: string;
    color?: string;
    matrixVersion?: number;
}
interface Impact {
    code: string;
    controls: string[];
    initialRisk?: Assessment | null;
    residualRisk?: Assessment | null;
}
interface Hazard {
    code: string;
    impacts: Impact[];
    initialRisk?: Assessment | null;
    residualRisk?: Assessment | null;
}
interface Entry {
    id: string;
    energyCode: string;
    utilityCode: string;
    hazards: Hazard[];
    notes: string;
    assemblyName?: string;
    activityType?: string;
    maintenanceType?: string;
    safetyScreening?: Record<string, boolean>;
}
interface Factor {
    code: string;
    label: string;
    max: number;
    enabled: boolean;
}
interface Matrix {
    version: number;
    formula: string;
    factors: Factor[];
    bands: Array<{ label: string; min: number; max: number; color: string; action: string }>;
    tolerableMax?: number;
}
interface Catalogue {
    energy: Ref[];
    hazards: Ref[];
    impacts: Ref[];
    controls: Ref[];
}
interface Response {
    catalogue: Catalogue;
    utilities: Array<{ code: string; label: string }>;
    items: Entry[];
    initialized: boolean;
    initializedUtilities: string[];
    pendingUtilities: Array<{ code: string; label: string }>;
    riskConfiguration?: Matrix | null;
}
interface Progress {
    configuration: number;
    assessment: number;
    overall: number;
}
interface SourceRow {
    entry: Entry;
    name: string;
    impacts: number;
    progress: Progress;
}
type RiskKey = 'initialRisk' | 'residualRisk';
type View = 'activities' | 'review';
// Hazards and impacts are addressed by position: older stored assessments can repeat a hazard or impact code.
type Picker = { type: 'hazards' } | { type: 'impacts'; hazard: number } | { type: 'controls'; hazard: number; impact: number } | null;

const MAX_HAZARDS = 80;
const PICKER_PAGE = 60;
const FALLBACK_COLOR = '#64748b';

// ---------------------------------------------------------------------------
// Safety-screening recommendations: matched against configured SAF hazards, impacts and controls.
// ---------------------------------------------------------------------------

const SAFETY_RULES = [
    { key: 'workAtHeight', terms: ['height', 'fall', 'elevat', 'ladder', 'scaffold'], controls: ['fall protection', 'harness', 'guardrail', 'working at height', 'elevated work'], title: 'Work at height' },
    { key: 'hotWork', terms: ['fire', 'burn', 'hot work', 'ignition', 'weld'], controls: ['hot work', 'fire watch', 'fire extinguisher', 'spark'], title: 'Hot work' },
    { key: 'confinedSpace', terms: ['confined', 'oxygen', 'asphyx', 'atmospher'], controls: ['confined space', 'gas test', 'ventilat', 'rescue'], title: 'Confined space entry' },
    { key: 'electricalWork', terms: ['electri', 'shock', 'arc flash', 'electrocut'], controls: ['isolat', 'lockout', 'loto', 'electrical', 'test for dead'], title: 'Electrical work' },
    { key: 'storedEnergy', terms: ['stored energy', 'unexpected start', 'pressure', 'release of energy', 'energiz'], controls: ['lockout', 'loto', 'isolation', 'zero energy', 'depressur'], title: 'Stored energy / LOTO' },
    { key: 'guardsRemoved', terms: ['unguard', 'guard', 'entangle', 'moving part', 'pinch'], controls: ['guard', 'lockout', 'loto', 'isolat'], title: 'Guard removal' },
    { key: 'bodyExposure', terms: ['entangle', 'crush', 'pinch', 'unguard', 'moving part'], controls: ['lockout', 'loto', 'guard', 'isolat'], title: 'Body exposure to danger zone' },
    { key: 'toolsOrParts', terms: ['mechanical', 'crush', 'cut', 'pinch', 'tool'], controls: ['isolat', 'lockout', 'tool', 'guard'], title: 'Tools / part removal' },
    { key: 'liveTesting', terms: ['live', 'electri', 'unexpected start', 'moving part'], controls: ['live work', 'authorized', 'barrier', 'safe distance', 'guard'], title: 'Live-equipment diagnosis' },
    { key: 'jogging', terms: ['moving part', 'entangle', 'crush', 'unexpected start', 'pinch'], controls: ['jog', 'inching', 'interlock', 'hold-to-run', 'barrier'], title: 'Inching / jogging' },
    { key: 'hazardousChemicals', terms: ['chemical', 'toxic', 'corros', 'expos'], controls: ['chemical', 'spill', 'ppe', 'sds', 'contain'], title: 'Hazardous chemicals' },
    { key: 'equipmentRunning', terms: ['moving part', 'entangle', 'unguard', 'unexpected start'], controls: ['guard', 'barrier', 'interlock', 'safe distance'], title: 'Running equipment' },
];

function safetySuggestions(entry: Entry, catalogue: Catalogue) {
    return SAFETY_RULES.filter((rule) => entry.safetyScreening?.[rule.key]).map((rule) => {
        const matches = (text: string, terms: string[]) => terms.some((t) => text.toLowerCase().includes(t));
        const hazard = catalogue.hazards.find((h) => matches(`${h.label} ${h.category} ${h.subcategory}`, rule.terms));
        const controls = catalogue.controls.filter((c) => matches(`${c.label} ${c.category}`, rule.controls)).map((c) => c.code);
        const impacts = catalogue.impacts.filter((im) => matches(`${im.label} ${im.category} ${im.subcategory}`, rule.terms)).slice(0, 3);
        return { ...rule, hazard, controls, impacts };
    });
}

function withSafetyDefaults(entry: Entry, catalogue: Catalogue): Entry {
    const hazards: Hazard[] = structuredClone(entry.hazards);
    for (const suggestion of safetySuggestions(entry, catalogue)) {
        if (!suggestion.hazard) continue;
        let hazard = hazards.find((h) => h.code === suggestion.hazard!.code);
        if (!hazard) {
            hazard = { code: suggestion.hazard.code, impacts: [] };
            hazards.push(hazard);
        }
        for (const impact of suggestion.impacts) {
            const existing = hazard.impacts.find((im) => im.code === impact.code);
            if (!existing) hazard.impacts.push({ code: impact.code, controls: [...suggestion.controls], initialRisk: null, residualRisk: null });
            else existing.controls = [...new Set([...existing.controls, ...suggestion.controls])];
        }
    }
    return { ...entry, hazards };
}

// ---------------------------------------------------------------------------
// Scoring and validation
// ---------------------------------------------------------------------------

const hasRatings = (risk?: Assessment | null) => !!risk && Object.keys(risk.ratings ?? {}).length > 0;
const validRating = (n: unknown, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max;

function evaluate(matrix: Matrix | null | undefined, risk: Assessment | null | undefined) {
    if (!matrix || !risk) return null;
    const active = matrix.factors.filter((f) => f.enabled);
    if (!active.every((f) => validRating(risk.ratings?.[f.code], f.max))) return null;
    const add = matrix.formula === 'add';
    const score = active.reduce((n, f) => (add ? n + risk.ratings[f.code] : n * risk.ratings[f.code]), add ? 0 : 1);
    return { score, band: matrix.bands.find((b) => score >= b.min && score <= b.max) };
}

function tolerability(matrix: Matrix | null | undefined, risk: Assessment | null | undefined) {
    const result = evaluate(matrix, risk);
    if (!result || !matrix) return 'Not assessed';
    return result.score > (matrix.tolerableMax ?? matrix.bands[1]?.max ?? 0) ? 'Intolerable' : 'Tolerable';
}

function progressOf(entry: Entry, matrix: Matrix | null | undefined): Progress {
    const impacts = entry.hazards.flatMap((h) => h.impacts);
    const required = entry.hazards.length + Math.max(impacts.length, 1);
    const configured = entry.hazards.filter((h) => h.impacts.length > 0).length + impacts.filter((i) => i.controls.length > 0).length;
    const configuration = required ? Math.round((configured / required) * 100) : 0;
    const rated = impacts.reduce((n, i) => n + Number(!!evaluate(matrix, i.initialRisk)) + Number(!!evaluate(matrix, i.residualRisk)), 0);
    const assessment = impacts.length ? Math.round((rated / (impacts.length * 2)) * 100) : 0;
    return { configuration, assessment, overall: Math.round((configuration + assessment) / 2) };
}

/** What blocks saving the open activity (mirrors what the server would refuse, plus completeness rules). */
function problemsOf(entry: Entry, matrix: Matrix | null | undefined, name: (kind: keyof Catalogue, code: string) => string): string[] {
    const problems: string[] = [];
    if (entry.hazards.length > MAX_HAZARDS) problems.push(`At most ${MAX_HAZARDS} hazards per activity.`);
    for (const h of entry.hazards) {
        for (const im of h.impacts) {
            const where = `${name('impacts', im.code)} (${name('hazards', h.code)})`;
            const started = hasRatings(im.initialRisk) || hasRatings(im.residualRisk);
            if (started && !matrix) {
                problems.push(`${where}: the SAF risk matrix is not configured, so ratings cannot be saved.`);
                continue;
            }
            if (started && matrix) {
                for (const key of ['initialRisk', 'residualRisk'] as const) {
                    const missing = matrix.factors.filter((f) => !validRating(im[key]?.ratings?.[f.code], f.max));
                    if (missing.length) problems.push(`${where}: rate ${missing.map((f) => f.label).join(', ')} ${key === 'initialRisk' ? 'before' : 'after'} mitigation.`);
                }
            }
            if (hasRatings(im.residualRisk) && im.controls.length === 0) problems.push(`${where}: select at least one mitigation for the after-mitigation rating.`);
        }
    }
    return problems;
}

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

/** Problems next to the Save action: a one-line summary that expands to the full list. */
function ProblemsBar({ problems }: { problems: string[] }) {
    const [open, setOpen] = useState(false);
    if (!problems.length) return null;
    return (
        <div className='rounded-xl bg-amber-500/10 text-amber-300'>
            <button type='button' aria-expanded={open} onClick={() => setOpen((v) => !v)} className='flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm'>
                <AlertTriangle className='h-4 w-4 shrink-0' />
                <span className='min-w-0 flex-1 truncate'>{problems.length === 1 ? problems[0] : `${problems.length} problems to fix before saving`}</span>
                {open ? <ChevronUp className='h-4 w-4 shrink-0' /> : <ChevronDown className='h-4 w-4 shrink-0' />}
            </button>
            {open && (
                <ul className='max-h-40 list-disc space-y-1 overflow-y-auto overscroll-contain px-8 pb-3 text-sm'>
                    {problems.map((text, i) => (
                        <li key={i}>{text}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ProgressBar({ value }: { value: number }) {
    return (
        <span className='block h-2 w-full overflow-hidden rounded-full bg-line' aria-hidden='true'>
            <span className='block h-full rounded-full bg-brand' style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </span>
    );
}

function RiskInputs({
    id,
    title,
    matrix,
    risk,
    required,
    onRate,
}: {
    id: string;
    title: string;
    matrix: Matrix;
    risk: Assessment | null | undefined;
    required: boolean;
    onRate: (factor: string, value: string) => void;
}) {
    const result = evaluate(matrix, risk);
    return (
        <fieldset className='space-y-2 rounded-xl border border-line p-3'>
            <legend className='px-1 text-sm font-semibold text-ink'>{title}</legend>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {matrix.factors.map((f) => {
                    const value = risk?.ratings?.[f.code];
                    const outOfRange = value !== undefined && !validRating(value, f.max);
                    const error = required ? (value === undefined ? 'Required' : outOfRange ? `Out of range 1–${f.max}` : undefined) : undefined;
                    return (
                        <SelectField
                            key={f.code}
                            id={`${id}-${f.code}`}
                            label={`${f.label} (1–${f.max})${f.enabled ? '' : ' · not scored'}${required ? ' *' : ''}`}
                            value={value ?? ''}
                            error={error}
                            onChange={(e) => onRate(f.code, e.target.value)}
                        >
                            <option value=''>Select</option>
                            {outOfRange && <option value={value}>{value} (out of range)</option>}
                            {Array.from({ length: f.max }, (_, i) => i + 1).map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </SelectField>
                    );
                })}
            </div>
            {result ? (
                <p className='rounded-lg px-3 py-2 text-sm font-semibold' style={{ backgroundColor: result.band?.color || FALLBACK_COLOR, color: '#ffffff' }}>
                    Score {result.score} · {result.band?.label ?? 'Unclassified'} · {tolerability(matrix, risk)} · Matrix v{risk?.matrixVersion || matrix.version}
                </p>
            ) : (
                <p className='text-xs text-muted'>Complete the ratings to calculate the score.</p>
            )}
        </fieldset>
    );
}

/** Multi-select sheet for hazards, impacts or mitigations; renders more rows as you scroll. */
function PickerSheet({
    title,
    hint,
    items,
    isChecked,
    describe,
    onToggle,
    onClose,
}: {
    title: string;
    hint: string;
    items: Ref[];
    isChecked: (code: string) => boolean;
    describe: (item: Ref) => string;
    onToggle: (item: Ref, checked: boolean) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState(PICKER_PAGE);
    const q = query.trim().toLowerCase();
    const matches = items.filter((x) => `${x.category} ${x.subcategory} ${x.label}`.toLowerCase().includes(q));
    const selected = items.filter((x) => isChecked(x.code)).length;
    const onScroll = (e: UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 240 && limit < matches.length) setLimit((n) => n + PICKER_PAGE);
    };
    return (
        <div className='fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close' className='absolute inset-0 bg-black/60' onClick={onClose} />
            <section role='dialog' aria-modal='true' aria-label={title} className='relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-xl sm:rounded-2xl'>
                <header className='flex items-start gap-3 border-b border-line p-4'>
                    <div className='min-w-0 flex-1'>
                        <h2 className='text-base font-semibold text-ink'>{title}</h2>
                        <p className='text-xs text-muted'>
                            {selected} selected · {hint}
                        </p>
                    </div>
                    <button type='button' aria-label='Close' onClick={onClose} className='-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </header>
                <div className='border-b border-line p-3'>
                    <input
                        type='search'
                        aria-label='Search categories or names'
                        placeholder='Search categories or names'
                        value={query}
                        maxLength={100}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setLimit(PICKER_PAGE);
                        }}
                        className='h-12 w-full rounded-xl border border-line bg-page px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none'
                    />
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1' onScroll={onScroll}>
                    {matches.length === 0 && <Empty>Nothing matches “{query}”.</Empty>}
                    {matches.slice(0, limit).map((x) => {
                        const checked = isChecked(x.code);
                        return (
                            <label key={x.code} className='flex min-h-[48px] items-start gap-3 rounded-lg px-2 py-3 text-sm active:bg-page'>
                                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={checked} onChange={(e) => onToggle(x, e.target.checked)} />
                                <span className='min-w-0'>
                                    <span className='block font-medium text-ink'>{x.label}</span>
                                    <span className='block text-xs text-muted'>{describe(x)}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
                <footer className='border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                    <Button type='button' className='h-12 w-full' onClick={onClose}>
                        Done
                    </Button>
                </footer>
            </section>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ActivityRiskLegacy({
    workCenterId,
    onBack,
    onReview,
    hierarchy = [],
}: {
    workCenterId: string;
    onBack: () => void;
    onReview?: () => void;
    hierarchy?: { level: string; code: string; name: string }[];
}) {
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<Response>('/api/org/activity-risk/legacy-read', { workCenterId }), [workCenterId]);
    const [view, setView] = useState<View>('activities');
    const [row, setRow] = useState<Entry | null>(null);
    const [opened, setOpened] = useState('');
    const [picker, setPicker] = useState<Picker>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    const title = 'Activity-based risk assessment';
    const place = hierarchy.length ? hierarchy[hierarchy.length - 1] : null;
    const eyebrow = place ? `${place.name} (${place.code})` : undefined;

    if (loading && !data) {
        return (
            <Screen title={title} eyebrow={eyebrow} onBack={onBack}>
                <Spinner />
            </Screen>
        );
    }
    if (!data) {
        return (
            <Screen title={title} eyebrow={eyebrow} onBack={onBack}>
                <Alert tone='error'>{error || 'Could not load the risk assessment.'}</Alert>
                <Button type='button' variant='secondary' onClick={reload}>
                    <RotateCcw className='h-4 w-4' /> Try again
                </Button>
            </Screen>
        );
    }

    const matrix = data.riskConfiguration ?? null;
    const label = (kind: keyof Catalogue, code: string) => data.catalogue[kind].find((x) => x.code === code)?.label || code;
    const refOf = (kind: keyof Catalogue, code: string) => data.catalogue[kind].find((x) => x.code === code);
    const activityName = (entry: Entry) => {
        const utility = entry.utilityCode ? data.utilities.find((u) => u.code === entry.utilityCode)?.label || entry.utilityCode : '';
        return label('energy', entry.energyCode) + (utility ? ` (${utility})` : '');
    };
    const contextOf = (entry: Entry) => [entry.assemblyName, entry.activityType, entry.maintenanceType].filter(Boolean).join(' · ') || 'Assembly activity';

    /** Saves all activities of the unit (the endpoint replaces the unit's assessments) and reloads the scores. */
    const persist = async (items: Entry[]) => {
        await callBackend('/api/org/activity-risk/legacy-save', { workCenterId, items, initialized: true, initializedUtilities: data.initializedUtilities });
        setData({ ...data, items, initialized: true });
        reload();
    };

    const open = (entry: Entry) => {
        const next = withSafetyDefaults(entry, data.catalogue);
        setRow(next);
        setOpened(JSON.stringify(next));
        setNotice('');
    };
    const close = () => {
        setRow(null);
        setOpened('');
        setPicker(null);
    };

    // ----- list of activities ------------------------------------------------
    if (!row) {
        const rows: SourceRow[] = data.items.map((entry) => ({
            entry,
            name: activityName(entry),
            impacts: entry.hazards.reduce((n, h) => n + h.impacts.length, 0),
            progress: progressOf(entry, matrix),
        }));
        const columns: Array<Column<SourceRow>> = [
            {
                key: 'activity',
                label: 'Activity',
                value: (r) => r.name,
                render: (r) => (
                    <span className='block min-w-[10rem]'>
                        <span className='block font-medium text-ink'>{r.name}</span>
                        <span className='block text-xs text-muted'>{contextOf(r.entry)}</span>
                    </span>
                ),
            },
            { key: 'assembly', label: 'Assembly', hidden: true, value: (r) => r.entry.assemblyName ?? '' },
            { key: 'activityType', label: 'Activity type', hidden: true, value: (r) => r.entry.activityType ?? '' },
            { key: 'maintenanceType', label: 'Maintenance type', hidden: true, value: (r) => r.entry.maintenanceType ?? '' },
            { key: 'hazards', label: 'Hazards', type: 'number', value: (r) => r.entry.hazards.length },
            { key: 'impacts', label: 'Impacts', type: 'number', value: (r) => r.impacts },
            { key: 'configuration', label: 'Configuration %', type: 'number', hidden: true, value: (r) => r.progress.configuration },
            { key: 'assessment', label: 'Assessment %', type: 'number', hidden: true, value: (r) => r.progress.assessment },
            {
                key: 'overall',
                label: 'Overall %',
                type: 'number',
                value: (r) => r.progress.overall,
                render: (r) => (
                    <span className='flex min-w-[7rem] items-center gap-2'>
                        <ProgressBar value={r.progress.overall} />
                        <span className='w-10 shrink-0 text-right text-xs text-soft'>{r.progress.overall}%</span>
                    </span>
                ),
            },
        ];
        return (
            <Screen
                title={title}
                eyebrow={eyebrow}
                subtitle={`${data.items.length} activities${matrix ? ` · risk matrix v${matrix.version}` : ' · risk matrix not configured'}`}
                onBack={onBack}
                actions={
                    onReview ? (
                        <Button type='button' variant='secondary' className='px-3' aria-label='Open the full risk review' onClick={onReview}>
                            <ClipboardList className='h-4 w-4' />
                            <span className='hidden sm:inline'>Full review</span>
                        </Button>
                    ) : undefined
                }
                toolbar={
                    <Segmented<View>
                        label='Risk assessment views'
                        value={view}
                        onChange={setView}
                        options={[
                            { value: 'activities', label: 'Activities', count: data.items.length },
                            { value: 'review', label: 'Hazard review' },
                        ]}
                    />
                }
            >
                {notice && <Alert tone='success'>{notice}</Alert>}
                {error && <Alert tone='error'>{error}</Alert>}
                {!matrix && <Alert tone='warn'>The SAF risk matrix is not configured yet: hazards, impacts and mitigations can be recorded, but impacts cannot be scored.</Alert>}
                {view === 'activities' ? (
                    <RichTable
                        id='saf.activity.sources'
                        title='Assembly activities'
                        columns={columns}
                        rows={rows}
                        rowKey={(r) => r.entry.id}
                        onRowClick={(r) => open(r.entry)}
                        empty='No assembly activities under this equipment unit yet. Add activities to its assemblies first.'
                        fileName={`activity-risk-activities-${workCenterId}`}
                        height='h-[calc(100dvh-17rem)]'
                    />
                ) : (
                    <ActivityRiskReview workCenterId={workCenterId} embedded hierarchy={hierarchy} />
                )}
            </Screen>
        );
    }

    // ----- editor for one activity -------------------------------------------
    const current = row;
    const saved = data.items.find((x) => x.id === current.id) ?? null;
    const name = activityName(current);
    const dirty = !saved || JSON.stringify(current) !== JSON.stringify(saved);
    const touched = JSON.stringify(current) !== opened;
    const problems = problemsOf(current, matrix, label);
    const canSave = dirty && problems.length === 0;
    const suggestions = safetySuggestions(current, data.catalogue);
    const progress = progressOf(current, matrix);

    const updateRow = (change: (e: Entry) => Entry) => setRow((r) => (r ? change(r) : r));
    const updateHazard = (hi: number, change: (h: Hazard) => Hazard) => updateRow((e) => ({ ...e, hazards: e.hazards.map((h, i) => (i === hi ? change(h) : h)) }));
    const updateImpact = (hi: number, ii: number, change: (im: Impact) => Impact) =>
        updateHazard(hi, (h) => ({ ...h, impacts: h.impacts.map((im, j) => (j === ii ? change(im) : im)) }));
    const rate = (hi: number, ii: number, key: RiskKey, factor: string, value: string) =>
        updateImpact(hi, ii, (im) => {
            const ratings = { ...(im[key]?.ratings ?? {}) };
            if (value === '') delete ratings[factor];
            else ratings[factor] = Number(value);
            return { ...im, [key]: Object.keys(ratings).length ? { ratings } : null };
        });

    const dropHazard = (hi: number) => updateRow((e) => ({ ...e, hazards: e.hazards.filter((_, i) => i !== hi) }));
    const dropImpact = (hi: number, ii: number) => updateHazard(hi, (h) => ({ ...h, impacts: h.impacts.filter((_, j) => j !== ii) }));
    const askRemoveHazard = (hi: number) => {
        const h = current.hazards[hi];
        if (!h) return;
        confirm.ask(
            {
                title: 'Remove hazard?',
                message: `${label('hazards', h.code)} and its ${h.impacts.length} impact${h.impacts.length === 1 ? '' : 's'} (with ratings and mitigations) are removed from this assessment. Nothing is saved until you tap Save.`,
                confirmLabel: 'Remove hazard',
                tone: 'danger',
            },
            async () => dropHazard(hi),
        );
    };
    const askRemoveImpact = (hi: number, ii: number) => {
        const h = current.hazards[hi];
        const im = h?.impacts[ii];
        if (!h || !im) return;
        confirm.ask(
            {
                title: 'Remove impact?',
                message: `${label('impacts', im.code)} is removed from ${label('hazards', h.code)}, with its ratings and ${im.controls.length} mitigation${im.controls.length === 1 ? '' : 's'}. Nothing is saved until you tap Save.`,
                confirmLabel: 'Remove impact',
                tone: 'danger',
            },
            async () => dropImpact(hi, ii),
        );
    };

    const askSave = () => {
        if (!canSave) return;
        const entry = current;
        const items = data.items.some((x) => x.id === entry.id) ? data.items.map((x) => (x.id === entry.id ? entry : x)) : [...data.items, entry];
        const impactCount = entry.hazards.reduce((n, h) => n + h.impacts.length, 0);
        confirm.ask(
            {
                title: 'Save risk assessment',
                message: (
                    <p>
                        Saves {entry.hazards.length} hazards and {impactCount} impacts with their ratings and mitigations for <strong className='text-ink'>{name}</strong>.
                        {matrix ? ` Scores are recalculated with risk matrix v${matrix.version}.` : ''}
                    </p>
                ),
                confirmLabel: 'Save assessment',
                acknowledge: 'I have reviewed the hazards, risk ratings and mitigations, and the site permits and isolation requirements for this activity are confirmed.',
            },
            async () => {
                await persist(items);
                close();
                setNotice(`Risk assessment for ${name} saved.`);
            },
        );
    };

    const askClear = (entry: Entry) =>
        confirm.ask(
            {
                title: 'Clear assessment?',
                message: (
                    <p>
                        Deletes all {entry.hazards.length} saved hazards of <strong className='text-ink'>{name}</strong> with their impacts, ratings and mitigations
                        {touched ? ', and discards your unsaved changes' : ''}. This cannot be undone.
                    </p>
                ),
                confirmLabel: 'Clear assessment',
                tone: 'danger',
                phrase: 'CLEAR',
            },
            async () => {
                await persist(data.items.map((x) => (x.id === entry.id ? { ...x, hazards: [] } : x)));
                close();
                setNotice(`Risk assessment for ${name} cleared.`);
            },
        );

    const leave = () => {
        if (!touched) return close();
        confirm.ask(
            {
                title: 'Discard changes?',
                message: `Your unsaved hazards, ratings and mitigations for ${name} will be lost.`,
                confirmLabel: 'Discard changes',
                tone: 'danger',
            },
            async () => close(),
        );
    };

    // Picker toggles: removing something that already holds work goes through the same confirmation.
    const toggleHazard = (item: Ref, checked: boolean) => {
        const hi = current.hazards.findIndex((h) => h.code === item.code);
        if (checked) {
            if (hi < 0) updateRow((e) => ({ ...e, hazards: [...e.hazards, { code: item.code, impacts: [] }] }));
        } else if (hi >= 0) {
            if (current.hazards[hi].impacts.length) askRemoveHazard(hi);
            else dropHazard(hi);
        }
    };
    const toggleImpact = (hi: number, item: Ref, checked: boolean) => {
        const h = current.hazards[hi];
        if (!h) return;
        const ii = h.impacts.findIndex((im) => im.code === item.code);
        if (checked) {
            if (ii < 0) updateHazard(hi, (x) => ({ ...x, impacts: [...x.impacts, { code: item.code, controls: [], initialRisk: null, residualRisk: null }] }));
        } else if (ii >= 0) {
            const existing = h.impacts[ii];
            if (existing.controls.length || hasRatings(existing.initialRisk) || hasRatings(existing.residualRisk)) askRemoveImpact(hi, ii);
            else dropImpact(hi, ii);
        }
    };
    const toggleControl = (hi: number, ii: number, item: Ref, checked: boolean) =>
        updateImpact(hi, ii, (im) => ({ ...im, controls: checked ? [...new Set([...im.controls, item.code])] : im.controls.filter((c) => c !== item.code) }));

    const pickerSheet = (() => {
        if (!picker) return null;
        const describe = (x: Ref) => [x.category, x.subcategory].filter(Boolean).join(' › ');
        if (picker.type === 'hazards') {
            return (
                <PickerSheet
                    title='Hazards of this activity'
                    hint='Tap to add or remove'
                    items={data.catalogue.hazards}
                    isChecked={(code) => current.hazards.some((h) => h.code === code)}
                    describe={describe}
                    onToggle={toggleHazard}
                    onClose={() => setPicker(null)}
                />
            );
        }
        const h = current.hazards[picker.hazard];
        if (!h) return null;
        if (picker.type === 'impacts') {
            return (
                <PickerSheet
                    title={`Impacts of ${label('hazards', h.code)}`}
                    hint='Tap to add or remove'
                    items={data.catalogue.impacts}
                    isChecked={(code) => h.impacts.some((im) => im.code === code)}
                    describe={describe}
                    onToggle={(item, checked) => toggleImpact(picker.hazard, item, checked)}
                    onClose={() => setPicker(null)}
                />
            );
        }
        const im = h.impacts[picker.impact];
        if (!im) return null;
        return (
            <PickerSheet
                title={`Mitigations for ${label('impacts', im.code)}`}
                hint='SAF control measures'
                items={data.catalogue.controls}
                isChecked={(code) => im.controls.includes(code)}
                describe={(x) => x.category}
                onToggle={(item, checked) => toggleControl(picker.hazard, picker.impact, item, checked)}
                onClose={() => setPicker(null)}
            />
        );
    })();

    return (
        <Screen
            title={name}
            eyebrow='Activity risk assessment'
            subtitle={contextOf(current)}
            onBack={leave}
            actions={
                <Button type='button' disabled={!canSave} onClick={askSave}>
                    <Save className='h-4 w-4' /> Save
                </Button>
            }
            toolbar={<ProblemsBar problems={problems} />}
        >
            <Card className='space-y-2 p-3'>
                <div className='flex items-baseline justify-between gap-2'>
                    <p className='text-sm font-semibold text-ink'>Completion {progress.overall}%</p>
                    <p className='text-xs text-muted'>{dirty ? 'Unsaved changes' : 'Saved'}</p>
                </div>
                <ProgressBar value={progress.overall} />
                <p className='text-xs text-soft'>
                    Configuration {progress.configuration}% · Assessment {progress.assessment}%
                </p>
                {saved && saved.hazards.length > 0 && (
                    <Button type='button' variant='danger' className='w-full' onClick={() => askClear(saved)}>
                        <Eraser className='h-4 w-4' /> Clear assessment
                    </Button>
                )}
            </Card>

            {suggestions.length > 0 && (
                <Card className='space-y-2 p-3 text-sm'>
                    <p className='font-semibold text-ink'>Safety screening · recommended hazards and controls</p>
                    <p className='text-soft'>
                        Matching hazards and controls were preselected from SAF metadata. Review them, assess risk before and after mitigation, and confirm all site permits and isolation requirements.
                    </p>
                    <ul className='space-y-1 text-soft'>
                        {suggestions.map((s) => (
                            <li key={s.key} className='flex gap-2'>
                                <ShieldCheck className='mt-0.5 h-4 w-4 shrink-0 text-brandsoft' />
                                <span>
                                    <span className='text-ink'>{s.title}</span>
                                    {s.hazard ? ` — ${s.hazard.label}` : ' — no matching SAF hazard; add one in Safety Admin'}
                                    {s.controls.length ? ` · ${s.controls.length} suggested controls` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            {!matrix && <Alert tone='warn'>Configure the SAF risk matrix to score impacts. Hazards, impacts and mitigations can still be saved.</Alert>}

            <div className='flex items-center justify-between gap-2'>
                <h2 className='text-sm font-semibold text-ink'>Hazards → impacts → mitigations ({current.hazards.length})</h2>
                <Button type='button' variant='secondary' className='px-3' onClick={() => setPicker({ type: 'hazards' })}>
                    <Plus className='h-4 w-4' /> Hazards
                </Button>
            </div>
            {current.hazards.length === 0 && <Empty>No hazards yet. Tap “Hazards” to add the hazards of this activity.</Empty>}

            {current.hazards.map((h, hi) => {
                const ref = refOf('hazards', h.code);
                return (
                    <Card key={`${h.code}-${hi}`} className='space-y-3 p-3'>
                        <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='text-sm font-semibold text-ink'>{label('hazards', h.code)}</p>
                                {ref && <p className='text-xs text-muted'>{[ref.category, ref.subcategory].filter(Boolean).join(' › ')}</p>}
                            </div>
                            <Button type='button' variant='danger' className='shrink-0 px-3' aria-label={`Remove hazard ${label('hazards', h.code)}`} onClick={() => askRemoveHazard(hi)}>
                                <Trash2 className='h-4 w-4' />
                                <span className='hidden sm:inline'>Remove hazard</span>
                            </Button>
                        </div>

                        {h.impacts.length === 0 && <p className='text-xs text-muted'>No impacts yet.</p>}
                        {h.impacts.map((im, ii) => {
                            const started = hasRatings(im.initialRisk) || hasRatings(im.residualRisk);
                            const needsControl = hasRatings(im.residualRisk) && im.controls.length === 0;
                            const idBase = `risk-${hi}-${ii}`;
                            return (
                                <div key={`${im.code}-${ii}`} className='space-y-3 rounded-xl border border-line bg-page p-3'>
                                    <div className='flex items-start gap-2'>
                                        <p className='min-w-0 flex-1 text-sm font-medium text-ink'>{label('impacts', im.code)}</p>
                                        <Button type='button' variant='danger' className='shrink-0 px-3' aria-label={`Remove impact ${label('impacts', im.code)}`} onClick={() => askRemoveImpact(hi, ii)}>
                                            <Trash2 className='h-4 w-4' />
                                            <span className='hidden sm:inline'>Remove impact</span>
                                        </Button>
                                    </div>
                                    {matrix && (
                                        <RiskInputs id={`${idBase}-before`} title='Before mitigation' matrix={matrix} risk={im.initialRisk} required={started} onRate={(f, v) => rate(hi, ii, 'initialRisk', f, v)} />
                                    )}
                                    <div className='space-y-2 rounded-xl border border-line p-3'>
                                        <p className='text-sm font-semibold text-ink'>Mitigations ({im.controls.length})</p>
                                        {im.controls.length ? (
                                            <ul className='flex flex-wrap gap-1.5'>
                                                {im.controls.map((c) => (
                                                    <li key={c} className='rounded-full bg-line px-2.5 py-1 text-xs text-soft'>
                                                        {label('controls', c)}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <p className='text-xs text-muted'>No SAF control measures selected.</p>
                                        )}
                                        {needsControl && <p className='text-xs text-red-300'>Select at least one mitigation for the after-mitigation rating.</p>}
                                        <Button type='button' variant='secondary' className='w-full' onClick={() => setPicker({ type: 'controls', hazard: hi, impact: ii })}>
                                            <ShieldCheck className='h-4 w-4' /> Select mitigations
                                        </Button>
                                    </div>
                                    {matrix && (
                                        <RiskInputs id={`${idBase}-after`} title='After mitigation' matrix={matrix} risk={im.residualRisk} required={started} onRate={(f, v) => rate(hi, ii, 'residualRisk', f, v)} />
                                    )}
                                </div>
                            );
                        })}
                        <Button type='button' variant='secondary' className='w-full' onClick={() => setPicker({ type: 'impacts', hazard: hi })}>
                            <Plus className='h-4 w-4' /> Add or remove impacts
                        </Button>
                    </Card>
                );
            })}

            {current.hazards.length > 0 && (
                <Button type='button' variant='secondary' className='w-full' onClick={() => setPicker({ type: 'hazards' })}>
                    <Plus className='h-4 w-4' /> Add or remove hazards
                </Button>
            )}
            {pickerSheet}
            {confirm.sheet}
        </Screen>
    );
}
