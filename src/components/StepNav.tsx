import { Check } from 'lucide-react';
import SelectField from './SearchableSelect';

export type StepNavItem = {
    key: string;
    label: string;
    /** done: complete · open: needs attention · undefined: not assessed yet */
    state?: 'done' | 'open';
};

/**
 * MEMS standard section/step navigation for multi-part forms.
 * Phones: one compact header (step n of N, the current section and its status), a tappable progress
 * bar and the standard dropdown to jump to any section, so the form itself starts on the first screen.
 * Larger screens: every section as a button in a grid.
 */
export default function StepNav({ steps, current, onChange, label, noun = 'Step' }: { steps: StepNavItem[]; current: string; onChange: (key: string) => void; label: string; noun?: 'Step' | 'Section' }) {
    const index = Math.max(0, steps.findIndex((s) => s.key === current));
    const active = steps[index];
    const status = (s: StepNavItem) => (s.state === 'done' ? 'Complete' : s.state === 'open' ? 'Needs attention' : '');
    return (
        <nav aria-label={label} className='min-w-0 space-y-2'>
            <div className='space-y-2 rounded-xl border border-line bg-panel p-3 sm:hidden'>
                <div className='flex items-baseline justify-between gap-2'>
                    <p className='min-w-0 truncate text-sm font-semibold text-ink'>
                        <span className='text-muted'>{noun} {index + 1} of {steps.length} · </span>
                        {active?.label}
                    </p>
                    {active && status(active) && (
                        <span className={`shrink-0 text-xs font-medium ${active.state === 'done' ? 'text-brand' : 'text-amber-600'}`}>{status(active)}</span>
                    )}
                </div>
                <ol className='grid gap-1' style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
                    {steps.map((s, i) => (
                        <li key={s.key}>
                            <button
                                type='button'
                                onClick={() => onChange(s.key)}
                                aria-label={`${noun} ${i + 1}: ${s.label}${status(s) ? ` (${status(s).toLowerCase()})` : ''}`}
                                aria-current={i === index ? (noun === 'Step' ? 'step' : 'page') : undefined}
                                className='flex h-6 w-full items-center'
                            >
                                <span className={`block h-1.5 w-full rounded-full ${i === index ? 'bg-brand' : s.state === 'done' ? 'bg-brand/50' : s.state === 'open' && i < index ? 'bg-amber-400' : 'bg-line'}`} />
                            </button>
                        </li>
                    ))}
                </ol>
                <SelectField label='Go to section' hideLabel value={active?.key ?? ''} onChange={(e) => onChange(e.target.value)}>
                    {steps.map((s, i) => (
                        <option key={s.key} value={s.key}>
                            {`${i + 1}. ${s.label}${s.state === 'done' ? ' ✓' : ''}`}
                        </option>
                    ))}
                </SelectField>
            </div>
            <div className='hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-3'>
                {steps.map((s, i) => (
                    <button
                        type='button'
                        key={s.key}
                        aria-current={i === index ? 'step' : undefined}
                        onClick={() => onChange(s.key)}
                        className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${i === index ? 'border-brand bg-brand text-onbrand font-semibold' : 'border-line bg-panel text-ink'}`}
                    >
                        <span className='min-w-0 truncate'>{i + 1}. {s.label}</span>
                        {s.state === 'done' ? <Check aria-hidden className='h-4 w-4 shrink-0' /> : s.state === 'open' ? <span className={`h-2 w-2 shrink-0 rounded-full ${i === index ? 'bg-onbrand' : 'bg-amber-500'}`} aria-hidden /> : null}
                    </button>
                ))}
            </div>
        </nav>
    );
}
