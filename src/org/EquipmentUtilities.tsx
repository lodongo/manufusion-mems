import { useState } from 'react';
import { AssetForm } from './AssetRegister';
import { CapacityLine, type SupplySummary, type SourceOption } from './AssetUtilitySupplies';
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
    sourceAssetTag?: string;
    sourceAssetName?: string;
    sourceAssetStatus?: string;
    configurationComplete?: boolean;
    supply?: SupplySummary | null;
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
    workCenterId,
    initialSource,
    busy,
    error,
    onCancel,
    onSave,
}: {
    utility: Utility;
    initial: Record<string, string | number>;
    workCenterId:string;
    initialSource:string;
    busy: boolean;
    error: string;
    onCancel: () => void;
    onSave: (values: Record<string, string | number>, sourceAssetTag:string) => void;
}) {
    const attrs = utility.attributes ?? [];
    const sources=useLoad(()=>callBackend<{sources:SourceOption[];determinant:SupplySummary['determinant']}>('/api/org/ast/utilities/read',{workCenterId,code:utility.code}),[workCenterId,utility.code]);
    const [source,setSource]=useState(initialSource);
    const [creating,setCreating]=useState(false);
    const [rating,setRating]=useState('');
    const [ratingBusy,setRatingBusy]=useState(false);
    const [ratingError,setRatingError]=useState('');
    const option=sources.data?.sources.find(x=>x.tag===source);
    const determinant=sources.data?.determinant;
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(attrs.map((a) => [a.key, initial[a.key] === undefined || initial[a.key] === null ? '' : String(initial[a.key])])));
    const demand=determinant?Number(values[determinant.key]):0;
    const sourceReady=!!option&&(!determinant||!!option.capacity&&Number.isFinite(demand)&&demand>0);
    const [touched, setTouched] = useState<string[]>([]);
    const [showAll, setShowAll] = useState(Object.keys(initial).length > 0);

    const errors = Object.fromEntries(attrs.map((a) => [a.key, checkValue(a, values[a.key] ?? '')]).filter(([, e]) => !!e)) as Record<string, string>;
    const problems = attrs.filter((a) => errors[a.key]).map((a) => `${a.label}: ${errors[a.key]}`);
    const set = (key: string, value: string) => {
        setValues((v) => ({ ...v, [key]: value }));
        setTouched((t) => (t.includes(key) ? t : [...t, key]));
    };
    const save = () => {
        if (problems.length || !sourceReady) return setShowAll(true);
        const out: Record<string, string | number> = {};
        for (const a of attrs) {
            const v = (values[a.key] ?? '').trim();
            if (v) out[a.key] = a.type === 'number' ? Number(v) : v;
        }
        onSave(out,source);
    };

    const saveRating=async()=>{if(!option||!determinant)return;setRatingBusy(true);setRatingError('');try{await callBackend('/api/org/ast/utilities/save',{assetTag:source,code:utility.code,capacity:Number(rating),expectedRating:option.rating});setRating('');sources.reload();}catch(err){setRatingError(messageOf(err));}finally{setRatingBusy(false);}};
    if(creating)return <AssetForm onCancel={()=>setCreating(false)} onDone={tag=>{setSource(tag);setCreating(false);sources.reload();}}/>;
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
                    <Button busy={busy} disabled={problems.length > 0 || !sourceReady || sources.loading || ratingBusy} onClick={save}>
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
                <h3 className='font-semibold text-ink'>Supplying asset *</h3>
                <p className='text-xs text-muted'>Select a registered source at this site. Multiple machines may use the same source.</p>
                {sources.error&&<Alert tone='error'>{sources.error}</Alert>}
                {sources.loading&&<Spinner/>}
                <SelectField id='utility-source' label='Supply asset *' value={source} onChange={e=>{setSource(e.target.value);setRating('');setRatingError('');}}>
                    <option value=''>Select registered asset…</option>
                    {sources.data?.sources.map(a=><option key={a.tag} value={a.tag}>{a.tag} · {a.name} · {a.className} ({a.assetStatus})</option>)}
                </SelectField>
                <Button variant='secondary' onClick={()=>setCreating(true)}><Plus className='h-4 w-4'/> Create new supply asset</Button>
                {source&&!option&&!sources.loading&&<Alert tone='warn'>Supply asset is unavailable or outside your scope. Select an eligible asset.</Alert>}
                {option&&option.assetStatus!=='active'&&<Alert tone='warn'>The source asset is not fully approved. This is a configuration record, not an authorization to operate.</Alert>}
                {option&&determinant&&<><CapacityLine supply={option} projected={option.total-option.ownDemand+(Number.isFinite(demand)&&demand>0?demand:0)}/>
                    {!option.capacity&&option.canRate&&<><Field id='utility-source-rating' label={'Usable supply capacity ('+determinant.unit+') *'} inputMode='decimal' value={rating} onChange={e=>setRating(e.target.value)}/>
                    <Button variant='secondary' busy={ratingBusy} disabled={!(Number(rating)>0)||!Number.isFinite(Number(rating))} onClick={()=>void saveRating()}>Save source capacity</Button></>}
                    {!option.capacity&&!option.canRate&&<Alert tone='warn'>Ask an authorized asset editor to set the usable capacity.</Alert>}
                    {ratingError&&<Alert tone='error'>{ratingError}</Alert>}
                </>}
                {option&&determinant&&(!Number.isFinite(demand)||demand<=0)&&<Alert tone='warn'>Enter a positive equipment demand in {determinant.unit} below.</Alert>}
                {option&&!determinant&&<p className='text-xs text-muted'>This utility has no additive capacity determinant in the catalogue. Asset linkage remains mandatory.</p>}
            </Card>
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
    const { data, setData, error, loading, reload } = useLoad(() => callBackend<{ catalogue: Utility[]; items: Entry[]; version:number }>('/api/org/ast/utilities/read', { workCenterId }), [workCenterId]);
    const [browse, setBrowse] = useState(false);
    const [editing, setEditing] = useState<{ utility: Utility; values: Record<string, string | number>; sourceAssetTag:string } | null>(null);
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
        const result=await callBackend<{version:number}>('/api/org/ast/utilities/save', { workCenterId, items: rows,version:data?.version||0 });
        setData((d) => (d ? { ...d, items: rows,version:result.version } : d));
        reload();
    };

    const edit = (utility: Utility, values: Record<string, string | number>, sourceAssetTag='') => {
        setNotice('');
        setSaveError('');
        setBrowse(false);
        setEditing({ utility, values, sourceAssetTag });
    };

    const saveUtility = async (values: Record<string, string | number>,sourceAssetTag:string) => {
        if (!editing) return;
        const row: Entry = { code: editing.utility.code, label: editing.utility.label, values, sourceAssetTag };
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
                workCenterId={workCenterId}
                initialSource={editing.sourceAssetTag}
                busy={saving}
                error={saveError}
                onCancel={() => {
                    setSaveError('');
                    setEditing(null);
                }}
                onSave={(values,source) => void saveUtility(values,source)}
            />
        );
    }

    const full = entries.length >= MAX_UTILITIES;
    return (
        <Screen
            title='Utilities'
            eyebrow='AST · equipment unit'
            subtitle='Utilities used by this unit — automatically linked to Hazardous Energy Sources'
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
            {data && catalogue.length === 0 && <Alert tone='warn'>No adopted utilities found. Check MEMS Admin utility master and Safety → Metadata Adoption.</Alert>}
            {stale.length > 0 && (
                <Alert tone='warn'>
                    {stale.map((e) => e.label).join(', ')} {stale.length === 1 ? 'is' : 'are'} not currently adopted or active. Existing connections remain visible in the energy register; review adoption before editing.
                </Alert>
            )}
            {entries.some(e=>!e.configurationComplete)&&<Alert tone='warn'>Utility configuration incomplete: link all existing supplies to valid assets and record required capacity.</Alert>}
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
                                    onClick={() => def && edit(def, e.values,e.sourceAssetTag)}
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
                                        <span className='block text-xs text-soft'>{e.sourceAssetTag?e.sourceAssetTag+' · '+(e.sourceAssetName||'Source not verified'):'Supply asset not linked'}</span>
                                        {e.supply&&<CapacityLine supply={e.supply}/>}
                                        {e.sourceAssetStatus&&e.sourceAssetStatus!=='active'&&<span className='block text-xs text-amber-400'>Source approval: {e.sourceAssetStatus}</span>}
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
