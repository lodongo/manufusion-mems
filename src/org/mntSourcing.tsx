import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { Archive, Boxes, CheckCircle2, ClipboardList, FileText, Paperclip, Search, ShieldCheck, Truck, Warehouse, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button } from '../admin/kit';
import { compressPhoto } from './mntShared';

// Maintenance sourcing UI (addendum): the material finder that enforces warehouse → registered material / catalogue →
// free text, the external-service editor with supplier category and qualified vendors, and the procurement
// fulfilment track shown on work-order tasks. The server enforces every rule again.

export type Any = Record<string, any>;
export const field = 'mt-1 block w-full min-w-0 rounded-xl border border-line bg-panel px-3 py-3 text-base text-ink';
export const fieldLabel = 'block min-w-0 text-sm text-soft';
const todayIso = () => new Date().toISOString().slice(0, 10);

interface StockHit { materialId: string; materialNumber: string; name: string; uom: string; warehouseId: string; warehouseName: string; available: number }
interface RegisteredHit { materialId: string; materialNumber: string; name: string; uom: string; warehouses: Array<{ id: string; name: string }> }
interface CatalogueHit { code: string; name: string; family: string }
interface SearchResult { warehouse: StockHit[]; registered: RegisteredHit[]; catalogue: CatalogueHit[]; counts: { warehouse: number; registered: number; catalogue: number }; receiptId: string }

export const SOURCE_LABEL: Record<string, string> = {
    warehouse: 'From warehouse stock',
    material: 'Registered material (no stock)',
    catalog: 'Catalogue entry (to be registered)',
    description: 'New material (free text)',
};

/** Step-by-step finder: search once, pick from stock first, then registered materials, then the catalogue. */
export function SpareFinder({ code, onAdd, onClose }: { code: string; onAdd: (spare: Any) => void; onClose: () => void }) {
    const [q, setQ] = useState(''),
        [result, setResult] = useState<SearchResult | null>(null),
        [searched, setSearched] = useState(''),
        [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [confirm, setConfirm] = useState(false),
        [reason, setReason] = useState(''),
        [receiving, setReceiving] = useState<Record<string, string>>({});
    useEffect(() => {
        const text = q.trim();
        if (text.length < 2) {
            setResult(null);
            setSearched('');
            return;
        }
        let alive = true;
        const t = setTimeout(async () => {
            setBusy(true);
            setError('');
            try {
                const r = await callBackend<SearchResult>('/api/org/mnt/sourcing/materials', { code, q: text });
                if (alive) {
                    setResult(r);
                    setSearched(text);
                    setConfirm(false);
                    setReason('');
                }
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : 'Search failed.');
            } finally {
                if (alive) setBusy(false);
            }
        }, 350);
        return () => {
            alive = false;
            clearTimeout(t);
        };
    }, [q, code]);
    const found = result ? result.counts.warehouse + result.counts.registered + result.counts.catalogue : 0;
    const canFreeText = !!result && searched.length >= 3 && confirm && (found === 0 || reason.trim().length >= 10);
    return (
        <section className='space-y-3 rounded-2xl border border-brand/40 bg-panel p-3' aria-label='Find a spare'>
            <div className='flex items-center justify-between gap-2'>
                <p className='text-sm font-semibold text-ink'>Find the spare</p>
                <button type='button' onClick={onClose} className='rounded-lg p-2 text-muted' aria-label='Close finder'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <ol className='grid grid-cols-3 gap-1 text-[11px] text-muted' aria-label='Selection order'>
                <li className='rounded-lg bg-page px-2 py-1'>1 Warehouse</li>
                <li className='rounded-lg bg-page px-2 py-1'>2 Catalogue</li>
                <li className='rounded-lg bg-page px-2 py-1'>3 New material</li>
            </ol>
            <label className={fieldLabel}>
                Code, name, description or specification
                <span className='relative block'>
                    <Search className='pointer-events-none absolute left-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-muted' />
                    <input type='search' className={field + ' pl-9'} value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. 6205 bearing, V-belt, seal 40 mm' autoFocus />
                </span>
            </label>
            {busy && <p className='text-xs text-muted'>Searching warehouse stock and the catalogue…</p>}
            {error && <Alert tone='error'>{error}</Alert>}
            {result && (
                <div className='max-h-[55dvh] space-y-3 overflow-y-auto overscroll-contain pr-1'>
                    <Group icon={<Warehouse className='h-4 w-4' />} title='1. In stock — will be reserved' count={result.warehouse.length}>
                        {result.warehouse.map((x) => (
                            <button
                                key={x.materialId + x.warehouseId}
                                type='button'
                                className='w-full rounded-xl border border-line p-3 text-left active:bg-page'
                                onClick={() => onAdd({ source: 'warehouse', materialId: x.materialId, warehouseId: x.warehouseId, description: x.name, uom: x.uom })}
                            >
                                <span className='block truncate text-sm font-medium text-ink'>{x.name}</span>
                                <span className='mt-0.5 block text-xs text-muted'>
                                    {x.materialNumber} · {x.warehouseName} · <span className='text-brandsoft'>{x.available} {x.uom} usable</span>
                                </span>
                            </button>
                        ))}
                    </Group>
                    <Group icon={<Boxes className='h-4 w-4' />} title='2a. Registered, no usable stock — will be procured' count={result.registered.length}>
                        {result.registered.map((x) => (
                            <div key={x.materialId} className='space-y-2 rounded-xl border border-line p-3'>
                                <span className='block truncate text-sm font-medium text-ink'>{x.name}</span>
                                <span className='block text-xs text-muted'>{x.materialNumber} · no usable stock</span>
                                {x.warehouses.length > 1 && (
                                    <select data-native-select='true' className={field} value={receiving[x.materialId] || ''} onChange={(e) => setReceiving((o) => ({ ...o, [x.materialId]: e.target.value }))} aria-label='Receiving warehouse'>
                                        <option value=''>Receiving warehouse (optional)</option>
                                        {x.warehouses.map((w) => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                )}
                                <Button variant='secondary' onClick={() => onAdd({ source: 'material', materialId: x.materialId, warehouseId: receiving[x.materialId] || (x.warehouses.length === 1 ? x.warehouses[0].id : ''), description: x.name, uom: x.uom })}>
                                    Use this material
                                </Button>
                            </div>
                        ))}
                    </Group>
                    <Group icon={<Archive className='h-4 w-4' />} title='2b. Catalogue, not yet registered — material creation first' count={result.catalogue.length}>
                        {result.catalogue.map((x) => (
                            <button key={x.code} type='button' className='w-full rounded-xl border border-line p-3 text-left active:bg-page' onClick={() => onAdd({ source: 'catalog', catalogCode: x.code, description: x.name })}>
                                <span className='block truncate text-sm font-medium text-ink'>{x.name}</span>
                                <span className='mt-0.5 block text-xs text-muted'>
                                    {x.code} · {x.family}
                                </span>
                            </button>
                        ))}
                    </Group>
                    <section className='space-y-2 rounded-xl border border-dashed border-line p-3'>
                        <p className='text-sm font-semibold text-ink'>3. Nothing suitable?</p>
                        {searched.length < 3 ? (
                            <p className='text-xs text-muted'>Search with at least 3 characters before describing a new material.</p>
                        ) : (
                            <>
                                <label className='flex items-start gap-3 text-sm text-ink'>
                                    <input type='checkbox' className='mt-1' checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I confirm no suitable warehouse or catalogue item exists for “{searched}”.
                                </label>
                                {found > 0 && confirm && (
                                    <label className={fieldLabel}>
                                        Why are the {found} result(s) unsuitable? (required)
                                        <textarea className={field} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                                    </label>
                                )}
                                <Button
                                    variant='secondary'
                                    disabled={!canFreeText}
                                    onClick={() => onAdd({ source: 'description', description: '', searchReceiptId: result!.receiptId, noMatchConfirmed: true, noMatchReason: reason.trim(), requiredDate: '' })}
                                >
                                    Describe a new material
                                </Button>
                            </>
                        )}
                    </section>
                </div>
            )}
        </section>
    );
}

function Group({ icon, title, count, children }: { icon: ReactNode; title: string; count: number; children: ReactNode }) {
    return (
        <section className='space-y-2'>
            <p className='flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted'>
                {icon}
                <span className='min-w-0 flex-1 leading-snug'>{title}</span>
                <span className='tabular-nums'>{count}</span>
            </p>
            {count === 0 ? <p className='rounded-lg bg-page px-3 py-2 text-xs text-muted'>No match.</p> : children}
        </section>
    );
}

/** Photos (JPEG/PNG, compressed on the phone) and PDF drawings, up to five per spare or service. */
export function Attachments({ code, files, urls, onChange }: { code: string; files: string[]; urls: Record<string, string>; onChange: (files: string[], urls: Record<string, string>) => void }) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const add = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            let data: string;
            if (file.type === 'application/pdf') {
                if (file.size > 1_500_000) throw new Error('PDF drawings must be smaller than 1.5 MB.');
                const buf = new Uint8Array(await file.arrayBuffer());
                let bin = '';
                for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
                data = btoa(bin);
            } else data = await compressPhoto(file);
            const r = await callBackend<{ token: string; url: string }>('/api/org/mnt/assessment/photo', { code, data });
            onChange([...files, r.token], { ...urls, [r.token]: r.url });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className='space-y-2'>
            <p className={fieldLabel}>Photos, drawings or technical documents ({files.length}/5)</p>
            {files.length > 0 && (
                <ul className='flex flex-wrap gap-2'>
                    {files.map((f) => (
                        <li key={f} className='flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs'>
                            {f.endsWith('.pdf') ? <FileText className='h-3.5 w-3.5' /> : <Paperclip className='h-3.5 w-3.5' />}
                            {urls[f] ? (
                                <a href={urls[f]} target='_blank' rel='noreferrer noopener' className='text-brandsoft underline'>
                                    {f.endsWith('.pdf') ? 'Drawing' : 'Photo'}
                                </a>
                            ) : (
                                <span>{f.endsWith('.pdf') ? 'Drawing' : 'Photo'}</span>
                            )}
                            <button type='button' aria-label='Remove attachment' className='p-1 text-muted' onClick={() => onChange(files.filter((x) => x !== f), urls)}>
                                <X className='h-3 w-3' />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {files.length < 5 && (
                <label className='flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-soft'>
                    <Paperclip className='h-4 w-4' />
                    {busy ? 'Uploading…' : 'Add photo or PDF (camera works)'}
                    <input type='file' accept='image/jpeg,image/png,application/pdf' className='sr-only' disabled={busy} onChange={add} />
                </label>
            )}
            {error && <p className='text-xs text-red-500'>{error}</p>}
        </div>
    );
}

/** Problems that keep a free-text spare from being saved (mirrors the server rules). */
export function freeTextProblems(s: Any): string[] {
    const out: string[] = [];
    if (String(s.description || '').trim().length < 3) out.push('material name and technical description');
    if (String(s.function || '').trim().length < 3) out.push('intended function');
    if (String(s.specifications || '').trim().length < 10) out.push('detailed specifications (10+ characters)');
    if (!(Number(s.qty) > 0)) out.push('quantity');
    if (!s.requiredDate || s.requiredDate < todayIso()) out.push('required delivery date');
    return out;
}

export interface SupplierCategory { code: string; label: string; description: string; kind: 'oem' | 'ocm' | 'other' }
export interface VendorOption { id: string; name: string; classLabel: string; brands: string[]; manufacturerMatch: boolean }
export interface ServiceHierarchy { categories: Array<{ code: string; name: string }>; subcategories: Array<{ code: string; name: string; categoryCode: string }>; families: Array<{ code: string; name: string; subcategoryCode: string }> }

/** Supplier categories and the qualified vendors for one service (approved, matching class, scope and make). */
export function useVendors(code: string, supplierCategory: string, categoryCode: string, subcategoryCode: string) {
    const [state, setState] = useState<{ categories: SupplierCategory[]; vendors: VendorOption[]; others: VendorOption[]; narrowed: boolean; make: Any; error: string; loading: boolean }>({ categories: [], vendors: [], others: [], narrowed: false, make: {}, error: '', loading: false });
    useEffect(() => {
        if (!code) return;
        let alive = true;
        setState((s) => ({ ...s, loading: true, error: '' }));
        callBackend<Any>('/api/org/mnt/sourcing/vendors', { code, supplierCategory: categoryCode && subcategoryCode ? supplierCategory : '', categoryCode, subcategoryCode })
            .then((r) => alive && setState({ categories: r.categories || [], vendors: r.vendors || [], others: r.others || [], narrowed: !!r.narrowed, make: r.make || {}, error: '', loading: false }))
            .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Vendors unavailable.' })));
        return () => {
            alive = false;
        };
    }, [code, supplierCategory, categoryCode, subcategoryCode]);
    return state;
}

export function newService(): Any {
    return {
        id: 'sv_' + Math.random().toString(36).slice(2, 10), description: '', categoryCode: '', subcategoryCode: '', classCode: '', catalogCode: '', attributes: {},
        proposedVendorIds: [], scope: '', instructions: '', deliverables: '', qualifications: '', certifications: '', acceptanceCriteria: '',
        quantity: 1, personnel: 1, durationHours: 8, executionDate: '', expectedCost: null, supplierCategory: '', attachments: [],
    };
}
export function serviceProblems(s: Any): string[] {
    const out: string[] = [];
    if (!s.categoryCode || !s.subcategoryCode || !s.classCode) out.push('service category, subcategory and class');
    if (String(s.description || '').trim().length < 3) out.push('service name');
    if (!String(s.scope || '').trim()) out.push('technical scope');
    if (!String(s.qualifications || '').trim()) out.push('required competencies');
    if (!String(s.deliverables || '').trim()) out.push('deliverables');
    if (!String(s.acceptanceCriteria || '').trim()) out.push('acceptance criteria');
    if (!s.executionDate || s.executionDate < todayIso()) out.push('execution date');
    if (!s.supplierCategory) out.push('supplier category');
    return out;
}

/** Full service requirement form used in the assessment Services step. */
export function ServiceEditor({ code, value, hierarchy, urls, onChange, onUrls }: { code: string; value: Any; hierarchy?: ServiceHierarchy; urls: Record<string, string>; onChange: (next: Any) => void; onUrls: (u: Record<string, string>) => void }) {
    const set = (patch: Any) => onChange({ ...value, ...patch });
    const subs = useMemo(() => hierarchy?.subcategories.filter((s) => s.categoryCode === value.categoryCode) ?? [], [hierarchy, value.categoryCode]);
    const fams = useMemo(() => hierarchy?.families.filter((f) => f.subcategoryCode === value.subcategoryCode) ?? [], [hierarchy, value.subcategoryCode]);
    const v = useVendors(code, value.supplierCategory, value.categoryCode, value.subcategoryCode);
    const category = v.categories.find((c) => c.code === value.supplierCategory);
    const text = (key: string, label: string, rows = 0, hint = '') => (
        <label className={fieldLabel} key={key}>
            {label}
            {rows ? <textarea className={field} rows={rows} value={value[key] ?? ''} placeholder={hint} onChange={(e) => set({ [key]: e.target.value })} /> : <input className={field} value={value[key] ?? ''} placeholder={hint} onChange={(e) => set({ [key]: e.target.value })} />}
        </label>
    );
    const num = (key: string, label: string, step = 1) => (
        <label className={fieldLabel} key={key}>
            {label}
            <input type='number' inputMode='decimal' min={0} step={step} className={field} value={value[key] ?? ''} onChange={(e) => set({ [key]: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
    );
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
                <label className={fieldLabel}>
                    Service category
                    <select data-native-select='true' className={field} value={value.categoryCode} onChange={(e) => set({ categoryCode: e.target.value, subcategoryCode: '', classCode: '', proposedVendorIds: [] })}>
                        <option value=''>Choose</option>
                        {hierarchy?.categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                </label>
                <label className={fieldLabel}>
                    Subcategory
                    <select data-native-select='true' className={field} value={value.subcategoryCode} disabled={!value.categoryCode} onChange={(e) => set({ subcategoryCode: e.target.value, classCode: '', proposedVendorIds: [] })}>
                        <option value=''>Choose</option>
                        {subs.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                </label>
                <label className={fieldLabel}>
                    Class
                    <select data-native-select='true' className={field} value={value.classCode} disabled={!value.subcategoryCode} onChange={(e) => set({ classCode: e.target.value })}>
                        <option value=''>Choose</option>
                        {fams.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                </label>
            </div>
            {text('description', 'Service name')}
            {text('scope', 'Detailed technical scope', 3)}
            {text('instructions', 'Work instructions and specifications', 2)}
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                {text('qualifications', 'Required competencies', 2)}
                {text('certifications', 'Certifications required', 2)}
            </div>
            <div className='grid grid-cols-3 gap-2'>
                {num('personnel', 'People')}
                {num('durationHours', 'Hours', 0.25)}
                {num('quantity', 'Quantity')}
            </div>
            {text('deliverables', 'Deliverables', 2)}
            {text('acceptanceCriteria', 'Acceptance criteria', 2)}
            <div className='grid grid-cols-2 gap-2'>
                <label className={fieldLabel}>
                    Execution date
                    <input type='date' min={todayIso()} className={field} value={value.executionDate || ''} onChange={(e) => set({ executionDate: e.target.value })} />
                </label>
                {num('expectedCost', 'Estimated cost')}
            </div>
            <section className='space-y-2 rounded-xl border border-line p-3'>
                <p className='flex items-center gap-2 text-sm font-semibold text-ink'>
                    <ShieldCheck className='h-4 w-4 text-brandsoft' />
                    Supplier category and vendors
                </p>
                <label className={fieldLabel}>
                    Supplier category (required)
                    <select data-native-select='true' className={field} value={value.supplierCategory} onChange={(e) => set({ supplierCategory: e.target.value, proposedVendorIds: [] })}>
                        <option value=''>Choose OEM, OCM, approved third party…</option>
                        {v.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                </label>
                {category && <p className='text-xs text-muted'>{category.description}</p>}
                {category && category.kind !== 'other' && (
                    <p className='text-xs text-soft'>
                        Equipment make: {[v.make.manufacturer, v.make.brand, v.make.model].filter(Boolean).join(' · ') || 'not recorded on the asset'}
                        {v.narrowed ? ' — vendors representing it are shown.' : ''}
                    </p>
                )}
                {value.supplierCategory && !(value.categoryCode && value.subcategoryCode) && <p className='text-xs text-amber-500'>Choose the service category and subcategory to list vendors.</p>}
                {v.error && <p className='text-xs text-red-500'>{v.error}</p>}
                {value.supplierCategory && value.categoryCode && value.subcategoryCode && !v.loading && (
                    <>
                        {v.vendors.length === 0 ? (
                            <p className='rounded-lg bg-page px-3 py-2 text-xs text-soft'>No approved vendor of this category covers this service. The planner will route it to supplier onboarding; do not name an unregistered vendor.</p>
                        ) : (
                            <fieldset className='space-y-1'>
                                <legend className='text-xs text-muted'>Propose up to 3 approved vendors (optional)</legend>
                                {v.vendors.map((x) => (
                                    <label key={x.id} className='flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm'>
                                        <input
                                            type='checkbox'
                                            checked={value.proposedVendorIds.includes(x.id)}
                                            disabled={!value.proposedVendorIds.includes(x.id) && value.proposedVendorIds.length >= 3}
                                            onChange={(e) => set({ proposedVendorIds: e.target.checked ? [...value.proposedVendorIds, x.id] : value.proposedVendorIds.filter((id: string) => id !== x.id) })}
                                        />
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate text-ink'>{x.name}</span>
                                            <span className='block truncate text-xs text-muted'>{[x.id, x.manufacturerMatch ? 'represents ' + (v.make.manufacturer || v.make.brand) : '', x.brands.join(', ')].filter(Boolean).join(' · ')}</span>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                        )}
                        {v.others.length > 0 && <p className='text-xs text-muted'>{v.others.length} other approved vendor(s) of this category do not represent the equipment make and cannot be proposed.</p>}
                    </>
                )}
            </section>
            <Attachments code={code} files={value.attachments || []} urls={urls} onChange={(files, u) => { set({ attachments: files }); onUrls(u); }} />
        </div>
    );
}

// ----- Work-order task: fulfilment status -----

export const STATUS_TEXT: Record<string, [string, 'brand' | 'muted' | 'warn' | 'danger']> = {
    reserved: ['Reserved', 'brand'],
    secured: ['Secured', 'brand'],
    received_reserve: ['Received — reserve now', 'warn'],
    linked_replenishment: ['Covered by replenishment', 'warn'],
    awaiting_procurement: ['With procurement', 'warn'],
    awaiting_verification: ['Verify the requirement', 'warn'],
    awaiting_material_approval: ['Material in approval', 'warn'],
    awaiting_material_creation: ['Needs material creation', 'warn'],
    needs_specification: ['Specification by Materials Master', 'warn'],
    ready_for_material_creation: ['Ready for material creation', 'warn'],
    material_rejected: ['Material rejected — respecify', 'danger'],
    supply_closed: ['Requirement closed — secure again', 'danger'],
    shortage: ['Shortage', 'danger'],
    order_placed: ['Order placed — confirm', 'warn'],
    order_inactive: ['Order no longer active', 'danger'],
    sourcing_confirmed: ['Vendor confirmed', 'muted'],
    awaiting_supplier_onboarding: ['Supplier onboarding', 'warn'],
    awaiting_sourcing: ['Choose supplier', 'muted'],
};
export function ResourceStatus({ status }: { status: string }) {
    const [label, tone] = STATUS_TEXT[status] ?? [String(status || 'pending').replace(/_/g, ' '), 'muted' as const];
    return <Badge tone={tone}>{label}</Badge>;
}

const TRACK: Array<[string, string, string[]]> = [
    ['requirement', 'Requirement', ['verification', 'approval', 'procurement', 'sourcing', 'requisition', 'ordered', 'partially_received', 'received', 'service_accepted']],
    ['approved', 'Approved', ['procurement', 'sourcing', 'requisition', 'ordered', 'partially_received', 'received', 'service_accepted']],
    ['sourced', 'Sourced', ['requisition', 'ordered', 'partially_received', 'received', 'service_accepted']],
    ['ordered', 'Ordered', ['ordered', 'partially_received', 'received', 'service_accepted']],
    ['received', 'Received', ['received', 'service_accepted']],
];

/** Requirement → approval → sourcing → order → receipt / acceptance, read live from procurement. */
export function FulfilmentTrack({ procurement, onOpen }: { procurement: Any | null; onOpen?: (requirementId: string) => void }) {
    if (!procurement) return null;
    const closed = procurement.stage === 'closed';
    return (
        <div className='space-y-2 rounded-xl bg-page p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
                <button type='button' className='flex items-center gap-1 text-sm font-medium text-brandsoft underline' onClick={() => onOpen?.(procurement.requirementId)}>
                    <ClipboardList className='h-4 w-4' />
                    {procurement.requirementId}
                </button>
                <span className={`text-xs ${closed ? 'text-red-500' : 'text-soft'}`}>{procurement.stageLabel}</span>
            </div>
            <ol className='grid grid-cols-5 gap-1' aria-label='Procurement progress'>
                {TRACK.map(([key, label, stages]) => {
                    const done = !closed && stages.includes(procurement.stage);
                    return (
                        <li key={key} className='flex min-w-0 flex-col items-center gap-1 text-center'>
                            <span className={`flex h-6 w-6 items-center justify-center rounded-full ${done ? 'bg-brand text-onbrand' : 'border border-line text-muted'}`}>
                                {done ? <CheckCircle2 className='h-3.5 w-3.5' /> : key === 'ordered' ? <Truck className='h-3.5 w-3.5' /> : <span className='h-1.5 w-1.5 rounded-full bg-line' />}
                            </span>
                            <span className='truncate text-[10px] text-muted sm:text-[11px]'>{key === 'received' && procurement.service ? 'Accepted' : label}</span>
                        </li>
                    );
                })}
            </ol>
            {(procurement.orders || []).length > 0 && (
                <p className='truncate text-xs text-muted'>
                    {procurement.orders.map((o: Any) => `${o.number}${o.vendorName ? ' · ' + o.vendorName : ''} (${String(o.status).replace(/_/g, ' ')})`).join(', ')}
                    {!procurement.service && procurement.quantity ? ` · received ${procurement.received}/${procurement.quantity}` : ''}
                </p>
            )}
        </div>
    );
}
