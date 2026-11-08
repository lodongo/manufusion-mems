/**
 * Taxes, freight and other overheads on a quote, carried to the requisition and the purchase order. Shared by the
 * server and the screens. Each overhead is either a fixed amount or a percentage of the goods total after discounts,
 * in the quote currency. The total of a quote (and the amount the chart of authority approves) is:
 *     goods after discounts + every overhead
 * VAT cannot be added on top when the quote says its prices already include VAT.
 */

export type ChargeKind = 'tax' | 'charge';
export const CHARGE_TYPES: Array<{ code: string; label: string; kind: ChargeKind }> = [
    { code: 'VAT', label: 'VAT', kind: 'tax' },
    { code: 'EXCISE', label: 'Excise duty', kind: 'tax' },
    { code: 'IMPORT_DUTY', label: 'Import duty', kind: 'tax' },
    { code: 'IDF', label: 'Import declaration fee', kind: 'tax' },
    { code: 'RDL', label: 'Railway development levy', kind: 'tax' },
    { code: 'OTHER_TAX', label: 'Other tax or levy', kind: 'tax' },
    { code: 'FREIGHT', label: 'Freight', kind: 'charge' },
    { code: 'INSURANCE', label: 'Insurance', kind: 'charge' },
    { code: 'CLEARING', label: 'Clearing and forwarding', kind: 'charge' },
    { code: 'PORT', label: 'Port and handling', kind: 'charge' },
    { code: 'PACKAGING', label: 'Packaging', kind: 'charge' },
    { code: 'INSTALLATION', label: 'Installation and commissioning', kind: 'charge' },
    { code: 'OTHER_CHARGE', label: 'Other charge', kind: 'charge' },
];

export interface Charge {
    code: string;
    label: string;
    kind: ChargeKind;
    basis: 'amount' | 'percent';
    value: number;
    amount: number;
    note: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Validates the overheads of a quote against its goods total (throws an Error with the message to show). */
export function readCharges(raw: unknown, goods: number, vatIncluded: boolean | null): Charge[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error('Taxes and charges must be a list.');
    if (raw.length > 15) throw new Error('At most 15 taxes and charges.');
    const out = raw.map((x, i) => {
        const v = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        const type = CHARGE_TYPES.find((t) => t.code === String(v.code ?? ''));
        if (!type) throw new Error(`Tax or charge ${i + 1}: choose its type.`);
        const basis = String(v.basis ?? 'amount') === 'percent' ? 'percent' : 'amount';
        const value = Number(v.value);
        if (!Number.isFinite(value) || value <= 0 || (basis === 'percent' ? value > 100 : value > 1e12)) throw new Error(`${type.label}: enter ${basis === 'percent' ? 'a percentage above 0 and up to 100' : 'an amount above 0'}.`);
        if (type.code === 'VAT' && vatIncluded === true) throw new Error('The prices already include VAT, so VAT cannot be added again.');
        const note = String(v.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (type.code.startsWith('OTHER') && note.length < 3) throw new Error(`${type.label}: say what it is.`);
        return { code: type.code, label: type.code.startsWith('OTHER') && note ? note : type.label, kind: type.kind, basis, value: r2(value), amount: r2(basis === 'percent' ? (goods * value) / 100 : value), note } as Charge;
    });
    const codes = out.filter((c) => !c.code.startsWith('OTHER')).map((c) => c.code);
    if (new Set(codes).size !== codes.length) throw new Error('Each tax or charge type can be entered once (use "Other" for more).');
    return out;
}

/**
 * The overheads again on a new goods total: percentages follow the goods. Fixed amounts are the quoted value times
 * `share` when a share is given (a quote split over several requisitions), otherwise they keep their current amount.
 */
export function rescaleCharges(charges: Charge[], goods: number, share?: number): Charge[] {
    return charges.map((c) => ({ ...c, amount: r2(c.basis === 'percent' ? (goods * c.value) / 100 : share === undefined ? Number(c.amount) || 0 : c.value * share) }));
}

export const chargesTotal = (charges: Array<{ amount?: unknown }>) => r2(charges.reduce((s, c) => s + (Number(c.amount) || 0), 0));
export const taxesTotal = (charges: Array<{ amount?: unknown; kind?: unknown }>) => r2(charges.filter((c) => c.kind === 'tax').reduce((s, c) => s + (Number(c.amount) || 0), 0));
