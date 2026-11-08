import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, defaultForecastSetup, demandPattern, effectiveSource, inverseNormal, levelsFrom, monthlyHistory, readEvents, readForecastSetup, runForecast, simulate, trendOf } from '../../backend/forecastModel.ts';

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

test('simulation gives about 100 movements over a year with one one-off issue, for heavy and light use', () => {
    for (const p of ['heavy', 'light']) {
        const s = simulate(p, 7, NOW);
        assert.equal(s.length, 100);
        assert.equal(s.filter((x) => x.id === 'SIM-ONEOFF').length, 1);
        assert.ok(s.every((x) => x.simulated && x.id.startsWith('SIM-')));
        assert.ok(s.some((x) => x.kind === 'receipt') && s.some((x) => x.kind === 'reversal'));
        assert.ok(Date.parse(s[0].at) >= Date.parse(NOW) - 366 * 86_400_000);
    }
    const heavy = simulate('heavy', 7, NOW).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF');
    const light = simulate('light', 7, NOW).filter((x) => x.kind === 'issue' && x.id !== 'SIM-ONEOFF');
    assert.ok(heavy.reduce((s, x) => s + x.qty, 0) > 5 * light.reduce((s, x) => s + x.qty, 0));
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
    assert.match(server, /Give a reason of at least 10 characters for masking movements or changing planned events/);
    for (const a of ['setup.save', 'save', 'propose', 'approve', 'return', 'source']) assert.match(server, new RegExp(`audited\\(ctx, 'inventory\\.forecast\\.${a.replace('.', '\\.')}'`));
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /id: 'forecast-propose-approve', a: 'INV\.forecast\.edit', b: 'INV\.forecast\.approve'/);
    assert.match(policy, /T\('inv_forecast_approver'/);
    assert.match(read('backend/index.ts'), /\.\.\.forecastingRoutes/);
});

test('UI: Forecasting tab after Criticality Analysis, simulation off on load, criticality results on the Overview', () => {
    const detail = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(detail, /'Criticality Analysis', 'Forecasting', 'Technical Data'/);
    assert.match(detail, /<CriticalitySummary materialId=\{id\}/);
    assert.match(detail, /locked=\{levelLock && LEVEL_SET\.has\(k\) \? levelLock : undefined\}/);
    const ui = read('src/org/Forecasting.tsx');
    assert.match(ui, /const \[sim, setSim\] = useState\(false\)/);
    assert.match(ui, /Nothing here can be saved or proposed/);
    assert.match(read('src/org/CriticalityAnalysis.tsx'), /label: 'Forecasting setup'/);
});
