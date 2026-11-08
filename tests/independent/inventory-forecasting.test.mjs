import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, defaultForecastSetup, demandPattern, effectiveSource, inverseNormal, leadTimeFrom, levelsFrom, monthlyHistory, projectStock, readEvents, readForecastSetup, readSimOptions, runForecast, simulate, trendOf } from '../../backend/forecastModel.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = '2026-11-08T09:00:00Z';
const monthly = (values, kind = 'issue') =>
    values.map((q, i) => {
        const d = new Date(Date.UTC(2026, 10 - values.length + i, 10));
        return { id: `J${i}`, at: d.toISOString(), kind, qty: q, type: 'GOODS_ISSUE', reference: `R${i}` };
    });

test('journal entries are classified as issues, reversals and receipts; other movements are not demand', () => {
    assert.equal(classify('GOODS_ISSUE', -5), 'issue');
    assert.equal(classify('GOODS_ISSUE', 5), 'reversal');
    assert.equal(classify('MAINTENANCE_RETURN', 2), 'reversal');
    assert.equal(classify('GOODS_RECEIPT', 10), 'receipt');
    assert.equal(classify('STOCK_TAKE_ADJUSTMENT', -3), null);
    assert.equal(classify('OPENING_BALANCE', 100), null);
});

test('monthly history subtracts reversals from issues, ignores receipts as demand and leaves masked movements out', () => {
    const inst = [
        { id: 'a', at: '2026-10-03T08:00:00Z', kind: 'issue', qty: 10, type: 'GOODS_ISSUE', reference: '' },
        { id: 'b', at: '2026-10-05T08:00:00Z', kind: 'reversal', qty: 3, type: 'MATERIAL_RETURN', reference: '' },
        { id: 'c', at: '2026-10-07T08:00:00Z', kind: 'receipt', qty: 50, type: 'GOODS_RECEIPT', reference: '' },
        { id: 'd', at: '2026-10-09T08:00:00Z', kind: 'issue', qty: 40, type: 'GOODS_ISSUE', reference: '' },
    ];
    const [oct] = monthlyHistory(inst, new Set(['d']), '2026-11', 2);
    assert.equal(oct.month, '2026-10');
    assert.equal(oct.issues, 10);
    assert.equal(oct.reversals, 3);
    assert.equal(oct.receipts, 50);
    assert.equal(oct.demand, 7);
    assert.equal(oct.masked, 1);
});

test('safety factor and service level: z(95%) = 1.645, z(99%) = 2.326', () => {
    assert.ok(Math.abs(inverseNormal(0.95) - 1.6449) < 1e-3);
    assert.ok(Math.abs(inverseNormal(0.99) - 2.3263) < 1e-3);
    assert.ok(Math.abs(inverseNormal(0.5)) < 1e-9);
});

test('trend is detected only when significant, and the demand pattern follows Syntetos–Boylan', () => {
    assert.equal(trendOf([10, 12, 14, 16, 18, 20, 22, 24]).direction, 'increasing');
    assert.equal(trendOf([30, 27, 24, 21, 18, 15]).direction, 'decreasing');
    assert.equal(trendOf([10, 11, 9, 10, 11, 9, 10]).direction, 'stable');
    assert.equal(demandPattern([0, 0, 5, 0, 0, 5, 0, 0, 5]).pattern, 'intermittent');
    assert.equal(demandPattern([10, 11, 9, 10, 12, 10]).pattern, 'smooth');
});

test('levels: SS = z·√(L·σ² + d²·σL²), ROP = lead time demand + SS, max = min + ROQ, MOQ and multiple applied', () => {
    const setup = { ...defaultForecastSetup(), leadTimeVariabilityPct: 0, wholeUnits: false, coverDays: 61 };
    const future = Array.from({ length: 6 }, (_, i) => ({ month: `2027-0${i + 1}`, base: 30, events: 0, total: 30, lower: 0, upper: 0, labels: [] }));
    const l = levelsFrom(future, 10, { setup, externalLeadDays: 60.88, internalLeadDays: 0, criticalityClass: 'C' });
    // L = 2 months, z(95%) = 1.645 → SS = 1.645 · √(2 · 100) = 23.26; ROP = 60 + SS
    assert.ok(Math.abs(l.leadMonths - 2) < 1e-3);
    assert.ok(Math.abs(l.safetyStock - 23.26) < 0.02);
    assert.ok(Math.abs(l.reorderPoint - (60 + 23.26)) < 0.05);
    assert.equal(l.minimumLevel, l.reorderPoint);
    assert.ok(Math.abs(l.maximumLevel - (l.minimumLevel + l.reorderQuantity)) < 0.02);
    const constrained = levelsFrom(future, 10, { setup: { ...setup, wholeUnits: true }, externalLeadDays: 30, internalLeadDays: 0, moq: 100, orderMultiple: 40 });
    assert.equal(constrained.reorderQuantity, 120);
});

test('the forecast fits completed months only, adds planned events and gives a higher service level to class A', () => {
    const inst = monthly([20, 22, 19, 21, 20, 23, 18, 22, 21, 20]);
    const setup = defaultForecastSetup();
    const events = readEvents([{ id: 'ov', label: 'Annual overhaul', kind: 'overhaul', recurrence: 'yearly', month: '02', qty: 100, upliftPct: 0 }]);
    const r = runForecast({ instances: inst, masked: [], setup, events, now: NOW, externalLeadDays: 30, criticalityClass: 'A' });
    assert.equal(r.past.at(-1).partial, true);
    assert.equal(r.trend.direction, 'stable');
    const feb = r.future.find((f) => f.month === '2027-02');
    assert.ok(feb.events === 100 && feb.total > feb.base);
    assert.equal(r.levels.serviceLevel, 99);
    const c = runForecast({ instances: inst, masked: [], setup, events: [], now: NOW, externalLeadDays: 30, criticalityClass: 'D' });
    assert.ok(c.levels.safetyStock < r.levels.safetyStock);
});

test('masking a one-off issue removes it from the demand', () => {
    const inst = monthly([10, 10, 10, 10, 10, 10, 10, 10]);
    inst.push({ id: 'BIG', at: '2026-09-15T08:00:00Z', kind: 'issue', qty: 400, type: 'GOODS_ISSUE', reference: 'Breakdown' });
    const setup = { ...defaultForecastSetup(), excludeOutliers: false };
    const all = runForecast({ instances: inst, masked: [], setup, events: [], now: NOW, externalLeadDays: 30, method: 'sma' });
    const masked = runForecast({ instances: inst, masked: ['BIG'], setup, events: [], now: NOW, externalLeadDays: 30, method: 'sma' });
    assert.ok(masked.levels.demandPerMonth < all.levels.demandPerMonth);
    assert.equal(masked.levels.demandPerMonth, 10);
});

const sim = (o) => simulate({ profile: 'moderate', distribution: 'uniform', trend: 'none', years: 1, seed: 7, now: NOW, ...o });

test('simulation: about 100 movements a year ending now (any year), five consumption levels, one one-off issue', () => {
    for (const profile of ['very_light', 'light', 'moderate', 'high', 'very_high']) {
        const s = sim({ profile });
        assert.equal(s.length, 100);
        assert.equal(s.filter((x) => x.id === 'SIM-ONEOFF').length, 1);
        assert.ok(s.every((x) => x.simulated && x.id.startsWith('SIM-')));
        assert.ok(s.some((x) => x.kind === 'receipt') && s.some((x) => x.kind === 'reversal'));
        assert.ok(Date.parse(s[0].at) >= Date.parse(NOW) - 366 * 86_400_000 && Date.parse(s.at(-1).at) <= Date.parse(NOW));
    }
    const total = (profile) => sim({ profile }).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF').reduce((a, x) => a + x.qty, 0);
    assert.ok(total('very_high') > total('high') && total('high') > total('moderate') && total('moderate') > total('light') && total('light') >= total('very_light'));
    const later = simulate({ profile: 'moderate', distribution: 'normal', trend: 'none', years: 2, seed: 3, now: '2029-03-01T00:00:00Z' });
    assert.equal(later.length, 200);
    assert.ok(later.at(-1).at.startsWith('2029') && later[0].at.startsWith('2027'));
    // Same options and seed rebuild the same data (the server relies on this for simulated proposals).
    assert.deepEqual(sim({ distribution: 'right_skewed' }), sim({ distribution: 'right_skewed' }));
    assert.throws(() => readSimOptions({ profile: 'heavy', distribution: 'uniform', seed: 1, now: NOW }), /consumption level/);
});

test('simulation distributions: right-skewed has mean above median, left-skewed below, normal clusters', () => {
    const stats = (distribution) => {
        const q = sim({ profile: 'very_high', distribution, seed: 11 }).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF').map((x) => x.qty).sort((a, b) => a - b);
        const mean = q.reduce((a, x) => a + x, 0) / q.length;
        return { mean, median: q[Math.floor(q.length / 2)] };
    };
    const r = stats('right_skewed');
    const l = stats('left_skewed');
    assert.ok(r.mean > r.median, 'right skew: a few large issues pull the mean up');
    assert.ok(l.mean < l.median, 'left skew: a few small issues pull the mean down');
    assert.ok(sim({ trend: 'rising', profile: 'very_high', seed: 5 }).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF').slice(-20).reduce((a, x) => a + x.qty, 0) > sim({ trend: 'falling', profile: 'very_high', seed: 5 }).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF').slice(-20).reduce((a, x) => a + x.qty, 0));
});

test('lead time: actual orders by average, worst or best case, else the material lead time; spread from 3+ orders', () => {
    const samples = [10, 20, 30].map((e, i) => ({ po: `PO${i}`, start: NOW, startBasis: 'approved', requirementAt: NOW, deliveredOn: '2026-10-01', internalDays: 4 + i, externalDays: e }));
    const base = { leadTimeMinSamples: 2 };
    assert.equal(leadTimeFrom(samples, { ...base, leadTimeStatistic: 'average' }, { externalDays: 99, internalDays: 9 }).externalDays, 20);
    assert.equal(leadTimeFrom(samples, { ...base, leadTimeStatistic: 'worst' }, { externalDays: 99, internalDays: 9 }).externalDays, 30);
    const best = leadTimeFrom(samples, { ...base, leadTimeStatistic: 'best' }, { externalDays: 99, internalDays: 9 });
    assert.equal(best.externalDays, 10);
    assert.equal(best.internalDays, 4);
    assert.equal(best.externalSource, 'actual');
    assert.ok(best.sigmaDays > 0);
    const fallback = leadTimeFrom(samples.slice(0, 1), { leadTimeMinSamples: 2, leadTimeStatistic: 'average' }, { externalDays: 45, internalDays: 7 });
    assert.deepEqual([fallback.externalDays, fallback.internalDays, fallback.externalSource, fallback.internalSource, fallback.sigmaDays], [45, 7, 'material', 'material', null]);
    assert.throws(() => readForecastSetup({ ...defaultForecastSetup(), leadTimeStatistic: 'median' }), /average, worst case or best case/);
    assert.equal('internalLeadDays' in defaultForecastSetup(), false, 'lead times are not set in the forecasting setup');
});

test('classification: a material bought on demand holds no levels; supply projects when the reorder point is reached', () => {
    const inst = monthly([20, 20, 20, 20, 20, 20, 20, 20]);
    const setup = defaultForecastSetup();
    const od = runForecast({ instances: inst, masked: [], setup, events: [], now: NOW, externalLeadDays: 30, onDemand: 'Bought on demand (RP07).' });
    assert.equal(od.levels.onDemand, true);
    assert.deepEqual([od.levels.minimumLevel, od.levels.maximumLevel, od.levels.reorderQuantity, od.levels.safetyStock], [0, 0, 0, 0]);
    assert.ok(od.levels.demandPerMonth > 0, 'the expected demand is still shown');
    const p = projectStock([{ month: '2026-12', total: 30 }, { month: '2027-01', total: 30 }, { month: '2027-02', total: 30 }], { available: 50, openSupply: 20 }, 25);
    assert.deepEqual(p.rows.map((r) => r.projected), [40, 10, -20]);
    assert.equal(p.reorderMonth, '2027-01');
    assert.equal(p.stockoutMonth, '2027-02');
    const withStock = runForecast({ instances: inst, masked: [], setup, events: [], now: NOW, externalLeadDays: 30, stock: { available: 100, openSupply: 0 } });
    assert.ok(withStock.projection && withStock.projection.rows.length === setup.futureMonths);
});

test('level source: forecast needs the minimum history, manual stays manual, manual-unless-forced follows the switch', () => {
    const f = { ...defaultForecastSetup(), levelMode: 'forecast' };
    assert.equal(effectiveSource(f, {}, 5).source, 'manual');
    assert.equal(effectiveSource(f, {}, 6).source, 'forecast');
    assert.equal(effectiveSource({ ...f, levelMode: 'manual' }, { levelsSource: 'forecast' }, 24).source, 'manual');
    assert.equal(effectiveSource({ ...f, levelMode: 'manual_unless_forced' }, {}, 24).source, 'manual');
    assert.equal(effectiveSource({ ...f, levelMode: 'manual_unless_forced' }, { levelsSource: 'forecast' }, 2).source, 'forecast');
    assert.throws(() => readForecastSetup({ ...f, minHistoryMonths: 3 }), /Minimum history/);
    assert.throws(() => readForecastSetup({ ...f, serviceLevels: { A: 90, B: 95, C: 95, D: 90, none: 95 } }), /must not increase/);
    assert.throws(() => readEvents([{ label: 'X', recurrence: 'once', month: '2027-01', qty: 1 }]), /name of 3/);
});

test('server: levels from the forecast are locked on the update route, proposals need independent approval and the Chart of Authority', () => {
    const server = read('backend/forecasting.ts');
    const proc = read('backend/procurement.ts');
    assert.match(proc, /levelsLockedByForecast\(ctx\.orgId,id,warehouseId,before,levelChanges\)/);
    assert.match(server, /bypass\(ctx, 'inv\.forecast\.approve_independence'\)/);
    assert.match(server, /approvalRoute\(ctx\.orgId, ctx\.me, value, authority/);
    assert.match(server, /Only real journal movements can be masked and saved/);
    assert.match(server, /The forecasting setup does not allow levels from simulated data/);
    assert.match(server, /data = simulate\(sim\)/, 'simulated proposals are rebuilt on the server from the seed');
    assert.match(server, /if \(m\.onDemand\) throw new HttpError\(409, m\.onDemand\)/);
    assert.match(server, /requirement created → start/);
    assert.match(read('backend/procurement.ts'), /'leadTimeDays','internalLeadTimeDays'/);
    assert.match(server, /Give a reason of at least 10 characters for masking movements or changing planned events/);
    for (const a of ['setup.save', 'save', 'propose', 'approve', 'return', 'source']) assert.match(server, new RegExp(`audited\\(ctx, 'inventory\\.forecast\\.${a.replace('.', '\\.')}'`));
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /id: 'forecast-propose-approve', a: 'INV\.forecast\.edit', b: 'INV\.forecast\.approve'/);
    assert.match(policy, /T\('inv_forecast_approver'/);
    assert.match(read('backend/index.ts'), /\.\.\.forecastingRoutes/);
    assert.doesNotMatch(server, /orgRoute\('org\.inventory\.forecast\.[a-z.]+', null/, 'every forecast route declares its permission');
    assert.doesNotMatch(read('backend/criticality.ts'), /orgRoute\('org\.inventory\.criticality\.[a-z.]+', null/, 'every criticality route declares its permission');
});

test('UI: Forecasting tab after Criticality Analysis, simulation off on load, criticality results on the Overview', () => {
    const detail = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(detail, /'Criticality Analysis', 'Forecasting', 'Technical Data'/);
    assert.match(detail, /<CriticalitySummary materialId=\{id\}/);
    assert.match(detail, /locked=\{levelLock && LEVEL_SET\.has\(k\) \? levelLock : undefined\}/);
    const ui = read('src/org/Forecasting.tsx');
    assert.match(ui, /const \[sim, setSim\] = useState\(false\)/);
    assert.match(ui, /Propose simulated levels/);
    assert.match(ui, /I understand these levels were worked out from simulated data/);
    assert.match(read('src/org/CriticalityAnalysis.tsx'), /label: 'Forecasting setup'/);
});
