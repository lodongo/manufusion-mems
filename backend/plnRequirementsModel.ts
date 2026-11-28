// ---------------------------------------------------------------------------
// Commercial requirements → work back through the BOMs → firmed material requirements → procurement.
//
//   1  Commercial requirements  Final-product SKUs only, with a quantity (in the SKU's own unit) and a need date. They are
//                               entered and firmed by hand for now; each line carries its source ('MANUAL') so the
//                               commercial forecast can feed the same lines later.
//   2  Work back                Every final SKU is exploded through its effective BOM, level by level. Each component line is
//                               taken in the unit of the BOM line and converted, with the registry factor, into the unit
//                               of the item it is made of (an intermediate SKU's own unit, a material's stock unit). An
//                               intermediate SKU is broken down further with the same rules, so the unit link is explicit at
//                               every level: BOM unit → own unit, and for a made item its BOM output unit.
//   3  Minimum batch            Made items are produced in whole lots (the unitisation of the BOM: the smallest batch that
//                               keeps every "cannot be split" line whole, optionally multiples of the process vessel).
//                               Requirements of one intermediate from several parents are added up first, then rounded up
//                               to lots once (as MRP does), so the lot excess is never double counted.
//   4  Total required           A material's gross requirement is the quantity the consolidated production plan consumes
//                               (after scrap and whole packs). It is shown against what each final SKU needs on its own, the
//                               difference being the batch and pack rounding, so the total is traceable.
//   5  Purchase requirement     Gross less usable stock (available less safety stock) less open supply = net; the net is
//                               rounded to the minimum order quantity and order multiple (held in the purchase unit and
//                               converted to the stock unit) to give the quantity to buy, its value, the date it is needed
//                               and the date it must be ordered by.
//   6  Push                     The firmed lines are confirmed (quantity may be changed with a reason, never above the
//                               approved value) and raised as purchase requirements for the manager's approval.
// Nothing here reads or writes the database: the routes in plnRequirements.ts load the data and store the results.
// ---------------------------------------------------------------------------
import { suggestedSplitRule } from '../src/shared/bomSplitRule';
import { buyLot, componentKind, unitise, type BomIn, type ComponentKind, type SkuInfo, type Unitisation } from './plnPlanningModel';

const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const DAY = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
export const addDaysTo = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Multiplier: one `from` equals the returned number of `to`. Null when the units are not convertible. */
export type Convert = (from: string, to: string) => number | null;

// ----- Commercial requirement lines -----

export const LINE_SOURCES = ['MANUAL'] as const; // 'COMMERCIAL_FORECAST' joins when the commercial forecast is linked
export interface RequirementLine { no: number; skuId: string; quantity: number; uom: string; needDate: string; customer: string; note: string; source: 'MANUAL' }
export const MAX_REQUIREMENT_LINES = 100;

/** Reads and checks the lines a person typed. The unit is always the SKU's own unit, so it is set here, not accepted. */
export function readRequirementLines(raw: unknown, skus: Map<string, SkuInfo>, today: string): RequirementLine[] {
    if (!Array.isArray(raw)) throw new Error('Add at least one final product with its quantity.');
    if (raw.length > MAX_REQUIREMENT_LINES) throw new Error(`A requirement set can have up to ${MAX_REQUIREMENT_LINES} lines.`);
    const seen = new Set<string>();
    const limit = addDaysTo(today, 5 * 366);
    return raw.map((x, i) => {
        const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        const at = `Line ${i + 1}: `;
        const skuId = s(o.skuId).trim();
        const sku = skus.get(skuId);
        if (!sku) throw new Error(`${at}choose a final product SKU.`);
        if (sku.category !== 'FINISHED') throw new Error(`${at}${sku.name} is not a final product: only final-product SKUs are firmed here, the intermediates are worked out from the BOM.`);
        const quantity = Number(typeof o.quantity === 'string' ? o.quantity.replace(/,/g, '') : o.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) throw new Error(`${at}enter a quantity greater than zero.`);
        if (suggestedSplitRule(sku.uom) === 'WHOLE' && !Number.isInteger(quantity)) throw new Error(`${at}${sku.name} is counted in whole units: enter a whole number.`);
        if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) throw new Error(`${at}use at most 3 decimals.`);
        const needDate = s(o.needDate).trim();
        if (!isoDay.test(needDate) || Number.isNaN(Date.parse(`${needDate}T00:00:00Z`))) throw new Error(`${at}enter the date the product is needed.`);
        if (needDate < today) throw new Error(`${at}the need date cannot be in the past.`);
        if (needDate > limit) throw new Error(`${at}the need date is too far ahead.`);
        if (seen.has(`${skuId}|${needDate}`)) throw new Error(`${at}${sku.name} is already on this set for ${needDate}: add the quantities together.`);
        seen.add(`${skuId}|${needDate}`);
        const customer = s(o.customer).trim().slice(0, 120);
        const note = s(o.note).trim().slice(0, 300);
        return { no: (i + 1) * 10, skuId, quantity: r3(quantity), uom: sku.uom, needDate, customer, note, source: 'MANUAL' as const };
    });
}

// ----- Inputs of the work-back -----

export interface MaterialPositionU {
    number: string;
    name: string;
    /** Stock unit of the material: the unit a purchase requirement is raised in. */
    stockUom: string;
    /** Purchase unit (Procurement Information); empty when none is set. */
    purchaseUom: string;
    available: number;
    safetyStock: number;
    openSupply: number;
    /** Per stock unit, in the organization currency. */
    unitCost: number;
    leadDays: number;
    /** In the purchase unit (the stock unit when no purchase unit is set). */
    moq: number | null;
    orderMultiple: number | null;
    notes?: string[];
}
export interface ExplosionIn {
    lines: RequirementLine[];
    skus: Map<string, SkuInfo>;
    bomOf: (skuId: string) => BomIn | null;
    unitOf: (skuId: string, bom: BomIn) => Unitisation;
    materialOf: (materialId: string, warehouseId: string) => MaterialPositionU | null;
    convert: Convert;
    today: string;
}

// ----- Outputs -----

export interface Issue { severity: 'block' | 'warn'; text: string; lineNo: number; item: string }
export interface TreeNode {
    id: string;
    depth: number;
    kind: ComponentKind;
    itemId: string;
    warehouseId: string;
    name: string;
    bomLine: number | null;
    /** "qty uom per basisQty basisUom of the parent", scrap and the split rule of the BOM line. */
    perParent: { qty: number; uom: string; basisQty: number; basisUom: string; scrapPct: number; rule: string } | null;
    /** Required in the unit of the BOM line (exact, with scrap); at the top, the commercial quantity. */
    lineQty: number | null;
    lineUom: string;
    /** The unit of the item itself: the SKU's own unit, the material's stock unit, the utility's line unit. */
    ownUom: string;
    /** One line unit equals this many own units (null when the units cannot be converted). */
    factor: number | null;
    ownQty: number | null;
    /** Made items: the BOM, its output unit and the minimum batch. */
    bom: { id: string; name: string; outputQty: number; outputUom: string; outputFactor: number | null; minimalBatch: number; exactBatch: number; lot: number; processBatch: number | null; notes: string[] } | null;
    children: TreeNode[];
    issues: string[];
}
export interface Peg { lineNo: number; skuId: string; skuName: string; needDate: string; parentSku: string; parentName: string; path: string; bomLine: number; lineQty: number; lineUom: string; factor: number; qty: number }
export interface MaterialRequirement {
    key: string;
    materialId: string;
    warehouseId: string;
    number: string;
    name: string;
    level: number;
    /** False when the BOM line names no warehouse or the material is not set up there: planned without stock netting and not pushed. */
    pushable: boolean;
    stockUom: string;
    purchaseUom: string;
    /** One purchase unit equals this many stock units (null: no purchase unit or not convertible). */
    purchaseFactor: number | null;
    bomUnits: string[];
    pegs: Peg[];
    /** What each final SKU needs by itself, the batch and pack rounding of the production plan, and their sum. */
    exact: number;
    rounding: number;
    gross: number;
    available: number;
    safetyStock: number;
    openSupply: number;
    net: number;
    moq: number | null;
    orderMultiple: number | null;
    buy: number;
    buyPurchase: number | null;
    excess: number;
    unitCost: number;
    value: number;
    leadDays: number;
    needBy: string;
    orderBy: string;
    arrival: string;
    orderNow: boolean;
    lateDays: number;
    issues: string[];
}
export interface UtilityRequirement { key: string; code: string; uom: string; gross: number; pegs: number }
export interface ProductionRow {
    skuId: string;
    name: string;
    level: number;
    category: string;
    ownUom: string;
    required: number;
    bomId: string;
    bomName: string;
    outputUom: string;
    outputFactor: number | null;
    requiredOutput: number;
    minimalBatch: number;
    exactBatch: number;
    lot: number;
    processBatch: number | null;
    lots: number;
    producedOutput: number;
    excessOutput: number;
    producedOwn: number;
    notes: string[];
}
export interface Explosion {
    trees: Array<{ line: RequirementLine; skuName: string; root: TreeNode }>;
    production: ProductionRow[];
    materials: MaterialRequirement[];
    utilities: UtilityRequirement[];
    issues: Issue[];
    summary: { lines: number; skus: number; intermediates: number; materials: number; toBuy: number; covered: number; orderNow: number; late: number; notPushable: number; utilities: number; blocking: number; warnings: number; value: number };
}

const MAX_DEPTH = 12;

/** Works back from the final-product lines to the BOM leaves. See the header for the rules. */
export function explodeRequirements(a: ExplosionIn): Explosion {
    const issues: Issue[] = [];
    const flag = (severity: Issue['severity'], text: string, lineNo: number, item: string) => issues.push({ severity, text, lineNo, item });
    const unitCache = new Map<string, Unitisation | null>();
    const unit = (skuId: string, bom: BomIn): Unitisation | null => {
        const k = `${skuId}|${bom.id}`;
        if (!unitCache.has(k)) {
            try {
                unitCache.set(k, a.unitOf(skuId, bom));
            } catch (e) {
                unitCache.set(k, null);
                flag('block', `${bom.id}: ${e instanceof Error ? e.message : 'the BOM cannot be unitised'}`, 0, skuId);
            }
        }
        return unitCache.get(k)!;
    };
    const factorCache = new Map<string, number | null>();
    const factor = (from: string, to: string): number | null => {
        if (!from || !to) return null;
        if (from === to) return 1;
        const k = `${from}>${to}`;
        if (!factorCache.has(k)) {
            const f = a.convert(from, to);
            factorCache.set(k, f !== null && Number.isFinite(f) && f > 0 ? f : null);
        }
        return factorCache.get(k)!;
    };
    const scrapOf = (c: { scrapPct?: number }) => 1 + (Number(c.scrapPct) || 0) / 100;
    const nameOf = (id: string) => a.skus.get(id)?.name ?? id;
    const matKey = (materialId: string, warehouseId: string) => `${materialId}|${warehouseId}`;
    const ruleText = (c: BomIn['components'][number], packs: number) =>
        componentKind(c) === 'utility' ? 'metered, divisible' : c.splitRule === 'WHOLE' ? `whole${packs > 1 ? ` packs of ${packs} ${c.uom}` : ' units'}` : c.splitRule === 'SPLIT' ? 'can be split' : `${suggestedSplitRule(c.uom) === 'WHOLE' ? 'whole units' : 'can be split'} (from the unit)`;

    // ----- A  The exact tree of every final-product line (no batch rounding): what each SKU needs on its own -----
    const exactPegs = new Map<string, Peg[]>();
    const exactUtil = new Map<string, { code: string; uom: string; qty: number; pegs: number }>();
    const levelOfMaterial = new Map<string, number>();
    const trees: Explosion['trees'] = [];
    const blank = (id: string, depth: number, kind: ComponentKind, itemId: string, name: string): TreeNode => ({
        id, depth, kind, itemId, warehouseId: '', name, bomLine: null, perParent: null, lineQty: null, lineUom: '', ownUom: '', factor: null, ownQty: null, bom: null, children: [], issues: [],
    });
    const expand = (node: TreeNode, skuId: string, ownQty: number, path: Set<string>, line: RequirementLine) => {
        const info = a.skus.get(skuId);
        const bom = a.bomOf(skuId);
        if (!bom) {
            node.issues.push('No approved BOM is effective for this SKU at the site: its components cannot be worked out.');
            flag('block', `${nameOf(skuId)} has no approved BOM effective at the site.`, line.no, skuId);
            return;
        }
        const u = unit(skuId, bom);
        const outFactor = factor(info?.uom ?? '', bom.outputUom);
        node.bom = { id: bom.id, name: s(bom.name), outputQty: bom.outputQty, outputUom: bom.outputUom, outputFactor: outFactor, minimalBatch: u?.minimalBatch ?? 1, exactBatch: u?.exactBatch ?? 1, lot: u?.lot ?? 1, processBatch: u?.processBatch ?? null, notes: u?.notes ?? [] };
        if (outFactor === null) {
            node.issues.push(`The unit of ${nameOf(skuId)} (${info?.uom ?? '?'}) cannot be converted to the BOM output unit (${bom.outputUom}).`);
            flag('block', `${nameOf(skuId)}: ${info?.uom ?? '?'} cannot be converted to the BOM output unit ${bom.outputUom}.`, line.no, skuId);
            return;
        }
        const outQty = ownQty * outFactor;
        bom.components.forEach((c, ci) => {
            const kind = componentKind(c);
            const lineNo = Number(c.line) || ci + 1;
            const lineQty = (outQty / bom.outputQty) * c.quantity * scrapOf(c);
            const id = `${node.id}.${lineNo}`;
            const perParent = { qty: c.quantity, uom: c.uom, basisQty: bom.outputQty, basisUom: bom.outputUom, scrapPct: Number(c.scrapPct) || 0, rule: ruleText(c, u?.lines[ci]?.packSize ?? 1) };
            if (kind === 'sku') {
                const child = blank(id, node.depth + 1, 'sku', s(c.skuId), nameOf(s(c.skuId)));
                child.bomLine = lineNo;
                child.perParent = perParent;
                child.lineQty = r3(lineQty);
                child.lineUom = c.uom;
                node.children.push(child);
                const ci2 = a.skus.get(s(c.skuId));
                if (!ci2) {
                    child.issues.push('This SKU is not in the master data.');
                    flag('block', `BOM line ${lineNo} of ${nameOf(skuId)} names a SKU that does not exist (${s(c.skuId)}).`, line.no, s(c.skuId));
                    return;
                }
                child.ownUom = ci2.uom;
                child.factor = factor(c.uom, ci2.uom);
                if (child.factor === null) {
                    child.issues.push(`${c.uom} cannot be converted to ${ci2.uom}, the unit of ${ci2.name}. Correct the unit on the BOM line.`);
                    flag('block', `${nameOf(skuId)} line ${lineNo}: ${c.uom} cannot be converted to ${ci2.uom}.`, line.no, s(c.skuId));
                    return;
                }
                child.ownQty = r3(lineQty * child.factor);
                if (path.has(s(c.skuId)) || node.depth + 1 >= MAX_DEPTH) {
                    child.issues.push('The BOM loops back on itself: the explosion stopped here.');
                    flag('block', `BOM cycle through ${ci2.name}: the explosion stopped.`, line.no, s(c.skuId));
                    return;
                }
                expand(child, s(c.skuId), lineQty * child.factor, new Set(path).add(s(c.skuId)), line);
            } else if (kind === 'material') {
                const materialId = s(c.materialId);
                const warehouseId = s(c.warehouseId);
                const pos = warehouseId ? a.materialOf(materialId, warehouseId) : null;
                const child = blank(id, node.depth + 1, 'material', materialId, pos ? `${pos.number} · ${pos.name}` : materialId);
                child.warehouseId = warehouseId;
                child.bomLine = lineNo;
                child.perParent = perParent;
                child.lineQty = r3(lineQty);
                child.lineUom = c.uom;
                child.ownUom = pos?.stockUom || c.uom;
                node.children.push(child);
                if (!warehouseId) child.issues.push('The BOM line names no warehouse: it is planned without stock netting and cannot be pushed to procurement.');
                else if (!pos) child.issues.push('The material is not set up in this warehouse: planned without stock netting and not pushed.');
                const f = factor(c.uom, child.ownUom);
                child.factor = f;
                if (f === null) {
                    child.issues.push(`${c.uom} cannot be converted to the stock unit ${child.ownUom}. Correct the unit on the BOM line.`);
                    flag('block', `${nameOf(skuId)} line ${lineNo}: ${c.uom} cannot be converted to the stock unit ${child.ownUom}.`, line.no, materialId);
                    return;
                }
                child.ownQty = r3(lineQty * f);
                const k = matKey(materialId, warehouseId);
                levelOfMaterial.set(k, Math.max(levelOfMaterial.get(k) ?? 0, node.depth + 1));
                const list = exactPegs.get(k) ?? exactPegs.set(k, []).get(k)!;
                list.push({ lineNo: line.no, skuId: line.skuId, skuName: nameOf(line.skuId), needDate: line.needDate, parentSku: skuId, parentName: nameOf(skuId), path: id, bomLine: lineNo, lineQty: r3(lineQty), lineUom: c.uom, factor: f, qty: lineQty * f });
            } else {
                const code = s(c.supplyUtilityCode) || s(c.utilityCode) || 'UTILITY';
                const child = blank(id, node.depth + 1, 'utility', code, code);
                child.bomLine = lineNo;
                child.perParent = perParent;
                child.lineQty = r3(lineQty);
                child.lineUom = c.uom;
                child.ownUom = c.uom;
                child.factor = 1;
                child.ownQty = r3(lineQty);
                node.children.push(child);
                const k = `${code}|${c.uom}`;
                const u2 = exactUtil.get(k) ?? exactUtil.set(k, { code, uom: c.uom, qty: 0, pegs: 0 }).get(k)!;
                u2.qty += lineQty;
                u2.pegs += 1;
            }
        });
    };
    for (const line of a.lines) {
        const info = a.skus.get(line.skuId);
        const root = blank(`L${line.no}`, 0, 'sku', line.skuId, info?.name ?? line.skuId);
        root.lineQty = line.quantity;
        root.lineUom = info?.uom ?? line.uom;
        root.ownUom = info?.uom ?? line.uom;
        root.factor = 1;
        root.ownQty = line.quantity;
        trees.push({ line, skuName: root.name, root });
        if (!info) {
            root.issues.push('This SKU is not in the master data.');
            flag('block', `Line ${line.no}: ${line.skuId} is not in the master data.`, line.no, line.skuId);
            continue;
        }
        if (info.category !== 'FINISHED') {
            root.issues.push('Only final products are firmed here.');
            flag('block', `Line ${line.no}: ${info.name} is not a final product.`, line.no, line.skuId);
            continue;
        }
        expand(root, line.skuId, line.quantity, new Set([line.skuId]), line);
    }

    // ----- B  The consolidated plan: intermediates added up across parents, rounded to lots once, level by level -----
    const level = new Map<string, number>();
    const visit = (sku: string, depth: number, path: Set<string>) => {
        if (path.has(sku) || depth >= MAX_DEPTH) return;
        if ((level.get(sku) ?? -1) >= depth) return;
        level.set(sku, depth);
        const bom = a.bomOf(sku);
        if (!bom) return;
        const next = new Set(path).add(sku);
        for (const c of bom.components) if (componentKind(c) === 'sku' && s(c.skuId)) visit(s(c.skuId), depth + 1, next);
    };
    const demand = new Map<string, number>();
    for (const line of a.lines) {
        const info = a.skus.get(line.skuId);
        if (!info || info.category !== 'FINISHED') continue;
        demand.set(line.skuId, (demand.get(line.skuId) ?? 0) + line.quantity);
        visit(line.skuId, 0, new Set());
    }
    const gross = new Map<string, number>();
    const byUnit = new Map<string, Set<string>>();
    const utilGross = new Map<string, { code: string; uom: string; qty: number }>();
    const production: ProductionRow[] = [];
    for (const [sku] of [...level.entries()].sort((x, y) => x[1] - y[1])) {
        const info = a.skus.get(sku);
        const bom = a.bomOf(sku);
        const req = demand.get(sku) ?? 0;
        if (!info || !bom || !(req > 0)) continue;
        const u = unit(sku, bom);
        const outFactor = factor(info.uom, bom.outputUom);
        if (!u || outFactor === null) continue;
        const reqOut = req * outFactor;
        const plan = unitise(reqOut, u.lot);
        production.push({
            skuId: sku, name: info.name, level: level.get(sku) ?? 0, category: info.category, ownUom: info.uom, required: r3(req), bomId: bom.id, bomName: s(bom.name), outputUom: bom.outputUom, outputFactor: outFactor, requiredOutput: r3(reqOut),
            minimalBatch: u.minimalBatch, exactBatch: u.exactBatch, lot: u.lot, processBatch: u.processBatch, lots: plan.lots, producedOutput: plan.qty, excessOutput: plan.excess, producedOwn: r3(plan.qty / outFactor), notes: u.notes,
        });
        bom.components.forEach((c, ci) => {
            const kind = componentKind(c);
            let q = (plan.qty / bom.outputQty) * c.quantity * scrapOf(c);
            const ul = u.lines[ci];
            // Whole packs stay whole: an indivisible component is rounded up after scrap.
            if (ul?.indivisible) q = Math.ceil(q / ul.packSize - 1e-9) * ul.packSize;
            if (kind === 'sku') {
                const child = a.skus.get(s(c.skuId));
                const f = child ? factor(c.uom, child.uom) : null;
                if (child && f !== null) demand.set(s(c.skuId), (demand.get(s(c.skuId)) ?? 0) + q * f);
            } else if (kind === 'material') {
                const materialId = s(c.materialId);
                const warehouseId = s(c.warehouseId);
                const pos = warehouseId ? a.materialOf(materialId, warehouseId) : null;
                const f = factor(c.uom, pos?.stockUom || c.uom);
                if (f === null) return;
                const k = matKey(materialId, warehouseId);
                gross.set(k, (gross.get(k) ?? 0) + q * f);
                (byUnit.get(k) ?? byUnit.set(k, new Set()).get(k)!).add(c.uom);
            } else {
                const code = s(c.supplyUtilityCode) || s(c.utilityCode) || 'UTILITY';
                const k = `${code}|${c.uom}`;
                const g = utilGross.get(k) ?? utilGross.set(k, { code, uom: c.uom, qty: 0 }).get(k)!;
                g.qty += q;
            }
        });
    }

    // ----- C  Gross to net and the quantity to buy, per material -----
    const materials: MaterialRequirement[] = [];
    const keys = new Set<string>([...gross.keys(), ...exactPegs.keys()]);
    for (const k of keys) {
        const [materialId, warehouseId] = k.split('|') as [string, string];
        const pos = warehouseId ? a.materialOf(materialId, warehouseId) : null;
        const pegs = (exactPegs.get(k) ?? []).map((p) => ({ ...p, qty: r3(p.qty) }));
        const grossQty = r3(gross.get(k) ?? 0);
        const exact = r3((exactPegs.get(k) ?? []).reduce((t, p) => t + p.qty, 0));
        const stockUom = pos?.stockUom || [...(byUnit.get(k) ?? [])][0] || '';
        const purchaseUom = pos?.purchaseUom ?? '';
        const purchaseFactor = purchaseUom && purchaseUom !== stockUom ? factor(purchaseUom, stockUom) : purchaseUom ? 1 : null;
        const notes: string[] = [...(pos?.notes ?? [])];
        if (!warehouseId) notes.push('No warehouse on the BOM line: planned without stock netting; raise the purchase requirement by hand.');
        else if (!pos) notes.push('Not set up in this warehouse: planned without stock netting; raise the purchase requirement by hand.');
        if (pos && purchaseUom && purchaseFactor === null) notes.push(`The purchase unit ${purchaseUom} cannot be converted to the stock unit ${stockUom}: the minimum order and order multiple are read in the stock unit.`);
        const asStock = (v: number | null) => (v === null ? null : purchaseFactor !== null ? r3(v * purchaseFactor) : v);
        const moq = asStock(pos?.moq ?? null);
        const multiple = asStock(pos?.orderMultiple ?? null);
        const available = r3(pos?.available ?? 0);
        const safety = r3(pos?.safetyStock ?? 0);
        const openSupply = r3(pos?.openSupply ?? 0);
        const net = r3(Math.max(0, grossQty - (available - safety) - openSupply));
        const buy = buyLot(net, moq, multiple);
        const unitCost = pos?.unitCost ?? 0;
        const needBy = pegs.map((p) => p.needDate).sort()[0] ?? '';
        const leadDays = Math.max(0, Math.trunc(pos?.leadDays ?? 0));
        const orderBy = needBy ? addDaysTo(needBy, -leadDays) : '';
        const arrival = addDaysTo(a.today, leadDays);
        const lateDays = needBy && buy > 0 ? Math.max(0, daysBetween(needBy, arrival)) : 0;
        if (buy > 0 && unitCost <= 0) notes.push('No price or stock value is known: the value is zero and the approval levels cannot count it.');
        materials.push({
            key: k, materialId, warehouseId, number: pos?.number || materialId, name: pos?.name || materialId, level: levelOfMaterial.get(k) ?? 1, pushable: !!pos && !!warehouseId,
            stockUom, purchaseUom, purchaseFactor, bomUnits: [...(byUnit.get(k) ?? [])].sort(), pegs, exact, rounding: r3(Math.max(0, grossQty - exact)), gross: grossQty, available, safetyStock: safety, openSupply, net,
            moq, orderMultiple: multiple, buy, buyPurchase: purchaseFactor && buy > 0 ? r3(buy / purchaseFactor) : null, excess: r3(Math.max(0, buy - net)), unitCost, value: r2(buy * unitCost),
            leadDays, needBy, orderBy, arrival, orderNow: buy > 0 && !!orderBy && orderBy < a.today, lateDays, issues: notes,
        });
    }
    materials.sort((x, y) => Number(y.buy > 0) - Number(x.buy > 0) || x.level - y.level || x.number.localeCompare(y.number));
    const utilities: UtilityRequirement[] = [...utilGross.entries()].map(([key, g]) => ({ key, code: g.code, uom: g.uom, gross: r3(g.qty), pegs: exactUtil.get(key)?.pegs ?? 0 })).sort((x, y) => x.code.localeCompare(y.code));
    for (const m of materials) if (m.issues.length && !m.pushable && m.buy > 0) flag('warn', `${m.number}: ${m.issues[0]}`, 0, m.materialId);
    for (const m of materials) if (m.lateDays > 0) flag('warn', `${m.number}: the lead time of ${m.leadDays} days reaches ${m.arrival}, ${m.lateDays} days after it is needed (${m.needBy}).`, 0, m.materialId);
    const summary = {
        lines: a.lines.length,
        skus: production.length,
        intermediates: production.filter((p) => p.level > 0).length,
        materials: materials.length,
        toBuy: materials.filter((m) => m.buy > 0).length,
        covered: materials.filter((m) => m.buy === 0).length,
        orderNow: materials.filter((m) => m.orderNow).length,
        late: materials.filter((m) => m.lateDays > 0).length,
        notPushable: materials.filter((m) => m.buy > 0 && !m.pushable).length,
        utilities: utilities.length,
        blocking: issues.filter((i) => i.severity === 'block').length,
        warnings: issues.filter((i) => i.severity === 'warn').length,
        value: r2(materials.reduce((t, m) => t + m.value, 0)),
    };
    return { trees, production, materials, utilities, issues, summary };
}

// ----- Firmed purchase requirements and the push -----

/** What is frozen when the purchase requirements are firmed: one line per material and warehouse with something to buy. */
export interface FirmedLine {
    key: string;
    materialId: string;
    warehouseId: string;
    number: string;
    name: string;
    stockUom: string;
    firmQty: number;
    unitCost: number;
    value: number;
    needBy: string;
    orderNow: boolean;
    /** The final products the material is for (names, at most five), carried into the procurement requirement. */
    forSkus: string[];
    /** Procurement requirement the line was pushed to. */
    pushedTo?: string;
}
export const firmedLinesOf = (m: MaterialRequirement[]): FirmedLine[] =>
    m.filter((x) => x.buy > 0 && x.pushable).map((x) => ({
        key: x.key, materialId: x.materialId, warehouseId: x.warehouseId, number: x.number, name: x.name, stockUom: x.stockUom, firmQty: x.buy, unitCost: x.unitCost, value: x.value, needBy: x.needBy, orderNow: x.orderNow,
        forSkus: [...new Set(x.pegs.map((p) => p.skuName))].slice(0, 5),
    }));

export interface PushEdit { key: string; quantity: number | string; reason?: string }
export interface PushLine extends FirmedLine { quantity: number; changed: boolean; reason: string; pushValue: number; delta: number }
/**
 * Confirms the quantities of a push. A quantity may be changed in either direction with a reason, but the value pushed may
 * never exceed the value the Chart of Authority approved: a push can reallocate quantity, not raise the spend.
 */
export function reviewPush(firmed: FirmedLine[], edits: PushEdit[], ceiling: number): { lines: PushLine[]; total: number; firmedTotal: number; problems: string[] } {
    const problems: string[] = [];
    const byKey = new Map(firmed.map((f) => [f.key, f]));
    const seen = new Set<string>();
    const lines: PushLine[] = [];
    if (!edits.length) problems.push('Choose at least one line to push.');
    for (const e of edits) {
        const f = byKey.get(e.key);
        if (!f) {
            problems.push(`${e.key} is not a firmed line of this set.`);
            continue;
        }
        if (seen.has(e.key)) {
            problems.push(`${f.number} is listed twice.`);
            continue;
        }
        seen.add(e.key);
        if (f.pushedTo) {
            problems.push(`${f.number} was already pushed to ${f.pushedTo}.`);
            continue;
        }
        const q = Number(typeof e.quantity === 'string' ? e.quantity.replace(/,/g, '') : e.quantity);
        if (!Number.isFinite(q) || q <= 0 || q > 1_000_000_000) {
            problems.push(`${f.number}: enter a quantity greater than zero.`);
            continue;
        }
        if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) {
            problems.push(`${f.number}: use at most 3 decimals.`);
            continue;
        }
        if (suggestedSplitRule(f.stockUom) === 'WHOLE' && !Number.isInteger(q)) {
            problems.push(`${f.number} is counted in whole ${f.stockUom}: enter a whole number.`);
            continue;
        }
        const changed = Math.abs(q - f.firmQty) > 1e-9;
        const reason = s(e.reason).trim();
        if (changed && (reason.length < 10 || reason.length > 300)) {
            problems.push(`${f.number}: say why the quantity changes from ${f.firmQty} to ${r3(q)} (10 to 300 characters).`);
            continue;
        }
        lines.push({ ...f, quantity: r3(q), changed, reason: changed ? reason : '', pushValue: r2(q * f.unitCost), delta: r3(q - f.firmQty) });
    }
    const total = r2(lines.reduce((t, l) => t + l.pushValue, 0));
    const firmedTotal = r2(firmed.reduce((t, f) => t + f.value, 0));
    // The ceiling is the whole approved value, so quantity can move between lines; a tolerance of one cent covers rounding.
    const alreadyPushed = r2(firmed.filter((f) => f.pushedTo).reduce((t, f) => t + f.value, 0));
    if (total + alreadyPushed > ceiling + 0.01) problems.push(`The push is worth ${total}${alreadyPushed ? ` (plus ${alreadyPushed} already pushed)` : ''}, above the approved value of ${ceiling}. Lower a quantity or return the set for a new approval.`);
    return { lines, total, firmedTotal, problems };
}

// ----- Workflow -----

export type ReqStatus = 'draft' | 'commercial_review' | 'firmed' | 'purchase_review' | 'approved' | 'pushed' | 'cancelled';
export type ReqAction = 'edit_lines' | 'submit_commercial' | 'firm_commercial' | 'return_commercial' | 'run_explosion' | 'submit_purchase' | 'approve_purchase' | 'return_purchase' | 'push' | 'reopen' | 'cancel';
export const REQ_STEPS: Array<{ status: ReqStatus; label: string; role: string }> = [
    { status: 'draft', label: 'Commercial requirements', role: 'Requirements Planner' },
    { status: 'commercial_review', label: 'Firming review', role: 'Commercial Firming Approver' },
    { status: 'firmed', label: 'Work back to materials', role: 'Requirements Planner' },
    { status: 'purchase_review', label: 'Purchase approval', role: 'Purchase Requirements Approver (Chart of Authority)' },
    { status: 'approved', label: 'Push to procurement', role: 'Purchase Requirements Releaser' },
    { status: 'pushed', label: 'In procurement', role: '' },
];
export const REQ_PERMISSION: Record<ReqAction, string> = {
    edit_lines: 'PLN.commercial.plan',
    submit_commercial: 'PLN.commercial.plan',
    firm_commercial: 'PLN.commercial.firm',
    return_commercial: 'PLN.commercial.firm',
    run_explosion: 'PLN.commercial.plan',
    submit_purchase: 'PLN.commercial.plan',
    approve_purchase: 'PLN.requirements.approve',
    return_purchase: 'PLN.requirements.approve',
    push: 'PLN.requirements.push',
    reopen: 'PLN.commercial.plan',
    cancel: 'PLN.commercial.plan',
};
const REQ_FROM: Record<ReqAction, ReqStatus[]> = {
    edit_lines: ['draft'],
    submit_commercial: ['draft'],
    firm_commercial: ['commercial_review'],
    return_commercial: ['commercial_review'],
    run_explosion: ['draft', 'firmed'],
    submit_purchase: ['firmed'],
    approve_purchase: ['purchase_review'],
    return_purchase: ['purchase_review'],
    push: ['approved'],
    reopen: ['firmed'],
    cancel: ['draft', 'commercial_review', 'firmed', 'purchase_review', 'approved'],
};
export interface ReqActors { createdBy?: string; commercialSubmittedBy?: string; firmedBy?: string; purchaseSubmittedBy?: string; approvers?: string[] }
/**
 * May `uid` take `action` on a set in `status`? Returns the reason when not. Independence: the person who firms is not the
 * planner who prepared or submitted; the purchase approvers are none of the planner, the person who firmed or an earlier
 * approver; the person who pushes is none of the approvers.
 */
export function reqTransitionCheck(status: ReqStatus, action: ReqAction, uid: string, actors: ReqActors, extra: { explosionRun?: boolean; explosionStale?: boolean; blocking?: number; toBuy?: number; unpriced?: number } = {}): string {
    if (!REQ_FROM[action].includes(status)) return `A requirement set that is ${status.replace('_', ' ')} cannot be ${action.replace('_', ' ')}d.`;
    if (action === 'submit_purchase') {
        if (!extra.explosionRun) return 'Work back to the materials before submitting the purchase requirements.';
        if (extra.explosionStale) return 'The BOMs, stock or prices changed since the last work-back: run it again before submitting.';
        if (extra.blocking) return `Fix the ${extra.blocking} blocking issue${extra.blocking === 1 ? '' : 's'} (BOM, unit or master data) and work back again before submitting.`;
        if (extra.unpriced) return `${extra.unpriced} material${extra.unpriced === 1 ? ' has' : 's have'} no price or stock value, so the approval level cannot be worked out. Set the unit price in Procurement Information and work back again.`;
        if (!extra.toBuy) return 'Nothing needs buying: stock and open supply cover the requirement, or the materials cannot be pushed. Cancel the set or correct the masters.';
    }
    if ((action === 'firm_commercial' || action === 'return_commercial') && (uid === actors.createdBy || uid === actors.commercialSubmittedBy)) return 'You prepared this requirement set, so an independent approver must firm it.';
    if (action === 'approve_purchase' || action === 'return_purchase') {
        if ([actors.createdBy, actors.commercialSubmittedBy, actors.firmedBy, actors.purchaseSubmittedBy].includes(uid)) return 'You prepared or firmed this set, so an independent approver must decide the purchase.';
        if (action === 'approve_purchase' && (actors.approvers ?? []).includes(uid)) return 'You approved an earlier level, so a different person must approve this one.';
    }
    if (action === 'push' && (actors.approvers ?? []).includes(uid)) return 'You approved this purchase, so another person must push it to procurement.';
    return '';
}
export const REQ_NEXT: Partial<Record<ReqAction, ReqStatus>> = {
    submit_commercial: 'commercial_review',
    firm_commercial: 'firmed',
    return_commercial: 'draft',
    submit_purchase: 'purchase_review',
    return_purchase: 'firmed',
    reopen: 'draft',
    cancel: 'cancelled',
};
