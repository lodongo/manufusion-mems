import { useState, type FormEvent } from 'react';
import { FileText, Folder, Lock, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { fmtDate, fmtKes, fmtUsdFromKes } from './format';
import { Badge, Button, Card, Empty, PageTitle, Spinner, SubTabs, TextArea, Toggle, useLoad } from './kit';
import DefaultLists from './DefaultLists';
import SkillsBrowser from './SkillsBrowser';
import SafMetadataBrowser from './SafMetadataBrowser';
import UtilityBrowser, { type Utility } from './UtilityBrowser';
import AssetDictionaryAdmin from './AssetDictionaryAdmin';
import ProcurementUnits, { type UomEntry } from './ProcurementUnits';
import { appConfirm } from '../components/dialogs';

export interface Module {
    code: string;
    name: string;
    category: string;
    description: string;
    features: string[];
    mandatory: boolean;
    enabled: boolean;
    initialized: boolean;
    initializedAt: string;
    monthlyPriceKes: number;
    annualPriceKes: number;
    pricePerUserKes: number;
    dependencies: string[];
    sortOrder: number;
    updatedAt: string;
}

interface ModulesData {
    modules: Module[];
    seeded: boolean;
    kesPerUsd: number | null;
    categories: string[];
}

export default function ModulesPage({ code, tab, canWrite, isSuper = false }: { code?: string; tab?: string; canWrite: boolean; isSuper?: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ModulesData>('/api/admin/modules/list'));
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [info, setInfo] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load modules.'}</Alert>;

    if (code) {
        const mod = code === 'new' ? undefined : data.modules.find((m) => m.code === code);
        if (code !== 'new' && !mod) return <Alert tone='error'>Module not found.</Alert>;
        return (
            <ModuleDetail
                key={code}
                module={mod}
                tab={tab}
                isSuper={isSuper}
                all={data.modules}
                categories={data.categories}
                kesPerUsd={data.kesPerUsd}
                canWrite={canWrite}
                onChanged={reload}
                onSaved={(saved) => {
                    reload();
                    navigate(saved ? `admin/modules/${saved}` : 'admin/modules');
                }}
            />
        );
    }

    const seed = async () => {
        if (!(await appConfirm('Upload the default ERP modules? This can only be done once.'))) return;
        setBusy(true);
        setActionError('');
        setInfo('');
        try {
            const res = await callBackend<{ added: number }>('/api/admin/modules/seed');
            setInfo(`${res.added} default modules uploaded.`);
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy(false);
        }
    };

    const initialised = data.modules.filter((m) => m.initialized).length;

    return (
        <div>
            <PageTitle
                title='Modules'
                subtitle={`${initialised} of ${data.modules.length} initialised · ${data.kesPerUsd ? `1 USD = KES ${data.kesPerUsd.toFixed(2)}` : 'USD rate not loaded'}`}
                action={
                    canWrite && (
                        <Button onClick={() => navigate('admin/modules/new')}>
                            <Plus className='h-4 w-4' />
                            Add module
                        </Button>
                    )
                }
            />
            {canWrite && !data.seeded && (
                <Card className='mb-4'>
                    <p className='text-sm text-slate-300'>Upload the default ERP module catalogue (one time only).</p>
                    <Button className='mt-3' busy={busy} onClick={seed}>
                        <Upload className='h-4 w-4' />
                        Upload default modules
                    </Button>
                </Card>
            )}
            {actionError && <div className='mb-3'><Alert tone='error'>{actionError}</Alert></div>}
            {info && <div className='mb-3'><Alert tone='info'>{info}</Alert></div>}
            {data.modules.length === 0 ? (
                <Empty>No modules yet.</Empty>
            ) : (
                <div className='space-y-3'>
                    {data.modules.map((m) => (
                        <button key={m.code} onClick={() => navigate(`admin/modules/${m.code}`)} className='block w-full text-left'>
                            <Card tone={m.initialized ? undefined : 'danger'}>
                                <div className='flex items-start gap-3'>
                                    <span className='flex h-11 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 font-mono text-sm font-bold text-emerald-300'>{m.code}</span>
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate font-medium text-white'>{m.name}</p>
                                        <p className='text-xs text-slate-500'>{m.category}</p>
                                        <div className='mt-2 flex flex-wrap gap-1'>
                                            {!m.initialized && <Badge tone='danger'>Not initialised</Badge>}
                                            {m.mandatory ? <Badge tone='warn'>Mandatory</Badge> : <Badge>Optional</Badge>}
                                            {m.enabled ? <Badge tone='brand'>Enabled</Badge> : <Badge tone='danger'>Disabled</Badge>}
                                        </div>
                                    </div>
                                    <div className='shrink-0 text-right'>
                                        <p className='text-sm font-medium text-white'>{fmtKes(m.monthlyPriceKes)}</p>
                                        <p className='text-xs text-slate-500'>{fmtUsdFromKes(m.monthlyPriceKes, data.kesPerUsd)}</p>
                                        <p className='text-xs text-slate-500'>per month</p>
                                    </div>
                                </div>
                            </Card>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

type Tab = 'overview' | 'setup' | 'metadata' | 'files' | 'dictionary';

function ModuleDetail({
    module,
    tab,
    isSuper,
    all,
    categories,
    kesPerUsd,
    canWrite,
    onChanged,
    onSaved,
}: {
    module?: Module;
    tab?: string;
    isSuper: boolean;
    all: Module[];
    categories: string[];
    kesPerUsd: number | null;
    canWrite: boolean;
    onChanged: () => void;
    onSaved: (code?: string) => void;
}) {
    const isNew = !module;
    const active: Tab = isNew ? 'setup' : tab === 'setup' || tab === 'metadata' || tab === 'files' || (tab === 'dictionary' && module?.code === 'PRC') ? tab : 'overview';
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const initialise = async () => {
        if (!module || !(await appConfirm(`Initialise ${module.code}? This creates the folder modules/${module.code} with ${module.code}_admin and ${module.code}_user.`))) return;
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/admin/modules/initialise', { code: module.code });
            onChanged();
            navigate(`admin/modules/${module.code}/files`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not initialise.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <button onClick={() => navigate('admin/modules')} className='mb-4 text-sm text-slate-400'>
                ← Modules
            </button>
            <PageTitle title={isNew ? 'Add module' : `${module.code} · ${module.name}`} subtitle={module?.category} />
            {module && !module.initialized && (
                <Card tone='danger' className='mb-4'>
                    <p className='text-sm text-slate-300'>
                        This module is not initialised. Initialising creates its dedicated folder <span className='font-mono'>modules/{module.code}</span> with the files{' '}
                        <span className='font-mono'>{module.code}_admin</span> and <span className='font-mono'>{module.code}_user</span>.
                    </p>
                    {canWrite && (
                        <Button className='mt-3' busy={busy} onClick={initialise}>
                            <Zap className='h-4 w-4' />
                            Initialise module
                        </Button>
                    )}
                    {error && <div className='mt-3'><Alert tone='error'>{error}</Alert></div>}
                </Card>
            )}
            {!isNew && (
                <SubTabs<Tab>
                    value={active}
                    onChange={(key) => navigate(`admin/modules/${module.code}/${key}`)}
                    tabs={[
                        { key: 'overview', label: 'Overview' },
                        { key: 'setup', label: 'Setup' },
                        { key: 'metadata', label: 'Metadata' },
                        ...(module.code === 'PRC' ? [{ key: 'dictionary' as Tab, label: 'Asset catalog' }] : []),
                        { key: 'files', label: 'Files' },
                    ]}
                />
            )}
            {active === 'overview' && module && <ModuleOverview module={module} kesPerUsd={kesPerUsd} />}
            {active === 'setup' && <ModuleForm module={module} all={all} categories={categories} kesPerUsd={kesPerUsd} canWrite={canWrite} onSaved={onSaved} />}
            {(active === 'metadata' || active === 'files') && module && <Workspace module={module} view={active} canWrite={canWrite} isSuper={isSuper} />}
            {active === 'dictionary' && module?.code === 'PRC' && (module.initialized ? <AssetDictionaryAdmin canWrite={canWrite} isSuper={isSuper} /> : <Card tone='danger'><p className='text-sm text-slate-300'>Initialise PRC first.</p></Card>)}
        </div>
    );
}

function ModuleOverview({ module, kesPerUsd }: { module: Module; kesPerUsd: number | null }) {
    const prices = [
        { label: 'Monthly', kes: module.monthlyPriceKes },
        { label: 'Annual', kes: module.annualPriceKes },
        { label: 'Per user / month', kes: module.pricePerUserKes },
    ];
    return (
        <div className='space-y-4'>
            <Card>
                <div className='mb-3 flex flex-wrap gap-1'>
                    {module.initialized ? <Badge tone='brand'>Initialised {fmtDate(module.initializedAt)}</Badge> : <Badge tone='danger'>Not initialised</Badge>}
                    {module.mandatory ? <Badge tone='warn'>Mandatory</Badge> : <Badge>Optional</Badge>}
                    {module.enabled ? <Badge tone='brand'>Enabled</Badge> : <Badge tone='danger'>Disabled</Badge>}
                </div>
                <p className='whitespace-pre-line text-sm leading-relaxed text-slate-300'>{module.description}</p>
            </Card>
            {module.features.length > 0 && (
                <Card>
                    <h2 className='mb-2 font-semibold text-white'>Features</h2>
                    <ul className='list-disc space-y-1 pl-5 text-sm text-slate-300'>
                        {module.features.map((f) => (
                            <li key={f}>{f}</li>
                        ))}
                    </ul>
                </Card>
            )}
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Cost plan</h2>
                <ul className='divide-y divide-slate-800'>
                    {prices.map((p) => (
                        <li key={p.label} className='flex items-center justify-between py-2 text-sm'>
                            <span className='text-slate-400'>{p.label}</span>
                            <span className='text-right'>
                                <span className='block font-medium text-white'>{fmtKes(p.kes)}</span>
                                <span className='block text-xs text-slate-500'>{fmtUsdFromKes(p.kes, kesPerUsd)}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </Card>
            <Card>
                <h2 className='mb-2 font-semibold text-white'>Depends on</h2>
                <p className='text-sm text-slate-300'>{module.dependencies.length ? module.dependencies.join(', ') : 'No other modules'}</p>
                <p className='mt-2 text-xs text-slate-500'>Last updated {fmtDate(module.updatedAt)}</p>
            </Card>
        </div>
    );
}

interface MetaList {
    key: string;
    title: string;
    description: string;
    items: Array<{ code: string; label: string; active: boolean; color?: string; category?: string; subcategory?: string; description?: string; selectable?: boolean; symbol?: string; system?: string; baseUnit?: string; multiplier?: number; categoryCode?: string }>;
    updatedAt: string;
}

interface WorkspaceData {
    workspace: { code: string; folder?: string; initializedAt?: string; initializedBy?: string } | null;
    files: Array<{ id: string; name?: string; kind?: string; title?: string; description?: string; path?: string; version?: number; audience?: string; createdAt?: string }>;
    metadata: MetaList[];
    defaultsAvailable?: string[];
}

function Workspace({ module, view, canWrite, isSuper }: { module: Module; view: 'metadata' | 'files'; canWrite: boolean; isSuper: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<WorkspaceData>('/api/admin/modules/workspace', { code: module.code }), [module.code, module.initialized]);
    const [editing, setEditing] = useState<MetaList | 'new' | null>(null);

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the module workspace.'}</Alert>;
    if (!data.workspace) return <Card tone='danger'><p className='text-sm text-slate-300'>Initialise this module first.</p></Card>;

    if (view === 'files') {
        return (
            <div className='space-y-3'>
                <Card>
                    <div className='flex items-center gap-2'>
                        <Folder className='h-5 w-5 text-emerald-400' />
                        <p className='font-mono text-sm text-white'>{data.workspace.folder}/</p>
                    </div>
                    <p className='mt-1 text-xs text-slate-500'>
                        Initialised {fmtDate(data.workspace.initializedAt)} by {data.workspace.initializedBy}
                    </p>
                </Card>
                {data.files.map((f) => (
                    <Card key={f.id}>
                        <div className='flex items-start gap-3'>
                            <FileText className='mt-0.5 h-5 w-5 shrink-0 text-emerald-400' />
                            <div className='min-w-0'>
                                <p className='font-mono text-sm font-semibold text-white'>{f.name}</p>
                                <p className='text-sm text-slate-300'>{f.title}</p>
                                <p className='mt-1 text-xs text-slate-400'>{f.description}</p>
                                <p className='mt-1 text-xs text-slate-500'>
                                    {f.path} · v{f.version} · opens in {f.audience}
                                </p>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        );
    }

    if (editing && editing !== 'new' && module.code === 'AST' && editing.key === 'utilitySupplies') return <UtilityBrowser items={editing.items as Utility[]} onBack={()=>setEditing(null)}/>;

    if (editing && editing !== 'new' && module.code === 'SAF') return <SafMetadataBrowser title={editing.title} items={editing.items} onCancel={()=>setEditing(null)}/>;

    if (editing && editing !== 'new' && module.code === 'HRM' && editing.key === 'skillsMaster') return <SkillsBrowser items={editing.items} canWrite={canWrite} canReplace={isSuper} onDone={()=>{setEditing(null);reload()}} onCancel={()=>setEditing(null)}/>;

    if (editing && editing !== 'new' && module.code === 'PRC' && editing.key === 'unitsOfMeasure') {
        return <ProcurementUnits items={editing.items as UomEntry[]} canWrite={canWrite} onDone={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />;
    }

    if (editing) {
        return (
            <MetaListForm
                code={module.code}
                list={editing === 'new' ? undefined : editing}
                canWrite={canWrite}
                onDone={() => {
                    setEditing(null);
                    reload();
                }}
                onCancel={() => setEditing(null)}
            />
        );
    }

    return (
        <div className='space-y-3'>
            {canWrite && (data.defaultsAvailable?.length ?? 0) > 0 && <DefaultLists code={module.code} keys={data.defaultsAvailable ?? []} onDone={reload} />}
            {module.code === 'INV' && (
                <Card className='border-emerald-500/40'>
                    <p className='font-medium text-white'>Warehouse › storage location › physical location</p>
                    <p className='mt-1 text-xs text-slate-400'>MEMS codifies two lists here: Material classifications (MCL-, colour-coded) and Storage location types (SLT-). Organizations name the storage locations of each warehouse, choosing a type and a classification from these lists. Material subcategories are chosen only when a cluster of bins is created. Entries can be disabled but never removed.</p>
                </Card>
            )}
            <div className='flex items-center justify-between'>
                <p className='text-sm text-slate-400'>Lists of selectable values used inside {module.code}.</p>
                {canWrite && (
                    <Button variant='secondary' onClick={() => setEditing('new')}>
                        <Plus className='h-4 w-4' />
                        Add list
                    </Button>
                )}
            </div>
            {data.metadata.length === 0 ? (
                <Empty>No metadata lists yet.</Empty>
            ) : (
                data.metadata.filter(list => module.code !== 'PRC' || list.key !== 'stockingPolicies').map((list) => (
                    <button key={list.key} onClick={() => setEditing(list)} className='block w-full text-left'>
                        <Card>
                            <div className='flex items-start justify-between gap-3'>
                                <div className='min-w-0'>
                                    <p className='font-medium text-white'>{list.title}</p>
                                    <p className='font-mono text-xs text-slate-500'>
                                        {module.code}.{list.key}
                                    </p>
                                    {list.description && <p className='mt-1 text-xs text-slate-400'>{list.description}</p>}
                                </div>
                                <Badge>{list.items.filter(i=>i.active !== false).length}/{list.items.length} enabled</Badge>
                            </div>
                        </Card>
                    </button>
                ))
            )}
        </div>
    );
}

function MetaListForm({ code, list, canWrite, onDone, onCancel }: { code: string; list?: MetaList; canWrite: boolean; onDone: () => void; onCancel: () => void }) {
    const isNew = !list;
    const [key, setKey] = useState(list?.key ?? '');
    const [title, setTitle] = useState(list?.title ?? '');
    const [description, setDescription] = useState(list?.description ?? '');
    const [entries, setEntries] = useState((list?.items ?? []).map((i) => `${i.code} | ${i.label}${i.active ? '' : ' | inactive'}`).join('\n'));
    const [mntItems, setMntItems] = useState(list?.items ?? []);
    const isMnt = (code === 'MNT' || (code === 'INV' && (list?.key === 'materialClassifications' || list?.key === 'storageLocationTypes'))) && !!list;
    const isStockMeta=code==='PRC'&&!!list&&['stockOwnership','supplyArrangements','stockCustody','stockConditions','replenishmentStrategies','stockPurposes','stockAllocations','financialProfiles','valuationMethods','traceabilityControls','titleTransferTriggers','specialStockPrograms','warehouseRestrictions','stockPlanningControls','ownershipSettlementTriggers'].includes(list.key);
    const [filterStock,setFilterStock]=useState('');
    const [newStockLabel,setNewStockLabel]=useState('');
    const [newStockDescription,setNewStockDescription]=useState('');
    const [stockError,setStockError]=useState('');
    const canAddColor = code === 'INV' && list?.key === 'materialClassifications' && canWrite;
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const ro = !canWrite;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const items = entries
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [itemCode = '', label = '', flag = ''] = line.split('|').map((p) => p.trim());
                return { code: itemCode, label: label || itemCode, active: flag.toLowerCase() !== 'inactive' };
            });
        setBusy('save');
        try {
            await callBackend('/api/admin/modules/metadata/save', { code, isNew, list: { key, title, description, items: (isMnt || isStockMeta) ? mntItems : items } });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!list || !(await appConfirm(`Delete the metadata list ${title}?`))) return;
        setBusy('delete');
        try {
            await callBackend('/api/admin/modules/metadata/delete', { code, key: list.key });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    return (
        <form onSubmit={submit} noValidate className='space-y-4'>
            <Card className='space-y-4'>
                {isNew ? (
                    <Field id='meta-key' label='List key (e.g. taxCodes)' maxLength={40} value={key} onChange={(e) => setKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} />
                ) : (
                    <div className='flex h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-sm text-slate-400'>
                        <Lock className='h-4 w-4' />
                        {code}.{list.key}
                    </div>
                )}
                <Field id='meta-title' label='Title' maxLength={60} value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} />
                <Field id='meta-description' label='Description (optional)' maxLength={300} value={description} disabled={ro} onChange={(e) => setDescription(e.target.value)} />
                {isMnt && <div className='max-h-[60dvh] space-y-2 overflow-y-auto rounded-xl border border-slate-700 p-2'>{mntItems.map((entry, idx) => <div key={entry.code} className='flex items-center gap-2 rounded-lg bg-slate-900 p-2'><input aria-label={'Color for ' + entry.label} type='color' value={entry.color || '#64748B'} disabled={ro} onChange={e => setMntItems(prev => prev.map((x,i)=>i===idx?{...x,color:e.target.value}:x))} className='h-8 w-9 shrink-0 cursor-pointer rounded' /><div className='min-w-0 flex-1'><div className='text-sm text-white'>{entry.label}</div><div className='font-mono text-[11px] text-slate-500'>{entry.code}{entry.selectable === false ? ' · Category' : ''}</div></div><label className='flex shrink-0 items-center gap-2 text-xs text-slate-300'><input type='checkbox' checked={entry.active !== false} disabled={ro} onChange={e=>setMntItems(prev=>prev.map((x,i)=>i===idx?{...x,active:e.target.checked}:x))} />Enabled</label></div>)}</div>}
                {isMnt && canAddColor && <AddColorEntry items={mntItems} onAdd={(entry) => setMntItems((prev) => [...prev, entry])} />}
                {isStockMeta && <div className='space-y-3'>
                  <p className='text-xs text-slate-400'>Descriptions are part of the controlled MEMS master. Edit the label, description or enabled status; codes remain stable so material references never silently change.</p>
                  <label className='block text-xs text-slate-300'>Filter values (optional)
                    <input type='search' value={filterStock} onChange={e=>setFilterStock(e.target.value)} placeholder='Code, label or description' className='mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-base text-white'/>
                  </label>
                  <div className='max-h-[56dvh] space-y-2 overflow-y-auto pr-1'>
                   {mntItems.map((entry,i)=>({entry,i})).filter(({entry})=>(entry.code+' '+entry.label+' '+(entry.description||'')).toLowerCase().includes(filterStock.toLowerCase())).map(({entry,i})=><div key={entry.code} className='space-y-2 rounded-xl border border-slate-700 p-3'>
                      <div className='flex items-center justify-between gap-2'>
                        <span className='font-mono text-xs font-semibold text-emerald-300'>{entry.code}</span>
                        <label className='flex items-center gap-2 text-xs text-slate-300'>
                          <input type='checkbox' checked={entry.active!==false} disabled={ro} onChange={e=>setMntItems(old=>old.map((x,j)=>i===j?{...x,active:e.target.checked}:x))}/>Enabled
                        </label>
                      </div>
                      <Field id={'meta-stock-label-'+i} label='Name' maxLength={120} value={entry.label} disabled={ro} onChange={e=>setMntItems(old=>old.map((x,j)=>i===j?{...x,label:e.target.value}:x))}/>
                      <TextArea id={'meta-stock-desc-'+i} label='Detailed description' rows={3} maxLength={500} value={entry.description||''} disabled={ro} onChange={e=>setMntItems(old=>old.map((x,j)=>i===j?{...x,description:e.target.value}:x))}/>
                   </div>)}
                  </div>
                  {canWrite&&<div className='space-y-2 rounded-xl border border-dashed border-slate-700 p-3'>
                    <p className='text-sm font-semibold text-white'>Add a codified variable</p>
                    <Field id='new-stock-name' label='Name' value={newStockLabel} maxLength={120} onChange={e=>setNewStockLabel(e.target.value)}/>
                    <TextArea id='new-stock-description' label='Description' value={newStockDescription} rows={3} maxLength={500} onChange={e=>setNewStockDescription(e.target.value)}/>
                    <Button type='button' variant='secondary' onClick={()=>{
                      if(newStockLabel.trim().length<2||newStockDescription.trim().length<20){setStockError('Provide a name and a detailed description of at least 20 characters.');return;}
                      const prefix=(mntItems[0]?.code||'ST01').replace(/\d+$/,'');
                      const next=mntItems.reduce((m,x)=>Math.max(m,Number(x.code.slice(prefix.length))||0),0)+1;
                      if(next>99){setStockError('This code series has reached 99 values. Contact MEMS Admin for a catalogue extension.');return;}
                      const code=prefix+String(next).padStart(2,'0');
                      if(mntItems.some(x=>x.code===code)){setStockError('Code already exists. Reload and retry.');return;}
                      setMntItems(old=>[...old,{code,label:newStockLabel.trim(),description:newStockDescription.trim(),active:true,selectable:true}]);
                      setNewStockLabel('');setNewStockDescription('');setStockError('');
                    }}>+ Add value</Button>
                    {stockError&&<p className='text-xs text-amber-300'>{stockError}</p>}
                  </div>}
                </div>}
                {!isMnt && !isStockMeta && <TextArea
                    id='meta-entries'
                    label='Entries: one per line as CODE | Label (add "| inactive" to hide)'
                    rows={10}
                    placeholder={'VAT16 | VAT 16%\nZERO | Zero rated\nEXEMPT | Exempt'}
                    value={entries}
                    disabled={ro}
                    onChange={(e) => setEntries(e.target.value)}
                />}
            </Card>
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex flex-wrap gap-2'>
                {canWrite && (
                    <Button type='submit' className='flex-1' busy={busy === 'save'} disabled={!!busy}>
                        Save list
                    </Button>
                )}
                <Button type='button' variant='secondary' onClick={onCancel}>
                    Back
                </Button>
                {canWrite && !isNew && (
                    <Button type='button' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove} aria-label='Delete list'>
                        <Trash2 className='h-4 w-4' />
                    </Button>
                )}
            </div>
        </form>
    );
}

/** Adds a colour-coded entry (e.g. a new material classification) with the next code in the list's series. */
function AddColorEntry({ items, onAdd }: { items: MetaList['items']; onAdd: (entry: MetaList['items'][number]) => void }) {
    const prefix = items[0]?.code.replace(/\d+$/, '') || 'MCL-';
    const next = items.reduce((m, i) => Math.max(m, Number(i.code.replace(/^\D+/, '')) || 0), 0) + 1;
    const suggested = `${prefix}${String(next).padStart(3, '0')}`;
    const [label, setLabel] = useState('');
    const [color, setColor] = useState('#64748B');
    const [error, setError] = useState('');
    const add = () => {
        const name = label.trim();
        if (name.length < 2 || name.length > 120) return setError('Enter a name of 2 to 120 characters.');
        if (items.some((i) => i.label.toLowerCase() === name.toLowerCase())) return setError('That name is already in the list.');
        if (items.some((i) => i.code === suggested)) return setError('Code clash. Reload and try again.');
        setError('');
        onAdd({ code: suggested, label: name, active: true, color, category: '', selectable: true });
        setLabel('');
    };
    return (
        <div className='space-y-2 rounded-xl border border-dashed border-slate-700 p-3'>
            <p className='text-xs text-slate-400'>
                Add an entry as <span className='font-mono text-slate-200'>{suggested}</span>, then save the list.
            </p>
            <div className='flex items-end gap-2'>
                <input aria-label='Colour' type='color' value={color} onChange={(e) => setColor(e.target.value)} className='h-12 w-12 shrink-0 cursor-pointer rounded' />
                <div className='min-w-0 flex-1'>
                    <Field id='add-color-label' label='Name' maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
                </div>
                <Button type='button' variant='secondary' onClick={add}>
                    <Plus className='h-4 w-4' />
                    Add
                </Button>
            </div>
            {error && <p className='text-xs text-amber-300'>{error}</p>}
        </div>
    );
}

function ModuleForm({
    module,
    all,
    categories,
    kesPerUsd,
    canWrite,
    onSaved,
}: {
    module?: Module;
    all: Module[];
    categories: string[];
    kesPerUsd: number | null;
    canWrite: boolean;
    onSaved: (code?: string) => void;
}) {
    const isNew = !module;
    const [code, setCode] = useState(module?.code ?? '');
    const [name, setName] = useState(module?.name ?? '');
    const [category, setCategory] = useState(module?.category ?? categories[0] ?? '');
    const [description, setDescription] = useState(module?.description ?? '');
    const [features, setFeatures] = useState((module?.features ?? []).join('\n'));
    const [mandatory, setMandatory] = useState(module?.mandatory ?? false);
    const [enabled, setEnabled] = useState(module?.enabled ?? true);
    const [monthly, setMonthly] = useState(String(module?.monthlyPriceKes ?? 0));
    const [annual, setAnnual] = useState(String(module?.annualPriceKes ?? 0));
    const [perUser, setPerUser] = useState(String(module?.pricePerUserKes ?? 0));
    const [deps, setDeps] = useState<string[]>(module?.dependencies ?? []);
    const [sortOrder, setSortOrder] = useState(String(module?.sortOrder ?? 100));
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const ro = !canWrite;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const cleanCode = code.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(cleanCode)) return setError('The module code must be exactly 3 letters, e.g. FIN.');
        if (isNew && all.some((m) => m.code === cleanCode)) return setError(`A module with code ${cleanCode} already exists.`);
        setBusy('save');
        try {
            const res = await callBackend<{ module: Module | null }>('/api/admin/modules/save', {
                isNew,
                module: {
                    code: cleanCode,
                    name,
                    category,
                    description,
                    features: features.split('\n').map((f) => f.trim()).filter(Boolean),
                    mandatory,
                    enabled: mandatory || enabled,
                    monthlyPriceKes: Number(monthly),
                    annualPriceKes: Number(annual),
                    pricePerUserKes: Number(perUser),
                    dependencies: deps,
                    sortOrder: Number(sortOrder),
                },
            });
            onSaved(res.module?.code ?? cleanCode);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!module || !(await appConfirm(`Delete module ${module.code} · ${module.name}? This cannot be undone.`))) return;
        setBusy('delete');
        setError('');
        try {
            await callBackend('/api/admin/modules/delete', { code: module.code });
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    const usd = (value: string) => fmtUsdFromKes(Number(value) || 0, kesPerUsd);

    return (
        <form onSubmit={submit} noValidate className='space-y-4'>
            <Card className='space-y-4'>
                {isNew ? (
                    <Field
                        id='module-code'
                        label='Module code (3 letters)'
                        maxLength={3}
                        autoCapitalize='characters'
                        placeholder='e.g. FIN'
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
                    />
                ) : (
                    <div>
                        <span className='mb-1 block text-sm text-slate-300'>Module code</span>
                        <div className='flex h-12 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-slate-400'>
                            <Lock className='h-4 w-4' />
                            {module.code}
                        </div>
                        <p className='mt-1 text-xs text-slate-500'>The module code cannot be changed.</p>
                    </div>
                )}
                <Field id='module-name' label='Name' maxLength={60} value={name} disabled={ro} onChange={(e) => setName(e.target.value)} />
                <SelectField id='module-category' label='Category' value={category} disabled={ro} onChange={(e) => setCategory(e.target.value)}>
                    {categories.map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </SelectField>
                <TextArea id='module-description' label='Description' rows={6} maxLength={3000} value={description} disabled={ro} onChange={(e) => setDescription(e.target.value)} />
                <TextArea id='module-features' label='Features (one per line)' rows={5} value={features} disabled={ro} onChange={(e) => setFeatures(e.target.value)} />
            </Card>

            <Card className='space-y-4'>
                <div className='flex items-center justify-between gap-3'>
                    <div>
                        <p className='text-sm font-medium text-white'>Mandatory</p>
                        <p className='text-xs text-slate-500'>Always on for every tenant</p>
                    </div>
                    <Toggle label='Mandatory' checked={mandatory} disabled={ro} onChange={setMandatory} />
                </div>
                <div className='flex items-center justify-between gap-3'>
                    <div>
                        <p className='text-sm font-medium text-white'>Enabled</p>
                        <p className='text-xs text-slate-500'>Available for tenants to use</p>
                    </div>
                    <Toggle label='Enabled' checked={mandatory || enabled} disabled={ro || mandatory} onChange={setEnabled} />
                </div>
            </Card>

            <Card className='space-y-4'>
                <h2 className='font-semibold text-white'>Cost plan (KES)</h2>
                {[
                    { id: 'monthly', label: 'Monthly price', value: monthly, set: setMonthly },
                    { id: 'annual', label: 'Annual price', value: annual, set: setAnnual },
                    { id: 'per-user', label: 'Price per user per month', value: perUser, set: setPerUser },
                ].map((p) => (
                    <div key={p.id}>
                        <Field id={p.id} label={p.label} type='number' inputMode='numeric' min={0} step={1} value={p.value} disabled={ro} onChange={(e) => p.set(e.target.value)} />
                        <p className='mt-1 text-xs text-slate-500'>≈ {usd(p.value)}</p>
                    </div>
                ))}
            </Card>

            <Card className='space-y-3'>
                <h2 className='font-semibold text-white'>Depends on</h2>
                <div className='flex flex-wrap gap-2'>
                    {all
                        .filter((m) => m.code !== module?.code)
                        .map((m) => {
                            const on = deps.includes(m.code);
                            return (
                                <button
                                    type='button'
                                    key={m.code}
                                    disabled={ro}
                                    onClick={() => setDeps(on ? deps.filter((d) => d !== m.code) : [...deps, m.code])}
                                    className={`h-11 rounded-full px-3 font-mono text-xs ${on ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-300'}`}
                                >
                                    {m.code}
                                </button>
                            );
                        })}
                </div>
                <Field id='sort-order' label='Sort order' type='number' inputMode='numeric' value={sortOrder} disabled={ro} onChange={(e) => setSortOrder(e.target.value)} />
            </Card>

            {error && <Alert tone='error'>{error}</Alert>}
            {canWrite && (
                <div className='flex flex-wrap gap-2'>
                    <Button type='submit' className='flex-1' busy={busy === 'save'} disabled={!!busy}>
                        {isNew ? 'Add module' : 'Save setup'}
                    </Button>
                    {!isNew && !module.initialized && (
                        <Button type='button' variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove}>
                            Delete
                        </Button>
                    )}
                </div>
            )}
        </form>
    );
}
