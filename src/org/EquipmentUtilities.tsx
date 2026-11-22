import { useState } from 'react';
import { utilityOptionLabel } from '../lib/iso8573Labels';
import { CapacityLine, type SupplySummary } from './AssetUtilitySupplies';
import {reviewUtilityDistribution,type UtilityCapacityReview} from '../shared/utilityDistributionCapacity';
import {navigate} from '../lib/route';
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
    isInternalSupply?: boolean;
    supplyLinkRule?: number;
    sourceAssetTag?: string;
    sourceCostCenterId?:string;
    sourceCostCenterName?:string;
    energyTag?: string;
    energyColor?: string;
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
            return `${attr?.label ?? k}: ${attr?utilityOptionLabel(attr.label,String(v)):v}${attr?.unit ? ` ${attr.unit}` : ''}`;
        })
        .join(' · ');

function UtilityEditor({
    utility,
    initial,
    workCenterId,
    initialInternal,
    busy,
    error,
    onCancel,
    onSave,
}: {
    utility: Utility;
    initial: Record<string, string | number>;
    workCenterId:string;
    initialInternal:boolean;
    busy: boolean;
    error: string;
    onCancel: () => void;
    onSave: (values: Record<string, string | number>, sourceCostCenterId:string,isInternalSupply:boolean) => void;
}) {
    const attrs = utility.attributes ?? [];
    const sources=useLoad(()=>callBackend<{
        determinant:SupplySummary['determinant'];
        costCenterSupply:{costCenterId:string;costCenterName:string;
         equipmentHasAsset?:boolean;missingUtility:boolean;missingAsset:boolean;
         supply:{code:string;label:string;capacity:number|null;ready:boolean;
          values:Record<string,unknown>;sources:Array<{assetTag:string}>;
          review:UtilityCapacityReview}|null};
    }>('/api/org/ast/utilities/read',{workCenterId,code:utility.code}),[workCenterId,utility.code]);
    const [internal,setInternal]=useState(initialInternal);
    const determinant=sources.data?.determinant;
    const allocation=sources.data?.costCenterSupply;
    const supply=allocation?.supply;
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(attrs.map(a=>[a.key,initial[a.key]===undefined||initial[a.key]===null?'':String(initial[a.key])])));
    const demand=determinant?Number(values[determinant.key]):0;
    const localReview=supply?reviewUtilityDistribution(utility,supply.values,supply.capacity,
        [...supply.review.consumers.filter(c=>c.equipmentId!==workCenterId).map(c=>({
            equipmentId:c.equipmentId,name:c.name,values:
                c.demand!==null&&determinant?{[determinant.key]:c.demand}:{} ,
            legacy:c.legacy,hasAsset:c.hasAsset,
        })),{equipmentId:workCenterId,name:'This equipment',values,legacy:false,hasAsset:true}]):null;
    const sourceReady=internal||!!allocation&&!allocation.missingUtility&&
        !!supply?.ready&&(!determinant||!!supply.capacity&&Number.isFinite(demand)&&demand>0)&&
        localReview?.status!=='overload'&&localReview?.status!=='incompatible';
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
        onSave(out,internal?'':allocation?.costCenterId||'',internal);
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
                    <Button busy={busy} disabled={problems.length > 0 || !sourceReady || (!internal&&sources.loading)} onClick={save}>
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
                <label className='flex min-h-11 items-center gap-3 font-semibold text-ink'>
                    <input type='checkbox' checked={internal} onChange={e=>setInternal(e.target.checked)}
                        className='h-5 w-5 accent-emerald-500'/> Is internal supply?
                </label>
                <p className='text-xs text-muted'>{internal?
                    'Generated within this equipment. Cost-centre external supply is not required; Safety requirements still apply.':
                    'External utility is distributed through this equipment\'s parent cost centre, not linked directly to a supply asset.'}</p>
                {!internal&&<>
                    {sources.error&&<Alert tone='error'>{sources.error}</Alert>}
                    {sources.loading&&<Spinner/>}
                    {allocation&&<div className='space-y-2 rounded-lg border border-line bg-page p-3 text-sm'>
                        <h3 className='font-semibold'>Supplying cost centre</h3>
                        <p>{allocation.costCenterName} · {allocation.costCenterId}</p>
                        {supply?<div className='space-y-2 text-xs'>
                            <p>Utility: {supply.label} · {supply.sources.length} registered source asset(s)</p>
                            <p>Allocated capacity: <strong>{supply.capacity??'Not rated'} {determinant?.unit||''}</strong></p>
                            <p>Existing equipment demand: {supply.review.demand} {determinant?.unit||''}</p>
                            {localReview?.percentage!==null&&<p>
                                Projected demand after this equipment: <strong>{localReview?.percentage?.toFixed(1)}%</strong> of cost-centre capacity
                            </p>}
                            {localReview?.gaps.filter(g=>g.equipmentId===workCenterId&&g.key!=='asset').slice(0,5).map((g,i)=>
                                <p key={i} className='text-amber-500'>{g.message}</p>)}
                        </div>:<Alert tone='warn'>This utility has not been added to the cost-centre distribution catalogue yet.</Alert>}
                    </div>}
                    {allocation?.missingUtility&&<Alert tone='warn'>
                        Add {utility.label} at the supplying cost centre first, then link a registered source asset and rated supply capacity.
                    </Alert>}
                    {allocation?.missingAsset&&<Alert tone='warn'>
                        Cost-centre utility has no source asset. Create or select an asset, then configure its rating.
                    </Alert>}
                    {allocation?.equipmentHasAsset===false&&<Alert tone='warn'>
                        This equipment has no assigned asset. Add or attribute an asset to complete its Asset Register configuration.
                    </Alert>}
                    {allocation&&<Button variant='secondary' onClick={()=>navigate('organization_admin/structure/'+allocation.costCenterId)}>
                        Configure cost-centre utilities / add supply asset
                    </Button>}
                    {allocation?.equipmentHasAsset===false&&<Button variant='secondary'
                        onClick={()=>navigate('organization_admin/structure/'+workCenterId+'/asset')}>
                        Add or attribute equipment asset
                    </Button>}
                    {supply&&determinant&&(!Number.isFinite(demand)||demand<=0)&&
                        <Alert tone='warn'>Enter the positive equipment requirement in {determinant.unit} below.</Alert>}
                    {supply&&localReview?.status==='overload'&&<Alert tone='error'>
                        The combined equipment requirement exceeds the cost-centre allocation. Increase supply capacity or reduce demand.
                    </Alert>}
                    {supply&&localReview?.status==='incompatible'&&<Alert tone='error'>
                        Supply attributes do not match equipment requirements. Check voltage, pressure, phase and quality values.
                    </Alert>}
                    {!allocation&&!sources.loading&&<Alert tone='warn'>Link this equipment to an active cost centre and configure its utility supplies first.</Alert>}
                </>}
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
                                        {utilityOptionLabel(a.label,o)}
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
    const [editing, setEditing] = useState<{ utility: Utility; values: Record<string, string | number>; isInternalSupply:boolean } | null>(null);
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

    const edit = (utility: Utility, values: Record<string, string | number>, isInternalSupply=false) => {
        setNotice('');
        setSaveError('');
        setBrowse(false);
        setEditing({ utility, values, isInternalSupply });
    };

    const saveUtility = async (values: Record<string, string | number>,sourceCostCenterId:string,isInternalSupply:boolean) => {
        if (!editing) return;
        const row: Entry = { code: editing.utility.code, label: editing.utility.label, values, sourceAssetTag:'',
            sourceCostCenterId:isInternalSupply?'':sourceCostCenterId,isInternalSupply,supplyLinkRule:isInternalSupply?2:3 };
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
                initialInternal={editing.isInternalSupply}
                busy={saving}
                error={saveError}
                onCancel={() => {
                    setSaveError('');
                    setEditing(null);
                }}
                onSave={(values,source,internal) => void saveUtility(values,source,internal)}
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
            {entries.some(e=>!e.configurationComplete)&&<Alert tone='warn'>Utility configuration incomplete: link external utilities through the supplying cost centre, configure source assets and verify aggregate capacity and compatibility.</Alert>}
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
                                    onClick={() => def && edit(def, e.values,e.isInternalSupply===true)}
                                    aria-label={def ? `Edit ${e.label}` : `${e.label} (not in catalogue)`}
                                    className='flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-page disabled:opacity-80'
                                >
                                    <Zap className='h-5 w-5 shrink-0 text-brandsoft' style={e.energyColor?{color:e.energyColor}:undefined} />
                                    <span className='min-w-0 flex-1'>
                                        <span className='flex flex-wrap items-center gap-2 font-semibold text-ink'>
                                            {e.label}
                                            {!def && <Badge tone='warn'>Not in catalogue</Badge>}
                                        </span>
                                        <span className='block text-xs text-muted'>{text || 'No values recorded'}</span><span className='block text-xs text-soft'>{e.energyColor&&<span className='mr-1 inline-block h-3 w-3 rounded border border-line' style={{backgroundColor:e.energyColor}}/>}Isolation tag: {e.energyTag||'Configure in Hazardous Energy Sources'}</span>
                                        <span className='block text-xs text-soft'>{e.isInternalSupply===true?'Internal supply · external distribution not required':e.supplyLinkRule===3?'Cost-centre supply: '+(e.sourceCostCenterName||e.sourceCostCenterId||'Needs configuration'):e.sourceAssetTag?'Legacy direct asset supply: '+e.sourceAssetTag+' · reassign through cost centre':'External supply · configure cost-centre utility'}</span>
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
