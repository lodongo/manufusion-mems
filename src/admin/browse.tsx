import { useEffect, useId, type ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { Toggle } from './kit';

// Building blocks shared by the admin reference-list browsers (skills, SAF metadata, utilities, units of measure).
//   DetailSheet  details of a tapped row: bottom sheet on phones, dialog on larger screens (never below a table)
//   DetailRow    label / value line inside a DetailSheet
//   Breadcrumb   Category › Subcategory trail with 44px targets; scrolls sideways inside itself
//   GroupList    tappable category / subcategory cards (short lists)
//   TableToggle  kit Toggle with a 44px hit area that does not open the row it sits in

export function DetailSheet({
    open,
    title,
    eyebrow,
    onClose,
    footer,
    children,
}: {
    open: boolean;
    title: string;
    eyebrow?: string;
    onClose: () => void;
    footer?: ReactNode;
    children: ReactNode;
}) {
    const titleId = useId();

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;
    // z-[90]: below ConfirmSheet (z-[100]) so a confirmation started here opens on top.
    return (
        <div className='fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4' role='presentation'>
            <button type='button' aria-label='Close details' className='absolute inset-0 bg-black/60' onClick={onClose} />
            <div role='dialog' aria-modal='true' aria-labelledby={titleId} className='relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-line bg-panel sm:max-w-lg sm:rounded-2xl'>
                <div className='flex items-start gap-3 border-b border-line p-4'>
                    <div className='min-w-0 flex-1'>
                        {eyebrow && <p className='truncate font-mono text-xs text-brandsoft'>{eyebrow}</p>}
                        <h2 id={titleId} className='text-base font-semibold text-ink'>
                            {title}
                        </h2>
                    </div>
                    <button type='button' aria-label='Close' onClick={onClose} className='-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted active:bg-page'>
                        <X className='h-5 w-5' />
                    </button>
                </div>
                <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm text-soft'>{children}</div>
                {footer && <div className='flex flex-wrap gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>{footer}</div>}
            </div>
        </div>
    );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className='flex items-start justify-between gap-3 border-b border-line py-2 last:border-0'>
            <span className='shrink-0 text-xs uppercase tracking-wide text-muted'>{label}</span>
            <span className='min-w-0 break-words text-right text-sm text-ink'>{children}</span>
        </div>
    );
}

export interface Crumb {
    label: string;
    /** Omit for the current (last) level. */
    onClick?: () => void;
}

export function Breadcrumb({ label, trail }: { label: string; trail: Crumb[] }) {
    return (
        <nav aria-label={label} className='-mx-1 flex items-center overflow-x-auto px-1 text-sm'>
            {trail.map((c, i) => (
                <span key={`${i}-${c.label}`} className='flex shrink-0 items-center'>
                    {i > 0 && <ChevronRight className='h-4 w-4 shrink-0 text-muted' aria-hidden='true' />}
                    {c.onClick ? (
                        <button type='button' onClick={c.onClick} className='flex h-11 items-center rounded-lg px-2 font-medium text-brandsoft underline underline-offset-4 active:bg-panel'>
                            {c.label}
                        </button>
                    ) : (
                        <span aria-current='page' className='flex h-11 items-center px-2 font-medium text-ink'>
                            {c.label}
                        </span>
                    )}
                </span>
            ))}
        </nav>
    );
}

export interface Group {
    key: string;
    title: string;
    meta: string;
}

export function GroupList({ groups, onOpen }: { groups: Group[]; onOpen: (key: string) => void }) {
    return (
        <ul className='grid gap-2 sm:grid-cols-2'>
            {groups.map((g) => (
                <li key={g.key}>
                    <button type='button' onClick={() => onOpen(g.key)} className='flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-line bg-panel p-4 text-left active:bg-page'>
                        <span className='min-w-0 flex-1'>
                            <span className='block font-semibold text-ink'>{g.title}</span>
                            <span className='block text-sm text-muted'>{g.meta}</span>
                        </span>
                        <ChevronRight className='h-5 w-5 shrink-0 text-brandsoft' aria-hidden='true' />
                    </button>
                </li>
            ))}
        </ul>
    );
}

/**
 * Toggle for a table cell. The surrounding label gives a 44px hit area (a label forwards taps to the switch)
 * and stops the tap from also opening the row's details.
 */
export function TableToggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
    return (
        <label className='-my-2 flex min-h-[44px] w-fit items-center px-2' onClick={(e) => e.stopPropagation()}>
            <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
        </label>
    );
}
