import CatalogueAttributeForm from '../components/CatalogueAttributeForm';
import type { AttrDef, CatalogueLibraryInfo } from '../components/AssetDictionaryBrowser';
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { CheckCircle2, ClipboardList, FileText, Paperclip, Search, ShieldCheck, Truck, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert } from '../components/ui';
import { Badge, Button } from '../admin/kit';
import { compressPhoto } from './mntShared';

// Maintenance sourcing UI (addendum): adding spares from the selected warehouse, the material catalogue (with a
// check for registered materials of the same specification) or free text (after a search), the external-service editor with supplier category and qualified vendors, and the procurement
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
    warehouse: 'Warehouse',
    material: 'Registered material',
    catalog: 'Material catalogue (new material)',
    description: 'Free text (new material)',
};

const SOURCES: Array<[Kind, string, string]> = [
    ['warehouse', 'Warehouse', 'Material stocked in the selected warehouse'],
    ['catalog', 'Material catalogue', 'Category, subcategory, family and attributes'],
    ['description', 'Free text', 'Only when nothing suitable exists'],
];
type Kind = 'warehouse' | 'catalog' | 'description';
interface WarehouseItem { materialId: string; materialNumber: string; name: string; uom: string; available: number | null; stockVerified: boolean; warehouseName: string }
interface CatSummary { code: string; name: string; subcategories: Array<{ code: string; name: string }> }
interface AttrSpec { code: string; name: string; dataType: string; unit: string; options: Array<{ code: string; label: string }>; required: boolean; description?: string; example?: string; domainName?: string; validation?: Record<string, unknown> }
interface Spec { code: string; name: string; categoryCode: string; subcategoryCode: string; familyCode: string; attributes: AttrSpec[]; library?: CatalogueLibraryInfo | null }
/** Catalogue spec attributes in the shape used by the shared attribute form. */
const asAttrDefs = (list: AttrSpec[]): AttrDef[] => list.map((a) => ({ key: a.code, domain: '', domainName: a.domainName ?? '', description: a.description ?? '', specific: false, ...a, validation: (a.validation ?? {}) as AttrDef['validation'] }));
interface Similar { materialId: string; materialNumber: string; name: string; uom: string; exact: boolean; score: number; matched: number; compared: number; linked: boolean; available: number | null; differences: Array<{ name: string; theirs: string; yours: string }> }

function Qty({ qty, uom, onQty, onUom, lockUom }: { qty: string; uom: string; onQty: (v: string) => void; onUom: (v: string) => void; lockUom?: boolean }) {
    return (
        <div className='grid grid-cols-2 gap-2'>
            <label className={fieldLabel}>
                Quantity *
                <input type='number' inputMode='decimal' min='0.001' step='any' className={field} value={qty} onChange={(e) => onQty(e.target.value)} />
            </label>
            <label className={fieldLabel}>
                Unit
                <input className={field} value={uom} readOnly={lockUom} onChange={(e) => onUom(e.target.value)} />
            </label>
        </div>
    );
}
const qtyOk = (q: string) => Number(q) > 0 && Number(q) <= 1_000_000;

/**
 * Add one spare to a task: the warehouse is chosen first on the Spares section, then the person picks the source.
 * Warehouse lists that warehouse's stock; catalogue walks category → subcategory → family → entry → attributes and
 * checks for registered materials with the same specification; free text runs a search first and needs explicit
 * confirmation that nothing suitable exists. Every path asks for the quantity.
 */
export function AddSpare({ code, warehouseId, warehouseName, onAdd, onClose }: { code: string; warehouseId: string; warehouseName: string; onAdd: (spare: Any) => void; onClose: () => void }) {
    const [kind, setKind] = useState<Kind | ''>('');
    return (
        <section className='space-y-3 rounded-2xl border border-brand/40 bg-panel p-3' aria-label='Add a spare'>
            <div className='flex items-center justify-between gap-2'>
                <p className='min-w-0 text-sm font-semibold text-ink'>
                    Add a spare <span className='font-normal text-muted'>· {warehouseName}</span>
                </p>
                <button type='button' onClick={onClose} className='rounded-lg p-2 text-muted' aria-label='Close'>
                    <X className='h-4 w-4' />
                </button>
            </div>
            <div className='grid grid-cols-3 gap-1' role='radiogroup' aria-label='Spare source'>
                {SOURCES.map(([k, label, hint]) => (
                    <button
                        key={k}
                        type='button'
                        role='radio'
                        aria-checked={kind === k}
                        title={hint}
                        onClick={() => setKind(k)}
                        className={`min-h-[52px] rounded-xl border px-2 py-2 text-xs font-semibold leading-tight ${kind === k ? 'border-brand bg-brand/10 text-brandsoft' : 'border-line text-soft'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {!kind && <p className='text-xs text-muted'>Choose where the spare comes from. Use the warehouse or the catalogue whenever possible.</p>}
            {kind === 'warehouse' && <FromWarehouse warehouseId={warehouseId} onAdd={onAdd} />}
            {kind === 'catalog' && <FromCatalogue code={code} warehouseId={warehouseId} onAdd={onAdd} />}
            {kind === 'description' && <FreeText code={code} warehouseId={warehouseId} onAdd={onAdd} onCatalogue={() => setKind('catalog')} />}
        </section>
    );
}

function FromWarehouse({ warehouseId, onAdd }: { warehouseId: string; onAdd: (spare: Any) => void }) {
    const [q, setQ] = useState(''),
        [items, setItems] = useState<WarehouseItem[]>([]),
        [busy, setBusy] = useState(false),
        [picked, setPicked] = useState<WarehouseItem | null>(null),
        [qty, setQty] = useState('1');
    useEffect(() => {
        if (q.trim().length < 2) {
            setItems([]);
            return;
        }
        let alive = true;
        const t = setTimeout(async () => {
            setBusy(true);
            try {
                const r = await callBackend<{ items: WarehouseItem[] }>('/api/org/mnt/warehouse-spares/search', { warehouseId, q: q.trim() });
                if (alive) setItems(r.items || []);
            } catch {
                if (alive) setItems([]);
            } finally {
                if (alive) setBusy(false);
            }
        }, 300);
        return () => {
            alive = false;
            clearTimeout(t);
        };
    }, [q, warehouseId]);
    if (picked)
        return (
            <div className='space-y-3'>
                <div className='rounded-xl bg-page p-3'>
                    <p className='break-words text-sm font-medium text-ink'>{picked.name}</p>
                    <p className='text-xs text-muted'>
                        {picked.materialNumber} · {picked.stockVerified ? `${picked.available} ${picked.uom} usable` : 'stock not verified'}
                    </p>
                </div>
                <Qty qty={qty} uom={picked.uom} onQty={setQty} onUom={() => undefined} lockUom />
                {picked.stockVerified && picked.available !== null && Number(qty) > picked.available && (
                    <p className='text-xs text-amber-500'>Only {picked.available} usable. The planner reserves that and procures the shortage.</p>
                )}
                <div className='flex gap-2'>
                    <Button disabled={!qtyOk(qty)} onClick={() => onAdd({ source: 'warehouse', materialId: picked.materialId, warehouseId, description: picked.name, uom: picked.uom, qty: Number(qty) })}>
                        Add spare
                    </Button>
                    <Button variant='secondary' onClick={() => setPicked(null)}>
                        Back
                    </Button>
                </div>
            </div>
        );
    return (
        <div className='space-y-2'>
            <label className={fieldLabel}>
                Search this warehouse
                <span className='relative block'>
                    <Search className='pointer-events-none absolute left-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-muted' />
                    <input type='search' autoFocus className={field + ' pl-9'} value={q} onChange={(e) => setQ(e.target.value)} placeholder='Material number or name' />
                </span>
            </label>
            {busy && <p className='text-xs text-muted'>Checking stock…</p>}
            <ul className='max-h-[45dvh] space-y-1 overflow-y-auto overscroll-contain'>
                {items.map((x) => (
                    <li key={x.materialId}>
                        <button type='button' className='w-full rounded-xl border border-line p-3 text-left active:bg-page' onClick={() => setPicked(x)}>
                            <span className='block truncate text-sm font-medium text-ink'>{x.name}</span>
                            <span className='block text-xs text-muted'>
                                {x.materialNumber} · {x.stockVerified ? <span className={x.available ? 'text-brandsoft' : ''}>{x.available} {x.uom} usable</span> : 'stock not verified'}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
            {!busy && q.trim().length >= 2 && !items.length && <p className='text-xs text-muted'>Not stocked in this warehouse. Try the material catalogue.</p>}
        </div>
    );
}

function FromCatalogue({ code, warehouseId, onAdd }: { code: string; warehouseId: string; onAdd: (spare: Any) => void }) {
    const [cats, setCats] = useState<CatSummary[]>([]),
        [cat, setCat] = useState(''),
        [sub, setSub] = useState(''),
        [tree, setTree] = useState<{ families: Array<{ code: string; name: string }>; items: Array<{ code: string; name: string; familyCode: string }> }>({ families: [], items: [] }),
        [fam, setFam] = useState(''),
        [item, setItem] = useState(''),
        [spec, setSpec] = useState<Spec | null>(null),
        [attrs, setAttrs] = useState<Record<string, string>>({}),
        [qty, setQty] = useState('1'),
        [uom, setUom] = useState('EA'),
        [similar, setSimilar] = useState<Similar[] | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const api = (body: Any) => callBackend<Any>('/api/org/mnt/sourcing/catalogue', { code, ...body });
    useEffect(() => {
        api({}).then((r) => setCats(r.categories || [])).catch((e) => setError(e instanceof Error ? e.message : 'Catalogue unavailable.'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code]);
    useEffect(() => {
        setTree({ families: [], items: [] });
        if (cat && sub) api({ categoryCode: cat, subcategoryCode: sub }).then((r) => setTree({ families: r.families || [], items: r.items || [] })).catch(() => undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cat, sub]);
    const entries = tree.items.filter((i) => i.familyCode === fam);
    useEffect(() => {
        if (entries.length === 1 && item !== entries[0].code) setItem(entries[0].code);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fam, tree]);
    useEffect(() => {
        setSpec(null);
        setAttrs({});
        setSimilar(null);
        if (item) api({ itemCode: item }).then((r) => setSpec(r.spec)).catch((e) => setError(e instanceof Error ? e.message : 'Entry unavailable.'));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item]);
    const subs = cats.find((c) => c.code === cat)?.subcategories ?? [];
    const missing = spec ? spec.attributes.filter((a) => a.required && !String(attrs[a.code] || '').trim()).map((a) => a.name) : [];
    const exact = similar?.find((s) => s.exact);
    const check = async () => {
        setError('');
        setBusy(true);
        try {
            const r = await callBackend<{ items: Similar[] }>('/api/org/mnt/sourcing/similar', { code, itemCode: item, attributes: attrs, warehouseId });
            setSimilar(r.items || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Check failed.');
        } finally {
            setBusy(false);
        }
    };
    const select = (label: string, value: string, set: (v: string) => void, list: Array<{ code: string; name: string }>, disabled = false) => (
        <label className={fieldLabel}>
            {label}
            <select data-native-select='true' className={field} value={value} disabled={disabled} onChange={(e) => set(e.target.value)}>
                <option value=''>Choose</option>
                {list.map((o) => (
                    <option key={o.code} value={o.code}>{o.name}</option>
                ))}
            </select>
        </label>
    );
    const attrPatch = (k: string, v: string) => {
        setAttrs((o) => ({ ...o, [k]: v }));
        setSimilar(null);
    };
    return (
        <div className='space-y-3'>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                {select('Category *', cat, (v) => (setCat(v), setSub(''), setFam(''), setItem('')), cats)}
                {select('Subcategory *', sub, (v) => (setSub(v), setFam(''), setItem('')), subs, !cat)}
                {select('Family *', fam, (v) => (setFam(v), setItem('')), tree.families, !sub)}
                {entries.length > 1 && select('Catalogue entry *', item, setItem, entries, !fam)}
            </div>
            {fam && !entries.length && <p className='text-xs text-amber-500'>This family has no catalogue entries yet.</p>}
            {spec && (
                <>
                    <p className='text-sm font-semibold text-ink'>{spec.name}</p>
                    <CatalogueAttributeForm attributes={asAttrDefs(spec.attributes)} values={attrs as Record<string, string>} onChange={(code, v) => attrPatch(code, v)} library={spec.library} />
                    <Qty qty={qty} uom={uom} onQty={setQty} onUom={setUom} />
                    {missing.length > 0 && <p className='text-xs text-amber-500'>Mandatory: {missing.join(', ')}.</p>}
                    {similar === null ? (
                        <Button disabled={!!missing.length || !qtyOk(qty)} busy={busy} onClick={check}>
                            Check for existing materials
                        </Button>
                    ) : (
                        <div className='space-y-2'>
                            <p className='text-xs font-semibold uppercase tracking-wide text-muted'>Registered materials in this family ({similar.length})</p>
                            {!similar.length && <p className='rounded-lg bg-page px-3 py-2 text-xs text-muted'>No registered material has this classification. A new material will be created and approved before purchase.</p>}
                            <ul className='max-h-[40dvh] space-y-1 overflow-y-auto overscroll-contain'>
                                {similar.map((m) => (
                                    <li key={m.materialId} className={`space-y-1 rounded-xl border p-3 ${m.exact ? 'border-brand' : 'border-line'}`}>
                                        <div className='flex items-start justify-between gap-2'>
                                            <span className='min-w-0'>
                                                <span className='block break-words text-sm font-medium text-ink'>{m.name}</span>
                                                <span className='block text-xs text-muted'>
                                                    {m.materialNumber} · {m.exact ? 'same specification' : `${m.matched}/${m.compared} attributes match`}
                                                    {m.linked ? ` · ${m.available ?? '—'} ${m.uom} usable here` : ' · not stocked in this warehouse'}
                                                </span>
                                            </span>
                                            <Badge tone={m.exact ? 'brand' : m.score >= 60 ? 'warn' : 'muted'}>{m.exact ? 'Match' : `${m.score}%`}</Badge>
                                        </div>
                                        {!m.exact && m.differences.length > 0 && (
                                            <p className='break-words text-[11px] text-muted'>{m.differences.map((d) => `${d.name}: ${d.theirs} (yours ${d.yours})`).join(' · ')}</p>
                                        )}
                                        <Button
                                            variant={m.exact ? 'primary' : 'secondary'}
                                            onClick={() => onAdd({ source: m.linked ? 'warehouse' : 'material', materialId: m.materialId, warehouseId: m.linked ? warehouseId : '', description: m.name, uom: m.uom, qty: Number(qty) })}
                                        >
                                            Use {m.materialNumber}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                            {exact ? (
                                <p className='text-xs text-soft'>{exact.materialNumber} already has this exact specification, so a new material cannot be created.</p>
                            ) : (
                                <Button
                                    variant={similar.length ? 'secondary' : 'primary'}
                                    disabled={!qtyOk(qty)}
                                    onClick={() =>
                                        onAdd({
                                            source: 'catalog', catalogCode: spec.code, categoryCode: spec.categoryCode, subcategoryCode: spec.subcategoryCode, familyCode: spec.familyCode,
                                            attributes: Object.fromEntries(Object.entries(attrs).filter(([, v]) => String(v).trim())), warehouseId,
                                            description: [spec.name, ...spec.attributes.filter((a) => attrs[a.code]).slice(0, 4).map((a) => attrs[a.code])].join(' · ').slice(0, 200),
                                            uom: uom || 'EA', qty: Number(qty),
                                        })
                                    }
                                >
                                    None suitable — add as a new catalogue material
                                </Button>
                            )}
                        </div>
                    )}
                </>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
        </div>
    );
}

function FreeText({ code, warehouseId, onAdd, onCatalogue }: { code: string; warehouseId: string; onAdd: (spare: Any) => void; onCatalogue: () => void }) {
    const [s, setS] = useState<Any>({ description: '', function: '', specifications: '', qty: '1', uom: 'EA', requiredDate: '', attachments: [] }),
        [urls, setUrls] = useState<Record<string, string>>({}),
        [result, setResult] = useState<SearchResult | null>(null),
        [checked, setChecked] = useState(''),
        [confirm, setConfirm] = useState(false),
        [reason, setReason] = useState(''),
        [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const set = (patch: Any) => setS((o: Any) => ({ ...o, ...patch }));
    const problems = freeTextProblems({ ...s, qty: Number(s.qty) });
    const query = String(s.description).trim().slice(0, 80);
    const found = result ? result.counts.warehouse + result.counts.registered + result.counts.catalogue : 0;
    const stale = !!result && checked !== query;
    const check = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await callBackend<SearchResult>('/api/org/mnt/sourcing/materials', { code, q: query });
            setResult(r);
            setChecked(query);
            setConfirm(false);
            setReason('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Search failed.');
        } finally {
            setBusy(false);
        }
    };
    const ready = !!result && !stale && confirm && (found === 0 || reason.trim().length >= 10) && !problems.length;
    return (
        <div className='space-y-3'>
            <label className={fieldLabel}>
                Material name and technical description *
                <input className={field} value={s.description} onChange={(e) => set({ description: e.target.value })} />
            </label>
            <label className={fieldLabel}>
                Intended function *
                <input className={field} value={s.function} onChange={(e) => set({ function: e.target.value })} placeholder='What the part does on this equipment' />
            </label>
            <label className={fieldLabel}>
                Detailed specifications and attributes *
                <textarea className={field} rows={3} value={s.specifications} onChange={(e) => set({ specifications: e.target.value })} placeholder='Dimensions, material, rating, part or drawing number…' />
            </label>
            <Qty qty={s.qty} uom={s.uom} onQty={(v) => set({ qty: v })} onUom={(v) => set({ uom: v })} />
            <label className={fieldLabel}>
                Required by *
                <input type='date' min={todayIso()} className={field} value={s.requiredDate} onChange={(e) => set({ requiredDate: e.target.value })} />
            </label>
            <Attachments code={code} files={s.attachments} urls={urls} onChange={(files, u) => (set({ attachments: files }), setUrls(u))} />
            {problems.length > 0 && <p className='text-xs text-amber-500'>Still needed: {problems.join(', ')}.</p>}
            {(!result || stale) && (
                <Button disabled={query.length < 3} busy={busy} onClick={check}>
                    Check warehouse and catalogue first
                </Button>
            )}
            {result && !stale && (
                <div className='space-y-2 rounded-xl border border-dashed border-line p-3'>
                    {found === 0 ? (
                        <p className='text-xs text-muted'>Nothing matches “{checked}” in stock, among registered materials or in the catalogue.</p>
                    ) : (
                        <>
                            <p className='text-xs text-soft'>Possible matches for “{checked}” — use one if suitable:</p>
                            <ul className='max-h-[30dvh] space-y-1 overflow-y-auto overscroll-contain'>
                                {result.warehouse.map((x) => (
                                    <li key={'w' + x.materialId + x.warehouseId}>
                                        <button type='button' className='w-full rounded-lg border border-line p-2 text-left text-xs' onClick={() => onAdd({ source: 'warehouse', materialId: x.materialId, warehouseId: x.warehouseId, description: x.name, uom: x.uom, qty: Number(s.qty) || 1 })}>
                                            <span className='block truncate text-sm text-ink'>{x.name}</span>
                                            {x.materialNumber} · {x.available} {x.uom} at {x.warehouseName}
                                        </button>
                                    </li>
                                ))}
                                {result.registered.map((x) => (
                                    <li key={'r' + x.materialId}>
                                        <button
                                            type='button'
                                            className='w-full rounded-lg border border-line p-2 text-left text-xs'
                                            onClick={() => onAdd({ source: 'material', materialId: x.materialId, warehouseId: x.warehouses.some((w) => w.id === warehouseId) ? warehouseId : '', description: x.name, uom: x.uom, qty: Number(s.qty) || 1 })}
                                        >
                                            <span className='block truncate text-sm text-ink'>{x.name}</span>
                                            {x.materialNumber} · registered, no usable stock
                                        </button>
                                    </li>
                                ))}
                                {result.catalogue.map((x) => (
                                    <li key={'c' + x.code}>
                                        <button type='button' className='w-full rounded-lg border border-line p-2 text-left text-xs' onClick={onCatalogue}>
                                            <span className='block truncate text-sm text-ink'>{x.name}</span>
                                            Catalogue {x.code} · {x.family} — open the catalogue
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    <label className='flex items-start gap-3 text-sm text-ink'>
                        <input type='checkbox' className='mt-1' checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I confirm no suitable warehouse or catalogue item exists.
                    </label>
                    {found > 0 && confirm && (
                        <label className={fieldLabel}>
                            Why are the {found} result(s) unsuitable? *
                            <textarea className={field} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                        </label>
                    )}
                    <Button
                        disabled={!ready}
                        onClick={() =>
                            onAdd({ ...s, source: 'description', qty: Number(s.qty), warehouseId, searchReceiptId: result.receiptId, noMatchConfirmed: true, noMatchReason: reason.trim() })
                        }
                    >
                        Add new material request
                    </Button>
                </div>
            )}
            {error && <Alert tone='error'>{error}</Alert>}
        </div>
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
            {text('description', 'Service name', 0, 'e.g. Rewind 37 kW 4-pole motor')}
            {text('scope', 'Detailed technical scope', 3, 'What the provider must do, step by step, e.g. strip, rewind with class F wire, varnish, replace both bearings, test')}
            {text('instructions', 'Work instructions and specifications', 2, 'Standards, drawings or manuals to follow, e.g. IEC 60034, OEM manual section 7')}
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                {text('qualifications', 'Required competencies', 2, 'e.g. Certified motor rewinder, electrician grade A')}
                {text('certifications', 'Certifications required', 2, 'e.g. EPRA licence, ISO 9001, OEM authorisation letter')}
            </div>
            <div className='grid grid-cols-3 gap-2'>
                {num('personnel', 'People')}
                {num('durationHours', 'Hours', 0.25)}
                {num('quantity', 'Quantity')}
            </div>
            {text('deliverables', 'Deliverables', 2, 'e.g. Repaired motor, test report with insulation resistance, warranty certificate')}
            {text('acceptanceCriteria', 'Acceptance criteria', 2, 'How you will check the work, e.g. no-load current within 5% of nameplate, IR above 100 MΩ')}
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
