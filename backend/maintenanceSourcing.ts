/**
 * Maintenance sourcing (maintenance addendum, MNT-02 / MNT-03 / MNT-04).
 *
 * Materials follow a mandatory selection hierarchy, enforced here on the server:
 *   1 warehouse   approved material with usable stock in a warehouse the person can reach → reserve
 *   2 registered  approved material without usable stock → procurement requirement (full quantity)
 *     catalogue   technical catalogue entry not yet registered → material creation and approval first
 *   3 free text   only after a recorded search of both sources found nothing suitable, explicitly confirmed
 *
 * External services carry a mandatory supplier category (vendor class metadata: OEM, OCM, approved third party,
 * specialist contractor ...). Vendors are only ever chosen from the approved vendor registry, filtered by class,
 * service scope and, for OEM/OCM, the equipment manufacturer or brand. When no suitable vendor exists the need is
 * routed to supplier onboarding (vendor registration and approval in Procurement), never to a free-text vendor.
 *
 * Every requirement belongs to a work-order task. Requirements reuse the Procurement Requirements process and
 * transaction numbers; a supply link records which requirement (maintenance or an existing open replenishment)
 * covers a task shortage, so the same shortage is never procured twice. Fulfilment (requirement → quotation →
 * requisition → order → receipt / service acceptance) is read back live from the procurement records.
 *
 *   organizations/{org}/mnt_search_receipts/{id}          proof that a person searched before free-text entry
 *   organizations/{org}/mnt_supply_links/{key}            task resource → requirement covering its shortage
 *   organizations/{org}/vendor_onboarding_requests/{key}  supplier onboarding raised from a maintenance service
 */
import { createHash } from 'node:crypto';
import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc, type Obj } from './core';
import { orgRoute, type OrgContext } from './guards';
import { canAt, scopeOf } from './access';
import { audit } from './audit';
import { materialIn, physicalOf } from './finCore';
import { catalogItemSpec, catalogSummary, catalogTree, searchCatalog, type ItemSpec } from './procurement';
import { metaList, vendorsPath } from './vendors';
import { requirementsPath } from './procurementSetup';
import { verifyMaintenanceStockLedger } from './maintenanceInventory';
import { object, rows, texts } from './maintenanceDomain';

const root = (orgId: string) => `organizations/${orgId}`;
const WR_RE = /^WR\d{8}$/;
const WO_RE = /^WO\d{8}$/;
const RECEIPT_RE = /^[a-f0-9]{40}$/;
const RECEIPT_HOURS = 72;
const APPROVED_MATERIAL = ['approved', 'active'];
/** Requirement statuses that still represent open supply. */
export const OPEN_SUPPLY = ['unverified', 'pending_approval', 'approved', 'acknowledged', 'converted'];
const DEAD = ['cancelled', 'rejected'];
const PLACED = ['open', 'sent', 'partial', 'full'];
const today = () => new Date().toISOString().slice(0, 10);
const norm = (v: unknown) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
export const supplyKey = (...parts: string[]) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40);

async function event(ctx: OrgContext, action: string, label: string, details = '') {
    await audit([{ category: 'maintenance', action: 'mnt.' + action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId, target: { label }, details }]);
}

/** The work request or work order being assessed or planned, if the person can see it. */
async function sourcingRecord(ctx: OrgContext, code: unknown): Promise<Doc> {
    const id = str(code);
    const path = WR_RE.test(id) ? `${root(ctx.orgId)}/work_requests/${id}` : WO_RE.test(id) ? `${root(ctx.orgId)}/work_orders/${id}` : '';
    if (!path) throw new HttpError(400, 'Choose a work request or work order.');
    const doc = await getDoc(path);
    if (!doc) throw new HttpError(404, 'The work request or work order was not found.');
    const scope = await scopeOf(ctx);
    const where = texts(doc.data.path);
    if (!['MNT.assessment.edit', 'MNT.WO.plan', 'MNT.assessment.review'].some((p) => canAt(ctx, p, where, scope)))
        throw new HttpError(403, 'Maintenance assessment or planning rights are required at this location.');
    return doc;
}

// ----- Supplier categories and vendors -----

export interface SupplierCategory { code: string; label: string; description: string; kind: 'oem' | 'ocm' | 'other' }
export async function supplierCategories(): Promise<SupplierCategory[]> {
    return (await metaList('vendorClasses')).map((c) => ({
        code: c.code,
        label: c.label,
        description: c.description,
        kind: /\bOEM\b|original equipment/i.test(c.label) ? 'oem' : /\bOCM\b|original component/i.test(c.label) ? 'ocm' : 'other',
    }));
}

/** Manufacturer, brand and model of the equipment, from the asset register. */
export async function equipmentMake(orgId: string, record: Doc) {
    const asset = str(record.data.assetTag) ? await getDoc(`${root(orgId)}/assets/${str(record.data.assetTag)}`) : null;
    const a = asset?.data ?? {};
    const attrs = object(a.attributes);
    return {
        manufacturer: str(a.manufacturer) || str(attrs.manufacturer),
        brand: str(a.brand) || str(attrs.brand),
        model: str(a.model) || str(attrs.model),
    };
}

export interface VendorOption { id: string; name: string; classCode: string; classLabel: string; brands: string[]; manufacturerMatch: boolean }
interface VendorQuery { supplierCategory: string; categoryCode: string; subcategoryCode: string; make: { manufacturer: string; brand: string; model: string } }

/** Approved vendors of the chosen class whose service scope covers the category; OEM/OCM narrowed to the equipment make. */
export async function qualifiedServiceVendors(orgId: string, q: VendorQuery) {
    const categories = await supplierCategories();
    const category = categories.find((c) => c.code === q.supplierCategory);
    if (!category) throw new HttpError(400, 'Choose the supplier category from the configured list.');
    const makes = [q.make.manufacturer, q.make.brand].map(norm).filter(Boolean);
    const all: VendorOption[] = (await listDocs(vendorsPath(orgId)))
        .filter((v) => str(v.data.status) === 'approved' && str(v.data.classCode) === category.code)
        .filter((v) =>
            objs(v.data.scopes).some(
                (s) => str(s.kind) === 'service' && str(s.categoryCode) === q.categoryCode && (!str(s.subcategoryCode) || str(s.subcategoryCode) === q.subcategoryCode),
            ),
        )
        .map((v) => {
            const brands = texts(v.data.brands);
            return {
                id: v.id,
                name: str(v.data.tradeName) || str(v.data.legalName) || v.id,
                classCode: str(v.data.classCode),
                classLabel: str(v.data.classLabel) || category.label,
                brands,
                manufacturerMatch: makes.length > 0 && brands.map(norm).some((b) => makes.includes(b)),
            };
        })
        .sort((a, b) => Number(b.manufacturerMatch) - Number(a.manufacturerMatch) || a.name.localeCompare(b.name));
    // For OEM and OCM, the equipment make narrows the list whenever a vendor represents it.
    const narrow = category.kind !== 'other' && all.some((v) => v.manufacturerMatch);
    return { category, vendors: narrow ? all.filter((v) => v.manufacturerMatch) : all, others: narrow ? all.filter((v) => !v.manufacturerMatch) : [], narrowed: narrow };
}

/** The vendor must be one of the qualified vendors for this service and category. */
export async function requireQualifiedVendor(orgId: string, vendorId: string, q: VendorQuery): Promise<VendorOption> {
    const { vendors } = await qualifiedServiceVendors(orgId, q);
    const v = vendors.find((x) => x.id === vendorId);
    if (!v) throw new HttpError(400, 'Choose an approved vendor of the selected supplier category whose service scope (and, for OEM/OCM, manufacturer) matches this service.');
    return v;
}

// ----- Material search (the selection hierarchy) -----

const hay = (m: Obj) =>
    norm(
        [
            m.materialNumber, m.name, m.shortText, m.description, m.longText, m.materialCode, m.categoryCode, m.subcategoryCode, m.familyCode,
            m.generalPartNumber, m.manufacturerPartNumber, m.partyName, ...Object.values(object(m.attributes)),
        ].map(str).join(' '),
    );

async function reachableWarehouses(ctx: OrgContext) {
    const scope = await scopeOf(ctx);
    return new Map((await listDocs(`${root(ctx.orgId)}/warehouses`)).filter((w) => (scope === 'all' || scope.has(w.id)) && str(w.data.status) !== 'inactive').map((w) => [w.id, w]));
}

function linkedWarehouses(m: Doc, extensions: Doc[]) {
    const ids = new Set(texts(m.data.warehouseIds));
    if (str(m.data.warehouseId) && str(m.data.pushedAt)) ids.add(str(m.data.warehouseId));
    for (const x of extensions) if (str(x.data.sourceId) === m.id && str(x.data.status) === 'approved') ids.add(str(x.data.warehouseId));
    return [...ids];
}

/** Usable stock (physical less reserved, quarantined, damaged and expired), or null when the ledger is not reconciled. */
async function usable(orgId: string, warehouseId: string, materialId: string): Promise<number | null> {
    try {
        await verifyMaintenanceStockLedger(orgId, warehouseId, materialId);
        return Math.max(0, (await physicalOf(orgId, warehouseId, materialId)).available);
    } catch {
        return null;
    }
}

export async function searchMaterials(ctx: OrgContext, record: Doc, q: string) {
    const words = norm(q).split(' ').filter(Boolean);
    const [warehouses, materials, extensions] = await Promise.all([
        reachableWarehouses(ctx),
        listDocs(`${root(ctx.orgId)}/materials`),
        listDocs(`${root(ctx.orgId)}/material_extensions`),
    ]);
    const warehouse: Obj[] = [],
        registered: Obj[] = [];
    const registeredCodes = new Set<string>();
    for (const m of materials) {
        if (!APPROVED_MATERIAL.includes(str(m.data.status)) || !str(m.data.materialNumber)) continue;
        if (str(m.data.materialCode)) registeredCodes.add(str(m.data.materialCode));
        const h = hay(m.data);
        if (!words.every((w) => h.includes(w))) continue;
        const base = {
            materialId: m.id, materialNumber: str(m.data.materialNumber), name: str(m.data.name) || str(m.data.shortText),
            uom: str(m.data.uom) || 'EA', categoryCode: str(m.data.categoryCode), subcategoryCode: str(m.data.subcategoryCode),
            catalogCode: str(m.data.materialCode), status: str(m.data.status),
        };
        const stocked: Obj[] = [];
        const linked = linkedWarehouses(m, extensions).filter((w) => warehouses.has(w));
        for (const w of linked) {
            if (warehouse.length >= 40) break;
            const available = await usable(ctx.orgId, w, m.id);
            const wh = warehouses.get(w)!;
            if (available && available > 0) {
                const row = { ...base, warehouseId: w, warehouseName: str(wh.data.name) || w, available, stockVerified: true, stockStatus: 'in_stock' };
                stocked.push(row);
                warehouse.push(row);
            }
        }
        if (!stocked.length && registered.length < 40)
            registered.push({ ...base, warehouses: linked.map((w) => ({ id: w, name: str(warehouses.get(w)?.data.name) || w })), stockStatus: 'no_usable_stock' });
    }
    const catalogue = (await searchCatalog('materials', q, 15)).filter((c) => !registeredCodes.has(c.code));
    const counts = { warehouse: warehouse.length, registered: registered.length, catalogue: catalogue.length };
    // One receipt per person, record and search text: repeated keystrokes refresh it instead of creating new ones.
    const receiptId = supplyKey(ctx.uid, record.id, words.join(' '));
    await writeDoc(`${root(ctx.orgId)}/mnt_search_receipts/${receiptId}`, { uid: ctx.uid, recordCode: record.id, q: words.join(' '), counts, at: nowIso() });
    return { warehouse, registered, catalogue, counts, receiptId };
}


// ----- Catalogue selection and similar registered materials -----

const normValue = (v: unknown) => str(v).trim().toLowerCase().replace(/\s+/g, ' ');
/** Same catalogue entry and the same value for every attribute the entry defines. */
export function sameSpecification(m: Obj, spec: ItemSpec, attrs: Obj) {
    if (str(m.materialCode) !== spec.code) return false;
    const ma = object(m.attributes);
    return spec.attributes.every((a) => normValue(ma[a.code]) === normValue(attrs[a.code]));
}

/** Approved materials with the same category, subcategory and family, best attribute match first. */
export async function similarMaterials(ctx: OrgContext, spec: ItemSpec, attrs: Obj, warehouseId: string) {
    const [materials, extensions] = await Promise.all([listDocs(`${root(ctx.orgId)}/materials`), listDocs(`${root(ctx.orgId)}/material_extensions`)]);
    const filled = spec.attributes.filter((a) => normValue(attrs[a.code]));
    const out: Obj[] = [];
    for (const m of materials) {
        const d = m.data;
        if (!APPROVED_MATERIAL.includes(str(d.status)) || !str(d.materialNumber)) continue;
        if (str(d.categoryCode) !== spec.categoryCode || str(d.subcategoryCode) !== spec.subcategoryCode || str(d.familyCode) !== spec.familyCode) continue;
        const ma = object(d.attributes);
        const matched = filled.filter((a) => normValue(ma[a.code]) === normValue(attrs[a.code])).length;
        const exact = sameSpecification(d, spec, attrs);
        const linked = !!warehouseId && linkedWarehouses(m, extensions).includes(warehouseId);
        out.push({
            materialId: m.id, materialNumber: str(d.materialNumber), name: str(d.name) || str(d.shortText), shortText: str(d.shortText), uom: str(d.uom) || 'EA',
            exact, score: filled.length ? Math.round((100 * matched) / filled.length) : 0, matched, compared: filled.length,
            linked, available: linked ? await usable(ctx.orgId, warehouseId, m.id) : null,
            differences: spec.attributes.filter((a) => normValue(ma[a.code]) !== normValue(attrs[a.code])).slice(0, 6).map((a) => ({ name: a.name, theirs: str(ma[a.code]) || '—', yours: str(attrs[a.code]) || '—' })),
        });
    }
    return out.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.score) - Number(a.score)).slice(0, 15);
}

// ----- Backend enforcement of the hierarchy at assessment save -----

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const KEY_FIELDS = ['source', 'materialId', 'warehouseId', 'catalogCode', 'description', 'qty', 'uom', 'specifications', 'function', 'searchReceiptId'];
function unchanged(spare: Obj, previous: Obj[]) {
    const p = previous.find((x) => str(x.id) === str(spare.id));
    return !!p && KEY_FIELDS.every((k) => same(p[k], spare[k]));
}

/**
 * Validates spares and services of an assessment against the hierarchy and supplier rules. Resources already saved
 * unchanged on the record are accepted as they were validated then; anything new or changed is validated now.
 */
export async function enforceSourcingRules(ctx: OrgContext, record: Doc, tasks: Array<{ id: string; spares: Obj[]; services: Obj[] }>) {
    const before = rows(record.data.assessmentTasks);
    const make = await equipmentMake(ctx.orgId, record);
    const categories = await supplierCategories();
    let warehousesCache: Map<string, Doc> | null = null;
    let materialsCache: Doc[] | null = null;
    let extensionsCache: Doc[] | null = null;
    for (const [ti, t] of tasks.entries()) {
        const prev = before.find((x) => str(x.id) === t.id);
        const prevSpares = rows(prev?.spares);
        const prevServices = rows(prev?.services);
        for (const [si, s] of t.spares.entries()) {
            if (unchanged(s, prevSpares)) continue;
            const at = `Task ${ti + 1}, spare ${si + 1}: `;
            const source = str(s.source);
            if (source === 'material') {
                const m = await getDoc(`${root(ctx.orgId)}/materials/${str(s.materialId)}`);
                if (!m || !APPROVED_MATERIAL.includes(str(m.data.status)) || !str(m.data.materialNumber)) throw new HttpError(400, `${at}choose an approved registered material.`);
                warehousesCache ??= await reachableWarehouses(ctx);
                extensionsCache ??= await listDocs(`${root(ctx.orgId)}/material_extensions`);
                for (const w of linkedWarehouses(m, extensionsCache).filter((x) => warehousesCache!.has(x))) {
                    const available = await usable(ctx.orgId, w, m.id);
                    if (available && available > 0)
                        throw new HttpError(400, `${at}${str(m.data.materialNumber)} has ${available} in stock at ${str(warehousesCache.get(w)?.data.name) || w}. Select it from the warehouse so it is reserved first.`);
                }
                if (str(s.warehouseId) && !(await materialIn(ctx.orgId, m.id, str(s.warehouseId)))) throw new HttpError(400, `${at}the receiving warehouse does not stock this material.`);
                s.description = str(s.description) || str(m.data.name) || str(m.data.shortText);
                s.categoryCode = str(m.data.categoryCode);
                s.subcategoryCode = str(m.data.subcategoryCode);
            } else if (source === 'catalog') {
                // Category → subcategory → family → catalogue entry with its attributes; mandatory attributes filled.
                const spec = await catalogItemSpec('materials', str(s.catalogCode));
                if (!spec) throw new HttpError(400, `${at}choose a valid catalogue entry.`);
                const attrs = object(s.attributes);
                const missing = spec.attributes.filter((a) => a.required && !str(attrs[a.code]).trim()).map((a) => a.name);
                if (missing.length) throw new HttpError(400, `${at}fill in the mandatory attributes: ${missing.join(', ')}.`);
                const unknown = Object.keys(attrs).filter((k) => !spec.attributes.some((a) => a.code === k));
                if (unknown.length) throw new HttpError(400, `${at}unknown attribute ${unknown[0]}.`);
                materialsCache ??= await listDocs(`${root(ctx.orgId)}/materials`);
                const twin = materialsCache.find((m) => APPROVED_MATERIAL.includes(str(m.data.status)) && str(m.data.materialNumber) && sameSpecification(m.data, spec, attrs));
                if (twin)
                    throw new HttpError(400, `${at}${str(twin.data.materialNumber)} is already registered with this classification and these attributes. Select it instead.`);
                s.categoryCode = spec.categoryCode;
                s.subcategoryCode = spec.subcategoryCode;
                s.familyCode = spec.familyCode;
            }
            if ((source === 'catalog' || source === 'description') && str(s.warehouseId)) {
                warehousesCache ??= await reachableWarehouses(ctx);
                if (!warehousesCache.has(str(s.warehouseId))) throw new HttpError(400, `${at}choose a warehouse you have access to.`);
            }
            if (source === 'description') {
                const receipt = RECEIPT_RE.test(str(s.searchReceiptId)) ? await getDoc(`${root(ctx.orgId)}/mnt_search_receipts/${str(s.searchReceiptId)}`) : null;
                const fresh = receipt && Date.now() - Date.parse(str(receipt.data.at)) < RECEIPT_HOURS * 3_600_000;
                if (!receipt || !fresh || str(receipt.data.uid) !== ctx.uid || str(receipt.data.recordCode) !== record.id || str(receipt.data.q).length < 3)
                    throw new HttpError(400, `${at}search the warehouse and the material catalogue first. Free text is only allowed when neither has a suitable item.`);
                if (s.noMatchConfirmed !== true) throw new HttpError(400, `${at}confirm that no suitable warehouse or catalogue item exists.`);
                const c = object(receipt.data.counts);
                const found = (Number(c.warehouse) || 0) + (Number(c.registered) || 0) + (Number(c.catalogue) || 0);
                if (found > 0 && str(s.noMatchReason).length < 10)
                    throw new HttpError(400, `${at}the search found ${found} item(s). Explain why none is suitable (at least 10 characters).`);
                if (str(s.description).length < 3) throw new HttpError(400, `${at}enter the material name and technical description.`);
                if (str(s.function).length < 3) throw new HttpError(400, `${at}describe the intended function.`);
                if (str(s.specifications).length < 10) throw new HttpError(400, `${at}give the detailed specifications and attributes (at least 10 characters).`);
                if (!str(s.requiredDate) || str(s.requiredDate) < today()) throw new HttpError(400, `${at}enter the required delivery date (today or later).`);
                s.receiptCounts = c;
            }
        }
        for (const [vi, v] of t.services.entries()) {
            const p = prevServices.find((x) => str(x.id) === str(v.id));
            const at = `Task ${ti + 1}, service ${vi + 1}: `;
            const changed = !p || ['supplierCategory', 'proposedVendorIds', 'categoryCode', 'subcategoryCode', 'scope', 'executionDate'].some((k) => !same(p[k], v[k]));
            if (!changed) continue;
            const category = categories.find((c) => c.code === str(v.supplierCategory));
            if (!category) throw new HttpError(400, `${at}choose the supplier category (OEM, OCM, approved third party, specialist contractor ...).`);
            if (!str(v.executionDate) || str(v.executionDate) < today()) throw new HttpError(400, `${at}enter the required execution date (today or later).`);
            for (const id of texts(v.proposedVendorIds))
                await requireQualifiedVendor(ctx.orgId, id, { supplierCategory: category.code, categoryCode: str(v.categoryCode), subcategoryCode: str(v.subcategoryCode), make });
            v.supplierCategoryLabel = category.label;
        }
    }
}

// ----- Supply links (no duplicate procurement) -----

export interface SupplyLink { key: string; requirementId: string; kind: 'maintenance' | 'replenishment'; qty: number; status: string }
export const linkPath = (orgId: string, key: string) => `${root(orgId)}/mnt_supply_links/${key}`;

/** Quantity received on placed purchase-order lines for each requirement. */
async function receivedByRequirement(orgId: string, ids: string[]) {
    const out = new Map<string, { ordered: number; received: number; orders: Obj[]; accepted: boolean }>();
    if (!ids.length) return out;
    const want = new Set(ids);
    for (const po of await listDocs(`${root(orgId)}/procurement_orders`)) {
        for (const l of objs(po.data.lines)) {
            const id = str(l.requirementId);
            if (!want.has(id)) continue;
            const cur = out.get(id) ?? { ordered: 0, received: 0, orders: [], accepted: false };
            const live = PLACED.includes(str(po.data.status));
            if (live) {
                cur.ordered += Number(l.quantity) || 0;
                cur.received += Number(l.receivedQty) || 0;
                if (objs(po.data.receipts).some((r) => str(r.status) === 'accepted')) cur.accepted = true;
            }
            if (!cur.orders.some((o) => o.id === po.id))
                cur.orders.push({ id: po.id, number: str(po.data.number) || po.id, status: str(po.data.status), lineNo: Number(l.no) || 0, vendorName: str(po.data.vendorName), live });
            out.set(id, cur);
        }
    }
    return out;
}

/** An open replenishment requirement for this material and warehouse with enough uncommitted quantity. */
export async function openReplenishmentCover(orgId: string, materialId: string, warehouseId: string, shortage: number, ownKey: string) {
    const reqs = (await listDocs(requirementsPath(orgId))).filter(
        (d) =>
            ['replenishment', 'mrp'].includes(str(d.data.source)) &&
            OPEN_SUPPLY.includes(str(d.data.status)) &&
            objs(d.data.lines).some((l) => str(l.materialId) === materialId && str(l.warehouseId) === warehouseId),
    );
    if (!reqs.length) return null;
    const links = (await listDocs(`${root(orgId)}/mnt_supply_links`)).filter((l) => str(l.data.status) === 'active' && l.id !== ownKey);
    const received = await receivedByRequirement(orgId, reqs.map((r) => r.id));
    for (const r of reqs.sort((a, b) => a.id.localeCompare(b.id))) {
        const qty = objs(r.data.lines).filter((l) => str(l.materialId) === materialId).reduce((n, l) => n + (Number(l.quantity) || 0), 0);
        const committed = links.filter((l) => str(l.data.requirementId) === r.id).reduce((n, l) => n + (Number(l.data.qty) || 0), 0);
        const open = qty - (received.get(r.id)?.received ?? 0) - committed;
        if (open >= shortage) return { requirementId: r.id, open, status: str(r.data.status) };
    }
    return null;
}

// ----- Fulfilment trace (procurement status synchronised back to the task) -----

const STAGE_LABEL: Record<string, string> = {
    verification: 'Waiting for planner verification',
    approval: 'In requirement approval',
    procurement: 'With procurement',
    sourcing: 'Quotations being sourced',
    requisition: 'Purchase requisition raised',
    ordered: 'Purchase order placed',
    partially_received: 'Partly received',
    received: 'Received into the warehouse',
    service_accepted: 'Service accepted',
    closed: 'Requirement cancelled or rejected',
};

export async function procurementTrace(orgId: string, ids: string[]) {
    const unique = [...new Set(ids.filter((x) => /^REQ\d{9}$/.test(x)))];
    const out = new Map<string, Obj>();
    if (!unique.length) return out;
    const [cases, requisitions, orders] = await Promise.all([
        listDocs(`${root(orgId)}/procurement_quotations`),
        listDocs(`${root(orgId)}/procurement_requisitions`),
        receivedByRequirement(orgId, unique),
    ]);
    for (const id of unique) {
        const req = await getDoc(`${requirementsPath(orgId)}/${id}`);
        if (!req) {
            out.set(id, { requirementId: id, stage: 'closed', stageLabel: 'Requirement not found', open: false });
            continue;
        }
        const status = str(req.data.status);
        const qty = objs(req.data.lines).reduce((n, l) => n + (Number(l.quantity) || 0), 0);
        const service = objs(req.data.lines).some((l) => str(l.type) === 'service');
        const q = cases.filter((c) => str(c.data.requirementId) === id && str(c.data.status) !== 'cancelled').map((c) => ({ id: c.id, number: str(c.data.number) || c.id, status: str(c.data.status) }));
        const rq = requisitions.filter((c) => str(c.data.requirementId) === id && str(c.data.status) !== 'cancelled').map((c) => ({ id: c.id, number: str(c.data.number) || c.id, status: str(c.data.status) }));
        const o = orders.get(id);
        let stage = 'procurement';
        // Evidence further down the chain (a placed order, a receipt) takes precedence over the requirement status.
        if (DEAD.includes(status)) stage = 'closed';
        else if (o && o.orders.some((x) => x.live)) stage = service ? (o.accepted ? 'service_accepted' : 'ordered') : o.received >= qty && qty > 0 ? 'received' : o.received > 0 ? 'partially_received' : 'ordered';
        else if (status === 'unverified') stage = 'verification';
        else if (['pending_approval', 'returned_user', 'draft'].includes(status)) stage = 'approval';
        else if (rq.length) stage = 'requisition';
        else if (q.length) stage = 'sourcing';
        out.set(id, {
            requirementId: id, status, stage, stageLabel: STAGE_LABEL[stage], quantity: qty, ordered: o?.ordered ?? 0, received: o?.received ?? 0,
            quotations: q, requisitions: rq, orders: o?.orders ?? [], open: !DEAD.includes(status), service,
        });
    }
    return out;
}

// ----- Supplier onboarding raised from maintenance -----

export async function raiseSupplierOnboarding(ctx: OrgContext, wo: Doc, task: Obj, service: Obj, input: { supplierCategory: SupplierCategory; name: string; contact: string; reason: string }) {
    const key = supplyKey(wo.id, str(task.id), str(service.id));
    const path = `${root(ctx.orgId)}/vendor_onboarding_requests/${key}`;
    const existing = await getDoc(path);
    if (existing && str(existing.data.status) === 'open') return key;
    const at = nowIso();
    const ok = await writeDoc(
        path,
        {
            status: 'open', source: 'maintenance', woCode: wo.id, taskId: str(task.id), serviceId: str(service.id),
            serviceDescription: str(service.description), categoryCode: str(service.categoryCode), subcategoryCode: str(service.subcategoryCode),
            supplierCategory: input.supplierCategory.code, supplierCategoryLabel: input.supplierCategory.label,
            suggestedName: input.name, suggestedContact: input.contact, reason: input.reason,
            siteId: str(wo.data.siteId), siteName: str(wo.data.siteName), path: texts(wo.data.path),
            requestedBy: ctx.uid, requestedByName: [str(ctx.me.data.firstName), str(ctx.me.data.lastName)].filter(Boolean).join(' '), requestedAt: at,
            history: [...rows(existing?.data.history), { at, by: ctx.uid, action: 'requested', note: input.reason }],
        },
        existing ? { updateTime: existing.updateTime } : { exists: false },
    );
    if (!ok) throw new HttpError(409, 'The onboarding request changed at the same time. Try again.');
    await event(ctx, 'supplier_onboarding.requested', wo.id, `${str(service.description)} · ${input.supplierCategory.label} · ${input.name}`);
    return key;
}

// ----- Routes -----

export const maintenanceSourcingRoutes = {
    // Hierarchy search: warehouse stock first, then registered materials, then technical catalogue entries.
    'POST /api/org/mnt/sourcing/materials': [
        orgRoute('org.mnt.sourcing.materials', 'MNT.view', async (ctx) => {
            const record = await sourcingRecord(ctx, ctx.body.code);
            const q = str(ctx.body.q).replace(/\s+/g, ' ').trim().slice(0, 80);
            if (q.length < 2) return { warehouse: [], registered: [], catalogue: [], counts: { warehouse: 0, registered: 0, catalogue: 0 }, receiptId: '' };
            return searchMaterials(ctx, record, q);
        }),
    ],
    // Material catalogue drill-down for a spare: categories → families and entries → entry specification.
    'POST /api/org/mnt/sourcing/catalogue': [
        orgRoute('org.mnt.sourcing.catalogue', 'MNT.view', async (ctx) => {
            await sourcingRecord(ctx, ctx.body.code);
            const itemCode = str(ctx.body.itemCode);
            if (itemCode) {
                const spec = await catalogItemSpec('materials', itemCode);
                if (!spec) throw new HttpError(404, 'That catalogue entry does not exist.');
                return { spec };
            }
            const categoryCode = str(ctx.body.categoryCode),
                subcategoryCode = str(ctx.body.subcategoryCode);
            if (categoryCode && subcategoryCode) {
                const tree = await catalogTree('materials', categoryCode, subcategoryCode);
                return { families: tree?.families ?? [], items: tree?.items ?? [] };
            }
            const summary = await catalogSummary('materials');
            return { categories: summary?.categories ?? [] };
        }),
    ],
    // Registered materials with the same classification and attributes, so an existing code is reused.
    'POST /api/org/mnt/sourcing/similar': [
        orgRoute('org.mnt.sourcing.similar', 'MNT.view', async (ctx) => {
            await sourcingRecord(ctx, ctx.body.code);
            const spec = await catalogItemSpec('materials', str(ctx.body.itemCode));
            if (!spec) throw new HttpError(400, 'Choose a catalogue entry.');
            const attrs = object(ctx.body.attributes);
            const missing = spec.attributes.filter((a) => a.required && !str(attrs[a.code]).trim()).map((a) => a.name);
            if (missing.length) throw new HttpError(400, `Fill in the mandatory attributes: ${missing.join(', ')}.`);
            const warehouseId = str(ctx.body.warehouseId);
            if (warehouseId && !(await reachableWarehouses(ctx)).has(warehouseId)) throw new HttpError(403, 'Choose a warehouse you have access to.');
            return { items: await similarMaterials(ctx, spec, attrs, warehouseId) };
        }),
    ],
    // Supplier categories and qualified vendors for one service of the record.
    'POST /api/org/mnt/sourcing/vendors': [
        orgRoute('org.mnt.sourcing.vendors', 'MNT.view', async (ctx) => {
            const record = await sourcingRecord(ctx, ctx.body.code);
            const categories = await supplierCategories();
            const make = await equipmentMake(ctx.orgId, record);
            const supplierCategory = str(ctx.body.supplierCategory);
            if (!supplierCategory) return { categories, make, vendors: [], others: [], narrowed: false };
            const categoryCode = str(ctx.body.categoryCode),
                subcategoryCode = str(ctx.body.subcategoryCode);
            if (!categoryCode || !subcategoryCode) throw new HttpError(400, 'Choose the service category and subcategory first.');
            const result = await qualifiedServiceVendors(ctx.orgId, { supplierCategory, categoryCode, subcategoryCode, make });
            return { categories, make, vendors: result.vendors, others: result.others, narrowed: result.narrowed };
        }),
    ],
    // Supplier onboarding requests raised from maintenance, for vendor managers (Procurement > Vendors).
    'POST /api/org/procurement/vendors/onboarding-requests': [
        orgRoute('org.procurement.vendors.onboarding_requests', 'PRC.vendors.manage', async (ctx) => {
            const scope = await scopeOf(ctx);
            const items = (await listDocs(`${root(ctx.orgId)}/vendor_onboarding_requests`))
                .filter((d) => canAt(ctx, 'PRC.vendors.manage', texts(d.data.path), scope))
                .map((d) => ({ id: d.id, ...d.data }))
                .sort((a, b) => str((b as Obj).requestedAt).localeCompare(str((a as Obj).requestedAt)));
            return { items };
        }),
    ],
    // Closes an onboarding request once the vendor is registered and approved (or it is no longer needed).
    'POST /api/org/procurement/vendors/onboarding-requests/resolve': [
        orgRoute('org.procurement.vendors.onboarding_requests.resolve', 'PRC.vendors.manage', async (ctx) => {
            const id = str(ctx.body.id);
            if (!RECEIPT_RE.test(id)) throw new HttpError(400, 'Choose an onboarding request.');
            const path = `${root(ctx.orgId)}/vendor_onboarding_requests/${id}`;
            const doc = await getDoc(path);
            if (!doc || str(doc.data.status) !== 'open') throw new HttpError(409, 'That onboarding request is not open.');
            const outcome = str(ctx.body.outcome);
            const note = str(ctx.body.note).trim().slice(0, 600);
            if (!['registered', 'declined'].includes(outcome)) throw new HttpError(400, 'Choose registered or declined.');
            if (note.length < 10) throw new HttpError(400, 'Record the outcome (at least 10 characters).');
            let vendorId = '';
            if (outcome === 'registered') {
                vendorId = str(ctx.body.vendorId);
                const v = /^VND\d{6}$/.test(vendorId) ? await getDoc(`${vendorsPath(ctx.orgId)}/${vendorId}`) : null;
                if (!v || str(v.data.status) !== 'approved') throw new HttpError(409, 'Link an approved vendor. Register the vendor and have it approved first.');
                if (str(v.data.classCode) !== str(doc.data.supplierCategory)) throw new HttpError(409, 'The vendor class does not match the requested supplier category.');
            }
            const at = nowIso();
            const ok = await writeDoc(path, { ...doc.data, status: outcome, vendorId, resolvedBy: ctx.uid, resolvedAt: at, resolutionNote: note, history: [...rows(doc.data.history), { at, by: ctx.uid, action: outcome, note }] }, { updateTime: doc.updateTime });
            if (!ok) throw new HttpError(409, 'The request changed at the same time. Refresh and try again.');
            await event(ctx, 'supplier_onboarding.' + outcome, str(doc.data.woCode), `${id}${vendorId ? ' · ' + vendorId : ''} · ${note}`);
            return { ok: true };
        }),
    ],
};

