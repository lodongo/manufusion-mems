import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ageingOf, countQuantile, defaultForecastSetup, isActivated, readForecastSetup, recommendFrom, runForecast } from '../../backend/forecastModel.ts';
import { impactSummary } from '../../backend/forecastRecommendations.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = '2026-11-20T10:00:00.000Z';
const issuesFrom = (monthly) => monthly.flatMap((q, i) => (q > 0 ? [{ id: 'J' + i, at: new Date(Date.UTC(2025, 10 + i, 10)).toISOString(), kind: 'issue', qty: q, type: 'GOODS_ISSUE', reference: '' }] : []));
const levels = (o = {}) => ({ serviceLevel: 95, z: 1.645, externalLeadDays: 20, internalLeadDays: 5, leadDays: 25, leadMonths: 0.82, demandPerMonth: 4, sigma: 1, demandDuringLead: 3.3, safetyStock: 2, reorderPoint: 6, reorderQuantity: 8, minimumLevel: 6, maximumLevel: 14, roqBasis: '', sigmaLeadDays: 5, onDemand: false, notes: [], ...o });
const base = (o = {}) => ({ setup: defaultForecastSetup(), criticalityClass: 'C', strategy: 'RP01', strategyLocked: '', current: { minimumLevel: 6, maximumLevel: 14, reorderQuantity: 8, safetyStock: 2, reorderPoint: 6 }, levels: levels(), leadDays: 25, ageing: { lastIssueAt: '', monthsSinceIssue: 1, issueMonthsLastYear: 10, dead: false, slow: false }, onHand: 10, unitCost: 50, ...o });

test('TSB is tried for intermittent demand and models fading demand (obsolescence)', () => {
    const s = defaultForecastSetup();
    // Regular early use that stopped: TSB lets the forecast decay where Croston keeps it flat.
    const inst = issuesFrom([0, 5, 0, 4, 0, 6, 0, 0, 0, 0, 0, 0]);
    const tsb = runForecast({ instances: inst, masked: [], setup: s, events: [], now: NOW, method: 'tsb', externalLeadDays: 30 });
    const croston = runForecast({ instances: inst, masked: [], setup: s, events: [], now: NOW, method: 'croston', externalLeadDays: 30 });
    assert.ok(tsb.future[0].base < croston.future[0].base, `tsb ${tsb.future[0].base} < croston ${croston.future[0].base}`);
    const auto = runForecast({ instances: inst, masked: [], setup: s, events: [], now: NOW, externalLeadDays: 30 });
    assert.ok(auto.candidates.some((c) => c.code === 'tsb'));
    assert.ok('mase' in auto.accuracy, 'MASE reported');
});

test('Slow movers use the Poisson / negative binomial quantile, not the normal approximation', () => {
    assert.equal(countQuantile(0, 0, 0.95), 0);
    assert.equal(countQuantile(1, 1, 0.95), 3, 'Poisson(1) 95% quantile');
    assert.equal(countQuantile(2, 2, 0.99), 6, 'Poisson(2) 99% quantile');
    assert.ok(countQuantile(2, 8, 0.95) > countQuantile(2, 2, 0.95), 'overdispersion needs more stock');
    const s = defaultForecastSetup();
    const r = runForecast({ instances: issuesFrom([0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0]), masked: [], setup: s, events: [], now: NOW, externalLeadDays: 60, criticalityClass: 'B' });
    assert.ok(r.levels.notes.some((n) => /Poisson|negative binomial/.test(n)), r.levels.notes.join(' | '));
    assert.equal(Number.isInteger(r.levels.reorderPoint), true);
});

test('Insurance spares: class A keeps a minimum with no forecast demand', () => {
    const r = runForecast({ instances: [], masked: [], setup: defaultForecastSetup(), events: [], now: NOW, externalLeadDays: 90, criticalityClass: 'A' });
    assert.equal(r.levels.minimumLevel, 1);
    assert.ok(r.levels.maximumLevel >= 1);
    const d = runForecast({ instances: [], masked: [], setup: defaultForecastSetup(), events: [], now: NOW, externalLeadDays: 90, criticalityClass: 'D' });
    assert.equal(d.levels.minimumLevel, 0);
});

test('Ageing: slow moving and dead stock from the months since the last issue', () => {
    const s = defaultForecastSetup();
    const old = [{ id: 'a', at: '2024-01-10T00:00:00.000Z', kind: 'issue', qty: 1, type: 'GOODS_ISSUE', reference: '' }];
    assert.equal(ageingOf(old, NOW, 5, s).dead, true);
    assert.equal(ageingOf([{ ...old[0], at: '2025-08-10T00:00:00.000Z' }], NOW, 5, s).slow, true);
    assert.equal(ageingOf([], NOW, 0, s).dead, false, 'nothing held is not dead stock');
    assert.equal(ageingOf(issuesFrom([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), NOW, 3, s).issueMonthsLastYear >= 10, true);
});

test('Recommendations are grouped: no change, increase, decrease, PD; strategy changes separately', () => {
    assert.equal(recommendFrom(base()).group, 'no_change');
    const up = recommendFrom(base({ levels: levels({ minimumLevel: 10, reorderPoint: 10, maximumLevel: 22 }) }));
    assert.equal(up.group, 'increase');
    assert.equal(up.impact.plannedValueChange, ((10 + 22) / 2 - (6 + 14) / 2) * 50);
    const down = recommendFrom(base({ levels: levels({ minimumLevel: 2, reorderPoint: 2, maximumLevel: 6 }) }));
    assert.equal(down.group, 'decrease');
    assert.equal(down.impact.excessQty, 4);
    const pd = recommendFrom(base({ ageing: { lastIssueAt: '', monthsSinceIssue: 8, issueMonthsLastYear: 1, dead: false, slow: false } }));
    assert.equal(pd.group, 'pd');
    assert.equal(pd.strategyGroup, 'to_pd');
    assert.equal(pd.recommendedStrategy, 'RP07');
    assert.deepEqual([pd.values.minimumLevel, pd.values.maximumLevel], [0, 0]);
    // Protected classes are never put on PD, long lead times are not PD either.
    assert.notEqual(recommendFrom(base({ criticalityClass: 'A', ageing: { lastIssueAt: '', monthsSinceIssue: 8, issueMonthsLastYear: 1, dead: false, slow: false } })).group, 'pd');
    assert.notEqual(recommendFrom(base({ leadDays: 90, ageing: { lastIssueAt: '', monthsSinceIssue: 8, issueMonthsLastYear: 1, dead: false, slow: false } })).group, 'pd');
    // Dead stock of a non-protected class → PD; a criticality-locked strategy is not changed.
    assert.equal(recommendFrom(base({ leadDays: 90, ageing: { lastIssueAt: '', monthsSinceIssue: 30, issueMonthsLastYear: 0, dead: true, slow: false } })).group, 'pd');
    assert.equal(recommendFrom(base({ strategyLocked: 'criticality', ageing: { lastIssueAt: '', monthsSinceIssue: 8, issueMonthsLastYear: 1, dead: false, slow: false } })).strategyGroup, 'none');
    // On demand today but used regularly → back to stock.
    const back = recommendFrom(base({ strategy: 'RP07', current: { minimumLevel: 0, maximumLevel: 0, reorderQuantity: 0, safetyStock: 0, reorderPoint: 0 } }));
    assert.equal(back.strategyGroup, 'to_stock');
    assert.equal(back.recommendedStrategy, 'RP01');
    assert.equal(back.group, 'increase');
});

test('Impact analysis sums stock capital, excess, dead stock and PD candidates', () => {
    const a = { group: 'decrease', strategyGroup: 'none', impact: recommendFrom(base({ levels: levels({ minimumLevel: 2, reorderPoint: 2, maximumLevel: 6 }) })).impact, ageing: { dead: false } };
    const b = { group: 'pd', strategyGroup: 'to_pd', impact: { onHandValue: 300, plannedValueNow: 500, plannedValueRecommended: 0, plannedValueChange: -500, excessQty: 6, excessValue: 300, deadStockValue: 300 }, ageing: { dead: true } };
    const s = impactSummary([a, b]);
    assert.equal(s.materials, 2);
    assert.equal(s.deadStock.count, 1);
    assert.equal(s.deadStock.value, 300);
    assert.equal(s.pd.count, 1);
    assert.equal(s.groups.pd.count, 1);
    assert.equal(s.strategyGroups.to_pd.count, 1);
    assert.equal(s.stockCapital.change, a.impact.plannedValueChange - 500);
});

test('Activation by material category; setup validation', () => {
    const s = readForecastSetup({ ...defaultForecastSetup(), activation: { mode: 'selected', categories: ['mech', 'ELEC'] } });
    assert.equal(isActivated(s, 'MECH'), true);
    assert.equal(isActivated(s, 'chem'), false);
    assert.equal(isActivated(defaultForecastSetup(), 'CHEM'), true);
    assert.throws(() => readForecastSetup({ ...defaultForecastSetup(), activation: { mode: 'selected', categories: [] } }), /at least one/);
    assert.throws(() => readForecastSetup({ ...defaultForecastSetup(), slowMonths: 24, deadStockMonths: 24 }), /before dead stock/);
});

test('Server controls: recommendations only, acceptance independent and Chart of Authority for capital, gating, triggers', () => {
    const rec = read('backend/forecastRecommendations.ts');
    assert.match(rec, /orgRoute\('org\.inventory\.forecast\.recommendations\.decide', 'INV\.forecast\.approve'/);
    assert.match(rec, /str\(r\.runBy\) === ctx\.uid && !bypass\(ctx, 'inv\.forecast\.recommendation_independence'\)/);
    assert.match(rec, /const commits = str\(r\.group\) === 'increase' \|\| str\(r\.strategyGroup\) === 'to_stock';/);
    assert.match(rec, /approvalRoute\(ctx\.orgId, ctx\.me, value/);
    assert.match(rec, /The levels or strategy changed after the evaluation; re-evaluate first\./);
    assert.match(rec, /Type \$\{keys\.length\} to confirm/);
    assert.match(rec, /onMaterialChanges\(onIssue\)/);
    assert.match(rec, /latest\.kind !== 'issue'/);
    assert.match(read('backend/automationEngine.ts'), /const FC_JOB_ID = 'inv\.forecast-weekly';/);
    assert.match(read('backend/forecasting.ts'), /await requireActivated\(ctx\.orgId, materialId\);/);
    assert.match(read('backend/criticality.ts'), /requireActivated\(ctx\.orgId, materialId\)/);
    assert.match(read('backend/criticality.ts'), /analysed\(str\(mm\.get\(str\(a\.data\.materialId\)\)\?\.categoryCode\)\)/);
});
