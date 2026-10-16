import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Card, Spinner } from '../admin/kit';
import { InfoTip, Screen, messageOf, useConfirm } from '../components/screen';

// SAF · risk matrix configuration (one per organization, versioned).
//   Factors      Probability (P), Severity (S), Exposure (E), People affected (A): each has a scale 1..max (1–10)
//                and can be left out of the score; the formula multiplies or adds the enabled factors.
//   Bands        2–10 risk classifications that must cover every possible score from the minimum to the maximum
//                without gaps or overlaps (same rules as the server).
//   Cut-offs     the highest tolerable score and an optional severity escalation override (0 = off).
// Saving publishes version N+1 for the whole organization (previous versions stay in history). Only people whose
// own role has SAF.configure may save: the read response says so in `canEdit`; everyone else sees it read only.
// Nothing can be saved until the current configuration has loaded, so built-in defaults are never published by mistake.

interface Factor {
    code: string;
    label: string;
    max: number;
    enabled: boolean;
}
interface Band {
    label: string;
    min: number;
    max: number;
    color: string;
    action: string;
}
interface Config {
    version: number;
    formula: 'multiply' | 'add';
    factors: Factor[];
    bands: Band[];
    severityOverride: number;
    tolerableMax: number;
    updatedAt: string;
}
interface ReadResponse {
    configuration: Config;
    history: Config[];
    canEdit?: boolean;
}

/** Editable copy: number inputs are kept as typed text until saved. */
interface BandDraft {
    label: string;
    min: string;
    max: string;
    color: string;
    action: string;
}
interface Draft {
    formula: Config['formula'];
    factors: Factor[];
    bands: BandDraft[];
    severityOverride: number;
    tolerableMax: string;
}
interface Problems {
    list: string[];
    bands: Record<number, { label?: string; min?: string; max?: string; color?: string; action?: string }>;
    tolerableMax?: string;
    severityOverride?: string;
    factors?: string;
}

const FACTOR_CODES = ['P', 'S', 'E', 'A'];
const MAX_BANDS = 10;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const toDraft = (c: Config): Draft => ({
    formula: c.formula,
    factors: c.factors.map((f) => ({ ...f })),
    bands: c.bands.map((b) => ({ label: b.label, min: String(b.min), max: String(b.max), color: b.color, action: b.action })),
    severityOverride: c.severityOverride,
    // Older configurations without a cut-off fall back to the end of the second band, as the server does.
    tolerableMax: String(c.tolerableMax ?? [...c.bands].sort((a, b) => a.min - b.min)[1]?.max ?? ''),
});

/** Comparable form of a configuration (only what Save sends and the server keeps). */
const fingerprint = (c: Config) =>
    JSON.stringify({
        formula: c.formula,
        factors: c.factors.map((f) => [f.code, f.label, f.max, f.enabled]),
        bands: [...c.bands].sort((a, b) => a.min - b.min).map((b) => [b.label, b.min, b.max, b.color.toLowerCase(), b.action]),
        severityOverride: c.severityOverride,
        tolerableMax: c.tolerableMax,
    });

/** Whole number or NaN (empty, decimals and signs are not accepted). */
const int = (text: string) => (/^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : NaN);

function scoreRange(draft: Draft) {
    const enabled = draft.factors.filter((f) => f.enabled);
    const multiply = draft.formula === 'multiply';
    const max = enabled.reduce((n, f) => (multiply ? n * f.max : n + f.max), multiply ? 1 : 0);
    const min = multiply ? 1 : enabled.length;
    return { enabled, min, max };
}

/** Client copy of the server's rules for /api/org/saf/risk-matrix/save. */
function validate(draft: Draft): Problems {
    const p: Problems = { list: [], bands: {} };
    const { enabled, min, max } = scoreRange(draft);
    if (draft.factors.length !== 4 || !FACTOR_CODES.every((code) => draft.factors.some((f) => f.code === code))) p.list.push('The four factors P, S, E and A are required.');
    if (draft.factors.some((f) => !Number.isInteger(f.max) || f.max < 1 || f.max > 10)) p.list.push('Each factor scale must be between 1 and 10.');
    if (!enabled.length) {
        p.factors = 'Enable at least one factor.';
        p.list.push(p.factors);
    }
    if (draft.bands.length < 2 || draft.bands.length > MAX_BANDS) p.list.push(`Define 2–${MAX_BANDS} risk bands.`);

    const parsed = draft.bands.map((b, i) => ({ i, label: b.label.trim(), min: int(b.min), max: int(b.max), color: b.color, action: b.action }));
    for (const b of parsed) {
        const e: Problems['bands'][number] = {};
        if (!b.label) e.label = 'Name the band.';
        else if (b.label.length > 50) e.label = 'At most 50 characters.';
        if (Number.isNaN(b.min)) e.min = 'Whole number.';
        if (Number.isNaN(b.max)) e.max = 'Whole number.';
        if (!e.min && !e.max && b.min > b.max) e.max = 'Must be ≥ From.';
        if (!COLOR_RE.test(b.color)) e.color = 'Pick a colour.';
        if (b.action.length > 240) e.action = 'At most 240 characters.';
        if (Object.keys(e).length) {
            p.bands[b.i] = e;
            p.list.push(`Band ${b.i + 1}${b.label ? ` (${b.label})` : ''}: ${Object.values(e).join(' ')}`);
        }
    }
    const numeric = parsed.filter((b) => !Number.isNaN(b.min) && !Number.isNaN(b.max)).sort((a, b) => a.min - b.min);
    if (numeric.length === parsed.length && numeric.length >= 2 && enabled.length) {
        const gapOrOverlap = numeric.some((b, i) => i > 0 && b.min !== numeric[i - 1].max + 1);
        if (numeric[0].min !== min || numeric[numeric.length - 1].max !== max || gapOrOverlap) {
            p.list.push(`Bands must cover ${min}–${max} without gaps or overlaps: the lowest starts at ${min}, each next one starts right after the previous ends, the highest ends at ${max}.`);
        }
    }

    const tolerable = int(draft.tolerableMax);
    if (Number.isNaN(tolerable)) p.tolerableMax = 'Enter a whole number.';
    else if (tolerable < min || tolerable > max) p.tolerableMax = `Must be between ${min} and ${max}.`;
    if (p.tolerableMax) p.list.push(`Maximum tolerable score: ${p.tolerableMax}`);

    const severityMax = draft.factors.find((f) => f.code === 'S')?.max ?? 0;
    if (!Number.isInteger(draft.severityOverride) || draft.severityOverride < 0 || draft.severityOverride > severityMax) {
        p.severityOverride = `Choose Disabled or 1–${severityMax}.`;
        p.list.push(`Severity escalation override: ${p.severityOverride}`);
    }
    return p;
}

/** Converts a valid draft into the configuration the server expects (bands sorted by score). */
function fromDraft(draft: Draft, base: Config): Config {
    return {
        ...base,
        formula: draft.formula,
        factors: draft.factors.map((f) => ({ ...f })),
        bands: draft.bands
            .map((b) => ({ label: b.label.trim(), min: int(b.min), max: int(b.max), color: b.color, action: b.action.trim() }))
            .sort((a, b) => a.min - b.min),
        severityOverride: draft.severityOverride,
        tolerableMax: int(draft.tolerableMax),
    };
}

/** Problems next to the Save action: a one-line summary that expands to the full list. */
function ProblemsBar({ problems }: { problems: string[] }) {
    const [open, setOpen] = useState(false);
    if (!problems.length) return null;
    return (
        <div className='rounded-xl bg-amber-500/10 text-amber-300'>
            <button type='button' aria-expanded={open} onClick={() => setOpen((v) => !v)} className='flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm'>
                <AlertTriangle className='h-4 w-4 shrink-0' />
                <span className='min-w-0 flex-1 truncate'>
                    {problems.length === 1 ? problems[0] : `${problems.length} problems to fix before saving`}
                </span>
                {open ? <ChevronUp className='h-4 w-4 shrink-0' /> : <ChevronDown className='h-4 w-4 shrink-0' />}
            </button>
            {open && (
                <ul className='max-h-40 list-disc space-y-1 overflow-y-auto overscroll-contain px-8 pb-3 text-sm'>
                    {problems.map((text) => (
                        <li key={text}>{text}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function BandCard({
    band,
    index,
    errors,
    disabled,
    canRemove,
    onChange,
    onRemove,
}: {
    band: BandDraft;
    index: number;
    errors?: Problems['bands'][number];
    disabled: boolean;
    canRemove: boolean;
    onChange: (next: BandDraft) => void;
    onRemove: () => void;
}) {
    const id = `saf-band-${index}`;
    return (
        <Card className='space-y-3 p-3'>
            <div className='flex items-center gap-2'>
                <span className='h-6 w-6 shrink-0 rounded-full border border-line' style={{ backgroundColor: COLOR_RE.test(band.color) ? band.color : 'transparent' }} aria-hidden='true' />
                <p className='min-w-0 flex-1 truncate text-sm font-semibold text-ink'>
                    Band {index + 1}
                    {band.label.trim() ? ` · ${band.label.trim()}` : ''}
                </p>
                {!disabled && (
                    <button
                        type='button'
                        aria-label={`Remove band ${index + 1}`}
                        disabled={!canRemove}
                        onClick={onRemove}
                        className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-500/40 text-red-400 disabled:opacity-40'
                    >
                        <Trash2 className='h-4 w-4' />
                    </button>
                )}
            </div>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                <div className='col-span-2'>
                    <Field label='Name *' id={`${id}-label`} value={band.label} maxLength={50} disabled={disabled} error={errors?.label} onChange={(e) => onChange({ ...band, label: e.target.value })} />
                </div>
                <Field label='From score *' id={`${id}-min`} inputMode='numeric' value={band.min} disabled={disabled} error={errors?.min} onChange={(e) => onChange({ ...band, min: e.target.value.replace(/[^\d]/g, '') })} />
                <Field label='To score *' id={`${id}-max`} inputMode='numeric' value={band.max} disabled={disabled} error={errors?.max} onChange={(e) => onChange({ ...band, max: e.target.value.replace(/[^\d]/g, '') })} />
                <label htmlFor={`${id}-color`} className='block'>
                    <span className='mb-1 block text-sm text-soft'>Colour *</span>
                    <input
                        id={`${id}-color`}
                        type='color'
                        value={COLOR_RE.test(band.color) ? band.color : '#64748b'}
                        disabled={disabled}
                        onChange={(e) => onChange({ ...band, color: e.target.value })}
                        className='h-12 w-full cursor-pointer rounded-xl border border-line bg-panel p-1 disabled:opacity-60'
                    />
                    {errors?.color && <span className='mt-1 block text-xs text-red-300'>{errors.color}</span>}
                </label>
                <div className='col-span-2 sm:col-span-3'>
                    <Field label='Required action' id={`${id}-action`} value={band.action} maxLength={240} disabled={disabled} error={errors?.action} onChange={(e) => onChange({ ...band, action: e.target.value })} />
                </div>
            </div>
        </Card>
    );
}

export default function SafConfiguration() {
    const [saved, setSaved] = useState<Config | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [history, setHistory] = useState<Config[]>([]);
    const [canEdit, setCanEdit] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [reloadKey, setReloadKey] = useState(0);
    const [notice, setNotice] = useState('');
    const [exposure, setExposure] = useState(3);
    const [people, setPeople] = useState(1);
    const confirm = useConfirm();

    useEffect(() => {
        let live = true;
        setLoading(true);
        setLoadError('');
        callBackend<ReadResponse>('/api/org/saf/risk-matrix/read', {})
            .then((r) => {
                if (!live) return;
                setSaved(r.configuration);
                setDraft(toDraft(r.configuration));
                setHistory(Array.isArray(r.history) ? r.history : []);
                setCanEdit(r.canEdit === true);
            })
            .catch((err: unknown) => {
                if (!live) return;
                // Never fall back to built-in defaults: without the stored configuration nothing may be saved.
                setSaved(null);
                setDraft(null);
                setCanEdit(false);
                setLoadError(messageOf(err, 'Could not load the risk matrix configuration.'));
            })
            .finally(() => {
                if (live) setLoading(false);
            });
        return () => {
            live = false;
        };
    }, [reloadKey]);

    const title = 'SAF · Risk matrix';
    if (loading && !draft) {
        return (
            <Screen title={title} eyebrow='Safety configuration'>
                <Spinner />
            </Screen>
        );
    }
    if (!saved || !draft) {
        return (
            <Screen title={title} eyebrow='Safety configuration'>
                <Alert tone='error'>{loadError || 'Could not load the risk matrix configuration.'}</Alert>
                <Button type='button' variant='secondary' onClick={() => setReloadKey((k) => k + 1)}>
                    <RotateCcw className='h-4 w-4' /> Try again
                </Button>
            </Screen>
        );
    }

    const readOnly = !canEdit;
    const { enabled, min, max } = scoreRange(draft);
    const problems = validate(draft);
    const dirty = fingerprint(fromDraft(draft, saved)) !== fingerprint(saved);
    const canSave = canEdit && dirty && problems.list.length === 0;
    const nextVersion = Number(saved.version || 0) + 1;
    const factor = (code: string) => draft.factors.find((f) => f.code === code);
    const sortedBands = draft.bands
        .map((b) => ({ min: int(b.min), max: int(b.max), color: b.color }))
        .filter((b) => !Number.isNaN(b.min) && !Number.isNaN(b.max))
        .sort((a, b) => a.min - b.min);
    const colorOf = (n: number) => sortedBands.find((b) => n >= b.min && n <= b.max)?.color || '#64748b';
    const value = (code: string, p: number, s: number) => (code === 'P' ? p : code === 'S' ? s : code === 'E' ? exposure : people);
    const score = (p: number, s: number) =>
        draft.formula === 'multiply' ? enabled.reduce((n, f) => n * value(f.code, p, s), 1) : enabled.reduce((n, f) => n + value(f.code, p, s), 0);
    const pMax = factor('P')?.max || 1;
    const sMax = factor('S')?.max || 1;

    const edit = (change: (d: Draft) => Draft) => {
        setNotice('');
        setDraft((d) => (d ? change(d) : d));
    };
    const setFactor = (i: number, next: Partial<Factor>) => edit((d) => ({ ...d, factors: d.factors.map((f, j) => (j === i ? { ...f, ...next } : f)) }));
    const setBand = (i: number, next: BandDraft) => edit((d) => ({ ...d, bands: d.bands.map((b, j) => (j === i ? next : b)) }));

    /** New band: split the highest band in two when it spans more than one score, otherwise append at the top. */
    const addBand = () =>
        edit((d) => {
            if (d.bands.length >= MAX_BANDS) return d;
            const order = d.bands.map((b, i) => ({ i, min: int(b.min), max: int(b.max) })).filter((b) => !Number.isNaN(b.min) && !Number.isNaN(b.max));
            const top = order.sort((a, b) => b.max - a.max)[0];
            if (top && top.max > top.min) {
                const mid = Math.floor((top.min + top.max) / 2);
                const bands = d.bands.map((b, j) => (j === top.i ? { ...b, max: String(mid) } : b));
                return { ...d, bands: [...bands, { label: 'New band', min: String(mid + 1), max: String(top.max), color: '#64748b', action: 'Review required' }] };
            }
            return { ...d, bands: [...d.bands, { label: 'New band', min: String(max), max: String(max), color: '#64748b', action: 'Review required' }] };
        });

    /** Remove a band and let its neighbour take over its range, so coverage stays contiguous. */
    const removeBand = (i: number) =>
        edit((d) => {
            if (d.bands.length <= 2) return d;
            const gone = d.bands[i];
            const rest = d.bands.filter((_, j) => j !== i);
            const goneMin = int(gone.min);
            const goneMax = int(gone.max);
            if (Number.isNaN(goneMin) || Number.isNaN(goneMax)) return { ...d, bands: rest };
            const below = rest.findIndex((b) => int(b.max) === goneMin - 1);
            if (below >= 0) return { ...d, bands: rest.map((b, j) => (j === below ? { ...b, max: String(goneMax) } : b)) };
            const above = rest.findIndex((b) => int(b.min) === goneMax + 1);
            if (above >= 0) return { ...d, bands: rest.map((b, j) => (j === above ? { ...b, min: String(goneMin) } : b)) };
            return { ...d, bands: rest };
        });

    const askSave = () => {
        if (!canSave) return;
        const configuration = fromDraft(draft, saved);
        confirm.ask(
            {
                title: `Publish risk matrix version ${nextVersion}`,
                message: (
                    <div className='space-y-2'>
                        <p>
                            This creates <strong className='text-ink'>version {nextVersion}</strong> of the risk matrix for the <strong className='text-ink'>whole organization</strong>. Every risk assessment saved from now on is
                            scored with it; version {saved.version} moves to history and earlier scores keep the version they were made with.
                        </p>
                        <p>
                            Score range {min}–{max} · {configuration.bands.length} bands · tolerable up to {configuration.tolerableMax} · severity override{' '}
                            {configuration.severityOverride ? `at S ${configuration.severityOverride}` : 'disabled'}.
                        </p>
                    </div>
                ),
                confirmLabel: `Publish version ${nextVersion}`,
                acknowledge: 'The factors, bands and cut-offs were reviewed by a competent safety person and are fit for operational use.',
            },
            async () => {
                const r = await callBackend<{ configuration: Config }>('/api/org/saf/risk-matrix/save', { configuration });
                setHistory((h) => [...h, saved]);
                setSaved(r.configuration);
                setDraft(toDraft(r.configuration));
                setNotice(`Version ${r.configuration.version} saved and published.`);
            },
        );
    };

    return (
        <Screen
            title={title}
            eyebrow='Safety configuration'
            subtitle={`Version ${saved.version}${saved.updatedAt ? ` · ${new Date(saved.updatedAt).toLocaleDateString()}` : ''} · ${history.length} earlier versions`}
            actions={
                canEdit ? (
                    <Button type='button' disabled={!canSave} onClick={askSave}>
                        <Save className='h-4 w-4' /> Save
                    </Button>
                ) : (
                    <Badge>Read only</Badge>
                )
            }
            toolbar={canEdit && problems.list.length ? <ProblemsBar problems={problems.list} /> : undefined}
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {readOnly && <Alert tone='info'>You can view the risk matrix. Changing it needs the SAF configure permission in your own role.</Alert>}
            {canEdit && dirty && (
                <div className='flex items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm text-soft'>
                    <span>Unsaved changes to version {saved.version}.</span>
                    <Button
                        type='button'
                        variant='secondary'
                        onClick={() => {
                            setNotice('');
                            setDraft(toDraft(saved));
                        }}
                    >
                        <RotateCcw className='h-4 w-4' /> Undo
                    </Button>
                </div>
            )}

            <Card className='space-y-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Assessment factors</h2>
                    <InfoTip label='Assessment factors'>
                        Every assessment rates all four factors. Only enabled factors are used in the score; the scale maximum sets the highest rating people can choose.
                    </InfoTip>
                </div>
                {problems.factors && <Alert tone='error'>{problems.factors}</Alert>}
                <ul className='divide-y divide-line'>
                    {draft.factors.map((f, i) => (
                        <li key={f.code} className='grid grid-cols-[1fr_8rem] items-end gap-3 py-2'>
                            <label className='flex min-h-[48px] items-center gap-3 text-sm text-ink'>
                                <input type='checkbox' className='h-5 w-5 shrink-0 accent-emerald-500' checked={f.enabled} disabled={readOnly} onChange={(e) => setFactor(i, { enabled: e.target.checked })} />
                                <span>
                                    {f.label} ({f.code})<span className='block text-xs text-muted'>{f.enabled ? 'Used in the score' : 'Rated, not scored'}</span>
                                </span>
                            </label>
                            <SelectField label='Scale max' id={`saf-factor-${f.code}`} value={f.max} disabled={readOnly} onChange={(e) => setFactor(i, { max: Number(e.target.value) })}>
                                {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </SelectField>
                        </li>
                    ))}
                </ul>
                <SelectField label='Formula *' id='saf-formula' value={draft.formula} disabled={readOnly} onChange={(e) => edit((d) => ({ ...d, formula: e.target.value === 'add' ? 'add' : 'multiply' }))}>
                    <option value='multiply'>Multiply enabled factors</option>
                    <option value='add'>Add enabled factors</option>
                </SelectField>
                <p className='text-sm font-semibold text-ink'>
                    Score range: {min}–{max}
                </p>
            </Card>

            <section className='space-y-3' aria-labelledby='saf-bands-title'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 id='saf-bands-title' className='text-sm font-semibold text-ink'>
                        Risk classifications and cut-offs ({draft.bands.length})
                    </h2>
                    {!readOnly && (
                        <Button type='button' variant='secondary' disabled={draft.bands.length >= MAX_BANDS} onClick={addBand}>
                            <Plus className='h-4 w-4' /> Add band
                        </Button>
                    )}
                </div>
                {draft.bands.map((b, i) => (
                    <BandCard key={i} band={b} index={i} errors={problems.bands[i]} disabled={readOnly} canRemove={draft.bands.length > 2} onChange={(next) => setBand(i, next)} onRemove={() => removeBand(i)} />
                ))}
                {problems.list.some((t) => t.startsWith('Bands must cover')) ? (
                    <Alert tone='warn'>Adjust the From/To scores so the bands cover {min}–{max} without gaps or overlaps.</Alert>
                ) : (
                    <p className='text-sm text-emerald-300'>All possible scores ({min}–{max}) are covered.</p>
                )}
            </section>

            <Card className='space-y-3'>
                <h2 className='text-sm font-semibold text-ink'>Tolerability and escalation</h2>
                <Field
                    label='Maximum tolerable score *'
                    id='saf-tolerable'
                    inputMode='numeric'
                    value={draft.tolerableMax}
                    disabled={readOnly}
                    error={problems.tolerableMax}
                    hint={`Scores above this are intolerable. Between ${min} and ${max}.`}
                    onChange={(e) => edit((d) => ({ ...d, tolerableMax: e.target.value.replace(/[^\d]/g, '') }))}
                />
                <SelectField
                    label='Severity escalation override'
                    id='saf-override'
                    value={draft.severityOverride}
                    disabled={readOnly}
                    error={problems.severityOverride}
                    hint='Flags assessments for escalation at or above this severity; it never changes the numerical score.'
                    onChange={(e) => edit((d) => ({ ...d, severityOverride: Number(e.target.value) }))}
                >
                    <option value={0}>Disabled</option>
                    {Array.from({ length: sMax }, (_, n) => n + 1).map((n) => (
                        <option key={n} value={n}>
                            Severity {n}
                        </option>
                    ))}
                </SelectField>
            </Card>

            <Card className='space-y-3'>
                <h2 className='text-sm font-semibold text-ink'>Matrix preview</h2>
                <div className='grid grid-cols-2 gap-3'>
                    {(['E', 'A'] as const).map((k) => (
                        <SelectField
                            key={k}
                            label={`${factor(k)?.label ?? k}${factor(k)?.enabled ? '' : ' (not scored)'}`}
                            id={`saf-preview-${k}`}
                            value={Math.min(k === 'E' ? exposure : people, factor(k)?.max || 1)}
                            onChange={(e) => (k === 'E' ? setExposure(Number(e.target.value)) : setPeople(Number(e.target.value)))}
                        >
                            {Array.from({ length: factor(k)?.max || 1 }, (_, n) => n + 1).map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </SelectField>
                    ))}
                </div>
                <div className='overflow-x-auto overscroll-x-contain'>
                    <div className='min-w-[16rem] max-w-lg space-y-1'>
                        {Array.from({ length: pMax }, (_, i) => pMax - i).map((p) => (
                            <div key={p} className='flex gap-1'>
                                <span className='flex w-6 shrink-0 items-center text-xs text-muted'>P{p}</span>
                                {Array.from({ length: sMax }, (_, i) => i + 1).map((s) => {
                                    const n = score(p, s);
                                    return (
                                        <div
                                            key={s}
                                            role='img'
                                            aria-label={`Probability ${p}, severity ${s}: score ${n}`}
                                            className='flex aspect-square min-w-0 flex-1 items-center justify-center rounded text-xs font-semibold'
                                            style={{ backgroundColor: colorOf(n), color: '#ffffff' }}
                                        >
                                            {n}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        <div className='flex gap-1 pl-7'>
                            {Array.from({ length: sMax }, (_, i) => i + 1).map((s) => (
                                <span key={s} className='min-w-0 flex-1 text-center text-xs text-muted'>
                                    S{s}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
                <p className='text-xs text-muted'>Probability (rows) × severity (columns), with the exposure and people-affected values chosen above for enabled factors.</p>
            </Card>

            <p className='px-1 text-xs text-muted'>
                Changes create a new version; {history.length} earlier versions are retained. Draft cut-off values require competent safety review before operational use.
            </p>
            {confirm.sheet}
        </Screen>
    );
}
