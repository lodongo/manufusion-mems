// ---------------------------------------------------------------------------
// Material criticality analysis (pure: no database access, so it is tested directly).
//
// Each material is placed on a 4 × 4 grid per warehouse:
//   - Criticality class A to D (A very critical, D non-critical) from an assessment of consequence and supply-risk
//     factors, each rated 1 (insignificant), 2 (moderately significant) or 3 (very significant).
//   - Movement 1 to 4 (1 very slow, 4 very fast) from how regularly the material is actually issued.
//
// The approach follows the usual reliability and spares practice: consequence-of-failure categories (health and safety,
// food safety, environment, compliance, production, quality) as in NORSOK Z-008 and ISO 14224's consequence
// classification, combined with supply-risk factors used in spare-parts criticality (lead time, sole source,
// substitutes, repairability, obsolescence) and ISO 31000 style scaled ratings. Two safeguards from that practice:
//   - High-consequence override: a very significant rating on personal safety, food safety, environment or legal
//     compliance makes the material class A whatever the other factors say (setup can switch this off).
//   - Movement uses the spread of issues over months, not the quantity alone, so a single large issue does not make a
//     material "fast moving" (a material is fast moving because it is needed regularly).
//
// Score: sum of weight × rating over the factors declared in setup. Minimum = sum of weights (all rated 1), maximum =
// 3 × sum of weights. The score is scaled linearly to 1–4 and rounded: 4 → A, 3 → B, 2 → C, 1 → D.
// ---------------------------------------------------------------------------

export type Rating = 1 | 2 | 3;
export type ClassLetter = 'A' | 'B' | 'C' | 'D';

export interface Factor {
    code: string;
    group: 'Safety and compliance' | 'Operations' | 'Supply' | 'Business';
    name: string;
    question: string;
    levels: [string, string, string];
    /** A rating of 3 on these may force class A (high-consequence override). */
    hse?: boolean;
    /** Declared for use in a new setup. */
    defaultOn?: boolean;
}

export const FACTORS: Factor[] = [
    { code: 'SAF', group: 'Safety and compliance', name: 'Personal safety', question: 'If this material is missing or fails, could people be hurt?', levels: ['No credible injury', 'Minor injury or first aid', 'Serious injury or fatality possible'], hse: true, defaultOn: true },
    { code: 'FSQ', group: 'Safety and compliance', name: 'Food safety', question: 'Could its absence or failure affect food safety or product integrity?', levels: ['No food or product contact effect', 'Quality deviation, product can be held or reworked', 'Food safety hazard, contamination or recall'], hse: true, defaultOn: true },
    { code: 'ENV', group: 'Safety and compliance', name: 'Environment', question: 'Could its absence or failure harm the environment?', levels: ['No environmental effect', 'Contained spill or emission, handled internally', 'Reportable release or permit breach'], hse: true, defaultOn: true },
    { code: 'REG', group: 'Safety and compliance', name: 'Legal and regulatory compliance', question: 'Is it needed to stay compliant (statutory equipment, licences, inspections)?', levels: ['No legal obligation', 'Compliance at risk if prolonged', 'Immediate breach of a legal or licence requirement'], hse: true, defaultOn: true },
    { code: 'PRD', group: 'Operations', name: 'Production impact', question: 'What happens to production if the equipment fails and this material is not available?', levels: ['No effect on output', 'Reduced rate, quality or efficiency', 'Equipment or line stops'], defaultOn: true },
    { code: 'RED', group: 'Operations', name: 'Redundancy', question: 'Is there a standby unit, bypass or workaround?', levels: ['Installed standby or full redundancy', 'Partial or manual workaround', 'No redundancy or workaround'], defaultOn: true },
    { code: 'MTR', group: 'Operations', name: 'Restoration time without stock', question: 'How long would the equipment be down if the material had to be bought after the failure?', levels: ['Less than one shift', 'One shift to three days', 'More than three days'], defaultOn: true },
    { code: 'PRE', group: 'Operations', name: 'Failure predictability', question: 'Can the failure be seen coming (condition monitoring, wear, inspection)?', levels: ['Predictable well in advance', 'Partly predictable', 'Sudden or random failure'], defaultOn: true },
    { code: 'DTC', group: 'Operations', name: 'Cost of downtime', question: 'How costly is the downtime or lost output it would cause?', levels: ['Low', 'Moderate', 'High'] },
    { code: 'FRQ', group: 'Operations', name: 'Failure likelihood', question: 'How often does the part fail or wear out on the equipment?', levels: ['Rarely (over five years)', 'Occasionally (one to five years)', 'Often (within a year)'] },
    { code: 'COM', group: 'Operations', name: 'Commonality', question: 'How many installed assets depend on this material?', levels: ['One asset', 'A few assets (two to five)', 'Many assets or plant-wide'] },
    { code: 'QLT', group: 'Business', name: 'Product quality and customer', question: 'Could the failure affect product quality or customer delivery?', levels: ['No effect', 'Rework or minor complaint', 'Customer rejection, penalty or lost order'] },
    { code: 'RPT', group: 'Business', name: 'Reputation', question: 'Could the consequence become public or damage the brand?', levels: ['No exposure', 'Local or internal attention', 'Public or brand damage'] },
    { code: 'SUP', group: 'Supply', name: 'Supplier options', question: 'How many qualified suppliers can provide it?', levels: ['Several qualified suppliers', 'Two or a limited number', 'Single or sole source'], defaultOn: true },
    { code: 'LDT', group: 'Supply', name: 'Procurement lead time', question: 'How long does it take to receive after ordering?', levels: ['A week or less', 'One to six weeks', 'More than six weeks'], defaultOn: true },
    { code: 'LOC', group: 'Supply', name: 'Local availability', question: 'Can it be bought locally?', levels: ['Readily available locally', 'Limited or regional stock', 'Imported only'] },
    { code: 'SUB', group: 'Supply', name: 'Substitutes', question: 'Is there an approved alternative or interchangeable part?', levels: ['Approved alternatives exist', 'Alternative needs engineering approval', 'No substitute'], defaultOn: true },
    { code: 'CUS', group: 'Supply', name: 'Standard or custom', question: 'Is it a standard catalogue item?', levels: ['Standard catalogue item', 'OEM part preferred', 'Made to order or OEM only'], defaultOn: true },
    { code: 'REP', group: 'Supply', name: 'Repairability', question: 'Can a failed unit be repaired and returned to service?', levels: ['Repaired quickly in-house', 'Repairable externally', 'Not repairable'] },
    { code: 'OBS', group: 'Supply', name: 'Obsolescence', question: 'Is the part still manufactured and supported?', levels: ['Current product', 'End of life announced', 'Obsolete or discontinued'] },
    { code: 'EMG', group: 'Supply', name: 'Emergency purchase', question: 'Could it be obtained urgently if needed?', levels: ['Same day', 'Within a week at a premium', 'Cannot be expedited'] },
];
export const FACTOR_BY_CODE = new Map(FACTORS.map((f) => [f.code, f]));

export const CLASSES: ClassLetter[] = ['A', 'B', 'C', 'D'];
/** A = 4 … D = 1. */
export const classRank = (c: string) => ({ A: 4, B: 3, C: 2, D: 1 } as Record<string, number>)[c] ?? 0;
const classOfLevel = (n: number): ClassLetter => (['D', 'C', 'B', 'A'] as ClassLetter[])[Math.min(4, Math.max(1, n)) - 1];

export interface FactorSetting {
    enabled: boolean;
    weight: 1 | 2 | 3;
}

export interface CriticalitySetup {
    factors: Record<string, FactorSetting>;
    /** A rating of 3 on a safety, food safety, environment or compliance factor makes the material class A. */
    hseOverride: boolean;
    /** Manual: the planner chooses the procurement strategy. Criticality: materials at or below the cutoff are bought on demand. */
    strategyMode: 'manual' | 'criticality';
    /** Grid cell such as C2: materials whose class and movement are both at or below it are bought on demand. */
    cutoff: string;
    /** Movement: issue history needed to calculate it, and months with issues per year needed for levels 4, 3 and 2. */
    minHistoryMonths: number;
    thresholds: { m4: number; m3: number; m2: number };
    /** Months after approval before an assessment is due for review. */
    reviewMonths: number;
}

export const ON_DEMAND_STRATEGY = 'RP07';

export function defaultSetup(): CriticalitySetup {
    return {
        factors: Object.fromEntries(FACTORS.map((f) => [f.code, { enabled: !!f.defaultOn, weight: 1 as const }])),
        hseOverride: true,
        strategyMode: 'manual',
        cutoff: 'C2',
        minHistoryMonths: 6,
        thresholds: { m4: 10, m3: 6, m2: 3 },
        reviewMonths: 12,
    };
}

const CELL_RE = /^[ABCD][1-4]$/;
export const isCell = (v: unknown): v is string => typeof v === 'string' && CELL_RE.test(v);

/** Validates and normalizes a setup; throws an Error with a readable message. */
export function readSetup(v: unknown): CriticalitySetup {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>;
    const base = defaultSetup();
    const factors: Record<string, FactorSetting> = {};
    for (const f of FACTORS) {
        const s = o.factors && typeof o.factors === 'object' ? o.factors[f.code] : undefined;
        const weight = Number(s?.weight ?? 1);
        if (![1, 2, 3].includes(weight)) throw new Error(`Weight of ${f.name} must be 1, 2 or 3`);
        factors[f.code] = { enabled: s ? s.enabled === true : base.factors[f.code].enabled, weight: weight as 1 | 2 | 3 };
    }
    const enabled = Object.values(factors).filter((x) => x.enabled).length;
    if (enabled < 3) throw new Error('Declare at least three criticality factors');
    const mode = String(o.strategyMode ?? 'manual');
    if (!['manual', 'criticality'].includes(mode)) throw new Error('Choose how the procurement strategy is set');
    const cutoff = String(o.cutoff ?? base.cutoff).toUpperCase();
    if (!isCell(cutoff)) throw new Error('Choose a cutoff cell, for example C2');
    const whole = (x: unknown, label: string, min: number, max: number) => {
        const n = Number(x);
        if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
        return n;
    };
    const t = o.thresholds && typeof o.thresholds === 'object' ? o.thresholds : base.thresholds;
    const m4 = whole(t.m4, 'Months with issues for very fast moving', 1, 12);
    const m3 = whole(t.m3, 'Months with issues for fast moving', 1, 12);
    const m2 = whole(t.m2, 'Months with issues for slow moving', 1, 12);
    if (!(m4 > m3 && m3 > m2)) throw new Error('Movement thresholds must decrease: very fast > fast > slow');
    return {
        factors,
        hseOverride: o.hseOverride !== false,
        strategyMode: mode as CriticalitySetup['strategyMode'],
        cutoff,
        minHistoryMonths: whole(o.minHistoryMonths ?? 6, 'Minimum issue history (months)', 6, 24),
        thresholds: { m4, m3, m2 },
        reviewMonths: whole(o.reviewMonths ?? 12, 'Review interval (months)', 3, 60),
    };
}

/** Criticality from the ratings of the factors declared in setup. */
export function scoreCriticality(setup: CriticalitySetup, ratings: Record<string, number>) {
    const used = FACTORS.filter((f) => setup.factors[f.code]?.enabled);
    const missing = used.filter((f) => ![1, 2, 3].includes(Number(ratings[f.code]))).map((f) => f.name);
    let score = 0;
    let min = 0;
    let max = 0;
    for (const f of used) {
        const w = setup.factors[f.code].weight;
        min += w;
        max += 3 * w;
        score += w * (Number(ratings[f.code]) || 1);
    }
    const scaled = max > min ? 1 + (3 * (score - min)) / (max - min) : 1;
    const level = Math.min(4, Math.max(1, Math.round(scaled)));
    const overrideBy = setup.hseOverride ? used.filter((f) => f.hse && Number(ratings[f.code]) === 3).map((f) => f.name) : [];
    const cls: ClassLetter = overrideBy.length ? 'A' : classOfLevel(level);
    return { complete: missing.length === 0, missing, score, min, max, scaled: Math.round(scaled * 100) / 100, level, criticalityClass: cls, overrideBy };
}

/** Monthly consumption over the last twelve months, oldest first, and how much issue history exists. */
export interface MovementData {
    months: Array<{ month: string; quantity: number }>;
    historyMonths: number;
}

/**
 * Movement 1–4 from how many months (per year) the material was issued in. With less than the minimum history the
 * movement has to be chosen by hand.
 */
export function movementFromData(setup: CriticalitySetup, d: MovementData) {
    const covered = Math.min(12, Math.max(0, Math.floor(d.historyMonths)));
    const recent = d.months.slice(-Math.max(covered, 0));
    const issued = recent.filter((m) => m.quantity > 0).length;
    const total = recent.reduce((n, m) => n + Math.max(0, m.quantity), 0);
    const perYear = covered > 0 ? Math.round(((issued * 12) / covered) * 10) / 10 : 0;
    const annualQuantity = covered > 0 ? Math.round(((total * 12) / covered) * 1000) / 1000 : 0;
    const enough = d.historyMonths >= setup.minHistoryMonths;
    const t = setup.thresholds;
    const level = !enough ? null : perYear >= t.m4 ? 4 : perYear >= t.m3 ? 3 : perYear >= t.m2 ? 2 : 1;
    // Share of the year's quantity issued in the busiest month: near 1 means one-off buying, not regular use.
    const busiest = recent.reduce((n, m) => Math.max(n, m.quantity), 0);
    const concentration = total > 0 ? Math.round((busiest / total) * 100) : 0;
    return { enough, coveredMonths: covered, monthsWithIssues: issued, monthsWithIssuesPerYear: perYear, annualQuantity, concentrationPct: concentration, level };
}

export const MOVEMENT_LABELS = ['', 'Very slow moving', 'Slow moving', 'Fast moving', 'Very fast moving'];

/** Whether a grid cell is at or below the cutoff (lower or equal class and lower or equal movement): bought on demand. */
export function onDemand(cell: string, cutoff: string): boolean {
    if (!isCell(cell) || !isCell(cutoff)) return false;
    return classRank(cell[0]) <= classRank(cutoff[0]) && Number(cell[1]) <= Number(cutoff[1]);
}
