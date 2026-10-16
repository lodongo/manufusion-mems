import { HttpError, deleteDoc, getDoc, isObj, listDocs, nowIso, str, updateFields, writeDoc, type Doc, type Fields, type Plain } from './core';
import { hasPerm, orgRoute, type OrgContext } from './guards';
import { getNode, record } from './structure';
import { materialCategories } from './procurement';
import { classifications, locationTypes } from './inventoryMeta';

// ---------------------------------------------------------------------------
// Warehouse and storage setup for cost centers of type Inventory (INV) or Warehousing (WHS).
//
// Hierarchy:  warehouse (the cost center)  >  storage location  >  physical location (bins, in clusters)
//   Warehouse         one or more material categories, layout per floor, capacity
//   Storage location  SL-01 … inside the warehouse: a name, a storage location type and a material
//                     classification (both codified lists maintained by MEMS in INV metadata; the
//                     classification gives the colour). Storage locations hold no subcategories.
//   Cluster           CL-0001 …: a run of N physical locations taken in sequence on one floor, in one storage
//                     location, for one or more material subcategories chosen from the warehouse's categories.
//                     The run starts at the next free space (after the last allocated position, or the first
//                     gap that fits) or at a starting bin the person chooses. Never a range typed end to end.
//
// organizations/{orgId}/warehouses/{costCenterId}                     setup, storage locations
// organizations/{orgId}/warehouses/{costCenterId}/clusters/{CL-0001}  a block of physical locations
//
// Physical location code: AB_01_C_02
//   A  floor (A = ground floor)          B  rack row on that floor
//   01 rack number in the row            C  column (level) counted from the bottom, A = lowest
//   02 position (bin, pallet place ...) in that column
// Clusters never overlap, so no code can ever exist twice. Codes are derived from the cluster ranges
// (never stored one by one), so the register cannot drift.
// ---------------------------------------------------------------------------

export const STORAGE_COST_TYPES = ['INV', 'WHS'];

const STORAGE_TYPES: Array<[string, string]> = [
    ['BIN', 'Bins'],
    ['PAL', 'Pallets'],
    ['SHL', 'Shelves'],
    ['TOT', 'Totes and cartons'],
    ['DRW', 'Drawers and cabinets'],
    ['DRM', 'Drums and IBCs'],
    ['CNT', 'Cantilever (long items)'],
    ['HNG', 'Hanging'],
    ['BLK', 'Bulk floor stacking'],
    ['TNK', 'Tanks and silos'],
];
const CONDITIONS: Array<[string, string]> = [
    ['AMB', 'Ambient'],
    ['AC', 'Air-conditioned'],
    ['CHL', 'Chilled (2 to 8 °C)'],
    ['FRZ', 'Frozen (below -18 °C)'],
    ['HAZ', 'Hazardous / flammable'],
    ['SEC', 'Secure / caged'],
    ['OUT', 'Outdoor yard'],
];

const LIMITS = { floors: 26, rows: 26, racks: 99, columns: 26, positions: 99 };
const MAX_CLUSTER_POSITIONS = 5000;
const MAX_CLUSTERS = 500;
const CLUSTER_RE = /^CL-\d{4}$/;
const SL_RE = /^SL-\d{2,3}$/;
const MAX_LOCATIONS = 99;
const MAX_CATEGORIES = 30;
const MAX_CLUSTER_SUBCATEGORIES = 30;

const whPath = (orgId: string, ccId: string) => `organizations/${orgId}/warehouses/${ccId}`;
const clusterCol = (orgId: string, ccId: string) => `${whPath(orgId, ccId)}/clusters`;
const lockPath = (orgId: string, ccId: string) => `${whPath(orgId, ccId)}/locks/clusters`;

export const letter = (n: number) => String.fromCharCode(64 + n); // 1 -> A
const pad2 = (n: number) => String(n).padStart(2, '0');
export const positionCode = (f: number, r: number, k: number, c: number, p: number) => `${letter(f)}${letter(r)}_${pad2(k)}_${letter(c)}_${pad2(p)}`;

/** Every floor is configured on its own: a mezzanine can have shelving while the ground floor has pallet racking. */
interface FloorLayout {
    name: string;
    racking: boolean;
    rows: number;
    racks: number;
    columns: number;
    positions: number;
}
interface Layout {
    floors: FloorLayout[];
}
type FloorDim = 'rows' | 'racks' | 'columns' | 'positions';
const floorPositions = (f: FloorLayout) => f.rows * f.racks * f.columns * f.positions;
const layoutPositions = (l: Layout) => l.floors.reduce((s, f) => s + floorPositions(f), 0);

interface Range {
    floorFrom: number;
    floorTo: number;
    rowFrom: number;
    rowTo: number;
    rackFrom: number;
    rackTo: number;
    colFrom: number;
    colTo: number;
    posFrom: number;
    posTo: number;
}
const AXES: Array<[keyof Range, keyof Range, string]> = [
    ['floorFrom', 'floorTo', 'floor'],
    ['rowFrom', 'rowTo', 'rack row'],
    ['rackFrom', 'rackTo', 'rack'],
    ['colFrom', 'colTo', 'column'],
    ['posFrom', 'posTo', 'position'],
];
const count = (r: Range) => AXES.reduce((n, [a, b]) => n * (r[b] - r[a] + 1), 1);

// Sequence of positions on a floor: rack row › rack › column (from the bottom) › position. Ordinal 0 = AA_01_A_01.
// While a floor holds clusters its racks, columns and positions are fixed (rows can only be added at the end),
// so ordinals never move.
type Seg = [number, number];
const ordOf = (f: FloorLayout, r: number, k: number, c: number, p: number) => (((r - 1) * f.racks + (k - 1)) * f.columns + (c - 1)) * f.positions + (p - 1);
function coordsOf(f: FloorLayout, o: number) {
    const p = o % f.positions;
    const c = Math.floor(o / f.positions) % f.columns;
    const k = Math.floor(o / (f.positions * f.columns)) % f.racks;
    const r = Math.floor(o / (f.positions * f.columns * f.racks));
    return { r: r + 1, k: k + 1, c: c + 1, p: p + 1 };
}
const codeAt = (floorNo: number, f: FloorLayout, o: number) => {
    const x = coordsOf(f, o);
    return positionCode(floorNo, x.r, x.k, x.c, x.p);
};

/** Positions a cluster holds, as ordered ranges of ordinals on its floor. */
function segmentsOf(d: Record<string, unknown>, floor: FloorLayout | undefined): Seg[] {
    if (str(d.kind) === 'run') {
        const s = Number(d.startOrd) || 0;
        const n = Number(d.count) || 0;
        return n > 0 ? [[s, s + n - 1]] : [];
    }
    // Clusters created before sequential allocation: a box of rows × racks × columns × positions.
    if (!floor) return [];
    const r = rangeOf(d);
    const out: Seg[] = [];
    for (let row = r.rowFrom; row <= r.rowTo; row++)
        for (let k = r.rackFrom; k <= r.rackTo; k++)
            for (let c = r.colFrom; c <= r.colTo; c++) {
                const s = ordOf(floor, row, k, c, r.posFrom);
                const e = ordOf(floor, row, k, c, r.posTo);
                const last = out[out.length - 1];
                if (last && last[1] + 1 === s) last[1] = e;
                else out.push([s, e]);
            }
    return out;
}

/** Free ranges of a floor with `total` positions, given the occupied ranges. */
function freeGaps(total: number, occupied: Seg[]): Seg[] {
    const gaps: Seg[] = [];
    let cursor = 0;
    for (const [s, e] of [...occupied].sort((a, b) => a[0] - b[0])) {
        if (s > cursor) gaps.push([cursor, s - 1]);
        cursor = Math.max(cursor, e + 1);
    }
    if (cursor <= total - 1) gaps.push([cursor, total - 1]);
    return gaps;
}

/** Next free space: right after the last allocated position if it fits, otherwise the first free gap that fits. */
function nextFreeStart(total: number, occupied: Seg[], n: number): number | null {
    const gaps = freeGaps(total, occupied);
    const last = occupied.reduce((m, s) => Math.max(m, s[1]), -1);
    const tail = gaps.find((g) => g[0] === last + 1);
    if (tail && tail[1] - tail[0] + 1 >= n) return tail[0];
    const g = gaps.find((x) => x[1] - x[0] + 1 >= n);
    return g ? g[0] : null;
}
const firstCode = (r: Range) => positionCode(r.floorFrom, r.rowFrom, r.rackFrom, r.colFrom, r.posFrom);
const lastCode = (r: Range) => positionCode(r.floorTo, r.rowTo, r.rackTo, r.colTo, r.posTo);

function int(v: unknown, min: number, max: number, label: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
    return n;
}
function dec(v: unknown, min: number, max: number, label: string, required: boolean): number | null {
    if (v === undefined || v === null || String(v).trim() === '') {
        if (required) throw new HttpError(400, `Enter the ${label}.`);
        return null;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} must be between ${min} and ${max}.`);
    return Math.round(n * 100) / 100;
}

function canView(ctx: OrgContext) {
    return ctx.role === 'org_super_admin' || ['ADM.structure', 'INV.view', 'WMS.view', 'WHS.view', 'INV.warehouse.view', 'WHS.warehouse.view', 'WMS.warehouse.view', 'INV.bin.view', 'WHS.bin.view'].some((p) => hasPerm(ctx.permissions, p));
}
function canEdit(ctx: OrgContext) {
    // Storage layout is part of the organization design: only the direct administration right counts.
    return ctx.role === 'org_super_admin' || hasPerm(ctx.directPermissions, 'ADM.structure') || ['INV.warehouse.configure','WHS.warehouse.configure','WMS.warehouse.configure','INV.cluster.create','WHS.cluster.create','INV.cluster.delete','WHS.cluster.delete'].some(p=>hasPerm(ctx.permissions,p));
}

async function storageCostCenter(ctx: OrgContext, id: string): Promise<Doc> {
    const node = await getNode(ctx, id);
    if (str(node.data.level) !== 'cost_center') throw new HttpError(400, 'Storage is set up on a cost center.');
    const type = isObj(node.data.attributes) ? str(node.data.attributes.costType) : '';
    if (!STORAGE_COST_TYPES.includes(type)) throw new HttpError(400, 'Storage setup is only for cost centers of type Inventory (INV) or Warehousing (WHS).');
    return node;
}

function layoutOf(d: Record<string, unknown>): Layout {
    const l = isObj(d.layout) ? d.layout : {};
    const floor = (f: Record<string, unknown>, i: number, racking: boolean): FloorLayout => ({
        name: str(f.name) || `Floor ${letter(i + 1)}`,
        racking,
        rows: Number(f.rows) || 0,
        racks: racking ? Number(f.racks) || 0 : 1,
        columns: racking ? Number(f.columns) || 0 : 1,
        positions: Number(f.positions) || 0,
    });
    if (Array.isArray(l.floors)) return { floors: (l.floors as Plain[]).filter(isObj).map((f, i) => floor(f, i, f.racking === true)) };
    // Layouts saved before floors were configured separately: every floor was identical.
    const legacyFloors = Number(l.floors) || 0;
    return { floors: Array.from({ length: legacyFloors }, (_, i) => floor(l, i, l.racking === true)) };
}

function rangeOf(d: Record<string, unknown>): Range {
    const r = {} as Range;
    for (const [a, b] of AXES) {
        r[a] = Number(d[a]) || 0;
        r[b] = Number(d[b]) || 0;
    }
    return r;
}

function clusterOut(doc: Doc, layout: Layout) {
    const d = doc.data;
    const run = str(d.kind) === 'run';
    const r = rangeOf(d);
    const floorNo = r.floorFrom;
    const floor = layout.floors[floorNo - 1];
    const segments = segmentsOf(d, floor);
    let positions = count(r);
    let first = firstCode(r);
    let last = lastCode(r);
    if (run) {
        positions = Number(d.count) || 0;
        if (floor && segments.length) {
            // Bounding coordinates of the run (first and last position), for display and floor checks.
            const a = coordsOf(floor, segments[0][0]);
            const z = coordsOf(floor, segments[0][1]);
            Object.assign(r, { rowFrom: a.r, rackFrom: a.k, colFrom: a.c, posFrom: a.p, rowTo: z.r, rackTo: z.k, colTo: z.c, posTo: z.p });
            first = codeAt(floorNo, floor, segments[0][0]);
            last = codeAt(floorNo, floor, segments[0][1]);
        }
    }
    return {
        code: doc.id,
        name: str(d.name),
        kind: run ? 'run' : 'box',
        mode: str(d.mode),
        floor: floorNo,
        segments,
        ...r,
        positions,
        firstCode: first,
        lastCode: last,
        locationCode: str(d.locationCode),
        locationName: str(d.locationName),
        classificationLabel: str(d.classificationLabel),
        color: /^#[0-9a-fA-F]{6}$/.test(str(d.color)) ? str(d.color) : '#64748B',
        subcategories: (Array.isArray(d.subcategories) ? (d.subcategories as Plain[]) : []).filter(isObj).map((s) => ({ code: str(s.code), name: str(s.name), categoryCode: str(s.categoryCode) })),
        storageTypeCode: str(d.storageTypeCode),
        storageTypeLabel: str(d.storageTypeLabel),
        createdByName: str(d.createdByName),
        createdAt: str(d.createdAt),
    };
}
type ClusterOut = ReturnType<typeof clusterOut>;

async function clustersOf(orgId: string, ccId: string, layout: Layout) {
    return (await listDocs(clusterCol(orgId, ccId)))
        .filter((d) => CLUSTER_RE.test(d.id))
        .map((d) => clusterOut(d, layout))
        .sort((a, b) => a.code.localeCompare(b.code));
}

interface StoredLocation {
    code: string;
    name: string;
    typeCode: string;
    classificationCode: string;
    active: boolean;
    createdAt: string;
}

function locationsOf(d: Record<string, unknown>): StoredLocation[] {
    return (Array.isArray(d.storageLocations) ? (d.storageLocations as Plain[]) : []).filter(isObj).map((l) => ({
        code: str(l.code),
        name: str(l.name),
        typeCode: str(l.typeCode),
        classificationCode: str(l.classificationCode),
        active: l.active !== false,
        createdAt: str(l.createdAt),
    }));
}

/** Warehouse categories: new list, or the single category saved before several were allowed. */
function categoryCodesOf(d: Record<string, unknown>): string[] {
    if (Array.isArray(d.materialCategoryCodes)) return (d.materialCategoryCodes as Plain[]).map(str).filter(Boolean);
    return str(d.materialCategoryCode) ? [str(d.materialCategoryCode)] : [];
}

/** Storage locations with the current labels and colour of their type and classification. */
async function describeLocations(stored: StoredLocation[]) {
    const [classes, types] = await Promise.all([classifications(), locationTypes()]);
    const cls = new Map(classes.map((c) => [c.code, c]));
    const typ = new Map(types.map((t) => [t.code, t]));
    return {
        classes,
        types,
        locations: stored.map((l) => ({
            ...l,
            typeLabel: typ.get(l.typeCode)?.label ?? l.typeCode,
            classificationLabel: cls.get(l.classificationCode)?.label ?? l.classificationCode,
            color: cls.get(l.classificationCode)?.color ?? '#64748B',
        })),
    };
}

function displayName(ctx: OrgContext) {
    return `${str(ctx.me.data.firstName)} ${str(ctx.me.data.lastName)}`.trim() || ctx.actor.email;
}

/** One writer at a time per warehouse, so two people can never allocate the same positions. */
async function withLock<T>(ctx: OrgContext, ccId: string, fn: () => Promise<T>): Promise<T> {
    const path = lockPath(ctx.orgId, ccId);
    let got = await writeDoc(path, { uid: ctx.uid, at: nowIso() }, { exists: false });
    if (!got) {
        const held = await getDoc(path);
        const age = Date.now() - Date.parse(str(held?.data.at));
        if (!held || Number.isNaN(age) || age > 60_000) {
            await deleteDoc(path);
            got = await writeDoc(path, { uid: ctx.uid, at: nowIso() }, { exists: false });
        }
    }
    if (!got) throw new HttpError(409, 'Someone else is changing the storage of this cost center. Try again in a moment.');
    try {
        return await fn();
    } finally {
        await deleteDoc(path);
    }
}

export const warehouseRoutes = {
    'POST /api/org/warehouse/get': [
        orgRoute('org.warehouse.get', null, async (ctx) => {
            if (!canView(ctx)) throw new HttpError(403, 'You do not have permission to view storage setup.');
            const node = await storageCostCenter(ctx, str(ctx.body.costCenterId));
            const [doc, categories] = await Promise.all([getDoc(whPath(ctx.orgId, node.id)), materialCategories()]);
            const d = doc?.data ?? {};
            const layout = layoutOf(d);
            const [rawClusters, { classes, types, locations }] = await Promise.all([clustersOf(ctx.orgId, node.id, layout), describeLocations(locationsOf(d))]);
            const reservations=await listDocs(`organizations/${ctx.orgId}/warehouse_bin_occupancy`);const linkedBins=reservations.filter(x=>str(x.data.warehouseId)===node.id).map(x=>({binId:str(x.data.binId),materialId:str(x.data.materialId),materialNumber:str(x.data.materialNumber)}));const byCode = new Map(locations.map((l) => [l.code, l]));
            // Colours always follow the current classification of the storage location.
            const clusters = rawClusters.map((c) => {
                const l = byCode.get(c.locationCode);
                return l ? { ...c, locationName: l.name, classificationLabel: l.classificationLabel, color: l.color } : c;
            });
            const capacity = isObj(d.capacity) ? d.capacity : {};
            const total = layoutPositions(layout);
            const allocated = clusters.reduce((s, c) => s + c.positions, 0);
            const usedClasses = new Set(locations.map((l) => l.classificationCode));
            const usedTypes = new Set(locations.map((l) => l.typeCode));
            return {
                costCenter: { id: node.id, code: str(node.data.code), name: str(node.data.name), costType: isObj(node.data.attributes) ? str(node.data.attributes.costType) : '' },
                configured: !!doc,
                setup: doc
                    ? {
                          materialCategoryCodes: categoryCodesOf(d),
                          storageLocations: locations,
                          storageTypeCode: str(d.storageTypeCode),
                          conditionCode: str(d.conditionCode),
                          layout,
                          capacity: {
                              totalAreaM2: capacity.totalAreaM2 ?? null,
                              storageAreaM2: capacity.storageAreaM2 ?? null,
                              clearHeightM: capacity.clearHeightM ?? null,
                              volumeM3: capacity.volumeM3 ?? null,
                              floorLoadKgM2: capacity.floorLoadKgM2 ?? null,
                              positionMaxKg: capacity.positionMaxKg ?? null,
                              positionLengthCm: capacity.positionLengthCm ?? null,
                              positionWidthCm: capacity.positionWidthCm ?? null,
                              positionHeightCm: capacity.positionHeightCm ?? null,
                          },
                          updatedByName: str(d.updatedByName),
                          updatedAt: str(d.updatedAt),
                      }
                    : null,
                summary: { totalPositions: total, allocated, free: total - allocated, clusters: clusters.length },linkedBins,
                clusters,
                categories,
                classifications: classes.filter((c) => c.active || usedClasses.has(c.code)),
                locationTypes: types.filter((t) => t.active || usedTypes.has(t.code)),
                storageTypes: STORAGE_TYPES.map(([code, label]) => ({ code, label })),
                conditions: CONDITIONS.map(([code, label]) => ({ code, label })),
                limits: { ...LIMITS, clusterPositions: MAX_CLUSTER_POSITIONS, locations: MAX_LOCATIONS, categories: MAX_CATEGORIES, clusterSubcategories: MAX_CLUSTER_SUBCATEGORIES },
                floorTotals: layout.floors.map((f, i) => ({ floor: letter(i + 1), positions: floorPositions(f), allocated: clusters.filter((c) => c.floorFrom === i + 1).reduce((s, c) => s + c.positions, 0) })),
                canEdit: canEdit(ctx),
                canLink: ctx.role==='org_super_admin'||['INV.bin.link','WHS.bin.link','WMS.bin.link','INV.edit'].some(p=>hasPerm(ctx.permissions,p)),
                canUnlink: ctx.role==='org_super_admin'||['INV.bin.unlink','WHS.bin.unlink','WMS.bin.unlink','INV.edit'].some(p=>hasPerm(ctx.permissions,p)),
                canHistory: ctx.role==='org_super_admin'||['INV.bin.history','WHS.bin.history','WMS.bin.history','ADM.audit'].some(p=>hasPerm(ctx.permissions,p)),
            };
        }),
    ],

    'POST /api/org/warehouse/bin/detail': [orgRoute('org.warehouse.bin.detail',null,async ctx=>{if(!canView(ctx))throw new HttpError(403,'Storage access required.');const node=await storageCostCenter(ctx,str(ctx.body.costCenterId));const binId=str(ctx.body.binId);const root=`organizations/${ctx.orgId}`;const [occupancy,events]=await Promise.all([listDocs(root+'/warehouse_bin_occupancy'),listDocs(root+'/bin_material_events')]);const reservation=occupancy.find(x=>str(x.data.warehouseId)===node.id&&str(x.data.binId)===binId);const history=(ctx.role==='org_super_admin'||['INV.bin.history','WHS.bin.history','WMS.bin.history','ADM.audit'].some(p=>hasPerm(ctx.permissions,p)))?events.filter(x=>str(x.data.warehouseId)===node.id&&str(x.data.binId)===binId).sort((a,b)=>str(b.data.at).localeCompare(str(a.data.at))).map(x=>({id:x.id,...x.data})):[];if(!reservation)return {linked:false,history};const materialId=str(reservation.data.materialId);const [material,info]=await Promise.all([getDoc(`organizations/${ctx.orgId}/materials/${materialId}`),getDoc(`organizations/${ctx.orgId}/inventory_material_info/${materialId}_${node.id}`)]);return {linked:true,materialNumber:str(material?.data.materialNumber)||str(reservation.data.materialNumber),name:str(material?.data.name),shortText:str(material?.data.shortText),minimum:info?.data.minimumLevel??null,maximum:info?.data.maximumLevel??null,actual:info?.data.actualStock??info?.data.onHandQuantity??null,cost:info?.data.stockValue??null,materialId,history};})],
    'POST /api/org/warehouse/save': [
        orgRoute('org.warehouse.save', null, async (ctx) => {
            if (!canEdit(ctx)||!(ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'ADM.structure')||['INV.warehouse.configure','WHS.warehouse.configure','WMS.warehouse.configure'].some(p=>hasPerm(ctx.permissions,p)))) throw new HttpError(403, 'Warehouse configuration permission required.');
            const node = await storageCostCenter(ctx, str(ctx.body.costCenterId));
            const b = isObj(ctx.body.setup) ? (ctx.body.setup as Record<string, unknown>) : {};
            if (ctx.body.confirm !== true) throw new HttpError(400, 'Review the setup and confirm it is correct.');

            // Material categories (several allowed).
            const catalog = await materialCategories();
            if (!catalog.length) throw new HttpError(400, 'The material catalog has not been loaded by MEMS yet.');
            const categoryCodes = Array.from(new Set((Array.isArray(b.materialCategoryCodes) ? b.materialCategoryCodes : []).map(str).filter(Boolean)));
            if (!categoryCodes.length) throw new HttpError(400, 'Choose at least one material category.');
            if (categoryCodes.length > MAX_CATEGORIES) throw new HttpError(400, `A warehouse can hold up to ${MAX_CATEGORIES} material categories.`);
            const categories = categoryCodes.map((code) => {
                const c = catalog.find((x) => x.code === code);
                if (!c) throw new HttpError(400, `Material category ${code} is not in the material catalog.`);
                return c;
            });

            const storageType = STORAGE_TYPES.find(([c]) => c === str(b.storageTypeCode));
            if (!storageType) throw new HttpError(400, 'Choose the type of storage.');
            const condition = CONDITIONS.find(([c]) => c === str(b.conditionCode));
            if (!condition) throw new HttpError(400, 'Choose the storage condition.');

            // Storage locations: name, storage location type, material classification.
            const [classes, types] = await Promise.all([classifications(), locationTypes()]);
            const rawLocations = (Array.isArray(b.storageLocations) ? (b.storageLocations as Plain[]) : []).filter(isObj);
            if (!rawLocations.length) throw new HttpError(400, 'Add at least one storage location.');
            if (rawLocations.length > MAX_LOCATIONS) throw new HttpError(400, `A warehouse can have up to ${MAX_LOCATIONS} storage locations.`);

            const l = isObj(b.layout) ? (b.layout as Record<string, unknown>) : {};
            const rawFloors = (Array.isArray(l.floors) ? (l.floors as Plain[]) : []).filter(isObj);
            if (rawFloors.length < 1 || rawFloors.length > LIMITS.floors) throw new HttpError(400, `Configure between 1 and ${LIMITS.floors} floors.`);
            const floorNames = new Set<string>();
            const layout: Layout = {
                floors: rawFloors.map((f, i) => {
                    const tag = `Floor ${letter(i + 1)}`;
                    const racking = f.racking === true;
                    const name = str(f.name).trim().replace(/\s+/g, ' ') || tag;
                    if (name.length > 40) throw new HttpError(400, `${tag}: the name can be up to 40 characters.`);
                    if (floorNames.has(name.toLowerCase())) throw new HttpError(400, `${tag}: another floor already has the name ${name}.`);
                    floorNames.add(name.toLowerCase());
                    return {
                        name,
                        racking,
                        rows: int(f.rows, 1, LIMITS.rows, `${tag}: ${racking ? 'rack rows' : 'storage rows'}`),
                        racks: racking ? int(f.racks, 1, LIMITS.racks, `${tag}: racks per row`) : 1,
                        columns: racking ? int(f.columns, 1, LIMITS.columns, `${tag}: columns per rack`) : 1,
                        positions: int(f.positions, 1, LIMITS.positions, `${tag}: positions per ${racking ? 'column' : 'row'}`),
                    };
                }),
            };

            const c = isObj(b.capacity) ? (b.capacity as Record<string, unknown>) : {};
            const capacity = {
                totalAreaM2: dec(c.totalAreaM2, 1, 1_000_000, 'total floor area (m²)', true),
                storageAreaM2: dec(c.storageAreaM2, 1, 1_000_000, 'usable storage area (m²)', true),
                clearHeightM: dec(c.clearHeightM, 1, 60, 'clear height (m)', true),
                volumeM3: dec(c.volumeM3, 1, 60_000_000, 'storage volume (m³)', false),
                floorLoadKgM2: dec(c.floorLoadKgM2, 1, 100_000, 'floor load limit (kg/m²)', false),
                positionMaxKg: dec(c.positionMaxKg, 0.1, 100_000, 'maximum load per position (kg)', true),
                positionLengthCm: dec(c.positionLengthCm, 1, 5000, 'position length (cm)', false),
                positionWidthCm: dec(c.positionWidthCm, 1, 5000, 'position width (cm)', false),
                positionHeightCm: dec(c.positionHeightCm, 1, 5000, 'position height (cm)', false),
            };
            if ((capacity.storageAreaM2 ?? 0) > (capacity.totalAreaM2 ?? 0)) throw new HttpError(400, 'The usable storage area cannot be larger than the total floor area.');
            if (capacity.volumeM3 !== null && capacity.volumeM3 > (capacity.totalAreaM2 ?? 0) * (capacity.clearHeightM ?? 0) * layout.floors.length + 0.01) {
                throw new HttpError(400, 'The storage volume cannot exceed floor area × clear height × floors.');
            }

            return withLock(ctx, node.id, async () => {
                const existing = await getDoc(whPath(ctx.orgId, node.id));
                const clusters = existing ? await clustersOf(ctx.orgId, node.id, layoutOf(existing.data)) : [];
                const now = nowIso();

                // Storage locations: keep codes of existing ones, number new ones SL-01, SL-02 … (never reused).
                const previous = existing ? locationsOf(existing.data) : [];
                let seq = Math.max(Number(existing?.data.locationSeq) || 0, ...previous.map((p) => Number(p.code.slice(3)) || 0));
                const names = new Set<string>();
                const storageLocations: StoredLocation[] = rawLocations.map((raw, i) => {
                    const code = str(raw.code);
                    const before = code ? previous.find((p) => p.code === code) : undefined;
                    if (code && (!SL_RE.test(code) || !before)) throw new HttpError(400, `Storage location ${code} does not belong to this warehouse.`);
                    const tag = before ? before.code : `New storage location ${i + 1}`;
                    const name = str(raw.name).trim().replace(/\s+/g, ' ');
                    if (name.length < 2 || name.length > 60) throw new HttpError(400, `${tag}: enter a name of 2 to 60 characters.`);
                    if (names.has(name.toLowerCase())) throw new HttpError(400, `Two storage locations are called ${name}. Each needs its own name.`);
                    names.add(name.toLowerCase());
                    const type = types.find((t) => t.code === str(raw.typeCode));
                    if (!type || (!type.active && before?.typeCode !== type.code)) throw new HttpError(400, `${tag}: choose the storage location type.`);
                    const cls = classes.find((x) => x.code === str(raw.classificationCode));
                    if (!cls || (!cls.active && before?.classificationCode !== cls.code)) throw new HttpError(400, `${tag}: choose the material classification.`);
                    if (!before) {
                        seq += 1;
                        if (seq > 999) throw new HttpError(400, 'Storage location numbering is exhausted for this warehouse.');
                    }
                    return { code: before ? before.code : `SL-${String(seq).padStart(2, '0')}`, name, typeCode: type.code, classificationCode: cls.code, active: raw.active !== false, createdAt: before?.createdAt || now };
                });
                const kept = new Set(storageLocations.map((s) => s.code));
                const removed = previous.filter((p) => !kept.has(p.code));
                const removedInUse = removed.filter((p) => clusters.some((x) => x.locationCode === p.code));
                if (removedInUse.length && ctx.body.forceRemoveInUse !== true) throw new HttpError(400, `Storage locations ${removedInUse.map((p) => `${p.code} ${p.name}`).join(', ')} hold clusters. Confirm force removal to delete their clusters.`);

                // Categories still used by clusters cannot be removed.
                const usedCats = new Set(clusters.flatMap((x) => x.subcategories.map((s) => s.categoryCode)).filter(Boolean));
                const droppedCats = [...usedCats].filter((cc) => !categoryCodes.includes(cc));
                if (droppedCats.length && ctx.body.forceRemoveInUse !== true) throw new HttpError(400, `Material categories ${droppedCats.join(', ')} are used by clusters and cannot be removed without force confirmation.`);

                if (existing && clusters.length) {
                    const old = layoutOf(existing.data);
                    const lastUsed = Math.max(...clusters.map((x) => x.floorTo));
                    if (layout.floors.length < lastUsed) throw new HttpError(400, `Clusters exist on floor ${letter(lastUsed)}, so there must be at least ${lastUsed} floors.`);
                    layout.floors.forEach((floor, i) => {
                        const onFloor = clusters.filter((x) => x.floorFrom === i + 1);
                        if (!onFloor.length) return;
                        const tag = `Floor ${letter(i + 1)}`;
                        const o = old.floors[i];
                        if (o && o.racking !== floor.racking) throw new HttpError(400, `${tag} has clusters, so its racking cannot be switched. Remove its clusters first.`);
                        // Positions are numbered in sequence, so the arrangement inside a row is frozen while clusters exist.
                        if (o && (o.racks !== floor.racks || o.columns !== floor.columns || o.positions !== floor.positions)) {
                            throw new HttpError(400, `${tag} has clusters: racks per row, columns per rack and positions are fixed. Only rack rows can be added.`);
                        }
                        const usedRow = Math.max(...onFloor.map((x) => x.rowTo));
                        if (floor.rows < usedRow) throw new HttpError(400, `${tag}: clusters use up to rack row ${letter(usedRow)}. It cannot be made smaller than that.`);
                    });
                }

                const data: Fields = {
                    costCenterId: node.id,
                    costCenterCode: str(node.data.code),
                    materialCategoryCodes: categories.map((x) => x.code),
                    materialCategories: categories.map((x) => ({ code: x.code, name: x.name })) as unknown as Plain,
                    storageLocations: storageLocations as unknown as Plain,
                    locationSeq: seq,
                    storageTypeCode: storageType[0],
                    storageTypeLabel: storageType[1],
                    conditionCode: condition[0],
                    conditionLabel: condition[1],
                    layout: layout as unknown as Plain,
                    capacity: capacity as unknown as Plain,
                    updatedBy: ctx.uid,
                    updatedByName: displayName(ctx),
                    updatedAt: now,
                    createdAt: existing ? str(existing.data.createdAt) || now : now,
                };
                const affectedClusters=clusters.filter(x=>removedInUse.some(l=>l.code===x.locationCode)||x.subcategories.some(s=>droppedCats.includes(s.categoryCode)));if(affectedClusters.length){if(ctx.body.forceRemoveInUse!==true||str(ctx.body.forceConfirmation)!=='REMOVE IN USE')throw new HttpError(400,'Type REMOVE IN USE to confirm deleting affected clusters.');for(const cluster of affectedClusters)await deleteDoc(clusterCol(ctx.orgId,node.id)+'/'+cluster.code);}await writeDoc(whPath(ctx.orgId, node.id), data);
                const total = layoutPositions(layout);
                const typeLabel = (code: string) => types.find((t) => t.code === code)?.label ?? code;
                const clsLabel = (code: string) => classes.find((t) => t.code === code)?.label ?? code;
                await record(
                    ctx,
                    existing ? 'org.warehouse.update' : 'org.warehouse.create',
                    `Storage of cost center ${str(node.data.code)}`,
                    [
                        `Categories ${categories.map((x) => x.code).join(', ')}`,
                        `storage locations ${storageLocations.map((s) => `${s.code} ${s.name} (${typeLabel(s.typeCode)}, ${clsLabel(s.classificationCode)}${s.active ? '' : ', inactive'})`).join('; ')}`,
                        removed.length ? `removed ${removed.map((p) => p.code).join(', ')}` : '',
                        affectedClusters.length ? `FORCE REMOVED ${affectedClusters.length} clusters: ${affectedClusters.map(x=>x.code).join(', ')} by ${ctx.uid}` : '',
                        storageType[1],
                        layout.floors.map((f, i) => `${letter(i + 1)} ${f.name}: ${f.racking ? `${f.rows} rows × ${f.racks} racks × ${f.columns} columns × ${f.positions}` : `no racking, ${f.rows} rows × ${f.positions}`}`).join('; '),
                        `${total} positions`,
                    ]
                        .filter(Boolean)
                        .join(' · ')
                );
                return { ok: true, totalPositions: total };
            });
        }),
    ],

    'POST /api/org/warehouse/cluster/create': [
        orgRoute('org.warehouse.cluster.create', null, async (ctx) => {
            if (!canEdit(ctx)||!(ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'ADM.structure')||['INV.cluster.create','WHS.cluster.create','WMS.cluster.create'].some(p=>hasPerm(ctx.permissions,p)))) throw new HttpError(403, 'Create cluster permission required.');
            const node = await storageCostCenter(ctx, str(ctx.body.costCenterId));
            const b = ctx.body;
            if (b.confirm !== true) throw new HttpError(400, 'Review the cluster and confirm it is correct.');
            const name = str(b.name).trim().replace(/\s+/g, ' ');
            if (name.length > 60) throw new HttpError(400, 'The cluster name can be up to 60 characters.');
            const mode = str(b.mode);
            if (mode !== 'next' && mode !== 'start') throw new HttpError(400, 'Choose how the positions are allocated: next free space, or from a chosen starting bin.');

            return withLock(ctx, node.id, async () => {
                const wh = await getDoc(whPath(ctx.orgId, node.id));
                if (!wh) throw new HttpError(400, 'Set up the warehouse first.');
                const layout = layoutOf(wh.data);
                const floorNo = int(b.floor, 1, layout.floors.length, 'The floor');
                const floor = layout.floors[floorNo - 1];
                const total = floorPositions(floor);
                const size = int(b.count, 1, Math.min(MAX_CLUSTER_POSITIONS, total), 'The number of positions');

                // Storage location of this warehouse.
                const { locations } = await describeLocations(locationsOf(wh.data));
                const location = locations.find((x) => x.code === str(b.locationCode));
                if (!location) throw new HttpError(400, 'Choose one of the storage locations of this warehouse.');
                if (!location.active) throw new HttpError(400, `${location.code} ${location.name} is inactive. Choose another storage location.`);

                // Material subcategories, only from the warehouse's categories.
                const catalog = await materialCategories();
                const allowed = new Map(
                    catalog.filter((cat) => categoryCodesOf(wh.data).includes(cat.code)).flatMap((cat) => cat.subcategories.map((s) => [s.code, { code: s.code, name: s.name, categoryCode: cat.code }] as const))
                );
                const clusterClassification=str(b.classificationCode);if(!clusterClassification)throw new HttpError(400,'Choose a material classification.');if(clusterClassification!==location.classificationCode)throw new HttpError(409,'Cluster classification must match the storage location.');const subCodes = Array.from(new Set((Array.isArray(b.subcategoryCodes) ? b.subcategoryCodes : []).map(str).filter(Boolean)));
                if (!subCodes.length) throw new HttpError(400, 'Choose at least one material subcategory for the cluster.');
                if (subCodes.length > MAX_CLUSTER_SUBCATEGORIES) throw new HttpError(400, `A cluster can hold up to ${MAX_CLUSTER_SUBCATEGORIES} subcategories.`);
                const subcategories = subCodes.map((code) => {
                    const s = allowed.get(code);
                    if (!s) throw new HttpError(400, `Subcategory ${code} is not in this warehouse's material categories.`);
                    return s;
                });

                if(/hazard|flammab|corrosiv|toxic|oxidiz|explosiv|reactiv/i.test(location.classificationLabel)&&subCodes.length>1)throw new HttpError(409,'Hazardous materials require segregated clusters; do not combine subcategories without a compatibility assessment.');const storageType = STORAGE_TYPES.find(([c]) => c === (str(b.storageTypeCode) || str(wh.data.storageTypeCode)));
                if (!storageType) throw new HttpError(400, 'Choose the type of storage.');

                const clusters = await clustersOf(ctx.orgId, node.id, layout);
                if (clusters.length >= MAX_CLUSTERS) throw new HttpError(400, `A cost center can have up to ${MAX_CLUSTERS} clusters.`);
                const occupied = clusters.filter((c) => c.floor === floorNo).flatMap((c) => c.segments.map((s) => ({ s, c })));

                // Where the run starts. Positions are taken one after the other in sequence; never a range typed end to end.
                let start: number;
                if (mode === 'next') {
                    const found = nextFreeStart(total, occupied.map((o) => o.s), size);
                    if (found === null) throw new HttpError(400, `Floor ${letter(floorNo)} has no free space of ${size} positions in sequence. Use fewer positions or another floor.`);
                    start = found;
                    // The person confirmed a specific range; if the free space changed meanwhile, they must review it again.
                    if (Number(b.expectStart) !== start) throw new HttpError(409, `The free space on floor ${letter(floorNo)} has changed. Review the new range (${codeAt(floorNo, floor, start)} onwards) and confirm again.`);
                } else {
                    const r = int(b.startRow, 1, floor.rows, 'The starting rack row');
                    const k = floor.racking ? int(b.startRack, 1, floor.racks, 'The starting rack') : 1;
                    const c = floor.racking ? int(b.startCol, 1, floor.columns, 'The starting column') : 1;
                    const p = int(b.startPos, 1, floor.positions, 'The starting position');
                    start = ordOf(floor, r, k, c, p);
                }
                const end = start + size - 1;
                if (end > total - 1) throw new HttpError(400, `Only ${total - start} positions remain on floor ${letter(floorNo)} from ${codeAt(floorNo, floor, start)}. Use fewer positions or an earlier starting bin.`);
                const clash = occupied.find((o) => o.s[0] <= end && start <= o.s[1]);
                if (clash) throw new HttpError(409, `These positions overlap cluster ${clash.c.code} (${clash.c.firstCode} to ${clash.c.lastCode}). Every position can belong to one cluster only.`);

                const a = coordsOf(floor, start);
                const z = coordsOf(floor, end);
                const first = codeAt(floorNo, floor, start);
                const last = codeAt(floorNo, floor, end);
                const next = clusters.reduce((m, c) => Math.max(m, Number(c.code.slice(3)) || 0), 0) + 1;
                if (next > 9999) throw new HttpError(400, 'Cluster numbering is exhausted.');
                const code = `CL-${String(next).padStart(4, '0')}`;
                const now = nowIso();
                const ok = await writeDoc(
                    `${clusterCol(ctx.orgId, node.id)}/${code}`,
                    {
                        kind: 'run',
                        mode,
                        startOrd: start,
                        count: size,
                        dims: { racks: floor.racks, columns: floor.columns, positions: floor.positions },
                        floorFrom: floorNo,
                        floorTo: floorNo,
                        rowFrom: a.r,
                        rackFrom: a.k,
                        colFrom: a.c,
                        posFrom: a.p,
                        rowTo: z.r,
                        rackTo: z.k,
                        colTo: z.c,
                        posTo: z.p,
                        firstCode: first,
                        lastCode: last,
                        name,
                        locationCode: location.code,
                        locationName: location.name,
                        locationTypeCode: location.typeCode,
                        classificationCode: location.classificationCode,
                        classificationLabel: location.classificationLabel,
                        color: location.color,
                        subcategories: subcategories as unknown as Plain,
                        storageTypeCode: storageType[0],
                        storageTypeLabel: storageType[1],
                        positions: size,
                        createdBy: ctx.uid,
                        createdByName: displayName(ctx),
                        createdAt: now,
                    },
                    { exists: false }
                );
                if (!ok) throw new HttpError(409, 'Could not number the cluster. Please try again.');
                await updateFields(whPath(ctx.orgId, node.id), { updatedAt: now });
                await record(
                    ctx,
                    'org.warehouse.cluster.create',
                    `Cluster ${code} of ${str(node.data.code)}`,
                    `${mode === 'next' ? 'Next free space' : 'From chosen bin'} · ${first} to ${last} · ${size} positions · ${location.code} ${location.name} (${location.classificationLabel}) · ${subcategories.map((s) => s.code).join(', ')} · ${storageType[1]}`
                );
                return { code, positions: size, firstCode: first, lastCode: last };
            });
        }),
    ],

    'POST /api/org/warehouse/cluster/delete': [
        orgRoute('org.warehouse.cluster.delete', null, async (ctx) => {
            if (!canEdit(ctx)||!(ctx.role==='org_super_admin'||hasPerm(ctx.directPermissions,'ADM.structure')||['INV.cluster.delete','WHS.cluster.delete','WMS.cluster.delete'].some(p=>hasPerm(ctx.permissions,p)))) throw new HttpError(403, 'Delete cluster permission required.');
            const node = await storageCostCenter(ctx, str(ctx.body.costCenterId));
            const code = str(ctx.body.code);
            if (!CLUSTER_RE.test(code)) throw new HttpError(400, 'Invalid cluster.');
            if (str(ctx.body.confirm) !== code) throw new HttpError(400, `Type ${code} to confirm.`);
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 5) throw new HttpError(400, 'Give the reason for removing the cluster (at least 5 characters).');
            return withLock(ctx, node.id, async () => {
                const [doc, wh] = await Promise.all([getDoc(`${clusterCol(ctx.orgId, node.id)}/${code}`), getDoc(whPath(ctx.orgId, node.id))]);
                if (!doc) throw new HttpError(404, 'Cluster not found.');
                const c = clusterOut(doc, layoutOf(wh?.data ?? {}));
                await deleteDoc(`${clusterCol(ctx.orgId, node.id)}/${code}`);
                await record(ctx, 'org.warehouse.cluster.delete', `Cluster ${code} of ${str(node.data.code)}`, `${c.firstCode} to ${c.lastCode} · ${c.positions} positions · ${reason.slice(0, 300)}`);
                return { ok: true };
            });
        }),
    ],

    // Physical locations are generated from the cluster ranges, in sequence.
    'POST /api/org/warehouse/positions': [
        orgRoute('org.warehouse.positions', null, async (ctx) => {
            if (!canView(ctx)) throw new HttpError(403, 'You do not have permission to view storage setup.');
            const node = await storageCostCenter(ctx, str(ctx.body.costCenterId));
            const only = str(ctx.body.clusterCode);
            const [wh, catalog] = await Promise.all([getDoc(whPath(ctx.orgId, node.id)), materialCategories()]);
            const layout = layoutOf(wh?.data ?? {});
            const [all, { locations }] = await Promise.all([clustersOf(ctx.orgId, node.id, layout), describeLocations(locationsOf(wh?.data ?? {}))]);
            const reservations=await listDocs(`organizations/${ctx.orgId}/warehouse_bin_occupancy`);const linkedBins=reservations.filter(x=>str(x.data.warehouseId)===node.id).map(x=>({binId:str(x.data.binId),materialId:str(x.data.materialId),materialNumber:str(x.data.materialNumber)}));const byCode = new Map(locations.map((l) => [l.code, l]));
            const catName = new Map(catalog.map((c) => [c.code, c.name]));
            const clusters: ClusterOut[] = all.filter((c) => !only || c.code === only);
            const rows: Array<Record<string, string | number>> = [];
            for (const c of clusters) {
                const floor = layout.floors[c.floor - 1];
                if (!floor) continue;
                const loc = byCode.get(c.locationCode);
                const subs = c.subcategories.map((s) => `${s.code} ${s.name}`).join(', ');
                const cats = Array.from(new Set(c.subcategories.map((s) => s.categoryCode).filter(Boolean)))
                    .map((x) => `${x} ${catName.get(x) ?? ''}`.trim())
                    .join(', ');
                for (const [s, e] of c.segments)
                    for (let o = s; o <= e; o++) {
                        if (rows.length >= 20_000) return { rows, truncated: true };
                        const x = coordsOf(floor, o);
                        rows.push({
                            code: positionCode(c.floor, x.r, x.k, x.c, x.p),
                            floor: letter(c.floor),
                            row: letter(x.r),
                            rack: pad2(x.k),
                            column: letter(x.c),
                            position: pad2(x.p),
                            cluster: c.code,
                            locationCode: c.locationCode,
                            locationName: loc?.name ?? c.locationName,
                            locationType: loc?.typeLabel ?? '',
                            classification: loc?.classificationLabel ?? c.classificationLabel,
                            categories: cats,
                            subcategories: subs,
                            storageType: c.storageTypeLabel,
                        });
                    }
            }
            return { rows, truncated: false };
        }),
    ],
};
