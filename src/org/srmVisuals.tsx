import { useId, useState } from 'react';

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

// ----- Deeper visuals -----

export const ACC_HUE: Record<string, number> = { SUPPLIER: 210, ORGANIZATION: 280, BOTH: 32 };
export const accColor = (a: string, alpha = 1) => `hsla(${ACC_HUE[a] ?? 0}, 65%, 50%, ${alpha})`;
const ACC_NAME: Record<string, string> = { SUPPLIER: 'Supplier', ORGANIZATION: 'Organization', BOTH: 'Joint' };

/**
 * 100 points split by who is accountable: solid = earned, hatched = lost (not OK), faint = still open.
 * Earned segments add up to the score.
 */
export function ContributionBar({ rows }: { rows: Array<{ accountability: string; weight: number; earned: number; lost: number; open: number }> }) {
    const id = useId().replace(/:/g, '');
    const total = rows.reduce((s, r) => s + r.weight, 0) || 100;
    return (
        <div>
            <svg width='0' height='0' className='absolute'>
                <defs>
                    {rows.map((r) => (
                        <pattern key={r.accountability} id={`h${id}${r.accountability}`} patternUnits='userSpaceOnUse' width='6' height='6' patternTransform='rotate(45)'>
                            <rect width='6' height='6' fill={accColor(r.accountability, 0.12)} />
                            <line x1='0' y1='0' x2='0' y2='6' stroke={scoreColor(0, 0.7)} strokeWidth='2.5' />
                        </pattern>
                    ))}
                </defs>
            </svg>
            <div className='flex h-7 w-full overflow-hidden rounded-lg' role='img' aria-label='Score contribution'>
                {rows.map((r) => (
                    <div key={r.accountability} className='flex h-full' style={{ width: `${(r.weight / total) * 100}%`, borderRight: '2px solid transparent' }}>
                        <div style={{ width: `${(r.earned / (r.weight || 1)) * 100}%`, background: accColor(r.accountability), transition: 'width 600ms' }} />
                        <svg style={{ width: `${(r.lost / (r.weight || 1)) * 100}%`, height: '100%', transition: 'width 600ms' }} preserveAspectRatio='none'><rect width='100%' height='100%' fill={`url(#h${id}${r.accountability})`} /></svg>
                        <div style={{ width: `${(r.open / (r.weight || 1)) * 100}%`, background: accColor(r.accountability, 0.15), transition: 'width 600ms' }} />
                    </div>
                ))}
            </div>
            <div className='mt-3 grid grid-cols-3 gap-2'>
                {rows.map((r) => (
                    <div key={r.accountability} className='rounded-xl bg-page p-2'>
                        <p className='flex items-center gap-1.5 text-xs font-semibold' style={{ color: accColor(r.accountability) }}><span className='h-2.5 w-2.5 rounded-sm' style={{ background: accColor(r.accountability) }} />{ACC_NAME[r.accountability]}</p>
                        <p className='mt-1 text-lg font-bold text-ink'>{fmt(r.earned)}<span className='text-xs font-normal text-muted'> / {fmt(r.weight)}</span></p>
                        <p className='text-xs text-muted'>lost {fmt(r.lost)}{r.open > 0.05 ? ` · open ${fmt(r.open)}` : ''}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Several lines over the same windows: overall plus supplier, organization and joint. Tap a legend item to hide it. */
export function MultiTrend({ points, series, bands, height = 180 }: { points: Array<Record<string, number | string | null>>; series: Array<{ key: string; label: string; color: string; bold?: boolean }>; bands?: { improveFrom: number; passFrom: number }; height?: number }) {
    const [off, setOff] = useState<Record<string, boolean>>({});
    const w = 340, h = height, pl = 28, pr = 22, pt = 14, pb = 24;
    if (!points.length) return <p className='text-sm text-muted'>No final evaluations yet.</p>;
    const x = (i: number) => (points.length === 1 ? (pl + w - pr) / 2 : pl + (i * (w - pl - pr)) / (points.length - 1));
    const y = (v: number) => pt + (1 - v / 100) * (h - pt - pb);
    return (
        <div>
            <svg width='100%' viewBox={`0 0 ${w} ${h}`} role='img' aria-label='Score trends'>
                {bands && (
                    <>
                        <rect x={pl} y={y(100)} width={w - pl - pr} height={y(bands.passFrom) - y(100)} fill={scoreColor(90, 0.09)} />
                        <rect x={pl} y={y(bands.passFrom)} width={w - pl - pr} height={y(bands.improveFrom) - y(bands.passFrom)} fill={scoreColor(55, 0.09)} />
                        <rect x={pl} y={y(bands.improveFrom)} width={w - pl - pr} height={y(0) - y(bands.improveFrom)} fill={scoreColor(5, 0.07)} />
                    </>
                )}
                {[0, 25, 50, 75, 100].map((g) => (
                    <g key={g}>
                        <line x1={pl} x2={w - pr} y1={y(g)} y2={y(g)} stroke='currentColor' className='text-line' strokeWidth={0.6} />
                        <text x={pl - 4} y={y(g) + 4} textAnchor='end' fontSize={12} className='fill-current text-muted'>{g}</text>
                    </g>
                ))}
                {series.filter((s) => !off[s.key]).map((s) => {
                    const pts = points.map((p, i) => ({ i, v: typeof p[s.key] === 'number' ? (p[s.key] as number) : null })).filter((p) => p.v !== null) as Array<{ i: number; v: number }>;
                    if (!pts.length) return null;
                    return (
                        <g key={s.key}>
                            <path d={pts.map((p, k) => `${k ? 'L' : 'M'} ${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')} fill='none' stroke={s.color} strokeWidth={s.bold ? 3 : 1.8} strokeDasharray={s.bold ? undefined : '4 3'} strokeLinecap='round' />
                            {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={s.bold ? 4.5 : 3} fill={s.bold ? scoreColor(p.v) : s.color} />)}
                            {s.bold && pts.map((p) => <text key={`t${p.i}`} x={x(p.i)} y={y(p.v) - 8} textAnchor='middle' fontSize={12} fontWeight={700} fill={scoreColor(p.v)}>{Math.round(p.v)}</text>)}
                        </g>
                    );
                })}
                {points.map((p, i) => <text key={i} x={x(i)} y={h - 6} textAnchor='middle' fontSize={12} className='fill-current text-muted'>{String(p.label ?? '').slice(2, 7)}</text>)}
            </svg>
            <div className='mt-1 flex flex-wrap gap-2'>
                {series.map((s) => (
                    <button key={s.key} type='button' aria-pressed={!off[s.key]} onClick={() => setOff((o) => ({ ...o, [s.key]: !o[s.key] }))} className={`flex min-h-[44px] items-center gap-1.5 rounded-full border border-line px-3 text-xs ${off[s.key] ? 'text-muted line-through' : 'text-soft'}`}>
                        <span className='h-2.5 w-2.5 rounded-full' style={{ background: s.color }} />{s.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Rows (categories) x columns (evaluations), each cell coloured by its score. */
export function Heatmap({ columns, rows }: { columns: string[]; rows: Array<{ id: string; name: string; cells: Array<number | null> }> }) {
    return (
        <div className='overflow-x-auto'>
            <table className='w-full border-separate' style={{ borderSpacing: 3 }}>
                <thead>
                    <tr>
                        <th className='text-left text-xs font-normal text-muted'>Category</th>
                        {columns.map((c, i) => <th key={`${c}${i}`} className='min-w-[40px] text-center text-xs font-normal text-muted'>{c.slice(2, 7)}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id}>
                            <td className='max-w-[110px] truncate pr-1 text-xs text-soft' title={r.name}>{r.name}</td>
                            {r.cells.map((v, i) => (
                                <td key={i} className='h-9 rounded-md text-center text-xs font-semibold' style={{ background: v === null ? 'transparent' : scoreColor(v, 0.22), color: v === null ? undefined : scoreColor(v), border: v === null ? '1px dashed currentColor' : undefined }}>{v === null ? '' : Math.round(v)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** A countdown tile: big number of days with a progress bar through the window. */
export function Countdown({ days, label, caption, pct, tone }: { days: number | null; label: string; caption?: string; pct?: number; tone?: number }) {
    return (
        <div className='rounded-2xl border border-line bg-panel p-3'>
            <p className='text-xs uppercase tracking-wide text-muted'>{label}</p>
            <p className='mt-0.5 text-3xl font-bold' style={{ color: tone === undefined ? undefined : scoreColor(tone) }}>{days === null ? '—' : days}<span className='ml-1 text-sm font-medium text-muted'>{days === 1 ? 'day' : 'days'}</span></p>
            {caption && <p className='text-xs text-soft'>{caption}</p>}
            {pct !== undefined && <div className='mt-2'><ScoreBar pct={100 - pct} height={6} /></div>}
        </div>
    );
}

/** Actions moving from raised to done to verified. */
export function ClosureFunnel({ total, closed, verified }: { total: number; closed: number; verified: number }) {
    const steps = [{ label: 'Raised', n: total, tone: 30 }, { label: 'Done', n: closed, tone: 65 }, { label: 'Verified', n: verified, tone: 100 }];
    return (
        <div className='space-y-1.5'>
            {steps.map((s) => (
                <div key={s.label} className='flex items-center gap-2'>
                    <span className='w-16 shrink-0 text-xs text-soft'>{s.label}</span>
                    <div className='h-6 flex-1 overflow-hidden rounded-md bg-line'>
                        <div className='flex h-full items-center justify-end rounded-md pr-2 text-xs font-semibold text-white' style={{ width: `${total ? Math.max(8, (s.n / total) * 100) : 0}%`, background: scoreColor(s.tone), transition: 'width 600ms' }}>{s.n}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}
