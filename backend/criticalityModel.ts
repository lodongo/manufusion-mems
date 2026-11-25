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
// Two methods, chosen in setup:
//
// 1. Risk-based (default for new setups). Follows the consequence × likelihood logic of NORSOK Z-008, ISO 14224 and
//    ISO 31000, and spare-parts practice of letting supply risk decide how far ahead the part must be held:
//      - Consequence C (1–3) is the WORST rating of the consequence factors declared (safety, food safety, environment,
//        compliance, production, downtime cost, restoration time, quality, reputation, commonality). Averaging would
//        let an easy-to-buy part hide a line stop; the worst consequence governs.
//      - Redundancy mitigates: an installed standby (redundancy rated 1) lowers a non-HSE consequence by one level.
//      - Likelihood L (1–3) of needing the part: failure likelihood, raised by one for sudden failures and lowered by
//        one when failure is predictable well in advance.
//      - Supply risk S (1–3): weighted mean of the supply factors (sources, lead time, local availability, substitutes,
//        custom, repairability, obsolescence, emergency purchase), rounded half up.
//      - Class = configurable 3 × 3 risk matrix of C × L; a supply risk of 3 raises it one class (setup can switch off).
//      - The risk index C × L × S (1–27) ranks materials within a class, like an RPN.
// 2. Weighted score (the original method, kept for setups that use it): sum of weight × rating, scaled linearly to
//    1–4 and rounded: 4 → A, 3 → B, 2 → C, 1 → D.
//
// Both keep the high-consequence override and report a sensitivity analysis: the factors whose rating, moved by one
// step, would change the class. A class with such swing factors is borderline and worth a second look.
//
// Movement also reports the demand pattern (Syntetos–Boylan: smooth, erratic, intermittent, lumpy from the average
// inter-demand interval ADI and the squared coefficient of variation CV² of demand sizes) and the XYZ variability class.
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
    /** 1 (normal) to 5 (dominant). In the risk method it weighs only the supply-risk mean. */
    weight: number;
}
export type Method = 'risk' | 'weighted';
/** The role of each factor in the risk method. */
export const ROLE: Record<string, 'consequence' | 'likelihood' | 'mitigation' | 'supply'> = {
    SAF: 'consequence', FSQ: 'consequence', ENV: 'consequence', REG: 'consequence', PRD: 'consequence', DTC: 'consequence',
    MTR: 'consequence', QLT: 'consequence', RPT: 'consequence', COM: 'consequence',
    FRQ: 'likelihood', PRE: 'likelihood', RED: 'mitigation',
    SUP: 'supply', LDT: 'supply', LOC: 'supply', SUB: 'supply', CUS: 'supply', REP: 'supply', OBS: 'supply', EMG: 'supply',
};
/** Risk matrix rows: consequence 3, 2, 1 (top to bottom); columns: likelihood 1, 2, 3. */
export type Matrix = [[ClassLetter, ClassLetter, ClassLetter], [ClassLetter, ClassLetter, ClassLetter], [ClassLetter, ClassLetter, ClassLetter]];
export const DEFAULT_MATRIX: Matrix = [['B', 'A', 'A'], ['C', 'B', 'B'], ['D', 'D', 'C']];
export const PATTERNS = { smooth: 'Smooth', erratic: 'Erratic', intermittent: 'Intermittent', lumpy: 'Lumpy', none: 'No demand' } as const;

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
    /** Risk-based (consequence × likelihood with supply uplift) or the weighted score. */
    method: Method;
    matrix: Matrix;
    /** A supply risk of 3 raises the class by one. */
    supplyUplift: boolean;
    /** An installed standby lowers a non-HSE consequence by one level. */
    redundancyMitigation: boolean;
    /** Review interval per class (months); critical materials are reviewed more often. */
    reviewMonthsByClass: Record<ClassLetter, number>;
    /** Material category codes the analysis applies to; empty means every category. */
    scopeCategories: string[];
    /** Demand pattern cut-offs (Syntetos–Boylan 1.32 and 0.49) and XYZ coefficient-of-variation limits. */
    pattern: { adi: number; cv2: number; x: number; y: number };
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
        method: 'risk',
        matrix: DEFAULT_MATRIX.map((r) => [...r]) as Matrix,
        supplyUplift: true,
        redundancyMitigation: true,
        reviewMonthsByClass: { A: 6, B: 12, C: 24, D: 36 },
        scopeCategories: [],
        pattern: { adi: 1.32, cv2: 0.49, x: 0.5, y: 1 },
    };
}
/** Review interval for a class under the setup. */
export const reviewMonthsFor = (setup: CriticalitySetup, cls: string) => setup.reviewMonthsByClass?.[cls as ClassLetter] ?? setup.reviewMonths;
export const inScope = (setup: CriticalitySetup, categoryCode: string) => !setup.scopeCategories?.length || setup.scopeCategories.includes(categoryCode);

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
        if (![1, 2, 3, 4, 5].includes(weight)) throw new Error(`Weight of ${f.name} must be a whole number from 1 to 5`);
        factors[f.code] = { enabled: s ? s.enabled === true : base.factors[f.code].enabled, weight };
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
    // A setup saved before the risk method existed keeps the weighted score until an administrator switches it.
    const method = String(o.method ?? (o.factors ? 'weighted' : base.method));
    if (!['risk', 'weighted'].includes(method)) throw new Error('Choose the criticality method');
    const used = FACTORS.filter((f) => factors[f.code].enabled);
    if (method === 'risk' && !used.some((f) => ROLE[f.code] === 'consequence')) throw new Error('The risk method needs at least one consequence factor');
    const letters = (v: unknown) => typeof v === 'string' && ['A', 'B', 'C', 'D'].includes(v);
    const rawMatrix = Array.isArray(o.matrix) ? o.matrix : base.matrix;
    if (rawMatrix.length !== 3 || rawMatrix.some((r: unknown) => !Array.isArray(r) || r.length !== 3 || !r.every(letters))) throw new Error('The risk matrix needs a class A to D in each of its nine cells');
    const matrix = rawMatrix.map((r: string[]) => [...r]) as Matrix;
    // Higher consequence or likelihood may never give a lower class: the matrix must be monotonic.
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (j < 2 && classRank(matrix[i][j + 1]) < classRank(matrix[i][j])) throw new Error('In the risk matrix, a higher likelihood cannot give a lower class');
        if (i < 2 && classRank(matrix[i][j]) < classRank(matrix[i + 1][j])) throw new Error('In the risk matrix, a higher consequence cannot give a lower class');
    }
    const rb = o.reviewMonthsByClass && typeof o.reviewMonthsByClass === 'object' ? o.reviewMonthsByClass : null;
    const reviewMonths = whole(o.reviewMonths ?? 12, 'Review interval (months)', 3, 60);
    const reviewMonthsByClass = Object.fromEntries(CLASSES.map((c) => [c, whole(rb ? rb[c] : rb === null && o.factors ? reviewMonths : base.reviewMonthsByClass[c], `Review interval for class ${c} (months)`, 3, 60)])) as Record<ClassLetter, number>;
    const scope = Array.isArray(o.scopeCategories) ? [...new Set(o.scopeCategories.map((x: unknown) => String(x).trim().toUpperCase()).filter(Boolean))] as string[] : [];
    if (scope.length > 100 || scope.some((c) => !/^[A-Z0-9][A-Z0-9._ /-]{0,59}$/.test(c))) throw new Error('Scope must list up to 100 valid material category codes');
    const pt = o.pattern && typeof o.pattern === 'object' ? o.pattern : base.pattern;
    const dec = (x: unknown, label: string, min: number, max: number) => {
        const n = Number(x);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be from ${min} to ${max}`);
        return Math.round(n * 100) / 100;
    };
    const pattern = { adi: dec(pt.adi, 'ADI cut-off', 1, 6), cv2: dec(pt.cv2, 'CV² cut-off', 0.1, 4), x: dec(pt.x, 'X limit', 0.1, 2), y: dec(pt.y, 'Y limit', 0.2, 4) };
    if (pattern.y <= pattern.x) throw new Error('The Y limit must be above the X limit');
    return {
        factors,
        hseOverride: o.hseOverride !== false,
        strategyMode: mode as CriticalitySetup['strategyMode'],
        cutoff,
        minHistoryMonths: whole(o.minHistoryMonths ?? 6, 'Minimum issue history (months)', 6, 24),
        thresholds: { m4, m3, m2 },
        reviewMonths,
        method: method as Method,
        matrix,
        supplyUplift: o.supplyUplift !== false,
        redundancyMitigation: o.redundancyMitigation !== false,
        reviewMonthsByClass,
        scopeCategories: scope,
        pattern,
    };
}

/** The weighted-score class (original method). */
function weightedClass(setup: CriticalitySetup, used: Factor[], ratings: Record<string, number>) {
    let score = 0, min = 0, max = 0;
    for (const f of used) {
        const w = setup.factors[f.code].weight;
        min += w; max += 3 * w; score += w * (Number(ratings[f.code]) || 1);
    }
    const scaled = max > min ? 1 + (3 * (score - min)) / (max - min) : 1;
    const level = Math.min(4, Math.max(1, Math.round(scaled)));
    return { score, min, max, scaled, cls: classOfLevel(level) };
}
const clamp3 = (n: number) => Math.min(3, Math.max(1, n));
/** The risk-based class: worst consequence × likelihood on the matrix, supply uplift. */
function riskClass(setup: CriticalitySetup, used: Factor[], ratings: Record<string, number>) {
    const r = (code: string) => (used.some((f) => f.code === code) ? Number(ratings[code]) || 1 : 0);
    const consequence = used.filter((f) => ROLE[f.code] === 'consequence');
    const rated = (f: Factor) => Number(ratings[f.code]) || 1;
    let c = Math.max(1, ...consequence.map(rated));
    const driver = consequence.filter((f) => rated(f) === c).map((f) => f.name).join(', ');
    const hseDriven = consequence.some((f) => f.hse && rated(f) === c);
    let mitigated = false;
    if (setup.redundancyMitigation && r('RED') === 1 && c > 1 && !hseDriven) { c -= 1; mitigated = true; }
    let l = r('FRQ') || 2;
    if (r('PRE') === 3) l = clamp3(l + 1);
    if (r('PRE') === 1) l = clamp3(l - 1);
    const supply = used.filter((f) => ROLE[f.code] === 'supply');
    const wsum = supply.reduce((n, f) => n + setup.factors[f.code].weight, 0);
    const mean = wsum ? supply.reduce((n, f) => n + setup.factors[f.code].weight * (Number(ratings[f.code]) || 1), 0) / wsum : 2;
    const sr = clamp3(Math.floor(mean + 0.5));
    const matrixClass = setup.matrix[3 - c][l - 1];
    const uplifted = setup.supplyUplift && sr === 3 && matrixClass !== 'A';
    const cls = uplifted ? classOfLevel(classRank(matrixClass) + 1) : matrixClass;
    return { consequence: c, consequenceDriver: driver, mitigated, likelihood: l, supplyRisk: sr, supplyMean: Math.round(mean * 100) / 100, matrixClass, uplifted, cls, riskIndex: c * l * sr };
}

/** Criticality from the ratings of the factors declared in setup. */
export function scoreCriticality(setup: CriticalitySetup, ratings: Record<string, number>) {
    const used = FACTORS.filter((f) => setup.factors[f.code]?.enabled);
    const missing = used.filter((f) => ![1, 2, 3].includes(Number(ratings[f.code]))).map((f) => f.name);
    const overrideBy = setup.hseOverride ? used.filter((f) => f.hse && Number(ratings[f.code]) === 3).map((f) => f.name) : [];
    const method: Method = setup.method ?? 'weighted';
    const classOf = (rt: Record<string, number>): ClassLetter => {
        const hse = setup.hseOverride && used.some((f) => f.hse && Number(rt[f.code]) === 3);
        if (hse) return 'A';
        return method === 'risk' ? riskClass(setup, used, rt).cls : weightedClass(setup, used, rt).cls;
    };
    const w = weightedClass(setup, used, ratings);
    const risk = method === 'risk' ? riskClass(setup, used, ratings) : null;
    const cls: ClassLetter = overrideBy.length ? 'A' : risk ? risk.cls : w.cls;
    // Sensitivity: which single one-step rating change would move the class, and where to.
    const swing: Array<{ factor: string; code: string; from: number; to: number; becomes: ClassLetter }> = [];
    if (!missing.length) for (const f of used) {
        const from = Number(ratings[f.code]);
        for (const to of [from - 1, from + 1]) {
            if (to < 1 || to > 3) continue;
            const becomes = classOf({ ...ratings, [f.code]: to });
            if (becomes !== cls) swing.push({ factor: f.name, code: f.code, from, to, becomes });
        }
    }
    return {
        complete: missing.length === 0, missing, method,
        score: risk ? risk.riskIndex : w.score, min: risk ? 1 : w.min, max: risk ? 27 : w.max,
        scaled: Math.round(w.scaled * 100) / 100, level: classRank(cls), criticalityClass: cls, overrideBy,
        risk, borderline: swing.length > 0, swing: swing.slice(0, 12),
    };
}

/** Demand pattern (Syntetos–Boylan) and XYZ variability from monthly demand. */
export function demandPattern(setup: CriticalitySetup, months: number[]) {
    const p = setup.pattern ?? defaultSetup().pattern;
    const n = months.length;
    const sizes = months.filter((q) => q > 0);
    if (!n || !sizes.length) return { pattern: 'none' as const, label: PATTERNS.none, adi: null, cv2: null, xyz: null as null | 'X' | 'Y' | 'Z', cv: null, method: 'Hold by criticality; no demand to forecast' };
    const adi = Math.round((n / sizes.length) * 100) / 100;
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const sd = Math.sqrt(sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length);
    const cv2 = Math.round(((sd / mean) ** 2) * 100) / 100;
    const allMean = months.reduce((a, b) => a + b, 0) / n;
    const allSd = Math.sqrt(months.reduce((a, b) => a + (b - allMean) ** 2, 0) / n);
    const cv = allMean > 0 ? Math.round((allSd / allMean) * 100) / 100 : null;
    const pattern = adi < p.adi ? (cv2 < p.cv2 ? 'smooth' : 'erratic') : cv2 < p.cv2 ? 'intermittent' : 'lumpy';
    const xyz = cv == null ? null : cv <= p.x ? 'X' : cv <= p.y ? 'Y' : 'Z';
    const method = { smooth: 'Exponential smoothing or moving average', erratic: 'Smoothing with a higher safety stock', intermittent: 'Croston / SBA', lumpy: 'SBA, or hold by criticality (min/max)' }[pattern];
    return { pattern, label: PATTERNS[pattern], adi, cv2, xyz, cv, method };
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
    const demand = demandPattern(setup, recent.map((m) => Math.max(0, m.quantity)));
    return { enough, coveredMonths: covered, monthsWithIssues: issued, monthsWithIssuesPerYear: perYear, annualQuantity, concentrationPct: concentration, level, demand };
}

export const MOVEMENT_LABELS = ['', 'Very slow moving', 'Slow moving', 'Fast moving', 'Very fast moving'];

/** Whether a grid cell is at or below the cutoff (lower or equal class and lower or equal movement): bought on demand. */
export function onDemand(cell: string, cutoff: string): boolean {
    if (!isCell(cell) || !isCell(cutoff)) return false;
    return classRank(cell[0]) <= classRank(cutoff[0]) && Number(cell[1]) <= Number(cutoff[1]);
}
