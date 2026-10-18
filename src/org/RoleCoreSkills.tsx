import { useState } from 'react';
import { Copy, GitBranch, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';
import { adoptSkillCodes, type SkillSourceRole } from './skillAdoption';

interface Skill {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    description: string;
}

export default function RoleCoreSkills({
    value, onChange, sources = [],
}: {
    value: string[];
    onChange: (v: string[]) => void;
    sources?: SkillSourceRole[];
}) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ ready: boolean; skills: Skill[] }>('/api/org/reference/skills'));
    const [cat, setCat] = useState('');
    const [sub, setSub] = useState('');
    const [search, setSearch] = useState('');
    const [sourceCode, setSourceCode] = useState('');
    const [parentSearch, setParentSearch] = useState('');
    const [parentExpanded,setParentExpanded] = useState(false);

    const all = data?.skills ?? [];
    const availableCodes = new Set(all.map((x) => x.code));
    const selectedCodes = new Set(value);
    const byCode = new Map(all.map((x) => [x.code, x]));
    const cats = [...new Set(all.map((x) => x.category))].sort();
    const subs = [...new Set(all.filter((x) => x.category === cat).map((x) => x.subcategory))].sort();
    const q = search.trim().toLowerCase();
    const options = all.filter((x) => x.category === cat && x.subcategory === sub && (!q || `${x.label} ${x.description}`.toLowerCase().includes(q)));
    const source = sources.find((p) => p.code === sourceCode) ?? sources[0];
    const inherited = [...new Set(source?.coreSkills ?? [])];
    const adoptable = inherited.filter((code) => availableCodes.has(code));
    const missing = adoptable.filter((code) => !selectedCodes.has(code));
    const unavailable = inherited.filter((code) => !availableCodes.has(code));
    const parentQuery = parentSearch.trim().toLowerCase();
    const parentChoices = adoptable.filter((code) =>
        !parentQuery || `${byCode.get(code)?.label ?? code} ${byCode.get(code)?.description ?? ''}`.toLowerCase().includes(parentQuery));
    const nameOf = (code: string) => byCode.get(code)?.label || code;
    const toggle = (code: string) =>
        onChange(selectedCodes.has(code) ? value.filter((x) => x !== code) : adoptSkillCodes(value, [code], availableCodes));

    return (
        <fieldset className='min-w-0 max-w-full space-y-3 overflow-hidden rounded-xl border border-line bg-panel p-3'>
            <legend className='px-1 text-sm font-semibold text-ink'>Core skills (optional · {value.length} selected)</legend>
            <p className='text-xs text-soft'>Skills are optional. Add as many as required, or leave the role without skills. Skill selection does not assign security permissions.</p>
            {error && <div className='space-y-2'><Alert tone='error'>{error}</Alert>
                <Button type='button' variant='secondary' onClick={reload}>Retry loading skills</Button>
            </div>}
            {loading && !data && <Spinner />}
            {data && !data.ready && <Alert tone='warn'>Load the HRM Skills Master to select new skills. Roles can still be saved without skills.</Alert>}

            {sources.length > 0 && (
                <div className='min-w-0 max-w-full space-y-3 overflow-hidden rounded-xl border border-line bg-page p-3'>
                    <button type='button' className='flex w-full min-w-0 items-center justify-between gap-2 text-left text-sm font-semibold text-ink' aria-expanded={parentExpanded} onClick={()=>setParentExpanded(x=>!x)}><span className='min-w-0 truncate'>Adopt from reporting role</span><span className='shrink-0 text-brand'>{parentExpanded?'Hide':'Show'}</span></button>
                    {parentExpanded && <div className='min-w-0 space-y-3'>
                    <div className='flex min-w-0 items-start gap-2'>
                        <GitBranch className='mt-0.5 h-5 w-5 shrink-0 text-brand' />
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-ink'>Adopt skills from a parent role</p>
                            <p className='text-xs text-soft'>Select a reporting role and adopt all or individual skills. Copies are saved to this role and can be changed independently later.</p>
                        </div>
                    </div>
                    <SelectField id='parent-skills-role' label='Source role in reporting hierarchy' value={source?.code ?? ''} onChange={(e) => { setSourceCode(e.target.value); setParentSearch(''); }}>
                        {sources.map((role, i) =>
                            <option key={role.code} value={role.code}>{i === 0 ? 'Direct parent' : `Ancestor ${i}`} · {role.title} ({role.code})</option>)}
                    </SelectField>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                        <p className='text-xs text-soft'>{inherited.length} source skills · {missing.length} available to add · {adoptable.length - missing.length} already selected</p>
                        <Button type='button' variant='secondary' disabled={!missing.length} onClick={() => onChange(adoptSkillCodes(value, adoptable, availableCodes))}>
                            <Copy className='h-4 w-4'/> Adopt all missing
                        </Button>
                    </div>
                    {unavailable.length > 0 && <Alert tone='warn'>{unavailable.length} skills in the source role are no longer enabled in HRM Skills Master and cannot be newly adopted. Existing role skills are not removed.</Alert>}
                    {adoptable.length > 0 && <>
                        <Field id='source-skill-search' label='Search parent role skills' type='search' value={parentSearch}
                            onChange={(e) => setParentSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                        <ul aria-label='Skills available from the parent role' className='min-w-0 max-w-full max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                            {parentChoices.map((code) => <li key={code}>
                                <label className='flex min-w-0 max-w-full min-h-12 items-start gap-3 rounded-lg border border-line p-3 text-sm text-ink active:bg-panel'>
                                    <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-brand' checked={selectedCodes.has(code)} onChange={() => toggle(code)} />
                                    <span className='min-w-0 flex-1 break-words'>
                                        <span className='block break-words font-semibold'>{nameOf(code)}</span>
                                        <span className='text-xs text-soft'>{byCode.get(code)?.category} · {byCode.get(code)?.subcategory}</span>
                                    </span>
                                </label>
                            </li>)}
                            {!parentChoices.length && <li className='px-2 py-3 text-xs text-soft'>No matching parent skills.</li>}
                        </ul>
                    </>}
                    {!inherited.length && <p className='text-xs text-soft'>This reporting role does not have any skills assigned yet. Select an ancestor or add skills manually below.</p>}
                    </div>}
                </div>
            )}

            {value.length > 0 ? (
                <div className='space-y-2'>
                    <p className='break-words text-sm font-medium text-ink'>Selected skills ({value.length})</p>
                    <ul aria-label='Selected core skills' className='min-w-0 max-w-full max-h-72 space-y-1 overflow-y-auto overscroll-contain'>
                        {value.map((code) => <li key={code} className='flex min-h-12 items-center gap-2 rounded-lg border border-line bg-page pl-3 text-sm text-ink'>
                            <span className='min-w-0 flex-1 break-words'>{nameOf(code)}</span>
                            <button type='button' onClick={() => toggle(code)}
                                aria-label={`Remove ${nameOf(code)}`}
                                className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-muted active:bg-panel'>
                                <X className='h-4 w-4' />
                            </button>
                        </li>)}
                    </ul>
                </div>
            ) : <p className='text-xs text-soft'>No skills selected. You may save this role now or add skills below.</p>}

            {data && <div className='grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2'>
                <SelectField id='core-skill-cat' label='Add skills — category' value={cat}
                    onChange={(e) => { setCat(e.target.value); setSub(''); }}>
                    <option value=''>Select category</option>
                    {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                </SelectField>
                <SelectField id='core-skill-sub' label='Subcategory' value={sub} disabled={!cat}
                    hint={cat ? undefined : 'Choose a category first'} onChange={(e) => setSub(e.target.value)}>
                    <option value=''>Select subcategory</option>
                    {subs.map((s) => <option key={s} value={s}>{s}</option>)}
                </SelectField>
            </div>}
            {sub && <>
                <Field id='core-skill-search' label='Search all skills' type='search' autoComplete='off' value={search}
                    onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                {options.length === 0 ? <p className='text-sm text-soft'>No matching skills.</p> :
                    <ul aria-label='Available skills' className='max-h-72 space-y-1 overflow-y-auto overscroll-contain'>
                        {options.map((x) => <li key={x.code}>
                            <label className='flex min-w-0 max-w-full min-h-12 items-start gap-3 rounded-lg border border-line p-3 text-ink active:bg-page'>
                                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-brand'
                                    checked={selectedCodes.has(x.code)} onChange={() => toggle(x.code)} />
                                <span className='min-w-0 flex-1 break-words'>
                                    <span className='block break-words text-sm font-semibold'>{x.label}</span>
                                    {x.description && <span className='block text-xs text-soft'>{x.description}</span>}
                                </span>
                            </label>
                        </li>)}
                    </ul>}
            </>}
        </fieldset>
    );
}
