/**
 * Material audit and the impact of level changes. Pure: no reads, no writes; the server gathers the inputs (current
 * levels and strategy, the criticality analysis, the forecast worked out in the background, stock, open supply and the
 * stock take adjustments) and saves the report, so audits can be trended over time.
 *
 * The audit reports:
 *   - what has not been done: criticality assessment (or overdue review), forecast levels, lead time
 *   - whether minimum, maximum, reorder quantity and the procurement strategy agree with the criticality analysis and the
 *     forecast (a tolerance decides what counts as out of line)
 *   - inconsistencies in stock count adjustments: repeated, one-directional (systematic loss or gain) or large
 *   - the risk (stock-out exposure) and opportunity (excess, slow or dead stock that ties up cash) of the stock held
 * Score = 100 − 15 per high, 7 per medium, 3 per low finding (never below 0).
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Area = 'criticality' | 'forecast' | 'levels' | 'strategy' | 'stock_take' | 'stock' | 'lead_time';
export interface Finding {
    code: string;
    area: Area;
    severity: Severity;
    title: string;
    detail: string;
    action: string;
    value?: number;
}

export interface Levels {
    minimumLevel: number | null;
    maximumLevel: number | null;
    reorderQuantity: number | null;
    safetyStock: number | null;
    reorderPoint: number | null;
}

export interface Adjustment {
    at: string;
    qty: number;
    reference: string;
}

export interface AuditInput {
    now: string;
    strategy: string;
    automated: boolean;
    strategySource: string;
    levels: Levels;
    criticality: { assessed: boolean; status: string; cell: string; cls: string; reviewDue: string; strategyMode: string; cutoff: string; onDemandCell: boolean };
    forecast: {
        levelSource: 'forecast' | 'manual';
        levelMode: string;
        appliedAt: string;
        appliedSimulated: boolean;
        historyMonths: number;
        minHistoryMonths: number;
        demandPerMonth: number;
        recommended: Levels | null;
        trend: string;
        leadDays: number;
        leadSource: string;
        onDemand: boolean;
    };
    stock: { physical: number; available: number; openSupply: number };
    unitCost: number;
    holdingPct: number;
    adjustments: Adjustment[];
    lastIssueAt: string;
    annualIssues: number;
    tolerancePct: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const n0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

export function auditMaterial(a: AuditInput) {
    const f: Finding[] = [];
    const add = (x: Finding) => f.push(x);
    const L = a.levels;
    const cost = a.unitCost > 0 ? a.unitCost : 0;
    const today = a.now.slice(0, 10);
    const d = Math.max(0, a.forecast.demandPerMonth);

    // ----- What has not been done -----
    if (!a.criticality.assessed) {
        add({ code: 'CRIT_MISSING', area: 'criticality', severity: a.criticality.strategyMode === 'criticality' ? 'high' : 'medium', title: 'No approved criticality assessment', detail: 'The service level, the on-demand rule and the review cycle all depend on it.', action: 'Assess the material on the Criticality Analysis tab and have it approved.' });
    } else if (a.criticality.reviewDue && a.criticality.reviewDue < today) {
        add({ code: 'CRIT_OVERDUE', area: 'criticality', severity: 'medium', title: 'Criticality review overdue', detail: `The review was due on ${a.criticality.reviewDue}.`, action: 'Review the assessment.' });
    }
    if (a.criticality.status === 'submitted') add({ code: 'CRIT_PENDING', area: 'criticality', severity: 'info', title: 'Criticality assessment waiting for approval', detail: 'A newer assessment is waiting for approval.', action: 'Approve or return it.' });
    if (!a.forecast.onDemand) {
        if (a.forecast.levelSource === 'forecast' && !a.forecast.appliedAt)
            add({ code: 'FC_NOT_APPLIED', area: 'forecast', severity: 'medium', title: 'Forecast levels never applied', detail: 'The levels come from the forecast, but no forecast proposal has been approved yet.', action: 'Propose the forecast levels on the Forecasting tab.' });
        if (a.forecast.appliedAt && Date.parse(a.now) - Date.parse(a.forecast.appliedAt) > 183 * 86_400_000)
            add({ code: 'FC_STALE', area: 'forecast', severity: 'low', title: 'Forecast levels older than six months', detail: `Last applied ${a.forecast.appliedAt.slice(0, 10)}.`, action: 'Refresh the forecast and propose again.' });
        if (a.forecast.appliedSimulated) add({ code: 'FC_SIMULATED', area: 'forecast', severity: 'medium', title: 'Levels applied from simulated data', detail: 'The levels in force were worked out from dummy movements, not real ones.', action: 'Propose levels from real data once there is enough history.' });
        if (a.forecast.historyMonths < a.forecast.minHistoryMonths)
            add({ code: 'FC_HISTORY', area: 'forecast', severity: 'info', title: 'Little issue history', detail: `${a.forecast.historyMonths} of the ${a.forecast.minHistoryMonths} months needed for a reliable forecast.`, action: 'Keep the levels under manual review until there is enough history.' });
    }
    if (!a.forecast.leadDays && a.automated) add({ code: 'LT_MISSING', area: 'lead_time', severity: 'high', title: 'No lead time', detail: 'No received purchase orders and no lead time on the material, so safety stock and the reorder point cannot be right.', action: 'Record the lead time in Inventory Information.' });
    else if (a.forecast.leadSource === 'material' && a.automated) add({ code: 'LT_ASSUMED', area: 'lead_time', severity: 'low', title: 'Lead time is an assumption', detail: 'There are not enough received purchase orders to measure it.', action: 'Check the material lead time against recent orders.' });

    // ----- Strategy against the criticality analysis -----
    if (a.criticality.onDemandCell && a.criticality.strategyMode === 'criticality' && a.strategy !== 'RP07')
        add({ code: 'STRAT_SHOULD_BE_ON_DEMAND', area: 'strategy', severity: 'high', title: 'Strategy not in line with the criticality analysis', detail: `Cell ${a.criticality.cell} is at or below the cutoff ${a.criticality.cutoff}, so the material should be bought on demand (RP07), but the strategy is ${a.strategy || 'not set'}.`, action: 'Approve the assessment again or correct the strategy.' });
    if (a.criticality.onDemandCell && a.criticality.strategyMode !== 'criticality' && a.strategy && a.strategy !== 'RP07')
        add({ code: 'STRAT_COULD_BE_ON_DEMAND', area: 'strategy', severity: 'low', title: 'Could be bought on demand', detail: `Cell ${a.criticality.cell} is at or below the cutoff ${a.criticality.cutoff}; holding stock of it may not be needed.`, action: 'Consider RP07 Direct purchase.' });
    if (a.strategy === 'RP07' && a.criticality.assessed && !a.criticality.onDemandCell)
        add({ code: 'STRAT_CRITICAL_ON_DEMAND', area: 'strategy', severity: a.criticality.cls === 'A' ? 'high' : 'medium', title: 'Critical material bought on demand', detail: `Cell ${a.criticality.cell} is above the cutoff, yet nothing is held in stock.`, action: 'Hold stock with an automated strategy (for example RP01 Min-Max).' });
    if (!a.strategy) add({ code: 'STRAT_MISSING', area: 'strategy', severity: 'medium', title: 'No procurement strategy', detail: 'Nothing decides how the material is replenished.', action: 'Choose a strategy in Stock Control.' });

    // ----- Levels -----
    const onDemand = a.strategy === 'RP07' || a.forecast.onDemand;
    if (onDemand && ((L.minimumLevel ?? 0) > 0 || (L.maximumLevel ?? 0) > 0))
        add({ code: 'LVL_ON_DEMAND_HELD', area: 'levels', severity: 'medium', title: 'Levels set for an on-demand material', detail: `Minimum ${L.minimumLevel ?? 0} and maximum ${L.maximumLevel ?? 0} are set although the material is bought on demand.`, action: 'Clear the levels or change the strategy.' });
    if (!onDemand && a.automated) {
        if (n0(L.minimumLevel) === null || n0(L.maximumLevel) === null) add({ code: 'LVL_MISSING', area: 'levels', severity: 'high', title: 'Minimum or maximum missing', detail: 'Automatic replenishment cannot plan without them.', action: 'Set or propose the levels.' });
        if (n0(L.minimumLevel) !== null && n0(L.maximumLevel) !== null && (L.minimumLevel as number) > (L.maximumLevel as number))
            add({ code: 'LVL_MIN_ABOVE_MAX', area: 'levels', severity: 'high', title: 'Minimum above maximum', detail: `Minimum ${L.minimumLevel} is above maximum ${L.maximumLevel}.`, action: 'Correct the levels.' });
        if (n0(L.safetyStock) !== null && n0(L.minimumLevel) !== null && (L.minimumLevel as number) < (L.safetyStock as number))
            add({ code: 'LVL_MIN_BELOW_SS', area: 'levels', severity: 'medium', title: 'Minimum below safety stock', detail: `Minimum ${L.minimumLevel} is below the safety stock ${L.safetyStock}.`, action: 'Raise the minimum to at least the safety stock plus lead-time demand.' });
        if (a.criticality.cls === 'A' && !(Number(L.safetyStock) > 0) && d > 0)
            add({ code: 'LVL_A_NO_SS', area: 'levels', severity: 'high', title: 'Very critical material without safety stock', detail: 'Class A materials need a buffer against lead time and demand variation.', action: 'Set or propose a safety stock.' });
    }
    const rec = a.forecast.recommended;
    const deviations: Array<{ field: keyof Levels; current: number | null; recommended: number; pct: number | null }> = [];
    if (rec && !onDemand) {
        for (const k of ['minimumLevel', 'maximumLevel', 'reorderQuantity', 'safetyStock'] as Array<keyof Levels>) {
            const cur = n0(L[k]);
            const want = Number(rec[k]) || 0;
            const pct = cur === null ? null : want ? Math.round(((cur - want) / want) * 1000) / 10 : cur ? 100 : 0;
            deviations.push({ field: k, current: cur, recommended: want, pct });
        }
        const off = deviations.filter((x) => x.current !== null && x.pct !== null && Math.abs(x.pct) > a.tolerancePct && (x.field === 'minimumLevel' || x.field === 'maximumLevel'));
        if (off.length) {
            const label = (k: string) => (k === 'minimumLevel' ? 'minimum' : 'maximum');
            add({
                code: 'LVL_OFF_FORECAST',
                area: 'levels',
                severity: off.some((x) => Math.abs(x.pct as number) > a.tolerancePct * 2) ? 'medium' : 'low',
                title: 'Levels not in line with the forecast',
                detail: off.map((x) => `${label(x.field)} ${x.current} vs ${x.recommended} recommended (${(x.pct as number) > 0 ? '+' : ''}${x.pct}%)`).join('; ') + ` — tolerance ±${a.tolerancePct}%.`,
                action: a.forecast.levelSource === 'forecast' ? 'Propose the forecast levels.' : 'Review the manual levels against the forecast.',
            });
        }
    }

    // ----- Stock count adjustments (last 12 months) -----
    const yearAgo = Date.parse(a.now) - 365 * 86_400_000;
    const adj = a.adjustments.filter((x) => Date.parse(x.at) >= yearAgo && x.qty !== 0);
    const gains = adj.filter((x) => x.qty > 0);
    const losses = adj.filter((x) => x.qty < 0);
    const gross = adj.reduce((s, x) => s + Math.abs(x.qty), 0);
    const net = adj.reduce((s, x) => s + x.qty, 0);
    const adjustments = { count: adj.length, gains: gains.length, losses: losses.length, grossQty: r3(gross), netQty: r3(net), grossValue: r2(gross * cost), netValue: r2(net * cost), largest: adj.reduce((m, x) => Math.max(m, Math.abs(x.qty)), 0), pctOfIssues: a.annualIssues > 0 ? Math.round((gross / a.annualIssues) * 1000) / 10 : null };
    if (adj.length >= 3) add({ code: 'ADJ_REPEATED', area: 'stock_take', severity: 'medium', title: 'Repeated count adjustments', detail: `${adj.length} adjustments in the last 12 months (${gains.length} gains, ${losses.length} losses).`, action: 'Check the bin, the unit of measure and how the material is issued.' });
    if (losses.length >= 3 && !gains.length) add({ code: 'ADJ_LOSS_BIAS', area: 'stock_take', severity: 'high', title: 'Losses at every count', detail: `${losses.length} counts all found less stock (net ${r3(net)}, value ${r2(net * cost)}): a systematic loss.`, action: 'Investigate unrecorded issues, theft or damage.', value: r2(-net * cost) });
    if (gains.length >= 3 && !losses.length) add({ code: 'ADJ_GAIN_BIAS', area: 'stock_take', severity: 'medium', title: 'Gains at every count', detail: `${gains.length} counts all found more stock (net +${r3(net)}): issues may be recorded but not taken, or receipts not recorded.`, action: 'Check the receiving and issuing records.' });
    if (a.annualIssues > 0 && gross > 0.2 * a.annualIssues) add({ code: 'ADJ_LARGE_SHARE', area: 'stock_take', severity: 'high', title: 'Adjustments large against usage', detail: `Adjusted ${r3(gross)} against ${r3(a.annualIssues)} issued in a year (${adjustments.pctOfIssues}%).`, action: 'Review stock control for this material.' });
    else if (d > 0 && adjustments.largest > d) add({ code: 'ADJ_LARGE_SINGLE', area: 'stock_take', severity: 'medium', title: 'An adjustment larger than a month of demand', detail: `The largest adjustment was ${adjustments.largest}; monthly demand is about ${r3(d)}.`, action: 'Confirm the count and the reason.' });

    // ----- Risk and opportunity in stock holding -----
    const cap = rec && !onDemand ? rec.maximumLevel ?? null : L.maximumLevel;
    const rop = rec && !onDemand ? rec.reorderPoint ?? 0 : L.reorderPoint ?? L.minimumLevel ?? 0;
    const ss = rec && !onDemand ? rec.safetyStock ?? 0 : L.safetyStock ?? 0;
    const physical = Math.max(0, a.stock.physical);
    const stockValue = r2(physical * cost);
    const coverageMonths = d > 0 ? r3(a.stock.available / d) : null;
    const noIssueYear = !a.lastIssueAt || Date.parse(a.lastIssueAt) < yearAgo;
    let excessQty = 0;
    let excessBasis = '';
    if (physical > 0 && noIssueYear) {
        excessQty = physical;
        excessBasis = 'no issue in 12 months (dead stock)';
        add({ code: 'STK_DEAD', area: 'stock', severity: 'high', title: 'Dead stock', detail: `${physical} in stock (value ${stockValue}) with no issue in the last 12 months.`, action: 'Return to the supplier, transfer, sell or write off; consider buying on demand.', value: stockValue });
    } else if (onDemand && physical > 0) {
        excessQty = physical;
        excessBasis = 'held although bought on demand';
        add({ code: 'STK_ON_DEMAND_HELD', area: 'stock', severity: 'low', title: 'Stock held for an on-demand material', detail: `${physical} in stock (value ${stockValue}).`, action: 'Use it up before buying again.', value: stockValue });
    } else if (cap !== null && cap !== undefined && physical > cap) {
        excessQty = physical - cap;
        excessBasis = `above the ${rec ? 'recommended' : 'current'} maximum ${cap}`;
        add({ code: 'STK_EXCESS', area: 'stock', severity: excessQty * cost > 0 && coverageMonths !== null && coverageMonths > 12 ? 'medium' : 'low', title: 'Excess stock', detail: `${r3(excessQty)} above the maximum (value ${r2(excessQty * cost)}).`, action: 'Hold back orders until stock is back within the maximum; consider transfers.', value: r2(excessQty * cost) });
    }
    if (coverageMonths !== null && coverageMonths > 12 && !noIssueYear && excessBasis === '') {
        excessQty = Math.max(0, a.stock.available - 12 * d);
        excessBasis = 'more than 12 months of demand';
        add({ code: 'STK_SLOW', area: 'stock', severity: 'medium', title: 'Slow-moving stock', detail: `${coverageMonths} months of cover.`, action: 'Reduce the maximum and hold back orders.', value: r2(excessQty * cost) });
    }
    const position = a.stock.available + a.stock.openSupply;
    let shortfallQty = 0;
    if (!onDemand && d > 0 && rop > 0 && position < rop) {
        shortfallQty = rop - position;
        add({ code: 'STK_BELOW_ROP', area: 'stock', severity: a.criticality.cls === 'A' || a.criticality.cls === 'B' ? 'high' : 'medium', title: 'Stock-out risk', detail: `Available ${r3(a.stock.available)} plus open supply ${r3(a.stock.openSupply)} is below the reorder point ${rop}.`, action: 'Raise a purchase requirement now.', value: r2(shortfallQty * cost) });
    }
    if (!onDemand && ss > 0 && a.stock.available < ss) add({ code: 'STK_BELOW_SS', area: 'stock', severity: 'high', title: 'Below safety stock', detail: `Available ${r3(a.stock.available)} is below the safety stock ${ss}.`, action: 'Expedite open orders.' });

    const weights: Record<Severity, number> = { high: 15, medium: 7, low: 3, info: 0 };
    const score = Math.max(0, 100 - f.reduce((s, x) => s + weights[x.severity], 0));
    const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
    f.sort((x, y) => order[x.severity] - order[y.severity]);
    return {
        score,
        rating: score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor',
        findings: f,
        done: { criticality: a.criticality.assessed && !(a.criticality.reviewDue && a.criticality.reviewDue < today), forecast: onDemand || a.forecast.levelSource !== 'forecast' || !!a.forecast.appliedAt, leadTime: a.forecast.leadDays > 0, strategyAligned: !f.some((x) => x.area === 'strategy' && x.severity !== 'info'), levelsAligned: !f.some((x) => x.area === 'levels' && x.severity !== 'info') },
        deviations,
        adjustments,
        holding: {
            physical,
            available: r3(a.stock.available),
            openSupply: r3(a.stock.openSupply),
            unitCost: r2(cost),
            stockValue,
            coverageMonths,
            demandPerMonth: r3(d),
            excessQty: r3(excessQty),
            excessValue: r2(excessQty * cost),
            excessBasis,
            shortfallQty: r3(shortfallQty),
            riskValue: r2(shortfallQty * cost),
            holdingCostYear: r2(stockValue * (a.holdingPct / 100)),
            opportunityYear: r2(excessQty * cost * (a.holdingPct / 100)),
        },
        counts: { high: f.filter((x) => x.severity === 'high').length, medium: f.filter((x) => x.severity === 'medium').length, low: f.filter((x) => x.severity === 'low').length },
    };
}
export type AuditReport = ReturnType<typeof auditMaterial>;

/**
 * Impact of a change of levels on stock holding, at unit cost:
 *   average stock ≈ safety stock + reorder quantity / 2 (cycle stock); maximum stock = the maximum level
 *   holding cost a year = average stock value × holding %
 * and what the new levels mean for the stock held today (excess above the new maximum, or an order now).
 */
export function levelImpact(before: Levels, after: Levels, a: { available: number; openSupply: number; demandPerMonth: number; unitCost: number; holdingPct: number }) {
    const avg = (l: Levels) => (Number(l.safetyStock) || 0) + (Number(l.reorderQuantity) || 0) / 2;
    const cost = a.unitCost > 0 ? a.unitCost : 0;
    const avgBefore = avg(before);
    const avgAfter = avg(after);
    const position = a.available + a.openSupply;
    const max = Number(after.maximumLevel) || 0;
    const min = Number(after.minimumLevel) || 0;
    const coverAfter = a.demandPerMonth > 0 ? r3(avgAfter / a.demandPerMonth) : null;
    const coverBefore = a.demandPerMonth > 0 ? r3(avgBefore / a.demandPerMonth) : null;
    return {
        averageStockBefore: r3(avgBefore),
        averageStockAfter: r3(avgAfter),
        averageValueBefore: r2(avgBefore * cost),
        averageValueAfter: r2(avgAfter * cost),
        averageValueChange: r2((avgAfter - avgBefore) * cost),
        maxValueBefore: r2((Number(before.maximumLevel) || 0) * cost),
        maxValueAfter: r2(max * cost),
        maxValueChange: r2((max - (Number(before.maximumLevel) || 0)) * cost),
        holdingCostChangeYear: r2((avgAfter - avgBefore) * cost * (a.holdingPct / 100)),
        coverMonthsBefore: coverBefore,
        coverMonthsAfter: coverAfter,
        excessNowQty: r3(Math.max(0, a.available - max)),
        excessNowValue: r2(Math.max(0, a.available - max) * cost),
        orderNowQty: max > 0 && position <= min ? r3(max - position) : 0,
        orderNowValue: max > 0 && position <= min ? r2((max - position) * cost) : 0,
        direction: avgAfter > avgBefore ? 'more stock' : avgAfter < avgBefore ? 'less stock' : 'unchanged',
    };
}
export type LevelImpact = ReturnType<typeof levelImpact>;
