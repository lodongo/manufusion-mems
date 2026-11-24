import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { Loader2, Search } from 'lucide-react';

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
            <span id={`${id}-note`} role='alert' className='mt-1 block text-xs text-red-500'>
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

/*
 * MEMS standard form templates. Every form control in the app uses one of these:
 *   Field (single-line input of any type), TextArea (multi-line), SearchField (list filters)
 *   and SelectField (searchable dropdown, opens as a bottom sheet on phones).
 * Shared rules: a label is always present (visually hidden only where the context names it),
 * 48px touch height, theme tokens for light/dark/brand, hint or error under the control,
 * `className` positions the whole field in a layout and never restyles the control.
 */
type FieldExtras = { label: string; id?: string; hint?: string; error?: string; hideLabel?: boolean };
const labelClass = (hidden?: boolean) => (hidden ? 'sr-only' : 'mb-1 block text-sm text-soft');
const controlState = (error?: string) => (error ? 'border-red-500/70 focus:border-red-400' : 'border-line focus:border-brand');

export function Field({ label, id, hint, error, hideLabel, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldExtras) {
    const generated = useId();
    const fieldId = id || generated;
    return (
        <label htmlFor={fieldId} className={`block min-w-0 ${className}`}>
            <span className={labelClass(hideLabel)}>{label}</span>
            <input
                id={fieldId}
                aria-invalid={error ? true : undefined}
                aria-describedby={error || hint ? `${fieldId}-note` : undefined}
                {...rest}
                className={`h-12 w-full rounded-xl border bg-panel px-3 text-base text-ink placeholder:text-muted focus:outline-none disabled:opacity-60 ${controlState(error)}`}
            />
            <FieldNote id={fieldId} error={error} hint={hint} />
        </label>
    );
}

export function TextArea({ label, id, hint, error, hideLabel, className = '', rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldExtras) {
    const generated = useId();
    const fieldId = id || generated;
    return (
        <label htmlFor={fieldId} className={`block min-w-0 ${className}`}>
            <span className={labelClass(hideLabel)}>{label}</span>
            <textarea
                id={fieldId}
                rows={rows}
                aria-invalid={error ? true : undefined}
                aria-describedby={error || hint ? `${fieldId}-note` : undefined}
                {...rest}
                className={`min-h-[6rem] w-full rounded-xl border bg-panel p-3 text-base text-ink placeholder:text-muted focus:outline-none disabled:opacity-60 ${controlState(error)}`}
            />
            <FieldNote id={fieldId} error={error} hint={hint} />
        </label>
    );
}

/** List or table filter: an accessible search box with an icon; the placeholder carries the visible text. */
export function SearchField({ label, id, className = '', placeholder, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; id?: string }) {
    const generated = useId();
    const fieldId = id || generated;
    return (
        <label htmlFor={fieldId} className={`relative block min-w-0 ${className}`}>
            <span className='sr-only'>{label}</span>
            <Search aria-hidden className='pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted' />
            <input
                id={fieldId}
                type='search'
                placeholder={placeholder ?? label}
                {...rest}
                className='h-12 w-full rounded-xl border border-line bg-panel pl-10 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none'
            />
        </label>
    );
}

export { default as SelectField } from './SearchableSelect';

export type AlertTone = 'error' | 'info' | 'success' | 'warn';

const ALERT_STYLES: Record<AlertTone, string> = {
    error: 'border border-red-300 bg-red-100 text-red-950',
    info: 'border border-sky-300 bg-sky-100 text-sky-950',
    success: 'border border-emerald-300 bg-emerald-100 text-emerald-950',
    warn: 'border border-amber-400 bg-amber-100 text-amber-950',
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
                    className={`flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium ${
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
