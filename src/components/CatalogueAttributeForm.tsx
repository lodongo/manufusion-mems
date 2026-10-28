import { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import type { AttrDef, CatalogueLibraryInfo } from './AssetDictionaryBrowser';

// ---------------------------------------------------------------------------
// Catalogue attribute form (materials, maintenance spares, services).
// Mandatory fields first; optional details folded below. Every field explains where to find the value and
// shows an example, so a person who is not a specialist does not have to guess. Mobile-first: native
// selects, Yes/No buttons, tick chips instead of multi-select lists, and numeric keyboards for numbers.
// ---------------------------------------------------------------------------

/** Verification shared by every catalogue attribute form (mirrors the server rules). */
export function attributeIssue(a: AttrDef, raw: string | undefined): string {
    const v = String(raw ?? '').trim();
    if (!v) return a.required ? 'Required.' : '';
    const val = a.validation ?? {};
    if (a.dataType === 'integer' || a.dataType === 'decimal') {
        const n = Number(v.replace(/,/g, ''));
        if (!Number.isFinite(n) || (a.dataType === 'integer' && !Number.isInteger(n))) return a.dataType === 'integer' ? 'Enter a whole number.' : 'Enter a number.';
        if (typeof val.minimum === 'number' && n < val.minimum) return `Must be at least ${val.minimum}.`;
        if (typeof val.maximum === 'number' && n > val.maximum) return `Must be at most ${val.maximum}.`;
    }
    if (a.dataType === 'enum' && a.options.length && !a.options.some((o) => o.code === v)) return 'Choose from the list.';
    if (a.dataType === 'multi_select' && v.split(',').some((c) => !a.options.some((o) => o.code === c))) return 'Choose from the list.';
    if (a.dataType === 'text' && val.maxLength && v.length > val.maxLength) return `Up to ${val.maxLength} characters.`;
    if (a.dataType === 'text' && val.pattern) {
        try {
            if (!new RegExp(val.pattern).test(v)) return 'Not in the expected format.';
        } catch {
            /* checked on the server */
        }
    }
    return '';
}
export const attributeIssues = (attributes: AttrDef[], values: Record<string, string>) =>
    attributes.map((a) => ({ a, msg: attributeIssue(a, values[a.code]) })).filter((x) => x.msg);

const control = 'mt-1 min-h-11 w-full min-w-0 rounded-xl border bg-page px-3 text-base text-ink focus:border-brand focus:outline-none';

export function AttributeField({ a, value, onChange, showError }: { a: AttrDef; value: string; onChange: (v: string) => void; showError: boolean }) {
    const issue = showError ? attributeIssue(a, value) : '';
    const border = issue ? 'border-danger' : a.required && !value.trim() ? 'border-amber-500/70' : 'border-line';
    const id = 'cat-attr-' + a.code.replace(/[^A-Za-z0-9_-]/g, '_');
    const numeric = a.dataType === 'integer' || a.dataType === 'decimal';
    let input;
    if (a.dataType === 'boolean') {
        input = (
            <div className='mt-1 grid grid-cols-3 gap-2' role='radiogroup' aria-labelledby={id + '-label'}>
                {[['true', 'Yes'], ['false', 'No'], ['', 'Not known']].map(([v, label]) => (
                    <button key={label} type='button' role='radio' aria-checked={value === v} onClick={() => onChange(v)}
                        className={`min-h-11 rounded-xl border text-sm font-semibold ${value === v ? 'border-brand bg-brand/10 text-brand' : 'border-line text-soft'}`}>{label}</button>
                ))}
            </div>
        );
    } else if (a.dataType === 'multi_select') {
        const list = value ? value.split(',').filter(Boolean) : [];
        input = (
            <div className='mt-1 flex flex-wrap gap-2' aria-labelledby={id + '-label'}>
                {a.options.map((o) => {
                    const on = list.includes(o.code);
                    return (
                        <button key={o.code} type='button' aria-pressed={on} onClick={() => onChange((on ? list.filter((c) => c !== o.code) : [...list, o.code]).join(','))}
                            className={`min-h-9 rounded-full border px-3 text-xs ${on ? 'border-brand bg-brand/15 font-semibold text-brand' : 'border-line text-soft'}`}>{on ? '✓ ' : ''}{o.label}</button>
                    );
                })}
            </div>
        );
    } else if (a.dataType === 'enum' || a.options.length) {
        input = (
            <select id={id} data-native-select='true' className={`${control} ${border}`} value={value} onChange={(e) => onChange(e.target.value)}>
                <option value=''>{a.required ? 'Choose…' : 'Not specified'}</option>
                {a.options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
        );
    } else {
        input = (
            <div className='flex items-center gap-2'>
                <input id={id} className={`${control} ${border}`} value={value} onChange={(e) => onChange(e.target.value)}
                    type={a.dataType === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined}
                    maxLength={numeric ? 24 : a.validation?.maxLength ?? 500}
                    placeholder={a.example ? 'e.g. ' + a.example : undefined} aria-invalid={!!issue} aria-describedby={id + '-help'} />
                {a.unit && <span className='mt-1 shrink-0 text-xs font-semibold text-muted'>{a.unit}</span>}
            </div>
        );
    }
    return (
        <div className='min-w-0'>
            <label id={id + '-label'} htmlFor={id} className='flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink'>
                {a.name}
                {a.required ? <span className='rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600'>Required</span> : null}
                {a.unit && (a.dataType === 'enum' || a.dataType === 'multi_select') ? <span className='text-xs text-muted'>({a.unit})</span> : null}
            </label>
            {input}
            {issue ? <p role='alert' className='mt-1 text-xs font-semibold text-danger'>{issue}</p>
                : a.description ? <p id={id + '-help'} className='mt-1 text-xs text-muted'>{a.description}{a.example && (a.dataType !== 'text' && !numeric) ? ' Example: ' + a.example + '.' : ''}</p> : null}
        </div>
    );
}

export default function CatalogueAttributeForm({ attributes, values, onChange, library, showErrors = false, title = 'Technical attributes' }: {
    attributes: AttrDef[];
    values: Record<string, string>;
    onChange: (code: string, value: string) => void;
    library?: CatalogueLibraryInfo | null;
    showErrors?: boolean;
    title?: string;
}) {
    const [showOptional, setShowOptional] = useState(false);
    const required = attributes.filter((a) => a.required);
    const optional = attributes.filter((a) => !a.required);
    const doneRequired = required.filter((a) => !attributeIssue(a, values[a.code])).length;
    const filledOptional = optional.filter((a) => String(values[a.code] ?? '').trim()).length;
    return (
        <section className='space-y-3' aria-label={title}>
            {library?.guidance && (
                <div className='flex gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3'>
                    <Lightbulb className='mt-0.5 h-4 w-4 shrink-0 text-brand' />
                    <p className='text-xs text-soft'><strong className='text-ink'>{library.label}.</strong> {library.guidance}</p>
                </div>
            )}
            {required.length > 0 && (
                <div>
                    <p className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted'>Required · {doneRequired}/{required.length} complete</p>
                    <div className='grid gap-4 sm:grid-cols-2'>
                        {required.map((a) => <AttributeField key={a.code} a={a} value={values[a.code] ?? ''} onChange={(v) => onChange(a.code, v)} showError={showErrors} />)}
                    </div>
                </div>
            )}
            {optional.length > 0 && (
                <div className='rounded-xl border border-line'>
                    <button type='button' onClick={() => setShowOptional((o) => !o)} aria-expanded={showOptional}
                        className='flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left'>
                        <span><span className='block text-sm font-semibold text-ink'>Recommended details</span>
                            <span className='text-xs text-muted'>{optional.length} optional · {filledOptional} filled — more detail makes reordering and finding equivalents easier</span></span>
                        {showOptional ? <ChevronDown className='h-4 w-4 text-muted' /> : <ChevronRight className='h-4 w-4 text-muted' />}
                    </button>
                    {showOptional && (
                        <div className='grid gap-4 border-t border-line p-3 sm:grid-cols-2'>
                            {optional.map((a) => <AttributeField key={a.code} a={a} value={values[a.code] ?? ''} onChange={(v) => onChange(a.code, v)} showError={showErrors} />)}
                        </div>
                    )}
                </div>
            )}
            {!attributes.length && <p className='text-sm text-muted'>No attributes are configured for this catalogue entry.</p>}
        </section>
    );
}
