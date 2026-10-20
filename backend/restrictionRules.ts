// ---------------------------------------------------------------------------
// Warehouse restriction rules shared by the server and the screens (pure: no I/O).
//
// One master decides where stock may be placed: Procurement metadata → warehouseRestrictions (RS01 …).
//   Material    material master default (registration) → per-warehouse Stock Control override
//   Warehouse   every storage location carries one restriction; its clusters and bins inherit it
// A material can be put in a bin only when both sides are set and carry the same, enabled code.
// The older material classification list (MCL-…) only suggests a restriction while locations are aligned.
// ---------------------------------------------------------------------------

/** Colours for the topology map, used unless MEMS administration gives a code its own colour. */
export const RESTRICTION_COLORS: Record<string, string> = {
    RS01: '#0EA5E9', RS02: '#DC2626', RS03: '#7C3AED', RS04: '#14B8A6', RS05: '#38BDF8',
    RS06: '#1D4ED8', RS07: '#0891B2', RS08: '#EA580C', RS09: '#A16207', RS10: '#CA8A04',
    RS11: '#16A34A', RS12: '#BE185D', RS13: '#475569', RS14: '#65A30D', RS15: '#64748B',
};
/** The generic colour shipped on every stock master entry: treated as "no colour chosen". */
export const GENERIC_MASTER_COLOR = '#2563EB';

/** Restrictions whose clusters must hold a single subcategory (segregated storage). */
export const SEGREGATED_RESTRICTIONS = new Set(['RS02', 'RS08', 'RS12', 'RS14']);

/** Suggested restriction for a storage location still carrying an old material classification. Suggestion only: a person confirms it. */
export const MCL_TO_RESTRICTION: Record<string, string> = {
    'MCL-001': 'RS15', 'MCL-002': 'RS02', 'MCL-003': 'RS08', 'MCL-004': 'RS14', 'MCL-005': 'RS15', 'MCL-006': 'RS03',
    'MCL-007': 'RS03', 'MCL-008': 'RS15', 'MCL-009': 'RS01', 'MCL-010': 'RS10', 'MCL-011': 'RS03', 'MCL-012': 'RS15',
    'MCL-013': 'RS15', 'MCL-014': 'RS14', 'MCL-015': 'RS13', 'MCL-016': 'RS15',
};

export const RESTRICTION_RE = /^RS[0-9]{2}$/;

export function restrictionColor(code: string, stored?: string): string {
    const own = String(stored || '');
    if (/^#[0-9a-fA-F]{6}$/.test(own) && own.toUpperCase() !== GENERIC_MASTER_COLOR) return own;
    return RESTRICTION_COLORS[code] || '#64748B';
}

/** Restriction that applies to a material in one warehouse: the Stock Control value, else the material master default. */
export function effectiveRestriction(warehouseInfo: Record<string, unknown> | null | undefined, material: Record<string, unknown> | null | undefined): string {
    const own = String(warehouseInfo?.warehouseRestriction ?? '').trim();
    if (own) return own;
    return String(material?.warehouseRestriction ?? '').trim();
}

export interface RestrictionEntry { code: string; label: string; active: boolean }

/**
 * Decide whether a material may be placed in a bin. Returns '' when allowed, otherwise the reason.
 * Both sides must be set, known to the master, enabled, and identical.
 */
/** Location side only: '' when the storage location carries an enabled restriction from the master. */
export function locationBlock(binCode: string, master: RestrictionEntry[], locationLabel = 'this storage location'): string {
    if (!binCode) return `The warehouse restriction of ${locationLabel} is not set. Align the storage location to the warehouse restriction master (Organization design → warehouse → Edit) before binning.`;
    const bin = master.find((m) => m.code === binCode);
    if (!bin) return `${locationLabel} uses restriction ${binCode}, which is not in the warehouse restriction master. Align the storage location before binning.`;
    if (!bin.active) return `${bin.label} (${bin.code}) is disabled in the warehouse restriction master. Align ${locationLabel} to an enabled restriction before binning.`;
    return '';
}

export function binningBlock(materialCode: string, binCode: string, master: RestrictionEntry[], locationLabel = 'this storage location'): string {
    const byCode = new Map(master.map((m) => [m.code, m]));
    const side = locationBlock(binCode, master, locationLabel);
    if (side) return side;
    const bin = byCode.get(binCode)!;
    if (!materialCode) return 'This material has no warehouse restriction for this warehouse. Set it in Stock Control (or on the material master) before binning.';
    const mat = byCode.get(materialCode);
    if (!mat) return `The material restriction ${materialCode} is not in the warehouse restriction master. Choose an enabled restriction in Stock Control.`;
    if (!mat.active) return `The material restriction ${mat.label} (${mat.code}) is disabled. Choose an enabled restriction in Stock Control.`;
    if (mat.code !== bin.code) return `Restriction mismatch: the material requires ${mat.label} (${mat.code}) but ${locationLabel} is ${bin.label} (${bin.code}).`;
    return '';
}
