// ---------------------------------------------------------------------------
// Material audit (Inventory › material detail › Audit) and the audit register (Inventory › Setup › Material audits).
//
// Opening the tab runs the audit on the server: the forecast is worked out in the background, the criticality
// analysis, levels, strategy, stock, open supply and stock take adjustments are checked, and the day's report is saved
// so the score, the excess (opportunity) and the stock-out exposure (risk) can be trended. Accepted level changes are
// listed with their impact on stock holding. Reports download as PDF.
// ---------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Save, XCircle } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field } from '../components/ui';
import { useConfirm } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, Toggle, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { downloadReportPdf } from '../lib/report';
import type { AuditReport, Finding, LevelImpact, Levels } from '../../backend/materialAuditModel';

const API = '/api/org/inventory/audit/';
const SEV_TONE: Record<string, 'danger' | 'warn' | 'muted' | 'brand'> = { high: 'danger', medium: 'warn', low: 'muted', info: 'brand' };
const SEV_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const AREA_LABEL: Record<string, string> = { criticality: 'Criticality', forecast: 'Forecast', levels: 'Levels', strategy: 'Strategy', stock_take: 'Count adjustments', stock: 'Stock holding', lead_time: 'Lead time' };
const LEVEL_LABEL: Record<string, string> = { minimumLevel: 'Minimum', maximumLevel: 'Maximum', reorderQuantity: 'Reorder quantity', safetyStock: 'Safety stock', reorderPoint: 'Reorder point' };
const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n.toFixed(digits)).toLocaleString());
const money = (n: number | null | undefined) => fmt(n, 2);

interface Context {
    materialNumber: string;
    description: string;
    strategy: string;
    cell: string;
    levelSource: string;
    levelMode: string;
    method: string;
    trend: string;
    leadDays: number;
    serviceLevel: number;
    current: Levels;
    recommended: Levels | null;
    tolerancePct: number;
}
interface TrendRow {
    day: string;
    score: number;
    excessValue: number;
    riskValue: number;
    stockValue?: number;
}
interface LevelChange {
    id: string;
    source: 'forecast' | 'manual';
    simulated: boolean;
    method: string;
    before: Levels;
    after: Levels;
    impact: LevelImpact;
    at: string;
}
interface AuditData {
    report: AuditReport;
    context: Context;
    at: string;
    trend: TrendRow[];
    levelChanges: LevelChange[];
}

type Tab = 'Criticality Analysis' | 'Forecasting' | 'Stock Control' | 'Inventory Information' | 'Movements';
const AREA_TAB: Record<string, Tab> = { criticality: 'Criticality Analysis', forecast: 'Forecasting', lead_time: 'Inventory Information', levels: 'Forecasting', strategy: 'Stock Control', stock_take: 'Movements', stock: 'Forecasting' };

/** Small multi-line trend chart over the saved reports (one point per day). */
export function TrendChart({ rows, series, height = 120 }: { rows: Array<Record<string, number | string>>; series: Array<{ key: string; label: string; color: string; max?: number }>; height?: number }) {
    if (rows.length < 2) return <p className='text-xs text-muted'>The trend appears once there are reports on two or more days.</p>;
    const W = Math.max(320, rows.length * 22 + 44);
    const top = 8;
    const plotH = height - 26;
    const left = 36;
    const yMax = Math.max(1, ...series.map((s) => s.max ?? Math.max(...rows.map((r) => Number(r[s.key]) || 0)) * 1.05));
    const x = (i: number) => left + (i * (W - left - 10)) / Math.max(1, rows.length - 1);
    const y = (v: number) => top + plotH - (v / yMax) * plotH;
    return (
        <div className='overflow-x-auto overscroll-contain'>
            <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className='block' role='img' aria-label={`Trend of ${series.map((s) => s.label).join(' and ')}`}>
                {[0, 0.5, 1].map((t) => (
                    <g key={t}>
                        <line x1={left} x2={W - 6} y1={y(t * yMax)} y2={y(t * yMax)} stroke='#334155' strokeWidth={0.5} />
                        <text x={left - 4} y={y(t * yMax) + 3} textAnchor='end' fontSize={9} fill='#94a3b8'>
                            {yMax * t >= 1000 ? `${Math.round((yMax * t) / 100) / 10}k` : Math.round(yMax * t)}
                        </text>
                    </g>
                ))}
                {series.map((s) => (
                    <g key={s.key}>
                        <polyline points={rows.map((r, i) => `${x(i)},${y(Number(r[s.key]) || 0)}`).join(' ')} fill='none' stroke={s.color} strokeWidth={1.75} />
                        {rows.map((r, i) => (
                            <circle key={i} cx={x(i)} cy={y(Number(r[s.key]) || 0)} r={2} fill={s.color}>
                                <title>{`${r.day}: ${s.label} ${fmt(Number(r[s.key]))}`}</title>
                            </circle>
                        ))}
                    </g>
                ))}
                {rows.map((r, i) =>
                    i === 0 || i === rows.length - 1 || i % Math.ceil(rows.length / 6) === 0 ? (
                        <text key={i} x={x(i)} y={height - 4} textAnchor='middle' fontSize={9} fill='#94a3b8'>
                            {String(r.day).slice(5)}
                        </text>
                    ) : null
                )}
            </svg>
            <div className='mt-1 flex flex-wrap gap-3 text-[11px] text-muted'>
                {series.map((s) => (
                    <span key={s.key} className='flex items-center gap-1'>
                        <span className='h-0.5 w-3' style={{ background: s.color }} /> {s.label}
                    </span>
                ))}
            </div>
        </div>
    );
}

function Score({ score, rating }: { score: number; rating: string }) {
    const color = rating === 'good' ? '#34d399' : rating === 'fair' ? '#fbbf24' : '#f87171';
    const c = 2 * Math.PI * 26;
    return (
        <svg width={68} height={68} viewBox='0 0 68 68' role='img' aria-label={`Audit score ${score} of 100, ${rating}`}>
            <circle cx={34} cy={34} r={26} fill='none' stroke='#334155' strokeWidth={7} />
            <circle cx={34} cy={34} r={26} fill='none' stroke={color} strokeWidth={7} strokeDasharray={`${(score / 100) * c} ${c}`} strokeLinecap='round' transform='rotate(-90 34 34)' />
            <text x={34} y={39} textAnchor='middle' fontSize={16} fontWeight={700} fill='#e2e8f0'>
                {score}
            </text>
        </svg>
    );
}

function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'risk' | 'opportunity' }) {
    return (
        <div className={`min-w-0 rounded-xl border p-2.5 ${tone === 'risk' ? 'border-red-500/40' : tone === 'opportunity' ? 'border-emerald-500/40' : 'border-line'} bg-panel`}>
            <p className='text-[11px] text-muted'>{label}</p>
            <p className='truncate text-sm font-semibold text-ink'>{value}</p>
            {note && <p className='text-[11px] leading-snug text-muted'>{note}</p>}
        </div>
    );
}

function pdf(d: AuditData, materialName: string, warehouseName: string) {
    const r = d.report;
    const h = r.holding;
    return downloadReportPdf({
        title: `Material audit ${d.context.materialNumber}`,
        subtitle: `${materialName} · ${warehouseName} · ${fmtDate(d.at)} · score ${r.score}/100 (${r.rating})`,
        fileName: `material-audit-${d.context.materialNumber}-${d.at.slice(0, 10)}`,
        sections: [
            {
                heading: 'Summary',
                facts: [
                    ['Strategy', d.context.strategy || 'Not set'],
                    ['Criticality cell', d.context.cell || 'Not assessed'],
                    ['Levels', d.context.levelSource === 'forecast' ? 'From the forecast' : 'Manual'],
                    ['Forecast method', d.context.method],
                    ['Demand trend', d.context.trend],
                    ['Lead time (days)', fmt(d.context.leadDays, 1)],
                    ['Findings', `${r.counts.high} high, ${r.counts.medium} medium, ${r.counts.low} low`],
                ],
            },
            {
                heading: 'Not done',
                table: {
                    head: ['Item', 'Done'],
                    body: [
                        ['Criticality assessment (current)', r.done.criticality ? 'Yes' : 'No'],
                        ['Forecast levels applied', r.done.forecast ? 'Yes' : 'No'],
                        ['Lead time known', r.done.leadTime ? 'Yes' : 'No'],
                        ['Strategy in line with the analysis', r.done.strategyAligned ? 'Yes' : 'No'],
                        ['Levels in line with the forecast', r.done.levelsAligned ? 'Yes' : 'No'],
                    ],
                },
            },
            { heading: 'Findings', table: { head: ['Severity', 'Area', 'Finding', 'Action'], body: r.findings.map((x) => [SEV_LABEL[x.severity], AREA_LABEL[x.area], `${x.title}: ${x.detail}`, x.action]) } },
            {
                heading: 'Risk and opportunity in stock holding',
                facts: [
                    ['Stock (physical)', `${fmt(h.physical)} · value ${money(h.stockValue)}`],
                    ['Cover', h.coverageMonths === null ? 'No demand' : `${fmt(h.coverageMonths, 1)} months`],
                    ['Opportunity: excess', `${fmt(h.excessQty)} · value ${money(h.excessValue)}${h.excessBasis ? ` (${h.excessBasis})` : ''}`],
                    ['Risk: shortfall', `${fmt(h.shortfallQty)} · value ${money(h.riskValue)}`],
                    ['Holding cost a year', money(h.holdingCostYear)],
                    ['Saving a year if the excess is released', money(h.opportunityYear)],
                ],
            },
            { heading: 'Levels', table: { head: ['Level', 'Current', 'Recommended', 'Deviation'], body: r.deviations.map((x) => [LEVEL_LABEL[x.field], fmt(x.current), fmt(x.recommended), x.pct === null ? '—' : `${x.pct}%`]) } },
            {
                heading: 'Stock count adjustments (12 months)',
                facts: [
                    ['Adjustments', `${r.adjustments.count} (${r.adjustments.gains} gains, ${r.adjustments.losses} losses)`],
                    ['Net', `${fmt(r.adjustments.netQty)} · value ${money(r.adjustments.netValue)}`],
                    ['Gross', `${fmt(r.adjustments.grossQty)} · value ${money(r.adjustments.grossValue)}`],
                    ['Against usage', r.adjustments.pctOfIssues === null ? '—' : `${r.adjustments.pctOfIssues}% of issues`],
                ],
            },
            {
                heading: 'Accepted level changes',
                table: {
                    head: ['Date', 'Source', 'Min / Max', 'Average stock value change', 'Holding cost a year'],
                    body: d.levelChanges.map((c) => [c.at.slice(0, 10), `${c.source}${c.simulated ? ' (simulated)' : ''}`, `${fmt(c.before.minimumLevel)}/${fmt(c.before.maximumLevel)} → ${fmt(c.after.minimumLevel)}/${fmt(c.after.maximumLevel)}`, money(c.impact.averageValueChange), money(c.impact.holdingCostChangeYear)]),
                },
            },
            { heading: 'Trend', table: { head: ['Day', 'Score', 'Excess value', 'Risk value'], body: d.trend.map((t) => [t.day, String(t.score), money(t.excessValue), money(t.riskValue)]) } },
        ],
    });
}

export default function MaterialAudit({ materialId, warehouseId, materialName, warehouseName, onOpen }: { materialId: string; warehouseId: string; materialName: string; warehouseName: string; onOpen: (tab: Tab) => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<AuditData>(API + 'run', { materialId, warehouseId }), [materialId, warehouseId]);
    if (!data && loading)
        return (
            <div className='space-y-2'>
                <Spinner />
                <p className='text-center text-xs text-muted'>Auditing: working the forecast out and checking levels, strategy, counts and stock…</p>
            </div>
        );
    if (!data) return <Alert tone='error'>{error || 'The audit could not be run.'}</Alert>;
    const r = data.report;
    const h = r.holding;
    const done: Array<[string, boolean, Tab]> = [
        ['Criticality assessment', r.done.criticality, 'Criticality Analysis'],
        ['Forecast levels applied', r.done.forecast, 'Forecasting'],
        ['Lead time known', r.done.leadTime, 'Inventory Information'],
        ['Strategy in line', r.done.strategyAligned, 'Stock Control'],
        ['Levels in line', r.done.levelsAligned, 'Forecasting'],
    ];
    return (
        <div className='space-y-3'>
            <div className='sticky top-0 z-10 grid grid-cols-2 gap-2 bg-page py-2'>
                <Button variant='secondary' busy={loading} onClick={reload}>
                    <RefreshCw className='h-4 w-4' /> Run again
                </Button>
                <Button onClick={() => void pdf(data, materialName, warehouseName)}>
                    <Download className='h-4 w-4' /> Report PDF
                </Button>
            </div>

            <Card className='flex items-center gap-3'>
                <Score score={r.score} rating={r.rating} />
                <div className='min-w-0 flex-1'>
                    <p className='text-sm font-semibold text-ink'>Audit score · {r.rating === 'good' ? 'Good' : r.rating === 'fair' ? 'Fair' : 'Poor'}</p>
                    <p className='text-xs text-muted'>
                        {r.counts.high} high · {r.counts.medium} medium · {r.counts.low} low · saved {fmtDate(data.at)}
                    </p>
                    <p className='text-[11px] text-muted'>
                        Forecast {data.context.method} ({data.context.trend}) · lead time {fmt(data.context.leadDays, 1)} days · tolerance ±{data.context.tolerancePct}%
                    </p>
                </div>
            </Card>

            <Card className='space-y-1.5'>
                <p className='text-sm font-semibold text-ink'>What has been done</p>
                {done.map(([label, ok, tab]) => (
                    <button key={label} type='button' onClick={() => !ok && onOpen(tab)} className='flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg border border-line px-2 text-left text-sm'>
                        <span className='flex items-center gap-2 text-soft'>
                            {ok ? <CheckCircle2 className='h-4 w-4 text-emerald-400' /> : <XCircle className='h-4 w-4 text-red-400' />}
                            {label}
                        </span>
                        {!ok && <span className='text-xs text-brandsoft'>Open {tab}</span>}
                    </button>
                ))}
            </Card>

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Risk and opportunity in stock holding</p>
                <div className='grid grid-cols-2 gap-2'>
                    <Tile label='Stock value' value={money(h.stockValue)} note={`${fmt(h.physical)} at ${money(h.unitCost)}`} />
                    <Tile label='Cover' value={h.coverageMonths === null ? 'No demand' : `${fmt(h.coverageMonths, 1)} months`} note={`Demand ${fmt(h.demandPerMonth)} a month`} />
                    <Tile tone='opportunity' label='Opportunity: excess' value={money(h.excessValue)} note={h.excessQty ? `${fmt(h.excessQty)} ${h.excessBasis}` : 'No excess'} />
                    <Tile tone='risk' label='Risk: stock-out exposure' value={money(h.riskValue)} note={h.shortfallQty ? `${fmt(h.shortfallQty)} short of the reorder point` : 'Covered'} />
                    <Tile label='Holding cost a year' value={money(h.holdingCostYear)} />
                    <Tile tone='opportunity' label='Saving a year' value={money(h.opportunityYear)} note='If the excess is released' />
                </div>
            </Card>

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Findings ({r.findings.length})</p>
                {r.findings.length === 0 && <p className='text-sm text-muted'>Nothing to report.</p>}
                {r.findings.map((x: Finding) => (
                    <div key={x.code} className='space-y-1 rounded-xl border border-line p-2.5'>
                        <div className='flex items-center justify-between gap-2'>
                            <p className='flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink'>
                                {x.severity === 'high' && <AlertTriangle className='h-4 w-4 shrink-0 text-red-400' />}
                                <span className='truncate'>{x.title}</span>
                            </p>
                            <Badge tone={SEV_TONE[x.severity]}>{SEV_LABEL[x.severity]}</Badge>
                        </div>
                        <p className='text-xs text-soft'>{x.detail}</p>
                        <button type='button' className='text-left text-xs text-brandsoft' onClick={() => onOpen(AREA_TAB[x.area] ?? 'Forecasting')}>
                            {AREA_LABEL[x.area]} · {x.action}
                        </button>
                    </div>
                ))}
            </Card>

            {r.deviations.length > 0 && (
                <Card className='space-y-2'>
                    <p className='text-sm font-semibold text-ink'>Levels against the forecast</p>
                    <table className='w-full text-sm'>
                        <thead className='text-xs text-muted'>
                            <tr>
                                <th className='py-1 text-left font-normal'>Level</th>
                                <th className='text-right font-normal'>Current</th>
                                <th className='text-right font-normal'>Forecast</th>
                                <th className='text-right font-normal'>Off</th>
                            </tr>
                        </thead>
                        <tbody>
                            {r.deviations.map((x) => (
                                <tr key={x.field} className='border-t border-line'>
                                    <td className='py-1.5 text-soft'>{LEVEL_LABEL[x.field]}</td>
                                    <td className='text-right text-soft'>{fmt(x.current)}</td>
                                    <td className='text-right text-ink'>{fmt(x.recommended)}</td>
                                    <td className={`text-right ${x.pct !== null && Math.abs(x.pct) > data.context.tolerancePct ? 'text-amber-300' : 'text-muted'}`}>{x.pct === null ? '—' : `${x.pct > 0 ? '+' : ''}${x.pct}%`}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Stock count adjustments (12 months)</p>
                <div className='grid grid-cols-2 gap-2'>
                    <Tile label='Adjustments' value={r.adjustments.count} note={`${r.adjustments.gains} gains · ${r.adjustments.losses} losses`} />
                    <Tile label='Net' value={fmt(r.adjustments.netQty)} note={`Value ${money(r.adjustments.netValue)}`} />
                    <Tile label='Gross' value={fmt(r.adjustments.grossQty)} note={`Value ${money(r.adjustments.grossValue)}`} />
                    <Tile label='Against usage' value={r.adjustments.pctOfIssues === null ? '—' : `${r.adjustments.pctOfIssues}%`} note={`Largest ${fmt(r.adjustments.largest)}`} />
                </div>
            </Card>

            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Accepted level changes and their impact</p>
                {data.levelChanges.length === 0 && <p className='text-sm text-muted'>No level changes recorded yet.</p>}
                {data.levelChanges.map((c) => (
                    <div key={c.id} className='space-y-1 rounded-xl border border-line p-2.5 text-xs'>
                        <div className='flex items-center justify-between gap-2'>
                            <span className='text-soft'>{fmtDate(c.at)}</span>
                            <span className='flex gap-1'>
                                <Badge tone={c.source === 'forecast' ? 'brand' : 'muted'}>{c.source === 'forecast' ? 'Forecast' : 'Manual'}</Badge>
                                {c.simulated && <Badge tone='warn'>Simulated</Badge>}
                            </span>
                        </div>
                        <p className='text-ink'>
                            Min {fmt(c.before.minimumLevel)} → {fmt(c.after.minimumLevel)} · Max {fmt(c.before.maximumLevel)} → {fmt(c.after.maximumLevel)} · ROQ {fmt(c.before.reorderQuantity)} → {fmt(c.after.reorderQuantity)}
                        </p>
                        <p className='text-muted'>
                            Average stock {fmt(c.impact.averageStockBefore)} → {fmt(c.impact.averageStockAfter)} ({c.impact.direction}) · value {c.impact.averageValueChange >= 0 ? '+' : ''}
                            {money(c.impact.averageValueChange)} · holding cost {c.impact.holdingCostChangeYear >= 0 ? '+' : ''}
                            {money(c.impact.holdingCostChangeYear)} a year · max value {money(c.impact.maxValueBefore)} → {money(c.impact.maxValueAfter)}
                        </p>
                        {(c.impact.excessNowQty > 0 || c.impact.orderNowQty > 0) && (
                            <p className={c.impact.excessNowQty > 0 ? 'text-emerald-300' : 'text-amber-300'}>
                                {c.impact.excessNowQty > 0 ? `At the change ${fmt(c.impact.excessNowQty)} was above the new maximum (${money(c.impact.excessNowValue)})` : `At the change an order of ${fmt(c.impact.orderNowQty)} was due (${money(c.impact.orderNowValue)})`}
                            </p>
                        )}
                    </div>
                ))}
            </Card>

            <Card className='space-y-3'>
                <p className='text-sm font-semibold text-ink'>Trend</p>
                <TrendChart rows={data.trend as unknown as Array<Record<string, number | string>>} series={[{ key: 'score', label: 'Audit score', color: '#a78bfa', max: 100 }]} />
                <TrendChart rows={data.trend as unknown as Array<Record<string, number | string>>} series={[{ key: 'excessValue', label: 'Excess (opportunity)', color: '#34d399' }, { key: 'riskValue', label: 'Stock-out exposure (risk)', color: '#f87171' }]} />
            </Card>
        </div>
    );
}

// ----- Register (Inventory › Setup › Material audits) -----

interface RegisterRow {
    id: string;
    materialId: string;
    warehouseId: string;
    materialNumber: string;
    description: string;
    warehouse: string;
    day: string;
    score: number;
    rating: string;
    high: number;
    medium: number;
    stockValue: number;
    excessValue: number;
    riskValue: number;
    criticality: boolean;
    forecast: boolean;
    strategyAligned: boolean;
    levelsAligned: boolean;
    cell: string;
    strategy: string;
}

export function AuditRegister() {
    const { data, error, loading } = useLoad(() => callBackend<{ rows: RegisterRow[]; trend: Array<{ day: string; excessValue: number; riskValue: number; score: number; materials: number }>; levelChanges: { count: number; averageValueChange: number } }>(API + 'register', {}), []);
    if (!data && loading) return <Spinner />;
    if (!data) return <Alert tone='error'>{error || 'The audit register could not be loaded.'}</Alert>;
    const yn = (v: boolean) => (v ? 'Yes' : 'No');
    const columns: Array<Column<RegisterRow>> = [
        { key: 'material', label: 'Material', value: (r) => r.materialNumber, render: (r) => <span className='font-mono text-xs font-semibold text-brandsoft'>{r.materialNumber}</span> },
        { key: 'score', label: 'Score', type: 'number', value: (r) => r.score, render: (r) => <Badge tone={r.rating === 'good' ? 'brand' : r.rating === 'fair' ? 'warn' : 'danger'}>{r.score}</Badge> },
        { key: 'high', label: 'High', type: 'number', value: (r) => r.high },
        { key: 'excess', label: 'Excess value', type: 'number', value: (r) => r.excessValue },
        { key: 'risk', label: 'Risk value', type: 'number', value: (r) => r.riskValue },
        { key: 'description', label: 'Description', value: (r) => r.description, hidden: true },
        { key: 'warehouse', label: 'Warehouse', value: (r) => r.warehouse },
        { key: 'stock', label: 'Stock value', type: 'number', value: (r) => r.stockValue, hidden: true },
        { key: 'criticality', label: 'Criticality done', value: (r) => yn(r.criticality) },
        { key: 'forecast', label: 'Forecast done', value: (r) => yn(r.forecast) },
        { key: 'strategy', label: 'Strategy in line', value: (r) => yn(r.strategyAligned) },
        { key: 'levels', label: 'Levels in line', value: (r) => yn(r.levelsAligned) },
        { key: 'cell', label: 'Cell', value: (r) => r.cell, hidden: true },
        { key: 'strategyCode', label: 'Strategy', value: (r) => r.strategy, hidden: true },
        { key: 'day', label: 'Audited', type: 'date', value: (r) => r.day },
    ];
    const total = (k: 'excessValue' | 'riskValue' | 'stockValue') => data.rows.reduce((s, r) => s + r[k], 0);
    return (
        <div className='space-y-3'>
            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Stock holding across audited materials</p>
                <div className='grid grid-cols-2 gap-2'>
                    <Tile label='Materials audited' value={data.rows.length} note={`${data.rows.filter((r) => r.rating === 'poor').length} poor`} />
                    <Tile label='Stock value' value={money(total('stockValue'))} />
                    <Tile tone='opportunity' label='Excess (opportunity)' value={money(total('excessValue'))} />
                    <Tile tone='risk' label='Stock-out exposure (risk)' value={money(total('riskValue'))} />
                    <Tile label='Level changes logged' value={data.levelChanges.count} note={`Average stock value ${data.levelChanges.averageValueChange >= 0 ? '+' : ''}${money(data.levelChanges.averageValueChange)}`} />
                </div>
                <TrendChart rows={data.trend as unknown as Array<Record<string, number | string>>} series={[{ key: 'excessValue', label: 'Excess (opportunity)', color: '#34d399' }, { key: 'riskValue', label: 'Stock-out exposure (risk)', color: '#f87171' }]} />
                <TrendChart rows={data.trend as unknown as Array<Record<string, number | string>>} series={[{ key: 'score', label: 'Average audit score', color: '#a78bfa', max: 100 }]} />
            </Card>
            <RichTable id='inv.audit.register' title='Material audits' fileName='Material_audits' columns={columns} rows={data.rows} rowKey={(r) => r.id} empty='No audits yet. Open a material and its Audit tab.' height='h-[calc(100dvh-26rem)]' />
        </div>
    );
}

// ----- Change control (Inventory › Setup › Change control) -----

type Area = 'stockControl' | 'replenishment' | 'procurement';
interface ControlData {
    control: { manual: Record<Area, boolean>; tolerancePct: number };
    version: number;
    updatedAt: string;
    reason: string;
    canEdit: boolean;
}

export function ChangeControlForm() {
    const { data, error, loading, reload } = useLoad(() => callBackend<ControlData>('/api/org/inventory/controls/get', {}), []);
    const confirm = useConfirm();
    const [form, setForm] = useState<{ manual: Record<Area, boolean>; tolerance: string } | null>(null);
    const [notice, setNotice] = useState('');
    useEffect(() => {
        if (data) setForm({ manual: { ...data.control.manual }, tolerance: String(data.control.tolerancePct) });
    }, [data]);
    if (!data && loading) return <Spinner />;
    if (!data || !form) return <Alert tone='error'>{error || 'Change control could not be loaded.'}</Alert>;
    const tol = Number(form.tolerance);
    const problem = !(Number.isFinite(tol) && tol >= 1 && tol <= 200) ? 'Tolerance must be 1 to 200%.' : '';
    const changed = JSON.stringify(form.manual) !== JSON.stringify(data.control.manual) || tol !== data.control.tolerancePct;
    const areas: Array<[Area, string, string]> = [
        ['stockControl', 'Stock Control', 'Strategy, ownership, supply arrangement and the other stock dimensions.'],
        ['replenishment', 'Replenishment', 'The parameters of the replenishment strategy.'],
        ['procurement', 'Procurement Information', 'Supplier, prices, order quantities and terms.'],
    ];
    const save = () =>
        confirm.ask(
            {
                title: 'Save change control?',
                message: `Manual changes: ${areas.map(([k, l]) => `${l} ${form.manual[k] ? 'allowed' : 'off'}`).join(', ')}. Audit tolerance ±${tol}%.`,
                confirmLabel: 'Save',
                reason: { label: 'Reason for the change', minLength: 10 },
            },
            async (reason) => {
                const r = await callBackend<{ version: number }>('/api/org/inventory/controls/save', { control: { manual: form.manual, tolerancePct: tol }, reason, version: data.version });
                setNotice(`Change control version ${r.version} saved.`);
                reload();
            }
        );
    return (
        <div className='space-y-3'>
            {confirm.sheet}
            {data.canEdit && (
                <div className='sticky top-0 z-10 bg-page pb-2'>
                    <Button disabled={!changed || !!problem} onClick={save}>
                        <Save className='h-4 w-4' /> Save change control
                    </Button>
                </div>
            )}
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='warn'>{problem}</Alert>}
            {!data.canEdit && <Alert tone='info'>Read only: changing this needs the Inventory Change Control Administrator role.</Alert>}
            <p className='text-xs text-muted'>
                Version {data.version}
                {data.updatedAt ? ` · ${fmtDate(data.updatedAt)}` : ' · defaults (not saved yet)'}
                {data.reason ? ` · ${data.reason}` : ''}
            </p>
            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Manual changes on the material screen</p>
                {areas.map(([k, label, note]) => (
                    <label key={k} className='flex min-h-[52px] items-center gap-3 rounded-xl border border-line px-2 py-1.5'>
                        <Toggle checked={form.manual[k]} onChange={(v) => data.canEdit && setForm({ ...form, manual: { ...form.manual, [k]: v } })} label={`Allow manual changes to ${label}`} />
                        <span className='min-w-0'>
                            <span className='block text-sm text-ink'>{label}</span>
                            <span className='block text-[11px] text-muted'>{note}</span>
                        </span>
                    </label>
                ))}
                <p className='text-xs text-muted'>When off, the tab shows Locked and the server refuses changes. Minimum, maximum and reorder levels follow the forecasting setup; the criticality class and an on-demand strategy follow the criticality analysis.</p>
            </Card>
            <Card className='space-y-2'>
                <p className='text-sm font-semibold text-ink'>Audit</p>
                <Field id='cc-tolerance' label='Tolerance for levels against the forecast (%)' inputMode='decimal' maxLength={5} disabled={!data.canEdit} value={form.tolerance} onChange={(e) => setForm({ ...form, tolerance: e.target.value })} hint='Minimum or maximum further off than this is reported' />
            </Card>
        </div>
    );
}
