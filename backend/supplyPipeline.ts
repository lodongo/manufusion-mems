// What is already on its way for a material in a warehouse, counted once.
//
// One purchase need moves through stages: purchase requirement → quotation → requisition → purchase order → delivery.
// Each stage keeps the requirement and line it came from (requirementId + line no), so the need is counted only at
// the furthest stage it has reached:
//   purchase order line (any version in force, latest version only): ordered − received (partial deliveries net off;
//     a fully delivered or closed line counts 0 but still closes the need)
//   requisition line (draft, confirmed, returned, suspended): its quantity, unless a purchase order carries it
//   quotation line (any quotation not cancelled, approved or not): its quantity, unless a requisition or order carries it
//   requirement line (unverified, pending approval, returned, approved, acknowledged): its quantity, unless a later
//     stage carries it. Requests not yet approved or rejected count.
// Order lines without that link are matched by material number and warehouse. Acknowledged replenishment signals
// (call-offs, transfers) are supply too. Maintenance work orders add demand: spares short on a reservation, with the
// work order's planned date.

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const isoAdd = (iso: string, days: number) => (iso ? new Date(Date.parse(iso.slice(0, 10)) + days * 86_400_000).toISOString().slice(0, 10) : '');

export const REQ_COUNT = ['unverified', 'pending_approval', 'returned_user', 'approved', 'acknowledged'];
export const REQ_DONE = ['converted'];
export const PRQ_COUNT = ['draft', 'confirmed', 'returned', 'suspended'];
export const PO_IN_FORCE = ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial', 'full', 'closed'];
export const PO_OPEN_QTY = ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial'];
export const WO_DONE = ['closed', 'cancelled', 'completed', 'verified', 'rejected'];

export type Stage = 'requirement' | 'quotation' | 'requisition' | 'order' | 'signal';
export const STAGE_LABEL: Record<Stage, string> = { requirement: 'Purchase requirement', quotation: 'Quotation', requisition: 'Purchase requisition', order: 'Purchase order', signal: 'Replenishment signal' };
export interface PipeEntry {
    stage: Stage;
    id: string;
    ref: string;
    status: string;
    qty: number;
    ordered: number;
    received: number;
    date: string;
    lineage: string;
    note: string;
}
export interface Pipe {
    qty: number;
    entries: PipeEntry[];
}
export interface Docs {
    requirements: Array<{ id: string; data: Obj }>;
    quotations: Array<{ id: string; data: Obj }>;
    requisitions: Array<{ id: string; data: Obj }>;
    orders: Array<{ id: string; data: Obj }>;
    signals: Array<{ id: string; data: Obj }>;
    materialsByNumber: Map<string, string>;
}

export const keyOf = (materialId: string, warehouseId: string) => `${materialId}__${warehouseId}`;
const baseOf = (id: string) => id.replace(/-V\d+$/, '');
const verOf = (id: string) => Number((id.match(/-V(\d+)$/) ?? [])[1] ?? 1);

/**
 * The pipeline per material and warehouse. `exclude` holds requirement ids left out (the requirement being reviewed,
 * or the replenishment engine's own open request), together with everything that came from them.
 */
export function buildPipeline(d: Docs, exclude: Set<string> = new Set()): Map<string, Pipe> {
    // Requirement lines that are stock: material and warehouse.
    const reqLine = new Map<string, { key: string; qty: number; date: string; ref: string; status: string; id: string }>();
    for (const r of d.requirements) {
        for (const l of objs(r.data.lines)) {
            const m = str(l.materialId);
            const w = str(l.warehouseId);
            if (!m || !w) continue;
            reqLine.set(`${r.id}|${Number(l.no)}`, { key: keyOf(m, w), qty: Math.max(0, Number(l.quantity) || 0), date: str(l.dateRequired), ref: str(r.data.number) || r.id, status: str(r.data.status), id: r.id });
        }
    }
    const covered = new Set<string>();
    const out = new Map<string, Pipe>();
    const add = (key: string, e: PipeEntry) => {
        const p = out.get(key) ?? { qty: 0, entries: [] };
        p.qty = r3(p.qty + e.qty);
        p.entries.push(e);
        out.set(key, p);
    };
    const resolve = (requirementId: string, lineNo: number, l: Obj, warehouseHint: string) => {
        const lineage = requirementId && lineNo ? `${requirementId}|${lineNo}` : '';
        const viaReq = lineage ? reqLine.get(lineage) : undefined;
        if (viaReq) return { key: viaReq.key, lineage, excluded: exclude.has(requirementId) };
        // No link: material number (item code) and warehouse.
        const m = str(l.materialId) || d.materialsByNumber.get(str(l.itemCode)) || d.materialsByNumber.get(str(l.materialNumber)) || '';
        const w = str(l.warehouseId) || warehouseHint;
        return m && w ? { key: keyOf(m, w), lineage, excluded: !!requirementId && exclude.has(requirementId) } : null;
    };

    // 1. Purchase orders: one version per order (the latest in force).
    const latest = new Map<string, { id: string; data: Obj }>();
    for (const p of d.orders) {
        if (!PO_IN_FORCE.includes(str(p.data.status))) continue;
        const b = baseOf(p.id);
        const cur = latest.get(b);
        if (!cur || verOf(p.id) > verOf(cur.id)) latest.set(b, p);
    }
    for (const p of latest.values()) {
        const status = str(p.data.status);
        const open = PO_OPEN_QTY.includes(status);
        const from = str(p.data.approvedAt) || str(p.data.createdAt);
        for (const l of objs(p.data.lines)) {
            if (str(l.type) && str(l.type) !== 'material') continue;
            const res = resolve(str(l.requirementId), Number(l.requirementLineNo) || 0, l, str(l.costCenterId));
            if (!res) continue;
            if (res.lineage) covered.add(res.lineage);
            if (res.excluded) continue;
            const ordered = Number(l.quantity) || 0;
            const received = Number(l.receivedQty) || 0;
            const qty = open ? r3(Math.max(0, ordered - received)) : 0;
            if (!open && !qty) continue;
            const lead = Number(l.leadTimeDays) || 0;
            add(res.key, { stage: 'order', id: p.id, ref: str(p.data.number) || p.id, status, qty, ordered, received, date: (from && lead ? isoAdd(from, lead) : '') || str(l.dateRequired), lineage: res.lineage, note: received > 0 ? `${received} of ${ordered} delivered` : '' });
        }
    }
    // 2. Requisitions not on an order.
    for (const rq of d.requisitions) {
        const status = str(rq.data.status);
        if (status === 'cancelled') continue;
        for (const l of objs(rq.data.lines)) {
            const res = resolve(str(rq.data.requirementId), Number(l.requirementLineNo) || 0, l, str(l.costCenterId));
            if (!res) continue;
            if (res.lineage && covered.has(res.lineage)) continue;
            if (res.lineage) covered.add(res.lineage);
            if (res.excluded || !PRQ_COUNT.includes(status)) continue;
            const qty = Math.max(0, Number(l.quantity) || 0);
            add(res.key, { stage: 'requisition', id: rq.id, ref: str(rq.data.number) || rq.id, status, qty, ordered: qty, received: 0, date: str(l.dateRequired), lineage: res.lineage, note: '' });
        }
    }
    // 3. Quotations (approved or not) not yet on a requisition or order.
    for (const c of d.quotations) {
        const status = str(c.data.status);
        if (status === 'cancelled') continue;
        for (const l of objs(c.data.lines)) {
            const lineage = `${str(c.data.requirementId)}|${Number(l.no)}`;
            const rl = reqLine.get(lineage);
            if (!rl || covered.has(lineage)) continue;
            covered.add(lineage);
            if (exclude.has(rl.id)) continue;
            const qty = Math.max(0, Number(l.quantity) || 0);
            add(rl.key, { stage: 'quotation', id: c.id, ref: str(c.data.number) || c.id, status, qty, ordered: qty, received: 0, date: str(l.dateRequired), lineage, note: '' });
        }
    }
    // 4. Requirements not yet in a later stage (including requests not yet approved).
    for (const [lineage, rl] of reqLine) {
        if (covered.has(lineage) || exclude.has(rl.id) || !REQ_COUNT.includes(rl.status)) continue;
        add(rl.key, { stage: 'requirement', id: rl.id, ref: rl.ref, status: rl.status, qty: rl.qty, ordered: rl.qty, received: 0, date: rl.date, lineage, note: '' });
    }
    // 5. Acknowledged signals.
    for (const s of d.signals) {
        if (str(s.data.status) !== 'acknowledged') continue;
        add(s.id, { stage: 'signal', id: s.id, ref: str(s.data.reference) || str(s.data.signalLabel) || s.id, status: 'acknowledged', qty: Math.max(0, Number(s.data.quantity) || 0), ordered: 0, received: 0, date: str(s.data.dateRequired), lineage: '', note: str(s.data.signalLabel) });
    }
    return out;
}

export interface MaintenanceNeed {
    workOrderId: string;
    taskId: string;
    spareId: string;
    required: number;
    reserved: number;
    shortage: number;
    plannedDate: string;
    woStatus: string;
    title: string;
}

/** Spares reserved and short on open maintenance work orders, by material and warehouse, with the planned dates. */
export function maintenanceNeeds(workOrders: Array<{ id: string; data: Obj }>): Map<string, MaintenanceNeed[]> {
    const out = new Map<string, MaintenanceNeed[]>();
    for (const wo of workOrders) {
        const st = str(wo.data.status);
        if (WO_DONE.includes(st)) continue;
        const planning = wo.data.taskPlanning && typeof wo.data.taskPlanning === 'object' ? (wo.data.taskPlanning as Record<string, unknown>) : {};
        const tasks = objs(wo.data.assessmentTasks);
        for (const [taskId, spares] of Object.entries(planning)) {
            if (!spares || typeof spares !== 'object') continue;
            const task = tasks.find((t) => str(t.id) === taskId);
            for (const [spareId, raw] of Object.entries(spares as Record<string, unknown>)) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
                const s = raw as Obj;
                const m = str(s.materialId);
                const w = str(s.warehouseId);
                if (!m || !w) continue;
                if (['issued', 'released', 'cancelled'].includes(str(s.status))) continue;
                const required = Number(s.required) || 0;
                const reserved = Number(s.reserved) || 0;
                const plannedDate = (str(task?.executionDate) || str(task?.scheduledStart) || str(wo.data.scheduledStart) || str(wo.data.windowStart)).slice(0, 10);
                const k = keyOf(m, w);
                out.set(k, [...(out.get(k) ?? []), { workOrderId: wo.id, taskId, spareId, required, reserved, shortage: r3(Math.max(0, required - reserved)), plannedDate, woStatus: st, title: str(wo.data.title) || str(wo.data.description) }]);
            }
        }
    }
    return out;
}

export const shortageOf = (needs: MaintenanceNeed[] | undefined, until = '') => r3((needs ?? []).filter((n) => !until || !n.plannedDate || n.plannedDate <= until).reduce((s, n) => s + n.shortage, 0));

export interface Verdict {
    action: 'release' | 'reduce' | 'cancel' | 'review';
    suggested: number;
    need: number;
    reasons: string[];
}

/**
 * Should this quantity be bought, given everything else already in the pipeline? `need` is what is still required
 * after available stock, the pipeline and maintenance shortages. Release when the request is within the need,
 * reduce when only part is needed (rounded up to the MOQ and order multiple), cancel when nothing is needed.
 */
export function verdictFor(a: { requested: number; need: number | null; moq: number | null; multiple: number | null; onDemand: boolean; strategyAutomated: boolean; reasons?: string[] }): Verdict {
    const reasons = [...(a.reasons ?? [])];
    if (a.need === null) return { action: 'review', suggested: a.requested, need: 0, reasons: [...reasons, 'No replenishment levels are set for this material in this warehouse, so the need cannot be worked out. Check the maintenance demand and pipeline below.'] };
    let need = Math.max(0, a.need);
    if (need <= 0) return { action: 'cancel', suggested: 0, need: 0, reasons: [...reasons, 'Stock and what is already in the pipeline cover the need.'] };
    let q = need;
    if (a.moq && q < a.moq) q = a.moq;
    if (a.multiple && a.multiple > 0) q = Math.ceil(q / a.multiple - 1e-9) * a.multiple;
    q = r3(q);
    need = r3(need);
    if (q + 1e-9 >= a.requested) return { action: 'release', suggested: a.requested, need, reasons: [...reasons, `${need} is still needed; the request is within it.`] };
    return { action: 'reduce', suggested: q, need, reasons: [...reasons, `Only ${need} is still needed (${q} after the minimum order quantity and order multiple), not ${a.requested}.`] };
}
