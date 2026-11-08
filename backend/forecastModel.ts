/**
 * Demand forecasting for one material in one warehouse. Pure: no reads, no writes; shared by the server (which derives
 * and enforces the levels from real data) and the material screen (interactive masking, simulation and charts).
 *
 * Demand = issues − reversals (returns of issued stock) per month. Receipts are shown for context but are never demand.
 * Masked (blinded) movements are left out of the demand. The forecast is fitted on completed months only, from the
 * first issue in the past horizon onwards, so months before the material was used do not drag the average down.
 *
 * Methods (one-step-ahead errors decide "auto"): simple and weighted moving average, simple exponential smoothing,
 * Holt's damped trend, linear regression and Croston/SBA for intermittent demand (Syntetos–Boylan classification).
 * Optional multiplicative seasonal indices need 24 months. Planned events (overhauls, peaks, projects) are added on top.
 *
 * Levels (units):
 *   L   = (external + internal lead time) / 30.44 months,  d = forecast demand per month,  σ = forecast error (RMSE)
 *   SS  = z · √(L·σ² + d²·σL²)        z from the service level of the criticality class, σL = L · variability %
 *   ROP = forecast demand over the lead time + SS        Minimum = ROP
 *   ROQ = forecast demand over the cover period, or EOQ = √(2·D·S / (h·price)); then MOQ and order multiple
 *   Maximum = Minimum + ROQ (so a Min-Max order at the minimum is exactly the ROQ)
 */

import { CONSUMPTION_TYPES, RETURN_TYPES } from './replenishmentPlan';

export type Kind = 'issue' | 'receipt' | 'reversal';
export interface Instance {
    id: string;
    at: string;
    kind: Kind;
    qty: number;
    type: string;
    reference: string;
    simulated?: boolean;
    note?: string;
}

export const RECEIPT_TYPES = ['GOODS_RECEIPT', 'GR_STOCK', 'PO_RECEIPT', 'STOCK_RECEIPT', 'TRANSFER_IN', 'STOCK_TRANSFER_IN'];

/** Movement kind of a posted journal entry (quantity is the change in physical stock), or null if it is not demand-related. */
export function classify(type: string, qty: number): Kind | null {
    const t = String(type || '').toUpperCase();
    if (!Number.isFinite(qty) || qty === 0) return null;
    if (CONSUMPTION_TYPES.includes(t)) return qty < 0 ? 'issue' : 'reversal';
    if (RETURN_TYPES.includes(t) && qty > 0) return 'reversal';
    if (RECEIPT_TYPES.includes(t) && qty > 0) return 'receipt';
    return null;
}

// ----- Setup -----

export type LevelMode = 'forecast' | 'manual' | 'manual_unless_forced';
export type Method = 'auto' | 'sma' | 'wma' | 'ses' | 'holt' | 'linear' | 'croston';
export const METHODS: Array<{ code: Exclude<Method, 'auto'>; name: string; note: string }> = [
    { code: 'sma', name: 'Moving average', note: 'Average of the last months; steady demand.' },
    { code: 'wma', name: 'Weighted moving average', note: 'Recent months weigh more; reacts faster.' },
    { code: 'ses', name: 'Exponential smoothing', note: 'Smoothed level; steady demand with noise.' },
    { code: 'holt', name: 'Holt damped trend', note: 'Level and trend; rising or falling demand.' },
    { code: 'linear', name: 'Linear regression', note: 'Straight-line trend over the history.' },
    { code: 'croston', name: 'Croston (SBA)', note: 'Intermittent spare-part demand with many zero months.' },
];
export const LEVEL_FIELDS = ['minimumLevel', 'maximumLevel', 'reorderQuantity', 'safetyStock', 'reorderPoint'] as const;

export interface ForecastSetup {
    levelMode: LevelMode;
    minHistoryMonths: number;
    pastMonths: number;
    futureMonths: number;
    method: Method;
    window: number;
    alpha: number;
    beta: number;
    seasonal: boolean;
    excludeOutliers: boolean;
    outlierZ: number;
    serviceLevels: { A: number; B: number; C: number; D: number; none: number };
    internalLeadDays: number;
    leadTimeVariabilityPct: number;
    roqMethod: 'cover' | 'eoq';
    coverDays: number;
    orderingCost: number;
    holdingPct: number;
    wholeUnits: boolean;
}

export function defaultForecastSetup(): ForecastSetup {
    return {
        levelMode: 'manual',
        minHistoryMonths: 6,
        pastMonths: 12,
        futureMonths: 6,
        method: 'auto',
        window: 3,
        alpha: 0.3,
        beta: 0.1,
        seasonal: false,
        excludeOutliers: true,
        outlierZ: 3.5,
        serviceLevels: { A: 99, B: 97.5, C: 95, D: 90, none: 95 },
        internalLeadDays: 3,
        leadTimeVariabilityPct: 20,
        roqMethod: 'cover',
        coverDays: 60,
        orderingCost: 0,
        holdingPct: 20,
        wholeUnits: true,
    };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v: unknown, label: string, min: number, max: number, integer = false): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}from ${min} to ${max}`);
    return n;
}

/** Validates a setup (throws an Error with the message to show). */
export function readForecastSetup(v: unknown): ForecastSetup {
    if (!isObj(v)) throw new Error('Setup required');
    const d = defaultForecastSetup();
    const levelMode = String(v.levelMode ?? d.levelMode) as LevelMode;
    if (!['forecast', 'manual', 'manual_unless_forced'].includes(levelMode)) throw new Error('Choose how minimum, maximum and reorder quantity are set');
    const method = String(v.method ?? d.method) as Method;
    if (!['auto', ...METHODS.map((m) => m.code)].includes(method)) throw new Error('Choose a forecast method');
    const roqMethod = String(v.roqMethod ?? d.roqMethod) as ForecastSetup['roqMethod'];
    if (!['cover', 'eoq'].includes(roqMethod)) throw new Error('Choose how the reorder quantity is worked out');
    const sl = isObj(v.serviceLevels) ? v.serviceLevels : d.serviceLevels;
    const serviceLevels = {
        A: num(sl.A, 'Service level A', 50, 99.9),
        B: num(sl.B, 'Service level B', 50, 99.9),
        C: num(sl.C, 'Service level C', 50, 99.9),
        D: num(sl.D, 'Service level D', 50, 99.9),
        none: num(sl.none, 'Service level for unassessed materials', 50, 99.9),
    };
    if (!(serviceLevels.A >= serviceLevels.B && serviceLevels.B >= serviceLevels.C && serviceLevels.C >= serviceLevels.D)) throw new Error('Service levels must not increase from A to D');
    const out: ForecastSetup = {
        levelMode,
        minHistoryMonths: num(v.minHistoryMonths ?? d.minHistoryMonths, 'Minimum history', 6, 24, true),
        pastMonths: num(v.pastMonths ?? d.pastMonths, 'Past horizon', 6, 36, true),
        futureMonths: num(v.futureMonths ?? d.futureMonths, 'Future horizon', 1, 24, true),
        method,
        window: num(v.window ?? d.window, 'Moving average window', 2, 12, true),
        alpha: num(v.alpha ?? d.alpha, 'Smoothing alpha', 0.05, 0.9),
        beta: num(v.beta ?? d.beta, 'Trend beta', 0.01, 0.5),
        seasonal: v.seasonal === true,
        excludeOutliers: v.excludeOutliers !== false,
        outlierZ: num(v.outlierZ ?? d.outlierZ, 'Outlier limit', 2, 6),
        serviceLevels,
        internalLeadDays: num(v.internalLeadDays ?? d.internalLeadDays, 'Internal lead time', 0, 120, true),
        leadTimeVariabilityPct: num(v.leadTimeVariabilityPct ?? d.leadTimeVariabilityPct, 'Lead time variability', 0, 100),
        roqMethod,
        coverDays: num(v.coverDays ?? d.coverDays, 'Cover period', 7, 365, true),
        orderingCost: num(v.orderingCost ?? d.orderingCost, 'Ordering cost', 0, 1e9),
        holdingPct: num(v.holdingPct ?? d.holdingPct, 'Holding cost', 1, 100),
        wholeUnits: v.wholeUnits !== false,
    };
    if (out.pastMonths < out.minHistoryMonths) throw new Error('The past horizon must cover at least the minimum history');
    return out;
}

/**
 * Whether the levels of a material come from the forecast:
 *   forecast              from the forecast when there are at least the minimum months of issue history, else manual
 *   manual                always manual
 *   manual_unless_forced  manual unless the material is switched to forecasting (levelsSource 'forecast')
 */
export function effectiveSource(setup: Pick<ForecastSetup, 'levelMode' | 'minHistoryMonths'>, info: Record<string, unknown> | null | undefined, historyMonths: number): { source: 'forecast' | 'manual'; why: string } {
    if (setup.levelMode === 'manual') return { source: 'manual', why: 'The forecasting setup keeps minimum, maximum and reorder quantity manual for every material.' };
    if (setup.levelMode === 'forecast') {
        if (historyMonths < setup.minHistoryMonths) return { source: 'manual', why: `Only ${historyMonths} of the ${setup.minHistoryMonths} months of issue history needed, so the levels stay manual until there is enough data.` };
        return { source: 'forecast', why: `The forecasting setup derives the levels from the forecast (${historyMonths} months of issue history).` };
    }
    if (String(info?.levelsSource ?? '') === 'forecast') return { source: 'forecast', why: 'This material is switched to forecasting.' };
    return { source: 'manual', why: 'Manual unless the material is switched to forecasting.' };
}

// ----- Calendar (East Africa Time, as the rest of MEMS) -----

const OFFSET = 3 * 3_600_000;
export const localDay = (iso: string) => new Date(Date.parse(iso) + OFFSET).toISOString().slice(0, 10);
export const monthOf = (iso: string) => localDay(iso).slice(0, 7);
export function addMonths(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
}
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export function monthsBetween(a: string, b: string): number {
    return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}

// ----- History -----

export interface MonthRow {
    month: string;
    issues: number;
    receipts: number;
    reversals: number;
    demand: number;
    count: number;
    masked: number;
    partial: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Receipts, issues and reversals per month for the past horizon, ending with the current (partial) month. */
export function monthlyHistory(instances: Instance[], masked: Set<string>, nowMonth: string, pastMonths: number): MonthRow[] {
    const rows: MonthRow[] = [];
    for (let i = pastMonths - 1; i >= 0; i--) rows.push({ month: addMonths(nowMonth, -i), issues: 0, receipts: 0, reversals: 0, demand: 0, count: 0, masked: 0, partial: i === 0 });
    const index = new Map(rows.map((r, i) => [r.month, i]));
    for (const x of instances) {
        const i = index.get(monthOf(x.at));
        if (i === undefined) continue;
        const r = rows[i];
        r.count++;
        if (masked.has(x.id)) {
            r.masked++;
            continue;
        }
        if (x.kind === 'issue') r.issues += x.qty;
        else if (x.kind === 'receipt') r.receipts += x.qty;
        else r.reversals += x.qty;
    }
    for (const r of rows) {
        r.issues = r3(r.issues);
        r.receipts = r3(r.receipts);
        r.reversals = r3(r.reversals);
        r.demand = r3(Math.max(0, r.issues - r.reversals));
    }
    return rows;
}

/** Months of issue history: from the first unmasked issue to now. */
export function historyMonthsOf(instances: Instance[], masked: Set<string>, nowIso: string): number {
    let first = Infinity;
    for (const x of instances) if (x.kind === 'issue' && !masked.has(x.id)) first = Math.min(first, Date.parse(x.at));
    if (!Number.isFinite(first)) return 0;
    return Math.max(0, Math.floor((Date.parse(nowIso) - first) / (30.44 * 86_400_000)));
}

// ----- Statistics -----

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function median(a: number[]) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const stdev = (a: number[]) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** Inverse of the standard normal distribution (Acklam), for the safety factor z of a service level. */
export function inverseNormal(p: number): number {
    if (!(p > 0 && p < 1)) throw new Error('Probability must be between 0 and 1');
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export type Pattern = 'smooth' | 'erratic' | 'intermittent' | 'lumpy' | 'none';
/** Syntetos–Boylan demand pattern: average demand interval (ADI) and squared coefficient of variation of the sizes. */
export function demandPattern(series: number[]): { pattern: Pattern; adi: number; cv2: number } {
    const sizes = series.filter((x) => x > 0);
    if (!sizes.length) return { pattern: 'none', adi: 0, cv2: 0 };
    const adi = series.length / sizes.length;
    const m = mean(sizes);
    const cv2 = sizes.length > 1 && m > 0 ? (stdev(sizes) / m) ** 2 : 0;
    const pattern: Pattern = adi < 1.32 ? (cv2 < 0.49 ? 'smooth' : 'erratic') : cv2 < 0.49 ? 'intermittent' : 'lumpy';
    return { pattern, adi: r3(adi), cv2: r3(cv2) };
}

/** Least-squares trend of the series with its t statistic: significant when |t| ≥ 2 with at least 4 months. */
export function trendOf(series: number[]): { slope: number; intercept: number; t: number; direction: 'increasing' | 'decreasing' | 'stable'; pctPerMonth: number } {
    const n = series.length;
    if (n < 2) return { slope: 0, intercept: series[0] ?? 0, t: 0, direction: 'stable', pctPerMonth: 0 };
    const xm = (n - 1) / 2;
    const ym = mean(series);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
        sxx += (i - xm) ** 2;
        sxy += (i - xm) * (series[i] - ym);
    }
    const slope = sxy / sxx;
    const intercept = ym - slope * xm;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (series[i] - (intercept + slope * i)) ** 2;
    const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
    const t = se > 0 ? slope / se : slope !== 0 && n > 2 ? Math.sign(slope) * 99 : 0;
    const direction = n >= 4 && Math.abs(t) >= 2 && slope !== 0 ? (slope > 0 ? 'increasing' : 'decreasing') : 'stable';
    return { slope: r3(slope), intercept: r3(intercept), t: Math.round(t * 100) / 100, direction, pctPerMonth: ym > 0 ? Math.round((slope / ym) * 1000) / 10 : 0 };
}

interface Fit {
    fitted: Array<number | null>;
    forecast: (h: number) => number;
}

const PHI = 0.98;
function fitMethod(series: number[], method: Exclude<Method, 'auto'>, p: Pick<ForecastSetup, 'window' | 'alpha' | 'beta'>): Fit {
    const n = series.length;
    const fitted: Array<number | null> = new Array(n).fill(null);
    if (!n) return { fitted, forecast: () => 0 };
    if (method === 'sma' || method === 'wma') {
        const avg = (end: number) => {
            const from = Math.max(0, end - p.window);
            const part = series.slice(from, end);
            if (!part.length) return null;
            if (method === 'sma') return mean(part);
            let w = 0;
            let s = 0;
            part.forEach((x, i) => {
                w += i + 1;
                s += x * (i + 1);
            });
            return s / w;
        };
        for (let t = 1; t < n; t++) fitted[t] = avg(t);
        const last = avg(n) ?? 0;
        return { fitted, forecast: () => last };
    }
    if (method === 'ses') {
        let level = series[0];
        for (let t = 1; t < n; t++) {
            fitted[t] = level;
            level = p.alpha * series[t] + (1 - p.alpha) * level;
        }
        return { fitted, forecast: () => level };
    }
    if (method === 'holt') {
        let level = series[0];
        let trend = n > 1 ? series[1] - series[0] : 0;
        for (let t = 1; t < n; t++) {
            fitted[t] = Math.max(0, level + PHI * trend);
            const prev = level;
            level = p.alpha * series[t] + (1 - p.alpha) * (level + PHI * trend);
            trend = p.beta * (level - prev) + (1 - p.beta) * PHI * trend;
        }
        return {
            fitted,
            forecast: (h) => {
                let damp = 0;
                for (let i = 1; i <= h; i++) damp += PHI ** i;
                return Math.max(0, level + damp * trend);
            },
        };
    }
    if (method === 'linear') {
        for (let t = 3; t < n; t++) {
            const tr = trendOf(series.slice(0, t));
            fitted[t] = Math.max(0, tr.intercept + tr.slope * t);
        }
        const tr = trendOf(series);
        return { fitted, forecast: (h) => Math.max(0, tr.intercept + tr.slope * (n - 1 + h)) };
    }
    // Croston with the Syntetos–Boylan bias correction: size and interval smoothed separately.
    let size = 0;
    let interval = 0;
    let gap = 1;
    let started = false;
    for (let t = 0; t < n; t++) {
        if (started) fitted[t] = (1 - p.alpha / 2) * (size / interval);
        if (series[t] > 0) {
            if (!started) {
                size = series[t];
                interval = gap;
                started = true;
            } else {
                size = p.alpha * series[t] + (1 - p.alpha) * size;
                interval = p.alpha * gap + (1 - p.alpha) * interval;
            }
            gap = 1;
        } else gap++;
    }
    const f = started ? (1 - p.alpha / 2) * (size / interval) : 0;
    return { fitted, forecast: () => f };
}

/** One-step-ahead errors of a fit (the first two months are warm-up). */
function accuracy(series: number[], fitted: Array<number | null>) {
    const e: number[] = [];
    for (let t = 2; t < series.length; t++) if (fitted[t] !== null) e.push(series[t] - (fitted[t] as number));
    if (!e.length) return { mae: null as number | null, rmse: null as number | null, bias: null as number | null, points: 0 };
    return { mae: r3(mean(e.map(Math.abs))), rmse: r3(Math.sqrt(mean(e.map((x) => x * x)))), bias: r3(mean(e)), points: e.length };
}

/** Multiplicative month-of-year indices (normalized to an average of 1) from at least 24 months. */
function seasonalIndices(series: number[], months: string[]): Map<number, number> | null {
    if (series.length < 24) return null;
    const overall = mean(series);
    if (overall <= 0) return null;
    const by = new Map<number, number[]>();
    series.forEach((x, i) => {
        const m = Number(months[i].slice(5, 7));
        by.set(m, [...(by.get(m) ?? []), x / overall]);
    });
    const raw = new Map<number, number>();
    for (let m = 1; m <= 12; m++) raw.set(m, by.has(m) ? mean(by.get(m)!) : 1);
    const norm = mean([...raw.values()]) || 1;
    for (const [m, v] of raw) raw.set(m, Math.max(0.05, v / norm));
    return raw;
}

// ----- Planned events -----

export interface PlannedEvent {
    id: string;
    label: string;
    kind: 'overhaul' | 'peak' | 'project' | 'other';
    recurrence: 'once' | 'yearly';
    month: string;
    qty: number;
    upliftPct: number;
}

/** Validates planned events (throws an Error with the message to show). */
export function readEvents(v: unknown): PlannedEvent[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error('Planned events must be a list');
    if (v.length > 24) throw new Error('At most 24 planned events');
    return v.map((x, i) => {
        if (!isObj(x)) throw new Error(`Planned event ${i + 1} is invalid`);
        const label = String(x.label ?? '').trim();
        if (label.length < 3 || label.length > 80) throw new Error(`Planned event ${i + 1}: give a name of 3 to 80 characters`);
        const kind = String(x.kind ?? 'other') as PlannedEvent['kind'];
        if (!['overhaul', 'peak', 'project', 'other'].includes(kind)) throw new Error(`${label}: choose the kind of event`);
        const recurrence = String(x.recurrence ?? 'once') as PlannedEvent['recurrence'];
        if (!['once', 'yearly'].includes(recurrence)) throw new Error(`${label}: choose once or every year`);
        const month = String(x.month ?? '');
        if (recurrence === 'once' ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) : !/^(0[1-9]|1[0-2])$/.test(month)) throw new Error(`${label}: choose the ${recurrence === 'once' ? 'month' : 'month of the year'}`);
        const qty = num(x.qty ?? 0, `${label}: extra quantity`, 0, 1e9);
        const upliftPct = num(x.upliftPct ?? 0, `${label}: uplift`, 0, 1000);
        if (!qty && !upliftPct) throw new Error(`${label}: give an extra quantity or an uplift percentage`);
        const id = /^[A-Za-z0-9_-]{1,40}$/.test(String(x.id ?? '')) ? String(x.id) : `EV${i + 1}`;
        return { id, label, kind, recurrence, month, qty, upliftPct };
    });
}

const eventApplies = (e: PlannedEvent, month: string) => (e.recurrence === 'once' ? e.month === month : month.slice(5, 7) === e.month);

// ----- Forecast and levels -----

export interface ForecastInput {
    instances: Instance[];
    masked: string[];
    setup: ForecastSetup;
    events: PlannedEvent[];
    now: string;
    method?: Method;
    pastMonths?: number;
    futureMonths?: number;
    externalLeadDays: number;
    internalLeadDays?: number | null;
    criticalityClass?: string;
    unitPrice?: number | null;
    moq?: number | null;
    orderMultiple?: number | null;
}

export interface FutureRow {
    month: string;
    base: number;
    events: number;
    total: number;
    lower: number;
    upper: number;
    labels: string[];
}

export interface Levels {
    serviceLevel: number;
    z: number;
    externalLeadDays: number;
    internalLeadDays: number;
    leadDays: number;
    leadMonths: number;
    demandPerMonth: number;
    sigma: number;
    demandDuringLead: number;
    safetyStock: number;
    reorderPoint: number;
    reorderQuantity: number;
    minimumLevel: number;
    maximumLevel: number;
    roqBasis: string;
    notes: string[];
}

/** Demand over the next `months` (fractional) from the future rows, extending with the last month beyond the horizon. */
function demandOver(future: FutureRow[], months: number) {
    let left = months;
    let sum = 0;
    let i = 0;
    while (left > 1e-9) {
        const row = future[Math.min(i, future.length - 1)];
        const take = Math.min(1, left);
        sum += (row?.total ?? 0) * take;
        left -= take;
        i++;
    }
    return sum;
}

export function levelsFrom(future: FutureRow[], sigma: number, a: { setup: ForecastSetup; externalLeadDays: number; internalLeadDays: number; criticalityClass?: string; unitPrice?: number | null; moq?: number | null; orderMultiple?: number | null }): Levels {
    const s = a.setup;
    const cls = (['A', 'B', 'C', 'D'].includes(String(a.criticalityClass)) ? a.criticalityClass : 'none') as keyof ForecastSetup['serviceLevels'];
    const serviceLevel = s.serviceLevels[cls];
    const z = inverseNormal(serviceLevel / 100);
    const external = Math.max(0, Number(a.externalLeadDays) || 0);
    const internal = Math.max(0, Number(a.internalLeadDays) || 0);
    const leadDays = external + internal;
    const L = leadDays / 30.44;
    const notes: string[] = [];
    if (!external) notes.push('No supplier lead time is recorded (Procurement or Inventory information); only the internal lead time is used.');
    const d = future.length ? mean(future.map((f) => f.total)) : 0;
    const sigmaL = L * (s.leadTimeVariabilityPct / 100);
    const ss = z * Math.sqrt(L * sigma * sigma + d * d * sigmaL * sigmaL);
    const dlt = demandOver(future, L);
    const rop = dlt + ss;
    let roq: number;
    let roqBasis: string;
    const annual = d * 12;
    const price = Number(a.unitPrice) || 0;
    if (s.roqMethod === 'eoq' && price > 0 && s.orderingCost > 0 && annual > 0) {
        roq = Math.sqrt((2 * annual * s.orderingCost) / ((s.holdingPct / 100) * price));
        roqBasis = `EOQ √(2 × ${r3(annual)} × ${s.orderingCost} / (${s.holdingPct}% × ${price}))`;
    } else {
        if (s.roqMethod === 'eoq') notes.push('EOQ needs the unit price, the ordering cost and demand; the cover period is used instead.');
        roq = demandOver(future, s.coverDays / 30.44);
        roqBasis = `Forecast demand over ${s.coverDays} days`;
    }
    const moq = Number(a.moq) || 0;
    const mult = Number(a.orderMultiple) || 0;
    if (roq > 0 && moq > roq) {
        roq = moq;
        roqBasis += `, raised to the minimum order quantity ${moq}`;
    }
    if (roq > 0 && mult > 0) {
        const up = Math.ceil(roq / mult - 1e-9) * mult;
        if (Math.abs(up - roq) > 1e-9) roqBasis += `, rounded up to the order multiple ${mult}`;
        roq = up;
    }
    const round = (x: number) => (s.wholeUnits ? Math.ceil(x - 1e-9) : Math.round(x * 100) / 100);
    const safetyStock = round(ss);
    const reorderPoint = round(rop);
    const reorderQuantity = Math.max(0, round(roq)) + 0;
    if (!d && !dlt) notes.push('No demand is forecast: the levels are zero. Consider buying on demand.');
    return {
        serviceLevel,
        z: Math.round(z * 1000) / 1000,
        externalLeadDays: external,
        internalLeadDays: internal,
        leadDays,
        leadMonths: r3(L),
        demandPerMonth: r3(d),
        sigma: r3(sigma),
        demandDuringLead: r3(dlt),
        safetyStock,
        reorderPoint,
        reorderQuantity,
        minimumLevel: reorderPoint,
        maximumLevel: round(reorderPoint + reorderQuantity),
        roqBasis,
        notes,
    };
}

export function runForecast(input: ForecastInput) {
    const s = input.setup;
    const pastMonths = Math.min(36, Math.max(3, Math.round(input.pastMonths ?? s.pastMonths)));
    const futureMonths = Math.min(24, Math.max(1, Math.round(input.futureMonths ?? s.futureMonths)));
    const masked = new Set(input.masked);
    const nowMonth = monthOf(input.now);
    const past = monthlyHistory(input.instances, masked, nowMonth, pastMonths);
    const complete = past.filter((r) => !r.partial);
    // Fit from the first month with an issue: months before the material was used are not zero demand.
    const firstUsed = complete.findIndex((r) => r.demand > 0);
    const used = firstUsed < 0 ? [] : complete.slice(firstUsed);
    const months = used.map((r) => r.month);
    const raw = used.map((r) => r.demand);
    // Outliers (robust z on the median absolute deviation) are capped, not dropped, so the month still counts.
    const med = median(raw);
    const mad = median(raw.map((x) => Math.abs(x - med))) * 1.4826;
    const spread = mad > 0 ? mad : stdev(raw);
    const cap = med + s.outlierZ * spread;
    const outliers = spread > 0 ? months.filter((_, i) => raw[i] > cap) : [];
    const series = s.excludeOutliers && outliers.length ? raw.map((x) => Math.min(x, cap)) : raw;

    const pattern = demandPattern(series);
    const trend = trendOf(series);
    const indices = s.seasonal ? seasonalIndices(series, months) : null;
    const work = indices ? series.map((x, i) => x / indices.get(Number(months[i].slice(5, 7)))!) : series;
    const requested = input.method ?? s.method;
    const intermittent = pattern.pattern === 'intermittent' || pattern.pattern === 'lumpy';
    // Auto: trend methods only when the trend is statistically significant, Croston only for intermittent demand.
    const trended = trend.direction !== 'stable';
    const candidates = (requested === 'auto' ? (intermittent ? ['croston', 'sma', 'ses'] : ['sma', 'wma', 'ses', ...(trended ? ['holt', 'linear'] : [])]) : [requested]) as Array<Exclude<Method, 'auto'>>;
    const scored = candidates.map((code) => {
        const fit = fitMethod(work, code, s);
        return { code, fit, ...accuracy(work, fit.fitted) };
    });
    const ranked = [...scored].sort((x, y) => (x.mae ?? Infinity) - (y.mae ?? Infinity) || (x.rmse ?? Infinity) - (y.rmse ?? Infinity));
    const best = ranked[0];
    const sigma = best.rmse !== null && best.points >= 3 ? best.rmse : stdev(series);
    const futureFrom = addMonths(nowMonth, 1);
    const future: FutureRow[] = [];
    for (let h = 1; h <= futureMonths; h++) {
        const month = addMonths(nowMonth, h);
        const si = indices?.get(Number(month.slice(5, 7))) ?? 1;
        const base = Math.max(0, best.fit.forecast(h) * si);
        const hits = input.events.filter((e) => eventApplies(e, month));
        const extra = hits.reduce((sum, e) => sum + e.qty + (base * e.upliftPct) / 100, 0);
        const band = 1.2816 * sigma * Math.sqrt(h);
        const total = base + extra;
        future.push({ month, base: r3(base), events: r3(extra), total: r3(total), lower: r3(Math.max(0, total - band)), upper: r3(total + band), labels: hits.map((e) => e.label) });
    }
    const historyMonths = historyMonthsOf(input.instances, masked, input.now);
    const levels = levelsFrom(future, sigma, {
        setup: s,
        externalLeadDays: input.externalLeadDays,
        internalLeadDays: input.internalLeadDays ?? s.internalLeadDays,
        criticalityClass: input.criticalityClass,
        unitPrice: input.unitPrice,
        moq: input.moq,
        orderMultiple: input.orderMultiple,
    });
    return {
        pastMonths,
        futureMonths,
        nowMonth,
        futureFrom,
        past,
        fitted: { months, series: series.map(r3), raw, values: best.fit.fitted.map((v, i) => (v === null ? null : r3(indices ? v * indices.get(Number(months[i].slice(5, 7)))! : v))) },
        outliers,
        pattern,
        trend,
        seasonal: !!indices,
        method: best.code,
        requested,
        candidates: scored.map((c) => ({ code: c.code, mae: c.mae, rmse: c.rmse, bias: c.bias, points: c.points })),
        accuracy: { mae: best.mae, rmse: best.rmse, bias: best.bias, points: best.points },
        sigma: r3(sigma),
        future,
        historyMonths,
        sufficient: historyMonths >= s.minHistoryMonths,
        levels,
    };
}
export type ForecastResult = ReturnType<typeof runForecast>;

// ----- Simulation (test data only; never saved) -----

function prng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * About 100 random movements over the last year to try the forecast: heavy (large, frequent, slowly rising issues) or
 * light (small, irregular issues), with receipts that replenish, a few reversals and always one one-off issue.
 */
export function simulate(profile: 'heavy' | 'light', seed: number, nowIso: string, count = 100): Instance[] {
    const rnd = prng(seed);
    const end = Date.parse(nowIso);
    const start = end - 365 * 86_400_000;
    const at = (f: number) => new Date(start + f * (end - start)).toISOString();
    const issues = Math.round(count * 0.7);
    const reversals = Math.round(count * 0.1);
    const receipts = count - issues - reversals - 1;
    const out: Instance[] = [];
    const base = profile === 'heavy' ? 24 : 2;
    const issueList: Array<{ f: number; qty: number }> = [];
    for (let i = 0; i < issues; i++) {
        // Heavy demand rises about 60% over the year; light demand is small and irregular.
        const f = rnd();
        const growth = profile === 'heavy' ? 0.7 + 0.6 * f : 1;
        const qty = Math.max(1, Math.round(base * growth * (profile === 'heavy' ? 0.7 + 0.6 * rnd() : 0.5 + rnd() * 1.5)));
        issueList.push({ f, qty });
    }
    issueList.sort((x, y) => x.f - y.f);
    issueList.forEach((x, i) => out.push({ id: `SIM-I${String(i + 1).padStart(3, '0')}`, at: at(x.f), kind: 'issue', qty: x.qty, type: 'GOODS_ISSUE', reference: `SIM-GI-${1000 + i}`, simulated: true }));
    const typical = Math.round(mean(issueList.map((x) => x.qty)));
    const spikeF = 0.35 + rnd() * 0.4;
    out.push({ id: 'SIM-ONEOFF', at: at(spikeF), kind: 'issue', qty: Math.max(10, typical * 10), type: 'GOODS_ISSUE', reference: 'SIM-BREAKDOWN', simulated: true, note: 'One-off issue (breakdown or project): mask it to see its effect' });
    for (let i = 0; i < reversals; i++) {
        const src = issueList[Math.floor(rnd() * issueList.length)];
        const f = Math.min(0.999, src.f + rnd() * 0.03);
        out.push({ id: `SIM-R${String(i + 1).padStart(3, '0')}`, at: at(f), kind: 'reversal', qty: Math.max(1, Math.round(src.qty * (0.1 + rnd() * 0.3))), type: 'MATERIAL_RETURN', reference: `SIM-RET-${2000 + i}`, simulated: true });
    }
    const total = issueList.reduce((sum, x) => sum + x.qty, 0);
    for (let i = 0; i < receipts; i++) {
        const f = (i + 0.2 + rnd() * 0.6) / receipts;
        out.push({ id: `SIM-G${String(i + 1).padStart(3, '0')}`, at: at(Math.min(0.999, f)), kind: 'receipt', qty: Math.max(1, Math.round((total / receipts) * (0.8 + rnd() * 0.4))), type: 'GOODS_RECEIPT', reference: `SIM-GR-${3000 + i}`, simulated: true });
    }
    return out.sort((x, y) => x.at.localeCompare(y.at));
}
