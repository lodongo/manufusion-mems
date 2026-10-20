import type { ReactNode } from 'react';
import { ListChecks, LogOut } from 'lucide-react';
import { useSite } from '../lib/site';
import { Alert, PrimaryButton } from '../components/ui';

/** Full-height mobile shell: fixed header, scrolling content frame, fixed action bar. */
export function AppFrame({
    title,
    step,
    total,
    onSteps,
    onSignOut,
    children,
}: {
    title?: string;
    step?: number;
    total?: number;
    onSteps?: () => void;
    onSignOut?: () => void;
    children: ReactNode;
}) {
    const { config } = useSite();
    return (
        <div className='flex h-[100dvh] flex-col bg-slate-950'>
            <header className='shrink-0 border-b border-slate-800 bg-slate-950 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]'>
                <div className='mx-auto flex max-w-md items-center gap-2'>
                    <div className='min-w-0 flex-1'>
                        <p className='text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-400'>{config.brandName} registration</p>
                        {title && <p className='truncate text-base font-semibold text-white'>{title}</p>}
                    </div>
                    {onSteps && step !== undefined && total !== undefined && (
                        <button type='button' onClick={onSteps} aria-label='All steps' className='flex h-11 items-center gap-1.5 rounded-full border border-slate-700 px-3 text-xs font-medium text-slate-200'>
                            <ListChecks className='h-4 w-4' />
                            {step + 1}/{total}
                        </button>
                    )}
                    {onSignOut && (
                        <button type='button' onClick={onSignOut} aria-label='Log out' className='flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200'>
                            <LogOut className='h-4 w-4' />
                        </button>
                    )}
                </div>
                {step !== undefined && total !== undefined && (
                    <div className='mx-auto mt-3 h-1 max-w-md overflow-hidden rounded-full bg-slate-800'>
                        <div className='h-full rounded-full bg-emerald-500 transition-all duration-300' style={{ width: `${((step + 1) / total) * 100}%` }} />
                    </div>
                )}
            </header>
            {children}
        </div>
    );
}

export function StepFrame({
    hint,
    children,
    error,
    busy,
    primary,
    disabled,
    onBack,
    onSubmit,
}: {
    hint?: string;
    children: ReactNode;
    error?: string;
    busy?: boolean;
    primary: string;
    disabled?: boolean;
    onBack?: () => void;
    onSubmit: () => void;
}) {
    return (
        <form
            noValidate
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
            }}
            className='flex min-h-0 flex-1 flex-col'
        >
            <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
                <div className='mx-auto max-w-md space-y-5 px-4 py-5'>
                    {hint && <p className='text-sm text-slate-400'>{hint}</p>}
                    {children}
                    {error && <Alert tone='error'>{error}</Alert>}
                </div>
            </div>
            <div className='shrink-0 border-t border-slate-800 bg-slate-950 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]'>
                <div className='mx-auto flex max-w-md gap-2'>
                    {onBack && (
                        <button type='button' onClick={onBack} className='h-12 shrink-0 rounded-xl border border-slate-700 px-5 text-sm font-medium text-slate-200'>
                            Back
                        </button>
                    )}
                    <PrimaryButton type='submit' busy={busy} disabled={disabled} className='flex-1'>
                        {primary}
                    </PrimaryButton>
                </div>
            </div>
        </form>
    );
}

export function ScrollFrame({ children }: { children: ReactNode }) {
    return (
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
            <div className='mx-auto max-w-md px-4 py-8'>{children}</div>
        </div>
    );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className='space-y-3'>
            <h3 className='text-xs font-semibold uppercase tracking-wider text-slate-500'>{title}</h3>
            {children}
        </section>
    );
}
