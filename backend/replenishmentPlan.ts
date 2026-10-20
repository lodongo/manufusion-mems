/**
 * Replenishment planning for one material in one warehouse. Pure: no reads, no writes.
 *
 * The method is the material's replenishment strategy (RP01-RP18, from the MEMS stock metadata). MRP is one method
 * (RP06). Every method works on the same position:
 *
 *   projected = available stock (physical − reserved − quarantined − damaged − expired − other)
 *             + open supply (requirements, requisitions and purchase orders not yet received, open signals)
 *
 * and returns either nothing to do, an incomplete configuration, or a quantity with its basis. Minimum order quantity
 * and order multiple are applied last. Who acts on the quantity (purchase, consignment call-off, supplier, owner) is
 * decided by `routeFor` from ownership and supply arrangement, not by the method.
 */

export type Urgency = 'high' | 'medium';
export interface Params {
    minimumLevel: number | null;
    maximumLevel: number | null;
    reorderPoint: number | null;
    reorderQuantity: number | null;
    safetyStock: number | null;
    minimumOrderQuantity: number | null;
    orderMultiple: number | null;
    leadTimeDays: number;
    unitPrice: number | null;
    annualDemand: number | null;
    orderCost: number | null;
    holdingCostRate: number | null;
    demandLookbackDays: number | null;
    coverageDays: number | null;
    emergencyLevel: number | null;
    strategicLevel: number | null;
    seasonalFactors: number[] | null;
    rotablesInRepair: number | null;
    binQuantity: number | null;
    kanbanCardQuantity: number | null;
    kanbanCards: number | null;
    reviewPeriodDays: number | null;
    forecastMonthlyDemand: number | null;
}
export interface Situation {
    available: number;
    openSupply: number;
    /** Quantity consumed (issued) in the last `consumedDays` days. */
    consumed: number;
    consumedDays: number;
    /** Month (0-11) in which an order placed now would arrive. */
    arrivalMonth: number;
    /** Days since the last periodic review of this material and warehouse (null: never reviewed). */
    daysSinceReview: number | null;
}
export type PlanResult =
    | { kind: 'not_planned'; reason: string }
    | { kind: 'incomplete'; reason: string }
    | { kind: 'not_due'; reason: string }
    | { kind: 'no_need'; projected: number; trigger: number; reason: string }
    | { kind: 'order'; projected: number; trigger: number; target: number | null; quantity: number; urgency: Urgency; basis: string };

export interface ParamDef { key: keyof Params; label: string; hint: string }
export interface MethodDef { code: string; name: string; automated: boolean; required: Array<keyof Params>; optional: Array<keyof Params>; explain: string }

const P = {
    min: 'minimumLevel', max: 'maximumLevel', rop: 'reorderPoint', roq: 'reorderQuantity', safety: 'safetyStock',
} as const;

/** What each strategy needs and does. Required parameters are checked before an order is ever planned. */
export const METHODS: Record<string, MethodDef> = {
    RP01: { code: 'RP01', name: 'Min-Max', automated: true, required: [P.min, P.max], optional: [P.safety], explain: 'When projected stock falls to or below the minimum, order up to the maximum.' },
    RP02: { code: 'RP02', name: 'Reorder Point', automated: true, required: [P.rop], optional: [P.roq, P.max, P.safety], explain: 'When projected stock falls to or below the reorder point, order the reorder quantity (as many times as needed), or up to the maximum.' },
    RP03: { code: 'RP03', name: 'Economic Order Quantity', automated: true, required: [P.rop, 'orderCost', 'holdingCostRate'], optional: ['annualDemand', 'demandLookbackDays', P.safety], explain: 'At the reorder point, order the economic order quantity √(2 × annual demand × order cost ÷ yearly holding cost per unit). Annual demand is entered or derived from consumption.' },
    RP04: { code: 'RP04', name: 'Just-in-Time', automated: true, required: [], optional: [], explain: 'Hold no buffer: order exactly what reserved demand needs beyond available stock and open supply.' },
    RP05: { code: 'RP05', name: 'Demand-driven', automated: true, required: [], optional: ['demandLookbackDays', 'coverageDays', P.safety], explain: 'Average daily consumption over the look-back window sets a reorder level (usage × lead time + safety) and a target (reorder level + usage × coverage days).' },
    RP06: { code: 'RP06', name: 'MRP-controlled', automated: true, required: [], optional: [P.safety], explain: 'Material requirements planning: net requirement = safety stock − (available after reservations + open supply), ordered lot for lot.' },
    RP07: { code: 'RP07', name: 'Direct purchase', automated: false, required: [], optional: [], explain: 'Bought directly against each demand; not replenished to stock.' },
    RP08: { code: 'RP08', name: 'Emergency reserve', automated: true, required: [], optional: ['emergencyLevel', P.min, P.max], explain: 'Keep the emergency level at all times; any shortfall is ordered with high urgency.' },
    RP09: { code: 'RP09', name: 'Rotable replenishment', automated: true, required: [P.min, P.max], optional: ['rotablesInRepair'], explain: 'Min-Max on serviceable units; units out for repair count as supply.' },
    RP10: { code: 'RP10', name: 'Seasonal stocking', automated: true, required: [P.min, P.max, 'seasonalFactors'], optional: [], explain: 'Min-Max with both levels scaled by the seasonal factor of the month the order would arrive.' },
    RP11: { code: 'RP11', name: 'Strategic buffer', automated: true, required: [], optional: ['strategicLevel', P.max], explain: 'Keep a strategic buffer level for supply security; any shortfall is ordered.' },
    RP12: { code: 'RP12', name: 'Supplier-replenished', automated: true, required: [P.min], optional: [P.max, P.rop], explain: 'The supplier replenishes (VMI); MEMS raises a replenishment signal for the supplier instead of a purchase.' },
    RP13: { code: 'RP13', name: 'Two-bin', automated: true, required: ['binQuantity'], optional: [], explain: 'When the first bin is empty (projected ≤ one bin), refill one bin.' },
    RP14: { code: 'RP14', name: 'Kanban', automated: true, required: ['kanbanCardQuantity', 'kanbanCards'], optional: [], explain: 'Each empty kanban card triggers one card quantity.' },
    RP15: { code: 'RP15', name: 'Periodic review', automated: true, required: ['reviewPeriodDays', P.max], optional: [], explain: 'Every review period, order up to the maximum. Between reviews nothing is ordered.' },
    RP16: { code: 'RP16', name: 'Order-up-to', automated: true, required: [P.max], optional: [P.rop], explain: 'Whenever projected stock is below the reorder point (or the maximum), order up to the maximum.' },
    RP17: { code: 'RP17', name: 'Forecast-driven', automated: true, required: ['forecastMonthlyDemand'], optional: ['coverageDays', P.safety], explain: 'Forecast monthly demand sets a reorder level (daily forecast × lead time + safety) and a target (reorder level + daily forecast × coverage days).' },
    RP18: { code: 'RP18', name: 'Non-stock', automated: false, required: [], optional: [], explain: 'Not held in stock; never replenished automatically.' },
};
export const AUTOMATED_METHODS = Object.values(METHODS).filter((m) => m.automated).map((m) => m.code);

/** Labels and help for every parameter (also used by the material screen). */
export const PARAMS: Record<keyof Params, { label: string; hint: string }> = {
    minimumLevel: { label: 'Minimum level', hint: 'Lowest projected stock before replenishing.' },
    maximumLevel: { label: 'Maximum level', hint: 'Stock level to replenish up to.' },
    reorderPoint: { label: 'Reorder point', hint: 'Projected stock that triggers replenishment.' },
    reorderQuantity: { label: 'Reorder quantity', hint: 'Quantity ordered each time the reorder point is reached.' },
    safetyStock: { label: 'Safety stock', hint: 'Protective buffer; at or below it the request is high urgency.' },
    minimumOrderQuantity: { label: 'Minimum order quantity', hint: 'Set in Procurement Information.' },
    orderMultiple: { label: 'Order multiple', hint: 'Set in Procurement Information.' },
    leadTimeDays: { label: 'Lead time (days)', hint: 'Days from order to receipt.' },
    unitPrice: { label: 'Unit price', hint: 'Set in Procurement Information.' },
    annualDemand: { label: 'Annual demand', hint: 'Units used per year. Leave empty to derive it from consumption.' },
    orderCost: { label: 'Cost per order', hint: 'Cost of placing and receiving one order, in the price currency.' },
    holdingCostRate: { label: 'Holding cost (% per year)', hint: 'Yearly cost of holding one unit, as a percentage of its unit price.' },
    demandLookbackDays: { label: 'Usage look-back (days)', hint: 'Days of consumption history used for average usage (default 90).' },
    coverageDays: { label: 'Coverage (days)', hint: 'Days of usage each order should cover beyond the lead time (default 30).' },
    emergencyLevel: { label: 'Emergency level', hint: 'Quantity that must always be available for emergencies.' },
    strategicLevel: { label: 'Strategic buffer level', hint: 'Quantity held for business continuity or supply security.' },
    seasonalFactors: { label: 'Seasonal factors (Jan-Dec)', hint: '12 comma-separated factors, e.g. 1,1,1.2,1.5,… (1 = normal).' },
    rotablesInRepair: { label: 'Units out for repair', hint: 'Repairable units expected back; counted as supply.' },
    binQuantity: { label: 'Bin quantity', hint: 'Quantity held in one bin.' },
    kanbanCardQuantity: { label: 'Quantity per kanban card', hint: 'Quantity replenished per card.' },
    kanbanCards: { label: 'Number of kanban cards', hint: 'Cards in circulation; the maximum is cards × quantity per card.' },
    reviewPeriodDays: { label: 'Review period (days)', hint: 'Days between periodic reviews.' },
    forecastMonthlyDemand: { label: 'Forecast monthly demand', hint: 'Expected usage per month.' },
};

/** Legacy stocking policies map onto the strategies. */
export function methodOf(strategy: unknown, legacyPolicy: unknown): string {
    const s = String(strategy ?? '').trim().toUpperCase();
    if (METHODS[s]) return s;
    const legacy = String(legacyPolicy ?? '').trim().toUpperCase();
    if (METHODS[legacy]) return legacy;
    return ({ MINMAX: 'RP01', REORDER: 'RP02', JIT: 'RP04', NONSTOCK: 'RP18', ONDEMAND: 'RP07' } as Record<string, string>)[legacy] ?? '';
}

export function numberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}
export function factorsOf(v: unknown): number[] | null {
    if (v === null || v === undefined || v === '') return null;
    const parts = (Array.isArray(v) ? v : String(v).split(/[,;\s]+/)).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    return parts.length === 12 && parts.every((x) => x >= 0 && x <= 10) ? parts : null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pos = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? v : null);
const set = (v: number | null | undefined) => v !== null && v !== undefined && Number.isFinite(v) && v >= 0;

export function plan(method: string, p: Params, s: Situation): PlanResult {
    const def = METHODS[method];
    if (!def) return { kind: 'not_planned', reason: 'No replenishment strategy is set for this material and warehouse.' };
    if (!def.automated) return { kind: 'not_planned', reason: `${def.code} ${def.name}: ${def.explain}` };
    const missing = def.required.filter((k) => (k === 'seasonalFactors' ? !p.seasonalFactors : !set(p[k] as number | null)));
    if (missing.length) return { kind: 'incomplete', reason: `${def.code} ${def.name} needs ${missing.map((k) => PARAMS[k].label.toLowerCase()).join(', ')}.` };

    const supply = Math.max(0, s.openSupply) + (method === 'RP09' ? Math.max(0, p.rotablesInRepair ?? 0) : 0);
    const projected = r3(s.available + supply);
    const lead = Math.max(0, p.leadTimeDays);
    const safety = set(p.safetyStock) ? p.safetyStock! : 0;
    const daily = s.consumedDays > 0 ? Math.max(0, s.consumed) / s.consumedDays : 0;
    let trigger = 0;
    let target: number | null = null;
    let quantity = 0;
    let basis = '';
    let urgency: Urgency | null = null;
    const noNeed = (why: string): PlanResult => ({ kind: 'no_need', projected, trigger, reason: why });
    const upTo = (t: number, label: string) => {
        target = t;
        quantity = t - projected;
        basis = `${def.code} ${def.name}: projected ${projected} ≤ ${label} ${r3(trigger)}; order up to ${r3(t)}`;
    };

    switch (method) {
        case 'RP01':
        case 'RP09':
        case 'RP10': {
            const f = method === 'RP10' ? p.seasonalFactors![s.arrivalMonth] ?? 1 : 1;
            const min = p.minimumLevel! * f;
            const max = p.maximumLevel! * f;
            if (min > max) return { kind: 'incomplete', reason: 'The minimum level is above the maximum level.' };
            trigger = min;
            if (projected > trigger) return noNeed(`Projected stock ${projected} is above the minimum level ${r3(min)}${f !== 1 ? ` (seasonal factor ${f})` : ''}.`);
            upTo(max, f !== 1 ? `seasonal minimum (factor ${f})` : 'minimum');
            break;
        }
        case 'RP02':
        case 'RP03':
        case 'RP12': {
            trigger = method === 'RP12' ? (set(p.reorderPoint) ? p.reorderPoint! : p.minimumLevel!) : p.reorderPoint!;
            if (projected > trigger) return noNeed(`Projected stock ${projected} is above the ${method === 'RP12' && !set(p.reorderPoint) ? 'minimum level' : 'reorder point'} ${trigger}.`);
            let lot = method === 'RP03' ? null : pos(p.reorderQuantity);
            if (method === 'RP03') {
                const annual = pos(p.annualDemand) ?? (daily > 0 ? daily * 365 : null);
                const holding = pos(p.unitPrice) && pos(p.holdingCostRate) ? (p.unitPrice! * p.holdingCostRate!) / 100 : null;
                if (!annual) return { kind: 'incomplete', reason: 'Economic order quantity needs the annual demand, or consumption history to derive it.' };
                if (!holding) return { kind: 'incomplete', reason: 'Economic order quantity needs the unit price (Procurement Information) and the holding cost rate.' };
                lot = Math.sqrt((2 * annual * p.orderCost!) / holding);
                lot = Math.max(1, Math.round(lot * 1000) / 1000);
            }
            if (lot) {
                const times = Math.max(1, Math.floor((trigger - projected) / lot) + 1);
                quantity = lot * times;
                basis = `${def.code} ${def.name}: projected ${projected} ≤ ${method === 'RP12' && !set(p.reorderPoint) ? 'minimum' : 'reorder point'} ${trigger}; ${times} × ${method === 'RP03' ? `EOQ ${lot}` : `reorder quantity ${lot}`}`;
            } else if (pos(p.maximumLevel)) {
                upTo(p.maximumLevel!, method === 'RP12' && !set(p.reorderPoint) ? 'minimum' : 'reorder point');
            } else return { kind: 'incomplete', reason: `${def.code} ${def.name} needs a reorder quantity or a maximum level to order up to.` };
            break;
        }
        case 'RP04': {
            trigger = 0;
            if (projected >= 0) return noNeed('Reserved demand is covered by available stock and open supply.');
            quantity = -projected;
            basis = `${def.code} ${def.name}: reserved demand exceeds available stock and supply by ${r3(-projected)}`;
            urgency = 'high';
            break;
        }
        case 'RP05':
        case 'RP17': {
            const perDay = method === 'RP17' ? p.forecastMonthlyDemand! / 30.4 : daily;
            const cover = pos(p.coverageDays) ?? 30;
            trigger = r3(perDay * lead + safety);
            if (perDay <= 0 && projected > safety) return noNeed(method === 'RP05' ? `No consumption in the last ${s.consumedDays} days and stock is above safety stock.` : 'No forecast demand.');
            if (projected > trigger) return noNeed(`Projected stock ${projected} is above the ${method === 'RP05' ? 'demand-driven' : 'forecast'} reorder level ${trigger} (${r3(perDay)} per day × ${lead} days lead time + safety ${safety}).`);
            upTo(r3(trigger + perDay * cover), `reorder level (${r3(perDay)} per day)`);
            break;
        }
        case 'RP06': {
            trigger = safety;
            if (projected >= safety && projected >= 0) return noNeed(`Net requirement is zero: projected ${projected} covers safety stock ${safety}.`);
            quantity = safety - projected;
            basis = `${def.code} MRP: net requirement = safety stock ${safety} − projected ${projected}, lot for lot`;
            break;
        }
        case 'RP08':
        case 'RP11': {
            const level = method === 'RP08' ? pos(p.emergencyLevel) ?? pos(p.minimumLevel) ?? pos(p.maximumLevel) : pos(p.strategicLevel) ?? pos(p.maximumLevel);
            if (!level) return { kind: 'incomplete', reason: `${def.code} ${def.name} needs ${method === 'RP08' ? 'an emergency level' : 'a strategic buffer level'}.` };
            trigger = level;
            if (projected >= level) return noNeed(`Projected stock ${projected} covers the ${method === 'RP08' ? 'emergency' : 'strategic'} level ${level}.`);
            upTo(level, method === 'RP08' ? 'emergency level' : 'strategic level');
            if (method === 'RP08') urgency = 'high';
            break;
        }
        case 'RP13': {
            const bin = p.binQuantity!;
            trigger = bin;
            if (projected > bin) return noNeed(`The first bin is not empty: projected ${projected} is above one bin of ${bin}.`);
            const bins = projected <= 0 ? 2 : 1;
            quantity = bin * bins;
            target = bin * 2;
            basis = `${def.code} Two-bin: projected ${projected} ≤ one bin ${bin}; refill ${bins} bin${bins > 1 ? 's' : ''}`;
            break;
        }
        case 'RP14': {
            const card = p.kanbanCardQuantity!;
            const cards = Math.max(1, Math.trunc(p.kanbanCards!));
            target = card * cards;
            trigger = target - card;
            const empty = Math.min(cards, Math.floor((target - projected) / card));
            if (empty < 1) return noNeed(`No empty kanban card: projected ${projected} of ${target}.`);
            quantity = empty * card;
            basis = `${def.code} Kanban: ${empty} empty card${empty > 1 ? 's' : ''} × ${card}`;
            break;
        }
        case 'RP15': {
            const period = Math.max(1, Math.trunc(p.reviewPeriodDays!));
            if (s.daysSinceReview !== null && s.daysSinceReview < period) return { kind: 'not_due', reason: `Next periodic review in ${Math.ceil(period - s.daysSinceReview)} day(s).` };
            trigger = p.maximumLevel!;
            if (projected >= trigger) return noNeed(`Periodic review: projected ${projected} is at the maximum ${trigger}.`);
            upTo(p.maximumLevel!, 'review target');
            break;
        }
        case 'RP16': {
            trigger = set(p.reorderPoint) ? p.reorderPoint! : p.maximumLevel!;
            if (set(p.reorderPoint) ? projected > trigger : projected >= trigger) return noNeed(`Projected stock ${projected} is ${set(p.reorderPoint) ? `above the reorder point ${trigger}` : `at the maximum ${trigger}`}.`);
            upTo(p.maximumLevel!, set(p.reorderPoint) ? 'reorder point' : 'maximum');
            break;
        }
        default:
            return { kind: 'not_planned', reason: `${def.code} is not planned automatically.` };
    }

    const moq = pos(p.minimumOrderQuantity);
    if (moq && quantity < moq) {
        quantity = moq;
        basis += `; raised to the minimum order quantity ${moq}`;
    }
    const multiple = pos(p.orderMultiple);
    if (multiple) {
        const rounded = Math.ceil(r3(quantity / multiple)) * multiple;
        if (rounded !== quantity) basis += `; rounded up to a multiple of ${multiple}`;
        quantity = rounded;
    }
    quantity = r3(quantity);
    if (!(quantity > 0)) return { kind: 'no_need', projected, trigger, reason: 'Nothing to order after rounding.' };
    return { kind: 'order', projected, trigger: r3(trigger), target, quantity, urgency: urgency ?? (s.available <= 0 || s.available <= safety ? 'high' : 'medium'), basis };
}

// ----- Who acts on the quantity -----

export type Channel =
    | { kind: 'purchase'; note: string; urgent: boolean }
    | { kind: 'signal'; signal: string; label: string; action: string }
    | { kind: 'blocked'; reason: string };

export const SIGNALS: Record<string, { label: string; action: string }> = {
    supplier_managed: { label: 'Supplier-managed replenishment (VMI)', action: 'Notify the supplier to replenish under the vendor-managed inventory agreement.' },
    consignment_calloff: { label: 'Consignment call-off', action: 'Call off stock from the supplier consignment agreement; ownership transfers on withdrawal or consumption.' },
    customer_supply: { label: 'Customer-supplied material', action: 'Ask the customer to supply or replenish their material.' },
    supplier_held_release: { label: 'Release from supplier-held stock', action: 'Request delivery of company-owned stock held at the supplier.' },
    third_party_release: { label: 'Release from third-party warehouse', action: 'Request a release or transfer from the third-party / logistics warehouse.' },
    subcontract_supply: { label: 'Subcontract material provision', action: 'Arrange the components to be provided to (or returned by) the subcontractor.' },
    intercompany_transfer: { label: 'Intercompany transfer request', action: 'Request a transfer from the group entity that holds or owns the stock.' },
    loan_request: { label: 'Loan or borrowing request', action: 'Arrange the loan or return under the borrowing agreement.' },
    returnable_pool: { label: 'Returnable pool replenishment', action: 'Request returnable packaging from the pool or deposit arrangement.' },
    shared_pool: { label: 'Shared pool replenishment', action: 'Request replenishment from the collaborative shared pool.' },
    exchange_pool: { label: 'Exchange or repair pool', action: 'Request an exchange unit or repair turnaround from the pool.' },
    owner_agreement: { label: 'Owner agreement replenishment', action: 'Replenish under the joint-ownership or lease agreement.' },
};

/** Purchase requirement for company-owned standard buying; a signal to the right party otherwise; blocked when ownership is unresolved. */
export function routeFor(ownership: string, arrangement: string, method: string): Channel {
    const ow = ownership.toUpperCase();
    const sa = arrangement.toUpperCase();
    const signal = (key: string): Channel => ({ kind: 'signal', signal: key, label: SIGNALS[key].label, action: SIGNALS[key].action });
    if (ow === 'OW08') return { kind: 'blocked', reason: 'Ownership is unresolved (OW08): replenishment is blocked until title is evidenced.' };
    if (sa === 'SA12') return { kind: 'blocked', reason: 'Drop-shipped material (SA12) is not held in this warehouse, so it is not replenished to stock.' };
    if (method === 'RP12' || sa === 'SA03') return signal('supplier_managed');
    if (sa === 'SA02' || ow === 'OW02') return signal('consignment_calloff');
    if (sa === 'SA04' || sa === 'SA18' || ow === 'OW03') return signal('customer_supply');
    if (sa === 'SA05') return signal('supplier_held_release');
    if (sa === 'SA06' || ow === 'OW04') return signal('third_party_release');
    if (sa === 'SA07') return signal('subcontract_supply');
    if (sa === 'SA08' || ow === 'OW05') return signal('intercompany_transfer');
    if (sa === 'SA09') return signal('loan_request');
    if (sa === 'SA10') return signal('returnable_pool');
    if (sa === 'SA13') return signal('shared_pool');
    if (sa === 'SA17') return signal('exchange_pool');
    if (ow === 'OW06' || ow === 'OW07') return signal('owner_agreement');
    const note = sa === 'SA14' ? 'Framework call-off: order against the framework agreement.' : sa === 'SA15' ? 'Emergency procurement.' : sa === 'SA11' ? 'Project supply.' : sa === 'SA16' ? 'Direct procurement.' : '';
    return { kind: 'purchase', note, urgent: sa === 'SA15' };
}

// ----- Open supply -----

export const REQ_OPEN = ['pending_approval', 'returned_user', 'approved', 'acknowledged'];
export const PRQ_OPEN = ['draft', 'confirmed', 'returned', 'suspended'];
export const PO_OPEN = ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial'];

export function openQuantity(kind: 'req' | 'prq' | 'po', line: Record<string, unknown>): number {
    const q = numberOrNull(line.quantity) ?? 0;
    if (kind !== 'po') return Math.max(0, q);
    return Math.max(0, q - (numberOrNull(line.receivedQty) ?? 0));
}

/** Journal entry types that consume stock (for usage-based methods). Returns reduce consumption. */
export const CONSUMPTION_TYPES = ['GOODS_ISSUE', 'GI_WO', 'GI_CC', 'MAINTENANCE_RESERVATION_ISSUE', 'MATERIAL_ISSUE'];
export const RETURN_TYPES = ['MATERIAL_RETURN', 'GOODS_RETURN', 'WO_RETURN', 'RETURN_TO_STOCK', 'MAINTENANCE_RETURN'];
