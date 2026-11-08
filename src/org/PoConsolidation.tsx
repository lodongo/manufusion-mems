// ---------------------------------------------------------------------------
// Purchase orders: opening an order with a specification, consolidating requisitions into it, the time left to
// consolidate, the consolidation window setting, and the trace pie chart of where the time went.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import { Segmented, useConfirm } from '../components/screen';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { API, PO_BASE, RQ_BASE, money, Section } from './PoExtras';

const KIND_LABEL: Record<string, string> = { material: 'Materials', service: 'Services', asset: 'Assets' };
interface Scope {
    kind: string;
    categoryCode: string;
    categoryName: string;
    subcategoryCode: string;
    subcategoryName: string;
}
const scopeId = (x: Pick<Scope, 'kind' | 'categoryCode' | 'subcategoryCode'>) => `${x.kind}|${x.categoryCode}|${x.subcategoryCode}`;
const scopeLabel = (x: Scope) => `${x.categoryName || x.categoryCode} › ${x.subcategoryName || 'all subcategories'}`;

// ----- New order with a specification -----

export function SpecOrderForm({ onClose }: { onClose: () => void }) {
    const { data, error, loading } = useLoad(() => callBackend<{ currency: string; vendors: Array<{ id: string; number: string; name: string; currency: string; scopes: Scope[] }> }>(`${API}/orders/spec-options`, {}), []);
    const confirm = useConfirm();
    const [vendorId, setVendorId] = useState('');
    const [kind, setKind] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [category, setCategory] = useState('');
    const [currency, setCurrency] = useState('');
    const [notes, setNotes] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the vendors.'}</Alert>;
    const vendor = data.vendors.find((v) => v.id === vendorId);
    const kinds = vendor ? Array.from(new Set(vendor.scopes.map((x) => x.kind))) : [];
    const k = kinds.includes(kind) ? kind : kinds[0] ?? '';
    const ofKind = vendor ? vendor.scopes.filter((x) => x.kind === k) : [];
    // An order holds one category: the category is chosen first, then its subcategories.
    const categories = Array.from(new Map(ofKind.map((x) => [x.categoryCode, x.categoryName || x.categoryCode])).entries());
    const cat = categories.some(([c]) => c === category) ? category : categories.length === 1 ? categories[0][0] : '';
    const options = ofKind.filter((x) => x.categoryCode === cat);
    const chosen = options.filter((x) => picked.has(scopeId(x)));
    const cur = (currency || vendor?.currency || data.currency).toUpperCase();
    const problems = [...(!vendor ? ['Choose the vendor.'] : []), ...(vendor && !cat ? ['Choose the one category this order holds.'] : []), ...(vendor && cat && !chosen.length ? ['Tick at least one subcategory.'] : []), ...(!/^[A-Z]{3}$/.test(cur) ? ['The currency is a 3-letter code.'] : [])];
    const create = () =>
        confirm.ask(
            {
                title: 'Open the order?',
                message: `${vendor!.name}, ${KIND_LABEL[k]}, ${cur}: ${chosen.map(scopeLabel).join('; ')}. Confirmed requisitions for this vendor in these categories can then be added to it.`,
                confirmLabel: 'Open order',
            },
            async () => {
                const out = await callBackend<{ id: string }>(`${API}/orders/create-spec`, { vendorId, poType: k, currency: cur, scopes: chosen.map(({ kind: kd, categoryCode, subcategoryCode }) => ({ kind: kd, categoryCode, subcategoryCode })), notes });
                navigate(`${PO_BASE}/${out.id}`);
            }
        );
    return (
        <Section title='New order with a specification'>
            <p className='text-xs text-muted'>Open an empty order for a vendor and the categories it should cover; requisitions that fit are added to it. Only approved vendors and the categories they are registered for (within your buyer groups) are offered.</p>
            {data.vendors.length === 0 ? (
                <Alert tone='warn'>No approved vendor is registered for categories you handle.</Alert>
            ) : (
                <>
                    <SelectField
                        id='spec-vendor'
                        label='Vendor *'
                        value={vendorId}
                        onChange={(e) => {
                            setVendorId(e.target.value);
                            setPicked(new Set());
                            setKind('');
                            setCategory('');
                            setCurrency('');
                        }}
                    >
                        <option value=''>Choose</option>
                        {data.vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                                {v.name} · {v.number}
                            </option>
                        ))}
                    </SelectField>
                    {vendor && kinds.length > 1 && (
                        <Segmented
                            label='Kind of purchase'
                            value={k}
                            options={kinds.map((x) => ({ value: x, label: KIND_LABEL[x] ?? x }))}
                            onChange={(v) => {
                                setKind(v);
                                setCategory('');
                                setPicked(new Set());
                            }}
                        />
                    )}
                    {vendor && categories.length > 0 && (
                        <div className='space-y-1'>
                            <p className='text-xs font-semibold text-muted'>{KIND_LABEL[k]}: category * (one per order)</p>
                            <div className='max-h-48 space-y-1 overflow-y-auto overscroll-contain'>
                                {categories.map(([code, name]) => (
                                    <label key={code} className='flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink'>
                                        <input
                                            type='radio'
                                            name='spec-category'
                                            className='h-5 w-5 accent-emerald-500'
                                            checked={cat === code}
                                            onChange={() => {
                                                setCategory(code);
                                                setPicked(new Set());
                                            }}
                                        />
                                        {name}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    {vendor && cat && (
                        <div className='space-y-1'>
                            <p className='text-xs font-semibold text-muted'>Subcategories *</p>
                            <div className='max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                                {options.map((x) => {
                                    const idk = scopeId(x);
                                    return (
                                        <label key={idk} className='flex min-h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm text-ink'>
                                            <input
                                                type='checkbox'
                                                className='h-5 w-5 accent-emerald-500'
                                                checked={picked.has(idk)}
                                                onChange={(e) => {
                                                    const n = new Set(picked);
                                                    if (e.target.checked) n.add(idk);
                                                    else n.delete(idk);
                                                    setPicked(n);
                                                }}
                                            />
                                            {scopeLabel(x)}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='spec-currency' label='Currency *' maxLength={3} value={currency || vendor?.currency || data.currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                    </div>
                    <Field id='spec-notes' label='Notes' maxLength={400} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    {problems.length > 0 && vendorId && <p className='text-xs text-amber-300'>{problems[0]}</p>}
                    <div className='grid grid-cols-2 gap-2'>
                        <Button variant='secondary' onClick={onClose}>
                            Cancel
                        </Button>
                        <Button disabled={problems.length > 0} onClick={create}>
                            Open order
                        </Button>
                    </div>
                </>
            )}
            {confirm.sheet}
        </Section>
    );
}

// ----- Consolidation on an order -----

interface WindowInfo {
    known: boolean;
    enabled: boolean;
    windowDays: number;
    pressed: boolean;
    slackDays: number | null;
    latestOrderDate: string;
    canWaitUntil: string;
    urgent: { no: number; item: string; dateRequired: string; leadTimeDays: number; latestOrderDate: string; slackDays: number } | null;
    lines: Array<{ no: number; item: string; dateRequired: string; leadTimeDays: number; latestOrderDate: string; slackDays: number }>;
    undated: number;
}
interface ConsolidationData {
    window: WindowInfo;
    ready: Array<{ id: string; number: string; title: string; items: number; total: number; currency: string; requester: string; dateRequired: string }>;
    pipeline: Array<{ kind: string; ref: string; title: string; items: number; dateRequired: string; status: string }>;
    canAttach: boolean;
    spec: Scope[];
}

export function WindowBanner({ w }: { w: WindowInfo }) {
    if (!w.enabled) return <p className='text-xs text-muted'>The consolidation window is off in the order settings.</p>;
    if (!w.known) return <Alert tone='info'>No line has a date required yet, so the time left to consolidate is unknown.</Alert>;
    if (w.pressed)
        return (
            <Alert tone='info'>
                <span className='flex items-start gap-2'>
                    <Clock className='mt-0.5 h-4 w-4 shrink-0' />
                    <span>
                        Pressed: line {w.urgent?.no} ({w.urgent?.item}) is needed {w.urgent?.dateRequired} with a {w.urgent?.leadTimeDays}-day lead time, so it must be ordered by {w.latestOrderDate}
                        {w.slackDays !== null && w.slackDays < 0 ? ` (${-w.slackDays} day(s) late)` : ` (${w.slackDays} day(s) left)`}. Release the order now.
                    </span>
                </span>
            </Alert>
        );
    return (
        <Alert tone='warn'>
            <span className='flex items-start gap-2'>
                <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                <span>
                    Time to consolidate: the most urgent line ({w.urgent?.no}) must be ordered by {w.latestOrderDate}, {w.slackDays} day(s) from now. The order could wait until {w.canWaitUntil} for more requisitions. Releasing it earlier needs a reason when you confirm.
                </span>
            </span>
        </Alert>
    );
}

export function ConsolidationView({ id, onAttached }: { id: string; onAttached: (m: string) => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<ConsolidationData>(`${API}/orders/consolidation`, { id }), [id]);
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not look for requisitions to consolidate.'}</Alert>;
    return (
        <div className='space-y-3'>
            <WindowBanner w={data.window} />
            {data.spec.length > 0 && (
                <Section title='Specification'>
                    <ul className='space-y-1 text-sm text-soft'>
                        {data.spec.map((x) => (
                            <li key={scopeId(x)}>
                                {KIND_LABEL[x.kind]} · {scopeLabel(x)}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            <Section title={`Requisitions that fit now (${data.ready.length})`}>
                {data.ready.length === 0 && <p className='text-sm text-muted'>No confirmed requisition fits this order now. A fit needs the same vendor, currency, kind of purchase, payment terms, buyer group and categories{data.spec.length ? ' within the specification' : ''}.</p>}
                {data.ready.map((r) => (
                    <div key={r.id} className='flex items-center gap-2 rounded-xl border border-line p-2'>
                        <button type='button' className='min-w-0 flex-1 text-left' onClick={() => navigate(`${RQ_BASE}/${r.id}`)}>
                            <p className='truncate text-sm text-ink'>
                                <span className='font-mono text-xs'>{r.number}</span> {r.title}
                            </p>
                            <p className='text-xs text-muted'>
                                {r.items} item(s) · {money(r.total, r.currency)} · {r.requester}
                                {r.dateRequired ? ` · needed ${r.dateRequired}` : ''}
                            </p>
                        </button>
                        {data.canAttach && (
                            <Button
                                variant='secondary'
                                onClick={() =>
                                    confirm.ask({ title: `Add ${r.number}`, message: `Its ${r.items} item(s) become lines of this order, which must then be validated again.`, confirmLabel: 'Add to order' }, async () => {
                                        await callBackend(`${API}/orders/create`, { requisitionId: r.id, mode: 'consolidate', orderId: id });
                                        reload();
                                        onAttached(`${r.number} added. Validate the order again.`);
                                    })
                                }
                            >
                                Add
                            </Button>
                        )}
                    </div>
                ))}
            </Section>
            <Section title={`On the way for this vendor and categories (${data.pipeline.length})`}>
                {data.pipeline.length === 0 && <p className='text-sm text-muted'>Nothing else is on the way.</p>}
                {data.pipeline.map((x) => (
                    <div key={`${x.kind}-${x.ref}`} className='rounded-xl border border-line p-2 text-sm'>
                        <p className='text-ink'>
                            <span className='font-mono text-xs'>{x.ref}</span> {x.title}
                        </p>
                        <p className='text-xs text-muted'>
                            {x.kind} · {x.items} item(s){x.dateRequired ? ` · needed ${x.dateRequired}` : ''}
                        </p>
                    </div>
                ))}
            </Section>
            {data.window.lines.length > 0 && (
                <Section title='Latest day to order each line'>
                    <ul className='space-y-1 text-xs'>
                        {data.window.lines.map((l) => (
                            <li key={l.no} className='flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1.5'>
                                <span className='min-w-0 truncate text-soft'>
                                    {l.no} · {l.item}
                                </span>
                                <span className={l.slackDays < data.window.windowDays ? 'text-amber-300' : 'text-muted'}>
                                    by {l.latestOrderDate} ({l.slackDays} d)
                                </span>
                            </li>
                        ))}
                    </ul>
                    {data.window.undated > 0 && <p className='text-xs text-muted'>{data.window.undated} line(s) have no date required.</p>}
                </Section>
            )}
            {confirm.sheet}
        </div>
    );
}

// ----- Consolidation window setting -----

export function WindowSetting({ days, onDone }: { days: number; onDone: (m: string) => void }) {
    const confirm = useConfirm();
    const [value, setValue] = useState(String(days));
    const n = Number(value);
    const ok = Number.isInteger(n) && n >= 0 && n <= 90;
    return (
        <Section title='Consolidation window'>
            <p className='text-xs text-muted'>An order is not pressed while every line can still be ordered this many days later (date required less lead time). Confirming such an order warns that it could wait to consolidate and needs a reason. 0 switches the check off.</p>
            <div className='flex items-end gap-2'>
                <div className='flex-1'>
                    <Field id='po-window' label='Days' inputMode='numeric' maxLength={2} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} hint='0 to 90' />
                </div>
                <Button
                    disabled={!ok || n === days}
                    onClick={() =>
                        confirm.ask({ title: 'Change the consolidation window?', message: `${n} day(s).`, confirmLabel: 'Save', reason: { label: 'Reason for this change', minLength: 10 } }, async (reason) => {
                            await callBackend(`${API}/orders/settings`, { consolidationWindowDays: n, reason });
                            onDone(`Consolidation window set to ${n} day(s).`);
                        })
                    }
                >
                    Save
                </Button>
            </div>
            {confirm.sheet}
        </Section>
    );
}

// ----- Trace: where the time went -----

export const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];
interface StepRow {
    from: string;
    to: string;
    key: string;
    party: string;
    hours: number;
    days: number;
    pct: number;
}
const span = (h: number) => (h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${Math.round(h * 10) / 10} h`);

export function Pie({ slices, size = 180 }: { slices: Array<{ label: string; value: number; color: string }>; size?: number }) {
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (total <= 0) return null;
    const r = size / 2 - 4;
    const c = size / 2;
    let a0 = -Math.PI / 2;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role='img' aria-label={`Share of the elapsed time by step: ${slices.map((x) => `${x.label} ${Math.round((x.value / total) * 1000) / 10}%`).join(', ')}`} className='mx-auto block'>
            {slices.map((x) => {
                const a1 = a0 + (x.value / total) * Math.PI * 2;
                const large = a1 - a0 > Math.PI ? 1 : 0;
                const path = slices.length === 1 ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z` : `M ${c} ${c} L ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)} Z`;
                a0 = a1;
                return (
                    <path key={x.label} d={path} fill={x.color} stroke='rgba(255,255,255,0.7)' strokeWidth={1.5}>
                        <title>{`${x.label}: ${Math.round((x.value / total) * 1000) / 10}%`}</title>
                    </path>
                );
            })}
        </svg>
    );
}

export function TraceBreakdown({ steps, byParty, totalHours }: { steps: StepRow[]; byParty: Array<{ party: string; hours: number; pct: number }>; totalHours: number }) {
    const [by, setBy] = useState<'step' | 'party'>('step');
    if (!steps.length || totalHours <= 0) return <p className='text-sm text-muted'>The breakdown appears once the order has at least two milestones.</p>;
    // Steps under 2% are grouped as "Other" so the chart stays readable; the table lists every step.
    const ranked = [...steps].sort((a, b) => b.hours - a.hours);
    const major = ranked.filter((x) => x.pct >= 2).slice(0, 9);
    const minorPct = ranked.filter((x) => !major.includes(x)).reduce((s, x) => s + x.hours, 0);
    const stepSlices = [...major.map((x, i) => ({ label: `${x.to}`, value: x.hours, color: PALETTE[i % PALETTE.length] })), ...(minorPct > 0 ? [{ label: 'Other steps', value: minorPct, color: '#94a3b8' }] : [])];
    const partySlices = byParty.filter((x) => x.hours > 0).map((x, i) => ({ label: x.party, value: x.hours, color: PALETTE[i % PALETTE.length] }));
    const slices = by === 'step' ? stepSlices : partySlices;
    const longest = ranked[0];
    return (
        <div className='space-y-3'>
            <Segmented<'step' | 'party'> label='Group the time by' value={by} onChange={setBy} options={[{ value: 'step', label: 'By step' }, { value: 'party', label: 'By who it waited on' }]} />
            <Pie slices={slices} />
            <ul className='space-y-1'>
                {slices.map((x) => (
                    <li key={x.label} className='flex items-center gap-2 text-xs'>
                        <span className='h-3 w-3 shrink-0 rounded-sm' style={{ background: x.color }} />
                        <span className='min-w-0 flex-1 truncate text-soft'>{x.label}</span>
                        <span className='text-muted'>{span(x.value)}</span>
                        <span className='w-12 text-right font-semibold text-ink'>{Math.round((x.value / totalHours) * 1000) / 10}%</span>
                    </li>
                ))}
            </ul>
            {longest && longest.pct >= 25 && (
                <p className='text-xs text-amber-300'>
                    The longest delay is “{longest.from} → {longest.to}” ({span(longest.hours)}, {longest.pct}%), waiting on {longest.party}.
                </p>
            )}
            <div className='overflow-x-auto rounded-xl border border-line'>
                <table className='w-full text-xs'>
                    <thead className='bg-page text-muted'>
                        <tr>
                            <th className='px-2 py-1.5 text-left font-normal'>Step</th>
                            <th className='text-left font-normal'>Waited on</th>
                            <th className='text-right font-normal'>Lead time</th>
                            <th className='px-2 text-right font-normal'>%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {steps.map((x, i) => (
                            <tr key={`${x.key}-${i}`} className='border-t border-line'>
                                <td className='px-2 py-1.5 text-soft'>
                                    {x.from} → <span className='text-ink'>{x.to}</span>
                                </td>
                                <td className='text-muted'>{x.party}</td>
                                <td className='text-right text-ink'>{span(x.hours)}</td>
                                <td className='px-2 text-right'>
                                    <Badge tone={x.pct >= 25 ? 'danger' : x.pct >= 10 ? 'warn' : 'muted'}>{x.pct}%</Badge>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className='flex items-center gap-1 text-[11px] text-muted'>
                <CheckCircle2 className='h-3.5 w-3.5' /> Total {span(totalHours)} from the requirement to the latest milestone.
            </p>
        </div>
    );
}
