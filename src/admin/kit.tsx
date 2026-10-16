import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { ChevronRight, Loader2, PanelLeft, X } from 'lucide-react';

export function Card({ children, className = '', tone }: { children: ReactNode; className?: string; tone?: 'danger' }) {
    const border = tone === 'danger' ? 'border-2 border-red-500/70' : 'border border-slate-800';
    return <section className={`rounded-2xl ${border} bg-slate-900 p-4 ${className}`}>{children}</section>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
    return (
        <div className='mb-5 flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
                <h1 className='text-xl font-semibold text-white'>{title}</h1>
                {subtitle && <p className='mt-1 text-sm text-slate-400'>{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
    primary: 'bg-emerald-500 text-onbrand',
    secondary: 'border border-slate-700 text-slate-200',
    danger: 'border border-red-500/40 text-red-400',
};

export function Button({
    variant = 'primary',
    busy,
    children,
    className = '',
    disabled,
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
    return (
        <button
            {...rest}
            disabled={busy || disabled}
            className={`flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
        >
            {busy && <Loader2 className='h-4 w-4 animate-spin' />}
            {children}
        </button>
    );
}

type Tone = 'brand' | 'muted' | 'danger' | 'warn';

const TONES: Record<Tone, string> = {
    brand: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
    muted: 'bg-slate-800 text-slate-300 ring-slate-700',
    danger: 'bg-red-500/10 text-red-400 ring-red-500/30',
    warn: 'bg-amber-500/10 text-amber-400 ring-amber-500/30',
};

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONES[tone]}`}>{children}</span>;
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }) {
    return (
        <button
            type='button'
            role='switch'
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-700'}`}
        >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-slate-200 shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
    );
}

export function TextArea({ label, id, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string }) {
    return (
        <label htmlFor={id} className='block'>
            <span className='mb-1 block text-sm text-slate-300'>{label}</span>
            <textarea
                id={id}
                {...rest}
                className='min-h-[6rem] w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-base text-white placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none'
            />
        </label>
    );
}

/** Section menu: shows the current section and opens a side panel listing all sections. */
export function SubTabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: Array<{ key: T; label: string }>; onChange: (key: T) => void }) {
    const [open, setOpen] = useState(false);
    const index = Math.max(0, tabs.findIndex((t) => t.key === value));
    const current = tabs[index];
    return (
        <>
            <button
                type='button'
                onClick={() => setOpen(true)}
                aria-label='Open sections'
                className='mb-4 flex h-14 w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 text-left active:bg-slate-800'
            >
                <PanelLeft className='h-5 w-5 shrink-0 text-emerald-400' />
                <span className='min-w-0 flex-1'>
                    <span className='block text-[11px] uppercase tracking-wider text-slate-500'>
                        Section {index + 1} of {tabs.length}
                    </span>
                    <span className='block truncate text-sm font-medium text-white'>{current?.label}</span>
                </span>
                <ChevronRight className='h-4 w-4 shrink-0 text-slate-500' />
            </button>
            {open && (
                <div className='fixed inset-0 z-50'>
                    <button aria-label='Close sections' className='absolute inset-0 bg-black/60' onClick={() => setOpen(false)} />
                    <aside className='absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-slate-800 bg-slate-900'>
                        <div className='flex items-center justify-between border-b border-slate-800 px-4 py-4'>
                            <p className='font-semibold text-white'>Sections</p>
                            <button onClick={() => setOpen(false)} aria-label='Close sections' className='flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-slate-300'>
                                <X className='h-4 w-4' />
                            </button>
                        </div>
                        <ul className='flex-1 space-y-0.5 overflow-y-auto p-2'>
                            {tabs.map((t) => (
                                <li key={t.key}>
                                    <button
                                        onClick={() => {
                                            onChange(t.key);
                                            setOpen(false);
                                        }}
                                        className={`flex h-11 w-full items-center rounded-lg px-3 text-left text-sm ${t.key === value ? 'bg-emerald-500/10 font-medium text-emerald-300' : 'text-slate-300 active:bg-slate-800'}`}
                                    >
                                        {t.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </aside>
                </div>
            )}
        </>
    );
}

export function LegacyTabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: Array<{ key: T; label: string }>; onChange: (key: T) => void }) {
    return (
        <div role='tablist' className='-mx-1 mb-4 flex gap-1 overflow-x-auto px-1'>
            {tabs.map((tab) => (
                <button
                    key={tab.key}
                    type='button'
                    role='tab'
                    aria-selected={value === tab.key}
                    onClick={() => onChange(tab.key)}
                    className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium ${
                        value === tab.key ? 'bg-emerald-500 text-onbrand' : 'border border-slate-700 text-slate-300'
                    }`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
}

export function Spinner() {
    return (
        <div className='flex justify-center py-10'>
            <Loader2 className='h-6 w-6 animate-spin text-slate-400' aria-label='Loading' />
        </div>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className='py-8 text-center text-sm text-slate-500'>{children}</p>;
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [key, setKey] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError('');
        loader()
            .then((value) => {
                if (active) setData(value);
            })
            .catch((err: unknown) => {
                if (active) setError(err instanceof Error ? err.message : 'Could not load.');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, key]);

    return { data, setData, error, loading, reload: () => setKey((k) => k + 1) };
}
