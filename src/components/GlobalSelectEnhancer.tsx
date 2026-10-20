import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';

type OptionItem = { value: string; label: string; group: string; disabled: boolean };
type Target = { select: HTMLSelectElement; title: string; options: OptionItem[]; value: string };

function optionsOf(select: HTMLSelectElement): OptionItem[] {
    return Array.from(select.options).map((option) => ({
        value: option.value,
        label: option.label || option.textContent || option.value,
        group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : '',
        disabled: option.disabled || !!(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    }));
}

function titleOf(select: HTMLSelectElement): string {
    const id = select.id;
    const label = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`) : null;
    return (label?.textContent || select.closest('label')?.textContent || select.getAttribute('aria-label') || 'Choose option').trim().slice(0, 100);
}

/** Ensures legacy native select elements also use the site theme, search and a mobile-friendly bottom sheet.
 * The shared SelectField has its own controlled sheet and is not intercepted here.
 */
export default function GlobalSelectEnhancer() {
    const [target, setTarget] = useState<Target | null>(null);
    const [query, setQuery] = useState('');
    const [searchVisible, setSearchVisible] = useState(false);
    const filtered = useMemo(() => {
        if (!target) return [];
        const search = query.toLowerCase().trim();
        return target.options.filter((o) => !search || (o.label + ' ' + o.value + ' ' + o.group).toLowerCase().includes(search));
    }, [target, query]);

    useEffect(() => {
        const intercept = (event: Event) => {
            const element = event.target;
            if (!(element instanceof Element)) return;
            const select = element.closest('select');
            if (!(select instanceof HTMLSelectElement) || select.disabled || select.hasAttribute('data-native-select')) return;
            event.preventDefault();
            event.stopPropagation();
            setTarget({ select, title: titleOf(select), options: optionsOf(select), value: select.value });
            setQuery('');
            setSearchVisible(false);
        };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setTarget(null); return; }
            if (!(event.target instanceof HTMLSelectElement)) return;
            if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
            intercept(event);
        };
        document.addEventListener('pointerdown', intercept, true);
        document.addEventListener('keydown', keyboard, true);
        return () => {
            document.removeEventListener('pointerdown', intercept, true);
            document.removeEventListener('keydown', keyboard, true);
        };
    }, []);

    useEffect(() => {
        if (!target) return;
        const old = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = old; };
    }, [target]);

    if (!target || typeof document === 'undefined') return null;
    const choose = (value: string) => {
        // Dispatch native events so existing React onChange logic and form validation remain intact.
        // React tracks the value property on controlled selects. Assign with the native
        // setter so React's change-event plugin observes the new value rather than
        // discarding the event as an unchanged controlled component.
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(target.select, value);
        else target.select.value = value;
        target.select.dispatchEvent(new Event('input', { bubbles: true }));
        target.select.dispatchEvent(new Event('change', { bubbles: true }));
        setTarget(null);
    };
    return createPortal(
        <div className='fixed inset-0 z-[1200] flex items-end justify-center bg-black/65 sm:items-center sm:p-5'
            role='presentation' onClick={() => setTarget(null)}>
            <div role='dialog' aria-modal='true' aria-label={target.title}
                onClick={(e) => e.stopPropagation()}
                className='flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-line bg-page text-ink shadow-2xl sm:rounded-2xl'>
                <div className='flex items-center justify-between border-b border-line p-4'>
                    <h2 className='min-w-0 truncate text-lg font-semibold'>{target.title}</h2>
                    <button type='button' className='flex h-11 w-11 items-center justify-center rounded-lg border border-line' aria-label='Close selector' onClick={() => setTarget(null)}><X className='h-5 w-5'/></button>
                </div>
                <div className='p-3'>
                    {searchVisible ? <label className='flex items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                        <Search className='h-5 w-5 shrink-0 text-muted'/>
                        <input type='search' value={query} onChange={(e)=>setQuery(e.target.value)} placeholder='Search options…'
                            aria-label='Search options' className='h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted outline-none'/>
                        <button type='button' aria-label='Hide search' onClick={()=>{setSearchVisible(false);setQuery('');}}
                            className='flex h-11 w-11 items-center justify-center rounded-lg text-muted'><X className='h-4 w-4'/></button>
                    </label> : <button type='button' onClick={()=>setSearchVisible(true)}
                        className='flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 text-left text-sm text-ink'>
                        <Search className='h-4 w-4 text-muted'/> Search (optional) · tap to type
                    </button>}
                    <p className='mt-2 px-1 text-xs text-soft'>{filtered.length} options · scroll to choose</p>
                </div>
                <div role='listbox' aria-label={target.title} className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8'>
                    {!filtered.length&&<p className='p-4 text-center text-sm text-soft'>No matching options.</p>}
                    {filtered.map((o,i)=>
                        <button key={o.value+'-'+i} type='button' role='option' aria-selected={target.value===o.value}
                            disabled={o.disabled} onClick={()=>choose(o.value)}
                            className={`mb-1 flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm disabled:opacity-30 ${target.value===o.value?'border border-brand bg-brand/10':'border border-transparent active:bg-panel'}`}>
                            <span className='min-w-0 flex-1'>
                                {o.group&&<span className='block text-xs text-muted'>{o.group}</span>}
                                {o.label||'None'}
                            </span>
                            {target.value===o.value&&<Check className='h-5 w-5 shrink-0 text-brand'/>}
                        </button>
                    )}
                </div>
            </div>
        </div>, document.body
    );
}
