import { useId } from 'react';

// Shared visuals for supplier relationship evaluation: a 0-100 colour scale that moves smoothly from red through
// yellow to green, a semicircle gauge, small rings, bars and a trend line. Colours are computed, not themed, so the
// meaning (red bad, green good) is the same in every theme.

/** Red (0) -> yellow (50) -> green (100), smoothly. */
export function scoreColor(score: number | null | undefined, alpha = 1): string {
    if (score === null || score === undefined || !Number.isFinite(score)) return `hsla(220, 8%, 55%, ${alpha})`;
    const s = Math.max(0, Math.min(100, score));
    const hue = (s / 100) * 125;
    const light = 46 - Math.sin((s / 100) * Math.PI) * 4;
    return `hsla(${hue.toFixed(1)}, 78%, ${light.toFixed(1)}%, ${alpha})`;
}
export const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));

/** Semicircle gauge 0-100 with the red-yellow-green scale, band ticks and the score in the middle. */
export function ScoreGauge({ score, coverage, bands, label, caption, size = 240 }: { score: number; coverage?: number | null; bands?: { improveFrom: number; passFrom: number }; label?: string; caption?: string; size?: number }) {
    const id = useId().replace(/:/g, '');
    const w = size, h = size * 0.62, r = size * 0.4, cx = w / 2, cy = size * 0.5, stroke = size * 0.075;
    const len = Math.PI * r;
    const s = Math.max(0, Math.min(100, score || 0));
    const pt = (v: number, rr = r) => {
        const a = Math.PI * (1 - v / 100);
        return { x: cx + rr * Math.cos(a), y: cy - rr * Math.sin(a) };
    };
    const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
    const needle = pt(s);
    return (
        <figure className='flex flex-col items-center' aria-label={`${label ?? 'Score'} ${fmt(s)} out of 100`}>
            <svg width='100%' viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: w }} role='img'>
                <defs>
                    <linearGradient id={`g${id}`} x1='0' y1='0' x2='1' y2='0'>
                        <stop offset='0%' stopColor={scoreColor(0)} />
                        <stop offset='25%' stopColor={scoreColor(25)} />
                        <stop offset='50%' stopColor={scoreColor(50)} />
                        <stop offset='75%' stopColor={scoreColor(75)} />
                        <stop offset='100%' stopColor={scoreColor(100)} />
                    </linearGradient>
                </defs>
                <path d={arc} fill='none' stroke={`url(#g${id})`} strokeOpacity={0.18} strokeWidth={stroke} strokeLinecap='round' />
                <path d={arc} fill='none' stroke={`url(#g${id})`} strokeWidth={stroke} strokeLinecap='round' strokeDasharray={len} strokeDashoffset={len * (1 - s / 100)} style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)' }} />
                {bands && [bands.improveFrom, bands.passFrom].map((b) => {
                    const a = pt(b, r - stroke * 0.9), c = pt(b, r + stroke * 0.9);
                    return <line key={b} x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke='currentColor' className='text-muted' strokeWidth={1.5} strokeDasharray='2 2' />;
                })}
                <circle cx={needle.x} cy={needle.y} r={stroke * 0.62} className='fill-current text-panel' stroke={scoreColor(s)} strokeWidth={3} style={{ transition: 'cx 600ms cubic-bezier(.2,.8,.2,1), cy 600ms cubic-bezier(.2,.8,.2,1)' }} />
                <text x={cx} y={cy - r * 0.18} textAnchor='middle' fontSize={size * 0.2} fontWeight={700} fill={scoreColor(s)} style={{ transition: 'fill 600ms' }}>{fmt(s)}</text>
                <text x={cx} y={cy + size * 0.02} textAnchor='middle' fontSize={size * 0.055} className='fill-current text-muted'>out of 100</text>
                <text x={cx - r} y={cy + size * 0.1} textAnchor='middle' fontSize={size * 0.05} className='fill-current text-muted'>0</text>
                <text x={cx + r} y={cy + size * 0.1} textAnchor='middle' fontSize={size * 0.05} className='fill-current text-muted'>100</text>
            </svg>
            {(label || caption || coverage !== undefined) && (
                <figcaption className='-mt-1 text-center'>
                    {label && <span className='block text-sm font-semibold text-ink'>{label}</span>}
                    {coverage !== undefined && coverage !== null && <span className='block text-xs text-muted'>{fmt(coverage, 0)}% of the weight assessed</span>}
                    {caption && <span className='block text-xs text-muted'>{caption}</span>}
                </figcaption>
            )}
        </figure>
    );
}

/** Small ring for a percentage (supplier, organization, joint). */
export function Ring({ pct, label, size = 72 }: { pct: number | null; label: string; size?: number }) {
    const r = size * 0.38, c = 2 * Math.PI * r, v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    return (
        <div className='flex min-w-0 flex-col items-center gap-1'>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role='img' aria-label={`${label} ${pct === null ? 'not assessed' : `${fmt(pct)}%`}`}>
                <circle cx={size / 2} cy={size / 2} r={r} fill='none' stroke='currentColor' className='text-line' strokeWidth={size * 0.1} />
                <circle cx={size / 2} cy={size / 2} r={r} fill='none' stroke={scoreColor(pct)} strokeWidth={size * 0.1} strokeLinecap='round' strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1), stroke 600ms' }} />
                <text x='50%' y='54%' dominantBaseline='middle' textAnchor='middle' fontSize={size * 0.24} fontWeight={700} fill={scoreColor(pct)}>{pct === null ? '—' : Math.round(pct)}</text>
            </svg>
            <span className='truncate text-xs text-soft'>{label}</span>
        </div>
    );
}

/** Horizontal bar coloured by its value. */
export function ScoreBar({ pct, height = 8 }: { pct: number | null; height?: number }) {
    const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
    return (
        <div className='w-full overflow-hidden rounded-full bg-line' style={{ height }} role='progressbar' aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <div className='h-full rounded-full' style={{ width: `${v}%`, background: `linear-gradient(90deg, ${scoreColor(Math.max(0, v - 25))}, ${scoreColor(v)})`, transition: 'width 600ms cubic-bezier(.2,.8,.2,1)' }} />
        </div>
    );
}

/** The Fail / Needs improvement / Pass ranges as a coloured strip. */
export function BandStrip({ improveFrom, passFrom }: { improveFrom: number; passFrom: number }) {
    return (
        <div>
            <div className='flex h-3 w-full overflow-hidden rounded-full'>
                <div style={{ width: `${improveFrom}%`, background: `linear-gradient(90deg, ${scoreColor(0)}, ${scoreColor(improveFrom * 0.6)})` }} />
                <div style={{ width: `${passFrom - improveFrom}%`, background: `linear-gradient(90deg, ${scoreColor(improveFrom)}, ${scoreColor(passFrom - 5)})` }} />
                <div style={{ width: `${100 - passFrom}%`, background: `linear-gradient(90deg, ${scoreColor(passFrom)}, ${scoreColor(100)})` }} />
            </div>
            <div className='mt-1 flex text-xs text-soft'>
                <span style={{ width: `${improveFrom}%` }}>Fail &lt; {improveFrom}</span>
                <span style={{ width: `${passFrom - improveFrom}%` }}>Improve {improveFrom}–{passFrom}</span>
                <span className='flex-1 text-right'>Pass ≥ {passFrom}</span>
            </div>
        </div>
    );
}

export function BandChip({ score, bands }: { score: number; bands: { improveFrom: number; passFrom: number } }) {
    const label = score >= bands.passFrom ? 'Pass' : score >= bands.improveFrom ? 'Needs improvement' : 'Fail';
    return <span className='inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold' style={{ background: scoreColor(score, 0.16), color: scoreColor(score), border: `1px solid ${scoreColor(score, 0.45)}` }}>{label}</span>;
}

/** Trend line with the pass and improve zones shaded. */
export function TrendChart({ points, bands, height = 150 }: { points: Array<{ label: string; score: number }>; bands: { improveFrom: number; passFrom: number }; height?: number }) {
    const w = 320, h = height, pad = 24;
    if (!points.length) return <p className='text-sm text-muted'>No finalized evaluations yet.</p>;
    const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (points.length - 1));
    const y = (v: number) => h - pad - (v / 100) * (h - pad * 1.6);
    const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
    return (
        <svg width='100%' viewBox={`0 0 ${w} ${h}`} role='img' aria-label='Score trend'>
            <rect x={pad / 2} y={y(100)} width={w - pad} height={y(bands.passFrom) - y(100)} fill={scoreColor(90, 0.1)} />
            <rect x={pad / 2} y={y(bands.passFrom)} width={w - pad} height={y(bands.improveFrom) - y(bands.passFrom)} fill={scoreColor(55, 0.1)} />
            <rect x={pad / 2} y={y(bands.improveFrom)} width={w - pad} height={y(0) - y(bands.improveFrom)} fill={scoreColor(10, 0.08)} />
            <path d={line} fill='none' stroke='currentColor' className='text-soft' strokeWidth={2} />
            {points.map((p, i) => (
                <g key={`${p.label}-${i}`}>
                    <circle cx={x(i)} cy={y(p.score)} r={5} fill={scoreColor(p.score)} />
                    <text x={x(i)} y={y(p.score) - 9} textAnchor='middle' fontSize={12} fontWeight={600} fill={scoreColor(p.score)}>{Math.round(p.score)}</text>
                    <text x={x(i)} y={h - 6} textAnchor='middle' fontSize={12} className='fill-current text-muted'>{p.label}</text>
                </g>
            ))}
        </svg>
    );
}

/** Light green (OK), light red (not OK) or plain (not assessed). */
export const answerStyle = (state: string) =>
    state === 'ok'
        ? { background: 'rgba(34, 197, 94, 0.13)', borderColor: 'rgba(34, 197, 94, 0.45)' }
        : state === 'not_ok'
            ? { background: 'rgba(239, 68, 68, 0.12)', borderColor: 'rgba(239, 68, 68, 0.45)' }
            : {};
