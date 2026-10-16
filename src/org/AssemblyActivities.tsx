import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Plus, Save, ShieldAlert, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { InfoTip, Screen, Segmented, messageOf, useConfirm, type ConfirmOptions } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';

// Assembly activity list (MNT) for one assembly of the organisation structure.
// Each activity is a preventive (PM) or autonomous (AM) maintenance task described with MNT master data
// (category, trigger, priority, duration), the HR skills it needs (3–30), the job roles that may execute it,
// the failure modes / impacts it addresses and a 12-question safety screening that indicates isolation (LOTO)
// and permit needs. The whole list is saved at once (POST /api/org/assembly/activities/save); the server checks
// every activity again and answers 403 with a message when the person may not edit at this unit.
//   list    RichTable mnt.assembly.activities; tap a row to open the editor
//   editor  full-height form, Save / Cancel / Remove on top, inline validation that mirrors the server rules

interface Ref {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    selectable?: boolean;
}

interface Activity {
    id: string;
    name: string;
    description?: string;
    instructions?: string;
    /** Older activities hold one failure mode in these two fields; newer ones use the lists below. */
    failureCategory?: string;
    failureSubcategory?: string;
    failureCategories?: string[];
    failureSubcategories?: string[];
    impactCategories?: string[];
    impactSubcategories?: string[];
    safetyScreening?: Record<string, boolean>;
    maintenanceType?: string;
    executionRoles?: string[];
    resourceType?: string;
    skillCategory?: string;
    skillSubcategory?: string;
    type: 'PM' | 'AM';
    category: string;
    subcategory: string;
    trigger: string;
    frequency: string;
    priority: string;
    duration: number;
    durationUnit: string;
    skills: string[];
    triggerValue?: number;
    triggerParameter?: string;
    triggerUnit?: string;
}

interface Role {
    code: string;
    title: string;
    operatingLevel: string;
    coreSkills: string[];
}

interface Data {
    items: Activity[];
    metadata: Record<string, Ref[]>;
    skills: Ref[];
    roles?: Role[];
}

const SAFETY_QUESTIONS = [
    { id: 'equipmentRunning', label: 'Will the equipment be running during this activity?' },
    { id: 'bodyExposure', label: 'Will any part of the body enter the equipment or danger zone?' },
    { id: 'toolsOrParts', label: 'Will tools be used, assemblies removed or parts changed?' },
    { id: 'guardsRemoved', label: 'Will any guard or safety device be removed or bypassed?' },
    { id: 'liveTesting', label: 'Will diagnosis or testing be performed on live equipment?' },
    { id: 'jogging', label: 'Will the equipment be inched or jogged?' },
    { id: 'storedEnergy', label: 'Could electrical, pneumatic, hydraulic, mechanical, thermal or other stored energy be present?' },
    { id: 'electricalWork', label: 'Will electrical work be performed?' },
    { id: 'hotWork', label: 'Will welding, cutting, grinding or other hot work occur?' },
    { id: 'workAtHeight', label: 'Will work at height be required?' },
    { id: 'confinedSpace', label: 'Will anyone enter a confined space?' },
    { id: 'hazardousChemicals', label: 'Will hazardous chemicals be handled or released?' },
] as const;

/** Calendar frequencies that are not offered for activities. */
const HIDDEN_FREQUENCIES = ['FRQ-012', 'FRQ-013', 'FRQ-016', 'FRQ-017', 'FRQ-018', 'FRQ-019', 'FRQ-020', 'FRQ-021', 'FRQ-022'];
/** Triggers that carry a number (running hours, cycles, condition threshold). */
const VALUE_TRIGGERS = ['MAI-002', 'MAI-003', 'MAI-004'];
const MAX_ACTIVITIES = 300;
const MAX_SKILLS = 30;
const MIN_SKILLS = 3;
const SKILLS_SHOWN = 150;

type SectionKey = 'basics' | 'class' | 'schedule' | 'skills' | 'safety' | 'roles' | 'failure';
const SECTIONS: Array<{ value: SectionKey; label: string }> = [
    { value: 'basics', label: 'Activity' },
    { value: 'class', label: 'Classification' },
    { value: 'schedule', label: 'Schedule' },
    { value: 'skills', label: 'HR skills' },
    { value: 'safety', label: 'Safety' },
    { value: 'roles', label: 'Roles' },
    { value: 'failure', label: 'Failure & impact' },
];

interface Problem {
    section: SectionKey;
    message: string;
}
interface Validation {
    /** Inline messages per field key. */
    errors: Record<string, string>;
    /** Short list shown next to Save. */
    problems: Problem[];
}

const newId = () => `ACT-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

function blank(): Activity {
    return {
        id: newId(),
        name: '',
        description: '',
        instructions: '',
        failureCategory: '',
        failureSubcategory: '',
        failureCategories: [],
        failureSubcategories: [],
        impactCategories: [],
        impactSubcategories: [],
        safetyScreening: {},
        maintenanceType: '',
        executionRoles: [],
        resourceType: '',
        skillCategory: '',
        skillSubcategory: '',
        type: 'PM',
        category: '',
        subcategory: '',
        trigger: '',
        frequency: '',
        triggerValue: 0,
        triggerParameter: '',
        triggerUnit: '',
        priority: '',
        duration: 30,
        durationUnit: 'DUR-001',
        skills: [],
    };
}

/** Fill list fields older activities may lack (a single failure mode becomes a one-item list). */
function normalise(a: Activity): Activity {
    return {
        ...a,
        description: a.description ?? '',
        instructions: a.instructions ?? '',
        failureCategories: a.failureCategories ?? (a.failureCategory ? [a.failureCategory] : []),
        failureSubcategories: a.failureSubcategories ?? (a.failureSubcategory ? [a.failureSubcategory] : []),
        impactCategories: a.impactCategories ?? [],
        impactSubcategories: a.impactSubcategories ?? [],
        safetyScreening: a.safetyScreening ?? {},
        executionRoles: a.executionRoles ?? [],
        skills: a.skills ?? [],
    };
}

const meta = (data: Data, key: string): Ref[] => data.metadata[key] ?? [];
const labelOf = (data: Data, key: string, code: string) => (code ? meta(data, key).find((x) => x.code === code)?.label || code : '');
const typeKey = (type: string) => (type === 'AM' ? 'amActivities' : 'pmActivities');
const frequencies = (data: Data) => meta(data, 'maintenanceFrequencies').filter((x) => !HIDDEN_FREQUENCIES.includes(x.code));
const toggleIn = (list: string[], code: string, on: boolean) => (on ? [...new Set([...list, code])] : list.filter((c) => c !== code));

/** Advisory reading of the safety screening answers. */
function screening(s: Record<string, boolean> = {}) {
    const answered = SAFETY_QUESTIONS.filter((q) => typeof s[q.id] === 'boolean').length;
    const loto = !!(s.bodyExposure || s.toolsOrParts || s.guardsRemoved || s.storedEnergy || s.electricalWork);
    const live = !!(s.liveTesting || s.jogging || (s.equipmentRunning && s.bodyExposure));
    const permits = [
        s.hotWork && 'Hot work permit',
        s.workAtHeight && 'Work at height permit',
        s.confinedSpace && 'Confined space entry permit',
        s.electricalWork && 'Electrical work authorization',
        s.hazardousChemicals && 'Chemical handling authorization',
    ].filter((p): p is string => !!p);
    return { answered, complete: answered === SAFETY_QUESTIONS.length, loto, live, permits };
}

function intervalText(a: Activity, data: Data): string {
    if (a.trigger === 'MAI-001') return labelOf(data, 'maintenanceFrequencies', a.frequency);
    if (a.trigger === 'MAI-002') return `Every ${a.triggerValue ?? 0} running hours`;
    if (a.trigger === 'MAI-003') return `Every ${a.triggerValue ?? 0} cycles`;
    if (a.trigger === 'MAI-004') return `${a.triggerParameter ?? ''} at ${a.triggerValue ?? 0} ${a.triggerUnit ?? ''}`.trim();
    if (a.trigger === 'MAI-007') return a.triggerParameter ?? '';
    if (a.trigger === 'MAI-005') return 'On failure';
    if (a.trigger === 'MAI-006') return 'On inspection finding';
    return '';
}

/** Client copy of the server rules (backend/assemblyActivities.ts), plus: every screening question answered. */
function validate(a: Activity, triggerValue: string, duration: string, data: Data): Validation {
    const errors: Record<string, string> = {};
    const problems: Problem[] = [];
    const add = (key: string, section: SectionKey, message: string, listed = true) => {
        if (!errors[key]) errors[key] = message;
        if (listed) problems.push({ section, message });
    };
    const has = (key: string, code: string) => !!code && meta(data, key).some((x) => x.code === code);

    const name = a.name.trim();
    if (name.length < 3) add('name', 'basics', 'Activity name needs at least 3 characters.');
    else if (name.length > 180) add('name', 'basics', 'Activity name can have at most 180 characters.');
    if ((a.description ?? '').trim().length > 2000) add('description', 'basics', 'Description can have at most 2000 characters.');
    if ((a.instructions ?? '').trim().length > 5000) add('instructions', 'basics', 'Instructions can have at most 5000 characters.');

    const key = typeKey(a.type);
    if (a.type !== 'PM' && a.type !== 'AM') add('type', 'class', 'Select the activity type.');
    if (!meta(data, key).some((x) => x.code === a.category && !x.category)) add('category', 'class', 'Select a category.');
    if (a.subcategory && !meta(data, key).some((x) => x.code === a.subcategory && x.category === a.category)) add('subcategory', 'class', 'Select a subcategory of the chosen category.');
    else if (a.type === 'PM' && !a.subcategory) add('subcategory', 'class', 'A preventive maintenance activity needs a subcategory.');
    if (a.maintenanceType && !has('maintenanceTypes', a.maintenanceType)) add('maintenanceType', 'class', 'Select a valid maintenance type.');
    if (a.resourceType && !has('resourceTypes', a.resourceType)) add('resourceType', 'class', 'Select a valid resource type.');
    if (!has('workPriorities', a.priority)) add('priority', 'class', 'Select a work priority.');

    const value = triggerValue.trim();
    const n = Number(value);
    if (!has('maintenanceTriggers', a.trigger)) add('trigger', 'schedule', 'Select a maintenance trigger.');
    if (a.trigger === 'MAI-001' && !frequencies(data).some((x) => x.code === a.frequency)) add('frequency', 'schedule', 'Select a calendar frequency.');
    if ((a.trigger === 'MAI-002' || a.trigger === 'MAI-003') && (!value || !Number.isSafeInteger(n) || n < 1)) {
        add('triggerValue', 'schedule', `Enter a whole number of ${a.trigger === 'MAI-002' ? 'running hours' : 'cycles'} of 1 or more.`);
    }
    if (a.trigger === 'MAI-004') {
        if (!(a.triggerParameter ?? '').trim()) add('triggerParameter', 'schedule', 'Enter the monitored parameter.');
        if (!value || !Number.isFinite(n)) add('triggerValue', 'schedule', 'Enter the threshold as a number.');
        if (!(a.triggerUnit ?? '').trim()) add('triggerUnit', 'schedule', 'Enter the threshold unit.');
    }
    if (a.trigger === 'MAI-007' && !(a.triggerParameter ?? '').trim()) add('triggerParameter', 'schedule', 'Enter the regulatory interval.');
    const d = Number(duration.trim());
    if (!duration.trim() || !Number.isFinite(d) || d <= 0) add('duration', 'schedule', 'Duration must be a number greater than 0.');
    else if (d > 100000) add('duration', 'schedule', 'Duration can be at most 100000.');
    if (!has('maintenanceDurations', a.durationUnit)) add('durationUnit', 'schedule', 'Select a duration unit.');

    if (a.skills.length < MIN_SKILLS) add('skills', 'skills', `Select at least ${MIN_SKILLS} HR skills (${a.skills.length} selected).`);
    else if (a.skills.length > MAX_SKILLS) add('skills', 'skills', `Select at most ${MAX_SKILLS} HR skills.`);
    if (a.skills.some((c) => !data.skills.some((s) => s.code === c))) add('skills', 'skills', 'Some selected skills are no longer active in the HR skills master. Remove them.');

    const s = a.safetyScreening ?? {};
    const open = SAFETY_QUESTIONS.filter((q) => typeof s[q.id] !== 'boolean');
    open.forEach((q) => add(`safety.${q.id}`, 'safety', 'Answer yes or no.', false));
    if (open.length) problems.push({ section: 'safety', message: `Answer all safety screening questions (${open.length} open).` });

    const roles = a.executionRoles ?? [];
    if (roles.some((c) => !(data.roles ?? []).some((r) => r.code === c))) add('roles', 'roles', 'Some selected roles can no longer execute activities here. Untick them.');

    const fCats = a.failureCategories ?? [];
    const fSubs = a.failureSubcategories ?? [];
    const iCats = a.impactCategories ?? [];
    const iSubs = a.impactSubcategories ?? [];
    const failures = meta(data, 'failureModes');
    const impacts = meta(data, 'impacts');
    if (fCats.some((c) => !failures.some((x) => x.code === c && !x.category)) || fSubs.some((c) => !failures.some((x) => x.code === c && fCats.includes(x.category)))) {
        add('failure', 'failure', 'Some failure modes are no longer available. Review the failure mode lists.');
    }
    if (iCats.some((c) => !impacts.some((x) => x.code === c && !x.category)) || iSubs.some((c) => !impacts.some((x) => x.code === c && iCats.includes(x.category)))) {
        add('impact', 'failure', 'Some impacts are no longer available. Review the impact lists.');
    }
    return { errors, problems };
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
    return (
        <div id={id} className='scroll-mt-3'>
            <Card className='space-y-3'>
                <div>
                    <h2 className='text-base font-semibold text-ink'>{title}</h2>
                    {note && <p className='mt-1 text-xs text-muted'>{note}</p>}
                </div>
                {children}
            </Card>
        </div>
    );
}

function Counter({ length, max, error }: { length: number; max: number; error?: string }) {
    return (
        <p role={error ? 'alert' : undefined} className={`-mt-2 text-right text-xs ${error ? 'text-red-300' : 'text-muted'}`}>
            {error ? `${error} ` : ''}
            {length}/{max}
        </p>
    );
}

interface CheckItem {
    code: string;
    label: string;
    hint?: string;
}

/** Scrollable multi-select list with 44px rows. */
function CheckList({ label, items, selected, full, empty, onToggle }: { label: string; items: CheckItem[]; selected: string[]; full?: boolean; empty: string; onToggle: (code: string, on: boolean) => void }) {
    if (!items.length) return <p className='text-sm text-muted'>{empty}</p>;
    return (
        <ul aria-label={label} className='max-h-72 space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border border-line p-1'>
            {items.map((x) => {
                const on = selected.includes(x.code);
                return (
                    <li key={x.code}>
                        <label className='flex min-h-[44px] items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink active:bg-page'>
                            <input type='checkbox' className='h-5 w-5 shrink-0 accent-emerald-500' checked={on} disabled={!on && full} onChange={(e) => onToggle(x.code, e.target.checked)} />
                            <span className='min-w-0 flex-1'>
                                {x.label} <span className='text-xs text-muted'>({x.code})</span>
                                {x.hint && <span className='block text-xs text-muted'>{x.hint}</span>}
                            </span>
                        </label>
                    </li>
                );
            })}
        </ul>
    );
}

/** Required yes/no answer as two 44px buttons (no blank answer can be saved). */
function YesNo({ id, label, value, error, onChange }: { id: string; label: string; value: boolean | undefined; error?: string; onChange: (value: boolean) => void }) {
    return (
        <div className='border-b border-line py-3 last:border-0'>
            <p id={`${id}-q`} className='text-sm text-ink'>
                {label} *
            </p>
            <div role='radiogroup' aria-labelledby={`${id}-q`} className='mt-2 grid grid-cols-2 gap-2'>
                {[true, false].map((v) => {
                    const on = value === v;
                    const tone = v ? 'border-amber-400 bg-amber-500/10 text-amber-300' : 'border-brand bg-brand/10 text-brandsoft';
                    return (
                        <button
                            key={String(v)}
                            type='button'
                            role='radio'
                            aria-checked={on}
                            onClick={() => onChange(v)}
                            className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium ${on ? tone : 'border-line text-soft active:bg-page'}`}
                        >
                            {on && <Check className='h-4 w-4' />}
                            {v ? 'Yes' : 'No'}
                        </button>
                    );
                })}
            </div>
            {error && (
                <p role='alert' className='mt-1 text-xs text-red-300'>
                    {error}
                </p>
            )}
        </div>
    );
}

function refOptions(list: Ref[]) {
    return list.map((x) => (
        <option key={x.code} value={x.code}>
            {x.label} ({x.code})
        </option>
    ));
}

/** Problems that keep Save disabled; opening the list also reveals every inline message. */
function ProblemList({ problems, onOpen }: { problems: Problem[]; onOpen: () => void }) {
    if (!problems.length) return null;
    const sectionLabel = (k: SectionKey) => SECTIONS.find((s) => s.value === k)?.label ?? '';
    return (
        <details onToggle={(e) => e.currentTarget.open && onOpen()} className='rounded-xl bg-amber-500/10 text-amber-300'>
            <summary className='flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-sm font-medium'>
                <AlertTriangle className='h-4 w-4 shrink-0' />
                {problems.length} {problems.length === 1 ? 'problem' : 'problems'} to fix before saving
            </summary>
            <ul className='list-disc space-y-1 pb-3 pl-9 pr-3 text-sm'>
                {problems.map((p, i) => (
                    <li key={i}>
                        <span className='font-medium'>{sectionLabel(p.section)}:</span> {p.message}
                    </li>
                ))}
            </ul>
        </details>
    );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function ActivityEditor({
    data,
    initial,
    isNew,
    busy,
    error,
    ask,
    onCancel,
    onSave,
    onRemove,
}: {
    data: Data;
    initial: Activity;
    isNew: boolean;
    busy: boolean;
    error: string;
    ask: (options: ConfirmOptions, run: (reason: string) => Promise<void>) => void;
    onCancel: () => void;
    onSave: (item: Activity) => void;
    onRemove: () => void;
}) {
    const [item, setItem] = useState<Activity>(() => normalise(initial));
    const [triggerValue, setTriggerValue] = useState(() => (VALUE_TRIGGERS.includes(initial.trigger) && Number.isFinite(initial.triggerValue) ? String(initial.triggerValue) : ''));
    const [duration, setDuration] = useState(() => (Number.isFinite(initial.duration) ? String(initial.duration) : ''));
    const [baseline] = useState(() => JSON.stringify([normalise(initial), triggerValue, duration]));
    const [touched, setTouched] = useState<string[]>([]);
    const [showAll, setShowAll] = useState(!isNew);
    const [section, setSection] = useState<SectionKey>('basics');
    const [search, setSearch] = useState('');

    const touch = (...keys: string[]) => setTouched((t) => [...new Set([...t, ...keys])]);
    const update = (part: Partial<Activity>) => {
        setItem((x) => ({ ...x, ...part }));
        touch(...Object.keys(part));
    };
    const { errors, problems } = validate(item, triggerValue, duration, data);
    const err = (key: string) => (showAll || touched.includes(key) ? errors[key] : undefined);
    const dirty = JSON.stringify([item, triggerValue, duration]) !== baseline;

    const jump = (key: SectionKey) => {
        setSection(key);
        document.getElementById(`act-sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const cancel = () => {
        if (!dirty) return onCancel();
        ask({ title: 'Discard changes?', message: 'Your changes to this activity have not been saved and will be lost.', confirmLabel: 'Discard changes', tone: 'danger' }, async () => onCancel());
    };
    const save = () => {
        if (problems.length) {
            setShowAll(true);
            return;
        }
        const valueTrigger = VALUE_TRIGGERS.includes(item.trigger);
        onSave({
            ...item,
            name: item.name.trim(),
            description: (item.description ?? '').trim(),
            instructions: (item.instructions ?? '').trim(),
            triggerParameter: (item.triggerParameter ?? '').trim(),
            triggerUnit: (item.triggerUnit ?? '').trim(),
            triggerValue: valueTrigger ? Number(triggerValue.trim()) : (item.triggerValue ?? 0),
            frequency: item.trigger === 'MAI-001' ? item.frequency : '',
            duration: Number(duration.trim()),
        });
    };

    const kind = typeKey(item.type);
    const categories = meta(data, kind).filter((x) => !x.category);
    const subcategories = meta(data, kind).filter((x) => x.category === item.category);
    const failures = meta(data, 'failureModes');
    const impacts = meta(data, 'impacts');
    const fCats = item.failureCategories ?? [];
    const fSubs = item.failureSubcategories ?? [];
    const iCats = item.impactCategories ?? [];
    const iSubs = item.impactSubcategories ?? [];
    const answers = item.safetyScreening ?? {};
    const advice = screening(answers);
    const roles = data.roles ?? [];

    const skillCats = [...new Set(data.skills.map((s) => s.category).filter(Boolean))].sort();
    const skillSubs = [...new Set(data.skills.filter((s) => !item.skillCategory || s.category === item.skillCategory).map((s) => s.subcategory).filter(Boolean))].sort();
    const q = search.trim().toLowerCase();
    const matches = data.skills.filter(
        (s) =>
            (!item.skillCategory || s.category === item.skillCategory) &&
            (!item.skillSubcategory || s.subcategory === item.skillSubcategory) &&
            (!q || `${s.label} ${s.code} ${s.category} ${s.subcategory}`.toLowerCase().includes(q)),
    );
    const skillName = (code: string) => data.skills.find((s) => s.code === code)?.label || code;
    const counts = SECTIONS.map((s) => ({ ...s, count: problems.filter((p) => p.section === s.value).length || undefined }));

    return (
        <Screen
            title={isNew ? 'New activity' : item.name.trim() || 'Activity'}
            eyebrow={isNew ? 'Assembly activity' : `Assembly activity · ${item.type}`}
            actions={
                <>
                    {!isNew && (
                        <button type='button' aria-label='Remove activity' disabled={busy} onClick={onRemove} className='flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/40 text-red-400 disabled:opacity-50'>
                            <Trash2 className='h-5 w-5' />
                        </button>
                    )}
                    <Button variant='secondary' disabled={busy} onClick={cancel} aria-label='Cancel' className='px-3'>
                        <X className='h-4 w-4' />
                        <span className='hidden sm:inline'>Cancel</span>
                    </Button>
                    <Button busy={busy} disabled={problems.length > 0} onClick={save}>
                        {!busy && <Save className='h-4 w-4' />}
                        Save
                    </Button>
                </>
            }
            toolbar={<Segmented label='Form sections' value={section} options={counts} onChange={jump} />}
        >
            {error && <Alert tone='error'>{error}</Alert>}
            <ProblemList problems={problems} onOpen={() => setShowAll(true)} />

            <Section id='act-sec-basics' title='Activity'>
                <Field id='act-name' label='Activity name *' maxLength={180} autoComplete='off' value={item.name} onChange={(e) => update({ name: e.target.value })} hint='3 to 180 characters' error={err('name')} />
                <TextArea id='act-desc' label='Description (optional)' rows={3} maxLength={2000} value={item.description ?? ''} onChange={(e) => update({ description: e.target.value })} />
                <Counter length={(item.description ?? '').trim().length} max={2000} error={err('description')} />
                <TextArea id='act-instr' label='Work instructions (optional)' rows={5} maxLength={5000} value={item.instructions ?? ''} onChange={(e) => update({ instructions: e.target.value })} />
                <Counter length={(item.instructions ?? '').trim().length} max={5000} error={err('instructions')} />
            </Section>

            <Section id='act-sec-class' title='Classification' note='MNT master data. Changing the activity type clears category and subcategory.'>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <SelectField id='act-type' label='Activity type *' value={item.type} error={err('type')} onChange={(e) => update({ type: e.target.value as 'PM' | 'AM', category: '', subcategory: '' })}>
                        <option value='PM'>Preventive maintenance (PM)</option>
                        <option value='AM'>Autonomous maintenance (AM)</option>
                    </SelectField>
                    <SelectField id='act-mtype' label='Maintenance type (optional)' value={item.maintenanceType ?? ''} error={err('maintenanceType')} onChange={(e) => update({ maintenanceType: e.target.value })}>
                        <option value=''>Not set</option>
                        {refOptions(meta(data, 'maintenanceTypes'))}
                    </SelectField>
                    <SelectField id='act-cat' label='Category *' value={item.category} error={err('category')} onChange={(e) => update({ category: e.target.value, subcategory: '' })}>
                        <option value=''>Select category</option>
                        {refOptions(categories)}
                    </SelectField>
                    <SelectField
                        id='act-sub'
                        label={item.type === 'PM' ? 'Subcategory *' : 'Subcategory (optional)'}
                        value={item.subcategory}
                        disabled={!item.category}
                        error={err('subcategory')}
                        hint={item.category ? undefined : 'Choose a category first'}
                        onChange={(e) => update({ subcategory: e.target.value })}
                    >
                        <option value=''>Select subcategory</option>
                        {refOptions(subcategories)}
                    </SelectField>
                    <SelectField id='act-res' label='Resource type (optional)' value={item.resourceType ?? ''} error={err('resourceType')} onChange={(e) => update({ resourceType: e.target.value })}>
                        <option value=''>Not set</option>
                        {refOptions(meta(data, 'resourceTypes'))}
                    </SelectField>
                    <SelectField id='act-prio' label='Work priority *' value={item.priority} error={err('priority')} onChange={(e) => update({ priority: e.target.value })}>
                        <option value=''>Select priority</option>
                        {refOptions(meta(data, 'workPriorities'))}
                    </SelectField>
                </div>
            </Section>

            <Section id='act-sec-schedule' title='Schedule' note='When the activity is due and how long it takes.'>
                <SelectField
                    id='act-trigger'
                    label='Maintenance trigger *'
                    value={item.trigger}
                    error={err('trigger')}
                    onChange={(e) => {
                        setTriggerValue('');
                        update({ trigger: e.target.value, frequency: '', triggerValue: 0, triggerParameter: '', triggerUnit: '' });
                    }}
                >
                    <option value=''>Select trigger</option>
                    {refOptions(meta(data, 'maintenanceTriggers'))}
                </SelectField>
                {item.trigger === 'MAI-001' && (
                    <SelectField id='act-freq' label='Calendar frequency *' value={item.frequency} error={err('frequency')} onChange={(e) => update({ frequency: e.target.value })}>
                        <option value=''>Select frequency</option>
                        {refOptions(frequencies(data))}
                    </SelectField>
                )}
                {(item.trigger === 'MAI-002' || item.trigger === 'MAI-003') && (
                    <Field
                        id='act-interval'
                        label={item.trigger === 'MAI-002' ? 'Every number of running hours *' : 'Every number of cycles *'}
                        inputMode='numeric'
                        autoComplete='off'
                        placeholder={item.trigger === 'MAI-002' ? 'e.g. 500' : 'e.g. 10000'}
                        value={triggerValue}
                        error={err('triggerValue')}
                        hint='Whole number, 1 or more'
                        onChange={(e) => {
                            setTriggerValue(e.target.value);
                            touch('triggerValue');
                        }}
                    />
                )}
                {item.trigger === 'MAI-004' && (
                    <>
                        <Field id='act-param' label='Monitored parameter *' maxLength={120} placeholder='e.g. Vibration, temperature, pressure' value={item.triggerParameter ?? ''} error={err('triggerParameter')} onChange={(e) => update({ triggerParameter: e.target.value })} />
                        <div className='grid grid-cols-2 gap-3'>
                            <Field
                                id='act-threshold'
                                label='Threshold value *'
                                inputMode='decimal'
                                autoComplete='off'
                                value={triggerValue}
                                error={err('triggerValue')}
                                onChange={(e) => {
                                    setTriggerValue(e.target.value);
                                    touch('triggerValue');
                                }}
                            />
                            <Field id='act-unit' label='Unit *' maxLength={20} placeholder='e.g. mm/s, °C' value={item.triggerUnit ?? ''} error={err('triggerUnit')} onChange={(e) => update({ triggerUnit: e.target.value })} />
                        </div>
                    </>
                )}
                {item.trigger === 'MAI-007' && (
                    <Field id='act-reg' label='Regulatory interval *' maxLength={120} placeholder='e.g. Annual statutory inspection' value={item.triggerParameter ?? ''} error={err('triggerParameter')} onChange={(e) => update({ triggerParameter: e.target.value })} />
                )}
                {(item.trigger === 'MAI-005' || item.trigger === 'MAI-006') && (
                    <Alert tone='info'>Event-triggered activity: it starts after {item.trigger === 'MAI-005' ? 'a failure' : 'an inspection finding'}. No fixed frequency is needed.</Alert>
                )}
                <div className='grid grid-cols-2 gap-3'>
                    <Field
                        id='act-duration'
                        label='Duration *'
                        inputMode='decimal'
                        autoComplete='off'
                        value={duration}
                        error={err('duration')}
                        onChange={(e) => {
                            setDuration(e.target.value);
                            touch('duration');
                        }}
                    />
                    <SelectField id='act-dunit' label='Duration unit *' value={item.durationUnit} error={err('durationUnit')} onChange={(e) => update({ durationUnit: e.target.value })}>
                        <option value=''>Select unit</option>
                        {refOptions(meta(data, 'maintenanceDurations'))}
                    </SelectField>
                </div>
            </Section>

            <Section id='act-sec-skills' title={`HR skills * · ${item.skills.length}/${MAX_SKILLS}`} note={`Select ${MIN_SKILLS} to ${MAX_SKILLS} skills from the HR skills master. They drive the role skill match below.`}>
                {err('skills') && <Alert tone='error'>{err('skills')}</Alert>}
                {item.skills.length > 0 && (
                    <ul aria-label='Selected skills' className='flex flex-wrap gap-2'>
                        {item.skills.map((code) => (
                            <li key={code} className='flex items-center rounded-full border border-line bg-page pl-3 text-sm text-ink'>
                                <span className='min-w-0 truncate'>{skillName(code)}</span>
                                <button type='button' aria-label={`Remove ${skillName(code)}`} onClick={() => update({ skills: item.skills.filter((c) => c !== code) })} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-panel'>
                                    <X className='h-4 w-4' />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className='grid gap-3 sm:grid-cols-2'>
                    <SelectField id='act-skcat' label='Skill category (filter)' value={item.skillCategory ?? ''} onChange={(e) => update({ skillCategory: e.target.value, skillSubcategory: '' })}>
                        <option value=''>All categories</option>
                        {skillCats.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField id='act-sksub' label='Skill subcategory (filter)' value={item.skillSubcategory ?? ''} onChange={(e) => update({ skillSubcategory: e.target.value })}>
                        <option value=''>All subcategories</option>
                        {skillSubs.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </SelectField>
                </div>
                <Field id='act-sksearch' label='Search HR skills' type='search' autoComplete='off' value={search} onChange={(e) => setSearch(e.target.value)} />
                <CheckList
                    label='HR skills'
                    items={matches.slice(0, SKILLS_SHOWN).map((s) => ({ code: s.code, label: s.label, hint: [s.category, s.subcategory].filter(Boolean).join(' › ') }))}
                    selected={item.skills}
                    full={item.skills.length >= MAX_SKILLS}
                    empty='No skills match these filters.'
                    onToggle={(code, on) => update({ skills: toggleIn(item.skills, code, on) })}
                />
                {matches.length > SKILLS_SHOWN && (
                    <p className='text-xs text-muted'>
                        Showing {SKILLS_SHOWN} of {matches.length}. Narrow with a category or the search.
                    </p>
                )}
            </Section>

            <Section id='act-sec-safety' title='Safety screening · isolation and permits' note='Answer every question. Requirements are indicative and must be confirmed by the authorized safety team before work starts.'>
                <div>
                    {SAFETY_QUESTIONS.map((sq) => (
                        <YesNo
                            key={sq.id}
                            id={`act-safe-${sq.id}`}
                            label={sq.label}
                            value={answers[sq.id]}
                            error={err(`safety.${sq.id}`)}
                            onChange={(v) => {
                                setItem((x) => ({ ...x, safetyScreening: { ...(x.safetyScreening ?? {}), [sq.id]: v } }));
                                touch(`safety.${sq.id}`);
                            }}
                        />
                    ))}
                </div>
                <div className='space-y-1 rounded-xl border border-line bg-page p-3 text-sm text-soft'>
                    <p className='flex items-center gap-2 font-semibold text-ink'>
                        <ShieldAlert className='h-4 w-4 shrink-0 text-amber-300' />
                        Potential safety requirements
                    </p>
                    {!advice.complete ? (
                        <p className='text-muted'>
                            {advice.answered} of {SAFETY_QUESTIONS.length} answered. Requirements show once every question is answered.
                        </p>
                    ) : (
                        <>
                            <p>{advice.loto ? 'Full LOTO / energy isolation assessment required.' : 'Consider short intervention controls only if approved by site procedure.'}</p>
                            {advice.live && <p>Live-equipment diagnosis or controlled inching/jogging authorization and safeguards required.</p>}
                            {advice.permits.map((p) => (
                                <p key={p}>{p}</p>
                            ))}
                        </>
                    )}
                    <p className='pt-1 text-xs text-muted'>Advisory screening only. Do not perform work without the approved procedure, isolation and required permits.</p>
                </div>
            </Section>

            <Section id='act-sec-roles' title={`Roles eligible to execute (optional) · ${(item.executionRoles ?? []).length}`} note='Job roles operating at site level and below. The match shows how many of the activity skills are core skills of the role.'>
                {err('roles') && <Alert tone='error'>{err('roles')}</Alert>}
                <CheckList
                    label='Eligible roles'
                    items={roles.map((r) => {
                        const matched = item.skills.filter((s) => r.coreSkills.includes(s)).length;
                        return {
                            code: r.code,
                            label: r.title,
                            hint: `${r.operatingLevel} · ${item.skills.length ? `${Math.round((matched / item.skills.length) * 100)}% skill match (${matched}/${item.skills.length})` : 'select activity skills to see the match'}`,
                        };
                    })}
                    selected={item.executionRoles ?? []}
                    empty='No eligible roles configured. Create job roles operating at site level or below under Positions.'
                    onToggle={(code, on) => update({ executionRoles: toggleIn(item.executionRoles ?? [], code, on) })}
                />
            </Section>

            <Section id='act-sec-failure' title='Failure modes and impacts (optional)' note='Unticking a category also unticks its subcategories.'>
                {err('failure') && <Alert tone='error'>{err('failure')}</Alert>}
                <h3 className='text-sm font-medium text-soft'>Failure mode categories</h3>
                <CheckList
                    label='Failure mode categories'
                    items={failures.filter((x) => !x.category)}
                    selected={fCats}
                    empty='No failure modes in MNT master data.'
                    onToggle={(code, on) => {
                        const next = toggleIn(fCats, code, on);
                        update({
                            failureCategories: next,
                            failureCategory: '',
                            failureSubcategory: '',
                            failureSubcategories: fSubs.filter((c) => failures.some((s) => s.code === c && next.includes(s.category))),
                        });
                    }}
                />
                <h3 className='text-sm font-medium text-soft'>Failure mode subcategories</h3>
                <CheckList
                    label='Failure mode subcategories'
                    items={failures.filter((x) => x.category && fCats.includes(x.category)).map((x) => ({ code: x.code, label: x.label, hint: labelOf(data, 'failureModes', x.category) }))}
                    selected={fSubs}
                    empty='Tick a failure mode category first.'
                    onToggle={(code, on) => update({ failureSubcategories: toggleIn(fSubs, code, on), failureSubcategory: '' })}
                />
                {err('impact') && <Alert tone='error'>{err('impact')}</Alert>}
                <h3 className='text-sm font-medium text-soft'>Impact categories</h3>
                <CheckList
                    label='Impact categories'
                    items={impacts.filter((x) => !x.category)}
                    selected={iCats}
                    empty='No impact categories in MNT master data.'
                    onToggle={(code, on) => {
                        const next = toggleIn(iCats, code, on);
                        update({ impactCategories: next, impactSubcategories: iSubs.filter((c) => impacts.some((s) => s.code === c && next.includes(s.category))) });
                    }}
                />
                <h3 className='text-sm font-medium text-soft'>Impact subcategories</h3>
                <CheckList
                    label='Impact subcategories'
                    items={impacts.filter((x) => x.category && iCats.includes(x.category)).map((x) => ({ code: x.code, label: x.label, hint: labelOf(data, 'impacts', x.category) }))}
                    selected={iSubs}
                    empty='Tick an impact category first.'
                    onToggle={(code, on) => update({ impactSubcategories: toggleIn(iSubs, code, on) })}
                />
            </Section>
        </Screen>
    );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AssemblyActivities({ assemblyId, onBack }: { assemblyId: string; onBack: () => void }) {
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<Data>('/api/org/assembly/activities/read', { assemblyId }), [assemblyId]);
    const [editing, setEditing] = useState<{ item: Activity; isNew: boolean } | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    /** Saves the complete list; the server validates every activity again. */
    const persist = async (items: Activity[]) => {
        await callBackend('/api/org/assembly/activities/save', { assemblyId, items });
        setData((d) => (d ? { ...d, items } : d));
    };

    const open = (item: Activity, isNew: boolean) => {
        setNotice('');
        setSaveError('');
        setEditing({ item, isNew });
    };

    const saveActivity = async (item: Activity) => {
        if (!data) return;
        setSaving(true);
        setSaveError('');
        try {
            const exists = data.items.some((x) => x.id === item.id);
            await persist(exists ? data.items.map((x) => (x.id === item.id ? item : x)) : [...data.items, item]);
            setEditing(null);
            setNotice(`Activity "${item.name}" ${exists ? 'saved' : 'added'}.`);
        } catch (err) {
            setSaveError(messageOf(err));
        } finally {
            setSaving(false);
        }
    };

    const removeActivity = (item: Activity) => {
        if (!data) return;
        confirm.ask(
            {
                title: 'Remove activity?',
                message: (
                    <>
                        <p>
                            <span className='font-semibold text-ink'>{item.name || item.id}</span> will be removed from this assembly&apos;s activity list and saved straight away.
                        </p>
                        <p className='mt-2'>Its safety risk assessment will no longer be reachable from this activity, and maintenance planning will stop offering it.</p>
                    </>
                ),
                confirmLabel: 'Remove activity',
                tone: 'danger',
                acknowledge: 'I understand the risk assessment linked to this activity will no longer be reachable.',
            },
            async () => {
                await persist(data.items.filter((x) => x.id !== item.id));
                setEditing(null);
                setSaveError('');
                setNotice(`Activity "${item.name}" removed.`);
            },
        );
    };

    if (data && editing) {
        return (
            <>
                <ActivityEditor
                    key={editing.item.id}
                    data={data}
                    initial={editing.item}
                    isNew={editing.isNew}
                    busy={saving}
                    error={saveError}
                    ask={confirm.ask}
                    onCancel={() => {
                        setSaveError('');
                        setEditing(null);
                    }}
                    onSave={(item) => void saveActivity(item)}
                    onRemove={() => removeActivity(editing.item)}
                />
                {confirm.sheet}
            </>
        );
    }

    const columns: Array<Column<Activity>> = data
        ? [
              { key: 'name', label: 'Activity', value: (a) => a.name, render: (a) => <span className='font-medium text-ink'>{a.name}</span> },
              { key: 'type', label: 'Type', value: (a) => a.type },
              { key: 'category', label: 'Category', value: (a) => labelOf(data, typeKey(a.type), a.category) },
              { key: 'subcategory', label: 'Subcategory', value: (a) => labelOf(data, typeKey(a.type), a.subcategory) },
              { key: 'trigger', label: 'Trigger', value: (a) => labelOf(data, 'maintenanceTriggers', a.trigger) },
              { key: 'interval', label: 'Interval', value: (a) => intervalText(a, data) },
              { key: 'priority', label: 'Priority', value: (a) => labelOf(data, 'workPriorities', a.priority) },
              { key: 'duration', label: 'Duration', type: 'number', value: (a) => a.duration, render: (a) => `${a.duration} ${labelOf(data, 'maintenanceDurations', a.durationUnit)}` },
              { key: 'skills', label: 'HR skills', type: 'number', value: (a) => (a.skills ?? []).length },
              { key: 'roles', label: 'Eligible roles', type: 'number', value: (a) => (a.executionRoles ?? []).length, hidden: true },
              {
                  key: 'screening',
                  label: 'Safety screening',
                  value: (a) => {
                      const s = screening(a.safetyScreening);
                      return !s.complete ? `Incomplete ${s.answered}/${SAFETY_QUESTIONS.length}` : s.loto ? 'LOTO assessment' : 'Short intervention';
                  },
                  render: (a) => {
                      const s = screening(a.safetyScreening);
                      if (!s.complete) return <Badge tone='danger'>Incomplete {s.answered}/{SAFETY_QUESTIONS.length}</Badge>;
                      return s.loto ? <Badge tone='warn'>LOTO assessment</Badge> : <Badge tone='muted'>Short intervention</Badge>;
                  },
              },
              { key: 'permits', label: 'Permits (advisory)', value: (a) => screening(a.safetyScreening).permits.join(', '), hidden: true },
              { key: 'id', label: 'Activity ID', value: (a) => a.id, hidden: true },
          ]
        : [];
    const full = !!data && data.items.length >= MAX_ACTIVITIES;

    return (
        <Screen
            title='Assembly activities'
            eyebrow='MNT · PM and AM'
            subtitle='Maintenance tasks, HR skills and safety screening'
            onBack={onBack}
            actions={
                data && (
                    <Button disabled={full} onClick={() => open(blank(), true)}>
                        <Plus className='h-4 w-4' />
                        Add
                    </Button>
                )
            }
        >
            {loading && !data && <Spinner />}
            {error && (
                <div className='space-y-2'>
                    <Alert tone='error'>{error}</Alert>
                    <Button variant='secondary' onClick={reload}>
                        Try again
                    </Button>
                </div>
            )}
            {notice && <Alert tone='success'>{notice}</Alert>}
            {full && <Alert tone='warn'>This assembly has the maximum of {MAX_ACTIVITIES} activities. Remove one before adding another.</Alert>}
            {data && (
                <>
                    <div className='flex items-center gap-1 text-xs text-muted'>
                        <span className='flex-1'>Tap an activity to edit or remove it. Screening results are advisory.</span>
                        <InfoTip label='Safety screening'>
                            The screening column summarises the 12 isolation and permit questions of each activity. An incomplete screening must be answered before the activity can be saved again.
                        </InfoTip>
                    </div>
                    <RichTable
                        id='mnt.assembly.activities'
                        title='Activities'
                        columns={columns}
                        rows={data.items}
                        rowKey={(a) => a.id}
                        onRowClick={(a) => open(a, false)}
                        fileName='assembly-activities'
                        height='h-[calc(100dvh-17rem)]'
                        empty='No activities configured yet. Tap Add to create the first one.'
                    />
                </>
            )}
            {confirm.sheet}
        </Screen>
    );
}
