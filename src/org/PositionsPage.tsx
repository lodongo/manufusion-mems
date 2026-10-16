import { useState } from 'react';
import { Briefcase, ChevronRight, Eye, Home, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Card, PageTitle, Spinner, TextArea, useLoad } from '../admin/kit';
import { operatingLabel, upperName } from './structureDefs';
import RoleCoreSkills from './RoleCoreSkills';

function CoreSkillsSelector({value,onChange}:{value:string[];onChange:(v:string[])=>void}){
 const {data,error}=useLoad(()=>callBackend<{ready:boolean;skills:Array<{code:string;label:string;category:string;subcategory:string;description:string;active:boolean}>}>('/api/org/reference/core-skills'));
 const [category,setCategory]=useState('');const [subcategory,setSubcategory]=useState('');const [skill,setSkill]=useState('');const skills=data?.skills??[];
 const categories=[...new Set(skills.filter(x=>x.active).map(x=>x.category))].sort();const subs=[...new Set(skills.filter(x=>x.active&&x.category===category).map(x=>x.subcategory))].sort();const choices=skills.filter(x=>x.active&&x.category===category&&x.subcategory===subcategory&&!value.includes(x.code));
 return <fieldset className='space-y-3 rounded-xl border border-slate-700 p-3'><legend className='px-1 text-sm font-semibold text-white'>Core skills ({value.length}/20)</legend>{error&&<p className='text-red-400'>{error}</p>}{data&&!data.ready&&<p className='text-amber-300'>Load HRM Skills Master metadata first.</p>}<div className='grid gap-2 sm:grid-cols-3'><label className='text-xs text-slate-300'>Category<select className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white' value={category} onChange={e=>{setCategory(e.target.value);setSubcategory('');setSkill('')}}><option value=''>Choose category</option>{categories.map(x=><option key={x}>{x}</option>)}</select></label><label className='text-xs text-slate-300'>Subcategory<select className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white' value={subcategory} disabled={!category} onChange={e=>{setSubcategory(e.target.value);setSkill('')}}><option value=''>Choose subcategory</option>{subs.map(x=><option key={x}>{x}</option>)}</select></label><label className='text-xs text-slate-300'>Skill<select className='mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-3 text-white' value={skill} disabled={!subcategory||value.length>=20} onChange={e=>setSkill(e.target.value)}><option value=''>Choose skill</option>{choices.map(x=><option key={x.code} value={x.code}>{x.label}</option>)}</select></label></div><button type='button' disabled={!skill||value.length>=20} onClick={()=>{onChange([...value,skill]);setSkill('')}} className='rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40'>Add skill</button><div className='space-y-2'>{value.map((code,i)=>{const x=skills.find(s=>s.code===code);return <div key={code} className='flex justify-between gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3'><div><p className='text-sm font-semibold text-white'>{i+1}. {x?.label??code}</p><p className='text-xs text-slate-400'>{x?x.category+' › '+x.subcategory:code}</p><p className='mt-1 text-xs text-slate-300'>{x?.description}</p></div><button type='button' onClick={()=>onChange(value.filter(c=>c!==code))} className='text-xs text-red-300'>Remove</button></div>})}</div></fieldset>;
}

export interface Position {
    code: string;
    title: string;
    description: string;
    parentCode: string;
    operatingLevel: string;
    defaultNodeId?: string;
    securityRoles?: string[];
    coreSkills?: string[];
}

export interface RoleOption {
    id: string;
    name: string;
    permissions: number;
    admin: boolean;
}

interface PositionsData {
    positions: Position[];
    design: { mode: string; names: string[] };
    roleOptions?: RoleOption[];
    scopeNodes?: Array<{id:string;level:string;tier:number;code:string;name:string}>;
}

const open = (code?: string) => navigate(code ? `organization_admin/positions/${code}` : 'organization_admin/positions');

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
    return (
        <button type='button' aria-label={label} title={label} onClick={onClick} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${danger ? 'border-red-500/40 text-red-400' : 'border-slate-700 text-slate-200'}`}>
            {children}
        </button>
    );
}

/** Job roles (ROL_): navigate the reporting lines, view or edit one role, add another in the list. */
export default function PositionsPage({ canEdit, code }: { canEdit: boolean; code?: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<PositionsData>('/api/org/positions/list'));
    const [mode, setMode] = useState<null | 'view' | 'edit' | 'add'>(null);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load job roles.'}</Alert>;

    const byCode = new Map(data.positions.map((p) => [p.code, p]));
    const current = code ? byCode.get(code) : undefined;
    const names = data.design.names;
    const parentKey = current?.code ?? '';
    const children = data.positions
        .filter((p) => (parentKey ? p.parentCode === parentKey : !p.parentCode || !byCode.has(p.parentCode)))
        .sort((a, b) => a.code.localeCompare(b.code));
    const trail: Position[] = [];
    for (let p = current; p && trail.length < 30; p = p.parentCode ? byCode.get(p.parentCode) : undefined) trail.unshift(p);
    const done = () => {
        setMode(null);
        reload();
    };

    if (mode === 'add' || (mode === 'edit' && current)) {
        return (
            <PositionForm
                existing={mode === 'edit' ? current : undefined}
                parentCode={mode === 'edit' ? current?.parentCode ?? '' : parentKey}
                positions={data.positions}
                names={names}
                roleOptions={data.roleOptions ?? []}
                scopeNodes={data.scopeNodes ?? []}
                onDone={done}
                onCancel={() => setMode(null)}
            />
        );
    }

    if (mode === 'view' && current) {
        const reportsTo = current.parentCode ? byCode.get(current.parentCode) : undefined;
        return (
            <div className='space-y-4'>
                <div className='flex items-center justify-between gap-2'>
                    <PageTitle title={current.title} subtitle={current.code} />
                    <div className='flex gap-2'>
                        {canEdit && (
                            <IconButton label='Edit' onClick={() => setMode('edit')}>
                                <Pencil className='h-4 w-4' />
                            </IconButton>
                        )}
                        <IconButton label='Close' onClick={() => setMode(null)}>
                            <X className='h-4 w-4' />
                        </IconButton>
                    </div>
                </div>
                <Card className='space-y-2 text-sm'>
                    <Detail label='Code' value={current.code} />
                    <Detail label='Job role title' value={current.title} />
                    <Detail label='Reports to' value={reportsTo ? `${reportsTo.code} · ${reportsTo.title}` : 'Nobody (top role)'} />
                    <Detail label='Operates at' value={operatingLabel(current.operatingLevel, names)} />
                    <Detail label='Direct reports' value={String(children.length)} />
                    {current.description && <Detail label='Purpose' value={current.description} />}
                </Card>
                <Card className='space-y-2 text-sm'><p className='font-medium text-white'>Core skills required ({(current.coreSkills??[]).length}/20)</p>{(current.coreSkills??[]).length?(current.coreSkills??[]).map(x=><p key={x} className='rounded-lg border border-slate-700 p-2 font-mono text-slate-200'>{x}</p>):<p className='text-slate-400'>No core skills assigned.</p>}</Card>
                <Card className='space-y-2 text-sm'>
                    <p className='flex items-center gap-2 font-medium text-white'>
                        <ShieldCheck className='h-4 w-4 text-emerald-400' />
                        Security roles mapped to this job role
                    </p>
                    {(current.securityRoles ?? []).length === 0 ? (
                        <p className='text-slate-400'>None. Holding this job role gives no rights in MEMS modules yet.</p>
                    ) : (
                        <ul className='space-y-1'>
                            {(current.securityRoles ?? []).map((r) => (
                                <li key={r} className='rounded-lg border border-slate-800 px-3 py-2 text-slate-200'>
                                    {(data.roleOptions ?? []).find((o) => o.id === r)?.name ?? r}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className='text-xs text-slate-500'>A person holding this job role receives these rights only at the place they hold it (and below).</p>
                </Card>
            </div>
        );
    }

    const remove = async () => {
        if (!current || !window.confirm(`Delete ${current.code} ${current.title}?`)) return;
        setBusy(true);
        setActionError('');
        try {
            await callBackend('/api/org/positions/delete', { code: current.code });
            open(current.parentCode || undefined);
            reload();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Could not delete.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='space-y-3'>
            <PageTitle title='Job roles' subtitle='Tap a role to see who reports to it' />
            <nav aria-label='Path' className='flex flex-wrap items-center gap-1 text-sm'>
                <button onClick={() => open()} className='flex items-center gap-1 rounded-lg px-2 py-1 text-emerald-300'>
                    <Home className='h-4 w-4' />
                    All job roles
                </button>
                {trail.map((p, i) => (
                    <span key={p.code} className='flex items-center gap-1'>
                        <ChevronRight className='h-3.5 w-3.5 text-slate-600' />
                        <button onClick={() => open(p.code)} className={`rounded-lg px-2 py-1 text-xs ${i === trail.length - 1 ? 'bg-slate-800 text-white' : 'text-emerald-300'}`}>
                            {p.title}
                        </button>
                    </span>
                ))}
            </nav>

            {current && (
                <div className='flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3'>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-sky-300'>{current.code}</p>
                        <p className='truncate text-white'>{current.title}</p>
                        <p className='truncate text-xs text-slate-500'>{operatingLabel(current.operatingLevel, names)}</p>
                    </div>
                    <IconButton label='View details' onClick={() => setMode('view')}>
                        <Eye className='h-4 w-4' />
                    </IconButton>
                    {canEdit && (
                        <IconButton label='Edit' onClick={() => setMode('edit')}>
                            <Pencil className='h-4 w-4' />
                        </IconButton>
                    )}
                    {canEdit && children.length === 0 && (
                        <IconButton label='Delete' danger onClick={() => !busy && remove()}>
                            <Trash2 className='h-4 w-4' />
                        </IconButton>
                    )}
                </div>
            )}
            {actionError && <Alert tone='error'>{actionError}</Alert>}

            <p className='px-1 text-xs font-semibold uppercase tracking-wider text-slate-500'>{current ? `Reporting to ${current.title}` : 'Top roles'}</p>
            <Card className='p-0'>
                <ul className='divide-y divide-slate-800'>
                    {children.length === 0 && <li className='px-4 py-3 text-sm text-slate-500'>{current ? 'Nobody reports to this role yet.' : 'No job roles yet. Start with your top role, for example CEO.'}</li>}
                    {children.map((p) => (
                        <li key={p.code}>
                            <button onClick={() => open(p.code)} className='flex w-full items-center gap-3 px-4 py-3 text-left'>
                                <Briefcase className='h-4 w-4 shrink-0 text-sky-400' />
                                <div className='min-w-0 flex-1'>
                                    <p className='truncate text-sm text-white'>{p.title}</p>
                                    <p className='truncate text-xs text-slate-500'>
                                        <span className='font-mono'>{p.code}</span> · {operatingLabel(p.operatingLevel, names)}
                                    </p>
                                </div>
                                <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
                            </button>
                        </li>
                    ))}
                    {canEdit && (
                        <li>
                            <button onClick={() => setMode('add')} className='flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-emerald-300'>
                                <Plus className='h-4 w-4 shrink-0' />
                                {current ? `Add a role reporting to ${current.title}` : 'Add a top role'}
                            </button>
                        </li>
                    )}
                </ul>
            </Card>
            <p className='px-1 text-xs text-slate-500'>Job roles (ROL_) are positions in your organization chart, not Security roles.</p>
        </div>
    );
}

function Detail({ label, value }: { label: string; value: string }) {
    return (
        <div className='flex justify-between gap-3'>
            <span className='text-slate-400'>{label}</span>
            <span className='break-words text-right text-white'>{value}</span>
        </div>
    );
}

function PositionForm({
    existing,
    parentCode,
    positions,
    names,
    roleOptions,
    scopeNodes,
    onDone,
    onCancel,
}: {
    existing?: Position;
    parentCode: string;
    positions: Position[];
    names: string[];
    roleOptions: RoleOption[];
    scopeNodes: Array<{id:string;level:string;tier:number;code:string;name:string}>;
    onDone: () => void;
    onCancel: () => void;
}) {
    const [title, setTitle] = useState(existing?.title ?? '');
    const [description, setDescription] = useState(existing?.description ?? '');
    const [parent, setParent] = useState(parentCode);
    const [operatingLevel, setOperatingLevel] = useState(existing?.operatingLevel ?? '');
    const [defaultNodeId, setDefaultNodeId] = useState(existing?.defaultNodeId ?? '');
    const [securityRoles, setSecurityRoles] = useState<string[]>(existing?.securityRoles ?? []);
    const [coreSkills,setCoreSkills]=useState<string[]>(existing?.coreSkills??[]);
    const toggleRole = (id: string) => setSecurityRoles((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const reportsTo = positions.find((p) => p.code === parent);

    const save = async () => {
        setError('');
        if (title.trim().length < 2) return setError('Enter the job role title (2 to 80 characters).');
        if (securityRoles.length > 10) return setError('Map up to 10 security roles.');
        if (coreSkills.length < 5 || coreSkills.length > 20) return setError('Select at least 5 and at most 20 core skills for this job role.');
        setBusy(true);
        try {
            await callBackend('/api/org/positions/save', { code: existing?.code, title: title.trim(), description, parentCode: parent, operatingLevel, securityRoles, coreSkills });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save.');
            setBusy(false);
        }
    };

    return (
        <div className='space-y-4'>
            <div className='flex items-center justify-between'>
                <PageTitle title={existing ? `Edit ${existing.code}` : 'New job role'} subtitle={reportsTo ? `Reports to ${reportsTo.code} ${reportsTo.title}` : 'Top of the role structure'} />
                <button onClick={onCancel} aria-label='Cancel' className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <Card className='space-y-4'>
                <div className='flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm'>
                    <Briefcase className='h-4 w-4 text-sky-400' />
                    <span className='font-mono text-slate-300'>{existing?.code ?? 'ROL_ + next number (automatic)'}</span>
                </div>
                <Field id='pos-title' label='Job role title' maxLength={80} placeholder='e.g. Manufacturing Manager' value={title} onChange={(e) => setTitle(e.target.value)} />
                <SelectField id='pos-parent' label='Reports to' value={parent} onChange={(e) => setParent(e.target.value)}>
                    <option value=''>Nobody (top role)</option>
                    {positions
                        .filter((p) => p.code !== existing?.code)
                        .map((p) => (
                            <option key={p.code} value={p.code}>
                                {p.code} · {p.title}
                            </option>
                        ))}
                </SelectField>
                <SelectField id='pos-level' label='Operates at' value={operatingLevel} onChange={(e) => { setOperatingLevel(e.target.value); setDefaultNodeId(''); }}>
                    <option value=''>Decide later</option>
                    {names.map((n, i) => (
                        <option key={i} value={`upper:${i}`}>
                            {upperName(names, i)} level (Level_{i})
                        </option>
                    ))}
                    <option value='legal_entity'>Legal entity level</option>
                    <option value='site'>Site level</option><option value='department'>Department level</option><option value='cost_center'>Cost center level</option>
                </SelectField>

                <TextArea id='pos-desc' label='Purpose and responsibilities (optional)' rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
                <RoleCoreSkills value={coreSkills} onChange={setCoreSkills}/>
                <fieldset className='space-y-2'>
                    <legend className='text-sm font-medium text-slate-200'>Security roles (what this job role may do)</legend>
                    <p className='text-xs text-slate-500'>People holding this job role get these rights where they hold it and below. Administration rights are never passed on through job roles.</p>
                    {roleOptions.length === 0 && <p className='text-sm text-slate-400'>No security roles yet. Create them under Security roles.</p>}
                    <div className='max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                        {roleOptions.map((r) => (
                            <label key={r.id} className='flex min-h-11 items-center gap-3 rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-200'>
                                <input type='checkbox' className='h-5 w-5 accent-emerald-500' checked={securityRoles.includes(r.id)} onChange={() => toggleRole(r.id)} />
                                <span className='min-w-0 flex-1'>
                                    {r.name}
                                    <span className='block text-xs text-slate-500'>
                                        {r.permissions} rights{r.admin ? ' · administration rights are ignored here' : ''}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>
                {error && <Alert tone='error'>{error}</Alert>}
                <div className='flex gap-2'>
                    <Button variant='secondary' onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button className='flex-1' busy={busy} onClick={save}>
                        {existing ? 'Save job role' : 'Add job role'}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
