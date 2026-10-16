import { useEffect, useId, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, HelpCircle, Loader2, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared screen building blocks (mobile first).
//   Screen        fixed action bar on top (back, title, primary actions, optional toolbar); only the body scrolls
//   ConfirmSheet  in-app confirmation for consequential actions (reason, typed phrase, acknowledgement)
//   Segmented     44px segmented control for views inside a screen
//   InfoTip       tap-to-open help (no hover-only tooltips, no browser alerts)
//   messageOf     readable error text from anything thrown
// ---------------------------------------------------------------------------

/** Readable message from an error (never "Error: …"). */
export function messageOf(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
    if (err instanceof Error && err.message) return err.message.replace(/^Error:\s*/, '');
    if (typeof err === 'string' && err) return err.replace(/^Error:\s*/, '');
    return fallback;
}

/**
 * Page frame used by every screen: the action bar stays on top, only the body scrolls.
 * The height leaves room for the shell's top bar and padding.
 */
export function Screen({
    title,
    eyebrow,
    subtitle,
    onBack,
    actions,
    toolbar,
    children,
    bodyClassName = '',
}: {
    title: string;
    eyebrow?: string;
    subtitle?: string;
    onBack?: () => void;
    actions?: ReactNode;
    toolbar?: ReactNode;
    children: ReactNode;
    bodyClassName?: string;
}) {
    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <header className='shrink-0 space-y-2 border-b border-line bg-page pb-3'>
                <div className='flex items-center gap-2'>
                    {onBack && (
                        <button type='button' aria-label='Back' onClick={onBack} className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                            <ArrowLeft className='h-5 w-5' />
                        </button>
                    )}
                    <div className='min-w-0 flex-1'>
                        {eyebrow && <p className='truncate font-mono text-xs text-brandsoft'>{eyebrow}</p>}
                        <h1 className='truncate text-base font-semibold text-ink sm:text-lg'>{title}</h1>
                        {subtitle && <p className='truncate text-xs text-muted'>{subtitle}</p>}
                    </div>
                    {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
                </div>
                {toolbar}
            </header>
            <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3 ${bodyClassName}`}>{children}</div>
        </div>
    );
}

/** Segmented control (views inside a screen). Scrolls sideways when there are many options. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void; label: string }) {
    return (
        <div role='tablist' aria-label={label} className='flex gap-1 overflow-x-auto rounded-xl border border-line p-1'>
            {options.map((o) => (
                <button
                    key={o.value}
                    type='button'
                    role='tab'
                    aria-selected={value === o.value}
                    onClick={() => onChange(o.value)}
                    className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${value === o.value ? 'bg-brand text-onbrand' : 'text-soft active:bg-panel'}`}
                >
                    {o.label}
                    {o.count !== undefined && <span className={`rounded-full px-1.5 text-xs ${value === o.value ? 'bg-black/15' : 'bg-line text-soft'}`}>{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

/** Tap-to-open help text. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <span className='inline-flex flex-col'>
            <button type='button' aria-label={`Help: ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className='inline-flex h-11 w-11 items-center justify-center rounded-full text-muted active:bg-panel'>
                <HelpCircle className='h-5 w-5' />
            </button>
            {open && (
                <span id={id} role='note' className='mt-1 block rounded-lg border border-line bg-panel p-3 text-sm text-soft'>
                    {children}
                </span>
            )}
        </span>
    );
}

export interface ConfirmOptions {
    title: string;
    /** What will happen, in plain words. */
    message: ReactNode;
    confirmLabel: string;
    tone?: 'primary' | 'danger';
    /** Ask for a reason (stored with the action and in the audit trail). */
    reason?: { label: string; minLength: number; placeholder?: string };
    /** Ask the person to type this phrase exactly (irreversible actions). */
    phrase?: string;
    /** Ask the person to tick this statement. */
    acknowledge?: string;
}

/**
 * In-app confirmation for consequential actions (approve, post, delete, clear …).
 * Opens as a bottom sheet on phones and a dialog on larger screens. Confirm stays disabled until every
 * requirement (reason length, typed phrase, acknowledgement) is met.
 */
export function ConfirmSheet({
    open,
    options,
    busy,
    error,
    onConfirm,
    onCancel,
}: {
    open: boolean;
    options: ConfirmOptions | null;
    busy?: boolean;
    error?: string;
    onConfirm: (reason: string) => void;
    onCancel: () => void;
}) {
    const [reason, setReason] = useState('');
    const [typed, setTyped] = useState('');
    const [ticked, setTicked] = useState(false);
    const baseId = useId();

    useEffect(() => {
        if (!open) return;
        setReason('');
        setTyped('');
        setTicked(false);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !busy) onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, options?.title]);

    if (!open || !options) return null;
    const reasonOk = !options.reason || reason.trim().length >= options.reason.minLength;
    const phraseOk = !options.phrase || typed.trim().toUpperCase() === options.phrase.toUpperCase();
    const tickOk = !options.acknowledge || ticked;
    const ready = reasonOk && phraseOk && tickOk && !busy;
    const danger = options.tone === 'danger';

    return (
        <div className='fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Cancel' className='absolute inset-0 bg-black/60' onClick={() => !busy && onCancel()} />
            <div role='dialog' aria-modal='true' aria-labelledby={`${baseId}-title`} className='relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-md sm:rounded-2xl'>
                <div className='flex items-start gap-3 border-b border-line p-4'>
                    {danger && <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0 text-red-400' />}
                    <h2 id={`${baseId}-title`} className='min-w-0 flex-1 text-base font-semibold text-ink'>
                        {options.title}
                    </h2>
                    <button type='button' aria-label='Close' disabled={busy} onClick={onCancel} className='-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm text-soft'>
                    <div>{options.message}</div>
                    {options.reason && (
                        <label htmlFor={`${baseId}-reason`} className='block'>
                            <span className='mb-1 block text-sm text-soft'>{options.reason.label} *</span>
                            <textarea
                                id={`${baseId}-reason`}
                                rows={3}
                                maxLength={500}
                                value={reason}
                                placeholder={options.reason.placeholder}
                                onChange={(e) => setReason(e.target.value)}
                                className='w-full rounded-xl border border-line bg-page p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none'
                            />
                            <span className={`mt-1 block text-xs ${reasonOk ? 'text-muted' : 'text-amber-300'}`}>
                                {reason.trim().length}/{options.reason.minLength} characters minimum
                            </span>
                        </label>
                    )}
                    {options.phrase && (
                        <label htmlFor={`${baseId}-phrase`} className='block'>
                            <span className='mb-1 block text-sm text-soft'>
                                Type <span className='font-mono font-semibold text-ink'>{options.phrase}</span> to confirm
                            </span>
                            <input
                                id={`${baseId}-phrase`}
                                autoComplete='off'
                                value={typed}
                                onChange={(e) => setTyped(e.target.value)}
                                className='h-12 w-full rounded-xl border border-line bg-page px-3 text-base text-ink focus:border-brand focus:outline-none'
                            />
                        </label>
                    )}
                    {options.acknowledge && (
                        <label className='flex min-h-[44px] items-start gap-3 rounded-xl border border-line p-3'>
                            <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
                            <span>{options.acknowledge}</span>
                        </label>
                    )}
                    {error && (
                        <p role='alert' className='rounded-lg bg-red-500/10 p-3 text-sm text-red-300'>
                            {error}
                        </p>
                    )}
                </div>
                <div className='flex gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
                    <button type='button' disabled={busy} onClick={onCancel} className='flex h-12 flex-1 items-center justify-center rounded-xl border border-line text-sm font-semibold text-soft'>
                        Cancel
                    </button>
                    <button
                        type='button'
                        disabled={!ready}
                        onClick={() => onConfirm(reason.trim())}
                        className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${danger ? 'bg-red-600 text-[#ffffff]' : 'bg-brand text-onbrand'}`}
                    >
                        {busy && <Loader2 className='h-4 w-4 animate-spin' />}
                        {options.confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * State helper for ConfirmSheet: ask(options, action) opens the sheet; the action runs on confirm with the
 * reason, errors stay in the sheet, success closes it.
 */
export function useConfirm() {
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const [action, setAction] = useState<((reason: string) => Promise<void>) | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ask = (next: ConfirmOptions, run: (reason: string) => Promise<void>) => {
        setError('');
        setOptions(next);
        setAction(() => run);
    };
    const close = () => {
        if (busy) return;
        setOptions(null);
        setAction(null);
        setError('');
    };
    const confirm = async (reason: string) => {
        if (!action) return;
        setBusy(true);
        setError('');
        try {
            await action(reason);
            setOptions(null);
            setAction(null);
        } catch (err) {
            setError(messageOf(err));
        } finally {
            setBusy(false);
        }
    };
    const sheet = <ConfirmSheet open={!!options} options={options} busy={busy} error={error} onConfirm={(r) => void confirm(r)} onCancel={close} />;
    return { ask, sheet };
}
