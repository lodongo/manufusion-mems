import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { Segmented } from '../components/screen';
import { Ring, scoreColor } from './srmVisuals';
import Scorecard, { BAND_WORD, bandColor, type Band, type ScorecardData } from './AgreementScorecard';
import { VerdictChip, fmtDay, rowTint } from './VendorOrders';

// A supplier's purchase agreements, reviewed: how old each is and what it says, what was bought on it, what it saved,
// how quickly the supplier delivered, and the time saved by not asking for a quote each time, as a scorecard of what was
// intended against what actually happened.

const API = '/api/org/procurement/vendors';
const PA_BASE = 'organization_home/procurement_agreements';
const PO_BASE = 'organization_home/procurement_orders';
type Verdict = 'on_time' | 'late' | 'overdue' | 'pending' | 'untimed';

interface Purchase {
    key: string; orderId: string; orderNumber: string; no: number; item: string; orderDate: string; quantity: number; received: number; currency: string;
    netUnitPrice: number; agreedUnitPrice: number | null; aboveAgreed: boolean; promiseOn: string; deliveredOn: string; verdict: Verdict; verdictLabel: string;
    daysLate: number; quotedLeadDays: number; actualLeadDays: number | null; value: number;
}
interface Agreement {
    id: string; number: string; title: string; status: string; statusLabel: string; startDate: string; endDate: string; currency: string; items: number;
    ownerName: string; quoteReference: string; createdAt: string; activatedAt: string; approvedAt: string; approvedAmount: number; orgCurrency: string;
    ageDays: number; runningDays: number; totalDays: number; daysRemaining: number; timeUsedPct: number; active: boolean;
    figures: { orders: number; orderedValue: number; expectedValue: number; utilisationPct: number; savings: number; potentialSavings: number; materialsPurchased: number; priceBreaches: number; itemsApplied: number; itemsOverridden: number };
    scorecard: ScorecardData;
    tat: { avgWaitDays: number | null; samples: number; orders: number; daysSaved: number | null; ownRfqDays: number | null; netDays: number | null };
    purchases: Purchase[]; purchasesTruncated: boolean;
}
interface Out {
    allowed: boolean; currency: string;
    summary?: { agreements: number; active: number; scheduled: number; ended: number; notStarted: number; orders: number; purchases: number; savings: number; potentialSavings: number; avgScore: number | null; band: Band; avgQuoteWaitDays: number | null; quoteSamples: number; daysSaved: number };
    thresholds?: { good: number; watch: number };
    agreements?: Agreement[];
}

const num = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }));
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (s === 'active' ? 'brand' : s === 'scheduled' ? 'warn' : s === 'terminated' ? 'danger' : 'muted');

/** "5 days", "3 months", "1 year 4 months": how long ago something started. */
export function ageText(days: number): string {
    if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.floor(days / 30.4375);
    if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
    const years = Math.floor(months / 12);
    const rest = months - years * 12;
    return `${years} year${years === 1 ? '' : 's'}${rest ? ` ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
}

function Tile({ label, value, hint, color }: { label: string; value: ReactNode; hint?: ReactNode; color?: string }) {
    return (
        <div className='min-w-0 rounded-xl border border-line bg-panel p-3'>
            <p className='text-xs text-muted'>{label}</p>
            <p className='mt-1 truncate text-lg font-semibold text-ink' style={color ? { color } : undefined}>{value}</p>
            {hint && <p className='mt-0.5 text-xs text-muted'>{hint}</p>}
        </div>
    );
}
function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
    return (
        <dl className='divide-y divide-line rounded-xl border border-line bg-panel text-sm'>
            {rows.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => (
                <div key={k} className='flex items-start justify-between gap-3 px-3 py-2'>
                    <dt className='shrink-0 text-muted'>{k}</dt>
                    <dd className='min-w-0 break-words text-right font-medium text-ink'>{v}</dd>
                </div>
            ))}
        </dl>
    );
}

function Tat({ a }: { a: Agreement }) {
    const t = a.tat;
    return (
        <section className='rounded-xl border border-line bg-panel p-3' aria-label='Quote turnaround'>
            <h3 className='text-sm font-semibold text-ink'>Quote turnaround</h3>
            <p className='mt-1 text-xs text-muted'>An order bought on the agreement needs no request for a quote: the price is already agreed. Each one saves the time this supplier usually takes to quote.</p>
            <div className='mt-2 grid grid-cols-2 gap-2'>
                <Tile label='Average wait for a quote' value={t.avgWaitDays === null ? '—' : `${num(t.avgWaitDays, 1)} d`} hint={t.samples ? `${t.samples} request(s) in the last 12 months` : 'No quote turnaround on record for the last 12 months'} />
                <Tile label='Waiting avoided' value={t.daysSaved === null ? '—' : `${num(t.daysSaved, 1)} d`} hint={`${t.orders} order(s) without a quote`} color={t.daysSaved ? scoreColor(100) : undefined} />
                <Tile label='Agreement RFQ took' value={t.ownRfqDays === null ? '—' : `${num(t.ownRfqDays, 1)} d`} hint='One-off cost of agreeing the prices' />
                <Tile label='Net days saved' value={t.netDays === null ? '—' : `${num(t.netDays, 1)} d`} hint='Waiting avoided less the RFQ' color={t.netDays === null ? undefined : scoreColor(t.netDays >= 0 ? 100 : 5)} />
            </div>
        </section>
    );
}

export function VendorAgreements({ vendorId }: { vendorId: string }) {
    const { data, error, loading } = useLoad(() => callBackend<Out>(`${API}/agreements/dashboard`, { id: vendorId }), [vendorId]);
    const [pick, setPick] = useState('');
    const [section, setSection] = useState<'scorecard' | 'purchases' | 'details'>('scorecard');
    const list = data?.agreements ?? [];
    useEffect(() => {
        if (!pick && list.length) setPick((list.find((a) => a.active) ?? list[0]).id);
    }, [list, pick]);
    const a = list.find((x) => x.id === pick);
    const cur = data?.currency ?? '';

    const listColumns = useMemo<Array<Column<Agreement>>>(
        () => [
            { key: 'number', label: 'Agreement', value: (r) => r.number, render: (r) => <span className='font-mono text-xs font-semibold text-blue-300'>{r.number}</span> },
            { key: 'title', label: 'Title', value: (r) => r.title },
            { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
            { key: 'score', label: 'Score', type: 'number', value: (r) => r.scorecard.score ?? '', render: (r) => (r.scorecard.score === null ? '—' : <span className='font-semibold' style={{ color: bandColor(r.scorecard.band) }}>{num(r.scorecard.score, 0)}</span>) },
            { key: 'age', label: 'Age', type: 'number', value: (r) => r.ageDays, render: (r) => ageText(r.ageDays) },
            { key: 'start', label: 'Starts', type: 'date', value: (r) => r.startDate },
            { key: 'end', label: 'Ends', type: 'date', value: (r) => r.endDate },
            { key: 'left', label: 'Days left', type: 'number', value: (r) => r.daysRemaining },
            { key: 'orders', label: 'Orders', type: 'number', value: (r) => r.figures.orders },
            { key: 'spend', label: 'Purchased', type: 'number', value: (r) => r.figures.orderedValue, render: (r) => `${r.currency} ${num(r.figures.orderedValue)}` },
            { key: 'sav', label: 'Savings', type: 'number', value: (r) => r.figures.savings, render: (r) => `${r.currency} ${num(r.figures.savings)}` },
            { key: 'util', label: 'Utilisation %', type: 'number', value: (r) => r.figures.utilisationPct, hidden: true },
            { key: 'items', label: 'Materials', type: 'number', value: (r) => r.items, hidden: true },
            { key: 'owner', label: 'Owner', value: (r) => r.ownerName, hidden: true },
        ],
        [],
    );
    const purchaseColumns = useMemo<Array<Column<Purchase>>>(
        () => [
            { key: 'po', label: 'PO number', value: (r) => r.orderNumber, render: (r) => <span className='font-mono text-xs font-semibold'>{r.orderNumber}</span> },
            { key: 'no', label: 'Line', type: 'number', value: (r) => r.no },
            { key: 'item', label: 'Material', value: (r) => r.item },
            { key: 'verdict', label: 'Promise kept?', value: (r) => r.verdictLabel, render: (r) => <VerdictChip verdict={r.verdict} label={r.verdictLabel} days={r.daysLate} /> },
            { key: 'date', label: 'Order date', type: 'date', value: (r) => r.orderDate },
            { key: 'qty', label: 'Quantity', type: 'number', value: (r) => r.quantity },
            { key: 'rec', label: 'Received', type: 'number', value: (r) => r.received },
            { key: 'price', label: 'Paid price', type: 'number', value: (r) => r.netUnitPrice, render: (r) => `${r.currency} ${num(r.netUnitPrice, 2)}` },
            { key: 'agreed', label: 'Agreed price', type: 'number', value: (r) => r.agreedUnitPrice ?? '', render: (r) => (r.agreedUnitPrice === null ? '—' : <span className={r.aboveAgreed ? 'font-semibold text-red-400' : ''}>{`${r.currency} ${num(r.agreedUnitPrice, 2)}${r.aboveAgreed ? ' · above' : ''}`}</span>) },
            { key: 'promise', label: 'Promised by', type: 'date', value: (r) => r.promiseOn },
            { key: 'deliv', label: 'Delivered on', type: 'date', value: (r) => r.deliveredOn },
            { key: 'late', label: 'Days late', type: 'number', value: (r) => r.daysLate },
            { key: 'lead', label: 'Lead time (days)', type: 'number', value: (r) => r.actualLeadDays ?? '', render: (r) => (r.actualLeadDays === null ? '—' : `${r.actualLeadDays} of ${r.quotedLeadDays} promised`) },
            { key: 'value', label: 'Value', type: 'number', value: (r) => r.value, render: (r) => `${r.currency} ${num(r.value, 2)}`, hidden: true },
        ],
        [],
    );

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the purchase agreements.'}</Alert>;
    if (!data.allowed) return <Alert tone='info'>Purchase agreements are shown only to people who can view them.</Alert>;
    const s = data.summary!;

    return (
        <div className='space-y-3'>
            {list.length === 0 && (
                <Alert tone='info'>
                    This supplier has no purchase agreement that is scheduled, active or ended yet.{s.notStarted ? ` ${s.notStarted} more ${s.notStarted === 1 ? 'is' : 'are'} still being prepared or approved.` : ''} Agreements appear here, with their scorecard, as soon as they are activated.
                </Alert>
            )}
            {list.length > 0 && (
                <>
                    <div className='flex items-center gap-3 rounded-xl border border-line bg-panel p-3'>
                        <Ring pct={s.avgScore} label='Average' size={76} />
                        <div className='min-w-0'>
                            <p className='text-sm font-semibold text-ink'>Agreements with this supplier</p>
                            <p className='text-xs text-muted'>{s.active} active{s.scheduled ? `, ${s.scheduled} scheduled` : ''}, {s.ended} ended{s.notStarted ? `, ${s.notStarted} being prepared` : ''}</p>
                            <p className='mt-1 text-xs font-semibold' style={{ color: bandColor(s.band) }}>{s.avgScore === null ? 'Not scored yet' : BAND_WORD[s.band]}</p>
                        </div>
                    </div>
                    <div className='grid grid-cols-2 gap-2'>
                        <Tile label={`Bought on agreements (${cur})`} value={num(s.purchases)} hint={`${s.orders} order(s)`} />
                        <Tile label={`Savings against standard (${cur})`} value={num(s.savings)} hint={`Projected ${num(s.potentialSavings)}`} color={s.savings > 0 ? scoreColor(100) : undefined} />
                        <Tile label='Average wait for a quote' value={s.avgQuoteWaitDays === null ? '—' : `${num(s.avgQuoteWaitDays, 1)} d`} hint={s.quoteSamples ? `${s.quoteSamples} request(s), last 12 months` : 'None on record'} />
                        <Tile label='Quote waiting avoided' value={`${num(s.daysSaved, 1)} d`} hint='Across all agreements' color={s.daysSaved > 0 ? scoreColor(100) : undefined} />
                    </div>
                    <RichTable
                        id='prc.vendor.agreements'
                        title='Purchase agreements'
                        fileName={`vendor-${vendorId}-purchase-agreements`}
                        height='h-72'
                        columns={listColumns}
                        rows={list}
                        rowKey={(r) => r.id}
                        onRowClick={(r) => { setPick(r.id); setSection('scorecard'); }}
                        rowClassName={(r) => (r.id === pick ? 'bg-blue-500/10' : '')}
                        empty='No agreements.'
                    />
                    <p className='text-xs text-muted'>Tap an agreement to review it below.</p>
                </>
            )}
            {a && (
                <section className='space-y-3 rounded-2xl border border-blue-500/50 p-2' aria-label={`Review of ${a.number}`}>
                    <div className='flex items-start justify-between gap-2 px-1 pt-1'>
                        <div className='min-w-0'>
                            <p className='font-mono text-sm font-semibold text-blue-300'>{a.number}</p>
                            <p className='truncate text-sm text-ink'>{a.title}</p>
                            <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted'><Badge tone={tone(a.status)}>{a.statusLabel}</Badge><span>Age {ageText(a.ageDays)}</span></div>
                        </div>
                        <Button variant='secondary' onClick={() => navigate(`${PA_BASE}/${a.id}`)}><ExternalLink className='mr-1 h-4 w-4' />Open</Button>
                    </div>
                    <Segmented label='Agreement review' value={section} onChange={setSection} options={[{ value: 'scorecard', label: 'Scorecard' }, { value: 'purchases', label: 'Purchases', count: a.purchases.length }, { value: 'details', label: 'Key details' }]} />
                    {section === 'scorecard' && (
                        <div className='space-y-3'>
                            <div className='rounded-xl border border-line bg-panel p-3'>
                                <div className='flex items-center justify-between text-xs text-soft'>
                                    <span>{a.daysRemaining} day(s) left of {a.totalDays}</span>
                                    <span>{num(a.timeUsedPct, 1)}% of the time used</span>
                                </div>
                                <div className='mt-2 h-2 overflow-hidden rounded-full bg-line' role='progressbar' aria-valuenow={a.timeUsedPct} aria-valuemin={0} aria-valuemax={100} aria-label='Time used'>
                                    <div className='h-full bg-blue-500' style={{ width: `${Math.min(100, a.timeUsedPct)}%` }} />
                                </div>
                            </div>
                            <Scorecard card={a.scorecard} currency={a.currency} title='Intended against actual' />
                            <Tat a={a} />
                        </div>
                    )}
                    {section === 'purchases' && (
                        <div className='space-y-2'>
                            <div className='grid grid-cols-2 gap-2'>
                                <Tile label='Orders' value={a.figures.orders} hint={`${a.figures.materialsPurchased} of ${a.items} materials bought`} />
                                <Tile label={`Purchased (${a.currency})`} value={num(a.figures.orderedValue)} hint={`${num(a.figures.utilisationPct, 1)}% of ${num(a.figures.expectedValue)} expected`} />
                                <Tile label={`Savings (${a.currency})`} value={num(a.figures.savings)} hint={`Projected ${num(a.figures.potentialSavings)}`} color={a.figures.savings > 0 ? scoreColor(100) : undefined} />
                                <Tile label='Priced above agreed' value={a.figures.priceBreaches} hint='Order line(s)' color={a.figures.priceBreaches ? scoreColor(4) : undefined} />
                            </div>
                            {a.purchasesTruncated && <Alert tone='warn'>Only the latest {a.purchases.length} lines are listed. The figures above are complete.</Alert>}
                            <RichTable
                                id={`prc.vendor.agreement.purchases`}
                                title={`Purchases on ${a.number}`}
                                fileName={`${a.number}-purchases`}
                                height='h-[calc(100dvh-20rem)] min-h-80'
                                columns={purchaseColumns}
                                rows={a.purchases}
                                rowKey={(r) => r.key}
                                onRowClick={(r) => navigate(`${PO_BASE}/${r.orderId}`)}
                                rowClassName={(r) => rowTint(r.verdict)}
                                empty='Nothing has been bought on this agreement yet.'
                            />
                            <p className='text-xs text-muted'>Tap a line to open the purchase order.</p>
                        </div>
                    )}
                    {section === 'details' && (
                        <Facts
                            rows={[
                                ['Agreement', a.number],
                                ['Title', a.title],
                                ['Status', a.statusLabel],
                                ['Age', `${ageText(a.ageDays)}${a.activatedAt ? ` (activated ${fmtDay(a.activatedAt)})` : a.createdAt ? ` (created ${fmtDay(a.createdAt)})` : ''}`],
                                ['Period', `${fmtDay(a.startDate)} to ${fmtDay(a.endDate)}`],
                                ['Term', `${a.totalDays} days, ${a.daysRemaining} left`],
                                ['Materials', `${a.items} (${a.figures.itemsApplied} using the agreement${a.figures.itemsOverridden ? `, ${a.figures.itemsOverridden} overridden` : ''})`],
                                ['Currency', a.currency],
                                ['Approved value', a.approvedAmount ? `${a.orgCurrency} ${num(a.approvedAmount)}` : ''],
                                ["Supplier's quote reference", a.quoteReference],
                                ['Approved', a.approvedAt ? fmtDay(a.approvedAt) : ''],
                                ['Owner', a.ownerName],
                            ]}
                        />
                    )}
                </section>
            )}
        </div>
    );
}
