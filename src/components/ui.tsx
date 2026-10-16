import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

export function PrimaryButton({
    busy,
    children,
    className = '',
    disabled,
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
    return (
        <button
            {...rest}
            disabled={busy || disabled}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-onbrand hover:opacity-90 active:opacity-80 disabled:opacity-60 ${className}`}
        >
            {busy && <Loader2 className='h-5 w-5 animate-spin' />}
            {children}
        </button>
    );
}

/** Message under a field: the validation problem when there is one, otherwise the hint. */
function FieldNote({ id, error, hint }: { id: string; error?: string; hint?: string }) {
    if (error) {
        return (
            <span id={`${id}-note`} role='alert' className='mt-1 block text-xs text-red-300'>
                {error}
            </span>
        );
    }
    if (hint) {
        return (
            <span id={`${id}-note`} className='mt-1 block text-xs text-muted'>
                {hint}
            </span>
        );
    }
    return null;
}

export function Field({ label, id, hint, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; error?: string }) {
    return (
        <label htmlFor={id} className='block'>
            <span className='mb-1 block text-sm text-soft'>{label}</span>
            <input
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={error || hint ? `${id}-note` : undefined}
                {...rest}
                className={`h-12 w-full rounded-xl border bg-panel px-3 text-base text-ink placeholder:text-muted focus:outline-none disabled:opacity-60 ${error ? 'border-red-500/70 focus:border-red-400' : 'border-line focus:border-brand'}`}
            />
            <FieldNote id={id} error={error} hint={hint} />
        </label>
    );
}

export function SelectField({
    label,
    id,
    hint,
    error,
    children,
    ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; hint?: string; error?: string; children: ReactNode }) {
    return (
        <label htmlFor={id} className='block'>
            <span className='mb-1 block text-sm text-soft'>{label}</span>
            <select
                id={id}
                aria-invalid={error ? true : undefined}
                aria-describedby={error || hint ? `${id}-note` : undefined}
                {...rest}
                className={`h-12 w-full rounded-xl border bg-panel px-3 text-base text-ink focus:outline-none disabled:opacity-60 ${error ? 'border-red-500/70 focus:border-red-400' : 'border-line focus:border-brand'}`}
            >
                {children}
            </select>
            <FieldNote id={id} error={error} hint={hint} />
        </label>
    );
}

export type AlertTone = 'error' | 'info' | 'success' | 'warn';

const ALERT_STYLES: Record<AlertTone, string> = {
    error: 'bg-red-500/10 text-red-300',
    info: 'bg-emerald-500/10 text-emerald-300',
    success: 'bg-emerald-500/10 text-emerald-300',
    warn: 'bg-amber-500/10 text-amber-300',
};

export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
    return (
        <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${ALERT_STYLES[tone]}`}>
            {children}
        </p>
    );
}

export function Tabs<T extends string>({
    value,
    options,
    onChange,
}: {
    value: T;
    options: Array<{ value: T; label: string; icon?: ReactNode }>;
    onChange: (value: T) => void;
}) {
    return (
        <div role='tablist' className='grid grid-cols-2 gap-1 rounded-xl bg-panel p-1'>
            {options.map((option) => (
                <button
                    key={option.value}
                    type='button'
                    role='tab'
                    aria-selected={value === option.value}
                    onClick={() => onChange(option.value)}
                    className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium ${
                        value === option.value ? 'bg-brand text-onbrand' : 'text-muted'
                    }`}
                >
                    {option.icon}
                    {option.label}
                </button>
            ))}
        </div>
    );
}
