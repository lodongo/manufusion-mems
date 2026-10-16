import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { downloadDataUrl } from '../lib/xlsx';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';

// Vendors (VND + 6 digits). A vendor is registered as a draft, submitted, and approved by someone who did not create
// or edit it. Classes (OEM, OCM, authorised distributor, general supplier ...), sourcing channels (single source, sole
// source, framework ...), documents, payment terms and risk ratings come from MEMS Modules > PRC > Metadata. For each of
// material, service and asset the vendor is limited to 10 subcategories the organization has approved in Setup.
// The server decides who may do what; this screen only shows what it is told is allowed.

const BASE = 'organization_home/procurement_vendors';
const API = '/api/org/procurement/vendors';
const VENDOR_ID = /^VND\d{6}$/;
const MAX_BYTES = 450 * 1024;

type Kind = 'material' | 'service' | 'asset';
type Stage = 'identity' | 'class' | 'scope' | 'finance' | 'compliance' | 'documents';

interface Cat {
    code: string;
    name: string;
    subcategories: Array<{ code: string; name: string }>;
}
interface Meta {
    code: string;
    label: string;
    description: string;
    needsAuthorisation?: boolean;
    needsJustification?: boolean;
    required?: boolean;
    expires?: boolean;
    forClasses?: string[];
}
interface Options {
    meta: { classes: Meta[]; sourcing: Meta[]; legalTypes: Meta[]; documents: Meta[]; paymentTerms: Meta[]; incoterms: Meta[]; risks: Meta[] };
    kinds: Array<{ kind: Kind; label: string; categories: Cat[] }>;
    maxPerKind: number;
    currency: string;
    currencies: Array<{ code: string; name: string }>;
    can: { manage: boolean; approve: boolean; override: boolean };
    limits: { documents: number; fileKb: number };
}
interface Row {
    id: string;
    number: string;
    legalName: string;
    tradeName: string;
    status: string;
    statusLabel: string;
    classLabel: string;
    sourcingLabel: string;
    riskLabel: string;
    kinds: string;
    scopeCount: number;
    country: string;
    taxPin: string;
    documentCount: number;
    expiringDocs: number;
    createdByName: string;
    updatedAt: string;
}
interface Scope {
    kind: Kind;
    categoryCode: string;
    categoryName: string;
    subcategoryCode: string;
    subcategoryName: string;
}
interface VDoc {
    id: string;
    typeCode: string;
    typeName: string;
    number: string;
    expiry: string;
    expires: boolean;
    name: string;
    type: string;
    size: number;
    uploadedAt: string;
    uploadedBy: string;
}
interface Flags {
    edit: boolean;
    submit: boolean;
    discard: boolean;
    decide: boolean;
    blocked: string;
    suspend: boolean;
    reinstate: boolean;
    reopen: boolean;
    seeBank: boolean;
    override: boolean;
}
interface Sla {
    id: string;
    ref: string;
    title: string;
    validFrom: string;
    validTo: string;
    status: 'active' | 'expired' | 'ended';
    categoryKeys: string[];
    maxLeadTimeDays: number;
    minWarrantyMonths: number;
    paymentTermsCode: string;
    paymentTermsLabel: string;
    notes: string;
    byName: string;
    at: string;
    endedAt: string;
    endReason: string;
}
interface Full extends Row {
    srmScore: number | null;
    srmAt: string;
    srmNote: string;
    canSrm: boolean;
    canSla: boolean;
    slas: Sla[];
    legalTypeCode: string;
    legalTypeLabel: string;
    registrationNumber: string;
    vatNumber: string;
    yearEstablished: number | null;
    website: string;
    classCode: string;
    sourcingCode: string;
    sourcingJustification: string;
    brands: string[];
    scopes: Scope[];
    contact: { name?: string; title?: string; email?: string; phone?: string };
    address: { country?: string; city?: string; street?: string };
    currencyCode: string;
    paymentTermsCode: string;
    paymentTermsLabel: string;
    incotermCode: string;
    incotermLabel: string;
    bank: { bankName?: string; branch?: string; accountName?: string; accountNumber?: string; swift?: string };
    conflict: string;
    conflictNotes: string;
    sanctionsScreened: boolean;
    riskCode: string;
    riskNotes: string;
    documents: VDoc[];
    history: Array<{ at: string; byName: string; action: string; note: string; from: string; to: string }>;
    overrides: Array<{ typeCode: string; typeName: string; reason: string; byName: string; at: string; expiresAt: string; resolved: boolean; active: boolean }>;
    missingDocs: Array<{ code: string; label: string }>;
    returnReason: string;
    suspendReason: string;
    gaps: string[];
    version: number;
    can: Flags;
    mine: boolean;
}
interface Form {
    legalName: string;
    tradeName: string;
    legalTypeCode: string;
    registrationNumber: string;
    taxPin: string;
    vatNumber: string;
    yearEstablished: string;
    website: string;
    classCode: string;
    sourcingCode: string;
    sourcingJustification: string;
    brands: string;
    scopes: Array<{ kind: Kind; categoryCode: string; subcategoryCode: string }>;
    contactName: string;
    contactTitle: string;
    contactEmail: string;
    contactPhone: string;
    country: string;
    city: string;
    street: string;
    currencyCode: string;
    paymentTermsCode: string;
    incotermCode: string;
    bankName: string;
    branch: string;
    accountName: string;
    accountNumber: string;
    swift: string;
    conflict: string;
    conflictNotes: string;
    sanctionsScreened: boolean;
    riskCode: string;
    riskNotes: string;
}

const KIND_NAME: Record<Kind, string> = { material: 'Materials', service: 'Services', asset: 'Assets' };
const KINDS: Kind[] = ['material', 'service', 'asset'];
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (s === 'approved' ? 'brand' : ['rejected', 'cancelled', 'suspended'].includes(s) ? 'danger' : ['returned', 'draft'].includes(s) ? 'warn' : 'muted');
const today = () => new Date().toISOString().slice(0, 10);

const STAGES: Array<{ value: Stage; label: string }> = [
    { value: 'identity', label: '1. Business' },
    { value: 'class', label: '2. Class and sourcing' },
    { value: 'scope', label: '3. What they supply' },
    { value: 'finance', label: '4. Contact and finance' },
    { value: 'compliance', label: '5. Compliance' },
    { value: 'documents', label: '6. Documents' },
];

const emptyForm = (currency: string): Form => ({
    legalName: '',
    tradeName: '',
    legalTypeCode: '',
    registrationNumber: '',
    taxPin: '',
    vatNumber: '',
    yearEstablished: '',
    website: '',
    classCode: '',
    sourcingCode: '',
    sourcingJustification: '',
    brands: '',
    scopes: [],
    contactName: '',
    contactTitle: '',
    contactEmail: '',
    contactPhone: '',
    country: '',
    city: '',
    street: '',
    currencyCode: currency,
    paymentTermsCode: '',
    incotermCode: '',
    bankName: '',
    branch: '',
    accountName: '',
    accountNumber: '',
    swift: '',
    conflict: '',
    conflictNotes: '',
    sanctionsScreened: false,
    riskCode: '',
    riskNotes: '',
});

const fromFull = (v: Full): Form => ({
    legalName: v.legalName,
    tradeName: v.tradeName,
    legalTypeCode: v.legalTypeCode,
    registrationNumber: v.registrationNumber,
    taxPin: v.taxPin,
    vatNumber: v.vatNumber,
    yearEstablished: v.yearEstablished === null ? '' : String(v.yearEstablished),
    website: v.website,
    classCode: v.classCode,
    sourcingCode: v.sourcingCode,
    sourcingJustification: v.sourcingJustification,
    brands: v.brands.join('\n'),
    scopes: v.scopes.filter((s, i, a) => a.findIndex((x) => x.kind === s.kind && x.categoryCode === s.categoryCode) === i).map((s) => ({ kind: s.kind, categoryCode: s.categoryCode, subcategoryCode: '' })),
    contactName: v.contact.name ?? '',
    contactTitle: v.contact.title ?? '',
    contactEmail: v.contact.email ?? '',
    contactPhone: v.contact.phone ?? '',
    country: v.address.country ?? '',
    city: v.address.city ?? '',
    street: v.address.street ?? '',
    currencyCode: v.currencyCode,
    paymentTermsCode: v.paymentTermsCode,
    incotermCode: v.incotermCode,
    bankName: v.bank.bankName ?? '',
    branch: v.bank.branch ?? '',
    accountName: v.bank.accountName ?? '',
    accountNumber: v.bank.accountNumber ?? '',
    swift: v.bank.swift ?? '',
    conflict: v.conflict,
    conflictNotes: v.conflictNotes,
    sanctionsScreened: v.sanctionsScreened,
    riskCode: v.riskCode,
    riskNotes: v.riskNotes,
});

function toBody(f: Form, id?: string): Record<string, unknown> {
    return {
        id: id || undefined,
        ...f,
        brands: f.brands
            .split('\n')
            .map((x) => x.trim())
            .filter(Boolean),
        bank: { bankName: f.bankName, branch: f.branch, accountName: f.accountName, accountNumber: f.accountNumber, swift: f.swift },
    };
}

const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const BY_EXT: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const MAX_CHARS = 600_000;

function dataUrl(blob: Blob, fileName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(`${fileName}: could not be read.`));
        reader.readAsDataURL(blob);
    });
}

// Phone photos are often several MB, so an image above the limit is scaled down here instead of being refused.
async function shrinkImage(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error(`${file.name}: the image could not be opened.`));
            el.src = url;
        });
        let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        for (let attempt = 0; attempt < 6; attempt++) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
            const g = canvas.getContext('2d');
            if (!g) break;
            g.fillStyle = '#ffffff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            g.drawImage(img, 0, 0, canvas.width, canvas.height);
            const out = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.8 - attempt * 0.15 : 0.5);
            if (out.length <= MAX_CHARS) return out;
            scale *= 0.75;
        }
        throw new Error(`${file.name}: the image is too large even after reducing it. Take a closer photo of the document.`);
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function readFile(file: File): Promise<{ name: string; type: string; data: string }> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const type = OK_TYPES.includes(file.type) ? file.type : BY_EXT[ext] ?? '';
    if (!type) throw new Error(`${file.name}: only PDF, JPEG or PNG files are accepted.`);
    if (file.size <= MAX_BYTES) {
        const raw = await dataUrl(file, file.name);
        return { name: file.name, type, data: `data:${type};base64,${raw.slice(raw.indexOf(',') + 1)}` };
    }
    if (type === 'application/pdf') throw new Error(`${file.name}: this PDF is ${Math.round(file.size / 1024)} KB and the limit is 450 KB. Compress it, or take a photo of the document instead.`);
    return { name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, type: 'image/jpeg', data: await shrinkImage(file) };
}

async function downloadDocument(id: string, docId: string) {
    const f = await callBackend<{ name: string; data: string }>(`${API}/document`, { id, docId });
    downloadDataUrl(f.data, f.name);
}

const COLUMNS: Array<Column<Row>> = [
    { key: 'number', label: 'Number', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'name', label: 'Legal name', value: (r) => r.legalName },
    { key: 'trade', label: 'Trade name', value: (r) => r.tradeName, hidden: true },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'class', label: 'Class', value: (r) => r.classLabel },
    { key: 'sourcing', label: 'Sourcing channel', value: (r) => r.sourcingLabel },
    { key: 'kinds', label: 'Supplies', value: (r) => r.kinds },
    { key: 'scopes', label: 'Categories', type: 'number', value: (r) => r.scopeCount },
    { key: 'risk', label: 'Risk', value: (r) => r.riskLabel },
    { key: 'country', label: 'Country', value: (r) => r.country },
    { key: 'pin', label: 'Tax PIN', value: (r) => r.taxPin, hidden: true },
    { key: 'docs', label: 'Documents', type: 'number', value: (r) => r.documentCount, hidden: true },
    { key: 'expiring', label: 'Expiring documents', type: 'number', value: (r) => r.expiringDocs },
    { key: 'by', label: 'Created by', value: (r) => r.createdByName, hidden: true },
    { key: 'updated', label: 'Updated', type: 'date', value: (r) => r.updatedAt.slice(0, 10), hidden: true },
];

// ----- What the vendor supplies: up to 10 approved categories, any mix of material, service and asset -----

function CategoryPicker({ kinds, chosen, max, onToggle }: { kinds: Array<{ kind: Kind; categories: Cat[] }>; chosen: Array<{ kind: Kind; categoryCode: string }>; max: number; onToggle: (kind: Kind, categoryCode: string) => void }) {
    const [q, setQ] = useState('');
    const full = chosen.length >= max;
    const has = (k: Kind, c: string) => chosen.some((s) => s.kind === k && s.categoryCode === c);
    const needle = q.trim().toLowerCase();
    return (
        <div className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
                <p className='text-sm font-semibold text-ink'>Categories chosen</p>
                <Badge tone={full ? 'warn' : 'muted'}>{chosen.length} of {max}</Badge>
            </div>
            <Field id='scope-q' label='Find a category' value={q} maxLength={40} onChange={(e) => setQ(e.target.value)} />
            {full && <p className='text-xs text-muted'>The limit is {max} categories. Untick one to choose another.</p>}
            {kinds.map((k) => {
                const list = k.categories.filter((c) => !needle || c.name.toLowerCase().includes(needle) || has(k.kind, c.code));
                return (
                    <section key={k.kind} className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                        <p className='text-sm font-semibold text-ink'>{KIND_NAME[k.kind]} <span className='text-xs font-normal text-muted'>({chosen.filter((s) => s.kind === k.kind).length} chosen)</span></p>
                        {!k.categories.length && <Alert tone='warn'>Your organization has not approved any {KIND_NAME[k.kind].toLowerCase()} categories yet. Ask the procurement setup administrator.</Alert>}
                        <div className='max-h-64 overflow-y-auto'>
                            {list.map((c) => {
                                const on = has(k.kind, c.code);
                                const blocked = !on && full;
                                return (
                                    <label key={c.code} className={`flex min-h-11 items-center gap-3 text-sm ${blocked ? 'text-muted' : 'cursor-pointer text-ink'}`}>
                                        <input type='checkbox' className='h-5 w-5 shrink-0 accent-emerald-500' checked={on} disabled={blocked} onChange={() => onToggle(k.kind, c.code)} />
                                        <span className='min-w-0 flex-1'>{c.name}</span>
                                    </label>
                                );
                            })}
                            {k.categories.length > 0 && !list.length && <p className='text-xs text-muted'>No category matches.</p>}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

// ----- Documents -----

function Documents({ vendor, options, reload }: { vendor: Full; options: Options; reload: () => void }) {
    const [typeCode, setTypeCode] = useState('');
    const [number, setNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const meta = options.meta.documents.find((x) => x.code === typeCode);
    const required = options.meta.documents.filter((t) => t.required === true && (!(t.forClasses ?? []).length || (t.forClasses ?? []).includes(vendor.classCode)));
    const have = new Set(vendor.documents.map((x) => x.typeCode));

    const add = async (list: File[]) => {
        if (!meta) return;
        if (!list.length) {
            setError('Your device did not pass the file on. Please choose it again.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            if (vendor.documents.length + list.length > options.limits.documents) throw new Error(`Attach up to ${options.limits.documents} documents.`);
            const files = await Promise.all(Array.from(list).map(readFile));
            for (const f of files) await callBackend(`${API}/document/add`, { id: vendor.id, typeCode, number, expiry, name: f.name, type: f.type, data: f.data });
            setNotice(`Attached ${files.length} document${files.length === 1 ? '' : 's'}.`);
            setNumber('');
            setExpiry('');
            reload();
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const drop = async (docId: string) => {
        setError('');
        try {
            await callBackend(`${API}/document/remove`, { id: vendor.id, docId });
            reload();
        } catch (e) {
            setError(messageOf(e));
        }
    };
    const needsExpiry = meta?.expires === true;
    const why = !meta ? 'Choose the document type first. The file button works after that.' : needsExpiry && !expiry ? 'This document type expires. Enter the expiry date first.' : '';
    const ready = !!meta && !why && !busy;

    return (
        <div className='space-y-3'>
            {error && <Alert tone='error'>{error}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Required for this vendor</h2>
                {!vendor.classCode && <p className='text-xs text-muted'>Choose the vendor class first (step 2) so the right documents are listed.</p>}
                <ul className='space-y-1'>
                    {required.map((t) => (
                        <li key={t.code} className='flex items-center gap-2 text-sm'>
                            <Badge tone={have.has(t.code) ? 'brand' : 'warn'}>{have.has(t.code) ? 'Attached' : vendor.overrides.some((x) => x.typeCode === t.code && x.active) ? 'Override' : 'Missing'}</Badge>
                            <span className='min-w-0 flex-1 text-ink'>{t.label}</span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Attach a document</h2>
                {notice && <Alert tone='success'>{notice}</Alert>}
                <SelectField id='doc-type' label='Document type' value={typeCode} onChange={(e) => setTypeCode(e.target.value)} hint={meta?.description}>
                    <option value=''>Choose</option>
                    {options.meta.documents.map((t) => (
                        <option key={t.code} value={t.code}>{t.label}{t.required === true && !(t.forClasses ?? []).length ? ' *' : ''}</option>
                    ))}
                </SelectField>
                <Field id='doc-number' label='Document number, optional' value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} />
                {needsExpiry && <Field id='doc-expiry' label='Expiry date' type='date' min={today()} value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
                {why && <p className='text-xs text-amber-400'>{why}</p>}
                {ready ? (
                    <label className='flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-brand px-4 text-sm font-medium text-brand'>
                        <Paperclip className='h-4 w-4' /> Choose file
                        <input
                            type='file'
                            accept='application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png'
                            className='sr-only'
                            onChange={(e) => {
                                // Copy the files first: clearing the input empties the live list on some phones.
                                const list = Array.from(e.target.files ?? []) as File[];
                                e.target.value = '';
                                void add(list);
                            }}
                        />
                    </label>
                ) : (
                    <button type='button' onClick={() => setError(busy ? 'Uploading, please wait.' : why)} className='flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm text-muted'>
                        <Paperclip className='h-4 w-4' /> {busy ? 'Uploading' : 'Choose file'}
                    </button>
                )}
                <p className='text-xs text-muted'>PDF, JPEG or PNG. Photos are reduced automatically; a PDF can be up to {options.limits.fileKb} KB. Cannot upload? A document override officer can grant a temporary override from the vendor page.</p>
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Attached ({vendor.documents.length})</h2>
                {!vendor.documents.length && <p className='text-xs text-muted'>Nothing attached yet.</p>}
                {vendor.documents.map((x) => (
                    <div key={x.id} className='flex items-center gap-1'>
                        <button type='button' onClick={() => void downloadDocument(vendor.id, x.id).catch((e) => setError(messageOf(e)))} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-brand'>
                            <FileText className='h-4 w-4 shrink-0' />
                            <span className='min-w-0 flex-1'>
                                <span className='block truncate'>{x.typeName}</span>
                                <span className='block truncate text-xs text-muted'>{x.name}{x.number ? ` · ${x.number}` : ''}{x.expiry ? ` · expires ${fmtDate(x.expiry)}` : ''}</span>
                            </span>
                        </button>
                        <button type='button' aria-label={`Remove ${x.typeName}`} onClick={() => void drop(x.id)} className='flex h-11 w-11 shrink-0 items-center justify-center text-red-400'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                ))}
            </section>
        </div>
    );
}

// ----- Registration form -----

function VendorForm({ id }: { id: string }) {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const vendor = useLoad<Full | null>(() => (id === 'new' ? Promise.resolve<Full | null>(null) : callBackend<Full>(`${API}/get`, { id })), [id]);
    const [f, setF] = useState<Form | null>(null);
    const [stage, setStage] = useState<Stage>('identity');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const seeded = useRef(false);

    useEffect(() => {
        if (seeded.current || !options.data || vendor.loading) return;
        if (id !== 'new' && !vendor.data) return;
        seeded.current = true;
        setF(vendor.data ? fromFull(vendor.data) : emptyForm(options.data.currency));
    }, [options.data, vendor.data, vendor.loading, id]);

    const back = () => navigate(id === 'new' ? BASE : `${BASE}/${id}`);
    if ((options.loading && !options.data) || (vendor.loading && !vendor.data && id !== 'new')) return <Spinner />;
    if (options.error || !options.data) return <Alert tone='error'>{options.error || 'Could not load the form.'}</Alert>;
    if (vendor.error) return <Alert tone='error'>{vendor.error}</Alert>;
    const o = options.data;
    if (!o.can.manage) {
        return (
            <Screen title='Vendor' onBack={back}>
                <Alert tone='warn'>You do not have permission to register or change vendors.</Alert>
            </Screen>
        );
    }
    if (vendor.data && !vendor.data.can.edit) {
        return (
            <Screen title={vendor.data.number} subtitle={vendor.data.legalName} onBack={back}>
                <Alert tone='warn'>This vendor can no longer be changed in its current status. If it is approved, reopen it from its page.</Alert>
            </Screen>
        );
    }
    if (!f) return <Spinner />;

    const set = (p: Partial<Form>) => setF((cur) => (cur ? { ...cur, ...p } : cur));
    const cls = o.meta.classes.find((c) => c.code === f.classCode);
    const src = o.meta.sourcing.find((c) => c.code === f.sourcingCode);
    const hasGoods = f.scopes.some((s) => s.kind !== 'service');

    const save = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const r = await callBackend<{ id: string }>(`${API}/save`, toBody(f, id === 'new' ? undefined : id));
            if (id === 'new') {
                navigate(`${BASE}/${r.id}/edit`);
                return;
            }
            setNotice('Saved as a draft. It is not sent for approval until you submit it from the vendor page.');
            vendor.reload();
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Screen
            title={id === 'new' ? 'Add vendor' : vendor.data?.number ?? id}
            subtitle={id === 'new' ? 'Registration' : vendor.data?.legalName}
            onBack={back}
            actions={<Button disabled={busy || f.legalName.trim().length < 3} onClick={() => void save()}>{busy ? 'Saving' : 'Save draft'}</Button>}
            toolbar={<Segmented label='Registration steps' value={stage} options={STAGES} onChange={(v) => (v === 'documents' && id === 'new' ? setError('Save the draft first, then attach documents.') : (setError(''), setStage(v)))} />}
        >
            {error && <Alert tone='error'>{error}</Alert>}
            {notice && <Alert tone='success'>{notice}</Alert>}
            {id !== 'new' && vendor.data?.returnReason && <Alert tone='warn'>{vendor.data.returnReason}</Alert>}

            {stage === 'identity' && (
                <>
                    <Field id='v-legal' label='Legal name *' value={f.legalName} maxLength={120} onChange={(e) => set({ legalName: e.target.value })} placeholder='As on the certificate of registration' />
                    <Field id='v-trade' label='Trade name, if different' value={f.tradeName} maxLength={120} onChange={(e) => set({ tradeName: e.target.value })} />
                    <SelectField id='v-legaltype' label='Legal type' value={f.legalTypeCode} onChange={(e) => set({ legalTypeCode: e.target.value })}>
                        <option value=''>Choose</option>
                        {o.meta.legalTypes.map((t) => (
                            <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                    </SelectField>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <Field id='v-reg' label='Registration number' value={f.registrationNumber} maxLength={30} onChange={(e) => set({ registrationNumber: e.target.value })} />
                        <Field id='v-pin' label='Tax PIN or TIN' value={f.taxPin} maxLength={20} onChange={(e) => set({ taxPin: e.target.value })} hint='A PIN already used by another vendor is refused.' />
                        <Field id='v-vat' label='VAT number, if registered' value={f.vatNumber} maxLength={20} onChange={(e) => set({ vatNumber: e.target.value })} />
                        <Field id='v-year' label='Year established' type='number' inputMode='numeric' value={f.yearEstablished} onChange={(e) => set({ yearEstablished: e.target.value })} />
                    </div>
                    <Field id='v-web' label='Website, optional' value={f.website} maxLength={200} onChange={(e) => set({ website: e.target.value })} placeholder='https://' />
                </>
            )}

            {stage === 'class' && (
                <>
                    <SelectField id='v-class' label='Vendor class' value={f.classCode} onChange={(e) => set({ classCode: e.target.value })} hint={cls?.description}>
                        <option value=''>Choose</option>
                        {o.meta.classes.map((c) => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                    </SelectField>
                    <SelectField id='v-source' label='Sourcing channel' value={f.sourcingCode} onChange={(e) => set({ sourcingCode: e.target.value })} hint={src?.description}>
                        <option value=''>Choose</option>
                        {o.meta.sourcing.map((c) => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                    </SelectField>
                    {src?.needsJustification === true && (
                        <label className='block'>
                            <span className='mb-1 block text-sm text-soft'>Justification for {src.label.toLowerCase()} *</span>
                            <textarea value={f.sourcingJustification} rows={4} maxLength={600} onChange={(e) => set({ sourcingJustification: e.target.value })} placeholder='Why is competition not possible or not wanted? For example proprietary design, warranty, standardisation or a named requirement.' className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                            <span className='text-xs text-muted'>{f.sourcingJustification.trim().length < 20 ? 'At least 20 characters are needed before you submit. ' : ''}{f.sourcingJustification.length}/600. The approver will read this.</span>
                        </label>
                    )}
                    <label className='block'>
                        <span className='mb-1 block text-sm text-soft'>Brands or manufacturers represented{cls?.needsAuthorisation === true ? ' *' : ', optional'}</span>
                        <textarea value={f.brands} rows={3} onChange={(e) => set({ brands: e.target.value })} placeholder='One per line, up to 10' className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />
                        {cls?.needsAuthorisation === true && <span className='text-xs text-muted'>This class needs a manufacturer authorisation letter for these brands (step 6).</span>}
                    </label>
                </>
            )}

            {stage === 'scope' && (
                <>
                    <Alert tone='info'>Tick the categories this vendor supplies, up to {o.maxPerKind} in total across materials, services and assets. Only categories your organization has approved in Procurement setup are listed.</Alert>
                    <CategoryPicker
                        kinds={KINDS.map((k) => ({ kind: k, categories: o.kinds.find((x) => x.kind === k)?.categories ?? [] }))}
                        chosen={f.scopes}
                        max={o.maxPerKind}
                        onToggle={(k, c) => set({ scopes: f.scopes.some((x) => x.kind === k && x.categoryCode === c) ? f.scopes.filter((x) => !(x.kind === k && x.categoryCode === c)) : [...f.scopes, { kind: k, categoryCode: c, subcategoryCode: '' }] })}
                    />
                </>
            )}

            {stage === 'finance' && (
                <>
                    <h2 className='text-sm font-semibold text-ink'>Contact</h2>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <Field id='v-cname' label='Contact person' value={f.contactName} maxLength={80} onChange={(e) => set({ contactName: e.target.value })} />
                        <Field id='v-ctitle' label='Job title' value={f.contactTitle} maxLength={80} onChange={(e) => set({ contactTitle: e.target.value })} />
                        <Field id='v-cemail' label='Email' type='email' inputMode='email' value={f.contactEmail} maxLength={120} onChange={(e) => set({ contactEmail: e.target.value })} />
                        <Field id='v-cphone' label='Phone' type='tel' inputMode='tel' value={f.contactPhone} maxLength={25} onChange={(e) => set({ contactPhone: e.target.value })} placeholder='+254 700 000 000' />
                        <Field id='v-country' label='Country' value={f.country} maxLength={60} onChange={(e) => set({ country: e.target.value })} />
                        <Field id='v-city' label='City or town' value={f.city} maxLength={60} onChange={(e) => set({ city: e.target.value })} />
                    </div>
                    <Field id='v-street' label='Address' value={f.street} maxLength={160} onChange={(e) => set({ street: e.target.value })} />
                    <h2 className='pt-2 text-sm font-semibold text-ink'>Trading terms</h2>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <SelectField id='v-cur' label='Trading currency' value={f.currencyCode} onChange={(e) => set({ currencyCode: e.target.value })}>
                            <option value=''>Choose</option>
                            {f.currencyCode && !o.currencies.some((x) => x.code === f.currencyCode) && <option value={f.currencyCode}>{f.currencyCode}</option>}
                            {o.currencies.map((x) => (
                                <option key={x.code} value={x.code}>{x.code}{x.name ? ` · ${x.name}` : ''}</option>
                            ))}
                        </SelectField>
                        <SelectField id='v-terms' label='Payment terms' value={f.paymentTermsCode} onChange={(e) => set({ paymentTermsCode: e.target.value })}>
                            <option value=''>Choose</option>
                            {o.meta.paymentTerms.map((t) => (
                                <option key={t.code} value={t.code}>{t.label}</option>
                            ))}
                        </SelectField>
                    </div>
                    {hasGoods && (
                        <SelectField id='v-inco' label='Incoterm (materials and assets)' value={f.incotermCode} onChange={(e) => set({ incotermCode: e.target.value })} hint={o.meta.incoterms.find((x) => x.code === f.incotermCode)?.description}>
                            <option value=''>Choose</option>
                            {o.meta.incoterms.map((t) => (
                                <option key={t.code} value={t.code}>{t.label}</option>
                            ))}
                        </SelectField>
                    )}
                    <h2 className='pt-2 text-sm font-semibold text-ink'>Bank account</h2>
                    <Alert tone='info'>Payments go only to the account named here. The account name should match the legal name. Any later change to bank details sends the vendor back for approval and is recorded.</Alert>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <Field id='v-bank' label='Bank' value={f.bankName} maxLength={80} onChange={(e) => set({ bankName: e.target.value })} />
                        <Field id='v-branch' label='Branch' value={f.branch} maxLength={80} onChange={(e) => set({ branch: e.target.value })} />
                        <Field id='v-acname' label='Account name' value={f.accountName} maxLength={120} onChange={(e) => set({ accountName: e.target.value })} />
                        <Field id='v-acno' label='Account number' value={f.accountNumber} maxLength={34} onChange={(e) => set({ accountNumber: e.target.value })} />
                        <Field id='v-swift' label='SWIFT or BIC, if paid abroad' value={f.swift} maxLength={11} onChange={(e) => set({ swift: e.target.value })} />
                    </div>
                </>
            )}

            {stage === 'compliance' && (
                <>
                    <SelectField id='v-risk' label='Risk rating' value={f.riskCode} onChange={(e) => set({ riskCode: e.target.value })} hint={o.meta.risks.find((x) => x.code === f.riskCode)?.description}>
                        <option value=''>Choose</option>
                        {o.meta.risks.map((t) => (
                            <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                    </SelectField>
                    <label className='block'>
                        <span className='mb-1 block text-sm text-soft'>Notes on the rating, optional</span>
                        <textarea value={f.riskNotes} rows={3} maxLength={600} onChange={(e) => set({ riskNotes: e.target.value })} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                    </label>
                    <fieldset className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                        <legend className='px-1 text-sm font-semibold text-ink'>Conflict of interest</legend>
                        <p className='text-xs text-muted'>Does anyone in your organization have a personal, family or financial interest in this vendor?</p>
                        {[
                            { v: 'none', label: 'No conflict of interest exists' },
                            { v: 'declared', label: 'A conflict of interest exists (give details)' },
                        ].map((x) => (
                            <label key={x.v} className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                                <input type='radio' name='conflict' className='h-5 w-5 accent-emerald-500' checked={f.conflict === x.v} onChange={() => set({ conflict: x.v })} />
                                {x.label}
                            </label>
                        ))}
                        {f.conflict === 'declared' && <textarea aria-label='Conflict details' value={f.conflictNotes} rows={3} maxLength={600} onChange={(e) => set({ conflictNotes: e.target.value })} placeholder='Who, and what the interest is' className='w-full rounded-xl border border-line bg-page p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none' />}
                    </fieldset>
                    <label className='flex min-h-11 items-start gap-3 rounded-xl border border-line bg-panel p-3 text-sm text-ink'>
                        <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={f.sanctionsScreened} onChange={(e) => set({ sanctionsScreened: e.target.checked })} />
                        <span>I have checked this vendor and its owners against sanctions and debarment lists, and found no match.</span>
                    </label>
                </>
            )}

            {stage === 'documents' && vendor.data && <Documents vendor={vendor.data} options={o} reload={vendor.reload} />}
        </Screen>
    );
}

// ----- Vendor page: read it, and act on it -----

function Line({ label, value }: { label: string; value: string | number | null | undefined }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div className='flex gap-2 text-sm'>
            <dt className='w-36 shrink-0 text-muted'>{label}</dt>
            <dd className='min-w-0 flex-1 break-words text-ink'>{value}</dd>
        </div>
    );
}

interface Totals {
    count: number;
    value: number;
    paid: number;
    pending: number;
}
interface OrderRow {
    id: string;
    number: string;
    status: string;
    statusLabel: string;
    date: string;
    total: number;
    currency: string;
    base: number;
    paid: number;
    pending: number;
}
interface OrdersOut {
    allowed: boolean;
    currency: string;
    totals: Totals;
    stages: Array<{ key: string; label: string } & Totals>;
    years: string[];
    byYear: Array<{ key: string } & Totals>;
    byMonth: Array<{ key: string } & Totals>;
    orders: OrderRow[];
}

const TABS = [
    { value: 'overview', label: 'Overview' },
    { value: 'orders', label: 'Purchase orders' },
    { value: 'sla', label: 'SLAs' },
    { value: 'srm_service', label: 'Service SRM' },
    { value: 'srm_spares', label: 'Spares SRM' },
];
const amount = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const ORDER_COLUMNS = (cur: string): Array<Column<OrderRow>> => [
    { key: 'number', label: 'PO number', value: (r) => r.number, render: (r) => <span className='font-mono text-xs'>{r.number}</span> },
    { key: 'status', label: 'Stage', value: (r) => r.statusLabel },
    { key: 'date', label: 'Date', type: 'date', value: (r) => r.date },
    { key: 'total', label: 'Order value', type: 'number', value: (r) => r.total, render: (r) => `${r.currency} ${amount(r.total)}` },
    { key: 'base', label: `Value (${cur})`, type: 'number', value: (r) => r.base },
    { key: 'paid', label: `Paid (${cur})`, type: 'number', value: (r) => r.paid },
    { key: 'pending', label: `Pending (${cur})`, type: 'number', value: (r) => r.pending },
];

function Tile({ label, value }: { label: string; value: string }) {
    return (
        <div className='rounded-xl border border-line bg-panel p-3'>
            <p className='text-xs text-muted'>{label}</p>
            <p className='text-base font-semibold text-ink'>{value}</p>
        </div>
    );
}

function PeriodTable({ title, rows, cur }: { title: string; rows: Array<{ key: string } & Totals>; cur: string }) {
    return (
        <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
            <h2 className='text-sm font-semibold text-ink'>{title}</h2>
            {!rows.length && <p className='text-xs text-muted'>Nothing to show yet.</p>}
            {rows.length > 0 && (
                <div className='max-h-72 overflow-auto'>
                    <table className='w-full text-left text-xs'>
                        <thead className='sticky top-0 bg-panel text-muted'>
                            <tr>
                                <th className='py-1 pr-2'>Period</th>
                                <th className='py-1 pr-2 text-right'>POs</th>
                                <th className='py-1 pr-2 text-right'>Value ({cur})</th>
                                <th className='py-1 pr-2 text-right'>Paid</th>
                                <th className='py-1 text-right'>Pending</th>
                            </tr>
                        </thead>
                        <tbody className='text-ink'>
                            {rows.map((r) => (
                                <tr key={r.key} className='border-t border-line'>
                                    <td className='py-1.5 pr-2'>{r.key}</td>
                                    <td className='py-1.5 pr-2 text-right'>{r.count}</td>
                                    <td className='py-1.5 pr-2 text-right'>{amount(r.value)}</td>
                                    <td className='py-1.5 pr-2 text-right'>{amount(r.paid)}</td>
                                    <td className='py-1.5 text-right'>{amount(r.pending)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

// Purchase orders raised against this supplier: a dashboard first, then the orders at each stage.
function Orders({ id }: { id: string }) {
    const { data, error, loading } = useLoad(() => callBackend<OrdersOut>(`${API}/orders`, { id }), [id]);
    const [stage, setStage] = useState('all');
    const [year, setYear] = useState('');
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load purchase orders.'}</Alert>;
    if (!data.allowed) return <Alert tone='info'>Purchase order values and payments are shown only to people who can view purchase orders.</Alert>;
    const cur = data.currency;
    const rows = data.orders.filter((r) => stage === 'all' || r.status === stage);
    const months = data.byMonth.filter((m) => !year || m.key.startsWith(year));
    return (
        <div className='space-y-3'>
            {data.totals.count === 0 && <Alert tone='info'>No purchase orders have been raised against this supplier yet. They appear here, with payments, as soon as they are.</Alert>}
            <div className='grid grid-cols-2 gap-2'>
                <Tile label='Total purchase orders' value={String(data.totals.count)} />
                <Tile label={`Total value (${cur})`} value={amount(data.totals.value)} />
                <Tile label={`Total paid (${cur})`} value={amount(data.totals.paid)} />
                <Tile label={`Total pending (${cur})`} value={amount(data.totals.pending)} />
            </div>
            <PeriodTable title='By stage' rows={data.stages.map((s) => ({ ...s, key: s.label }))} cur={cur} />
            <PeriodTable title='By year' rows={data.byYear} cur={cur} />
            <SelectField id='po-year' label='Months of' value={year} onChange={(e) => setYear(e.target.value)}>
                <option value=''>All years</option>
                {data.years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                ))}
            </SelectField>
            <PeriodTable title='By month' rows={months} cur={cur} />
            <Segmented label='Stage' value={stage} options={[{ value: 'all', label: 'All', count: data.totals.count }, ...data.stages.map((s) => ({ value: s.key, label: s.label, count: s.count }))]} onChange={setStage} />
            <RichTable id='prc.vendor.orders' title='Purchase orders' columns={ORDER_COLUMNS(cur)} rows={rows} rowKey={(r) => r.id} empty='No purchase orders at this stage.' fileName={`vendor-${id}-purchase-orders`} height='h-96' />
        </div>
    );
}

// Service level agreements agreed with this supplier. Every purchase order is compared with the active ones when it is validated.
function SlaPanel({ v, onDone }: { v: Full; onDone: (message: string) => void }) {
    const opts = useLoad(() => callBackend<Options>(`${API}/options`), []);
    const confirm = useConfirm();
    const blank = { title: '', ref: '', validFrom: today(), validTo: '', maxLeadTimeDays: '', minWarrantyMonths: '', paymentTermsCode: '', notes: '' };
    const [f, setF] = useState(blank);
    const [keys, setKeys] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState('');
    const cats = useMemo(() => {
        const seen = new Map<string, string>();
        for (const s of v.scopes) seen.set(`${s.kind}|${s.categoryCode}`, s.categoryName);
        return Array.from(seen.entries());
    }, [v.scopes]);
    const nameOf = (k: string) => cats.find((c) => c[0] === k)?.[1] ?? k.split('|')[1];
    const problems: string[] = [];
    if (f.title.trim().length < 3) problems.push('A title of at least 3 characters');
    if (!f.validFrom || !f.validTo) problems.push('Start and end dates');
    else if (f.validTo < f.validFrom) problems.push('An end date after the start date');
    else if (f.validTo < today()) problems.push('An end date that is not in the past');
    if (!f.maxLeadTimeDays && !f.minWarrantyMonths && !f.paymentTermsCode) problems.push('At least one term: longest lead time, shortest warranty or payment terms');
    const save = () =>
        confirm.ask(
            { title: 'Add service level agreement', message: `${f.title.trim()} with ${v.legalName}, ${f.validFrom} to ${f.validTo}. Orders for ${keys.length ? keys.map(nameOf).join(', ') : 'all categories'} will be compared with it.`, confirmLabel: 'Add agreement', acknowledge: 'I confirm these terms are as signed with the supplier.' },
            async () => {
                setError('');
                try {
                    await callBackend(`${API}/sla/add`, { id: v.id, ...f, categoryKeys: keys });
                    setF(blank);
                    setKeys([]);
                    setOpen(false);
                    onDone('Service level agreement added.');
                } catch (e) {
                    setError(messageOf(e));
                    throw e;
                }
            }
        );
    const end = (s: Sla) =>
        confirm.ask({ title: `End ${s.title}`, message: 'Orders will no longer be compared with this agreement.', confirmLabel: 'End agreement', tone: 'danger', reason: { label: 'Reason', minLength: 10, placeholder: 'Say why it ends' } }, async (reason) => {
            await callBackend(`${API}/sla/end`, { id: v.id, slaId: s.id, reason });
            onDone('Agreement ended.');
        });
    return (
        <div className='space-y-3'>
            {error && <Alert tone='error'>{error}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex items-center justify-between gap-2'>
                    <h2 className='text-sm font-semibold text-ink'>Service level agreements ({v.slas.length})</h2>
                    {v.canSla && !open && (
                        <Button onClick={() => setOpen(true)}>
                            <Plus className='mr-1 h-4 w-4' /> Add
                        </Button>
                    )}
                </div>
                {!v.slas.length && <p className='text-sm text-muted'>No agreements on file. Purchase orders for this supplier are validated without a service level comparison.</p>}
                {v.slas.map((s) => (
                    <div key={s.id} className='space-y-1 rounded-xl border border-line p-3'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <span className='font-mono text-xs text-muted'>{s.id}</span>
                            <span className='min-w-0 flex-1 text-sm font-medium text-ink'>{s.title}</span>
                            <Badge tone={s.status === 'active' ? 'brand' : s.status === 'expired' ? 'warn' : 'muted'}>{s.status === 'active' ? 'Active' : s.status === 'expired' ? 'Expired' : 'Ended'}</Badge>
                        </div>
                        <p className='text-xs text-soft'>
                            {s.validFrom} to {s.validTo}
                            {s.ref ? ` · ref ${s.ref}` : ''}
                        </p>
                        <ul className='text-xs text-ink'>
                            {s.maxLeadTimeDays > 0 && <li>Lead time at most {s.maxLeadTimeDays} day(s)</li>}
                            {s.minWarrantyMonths > 0 && <li>Warranty at least {s.minWarrantyMonths} month(s)</li>}
                            {s.paymentTermsCode && <li>Payment terms: {s.paymentTermsLabel || s.paymentTermsCode}</li>}
                            <li>Covers: {s.categoryKeys.length ? s.categoryKeys.map(nameOf).join(', ') : 'all categories supplied'}</li>
                        </ul>
                        {s.notes && <p className='text-xs text-muted'>{s.notes}</p>}
                        {s.status === 'ended' && <p className='text-xs text-muted'>Ended {fmtDate(s.endedAt)}: {s.endReason}</p>}
                        {v.canSla && s.status !== 'ended' && (
                            <button type='button' onClick={() => end(s)} className='min-h-11 text-sm text-red-400'>
                                End this agreement
                            </button>
                        )}
                    </div>
                ))}
            </section>
            {v.canSla && open && (
                <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>New agreement</h2>
                    <Field id='sla-title' label='Title *' value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} />
                    <Field id='sla-ref' label='Contract reference, optional' value={f.ref} maxLength={40} onChange={(e) => setF({ ...f, ref: e.target.value })} />
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='sla-from' label='Starts *' type='date' value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
                        <Field id='sla-to' label='Ends *' type='date' value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
                    </div>
                    <div className='grid grid-cols-2 gap-2'>
                        <Field id='sla-lead' label='Longest lead time (days)' inputMode='numeric' value={f.maxLeadTimeDays} onChange={(e) => setF({ ...f, maxLeadTimeDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                        <Field id='sla-war' label='Shortest warranty (months)' inputMode='numeric' value={f.minWarrantyMonths} onChange={(e) => setF({ ...f, minWarrantyMonths: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                    </div>
                    <SelectField id='sla-terms' label='Agreed payment terms' value={f.paymentTermsCode} onChange={(e) => setF({ ...f, paymentTermsCode: e.target.value })}>
                        <option value=''>Not part of the agreement</option>
                        {(opts.data?.meta.paymentTerms ?? []).map((t) => (
                            <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                    </SelectField>
                    <div className='space-y-1'>
                        <p className='text-sm text-soft'>Categories covered (none ticked means all)</p>
                        {cats.map(([k, name]) => (
                            <label key={k} className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                                <input type='checkbox' className='h-5 w-5 accent-emerald-500' checked={keys.includes(k)} onChange={(e) => setKeys(e.target.checked ? [...keys, k] : keys.filter((x) => x !== k))} />
                                {name}
                            </label>
                        ))}
                    </div>
                    <Field id='sla-notes' label='Notes, optional' value={f.notes} maxLength={400} onChange={(e) => setF({ ...f, notes: e.target.value })} />
                    {problems.length > 0 && (
                        <div className='text-xs text-amber-300'>
                            <p className='font-semibold'>Still needed:</p>
                            <ul className='list-disc pl-5'>
                                {problems.map((p) => (
                                    <li key={p}>{p}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className='flex gap-2'>
                        <Button disabled={problems.length > 0} onClick={save}>Add agreement</Button>
                        <Button variant='secondary' onClick={() => setOpen(false)}>Cancel</Button>
                    </div>
                </section>
            )}
            {confirm.sheet}
        </div>
    );
}

function Blank({ title, text }: { title: string; text: string }) {
    return (
        <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
            <h2 className='text-sm font-semibold text-ink'>{title}</h2>
            <p className='text-sm text-muted'>{text}</p>
        </section>
    );
}

// A temporary, time-limited waiver of a required document that cannot be uploaded. Needs its own permission and a written reason.
function OverridePanel({ v, onDone, onError }: { v: Full; onDone: (message: string) => void; onError: (message: string) => void }) {
    const [typeCode, setTypeCode] = useState('');
    const [reason, setReason] = useState('');
    const [sure, setSure] = useState(false);
    const [busy, setBusy] = useState(false);
    const ok = !!typeCode && reason.trim().length >= 20 && sure && !busy;
    const grant = async () => {
        setBusy(true);
        onError('');
        try {
            await callBackend(`${API}/document/override`, { id: v.id, typeCode, reason, confirm: true });
            setTypeCode('');
            setReason('');
            setSure(false);
            onDone('Temporary override granted for 30 days. The vendor can now be submitted; the approver will be told.');
        } catch (e) {
            onError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
            <h2 className='text-sm font-semibold text-ink'>Temporary document override</h2>
            <Alert tone='warn'>Use this only when a required document truly cannot be uploaded. It lasts 30 days, the approver must accept it, and it ends when the real document is attached. Everything is recorded.</Alert>
            <SelectField id='ov-type' label='Document that cannot be uploaded' value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
                <option value=''>Choose</option>
                {v.missingDocs.map((t) => (
                    <option key={t.code} value={t.code}>{t.label}</option>
                ))}
            </SelectField>
            <label className='block'>
                <span className='mb-1 block text-sm text-soft'>Why can it not be uploaded? *</span>
                <textarea value={reason} rows={3} maxLength={300} onChange={(e) => setReason(e.target.value)} className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink focus:border-brand focus:outline-none' />
                <span className='text-xs text-muted'>{reason.trim().length < 20 ? 'At least 20 characters. ' : ''}{reason.length}/300</span>
            </label>
            <label className='flex min-h-11 items-start gap-3 text-sm text-ink'>
                <input type='checkbox' className='mt-0.5 h-5 w-5 shrink-0 accent-emerald-500' checked={sure} onChange={(e) => setSure(e.target.checked)} />
                <span>I accept responsibility for this override and know the document is still outstanding.</span>
            </label>
            <Button disabled={!ok} onClick={() => void grant()}>{busy ? 'Saving' : 'Grant override'}</Button>
        </section>
    );
}

function Detail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Full>(`${API}/get`, { id }), [id]);
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const confirm = useConfirm();
    const [srm, setSrm] = useState({ open: false, score: '', note: '', busy: false });
    const [tab, setTab] = useState('overview');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Vendor not found.'}</Alert>;
    const v = data;
    const c = v.can;
    const act = (path: string, extra: Record<string, unknown>, done: string) => async (reason: string) => {
        await callBackend(`${API}/${path}`, { id, reason, ...extra });
        setNotice(done);
        reload();
    };

    const submit = () =>
        confirm.ask(
            { title: 'Submit for approval', message: `${v.legalName} will be sent to a vendor approver. You will not be able to change it until it is approved or returned.`, confirmLabel: 'Submit', acknowledge: 'I confirm the information is accurate and the documents are genuine.' },
            act('submit', { accuracy: true }, 'Submitted for approval.')
        );
    const approve = () => confirm.ask({ title: 'Approve vendor', message: `${v.legalName} will be allowed for purchasing. Bank details, documents and the risk rating are as shown on this page.`, confirmLabel: 'Approve', acknowledge: v.overrides.some((x) => !x.resolved) ? 'I have reviewed the vendor and I accept the temporary document override(s) listed on this page, knowing the documents are still outstanding.' : 'I have reviewed the vendor details, documents and conflict of interest answer.' }, act('approve', { acknowledgeOverrides: true }, 'Vendor approved.'));
    const withReason = (title: string, path: string, label: string, done: string, danger = false) =>
        confirm.ask({ title, message: `${v.number} ${v.legalName}`, confirmLabel: label, tone: danger ? 'danger' : 'primary', reason: { label: 'Reason', minLength: 10, placeholder: 'Say why' } }, act(path, {}, done));
    const discard = () => confirm.ask({ title: 'Discard draft', message: 'The draft and its documents will be removed. The number stays on record as cancelled.', confirmLabel: 'Discard', tone: 'danger' }, async () => {
        await callBackend(`${API}/discard`, { id });
        navigate(BASE);
    });

    const primary = c.edit ? (
        <Button onClick={() => navigate(`${BASE}/${id}/edit`)}>
            <Pencil className='mr-1 h-4 w-4' /> Edit
        </Button>
    ) : c.decide ? (
        <Button onClick={approve}>Approve</Button>
    ) : undefined;

    return (
        <Screen title={v.number} subtitle={v.legalName} onBack={() => navigate(BASE)} actions={primary} toolbar={['approved', 'suspended'].includes(v.status) ? <Segmented label='Supplier sections' value={tab} options={TABS} onChange={setTab} /> : undefined}>
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            <div className='flex flex-wrap items-center gap-2'>
                <Badge tone={tone(v.status)}>{v.statusLabel}</Badge>
                {v.riskLabel && <Badge tone={v.riskLabel === 'High' ? 'warn' : 'muted'}>{v.riskLabel} risk</Badge>}
                {v.expiringDocs > 0 && <Badge tone='warn'>{v.expiringDocs} document(s) expire within 30 days</Badge>}
            </div>
            {v.returnReason && <Alert tone='warn'>{v.returnReason}</Alert>}
            {v.suspendReason && <Alert tone='error'>Suspended: {v.suspendReason}</Alert>}
            {c.blocked && <Alert tone='info'>{c.blocked}</Alert>}
            {tab === 'orders' && <Orders id={v.id} />}
            {tab === 'sla' && <SlaPanel v={v} onDone={(m) => { setNotice(m); reload(); }} />}
            {tab === 'srm_service' && <Blank title='Service SRM' text='Service supplier relationship management is not set up yet. This section is ready for it.' />}
            {tab === 'srm_spares' && <Blank title='Spares SRM' text='Spares supplier relationship management is not set up yet. This section is ready for it.' />}
            {tab === 'overview' && (
                <>
            {c.override && v.missingDocs.length > 0 && <OverridePanel v={v} onDone={(m) => { setNotice(m); reload(); }} onError={setProblem} />}
            {v.overrides.length > 0 && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>Document overrides</h2>
                    {v.overrides.map((x, i) => (
                        <div key={`${x.typeCode}-${i}`} className='space-y-0.5 text-sm'>
                            <div className='flex items-center gap-2'>
                                <Badge tone={x.resolved ? 'brand' : x.active ? 'warn' : 'danger'}>{x.resolved ? 'Document attached' : x.active ? `Open until ${fmtDate(x.expiresAt)}` : 'Expired'}</Badge>
                                <span className='min-w-0 flex-1 text-ink'>{x.typeName}</span>
                            </div>
                            <p className='text-xs text-muted'>{x.byName} · {fmtDate(x.at)} · {x.reason}</p>
                        </div>
                    ))}
                </section>
            )}

            {(c.edit || c.decide || c.suspend || c.reinstate || c.reopen) && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>Actions</h2>
                    {c.edit && v.gaps.length > 0 && (
                        <div className='rounded-xl border border-line bg-page p-3'>
                            <p className='text-sm font-medium text-ink'>Still needed before you can submit</p>
                            <ul className='mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted'>
                                {v.gaps.map((g) => (
                                    <li key={g}>{g}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className='flex flex-wrap gap-2'>
                        {c.submit && <Button disabled={v.gaps.length > 0} onClick={submit}>Submit for approval</Button>}
                        {c.decide && <Button variant='secondary' onClick={() => withReason('Return for correction', 'return', 'Return', 'Returned for correction.')}>Return</Button>}
                        {c.decide && <Button variant='danger' onClick={() => withReason('Reject vendor', 'reject', 'Reject', 'Vendor rejected.', true)}>Reject</Button>}
                        {c.suspend && <Button variant='danger' onClick={() => withReason('Suspend vendor', 'suspend', 'Suspend', 'Vendor suspended.', true)}>Suspend</Button>}
                        {c.reinstate && <Button onClick={() => withReason('Reinstate vendor', 'reinstate', 'Reinstate', 'Vendor reinstated.')}>Reinstate</Button>}
                        {c.reopen && <Button variant='secondary' onClick={() => withReason('Reopen for change', 'reopen', 'Reopen', 'Vendor reopened. It cannot be used until approved again.')}>Change details</Button>}
                        {c.discard && <Button variant='danger' onClick={discard}><Trash2 className='mr-1 h-4 w-4' /> Discard</Button>}
                    </div>
                    {c.reopen && <p className='text-xs text-muted'>Changing an approved vendor sends it back for approval. It cannot be used for buying until it is approved again.</p>}
                </section>
            )}

            {(v.canSrm || v.srmScore !== null) && (
                <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>Supplier relationship (SRM) score</h2>
                    <p className='text-sm text-ink'>
                        {v.srmScore === null ? 'No score recorded. Quotation analysis does not score this vendor on SRM.' : `${v.srmScore} out of 100${v.srmNote ? ` · ${v.srmNote}` : ''}${v.srmAt ? ` · ${fmtDate(v.srmAt)}` : ''}`}
                    </p>
                    {v.canSrm && !srm.open && (
                        <Button variant='secondary' onClick={() => setSrm({ open: true, score: v.srmScore === null ? '' : String(v.srmScore), note: v.srmNote, busy: false })}>
                            {v.srmScore === null ? 'Record score' : 'Change score'}
                        </Button>
                    )}
                    {v.canSrm && srm.open && (
                        <div className='space-y-2'>
                            <Field id='srm-score' label='Score (0 to 100)' type='number' inputMode='decimal' min='0' max='100' step='any' value={srm.score} onChange={(e) => setSrm({ ...srm, score: e.target.value })} hint='Leave empty to clear the score' />
                            <Field id='srm-note' label='Where the score comes from' maxLength={200} value={srm.note} onChange={(e) => setSrm({ ...srm, note: e.target.value })} hint='For example: annual review 2026' />
                            <div className='flex gap-2'>
                                <Button
                                    disabled={srm.busy || (srm.score.trim() !== '' && (Number(srm.score) < 0 || Number(srm.score) > 100 || srm.note.trim().length < 5))}
                                    onClick={async () => {
                                        setSrm({ ...srm, busy: true });
                                        setProblem('');
                                        try {
                                            await callBackend('/api/org/procurement/vendors/srm', { id, score: srm.score, note: srm.note });
                                            setSrm({ open: false, score: '', note: '', busy: false });
                                            setNotice('SRM score saved.');
                                            reload();
                                        } catch (e) {
                                            setProblem(messageOf(e));
                                            setSrm({ ...srm, busy: false });
                                        }
                                    }}
                                >
                                    Save
                                </Button>
                                <Button variant='secondary' onClick={() => setSrm({ open: false, score: '', note: '', busy: false })}>Cancel</Button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <section className='space-y-1.5 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Business</h2>
                <dl className='space-y-1'>
                    <Line label='Legal name' value={v.legalName} />
                    <Line label='Trade name' value={v.tradeName} />
                    <Line label='Legal type' value={v.legalTypeLabel} />
                    <Line label='Registration' value={v.registrationNumber} />
                    <Line label='Tax PIN' value={v.taxPin} />
                    <Line label='VAT number' value={v.vatNumber} />
                    <Line label='Established' value={v.yearEstablished} />
                    <Line label='Website' value={v.website} />
                </dl>
            </section>
            <section className='space-y-1.5 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Class and sourcing</h2>
                <dl className='space-y-1'>
                    <Line label='Class' value={v.classLabel} />
                    <Line label='Sourcing channel' value={v.sourcingLabel} />
                    <Line label='Justification' value={v.sourcingJustification} />
                    <Line label='Brands' value={v.brands.join(', ')} />
                </dl>
            </section>
            <section className='space-y-1.5 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>What they supply</h2>
                {KINDS.map((k) => {
                    const list = v.scopes.filter((s) => s.kind === k);
                    if (!list.length) return null;
                    return (
                        <div key={k}>
                            <p className='text-xs font-semibold uppercase tracking-wide text-muted'>{KIND_NAME[k]} ({list.length})</p>
                            <ul className='mt-0.5 space-y-0.5 text-sm text-ink'>
                                {list.map((s) => (
                                    <li key={`${s.categoryCode}|${s.subcategoryCode}`}>{s.subcategoryName ? `${s.categoryName} › ${s.subcategoryName}` : s.categoryName}</li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
                {!v.scopes.length && <p className='text-sm text-muted'>Nothing chosen yet.</p>}
            </section>
            <section className='space-y-1.5 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Contact and finance</h2>
                <dl className='space-y-1'>
                    <Line label='Contact' value={[v.contact.name, v.contact.title].filter(Boolean).join(', ')} />
                    <Line label='Email' value={v.contact.email} />
                    <Line label='Phone' value={v.contact.phone} />
                    <Line label='Address' value={[v.address.street, v.address.city, v.address.country].filter(Boolean).join(', ')} />
                    <Line label='Currency' value={v.currencyCode} />
                    <Line label='Payment terms' value={v.paymentTermsLabel} />
                    <Line label='Incoterm' value={v.incotermLabel} />
                    <Line label='Bank' value={[v.bank.bankName, v.bank.branch].filter(Boolean).join(', ')} />
                    <Line label='Account name' value={v.bank.accountName} />
                    <Line label='Account number' value={v.bank.accountNumber} />
                    <Line label='SWIFT' value={v.bank.swift} />
                </dl>
            </section>
            <section className='space-y-1.5 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Compliance</h2>
                <dl className='space-y-1'>
                    <Line label='Conflict of interest' value={v.conflict === 'none' ? 'None declared' : v.conflict === 'declared' ? 'Declared' : ''} />
                    <Line label='Details' value={v.conflictNotes} />
                    <Line label='Sanctions check' value={v.sanctionsScreened ? 'Confirmed clear' : 'Not confirmed'} />
                    <Line label='Risk notes' value={v.riskNotes} />
                </dl>
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>Documents ({v.documents.length})</h2>
                {!v.documents.length && <p className='text-sm text-muted'>None attached.</p>}
                {v.documents.map((x) => (
                    <button key={x.id} type='button' onClick={() => void downloadDocument(v.id, x.id).catch((e) => setProblem(messageOf(e)))} className='flex min-h-11 w-full items-center gap-2 text-left text-sm text-brand'>
                        <Download className='h-4 w-4 shrink-0' />
                        <span className='min-w-0 flex-1'>
                            <span className='block truncate'>{x.typeName}</span>
                            <span className='block truncate text-xs text-muted'>{x.name}{x.number ? ` · ${x.number}` : ''}{x.expiry ? ` · expires ${fmtDate(x.expiry)}` : ''}</span>
                        </span>
                    </button>
                ))}
            </section>
            <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                <h2 className='text-sm font-semibold text-ink'>History</h2>
                <ul className='space-y-1.5'>
                    {[...v.history].reverse().map((h, i) => (
                        <li key={`${h.at}-${i}`} className='text-xs text-muted'>
                            <span className='font-medium text-ink'>{h.action}</span> by {h.byName || 'unknown'} · {fmtDate(h.at)}
                            {h.note ? <span className='block text-soft'>{h.note}</span> : null}
                        </li>
                    ))}
                </ul>
            </section>
                </>
            )}
            {confirm.sheet}
        </Screen>
    );
}

// ----- List -----

function List() {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const [view, setView] = useState('approved');
    const list = useLoad(() => callBackend<{ rows: Row[]; counts: Record<string, number> }>(`${API}/list`, { view }), [view]);
    const can = options.data?.can;
    const tabs = useMemo(() => {
        const counts = list.data?.counts ?? {};
        const all = [
            { value: 'approved', label: 'Approved vendors', show: true },
            { value: 'mine', label: 'Registered by me', show: !!can?.manage },
            { value: 'approvals', label: 'Needs my approval', show: !!can?.approve },
            { value: 'all', label: 'All vendors', show: !!can?.manage || !!can?.approve || !!can?.override },
        ];
        return all.filter((t) => t.show).map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }));
    }, [can, list.data]);

    return (
        <Screen
            title='Vendors'
            subtitle='Register, approve and maintain vendors'
            onBack={() => navigate('organization_home')}
            actions={
                can?.manage ? (
                    <Button onClick={() => navigate(`${BASE}/new`)}>
                        <Plus className='mr-1 h-4 w-4' /> Add vendor
                    </Button>
                ) : undefined
            }
            toolbar={<Segmented label='Views' value={view} options={tabs} onChange={setView} />}
        >
            {list.error ? (
                <Alert tone='error'>{list.error}</Alert>
            ) : list.loading && !list.data ? (
                <Spinner />
            ) : (
                <RichTable
                    id={`prc.vendors.${view}`}
                    title='Vendors'
                    columns={COLUMNS}
                    rows={list.data?.rows ?? []}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => navigate(`${BASE}/${r.id}`)}
                    empty={view === 'approvals' ? 'No vendor is waiting for your approval.' : can?.manage ? 'No vendors here yet. Use Add vendor to register one.' : 'No vendors here yet.'}
                    fileName={`vendors-${view}`}
                    height='h-[calc(100dvh-17rem)]'
                />
            )}
        </Screen>
    );
}

export default function Vendors({ id, sub }: { id?: string; sub?: string }) {
    if (id === 'new') return <VendorForm key='new' id='new' />;
    if (id && VENDOR_ID.test(id)) {
        if (sub === 'edit') return <VendorForm key={id} id={id} />;
        return <Detail id={id} />;
    }
    return <List />;
}
