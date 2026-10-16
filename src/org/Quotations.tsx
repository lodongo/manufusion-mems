import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Download, FileText, Paperclip, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { downloadDataUrl } from '../lib/xlsx';
import { downloadReportPdf } from '../lib/report';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';

// Quotations (QTN + 9 digits). Procurement picks up an acknowledged purchase requirement and works it to a recommendation:
//   1. Review: decide the mode of procurement (or record that the best method is still being researched or consulted on).
//   2. Vendors: invite approved vendors. The case shows how many quotes were asked for and received.
//   3. Quotes: record each vendor's quote by item (mandatory and optional fields) and attach the vendor's document.
//   4. Analysis: the quotes are scored with the configured metrics, evaluators sign off, and procurement recommends one.
// The server decides who may do what and checks every field again; this screen only shows what it is told is allowed.

const BASE = 'organization_home/procurement_quotations';
const API = '/api/org/procurement/quotes';
const MAX_BYTES = 450 * 1024;
const CASE_ID = /^QTN\d{9}$/;

interface Method {
    code: string;
    label: string;
    note: string;
}
interface Meta {
    code: string;
    label: string;
}
interface Criterion {
    code: string;
    label: string;
    note: string;
    enabled: boolean;
    weight: number;
    whenMissing: 'skip' | 'zero';
}
interface Options {
    methods: Method[];
    currency: string;
    currencies: Array<{ code: string; name: string }>;
    rates: Record<string, number>;
    ratesAsOf: string;
    terms: Meta[];
    incoterms: Meta[];
    evaluation: { criteria: Criterion[]; classOrder: string[]; version: number };
    fieldsNote: string;
    scope: { enabled: boolean; all: boolean };
    can: { manage: boolean; evaluate: boolean; srm: boolean; metrics: boolean };
}
interface Row {
    id: string;
    number: string;
    requirementId: string;
    requirementTitle: string;
    requester: string;
    status: string;
    statusLabel: string;
    mode: string;
    modeLabel: string;
    groups: string;
    items: number;
    invited: number;
    received: number;
    estimate: number | null;
    recommended: string;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
}
interface ReadyItem {
    no: number;
    type: string;
    requirement: string;
    quantity: number;
    unit: string;
    subcategoryName: string;
    budget: number | null;
    dateRequired: string;
    urgency: string;
}
interface Ready {
    id: string;
    title: string;
    requester: string;
    acknowledgedAt: string;
    items: ReadyItem[];
}
interface ListOut {
    rows: Row[];
    ready: Ready[];
    counts: { cases: number; open: number; ready: number };
}
interface CaseLine {
    no: number;
    type: string;
    requirement: string;
    technical: string;
    quantity: number;
    unit: string;
    subcategoryName: string;
    categoryName: string;
    budget: number | null;
    dateRequired: string;
    urgency: string;
    costCenterName: string;
    glCode: string;
    warehouseName: string;
    attributeView: Array<{ name: string; value: string; unit: string }>;
    lastPrice?: LastPrice | null;
}
interface LastPrice {
    unitPrice: number;
    currency: string;
    fxRate: number | null;
    vendorName: string;
    date: string;
    ref: string;
    source: string;
}
interface Invite {
    vendorId: string;
    vendorNumber: string;
    vendorName: string;
    invitedAt: string;
    invitedBy: string;
    status: string;
    note: string;
    classLabel: string;
    sourcingLabel: string;
    riskLabel: string;
    srmScore: number | null;
    vendorStatus: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    scopeMatch: string;
}
interface QuoteLine {
    no: number;
    bid: boolean;
    unitPrice?: number;
    quantity?: number;
    discountPct?: number | null;
    leadTimeDays?: number | null;
    warrantyMonths?: number | null;
    brand?: string;
    origin?: string;
    compliance?: string;
    note?: string;
}
interface FileMeta {
    id: string;
    name: string;
    type: string;
    size: number;
    uploadedAt: string;
    uploadedBy: string;
}
interface Quote {
    id: string;
    vendorId: string;
    vendorName: string;
    classLabel: string;
    ref: string;
    date: string;
    validUntil: string;
    currency: string;
    fxRate: number | null;
    latestRate: number | null;
    latestBase: number | null;
    paymentTermsCode: string;
    paymentTermsLabel: string;
    incotermCode: string;
    incotermLabel: string;
    leadTimeDays: number | null;
    warrantyMonths: number | null;
    discountPct: number | null;
    deliveryTerms: string;
    vatIncluded: boolean | null;
    notes: string;
    lines: QuoteLine[];
    tech: { preference?: string; note?: string; byName?: string };
    attachments: FileMeta[];
    total: number;
    base: number | null;
    gaps: string[];
}
interface Ranked {
    quoteId: string;
    vendorId: string;
    vendorName: string;
    total: number;
    base: number | null;
    scores: Record<string, number | null>;
    used: string[];
    skipped: string[];
    score: number;
    rank: number | null;
    eligible: boolean;
    flags: string[];
}
interface Approver {
    code: string;
    title: string;
    positionCode: string;
    positionTitle: string;
    holders: number;
    viaReportingLine: boolean;
}
interface Authority {
    estimate: number | null;
    suggested: { sourcing: { method: string; methodLabel: string; minQuotes: number; minEvaluators: number; justification: boolean }; approval: { approvers: number } } | null;
    minQuotes: number;
    minEvaluators: number;
    validSigns: number;
    award: number | null;
    approvers: Approver[];
}
interface Sign {
    uid: string;
    name: string;
    at: string;
    conflict: string;
    note: string;
    stale: boolean;
    counts: boolean;
}
interface CaseOut extends Row {
    lines: CaseLine[];
    review: { mode?: string; note?: string; estimateTotal?: number | null; suggestedMethod?: string; minQuotes?: number; deviationReason?: string; closingDate?: string; byName?: string; at?: string };
    invites: Invite[];
    quotes: Quote[];
    ranking: Ranked[];
    signs: Sign[];
    recommendation: { quoteId: string; vendorName: string; total: number; score: number; rank: number | null; reason: string; shortfallReason: string; byName: string; at: string } | null;
    authority: Authority;
    evaluation: { criteria: Criterion[] };
    history: Array<{ at: string; byName: string; action: string; note: string; from: string; to: string }>;
    currency: string;
    ratesAsOf: string;
    can: { review: boolean; invite: boolean; record: boolean; technical: boolean; sign: boolean; recommend: boolean; reopen: boolean; cancel: boolean };
}
interface VendorHit {
    id: string;
    number: string;
    name: string;
    classLabel: string;
    sourcingLabel: string;
    srmScore: number | null;
    scopeMatch: string;
}

const money = (n: number | null | undefined, cur = '') => (n === null || n === undefined ? '-' : `${cur ? `${cur} ` : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (s === 'recommended' ? 'brand' : s === 'cancelled' ? 'danger' : s === 'sourcing' ? 'brand' : 'warn');
const fileSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const TECH_LABEL: Record<string, string> = { preferred: 'Preferred', acceptable: 'Acceptable', not_acceptable: 'Not acceptable' };

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read that file.'));
        r.readAsDataURL(file);
    });
}

// ----- List -----

const COLUMNS: Array<Column<Row>> = [
    { key: 'number', label: 'Number', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'req', label: 'Requirement', value: (r) => r.requirementTitle },
    { key: 'requirementId', label: 'Requirement no.', value: (r) => r.requirementId, hidden: true },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'mode', label: 'Mode of procurement', value: (r) => r.modeLabel || 'Not decided' },
    { key: 'items', type: 'number', label: 'Items', value: (r) => r.items },
    { key: 'invited', type: 'number', label: 'Quotes asked', value: (r) => r.invited },
    { key: 'received', type: 'number', label: 'Quotes received', value: (r) => r.received },
    { key: 'estimate', type: 'number', label: 'Estimate', value: (r) => r.estimate ?? '' },
    { key: 'recommended', label: 'Recommended vendor', value: (r) => r.recommended },
    { key: 'groups', label: 'Buyer group', value: (r) => r.groups, hidden: true },
    { key: 'requester', label: 'Requester', value: (r) => r.requester, hidden: true },
    { key: 'updated', type: 'date', label: 'Updated', value: (r) => r.updatedAt, render: (r) => fmtDate(r.updatedAt), hidden: true },
];

// The last price paid or agreed for the same item, and how a quoted price compares with it.
function LastPriceNote({ lp, now, nowCurrency }: { lp: LastPrice; now?: number; nowCurrency?: string }) {
    const same = now !== undefined && nowCurrency === lp.currency && lp.unitPrice > 0;
    const pct = same ? Math.round(((now! - lp.unitPrice) / lp.unitPrice) * 1000) / 10 : null;
    return (
        <p className='text-xs text-soft'>
            Last price {money(lp.unitPrice, lp.currency)} from {lp.vendorName || 'a vendor'}, {lp.date} ({lp.source.toLowerCase()} {lp.ref})
            {pct !== null && (
                <span className={pct > 0 ? 'text-amber-300' : pct < 0 ? 'text-emerald-300' : 'text-muted'}>
                    {' '}· {pct > 0 ? `${pct}% higher` : pct < 0 ? `${Math.abs(pct)}% lower` : 'unchanged'}
                </span>
            )}
        </p>
    );
}

function ReadyCard({ r, onStart }: { r: Ready; onStart: (r: Ready, nos: number[]) => void }) {
    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState<Set<number>>(new Set(r.items.map((i) => i.no)));
    return (
        <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className='flex min-h-11 w-full items-center gap-2 text-left'>
                {open ? <ChevronDown className='h-4 w-4 shrink-0' /> : <ChevronRight className='h-4 w-4 shrink-0' />}
                <span className='min-w-0 flex-1'>
                    <span className='block font-mono text-xs text-brandsoft'>{r.id}</span>
                    <span className='block truncate text-sm font-semibold text-ink'>{r.title}</span>
                    <span className='block text-xs text-muted'>{r.requester} · {r.items.length} item{r.items.length === 1 ? '' : 's'} to source</span>
                </span>
            </button>
            {open && (
                <>
                    <ul className='divide-y divide-line rounded-xl border border-line'>
                        {r.items.map((i) => (
                            <li key={i.no}>
                                <label className='flex min-h-11 items-start gap-3 px-3 py-2 text-sm text-ink'>
                                    <input
                                        type='checkbox'
                                        checked={picked.has(i.no)}
                                        onChange={(e) => {
                                            const next = new Set(picked);
                                            if (e.target.checked) next.add(i.no);
                                            else next.delete(i.no);
                                            setPicked(next);
                                        }}
                                        className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500'
                                    />
                                    <span className='min-w-0 flex-1'>
                                        <span className='block'>{i.no} · {i.requirement}</span>
                                        <span className='block text-xs text-muted'>{i.quantity} {i.unit} · {i.subcategoryName}{i.budget ? ` · budget ${money(i.budget)}` : ''}</span>
                                    </span>
                                </label>
                            </li>
                        ))}
                    </ul>
                    <Button disabled={picked.size === 0} onClick={() => onStart(r, [...picked].sort((a, b) => a - b))}>
                        <Plus className='mr-1 h-4 w-4' /> Start quotation ({picked.size})
                    </Button>
                </>
            )}
        </section>
    );
}

function List() {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const { data, error, loading } = useLoad(() => callBackend<ListOut>(`${API}/list`, {}));
    const [view, setView] = useState<'cases' | 'ready'>('cases');
    const confirm = useConfirm();

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'You do not have permission to view quotations.'}</Alert>;

    const start = (r: Ready, nos: number[]) =>
        confirm.ask(
            {
                title: `Start a quotation for ${r.id}`,
                message: `${nos.length} item${nos.length === 1 ? '' : 's'} of ${r.title} will be taken into a new quotation. You then review them and decide the mode of procurement.`,
                confirmLabel: 'Start',
            },
            async () => {
                const out = await callBackend<{ id: string }>(`${API}/create`, { requirementId: r.id, lineNos: nos });
                navigate(`${BASE}/${out.id}`);
            }
        );

    return (
        <Screen
            title='Quotations'
            subtitle={options.data?.scope.enabled && !options.data.scope.all ? 'Your buyer groups only' : 'Sourcing and comparing quotes'}
            onBack={() => navigate('organization_home')}
            toolbar={
                <Segmented
                    label='Quotation views'
                    value={view}
                    options={[
                        { value: 'cases', label: 'Quotations', count: data.counts.cases },
                        ...(options.data?.can.manage ? [{ value: 'ready' as const, label: 'Ready to source', count: data.counts.ready }] : []),
                    ]}
                    onChange={setView}
                />
            }
        >
            {view === 'cases' ? (
                <RichTable id='prc.quotations' title='Quotations' columns={COLUMNS} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => navigate(`${BASE}/${r.id}`)} empty='No quotations yet.' fileName='quotations' height='h-[calc(100dvh-18rem)]' />
            ) : data.ready.length === 0 ? (
                <p className='text-sm text-muted'>No acknowledged requirements are waiting for quotations{options.data?.scope.enabled && !options.data.scope.all ? ' in your buyer groups' : ''}.</p>
            ) : (
                data.ready.map((r) => <ReadyCard key={r.id} r={r} onStart={start} />)
            )}
            {confirm.sheet}
        </Screen>
    );
}

// ----- A quote form -----

interface Draft {
    ref: string;
    date: string;
    validUntil: string;
    currency: string;
    fxRate: string;
    paymentTermsCode: string;
    leadTimeDays: string;
    warrantyMonths: string;
    discountPct: string;
    incotermCode: string;
    deliveryTerms: string;
    vatIncluded: '' | 'yes' | 'no';
    notes: string;
    lines: Array<{ no: number; bid: boolean; unitPrice: string; quantity: string; discountPct: string; leadTimeDays: string; warrantyMonths: string; brand: string; origin: string; compliance: string; note: string }>;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function draftOf(c: CaseOut, vendorId: string, orgCurrency: string): Draft {
    const q = c.quotes.find((x) => x.vendorId === vendorId);
    return {
        ref: q?.ref ?? '',
        date: q?.date ?? '',
        validUntil: q?.validUntil ?? '',
        currency: q?.currency ?? orgCurrency,
        fxRate: s(q?.fxRate),
        paymentTermsCode: q?.paymentTermsCode ?? '',
        leadTimeDays: s(q?.leadTimeDays),
        warrantyMonths: s(q?.warrantyMonths),
        discountPct: s(q?.discountPct),
        incotermCode: q?.incotermCode ?? '',
        deliveryTerms: q?.deliveryTerms ?? '',
        vatIncluded: q?.vatIncluded === true ? 'yes' : q?.vatIncluded === false ? 'no' : '',
        notes: q?.notes ?? '',
        lines: c.lines.map((l) => {
            const x = q?.lines.find((y) => y.no === l.no);
            return {
                no: l.no,
                bid: x ? x.bid !== false : true,
                unitPrice: x?.bid !== false && x?.unitPrice ? s(x.unitPrice) : '',
                quantity: x?.bid !== false && x?.quantity ? s(x.quantity) : s(l.quantity),
                discountPct: s(x?.discountPct),
                leadTimeDays: s(x?.leadTimeDays),
                warrantyMonths: s(x?.warrantyMonths),
                brand: x?.brand ?? '',
                origin: x?.origin ?? '',
                compliance: x?.compliance ?? '',
                note: x?.note ?? '',
            };
        }),
    };
}

const required = (label: string) => <span>{label} <span className='text-red-400' aria-hidden>*</span><span className='sr-only'> (required)</span></span>;

function QuoteForm({ c, vendorId, options, onClose, onSaved }: { c: CaseOut; vendorId: string; options: Options; onClose: () => void; onSaved: () => void }) {
    const inv = c.invites.find((i) => i.vendorId === vendorId);
    const existing = c.quotes.find((q) => q.vendorId === vendorId);
    const [d, setD] = useState<Draft>(() => draftOf(c, vendorId, options.currency));
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState(false);
    const today = new Date().toISOString().slice(0, 10);
    const set = (p: Partial<Draft>) => setD({ ...d, ...p });
    const setLine = (no: number, p: Partial<Draft['lines'][number]>) => setD({ ...d, lines: d.lines.map((l) => (l.no === no ? { ...l, ...p } : l)) });
    const foreign = d.currency.trim().length === 3 && d.currency.trim().toUpperCase() !== options.currency;

    const total = useMemo(() => {
        const sub = d.lines.filter((l) => l.bid).reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100), 0);
        return sub * (1 - (Number(d.discountPct) || 0) / 100);
    }, [d]);

    // Mandatory fields are listed so the person knows what is still missing; the quote can be saved part-filled.
    const missing: string[] = [];
    if (!d.ref.trim()) missing.push('Quote reference');
    if (!d.date) missing.push('Quote date');
    if (!d.validUntil) missing.push('Valid until');
    if (d.currency.trim().length !== 3) missing.push('Currency');
    if (foreign && !(Number(d.fxRate) > 0)) missing.push(`Exchange rate to ${options.currency}`);
    if (!d.paymentTermsCode) missing.push('Terms of payment');
    if (d.leadTimeDays.trim() === '') missing.push('Lead time');
    if (!d.lines.some((l) => l.bid)) missing.push('At least one item quoted');
    for (const l of d.lines) if (l.bid && (!(Number(l.unitPrice) > 0) || !(Number(l.quantity) > 0))) missing.push(`Price and quantity for item ${l.no}`);

    const dateErr = d.date && d.date > today ? 'The quote date cannot be in the future.' : '';
    const validErr = d.date && d.validUntil && d.validUntil < d.date ? 'Cannot be before the quote date.' : '';
    const blocked = !!dateErr || !!validErr;

    const save = async () => {
        setBusy(true);
        setProblem('');
        try {
            await callBackend(`${API}/quote/save`, {
                id: c.id,
                vendorId,
                ref: d.ref,
                date: d.date,
                validUntil: d.validUntil,
                currency: d.currency.trim().toUpperCase(),
                fxRate: foreign ? d.fxRate : '',
                paymentTermsCode: d.paymentTermsCode,
                leadTimeDays: d.leadTimeDays,
                warrantyMonths: d.warrantyMonths,
                discountPct: d.discountPct,
                incotermCode: d.incotermCode,
                deliveryTerms: d.deliveryTerms,
                vatIncluded: d.vatIncluded === '' ? null : d.vatIncluded === 'yes',
                notes: d.notes,
                lines: d.lines.map((l) => (l.bid ? { ...l } : { no: l.no, bid: false })),
            });
            onSaved();
        } catch (e) {
            setProblem(messageOf(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen
            title={inv?.vendorName ?? 'Quote'}
            eyebrow={`${c.number} · ${existing ? 'Change quote' : 'Record quote'}`}
            subtitle={missing.length ? `${missing.length} mandatory field${missing.length === 1 ? '' : 's'} still to fill` : 'All mandatory fields filled'}
            onBack={onClose}
            actions={
                <Button disabled={busy || blocked} onClick={() => void save()}>
                    <Check className='mr-1 h-4 w-4' /> {busy ? 'Saving' : 'Save'}
                </Button>
            }
        >
            {problem && <Alert tone='error'>{problem}</Alert>}
            <Alert tone='info'>{options.fieldsNote} You can save a part-filled quote. It is only ranked once every mandatory field is filled and the vendor document is attached.</Alert>
            {existing && <Alert tone='warn'>Saving a change makes earlier evaluator sign-offs lapse. Evaluators sign again on the new figures.</Alert>}
            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Quote details</h2>
                <Field id='q-ref' label='Quote reference *' maxLength={40} value={d.ref} onChange={(e) => set({ ref: e.target.value })} />
                <div className='grid grid-cols-2 gap-3'>
                    <Field id='q-date' label='Quote date *' type='date' max={today} value={d.date} error={dateErr} onChange={(e) => set({ date: e.target.value })} />
                    <Field id='q-valid' label='Valid until *' type='date' value={d.validUntil} error={validErr} onChange={(e) => set({ validUntil: e.target.value })} />
                </div>
                <div className='grid grid-cols-2 gap-3'>
                    <SelectField id='q-cur' label='Currency *' value={d.currency} onChange={(e) => set({ currency: e.target.value, fxRate: e.target.value === options.currency ? '' : String(options.rates[e.target.value] ?? '') })}>
                        <option value=''>Choose</option>
                        {d.currency && !options.currencies.some((x) => x.code === d.currency) && <option value={d.currency}>{d.currency}</option>}
                        {options.currencies.map((x) => (
                            <option key={x.code} value={x.code}>{x.code}{x.name ? ` · ${x.name}` : ''}</option>
                        ))}
                    </SelectField>
                    {foreign ? <Field id='q-fx' label={`Rate to ${options.currency} *`} type='number' inputMode='decimal' min='0' step='any' value={d.fxRate} onChange={(e) => set({ fxRate: e.target.value })} hint={options.rates[d.currency.trim().toUpperCase()] ? `Latest: 1 ${d.currency.trim().toUpperCase()} = ${options.rates[d.currency.trim().toUpperCase()]} ${options.currency}${options.ratesAsOf ? ` (${fmtDate(options.ratesAsOf)})` : ''}. You can change it to the rate on the quote.` : 'No latest rate is available. Enter the rate on the quote.'} /> : <div />}
                </div>
                <SelectField id='q-pay' label='Terms of payment *' value={d.paymentTermsCode} onChange={(e) => set({ paymentTermsCode: e.target.value })}>
                    <option value=''>Choose</option>
                    {options.terms.map((t) => (
                        <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                </SelectField>
                <div className='grid grid-cols-2 gap-3'>
                    <Field id='q-lead' label='Lead time, days *' type='number' inputMode='numeric' min='0' step='1' value={d.leadTimeDays} onChange={(e) => set({ leadTimeDays: e.target.value })} />
                    <Field id='q-war' label='Warranty, months' type='number' inputMode='numeric' min='0' step='1' value={d.warrantyMonths} onChange={(e) => set({ warrantyMonths: e.target.value })} />
                </div>
                <Field id='q-disc' label='Overall discount, %' type='number' inputMode='decimal' min='0' max='100' step='any' value={d.discountPct} onChange={(e) => set({ discountPct: e.target.value })} hint='Taken off the total after item discounts' />
                <SelectField id='q-inco' label='Incoterm' value={d.incotermCode} onChange={(e) => set({ incotermCode: e.target.value })}>
                    <option value=''>Not stated</option>
                    {options.incoterms.map((t) => (
                        <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                </SelectField>
                <Field id='q-del' label='Delivery terms' maxLength={200} value={d.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} />
                <SelectField id='q-vat' label='Prices include VAT?' value={d.vatIncluded} onChange={(e) => set({ vatIncluded: e.target.value as Draft['vatIncluded'] })}>
                    <option value=''>Not stated</option>
                    <option value='yes'>Yes</option>
                    <option value='no'>No</option>
                </SelectField>
                <label className='block'>
                    <span className='mb-1 block text-sm text-soft'>Notes</span>
                    <textarea id='q-notes' value={d.notes} maxLength={600} rows={3} onChange={(e) => set({ notes: e.target.value })} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                </label>
            </section>

            {c.lines.map((l) => {
                const x = d.lines.find((y) => y.no === l.no);
                if (!x) return null;
                return (
                    <section key={l.no} className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                        <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='text-sm font-semibold text-ink'>Item {l.no} · {l.requirement}</p>
                                <p className='text-xs text-muted'>Asked: {l.quantity} {l.unit} · {l.subcategoryName}</p>
                                {l.lastPrice && <LastPriceNote lp={l.lastPrice} now={Number(x.unitPrice) > 0 ? Number(x.unitPrice) : undefined} nowCurrency={d.currency} />}
                            </div>
                            <label className='flex min-h-11 items-center gap-2 text-xs text-soft'>
                                <input type='checkbox' checked={x.bid} onChange={(e) => setLine(l.no, { bid: e.target.checked })} className='h-5 w-5 accent-emerald-500' /> Quoted
                            </label>
                        </div>
                        {!x.bid ? (
                            <p className='text-xs text-muted'>This vendor did not quote this item. A quote that does not cover every item is not ranked.</p>
                        ) : (
                            <>
                                <div className='grid grid-cols-2 gap-3'>
                                    <Field id={`l-p-${l.no}`} label={`Unit price (${d.currency || '...'}) *`} type='number' inputMode='decimal' min='0' step='any' value={x.unitPrice} onChange={(e) => setLine(l.no, { unitPrice: e.target.value })} />
                                    <Field id={`l-q-${l.no}`} label={`Quantity (${l.unit}) *`} type='number' inputMode='decimal' min='0' step='any' value={x.quantity} onChange={(e) => setLine(l.no, { quantity: e.target.value })} />
                                </div>
                                <div className='grid grid-cols-3 gap-3'>
                                    <Field id={`l-d-${l.no}`} label='Discount %' type='number' inputMode='decimal' min='0' max='100' step='any' value={x.discountPct} onChange={(e) => setLine(l.no, { discountPct: e.target.value })} />
                                    <Field id={`l-t-${l.no}`} label='Lead days' type='number' inputMode='numeric' min='0' step='1' value={x.leadTimeDays} onChange={(e) => setLine(l.no, { leadTimeDays: e.target.value })} />
                                    <Field id={`l-w-${l.no}`} label='Warranty mo.' type='number' inputMode='numeric' min='0' step='1' value={x.warrantyMonths} onChange={(e) => setLine(l.no, { warrantyMonths: e.target.value })} />
                                </div>
                                <div className='grid grid-cols-2 gap-3'>
                                    <Field id={`l-b-${l.no}`} label='Brand or make' maxLength={80} value={x.brand} onChange={(e) => setLine(l.no, { brand: e.target.value })} />
                                    <Field id={`l-o-${l.no}`} label='Country of origin' maxLength={60} value={x.origin} onChange={(e) => setLine(l.no, { origin: e.target.value })} />
                                </div>
                                <SelectField id={`l-c-${l.no}`} label='Meets the specification' value={x.compliance} onChange={(e) => setLine(l.no, { compliance: e.target.value })}>
                                    <option value=''>Not stated</option>
                                    <option value='full'>Fully</option>
                                    <option value='partial'>Partly</option>
                                    <option value='none'>Does not</option>
                                </SelectField>
                                <Field id={`l-n-${l.no}`} label='Note' maxLength={200} value={x.note} onChange={(e) => setLine(l.no, { note: e.target.value })} />
                                <p className='text-right text-xs text-muted'>Line: {money((Number(x.quantity) || 0) * (Number(x.unitPrice) || 0) * (1 - (Number(x.discountPct) || 0) / 100), d.currency)}</p>
                            </>
                        )}
                    </section>
                );
            })}
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between'>
                    <span className='text-sm text-soft'>Quote total</span>
                    <span className='text-base font-semibold text-ink'>{money(total, d.currency)}</span>
                </div>
                {missing.length > 0 && <p className='text-xs text-amber-400'>Still needed: {missing.join(', ')}.</p>}
                <p className='text-xs text-muted'>Attach the vendor&apos;s document after saving. {required('Mandatory fields')} are marked *.</p>
            </section>
        </Screen>
    );
}

// ----- A case -----

type Tab = 'review' | 'vendors' | 'quotes' | 'analysis' | 'history';

function Case({ id }: { id: string }) {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const { data, error, loading, reload } = useLoad(() => callBackend<CaseOut>(`${API}/get`, { id }), [id]);
    const [tab, setTab] = useState<Tab>('review');
    const [editing, setEditing] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const confirm = useConfirm();

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Quotation not found.'}</Alert>;
    const c = data;
    const o = options.data;
    if (!o) return <Spinner />;

    const run = async (fn: () => Promise<unknown>, done = '') => {
        setProblem('');
        try {
            await fn();
            if (done) setNotice(done);
            reload();
        } catch (e) {
            setProblem(messageOf(e));
        }
    };

    if (editing)
        return (
            <QuoteForm
                c={c}
                vendorId={editing}
                options={o}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    setNotice('Quote saved.');
                    reload();
                }}
            />
        );

    const guard: Confirm = {
        ask: (opts, fn) =>
            confirm.ask(opts, async (r) => {
                await fn(r);
                reload();
            }),
    };

    const pdf = () =>
        void run(
            () =>
                downloadReportPdf({
                    title: `${c.number} ${c.requirementTitle}`,
                    subtitle: `Requirement ${c.requirementId} · ${c.statusLabel}`,
                    fileName: c.number,
                    sections: [
                        {
                            heading: 'Summary',
                            facts: [
                                ['Mode of procurement', c.modeLabel || 'Not decided'],
                                ['Estimated value', money(c.authority.estimate, c.currency)],
                                ['Chart of authority suggests', c.authority.suggested ? `${c.authority.suggested.sourcing.methodLabel}, ${c.authority.minQuotes} quote(s), ${c.authority.minEvaluators} evaluator(s)` : '-'],
                                ['Quotes asked / received', `${c.invited} / ${c.received}`],
                                ['Buyer group', c.groups || '-'],
                                ['Recommended', c.recommendation ? `${c.recommendation.vendorName}, ${money(c.recommendation.total, c.currency)}, score ${c.recommendation.score}` : '-'],
                            ],
                        },
                        { heading: 'Items', table: { head: ['No', 'Item', 'Quantity', 'Needed by', 'Budget'], body: c.lines.map((l) => [String(l.no), l.requirement, `${l.quantity} ${l.unit}`, l.dateRequired, l.budget ? money(l.budget) : '-']) } },
                        {
                            heading: 'Vendors invited',
                            table: { head: ['Vendor', 'Class', 'Status', 'SRM score'], body: c.invites.map((i) => [`${i.vendorNumber} ${i.vendorName}`, i.classLabel, i.status, i.srmScore === null ? 'none' : String(i.srmScore)]) },
                        },
                        {
                            heading: 'Quotes',
                            table: {
                                head: ['Vendor', 'Ref', 'Date', 'Total', 'Payment', 'Lead (days)', 'Technical'],
                                body: c.quotes.map((q) => [q.vendorName, q.ref, q.date, `${money(q.total, q.currency)}${q.currency !== c.currency && q.latestBase !== null ? ` (about ${money(q.latestBase, c.currency)} at the latest rate)` : ''}`, q.paymentTermsLabel, s(q.leadTimeDays), TECH_LABEL[q.tech.preference ?? ''] ?? '-']),
                            },
                        },
                        {
                            heading: 'Analysis',
                            table: {
                                head: ['Rank', 'Vendor', 'Total', 'Score', 'Notes'],
                                body: c.ranking.map((r) => [r.rank ? String(r.rank) : '-', r.vendorName, money(r.total), r.eligible ? String(r.score) : '-', r.flags.join('; ') || (r.skipped.length ? `Not scored on: ${r.skipped.join(', ')}` : '')]),
                            },
                        },
                        { heading: 'History', table: { head: ['When', 'Who', 'What'], body: c.history.map((h) => [fmtDate(h.at), h.byName, `${h.action}${h.note ? `: ${h.note}` : ''}`]) } },
                    ],
                }),
            ''
        );

    const tabs: Array<{ value: Tab; label: string; count?: number }> = [
        { value: 'review', label: 'Review' },
        { value: 'vendors', label: 'Vendors', count: c.invited },
        { value: 'quotes', label: 'Quotes', count: c.received },
        { value: 'analysis', label: 'Analysis' },
        { value: 'history', label: 'History' },
    ];

    return (
        <Screen
            title={c.number}
            eyebrow='Quotation'
            subtitle={c.requirementTitle}
            onBack={() => navigate(BASE)}
            actions={
                <Button variant='secondary' onClick={pdf}>
                    <FileText className='mr-1 h-4 w-4' /> PDF
                </Button>
            }
            toolbar={<Segmented label='Quotation sections' value={tab} options={tabs} onChange={setTab} />}
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                    <Badge tone={tone(c.status)}>{c.statusLabel}</Badge>
                    {c.modeLabel && <Badge tone='muted'>{c.modeLabel}</Badge>}
                </div>
                <div className='grid grid-cols-3 gap-2 text-center'>
                    <div className='rounded-xl border border-line p-2'>
                        <p className='text-lg font-semibold text-ink'>{c.invited}</p>
                        <p className='text-xs text-muted'>Quotes asked</p>
                    </div>
                    <div className='rounded-xl border border-line p-2'>
                        <p className='text-lg font-semibold text-ink'>{c.received}</p>
                        <p className='text-xs text-muted'>Received</p>
                    </div>
                    <div className='rounded-xl border border-line p-2'>
                        <p className='text-lg font-semibold text-ink'>{c.authority.minQuotes}</p>
                        <p className='text-xs text-muted'>Needed</p>
                    </div>
                </div>
                <p className='text-xs text-muted'>From {c.requirementId} · requested by {c.requester}{c.groups ? ` · ${c.groups}` : ''}</p>
            </section>

            {tab === 'review' && <ReviewTab c={c} o={o} confirm={guard} />}
            {tab === 'vendors' && <VendorsTab c={c} confirm={guard} onRecord={(v) => { setTab('quotes'); setEditing(v); }} />}
            {tab === 'quotes' && <QuotesTab c={c} run={run} confirm={guard} onEdit={(v) => setEditing(v)} setProblem={setProblem} />}
            {tab === 'analysis' && <AnalysisTab c={c} o={o} confirm={guard} />}
            {tab === 'history' && (
                <section className='rounded-2xl border border-line bg-panel p-3'>
                    <ol className='space-y-3'>
                        {c.history.slice().reverse().map((h, i) => (
                            <li key={i} className='text-sm'>
                                <p className='text-ink'>{h.action}{h.note ? `: ${h.note}` : ''}</p>
                                <p className='text-xs text-muted'>{h.byName} · {fmtDate(h.at)}</p>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {(c.can.cancel || c.can.reopen) && (
                <div className='flex flex-wrap gap-2'>
                    {c.can.reopen && (
                        <Button variant='secondary' onClick={() => confirm.ask({ title: `Reopen ${c.number}`, message: 'The recommendation is withdrawn so quotes can be changed. Evaluators sign again.', confirmLabel: 'Reopen', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${API}/reopen`, { id, reason }); reload(); })}>Reopen</Button>
                    )}
                    {c.can.cancel && (
                        <Button variant='danger' onClick={() => confirm.ask({ title: `Cancel ${c.number}`, message: 'The quotation is closed. The items can be taken into a new quotation.', confirmLabel: 'Cancel quotation', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${API}/cancel`, { id, reason }); reload(); })}>Cancel quotation</Button>
                    )}
                </div>
            )}
            {confirm.sheet}
        </Screen>
    );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>;
type Confirm = { ask: ReturnType<typeof useConfirm>['ask'] };

function ReviewTab({ c, o, confirm }: { c: CaseOut; o: Options; confirm: Confirm }) {
    const [mode, setMode] = useState(c.review.mode ?? '');
    const [note, setNote] = useState(c.review.note ?? '');
    const [estimate, setEstimate] = useState(s(c.review.estimateTotal ?? ''));
    const [deviation, setDeviation] = useState(c.review.deviationReason ?? '');
    const [closing, setClosing] = useState(c.review.closingDate ?? '');
    const sug = c.authority.suggested;
    const budgetSum = c.lines.reduce((sum, l) => sum + (l.budget ?? 0), 0);
    const research = mode === 'research' || mode === 'consult';
    const today = new Date().toISOString().slice(0, 10);
    const hasQuotes = c.quotes.length > 0;
    const noteErr = research && note.trim().length > 0 && note.trim().length < 10 ? 'Use at least 10 characters.' : '';
    const closingErr = closing && closing < today ? 'The closing date cannot be in the past.' : '';
    const needEstimate = !research && mode !== '' && budgetSum <= 0 && !(Number(estimate) > 0);
    const ok = mode !== '' && !noteErr && !closingErr && !needEstimate && (!research || note.trim().length >= 10);

    const save = () =>
        confirm.ask(
            {
                title: 'Record the review',
                message: research
                    ? 'The quotation stays open while the best method is researched or consulted on. No vendors can be invited until a mode of procurement is chosen.'
                    : `The mode of procurement is set to ${o.methods.find((m) => m.code === mode)?.label}. Vendors can then be invited and quotes recorded.`,
                confirmLabel: 'Save review',
            },
            async () => {
                await callBackend(`${API}/review`, { id: c.id, mode, note, estimateTotal: estimate, deviationReason: deviation, closingDate: closing });
            }
        );

    return (
        <div className='space-y-3'>
            {c.lines.map((l) => (
                <section key={l.no} className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                    <p className='text-sm font-semibold text-ink'>Item {l.no} · {l.requirement}</p>
                    <p className='text-xs text-muted'>{l.quantity} {l.unit} · {l.categoryName} / {l.subcategoryName}{l.budget ? ` · budget ${money(l.budget, c.currency)}` : ''}</p>
                    <p className='text-xs text-muted'>Needed by {l.dateRequired || '-'} · {l.costCenterName}{l.warehouseName ? ` · deliver to ${l.warehouseName}` : ''}</p>
                    {l.technical && <p className='text-xs text-soft'>{l.technical}</p>}
                    {l.lastPrice ? <LastPriceNote lp={l.lastPrice} /> : <p className='text-xs text-muted'>No earlier price on record for this item.</p>}
                    {l.attributeView.length > 0 && <p className='text-xs text-soft'>{l.attributeView.map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`).join(' · ')}</p>}
                </section>
            ))}

            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Review: how will this be bought?</h2>
                {sug && (
                    <Alert tone='info'>
                        For {money(c.authority.estimate, c.currency)} the chart of authority suggests <strong>{sug.sourcing.methodLabel}</strong>, with {sug.sourcing.minQuotes} quote(s) and {sug.sourcing.minEvaluators} evaluator(s), and {sug.approval.approvers} approver(s) on the cost.
                    </Alert>
                )}
                {!c.can.review ? (
                    <p className='text-sm text-ink'>{c.modeLabel ? `Mode of procurement: ${c.modeLabel}.` : 'No review has been recorded yet.'}{c.review.note ? ` ${c.review.note}` : ''}</p>
                ) : (
                    <>
                        <SelectField id='rv-mode' label='Mode of procurement *' value={mode} disabled={hasQuotes && !research} onChange={(e) => setMode(e.target.value)} hint={o.methods.find((m) => m.code === mode)?.note}>
                            <option value=''>Choose</option>
                            {o.methods.map((m) => (
                                <option key={m.code} value={m.code}>{m.label}</option>
                            ))}
                            <option value='research'>Not sure yet: research</option>
                            <option value='consult'>Not sure yet: consult</option>
                        </SelectField>
                        {research ? (
                            <label className='block'>
                                <span className='mb-1 block text-sm text-soft'>{mode === 'research' ? 'What is being researched? *' : 'Who is being consulted, and about what? *'}</span>
                                <textarea id='rv-note' value={note} maxLength={600} rows={3} onChange={(e) => setNote(e.target.value)} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                                {noteErr && <span className='text-xs text-red-400'>{noteErr}</span>}
                            </label>
                        ) : (
                            mode !== '' && (
                                <>
                                    <Field id='rv-est' label={`Estimated value (${c.currency})${budgetSum > 0 ? '' : ' *'}`} type='number' inputMode='decimal' min='0' step='any' value={estimate} onChange={(e) => setEstimate(e.target.value)} hint={budgetSum > 0 ? `Left empty, the budgets on the items are used: ${money(budgetSum, c.currency)}` : 'No budget was given on the items, so enter the estimate.'} />
                                    <Field id='rv-close' label='Closing date for quotes' type='date' min={today} value={closing} error={closingErr} onChange={(e) => setClosing(e.target.value)} />
                                    <label className='block'>
                                        <span className='mb-1 block text-sm text-soft'>Notes on the review</span>
                                        <textarea id='rv-note2' value={note} maxLength={600} rows={2} onChange={(e) => setNote(e.target.value)} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                                    </label>
                                    <label className='block'>
                                        <span className='mb-1 block text-sm text-soft'>Reason for choosing less competition than the chart asks for, or for single source</span>
                                        <textarea id='rv-dev' value={deviation} maxLength={600} rows={2} onChange={(e) => setDeviation(e.target.value)} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                                    </label>
                                </>
                            )
                        )}
                        <Button disabled={!ok} onClick={save}>Save review</Button>
                    </>
                )}
                {c.review.at && <p className='text-xs text-muted'>Reviewed by {c.review.byName} on {fmtDate(c.review.at)}.</p>}
            </section>
        </div>
    );
}

function VendorsTab({ c, confirm, onRecord }: { c: CaseOut; confirm: Confirm; onRecord: (vendorId: string) => void }) {
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<VendorHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [err, setErr] = useState('');
    const search = async (term: string) => {
        setQ(term);
        setErr('');
        if (term.trim().length < 2) {
            setHits([]);
            return;
        }
        setSearching(true);
        try {
            const out = await callBackend<{ items: VendorHit[] }>(`${API}/vendors`, { id: c.id, q: term });
            setHits(out.items.filter((h) => !c.invites.some((i) => i.vendorId === h.id)));
        } catch (e) {
            setErr(messageOf(e));
        } finally {
            setSearching(false);
        }
    };
    const invite = (h: VendorHit) =>
        confirm.ask(
            {
                title: `Invite ${h.name}`,
                message: h.scopeMatch === 'full' ? 'The vendor is approved for the subcategories of these items.' : h.scopeMatch === 'partial' ? 'The vendor is approved for only some of the subcategories of these items.' : 'The vendor is not approved for the subcategories of these items. Invite only if you are sure.',
                confirmLabel: 'Invite',
                tone: h.scopeMatch === 'none' ? 'danger' : 'primary',
            },
            async () => {
                await callBackend(`${API}/invite`, { id: c.id, vendorId: h.id });
                setHits([]);
                setQ('');
            }
        );
    const status = (i: Invite) => (i.status === 'received' ? 'Quote received' : i.status === 'declined' ? 'Declined' : i.status === 'no_response' ? 'No response' : 'Asked');

    return (
        <div className='space-y-3'>
            {c.status === 'reviewing' || c.status === 'researching' || c.status === 'consulting' ? <Alert tone='warn'>Decide the mode of procurement under Review before inviting vendors.</Alert> : null}
            {c.can.invite && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>Invite an approved vendor</h2>
                    <div className='relative'>
                        <Search className='pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted' />
                        <input aria-label='Search vendors' value={q} onChange={(e) => void search(e.target.value)} placeholder='Vendor name or number' className='h-12 w-full rounded-xl border border-line bg-panel pl-9 pr-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                    </div>
                    {err && <Alert tone='error'>{err}</Alert>}
                    {searching && <Spinner />}
                    {q.trim().length >= 2 && !searching && hits.length === 0 && <p className='text-xs text-muted'>No approved vendor matches.</p>}
                    {hits.length > 0 && (
                        <ul className='divide-y divide-line rounded-xl border border-line'>
                            {hits.map((h) => (
                                <li key={h.id}>
                                    <button type='button' onClick={() => invite(h)} className='flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left active:bg-page'>
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate text-sm text-ink'>{h.name}</span>
                                            <span className='block truncate text-xs text-muted'>{h.number} · {h.classLabel}{h.srmScore !== null ? ` · SRM ${h.srmScore}` : ''}</span>
                                        </span>
                                        <Badge tone={h.scopeMatch === 'full' ? 'brand' : h.scopeMatch === 'partial' ? 'warn' : 'danger'}>{h.scopeMatch === 'full' ? 'Matches' : h.scopeMatch === 'partial' ? 'Partly' : 'No match'}</Badge>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
            {c.invites.length === 0 && <p className='text-sm text-muted'>No vendors invited yet.</p>}
            {c.invites.map((i) => (
                <section key={i.vendorId} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <div className='flex items-start gap-2'>
                        <div className='min-w-0 flex-1'>
                            <p className='font-mono text-xs text-brandsoft'>{i.vendorNumber}</p>
                            <p className='truncate text-sm font-semibold text-ink'>{i.vendorName}</p>
                            <p className='text-xs text-muted'>{[i.classLabel, i.sourcingLabel, i.riskLabel].filter(Boolean).join(' · ')}</p>
                        </div>
                        <Badge tone={i.status === 'received' ? 'brand' : i.status === 'invited' ? 'warn' : 'muted'}>{status(i)}</Badge>
                    </div>
                    <p className='text-xs text-soft'>
                        {i.contactName || 'No contact on file'}
                        {i.contactPhone ? ` · ${i.contactPhone}` : ''}
                        {i.contactEmail ? ` · ${i.contactEmail}` : ''}
                    </p>
                    <p className='text-xs text-muted'>SRM score: {i.srmScore === null ? 'none (not scored)' : i.srmScore} · asked {fmtDate(i.invitedAt)} by {i.invitedBy}{i.note ? ` · ${i.note}` : ''}</p>
                    {i.scopeMatch !== 'full' && <p className='text-xs text-amber-400'>{i.scopeMatch === 'none' ? 'Not approved for these subcategories.' : 'Approved for only some of these subcategories.'}</p>}
                    {c.can.record && (
                        <div className='flex flex-wrap gap-2'>
                            <Button variant='secondary' onClick={() => onRecord(i.vendorId)}>{i.status === 'received' ? 'Change quote' : 'Record quote'}</Button>
                            {i.status !== 'received' && (
                                <>
                                    <Button variant='secondary' onClick={() => confirm.ask({ title: `${i.vendorName} declined`, message: 'Record that the vendor declined to quote.', confirmLabel: 'Record' }, async () => { await callBackend(`${API}/invite/update`, { id: c.id, vendorId: i.vendorId, action: 'declined' }); })}>Declined</Button>
                                    <Button variant='secondary' onClick={() => confirm.ask({ title: `${i.vendorName}: no response`, message: 'Record that the vendor did not respond by the closing date.', confirmLabel: 'Record' }, async () => { await callBackend(`${API}/invite/update`, { id: c.id, vendorId: i.vendorId, action: 'no_response' }); })}>No response</Button>
                                    <Button variant='danger' onClick={() => confirm.ask({ title: `Remove ${i.vendorName}`, message: 'The vendor is taken off this quotation.', confirmLabel: 'Remove', tone: 'danger' }, async () => { await callBackend(`${API}/invite/update`, { id: c.id, vendorId: i.vendorId, action: 'remove' }); })}>Remove</Button>
                                </>
                            )}
                        </div>
                    )}
                </section>
            ))}
        </div>
    );
}

function QuotesTab({ c, run, confirm, onEdit, setProblem }: { c: CaseOut; run: Run; confirm: Confirm; onEdit: (vendorId: string) => void; setProblem: (m: string) => void }) {
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState('');
    const upload = async (q: Quote, file: File | undefined) => {
        if (!file) return;
        setProblem('');
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return setProblem('Attach a PDF, JPEG or PNG file.');
        if (file.size > MAX_BYTES) return setProblem('That file is larger than 450 KB.');
        setBusy(q.id);
        await run(async () => {
            const data = await readFile(file);
            await callBackend(`${API}/quote/file/add`, { id: c.id, quoteId: q.id, name: file.name, type: file.type, data });
        }, 'Document attached.');
        setBusy('');
    };
    const view = (f: FileMeta) =>
        void run(async () => {
            const out = await callBackend<{ name: string; data: string }>(`${API}/quote/file`, { id: c.id, fileId: f.id });
            downloadDataUrl(out.data, out.name);
        });
    const technical = (q: Quote, preference: string) =>
        preference === 'not_acceptable'
            ? confirm.ask({ title: `Not acceptable: ${q.vendorName}`, message: 'The quote is left out of the ranking.', confirmLabel: 'Record', tone: 'danger', reason: { label: 'Why is it not acceptable?', minLength: 10 } }, async (reason) => { await callBackend(`${API}/technical`, { id: c.id, quoteId: q.id, preference, note: reason }); })
            : confirm.ask({ title: `${preference ? TECH_LABEL[preference] : 'Clear'}: ${q.vendorName}`, message: 'This is the technical team\'s view. Evaluator sign-offs lapse and are given again.', confirmLabel: 'Record' }, async () => { await callBackend(`${API}/technical`, { id: c.id, quoteId: q.id, preference }); });

    if (c.quotes.length === 0) return <p className='text-sm text-muted'>No quotes recorded yet. Record each vendor&apos;s quote from the Vendors tab.</p>;
    return (
        <div className='space-y-3'>
            {c.quotes.map((q) => {
                const isOpen = open[q.id] ?? false;
                return (
                    <section key={q.id} className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                        <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1'>
                                <p className='truncate text-sm font-semibold text-ink'>{q.vendorName}</p>
                                <p className='text-xs text-muted'>Ref {q.ref || '-'} · dated {q.date || '-'} · valid until {q.validUntil || '-'}</p>
                            </div>
                            <div className='text-right'>
                                <p className='text-sm font-semibold text-ink'>{money(q.total, q.currency)}</p>
                                {q.currency !== c.currency && q.base !== null && <p className='text-xs text-muted'>{money(q.base, c.currency)} at the quote rate</p>}
                                {q.currency !== c.currency && q.latestBase !== null && <p className='text-xs text-muted'>{money(q.latestBase, c.currency)} at the latest rate{c.ratesAsOf ? ` (${fmtDate(c.ratesAsOf)})` : ''}</p>}
                            </div>
                        </div>
                        <p className='text-xs text-soft'>{q.paymentTermsLabel || 'No payment terms'} · lead time {q.leadTimeDays ?? '-'} days{q.warrantyMonths !== null ? ` · warranty ${q.warrantyMonths} months` : ''}{q.discountPct ? ` · discount ${q.discountPct}%` : ''}</p>
                        {q.gaps.length > 0 ? <Alert tone='warn'>Not ranked yet. Missing: {q.gaps.join(', ')}.</Alert> : <p className='text-xs text-brandsoft'>All mandatory fields filled.</p>}
                        {q.tech.preference && <Badge tone={q.tech.preference === 'not_acceptable' ? 'danger' : 'brand'}>Technical: {TECH_LABEL[q.tech.preference]}</Badge>}
                        <button type='button' aria-expanded={isOpen} onClick={() => setOpen({ ...open, [q.id]: !isOpen })} className='flex min-h-11 items-center gap-1 text-xs text-brand'>
                            {isOpen ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />} Items and terms
                        </button>
                        {isOpen && (
                            <div className='space-y-2'>
                                <ul className='divide-y divide-line rounded-xl border border-line'>
                                    {q.lines.map((l) => {
                                        const cl = c.lines.find((x) => x.no === l.no);
                                        return (
                                            <li key={l.no} className='px-3 py-2 text-xs'>
                                                <p className='text-ink'>Item {l.no} · {cl?.requirement}</p>
                                                {cl?.lastPrice && l.bid !== false && <LastPriceNote lp={cl.lastPrice} now={Number(l.unitPrice) || undefined} nowCurrency={q.currency} />}
                                                {l.bid === false ? <p className='text-muted'>Not quoted</p> : <p className='text-muted'>{l.quantity} × {money(l.unitPrice, q.currency)}{l.discountPct ? ` less ${l.discountPct}%` : ''}{l.leadTimeDays !== null && l.leadTimeDays !== undefined ? ` · ${l.leadTimeDays} days` : ''}{l.brand ? ` · ${l.brand}` : ''}{l.origin ? ` · ${l.origin}` : ''}{l.compliance ? ` · meets spec: ${l.compliance}` : ''}</p>}
                                            </li>
                                        );
                                    })}
                                </ul>
                                <p className='text-xs text-muted'>{[q.incotermLabel, q.deliveryTerms, q.vatIncluded === null ? '' : q.vatIncluded ? 'Prices include VAT' : 'Prices exclude VAT', q.notes].filter(Boolean).join(' · ')}</p>
                            </div>
                        )}
                        <div className='space-y-1'>
                            <p className='text-xs font-medium text-soft'>Vendor document</p>
                            {q.attachments.length === 0 && <p className='text-xs text-amber-400'>None attached yet. It is mandatory.</p>}
                            {q.attachments.map((f) => (
                                <div key={f.id} className='flex items-center gap-1'>
                                    <button type='button' onClick={() => view(f)} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-brand'>
                                        <Download className='h-4 w-4 shrink-0' /> <span className='truncate'>{f.name}</span> <span className='shrink-0 text-xs text-muted'>{fileSize(f.size)}</span>
                                    </button>
                                    {c.can.record && (
                                        <button type='button' aria-label={`Remove ${f.name}`} onClick={() => confirm.ask({ title: 'Remove the document', message: f.name, confirmLabel: 'Remove', tone: 'danger' }, async () => { await callBackend(`${API}/quote/file/remove`, { id: c.id, fileId: f.id }); })} className='flex h-11 w-11 items-center justify-center text-red-400'>
                                            <X className='h-4 w-4' />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {c.can.record && q.attachments.length < 5 && (
                                <label className='flex min-h-11 cursor-pointer items-center gap-2 text-sm text-soft'>
                                    <Paperclip className='h-4 w-4' /> {busy === q.id ? 'Attaching' : 'Attach PDF, JPEG or PNG (up to 450 KB)'}
                                    <input type='file' accept='application/pdf,image/jpeg,image/png' className='sr-only' onChange={(e) => { void upload(q, e.target.files?.[0]); e.target.value = ''; }} />
                                </label>
                            )}
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            {c.can.record && (
                                <>
                                    <Button variant='secondary' onClick={() => onEdit(q.vendorId)}>
                                        <Pencil className='mr-1 h-4 w-4' /> Change
                                    </Button>
                                    <Button variant='danger' onClick={() => confirm.ask({ title: `Remove the quote of ${q.vendorName}`, message: 'The quote and its documents are deleted. Sign-offs lapse.', confirmLabel: 'Remove quote', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, async (reason) => { await callBackend(`${API}/quote/remove`, { id: c.id, quoteId: q.id, reason }); })}>
                                        <Trash2 className='mr-1 h-4 w-4' /> Remove
                                    </Button>
                                </>
                            )}
                        </div>
                        {c.can.technical && (
                            <div className='space-y-1'>
                                <p className='text-xs font-medium text-soft'>Technical team&apos;s view</p>
                                <div className='flex flex-wrap gap-2'>
                                    {(['preferred', 'acceptable', 'not_acceptable'] as const).map((p) => (
                                        <button key={p} type='button' aria-pressed={q.tech.preference === p} onClick={() => technical(q, q.tech.preference === p ? '' : p)} className={`min-h-11 rounded-xl border px-3 text-sm ${q.tech.preference === p ? 'border-brand bg-brand text-onbrand' : 'border-line text-soft'}`}>
                                            {TECH_LABEL[p]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function AnalysisTab({ c, o, confirm }: { c: CaseOut; o: Options; confirm: Confirm }) {
    const [choice, setChoice] = useState('');
    const [reason, setReason] = useState('');
    const [shortfall, setShortfall] = useState('');
    const [conflict, setConflict] = useState<'none' | 'declared'>('none');
    const [signNote, setSignNote] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const crit = c.evaluation.criteria.filter((k) => k.enabled && k.weight > 0);
    const eligible = c.ranking.filter((r) => r.eligible);
    const top = c.ranking.find((r) => r.rank === 1);
    const pick = choice || top?.quoteId || '';
    const notTop = !!top && pick !== '' && pick !== top.quoteId;
    const short = c.received < c.authority.minQuotes;
    const label = (code: string) => c.evaluation.criteria.find((k) => k.code === code)?.label ?? code;

    const recommend = () =>
        confirm.ask(
            {
                title: `Recommend ${c.ranking.find((r) => r.quoteId === pick)?.vendorName ?? 'this vendor'}`,
                message: `The quotation moves to Recommended. The chart of authority then shows who approves the spend of ${money(c.ranking.find((r) => r.quoteId === pick)?.base, c.currency)}. Quotes can no longer be changed unless it is reopened.`,
                confirmLabel: 'Recommend',
                acknowledge: 'I have checked the analysis and the vendor documents.',
            },
            async () => {
                await callBackend(`${API}/recommend`, { id: c.id, quoteId: pick, reason, shortfallReason: shortfall });
            }
        );
    const sign = () =>
        confirm.ask(
            { title: 'Sign off the evaluation', message: conflict === 'declared' ? 'You declare a conflict of interest. Your sign-off will not count towards the evaluators needed.' : 'You confirm you reviewed the quotes and have no conflict of interest.', confirmLabel: 'Sign off' },
            async () => {
                await callBackend(`${API}/sign`, { id: c.id, conflict, note: signNote, confirm: confirmed });
                setConfirmed(false);
                setSignNote('');
            }
        );

    return (
        <div className='space-y-3'>
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>How quotes are scored</h2>
                <ul className='space-y-1 text-xs text-soft'>
                    {crit.map((k) => (
                        <li key={k.code} className='flex items-center justify-between gap-2'>
                            <span>{k.label}</span>
                            <span className='text-muted'>{k.weight}% · {k.whenMissing === 'skip' ? 'skipped if no data' : 'zero if no data'}</span>
                        </li>
                    ))}
                </ul>
                <p className='text-xs text-muted'>Vendor class order (OEM, then OCM, then the rest) and these weights are set under Procurement setup{o.can.metrics ? '' : ' by the chart of authority administrator'}. Only complete quotes that cover every item are ranked.</p>
            </section>

            {c.ranking.length === 0 && <p className='text-sm text-muted'>No quotes to analyse yet.</p>}
            {c.ranking.map((r) => (
                <section key={r.quoteId} className={`space-y-2 rounded-2xl border bg-panel p-3 ${r.rank === 1 ? 'border-brand' : 'border-line'}`}>
                    <div className='flex items-start gap-2'>
                        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-sm font-semibold text-ink'>{r.rank ?? '-'}</div>
                        <div className='min-w-0 flex-1'>
                            <p className='truncate text-sm font-semibold text-ink'>{r.vendorName}</p>
                            <p className='text-xs text-muted'>{money(r.total, c.currency)}{r.base !== null && r.base !== r.total ? ` · ${money(r.base, c.currency)} in ${c.currency}` : ''}</p>
                        </div>
                        <div className='text-right'>
                            <p className='text-lg font-semibold text-ink'>{r.eligible ? r.score : '-'}</p>
                            <p className='text-xs text-muted'>score</p>
                        </div>
                    </div>
                    {r.flags.map((f) => (
                        <p key={f} className='text-xs text-amber-400'>{f}</p>
                    ))}
                    {r.eligible && (
                        <ul className='space-y-1'>
                            {crit.map((k) => {
                                const v = r.scores[k.code];
                                const used = r.used.includes(k.code);
                                return (
                                    <li key={k.code} className='text-xs'>
                                        <div className='flex justify-between text-soft'>
                                            <span>{k.label}</span>
                                            <span>{!used ? 'not scored' : v === null || v === undefined ? '0 (no data)' : v}</span>
                                        </div>
                                        <div className='h-1.5 overflow-hidden rounded-full bg-page'>
                                            <div className='h-full bg-brand' style={{ width: `${used && typeof v === 'number' ? Math.min(100, v) : 0}%` }} />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {r.eligible && r.skipped.length > 0 && <p className='text-xs text-muted'>Left out for this vendor because there is no data: {r.skipped.map(label).join(', ')}.</p>}
                </section>
            ))}

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Chart of authority</h2>
                <p className='text-xs text-soft'>
                    Estimate {money(c.authority.estimate, c.currency)} · {c.authority.minQuotes} quote(s) needed, {c.received} received · {c.authority.minEvaluators} evaluator sign-off(s) needed, {c.authority.validSigns} valid
                </p>
                {c.authority.approvers.length > 0 && (
                    <>
                        <p className='text-xs font-medium text-soft'>Approves the spend{c.authority.award !== null ? ` of ${money(c.authority.award, c.currency)}` : ' (on the estimate)'}</p>
                        <ol className='space-y-1'>
                            {c.authority.approvers.map((a) => (
                                <li key={a.code} className='rounded-xl border border-line px-3 py-2 text-xs'>
                                    <span className='font-mono text-brandsoft'>{a.code}</span> <span className='text-ink'>{a.title}</span>
                                    <span className='block text-muted'>{a.viaReportingLine ? 'The requester\'s immediate manager' : a.positionTitle ? `${a.positionTitle} (${a.positionCode}) · ${a.holders} holder${a.holders === 1 ? '' : 's'}` : 'No job role mapped yet. Map it under Setup > Authority limits > Approval levels.'}</span>
                                </li>
                            ))}
                        </ol>
                    </>
                )}
            </section>

            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Evaluators</h2>
                {c.signs.length === 0 && <p className='text-xs text-muted'>No one has signed off yet.</p>}
                {c.signs.map((x) => (
                    <p key={x.uid} className='text-xs text-soft'>
                        {x.name} · {fmtDate(x.at)} · {x.conflict === 'declared' ? 'conflict declared, does not count' : x.stale ? 'lapsed: quotes changed since' : 'counts'}
                    </p>
                ))}
                {c.can.sign && c.received > 0 && (
                    <div className='space-y-2 border-t border-line pt-2'>
                        <SelectField id='sg-conflict' label='Conflict of interest' value={conflict} onChange={(e) => setConflict(e.target.value as 'none' | 'declared')}>
                            <option value='none'>I have no conflict of interest</option>
                            <option value='declared'>I have a conflict of interest</option>
                        </SelectField>
                        {conflict === 'declared' && <Field id='sg-note' label='Describe the conflict *' maxLength={300} value={signNote} onChange={(e) => setSignNote(e.target.value)} />}
                        <label className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                            <input type='checkbox' checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className='h-5 w-5 accent-emerald-500' /> I reviewed the quotes and the analysis
                        </label>
                        <Button disabled={!confirmed || (conflict === 'declared' && signNote.trim().length < 10)} onClick={sign}>Sign off</Button>
                    </div>
                )}
            </section>

            {c.recommendation ? (
                <Alert tone='success'>
                    Recommended: {c.recommendation.vendorName}, {money(c.recommendation.total, c.currency)}, score {c.recommendation.score}. By {c.recommendation.byName} on {fmtDate(c.recommendation.at)}.{c.recommendation.reason ? ` ${c.recommendation.reason}` : ''}
                </Alert>
            ) : (
                c.can.recommend && (
                    <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                        <h2 className='text-sm font-semibold text-ink'>Recommend a quote</h2>
                        {eligible.length === 0 ? (
                            <p className='text-xs text-muted'>No quote can be recommended yet. A quote must be complete, cover every item, be within its validity and be accepted by the technical team.</p>
                        ) : (
                            <>
                                <SelectField id='rc-pick' label='Quote' value={pick} onChange={(e) => setChoice(e.target.value)}>
                                    {eligible.map((r) => (
                                        <option key={r.quoteId} value={r.quoteId}>{r.rank}. {r.vendorName} · {money(r.total)} · {r.score}</option>
                                    ))}
                                </SelectField>
                                {notTop && <Field id='rc-reason' label={`Why not ${top?.vendorName}, who ranks first? *`} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} hint='At least 20 characters' />}
                                {short && <Field id='rc-short' label={`Why fewer than ${c.authority.minQuotes} quotes? *`} maxLength={400} value={shortfall} onChange={(e) => setShortfall(e.target.value)} hint='At least 20 characters' />}
                                <Button disabled={!pick || (notTop && reason.trim().length < 20) || (short && shortfall.trim().length < 20)} onClick={recommend}>Recommend</Button>
                            </>
                        )}
                    </section>
                )
            )}
        </div>
    );
}

export default function Quotations({ id }: { id?: string }) {
    if (id && CASE_ID.test(id)) return <Case id={id} />;
    return <List />;
}
