import { useEffect, useState } from 'react';
import { Warehouse, ArrowDown, Briefcase, Building, Building2, ChevronRight, Cog, Eye, FileText, Home, Layers, Lock, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react';
import WorkCenterAsset from './WorkCenterAsset';
import EquipmentUtilities from './EquipmentUtilities';
import StoredEnergy from './StoredEnergy';
import StoredEnergyReview from './StoredEnergyReview';
import AssemblyActivities from './AssemblyActivities';
import ActivityRiskRegister from './ActivityRiskRegister';
import ActivityRiskLegacy from './ActivityRiskLegacy';
import ActivityRiskReview from './ActivityRiskReview';
import WarehouseSetup from './WarehouseSetup';
import ClassField from './ClassField';
import { callBackend } from '../lib/backend';
import { fetchReference } from '../lib/reference';
import { navigate } from '../lib/route';
import { prepareFile } from '../apply/files';
import { Alert, Field, SelectField } from '../components/ui';
import { Badge, Button, Card, Empty, PageTitle, Spinner, TextArea, useLoad } from '../admin/kit';
import { CHAIN, LEVELS, LEVEL_EXAMPLES, MAX_UPPER_LEVELS, suggestCode, upperName, type FieldDef } from './structureDefs';
import type { Position } from './PositionsPage';

interface Node {
    id: string;
    level: string;
    tier: number;
    parentId: string;
    code: string;
    segment: string;
    name: string;
    description: string;
    status: string;
    managerUid: string;
    managerName: string;
    attributes: Record<string, string | number>;
    roleCodes: string[];
    logoUrl?: string;
    managerRoleCode?: string;
    managerRoleTitle?: string;
    managerHolders?: string[];
    childCount?: number;
}

interface BomLine {
    component: string;
    description: string;
    quantity: number;
    unit: string;
}

interface Bom {
    id: string;
    assemblyId: string;
    code: string;
    version: number;
    name: string;
    status: string;
    lines: BomLine[];
}

interface Design {
    mode: string;
    names: string[];
    locked: boolean;
}

interface NodeData {
    node: Node | null;
    ancestors: Node[];
    children: Node[];
    boms: Bom[];
    design: Design;
}

type Mode = null | { type: 'create'; level: string } | { type: 'edit' } | { type: 'bom'; bom?: Bom } | { type: 'levels' } | { type: 'expand' } | { type: 'roles' } | { type: 'details' } | { type: 'asset'; configure?: boolean } | { type: 'utilities' } | { type: 'stored-energy' } | { type: 'activity-risk' } | { type: 'activity-risk-review' } | { type: 'loto-program' } | { type: 'stored-energy-review' } | { type: 'storage' } | { type: 'activities' };

const open = (id: string) => navigate(id === 'root' ? 'organization_admin/structure' : `organization_admin/structure/${id}`);

function labelOf(node: Pick<Node, 'level' | 'tier'>, names: string[]): string {
    return node.level === 'group' ? upperName(names, node.tier) : LEVELS[node.level]?.label ?? node.level;
}

function allowedChildren(node: Node | null, design: Design, children: Node[]): Array<{ level: string; label: string }> {
    const names = design.names;
    const count = names.length;
    const le = { level: 'legal_entity', label: 'Legal entity' };
    if (!node) {
        if (!design.mode) return [];
        if (design.mode === 'single') return children.some((c) => c.level === 'legal_entity') ? [] : [le];
        return count ? [{ level: 'group', label: upperName(names, 0) }] : [le];
    }
    if (node.level === 'group') return node.tier < count - 1 ? [{ level: 'group', label: upperName(names, node.tier + 1) }] : [le];
    return (LEVELS[node.level]?.children ?? []).map((l) => ({ level: l, label: LEVELS[l].label }));
}

export default function StructurePage({ nodeId, sub, canEdit }: { nodeId?: string; sub?: string; canEdit: boolean }) {
    const id = nodeId || 'root';
    return <NodeView key={id} id={id} canEdit={canEdit} start={sub} />;
}

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
    return (
        <button type='button' aria-label={label} title={label} onClick={onClick} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${danger ? 'border-red-500/40 text-red-400' : 'border-slate-700 text-slate-200'}`}>
            {children}
        </button>
    );
}

/** Navigation: where you are, a simple list of what is inside, and an add row. Details and editing open from the icons. */
function NodeView({ id, canEdit, start }: { id: string; canEdit: boolean; start?: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<NodeData>('/api/org/structure/node', { id }), [id]);
    const [mode, setMode] = useState<Mode>(start === 'asset' ? { type: 'asset', configure: true } : start === 'storage' ? { type: 'storage' } : null);
    const [hasUtilities,setHasUtilities]=useState(false);
    useEffect(()=>{let live=true;callBackend<{items:unknown[]}>('/api/org/ast/utilities/read',{workCenterId:id}).then(r=>{if(live)setHasUtilities(r.items.length>0)}).catch(()=>{if(live)setHasUtilities(false)});return ()=>{live=false}},[id,mode]);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the organization design.'}</Alert>;
    const node = data.node;
    const design = data.design;
    const names = design.names;
    const done = () => {
        setMode(null);
        reload();
    };

    if (mode?.type === 'levels') return <LevelsForm design={design} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'expand') return <AddUpperLevel onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'roles' && node) return <SiteRolesForm site={node} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'create' || mode?.type === 'edit') {
        const level = mode.type === 'create' ? mode.level : node!.level;
        const tier = mode.type === 'edit' ? node!.tier : level === 'group' ? (node ? node.tier + 1 : 0) : 0;
        const label = level === 'group' ? upperName(names, tier) : LEVELS[level].label;
        return (
            <NodeForm
                parent={mode.type === 'edit' ? null : node}
                parentCode={mode.type === 'edit' ? '' : node?.code ?? ''}
                level={level}
                label={label}
                existing={mode.type === 'edit' ? node! : undefined}
                canRecode={mode.type === 'edit' && node!.level === 'legal_entity' && data.children.length === 0}
                onDone={(newId) => (newId ? (mode.type === 'create' && level === 'work_center' ? navigate(`organization_admin/structure/${newId}/asset`) : open(newId)) : done())}
                onCancel={() => setMode(null)}
            />
        );
    }
    if (mode?.type === 'bom' && node) return <BomForm assembly={node} bom={mode.bom} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'asset' && node)
        return (
            <WorkCenterAsset
                workCenterId={node.id}
                configure={mode.configure}
                onBack={() => {
                    navigate(`organization_admin/structure/${node.id}`);
                    done();
                }}
            />
        );
    if (mode?.type === 'activities' && node) return <AssemblyActivities assemblyId={node.id} onBack={()=>setMode(null)}/>;
    if (mode?.type === 'utilities' && node) return <EquipmentUtilities workCenterId={node.id} onBack={()=>setMode(null)}/>;
    if (mode?.type === 'activity-risk' && node) return <ActivityRiskLegacy workCenterId={node.id} onBack={()=>setMode(null)} onReview={()=>setMode({type:'activity-risk-review'})} hierarchy={[...(data?.ancestors||[]),node].map(n=>({level:n.level,code:n.code,name:n.name}))}/>;
    if (mode?.type === 'activity-risk-review' && node) return <ActivityRiskReview workCenterId={node.id} onBack={()=>setMode({type:'activity-risk'})} hierarchy={[...(data?.ancestors||[]),node].map(n=>({level:n.level,code:n.code,name:n.name}))}/>;
    if (mode?.type === 'loto-program' && node) return <section className='space-y-4'><button type='button' onClick={()=>setMode(null)} className='rounded-lg border px-4 py-2'>← Back</button><h2 className='text-2xl font-semibold'>LOTO Program</h2><p className='text-sm text-slate-500'>Program configuration will be defined later.</p></section>;
    if (mode?.type === 'stored-energy' && node) return <ActivityRiskLegacy workCenterId={node.id} onBack={()=>setMode(null)} onReview={()=>setMode({type:'stored-energy-review'})} hierarchy={[...(data?.ancestors||[]),node].map(n=>({level:n.level,code:n.code,name:n.name}))}/>;
    if (mode?.type === 'stored-energy-review' && node) return <ActivityRiskReview workCenterId={node.id} onBack={()=>setMode({type:'stored-energy'})} hierarchy={[...(data?.ancestors||[]),node].map(n=>({level:n.level,code:n.code,name:n.name}))}/>;
    if (mode?.type === 'storage' && node)
        return (
            <WarehouseSetup
                costCenterId={node.id}
                onBack={() => {
                    navigate(`organization_admin/structure/${node.id}`);
                    done();
                }}
            />
        );
    if (mode?.type === 'details' && node) {
        const fields = LEVELS[node.level]?.fields ?? [];
        const currency = data.ancestors.find((a) => a.level === 'legal_entity')?.attributes.currencyCode;
        return (
            <div className='space-y-4'>
                <div className='flex items-center justify-between gap-2'>
                    <PageTitle title={node.name} subtitle={`${labelOf(node, names)} · ${node.code}`} />
                    <div className='flex gap-2'>
                        {canEdit && (
                            <IconButton label='Edit' onClick={() => setMode({ type: 'edit' })}>
                                <Pencil className='h-4 w-4' />
                            </IconButton>
                        )}
                        <IconButton label='Close' onClick={() => setMode(null)}>
                            <X className='h-4 w-4' />
                        </IconButton>
                    </div>
                </div>
                <Card className='space-y-2 text-sm'>
                    {node.level === 'legal_entity' && node.logoUrl && <img src={node.logoUrl} alt='Logo' className='mb-2 h-16 w-16 rounded-xl border border-slate-800 bg-slate-950 object-contain p-1' />}
                    <Row label='Code' value={node.code} />
                    <Row label='Name' value={node.name} />
                    <Row label='Level' value={node.level === 'group' ? `${labelOf(node, names)} (Level_${node.tier})` : labelOf(node, names)} />
                    <Row label='Status' value={node.status === 'inactive' ? 'Inactive' : 'Active'} />
                    {node.description && <Row label='Description' value={node.description} />}
                    {node.level !== 'cost_center' && !['work_center', 'equipment', 'assembly'].includes(node.level) && node.managerRoleCode && (
                        <>
                            <Row label='Manager (job role)' value={`${node.managerRoleTitle} (${node.managerRoleCode})`} />
                            <Row label='Held by' value={node.managerHolders?.length ? node.managerHolders.join(', ') : 'Nobody assigned yet'} />
                        </>
                    )}
                    {node.level === 'cost_center' && (
                        <>
                            <Row label='Cost center manager' value={node.managerRoleCode ? `${node.managerRoleTitle} (${node.managerRoleCode})` : '—'} />
                            <Row label='Held by' value={node.managerHolders?.length ? node.managerHolders.join(', ') : 'Nobody assigned yet'} />
                            <Row label='Currency (from legal entity)' value={String(currency ?? '—')} />
                        </>
                    )}
                    {node.level === 'site' && <Row label='Job roles used here' value={node.roleCodes.length ? node.roleCodes.join(', ') : 'None yet'} />}
                    {fields.map((f) => (node.attributes[f.key] !== undefined && node.attributes[f.key] !== '' ? <Row key={f.key} label={f.label} value={f.type === 'asset' || f.type === 'assetClass' ? `${String(node.attributes[f.key])} · ${String(node.attributes[`${f.key}Name`] ?? '')}` : String(node.attributes[f.key])} /> : null))}
                    {node.level === 'work_center' && <Row label='Asset' value={node.attributes.assetTag ? `${String(node.attributes.assetTag)} · ${String(node.attributes.assetTagName ?? '')}` : 'Not attributed yet'} />}
                </Card>
            </div>
        );
    }

    const chooseSingle = async () => {
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/structure/design/save', { mode: 'single', names: [] });
            setMode({ type: 'create', level: 'legal_entity' });
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!node || busy || !window.confirm(`Delete ${labelOf(node, names)} ${node.code}?`)) return;
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/structure/delete', { id: node.id });
            open(node.parentId || 'root');
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy(false);
        }
    };

    const allowed = allowedChildren(node, design, data.children);
    const nothingInside = data.children.length === 0 && data.boms.length === 0;

    return (
        <div className='space-y-3'>
            <PageTitle title='Organization design' subtitle='Choose a unit to configure it or add lower levels. Changes can be made later.' />
            <nav aria-label='Path' className='flex flex-wrap items-center gap-1 text-sm'>
                <button onClick={() => open('root')} className='flex items-center gap-1 rounded-lg px-2 py-1 text-emerald-300'>
                    <Home className='h-4 w-4' />
                    Organization
                </button>
                {[...data.ancestors, ...(node ? [node] : [])].map((n, i, arr) => (
                    <span key={n.id} className='flex items-center gap-1'>
                        <ChevronRight className='h-3.5 w-3.5 text-slate-600' />
                        <button onClick={() => open(n.id)} className={`rounded-lg px-2 py-1 font-mono text-xs ${i === arr.length - 1 ? 'bg-slate-800 text-white' : 'text-emerald-300'}`}>
                            {n.code}
                        </button>
                    </span>
                ))}
            </nav>

            {node && (
                <div className='flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3'>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-emerald-300'>{node.code}</p>
                        <p className='truncate text-white'>{node.name}</p>
                        <p className='truncate text-xs text-slate-500'>
                            {labelOf(node, names)}
                            {node.status === 'inactive' ? ' · inactive' : ''}
                        </p>
                    </div>
                    <IconButton label='Configure' onClick={() => setMode({ type: 'edit' })}>
                        <Cog className='h-4 w-4' />
                    </IconButton>
                    {canEdit && (
                        <IconButton label='Configure' onClick={() => setMode({ type: 'edit' })}>
                            <Pencil className='h-4 w-4' />
                        </IconButton>
                    )}
                    {canEdit && nothingInside && (
                        <IconButton label='Delete' danger onClick={remove}>
                            <Trash2 className='h-4 w-4' />
                        </IconButton>
                    )}
                </div>
            )}

            {!node && design.mode && (
                <div className='flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3'>
                    <div className='min-w-0 flex-1'>
                        <p className='text-white'>Organization</p>
                        <p className='truncate text-xs text-slate-500'>{design.mode === 'single' ? 'One legal entity' : names.length ? names.join(' › ') + ' › Legal entities' : 'Several legal entities'}</p>
                    </div>
                    {canEdit && design.mode === 'multi' && (
                        <IconButton label='Rename upper levels' onClick={() => setMode({ type: 'levels' })}>
                            <Pencil className='h-4 w-4' />
                        </IconButton>
                    )}
                    {canEdit && names.length < MAX_UPPER_LEVELS && (
                        <IconButton label='Adopt an additional upper level' onClick={() => setMode({ type: 'expand' })}>
                            <Plus className='h-4 w-4' />
                        </IconButton>
                    )}
                    {canEdit && design.mode === 'single' && (
                        <button type='button' onClick={async () => {
                            try { await callBackend('/api/org/structure/design/save', { mode: 'multi', names: [] }); reload(); }
                            catch (e) { setActionError(e instanceof Error ? e.message : 'Could not allow additional legal entities.'); }
                        }} className='rounded-xl border border-line px-3 py-2 text-xs text-brand'>Allow multiple legal entities</button>
                    )}
                </div>
            )}

            {!node && !design.mode && (
                <Card className='space-y-4'>
                    <div>
                        <p className='text-xs font-semibold uppercase tracking-wider text-emerald-400'>Let us start</p>
                        <p className='mt-1 text-lg font-semibold text-white'>Does your organization have more than one legal entity?</p>
                        <p className='mt-1 text-sm text-slate-400'>A legal entity is a separately registered company. Groups often have several, for example a holding company with subsidiaries in different countries.</p>
                    </div>
                    {canEdit ? (
                        <div className='grid gap-2 sm:grid-cols-2'>
                            <button type='button' onClick={() => setMode({ type: 'levels' })} className='rounded-2xl border border-slate-700 p-4 text-left active:bg-slate-800'>
                                <Building2 className='h-6 w-6 text-sky-400' />
                                <p className='mt-2 font-medium text-white'>Yes, more than one</p>
                                <p className='text-xs text-slate-400'>Next, declare the levels above your legal entities, such as Headquarters or Regional office.</p>
                            </button>
                            <button type='button' onClick={chooseSingle} disabled={busy} className='rounded-2xl border border-slate-700 p-4 text-left active:bg-slate-800 disabled:opacity-50'>
                                <Building className='h-6 w-6 text-emerald-400' />
                                <p className='mt-2 font-medium text-white'>No, just one</p>
                                <p className='text-xs text-slate-400'>Go straight to setting up your legal entity, then build downwards.</p>
                            </button>
                        </div>
                    ) : (
                        <Alert tone='info'>Your organization design has not been started yet.</Alert>
                    )}
                </Card>
            )}
            {actionError && <Alert tone='error'>{actionError}</Alert>}

            {(node || design.mode) && (
                <Card className='p-0'>
                    <ul className='divide-y divide-slate-800'>
                        {node?.level === 'site' && (
                            <li>
                                <button onClick={() => canEdit && setMode({ type: 'roles' })} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <Briefcase className='h-5 w-5 shrink-0 text-sky-400' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm text-white'>Job roles used at this site</p>
                                        <p className='text-xs text-slate-500'>{node.roleCodes.length ? `${node.roleCodes.length} selected` : 'None yet'}</p>
                                    </div>
                                    {canEdit && <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />}
                                </button>
                            </li>
                        )}
                        {node?.level === 'cost_center' && ['INV', 'WHS'].includes(String(node.attributes.costType ?? '')) && (
                            <li>
                                <button onClick={() => setMode({ type: 'storage' })} className='flex w-full items-center gap-3 bg-sky-500/5 px-4 py-3 text-left'>
                                    <Warehouse className='h-5 w-5 shrink-0 text-sky-300' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm font-medium text-white'>Storage layout, capacity and bins</p>
                                        <p className='truncate text-xs text-slate-500'>Material category, racking, floors, rows, racks, columns, positions and clusters</p>
                                    </div>
                                    <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        )}
                        {node?.level === 'assembly' && (<li><button onClick={()=>setMode({type:'activities'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><FileText className='h-5 w-5 shrink-0 text-blue-400'/><div className='min-w-0 flex-1'><p className='text-sm font-semibold'>Activity List</p><p className='text-xs text-slate-500'>PM and AM activities · skills · safety risk sources</p></div><ChevronRight className='h-4 w-4'/></button></li>)}
                        {node?.level === 'assembly' && (
                            <li>
                                <button onClick={() => navigate(`organization_admin/work_requests/new/${node.id}`)} className='flex w-full items-center gap-3 bg-amber-500/5 px-4 py-3 text-left'>
                                    <Wrench className='h-5 w-5 shrink-0 text-amber-300' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm font-medium text-white'>Raise work request</p>
                                        <p className='truncate text-xs text-slate-500'>Report a finding on this assembly (Maintenance)</p>
                                    </div>
                                    <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        )}
                        {node?.level === 'work_center' && (
                            <li>
                                <button onClick={() => setMode({ type: 'asset' })} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <Cog className='h-5 w-5 shrink-0 text-amber-400' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='text-sm text-white'>Asset and attributes</p>
                                        <p className='truncate text-xs text-slate-500'>
                                            {node.attributes.equipmentClass ? `${String(node.attributes.equipmentClass)} · ${String(node.attributes.equipmentClassName ?? '')}` : 'Not classified yet'}
                                            {node.attributes.assetTag ? ` · ${String(node.attributes.assetTag)}` : ' · tap to configure'}
                                        </p>
                                    </div>
                                    <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        )}
                        {node?.level === 'work_center' && (<li><button type='button' onClick={()=>setMode({type:'utilities'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><Cog className='h-5 w-5 shrink-0 text-blue-400'/><div className='min-w-0 flex-1'><p className='text-sm text-white'>Utilities</p><p className='truncate text-xs text-slate-500'>Add electrical, water, steam, CIP and other supplies</p></div><ChevronRight className='h-4 w-4 shrink-0 text-slate-500'/></button></li>)}
                        {node?.level === 'work_center' && (<li><button type='button' onClick={()=>setMode({type:'loto-program'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><Cog className='h-5 w-5 shrink-0 text-blue-500'/><div className='min-w-0 flex-1'><p className='text-sm'>LOTO Program</p><p className='truncate text-xs text-slate-500'>To be configured</p></div><ChevronRight className='h-4 w-4 shrink-0 text-slate-500'/></button></li>)}{node?.level === 'work_center' && (<li><button type='button' onClick={()=>setMode({type:'stored-energy'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><Cog className='h-5 w-5 shrink-0 text-orange-400'/><div className='min-w-0 flex-1'><p className='text-sm'>Activities and Activity-Based Risk Assessment</p><p className='truncate text-xs text-slate-500'>Assembly activities, hazards, impacts, risk review and downloads</p></div><ChevronRight className='h-4 w-4 shrink-0 text-slate-500'/></button></li>)}
                        {data.children.map((c) => (
                            <li key={c.id} className='mx-2 my-2 rounded-xl border border-line bg-panel shadow-sm'>
                                <button onClick={() => open(c.id)} className='flex w-full items-center gap-3 px-3 py-3 text-left'>
                                    <Layers className='h-5 w-5 shrink-0 text-emerald-400' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate text-sm font-medium text-ink'>{c.name}</p>
                                        <p className='truncate text-xs text-muted'>
                                            <span className='font-mono'>{c.code}</span> · {labelOf(c, names)}
                                            {c.status === 'inactive' ? ' · inactive' : ''}
                                        </p>
                                        <p className='mt-1 text-xs text-brand'>{c.childCount ?? 0} lower units configured · tap to configure</p>
                                    </div>
                                    <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                </button>
                            </li>
                        ))}
                        {data.boms.map((b) => (
                            <li key={b.id}>
                                <button onClick={() => canEdit && setMode({ type: 'bom', bom: b })} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                    <FileText className='h-5 w-5 shrink-0 text-lime-400' />
                                    <div className='min-w-0 flex-1'>
                                        <p className='truncate text-sm text-white'>{b.name}</p>
                                        <p className='truncate text-xs text-slate-500'>
                                            Bill of materials · version {b.version} · {b.lines.length} components · {b.status}
                                        </p>
                                    </div>
                                </button>
                            </li>
                        ))}
                        {nothingInside && <li className='px-4 py-3 text-sm text-muted'>Nothing configured at this level yet.</li>}
                        {canEdit &&
                            allowed.map((a) => (
                                <li key={a.level}>
                                    <button onClick={() => setMode({ type: 'create', level: a.level })} className='flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-emerald-300'>
                                        <Plus className='h-4 w-4 shrink-0' />
                                        {a.level === 'legal_entity' && design.mode === 'single' ? 'Set up your legal entity' : `Add ${a.label.toLowerCase()}`}
                                    </button>
                                </li>
                            ))}
                        {canEdit && node?.level === 'assembly' && (
                            <li>
                                <button onClick={() => setMode({ type: 'bom' })} className='flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-emerald-300'>
                                    <Plus className='h-4 w-4 shrink-0' />
                                    Add bill of materials
                                </button>
                            </li>
                        )}
                    </ul>
                </Card>
            )}
        </div>
    );
}

export function LegacyNodeView({ id, canEdit }: { id: string; canEdit: boolean }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<NodeData>('/api/org/structure/node', { id }), [id]);
    const [hasUtilities,setHasUtilities]=useState(false);
    useEffect(()=>{let live=true;callBackend<{items:unknown[]}>('/api/org/ast/utilities/read',{workCenterId:id}).then(r=>{if(live)setHasUtilities(r.items.length>0)}).catch(()=>{if(live)setHasUtilities(false)});return ()=>{live=false}},[id]);
    const [mode, setMode] = useState<Mode>(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the organization design.'}</Alert>;
    const node = data.node;
    const design = data.design;
    const names = design.names;
    const done = () => {
        setMode(null);
        reload();
    };

    if (mode?.type === 'levels') return <LevelsForm design={design} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'roles' && node) return <SiteRolesForm site={node} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'create' || mode?.type === 'edit') {
        const level = mode.type === 'create' ? mode.level : node!.level;
        const tier = mode.type === 'edit' ? node!.tier : level === 'group' ? (node ? node.tier + 1 : 0) : 0;
        const label = level === 'group' ? upperName(names, tier) : LEVELS[level].label;
        return (
            <NodeForm
                parent={mode.type === 'edit' ? null : node}
                parentCode={mode.type === 'edit' ? '' : node?.code ?? ''}
                level={level}
                label={label}
                existing={mode.type === 'edit' ? node! : undefined}
                canRecode={mode.type === 'edit' && node!.level === 'legal_entity' && data.children.length === 0}
                onDone={(newId) => (newId ? (mode.type === 'create' && level === 'work_center' ? navigate(`organization_admin/structure/${newId}/asset`) : open(newId)) : done())}
                onCancel={() => setMode(null)}
            />
        );
    }
    if (mode?.type === 'bom' && node) return <BomForm assembly={node} bom={mode.bom} onDone={done} onCancel={() => setMode(null)} />;
    if (mode?.type === 'asset' && node)
        return (
            <WorkCenterAsset
                workCenterId={node.id}
                configure={mode.configure}
                onBack={() => {
                    navigate(`organization_admin/structure/${node.id}`);
                    done();
                }}
            />
        );

    const chooseSingle = async () => {
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/structure/design/save', { mode: 'single', names: [] });
            setMode({ type: 'create', level: 'legal_entity' });
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!node || !window.confirm(`Delete ${labelOf(node, names)} ${node.code}?`)) return;
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/structure/delete', { id: node.id });
            open(node.parentId || 'root');
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy(false);
        }
    };

    const allowed = allowedChildren(node, design, data.children);
    const fields = node ? LEVELS[node.level]?.fields ?? [] : [];

    return (
        <div className='space-y-4'>
            <PageTitle title='Organization design' subtitle='Build your structure from the top down' />
            <nav aria-label='Path' className='-mt-2 flex flex-wrap items-center gap-1 text-sm'>
                <button onClick={() => open('root')} className='flex items-center gap-1 rounded-lg px-2 py-1 text-emerald-300'>
                    <Home className='h-4 w-4' />
                    Organization
                </button>
                {[...data.ancestors, ...(node ? [node] : [])].map((n, i, arr) => (
                    <span key={n.id} className='flex items-center gap-1'>
                        <ChevronRight className='h-3.5 w-3.5 text-slate-600' />
                        <button onClick={() => open(n.id)} className={`rounded-lg px-2 py-1 font-mono text-xs ${i === arr.length - 1 ? 'bg-slate-800 text-white' : 'text-emerald-300'}`}>
                            {n.code}
                        </button>
                    </span>
                ))}
            </nav>

            {!node && !design.mode && (
                <Card className='space-y-4'>
                    <div>
                        <p className='text-xs font-semibold uppercase tracking-wider text-emerald-400'>Let us start</p>
                        <p className='mt-1 text-lg font-semibold text-white'>Does your organization have more than one legal entity?</p>
                        <p className='mt-1 text-sm text-slate-400'>A legal entity is a separately registered company. Groups often have several, for example a holding company with subsidiaries in different countries.</p>
                    </div>
                    {canEdit ? (
                        <div className='grid gap-2 sm:grid-cols-2'>
                            <button type='button' onClick={() => setMode({ type: 'levels' })} className='rounded-2xl border border-slate-700 p-4 text-left active:bg-slate-800'>
                                <Building2 className='h-6 w-6 text-sky-400' />
                                <p className='mt-2 font-medium text-white'>Yes, more than one</p>
                                <p className='text-xs text-slate-400'>Next, declare the levels above your legal entities, such as Headquarters or Regional office.</p>
                            </button>
                            <button type='button' onClick={chooseSingle} disabled={busy} className='rounded-2xl border border-slate-700 p-4 text-left active:bg-slate-800 disabled:opacity-50'>
                                <Building className='h-6 w-6 text-emerald-400' />
                                <p className='mt-2 font-medium text-white'>No, just one</p>
                                <p className='text-xs text-slate-400'>Go straight to setting up your legal entity, then build downwards.</p>
                            </button>
                        </div>
                    ) : (
                        <Alert tone='info'>Your organization design has not been started yet.</Alert>
                    )}
                    {actionError && <Alert tone='error'>{actionError}</Alert>}
                </Card>
            )}

            {!node && design.mode && (
                <Card className='space-y-3'>
                    <div className='flex items-start justify-between gap-3'>
                        <div>
                            <p className='text-xs font-semibold uppercase tracking-wider text-emerald-400'>Design type</p>
                            <p className='font-semibold text-white'>{design.mode === 'single' ? 'One legal entity' : names.length ? `Several legal entities, ${names.length} level${names.length === 1 ? '' : 's'} above them` : 'Several legal entities'}</p>
                        </div>
                        {canEdit && design.mode === 'multi' && (
                            <Button variant='secondary' onClick={() => setMode({ type: 'levels' })}>
                                <Pencil className='h-4 w-4' />
                                Levels
                            </Button>
                        )}
                    </div>
                    <button onClick={() => navigate('organization_admin/positions')} className='flex w-full items-center gap-3 rounded-xl border border-slate-800 px-3 py-3 text-left'>
                        <Briefcase className='h-5 w-5 text-sky-400' />
                        <span className='min-w-0 flex-1'>
                            <span className='block text-sm text-white'>Job roles (ROL_)</span>
                            <span className='block text-xs text-slate-500'>Positions such as CEO and Manufacturing Manager</span>
                        </span>
                        <ChevronRight className='h-4 w-4 text-slate-500' />
                    </button>
                </Card>
            )}

            {node && (
                <Card className='space-y-3'>
                    <div className='flex items-start justify-between gap-3'>
                        <div className='flex min-w-0 gap-3'>
                            {node.level === 'legal_entity' && (
                                <div className='flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950'>
                                    {node.logoUrl ? <img src={node.logoUrl} alt='Logo' className='h-full w-full object-contain' /> : <Building className='h-6 w-6 text-slate-600' />}
                                </div>
                            )}
                            <div className='min-w-0'>
                                <Badge tone='brand'>{labelOf(node, names)}</Badge>
                                <p className='mt-2 break-all font-mono text-lg font-semibold text-white'>{node.code}</p>
                                <p className='text-sm text-slate-300'>{node.name}</p>
                                {node.description && <p className='mt-1 text-xs text-slate-500'>{node.description}</p>}
                            </div>
                        </div>
                        {node.status === 'inactive' && <Badge tone='danger'>Inactive</Badge>}
                    </div>
                    <div className='space-y-1 border-t border-slate-800 pt-3 text-sm'>
                        {node.level === 'group' && <Row label='Level' value={`Level_${node.tier}`} />}
                        {node.managerName && <Row label='Manager' value={node.managerName} />}
                        {node.level === 'cost_center' && node.managerRoleCode && (
                            <>
                                <Row label='Cost center manager' value={`${node.managerRoleTitle} (${node.managerRoleCode})`} />
                                <Row label='Held by' value={node.managerHolders?.length ? node.managerHolders.join(', ') : 'Nobody assigned yet'} />
                            </>
                        )}
                        {node.level === 'cost_center' && <Row label='Currency (from legal entity)' value={String(data.ancestors.find((a) => a.level === 'legal_entity')?.attributes.currencyCode ?? '—')} />}
                        {fields.map((f) => (node.attributes[f.key] !== undefined && node.attributes[f.key] !== '' ? <Row key={f.key} label={f.label} value={f.type === 'asset' || f.type === 'assetClass' ? `${String(node.attributes[f.key])} · ${String(node.attributes[`${f.key}Name`] ?? '')}` : String(node.attributes[f.key])} /> : null))}
                    </div>
                    {canEdit && (
                        <div className='flex gap-2'>
                            <Button variant='secondary' className='flex-1' onClick={() => setMode({ type: 'edit' })}>
                                <Pencil className='h-4 w-4' />
                                Edit
                            </Button>
                            {data.children.length === 0 && data.boms.length === 0 && (
                                <Button variant='danger' busy={busy} onClick={remove} aria-label='Delete'>
                                    <Trash2 className='h-4 w-4' />
                                </Button>
                            )}
                        </div>
                    )}
                    {actionError && <Alert tone='error'>{actionError}</Alert>}
                </Card>
            )}

            {node?.level === 'site' && (
                <Card className='space-y-3'>
                    <div className='flex items-center justify-between gap-3'>
                        <div>
                            <p className='font-semibold text-white'>Job roles used at this site</p>
                            <p className='text-xs text-slate-500'>{node.roleCodes.length ? `${node.roleCodes.length} selected` : 'None selected yet'}</p>
                        </div>
                        {canEdit && (
                            <Button variant='secondary' onClick={() => setMode({ type: 'roles' })}>
                                Choose
                            </Button>
                        )}
                    </div>
                    {node.roleCodes.length > 0 && (
                        <div className='flex flex-wrap gap-1.5'>
                            {node.roleCodes.map((c) => (
                                <Badge key={c}>{c}</Badge>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {allowed.length > 0 || data.children.length > 0 ? (
                <section>
                    <h2 className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>{node ? 'Inside this' : 'Top level'}</h2>
                    {data.children.length === 0 ? (
                        <Empty>Nothing here yet.</Empty>
                    ) : (
                        <Card className='p-0'>
                            <ul className='divide-y divide-slate-800'>
                                {node?.level === 'work_center' && (<li><button type='button' onClick={()=>setMode({type:'loto-program'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><Cog className='h-5 w-5 shrink-0 text-blue-500'/><div className='min-w-0 flex-1'><p className='text-sm'>LOTO Program</p><p className='truncate text-xs text-slate-500'>To be configured</p></div><ChevronRight className='h-4 w-4 shrink-0 text-slate-500'/></button></li>)}{node?.level === 'work_center' && (<li><button type='button' onClick={()=>setMode({type:'stored-energy'})} className='flex w-full items-center gap-3 px-4 py-3 text-left'><Cog className='h-5 w-5 shrink-0 text-orange-400'/><div className='min-w-0 flex-1'><p className='text-sm'>Activities and Activity-Based Risk Assessment</p><p className='truncate text-xs text-slate-500'>Assembly activities, hazards, impacts, risk review and downloads</p></div><ChevronRight className='h-4 w-4 shrink-0 text-slate-500'/></button></li>)}
                        {data.children.map((c) => (
                                    <li key={c.id}>
                                        <button onClick={() => open(c.id)} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                            <Layers className='h-5 w-5 shrink-0 text-emerald-400' />
                                            <div className='min-w-0 flex-1'>
                                                <p className='truncate font-mono text-xs text-emerald-300'>{c.code}</p>
                                                <p className='truncate text-sm text-white'>{c.name}</p>
                                                <p className='text-xs text-slate-500'>
                                                    {labelOf(c, names)}
                                                    {c.status === 'inactive' ? ' · inactive' : ''}
                                                </p>
                                            </div>
                                            <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}
                    {canEdit && allowed.length > 0 && (
                        <div className='mt-3 grid gap-2'>
                            {allowed.map((a) => (
                                <Button key={a.level} variant='secondary' onClick={() => setMode({ type: 'create', level: a.level })}>
                                    <Plus className='h-4 w-4' />
                                    {a.level === 'legal_entity' && design.mode === 'single' ? 'Set up your legal entity' : `Add ${a.label.toLowerCase()}`}
                                </Button>
                            ))}
                        </div>
                    )}
                </section>
            ) : null}

            {node?.level === 'assembly' && (
                <section>
                    <h2 className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>Bills of materials</h2>
                    {data.boms.length === 0 ? (
                        <Empty>No bills of materials yet.</Empty>
                    ) : (
                        <Card className='p-0'>
                            <ul className='divide-y divide-slate-800'>
                                {data.boms.map((b) => (
                                    <li key={b.id}>
                                        <button onClick={() => canEdit && setMode({ type: 'bom', bom: b })} className='flex w-full items-center justify-between gap-3 px-4 py-3 text-left'>
                                            <div className='min-w-0'>
                                                <p className='truncate font-mono text-xs text-emerald-300'>{b.code}</p>
                                                <p className='truncate text-sm text-white'>{b.name}</p>
                                                <p className='text-xs text-slate-500'>{b.lines.length} components</p>
                                            </div>
                                            <Badge tone={b.status === 'active' ? 'brand' : b.status === 'obsolete' ? 'danger' : 'muted'}>{b.status}</Badge>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}
                    {canEdit && (
                        <Button variant='secondary' className='mt-3 w-full' onClick={() => setMode({ type: 'bom' })}>
                            <Plus className='h-4 w-4' />
                            Add bill of materials
                        </Button>
                    )}
                </section>
            )}
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className='flex justify-between gap-3'>
            <span className='text-slate-400'>{label}</span>
            <span className='break-words text-right text-white'>{value}</span>
        </div>
    );
}

function Hierarchy({ names }: { names: string[] }) {
    const rows = [
        ...names.map((n, i) => ({ label: n, ref: `Level_${i}`, code: 'Own code', upper: true })),
        ...CHAIN.map((key) => ({ label: LEVELS[key].label, ref: '', code: LEVELS[key].example, upper: false })),
        { label: 'Bills of materials', ref: '', code: 'Not codified', upper: false },
    ];
    return (
        <ol className='space-y-1'>
            {rows.map((r, i) => (
                <li key={`${r.label}-${i}`}>
                    <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${r.upper ? 'bg-sky-500/10' : 'bg-slate-950'}`}>
                        <span className='min-w-0'>
                            <span className='font-medium text-white'>{r.label}</span>
                            {r.ref && <span className='ml-2 font-mono text-[10px] text-sky-300'>{r.ref}</span>}
                        </span>
                        <span className='truncate font-mono text-emerald-300'>{r.code}</span>
                    </div>
                    {i < rows.length - 1 && <ArrowDown className='mx-auto my-0.5 h-3 w-3 text-slate-600' />}
                </li>
            ))}
        </ol>
    );
}

function LevelsForm({ design, onDone, onCancel }: { design: Design; onDone: () => void; onCancel: () => void }) {
    const [names, setNames] = useState<string[]>(design.names);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const setCount = (count: number) => setNames((prev) => Array.from({ length: count }, (_, i) => prev[i] ?? ''));

    const save = async () => {
        setError('');
        if (names.some((n) => n.trim().length < 2)) return setError('Give every level a name of at least 2 characters.');
        setBusy(true);
        try {
            await callBackend('/api/org/structure/design/save', { mode: 'multi', names: names.map((n) => n.trim()) });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy(false);
        }
    };

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <PageTitle title='Levels above your legal entities' subtitle='Organizations with several legal entities' />
                <button onClick={onCancel} aria-label='Cancel' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <Card className='space-y-3 text-sm text-slate-300'>
                <p>
                    Groups usually organize their legal entities in layers. For example a <span className='text-white'>Headquarters</span> oversees <span className='text-white'>Regional offices</span>, each region oversees{' '}
                    <span className='text-white'>Country offices</span>, and each country office holds its legal entities.
                </p>
                <p>
                    <span className='text-white'>1.</span> Choose how many levels you have. <span className='text-white'>2.</span> Name each one. Level_0 is the top. Choose 0 if your legal entities sit directly under the organization.
                </p>
                <p className='text-xs text-slate-500'>MEMS keeps the generic references Level_0, Level_1... behind the scenes, so you can rename levels at any time without breaking codes, roles or approvals.</p>
            </Card>
            <Card className='space-y-4'>
                <div>
                    <p className='mb-2 text-sm text-slate-300'>How many levels sit above your legal entities?</p>
                    {design.locked && (
                        <p className='mb-2 flex items-center gap-2 text-xs text-amber-400'>
                            <Lock className='h-3.5 w-3.5' />
                            The number is fixed because units already exist. You can still rename the levels.
                        </p>
                    )}
                    <div className='grid grid-cols-7 gap-1.5'>
                        {Array.from({ length: MAX_UPPER_LEVELS + 1 }, (_, n) => (
                            <button
                                key={n}
                                type='button'
                                disabled={design.locked && n !== design.names.length}
                                onClick={() => setCount(n)}
                                className={`h-11 rounded-xl text-sm font-semibold disabled:opacity-30 ${names.length === n ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-300'}`}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                </div>
                {names.map((n, i) => (
                    <label key={i} className='block'>
                        <span className='mb-1 flex items-center justify-between text-sm text-slate-300'>
                            <span>{i === 0 ? 'Top level' : i === names.length - 1 ? 'Level just above legal entities' : `Level ${i + 1}`}</span>
                            <span className='font-mono text-xs text-sky-300'>Level_{i}</span>
                        </span>
                        <input
                            value={n}
                            maxLength={40}
                            placeholder={`e.g. ${LEVEL_EXAMPLES[i] ?? 'Unit'}`}
                            onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
                            className='h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
                        />
                    </label>
                ))}
            </Card>
            <Card>
                <p className='mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'>Preview</p>
                <Hierarchy names={names.map((n, i) => n.trim() || `Level_${i}`)} />
            </Card>
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button variant='secondary' onClick={onCancel}>
                    Cancel
                </Button>
                <Button className='flex-1' busy={busy} onClick={save}>
                    Save levels
                </Button>
            </div>
        </div>
    );
}

function AddUpperLevel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
    const [name, setName] = useState('');
    const [unitName, setUnitName] = useState('');
    const [segment, setSegment] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const save = async () => {
        if (!window.confirm('Add a new top hierarchy level above existing units? MEMS will preserve every existing unit and job role identifier.')) return;
        setBusy(true); setError('');
        try {
            await callBackend('/api/org/structure/design/expand', { name: name.trim(), unitName: unitName.trim(), segment: segment.trim().toUpperCase() });
            onDone();
            open('root');
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not extend the hierarchy.'); }
        finally { setBusy(false); }
    };
    return <div className='space-y-4'>
        <PageTitle title='Adopt an upper hierarchy level' subtitle='Extend your organization as you grow without rebuilding existing sites or job roles.' />
        <Card className='space-y-4'>
            <Field id='upper-level-name' label='Level name (e.g. Country office or Regional office)' value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <Field id='upper-unit-name' label='First unit name (e.g. East Africa)' value={unitName} onChange={(e) => setUnitName(e.target.value)} maxLength={120} />
            <Field id='upper-unit-code' label='Unit code (2–6 capital letters)' value={segment} onChange={(e) => setSegment(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6))} maxLength={6} />
            <p className='text-sm text-soft'>The new unit becomes the parent of the existing top-level units. Existing codes, sites and asset records are preserved. This is an audited, atomic change.</p>
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button variant='secondary' onClick={onCancel}>Cancel</Button>
                <Button className='flex-1' busy={busy} onClick={save}>Add upper level</Button>
            </div>
        </Card>
    </div>;
}

function SiteRolesForm({ site, onDone, onCancel }: { site: Node; onDone: () => void; onCancel: () => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ positions: Position[] }>('/api/org/positions/list'));
    const [selected, setSelected] = useState<string[]>(site.roleCodes);
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState('');
    const toggle = (code: string) => setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

    const save = async () => {
        setBusy(true);
        setSaveError('');
        try {
            await callBackend('/api/org/structure/site-roles', { siteId: site.id, roleCodes: selected });
            onDone();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not save.');
            setBusy(false);
        }
    };

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <PageTitle title='Job roles used at this site' subtitle={`${site.code} · ${site.name}`} />
                <button onClick={onCancel} aria-label='Cancel' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            {loading && !data ? (
                <Spinner />
            ) : error || !data ? (
                <Alert tone='error'>{error || 'Could not load roles.'}</Alert>
            ) : data.positions.length === 0 ? (
                <Card>
                    <Empty>No job roles yet. Create them under Job roles → Design first.</Empty>
                </Card>
            ) : (
                <Card className='p-0'>
                    <ul className='divide-y divide-slate-800'>
                        {data.positions.map((p) => (
                            <li key={p.code}>
                                <label className='flex cursor-pointer items-center gap-3 px-4 py-3'>
                                    <input type='checkbox' className='h-5 w-5 accent-emerald-500' checked={selected.includes(p.code)} onChange={() => toggle(p.code)} />
                                    <span className='min-w-0'>
                                        <span className='block text-sm text-white'>{p.title}</span>
                                        <span className='block font-mono text-xs text-slate-500'>{p.code}</span>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
            {saveError && <Alert tone='error'>{saveError}</Alert>}
            <div className='flex gap-2'>
                <Button variant='secondary' onClick={onCancel}>
                    Cancel
                </Button>
                <Button className='flex-1' busy={busy} onClick={save}>
                    Save roles ({selected.length})
                </Button>
            </div>
        </div>
    );
}

function NodeForm({
    parent,
    parentCode,
    level,
    label,
    existing,
    canRecode,
    onDone,
    onCancel,
}: {
    parent: Node | null;
    parentCode: string;
    level: string;
    label: string;
    existing?: Node;
    canRecode: boolean;
    onDone: (newId?: string) => void;
    onCancel: () => void;
}) {
    const def = LEVELS[level];
    const ref = useLoad(() => fetchReference());
    const [segment, setSegment] = useState(existing?.segment ?? '');
    const [segmentTouched, setSegmentTouched] = useState(!!existing);
    const [name, setName] = useState(existing?.name ?? '');
    const [description, setDescription] = useState(existing?.description ?? '');
    const [status, setStatus] = useState(existing?.status ?? 'active');
    const [attributes, setAttributes] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(existing?.attributes ?? {}).map(([k, v]) => [k, String(v)])));
    const [banks, setBanks] = useState<Array<{ id: string; name: string; swiftCode: string }>>([]);
    const [costTypes, setCostTypes] = useState<Array<{ code: string; label: string }>>([]);
    const [assetOpts, setAssetOpts] = useState<{ enabled: boolean; assets: Array<{ tag: string; name: string; className: string }> }>({ enabled: true, assets: [] });
    const [managerRoleCode, setManagerRoleCode] = useState(existing?.managerRoleCode ?? '');
    const [managerRoles, setManagerRoles] = useState<Array<{ code: string; title: string; selectedAtSite: boolean }>>([]);
    const [siteLabel, setSiteLabel] = useState('');
    const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? '');
    const [logoBusy, setLogoBusy] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');


    const country = attributes.countryCode ?? '';
    useEffect(() => {
        if (!def.fields.some((f) => f.type === 'bank') || !country) {
            setBanks([]);
            return;
        }
        callBackend<{ banks: Array<{ id: string; name: string; swiftCode: string }> }>('/api/org/reference/banks', { countryCode: country })
            .then((res) => setBanks(res.banks))
            .catch(() => setBanks([]));
    }, [country, def.fields]);

    useEffect(() => {
        if (!def.fields.some((f) => f.type === 'fin')) return;
        callBackend<{ types: Array<{ code: string; label: string }> }>('/api/org/reference/cost-center-types')
            .then((res) => setCostTypes(res.types))
            .catch(() => setCostTypes([]));
    }, [def.fields]);

    const managerParent = existing ? existing.parentId : parent?.id ?? 'root';
    const managerNode = existing?.id ?? '';
    useEffect(() => {
        callBackend<{ roles: Array<{ code: string; title: string; selectedAtSite: boolean }>; siteCode: string; siteName: string }>('/api/org/structure/manager-roles', { level, parentId: managerParent, nodeId: managerNode })
            .then((res) => {
                setManagerRoles(res.roles);
                setSiteLabel(res.siteCode ? `${res.siteCode} · ${res.siteName}` : '');
            })
            .catch(() => setManagerRoles([]));
    }, [level, managerParent, managerNode]);

    useEffect(() => {
        if (!def.fields.some((f) => f.type === 'asset')) return;
        callBackend<{ enabled: boolean; assets: Array<{ tag: string; name: string; className: string }> }>('/api/org/assets/options', { parentId: managerParent, nodeId: managerNode })
            .then(setAssetOpts)
            .catch(() => setAssetOpts({ enabled: false, assets: [] }));
    }, [def.fields, managerParent, managerNode]);

    const manualCode = def.manual && (!existing || canRecode);
    // Only cost centers and the levels above them have a manager.
    const allowsManager = !['work_center', 'equipment', 'assembly'].includes(level);
    const prefix = parentCode && level !== 'group' && level !== 'legal_entity' ? `${parentCode}-` : '';

    const onName = (value: string) => {
        setName(value);
        if (level === 'legal_entity' && !segmentTouched) setSegment(suggestCode(value));
    };

    const uploadLogo = async (file?: File) => {
        if (!file || !existing) return;
        setLogoBusy(true);
        setError('');
        try {
            const prepared = await prepareFile(file, true, { logo: true });
            const res = await callBackend<{ logoUrl: string }>('/api/org/structure/logo', { id: existing.id, data: prepared.data });
            setLogoUrl(res.logoUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setLogoBusy(false);
        }
    };

    const submit = async () => {
        setError('');
        const missing = def.fields.filter((f) => f.required && !String(attributes[f.key] ?? '').trim());
        if (!name.trim()) return setError('Enter a name.');
        if (level === 'cost_center' && !managerRoleCode) return setError('Choose the cost center manager role.');
        if (missing.length) return setError(`Please complete: ${missing.map((m) => m.label).join(', ')}.`);
        setBusy(true);
        try {
            if (existing) {
                let id = existing.id;
                if (canRecode && segment && segment !== existing.segment) {
                    const res = await callBackend<{ id: string }>('/api/org/structure/recode', { id, segment });
                    id = res.id;
                }
                await callBackend('/api/org/structure/update', { id, name, description, status, managerRoleCode: allowsManager ? managerRoleCode : '', attributes });
                onDone(id !== existing.id ? id : undefined);
            } else {
                const res = await callBackend<{ id: string }>('/api/org/structure/create', { parentId: parent?.id ?? 'root', level, segment, name, description, managerRoleCode: allowsManager ? managerRoleCode : '', attributes });
                onDone(res.id);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy(false);
        }
    };

    const countries = [...(ref.data?.countries ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const currencies = [...(ref.data?.currencies ?? [])].sort((a, b) => Number(b.usedInAfrica) - Number(a.usedInAfrica) || a.code.localeCompare(b.code));
    const meta = (key: string) => ref.data?.metadataLists.find((l) => l.key === key)?.items ?? [];
    const sections = Array.from(new Set(def.fields.map((f) => f.section ?? 'Details')));

    const renderField = (f: FieldDef) => {
        const value = attributes[f.key] ?? '';
        const set = (v: string) => setAttributes({ ...attributes, [f.key]: v });
        const label = `${f.label}${f.required ? ' *' : ''}`;
        if (f.type === 'assetClass')
            return (
                <ClassField
                    key={f.key}
                    label={f.label}
                    value={String(value)}
                    name={String(attributes[`${f.key}Name`] ?? '')}
                    locked={!!existing?.attributes.assetTag && !!existing?.attributes[f.key]}
                    onChange={(code, className) => setAttributes({ ...attributes, [f.key]: code, [`${f.key}Name`]: className })}
                />
            );
        if (['select', 'country', 'currency', 'meta', 'bank', 'fin', 'asset'].includes(f.type)) {
            const options =
                f.type === 'select'
                    ? (f.options ?? []).map((o) => ({ value: o, label: o }))
                    : f.type === 'country'
                      ? countries.map((c) => ({ value: c.iso2, label: `${c.flag} ${c.name}` }))
                      : f.type === 'currency'
                        ? currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))
                        : f.type === 'fin'
                          ? costTypes.map((o) => ({ value: o.code, label: `${o.code} · ${o.label}` }))
                          : f.type === 'meta'
                          ? meta(f.list ?? '').map((o) => ({ value: o.code, label: o.label }))
                          : f.type === 'asset'
                          ? assetOpts.assets.map((a) => ({ value: a.tag, label: `${a.tag} · ${a.name} (${a.className})` }))
                          : banks.map((b) => ({ value: b.id, label: `${b.name}${b.swiftCode ? ` (${b.swiftCode})` : ''}` }));
            return (
                <SelectField key={f.key} id={`sn-${f.key}`} label={label} value={value} onChange={(e) => set(e.target.value)}>
                    <option value=''>{f.type === 'bank' && !country ? 'Choose the country first' : f.type === 'fin' && !costTypes.length ? 'No cost center types loaded yet' : f.type === 'asset' && !assetOpts.enabled ? 'Asset Management (AST) is not enabled' : f.type === 'asset' && !assetOpts.assets.length ? 'No approved assets at this site yet' : f.type === 'asset' ? 'None' : 'Select...'}</option>
                    {options.map((o) => (
                        <option key={o.value} value={o.value}>
                            {o.label}
                        </option>
                    ))}
                </SelectField>
            );
        }
        return (
            <Field
                key={f.key}
                id={`sn-${f.key}`}
                label={label}
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'}
                inputMode={f.type === 'number' ? 'decimal' : f.type === 'phone' ? 'tel' : undefined}
                min={f.min}
                max={f.max}
                maxLength={160}
                placeholder={f.placeholder}
                value={value}
                onChange={(e) => set(e.target.value)}
            />
        );
    };

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <PageTitle title={existing ? `Edit ${label.toLowerCase()}` : `Set up ${label.toLowerCase()}`} subtitle={parent ? `Under ${parent.code} · ${parent.name}` : existing ? existing.code : 'At the top of your organization'} />
                <button onClick={onCancel} aria-label='Cancel' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <Card className='space-y-4'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Identity</p>
                {level === 'legal_entity' && existing && (
                    <label className='flex cursor-pointer items-center gap-4'>
                        <span className='relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-600 bg-slate-950'>
                            {logoUrl ? <img src={logoUrl} alt='Logo' className='h-full w-full object-contain p-1' /> : <Building className='h-6 w-6 text-slate-500' />}
                            {logoBusy && <span className='absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] text-white'>Uploading</span>}
                        </span>
                        <span className='text-sm text-slate-300'>
                            Legal entity logo
                            <span className='block text-xs text-slate-500'>Tap to upload a PNG or JPEG</span>
                        </span>
                        <input type='file' accept='image/png,image/jpeg' className='hidden' disabled={logoBusy} onChange={(e) => { void uploadLogo(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                )}
                <Field id='sn-name' label={level === 'legal_entity' ? 'Registered legal name *' : 'Name *'} maxLength={120} value={name} onChange={(e) => onName(e.target.value)} />
                {manualCode ? (
                    <label className='block'>
                        <span className='mb-1 block text-sm text-slate-300'>Code *</span>
                        <div className='flex'>
                            {prefix && <span className='flex h-12 items-center rounded-l-xl border border-r-0 border-slate-700 bg-slate-800 px-2 font-mono text-xs text-slate-300'>{prefix}</span>}
                            <input
                                value={segment}
                                onChange={(e) => {
                                    setSegmentTouched(true);
                                    setSegment(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, def.maxLength));
                                }}
                                maxLength={def.maxLength}
                                autoCapitalize='characters'
                                placeholder={def.example.split('-').pop()}
                                className={`h-12 w-full border border-slate-700 bg-slate-950 px-3 font-mono text-base text-white focus:border-emerald-500 focus:outline-none ${prefix ? 'rounded-r-xl' : 'rounded-xl'}`}
                            />
                        </div>
                        <span className='mt-1 block text-xs text-slate-500'>{existing ? 'You can change this code until sites are added.' : def.hint}</span>
                    </label>
                ) : existing ? (
                    <div>
                        <span className='mb-1 block text-sm text-slate-300'>Code (cannot change)</span>
                        <div className='rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 font-mono text-slate-400'>{existing.code}</div>
                    </div>
                ) : (
                    <div className='rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-slate-300'>
                        Code: <span className='font-mono text-emerald-300'>{prefix}</span>
                        <span className='text-slate-500'> + next number, assigned automatically</span>
                    </div>
                )}
                <TextArea id='sn-desc' label='Description (optional)' rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
                {allowsManager && (
                    <div>
                        <SelectField id='sn-manager-role' label={level === 'cost_center' ? 'Cost center manager (job role) *' : `${label} manager (job role, optional)`} value={managerRoleCode} onChange={(e) => setManagerRoleCode(e.target.value)}>
                            <option value=''>{managerRoles.length ? (level === 'cost_center' ? 'Select...' : 'None') : 'No job roles operate at this level yet'}</option>
                            {managerRoles.map((r) => (
                                <option key={r.code} value={r.code}>
                                    {r.code} · {r.title}
                                    {r.selectedAtSite ? '' : ' (will be added to this site)'}
                                </option>
                            ))}
                        </SelectField>
                        <p className='mt-1 text-xs text-slate-500'>
                            Job roles (ROL_) that operate at this level{siteLabel ? `, at site ${siteLabel}` : ''}. Whoever holds the role manages this unit. Not Security roles.
                        </p>
                    </div>
                )}
                {existing && (
                    <SelectField id='sn-status' label='Status' value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value='active'>Active</option>
                        <option value='inactive'>Inactive</option>
                    </SelectField>
                )}
            </Card>
            {sections.map((section) => (
                <Card key={section} className='space-y-4'>
                    <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>{section}</p>
                    {def.fields.filter((f) => (f.section ?? 'Details') === section).map(renderField)}
                </Card>
            ))}
            {level === 'legal_entity' && !existing && <p className='text-xs text-slate-500'>You can add the logo right after saving.</p>}
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                <Button variant='secondary' onClick={onCancel}>
                    Cancel
                </Button>
                <Button className='flex-1' busy={busy} onClick={submit}>
                    {existing ? 'Save changes' : `Save ${label.toLowerCase()}`}
                </Button>
            </div>
        </div>
    );
}

function BomForm({ assembly, bom, onDone, onCancel }: { assembly: Node; bom?: Bom; onDone: () => void; onCancel: () => void }) {
    const [name, setName] = useState(bom?.name ?? assembly.name);
    const [status, setStatus] = useState(bom?.status ?? 'draft');
    const [lines, setLines] = useState<Array<{ component: string; description: string; quantity: string; unit: string }>>(
        bom?.lines.map((l) => ({ component: l.component, description: l.description, quantity: String(l.quantity), unit: l.unit })) ?? [{ component: '', description: '', quantity: '1', unit: 'pcs' }]
    );
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

    const save = async () => {
        setError('');
        setBusy('save');
        try {
            await callBackend('/api/org/bom/save', { assemblyId: assembly.id, bomId: bom?.id, name, status, lines: lines.filter((l) => l.component.trim()).map((l) => ({ ...l, quantity: Number(l.quantity) })) });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy('');
        }
    };

    const remove = async () => {
        if (!bom || !window.confirm(`Delete the bill of materials ${bom.name}?`)) return;
        setBusy('delete');
        try {
            await callBackend('/api/org/bom/delete', { id: bom.id });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete.');
            setBusy('');
        }
    };

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <PageTitle title={bom ? `${bom.name} · v${bom.version}` : 'New bill of materials'} subtitle={`For assembly ${assembly.code}`} />
                <button onClick={onCancel} aria-label='Cancel' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <Card className='space-y-4'>
                {!bom && <p className='text-xs text-slate-500'>Bills of materials are not codified. Each is identified by its assembly and version; components will be picked from inventory.</p>}
                <Field id='bom-name' label='Name' maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                <SelectField id='bom-status' label='Status' value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value='draft'>Draft</option>
                    <option value='active'>Active</option>
                    <option value='obsolete'>Obsolete</option>
                </SelectField>
            </Card>
            <section className='space-y-3'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Components ({lines.length})</h2>
                {lines.map((l, i) => (
                    <Card key={i} className='space-y-3'>
                        <div className='flex items-center justify-between'>
                            <span className='text-xs font-medium text-slate-400'>Line {i + 1}</span>
                            {lines.length > 1 && (
                                <button type='button' onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} className='text-red-400'>
                                    <Trash2 className='h-4 w-4' />
                                </button>
                            )}
                        </div>
                        <Field id={`bl-c-${i}`} label='Component code' maxLength={40} value={l.component} onChange={(e) => update(i, { component: e.target.value })} />
                        <Field id={`bl-d-${i}`} label='Description' maxLength={120} value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                        <div className='grid grid-cols-2 gap-3'>
                            <Field id={`bl-q-${i}`} label='Quantity' type='number' inputMode='decimal' min={0} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                            <Field id={`bl-u-${i}`} label='Unit' maxLength={12} value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} />
                        </div>
                    </Card>
                ))}
                <Button variant='secondary' className='w-full' onClick={() => setLines([...lines, { component: '', description: '', quantity: '1', unit: 'pcs' }])}>
                    <Plus className='h-4 w-4' />
                    Add component
                </Button>
            </section>
            {error && <Alert tone='error'>{error}</Alert>}
            <div className='flex gap-2'>
                {bom && (
                    <Button variant='danger' busy={busy === 'delete'} disabled={!!busy} onClick={remove} aria-label='Delete'>
                        <Trash2 className='h-4 w-4' />
                    </Button>
                )}
                <Button className='flex-1' busy={busy === 'save'} disabled={!!busy} onClick={save}>
                    Save bill of materials
                </Button>
            </div>
        </div>
    );
}
