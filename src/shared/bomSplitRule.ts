// Whether a BOM line may be consumed in fractions. Each BOM line carries its own rule (set and approved with the BOM):
//   SPLIT  any quantity can be issued (kilograms, litres, metres …)
//   WHOLE  only whole units, or whole packs of `packSize` units (pieces, bags, drums, a 25 kg sack …)
// Metered utilities are always divisible. A line saved before the rule existed is read with the suggestion below.

export type SplitRule = 'SPLIT' | 'WHOLE';

/** Units that normally cannot be split: the starting suggestion on a new BOM line, never a hidden override. */
export const WHOLE_UNIT_SUGGESTIONS: readonly string[] = ['EA', 'PC', 'PCS', 'UNIT', 'UNITS', 'NO', 'NOS', 'BOX', 'CTN', 'CARTON', 'CASE', 'PACK', 'PKT', 'BAG', 'SACK', 'ROLL', 'REEL', 'SET', 'PAIR', 'BTL', 'BOTTLE', 'CAN', 'TIN', 'DRUM', 'PAIL', 'JERRYCAN', 'PALLET', 'SHEET', 'TRAY', 'CYL', 'CYLINDER'];

/** Count units of the unit registry (each, dozen, pair …). */
const COUNT_UNIT = /^UOM-20-\d{3}$/;
export const suggestedSplitRule = (uom: unknown): SplitRule => {
    const u = String(uom ?? '').trim().toUpperCase();
    return COUNT_UNIT.test(u) || WHOLE_UNIT_SUGGESTIONS.includes(u) ? 'WHOLE' : 'SPLIT';
};

export interface SplitLine { source?: string; processSupplyKind?: string; uom?: string; splitRule?: unknown; packSize?: unknown }

/** A metered utility line (always divisible). */
export const isUtilityLine = (c: SplitLine) => c.source === 'PROCESS_SUPPLY' && c.processSupplyKind !== 'SKU' && c.processSupplyKind !== 'PROCUREMENT';

/** The rule a line is planned with, and whether it was set on the BOM or only suggested from the unit. */
export function lineSplit(c: SplitLine): { rule: SplitRule; packSize: number; explicit: boolean } {
    if (isUtilityLine(c)) return { rule: 'SPLIT', packSize: 1, explicit: true };
    if (c.splitRule === 'WHOLE' || c.splitRule === 'SPLIT') {
        const pack = Number(c.packSize);
        return { rule: c.splitRule, packSize: c.splitRule === 'WHOLE' && pack > 0 ? pack : 1, explicit: true };
    }
    return { rule: suggestedSplitRule(c.uom), packSize: 1, explicit: false };
}

/** Short label for lists and approvals. */
export const splitLabel = (c: SplitLine, unitName = c.uom ?? '') => {
    const s = lineSplit(c);
    if (isUtilityLine(c)) return 'Metered · can be split';
    const base = s.rule === 'WHOLE' ? (s.packSize !== 1 ? `Cannot be split · packs of ${s.packSize} ${unitName}`.trim() : 'Cannot be split') : 'Can be split';
    return s.explicit ? base : `${base} (from unit, not set)`;
};
