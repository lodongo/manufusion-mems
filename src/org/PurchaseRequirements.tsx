import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Download, FileText, Paperclip, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { navigate } from '../lib/route';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Spinner, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';
import { Screen, Segmented, messageOf, useConfirm } from '../components/screen';
import { downloadDataUrl } from '../lib/xlsx';
import { downloadReportPdf } from '../lib/report';

// Purchase requirements (REQ + 9 digits). Anyone in the organization raises one. The requirement starts as a private
// draft; items are added one at a time and numbered 10, 20, 30 so they can become purchase order lines later. Each item
// is saved on its own: core details first (what, how many, when, cost center, GL account, urgency, budget), then the
// technical attributes of the chosen catalogue entry (mandatory ones first). When every item is complete the
// requester submits. The immediate manager approves; procurement acknowledges the start of offline quotation. No
// quotes are accepted here. The server decides who may do what; this screen only shows the actions it is told are allowed.

const BASE = 'organization_home/purchase_requirements';
const API = '/api/org/procurement/req';
const URGENCY_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', normal: 'Medium', critical: 'High' };
const KIND_NAME: Record<string, string> = { material: 'Material', service: 'Service', asset: 'Asset' };
const MAX_BYTES = 450 * 1024;
const REQ_ID = /^REQ\d{9}$/;

type Kind = 'material' | 'service' | 'asset';
type Stage = 'core' | 'technical';

interface Cat {
    code: string;
    name: string;
    subcategories: Array<{ code: string; name: string }>;
}
interface Options {
    kinds: Array<{ kind: Kind; label: string; categories: Cat[] }>;
    approver: { title: string; position: string; holders: number; problem: string };
    can: { approve: boolean; desk: boolean; viewAll: boolean; setup: boolean };
    limits: { lines: number; files: number; fileKb: number };
    units: Array<{ code: string; name: string; units: Array<{ code: string; label: string; symbol: string }> }>;
    costCenterTree: Array<{ id: string; parentId: string; level: string; code: string; name: string; selectable: boolean }>;
    glTree: Cat[];
    last: { costCenterId: string; glCode: string; glName: string } | null;
    currency: string;
    urgencies: string[];
    policy: { directToCostCenters: boolean };
}
interface Row {
    id: string;
    title: string;
    status: string;
    statusLabel: string;
    requester: string;
    submittedAt: string;
    updatedAt: string;
    lineCount: number;
    summary: string;
    kinds: string[];
    neededBy: string;
    urgency: string;
    budget: number;
    waitingOn: string;
    attachments: number;
}
interface Item {
    maintenanceSource?:{woCode:string;taskId:string;assessedRequirement?:Record<string,any>;proposedVendors?:Array<{id:string;name:string}>};
    no: number;
    type: Kind;
    categoryCode: string;
    categoryName: string;
    subcategoryCode: string;
    subcategoryName: string;
    familyCode?: string;
    familyName?: string;
    itemCode?: string;
    itemName?: string;
    master?: { code: string; name: string } | null;
    requirement: string;
    technical: string;
    attributes?: Record<string, unknown>;
    attributeView?: Array<{ code: string; name: string; value: string; unit: string }>;
    quantity: number;
    unit: string;
    uomCategoryCode?: string;
    uomCode?: string;
    dateRequired: string;
    urgency: string;
    budget?: number | null;
    costCenterId: string;
    costCenterCode: string;
    costCenterName: string;
    glCode: string;
    glName: string;
    source?: string;
    warehouseId?: string;
    warehouseName?: string;
    materialId?: string;
    missing?: string[];
    complete?: boolean;
}
interface Attachment {
    id: string;
    name: string;
    type: string;
    lineNo: number | null;
    size: number;
    uploadedAt: string;
    uploadedBy: string;
}
interface DetailFull extends Omit<Row, 'attachments'> {
    lines: Item[];
    attachments: Attachment[];
    history: Array<{ at: string; byName: string; action: string; note: string; from: string; to: string }>;
    approverTitle: string;
    returnReason: string;
    maintenance?: { woCode: string; taskId: string; description: string; quantity: number; supplierCategory: string; preferredVendor: { id: string; name: string } | null; supplierOnboarding: boolean; executionDate: string; planningGroup: string; raisedBy: string; attachments: Array<{ kind: string; url: string }> } | null;
    currency: string;
    version: number;
    mine: boolean;
    can: { edit: boolean; submit: boolean; discard: boolean; cancel: boolean; approve: boolean; reject: boolean; returnManager: boolean; acknowledge: boolean; returnDesk: boolean };
}
interface Attr {
    code: string;
    name: string;
    dataType: string;
    unit: string;
    options: Array<{ code: string; label: string }>;
    validation: Record<string, unknown>;
    required: boolean;
    description?: string;
    example?: string;
}
interface Spec {
    code: string;
    name: string;
    categoryCode: string;
    subcategoryCode: string;
    familyCode: string;
    attributes: Attr[];
    adopted: boolean;
    guidance?: { id: string; label: string; guidance: string; providers?: { usual: string[]; usualLabels?: string[]; note: string } } | null;
}
interface Tree {
    families: Array<{ code: string; name: string }>;
    items: Array<{ code: string; name: string; familyCode: string }>;
}
interface Core {
    type: Kind;
    categoryCode: string;
    subcategoryCode: string;
    familyCode: string;
    itemCode: string;
    itemName: string;
    requirement: string;
    quantity: string;
    uomCategoryCode: string;
    uomCode: string;
    dateRequired: string;
    urgency: string;
    budget: string;
    costCenterId: string;
    glCode: string;
    glName: string;
    source: 'description' | 'warehouse' | 'catalogue';
    warehouseId: string;
    warehouseName: string;
    materialId: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const tone = (s: string): 'brand' | 'muted' | 'danger' | 'warn' => (['approved', 'acknowledged', 'converted'].includes(s) ? 'brand' : ['rejected', 'cancelled'].includes(s) ? 'danger' : ['returned_user', 'draft'].includes(s) ? 'warn' : 'muted');
const urgencyTone = (u: string): 'brand' | 'muted' | 'danger' | 'warn' => (u === 'high' || u === 'critical' ? 'warn' : 'muted');
const money = (n: number, currency: string) => `${currency ? `${currency} ` : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function readFile(file: File): Promise<{ name: string; type: string; data: string }> {
    return new Promise((resolve, reject) => {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return reject(new Error(`${file.name}: only PDF, JPEG or PNG files are accepted.`));
        if (file.size > MAX_BYTES) return reject(new Error(`${file.name}: files can be up to 450 KB.`));
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result) });
        reader.onerror = () => reject(new Error(`${file.name}: could not be read.`));
        reader.readAsDataURL(file);
    });
}

async function uploadFiles(id: string, list: FileList | null, lineNo: number | null) {
    if (!list) return;
    const files = await Promise.all(Array.from(list).map(readFile));
    for (const f of files) await callBackend(`${API}/attachment/add`, { id, lineNo, name: f.name, type: f.type, data: f.data });
}

// ----- Lookup box (catalogue entries and GL accounts) -----

function Lookup({ label, path, body, onPick, placeholder }: { label: string; path: string; body?: Record<string, unknown>; onPick: (item: { code: string; name: string }) => void; placeholder: string }) {
    const [q, setQ] = useState('');
    const [items, setItems] = useState<Array<{ code: string; name: string }>>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const seq = useRef(0);
    useEffect(() => {
        const text = q.trim();
        if (text.length < 2) {
            setItems([]);
            setError('');
            return;
        }
        const mine = ++seq.current;
        const timer = setTimeout(() => {
            setBusy(true);
            callBackend<{ items: Array<{ code: string; name: string }> }>(path, { ...body, q: text })
                .then((r) => mine === seq.current && (setItems(r.items), setError('')))
                .catch((e) => mine === seq.current && setError(messageOf(e)))
                .finally(() => mine === seq.current && setBusy(false));
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [q, path, JSON.stringify(body)]);
    return (
        <div className='space-y-1'>
            <label className='block'>
                <span className='mb-1 block text-sm text-soft'>{label}</span>
                <span className='flex h-12 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                    <Search className='h-4 w-4 shrink-0 text-muted' />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
                    {busy && <span className='text-xs text-muted'>Searching</span>}
                </span>
            </label>
            {error && <p className='text-xs text-red-400'>{error}</p>}
            {items.length > 0 && (
                <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line bg-page'>
                    {items.map((i) => (
                        <li key={i.code}>
                            <button
                                type='button'
                                onClick={() => {
                                    onPick(i);
                                    setQ('');
                                    setItems([]);
                                }}
                                className='flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm active:bg-panel'
                            >
                                <span className='min-w-0 flex-1 truncate text-ink'>{i.name}</span>
                                <span className='font-mono text-xs text-muted'>{i.code}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ----- Cost center picker: type to search, or browse the hierarchy -----

type TreeNode = Options['costCenterTree'][number];

function CostCenterPicker({ tree, value, onChange }: { tree: TreeNode[]; value: string; onChange: (id: string) => void }) {
    const [q, setQ] = useState('');
    const [browse, setBrowse] = useState(false);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const byId = useMemo(() => new Map<string, TreeNode>(tree.map((n): [string, TreeNode] => [n.id, n])), [tree]);
    const kids = useMemo(() => {
        const m = new Map<string, TreeNode[]>();
        for (const n of tree) {
            const key = byId.has(n.parentId) ? n.parentId : '';
            m.set(key, [...(m.get(key) ?? []), n]);
        }
        return m;
    }, [tree, byId]);
    const pathOf = (id: string) => {
        const parts: string[] = [];
        let cur = byId.get(id);
        for (let g = 0; cur && g < 20; g++) {
            parts.unshift(cur.name);
            cur = byId.get(cur.parentId);
        }
        return parts.join(' > ');
    };
    const pick = (id: string) => {
        onChange(id);
        setQ('');
        setBrowse(false);
    };
    const term = q.trim().toLowerCase();
    const found = term.length < 2 ? [] : tree.filter((n) => n.selectable && `${n.code} ${n.name} ${pathOf(n.id)}`.toLowerCase().includes(term)).slice(0, 30);
    const level = (key: string, depth: number): ReactNode[] =>
        (kids.get(key) ?? []).flatMap((n) => {
            const children = kids.get(n.id) ?? [];
            const row = (
                <li key={n.id} className='flex min-h-11 items-center gap-1 pr-2' style={{ paddingLeft: depth * 16 }}>
                    {children.length ? (
                        <button type='button' aria-label={open[n.id] ? `Collapse ${n.name}` : `Expand ${n.name}`} aria-expanded={!!open[n.id]} onClick={() => setOpen((o) => ({ ...o, [n.id]: !o[n.id] }))} className='flex h-11 w-9 shrink-0 items-center justify-center text-muted'>
                            {open[n.id] ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
                        </button>
                    ) : (
                        <span className='w-9 shrink-0' />
                    )}
                    {n.selectable ? (
                        <button type='button' onClick={() => pick(n.id)} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm text-ink active:bg-panel'>
                            <span className='min-w-0 flex-1 truncate'>{n.name}</span>
                            <span className='font-mono text-xs text-muted'>{n.code}</span>
                        </button>
                    ) : (
                        <span className='min-w-0 flex-1 truncate px-2 text-sm text-muted'>{n.name}</span>
                    )}
                </li>
            );
            return [row, ...(open[n.id] ? level(n.id, depth + 1) : [])];
        });
    if (value) {
        return (
            <div className='flex items-end gap-2'>
                <span className='min-w-0 flex-1'>
                    <span className='mb-1 block text-sm text-soft'>Cost center</span>
                    <span className='flex min-h-12 items-center rounded-xl border border-line bg-panel px-3 py-1 text-sm text-ink'>{pathOf(value) || value}</span>
                </span>
                <button type='button' aria-label='Change cost center' onClick={() => onChange('')} className='flex h-12 w-12 items-center justify-center rounded-xl border border-line text-soft'>
                    <X className='h-4 w-4' />
                </button>
            </div>
        );
    }
    return (
        <div className='space-y-1'>
            <label className='block'>
                <span className='mb-1 block text-sm text-soft'>Cost center (type to search)</span>
                <span className='flex h-12 items-center gap-2 rounded-xl border border-line bg-panel px-3'>
                    <Search className='h-4 w-4 shrink-0 text-muted' />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Code, name or unit' className='h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted' />
                </span>
            </label>
            {found.length > 0 && (
                <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line bg-page'>
                    {found.map((n) => (
                        <li key={n.id}>
                            <button type='button' onClick={() => pick(n.id)} className='flex min-h-11 w-full flex-col justify-center px-3 py-1 text-left active:bg-panel'>
                                <span className='text-sm text-ink'>{n.name} <span className='font-mono text-xs text-muted'>{n.code}</span></span>
                                <span className='truncate text-xs text-muted'>{pathOf(n.id)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {term.length >= 2 && !found.length && <p className='text-xs text-muted'>No cost center matches. You only see cost centers you have access to.</p>}
            <button type='button' onClick={() => setBrowse((b) => !b)} className='min-h-11 text-sm text-brand'>{browse ? 'Hide hierarchy' : 'Browse the hierarchy'}</button>
            {browse && <ul className='max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-line bg-page py-1'>{level('', 0)}</ul>}
        </div>
    );
}

// ----- GL account picker: type to search, or browse by class and category -----

function GlPicker({ costCenterId, code, name, onChange }: { costCenterId: string; code: string; name: string; onChange: (code: string, name: string) => void }) {
    const [browse, setBrowse] = useState(false);
    const [tree, setTree] = useState<Cat[]>([]);
    useEffect(() => {
        setTree([]);
        if (!browse || !costCenterId) return;
        let alive = true;
        callBackend<{ tree: Cat[] }>(`${API}/gl`, { costCenterId, tree: true })
            .then((r) => alive && setTree(r.tree ?? []))
            .catch(() => alive && setTree([]));
        return () => {
            alive = false;
        };
    }, [browse, costCenterId]);
    const [cls, setCls] = useState('');
    const [cat, setCat] = useState('');
    const [items, setItems] = useState<Array<{ code: string; name: string }>>([]);
    const [error, setError] = useState('');
    useEffect(() => {
        setItems([]);
        setError('');
        if (!browse || !cls || !cat) return;
        let alive = true;
        callBackend<{ items: Array<{ code: string; name: string }> }>(`${API}/gl`, { costCenterId, categoryCode: cls, subcategoryCode: cat })
            .then((r) => alive && setItems(r.items))
            .catch((e) => alive && setError(messageOf(e)));
        return () => {
            alive = false;
        };
    }, [browse, cls, cat, costCenterId]);
    if (code) {
        return (
            <div className='flex items-end gap-2'>
                <span className='min-w-0 flex-1'>
                    <span className='mb-1 block text-sm text-soft'>GL account</span>
                    <span className='flex min-h-12 items-center rounded-xl border border-line bg-panel px-3 py-1 text-sm text-ink'>{name} <span className='ml-1 font-mono text-xs text-muted'>{code}</span></span>
                </span>
                <button type='button' aria-label='Change GL account' onClick={() => onChange('', '')} className='flex h-12 w-12 items-center justify-center rounded-xl border border-line text-soft'>
                    <X className='h-4 w-4' />
                </button>
            </div>
        );
    }
    const subs = tree.find((c) => c.code === cls)?.subcategories ?? [];
    return (
        <div className='space-y-1'>
            {!costCenterId && <p className='text-xs text-amber-300'>Choose the cost center first: only GL accounts approved for its legal entity can be used.</p>}
            <Lookup label='GL account (type to search)' path={`${API}/gl`} body={{ costCenterId }} placeholder='Code or name' onPick={(i) => onChange(i.code, i.name)} />
            <button type='button' onClick={() => setBrowse((b) => !b)} className='min-h-11 text-sm text-brand'>{browse ? 'Hide browse' : 'Browse by class and category'}</button>
            {browse && (
                <div className='space-y-2 rounded-xl border border-line bg-page p-3'>
                    <div className='grid grid-cols-2 gap-2'>
                        <SelectField id='gl-class' label='Account class' value={cls} onChange={(e) => { setCls(e.target.value); setCat(''); }}>
                            <option value=''>Choose</option>
                            {tree.map((c) => (
                                <option key={c.code} value={c.code}>{c.name}</option>
                            ))}
                        </SelectField>
                        <SelectField id='gl-cat' label='Category' value={cat} disabled={!cls} onChange={(e) => setCat(e.target.value)}>
                            <option value=''>Choose</option>
                            {subs.map((s) => (
                                <option key={s.code} value={s.code}>{s.name}</option>
                            ))}
                        </SelectField>
                    </div>
                    {error && <p className='text-xs text-red-400'>{error}</p>}
                    {cls && cat && !items.length && !error && <p className='text-xs text-muted'>No accounts in this category.</p>}
                    {items.length > 0 && (
                        <ul className='max-h-56 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line'>
                            {items.map((i) => (
                                <li key={i.code}>
                                    <button type='button' onClick={() => onChange(i.code, i.name)} className='flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm active:bg-panel'>
                                        <span className='min-w-0 flex-1 truncate text-ink'>{i.name}</span>
                                        <span className='font-mono text-xs text-muted'>{i.code}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

// ----- One technical attribute -----

function AttrInput({ a, value, onChange }: { a: Attr; value: unknown; onChange: (v: unknown) => void }) {
    const id = `attr-${a.code}`;
    const label = `${a.name}${a.required ? ' * (required)' : ''}${a.unit ? ` (${a.unit})` : ''}`;
    // Plain guidance from the catalogue (where to find the value), so nobody has to guess.
    const hint = [a.description, a.example ? `Example: ${a.example}.` : ''].filter(Boolean).join(' ') || undefined;
    const placeholder = a.example ? `e.g. ${a.example}` : undefined;
    const min = typeof a.validation.minimum === 'number' ? a.validation.minimum : undefined;
    const max = typeof a.validation.maximum === 'number' ? a.validation.maximum : undefined;
    const maxLength = typeof a.validation.maxLength === 'number' ? Math.min(a.validation.maxLength, 2000) : 500;
    if (a.dataType === 'enum') {
        return (
            <SelectField id={id} label={label} hint={hint} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
                <option value=''>Choose</option>
                {a.options.map((o) => (
                    <option key={o.code} value={o.code}>{o.label}</option>
                ))}
            </SelectField>
        );
    }
    if (a.dataType === 'multi_select') {
        const chosen = Array.isArray(value) ? value.map(String) : [];
        return (
            <fieldset className='space-y-0'>
                <legend className='mb-1 text-sm text-soft'>{label}</legend>
                {hint && <p className='mb-1 text-xs text-muted'>{hint}</p>}
                {a.options.map((o) => (
                    <label key={o.code} className='flex min-h-11 items-center gap-3 text-sm text-ink'>
                        <input type='checkbox' checked={chosen.includes(o.code)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.code] : chosen.filter((c) => c !== o.code))} className='h-5 w-5 shrink-0 accent-emerald-500' />
                        {o.label}
                    </label>
                ))}
            </fieldset>
        );
    }
    if (a.dataType === 'boolean') {
        return (
            <SelectField id={id} label={label} hint={hint} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'true')}>
                <option value=''>Choose</option>
                <option value='true'>Yes</option>
                <option value='false'>No</option>
            </SelectField>
        );
    }
    if (a.dataType === 'integer' || a.dataType === 'decimal') {
        return <Field id={id} label={label} hint={hint} placeholder={placeholder} type='number' inputMode='decimal' step={a.dataType === 'integer' ? '1' : 'any'} min={min} max={max} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />;
    }
    if (a.dataType === 'date') return <Field id={id} label={label} hint={hint} type='date' value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
    if (a.dataType === 'country' || a.dataType === 'currency') {
        return <Field id={id} label={label} hint={hint} maxLength={a.dataType === 'country' ? 2 : 3} value={typeof value === 'string' ? value : ''} placeholder={a.dataType === 'country' ? 'Two-letter code, for example KE' : 'Three-letter code, for example KES'} onChange={(e) => onChange(e.target.value.toUpperCase())} />;
    }
    return <Field id={id} label={label} hint={hint} placeholder={placeholder} maxLength={maxLength} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />;
}

// ----- Item editor: core details first, then technical details. Each save stores this one item. -----

const STAGES: Array<{ value: Stage; label: string }> = [
    { value: 'core', label: '1. Core details' },
    { value: 'technical', label: '2. Technical details' },
];

function coreProblems(f: Core, o: Options): string[] {
    const out: string[] = [];
    const cats = o.kinds.find((k) => k.kind === f.type)?.categories ?? [];
    if (!cats.find((c) => c.code === f.categoryCode)?.subcategories.some((s) => s.code === f.subcategoryCode)) out.push('Choose a category and subcategory.');
    if (f.requirement.trim().length < 3) out.push('Say what is required.');
    if (f.type !== 'service' && !f.uomCode) out.push('Choose the unit of measure.');
    if (f.type !== 'service' && !(Number(f.quantity) > 0)) out.push('Enter a quantity.');
    if (!f.dateRequired) out.push('Enter the date required.');
    else if (f.dateRequired < today()) out.push('The date required cannot be in the past.');
    if (f.budget.trim() !== '' && !(Number(f.budget) >= 0)) out.push('Enter a budget of zero or more, or leave it empty.');
    if (!f.costCenterId) out.push('Choose a cost center.');
    if (!f.glCode) out.push('Choose a GL account.');
    if (f.source === 'warehouse' && !f.materialId) out.push('Pick the material from a warehouse, or switch to Description.');
    return out;
}

interface Wh {
    id: string;
    code: string;
    name: string;
    matches: boolean;
}

// Where the material is delivered. When the buying rules prohibit direct purchase for other cost centers, only warehouses
// that hold this material type are listed. The server checks the same rule again.
function DeliverTo({ categoryCode, value, onChange }: { categoryCode: string; value: string; onChange: (id: string) => void }) {
    const [list, setList] = useState<Wh[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        setList(null);
        setError('');
        if (!categoryCode) return;
        let alive = true;
        callBackend<{ items: Wh[] }>(`${API}/warehouses`, { categoryCode })
            .then((r) => alive && setList(r.items))
            .catch((e) => alive && setError(messageOf(e)));
        return () => {
            alive = false;
        };
    }, [categoryCode]);
    return (
        <div className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
            <p className='text-sm font-semibold text-ink'>Deliver to warehouse</p>
            <p className='text-xs text-muted'>Your organization buys materials only for warehouses that hold this material type.</p>
            {error && <Alert tone='error'>{error}</Alert>}
            {!categoryCode ? (
                <Alert tone='info'>Choose the category first. The warehouses that hold it will be listed here.</Alert>
            ) : !list && !error ? (
                <Spinner />
            ) : list && list.length === 0 ? (
                <Alert tone='warn'>No warehouse is set up to hold this material type. Ask the warehouse administrator to add it to a warehouse.</Alert>
            ) : (
                <SelectField id='item-deliver' label='Warehouse' value={value} onChange={(e) => onChange(e.target.value)}>
                    <option value=''>Choose</option>
                    {(list ?? []).map((w) => (
                        <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                </SelectField>
            )}
        </div>
    );
}

// Pick a material that is already stocked in any warehouse of the organization.
function WarehousePick({ subcategoryCode, warehouseId, materialId, materialName, onWarehouse, onMaterial }: { subcategoryCode: string; warehouseId: string; materialId: string; materialName: string; onWarehouse: (id: string, name: string) => void; onMaterial: (i: { code: string; name: string }) => void }) {
    const [list, setList] = useState<Wh[] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let alive = true;
        callBackend<{ items: Wh[] }>(`${API}/warehouses`, { mode: 'browse' })
            .then((r) => alive && setList(r.items))
            .catch((e) => alive && setError(messageOf(e)));
        return () => {
            alive = false;
        };
    }, []);
    return (
        <div className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
            <p className='text-sm font-semibold text-ink'>Material from a warehouse</p>
            {error && <Alert tone='error'>{error}</Alert>}
            {!list && !error && <Spinner />}
            {list && (
                <SelectField id='item-source-wh' label='Warehouse to pick from' value={warehouseId} onChange={(e) => onWarehouse(e.target.value, list.find((w) => w.id === e.target.value)?.name ?? '')} hint='Any warehouse of your organization. This only says where the material is stocked, not where it is delivered.'>
                    <option value=''>Choose</option>
                    {list.map((w) => (
                        <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                    ))}
                </SelectField>
            )}
            {warehouseId && <Lookup label='Find the material by number or name' path={`${API}/warehouse/materials`} body={{ warehouseId, subcategoryCode }} placeholder='Type at least 2 characters' onPick={onMaterial} />}
            {materialId && <Alert tone='success'>Selected: {materialName || materialId}</Alert>}
        </div>
    );
}

function ItemEditor({ id, no }: { id: string; no: string }) {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const req = useLoad(() => callBackend<DetailFull>(`${API}/get`, { id }), [id]);
    const [f, setF] = useState<Core | null>(null);
    const [technical, setTechnical] = useState('');
    const [attrs, setAttrs] = useState<Record<string, unknown>>({});
    const [savedNo, setSavedNo] = useState(0);
    const [stage, setStage] = useState<Stage>('core');
    const [tree, setTree] = useState<Tree | null>(null);
    const [treeError, setTreeError] = useState('');
    const [spec, setSpec] = useState<Spec | null>(null);
    const [specError, setSpecError] = useState('');
    const [showOptional, setShowOptional] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const seeded = useRef(false);

    useEffect(() => {
        if (seeded.current || !options.data || !req.data) return;
        seeded.current = true;
        const d = req.data;
        const o = options.data;
        const existing = no === 'new' ? undefined : d.lines.find((l) => String(l.no) === no);
        if (no !== 'new' && !existing) {
            setError('That item does not exist.');
            return;
        }
        if (existing) {
            setF({
                type: existing.type,
                categoryCode: existing.categoryCode,
                subcategoryCode: existing.subcategoryCode,
                familyCode: existing.familyCode ?? '',
                itemCode: existing.itemCode ?? '',
                itemName: existing.itemName ?? '',
                requirement: existing.requirement,
                quantity: String(existing.quantity),
                uomCategoryCode: existing.uomCategoryCode ?? '',
                uomCode: existing.uomCode ?? '',
                dateRequired: existing.dateRequired,
                urgency: existing.urgency,
                budget: existing.budget === null || existing.budget === undefined ? '' : String(existing.budget),
                costCenterId: existing.costCenterId,
                glCode: existing.glCode,
                glName: existing.glName,
                source: existing.source === 'warehouse' || existing.source === 'description' || existing.source === 'catalogue' ? existing.source : existing.itemCode ? 'catalogue' : 'description',
                warehouseId: existing.warehouseId ?? '',
                warehouseName: existing.warehouseName ?? '',
                materialId: existing.materialId ?? '',
            });
            setTechnical(existing.technical ?? '');
            setAttrs(existing.attributes ?? {});
            setSavedNo(existing.no);
        } else {
            // A new item starts from the previous item's type, cost center and GL account.
            const prev = d.lines[d.lines.length - 1];
            setF({
                type: prev?.type ?? 'material',
                categoryCode: '',
                subcategoryCode: '',
                familyCode: '',
                itemCode: '',
                itemName: '',
                requirement: '',
                quantity: prev?.type === 'service' ? '1' : '',
                uomCategoryCode: '',
                uomCode: '',
                dateRequired: '',
                urgency: 'medium',
                budget: '',
                costCenterId: prev?.costCenterId ?? o.last?.costCenterId ?? '',
                glCode: prev?.glCode ?? o.last?.glCode ?? '',
                glName: prev?.glName ?? o.last?.glName ?? '',
                source: 'catalogue',
                warehouseId: '',
                warehouseName: '',
                materialId: '',
            });
        }
    }, [options.data, req.data, no]);

    const type = f?.type;
    const cat = f?.categoryCode;
    const sub = f?.subcategoryCode;
    const itemCode = f?.itemCode;

    // Families and catalogue entries for the chosen subcategory.
    useEffect(() => {
        setTree(null);
        setTreeError('');
        if (!type || !cat || !sub) return;
        let alive = true;
        callBackend<Tree>(`${API}/tree`, { kind: type, categoryCode: cat, subcategoryCode: sub })
            .then((r) => alive && setTree(r))
            .catch((e) => alive && setTreeError(messageOf(e)));
        return () => {
            alive = false;
        };
    }, [type, cat, sub]);

    // Technical attributes of the chosen catalogue entry.
    useEffect(() => {
        setSpec(null);
        setSpecError('');
        if (!type || !itemCode) return;
        let alive = true;
        callBackend<Spec>(`${API}/spec`, { kind: type, itemCode })
            .then((r) => alive && setSpec(r))
            .catch((e) => alive && setSpecError(messageOf(e)));
        return () => {
            alive = false;
        };
    }, [type, itemCode]);

    if ((options.loading && !options.data) || (req.loading && !req.data)) return <Spinner />;
    if (options.error || !options.data) return <Alert tone='error'>{options.error || 'Could not load the form.'}</Alert>;
    if (req.error || !req.data) return <Alert tone='error'>{req.error || 'Purchase requirement not found.'}</Alert>;
    const o = options.data;
    const d = req.data;
    const back = () => navigate(`${BASE}/${id}`);
    if (!d.can.edit) {
        return (
            <Screen title={d.id} subtitle={d.title} onBack={back}>
                <Alert tone='warn'>This requirement can no longer be changed.</Alert>
            </Screen>
        );
    }
    if (!f) {
        return (
            <Screen title={d.id} subtitle={d.title} onBack={back}>
                {error ? <Alert tone='error'>{error}</Alert> : <Spinner />}
            </Screen>
        );
    }

    const patch = (p: Partial<Core>) => setF((cur) => (cur ? { ...cur, ...p } : cur));
    const cats = o.kinds.find((k) => k.kind === f.type)?.categories ?? [];
    const subs = cats.find((c) => c.code === f.categoryCode)?.subcategories ?? [];
    const items = (tree?.items ?? []).filter((i) => !f.familyCode || i.familyCode === f.familyCode);
    const isService = f.type === 'service';
    const problems = coreProblems(f, o);
    const attrList = spec?.attributes ?? [];
    const mandatory = attrList.filter((a) => a.required);
    const optional = attrList.filter((a) => !a.required);
    const missingAttrs = mandatory.filter((a) => isBlank(attrs[a.code]));
    const itemFiles = d.attachments.filter((a) => a.lineNo === savedNo && savedNo > 0);

    const setAttr = (code: string, v: unknown) =>
        setAttrs((cur) => {
            const next = { ...cur };
            if (isBlank(v)) delete next[code];
            else next[code] = v;
            return next;
        });

    const chooseItem = (code: string) => {
        const found = tree?.items.find((i) => i.code === code);
        patch({ itemCode: code, itemName: found?.name ?? '', familyCode: found?.familyCode || f.familyCode, requirement: f.requirement || found?.name || '' });
        setAttrs({});
    };
    const pickFound = async (i: { code: string; name: string }) => {
        setError('');
        try {
            const s = await callBackend<Spec>(`${API}/spec`, { kind: f.type, itemCode: i.code });
            if (!s.adopted) throw new Error('That entry belongs to a category your organization has not adopted. Ask the procurement setup administrator.');
            patch({ categoryCode: s.categoryCode, subcategoryCode: s.subcategoryCode, familyCode: s.familyCode, itemCode: s.code, itemName: s.name, requirement: f.requirement || s.name });
            setAttrs({});
        } catch (e) {
            setError(messageOf(e));
        }
    };

    const save = async (next: 'technical' | 'back') => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const r = await callBackend<{ no: number; missing: string[] }>(`${API}/item/save`, {
                id,
                no: savedNo || undefined,
                type: f.type,
                categoryCode: f.categoryCode,
                subcategoryCode: f.subcategoryCode,
                familyCode: f.familyCode,
                source: f.source,
                warehouseId: f.source === 'warehouse' ? f.warehouseId : '',
                materialId: f.source === 'warehouse' ? f.materialId : '',
                itemCode: f.source === 'catalogue' ? f.itemCode : '',
                requirement: f.requirement,
                technical,
                attributes: attrs,
                quantity: isService ? 1 : Number(f.quantity),
                uomCode: isService ? '' : f.uomCode,
                dateRequired: f.dateRequired,
                urgency: f.urgency,
                budget: f.budget.trim() === '' ? null : f.budget.trim(),
                costCenterId: f.costCenterId,
                glCode: f.glCode,
            });
            setSavedNo(r.no);
            req.reload();
            if (next === 'technical') {
                setStage('technical');
                setNotice(`Item ${r.no} is saved as a draft. Now add its technical details.`);
            } else back();
        } catch (e) {
            setError(messageOf(e));
        } finally {
            setBusy(false);
        }
    };
    const addFiles = async (list: FileList | null) => {
        setError('');
        try {
            if (d.attachments.length + (list?.length ?? 0) > o.limits.files) throw new Error(`Attach up to ${o.limits.files} files in total.`);
            await uploadFiles(id, list, savedNo);
            req.reload();
        } catch (e) {
            setError(messageOf(e));
        }
    };
    const dropFile = async (attId: string) => {
        setError('');
        try {
            await callBackend(`${API}/attachment/remove`, { id, attId });
            req.reload();
        } catch (e) {
            setError(messageOf(e));
        }
    };

    return (
        <Screen
            title={savedNo ? `Item ${savedNo}` : 'New item'}
            eyebrow={d.id}
            subtitle={d.title}
            onBack={back}
            actions={
                stage === 'core' ? (
                    <Button disabled={busy || problems.length > 0} onClick={() => void save('technical')}>Save item</Button>
                ) : (
                    <Button disabled={busy} onClick={() => void save('back')}>Save details</Button>
                )
            }
            toolbar={<Segmented label='Item steps' value={stage} options={STAGES} onChange={(v) => (v === 'technical' && !savedNo ? setError('Save the core details first. The item is stored as a draft, then you can add its technical details.') : (setError(''), setStage(v)))} />}
        >
            {error && <Alert tone='error'>{error}</Alert>}
            {notice && <Alert tone='success'>{notice}</Alert>}

            {stage === 'core' ? (
                <>
                    <SelectField
                        id='item-type'
                        label='Type'
                        value={f.type}
                        onChange={(e) => {
                            const next = e.target.value as Kind;
                            patch({ type: next, source: next !== 'material' && f.source === 'warehouse' ? 'catalogue' : f.source, warehouseId: '', warehouseName: '', materialId: '', categoryCode: '', subcategoryCode: '', familyCode: '', itemCode: '', itemName: '', uomCategoryCode: '', uomCode: '', quantity: next === 'service' ? '1' : f.type === 'service' ? '' : f.quantity });
                            setAttrs({});
                        }}
                    >
                        <option value='material'>Material</option>
                        <option value='service'>Service</option>
                        <option value='asset'>Asset</option>
                    </SelectField>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <SelectField id='item-cat' label='Category' value={f.categoryCode} onChange={(e) => { patch({ categoryCode: e.target.value, subcategoryCode: '', familyCode: '', itemCode: '', itemName: '' }); setAttrs({}); }}>
                            <option value=''>{cats.length ? 'Choose' : 'None adopted'}</option>
                            {cats.map((c) => (
                                <option key={c.code} value={c.code}>{c.name}</option>
                            ))}
                        </SelectField>
                        <SelectField id='item-sub' label='Subcategory' value={f.subcategoryCode} disabled={!f.categoryCode} onChange={(e) => { patch({ subcategoryCode: e.target.value, familyCode: '', itemCode: '', itemName: '' }); setAttrs({}); }}>
                            <option value=''>Choose</option>
                            {subs.map((s) => (
                                <option key={s.code} value={s.code}>{s.name}</option>
                            ))}
                        </SelectField>
                    </div>
                    {!cats.length && <Alert tone='warn'>No {KIND_NAME[f.type].toLowerCase()} categories have been adopted yet. Ask the procurement setup administrator.</Alert>}

                    <SelectField
                        id='item-source'
                        label='How do you identify the item?'
                        value={f.source}
                        onChange={(e) => {
                            patch({ source: e.target.value as Core['source'], itemCode: '', itemName: '', familyCode: '', warehouseId: '', warehouseName: '', materialId: '' });
                            setAttrs({});
                        }}
                        hint={f.source === 'description' ? 'Describe the need in your own words. Use this when nothing in the warehouses or catalogue fits.' : f.source === 'warehouse' ? 'Choose a material that is already stocked in a warehouse.' : 'Choose a catalogue entry, then fill in its technical attributes.'}
                    >
                        <option value='description'>Description only</option>
                        {f.type === 'material' && <option value='warehouse'>Pick from a warehouse</option>}
                        <option value='catalogue'>Pick from the catalogue and add attributes</option>
                    </SelectField>
                    {f.source === 'warehouse' && f.type === 'material' && (
                        <WarehousePick
                            subcategoryCode={f.subcategoryCode}
                            warehouseId={f.warehouseId}
                            materialId={f.materialId}
                            materialName={f.itemName}
                            onWarehouse={(wid, wname) => patch({ warehouseId: wid, warehouseName: wname, materialId: '', itemName: '' })}
                            onMaterial={(i) => patch({ materialId: i.code, itemName: i.name, requirement: f.requirement || i.name })}
                        />
                    )}
                    {f.source === 'catalogue' && f.subcategoryCode && (
                        <div className='space-y-3 rounded-2xl border border-line bg-panel p-3'>
                            <p className='text-sm font-semibold text-ink'>Catalogue entry</p>
                            {treeError && <Alert tone='error'>{treeError}</Alert>}
                            {!tree && !treeError && <Spinner />}
                            {tree && (
                                <>
                                    {tree.families.length > 0 && (
                                        <SelectField id='item-family' label='Family' value={f.familyCode} onChange={(e) => { patch({ familyCode: e.target.value, itemCode: '', itemName: '' }); setAttrs({}); }}>
                                            <option value=''>All families</option>
                                            {tree.families.map((x) => (
                                                <option key={x.code} value={x.code}>{x.name}</option>
                                            ))}
                                        </SelectField>
                                    )}
                                    <SelectField id='item-entry' label={`${KIND_NAME[f.type]} entry`} value={f.itemCode} onChange={(e) => chooseItem(e.target.value)} hint={items.length ? `${items.length} entries. The entry decides which technical attributes you fill in.` : 'Nothing in the catalogue for this selection. Describe the need below instead.'}>
                                        <option value=''>Not in the catalogue yet</option>
                                        {f.itemCode && !items.some((i) => i.code === f.itemCode) && <option value={f.itemCode}>{f.itemName || f.itemCode}</option>}
                                        {items.map((i) => (
                                            <option key={i.code} value={i.code}>{i.name} ({i.code})</option>
                                        ))}
                                    </SelectField>
                                </>
                            )}
                            <Lookup label='Or find an entry by code or name' path={`${API}/masters`} body={{ kind: f.type }} placeholder='Search the catalogue' onPick={(i) => void pickFound(i)} />
                        </div>
                    )}
                    {f.source === 'catalogue' && !f.subcategoryCode && (
                        <div className='rounded-2xl border border-line bg-panel p-3'>
                            <Lookup label='Know the entry? Find it by code or name' path={`${API}/masters`} body={{ kind: f.type }} placeholder='Search the catalogue' onPick={(i) => void pickFound(i)} />
                        </div>
                    )}

                    <Field id='item-req' label='Requirement' value={f.requirement} maxLength={300} onChange={(e) => patch({ requirement: e.target.value })} placeholder='What is needed' />

                    {!isService && (
                        <div className='grid grid-cols-2 gap-3'>
                            <SelectField id='item-uomcat' label='Unit category' value={f.uomCategoryCode} onChange={(e) => patch({ uomCategoryCode: e.target.value, uomCode: '' })}>
                                <option value=''>Choose</option>
                                {o.units.map((g) => (
                                    <option key={g.code} value={g.code}>{g.name}</option>
                                ))}
                            </SelectField>
                            <SelectField id='item-uom' label='Unit of measure' value={f.uomCode} disabled={!f.uomCategoryCode} onChange={(e) => patch({ uomCode: e.target.value })}>
                                <option value=''>Choose</option>
                                {(o.units.find((g) => g.code === f.uomCategoryCode)?.units ?? []).map((u) => (
                                    <option key={u.code} value={u.code}>{u.label} ({u.symbol})</option>
                                ))}
                            </SelectField>
                        </div>
                    )}
                    <div className='grid grid-cols-2 gap-3'>
                        {isService ? (
                            <div>
                                <span className='mb-1 block text-sm text-soft'>Quantity</span>
                                <span className='flex h-12 items-center rounded-xl border border-line bg-page px-3 text-sm text-muted'>1 (one per service item)</span>
                            </div>
                        ) : (
                            <Field id='item-qty' label='Quantity' type='number' inputMode='decimal' min='0' step='any' value={f.quantity} onChange={(e) => patch({ quantity: e.target.value })} />
                        )}
                        <Field id='item-date' label='Date required' type='date' min={today()} value={f.dateRequired} onChange={(e) => patch({ dateRequired: e.target.value })} />
                    </div>

                    <div className='space-y-2'>
                        <SelectField id='item-urgency' label='Urgency' value={f.urgency} onChange={(e) => patch({ urgency: e.target.value })}>
                            {o.urgencies.map((u) => (
                                <option key={u} value={u}>{URGENCY_LABEL[u] ?? u}</option>
                            ))}
                        </SelectField>
                        <p className='text-xs text-muted'>Please do not misuse High. Keep it for work that cannot wait, such as a safety risk, a production stop or a legal deadline. Your manager and procurement can see the urgency and may question it.</p>
                        {f.urgency === 'high' && <Alert tone='warn'>You marked this item High. Be ready to explain why it cannot wait.</Alert>}
                    </div>

                    <Field
                        id='item-budget'
                        label={`Budget${o.currency ? ` (${o.currency})` : ''}, optional`}
                        type='number'
                        inputMode='decimal'
                        min='0'
                        step='any'
                        value={f.budget}
                        onChange={(e) => patch({ budget: e.target.value })}
                        hint='Your own estimate for this whole item. It is not a quotation and does not approve any spend.'
                    />

                    {f.type === 'material' && !o.policy.directToCostCenters ? (
                        <DeliverTo categoryCode={f.categoryCode} value={f.costCenterId} onChange={(v) => patch({ costCenterId: v })} />
                    ) : (
                        <CostCenterPicker tree={o.costCenterTree} value={f.costCenterId} onChange={(v) => patch({ costCenterId: v })} />
                    )}
                    <GlPicker costCenterId={f.costCenterId} code={f.glCode} name={f.glName} onChange={(c, n) => patch({ glCode: c, glName: n })} />

                    {problems.length > 0 && (
                        <section className='rounded-2xl border border-line bg-panel p-3'>
                            <p className='text-sm font-semibold text-ink'>Still needed to save this item</p>
                            <ul className='mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted'>
                                {problems.map((p) => (
                                    <li key={p}>{p}</li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            ) : (
                <>
                    <p className='text-xs text-muted'>{f.requirement}{f.itemCode ? ` · ${f.itemName || f.itemCode}` : ' · not in the catalogue'}</p>
                    {specError && <Alert tone='error'>{specError}</Alert>}
                    {f.itemCode && !spec && !specError && <Spinner />}
                    {spec && (
                        <>
                            {spec.guidance?.guidance && <Alert tone='info'><strong>{spec.guidance.label}.</strong> {spec.guidance.guidance}{spec.guidance.providers ? ` Usually done by: ${(spec.guidance.providers.usualLabels?.length ? spec.guidance.providers.usualLabels : spec.guidance.providers.usual).join(' · ')}.` : ''}</Alert>}
                            {mandatory.length === 0 && attrList.length > 0 && <Alert tone='info'>This entry has no mandatory attributes. Optional ones are below.</Alert>}
                            {mandatory.map((a) => (
                                <AttrInput key={a.code} a={a} value={attrs[a.code]} onChange={(v) => setAttr(a.code, v)} />
                            ))}
                            {optional.length > 0 && (
                                <>
                                    <button type='button' aria-expanded={showOptional} onClick={() => setShowOptional((s) => !s)} className='flex min-h-11 items-center gap-2 text-sm text-brand'>
                                        {showOptional ? <ChevronDown className='h-4 w-4' /> : <ChevronRight className='h-4 w-4' />}
                                        {showOptional ? 'Hide' : 'Show'} {optional.length} optional attribute{optional.length === 1 ? '' : 's'}
                                    </button>
                                    {showOptional && optional.map((a) => <AttrInput key={a.code} a={a} value={attrs[a.code]} onChange={(v) => setAttr(a.code, v)} />)}
                                </>
                            )}
                            {missingAttrs.length > 0 && <p className='text-xs text-muted'>Mandatory and still empty: {missingAttrs.map((a) => a.name).join(', ')}. You can save now and finish before you submit.</p>}
                        </>
                    )}
                    {!f.itemCode && <Alert tone='info'>This item is not tied to a catalogue entry, so there are no attributes. Describe it in the technical notes.</Alert>}
                    <label className='block'>
                        <span className='mb-1 block text-sm text-soft'>Technical notes *</span>
                        <textarea
                            value={technical}
                            maxLength={2000}
                            rows={5}
                            onChange={(e) => setTechnical(e.target.value)}
                            placeholder='Specifications, standard, size, grade, scope of work, performance'
                            className='w-full rounded-xl border border-line bg-panel p-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none'
                        />
                        <span className='text-xs text-muted'>{technical.trim().length < 10 ? 'At least 10 characters are needed before you submit. ' : ''}{technical.length}/2000</span>
                    </label>
                    <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                        <h2 className='text-sm font-semibold text-ink'>Files for this item</h2>
                        <label className='flex min-h-11 cursor-pointer items-center gap-2 text-sm text-soft'>
                            <Paperclip className='h-4 w-4' /> Add files (PDF, JPEG, PNG, up to {o.limits.fileKb} KB each)
                            <input type='file' multiple accept='application/pdf,image/jpeg,image/png' className='sr-only' onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
                        </label>
                        {itemFiles.map((a) => (
                            <p key={a.id} className='flex items-center gap-2 text-xs text-ink'>
                                <FileText className='h-4 w-4 text-muted' /> <span className='min-w-0 flex-1 truncate'>{a.name}</span>
                                <button type='button' aria-label={`Remove ${a.name}`} onClick={() => void dropFile(a.id)} className='flex h-11 w-11 items-center justify-center text-red-400'><X className='h-4 w-4' /></button>
                            </p>
                        ))}
                    </section>
                </>
            )}
        </Screen>
    );
}

// ----- New requirement: a title, then the draft is created and items are added one by one -----

function NewDraft() {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const create = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<{ id: string }>(`${API}/draft`, { title });
            navigate(`${BASE}/${r.id}`);
        } catch (e) {
            setError(messageOf(e));
            setBusy(false);
        }
    };
    return (
        <Screen title='New purchase requirement' subtitle='Start a draft, then add items one by one' onBack={() => navigate(BASE)} actions={<Button disabled={busy || title.trim().length < 3} onClick={() => void create()}>Create draft</Button>}>
            {error && <Alert tone='error'>{error}</Alert>}
            <Alert tone='warn'>Quotations are not accepted here. Describe the need only. After approval, procurement obtains quotes offline.</Alert>
            {options.data?.approver.problem ? <Alert tone='error'>{options.data.approver.problem}</Alert> : options.data ? <p className='text-xs text-muted'>Your immediate manager, {options.data.approver.title}, will approve this requirement.</p> : null}
            <Field id='req-title' label='Title' value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder='For example: Spares for packing line 2' hint='The draft is private to you until you submit it. Items are saved one at a time and numbered 10, 20, 30.' />
        </Screen>
    );
}

// ----- One item on the detail screen -----

function ItemCard({ l, currency, files, onDownload, onEdit, onRemove }: { l: Item; currency: string; files: Attachment[]; onDownload: (attId: string) => void; onEdit?: () => void; onRemove?: () => void }) {
    const view = l.attributeView ?? [];
    return (
        <section className='space-y-1 rounded-2xl border border-line bg-panel p-3 text-sm'>
            <div className='flex items-start justify-between gap-2'>
                <p className='min-w-0 font-semibold text-ink'><span className='mr-1 font-mono text-xs text-brandsoft'>{l.no}</span>{l.requirement}</p>
                <Badge tone={urgencyTone(l.urgency)}>{URGENCY_LABEL[l.urgency] ?? l.urgency}</Badge>
            </div>
            <p className='text-xs text-muted'>
                {KIND_NAME[l.type]} · {l.categoryName} · {l.subcategoryName}{l.familyName ? ` · ${l.familyName}` : ''}
                {l.itemCode ? ` · ${l.itemName || ''} (${l.itemCode})` : l.master ? ` · ${l.master.name} (${l.master.code})` : ''}
            </p>
            <p className='text-xs text-muted'>
                {l.quantity} {l.unit} · needed by {fmtDate(l.dateRequired)}
                {l.budget !== null && l.budget !== undefined ? ` · budget ${money(l.budget, currency)}` : ''}
            </p>
            <p className='text-xs text-muted'>{l.costCenterCode} {l.costCenterName} · GL {l.glCode} {l.glName}</p>
            {view.length > 0 && (
                <dl className='grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-xl border border-line bg-page p-2 text-xs sm:grid-cols-2'>
                    {view.map((a) => (
                        <div key={a.code} className='flex gap-2'>
                            <dt className='text-muted'>{a.name}</dt>
                            <dd className='min-w-0 flex-1 text-ink'>{a.value}{a.unit ? ` ${a.unit}` : ''}</dd>
                        </div>
                    ))}
                </dl>
            )}
            {l.technical && <p className='whitespace-pre-wrap text-soft'>{l.technical}</p>}
            {l.maintenanceSource&&<details className='rounded-xl border border-line p-3'><summary className='cursor-pointer font-semibold'>Assessed maintenance task scope · {l.maintenanceSource.woCode}</summary><button className='mt-2 text-sm underline' onClick={()=>navigate('organization_admin/work_orders/'+l.maintenanceSource!.woCode)}>Open originating work order</button>{Object.entries(l.maintenanceSource.assessedRequirement||{}).filter(([key,value])=>['scope','deliverables','quantity','qualifications','acceptanceCriteria','specifications'].includes(key)&&value).map(([key,value])=><p key={key} className='mt-2 whitespace-pre-wrap text-sm'><strong>{key.replace(/([A-Z])/g,' $1')}: </strong>{String(value)}</p>)}{l.maintenanceSource.proposedVendors?.length?<p className='mt-2 text-sm'>Proposed suppliers: {l.maintenanceSource.proposedVendors.map(v=>v.name).join(', ')}. Procurement makes the final selection.</p>:null}</details>}
            {l.complete !== undefined && (l.complete ? <Badge tone='brand'>Complete</Badge> : <Badge tone='warn'>Needs: {(l.missing ?? []).join(', ')}</Badge>)}
            {files.map((a) => (
                <button key={a.id} type='button' onClick={() => onDownload(a.id)} className='flex min-h-11 items-center gap-2 text-xs text-brand'>
                    <Download className='h-4 w-4' /> {a.name}
                </button>
            ))}
            {(onEdit || onRemove) && (
                <div className='flex gap-2 pt-1'>
                    {onEdit && (
                        <Button variant='secondary' onClick={onEdit}>
                            <Pencil className='mr-1 h-4 w-4' /> Edit
                        </Button>
                    )}
                    {onRemove && (
                        <Button variant='danger' onClick={onRemove}>
                            <Trash2 className='mr-1 h-4 w-4' /> Remove
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
}

// ----- Detail (read, act, and edit while it is a draft or returned) -----

function Detail({ id }: { id: string }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<DetailFull>(`${API}/get`, { id }), [id]);
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const [notice, setNotice] = useState('');
    const [problem, setProblem] = useState('');
    const [title, setTitle] = useState<string | null>(null);
    const confirm = useConfirm();
    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Not found.'}</Alert>;
    const c = data.can;
    const o = options.data;

    const act = (path: string, extra: Record<string, unknown>, done: string) => async (reason: string) => {
        await callBackend(path, { id, reason, ...extra });
        setNotice(done);
        reload();
    };
    const pdf = async () => {
        setProblem('');
        try {
            const sum = data.lines.reduce((n, l) => n + (l.budget ?? 0), 0);
            await downloadReportPdf({
                title: `${data.id} ${data.title}`,
                subtitle: `Purchase requirement · ${data.statusLabel}`,
                fileName: data.id,
                sections: [
                    {
                        heading: 'Summary',
                        facts: [
                            ['Raised by', data.requester],
                            ['Submitted', data.submittedAt ? fmtDate(data.submittedAt) : 'Not yet'],
                            ['Approver', data.approverTitle || '-'],
                            ['Waiting on', data.waitingOn || '-'],
                            ['Total budget', sum > 0 ? money(sum, data.currency) : '-'],
                        ],
                    },
                    {
                        heading: 'Items',
                        table: {
                            head: ['No', 'Item', 'Quantity', 'Needed by', 'Urgency', 'Budget', 'Cost center', 'GL'],
                            body: data.lines.map((l) => [String(l.no), l.requirement, `${l.quantity} ${l.unit}`, l.dateRequired, URGENCY_LABEL[l.urgency] ?? l.urgency, l.budget ? money(l.budget, data.currency) : '-', `${l.costCenterCode} ${l.costCenterName}`.trim(), `${l.glCode} ${l.glName}`.trim()]),
                        },
                    },
                    ...data.lines
                        .filter((l) => l.technical || (l.attributeView && l.attributeView.length))
                        .map((l) => ({
                            heading: `Item ${l.no} specification`,
                            text: [l.technical, ...(l.attributeView ?? []).map((a) => `${a.name}: ${a.value}${a.unit ? ` ${a.unit}` : ''}`)].filter(Boolean).join('\n'),
                        })),
                    { heading: 'History', table: { head: ['When', 'Who', 'What'], body: data.history.map((h) => [fmtDate(h.at), h.byName, `${h.action}${h.note ? `: ${h.note}` : ''}`]) } },
                ],
            });
        } catch (e) {
            setProblem(messageOf(e));
        }
    };
    const download = async (attId: string) => {
        setProblem('');
        try {
            const f = await callBackend<{ name: string; data: string }>(`${API}/attachment`, { id, attId });
            downloadDataUrl(f.data, f.name);
        } catch (e) {
            setProblem(messageOf(e));
        }
    };
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
    const blocked = !data.lines.length || data.lines.some((l) => l.complete === false);

    const submit = () =>
        confirm.ask(
            {
                title: data.status === 'draft' ? `Submit ${id}` : `Resubmit ${id}`,
                message: `${data.lines.length} item${data.lines.length === 1 ? '' : 's'} will go to ${o?.approver.title || 'your manager'} for approval. You cannot change them afterwards unless they are returned to you.`,
                confirmLabel: 'Submit',
                acknowledge: 'I confirm that no quotations or prices are included. Procurement obtains quotations offline.',
            },
            async () => {
                await callBackend(`${API}/submit`, { id, acknowledgeNoQuotes: true });
                setNotice('Submitted for approval.');
                reload();
            }
        );
    const discard = () =>
        confirm.ask({ title: `Discard draft ${id}`, message: 'The draft and its items are removed. The number stays on record as cancelled.', confirmLabel: 'Discard draft', tone: 'danger' }, async () => {
            await callBackend(`${API}/discard`, { id });
            navigate(BASE);
        });
    const removeItem = (l: Item) =>
        confirm.ask({ title: `Remove item ${l.no}`, message: `${l.requirement} and its files are removed from this requirement. Other items keep their numbers.`, confirmLabel: 'Remove', tone: 'danger' }, async () => {
            await callBackend(`${API}/item/remove`, { id, no: l.no });
            reload();
        });

    const buttons: Array<{ label: string; variant?: 'primary' | 'secondary' | 'danger'; run: () => void; show: boolean }> = [
        {
            label: 'Approve',
            show: c.approve,
            run: () => confirm.ask({ title: `Approve ${id}`, message: 'It goes to procurement to start offline quotation.', confirmLabel: 'Approve' }, act(`${API}/approve`, {}, 'Approved.')),
        },
        {
            label: 'Acknowledge',
            show: c.acknowledge,
            run: () => confirm.ask({ title: `Acknowledge ${id}`, message: 'You confirm that offline quotation has started for this requirement.', confirmLabel: 'Acknowledge' }, act(`${API}/acknowledge`, {}, 'Acknowledged.')),
        },
        {
            label: 'Return to requester',
            variant: 'secondary',
            show: c.returnManager || c.returnDesk,
            run: () => confirm.ask({ title: `Return ${id} to the requester`, message: 'The requester corrects it and sends it to the manager again.', confirmLabel: 'Return', reason: { label: 'Reason', minLength: 10 } }, act(`${API}/return`, { to: 'user' }, 'Returned to the requester.')),
        },
        {
            label: 'Return to manager',
            variant: 'secondary',
            show: c.returnDesk,
            run: () => confirm.ask({ title: `Return ${id} to the manager`, message: 'The manager reviews and approves it again.', confirmLabel: 'Return', reason: { label: 'Reason', minLength: 10 } }, act(`${API}/return`, { to: 'manager' }, 'Returned to the manager.')),
        },
        {
            label: 'Reject',
            variant: 'danger',
            show: c.reject,
            run: () => confirm.ask({ title: `Reject ${id}`, message: 'The requirement is closed. The requester sees your reason.', confirmLabel: 'Reject', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, act(`${API}/reject`, {}, 'Rejected.')),
        },
        {
            label: 'Cancel requirement',
            variant: 'danger',
            show: c.cancel,
            run: () => confirm.ask({ title: `Cancel ${id}`, message: 'The requirement is withdrawn and cannot be reopened.', confirmLabel: 'Cancel requirement', tone: 'danger', reason: { label: 'Reason', minLength: 10 } }, act(`${API}/cancel`, {}, 'Cancelled.')),
        },
        { label: 'Discard draft', variant: 'danger', show: c.discard, run: discard },
    ].filter((b) => b.show) as typeof buttons;

    const docFiles = data.attachments.filter((a) => a.lineNo === null);
    const total = data.lines.reduce((sum, l) => sum + (l.budget ?? 0), 0);

    return (
        <Screen
            title={data.id}
            eyebrow='Purchase requirement'
            subtitle={data.title}
            onBack={() => navigate(BASE)}
            actions={
                <>
                    <Button variant='secondary' aria-label='Download PDF' onClick={() => void pdf()}>
                        <FileText className='h-4 w-4 sm:mr-1' /> <span className='hidden sm:inline'>PDF</span>
                    </Button>
                    {c.edit ? (
                    <>
                        <Button variant='secondary' disabled={data.lines.length >= (o?.limits.lines ?? 50)} onClick={() => navigate(`${BASE}/${id}/item/new`)}>
                            <Plus className='mr-1 h-4 w-4' /> Item
                        </Button>
                        <Button disabled={blocked || !!o?.approver.problem} onClick={submit}>Submit</Button>
                    </>
                    ) : null}
                </>
            }
        >
            {notice && <Alert tone='success'>{notice}</Alert>}
            {problem && <Alert tone='error'>{problem}</Alert>}
            {data.status === 'returned_user' && data.returnReason && <Alert tone='warn'>Returned: {data.returnReason}</Alert>}
            {c.edit && o?.approver.problem && <Alert tone='error'>{o.approver.problem}</Alert>}
            <section className='space-y-2 rounded-2xl border border-line bg-panel p-3'>
                <div className='flex flex-wrap items-center gap-2'>
                    <Badge tone={tone(data.status)}>{data.statusLabel}</Badge>
                    {data.waitingOn && <span className='text-xs text-muted'>Waiting on {data.waitingOn}</span>}
                </div>
                <p className='text-xs text-muted'>
                    Raised by {data.requester}{data.submittedAt ? ` on ${fmtDate(data.submittedAt)}` : ''} · approver {data.approverTitle || o?.approver.title || 'not set'}
                    {total > 0 ? ` · total budget ${money(total, data.currency)}` : ''}
                </p>
                {data.maintenance && (
                    <div className='space-y-1 rounded-xl bg-page p-3 text-xs text-soft'>
                        <p className='text-sm font-semibold text-ink'>
                            Maintenance {data.maintenance.woCode} · task {data.maintenance.taskId}
                        </p>
                        <p className='break-words'>
                            {[
                                data.maintenance.planningGroup && 'Planning group ' + data.maintenance.planningGroup,
                                data.maintenance.supplierCategory && 'Supplier category ' + data.maintenance.supplierCategory,
                                data.maintenance.preferredVendor && 'Preferred vendor ' + data.maintenance.preferredVendor.name + ' (' + data.maintenance.preferredVendor.id + ')',
                                data.maintenance.supplierOnboarding && 'Supplier onboarding requested',
                                data.maintenance.executionDate && 'Execute ' + data.maintenance.executionDate,
                            ]
                                .filter(Boolean)
                                .join(' · ') || data.maintenance.description}
                        </p>
                        {data.maintenance.attachments.length > 0 && (
                            <p className='flex flex-wrap gap-2'>
                                {data.maintenance.attachments.map((a, i) => (
                                    <a key={i} href={a.url} target='_blank' rel='noreferrer noopener' className='text-brandsoft underline'>
                                        {a.kind === 'drawing' ? 'Drawing' : 'Photo'} {i + 1}
                                    </a>
                                ))}
                            </p>
                        )}
                    </div>
                )}
                {c.edit && (
                    <div className='space-y-2 pt-1'>
                        <Field id='req-title' label='Title' value={title ?? data.title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
                        {title !== null && title.trim() !== data.title && (
                            <Button variant='secondary' disabled={title.trim().length < 3} onClick={() => void run(async () => { await callBackend(`${API}/header/save`, { id, title }); setTitle(null); }, 'Title saved.')}>
                                Save title
                            </Button>
                        )}
                        {data.lines.length === 0 && <Alert tone='info'>Add your first item. Enter the core details and it is saved as a draft, then fill in its technical details.</Alert>}
                        {data.lines.length > 0 && blocked && <Alert tone='warn'>Complete every item before you submit. Items that need work are marked below.</Alert>}
                    </div>
                )}
                {buttons.length > 0 && (
                    <div className='flex flex-wrap gap-2 pt-1'>
                        {buttons.map((b) => (
                            <Button key={b.label} variant={b.variant} onClick={b.run}>{b.label}</Button>
                        ))}
                    </div>
                )}
            </section>
            {data.lines.map((l) => (
                <ItemCard
                    key={l.no}
                    l={l}
                    currency={data.currency}
                    files={data.attachments.filter((a) => a.lineNo === l.no)}
                    onDownload={(attId) => void download(attId)}
                    onEdit={c.edit ? () => navigate(`${BASE}/${id}/item/${l.no}`) : undefined}
                    onRemove={c.edit ? () => removeItem(l) : undefined}
                />
            ))}
            {(docFiles.length > 0 || c.edit) && (
                <section className='space-y-1 rounded-2xl border border-line bg-panel p-3'>
                    <h2 className='text-sm font-semibold text-ink'>Attachments for the whole document</h2>
                    {c.edit && (
                        <label className='flex min-h-11 cursor-pointer items-center gap-2 text-sm text-soft'>
                            <Paperclip className='h-4 w-4' /> Add files (PDF, JPEG, PNG, up to {o?.limits.fileKb ?? 450} KB each)
                            <input
                                type='file'
                                multiple
                                accept='application/pdf,image/jpeg,image/png'
                                className='sr-only'
                                onChange={(e) => {
                                    const list = e.target.files;
                                    e.target.value = '';
                                    void run(() => uploadFiles(id, list, null));
                                }}
                            />
                        </label>
                    )}
                    {docFiles.map((a) => (
                        <div key={a.id} className='flex items-center gap-1'>
                            <button type='button' onClick={() => void download(a.id)} className='flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm text-brand'>
                                <Download className='h-4 w-4 shrink-0' /> <span className='truncate'>{a.name}</span> <span className='shrink-0 text-xs text-muted'>{Math.round(a.size / 1024)} KB</span>
                            </button>
                            {c.edit && (
                                <button type='button' aria-label={`Remove ${a.name}`} onClick={() => void run(() => callBackend(`${API}/attachment/remove`, { id, attId: a.id }))} className='flex h-11 w-11 shrink-0 items-center justify-center text-red-400'>
                                    <X className='h-4 w-4' />
                                </button>
                            )}
                        </div>
                    ))}
                </section>
            )}
            <section className='rounded-2xl border border-line bg-panel p-3'>
                <h2 className='mb-2 text-sm font-semibold text-ink'>History</h2>
                <ol className='space-y-3'>
                    {data.history.map((h, i) => (
                        <li key={i} className='flex gap-2 text-sm'>
                            <Check className='mt-0.5 h-4 w-4 shrink-0 text-brand' />
                            <span className='min-w-0'>
                                <span className='block text-ink'>{h.action[0].toUpperCase() + h.action.slice(1)} by {h.byName}</span>
                                <span className='block text-xs text-muted'>{fmtDate(h.at)}{h.note ? ` · ${h.note}` : ''}</span>
                            </span>
                        </li>
                    ))}
                </ol>
            </section>
            {confirm.sheet}
        </Screen>
    );
}

// ----- List -----

const COLUMNS: Array<Column<Row>> = [
    { key: 'id', label: 'Number', value: (r) => r.id, render: (r) => <span className='font-mono text-xs'>{r.id}</span> },
    { key: 'title', label: 'Title', value: (r) => r.title },
    { key: 'status', label: 'Status', value: (r) => r.statusLabel, render: (r) => <Badge tone={tone(r.status)}>{r.statusLabel}</Badge> },
    { key: 'waiting', label: 'Waiting on', value: (r) => r.waitingOn },
    { key: 'requester', label: 'Requester', value: (r) => r.requester },
    { key: 'summary', label: 'First item', value: (r) => r.summary },
    { key: 'lines', label: 'Items', type: 'number', value: (r) => r.lineCount },
    { key: 'kinds', label: 'Types', value: (r) => r.kinds.join(', ') },
    { key: 'urgency', label: 'Urgency', value: (r) => URGENCY_LABEL[r.urgency] ?? r.urgency, render: (r) => <Badge tone={urgencyTone(r.urgency)}>{URGENCY_LABEL[r.urgency] ?? r.urgency}</Badge> },
    { key: 'budget', label: 'Budget', type: 'number', value: (r) => r.budget },
    { key: 'needed', label: 'Needed by', type: 'date', value: (r) => r.neededBy },
    { key: 'submitted', label: 'Submitted', type: 'date', value: (r) => r.submittedAt.slice(0, 10) },
    { key: 'updated', label: 'Updated', type: 'date', value: (r) => r.updatedAt.slice(0, 10), hidden: true },
    { key: 'files', label: 'Files', type: 'number', value: (r) => r.attachments, hidden: true },
];

function List() {
    const options = useLoad(() => callBackend<Options>(`${API}/options`));
    const [view, setView] = useState('mine');
    const list = useLoad(() => callBackend<{ rows: Row[]; counts: Record<string, number> }>(`${API}/list`, { view }), [view]);
    const can = options.data?.can;
    const tabs = useMemo(() => {
        const counts = list.data?.counts ?? {};
        const all = [
            { value: 'mine', label: 'My requirements', show: true },
            { value: 'approvals', label: 'Needs my approval', show: !!can?.approve },
            { value: 'approved', label: 'Approved by me', show: !!can?.approve },
            { value: 'desk', label: 'Procurement desk', show: !!can?.desk },
            { value: 'all', label: 'All my submissions', show: true },
            { value: 'org', label: 'Organization', show: !!can?.viewAll },
        ];
        return all.filter((t) => t.show).map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }));
    }, [can, list.data]);
    return (
        <Screen
            title='Purchase requirements'
            subtitle='Raise, approve and follow requirements'
            onBack={() => navigate('organization_home')}
            actions={
                <Button onClick={() => navigate(`${BASE}/new`)}>
                    <Plus className='mr-1 h-4 w-4' /> New
                </Button>
            }
            toolbar={<Segmented label='Views' value={view} options={tabs} onChange={setView} />}
        >
            {options.data?.approver.problem && view === 'mine' && <Alert tone='warn'>{options.data.approver.problem}</Alert>}
            {list.error ? (
                <Alert tone='error'>{list.error}</Alert>
            ) : list.loading && !list.data ? (
                <Spinner />
            ) : (
                <RichTable
                    id={`prc.req.${view}`}
                    title='Purchase requirements'
                    columns={COLUMNS}
                    rows={list.data?.rows ?? []}
                    rowKey={(r) => r.id}
                    onRowClick={(r) => navigate(`${BASE}/${r.id}`)}
                    empty={view === 'approvals' ? 'Nothing is waiting for your approval.' : 'No purchase requirements here yet.'}
                    fileName={`purchase-requirements-${view}`}
                    height='h-[calc(100dvh-17rem)]'
                />
            )}
        </Screen>
    );
}

export default function PurchaseRequirements({ id, sub, no }: { id?: string; sub?: string; no?: string }) {
    if (id === 'new') return <NewDraft />;
    if (id && REQ_ID.test(id)) {
        if (sub === 'item' && no && (no === 'new' || /^\d{1,4}$/.test(no))) return <ItemEditor key={`${id}-${no}`} id={id} no={no} />;
        return <Detail id={id} />;
    }
    return <List />;
}

