import { useMemo, useState } from 'react';
import { Check, CheckCheck, Play, RefreshCw, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Segmented, messageOf, useConfirm } from '../components/screen';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, useLoad } from '../admin/kit';

// Background forecasting results. Every forecast is a RECOMMENDATION until an approver accepts it, one by one or a whole
// group at a time. Groups: no change, increase min/max, reduce min/max, purchase on demand (PD, RP07 Direct purchase),
// and, separately, procurement strategy changes (to PD, back to stock). Increases that commit capital go on to the
// Chart of Authority; reductions are applied by the accepting approver. The server enforces every rule.

const API = '/api/org/inventory/forecast/';
type Group = 'increase' | 'decrease' | 'pd' | 'no_change' | 'to_pd' | 'to_stock';
interface Impact { onHandValue: number; plannedValueNow: number; plannedValueRecommended: number; plannedValueChange: number; excessQty: number; excessValue: number; deadStockValue: number; maxChangeValue: number }
export interface Recommendation {
    id: string; materialId: string; warehouseId: string; name: string; materialNumber: string; categoryCode: string;
    group: 'no_change' | 'increase' | 'decrease' | 'pd'; strategyGroup: 'none' | 'to_pd' | 'to_stock'; reasons: string[];
    current: Record<string, number | null>; values: Record<string, number>; currentStrategy: string; recommendedStrategy: string; strategyLocked: string;
    impact: Impact; onHand: number; unitCost: number; criticalityClass: string; criticalityCell: string;
    method: string; pattern: string; trend: string; accuracy: { mae: number | null; mase: number | null };
    demandPerMonth: number; serviceLevel: number; leadDays: number; externalLeadDays: number; internalLeadDays: number; leadBasis: string;
    historyMonths: number; sufficient: boolean; notes: string[]; evaluatedAt: string; trigger: string; runId: string; runBy: string;
    ageing: { lastIssueAt: string; monthsSinceIssue: number | null; issueMonthsLastYear: number; dead: boolean; slow: boolean };
}
interface Bucket { count: number; plannedValueChange: number; onHandValue: number; excessValue: number }
interface Summary {
    materials: number;
    stockCapital: { onHand: number; plannedNow: number; plannedRecommended: number; change: number };
    excess: { count: number; value: number }; deadStock: { count: number; value: number }; slowMoving: { count: number; value: number };
    pd: { count: number; onHandValue: number }; groups: Record<string, Bucket>; strategyGroups: Record<string, Bucket>; insufficientHistory: number;
}
interface Data { recommendations: Recommendation[]; summary: Summary; warehouses: Record<string, string>; canDecide: boolean }
interface Run { runId: string; status: string; total: number; done: number; failed: number }

const money = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const GROUP_LABEL: Record<Group, string> = { increase: 'Increase min / max', decrease: 'Reduce min / max', pd: 'Purchase on demand (PD)', no_change: 'No change', to_pd: 'Strategy → PD (RP07)', to_stock: 'Strategy → stock (RP01)' };
const inGroup = (r: Recommendation, g: Group) => (g === 'to_pd' || g === 'to_stock' ? r.strategyGroup === g : r.group === g);

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'brand' | 'warn' | 'danger' }) {
    const bar = tone === 'danger' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'brand' ? 'bg-brand' : 'bg-line';
    return (
        <div className='relative min-w-0 overflow-hidden rounded-xl border border-line bg-panel p-3'>
            <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
            <p className='truncate text-xs text-muted'>{label}</p>
            <p className='mt-1 truncate text-lg font-semibold tabular-nums text-ink'>{value}</p>
            {note && <p className='mt-0.5 line-clamp-2 text-xs text-soft'>{note}</p>}
        </div>
    );
}

/** Impact analysis of the open recommendations: stock capital, dead stock, excess and PD candidates. */
export function ImpactSummary({ s }: { s: Summary }) {
    return (
        <div className='grid grid-cols-2 gap-2 lg:grid-cols-4'>
            <Stat label='Stock capital on hand' value={money(s.stockCapital.onHand)} note={`${s.materials} materials evaluated`} />
            <Stat label='Planned stock capital' value={`${money(s.stockCapital.plannedNow)} → ${money(s.stockCapital.plannedRecommended)}`} note={`Change ${money(s.stockCapital.change)} (average of min and max at cost)`} tone={s.stockCapital.change > 0 ? 'warn' : 'brand'} />
            <Stat label='Dead stock' value={money(s.deadStock.value)} note={`${s.deadStock.count} material(s) with no issue for the dead-stock period`} tone={s.deadStock.count ? 'danger' : undefined} />
            <Stat label='Excess above recommended max' value={money(s.excess.value)} note={`${s.excess.count} material(s)`} tone={s.excess.count ? 'warn' : undefined} />
            <Stat label='Consider PD' value={String(s.pd.count)} note={`${money(s.pd.onHandValue)} held today`} tone={s.pd.count ? 'warn' : undefined} />
            <Stat label='Slow moving' value={money(s.slowMoving.value)} note={`${s.slowMoving.count} material(s) ageing`} />
            <Stat label='Increase / reduce' value={`${s.groups.increase?.count ?? 0} / ${s.groups.decrease?.count ?? 0}`} note={`${s.groups.no_change?.count ?? 0} need no change`} />
            <Stat label='Strategy changes' value={`${(s.strategyGroups.to_pd?.count ?? 0) + (s.strategyGroups.to_stock?.count ?? 0)}`} note={`${s.strategyGroups.to_pd?.count ?? 0} to PD · ${s.strategyGroups.to_stock?.count ?? 0} back to stock`} />
        </div>
    );
}

/** Mass forecasting evaluation of every activated material, with progress and the resulting impact analysis. */
export function MassEvaluation() {
    const [run, setRun] = useState<Run | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [summary, setSummary] = useState<Summary | null>(null);
    const confirm = useConfirm();
    const start = () =>
        confirm.ask(
            { title: 'Run mass forecasting evaluation?', message: 'Every activated material in the warehouses you manage is forecast from its own issue history, lead times, criticality and ageing. The results are recommendations only; nothing changes until an approver accepts them. You cannot accept the recommendations of a run you start.', confirmLabel: 'Run evaluation' },
            async () => {
                setBusy(true); setError(''); setSummary(null);
                try {
                    let r = await callBackend<Run>(API + 'evaluate', {});
                    setRun(r);
                    while (r.status !== 'complete') {
                        r = await callBackend<Run>(API + 'evaluate', { runId: r.runId });
                        setRun(r);
                    }
                    const d = await callBackend<Data>(API + 'recommendations', { runId: r.runId });
                    setSummary(d.summary);
                } catch (e) {
                    setError(messageOf(e));
                } finally {
                    setBusy(false);
                }
            }
        );
    const pct = run && run.total ? Math.round((run.done / run.total) * 100) : 0;
    return (
        <Card className='space-y-3'>
            {confirm.sheet}
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='min-w-0'>
                    <p className='text-sm font-semibold text-ink'>Mass forecasting evaluation</p>
                    <p className='text-xs text-muted'>Forecast every activated material now and see the impact on stock capital, dead stock and PD.</p>
                </div>
                <Button disabled={busy} busy={busy} onClick={start}><Play className='h-4 w-4' /> Run evaluation</Button>
            </div>
            {run && (
                <div aria-live='polite' className='space-y-1'>
                    <div className='h-2 overflow-hidden rounded-full bg-line'><div className='h-full bg-brand transition-all' style={{ width: `${pct}%` }} /></div>
                    <p className='text-xs text-soft'>{run.done} of {run.total} evaluated{run.failed ? `, ${run.failed} failed` : ''} · {run.status === 'complete' ? 'complete' : 'running'}</p>
                </div>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
            {summary && <>
                <ImpactSummary s={summary} />
                <p className='text-xs text-muted'>Review and accept the results on the Recommendations tab.</p>
            </>}
        </Card>
    );
}

/** Accept or reject recommendations; returns a short outcome text. */
async function decide(keys: string[], decision: 'accept' | 'reject', reason?: string) {
    const r = await callBackend<{ applied: number; routed: number; rejected: number; skipped: number; results: Array<{ key: string; outcome: string; detail: string }> }>(API + 'recommendations/decide', { keys, decision, reason, confirm: String(keys.length) });
    const firstSkip = r.results.find((x) => x.outcome === 'skipped');
    return [r.applied && `${r.applied} applied`, r.routed && `${r.routed} sent for Chart of Authority approval`, r.rejected && `${r.rejected} rejected`, r.skipped && `${r.skipped} skipped${firstSkip ? ` (${firstSkip.detail})` : ''}`].filter(Boolean).join(', ') + '.';
}

/** The full recommendations view: impact analysis, groups and mass or single decisions. */
export default function ForecastRecommendations() {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>(API + 'recommendations', {}), []);
    const [group, setGroup] = useState<Group>('increase');
    const [open, setOpen] = useState<Recommendation | null>(null);
    const [notice, setNotice] = useState('');
    const confirm = useConfirm();
    const rows = useMemo(() => (data?.recommendations ?? []).filter((r) => inGroup(r, group)), [data, group]);
    const wh = (id: string) => data?.warehouses[id] || id;
    const columns = useMemo<Column<Recommendation>[]>(() => [
        { key: 'number', label: 'Material', value: (r) => r.materialNumber, render: (r) => <span className='block min-w-[10rem] whitespace-normal'><span className='block font-mono text-xs font-semibold text-ink'>{r.materialNumber}</span><span className='block text-xs text-soft line-clamp-2'>{r.name}</span></span> },
        { key: 'warehouse', label: 'Warehouse', value: (r) => wh(r.warehouseId) },
        { key: 'class', label: 'Class', value: (r) => r.criticalityClass || '—' },
        { key: 'min', label: 'Min now → rec.', value: (r) => `${r.current.minimumLevel ?? 0} → ${r.values.minimumLevel}` },
        { key: 'max', label: 'Max now → rec.', value: (r) => `${r.current.maximumLevel ?? 0} → ${r.values.maximumLevel}` },
        { key: 'strategy', label: 'Strategy', value: (r) => (r.recommendedStrategy && r.recommendedStrategy !== r.currentStrategy ? `${r.currentStrategy || '—'} → ${r.recommendedStrategy}` : r.currentStrategy || '—') },
        { key: 'capital', label: 'Capital change', type: 'number', value: (r) => r.impact.plannedValueChange, render: (r) => <span className={r.impact.plannedValueChange > 0 ? 'text-amber-600' : 'text-brand'}>{money(r.impact.plannedValueChange)}</span> },
        { key: 'onhand', label: 'On hand value', type: 'number', value: (r) => r.impact.onHandValue, hidden: true },
        { key: 'excess', label: 'Excess value', type: 'number', value: (r) => r.impact.excessValue, hidden: true },
        { key: 'demand', label: 'Demand / month', type: 'number', value: (r) => r.demandPerMonth },
        { key: 'lead', label: 'Lead time (days)', type: 'number', value: (r) => r.leadDays },
        { key: 'since', label: 'Months since issue', type: 'number', value: (r) => r.ageing.monthsSinceIssue, hidden: true },
        { key: 'ageing', label: 'Ageing', value: (r) => (r.ageing.dead ? 'Dead stock' : r.ageing.slow ? 'Slow moving' : '') },
        { key: 'method', label: 'Method', value: (r) => r.method, hidden: true },
        { key: 'pattern', label: 'Pattern', value: (r) => r.pattern, hidden: true },
        { key: 'mase', label: 'MASE', type: 'number', value: (r) => r.accuracy?.mase ?? null, hidden: true },
        { key: 'why', label: 'Why', value: (r) => r.reasons.join(' '), hidden: true },
        { key: 'category', label: 'Category', value: (r) => r.categoryCode, hidden: true },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [data]);
    const groupDecision = (decision: 'accept' | 'reject') => {
        const keys = rows.map((r) => r.id);
        if (!keys.length) return;
        confirm.ask(
            {
                title: `${decision === 'accept' ? 'Accept' : 'Reject'} all in “${GROUP_LABEL[group]}”`,
                message: decision === 'accept'
                    ? `${keys.length} recommendation(s). Reductions, PD and no-change are applied now; increases and moves back to stock go to the Chart of Authority. Any that changed since the evaluation, or that you started yourself, are skipped.`
                    : `${keys.length} recommendation(s) are closed without change.`,
                confirmLabel: decision === 'accept' ? `Accept ${keys.length}` : `Reject ${keys.length}`,
                tone: decision === 'reject' ? 'danger' : 'primary',
                phrase: keys.length > 1 ? String(keys.length) : undefined,
                ...(decision === 'reject' ? { reason: { label: 'Reason', minLength: 10 } } : {}),
            },
            async (reason) => { setNotice(await decide(keys, decision, reason)); reload(); }
        );
    };
    if (loading && !data) return <Spinner />;
    if (!data) return <Alert tone='error'>{error || 'Recommendations could not be loaded.'}</Alert>;
    const groups: Group[] = ['increase', 'decrease', 'pd', 'no_change', 'to_pd', 'to_stock'];
    return (
        <div className='space-y-3'>
            {confirm.sheet}
            {notice && <Alert tone='success'>{notice}</Alert>}
            <ImpactSummary s={data.summary} />
            {data.summary.insufficientHistory > 0 && <p className='text-xs text-muted'>{data.summary.insufficientHistory} material(s) have less issue history than the setup minimum; treat their recommendations with care.</p>}
            <Segmented label='Recommendation groups' value={group} onChange={setGroup} options={groups.map((g) => ({ value: g, label: GROUP_LABEL[g], count: (data.recommendations ?? []).filter((r) => inGroup(r, g)).length }))} />
            {data.canDecide && rows.length > 0 && (
                <div className='grid grid-cols-2 gap-2 sm:flex'>
                    <Button onClick={() => groupDecision('accept')}><CheckCheck className='h-4 w-4' /> Accept all {rows.length}</Button>
                    <Button variant='secondary' onClick={() => groupDecision('reject')}><X className='h-4 w-4' /> Reject all</Button>
                </div>
            )}
            <RichTable id={'inv.forecast.recommendations.' + group} title={GROUP_LABEL[group]} fileName={'Forecast_recommendations_' + group} columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setOpen} height='h-[calc(100dvh-30rem)]' empty='Nothing in this group. Run a mass evaluation from Forecasting setup, or wait for the weekly run.' />
            {open && <RecommendationSheet r={open} warehouse={wh(open.warehouseId)} canDecide={data.canDecide} onClose={() => setOpen(null)} onDone={(t) => { setNotice(t); setOpen(null); reload(); }} />}
        </div>
    );
}

function RecommendationSheet({ r, warehouse, canDecide, onClose, onDone }: { r: Recommendation; warehouse: string; canDecide: boolean; onClose: () => void; onDone: (t: string) => void }) {
    return (
        <div role='dialog' aria-modal='true' aria-label={`Recommendation for ${r.materialNumber}`} className='fixed inset-0 z-50 flex items-end justify-center bg-[#000000]/50 sm:items-center' onClick={onClose}>
            <div className='max-h-[90dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-2xl bg-page p-4 sm:rounded-2xl' onClick={(e) => e.stopPropagation()}>
                <RecommendationCard r={r} warehouse={warehouse} canDecide={canDecide} onDone={onDone} />
                <Button variant='secondary' className='mt-3 w-full' onClick={onClose}>Close</Button>
            </div>
        </div>
    );
}

/** One recommendation with its reasons and the accept / reject decision (also used on the material's Forecasting tab). */
export function RecommendationCard({ r, warehouse, canDecide, onDone, onRefresh }: { r: Recommendation; warehouse?: string; canDecide: boolean; onDone: (t: string) => void; onRefresh?: () => void }) {
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);
    const rows: Array<[string, number | null, number]> = [
        ['Minimum', r.current.minimumLevel, r.values.minimumLevel],
        ['Maximum', r.current.maximumLevel, r.values.maximumLevel],
        ['Reorder quantity', r.current.reorderQuantity, r.values.reorderQuantity],
        ['Safety stock', r.current.safetyStock, r.values.safetyStock],
        ['Reorder point', r.current.reorderPoint, r.values.reorderPoint],
    ];
    const act = (decision: 'accept' | 'reject') =>
        confirm.ask(
            {
                title: decision === 'accept' ? 'Accept recommendation' : 'Reject recommendation',
                message: decision === 'accept' ? (r.group === 'increase' || r.strategyGroup === 'to_stock' ? 'This commits stock capital, so it goes to the Chart of Authority for approval.' : 'The levels and strategy are applied now.') : 'The recommendation is closed without change.',
                confirmLabel: decision === 'accept' ? 'Accept' : 'Reject',
                tone: decision === 'reject' ? 'danger' : 'primary',
                ...(decision === 'reject' ? { reason: { label: 'Reason', minLength: 10 } } : {}),
            },
            async (reason) => { setBusy(true); try { onDone(await decide([r.id], decision, reason)); } finally { setBusy(false); } }
        );
    const tone = r.group === 'increase' ? 'warn' : r.group === 'decrease' ? 'brand' : r.group === 'pd' ? 'danger' : 'muted';
    return (
        <Card className='space-y-3'>
            {confirm.sheet}
            <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                    <p className='text-xs text-muted'>Recommendation · {r.trigger === 'issue' ? 'after an issue' : r.trigger === 'weekly' ? 'weekly run' : 'evaluation'} · {new Date(r.evaluatedAt).toLocaleString()}</p>
                    <p className='font-mono text-sm font-semibold text-ink'>{r.materialNumber}{warehouse ? ` · ${warehouse}` : ''}</p>
                </div>
                <div className='flex flex-wrap gap-1'>
                    <Badge tone={tone}>{GROUP_LABEL[r.group]}</Badge>
                    {r.strategyGroup !== 'none' && <Badge tone='warn'>{GROUP_LABEL[r.strategyGroup]}</Badge>}
                </div>
            </div>
            <ul className='space-y-1 text-xs text-soft'>{r.reasons.map((x) => <li key={x}>• {x}</li>)}</ul>
            <table className='w-full text-sm'>
                <thead><tr className='text-xs text-muted'><th className='py-1 text-left font-normal'>Level</th><th className='text-right font-normal'>Now</th><th className='text-right font-normal'>Recommended</th></tr></thead>
                <tbody>{rows.map(([k, a, b]) => <tr key={k} className='border-t border-line'><td className='py-1.5 text-ink'>{k}</td><td className='text-right tabular-nums text-soft'>{a ?? '—'}</td><td className={`text-right font-semibold tabular-nums ${b !== (a ?? 0) ? 'text-ink' : 'text-muted'}`}>{b}</td></tr>)}</tbody>
            </table>
            <dl className='grid grid-cols-2 gap-2 text-xs'>
                {[['Demand', `${r.demandPerMonth}/month · ${r.pattern}`], ['Method', `${r.method}${r.accuracy?.mase != null ? ` · MASE ${r.accuracy.mase}` : ''}`], ['Lead time', `${r.externalLeadDays} + ${r.internalLeadDays} days`], ['Service level', `${r.serviceLevel}%${r.criticalityClass ? ` · class ${r.criticalityClass}` : ''}`], ['Capital change', money(r.impact.plannedValueChange)], ['Last issue', r.ageing.monthsSinceIssue == null ? 'Never' : `${r.ageing.monthsSinceIssue} months ago`]].map(([k, v]) => (
                    <div key={k} className='rounded-lg bg-page p-2'><dt className='text-muted'>{k}</dt><dd className='font-medium text-ink'>{v}</dd></div>
                ))}
            </dl>
            {r.notes.length > 0 && <p className='text-xs text-muted'>{r.notes.join(' ')}</p>}
            <div className='grid grid-cols-2 gap-2'>
                {canDecide && <Button disabled={busy} onClick={() => act('accept')}><Check className='h-4 w-4' /> Accept</Button>}
                {canDecide && <Button variant='secondary' disabled={busy} onClick={() => act('reject')}><X className='h-4 w-4' /> Reject</Button>}
                {onRefresh && <Button variant='secondary' disabled={busy} onClick={onRefresh} className='col-span-2'><RefreshCw className='h-4 w-4' /> Re-evaluate now</Button>}
            </div>
        </Card>
    );
}
