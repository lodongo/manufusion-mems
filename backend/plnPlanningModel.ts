// ---------------------------------------------------------------------------
// Production planning & MRP model: one pure module for the S&OP / MPS / MRP cycle (ASCM / APICS practice).
//
//   1  Financial year buckets   The planning year is the financial year configured in Finance for the site's legal
//                               entity. Part-way through the year only the BALANCE of the year is planned: past periods
//                               are closed, the current period is prorated (or included / excluded, by setup).
//   2  Annual demand            Each SKU has an annual quantity for the financial year (until commercial confirmed demand
//                               is linked). It is spread over the periods by a seasonality profile; for a full-year figure
//                               only the share of the balance periods is planned.
//   3  SKU forecast             A statistical forecast per SKU from its confirmed-order history (the same engine as the
//                               spare-part forecasting: SMA/WMA/SES/Holt/regression/Croston/TSB ranked by MASE). The
//                               consensus is the annual plan, the statistical forecast or a blend; firm orders consume the
//                               forecast (the larger of the two counts, never both).
//   4  BOM unitisation          The smallest production quantity that keeps every indivisible component whole (bags,
//                               drums, pieces, packs of a stated size): the least common multiple of the denominators of
//                               the per-unit quantities, with an optional rounding tolerance. Without indivisible
//                               components the unit is one output unit. Production is planned in multiples of it.
//   5  MRP                      Multi-level BOM explosion (intermediates are exploded in low-level-code order), scrap,
//                               gross-to-net against available stock, safety stock and open supply, lot sizing (minimal
//                               batch for made items, MOQ and order multiple for bought ones) and lead-time offset.
//   6  Rough-cut capacity       Hours each routing needs per period (bottleneck rate plus set-ups per process batch)
//                               against the hours available.
//   7  S&OP summary             Demand, supply, inventory, capacity and purchase value per family and period.
//   8  Workflow                 draft → demand review → supply planning → S&OP review (Chart of Authority on the planned
//                               purchase value) → approved → released, with independent reviewers at every gate.
// Nothing here reads or writes the database: the routes in plnPlanning.ts load the data and store the results.
// ---------------------------------------------------------------------------
import { defaultForecastSetup, runForecast, type ForecastSetup, type Instance } from './forecastModel';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const DAY = 86_400_000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;

// ----- Setup -----

export const DISCRETE_UOMS = ['EA', 'PC', 'PCS', 'UNIT', 'UNITS', 'NO', 'NOS', 'BOX', 'CTN', 'CARTON', 'CASE', 'PACK', 'PKT', 'BAG', 'SACK', 'ROLL', 'REEL', 'SET', 'PAIR', 'BTL', 'BOTTLE', 'CAN', 'TIN', 'DRUM', 'PAIL', 'JERRYCAN', 'PALLET', 'SHEET', 'TRAY', 'CYL', 'CYLINDER'];
export type Profile = 'FLAT' | 'DAYS' | 'HISTORY' | 'CUSTOM';
export type ForecastBasis = 'ANNUAL' | 'STATISTICAL' | 'BLENDED';
export type CurrentPeriodRule = 'prorate' | 'include' | 'exclude';
export type AnnualBasis = 'FULL_YEAR' | 'BALANCE';
export interface Indivisible { key: string; packSize: number; note: string }
export interface PlanningSetup {
    /** Where planned demand comes from. Commercial confirmed demand is a later integration. */
    demandSource: 'ANNUAL_PLAN';
    currentPeriodRule: CurrentPeriodRule;
    defaultAnnualBasis: AnnualBasis;
    defaultProfile: Profile;
    /** 12 percentages by calendar month (Jan…Dec) for the CUSTOM profile; they are normalised. */
    customProfile: number[];
    defaultForecastBasis: ForecastBasis;
    /** Weight of the statistical forecast in a blend, %. */
    blendPct: number;
    historyMonths: number;
    /** Units that can never be split (pieces, bags, drums …). */
    discreteUoms: string[];
    /** Components that must stay whole, optionally in packs (MAT:{materialId} or SKU:{skuId}). */
    indivisible: Indivisible[];
    /** Accept a smaller batch when every indivisible component is within this % of a whole pack. 0 = exact. */
    unitTolerancePct: number;
    /** Process batches (vessel sizes on BATCH_CYCLE stages): only count runs, or plan full batches only. */
    processBatchRule: 'runs' | 'multiple';
    hoursPerDay: number;
    workingDaysPerWeek: number;
    oeePct: number;
    /** Over this utilisation a period is flagged as overloaded. */
    overloadPct: number;
}
export function defaultPlanningSetup(): PlanningSetup {
    return {
        demandSource: 'ANNUAL_PLAN',
        currentPeriodRule: 'prorate',
        defaultAnnualBasis: 'FULL_YEAR',
        defaultProfile: 'DAYS',
        customProfile: Array(12).fill(100 / 12).map(r3),
        defaultForecastBasis: 'ANNUAL',
        blendPct: 50,
        historyMonths: 24,
        discreteUoms: [...DISCRETE_UOMS],
        indivisible: [],
        unitTolerancePct: 0,
        processBatchRule: 'runs',
        hoursPerDay: 16,
        workingDaysPerWeek: 6,
        oeePct: 85,
        overloadPct: 100,
    };
}
function n(v: unknown, label: string, min: number, max: number, integer = false): number {
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}`);
    return x;
}
function pick<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
    if (!allowed.includes(v as T)) throw new Error(`Choose ${label}`);
    return v as T;
}
const UOM = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const KEY = /^(MAT|SKU):[A-Za-z0-9_-]{1,120}$/;
/** Validates the planning setup (throws an Error with the message to show). */
export function readPlanningSetup(v: unknown): PlanningSetup {
    if (!isObj(v)) throw new Error('Planning setup required');
    const d = defaultPlanningSetup();
    if (v.demandSource !== undefined && v.demandSource !== 'ANNUAL_PLAN') throw new Error('Commercial confirmed demand is not linked yet: planned demand comes from the annual demand plan.');
    const custom = Array.isArray(v.customProfile) ? v.customProfile.map((x, i) => n(x, `Seasonality for month ${i + 1}`, 0, 100)) : d.customProfile;
    if (custom.length !== 12) throw new Error('The custom seasonality needs 12 monthly percentages');
    if (custom.reduce((a, b) => a + b, 0) <= 0) throw new Error('The custom seasonality must have at least one month above zero');
    const uoms = Array.isArray(v.discreteUoms) ? [...new Set(v.discreteUoms.map((x) => s(x).trim().toUpperCase()).filter(Boolean))] : d.discreteUoms;
    if (uoms.length > 80 || uoms.some((u) => !UOM.test(u))) throw new Error('Indivisible units: up to 80 valid unit codes');
    const ind = Array.isArray(v.indivisible) ? v.indivisible : [];
    if (ind.length > 500) throw new Error('At most 500 indivisible components');
    const seen = new Set<string>();
    const indivisible = ind.map((x, i) => {
        if (!isObj(x)) throw new Error(`Indivisible component ${i + 1} is invalid`);
        const key = s(x.key).trim();
        if (!KEY.test(key)) throw new Error(`Indivisible component ${i + 1}: choose a material or SKU`);
        if (seen.has(key)) throw new Error(`${key} is listed twice`);
        seen.add(key);
        return { key, packSize: n(x.packSize ?? 1, `${key}: pack size`, 0.000001, 1e7), note: s(x.note).trim().slice(0, 120) };
    });
    const hoursPerDay = n(v.hoursPerDay ?? d.hoursPerDay, 'Hours per day', 1, 24);
    return {
        demandSource: 'ANNUAL_PLAN',
        currentPeriodRule: pick(v.currentPeriodRule ?? d.currentPeriodRule, ['prorate', 'include', 'exclude'] as const, 'how the current period is planned'),
        defaultAnnualBasis: pick(v.defaultAnnualBasis ?? d.defaultAnnualBasis, ['FULL_YEAR', 'BALANCE'] as const, 'what the annual quantity covers'),
        defaultProfile: pick(v.defaultProfile ?? d.defaultProfile, ['FLAT', 'DAYS', 'HISTORY', 'CUSTOM'] as const, 'the seasonality profile'),
        customProfile: custom.map(r3),
        defaultForecastBasis: pick(v.defaultForecastBasis ?? d.defaultForecastBasis, ['ANNUAL', 'STATISTICAL', 'BLENDED'] as const, 'the forecast basis'),
        blendPct: n(v.blendPct ?? d.blendPct, 'Statistical weight in a blend', 0, 100),
        historyMonths: n(v.historyMonths ?? d.historyMonths, 'History months', 6, 36, true),
        discreteUoms: uoms,
        indivisible,
        unitTolerancePct: n(v.unitTolerancePct ?? d.unitTolerancePct, 'Unitisation tolerance', 0, 10),
        processBatchRule: pick(v.processBatchRule ?? d.processBatchRule, ['runs', 'multiple'] as const, 'how process batches are used'),
        hoursPerDay,
        workingDaysPerWeek: n(v.workingDaysPerWeek ?? d.workingDaysPerWeek, 'Working days per week', 1, 7),
        oeePct: n(v.oeePct ?? d.oeePct, 'OEE', 10, 100),
        overloadPct: n(v.overloadPct ?? d.overloadPct, 'Overload threshold', 50, 200),
    };
}

// ----- 1  Financial year buckets -----

export interface FyPeriodIn { no: number; name: string; start: string; end: string; special?: boolean }
export interface Bucket {
    key: string;
    no: number;
    name: string;
    start: string;
    end: string;
    month: string;
    days: number;
    /** Share of the period still to plan (0 past · 0–1 current · 1 future). */
    fraction: number;
    state: 'past' | 'current' | 'future';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Planning buckets of a financial year. Month and 4-4-5 style years keep their finance periods; a weekly or other
 * calendar with more than 13 periods is planned in calendar months inside the year.
 */
export function bucketsOf(year: { start: string; end: string; periods: FyPeriodIn[] }, asOf: string, rule: CurrentPeriodRule): Bucket[] {
    if (!isoDay.test(year.start) || !isoDay.test(year.end) || year.end < year.start) throw new Error('The financial year has no valid dates');
    if (!isoDay.test(asOf)) throw new Error('Valid planning date required');
    let periods = year.periods.filter((p) => !p.special && isoDay.test(p.start) && isoDay.test(p.end));
    if (!periods.length || periods.length > 13) {
        periods = [];
        let cur = year.start;
        for (let i = 1; cur <= year.end && i <= 13; i++) {
            const d = new Date(`${cur}T00:00:00Z`);
            const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
            const end = last > year.end ? year.end : last;
            periods.push({ no: i, name: `P${String(i).padStart(2, '0')} · ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, start: cur, end });
            cur = new Date(Date.parse(`${end}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
        }
    }
    return periods.map((p) => {
        const total = days(p.start, p.end);
        let fraction = 1;
        let state: Bucket['state'] = 'future';
        if (asOf > p.end) {
            fraction = 0;
            state = 'past';
        } else if (asOf >= p.start) {
            state = 'current';
            fraction = rule === 'include' ? 1 : rule === 'exclude' ? 0 : days(asOf, p.end) / total;
        }
        // A 4-4-5 period is named after the month it mostly falls in (its middle day).
        const mid = new Date(Date.parse(`${p.start}T00:00:00Z`) + Math.floor(total / 2) * DAY).toISOString().slice(0, 7);
        return { key: `P${String(p.no).padStart(2, '0')}`, no: p.no, name: p.name, start: p.start, end: p.end, month: mid, days: total, fraction: r3(fraction), state };
    });
}
/** Planned share of the year: balance periods weighted by days (for the headline "x of 12 months"). */
export function balanceSummary(buckets: Bucket[]) {
    const open = buckets.filter((b) => b.fraction > 0);
    const totalDays = buckets.reduce((a, b) => a + b.days, 0) || 1;
    const openDays = buckets.reduce((a, b) => a + b.days * b.fraction, 0);
    return { periods: buckets.length, open: open.length, past: buckets.filter((b) => b.state === 'past').length, firstOpen: open[0]?.key ?? '', share: r3(openDays / totalDays) };
}

// ----- 2  Annual demand spread -----

/** Weight of each bucket for a seasonality profile. */
export function profileWeights(buckets: Bucket[], profile: Profile, custom: number[], historyIndex: Map<number, number> | null): number[] {
    if (profile === 'FLAT') return buckets.map(() => 1);
    if (profile === 'DAYS') return buckets.map((b) => b.days);
    const byMonth = (m: string) => Number(m.slice(5, 7));
    if (profile === 'CUSTOM') return buckets.map((b) => Math.max(0, custom[byMonth(b.month) - 1] ?? 0) * b.days / 30.4375);
    return buckets.map((b) => (historyIndex?.get(byMonth(b.month)) ?? 1) * b.days);
}
/** Seasonal index per calendar month from at least 12 months of history (average month = 1), else null. */
export function historyIndex(history: Array<{ month: string; qty: number }>): Map<number, number> | null {
    const months = history.filter((h) => /^\d{4}-\d{2}$/.test(h.month));
    if (months.length < 12) return null;
    const mean = months.reduce((a, h) => a + h.qty, 0) / months.length;
    if (mean <= 0) return null;
    const out = new Map<number, number>();
    for (let m = 1; m <= 12; m++) {
        const xs = months.filter((h) => Number(h.month.slice(5, 7)) === m).map((h) => h.qty);
        out.set(m, xs.length ? Math.max(0.05, xs.reduce((a, b) => a + b, 0) / xs.length / mean) : 1);
    }
    return out;
}
/** Splits a total over weights; whole units keep the exact total (largest remainder). */
export function apportion(total: number, weights: number[], whole: boolean): number[] {
    const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0 || sum <= 0) return weights.map(() => 0);
    const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
    if (!whole) return exact.map(r3);
    const target = Math.round(total);
    const floors = exact.map(Math.floor);
    let rest = target - floors.reduce((a, b) => a + b, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const o of order) {
        if (rest <= 0) break;
        floors[o.i] += 1;
        rest -= 1;
    }
    return floors;
}
/** Annual quantity → quantity per bucket. A full-year figure plans only the share of the balance periods. */
export function spreadAnnual(annualQty: number, basis: AnnualBasis, buckets: Bucket[], weights: number[], whole: boolean) {
    const open = buckets.map((b, i) => weights[i] * b.fraction);
    const all = weights.reduce((a, b) => a + b, 0) || 1;
    const share = basis === 'BALANCE' ? 1 : open.reduce((a, b) => a + b, 0) / all;
    const balanceQty = annualQty * share;
    return { perBucket: apportion(balanceQty, open, whole), balanceQty: whole ? Math.round(balanceQty) : r3(balanceQty), share: r3(share) };
}

// ----- 3  SKU forecast -----

export interface SkuLine {
    skuId: string;
    annualQty: number;
    annualBasis: AnnualBasis;
    profile: Profile;
    forecastBasis: ForecastBasis;
    blendPct: number;
    /** Planner overrides of the final quantity per bucket, with a reason. */
    overrides: Record<string, { qty: number; reason: string }>;
    note: string;
}
const SKU = /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/;
/** Validates the annual demand lines of a plan. */
export function readLines(v: unknown, buckets: Bucket[], setup: PlanningSetup): SkuLine[] {
    if (!Array.isArray(v)) throw new Error('Annual demand lines required');
    if (v.length > 300) throw new Error('At most 300 SKUs in one plan; split the plan by site');
    const keys = new Set(buckets.filter((b) => b.fraction > 0).map((b) => b.key));
    const seen = new Set<string>();
    return v.map((x, i) => {
        if (!isObj(x)) throw new Error(`Line ${i + 1} is invalid`);
        const skuId = s(x.skuId).trim();
        if (!SKU.test(skuId)) throw new Error(`Line ${i + 1}: choose a SKU`);
        if (seen.has(skuId)) throw new Error(`${skuId} is planned twice`);
        seen.add(skuId);
        const overrides: SkuLine['overrides'] = {};
        if (isObj(x.overrides)) {
            for (const [k, o] of Object.entries(x.overrides)) {
                if (!isObj(o)) continue;
                if (!keys.has(k)) throw new Error(`${skuId}: ${k} is not an open period of this plan`);
                const reason = s(o.reason).trim();
                if (reason.length < 5) throw new Error(`${skuId} ${k}: give a reason of at least 5 characters for the override`);
                overrides[k] = { qty: n(o.qty, `${skuId} ${k} override`, 0, 1e12), reason: reason.slice(0, 200) };
            }
        }
        return {
            skuId,
            annualQty: n(x.annualQty, `${skuId}: annual quantity`, 0, 1e12),
            annualBasis: pick(x.annualBasis ?? setup.defaultAnnualBasis, ['FULL_YEAR', 'BALANCE'] as const, `${skuId}: what the annual quantity covers`),
            profile: pick(x.profile ?? setup.defaultProfile, ['FLAT', 'DAYS', 'HISTORY', 'CUSTOM'] as const, `${skuId}: the seasonality`),
            forecastBasis: pick(x.forecastBasis ?? setup.defaultForecastBasis, ['ANNUAL', 'STATISTICAL', 'BLENDED'] as const, `${skuId}: the forecast basis`),
            blendPct: n(x.blendPct ?? setup.blendPct, `${skuId}: statistical weight`, 0, 100),
            overrides,
            note: s(x.note).trim().slice(0, 300),
        };
    });
}
export interface ForecastBucket {
    key: string;
    month: string;
    fraction: number;
    annual: number;
    statistical: number | null;
    lower: number | null;
    upper: number | null;
    consensus: number;
    override: number | null;
    firm: number;
    /** Demand to plan: the final forecast, consumed by firm orders (the larger of the two). */
    demand: number;
}
export interface SkuForecast {
    skuId: string;
    uom: string;
    whole: boolean;
    basis: ForecastBasis;
    effectiveBasis: ForecastBasis;
    buckets: ForecastBucket[];
    totals: { annual: number; balance: number; statistical: number | null; firm: number; demand: number };
    stat: { method: string; pattern: string; trend: string; mase: number | null; mae: number | null; bias: number | null; historyMonths: number; sufficient: boolean; seasonal: boolean } | null;
    notes: string[];
}
/** Detailed forecast of one SKU over the open buckets of the plan. */
export function forecastSku(a: {
    line: SkuLine;
    uom: string;
    whole: boolean;
    buckets: Bucket[];
    history: Array<{ month: string; qty: number }>;
    firm: Record<string, number>;
    setup: PlanningSetup;
    forecastSetup?: ForecastSetup;
    now: string;
}): SkuForecast {
    const { line, buckets, setup } = a;
    const notes: string[] = [];
    const idx = line.profile === 'HISTORY' ? historyIndex(a.history) : null;
    if (line.profile === 'HISTORY' && !idx) notes.push('Less than 12 months of history: seasonality follows calendar days.');
    const weights = profileWeights(buckets, line.profile === 'HISTORY' && !idx ? 'DAYS' : line.profile, setup.customProfile, idx);
    const spread = spreadAnnual(line.annualQty, line.annualBasis, buckets, weights, a.whole);

    // Statistical forecast from monthly confirmed-order history (masked nothing; outliers capped by the engine).
    let stat: SkuForecast['stat'] = null;
    const statBy = new Map<string, { v: number; lo: number; hi: number }>();
    const used = a.history.filter((h) => h.qty > 0).length;
    if (used >= 3) {
        const fs = { ...(a.forecastSetup ?? defaultForecastSetup()), seasonal: a.history.length >= 24 };
        const instances: Instance[] = a.history.filter((h) => h.qty > 0).map((h, i) => ({ id: `H${i}`, at: `${h.month}-15T09:00:00.000Z`, kind: 'issue', qty: h.qty, type: 'SKU_DEMAND', reference: 'history' }));
        const nowMonth = a.now.slice(0, 7);
        const last = buckets[buckets.length - 1]?.month ?? nowMonth;
        const ahead = Math.min(24, Math.max(1, (Number(last.slice(0, 4)) - Number(nowMonth.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(nowMonth.slice(5, 7)) + 1));
        const f = runForecast({ instances, masked: [], setup: fs, events: [], now: a.now, pastMonths: Math.min(36, setup.historyMonths), futureMonths: ahead, externalLeadDays: 0 });
        for (const row of f.future) statBy.set(row.month, { v: row.total, lo: row.lower, hi: row.upper });
        // The current month is not in the engine's future: it carries the first forecast month.
        if (f.future[0] && !statBy.has(nowMonth)) statBy.set(nowMonth, { v: f.future[0].total, lo: f.future[0].lower, hi: f.future[0].upper });
        stat = { method: f.method, pattern: f.pattern.pattern, trend: f.trend.direction, mase: f.accuracy.mase, mae: f.accuracy.mae, bias: f.accuracy.bias, historyMonths: f.historyMonths, sufficient: f.sufficient, seasonal: f.seasonal };
    } else if (line.forecastBasis !== 'ANNUAL') notes.push('Fewer than 3 months with confirmed orders: the statistical forecast is not available, so the annual plan is used.');
    const effectiveBasis: ForecastBasis = stat ? line.forecastBasis : 'ANNUAL';

    const rows: ForecastBucket[] = buckets.map((b, i) => {
        const sb = statBy.get(b.month);
        const statistical = stat && sb && b.fraction > 0 ? sb.v * b.fraction : stat && b.fraction > 0 ? 0 : null;
        const annual = spread.perBucket[i];
        const consensus = effectiveBasis === 'ANNUAL' ? annual : effectiveBasis === 'STATISTICAL' ? statistical ?? annual : (line.blendPct / 100) * (statistical ?? annual) + (1 - line.blendPct / 100) * annual;
        const o = line.overrides[b.key];
        const override = o && b.fraction > 0 ? o.qty : null;
        const firm = b.fraction > 0 ? Math.max(0, a.firm[b.month] ?? 0) : 0;
        const final = override ?? consensus;
        return { key: b.key, month: b.month, fraction: b.fraction, annual, statistical: statistical === null ? null : r3(statistical), lower: stat && sb && b.fraction > 0 ? r3(sb.lo * b.fraction) : null, upper: stat && sb && b.fraction > 0 ? r3(sb.hi * b.fraction) : null, consensus: r3(consensus), override, firm, demand: b.fraction > 0 ? Math.max(final, firm) : 0 };
    });
    // Whole units: round the planned demand without losing the total (largest remainder), never below firm orders.
    if (a.whole) {
        const target = Math.round(rows.reduce((t, r) => t + r.demand, 0));
        const parts = apportion(target, rows.map((r) => r.demand), true);
        rows.forEach((r, i) => (r.demand = Math.max(parts[i], Math.ceil(r.firm))));
    } else rows.forEach((r) => (r.demand = r3(r.demand)));
    const firmTotal = rows.reduce((t, r) => t + r.firm, 0);
    if (firmTotal > 0) notes.push('Firm orders consume the forecast: each period plans the larger of the forecast and the firm orders.');
    if (Object.keys(line.overrides).length) notes.push(`${Object.keys(line.overrides).length} period(s) overridden by the planner.`);
    return {
        skuId: line.skuId,
        uom: a.uom,
        whole: a.whole,
        basis: line.forecastBasis,
        effectiveBasis,
        buckets: rows,
        totals: {
            annual: line.annualQty,
            balance: spread.balanceQty,
            statistical: stat ? r3(rows.reduce((t, r) => t + (r.statistical ?? 0), 0)) : null,
            firm: r3(firmTotal),
            demand: r3(rows.reduce((t, r) => t + r.demand, 0)),
        },
        stat,
        notes,
    };
}

// ----- 4  BOM unitisation -----

const gcd = (a: number, b: number): number => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a || 1;
};
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
/** A decimal as a reduced fraction (up to 6 decimal places). */
export function fraction(x: number): [number, number] {
    if (!Number.isFinite(x)) throw new Error('Invalid quantity');
    let den = 1;
    let num = x;
    for (let i = 0; i < 6 && Math.abs(num - Math.round(num)) > 1e-9; i++) {
        num *= 10;
        den *= 10;
    }
    num = Math.round(num);
    const g = gcd(num, den);
    return [num / g, den / g];
}
export interface BomLineIn {
    line?: number;
    source?: string;
    processSupplyKind?: string;
    skuId?: string;
    materialId?: string;
    warehouseId?: string;
    utilityCode?: string;
    supplyUtilityCode?: string;
    quantity: number;
    uom: string;
    scrapPct?: number;
}
export interface BomIn {
    id: string;
    name?: string;
    parentSkuId?: string;
    outputQty: number;
    outputUom: string;
    components: BomLineIn[];
    routingId?: string;
}
export type ComponentKind = 'sku' | 'material' | 'utility';
export const componentKind = (c: BomLineIn): ComponentKind =>
    c.source === 'WAREHOUSE' ? 'material' : c.source === 'PROCESS_SUPPLY' ? (c.processSupplyKind === 'SKU' ? 'sku' : c.processSupplyKind === 'PROCUREMENT' ? 'material' : 'utility') : 'sku';
export const componentKey = (c: BomLineIn) => {
    const k = componentKind(c);
    return k === 'sku' ? `SKU:${s(c.skuId)}` : k === 'material' ? `MAT:${s(c.materialId)}` : `UTL:${s(c.supplyUtilityCode) || s(c.utilityCode)}`;
};
export interface UnitLine {
    line: number;
    key: string;
    kind: ComponentKind;
    uom: string;
    perOutput: number;
    indivisible: boolean;
    packSize: number;
    why: string;
    /** Quantity in the minimal batch (before scrap) and in whole packs when indivisible. */
    batchQty: number;
    packs: number | null;
    deviationPct: number;
}
export interface Unitisation {
    bomId: string;
    outputUom: string;
    outputDiscrete: boolean;
    /** Smallest quantity that can be produced without splitting an indivisible component (multiple of 1 output unit). */
    minimalBatch: number;
    /** Exact least common multiple before any tolerance. */
    exactBatch: number;
    /** Largest BATCH_CYCLE vessel on the routing, if any (runs are counted against it). */
    processBatch: number | null;
    /** Planning lot: the minimal batch, or a multiple of the process batch when full batches are required. */
    lot: number;
    lines: UnitLine[];
    notes: string[];
}
/** Smallest production batch that keeps indivisible components whole (see the header). */
export function unitiseBom(bom: BomIn, setup: Pick<PlanningSetup, 'discreteUoms' | 'indivisible' | 'unitTolerancePct' | 'processBatchRule'>, processBatch: number | null = null): Unitisation {
    if (!(bom.outputQty > 0)) throw new Error(`${bom.id}: the output basis must be above zero`);
    const notes: string[] = [];
    const discrete = new Set(setup.discreteUoms.map((u) => u.toUpperCase()));
    const packs = new Map(setup.indivisible.map((i) => [i.key, i]));
    const outputDiscrete = discrete.has(String(bom.outputUom).toUpperCase());
    const lines = bom.components.map((c, i) => {
        const key = componentKey(c);
        const kind = componentKind(c);
        const listed = packs.get(key);
        const byUom = kind !== 'utility' && discrete.has(String(c.uom).toUpperCase());
        const indivisible = kind !== 'utility' && (!!listed || byUom);
        const packSize = listed?.packSize ?? 1;
        const why = !indivisible ? (kind === 'utility' ? 'Utility: metered, always divisible' : 'Divisible unit') : listed ? `Listed as indivisible${packSize !== 1 ? ` in packs of ${packSize} ${c.uom}` : ''}${listed.note ? ` (${listed.note})` : ''}` : `${c.uom} cannot be split`;
        return { line: c.line ?? i + 1, key, kind, uom: c.uom, perOutput: c.quantity / bom.outputQty, indivisible, packSize, why, raw: c.quantity / packSize };
    });
    // Per output unit, an indivisible component needs quantity / outputQty / packSize packs = a/b. The batch N (whole
    // output units) keeps it whole when b divides N·a, i.e. b divides N (a and b coprime). N = lcm of every b.
    let exact = 1;
    const [oNum, oDen] = fraction(bom.outputQty);
    for (const l of lines) {
        if (!l.indivisible) continue;
        const [pn, pd] = fraction(l.raw);
        // (pn/pd) / (oNum/oDen) = pn·oDen / (pd·oNum)
        const num = pn * oDen;
        const den = pd * oNum;
        const g = gcd(num, den);
        exact = lcm(exact, den / g);
        if (exact > 1e9) {
            notes.push('The exact batch is unrealistically large; check the BOM quantities or allow a rounding tolerance.');
            break;
        }
    }
    let minimal = exact;
    const tol = setup.unitTolerancePct / 100;
    if (tol > 0 && exact > 1) {
        const limit = Math.min(exact, 100_000);
        for (let N = 1; N < limit; N++) {
            const ok = lines.every((l) => {
                if (!l.indivisible) return true;
                const q = N * l.raw / bom.outputQty;
                const whole = Math.round(q);
                return whole >= 1 && Math.abs(q - whole) <= tol * q;
            });
            if (ok) {
                minimal = N;
                break;
            }
        }
        if (minimal < exact) notes.push(`A rounding tolerance of ${setup.unitTolerancePct}% allows a batch of ${minimal} instead of ${exact}: indivisible components are rounded to whole packs.`);
    }
    if (!lines.some((l) => l.indivisible)) notes.push('No indivisible components: production can be planned one unit at a time.');
    let lot = minimal;
    if (processBatch && processBatch > 0 && setup.processBatchRule === 'multiple') {
        const [pbN, pbD] = fraction(processBatch);
        // Full process batches only: the lot is the least common multiple of the minimal batch and the vessel size.
        lot = pbD === 1 ? lcm(minimal, pbN) : processBatch * Math.ceil(minimal / processBatch);
        notes.push(`Full process batches only: production is planned in lots of ${lot} (vessel ${processBatch}).`);
    }
    return {
        bomId: bom.id,
        outputUom: bom.outputUom,
        outputDiscrete,
        minimalBatch: minimal,
        exactBatch: exact,
        processBatch: processBatch && processBatch > 0 ? processBatch : null,
        lot,
        lines: lines.map((l) => {
            const q = (minimal * l.raw) / bom.outputQty;
            const whole = l.indivisible ? Math.max(1, Math.round(q)) : null;
            return { line: l.line, key: l.key, kind: l.kind, uom: l.uom, perOutput: r3(l.perOutput) || l.perOutput, indivisible: l.indivisible, packSize: l.packSize, why: l.why, batchQty: r3(l.indivisible ? (whole as number) * l.packSize : minimal * l.perOutput), packs: whole, deviationPct: whole === null || q === 0 ? 0 : r2((Math.abs(whole - q) / q) * 100) };
        }),
        notes,
    };
}
/** Rounds a requirement up to whole lots. */
export function unitise(qty: number, lot: number) {
    if (!(qty > 0)) return { qty: 0, lots: 0, excess: 0 };
    const l = lot > 0 ? lot : 1;
    const lots = Math.ceil(qty / l - 1e-9);
    return { qty: r3(lots * l), lots, excess: r3(lots * l - qty) };
}

// ----- 5  MRP -----

export interface MaterialPosition {
    available: number;
    safetyStock: number;
    openSupply: number;
    unitCost: number;
    leadDays: number;
    moq: number | null;
    orderMultiple: number | null;
    name?: string;
    uom?: string;
    number?: string;
}
export interface SkuInfo { name: string; uom: string; category: string; processClassId: string; whole: boolean }
export interface MrpBucketRow { key: string; gross: number; scheduled: number; projected: number; net: number; receipt: number; release: number }
export interface MrpItem {
    key: string;
    kind: ComponentKind;
    id: string;
    warehouseId: string;
    name: string;
    uom: string;
    level: number;
    lot: number;
    leadBuckets: number;
    rows: MrpBucketRow[];
    totals: { gross: number; receipts: number; value: number; excess: number };
    pastDue: number;
    parents: string[];
    unitCost: number;
    notes: string[];
}
const leadBucketsOf = (leadDays: number) => (leadDays > 0 ? Math.ceil(leadDays / 30.4375 - 1e-9) : 0);
/** Lot sizing for a bought material: at least the MOQ, in order multiples. */
export function buyLot(net: number, moq: number | null, multiple: number | null) {
    if (net <= 0) return 0;
    let q = Math.max(net, moq ?? 0);
    if (multiple && multiple > 0) q = Math.ceil(q / multiple - 1e-9) * multiple;
    return r3(q);
}
/**
 * Multi-level MRP over the plan buckets. `demand` is the top-level SKU demand per bucket. Intermediates are exploded in
 * low-level-code order so every parent's planned orders are known before a component is netted.
 */
export function runMrp(a: {
    buckets: Bucket[];
    demand: Map<string, number[]>;
    bomOf: (skuId: string) => BomIn | null;
    unitOf: (skuId: string, bom: BomIn) => Unitisation;
    skus: Map<string, SkuInfo>;
    materialOf: (materialId: string, warehouseId: string) => MaterialPosition | null;
    skuStock?: Map<string, number>;
}): { items: MrpItem[]; skuPlan: Map<string, { rows: MrpBucketRow[]; lot: number; lots: number[] }>; issues: string[] } {
    const open = a.buckets.map((b) => b.fraction > 0);
    const B = a.buckets.length;
    const issues: string[] = [];
    // Low-level codes: the deepest level at which an item appears.
    const level = new Map<string, number>();
    const visit = (sku: string, depth: number, path: Set<string>) => {
        if (path.has(sku)) {
            issues.push(`BOM cycle through ${sku}: explosion stopped.`);
            return;
        }
        if ((level.get(`SKU:${sku}`) ?? -1) >= depth && depth > 0) return;
        level.set(`SKU:${sku}`, Math.max(level.get(`SKU:${sku}`) ?? 0, depth));
        const bom = a.bomOf(sku);
        if (!bom) return;
        const next = new Set(path).add(sku);
        for (const c of bom.components) {
            const k = componentKey(c);
            if (componentKind(c) === 'sku') visit(s(c.skuId), depth + 1, next);
            else level.set(k + (c.warehouseId ? `@${c.warehouseId}` : ''), Math.max(level.get(k + (c.warehouseId ? `@${c.warehouseId}` : '')) ?? 0, depth + 1));
        }
    };
    for (const sku of a.demand.keys()) visit(sku, 0, new Set());

    const gross = new Map<string, number[]>();
    const parents = new Map<string, Set<string>>();
    const add = (key: string, i: number, q: number, parent: string) => {
        if (!gross.has(key)) gross.set(key, Array(B).fill(0));
        gross.get(key)![i] += q;
        if (parent) (parents.get(key) ?? parents.set(key, new Set()).get(key)!).add(parent);
    };
    for (const [sku, qty] of a.demand) qty.forEach((q, i) => q > 0 && add(`SKU:${sku}`, i, q, ''));

    const skuPlan = new Map<string, { rows: MrpBucketRow[]; lot: number; lots: number[] }>();
    const items: MrpItem[] = [];
    const meta = new Map<string, { kind: ComponentKind; id: string; warehouseId: string; uom: string }>();
    const order = [...level.entries()].sort((x, y) => x[1] - y[1]);
    for (const [key] of order) {
        if (!key.startsWith('SKU:')) continue;
        const sku = key.slice(4);
        const g = gross.get(key) ?? Array(B).fill(0);
        const info = a.skus.get(sku);
        const bom = a.bomOf(sku);
        const notes: string[] = [];
        if (!bom) notes.push('No approved BOM effective for this site: components cannot be planned.');
        const u = bom ? a.unitOf(sku, bom) : null;
        const lot = u?.lot ?? 1;
        let onHand = a.skuStock?.get(sku) ?? 0;
        const rows: MrpBucketRow[] = [];
        const lots: number[] = [];
        for (let i = 0; i < B; i++) {
            if (!open[i]) {
                rows.push({ key: a.buckets[i].key, gross: 0, scheduled: 0, projected: r3(onHand), net: 0, receipt: 0, release: 0 });
                lots.push(0);
                continue;
            }
            const need = g[i] - onHand;
            const net = Math.max(0, need);
            const plan = unitise(net, lot);
            onHand = onHand + plan.qty - g[i];
            rows.push({ key: a.buckets[i].key, gross: r3(g[i]), scheduled: 0, projected: r3(onHand), net: r3(net), receipt: plan.qty, release: plan.qty });
            lots.push(plan.lots);
            if (bom && plan.qty > 0) {
                for (const [ci, c] of bom.components.entries()) {
                    const kind = componentKind(c);
                    const scrap = 1 + (Number(c.scrapPct) || 0) / 100;
                    const line = u?.lines[ci] ?? null;
                    let q = (plan.qty / bom.outputQty) * c.quantity * scrap;
                    // Whole packs stay whole: round up an indivisible component after scrap.
                    if (line?.indivisible) q = Math.ceil(q / line.packSize - 1e-9) * line.packSize;
                    const ck = componentKey(c) + (kind === 'material' && c.warehouseId ? `@${c.warehouseId}` : '');
                    if (!meta.has(ck)) meta.set(ck, { kind, id: kind === 'sku' ? s(c.skuId) : kind === 'material' ? s(c.materialId) : s(c.supplyUtilityCode) || s(c.utilityCode), warehouseId: s(c.warehouseId), uom: c.uom });
                    add(ck, i, q, sku);
                }
            }
        }
        skuPlan.set(sku, { rows, lot, lots });
        const receipts = rows.reduce((t, r) => t + r.receipt, 0);
        const grossT = g.reduce((t, x) => t + x, 0);
        items.push({ key, kind: 'sku', id: sku, warehouseId: '', name: info?.name ?? sku, uom: info?.uom ?? '', level: level.get(key) ?? 0, lot, leadBuckets: 0, rows, totals: { gross: r3(grossT), receipts: r3(receipts), value: 0, excess: r3(Math.max(0, onHand)) }, pastDue: 0, parents: [...(parents.get(key) ?? [])], unitCost: 0, notes });
    }
    // Bought materials and utilities (leaves): gross-to-net with stock, safety stock, open supply, MOQ and lead time.
    for (const [key, m] of meta) {
        if (m.kind === 'sku') continue;
        const g = gross.get(key) ?? Array(B).fill(0);
        const notes: string[] = [];
        const rows: MrpBucketRow[] = a.buckets.map((b) => ({ key: b.key, gross: 0, scheduled: 0, projected: 0, net: 0, receipt: 0, release: 0 }));
        if (m.kind === 'utility') {
            g.forEach((q, i) => (rows[i].gross = r3(q)));
            items.push({ key, kind: 'utility', id: m.id, warehouseId: '', name: m.id, uom: m.uom, level: level.get(key.replace(/@.*/, '')) ?? 1, lot: 0, leadBuckets: 0, rows, totals: { gross: r3(g.reduce((t, x) => t + x, 0)), receipts: 0, value: 0, excess: 0 }, pastDue: 0, parents: [...(parents.get(key) ?? [])], unitCost: 0, notes: ['Utility: requirement only (metered supply, no stock netting).'] });
            continue;
        }
        const pos = m.warehouseId ? a.materialOf(m.id, m.warehouseId) : null;
        if (!m.warehouseId) notes.push('Process supply material with no warehouse: planned without stock netting.');
        else if (!pos) notes.push('Not set up in this warehouse: planned without stock netting.');
        const lead = leadBucketsOf(pos?.leadDays ?? 0);
        let onHand = (pos?.available ?? 0) - (pos?.safetyStock ?? 0);
        let scheduled = pos?.openSupply ?? 0;
        let pastDue = 0;
        const first = open.indexOf(true);
        for (let i = 0; i < B; i++) {
            const r = rows[i];
            if (!open[i]) {
                r.projected = r3(onHand);
                continue;
            }
            r.gross = r3(g[i]);
            // Open supply (requirements, requisitions, orders) is expected in the first open period.
            r.scheduled = i === first ? r3(scheduled) : 0;
            if (i === first) scheduled = 0;
            const before = onHand + r.scheduled - g[i];
            const net = before < 0 ? -before : 0;
            const receipt = buyLot(net, pos?.moq ?? null, pos?.orderMultiple ?? null);
            onHand = before + receipt;
            r.net = r3(net);
            r.receipt = receipt;
            r.projected = r3(onHand);
            if (receipt > 0) {
                const at = i - lead;
                if (at < first) pastDue += receipt;
                else rows[at].release = r3(rows[at].release + receipt);
            }
        }
        if (pastDue > 0) notes.push(`${r3(pastDue)} ${m.uom} must be ordered now: the lead time of ${pos?.leadDays ?? 0} days reaches before the first open period.`);
        if (pos && pos.uom && pos.uom.toUpperCase() !== m.uom.toUpperCase()) notes.push(`BOM unit ${m.uom} differs from the stock unit ${pos.uom}.`);
        const receipts = rows.reduce((t, r) => t + r.receipt, 0);
        items.push({ key, kind: 'material', id: m.id, warehouseId: m.warehouseId, name: pos?.name || m.id, uom: m.uom, level: level.get(key.replace(/@.*/, '')) ?? level.get(key) ?? 1, lot: pos?.orderMultiple ?? 0, leadBuckets: lead, rows, totals: { gross: r3(g.reduce((t, x) => t + x, 0)), receipts: r3(receipts), value: r2(receipts * (pos?.unitCost ?? 0)), excess: r3(Math.max(0, onHand)) }, pastDue: r3(pastDue), parents: [...(parents.get(key) ?? [])], unitCost: pos?.unitCost ?? 0, notes });
    }
    items.sort((x, y) => x.level - y.level || x.kind.localeCompare(y.kind) || x.id.localeCompare(y.id));
    return { items, skuPlan, issues: [...new Set(issues)] };
}

// ----- 6  Rough-cut capacity -----

export interface StageIn { code?: string; name?: string; capacityBasis?: string; batchSize?: number; cycleMinutes?: number; flowRatePerHour?: number; runMinutesPerUnit?: number; setupMinutes?: number }
/** Bottleneck rate (output units per hour), set-up minutes per run and the largest vessel of a routing. */
export function routingRate(stages: StageIn[]) {
    let rate = Infinity;
    let bottleneck = '';
    let setup = 0;
    let vessel = 0;
    for (const st of stages) {
        const basis = s(st.capacityBasis);
        const r = basis === 'CONTINUOUS_FLOW' ? Number(st.flowRatePerHour) || 0 : basis === 'BATCH_CYCLE' ? ((Number(st.batchSize) || 0) * 60) / (Number(st.cycleMinutes) || Infinity) : (Number(st.runMinutesPerUnit) || 0) > 0 ? 60 / Number(st.runMinutesPerUnit) : 0;
        if (basis === 'BATCH_CYCLE' && Number(st.batchSize) > vessel) vessel = Number(st.batchSize);
        setup += Number(st.setupMinutes) || 0;
        if (r > 0 && r < rate) {
            rate = r;
            bottleneck = s(st.name) || s(st.code);
        }
    }
    return { ratePerHour: Number.isFinite(rate) ? r3(rate) : 0, bottleneck, setupMinutes: setup, vessel: vessel || null };
}
export const hoursAvailable = (b: Bucket, setup: Pick<PlanningSetup, 'hoursPerDay' | 'workingDaysPerWeek' | 'oeePct'>) => r2(b.days * b.fraction * (setup.workingDaysPerWeek / 7) * setup.hoursPerDay * (setup.oeePct / 100));
export interface CapacityRow { routingId: string; name: string; skus: string[]; ratePerHour: number; bottleneck: string; buckets: Array<{ key: string; required: number; available: number; utilisation: number | null; runs: number }>; peak: number | null; overloaded: string[] }
export function roughCut(a: { buckets: Bucket[]; routings: Array<{ id: string; name: string; stages: StageIn[]; skus: string[] }>; production: Map<string, number[]>; setup: PlanningSetup }): CapacityRow[] {
    return a.routings.map((rt) => {
        const rr = routingRate(rt.stages);
        const rows = a.buckets.map((b, i) => {
            const qty = rt.skus.reduce((t, sku) => t + (a.production.get(sku)?.[i] ?? 0), 0);
            const runs = qty > 0 ? (rr.vessel ? Math.ceil(qty / rr.vessel - 1e-9) : 1) : 0;
            const required = rr.ratePerHour > 0 ? qty / rr.ratePerHour + (runs * rr.setupMinutes) / 60 : 0;
            const available = hoursAvailable(b, a.setup);
            return { key: b.key, required: r2(required), available, utilisation: available > 0 ? r2((required / available) * 100) : required > 0 ? null : 0, runs };
        });
        const util = rows.map((r) => r.utilisation).filter((u): u is number => u !== null);
        return { routingId: rt.id, name: rt.name, skus: rt.skus, ratePerHour: rr.ratePerHour, bottleneck: rr.bottleneck, buckets: rows, peak: util.length ? Math.max(...util) : null, overloaded: rows.filter((r) => r.utilisation === null || r.utilisation > a.setup.overloadPct).filter((r) => r.required > 0).map((r) => r.key) };
    });
}

// ----- 7  S&OP summary -----

export function sopSummary(a: { buckets: Bucket[]; forecasts: SkuForecast[]; mrp: ReturnType<typeof runMrp>; capacity: CapacityRow[]; skus: Map<string, SkuInfo> }) {
    const families = new Map<string, { family: string; skus: number; buckets: Array<{ key: string; demand: number; production: number; inventory: number }> }>();
    for (const f of a.forecasts) {
        const info = a.skus.get(f.skuId);
        const fam = info?.processClassId || info?.category || 'Other';
        const plan = a.mrp.skuPlan.get(f.skuId);
        const g = families.get(fam) ?? { family: fam, skus: 0, buckets: a.buckets.map((b) => ({ key: b.key, demand: 0, production: 0, inventory: 0 })) };
        g.skus += 1;
        f.buckets.forEach((b, i) => {
            g.buckets[i].demand = r3(g.buckets[i].demand + b.demand);
            g.buckets[i].production = r3(g.buckets[i].production + (plan?.rows[i]?.receipt ?? 0));
            g.buckets[i].inventory = r3(g.buckets[i].inventory + (plan?.rows[i]?.projected ?? 0));
        });
        families.set(fam, g);
    }
    const materials = a.mrp.items.filter((i) => i.kind === 'material');
    const demand = a.forecasts.reduce((t, f) => t + f.totals.demand, 0);
    const production = [...a.mrp.skuPlan.entries()].filter(([sku]) => a.forecasts.some((f) => f.skuId === sku)).reduce((t, [, p]) => t + p.rows.reduce((x, r) => x + r.receipt, 0), 0);
    const purchaseByBucket = a.buckets.map((b, i) => r2(materials.reduce((t, m) => t + m.rows[i].receipt * m.unitCost, 0)));
    return {
        families: [...families.values()].sort((x, y) => x.family.localeCompare(y.family)),
        kpis: {
            skus: a.forecasts.length,
            demand: r3(demand),
            production: r3(production),
            unitisationExcess: r3(Math.max(0, production - demand)),
            purchaseValue: r2(materials.reduce((t, m) => t + m.totals.value, 0)),
            materials: materials.length,
            pastDue: materials.filter((m) => m.pastDue > 0).length,
            overloaded: a.capacity.filter((c) => c.overloaded.length).length,
            peakUtilisation: a.capacity.reduce((t, c) => Math.max(t, c.peak ?? 0), 0),
            withoutBom: a.mrp.items.filter((i) => i.kind === 'sku' && i.notes.some((x) => x.startsWith('No approved BOM'))).length,
        },
        purchaseByBucket,
    };
}

// ----- 8  Workflow -----

export type PlanStatus = 'draft' | 'demand_review' | 'supply_planning' | 'sop_review' | 'approved' | 'released' | 'superseded' | 'cancelled';
export type PlanAction = 'edit_demand' | 'run_forecast' | 'submit_demand' | 'approve_demand' | 'return_demand' | 'run_supply' | 'submit_supply' | 'approve_sop' | 'return_sop' | 'release' | 'cancel';
export const PLAN_STEPS: Array<{ status: PlanStatus; label: string; role: string }> = [
    { status: 'draft', label: 'Demand planning', role: 'Demand Planner' },
    { status: 'demand_review', label: 'Demand review', role: 'Demand Manager' },
    { status: 'supply_planning', label: 'Supply planning & MRP', role: 'Supply Planner' },
    { status: 'sop_review', label: 'Executive S&OP', role: 'S&OP Approver (Chart of Authority)' },
    { status: 'approved', label: 'Approved', role: 'Planning Releaser' },
    { status: 'released', label: 'Released', role: '' },
];
export const ACTION_PERMISSION: Record<PlanAction, string> = {
    edit_demand: 'PLN.demand.plan',
    run_forecast: 'PLN.demand.plan',
    submit_demand: 'PLN.demand.plan',
    approve_demand: 'PLN.demand.approve',
    return_demand: 'PLN.demand.approve',
    run_supply: 'PLN.supply.plan',
    submit_supply: 'PLN.supply.plan',
    approve_sop: 'PLN.sop.approve',
    return_sop: 'PLN.sop.approve',
    release: 'PLN.mrp.release',
    cancel: 'PLN.demand.plan',
};
const FROM: Record<PlanAction, PlanStatus[]> = {
    edit_demand: ['draft'],
    run_forecast: ['draft'],
    submit_demand: ['draft'],
    approve_demand: ['demand_review'],
    return_demand: ['demand_review'],
    run_supply: ['supply_planning'],
    submit_supply: ['supply_planning'],
    approve_sop: ['sop_review'],
    return_sop: ['sop_review'],
    release: ['approved'],
    cancel: ['draft', 'demand_review', 'supply_planning'],
};
export interface PlanActors { createdBy?: string; demandSubmittedBy?: string; demandApprovedBy?: string; supplySubmittedBy?: string; sopApprovers?: string[] }
/**
 * May `uid` take `action` on a plan in `status`? Returns the reason when not. Independence: the demand reviewer is not
 * the planner who prepared or submitted the demand; the S&OP approvers are none of the planners or the demand reviewer
 * and never approve two levels; the releaser is not the person who gave the final approval.
 */
export function transitionCheck(status: PlanStatus, action: PlanAction, uid: string, actors: PlanActors, extra: { forecastRun?: boolean; supplyRun?: boolean; supplyStale?: boolean } = {}): string {
    if (!FROM[action].includes(status)) return `A plan that is ${status.replace('_', ' ')} cannot be ${action.replace('_', ' ')}d.`;
    if (action === 'submit_demand' && !extra.forecastRun) return 'Run the SKU forecast before submitting the demand plan.';
    if (action === 'submit_supply' && !extra.supplyRun) return 'Run supply planning (unitisation, MRP and capacity) before submitting.';
    if (action === 'submit_supply' && extra.supplyStale) return 'The masters or stock changed since the last supply run: run it again before submitting.';
    if ((action === 'approve_demand' || action === 'return_demand') && (uid === actors.createdBy || uid === actors.demandSubmittedBy)) return 'You prepared this demand plan, so an independent Demand Manager must review it.';
    if (action === 'approve_sop' || action === 'return_sop') {
        if ([actors.createdBy, actors.demandSubmittedBy, actors.demandApprovedBy, actors.supplySubmittedBy].includes(uid)) return 'You prepared or reviewed this plan, so an independent S&OP approver must decide.';
        if (action === 'approve_sop' && (actors.sopApprovers ?? []).includes(uid)) return 'You approved an earlier level, so a different person must approve this one.';
    }
    if (action === 'release' && (actors.sopApprovers ?? []).slice(-1)[0] === uid) return 'You gave the final approval, so another person must release the plan.';
    return '';
}
export const NEXT_STATUS: Partial<Record<PlanAction, PlanStatus>> = {
    submit_demand: 'demand_review',
    approve_demand: 'supply_planning',
    return_demand: 'draft',
    submit_supply: 'sop_review',
    return_sop: 'supply_planning',
    release: 'released',
    cancel: 'cancelled',
};
