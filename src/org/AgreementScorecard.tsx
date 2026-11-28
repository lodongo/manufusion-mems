import { Ring, fmt, scoreColor } from './srmVisuals';

// The purchase agreement scorecard: what the agreement was meant to deliver (projected), where it should be by now
// (on pace) and what it has actually delivered. Used on the agreement dashboard and on the supplier dashboard.

export type Band = 'good' | 'watch' | 'poor' | 'none';
export interface ScoreRow {
    key: string;
    label: string;
    unit: 'money' | 'days' | 'pct' | 'count';
    better: 'higher' | 'lower';
    intended: number | null;
    pace: number | null;
    actual: number | null;
    achievedPct: number | null;
    band: Band;
    note: string;
}
export interface ScorecardData {
    rows: ScoreRow[];
    score: number | null;
    band: Band;
    basis: 'to date' | 'final';
    purchases: number;
}

/** Green when it is delivered, amber when it needs watching, red when it is not, grey when there is nothing to judge yet. */
export const bandScore = (b: Band): number | null => (b === 'good' ? 100 : b === 'watch' ? 38 : b === 'poor' ? 6 : null);
export const bandColor = (b: Band, alpha = 1) => scoreColor(bandScore(b), alpha);
export const BAND_WORD: Record<Band, string> = { good: 'On target', watch: 'Watch', poor: 'Behind', none: 'Not enough yet' };

export function formatBy(unit: ScoreRow['unit'], n: number | null | undefined, currency = ''): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    if (unit === 'money') return `${currency ? `${currency} ` : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (unit === 'days') return `${fmt(n)} d`;
    if (unit === 'pct') return `${fmt(n)}%`;
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function Bar({ r }: { r: ScoreRow }) {
    const scale = Math.max(r.intended ?? 0, r.actual ?? 0, r.pace ?? 0, 1e-9);
    const at = (v: number | null) => (v === null ? null : Math.max(0, Math.min(100, (v / scale) * 100)));
    const fill = at(r.actual);
    const goal = at(r.intended);
    const pace = r.better === 'higher' && r.pace !== r.intended ? at(r.pace) : null;
    return (
        <div className='relative mt-2 h-2.5 w-full rounded-full bg-line' role='img' aria-label={`${r.label}: actual ${r.actual ?? 'none'}, projected ${r.intended ?? 'none'}`}>
            {fill !== null && <div className='h-full rounded-full' style={{ width: `${fill}%`, background: bandColor(r.band === 'none' ? 'good' : r.band), opacity: r.band === 'none' ? 0.55 : 1, transition: 'width 600ms cubic-bezier(.2,.8,.2,1)' }} />}
            {goal !== null && <span className='absolute -top-1 w-0.5 bg-ink/70' style={{ left: `calc(${goal}% - 1px)`, height: '1.125rem' }} title='Projected' />}
            {pace !== null && <span className='absolute -top-0.5 w-0.5 bg-ink/35' style={{ left: `calc(${pace}% - 1px)`, height: '0.875rem' }} title='On pace' />}
        </div>
    );
}

export function ScoreRowView({ r, currency }: { r: ScoreRow; currency: string }) {
    return (
        <li className='rounded-xl border border-line bg-panel p-3'>
            <div className='flex items-start justify-between gap-2'>
                <p className='min-w-0 text-sm font-medium text-ink'>{r.label}</p>
                <span className='shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold' style={{ background: bandColor(r.band, 0.15), color: bandColor(r.band) }}>
                    {r.band === 'none' ? (r.actual !== null ? 'No target set' : BAND_WORD.none) : r.achievedPct !== null ? `${Math.round(r.achievedPct)}% · ${BAND_WORD[r.band]}` : BAND_WORD[r.band]}
                </span>
            </div>
            <dl className='mt-2 grid grid-cols-3 gap-2 text-xs'>
                <div>
                    <dt className='text-muted'>Projected</dt>
                    <dd className='font-semibold text-ink'>{formatBy(r.unit, r.intended, currency)}</dd>
                </div>
                <div>
                    <dt className='text-muted'>{r.better === 'lower' ? 'Promised' : 'On pace'}</dt>
                    <dd className='font-semibold text-ink'>{formatBy(r.unit, r.pace, currency)}</dd>
                </div>
                <div>
                    <dt className='text-muted'>Actual</dt>
                    <dd className='font-semibold' style={{ color: r.band === 'none' ? undefined : bandColor(r.band) }}>{formatBy(r.unit, r.actual, currency)}</dd>
                </div>
            </dl>
            <Bar r={r} />
            {r.note && <p className='mt-2 text-xs text-soft'>{r.note}</p>}
        </li>
    );
}

export default function Scorecard({ card, currency, title = 'Projected against actual' }: { card: ScorecardData; currency: string; title?: string }) {
    return (
        <section className='space-y-2' aria-label={title}>
            <div className='flex items-center gap-3 rounded-xl border border-line bg-panel p-3'>
                <Ring pct={card.score} label='Score' size={76} />
                <div className='min-w-0'>
                    <h3 className='text-sm font-semibold text-ink'>{title}</h3>
                    <p className='text-xs text-muted'>{card.basis === 'final' ? 'Final: the agreement has ended.' : 'To date: judged against the time used so far.'}</p>
                    <p className='mt-1 text-xs text-soft'>
                        {card.purchases} order(s) bought on the agreement. The line on each bar marks the projected figure; the lighter line marks where it should be by now.
                    </p>
                </div>
            </div>
            <ul className='space-y-2'>
                {card.rows.map((r) => <ScoreRowView key={r.key} r={r} currency={currency} />)}
            </ul>
        </section>
    );
}
