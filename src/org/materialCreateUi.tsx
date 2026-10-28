import type { ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Cloud, CloudOff, Loader2, Pencil, X } from 'lucide-react';

/**
 * Building blocks for the material creation wizard: a sticky action bar with the step progress, step sections,
 * selectable option cards, review sections and duplicate match cards. Theme tokens only (page, panel, line, ink,
 * soft, muted, brand) so the screens follow the tenant colours in light and dark appearance.
 */

export interface WizardStep {
    label: string;
    /** Open items in this step (0 = complete). */
    open: number;
}

/** Sticky action bar: close, title, progress, autosave state, the step actions and the current error. */
export function WizardBar({ title, steps, stage, onStep, onClose, status, actions, error, blocked }: {
    title: string;
    steps: WizardStep[];
    stage: number;
    /** Jump to an earlier step. */
    onStep: (stage: number) => void;
    onClose: () => void;
    status?: string;
    actions: ReactNode;
    error?: string;
    blocked?: string;
}) {
    const current = steps[stage - 1];
    const saving = status?.startsWith('Saving');
    const failed = status?.toLowerCase().includes('failed');
    return (
        <div className='sticky top-[var(--mems-top,0px)] z-20 mx-[calc(var(--mems-gutter,0px)*-1)] mb-4 border-b border-line bg-page/95 px-[var(--mems-gutter,0px)] pb-3 pt-2 backdrop-blur'>
            <div className='flex items-center gap-2'>
                <button type='button' onClick={onClose} aria-label='Close and return to materials'
                    className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-soft active:bg-panel'>
                    <X className='h-5 w-5' />
                </button>
                <div className='min-w-0 flex-1'>
                    <h1 className='truncate text-base font-semibold text-ink sm:text-lg'>{title}</h1>
                    <p className='truncate text-xs text-muted'>Step {stage} of {steps.length} · {current?.label}</p>
                </div>
                {status && (
                    <span role='status' className={`hidden shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs sm:flex ${failed ? 'border-red-500/50 text-red-400' : 'border-line text-muted'}`}>
                        {saving ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : failed ? <CloudOff className='h-3.5 w-3.5' /> : <Cloud className='h-3.5 w-3.5' />}
                        {status}
                    </span>
                )}
            </div>
            <div className='mt-2'><StepProgress steps={steps} stage={stage} onStep={onStep} /></div>
            {blocked && (
                <p role='alert' className='mt-2 flex items-start gap-2 rounded-lg border border-red-500/60 bg-red-500/10 p-2 text-xs font-semibold text-red-400'>
                    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />{blocked}
                </p>
            )}
            {error && (
                <p role='alert' className='mt-2 rounded-lg border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-400'>{error}</p>
            )}
            <div className='mt-2 flex items-center gap-2'>{actions}</div>
        </div>
    );
}

/** Step progress: segments per step; earlier steps are tappable to go back. Usable in any screen's toolbar. */
export function StepProgress({ steps, stage, onStep }: { steps: WizardStep[]; stage: number; onStep: (stage: number) => void }) {
    return (
        <ol className='grid gap-1' style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label='Progress'>
            {steps.map((s, i) => {
                const n = i + 1;
                const done = n < stage && s.open === 0;
                const active = n === stage;
                const reachable = n < stage;
                return (
                    <li key={s.label} className='min-w-0'>
                        <button type='button' disabled={!reachable} onClick={() => onStep(n)} aria-current={active ? 'step' : undefined}
                            aria-label={`Step ${n}: ${s.label}${done ? ' (complete)' : s.open ? ` (${s.open} open)` : ''}`}
                            className='group block w-full text-left disabled:cursor-default'>
                            <span className={`block h-1.5 rounded-full ${active ? 'bg-brand' : done ? 'bg-brand/60' : n < stage ? 'bg-amber-400/70' : 'bg-line'}`} />
                            <span className={`mt-1 hidden truncate text-[11px] sm:block ${active ? 'font-semibold text-ink' : 'text-muted group-enabled:group-hover:text-soft'}`}>{s.label}</span>
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

/** One section of a step, with a short plain explanation. */
export function StepSection({ title, hint, children, aside }: { title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
    return (
        <section className='rounded-2xl border border-line bg-panel p-4 sm:p-5'>
            <div className='mb-4 flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                    <h2 className='text-base font-semibold text-ink'>{title}</h2>
                    {hint && <p className='mt-1 text-xs text-muted'>{hint}</p>}
                </div>
                {aside}
            </div>
            {children}
        </section>
    );
}

/** A large, tappable choice (radio behaviour). */
export function OptionCard({ selected, onSelect, title, text, badge }: { selected: boolean; onSelect: () => void; title: string; text: string; badge?: string }) {
    return (
        <button type='button' role='radio' aria-checked={selected} onClick={onSelect}
            className={`relative flex min-h-[5.5rem] w-full flex-col rounded-xl border p-3 text-left transition ${selected ? 'border-brand bg-brand/10 ring-1 ring-brand' : 'border-line bg-page active:bg-panel'}`}>
            <span className='flex items-center gap-2 pr-6'>
                <span className='text-sm font-semibold text-ink'>{title}</span>
                {badge && <span className='rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand'>{badge}</span>}
            </span>
            <span className='mt-1 text-xs text-muted'>{text}</span>
            {selected && <Check className='absolute right-3 top-3 h-5 w-5 text-brand' />}
        </button>
    );
}

/** Multi-select chip (checkbox behaviour). */
export function ChoiceChip({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: ReactNode }) {
    return (
        <button type='button' role='checkbox' aria-checked={checked} onClick={onToggle}
            className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm ${checked ? 'border-brand bg-brand/10 text-ink' : 'border-line bg-page text-soft'}`}>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-brand bg-brand text-onbrand' : 'border-line'}`}>
                {checked && <Check className='h-3.5 w-3.5' />}
            </span>
            <span className='min-w-0 break-words'>{children}</span>
        </button>
    );
}

/** Confirmation with a large hit area. */
export function ConfirmBox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
    return (
        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${checked ? 'border-brand bg-brand/10 text-ink' : 'border-line bg-page text-soft'}`}>
            <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0' checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span>{children}</span>
        </label>
    );
}

/** Generated short text with its length. */
export function ShortTextPreview({ text, max = 120 }: { text: string; max?: number }) {
    return (
        <div className='rounded-xl border border-dashed border-line bg-page p-3'>
            <div className='flex items-center justify-between gap-2 text-xs text-muted'>
                <span>Short text (generated)</span>
                <span className={text.length >= max ? 'text-amber-400' : ''}>{text.length}/{max}</span>
            </div>
            <p className='mt-1 break-words text-sm font-medium text-ink'>{text || 'Appears when the name and key attributes are filled in.'}</p>
        </div>
    );
}

/** Review block with an edit shortcut back to its step. */
export function ReviewSection({ title, items, onEdit }: { title: string; items: Array<[string, ReactNode]>; onEdit?: () => void }) {
    const shown = items.filter(([, v]) => v !== undefined && v !== null && v !== '');
    return (
        <section className='rounded-2xl border border-line bg-panel p-4'>
            <div className='mb-2 flex items-center justify-between gap-2'>
                <h3 className='text-sm font-semibold text-ink'>{title}</h3>
                {onEdit && (
                    <button type='button' onClick={onEdit} className='flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-brand active:bg-page'>
                        <Pencil className='h-3.5 w-3.5' /> Edit
                    </button>
                )}
            </div>
            {shown.length ? (
                <dl className='grid gap-x-4 gap-y-2 sm:grid-cols-2'>
                    {shown.map(([label, value]) => (
                        <div key={label} className='min-w-0 border-b border-line/60 pb-2 last:border-0'>
                            <dt className='text-xs text-muted'>{label}</dt>
                            <dd className='break-words text-sm text-ink'>{value}</dd>
                        </div>
                    ))}
                </dl>
            ) : <p className='text-xs text-muted'>Nothing entered.</p>}
        </section>
    );
}

/** One existing material that resembles the new one. */
export function MatchCard({ score, name, shortText, status, meta, action }: { score: number; name: string; shortText: string; status: string; meta?: ReactNode; action?: ReactNode }) {
    const tone = score >= 90 ? 'bg-red-500/15 text-red-400 ring-red-500/40' : score >= 70 ? 'bg-amber-400/15 text-amber-400 ring-amber-400/40' : 'bg-page text-muted ring-line';
    return (
        <div className='flex gap-3 rounded-xl border border-line bg-page p-3'>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ring-1 ${tone}`}>{score}%</span>
            <div className='min-w-0 flex-1'>
                <p className='break-words text-sm font-semibold text-ink'>{name}</p>
                <p className='line-clamp-2 break-words text-xs text-muted'>{shortText}</p>
                <p className='mt-1 text-[11px] uppercase tracking-wide text-muted'>{status.replaceAll('_', ' ')}</p>
                {meta && <div className='mt-1 text-xs text-soft'>{meta}</div>}
                {action && <div className='mt-2'>{action}</div>}
            </div>
        </div>
    );
}

/** Open items of the current step, folded. */
export function OpenItems({ issues }: { issues: string[] }) {
    if (!issues.length) return null;
    return (
        <details className='group rounded-2xl border border-amber-400/40 bg-amber-400/5 p-3 text-sm'>
            <summary className='flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 font-medium text-amber-400'>
                <span>{issues.length} item{issues.length === 1 ? '' : 's'} still to complete in this step</span>
                <ChevronDown className='h-4 w-4 transition group-open:rotate-180' />
            </summary>
            <ul className='mt-2 space-y-1 text-xs text-soft'>{issues.map((i) => <li key={i}>• {i}</li>)}</ul>
        </details>
    );
}
