import { useMemo, useState } from 'react';
import { ChevronRight, FolderTree, Table2 } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from './ui';
import RichTable, { type Column } from './RichTable';
import { Badge, Button, Card, Spinner, useLoad } from '../admin/kit';

// Read-only browser for the MEMS asset master dictionary:
// Group > Category > Subcategory > Asset class > Attributes, with a searchable table of all classes.

export interface FinancialCatalogueInfo {
 mappingStatus:string; glRouteCount:number; primaryGlCode:string; majorBranch:string;
 storesClassCode:string; storesClassName:string; determinationMode?:string;
 accountPurpose?:string; costObjectRequirement?:string; legalEntityApplicability?:string;
 corporateApplicability?:string; classificationEvidence?:string; materialNumberPattern?:string;
 usedInProcurement:boolean|null; usedInBudget:boolean|null; usedInProcurementPosting:boolean|null;
 pendingFinanceApproval?:boolean; sourceOfEligibility?:string;
 routes?:Array<{event:string;glCode:string;glName:string;status:string;systemDerived:boolean}>;
}
const eligible=(value:boolean|null|undefined)=>value===true?'Yes':value===false?'No':'Not configured';
const financialStatus=(value:string)=>value==='reference_proposed'?'Reference mapping · Finance approval pending':
 value==='finance_review_required'?'Finance review required':
 value==='not_configured'?'Accounting not configured':value.replace(/_/g,' ');

export interface Life {
    min: number;
    max: number;
    depreciable: boolean;
}

export interface DictTree {
    version: string;
    vid: string;
    name: string;
    domains: Array<{ code: string; name: string }>;
    groups: Array<{ code: string; name: string; description: string; profiles: string[] }>;
    categories: Array<{ code: string; groupCode: string; name: string; description: string; profiles: string[]; usefulLifeYears: Life | null }>;
    subcategories: Array<{ code: string; categoryCode: string; name: string; description: string; profiles: string[] }>;
    classes: Array<{
        code: string;
        subcategoryCode: string;
        categoryCode: string;
        groupCode: string;
        name: string;
        description: string;
        synonyms: string[];
        attributeCount: number;
        requiredCount: number;
        usefulLifeYears: Life | null;
        extra?: Record<string, string>;
        financial?: FinancialCatalogueInfo;
    }>;
}

export interface AttrDef {
    code: string;
    key: string;
    name: string;
    description: string;
    domain: string;
    domainName: string;
    dataType: string;
    unit: string;
    options: Array<{ code: string; label: string }>;
    validation: { minimum?: number; maximum?: number; maxLength?: number; pattern?: string };
    required: boolean;
    specific: boolean;
}

export interface ClassDetail {
    code: string;
    name: string;
    description: string;
    groupCode: string;
    categoryCode: string;
    subcategoryCode: string;
    profiles: Array<{ code: string; name: string }>;
    synonyms: string[];
    usefulLifeYears: Life | null;
    attributes: AttrDef[];
    properties?: Array<{ label: string; value: string }>;
    legacyCodes?: string[];
    accounting?: Record<string, unknown>;
    financialMapping?: Record<string, unknown>;
    financial?: FinancialCatalogueInfo;
}

export const lifeText = (l: Life | null) => (!l ? '' : !l.depreciable ? 'Not depreciated' : l.min === l.max ? `${l.min} years` : `${l.min}–${l.max} years`);

const TYPE_LABELS: Record<string, string> = {
    text: 'Text',
    integer: 'Whole number',
    decimal: 'Number',
    boolean: 'Yes / no',
    date: 'Date',
    enum: 'One option',
    multi_select: 'Several options',
    country: 'Country',
    currency: 'Currency',
    file: 'Document',
};
export const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;

type Path = { group?: string; category?: string; subcategory?: string; cls?: string };

// Level names, so the same browser serves the asset catalog and the procurement material and service catalogs.
export interface BrowserLabels {
    group: string;
    groups: string;
    category: string;
    categories: string;
    subcategory: string;
    subcategories: string;
    cls: string;
    classes: string;
    tableId: string;
    filePrefix: string;
    showLife: boolean;
    extra?: Array<{ key: string; label: string }>;
}

// Codes such as MRM-MAL-FST show their own segment; purely numeric codes (GL accounts) show in full.
const seg = (code: string, i: number) => (code.includes('-') ? code.split('-')[i] ?? code : code);

export const ASSET_LABELS: BrowserLabels = { group: 'Group', groups: 'groups', category: 'Category', categories: 'categories', subcategory: 'Subcategory', subcategories: 'subcategories', cls: 'Asset class', classes: 'classes', tableId: 'asset.dictionary', filePrefix: 'MEMS_asset', showLife: true };
export const MATERIAL_LABELS: BrowserLabels = { group: 'Category', groups: 'categories', category: 'Subcategory', categories: 'subcategories', subcategory: 'Family', subcategories: 'families', cls: 'Material', classes: 'materials', tableId: 'prc.materials', filePrefix: 'MEMS_material', showLife: false };
export const SERVICE_LABELS: BrowserLabels = { group: 'Category', groups: 'categories', category: 'Subcategory', categories: 'subcategories', subcategory: 'Family', subcategories: 'families', cls: 'Service', classes: 'services', tableId: 'prc.services', filePrefix: 'MEMS_service', showLife: false };
export const GL_LABELS: BrowserLabels = {
    group: 'Account class',
    groups: 'classes',
    category: 'Account category',
    categories: 'categories',
    subcategory: 'Account group',
    subcategories: 'groups',
    cls: 'GL account',
    classes: 'accounts',
    tableId: 'fin.gl_accounts',
    filePrefix: 'MEMS_gl_account',
    showLife: false,
    extra: [
        { key: 'normalBalance', label: 'Normal balance' },
        { key: 'accountRole', label: 'Role' },
        { key: 'accountType', label: 'Account type' },
        { key: 'postingMode', label: 'Posting' },
    ],
};

export default function AssetDictionaryBrowser({
    treePath,
    classPath,
    body = {},
    onPick,
    pickLabel = 'Use this class',
    showAttributes = true,
    labels: L = ASSET_LABELS,
}: {
    treePath: string;
    classPath: string;
    body?: Record<string, unknown>;
    onPick?: (cls: ClassDetail) => void;
    pickLabel?: string;
    showAttributes?: boolean;
    labels?: BrowserLabels;
}) {
    const bodyKey = JSON.stringify(body);
    const { data, error, loading } = useLoad(() => callBackend<DictTree>(treePath, body), [treePath, bodyKey]);
    const [path, setPath] = useState<Path>({});
    const [mode, setMode] = useState<'browse' | 'table'>('browse');

    const names = useMemo(() => {
        const m = new Map<string, string>();
        data?.groups.forEach((g) => m.set(g.code, g.name));
        data?.categories.forEach((c) => m.set(c.code, c.name));
        data?.subcategories.forEach((s) => m.set(s.code, s.name));
        return m;
    }, [data]);

    const classColumns = useMemo<Array<Column<DictTree['classes'][number]>>>(
        () => [
            { key: 'code', label: `${L.cls} code`, value: (r) => r.code, className: 'font-mono whitespace-nowrap' },
            { key: 'name', label: L.cls, value: (r) => r.name },
            { key: 'group', label: L.group, value: (r) => `${r.groupCode} ${names.get(r.groupCode) ?? ''}` },
            { key: 'category', label: L.category, value: (r) => `${r.categoryCode} ${names.get(r.categoryCode) ?? ''}` },
            { key: 'subcategory', label: L.subcategory, value: (r) => `${r.subcategoryCode} ${names.get(r.subcategoryCode) ?? ''}` },
            { key: 'attributes', label: 'Attributes', type: 'number', value: (r) => r.attributeCount },
            { key: 'required', label: 'Required', type: 'number', value: (r) => r.requiredCount },
            { key: 'financialBranch', label: 'MRO / Non-MRO', value: (r) => r.financial?.majorBranch||'' },
            { key: 'storesClass', label: 'Stores class', value: (r) => r.financial?.storesClassCode||'' },
            { key: 'gl', label: 'Primary reference GL', value: (r) => r.financial?.primaryGlCode||'' },
            { key: 'mapping', label: 'GL mapping status', value: (r) => r.financial?.mappingStatus||'not_configured' },
            { key: 'procurement', label: 'In procurement', value: (r) => eligible(r.financial?.usedInProcurement), hidden: true },
            { key: 'budget', label: 'In budgets', value: (r) => eligible(r.financial?.usedInBudget), hidden: true },
            { key: 'life', label: 'Useful life', value: (r) => lifeText(r.usefulLifeYears), hidden: !L.showLife },
            { key: 'synonyms', label: 'Also known as', value: (r) => r.synonyms.join('; '), hidden: true },
            { key: 'description', label: 'Description', value: (r) => r.description, hidden: true },
            ...(L.extra ?? []).map((x) => ({ key: `x_${x.key}`, label: x.label, value: (r: DictTree['classes'][number]) => r.extra?.[x.key] ?? '' })),
        ],
        [names, L]
    );

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the catalog.'}</Alert>;

    const crumbs: Array<{ label: string; to: Path }> = [{ label: `All ${L.groups}`, to: {} }];
    if (path.group) crumbs.push({ label: `${path.group} ${names.get(path.group) ?? ''}`, to: { group: path.group } });
    if (path.category) crumbs.push({ label: `${seg(path.category, 1)} ${names.get(path.category) ?? ''}`, to: { group: path.group, category: path.category } });
    if (path.subcategory) crumbs.push({ label: `${seg(path.subcategory, 2)} ${names.get(path.subcategory) ?? ''}`, to: { group: path.group, category: path.category, subcategory: path.subcategory } });

    const list: Array<{ code: string; name: string; description: string; count: number; unit: string; life?: string; financial?: FinancialCatalogueInfo; to: Path }> = (() => {
        if (!path.group) return data.groups.map((g) => ({ code: g.code, name: g.name, description: g.description, count: data.categories.filter((c) => c.groupCode === g.code).length, unit: L.categories, to: { group: g.code } }));
        if (!path.category)
            return data.categories
                .filter((c) => c.groupCode === path.group)
                .map((c) => ({ code: c.code, name: c.name, description: c.description, count: data.subcategories.filter((s) => s.categoryCode === c.code).length, unit: L.subcategories, life: lifeText(c.usefulLifeYears), to: { ...path, category: c.code } }));
        if (!path.subcategory)
            return data.subcategories
                .filter((s) => s.categoryCode === path.category)
                .map((s) => ({ code: s.code, name: s.name, description: s.description, count: data.classes.filter((c) => c.subcategoryCode === s.code).length, unit: L.classes, to: { ...path, subcategory: s.code } }));
        return data.classes
            .filter((c) => c.subcategoryCode === path.subcategory)
            .map((c) => ({ code: c.code, name: c.name, description: c.description, count: c.attributeCount, unit: 'attributes', life: lifeText(c.usefulLifeYears), financial:c.financial, to: { ...path, cls: c.code } }));
    })();

    if (path.cls) {
        return (
            <ClassView
                classPath={classPath}
                body={body}
                code={path.cls}
                onBack={() => setPath({ group: path.group, category: path.category, subcategory: path.subcategory })}
                onPick={onPick}
                pickLabel={pickLabel}
                showAttributes={showAttributes}
                names={names}
                labels={L}
            />
        );
    }

    return (
        <div className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
                <p className='min-w-0 truncate text-xs text-slate-400'>
                    {data.name} · version <span className='font-mono text-emerald-300'>{data.version}</span> · {data.groups.length} {L.groups} · {data.classes.length} {L.classes}
                </p>
                <div className='flex shrink-0 gap-1 rounded-xl border border-slate-700 p-1'>
                    <button type='button' aria-label='Browse' onClick={() => setMode('browse')} className={`flex h-11 items-center gap-1 rounded-lg px-2 text-xs ${mode === 'browse' ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                        <FolderTree className='h-4 w-4' />
                        Browse
                    </button>
                    <button type='button' aria-label='Table' onClick={() => setMode('table')} className={`flex h-11 items-center gap-1 rounded-lg px-2 text-xs ${mode === 'table' ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                        <Table2 className='h-4 w-4' />
                        All {L.classes}
                    </button>
                </div>
            </div>

            {mode === 'table' ? (
                <RichTable
                    id={`${L.tableId}.classes`}
                    title={`${L.cls} list`}
                    fileName={`${L.filePrefix}_list_${data.version}`}
                    columns={classColumns}
                    rows={data.classes}
                    rowKey={(r) => r.code}
                    onRowClick={(r) => setPath({ group: r.groupCode, category: r.categoryCode, subcategory: r.subcategoryCode, cls: r.code })}
                    height='h-[calc(100dvh-14rem)]'
                />
            ) : (
                <>
                    <nav aria-label='Dictionary path' className='flex flex-wrap items-center gap-1 text-xs'>
                        {crumbs.map((c, i) => (
                            <span key={i} className='flex items-center gap-1'>
                                {i > 0 && <ChevronRight className='h-3 w-3 text-slate-600' />}
                                <button type='button' onClick={() => setPath(c.to)} className={`rounded-lg px-2 py-1 ${i === crumbs.length - 1 ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400'}`}>
                                    {c.label}
                                </button>
                            </span>
                        ))}
                    </nav>
                    {path.group && (
                        <Card>
                            <p className='text-sm text-slate-300'>
                                {(path.subcategory ? data.subcategories.find((s) => s.code === path.subcategory)?.description : path.category ? data.categories.find((c) => c.code === path.category)?.description : data.groups.find((g) => g.code === path.group)?.description) ?? ''}
                            </p>
                        </Card>
                    )}
                    <ul className='max-h-[calc(100dvh-18rem)] min-h-[16rem] space-y-2 overflow-y-auto overscroll-contain pr-1'>
                        {list.map((item) => (
                            <li key={item.code}>
                                <button type='button' onClick={() => setPath(item.to)} className='flex w-full items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left active:bg-slate-800'>
                                    <span className='shrink-0 rounded-lg bg-emerald-500/10 px-2 py-1 font-mono text-xs font-bold text-emerald-300'>{item.code}</span>
                                    <span className='min-w-0 flex-1'>
                                        <span className='block text-sm font-medium text-white'>{item.name}</span>
                                        <span className='mt-0.5 line-clamp-2 block text-xs text-slate-400'>{item.description}</span>
                                        <span className='mt-1 flex flex-wrap gap-1'>
                                            <Badge>
                                                {item.count} {item.unit}
                                            </Badge>
                                            {item.life ? <Badge tone='warn'>{item.life}</Badge> : null}
                                            {item.financial?.majorBranch && <Badge>{item.financial.majorBranch} · {item.financial.storesClassCode}</Badge>}
                                            {item.financial && <Badge tone={item.financial.mappingStatus==='finance_review_required'||item.financial.mappingStatus==='not_configured'?'warn':'muted'}>{financialStatus(item.financial.mappingStatus)}</Badge>}
                                            {item.financial?.primaryGlCode && <Badge>GL {item.financial.primaryGlCode}</Badge>}
                                        </span>
                                    </span>
                                    <ChevronRight className='mt-1 h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}

function ClassView({
    classPath,
    body,
    code,
    onBack,
    onPick,
    pickLabel,
    showAttributes,
    names,
    labels: L,
}: {
    classPath: string;
    body: Record<string, unknown>;
    code: string;
    onBack: () => void;
    onPick?: (cls: ClassDetail) => void;
    pickLabel: string;
    showAttributes: boolean;
    names: Map<string, string>;
    labels: BrowserLabels;
}) {
    const { data, error, loading } = useLoad(() => callBackend<ClassDetail>(classPath, { ...body, code }), [classPath, code]);
    const columns = useMemo<Array<Column<AttrDef>>>(
        () => [
            { key: 'code', label: 'Attribute code', value: (r) => r.code, className: 'font-mono whitespace-nowrap' },
            { key: 'name', label: 'Attribute', value: (r) => r.name },
            { key: 'required', label: 'Required', value: (r) => (r.required ? 'Yes' : 'No'), render: (r) => (r.required ? <Badge tone='danger'>Required</Badge> : <span className='text-slate-500'>Optional</span>) },
            { key: 'type', label: 'Type', value: (r) => typeLabel(r.dataType) },
            { key: 'unit', label: 'Unit', value: (r) => r.unit },
            { key: 'domain', label: 'Domain', value: (r) => r.domainName },
            { key: 'specific', label: `${L.cls} specific`, value: (r) => (r.specific ? 'Yes' : 'No'), hidden: true },
            { key: 'options', label: 'Options', value: (r) => r.options.map((o) => o.label).join(', '), hidden: true },
            { key: 'description', label: 'Description', value: (r) => r.description },
        ],
        [L]
    );
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the entry.'}</Alert>;
    return (
        <div className='space-y-3'>
            <button type='button' onClick={onBack} className='text-sm text-slate-400'>
                ← {data.subcategoryCode} {names.get(data.subcategoryCode) ?? ''}
            </button>
            <Card>
                <p className='font-mono text-xs text-emerald-300'>{data.code}</p>
                <h2 className='text-lg font-semibold text-white'>{data.name}</h2>
                <p className='mt-1 text-sm text-slate-300'>{data.description}</p>
                <div className='mt-2 flex flex-wrap gap-1'>
                    {showAttributes && <Badge>{data.attributes.length} attributes</Badge>}
                    {showAttributes && <Badge tone='danger'>{data.attributes.filter((a) => a.required).length} required</Badge>}
                    {data.usefulLifeYears && <Badge tone='warn'>Useful life {lifeText(data.usefulLifeYears)}</Badge>}
                </div>
                <p className='mt-2 text-xs text-slate-500'>
                    {data.groupCode} {names.get(data.groupCode)} › {data.categoryCode} {names.get(data.categoryCode)}
                </p>
                {data.synonyms.length > 0 && <p className='mt-1 text-xs text-slate-400'>Also known as: {data.synonyms.join(', ')}</p>}
                <p className='mt-1 text-xs text-slate-500'>Profiles: {data.profiles.map((p) => p.name || p.code).join(' · ')}</p>
                {!!data.legacyCodes?.length && <p className='mt-1 text-xs text-slate-500'>Previous codes: {data.legacyCodes.join(', ')}</p>}
                <section aria-label='Financial classification and GL account determination' className='mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3 space-y-3'>
                    <div>
                        <h3 className='text-sm font-semibold text-white'>Financial classification &amp; GL determination</h3>
                        <p className='text-xs text-slate-400'>Reference mapping is not a posted GL entry. Finance and legal-entity policy govern activation.</p>
                    </div>
                    <div className='grid grid-cols-2 gap-2 text-xs'>
                        {[
                            ['Mapping status',financialStatus(data.financial?.mappingStatus||'not_configured')],
                            ['MRO / Non-MRO',data.financial?.majorBranch||'Not applicable'],
                            ['Stores class',data.financial?.storesClassName||'Not configured'],
                            ['Account purpose',data.financial?.accountPurpose||'Not specified'],
                            ['GL determination',data.financial?.determinationMode||'Not configured'],
                            ['Direct procurement',eligible(data.financial?.usedInProcurement)],
                            ['Budget eligible',eligible(data.financial?.usedInBudget)],
                            ['Procurement posting',eligible(data.financial?.usedInProcurementPosting)],
                            ['Cost object',data.financial?.costObjectRequirement||'Per tenant policy'],
                            ['Legal-entity scope',data.financial?.legalEntityApplicability||'Per tenant policy'],
                            ['Corporate scope',data.financial?.corporateApplicability||'Per tenant policy'],
                            ['Numbering pattern',data.financial?.materialNumberPattern||'Not applicable'],
                        ].map(([label,value])=><div key={label} className='min-w-0 rounded-lg bg-slate-900 p-2'>
                            <p className='text-slate-400 text-[11px]'>{label}</p>
                            <p className='mt-1 break-words font-medium text-slate-100'>{value}</p>
                        </div>)}
                    </div>
                    {!!data.financial?.routes?.length && (
                        <div className='space-y-2'>
                            <h4 className='text-sm font-semibold text-white'>Applicable GL routes ({data.financial.routes.length})</h4>
                            {data.financial.routes.map((route,index)=>(
                                <div key={route.event+route.glCode+index} className='rounded-lg border border-slate-800 bg-slate-900 p-2'>
                                    <p className='text-xs text-slate-200 font-semibold break-words'>{route.event}</p>
                                    <p className='font-mono text-xs text-emerald-300 break-words'>{route.glCode}</p>
                                    <p className='text-xs text-slate-300 break-words'>{route.glName||'GL description not provided'}</p>
                                    <p className='text-[11px] text-amber-300'>{financialStatus(route.status)} · {route.systemDerived?'System-derived':'Purpose-selectable candidate'}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    {data.financial?.pendingFinanceApproval && <p role='status' className='text-xs text-amber-300'>This proposed GL account is inactive and requires Finance sign-off.</p>}
                    {!data.financial && <p className='text-xs text-amber-300'>No integrated accounting metadata in the active catalogue.</p>}
                </section>
                {(data.accounting || data.financialMapping) && (
                    <section className='mt-3 rounded-xl border border-slate-700 bg-slate-950 p-3' aria-label='Financial configuration'>
                        <h3 className='text-sm font-semibold text-white'>Financial configuration</h3>
                        <dl className='mt-2 space-y-2'>
                            {Object.entries(data.financialMapping ?? data.accounting ?? {}).map(([key, value]) => (
                                <div key={key} className='grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2 border-t border-slate-800 pt-2 text-xs'>
                                    <dt className='break-words text-slate-400'>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</dt>
                                    <dd className='min-w-0 break-words text-slate-200'>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'Not configured')}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                )}
                {!!data.properties?.length && (
                    <details className='mt-3 rounded-xl border border-slate-800 bg-slate-950'>
                        <summary className='cursor-pointer px-3 py-2 text-sm font-medium text-slate-200'>Properties ({data.properties.length})</summary>
                        <dl className='max-h-72 space-y-1 overflow-y-auto overscroll-contain px-3 pb-3 text-xs'>
                            {data.properties.map((p) => (
                                <div key={p.label} className='grid grid-cols-[9rem_1fr] gap-2 border-t border-slate-800 pt-1'>
                                    <dt className='text-slate-500'>{p.label}</dt>
                                    <dd className='text-slate-200'>{p.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </details>
                )}
                {onPick && (
                    <Button className='mt-3 w-full' onClick={() => onPick(data)}>
                        {pickLabel}
                    </Button>
                )}
            </Card>
            {showAttributes && <RichTable id={`${L.tableId}.attributes`} title={`${data.code} attributes`} fileName={`MEMS_${data.code}_attributes`} columns={columns} rows={data.attributes} rowKey={(r) => r.code} height='h-[calc(100dvh-20rem)]' />}
        </div>
    );
}
