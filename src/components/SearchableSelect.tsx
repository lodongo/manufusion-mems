import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
    label: string;
    id?: string;
    hint?: string;
    error?: string;
    children: ReactNode;
    /** Keep the label for screen readers only, when the caller renders its own visible label. */
    hideLabel?: boolean;
};
type Option = { value: string; label: string; disabled: boolean; group?: string };

function textOf(value: ReactNode): string {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(textOf).join('');
    if (isValidElement(value)) return textOf((value.props as { children?: ReactNode }).children);
    return '';
}

function extractOptions(children: ReactNode, group = ''): Option[] {
    const values: Option[] = [];
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        const p = child.props as { children?: ReactNode; value?: string | number; label?: string; disabled?: boolean };
        if (child.type === 'option') values.push({
            value: p.value === undefined ? textOf(p.children) : String(p.value),
            label: p.label ?? textOf(p.children), disabled: !!p.disabled, group,
        });
        else if (child.type === Fragment) values.push(...extractOptions(p.children, group));
        else if (child.type === 'optgroup') values.push(...extractOptions(p.children, p.label ?? group));
    });
    return values;
}

/** MEMS dropdown template: searchable staged choice, explicit confirmation and visible mobile actions. */
export default function SearchableSelect({ label, id: providedId, hint, error, children, value, defaultValue, name, onChange, disabled, required, hideLabel, className = '', ...rest }: Props) {
    const generatedId = useId();
    const id = providedId || generatedId;
    const options = useMemo(() => extractOptions(children), [children]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const [pending, setPending] = useState<string | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [internal, setInternal] = useState(defaultValue === undefined ? '' : String(defaultValue));
    const selectedValue = value === undefined ? internal : String(value);
    const current = options.find((o) => o.value === selectedValue);
    const staged = options.find((o) => o.value === pending);
    const filtered = useMemo(() => options.filter((o) =>
        !query.trim() || (o.label + ' ' + o.value + ' ' + (o.group ?? '')).toLowerCase().includes(query.trim().toLowerCase())
    ), [options, query]);

    useEffect(() => {
        if (!open) return;
        const old = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', escape);
        return () => { document.body.style.overflow = old; document.removeEventListener('keydown', escape); if(previous?.isConnected) previous.focus(); };
    }, [open]);

    const choose = (v: string) => {
        if (!options.some(o => o.value === v && !o.disabled)) return;
        if (value === undefined) setInternal(v);
        // All existing MEMS SelectField callers consume e.target.value. Keep that contract intact.
        onChange?.({ target: { value: v, name, id }, currentTarget: { value: v, name, id } } as unknown as ChangeEvent<HTMLSelectElement>);
        setOpen(false);
        setPending(null);
        setQuery('');
        setSearchVisible(false);
    };

    return (
        <div className={`block min-w-0 ${className}`}>
            <label htmlFor={id} className={hideLabel ? 'sr-only' : 'mb-1 block text-sm text-soft'}>{label}{required ? ' *' : ''}</label>
            <input type='hidden' name={name} value={selectedValue} />
            <button ref={buttonRef} type='button' id={id} disabled={disabled} aria-required={required} aria-invalid={!!error}
                aria-haspopup='listbox' aria-expanded={open} aria-describedby={error || hint ? `${id}-note` : undefined}
                onClick={() => { setPending(current && !current.disabled ? selectedValue : null); setQuery(''); setSearchVisible(false); setOpen(true); }}
                className={`flex min-h-12 w-full items-center gap-2 rounded-xl border bg-panel px-3 text-left text-base text-ink focus:outline-none disabled:opacity-50 ${error ? 'border-red-500/70' : 'border-line focus:border-brand'}`}>
                <span className={`min-w-0 flex-1 truncate ${!selectedValue ? 'text-muted' : ''}`}>{current?.label || (selectedValue ? 'Selection unavailable — choose again' : options.find((o) => !o.value)?.label || 'Choose...')}</span>
                <ChevronDown className='h-5 w-5 shrink-0 text-muted' />
            </button>
            {(error || hint) && <span id={`${id}-note`} className={`mt-1 block text-xs ${error ? 'text-red-500' : 'text-muted'}`}>{error || hint}</span>}
            {open && typeof document !== 'undefined' && createPortal(
                <div className='fixed inset-0 z-[2200] flex items-end justify-center bg-black/60 px-0 pt-[max(4dvh,12px)] sm:items-center sm:p-5'
                    role='presentation' onClick={() => setOpen(false)}>
                    <div role='dialog' aria-label={label} aria-modal='true'
                        onClick={(e) => e.stopPropagation()}
                        className='flex h-[min(88dvh,760px)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-page shadow-2xl sm:h-[min(84dvh,720px)] sm:rounded-2xl'>
                        <div className='flex shrink-0 items-center justify-between border-b border-line p-4'>
                            <h2 className='min-w-0 truncate text-lg font-semibold text-ink'>{label}</h2>
                            <button ref={closeRef} type='button' aria-label='Close' className='flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink'
                                onClick={() => setOpen(false)}><X className='h-5 w-5' /></button>
                        </div>
                        <div className='shrink-0 p-3'>
                            {searchVisible ? (
                                <label className='flex min-h-12 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                                    <Search className='h-5 w-5 shrink-0 text-muted' />
                                    <input type='search' value={query} onChange={(e) => setQuery(e.target.value)}
                                        placeholder='Search names or codes…' aria-label={`Search ${label}`}
                                        className='min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted outline-none' />
                                    <button type='button' aria-label='Hide search' className='flex h-11 w-11 items-center justify-center rounded-lg text-muted'
                                        onClick={() => { setSearchVisible(false); setQuery(''); }}><X className='h-4 w-4'/></button>
                                </label>
                            ) : (
                                <button type='button' onClick={() => setSearchVisible(true)}
                                    className='flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm text-ink'>
                                    <Search className='h-4 w-4 text-muted'/> Search (optional) · tap to type
                                </button>
                            )}
                            <p className='mt-2 px-1 text-xs text-muted'>{filtered.length} of {options.length} options · choose an option, then confirm</p>
                        </div>
                        <div role='listbox' aria-label={label} className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3'>
                            {filtered.length === 0 && <p className='p-4 text-center text-sm text-muted'>No matching options</p>}
                            {filtered.map((o, i) =>
                                <button key={o.value + '-' + i} type='button' role='option' aria-selected={o.value === pending}
                                    disabled={o.disabled}
                                    onClick={() => setPending(o.value)}
                                    className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-40 ${o.value === pending ? 'border-brand bg-brand/10 text-ink' : 'border-transparent text-ink active:bg-panel'}`}>
                                    <span className='min-w-0 flex-1 break-words'>
                                        {o.group && <span className='block text-xs text-muted'>{o.group}</span>}
                                        {o.label || 'None'}
                                    </span>
                                    {o.value === pending && <Check className='h-5 w-5 shrink-0 text-brand' />}
                                </button>
                            )}
                        </div>
                        <div className='shrink-0 border-t border-line bg-page px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]'>
                            <p aria-live='polite' className='mb-2 truncate text-xs text-muted'>Pending: {staged ? staged.label : 'Choose an option above'}</p>
                            <div className='flex items-center justify-end gap-2'>
                                <button type='button' aria-label='Cancel selection' onClick={() => setOpen(false)}
                                    className='min-h-12 rounded-xl border border-line px-4 font-semibold text-ink'>Cancel</button>
                                <button type='button' aria-label='Confirm selection' disabled={pending === null || !staged || staged.disabled}
                                    onClick={() => { if (pending !== null) choose(pending); }}
                                    className='min-h-12 rounded-xl bg-brand px-5 font-semibold text-onbrand disabled:opacity-40'>Confirm selection</button>
                            </div>
                        </div>
                    </div>
                </div>, document.body
            )}
        </div>
    );
}
