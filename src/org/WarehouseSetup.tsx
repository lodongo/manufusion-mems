import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Boxes, Check, Copy, Layers, Map as MapIcon, Pencil, Plus, Search, Trash2, Warehouse, X } from 'lucide-react';
import { callBackend } from '../lib/backend';
import { Alert, Field, SelectField } from '../components/ui';
import RichTable, { type Column } from '../components/RichTable';
import { Badge, Button, Card, Spinner, TextArea, useLoad } from '../admin/kit';
import { fmtDate } from '../admin/format';

// Storage setup for Inventory (INV) and Warehousing (WHS) cost centers.
// Warehouse › storage location › physical location:
//   warehouse          material categories (one or more), layout per floor, capacity
//   storage location   a name + a storage location type + a material classification (colour), both from MEMS INV metadata
//   physical location  bins in clusters; each cluster sits in one storage location and is for material subcategories
//                      chosen from the warehouse's categories (subcategories are chosen only here)
// Position code AB_01_C_02 = floor A, rack row B, rack 01, column C (from the bottom), position 02.

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
interface Capacity {
    totalAreaM2: number | null;
    storageAreaM2: number | null;
    clearHeightM: number | null;
    volumeM3: number | null;
    floorLoadKgM2: number | null;
    positionMaxKg: number | null;
    positionLengthCm: number | null;
    positionWidthCm: number | null;
    positionHeightCm: number | null;
}
interface Loc {
    code: string;
    name: string;
    typeCode: string;
    typeLabel: string;
    classificationCode: string;
    classificationLabel: string;
    color: string;
    active: boolean;
}
interface Setup {
    materialCategoryCodes: string[];
    storageLocations: Loc[];
    storageTypeCode: string;
    conditionCode: string;
    layout: Layout;
    capacity: Capacity;
    updatedByName: string;
    updatedAt: string;
}
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
interface Cluster extends Range {
    code: string;
    name: string;
    /** run = positions taken in sequence (start + count); box = range of rows × racks × columns × positions (older clusters). */
    kind: 'run' | 'box';
    mode: string;
    floor: number;
    /** Ordinals of the positions held on the floor, as [first, last] ranges. */
    segments: Array<[number, number]>;
    positions: number;
    firstCode: string;
    lastCode: string;
    locationCode: string;
    locationName: string;
    classificationLabel: string;
    color: string;
    subcategories: Array<{ code: string; name: string; categoryCode: string }>;
    storageTypeCode: string;
    storageTypeLabel: string;
    createdByName: string;
    createdAt: string;
}
interface Category {
    code: string;
    name: string;
    subcategories: Array<{ code: string; name: string }>;
}
interface Opt {
    code: string;
    label: string;
}
interface Meta {
    code: string;
    label: string;
    color: string;
    active: boolean;
}
interface Data {
    costCenter: { id: string; code: string; name: string; costType: string };
    configured: boolean;
    setup: Setup | null;
    summary: { totalPositions: number; allocated: number; free: number; clusters: number };
    floorTotals?: Array<{ floor: string; positions: number; allocated: number }>;
    clusters: Cluster[];
    categories: Category[];
    classifications: Meta[];
    locationTypes: Meta[];
    storageTypes: Opt[];
    conditions: Opt[];
    limits: { floors: number; rows: number; racks: number; columns: number; positions: number; clusterPositions: number; locations: number; categories: number; clusterSubcategories: number };
    canEdit: boolean;
    canLink?: boolean;
    canUnlink?: boolean;
    canHistory?: boolean;
    linkedBins?: Array<{binId:string;materialId:string;materialNumber:string}>;
}

const letter = (n: number) => String.fromCharCode(64 + n);
const pad2 = (n: number) => String(n).padStart(2, '0');
const code = (f: number, r: number, k: number, c: number, p: number) => `${letter(f)}${letter(r)}_${pad2(k)}_${letter(c)}_${pad2(p)}`;
type FloorDim = 'rows' | 'racks' | 'columns' | 'positions';
interface Axis {
    from: keyof Range;
    to: keyof Range;
    dim: 'floor' | FloorDim;
    label: string;
    fmt: (n: number) => string;
}
const AXES: Axis[] = [
    { from: 'floorFrom', to: 'floorTo', dim: 'floor', label: 'Floor', fmt: letter },
    { from: 'rowFrom', to: 'rowTo', dim: 'rows', label: 'Rack row', fmt: letter },
    { from: 'rackFrom', to: 'rackTo', dim: 'racks', label: 'Rack', fmt: pad2 },
    { from: 'colFrom', to: 'colTo', dim: 'columns', label: 'Column (from bottom)', fmt: letter },
    { from: 'posFrom', to: 'posTo', dim: 'positions', label: 'Position', fmt: pad2 },
];
const FLOOR_AXES = AXES.slice(1) as Array<Axis & { dim: FloorDim }>;
const floorPositions = (f: FloorLayout) => f.rows * f.racks * f.columns * f.positions;

// Positions of a floor in sequence: rack row › rack › column (from the bottom) › position. Ordinal 0 = AA_01_A_01.
// Same arithmetic as the server, which re-checks everything under a lock.
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
    return code(floorNo, x.r, x.k, x.c, x.p);
};
type Seg = [number, number];
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
/** Sorted owner index of a floor, for fast look-up of which cluster holds a position. */
type OwnerIndex = Array<{ s: number; e: number; c: Cluster }>;
const ownerIndex = (clusters: Cluster[]): OwnerIndex =>
    clusters
        .flatMap((c) => c.segments.map(([s, e]) => ({ s, e, c })))
        .sort((a, b) => a.s - b.s);
function ownerAt(index: OwnerIndex, o: number): Cluster | undefined {
    let lo = 0;
    let hi = index.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const x = index[mid];
        if (o < x.s) hi = mid - 1;
        else if (o > x.e) lo = mid + 1;
        else return x.c;
    }
    return undefined;
}

// Colours come from the material classification of each storage location (codified by MEMS in INV metadata).
function locationColors(clusters: Cluster[]) {
    return new Map(clusters.map((c) => [c.locationCode, c.color || '#64748B']));
}

function LocDot({ color, size = 'h-3 w-3' }: { color: string; size?: string }) {
    return <span className={`${size} shrink-0 rounded`} style={{ background: color || '#64748B' }} />;
}

type Tab = 'setup' | 'topology' | 'clusters' | 'positions';

export default function WarehouseSetup({ costCenterId, onBack }: { costCenterId: string; onBack: () => void }) {
    const { data, error, loading, reload } = useLoad(() => callBackend<Data>('/api/org/warehouse/get', { costCenterId }), [costCenterId]);
    const [tab, setTab] = useState<Tab>('setup');
    const [editing, setEditing] = useState(false);
    const [newCluster, setNewCluster] = useState(false);
    const [openCluster, setOpenCluster] = useState('');
    const [positionsOf, setPositionsOf] = useState('');

    if (loading && !data) return <Spinner />;
    if (error || !data) return <Alert tone='error'>{error || 'Could not load the storage setup.'}</Alert>;
    const d = data;
    const done = () => {
        setEditing(false);
        setNewCluster(false);
        setOpenCluster('');
        reload();
    };

    if ((editing || !d.configured) && d.canEdit && tab === 'setup') return <SetupForm data={d} onDone={() => (done(), setTab('topology'))} onCancel={d.configured ? () => setEditing(false) : onBack} />;
    if (newCluster && d.setup) return <ClusterForm data={d} onDone={(c) => (done(), setTab('clusters'), setOpenCluster(c))} onCancel={() => setNewCluster(false)} />;
    const cluster = d.clusters.find((c) => c.code === openCluster);

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={cluster ? () => setOpenCluster('') : onBack}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-emerald-300'>{d.costCenter.code}</p>
                        <p className='truncate font-semibold text-white'>Storage · {d.costCenter.name}</p>
                    </div>
                    {tab === 'setup' && d.canEdit && d.configured && (
                        <Button variant='secondary' onClick={() => setEditing(true)}>
                            <Pencil className='h-4 w-4' />
                            Edit
                        </Button>
                    )}
                    {(tab === 'clusters' || tab === 'topology') && d.canEdit && d.configured && !cluster && (
                        <Button onClick={() => setNewCluster(true)}>
                            <Plus className='h-4 w-4' />
                            Cluster
                        </Button>
                    )}
                </div>
                <div className='flex gap-1 overflow-x-auto rounded-xl border border-slate-800 p-1'>
                    {(
                        [
                            ['setup', 'Layout & capacity'],
                            ['topology', 'Physical storage'],
                            ['clusters', `Clusters (${d.clusters.length})`],
                            ['positions', 'Positions'],
                        ] as Array<[Tab, string]>
                    ).map(([k, label]) => (
                        <button key={k} type='button' onClick={() => (setTab(k), setOpenCluster(''))} className={`h-9 shrink-0 rounded-lg px-3 text-sm ${tab === k ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {!d.configured && !d.canEdit && <Alert tone='info'>Storage has not been set up for this cost center yet.</Alert>}
                {tab === 'setup' && d.setup && <SetupView data={d} setup={d.setup} onTopology={() => setTab('topology')} />}
                {tab === 'topology' && d.setup && <PhysicalStorage data={d} setup={d.setup} reload={reload} />}
                {tab === 'clusters' && !cluster && <ClusterList data={d} onOpen={setOpenCluster} />}
                {tab === 'clusters' && cluster && <ClusterDetail data={d} cluster={cluster} onDeleted={done} onPositions={() => (setPositionsOf(cluster.code), setTab('positions'), setOpenCluster(''))} />}
                {tab === 'positions' && <PositionList data={d} clusterCode={positionsOf} onCluster={setPositionsOf} />}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Layout and capacity
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className='rounded-xl border border-slate-800 bg-slate-950 p-3'>
            <p className='text-[11px] uppercase tracking-wider text-slate-500'>{label}</p>
            <p className='mt-0.5 text-lg font-semibold text-white'>{value}</p>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className='grid grid-cols-[9.5rem_1fr] gap-2 text-sm'>
            <span className='text-xs text-slate-500'>{label}</span>
            <span className='text-slate-200'>{value}</span>
        </div>
    );
}

const n = (v: number | null, unit: string) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString()} ${unit}`);

function floorSummary(f: FloorLayout) {
    return f.racking ? `${f.rows} rack rows × ${f.racks} racks × ${f.columns} columns × ${f.positions} positions` : `Floor storage · ${f.rows} rows × ${f.positions} positions`;
}

function SetupView({ data, setup, onTopology }: { data: Data; setup: Setup; onTopology: () => void }) {
    const s = data.summary;
    const type = data.storageTypes.find((t) => t.code === setup.storageTypeCode)?.label ?? setup.storageTypeCode;
    const cond = data.conditions.find((t) => t.code === setup.conditionCode)?.label ?? setup.conditionCode;
    const c = setup.capacity;
    const catName = (code: string) => data.categories.find((x) => x.code === code)?.name ?? code;
    return (
        <>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                <Stat label='Positions' value={s.totalPositions.toLocaleString()} />
                <Stat label='In clusters' value={s.allocated.toLocaleString()} />
                <Stat label='Free' value={s.free.toLocaleString()} />
                <Stat label='Used' value={s.totalPositions ? `${Math.round((s.allocated / s.totalPositions) * 100)}%` : '0%'} />
            </div>
            <Card className='space-y-2'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Material categories ({setup.materialCategoryCodes.length})</p>
                <div className='flex flex-wrap gap-1'>
                    {setup.materialCategoryCodes.map((code) => (
                        <Badge key={code}>
                            {code} · {catName(code)}
                        </Badge>
                    ))}
                </div>
                <Row label='Type of storage' value={type} />
                <Row label='Condition' value={cond} />
            </Card>
            <Card className='space-y-2'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Storage locations ({setup.storageLocations.length})</p>
                {setup.storageLocations.map((l) => {
                    const used = data.clusters.filter((x) => x.locationCode === l.code).reduce((sum, x) => sum + x.positions, 0);
                    return (
                        <div key={l.code} className='rounded-xl border-l-4 border-slate-800 bg-slate-950 p-3' style={{ borderLeftColor: l.color }}>
                            <div className='flex items-center gap-2'>
                                <span className='min-w-0 flex-1 truncate text-sm font-medium text-white'>{l.name}</span>
                                <span className='font-mono text-[11px] text-slate-500'>{l.code}</span>
                            </div>
                            <p className='mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400'>
                                <span>{l.typeLabel}</span>
                                <span className='inline-flex items-center gap-1'>
                                    <LocDot color={l.color} />
                                    {l.classificationLabel}
                                </span>
                                <span>{used.toLocaleString()} positions</span>
                                {!l.active && <span className='text-amber-300'>inactive</span>}
                            </p>
                        </div>
                    );
                })}
            </Card>
            <Card className='space-y-2'>
                <div className='flex items-center justify-between'>
                    <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Floors ({setup.layout.floors.length})</p>
                    <button type='button' onClick={onTopology} className='flex items-center gap-1 text-xs text-emerald-300'>
                        <MapIcon className='h-3.5 w-3.5' />
                        View physical storage
                    </button>
                </div>
                {setup.layout.floors.map((f, i) => {
                    const t = data.floorTotals?.[i];
                    return (
                        <div key={i} className='rounded-xl border border-slate-800 p-3'>
                            <div className='flex items-center gap-2'>
                                <span className='flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 font-mono text-sm font-bold text-emerald-300'>{letter(i + 1)}</span>
                                <span className='min-w-0 flex-1 truncate text-sm font-medium text-white'>{f.name}</span>
                                <span className='text-xs text-slate-400'>{floorPositions(f).toLocaleString()} positions</span>
                            </div>
                            <p className='mt-1 text-xs text-slate-400'>{floorSummary(f)}</p>
                            <p className='mt-0.5 font-mono text-[11px] text-slate-500'>
                                {code(i + 1, 1, 1, 1, 1)} to {code(i + 1, f.rows, f.racks, f.columns, f.positions)}
                                {t ? ` · ${t.allocated.toLocaleString()} in clusters` : ''}
                            </p>
                        </div>
                    );
                })}
            </Card>
            <Card className='space-y-2'>
                <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>Capacity and space</p>
                <Row label='Total floor area' value={n(c.totalAreaM2, 'm²')} />
                <Row label='Usable storage area' value={n(c.storageAreaM2, 'm²')} />
                <Row label='Clear height' value={n(c.clearHeightM, 'm')} />
                <Row label='Storage volume' value={n(c.volumeM3, 'm³')} />
                <Row label='Floor load limit' value={n(c.floorLoadKgM2, 'kg/m²')} />
                <Row label='Max load per position' value={n(c.positionMaxKg, 'kg')} />
                <Row label='Position size (L×W×H)' value={c.positionLengthCm ? `${c.positionLengthCm} × ${c.positionWidthCm ?? '—'} × ${c.positionHeightCm ?? '—'} cm` : '—'} />
                <Row label='Total load capacity' value={c.positionMaxKg ? `${(c.positionMaxKg * s.totalPositions).toLocaleString()} kg` : '—'} />
            </Card>
            {setup.updatedAt && <p className='text-xs text-slate-500'>Last changed by {setup.updatedByName} · {fmtDate(setup.updatedAt)}</p>}
        </>
    );
}

function NumField({ id, label, value, onChange, hint, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
    return (
        <div>
            <Field id={id} label={label} type='number' inputMode='numeric' min={0} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
            {hint && <p className='mt-0.5 text-[11px] text-slate-500'>{hint}</p>}
        </div>
    );
}

interface FloorDraft {
    name: string;
    racking: boolean | null;
    rows: string;
    racks: string;
    columns: string;
    positions: string;
}
const draftOf = (f: FloorLayout): FloorDraft => ({ name: f.name, racking: f.racking, rows: String(f.rows), racks: f.racking ? String(f.racks) : '', columns: f.racking ? String(f.columns) : '', positions: String(f.positions) });
interface LocDraft {
    key: string;
    code?: string;
    name: string;
    typeCode: string;
    classificationCode: string;
    active: boolean;
}
let locDraftSeq = 0;
const blankLoc = (): LocDraft => ({ key: `new-${++locDraftSeq}`, name: '', typeCode: '', classificationCode: '', active: true });
const blankFloor = (i: number): FloorDraft => ({ name: i === 0 ? 'Ground floor' : `Floor ${letter(i + 1)}`, racking: null, rows: '', racks: '', columns: '', positions: '' });

function SetupForm({ data, onDone, onCancel }: { data: Data; onDone: () => void; onCancel: () => void }) {
    const s = data.setup;
    const clusterFloors = new Set(data.clusters.map((c) => c.floorFrom));
    const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
    const [cats, setCats] = useState<string[]>(s?.materialCategoryCodes ?? []);
    const [catQ, setCatQ] = useState('');
    const [storageType, setStorageType] = useState(s?.storageTypeCode ?? '');
    const [condition, setCondition] = useState(s?.conditionCode ?? 'AMB');
    const [locs, setLocs] = useState<LocDraft[]>(s?.storageLocations.length ? s.storageLocations.map((l) => ({ key: l.code, code: l.code, name: l.name, typeCode: l.typeCode, classificationCode: l.classificationCode, active: l.active })) : [blankLoc()]);
    const usedLocations = new Set(data.clusters.map((c) => c.locationCode));
    const usedCategories = new Set(data.clusters.flatMap((c) => c.subcategories.map((x) => x.categoryCode)));
    const toggleCat = (code: string) => setCats((cur) => (cur.includes(code) ? (usedCategories.has(code)&&!forceRemove ? cur : cur.filter((x) => x !== code)) : [...cur, code]));
    const updLoc = (key: string, patch: Partial<LocDraft>) => setLocs((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const [floors, setFloors] = useState<FloorDraft[]>(s?.layout.floors.length ? s.layout.floors.map(draftOf) : [blankFloor(0)]);
    const [open, setOpen] = useState(0);
    const c0 = s?.capacity;
    const [cap, setCap] = useState({
        totalAreaM2: str(c0?.totalAreaM2),
        storageAreaM2: str(c0?.storageAreaM2),
        clearHeightM: str(c0?.clearHeightM),
        volumeM3: str(c0?.volumeM3),
        floorLoadKgM2: str(c0?.floorLoadKgM2),
        positionMaxKg: str(c0?.positionMaxKg),
        positionLengthCm: str(c0?.positionLengthCm),
        positionWidthCm: str(c0?.positionWidthCm),
        positionHeightCm: str(c0?.positionHeightCm),
    });
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showSaveIssues,setShowSaveIssues]=useState(false);
    const [forceRemove,setForceRemove]=useState(false);
    const L = data.limits;

    const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
    const layoutFloors: FloorLayout[] = floors.map((f) => ({
        name: f.name.trim(),
        racking: f.racking === true,
        rows: num(f.rows),
        racks: f.racking ? num(f.racks) : 1,
        columns: f.racking ? num(f.columns) : 1,
        positions: num(f.positions),
    }));
    const floorProblems = floors.map((f, i) => {
        const out: string[] = [];
        const lf = layoutFloors[i];
        const checkInt = (v: number, max: number, label: string) => {
            if (!Number.isInteger(v) || v < 1 || v > max) out.push(`${label}: whole number from 1 to ${max}.`);
        };
        if (f.racking === null) out.push('Say whether this floor uses racking.');
        if (lf.name.length > 40) out.push('The name can be up to 40 characters.');
        checkInt(lf.rows, L.rows, f.racking ? 'Rack rows' : 'Rows');
        if (f.racking) {
            checkInt(lf.racks, L.racks, 'Racks per row');
            checkInt(lf.columns, L.columns, 'Columns per rack');
        }
        checkInt(lf.positions, L.positions, f.racking ? 'Positions per column' : 'Positions per row');
        const onFloor = data.clusters.filter((c) => c.floorFrom === i + 1);
        if (onFloor.length && s?.layout.floors[i]) {
            const o = s.layout.floors[i];
            if (o.racking !== (f.racking === true)) out.push('This floor has clusters, so racking cannot be switched.');
            if (lf.racks !== o.racks || lf.columns !== o.columns || lf.positions !== o.positions) out.push(`This floor has clusters: racks per row (${o.racks}), columns per rack (${o.columns}) and positions (${o.positions}) are fixed.`);
            const usedRow = Math.max(...onFloor.map((c) => c.rowTo));
            if (lf.rows < usedRow) out.push(`Rack rows: clusters already use up to row ${letter(usedRow)}.`);
        }
        return out;
    });
    const names = layoutFloors.map((f, i) => (f.name || `Floor ${letter(i + 1)}`).toLowerCase());
    const problems: string[] = [];
    if (!cats.length) problems.push('Choose at least one material category.');
    if (cats.length > L.categories) problems.push(`Up to ${L.categories} material categories.`);
    if (!storageType) problems.push('Choose the type of storage.');
    const locProblems = locs.map((l) => {
        const out: string[] = [];
        if (l.name.trim().length < 2 || l.name.trim().length > 60) out.push('name of 2 to 60 characters');
        if (!data.locationTypes.some((t) => t.code === l.typeCode)) out.push('storage location type');
        if (!data.classifications.some((t) => t.code === l.classificationCode)) out.push('material classification');
        return out;
    });
    if (!locs.length) problems.push('Add at least one storage location.');
    if (locs.length > L.locations) problems.push(`Up to ${L.locations} storage locations.`);
    locProblems.forEach((p, i) => p.length && problems.push(`Storage location ${locs[i].code ?? i + 1}: ${p.join(', ')}.`));
    const locNames = locs.map((l) => l.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(locNames).size !== locNames.length) problems.push('Each storage location needs its own name.');
    floorProblems.forEach((p, i) => p.length && problems.push(`Floor ${letter(i + 1)}: ${p[0]}${p.length > 1 ? ` (+${p.length - 1} more)` : ''}`));
    if (new Set(names).size !== names.length) problems.push('Each floor needs a different name.');
    const total = num(cap.totalAreaM2);
    const usable = num(cap.storageAreaM2);
    const height = num(cap.clearHeightM);
    if (!(total > 0)) problems.push('Enter the total floor area.');
    if (!(usable > 0)) problems.push('Enter the usable storage area.');
    if (usable > total) problems.push('Usable storage area cannot exceed the total floor area.');
    if (!(height > 0)) problems.push('Enter the clear height.');
    if (!(num(cap.positionMaxKg) > 0)) problems.push('Enter the maximum load per position.');
    const vol = num(cap.volumeM3);
    if (!Number.isNaN(vol) && total > 0 && height > 0 && vol > total * height * floors.length) problems.push('Storage volume cannot exceed floor area × clear height × floors.');
    const lastUsedFloor = Math.max(0, ...data.clusters.map((c) => c.floorTo));
    const floorOk = (i: number) => floorProblems[i].length === 0;
    const positions = layoutFloors.reduce((sum, f, i) => sum + (floorOk(i) ? floorPositions(f) : 0), 0);

    const setFloorCount = (v: string) => {
        const count = Number(v);
        if (!Number.isInteger(count) || count < 1 || count > L.floors) return;
        if (count < lastUsedFloor) return setError(`Clusters exist on floor ${letter(lastUsedFloor)}, so you need at least ${lastUsedFloor} floors.`);
        setError('');
        setFloors((cur) => (count <= cur.length ? cur.slice(0, count) : [...cur, ...Array.from({ length: count - cur.length }, (_, j) => blankFloor(cur.length + j))]));
        setOpen((o) => Math.min(o, count - 1));
    };
    const updFloor = (i: number, patch: Partial<FloorDraft>) => setFloors((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));
    const copyToOthers = (i: number) => {
        const src = floors[i];
        setFloors((cur) => cur.map((f, j) => (j === i || clusterFloors.has(j + 1) ? f : { ...f, racking: src.racking, rows: src.rows, racks: src.racks, columns: src.columns, positions: src.positions })));
    };

    const save = async () => {
        if(problems.length){setShowSaveIssues(true);setError('Resolve the issues listed above before saving.');return;}
        if(!confirmed){setShowSaveIssues(true);setError('Confirm the warehouse layout and capacity before saving.');return;}
        setBusy(true);
        setError('');
        try {
            const capacity = Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, v.trim() === '' ? '' : Number(v)]));
            const impacted=data.clusters.filter(c=>!locs.some(l=>l.code===c.locationCode)||c.subcategories.some(s=>!cats.includes(s.categoryCode)));
            if(impacted.length&&(!forceRemove||window.prompt('This will permanently remove '+impacted.length+' affected clusters and their bin allocations. Type REMOVE IN USE to confirm.')!=='REMOVE IN USE')){setError('Removal cancelled.');return;}
            await callBackend('/api/org/warehouse/save', {
                forceRemoveInUse:impacted.length>0,
                forceConfirmation:impacted.length>0?'REMOVE IN USE':'',
                costCenterId: data.costCenter.id,
                confirm: confirmed,
                setup: {
                    materialCategoryCodes: cats,
                    storageLocations: locs.map((l) => ({ code: l.code, name: l.name.trim(), typeCode: l.typeCode, classificationCode: l.classificationCode, active: l.active })),
                    storageTypeCode: storageType,
                    conditionCode: condition,
                    layout: { floors: layoutFloors.map((f, i) => ({ ...f, name: f.name || `Floor ${letter(i + 1)}` })) }, capacity },
            });
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the storage setup.');
        } finally {
            setBusy(false);
        }
    };
    const setC = (k: keyof typeof cap) => (v: string) => setCap((x) => ({ ...x, [k]: v }));

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-1 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={onCancel}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-emerald-300'>{data.costCenter.code}</p>
                        <p className='truncate font-semibold text-white'>{s ? 'Edit storage setup' : 'Set up storage'}</p>
                    </div>
                    <Button busy={busy} disabled={busy} onClick={save}>
                        <Check className='h-4 w-4' />
                        Save
                    </Button>
                </div>
                {(showSaveIssues||error)&&<div role='alert' className='rounded-lg border border-amber-500 bg-amber-950/95 p-3 text-sm text-amber-100'><p className='font-semibold'>{error||'Complete the following before saving:'}</p>{problems.length>0&&<ul className='mt-2 list-disc pl-5'>{problems.slice(0,12).map((p,i)=><li key={i}>{p}</li>)}</ul>}{!confirmed&&<p className='mt-1'>Scroll to the bottom and tick the layout and capacity confirmation checkbox.</p>}</div>}
                <label className='flex items-center gap-2 text-xs text-red-200'><input type='checkbox' checked={forceRemove} onChange={e=>setForceRemove(e.target.checked)}/> Force remove in-use categories or storage locations (deletes affected clusters after confirmation)</label>
                <p className='text-xs text-slate-400'>
                    {floors.length} floor{floors.length === 1 ? '' : 's'} · {positions.toLocaleString()} storage positions
                </p>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                {data.categories.length === 0 && <Alert tone='error'>The material catalog has not been loaded by MEMS yet, so no material category can be chosen.</Alert>}
                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>1 · Material categories in this warehouse *</p>
                    <p className='text-xs text-slate-400'>Choose every category stored here. Subcategories are chosen later, when you create each cluster of bins.</p>
                    {cats.length > 0 && (
                        <div className='flex flex-wrap gap-1'>
                            {cats.map((code) => (
                                <button key={code} type='button' onClick={() => toggleCat(code)} className='flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-emerald-500/70'>
                                    <span className='font-mono'>{code}</span> {data.categories.find((c) => c.code === code)?.name ?? ''}
                                    {usedCategories.has(code)&&!forceRemove ? <span className='text-[10px] text-amber-300'>in use</span> : <X className='h-3 w-3' />}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className='relative'>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                        <input value={catQ} onChange={(e) => setCatQ(e.target.value)} placeholder={`Search ${data.categories.length} categories…`} className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white' />
                    </div>
                    <ul className='max-h-60 space-y-1 overflow-y-auto overscroll-contain'>
                        {data.categories
                            .filter((c) => !catQ.trim() || `${c.code} ${c.name}`.toLowerCase().includes(catQ.trim().toLowerCase()))
                            .map((c) => {
                                const on = cats.includes(c.code);
                                return (
                                    <li key={c.code}>
                                        <button type='button' onClick={() => toggleCat(c.code)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${on ? 'bg-slate-800 text-white ring-1 ring-emerald-400' : 'text-slate-300 active:bg-slate-800'}`}>
                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'}`}>{on && <Check className='h-3.5 w-3.5 text-white' />}</span>
                                            <span className='min-w-0 flex-1'>
                                                {c.name}
                                                <span className='block font-mono text-[11px] text-slate-500'>
                                                    {c.code} · {c.subcategories.length} subcategories
                                                </span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                    </ul>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>2 · Storage locations *</p>
                    <p className='text-xs text-slate-400'>Each storage location has a name, a storage location type and a material classification (its colour). Types and classifications are codified by MEMS. Codes SL-01, SL-02… are given automatically.</p>
                    {locs.map((l, i) => {
                        const cls = data.classifications.find((x) => x.code === l.classificationCode);
                        const inUse = !!l.code && usedLocations.has(l.code);
                        return (
                            <div key={l.key} className='space-y-2 rounded-xl border-l-4 border-slate-800 bg-slate-950 p-3' style={{ borderLeftColor: cls?.color ?? '#334155' }}>
                                <div className='flex items-center gap-2'>
                                    <span className='font-mono text-xs text-emerald-300'>{l.code ?? `New ${i + 1}`}</span>
                                    <span className='flex-1' />
                                    {l.code && (
                                        <label className='flex items-center gap-1 text-xs text-slate-300'>
                                            <input type='checkbox' className='h-4 w-4 accent-emerald-500' checked={l.active} onChange={(e) => updLoc(l.key, { active: e.target.checked })} />
                                            Active
                                        </label>
                                    )}
                                    <button type='button' aria-label='Remove storage location' disabled={inUse&&!forceRemove} onClick={() => setLocs((cur) => cur.filter((x) => x.key !== l.key))} className='text-red-300 disabled:opacity-30'>
                                        <Trash2 className='h-4 w-4' />
                                    </button>
                                </div>
                                <Field id={`loc-name-${l.key}`} label='Name *' maxLength={60} placeholder='e.g. Main spares store' value={l.name} onChange={(e) => updLoc(l.key, { name: e.target.value })} />
                                <SelectField id={`loc-type-${l.key}`} label='Storage location type *' value={l.typeCode} onChange={(e) => updLoc(l.key, { typeCode: e.target.value })}>
                                    <option value=''>Select…</option>
                                    {data.locationTypes.map((t) => (
                                        <option key={t.code} value={t.code} disabled={!t.active && t.code !== l.typeCode}>
                                            {t.label}
                                        </option>
                                    ))}
                                </SelectField>
                                <p className='text-sm text-slate-300'>Material classification *</p>
                                <div className='flex flex-wrap gap-1.5'>
                                    {data.classifications
                                        .filter((x) => x.active || x.code === l.classificationCode)
                                        .map((x) => {
                                            const on = x.code === l.classificationCode;
                                            return (
                                                <button key={x.code} type='button' onClick={() => updLoc(l.key, { classificationCode: x.code })} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs ${on ? 'text-white' : 'border-slate-700 text-slate-300'}`} style={on ? { borderColor: x.color, background: `${x.color}33` } : undefined}>
                                                    <LocDot color={x.color} />
                                                    {x.label}
                                                </button>
                                            );
                                        })}
                                </div>
                                {inUse && <p className='text-[11px] text-amber-300'>Holds clusters: it cannot be removed.</p>}
                            </div>
                        );
                    })}
                    <Button variant='secondary' className='w-full' disabled={locs.length >= L.locations} onClick={() => setLocs((cur) => [...cur, blankLoc()])}>
                        <Plus className='h-4 w-4' />
                        Add storage location
                    </Button>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>3 · Storage equipment and condition</p>
                    <SelectField id='wh-type' label='Type of storage *' value={storageType} onChange={(e) => setStorageType(e.target.value)}>
                        <option value=''>Select…</option>
                        {data.storageTypes.map((t) => (
                            <option key={t.code} value={t.code}>
                                {t.label}
                            </option>
                        ))}
                    </SelectField>
                    <SelectField id='wh-cond' label='Storage condition *' value={condition} onChange={(e) => setCondition(e.target.value)}>
                        {data.conditions.map((t) => (
                            <option key={t.code} value={t.code}>
                                {t.label}
                            </option>
                        ))}
                    </SelectField>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>4 · Floors</p>
                    <p className='text-xs text-slate-400'>Each floor is set up on its own. Floors are lettered A (ground) upwards.</p>
                    <SelectField id='wh-floors' label='Number of floors *' value={String(floors.length)} onChange={(e) => setFloorCount(e.target.value)}>
                        {Array.from({ length: L.floors }, (_, i) => i + 1).map((v) => (
                            <option key={v} value={v} disabled={v < lastUsedFloor}>
                                {v} (A{v > 1 ? ` to ${letter(v)}` : ''})
                            </option>
                        ))}
                    </SelectField>
                    <div className='flex gap-1 overflow-x-auto pb-1'>
                        {floors.map((f, i) => (
                            <button key={i} type='button' onClick={() => setOpen(i)} className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs ${open === i ? 'bg-emerald-500 text-onbrand' : floorOk(i) ? 'bg-slate-800 text-slate-200' : 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/40'}`}>
                                <span className='font-mono font-bold'>{letter(i + 1)}</span>
                                {floorOk(i) ? <Check className='h-3 w-3' /> : <span>!</span>}
                            </button>
                        ))}
                    </div>
                    {floors[open] && (
                        <FloorEditor
                            index={open}
                            floor={floors[open]}
                            limits={L}
                            hasClusters={clusterFloors.has(open + 1)}
                            problems={floorProblems[open]}
                            positions={floorOk(open) ? floorPositions(layoutFloors[open]) : 0}
                            onChange={(patch) => updFloor(open, patch)}
                            onCopy={floors.length > 1 ? () => copyToOthers(open) : undefined}
                        />
                    )}
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>5 · Capacity and space (whole store)</p>
                    <div className='grid grid-cols-2 gap-2'>
                        <NumField id='wh-area' label='Total floor area (m²) *' value={cap.totalAreaM2} onChange={setC('totalAreaM2')} />
                        <NumField id='wh-usable' label='Usable storage area (m²) *' value={cap.storageAreaM2} onChange={setC('storageAreaM2')} />
                        <NumField id='wh-height' label='Clear height (m) *' value={cap.clearHeightM} onChange={setC('clearHeightM')} />
                        <NumField id='wh-vol' label='Storage volume (m³)' value={cap.volumeM3} onChange={setC('volumeM3')} />
                        <NumField id='wh-load' label='Floor load limit (kg/m²)' value={cap.floorLoadKgM2} onChange={setC('floorLoadKgM2')} />
                        <NumField id='wh-pkg' label='Max load per position (kg) *' value={cap.positionMaxKg} onChange={setC('positionMaxKg')} />
                    </div>
                    <p className='text-xs text-slate-400'>Standard position size (optional)</p>
                    <div className='grid grid-cols-3 gap-2'>
                        <NumField id='wh-pl' label='Length (cm)' value={cap.positionLengthCm} onChange={setC('positionLengthCm')} />
                        <NumField id='wh-pw' label='Width (cm)' value={cap.positionWidthCm} onChange={setC('positionWidthCm')} />
                        <NumField id='wh-ph' label='Height (cm)' value={cap.positionHeightCm} onChange={setC('positionHeightCm')} />
                    </div>
                </Card>

                {problems.length > 0 && (
                    <ul className='space-y-0.5 text-xs text-amber-300'>
                        {problems.map((p) => (
                            <li key={p}>• {p}</li>
                        ))}
                    </ul>
                )}
                <label className='flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-slate-200'>
                    <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    I confirm this layout and capacity are correct. {positions ? `${positions.toLocaleString()} storage positions on ${floors.length} floor${floors.length === 1 ? '' : 's'} will be available for clusters.` : ''}
                </label>
                {error && <Alert tone='error'>{error}</Alert>}
            </div>
        </div>
    );
}

function FloorEditor({
    index,
    floor,
    limits,
    hasClusters,
    problems,
    positions,
    onChange,
    onCopy,
}: {
    index: number;
    floor: FloorDraft;
    limits: Data['limits'];
    hasClusters: boolean;
    problems: string[];
    positions: number;
    onChange: (patch: Partial<FloorDraft>) => void;
    onCopy?: () => void;
}) {
    const f = index + 1;
    const r = Number(floor.rows) || 1;
    const k = floor.racking ? Number(floor.racks) || 1 : 1;
    const c = floor.racking ? Number(floor.columns) || 1 : 1;
    const p = Number(floor.positions) || 1;
    return (
        <div className='space-y-3 rounded-xl border border-slate-800 p-3'>
            <div className='flex items-center gap-2'>
                <span className='flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 font-mono font-bold text-emerald-300'>{letter(f)}</span>
                <div className='min-w-0 flex-1'>
                    <Field id={`fl-name-${index}`} label='Floor name' maxLength={40} value={floor.name} onChange={(e) => onChange({ name: e.target.value })} />
                </div>
            </div>
            {hasClusters && <p className='text-xs text-amber-300'>This floor has clusters, which are numbered in sequence: racking, racks per row, columns per rack and positions are fixed. Rack rows can only be added.</p>}
            <p className='text-sm text-slate-300'>Does this floor use racking? *</p>
            <div className='grid grid-cols-2 gap-2'>
                {[true, false].map((v) => (
                    <button key={String(v)} type='button' disabled={hasClusters} onClick={() => onChange({ racking: v })} className={`h-12 rounded-xl border-2 text-sm font-semibold disabled:opacity-60 ${floor.racking === v ? 'border-emerald-400 bg-emerald-500/15 text-white' : 'border-slate-700 text-slate-300'}`}>
                        {v ? 'Yes, racking' : 'No, floor storage'}
                    </button>
                ))}
            </div>
            <div className='grid grid-cols-2 gap-2'>
                <NumField id={`fl-rows-${index}`} label={floor.racking ? 'Rack rows *' : 'Rows *'} value={floor.rows} onChange={(v) => onChange({ rows: v })} hint={`Lettered A to ${letter(limits.rows)}`} />
                {floor.racking && <NumField id={`fl-racks-${index}`} label='Racks per row *' value={floor.racks} disabled={hasClusters} onChange={(v) => onChange({ racks: v })} hint={`Numbered 01 to ${limits.racks}`} />}
                {floor.racking && <NumField id={`fl-cols-${index}`} label='Columns per rack *' value={floor.columns} disabled={hasClusters} onChange={(v) => onChange({ columns: v })} hint='Lettered from the bottom, A = lowest' />}
                <NumField id={`fl-pos-${index}`} label={floor.racking ? 'Positions per column *' : 'Positions per row *'} value={floor.positions} disabled={hasClusters} onChange={(v) => onChange({ positions: v })} hint={`Numbered 01 to ${limits.positions}`} />
            </div>
            <div className='rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300'>
                <p className='font-mono text-emerald-300'>
                    {code(f, 1, 1, 1, 1)} → {code(f, Math.min(r, 26), Math.min(k, 99), Math.min(c, 26), Math.min(p, 99))}
                </p>
                <p className='mt-1'>{positions ? `${positions.toLocaleString()} positions on this floor` : 'Complete the sizes to see the positions.'}</p>
                {floor.racking === false && <p className='mt-1 text-slate-500'>Without racking the rack is always 01 and the column A.</p>}
            </div>
            {problems.length > 0 && (
                <ul className='space-y-0.5 text-xs text-amber-300'>
                    {problems.map((x) => (
                        <li key={x}>• {x}</li>
                    ))}
                </ul>
            )}
            {onCopy && (
                <Button variant='secondary' className='w-full' onClick={onCopy}>
                    <Copy className='h-4 w-4' />
                    Copy this arrangement to the other floors
                </Button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

const allocLabel = (c: Cluster) => (c.kind === 'box' ? 'Range (created before sequential allocation)' : c.mode === 'start' ? 'In sequence from a chosen bin' : 'In sequence, next free space');

function ClusterList({ data, onOpen }: { data: Data; onOpen: (code: string) => void }) {
    const columns = useMemo<Array<Column<Cluster>>>(
        () => [
            { key: 'code', label: 'Cluster', value: (c) => c.code, className: 'font-mono whitespace-nowrap' },
            { key: 'name', label: 'Name', value: (c) => c.name },
            { key: 'first', label: 'From', value: (c) => c.firstCode, className: 'font-mono whitespace-nowrap' },
            { key: 'last', label: 'To', value: (c) => c.lastCode, className: 'font-mono whitespace-nowrap' },
            { key: 'positions', label: 'Positions', type: 'number', value: (c) => c.positions },
            { key: 'floor', label: 'Floor', value: (c) => letter(c.floor) },
            { key: 'alloc', label: 'Allocation', value: (c) => allocLabel(c), hidden: true },
            {
                key: 'location',
                label: 'Storage location',
                value: (c) => `${c.locationCode} ${c.locationName}`,
                render: (c) => (
                    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                        <LocDot color={c.color} />
                        {c.locationCode} {c.locationName}
                    </span>
                ),
            },
            { key: 'class', label: 'Classification', value: (c) => c.classificationLabel },
            { key: 'subs', label: 'Subcategories', value: (c) => c.subcategories.map((x) => `${x.code} ${x.name}`).join(', ') },
            { key: 'type', label: 'Storage type', value: (c) => c.storageTypeLabel },
            { key: 'by', label: 'Created by', value: (c) => c.createdByName, hidden: true },
            { key: 'at', label: 'Created', type: 'date', value: (c) => c.createdAt, render: (c) => fmtDate(c.createdAt), hidden: true },
        ],
        []
    );
    if (!data.configured) return <Alert tone='info'>Set up the layout first, then create clusters.</Alert>;
    return <RichTable id='wh.clusters' title='Storage clusters' fileName={`storage_clusters_${data.costCenter.code}`} columns={columns} rows={data.clusters} rowKey={(c) => c.code} onRowClick={(c) => onOpen(c.code)} empty='No clusters yet. Use + Cluster to allocate positions to a storage location.' height='h-[calc(100dvh-15rem)]' />;
}

function ClusterDetail({ data, cluster, onDeleted, onPositions }: { data: Data; cluster: Cluster; onDeleted: () => void; onPositions: () => void }) {
    const [removing, setRemoving] = useState(false);
    const [typed, setTyped] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showSaveIssues,setShowSaveIssues]=useState(false);
    const remove = async () => {
        setBusy(true);
        setError('');
        try {
            await callBackend('/api/org/warehouse/cluster/delete', { costCenterId: data.costCenter.id, code: cluster.code, confirm: typed.trim(), reason: reason.trim() });
            onDeleted();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not remove the cluster.');
            setBusy(false);
        }
    };
    return (
        <>
            <Card className='space-y-2'>
                <div className='flex items-center gap-2'>
                    <Boxes className='h-5 w-5 text-emerald-400' />
                    <p className='font-mono font-semibold text-white'>{cluster.code}</p>
                    {cluster.name && <span className='truncate text-sm text-slate-300'>{cluster.name}</span>}
                </div>
                <Row label='Positions' value={`${cluster.positions.toLocaleString()} · ${cluster.firstCode} to ${cluster.lastCode}`} />
                <Row label='Floor' value={letter(cluster.floor)} />
                <Row label='Allocation' value={allocLabel(cluster)} />
                {cluster.kind === 'box' &&
                    FLOOR_AXES.map((a) => <Row key={a.dim} label={a.label} value={cluster[a.from] === cluster[a.to] ? a.fmt(cluster[a.from]) : `${a.fmt(cluster[a.from])} to ${a.fmt(cluster[a.to])}`} />)}
                <Row label='Storage location' value={`${cluster.locationCode} · ${cluster.locationName}`} />
                <Row label='Classification' value={cluster.classificationLabel || '—'} />
                <Row label='Subcategories' value={cluster.subcategories.length ? cluster.subcategories.map((x) => `${x.code} ${x.name}`).join(', ') : '—'} />
                <Row label='Storage type' value={cluster.storageTypeLabel} />
                <Row label='Created' value={`${cluster.createdByName} · ${fmtDate(cluster.createdAt)}`} />
            </Card>
            <div className='grid grid-cols-2 gap-2'>
                <Button variant='secondary' onClick={onPositions}>
                    <Layers className='h-4 w-4' />
                    View positions
                </Button>
                {data.canEdit && !removing && (
                    <Button variant='danger' onClick={() => setRemoving(true)}>
                        <Trash2 className='h-4 w-4' />
                        Remove
                    </Button>
                )}
            </div>
            {removing && (
                <Card className='space-y-3 border-red-500/40'>
                    <p className='font-medium text-white'>Remove cluster {cluster.code}</p>
                    <p className='text-xs text-slate-400'>Its {cluster.positions.toLocaleString()} positions become free again. This is recorded in the audit trail.</p>
                    <TextArea id='cl-reason' label='Reason *' rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Field id='cl-confirm' label={`Type ${cluster.code} to confirm`} autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} />
                    {error && <Alert tone='error'>{error}</Alert>}
                    <div className='flex gap-2'>
                        <Button className='flex-1' variant='danger' busy={busy} disabled={typed.trim() !== cluster.code || reason.trim().length < 5} onClick={remove}>
                            Remove cluster
                        </Button>
                        <Button variant='secondary' onClick={() => setRemoving(false)}>
                            <X className='h-4 w-4' />
                        </Button>
                    </div>
                </Card>
            )}
        </>
    );
}

function AxisSelect({ id, label, max, fmt, value, onChange }: { id: string; label: string; max: number; fmt: (n: number) => string; value: number; onChange: (v: number) => void }) {
    return (
        <SelectField id={id} label={label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
            {Array.from({ length: max }, (_, i) => i + 1).map((o) => (
                <option key={o} value={o}>
                    {fmt(o)}
                </option>
            ))}
        </SelectField>
    );
}

type AllocMode = 'next' | 'start';

function ClusterForm({ data, onDone, onCancel }: { data: Data; onDone: (code: string) => void; onCancel: () => void }) {
    const setup = data.setup!;
    const floors = setup.layout.floors;
    const options = setup.storageLocations.filter((l) => l.active);
    const whCats = data.categories.filter((c) => setup.materialCategoryCodes.includes(c.code));
    const allSubs = whCats.flatMap((c) => c.subcategories.map((sc) => ({ ...sc, categoryCode: c.code, categoryName: c.name })));
    const [subCodes, setSubCodes] = useState<string[]>([]);
    const [subCat, setSubCat] = useState(whCats[0]?.code ?? '');
    const [subQ, setSubQ] = useState('');
    const subTerm = subQ.trim().toLowerCase();
    const shownSubs = subTerm ? allSubs.filter((x) => `${x.code} ${x.name} ${x.categoryName}`.toLowerCase().includes(subTerm)).slice(0, 80) : allSubs.filter((x) => x.categoryCode === subCat);
    const toggleSub = (c: string) => setSubCodes((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
    const [floorNo, setFloorNo] = useState(1);
    const [mode, setMode] = useState<AllocMode>('next');
    const [countText, setCountText] = useState('');
    const [start, setStart] = useState({ r: 1, k: 1, c: 1, p: 1 });
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');const [clusterClass,setClusterClass]=useState('');
    const [q, setQ] = useState('');
    const [storageType, setStorageType] = useState(setup.storageTypeCode);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [showSaveIssues,setShowSaveIssues]=useState(false);

    const floor = floors[floorNo - 1];
    const total = floorPositions(floor);
    const onFloor = useMemo(() => data.clusters.filter((c) => c.floor === floorNo), [data.clusters, floorNo]);
    const occupied = useMemo(() => onFloor.flatMap((c) => c.segments), [onFloor]);
    const index = useMemo(() => ownerIndex(onFloor), [onFloor]);
    const used = occupied.reduce((s, [a, b]) => s + b - a + 1, 0);
    const largestGap = useMemo(() => freeGaps(total, occupied).reduce((m, g) => Math.max(m, g[1] - g[0] + 1), 0), [total, occupied]);
    const size = Number(countText);
    const sizeOk = countText.trim() !== '' && Number.isInteger(size) && size >= 1 && size <= data.limits.clusterPositions;
    const startOrd: number | null = mode === 'next' ? (sizeOk ? nextFreeStart(total, occupied, size) : null) : ordOf(floor, start.r, floor.racking ? start.k : 1, floor.racking ? start.c : 1, start.p);
    const endOrd = startOrd !== null && sizeOk ? startOrd + size - 1 : null;
    const fits = endOrd !== null && endOrd <= total - 1;
    const clash = startOrd !== null && endOrd !== null ? onFloor.find((c) => c.segments.some(([a, b]) => a <= endOrd && startOrd <= b)) : undefined;
    const startOwner = mode === 'start' && startOrd !== null ? ownerAt(index, startOrd) : undefined;
    const shownOptions = options.filter((l) => (!clusterClass || l.classificationCode === clusterClass) && (!q.trim() || `${l.code} ${l.name} ${l.typeLabel} ${l.classificationLabel}`.toLowerCase().includes(q.trim().toLowerCase())));
    const chosen = options.find((l) => l.code === location);
    const problems: string[] = [];
    if (!sizeOk) problems.push(`Enter the number of positions: a whole number from 1 to ${data.limits.clusterPositions.toLocaleString()}.`);
    else if (mode === 'next' && startOrd === null) problems.push(`Floor ${letter(floorNo)} has no free space of ${size.toLocaleString()} positions in sequence (largest free space: ${largestGap.toLocaleString()}).`);
    if (startOrd !== null && endOrd !== null && !fits) problems.push(`Only ${(total - startOrd).toLocaleString()} positions remain on this floor from ${codeAt(floorNo, floor, startOrd)}.`);
    if (clash) problems.push(`Overlaps cluster ${clash.code} (${clash.firstCode} to ${clash.lastCode}). Every position belongs to one cluster only.`);
    if (!chosen) problems.push('Choose the storage location.');if(!clusterClass)problems.push('Choose material classification.');else if(chosen&&clusterClass!==chosen.classificationCode)problems.push('Classification must match storage location.');
    if (!subCodes.length) problems.push('Choose at least one material subcategory.');
    if (subCodes.length > data.limits.clusterSubcategories) problems.push(`Up to ${data.limits.clusterSubcategories} subcategories per cluster.`);
    if (name.trim().length > 60) problems.push('The name can be up to 60 characters.');
    const preview = startOrd !== null && endOrd !== null && fits ? `${size.toLocaleString()} positions · ${codeAt(floorNo, floor, startOrd)} → ${codeAt(floorNo, floor, endOrd)}` : '';

    const create = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await callBackend<{ code: string }>('/api/org/warehouse/cluster/create', {
                costCenterId: data.costCenter.id,
                floor: floorNo,
                mode,
                count: size,
                expectStart: startOrd,
                startRow: start.r,
                startRack: start.k,
                startCol: start.c,
                startPos: start.p,
                name: name.trim(),
                locationCode: location,
                classificationCode:clusterClass,
                subcategoryCodes: subCodes,
                storageTypeCode: storageType,
                confirm: confirmed,
            });
            onDone(res.code);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create the cluster.');
            setConfirmed(false);
            setBusy(false);
        }
    };
    // Any change to the range must be confirmed again.
    const change = <T,>(fn: (v: T) => void) => (v: T) => (fn(v), setConfirmed(false));

    return (
        <div className='flex h-[calc(100dvh-7rem)] flex-col'>
            <div className='shrink-0 space-y-1 border-b border-slate-800 bg-slate-950 pb-3'>
                <div className='flex items-center gap-2'>
                    <Button variant='secondary' aria-label='Back' onClick={onCancel}>
                        <ArrowLeft className='h-4 w-4' />
                    </Button>
                    <div className='min-w-0 flex-1'>
                        <p className='font-mono text-xs text-emerald-300'>{data.costCenter.code}</p>
                        <p className='truncate font-semibold text-white'>New storage cluster</p>
                    </div>
                    <Button busy={busy} disabled={problems.length > 0 || !confirmed} onClick={create}>
                        <Check className='h-4 w-4' />
                        Create
                    </Button>
                </div>
                <p className={`font-mono text-xs ${clash || (sizeOk && !preview) ? 'text-red-300' : 'text-slate-300'}`}>{preview || 'Enter the number of positions'}</p>
            </div>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-3'>
                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>1 · Floor</p><p className='text-xs text-slate-300'>5S · Set in order: select an accessible floor with safe material-handling routes. Keep emergency exits and aisles unobstructed; minimize picking travel.</p>
                    <SelectField id='cl-floor' label='A cluster sits on one floor' value={String(floorNo)} onChange={(e) => (setFloorNo(Number(e.target.value)), setStart({ r: 1, k: 1, c: 1, p: 1 }), setConfirmed(false))}>
                        {floors.map((f, i) => (
                            <option key={i} value={i + 1}>
                                {letter(i + 1)} · {f.name} · {floorSummary(f)}
                            </option>
                        ))}
                    </SelectField>
                    <div className='grid grid-cols-3 gap-2'>
                        <Stat label='On floor' value={total.toLocaleString()} />
                        <Stat label='Free' value={(total - used).toLocaleString()} />
                        <Stat label='Largest gap' value={largestGap.toLocaleString()} />
                    </div>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>2 · Allocate positions *</p><p className='text-xs text-slate-300'>5S · Set in order: reserve a clearly identified continuous run for fast, repeatable retrieval and stock counts. Respect load ratings, handling clearance and safe access.</p>
                    <div className='grid grid-cols-1 gap-2'>
                        {(
                            [
                                ['next', 'Next free space', 'Starts after the last allocated physical location. If that space is too small, the first free gap that holds the whole cluster is used.'],
                                ['start', 'From a starting physical location', 'Choose the first physical location; the cluster takes that position and the following ones in sequence.'],
                            ] as Array<[AllocMode, string, string]>
                        ).map(([m, title, text]) => (
                            <button key={m} type='button' onClick={() => (setMode(m), setConfirmed(false))} className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left ${mode === m ? 'border-emerald-400 bg-emerald-500/10 text-white' : 'border-slate-800 text-slate-300'}`}>
                                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${mode === m ? 'border-emerald-400' : 'border-slate-600'}`}>{mode === m && <span className='h-2.5 w-2.5 rounded-full bg-emerald-400' />}</span>
                                <span>
                                    <span className='block text-sm font-medium'>{title}</span>
                                    <span className='block text-xs text-slate-400'>{text}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                    <NumField id='cl-count' label='Number of positions *' value={countText} onChange={change(setCountText)} hint={`Up to ${Math.min(data.limits.clusterPositions, total).toLocaleString()} · taken in sequence: rack row › rack › column (from the bottom) › position`} />
                    {mode === 'start' && (
                        <>
                            <p className='text-sm text-slate-300'>Starting physical location</p>
                            <div className='grid grid-cols-2 gap-2'>
                                <AxisSelect id='cl-sr' label='Rack row' max={floor.rows} fmt={letter} value={start.r} onChange={change((v: number) => setStart((s) => ({ ...s, r: v })))} />
                                {floor.racking && <AxisSelect id='cl-sk' label='Rack' max={floor.racks} fmt={pad2} value={start.k} onChange={change((v: number) => setStart((s) => ({ ...s, k: v })))} />}
                                {floor.racking && <AxisSelect id='cl-sc' label='Column (from bottom)' max={floor.columns} fmt={letter} value={start.c} onChange={change((v: number) => setStart((s) => ({ ...s, c: v })))} />}
                                <AxisSelect id='cl-sp' label='Position' max={floor.positions} fmt={pad2} value={start.p} onChange={change((v: number) => setStart((s) => ({ ...s, p: v })))} />
                            </div>
                            {startOrd !== null && (
                                <p className={`rounded-lg px-3 py-2 font-mono text-xs ${startOwner ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                                    {codeAt(floorNo, floor, startOrd)} · {startOwner ? `already in ${startOwner.code} (${startOwner.locationName})` : 'free'}
                                </p>
                            )}
                        </>
                    )}
                    {preview && (
                        <div className='rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300'>
                            <p className='font-mono text-emerald-300'>{preview}</p>
                            <p className='mt-1 text-slate-500'>Each code is generated once, in sequence, and can never be reused by another cluster.</p>
                        </div>
                    )}
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>3 · Classification and storage location *</p><p className='text-xs text-slate-300'>Safety first: choose the material classification below, then a matching storage location. Classification and segregation take priority over subcategory. Hazardous items require SDS and chemical compatibility checks.</p>
                    <p className='text-xs text-slate-400'>Classification and safety segregation take priority over subcategory.</p><SelectField id='cl-classification' label='Material classification *' value={clusterClass} onChange={(e)=>{setClusterClass(e.target.value);setLocation('');setConfirmed(false);}}><option value=''>Choose classification</option>{data.classifications.filter(x=>x.active||x.code===clusterClass).map(x=><option key={x.code} value={x.code}>{x.label} ({x.code})</option>)}</SelectField>
                    {options.length === 0 && <Alert tone='error'>This warehouse has no active storage locations. Edit the setup and add one first.</Alert>}
                    {options.length > 6 && (
                        <div className='relative'>
                            <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search storage locations…' className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white' />
                        </div>
                    )}
                    <ul className='max-h-72 space-y-1 overflow-y-auto overscroll-contain'>
                        {shownOptions.map((l) => {
                            const on = location === l.code;
                            return (
                                <li key={l.code}>
                                    <button type='button' onClick={() => {setLocation(l.code);setConfirmed(false);}} className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left text-sm ${on ? 'text-white' : 'border-slate-800 text-slate-300'}`} style={on ? { borderColor: l.color, background: `${l.color}1f` } : undefined}>
                                        <LocDot color={l.color} size='mt-0.5 h-4 w-4' />
                                        <span className='min-w-0 flex-1'>
                                            {l.name}
                                            <span className='block text-xs text-slate-400'>
                                                {l.typeLabel} · {l.classificationLabel}
                                            </span>
                                        </span>
                                        <span className='font-mono text-[10px] text-slate-500'>{l.code}</span>
                                        {on && <Check className='h-4 w-4 shrink-0' />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>4 · Material subcategories *</p>
                    <p className='text-xs text-slate-300'>5S · Sort: limit this cluster to the intended subcategories for organized picking and easy counting. Never mix incompatible materials merely because they share a subcategory.</p>
                    {subCodes.length > 0 && (
                        <div className='flex max-h-32 flex-wrap gap-1 overflow-y-auto'>
                            {subCodes.map((c) => (
                                <button key={c} type='button' onClick={() => toggleSub(c)} className='flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-emerald-500/70'>
                                    <span className='font-mono'>{c}</span> {allSubs.find((x) => x.code === c)?.name ?? ''}
                                    <X className='h-3 w-3' />
                                </button>
                            ))}
                        </div>
                    )}
                    <div className='relative'>
                        <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500' />
                        <input value={subQ} onChange={(e) => setSubQ(e.target.value)} placeholder='Search subcategories…' className='h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-white' />
                    </div>
                    {!subTerm && whCats.length > 1 && (
                        <div className='flex gap-1 overflow-x-auto pb-1'>
                            {whCats.map((c) => (
                                <button key={c.code} type='button' onClick={() => setSubCat(c.code)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${subCat === c.code ? 'bg-emerald-500 text-onbrand' : 'bg-slate-800 text-slate-300'}`}>
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <ul className='max-h-64 space-y-1 overflow-y-auto overscroll-contain'>
                        {shownSubs.map((x) => {
                            const on = subCodes.includes(x.code);
                            return (
                                <li key={x.code}>
                                    <button type='button' onClick={() => toggleSub(x.code)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${on ? 'bg-slate-800 text-white ring-1 ring-emerald-400' : 'text-slate-300 active:bg-slate-800'}`}>
                                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'}`}>{on && <Check className='h-3.5 w-3.5 text-white' />}</span>
                                        <span className='min-w-0 flex-1'>
                                            {x.name}
                                            <span className='block font-mono text-[11px] text-slate-500'>
                                                {x.code} · {x.categoryName}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                        {!shownSubs.length && <p className='text-xs text-slate-500'>Nothing matches.</p>}
                    </ul>
                </Card>

                <Card className='space-y-3'>
                    <p className='text-sm font-semibold text-white'>5 · Physical location type and identification</p><p className='text-xs text-slate-300'>5S · Shine, standardize and sustain: choose suitable storage and name the cluster for labeling, inspections, housekeeping and easy retrieval.</p><SelectField id='cl-type' label='Physical location type (bin, drawer, pallet position, etc.)' value={storageType} onChange={(e) => setStorageType(e.target.value)}>
                        {data.storageTypes.map((t) => (
                            <option key={t.code} value={t.code}>
                                {t.label}
                            </option>
                        ))}
                    </SelectField>
                    <Field id='cl-name' label='Cluster name (optional)' maxLength={60} placeholder='e.g. Fast movers, bearings aisle' value={name} onChange={(e) => setName(e.target.value)} />
                </Card>

                {problems.length > 0 && (
                    <ul className='space-y-0.5 text-xs text-amber-300'>
                        {problems.map((p) => (
                            <li key={p}>• {p}</li>
                        ))}
                    </ul>
                )}
                <label className='flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-slate-200'>
                    <input type='checkbox' className='mt-0.5 h-5 w-5 accent-emerald-500' checked={confirmed} disabled={!preview} onChange={(e) => setConfirmed(e.target.checked)} />
                    I confirm: allocate these {sizeOk ? size.toLocaleString() : 0} positions{preview ? ` (${preview.split(' · ')[1]})` : ''} to {chosen ? `${chosen.code} ${chosen.name} (${chosen.classificationLabel})` : 'the chosen storage location'} for {subCodes.length} subcategor{subCodes.length === 1 ? 'y' : 'ies'}. The cluster is numbered automatically.
                </label>
                {error && <Alert tone='error'>{error}</Alert>}
            </div>
        </div>
    );
}

function PhysicalStorage({data,setup,reload}:{data:Data;setup:Setup;reload:()=>void}){const [page,setPage]=useState(0);const [historyOpen,setHistoryOpen]=useState(false);const [selected,setSelected]=useState<{code:string;cluster?:Cluster;binId?:string;floor:number;rack:number;row:number;column:number;position:number}|null>(null);const [detail,setDetail]=useState<Record<string,unknown>|null>(null);const [busy,setBusy]=useState(false);const [candidates,setCandidates]=useState<Array<{id:string;materialNumber:string;name:string;shortText:string}>>([]);const [choice,setChoice]=useState('');const [actionError,setActionError]=useState('');const PAGE=200;const offsets=setup.layout.floors.map((_,i)=>setup.layout.floors.slice(0,i).reduce((n,x)=>n+floorPositions(x),0));const total=setup.layout.floors.reduce((n,f)=>n+floorPositions(f),0);const bins=Array.from({length:Math.max(0,Math.min(PAGE,total-page*PAGE))},(_,i)=>{const index=page*PAGE+i;let floorNo=1;for(let j=0;j<offsets.length;j++)if(index>=offsets[j])floorNo=j+1;const f=setup.layout.floors[floorNo-1],o=index-offsets[floorNo-1];const cluster=data.clusters.find(c=>c.floor===floorNo&&c.segments.some(([s,e])=>o>=s&&o<=e));const code=codeAt(floorNo,f,o);const binId=data.linkedBins?.find(x=>x.binId===cluster?.code+'__'+code||x.binId===code)?.binId;const positions=f.positions||1;const columns=f.racking?f.columns||1:1;const racks=f.racking?f.racks||1:1;return {code,cluster,binId,floor:floorNo,rack:Math.floor(o/(positions*columns))%racks+1,row:Math.floor(o/(positions*columns*racks))+1,column:Math.floor(o/positions)%columns+1,position:o%positions+1};});const open=async(b:typeof bins[number])=>{setSelected(b);setHistoryOpen(false);setDetail(null);setCandidates([]);setChoice('');setActionError('');if(!b.cluster)return;setBusy(true);try{const responseDetail=await callBackend<Record<string,unknown>>('/api/org/warehouse/bin/detail',{costCenterId:data.costCenter.id,binId:b.binId||b.cluster.code+'__'+b.code});setDetail(responseDetail);if(!b.binId){const response=await callBackend<{materials:Array<{id:string;materialNumber:string;name:string;shortText:string}>}>('/api/org/inventory/material/bin/candidates',{warehouseId:data.costCenter.id,binId:b.cluster.code+'__'+b.code});setCandidates(response.materials);return;}}catch(e){setDetail({error:String(e)});}finally{setBusy(false);}};const changeLink=async(unlink:boolean)=>{if(!selected||!selected.cluster)return;if(unlink&&!window.confirm('Delink this material? The event will be audited.'))return;setBusy(true);setActionError('');try{await callBackend(unlink?'/api/org/inventory/material/bin/unlink':'/api/org/inventory/material/bin/link',unlink?{id:detail?.materialId,warehouseId:data.costCenter.id,reason:'Manual delink from physical bin'}:{id:choice,warehouseId:data.costCenter.id,binId:selected.cluster.code+'__'+selected.code});setSelected(null);reload();}catch(e){setActionError(String(e));}finally{setBusy(false);}};const item=(label:string,value:unknown)=><div className='rounded-lg border border-slate-700 p-3'><p className='text-xs text-slate-400'>{label}</p><p className='mt-1 break-words font-semibold text-white'>{value===null||value===undefined||value===''?'Not recorded':String(value)}</p></div>;return <div className='space-y-3'><Card><h2 className='font-semibold text-white'>Physical locations · sequential positions</h2><p className='text-xs text-slate-300'>Tap a physical location to inspect its status and linked material. Position codes retain the original physical address.</p><div className='mt-3 flex flex-wrap gap-3 text-xs text-slate-200'><span>■ Grey: Unallocated</span><span>□ White: Allocated</span><span className='text-orange-300'>■ Orange: Linked</span></div><div className='mt-3 flex items-center justify-between text-xs text-slate-300'><span>{total?page*PAGE+1:0}–{Math.min(total,(page+1)*PAGE)} of {total.toLocaleString()}</span><div className='flex gap-2'><button disabled={page===0} onClick={()=>setPage(p=>p-1)} className='rounded border border-slate-600 px-3 py-2 disabled:opacity-30'>Previous</button><button disabled={(page+1)*PAGE>=total} onClick={()=>setPage(p=>p+1)} className='rounded border border-slate-600 px-3 py-2 disabled:opacity-30'>Next</button></div></div><div className='mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8'>{bins.map(b=><button key={b.code} onClick={()=>void open(b)} className={'rounded-lg border p-2 font-mono text-[11px] font-semibold '+(b.binId?'border-orange-500 bg-orange-200 text-orange-950':b.cluster?'border-slate-400 bg-white text-slate-900':'border-slate-500 bg-slate-400 text-slate-950')}>{b.code}</button>)}</div></Card>{selected&&<div role='dialog' aria-modal='true' className='fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3'><div className='max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 p-5'><div className='flex items-center justify-between'><h2 className='text-xl font-bold text-white'>Physical location {selected.code}</h2><button aria-label='Close' onClick={()=>setSelected(null)} className='rounded border border-slate-600 p-2 text-white'><X className='h-5 w-5'/></button></div><p className='mt-2 text-sm text-slate-300'>Status: {selected.binId?'Linked to material':selected.cluster?'Allocated, empty':'Unallocated'}</p>{selected.cluster&&<p className='mt-1 text-xs text-slate-300'>Cluster {selected.cluster.code} · {selected.cluster.name||selected.cluster.locationName}</p>}<div className='mt-3 grid grid-cols-3 gap-2'>{item('Floor',selected.floor)}{item('Rack',selected.rack)}{item('Row',selected.row)}{item('Column',selected.column)}{item('Position',selected.position)}{item('Physical location address',selected.code)}</div>{busy?<Spinner/>:selected.binId?<div className='mt-4 grid grid-cols-2 gap-2'>{item('Material number',detail?.materialNumber)}{item('Material name',detail?.name)}<div className='col-span-2'>{item('Short text',detail?.shortText)}</div>{item('Minimum',detail?.minimum)}{item('Maximum',detail?.maximum)}{item('Actual stock',detail?.actual)}{item('Cost / stock value',detail?.cost)}{detail?.error&&<p className='col-span-2 text-red-300'>{String(detail.error)}</p>}{data.canUnlink&&<button disabled={busy} onClick={()=>void changeLink(true)} className='col-span-2 rounded-lg bg-orange-700 p-3 font-semibold text-white'>Delink material</button>}</div>:<div className='mt-4 space-y-3'><p className='text-sm text-slate-300'>No material linked to this physical location.</p>{selected.cluster&&data.canLink&&<><label className='block text-sm text-white'>Link an eligible unlinked material</label><select value={choice} onChange={e=>setChoice(e.target.value)} className='w-full rounded border border-slate-500 bg-slate-900 p-3 text-white'><option value=''>Select compatible material</option>{candidates.map(m=><option key={m.id} value={m.id}>{m.materialNumber} · {m.shortText||m.name}</option>)}</select>{!candidates.length&&<p className='text-xs text-amber-300'>No unlinked materials match this physical location's classification, subcategory and warehouse mapping.</p>}<button disabled={!choice||busy} onClick={()=>void changeLink(false)} className='rounded bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-40'>Link selected material</button></>}</div>}<div className='mt-5 border-t border-slate-700 pt-4'>{data.canHistory&&<button type='button' onClick={()=>setHistoryOpen(true)} className='rounded-lg border border-slate-500 bg-slate-800 px-4 py-2 font-semibold text-white'>History</button>}</div>{historyOpen&&<div role='dialog' aria-modal='true' aria-label='Bin history' className='fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3'><div className='max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 p-5'><div className='flex items-center justify-between gap-3'><h3 className='text-lg font-semibold text-white'>Physical location {selected.code} · History</h3><button type='button' aria-label='Close history' onClick={()=>setHistoryOpen(false)} className='rounded-lg border border-slate-500 px-3 py-2 text-white'>Close</button></div><div className='mt-4'><h4 className='text-sm font-semibold text-slate-200'>Recorded events and material snapshots</h4>{Array.isArray(detail?.history)&&detail.history.length?<div className='mt-3 space-y-3'>{(detail.history as Array<Record<string,unknown>>).map((h,i)=><div key={String(h.id||i)} className='rounded-lg border border-slate-700 bg-slate-900 p-3'><p className='font-semibold text-white'>{String(h.event||'Event')} · {String(h.at||'')}</p><p className='text-xs text-slate-400'>Recorded by: {String(h.by||'Not recorded')}{h.reason?' · '+String(h.reason):''}</p><div className='mt-2 grid grid-cols-2 gap-2'>{Object.entries((h.snapshot&&typeof h.snapshot==='object'?h.snapshot:{}) as Record<string,unknown>).map(([k,v])=><div key={k}>{item(k.replace(/([A-Z])/g,' $1'),v)}</div>)}</div></div>)}</div>:<p className='mt-2 text-sm text-slate-400'>No link or delink history recorded for this physical location.</p>}</div></div></div>}{actionError&&<p className='mt-3 text-sm text-red-300'>{actionError}</p>}</div></div>}</div>}

// ---------------------------------------------------------------------------
// Topology: every bin of a floor. Unallocated = grey, allocated = white with a border in the colour of the
// material classification of its storage location. Racks are mounted lazily as you scroll.
// ---------------------------------------------------------------------------

const LIST_CAP = 20_000;

/** Storage location, material categories and subcategories of a cluster, for display. */
function describeCluster(data: Data, setup: Setup, c: Cluster) {
    const loc = setup.storageLocations.find((l) => l.code === c.locationCode);
    const catCodes = Array.from(new Set(c.subcategories.map((s) => s.categoryCode).filter(Boolean)));
    return {
        locationName: loc?.name ?? c.locationName,
        locationType: loc?.typeLabel ?? '',
        classification: loc?.classificationLabel ?? c.classificationLabel,
        color: loc?.color ?? c.color ?? '#64748B',
        categories: catCodes.map((x) => `${x} ${data.categories.find((k) => k.code === x)?.name ?? ''}`.trim()).join(', '),
        subcategories: c.subcategories.map((s) => `${s.code} ${s.name}`).join(', '),
    };
}

function Topology({ data, setup, onCluster }: { data: Data; setup: Setup; onCluster: (code: string) => void }) {
    const floors = setup.layout.floors;
    const [floorNo, setFloorNo] = useState(1);
    const [view, setView] = useState<'map' | 'list'>('map');
    const [picked, setPicked] = useState<number | null>(null);
    const floor = floors[floorNo - 1];
    const onFloor = useMemo(() => data.clusters.filter((c) => c.floor === floorNo), [data.clusters, floorNo]);
    const index = useMemo(() => ownerIndex(onFloor), [onFloor]);
    if (!floor) return <Alert tone='info'>No floors configured yet.</Alert>;
    const floorUsed = onFloor.reduce((s, c) => s + c.positions, 0);
    const floorTotal = floorPositions(floor);
    const legend = Array.from(new Map(onFloor.map((c) => [c.classificationLabel || c.locationName, c.color || '#64748B'])).entries());
    const owner = picked === null ? undefined : ownerAt(index, picked);
    const info = owner ? describeCluster(data, setup, owner) : null;

    return (
        <>
            <div className='flex gap-1 overflow-x-auto pb-1'>
                {floors.map((f, i) => (
                    <button key={i} type='button' onClick={() => (setFloorNo(i + 1), setPicked(null))} className={`shrink-0 rounded-xl px-3 py-2 text-left text-xs ${floorNo === i + 1 ? 'bg-emerald-500 text-onbrand' : 'bg-slate-800 text-slate-300'}`}>
                        <span className='font-mono font-bold'>{letter(i + 1)}</span> · {f.name}
                    </button>
                ))}
            </div>
            <Card className='space-y-1'>
                <p className='text-sm font-medium text-white'>
                    Floor {letter(floorNo)} · {floor.name}
                </p>
                <p className='text-xs text-slate-400'>{floorSummary(floor)}</p>
                <div className='mt-2 h-2 overflow-hidden rounded-full bg-slate-800'>
                    <div className='h-full bg-emerald-500' style={{ width: `${floorTotal ? Math.round((floorUsed / floorTotal) * 100) : 0}%` }} />
                </div>
                <p className='text-xs text-slate-500'>
                    {floorUsed.toLocaleString()} of {floorTotal.toLocaleString()} positions allocated · {(floorTotal - floorUsed).toLocaleString()} unallocated
                </p>
                <div className='flex flex-wrap gap-2 pt-1 text-xs'>
                    <span className='flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-slate-300'>
                        <span className='h-3.5 w-3.5 rounded-[3px] border-2 border-slate-600 bg-slate-500' />
                        Unallocated
                    </span>
                    {legend.map(([label, color]) => (
                        <span key={label} className='flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-slate-300'>
                            <span className='h-3.5 w-3.5 rounded-[3px] border-2 bg-white' style={{ borderColor: color }} />
                            {label}
                        </span>
                    ))}
                </div>
                <p className='text-[11px] text-slate-500'>Allocated bins are white; their border is the colour of the storage location's material classification.</p>
            </Card>

            <div className='grid grid-cols-2 gap-1 rounded-xl border border-slate-800 p-1'>
                {(
                    [
                        ['map', 'Bin map'],
                        ['list', 'All locations'],
                    ] as const
                ).map(([k, label]) => (
                    <button key={k} type='button' onClick={() => setView(k)} className={`h-9 rounded-lg text-sm ${view === k ? 'bg-emerald-500 text-onbrand' : 'text-slate-300'}`}>
                        {label}
                    </button>
                ))}
            </div>

            {view === 'map' ? <FloorMap key={floorNo} floorNo={floorNo} floor={floor} index={index} picked={picked} onPick={setPicked} /> : <FloorLocations key={floorNo} data={data} setup={setup} floorNo={floorNo} floor={floor} index={index} />}

            {view === 'map' && picked !== null && (
                <Card className='space-y-1 border-emerald-500/40'>
                    <div className='flex items-center gap-2'>
                        <span className={`h-5 w-5 rounded-[3px] border-2 ${owner ? 'bg-white' : 'border-slate-600 bg-slate-500'}`} style={owner ? { borderColor: info?.color } : undefined} />
                        <p className='font-mono text-lg font-bold text-white'>{codeAt(floorNo, floor, picked)}</p>
                        <span className='flex-1' />
                        <button type='button' aria-label='Close' onClick={() => setPicked(null)} className='text-slate-400'>
                            <X className='h-4 w-4' />
                        </button>
                    </div>
                    {owner && info ? (
                        <>
                            <Row label='Storage location' value={`${owner.locationCode} · ${info.locationName}`} />
                            <Row label='Location type' value={info.locationType || '—'} />
                            <Row label='Classification' value={info.classification || '—'} />
                            <Row label='Material category' value={info.categories || '—'} />
                            <Row label='Subcategories' value={info.subcategories || '—'} />
                            <Row label='Cluster' value={`${owner.code}${owner.name ? ` · ${owner.name}` : ''} · ${owner.storageTypeLabel}`} />
                            <Button variant='secondary' className='mt-2' onClick={() => onCluster(owner.code)}>
                                <Boxes className='h-4 w-4' />
                                Open cluster
                            </Button>
                        </>
                    ) : (
                        <p className='text-sm text-slate-400'>Unallocated: not in any cluster yet.</p>
                    )}
                </Card>
            )}
        </>
    );
}

function Bin({ label, owner, selected, onPick }: { label: string; owner?: Cluster; selected: boolean; onPick: () => void }) {
    return (
        <button
            type='button'
            aria-label={label}
            title={owner ? `${label} · ${owner.locationCode} ${owner.locationName}` : `${label} · unallocated`}
            onClick={onPick}
            className={`h-5 w-5 shrink-0 rounded-[3px] border-2 ${owner ? 'bg-white' : 'border-slate-600 bg-slate-500'} ${selected ? 'outline outline-2 outline-offset-1 outline-emerald-400' : ''}`}
            style={owner ? { borderColor: owner.color || '#64748B' } : undefined}
        />
    );
}

/** Every bin of a floor, rack by rack (front view, column A at the bottom). Racks are mounted as they scroll into view. */
function FloorMap({ floorNo, floor, index, picked, onPick }: { floorNo: number; floor: FloorLayout; index: OwnerIndex; picked: number | null; onPick: (o: number) => void }) {
    const blocks = useMemo(() => {
        const out: Array<{ r: number; k: number }> = [];
        for (let r = 1; r <= floor.rows; r++) for (let k = 1; k <= floor.racks; k++) out.push({ r, k });
        return out;
    }, [floor]);
    const perRack = floor.columns * floor.positions;
    const step = Math.max(1, Math.min(40, Math.floor(3000 / Math.max(1, perRack))));
    const [shown, setShown] = useState(step);
    const frame = useRef<HTMLDivElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = sentinel.current;
        if (!el || shown >= blocks.length) return;
        const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown((s) => Math.min(blocks.length, s + step)), { root: frame.current, rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [shown, blocks.length, step]);
    const colsTopDown = Array.from({ length: floor.columns }, (_, i) => floor.columns - i);

    return (
        <Card className='space-y-2'>
            <p className='text-xs font-semibold uppercase tracking-wider text-slate-500'>{floor.racking ? 'Every bin · rack by rack, column A at the bottom (tap a bin)' : 'Every position · row by row (tap a position)'}</p>
            <div ref={frame} className='max-h-[60dvh] space-y-3 overflow-auto overscroll-contain rounded-lg border border-slate-800 bg-slate-950 p-2'>
                {blocks.slice(0, shown).map(({ r, k }) => {
                    const head = k === 1;
                    let used = 0;
                    const base = ordOf(floor, r, k, 1, 1);
                    for (let i = 0; i < perRack; i++) if (ownerAt(index, base + i)) used++;
                    return (
                        <div key={`${r}-${k}`}>
                            {head && (
                                <p className='sticky left-0 mb-1 font-mono text-xs font-semibold text-emerald-300'>
                                    {floor.racking ? 'Rack row' : 'Row'} {letter(floorNo)}
                                    {letter(r)}
                                </p>
                            )}
                            <div className='inline-block max-w-full overflow-x-auto rounded-lg border border-slate-800 p-1.5'>
                                <p className='mb-1 font-mono text-[10px] text-slate-400'>
                                    {letter(floorNo)}
                                    {letter(r)}
                                    {floor.racking ? `_${pad2(k)}` : ''} · {used}/{perRack}
                                </p>
                                {colsTopDown.map((c) => (
                                    <div key={c} className={`flex items-center gap-0.5 py-0.5 ${floor.racking ? 'border-b border-slate-700' : 'flex-wrap'}`}>
                                        {floor.racking && <span className='w-3 shrink-0 font-mono text-[9px] text-slate-500'>{letter(c)}</span>}
                                        {Array.from({ length: floor.positions }, (_, pi) => {
                                            const o = ordOf(floor, r, k, c, pi + 1);
                                            return <Bin key={pi} label={code(floorNo, r, k, c, pi + 1)} owner={ownerAt(index, o)} selected={picked === o} onPick={() => onPick(o)} />;
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {shown < blocks.length && (
                    <div ref={sentinel} className='py-3 text-center text-xs text-slate-500'>
                        Loading more racks…
                    </div>
                )}
            </div>
        </Card>
    );
}

interface FloorPos {
    code: string;
    row: string;
    rack: string;
    column: string;
    position: string;
    status: string;
    locationCode: string;
    locationName: string;
    locationType: string;
    classification: string;
    color: string;
    categories: string;
    subcategories: string;
    cluster: string;
    storageType: string;
}

/** Every location of the floor (allocated and unallocated) with its storage location and material details. */
function FloorLocations({ data, setup, floorNo, floor, index }: { data: Data; setup: Setup; floorNo: number; floor: FloorLayout; index: OwnerIndex }) {
    const total = floorPositions(floor);
    const perRow = floor.racks * floor.columns * floor.positions;
    const [rowSel, setRowSel] = useState(total > LIST_CAP ? 1 : 0);
    const { rows, truncated } = useMemo(() => {
        const from = rowSel ? (rowSel - 1) * perRow : 0;
        const to = rowSel ? rowSel * perRow - 1 : total - 1;
        const cache = new Map<string, ReturnType<typeof describeCluster>>();
        const out: FloorPos[] = [];
        for (let o = from; o <= to && out.length < LIST_CAP; o++) {
            const x = coordsOf(floor, o);
            const c = ownerAt(index, o);
            let info = c ? cache.get(c.code) : undefined;
            if (c && !info) {
                info = describeCluster(data, setup, c);
                cache.set(c.code, info);
            }
            out.push({
                code: code(floorNo, x.r, x.k, x.c, x.p),
                row: letter(x.r),
                rack: pad2(x.k),
                column: letter(x.c),
                position: pad2(x.p),
                status: c ? 'Allocated' : 'Unallocated',
                locationCode: c?.locationCode ?? '',
                locationName: info?.locationName ?? '',
                locationType: info?.locationType ?? '',
                classification: info?.classification ?? '',
                color: info?.color ?? '',
                categories: info?.categories ?? '',
                subcategories: info?.subcategories ?? '',
                cluster: c?.code ?? '',
                storageType: c?.storageTypeLabel ?? '',
            });
        }
        return { rows: out, truncated: to - from + 1 > LIST_CAP };
    }, [data, setup, floorNo, floor, index, rowSel, perRow, total]);

    const columns = useMemo<Array<Column<FloorPos>>>(
        () => [
            { key: 'code', label: 'Location', value: (p) => p.code, className: 'font-mono whitespace-nowrap' },
            {
                key: 'status',
                label: 'Status',
                value: (p) => p.status,
                render: (p) => (
                    <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                        <span className={`h-3.5 w-3.5 rounded-[3px] border-2 ${p.color ? 'bg-white' : 'border-slate-600 bg-slate-500'}`} style={p.color ? { borderColor: p.color } : undefined} />
                        {p.status}
                    </span>
                ),
            },
            { key: 'sl', label: 'Storage location', value: (p) => p.locationCode, className: 'font-mono whitespace-nowrap' },
            { key: 'slname', label: 'Location name', value: (p) => p.locationName },
            { key: 'sltype', label: 'Location type', value: (p) => p.locationType },
            {
                key: 'class',
                label: 'Classification',
                value: (p) => p.classification,
                render: (p) =>
                    p.classification ? (
                        <span className='inline-flex items-center gap-1.5 whitespace-nowrap'>
                            <LocDot color={p.color} />
                            {p.classification}
                        </span>
                    ) : (
                        ''
                    ),
            },
            { key: 'cat', label: 'Material category', value: (p) => p.categories },
            { key: 'subs', label: 'Subcategories', value: (p) => p.subcategories },
            { key: 'cluster', label: 'Cluster', value: (p) => p.cluster, className: 'font-mono whitespace-nowrap' },
            { key: 'stype', label: 'Storage type', value: (p) => p.storageType, hidden: true },
            { key: 'row', label: 'Row', value: (p) => p.row, hidden: true },
            { key: 'rack', label: 'Rack', value: (p) => p.rack, hidden: true },
            { key: 'column', label: 'Column', value: (p) => p.column, hidden: true },
            { key: 'position', label: 'Pos.', value: (p) => p.position, hidden: true },
        ],
        []
    );

    return (
        <>
            {total > LIST_CAP && (
                <SelectField id='fl-row' label='Rack row' value={String(rowSel)} onChange={(e) => setRowSel(Number(e.target.value))}>
                    {Array.from({ length: floor.rows }, (_, i) => (
                        <option key={i} value={i + 1}>
                            {letter(floorNo)}
                            {letter(i + 1)} · {perRow.toLocaleString()} locations
                        </option>
                    ))}
                </SelectField>
            )}
            {truncated && <Alert tone='info'>Showing the first {LIST_CAP.toLocaleString()} locations of this selection. Use the Positions tab per cluster for the rest.</Alert>}
            <RichTable id='wh.floorLocations' title={`Floor ${letter(floorNo)} · all locations`} fileName={`storage_floor_${letter(floorNo)}_${data.costCenter.code}`} columns={columns} rows={rows} rowKey={(p) => p.code} empty='No locations.' height='h-[calc(100dvh-16rem)]' />
        </>
    );
}

// ---------------------------------------------------------------------------
// Position register
// ---------------------------------------------------------------------------

interface Position {
    code: string;
    floor: string;
    row: string;
    rack: string;
    column: string;
    position: string;
    cluster: string;
    locationCode: string;
    locationName: string;
    locationType: string;
    classification: string;
    categories: string;
    subcategories: string;
    storageType: string;
}

function PositionList({ data, clusterCode, onCluster }: { data: Data; clusterCode: string; onCluster: (c: string) => void }) {
    const res = useLoad(() => callBackend<{ rows: Position[]; truncated: boolean }>('/api/org/warehouse/positions', { costCenterId: data.costCenter.id, clusterCode }), [clusterCode]);
    const racking = data.setup ? data.setup.layout.floors.some((f) => f.racking) : true;
    const columns = useMemo<Array<Column<Position>>>(
        () => [
            { key: 'code', label: 'Position', value: (p) => p.code, className: 'font-mono whitespace-nowrap' },
            { key: 'floor', label: 'Floor', value: (p) => p.floor },
            { key: 'row', label: 'Row', value: (p) => p.row },
            { key: 'rack', label: 'Rack', value: (p) => p.rack, hidden: !racking },
            { key: 'column', label: 'Column', value: (p) => p.column, hidden: !racking },
            { key: 'position', label: 'Pos.', value: (p) => p.position },
            { key: 'cluster', label: 'Cluster', value: (p) => p.cluster, className: 'font-mono whitespace-nowrap' },
            { key: 'location', label: 'Storage location', value: (p) => `${p.locationCode} ${p.locationName}` },
            { key: 'ltype', label: 'Location type', value: (p) => p.locationType, hidden: true },
            { key: 'class', label: 'Classification', value: (p) => p.classification },
            { key: 'cat', label: 'Material category', value: (p) => p.categories },
            { key: 'subs', label: 'Subcategories', value: (p) => p.subcategories },
            { key: 'type', label: 'Storage type', value: (p) => p.storageType, hidden: true },
        ],
        [racking]
    );
    if (!data.clusters.length) return <Alert tone='info'>No positions yet. Create a cluster to allocate positions.</Alert>;
    return (
        <>
            <SelectField id='pos-cluster' label='Cluster' value={clusterCode} onChange={(e) => onCluster(e.target.value)}>
                <option value=''>All clusters</option>
                {data.clusters.map((c) => (
                    <option key={c.code} value={c.code}>
                        {c.code} · {c.locationName} ({c.positions})
                    </option>
                ))}
            </SelectField>
            {res.error && <Alert tone='error'>{res.error}</Alert>}
            {res.data?.truncated && <Alert tone='info'>Showing the first 20,000 positions. Choose a cluster to see the rest.</Alert>}
            {res.loading && !res.data ? (
                <Spinner />
            ) : (
                <RichTable id='wh.positions' title='Storage positions' fileName={`storage_positions_${data.costCenter.code}${clusterCode ? `_${clusterCode}` : ''}`} columns={columns} rows={res.data?.rows ?? []} rowKey={(p) => p.code} empty='No positions.' height='h-[calc(100dvh-20rem)]' />
            )}
            <p className='flex items-center gap-1 text-xs text-slate-500'>
                <Warehouse className='h-3.5 w-3.5' />
                Positions are generated in sequence from the clusters; each code exists once.
            </p>
            <Badge>{(res.data?.rows.length ?? 0).toLocaleString()} positions</Badge>
        </>
    );
}
