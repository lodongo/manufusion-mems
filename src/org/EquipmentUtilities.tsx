import { useState } from 'react';
import { ChevronRight, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Screen, messageOf, useConfirm } from '../components/screen';
import UtilityBrowser, { type Utility } from '../admin/UtilityBrowser';
import { Badge, Button, Card, Empty, Spinner, useLoad } from '../admin/kit';

// Utilities (compressed air, power, water …) used by one equipment unit (work center).
// Utilities come from the AST "Utility supplies master"; each one carries typed attributes (number, text or a
// controlled list) that may be mandatory. The whole list is saved at once (POST /api/org/ast/utilities/save);
// the server checks every entry against the catalogue and answers 403 with a message when the person may not
// edit at this unit.
//   list     one card per utility; tap to edit, bin icon to remove (confirmed)
//   browse   UtilityBrowser (category › subcategory › utility) to add one that is not on the unit yet
//   editor   attribute form with Save / Cancel on top and inline validation (required, numbers, list values)

interface Entry {
    code: string;
    label: string;
    values: Record<string, string | number>;
}
type Attr = Utility['attributes'][number];

const MAX_UTILITIES = 80;
const MAX_TEXT = 180;

const isNumber = (v: string) => /^-?(\d+\.?\d*|\.\d+)$/.test(v) && Number.isFinite(Number(v));

/** Inline message for one attribute value (mirrors the server rules, slightly stricter on number format). */
function checkValue(attr: Attr, raw: string): string | undefined {
    const v = raw.trim();
    if (!v) return attr.required ? `${attr.label} is required.` : undefined;
    if (attr.type === 'number') return isNumber(v) ? undefined : 'Enter a number, e.g. 6 or 7.5.';
    if (v.length > MAX_TEXT) return `At most ${MAX_TEXT} characters.`;
    if (attr.type === 'select' && !(attr.options ?? []).includes(v)) return 'Choose a value from the list.';
    return undefined;
}

const fieldLabel = (attr: Attr) => `${attr.label}${attr.unit ? ` (${attr.unit})` : ''}${attr.required ? ' *' : ' (optional)'}`;
const summary = (entry: Entry, def?: Utility) =>
    Object.entries(entry.values)
        .map(([k, v]) => {
            const attr = (def?.attributes ?? []).find((a) => a.key === k);
            return `${attr?.label ?? k}: ${v}${attr?.unit ? ` ${attr.unit}` : ''}`;
        })
        .join(' · ');

function UtilityEditor({
    utility,
    initial,
    busy,
    error,
    onCancel,
    onSave,
}: {
    utility: Utility;
    initial: Record<string, string | number>;
    busy: boolean;
    error: string;
    onCancel: () => void;
    onSave: (values: Record<string, string | number>) => void;
}) {
    const attrs = utility.attributes ?? [];
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(attrs.map((a) => [a.key, initial[a.key] === undefined || initial[a.key] === null ? '' : String(initial[a.key])])));
    const [touched, setTouched] = useState<string[]>([]);
    const [showAll, setShowAll] = useState(Object.keys(initial).length > 0);

    const errors = Object.fromEntries(attrs.map((a) => [a.key, checkValue(a, values[a.key] ?? '')]).filter(([, e]) => !!e)) as Record<string, string>;
    const problems = attrs.filter((a) => errors[a.key]).map((a) => `${a.label}: ${errors[a.key]}`);
    const set = (key: string, value: string) => {
        setValues((v) => ({ ...v, [key]: value }));
        setTouched((t) => (t.includes(key) ? t : [...t, key]));
    };
    const save = () => {
        if (problems.length) return setShowAll(true);
        const out: Record<string, string | number> = {};
        for (const a of attrs) {
            const v = (values[a.key] ?? '').trim();
            if (v) out[a.key] = a.type === 'number' ? Number(v) : v;
        }
        onSave(out);
    };

    return (
        <Screen
            title={utility.label}
            eyebrow={`Utility · ${utility.code}`}
            subtitle={[utility.category, utility.subcategory].filter(Boolean).join(' › ')}
            actions={
                <>
                    <Button variant='secondary' disabled={busy} onClick={onCancel} aria-label='Cancel' className='px-3'>
                        <X className='h-4 w-4' />
                        <span className='hidden sm:inline'>Cancel</span>
                    </Button>
                    <Button busy={busy} disabled={problems.length > 0} onClick={save}>
                        {!busy && <Save className='h-4 w-4' />}
                        Save
                    </Button>
                </>
            }
        >
            {error && <Alert tone='error'>{error}</Alert>}
            {problems.length > 0 && (showAll || touched.length > 0) && (
                <Alert tone='warn'>
                    {problems.length} {problems.length === 1 ? 'value needs' : 'values need'} attention before saving: {problems.join(' ')}
                </Alert>
            )}
            {problems.length > 0 && !showAll && touched.length === 0 && (
                <p className='text-xs text-muted'>Fields marked * are required. Save unlocks once they are filled in.</p>
            )}
            <Card className='space-y-3'>
                {utility.description && <p className='text-sm text-soft'>{utility.description}</p>}
                {attrs.length === 0 && <p className='text-sm text-muted'>This utility has no attributes to record. Save to add it to the unit.</p>}
                {attrs.map((a, i) => {
                    const id = `util-attr-${i}`;
                    const error = showAll || touched.includes(a.key) ? errors[a.key] : undefined;
                    if (a.type === 'select') {
                        return (
                            <SelectField key={a.key} id={id} label={fieldLabel(a)} value={values[a.key] ?? ''} error={error} onChange={(e) => set(a.key, e.target.value)}>
                                <option value=''>{a.required ? 'Select…' : 'Not set'}</option>
                                {(a.options ?? []).map((o) => (
                                    <option key={o} value={o}>
                                        {o}
                                    </option>
                                ))}
                            </SelectField>
                        );
                    }
                    return (
                        <Field
                            key={a.key}
                            id={id}
                            label={fieldLabel(a)}
                            inputMode={a.type === 'number' ? 'decimal' : undefined}
                            autoComplete='off'
                            maxLength={a.type === 'number' ? 30 : MAX_TEXT}
                            value={values[a.key] ?? ''}
                            error={error}
                            hint={a.type === 'number' ? 'Number' : undefined}
                            onChange={(e) => set(a.key, e.target.value)}
                        />
                    );
                })}
            </Card>
        </Screen>
    );
}

export default function EquipmentUtilities({ workCenterId, onBack }: { workCenterId: string; onBack: () => void }) {
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<{ catalogue: Utility[]; items: Entry[] }>('/api/org/ast/utilities/read', { workCenterId }), [workCenterId]);
    const [browse, setBrowse] = useState(false);
    const [editing, setEditing] = useState<{ utility: Utility; values: Record<string, string | number> } | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();

    const catalogue = data?.catalogue ?? [];
    const entries = data?.items ?? [];
    const defOf = (code: string) => catalogue.find((u) => u.code === code);
    const stale = entries.filter((e) => !defOf(e.code));

    /** Saves the complete list; the server checks every entry against the catalogue again. */
    const persist = async (rows: Entry[]) => {
        await callBackend('/api/org/ast/utilities/save', { workCenterId, items: rows });
        setData((d) => (d ? { ...d, items: rows } : d));
    };

    const edit = (utility: Utility, values: Record<string, string | number>) => {
        setNotice('');
        setSaveError('');
        setBrowse(false);
        setEditing({ utility, values });
    };

    const saveUtility = async (values: Record<string, string | number>) => {
        if (!editing) return;
        const row: Entry = { code: editing.utility.code, label: editing.utility.label, values };
        const exists = entries.some((e) => e.code === row.code);
        setSaving(true);
        setSaveError('');
        try {
            await persist(exists ? entries.map((e) => (e.code === row.code ? row : e)) : [...entries, row]);
            setEditing(null);
            setNotice(`${row.label} ${exists ? 'updated' : 'added'}.`);
        } catch (err) {
            setSaveError(messageOf(err));
        } finally {
            setSaving(false);
        }
    };

    const removeUtility = (entry: Entry) => {
        setNotice('');
        confirm.ask(
            {
                title: 'Remove utility?',
                message: (
                    <p>
                        <span className='font-semibold text-ink'>{entry.label}</span> and its recorded values will be removed from this equipment unit and saved straight away.
                    </p>
                ),
                confirmLabel: 'Remove utility',
                tone: 'danger',
            },
            async () => {
                await persist(entries.filter((e) => e.code !== entry.code));
                setNotice(`${entry.label} removed.`);
            },
        );
    };

    if (browse) {
        return <UtilityBrowser items={catalogue.filter((u) => !entries.some((e) => e.code === u.code))} onBack={() => setBrowse(false)} onChoose={(u) => edit(u, {})} />;
    }

    if (editing) {
        return (
            <UtilityEditor
                key={editing.utility.code}
                utility={editing.utility}
                initial={editing.values}
                busy={saving}
                error={saveError}
                onCancel={() => {
                    setSaveError('');
                    setEditing(null);
                }}
                onSave={(values) => void saveUtility(values)}
            />
        );
    }

    const full = entries.length >= MAX_UTILITIES;
    return (
        <Screen
            title='Utilities'
            eyebrow='AST · equipment unit'
            subtitle='Utilities used by this unit and their technical values'
            onBack={onBack}
            actions={
                data && (
                    <Button disabled={full || catalogue.length === 0} onClick={() => setBrowse(true)}>
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
            {data && catalogue.length === 0 && <Alert tone='warn'>No utility records found in AST metadata. Ask an administrator to load the Utility supplies master defaults.</Alert>}
            {stale.length > 0 && (
                <Alert tone='warn'>
                    {stale.map((e) => e.label).join(', ')} {stale.length === 1 ? 'is' : 'are'} no longer active in the AST utility catalogue. Remove {stale.length === 1 ? 'it' : 'them'} before saving other changes.
                </Alert>
            )}
            {full && <Alert tone='warn'>This unit has the maximum of {MAX_UTILITIES} utilities.</Alert>}
            {data && entries.length === 0 && <Empty>No utilities recorded for this unit yet. Tap Add to choose one from the catalogue.</Empty>}
            {entries.length > 0 && (
                <ul className='space-y-2'>
                    {entries.map((e) => {
                        const def = defOf(e.code);
                        const text = summary(e, def);
                        return (
                            <li key={e.code} className='flex items-stretch gap-2 rounded-2xl border border-line bg-panel p-2'>
                                <button
                                    type='button'
                                    disabled={!def}
                                    onClick={() => def && edit(def, e.values)}
                                    aria-label={def ? `Edit ${e.label}` : `${e.label} (not in catalogue)`}
                                    className='flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-page disabled:opacity-80'
                                >
                                    <Zap className='h-5 w-5 shrink-0 text-brandsoft' />
                                    <span className='min-w-0 flex-1'>
                                        <span className='flex flex-wrap items-center gap-2 font-semibold text-ink'>
                                            {e.label}
                                            {!def && <Badge tone='warn'>Not in catalogue</Badge>}
                                        </span>
                                        <span className='block text-xs text-muted'>{text || 'No values recorded'}</span>
                                    </span>
                                    {def && <ChevronRight className='h-4 w-4 shrink-0 text-muted' />}
                                </button>
                                <button
                                    type='button'
                                    aria-label={`Remove ${e.label}`}
                                    onClick={() => removeUtility(e)}
                                    className='flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-xl border border-red-500/40 text-red-400 active:bg-page'
                                >
                                    <Trash2 className='h-5 w-5' />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {confirm.sheet}
        </Screen>
    );
}
