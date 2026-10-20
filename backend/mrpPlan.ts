/**
 * MRP planning arithmetic for one material in one warehouse. Pure: no reads, no writes.
 *
 *   projected = available stock (physical − reserved − quarantined − damaged − expired)
 *             + open supply (purchase requirements in process, requisitions, purchase orders not yet delivered)
 *
 *   MINMAX   when projected ≤ minimum level           order up to the maximum level:  max − projected
 *   REORDER  when projected ≤ reorder point           order the reorder quantity (as many times as needed to rise above
 *                                                      the reorder point); without one, order up to the maximum level
 *
 * The quantity is then raised to the minimum order quantity and rounded up to the order multiple.
 * Urgency: high when available stock is at or below safety stock (or nothing is left), otherwise medium.
 */

export type Policy = 'MINMAX' | 'REORDER';
export const MRP_POLICIES: Policy[] = ['MINMAX', 'REORDER'];

export interface PlanInput {
    policy: string;
    available: number;
    openSupply: number;
    minimumLevel: number | null;
    maximumLevel: number | null;
    reorderPoint: number | null;
    reorderQuantity: number | null;
    safetyStock: number | null;
    minimumOrderQuantity: number | null;
    orderMultiple: number | null;
}
export type PlanResult =
    | { kind: 'not_planned'; reason: string }
    | { kind: 'incomplete'; reason: string }
    | { kind: 'no_need'; projected: number; trigger: number; reason: string }
    | { kind: 'order'; projected: number; trigger: number; target: number | null; quantity: number; urgency: 'high' | 'medium'; basis: string };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pos = (v: number | null) => (v !== null && Number.isFinite(v) && v > 0 ? v : null);
const set = (v: number | null) => v !== null && Number.isFinite(v) && v >= 0;

export function numberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

export function plan(i: PlanInput): PlanResult {
    const policy = String(i.policy || '').toUpperCase();
    if (!MRP_POLICIES.includes(policy as Policy)) return { kind: 'not_planned', reason: `Stocking policy ${policy || 'not set'} is not planned by MRP (only Min/max and Reorder point).` };
    const projected = r3(i.available + Math.max(0, i.openSupply));
    let trigger: number;
    let target: number | null = null;
    let quantity: number;
    let basis: string;
    if (policy === 'MINMAX') {
        if (!set(i.minimumLevel) || !pos(i.maximumLevel)) return { kind: 'incomplete', reason: 'Min/max replenishment needs a minimum level and a maximum level above zero.' };
        if (i.minimumLevel! > i.maximumLevel!) return { kind: 'incomplete', reason: 'The minimum level is above the maximum level.' };
        trigger = i.minimumLevel!;
        target = i.maximumLevel!;
        if (projected > trigger) return { kind: 'no_need', projected, trigger, reason: `Projected stock ${projected} is above the minimum level ${trigger}.` };
        quantity = target - projected;
        basis = `Min/max: projected ${projected} ≤ minimum ${trigger}; order up to maximum ${target}`;
    } else {
        if (!set(i.reorderPoint)) return { kind: 'incomplete', reason: 'Reorder point replenishment needs a reorder point.' };
        trigger = i.reorderPoint!;
        const roq = pos(i.reorderQuantity);
        const max = pos(i.maximumLevel);
        if (!roq && !max) return { kind: 'incomplete', reason: 'Reorder point replenishment needs a reorder quantity (or a maximum level to order up to).' };
        if (projected > trigger) return { kind: 'no_need', projected, trigger, reason: `Projected stock ${projected} is above the reorder point ${trigger}.` };
        if (roq) {
            const times = Math.max(1, Math.floor((trigger - projected) / roq) + 1);
            quantity = roq * times;
            basis = `Reorder point: projected ${projected} ≤ reorder point ${trigger}; ${times} × reorder quantity ${roq}`;
        } else {
            target = max!;
            quantity = max! - projected;
            basis = `Reorder point: projected ${projected} ≤ reorder point ${trigger}; order up to maximum ${max}`;
        }
    }
    const moq = pos(i.minimumOrderQuantity);
    if (moq && quantity < moq) {
        quantity = moq;
        basis += `; raised to the minimum order quantity ${moq}`;
    }
    const multiple = pos(i.orderMultiple);
    if (multiple) {
        const rounded = Math.ceil(r3(quantity / multiple)) * multiple;
        if (rounded !== quantity) basis += `; rounded up to a multiple of ${multiple}`;
        quantity = rounded;
    }
    quantity = r3(quantity);
    if (!(quantity > 0)) return { kind: 'no_need', projected, trigger, reason: 'Nothing to order after rounding.' };
    const safety = set(i.safetyStock) ? i.safetyStock! : 0;
    const urgency = i.available <= 0 || i.available <= safety ? 'high' : 'medium';
    return { kind: 'order', projected, trigger, target, quantity, urgency, basis };
}

/** Lines of purchasing documents that are still supply for a material in a warehouse. */
export const REQ_OPEN = ['pending_approval', 'returned_user', 'approved', 'acknowledged'];
export const PRQ_OPEN = ['draft', 'confirmed', 'returned', 'suspended'];
export const PO_OPEN = ['draft', 'validated', 'pending_approval', 'open', 'sent', 'partial'];

export function openQuantity(kind: 'req' | 'prq' | 'po', line: Record<string, unknown>): number {
    const q = numberOrNull(line.quantity) ?? 0;
    if (kind !== 'po') return Math.max(0, q);
    return Math.max(0, q - (numberOrNull(line.receivedQty) ?? 0));
}
