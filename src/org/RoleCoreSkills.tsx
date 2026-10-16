import { useState } from 'react';
import { X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import { Button, Spinner, useLoad } from '../admin/kit';

// Core skills of a job role (used inside the job role form of PositionsPage).
// Skills come from the HRM skills master (POST /api/org/reference/skills): pick a category, then a subcategory,
// then tick skills (optional search). A role holds at most 20 core skills; selected skills are listed on top
// with a 44px remove button. The parent form saves the list.

interface Skill {
    code: string;
    label: string;
    category: string;
    subcategory: string;
    description: string;
}

const MAX_SKILLS = 20;

export default function RoleCoreSkills({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<{ skills: Skill[] }>('/api/org/reference/skills'));
    const [cat, setCat] = useState('');
    const [sub, setSub] = useState('');
    const [search, setSearch] = useState('');

    const all = data?.skills ?? [];
    const cats = [...new Set(all.map((x) => x.category))].sort();
    const subs = [...new Set(all.filter((x) => x.category === cat).map((x) => x.subcategory))].sort();
    const q = search.trim().toLowerCase();
    const options = all.filter((x) => x.category === cat && x.subcategory === sub && (!q || `${x.label} ${x.description}`.toLowerCase().includes(q)));
    const full = value.length >= MAX_SKILLS;
    const toggle = (code: string) => onChange(value.includes(code) ? value.filter((x) => x !== code) : value.length < MAX_SKILLS ? [...value, code] : value);
    const nameOf = (code: string) => all.find((x) => x.code === code)?.label || code;

    return (
        <fieldset className='space-y-3 rounded-xl border border-line p-3'>
            <legend className='px-1 text-sm font-semibold text-ink'>
                Core skills ({value.length}/{MAX_SKILLS})
            </legend>
            {error && (
                <div className='space-y-2'>
                    <Alert tone='error'>{error}</Alert>
                    <Button type='button' variant='secondary' onClick={reload}>
                        Try again
                    </Button>
                </div>
            )}
            {loading && !data && <Spinner />}

            {value.length > 0 ? (
                <ul aria-label='Selected core skills' className='space-y-1'>
                    {value.map((code) => (
                        <li key={code} className='flex min-h-[44px] items-center gap-2 rounded-lg bg-page pl-3 text-sm text-ink'>
                            <span className='min-w-0 flex-1 truncate'>{nameOf(code)}</span>
                            <button
                                type='button'
                                onClick={() => toggle(code)}
                                aria-label={`Remove ${nameOf(code)}`}
                                className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted active:bg-panel'
                            >
                                <X className='h-4 w-4' />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className='text-xs text-muted'>No core skills yet. Choose a category and subcategory to add some.</p>
            )}
            {full && <Alert tone='warn'>This role has the maximum of {MAX_SKILLS} core skills. Remove one to add another.</Alert>}

            {data && (
                <div className='grid gap-3 sm:grid-cols-2'>
                    <SelectField
                        id='core-skill-cat'
                        label='Skill category'
                        value={cat}
                        onChange={(e) => {
                            setCat(e.target.value);
                            setSub('');
                        }}
                    >
                        <option value=''>Select category</option>
                        {cats.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField id='core-skill-sub' label='Skill subcategory' value={sub} disabled={!cat} hint={cat ? undefined : 'Choose a category first'} onChange={(e) => setSub(e.target.value)}>
                        <option value=''>Select subcategory</option>
                        {subs.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </SelectField>
                </div>
            )}

            {sub && (
                <>
                    <Field id='core-skill-search' label='Search skills' type='search' autoComplete='off' value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                    {options.length === 0 ? (
                        <p className='text-sm text-muted'>No skills match.</p>
                    ) : (
                        <ul aria-label='Skills' className='max-h-72 space-y-1 overflow-y-auto overscroll-contain'>
                            {options.map((x) => {
                                const on = value.includes(x.code);
                                return (
                                    <li key={x.code}>
                                        <label className={`flex min-h-[44px] items-start gap-3 rounded-lg border border-line p-3 text-ink ${!on && full ? 'opacity-60' : 'active:bg-page'}`}>
                                            <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={on} disabled={!on && full} onChange={() => toggle(x.code)} />
                                            <span className='min-w-0'>
                                                <span className='block text-sm font-semibold'>{x.label}</span>
                                                {x.description && <span className='block text-xs text-muted'>{x.description}</span>}
                                            </span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </>
            )}
        </fieldset>
    );
}
