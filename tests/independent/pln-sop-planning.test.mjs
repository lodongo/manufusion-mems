import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    apportion, balanceSummary, bucketsOf, buyLot, defaultPlanningSetup, forecastSku, fraction, readLines, readPlanningSetup,
    roughCut, routingRate, runMrp, sopSummary, spreadAnnual, transitionCheck, unitise, unitiseBom, profileWeights,
} from '../../backend/plnPlanningModel.ts';
import { ALL_BUILT_KEYS, SOD_RULES, sodConflicts } from '../../backend/permissionPolicy.ts';
import { LEVEL_ROLES } from '../../backend/levelRoles.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
// A July–June financial year, as Finance builds it (12 monthly periods).
const periods = Array.from({ length: 12 }, (_, i) => {
    const m = ((6 + i) % 12) + 1;
    const y = m >= 7 ? 2026 : 2027;
    return { no: i + 1, name: `P${i + 1}`, start: `${y}-${String(m).padStart(2, '0')}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
});
const YEAR = { start: '2026-07-01', end: '2027-06-30', periods };
const setup = defaultPlanningSetup();

test('financial year: part-way through, only the balance periods are planned (current period prorated, included or excluded)', () => {
    const b = bucketsOf(YEAR, '2026-11-25', 'prorate');
    assert.equal(b.length, 12);
    assert.deepEqual(b.slice(0, 4).map((x) => x.state), ['past', 'past', 'past', 'past']);
    assert.equal(b[4].state, 'current');
    assert.equal(b[4].fraction, Math.round((6 / 30) * 1000) / 1000, '25–30 Nov is 6 of 30 days');
    assert.ok(b.slice(5).every((x) => x.fraction === 1));
    assert.equal(bucketsOf(YEAR, '2026-11-25', 'include')[4].fraction, 1);
    assert.equal(bucketsOf(YEAR, '2026-11-25', 'exclude')[4].fraction, 0);
    const s = balanceSummary(b);
    assert.equal(s.open, 8);
    assert.equal(s.past, 4);
    assert.equal(s.firstOpen, 'P05');
    // A future year is planned in full.
    assert.equal(balanceSummary(bucketsOf(YEAR, '2026-06-01', 'prorate')).share, 1);
    // A weekly calendar (52 periods) is planned in calendar months inside the year.
    const weekly = Array.from({ length: 52 }, (_, i) => ({ no: i + 1, name: `W${i + 1}`, start: new Date(Date.UTC(2026, 6, 1 + i * 7)).toISOString().slice(0, 10), end: new Date(Date.UTC(2026, 6, 7 + i * 7)).toISOString().slice(0, 10) }));
    assert.equal(bucketsOf({ start: '2026-07-01', end: '2027-06-29', periods: weekly }, '2026-07-01', 'prorate').length, 12);
});

test('annual demand: a full-year quantity plans only the balance share; a balance quantity is spread over open periods; whole units keep the total', () => {
    const b = bucketsOf(YEAR, '2026-11-25', 'prorate');
    const w = profileWeights(b, 'FLAT', setup.customProfile, null);
    const full = spreadAnnual(12000, 'FULL_YEAR', b, w, true);
    assert.equal(full.perBucket.slice(0, 4).reduce((a, x) => a + x, 0), 0, 'nothing in past periods');
    assert.equal(full.balanceQty, Math.round(12000 * ((0.2 + 7) / 12)));
    assert.equal(full.perBucket.reduce((a, x) => a + x, 0), full.balanceQty);
    const bal = spreadAnnual(7000, 'BALANCE', b, w, true);
    assert.equal(bal.perBucket.reduce((a, x) => a + x, 0), 7000);
    assert.deepEqual(apportion(10, [1, 1, 1], true), [4, 3, 3]);
    // Custom monthly seasonality follows the calendar month of each period.
    const custom = Array(12).fill(0);
    custom[11] = 100; // December only
    const dec = spreadAnnual(1000, 'BALANCE', b, profileWeights(b, 'CUSTOM', custom, null), true);
    assert.equal(dec.perBucket[5], 1000);
});

test('SKU forecast: statistical engine, consensus basis, firm orders consume the forecast, overrides need a reason', () => {
    const b = bucketsOf(YEAR, '2026-11-25', 'prorate');
    const [line] = readLines([{ skuId: 'SKU_1', annualQty: 12000, forecastBasis: 'BLENDED', blendPct: 50 }], b, setup);
    const history = Array.from({ length: 18 }, (_, i) => ({ month: new Date(Date.UTC(2025, 4 + i, 1)).toISOString().slice(0, 7), qty: 900 + ((i * 37) % 200) }));
    const f = forecastSku({ line, uom: 'EA', whole: true, buckets: b, history, firm: { '2026-12': 2500 }, setup, now: '2026-11-25T08:00:00Z' });
    assert.ok(f.stat, 'statistical forecast available');
    assert.ok(['sma', 'wma', 'ses', 'holt', 'linear', 'croston', 'tsb'].includes(f.stat.method));
    assert.equal(f.effectiveBasis, 'BLENDED');
    const dec = f.buckets.find((x) => x.key === 'P06');
    assert.ok(dec.demand >= 2500, 'firm orders consume the forecast (the larger counts)');
    assert.ok(f.buckets.every((x) => Number.isInteger(x.demand)));
    assert.equal(f.buckets.slice(0, 4).reduce((a, x) => a + x.demand, 0), 0);
    // No history: falls back to the annual plan with a note.
    const none = forecastSku({ line: { ...line, forecastBasis: 'STATISTICAL' }, uom: 'EA', whole: true, buckets: b, history: [], firm: {}, setup, now: '2026-11-25T08:00:00Z' });
    assert.equal(none.effectiveBasis, 'ANNUAL');
    assert.ok(none.notes.some((n) => /annual plan is used/.test(n)));
    assert.throws(() => readLines([{ skuId: 'SKU_1', annualQty: 10, overrides: { P06: { qty: 5, reason: '' } } }], b, setup), /reason/);
    assert.throws(() => readLines([{ skuId: 'SKU_1', annualQty: 10, overrides: { P01: { qty: 5, reason: 'closed period' } } }], b, setup), /not an open period/);
    assert.throws(() => readLines([{ skuId: 'SKU_1', annualQty: 1 }, { skuId: 'SKU_1', annualQty: 2 }], b, setup), /twice/);
    const o = forecastSku({ line: { ...line, forecastBasis: 'ANNUAL', overrides: { P07: { qty: 4321, reason: 'promotion' } } }, uom: 'EA', whole: true, buckets: b, history: [], firm: {}, setup, now: '2026-11-25T08:00:00Z' });
    assert.equal(o.buckets.find((x) => x.key === 'P07').override, 4321);
});

test('BOM unitisation: least common multiple keeps whole-only BOM lines (bags, packs) whole; tolerance and vessels are optional', () => {
    assert.deepEqual(fraction(0.025), [1, 40]);
    const bom = { id: 'B1', outputQty: 100, outputUom: 'L', components: [
        { line: 1, source: 'WAREHOUSE', materialId: 'M1', warehouseId: 'W1', quantity: 2.5, uom: 'BAG', scrapPct: 2, splitRule: 'WHOLE', packSize: 1 },
        { line: 2, source: 'WAREHOUSE', materialId: 'M2', warehouseId: 'W1', quantity: 12.3, uom: 'KG', splitRule: 'SPLIT' },
        { line: 3, source: 'WAREHOUSE', materialId: 'M3', warehouseId: 'W1', quantity: 30, uom: 'KG', splitRule: 'WHOLE', packSize: 25 },
        { line: 4, source: 'PROCESS_SUPPLY', processSupplyKind: 'UTILITY', supplyUtilityCode: 'STEAM', quantity: 0.7, uom: 'EA', splitRule: 'WHOLE' },
    ] };
    const u = unitiseBom(bom, setup);
    // 2.5 bags per 100 L → 1 bag per 40 L; 30 kg in 25 kg sacks per 100 L → 1.2 sacks → whole at 500 L; lcm(40, 500) = 1000.
    assert.equal(u.exactBatch, 1000);
    assert.equal(u.minimalBatch, 1000);
    assert.equal(u.lines[0].packs, 25);
    assert.equal(u.lines[2].packs, 12);
    assert.equal(u.lines[1].indivisible, false, 'kilograms divide');
    assert.equal(u.lines[3].indivisible, false, 'utilities are metered, even in a discrete unit');
    const tol = unitiseBom(bom, { ...setup, unitTolerancePct: 5 });
    assert.ok(tol.minimalBatch < 1000 && tol.lines.every((l) => l.deviationPct <= 5));
    const plain = unitiseBom({ id: 'B2', outputQty: 1, outputUom: 'EA', components: [{ source: 'WAREHOUSE', materialId: 'X', warehouseId: 'W', quantity: 0.3, uom: 'KG' }] }, setup);
    assert.equal(plain.minimalBatch, 1, 'no indivisible component: one unit');
    // The rule is on the BOM line: a bag marked "can be split" divides; a line without a rule is read from its unit and flagged.
    const splitBag = unitiseBom({ id: 'B3', outputQty: 100, outputUom: 'L', components: [{ source: 'WAREHOUSE', materialId: 'M1', warehouseId: 'W1', quantity: 2.5, uom: 'BAG', splitRule: 'SPLIT' }] }, setup);
    assert.equal(splitBag.minimalBatch, 1);
    assert.equal(splitBag.lines[0].why, 'BOM: can be split');
    const unset = unitiseBom({ id: 'B4', outputQty: 100, outputUom: 'L', components: [{ source: 'WAREHOUSE', materialId: 'M1', warehouseId: 'W1', quantity: 2.5, uom: 'BAG' }] }, setup);
    assert.equal(unset.minimalBatch, 40);
    assert.match(unset.lines[0].why, /Not set on the BOM/);
    assert.ok(unset.notes.some((n) => /no split rule yet/.test(n)));
    const ms = { ...bom, components: bom.components.map((c) => (c.line === 3 ? { ...c, splitRule: 'SPLIT', packSize: null } : c)) };
    const vessel = unitiseBom(ms, { ...setup, processBatchRule: 'multiple' }, 1500);
    const vessel2 = unitiseBom(ms, { ...setup, processBatchRule: 'multiple' }, 2000);
    assert.equal(vessel2.lot, 2000, 'a vessel that holds whole bags is its own lot');
    assert.equal(vessel.minimalBatch, 40);
    assert.equal(vessel.lot, 3000, 'full vessel batches only and whole bags: lcm(40, 1500)');
    assert.deepEqual(unitise(1001, 1000), { qty: 2000, lots: 2, excess: 999 });
    assert.deepEqual(unitise(0, 1000), { qty: 0, lots: 0, excess: 0 });
});

test('MRP: multi-level explosion, scrap, whole packs, gross-to-net, MOQ and multiples, lead-time offset and order-now', () => {
    const b = bucketsOf(YEAR, '2026-11-25', 'prorate');
    const inter = { id: 'BI', outputQty: 100, outputUom: 'L', components: [{ line: 1, source: 'WAREHOUSE', materialId: 'BAG', warehouseId: 'W1', quantity: 2.5, uom: 'BAG', scrapPct: 2 }] };
    const fin = { id: 'BF', outputQty: 1, outputUom: 'EA', components: [{ line: 1, source: 'INTERMEDIATE', skuId: 'INT', quantity: 0.5, uom: 'L' }, { line: 2, source: 'WAREHOUSE', materialId: 'CAP', warehouseId: 'W1', quantity: 1, uom: 'EA' }] };
    const demand = new Map([['FG', b.map((x) => (x.fraction > 0 ? 1000 : 0))]]);
    const r = runMrp({
        buckets: b, demand, skus: new Map(),
        bomOf: (s) => (s === 'FG' ? fin : s === 'INT' ? inter : null),
        unitOf: (s, bom) => unitiseBom(bom, setup),
        materialOf: (m) => (m === 'CAP' ? { available: 2500, safetyStock: 500, openSupply: 1000, unitCost: 2, leadDays: 45, moq: 500, orderMultiple: 100 } : { available: 0, safetyStock: 0, openSupply: 0, unitCost: 10, leadDays: 0, moq: null, orderMultiple: null }),
    });
    const fg = r.items.find((i) => i.key === 'SKU:FG');
    const int = r.items.find((i) => i.key === 'SKU:INT');
    const cap = r.items.find((i) => i.key === 'MAT:CAP@W1');
    const bag = r.items.find((i) => i.key === 'MAT:BAG@W1');
    assert.equal(fg.level, 0);
    assert.equal(int.level, 1);
    assert.equal(bag.level, 2, 'low-level code below the intermediate');
    assert.equal(int.lot, 40, 'intermediate made in whole-bag batches');
    assert.ok(int.rows.every((x) => x.receipt % 40 === 0));
    // 40 L uses exactly 1 bag; scrap 2% → 1.02 → rounded up to whole bags per planned order.
    assert.ok(bag.rows.every((x) => Number.isInteger(x.gross)));
    // CAP: 2500 available − 500 safety + 1000 open supply covers the first two open periods (200 + 1000), then lots of ≥ 500 in multiples of 100.
    const p05 = cap.rows.find((x) => x.key === 'P05');
    assert.equal(p05.scheduled, 1000);
    assert.ok(cap.rows.every((x) => x.receipt === 0 || (x.receipt >= 500 && x.receipt % 100 === 0)));
    assert.equal(cap.leadBuckets, 2);
    assert.ok(cap.totals.value === cap.totals.receipts * 2);
    assert.deepEqual(cap.parents, ['FG']);
    assert.equal(buyLot(120, 500, 100), 500);
    assert.equal(buyLot(730, 500, 100), 800);
    // A cycle is reported, not looped.
    const cyc = runMrp({ buckets: b, demand: new Map([['A', [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]]]), skus: new Map(), bomOf: (s) => ({ id: s, outputQty: 1, outputUom: 'EA', components: [{ source: 'INTERMEDIATE', skuId: s === 'A' ? 'B' : 'A', quantity: 1, uom: 'EA' }] }), unitOf: (s, bom) => unitiseBom(bom, setup), materialOf: () => null });
    assert.ok(cyc.issues.some((x) => /cycle/.test(x)));
});

test('rough-cut capacity and the S&OP summary', () => {
    const b = bucketsOf(YEAR, '2026-11-25', 'prorate');
    const rr = routingRate([{ name: 'Mix', capacityBasis: 'BATCH_CYCLE', batchSize: 1000, cycleMinutes: 120, setupMinutes: 30 }, { name: 'Fill', runMinutesPerUnit: 0.01 }]);
    assert.equal(rr.ratePerHour, 500, 'mixing is the bottleneck at 500/h');
    assert.equal(rr.vessel, 1000);
    const cap = roughCut({ buckets: b, routings: [{ id: 'R1', name: 'Line 1', stages: [{ name: 'Mix', capacityBasis: 'BATCH_CYCLE', batchSize: 1000, cycleMinutes: 120, setupMinutes: 30 }], skus: ['FG'] }], production: new Map([['FG', b.map((x) => (x.fraction > 0 ? 300000 : 0))]]), setup });
    assert.ok(cap[0].overloaded.length > 0, '300,000 a month at 500/h overloads a 16 h × 6 d × 85% calendar');
    assert.equal(cap[0].buckets[0].required, 0);
    const forecasts = [{ skuId: 'FG', totals: { demand: 100 }, buckets: b.map((x) => ({ key: x.key, demand: x.fraction > 0 ? 10 : 0 })) }];
    const mrp = { items: [], skuPlan: new Map([['FG', { rows: b.map((x) => ({ key: x.key, receipt: x.fraction > 0 ? 12 : 0, projected: 1 })), lot: 12, lots: [] }]]), issues: [] };
    const s = sopSummary({ buckets: b, forecasts, mrp, capacity: cap, skus: new Map([['FG', { name: 'FG', uom: 'EA', category: 'FINISHED', processClassId: 'BEV', whole: true }]]) });
    assert.equal(s.families[0].family, 'BEV');
    assert.equal(s.kpis.unitisationExcess, 96 - 100 < 0 ? 0 : s.kpis.unitisationExcess);
    assert.equal(s.kpis.overloaded, 1);
});

test('workflow: independent people at every gate; forecast and supply must run before submission', () => {
    const a = { createdBy: 'p1', demandSubmittedBy: 'p1', demandApprovedBy: 'm1', supplySubmittedBy: 's1', sopApprovers: [] };
    assert.match(transitionCheck('draft', 'submit_demand', 'p1', a, {}), /Run the SKU forecast/);
    assert.equal(transitionCheck('draft', 'submit_demand', 'p1', a, { forecastRun: true }), '');
    assert.match(transitionCheck('demand_review', 'approve_demand', 'p1', a), /independent/);
    assert.equal(transitionCheck('demand_review', 'approve_demand', 'm1', a), '');
    assert.match(transitionCheck('supply_planning', 'submit_supply', 's1', a, { supplyRun: false }), /Run supply planning/);
    assert.match(transitionCheck('supply_planning', 'submit_supply', 's1', a, { supplyRun: true, supplyStale: true }), /again/);
    for (const who of ['p1', 'm1', 's1']) assert.match(transitionCheck('sop_review', 'approve_sop', who, a), /independent/);
    assert.equal(transitionCheck('sop_review', 'approve_sop', 'e1', a), '');
    assert.match(transitionCheck('sop_review', 'approve_sop', 'e1', { ...a, sopApprovers: ['e1'] }), /earlier level/);
    assert.match(transitionCheck('approved', 'release', 'e2', { ...a, sopApprovers: ['e1', 'e2'] }), /final approval/);
    assert.equal(transitionCheck('approved', 'release', 'r1', { ...a, sopApprovers: ['e1', 'e2'] }), '');
    assert.match(transitionCheck('released', 'edit_demand', 'p1', a), /cannot/);
});

test('setup validation: commercial demand is not linked yet; tolerance and calendar are bounded; split rules are not in setup', () => {
    assert.throws(() => readPlanningSetup({ demandSource: 'COMMERCIAL' }), /not linked yet/);
    assert.throws(() => readPlanningSetup({ unitTolerancePct: 50 }), /tolerance/);
    assert.throws(() => readPlanningSetup({ customProfile: [1, 2, 3] }), /12/);
    // An older setup that still carries the unit list and component packs is read without them.
    const ok = readPlanningSetup({ discreteUoms: ['ea', 'bag'], indivisible: [{ key: 'MAT:A', packSize: 0 }], hoursPerDay: 8 });
    assert.equal('discreteUoms' in ok, false);
    assert.equal('indivisible' in ok, false);
    assert.equal(ok.hoursPerDay, 8);
});

test('roles: new PLN permissions, segregation of duties, templates and level roles', () => {
    const keys = ALL_BUILT_KEYS;
    for (const k of ['PLN.demand.plan', 'PLN.demand.approve', 'PLN.supply.plan', 'PLN.sop.approve', 'PLN.mrp.release']) assert.ok(keys.has(k), k);
    for (const id of ['pln-demand-maker-checker', 'pln-supply-sop', 'pln-demand-sop', 'pln-setup-sop', 'pln-sop-release']) assert.ok(SOD_RULES.some((r) => r.id === id), id);
    const pln = LEVEL_ROLES.filter((r) => r.module === 'PLN');
    assert.equal(pln.length, 6);
    for (const r of pln) assert.deepEqual(sodConflicts(r.permissions), [], `${r.name} breaks no SoD rule`);
    const policy = read('backend/permissionPolicy.ts');
    for (const t of ['pln_demand_planner', 'pln_demand_manager', 'pln_supply_planner', 'pln_sop_approver', 'pln_plan_releaser', 'pln_planning_admin']) assert.ok(policy.includes(`'${t}'`), t);
});

test('routes are wired with their permissions, audited, scoped to the site and routed through the Chart of Authority', () => {
    const api = read('backend/plnPlanning.ts');
    const index = read('backend/index.ts');
    assert.ok(index.includes('...plnPlanningRoutes'));
    for (const [route, perm] of [['plan/create', 'PLN.demand.plan'], ['plan/demand/decide', 'PLN.demand.approve'], ['plan/supply/run', 'PLN.supply.plan'], ['plan/supply/submit', 'PLN.supply.plan'], ['plan/sop/decide', 'PLN.sop.approve'], ['plan/release', 'PLN.mrp.release'], ['setup/save', 'PLN.configure']]) {
        assert.match(api, new RegExp(`'POST /api/org/pln/planning/${route.replace(/\//g, '\\/')}': \\[\\s*orgRoute\\('[^']+', '${perm.replace('.', '\\.')}'`), route);
    }
    assert.ok(api.includes('approvalRoute(ctx.orgId, ctx.me, amount'), 'Chart of Authority on the planned purchase value');
    assert.ok(api.includes("await audited(ctx, `pln.plan.${action}`"), 'every plan change audited');
    assert.ok(api.includes("holdsDirect(ctx, ['PLN.configure'])"), 'organization setup needs a direct role');
    assert.ok(api.includes('fin.yearsOf(orgId, le.id)') && api.includes('fin.leOf(units, siteId)'), 'financial year of the site legal entity');
    assert.ok(api.includes("precondition: rec ? { updateTime: rec.updateTime } : { exists: false }"), 'plan of record written atomically');
});

test('workspace UI: action bar on top, content scrolls, rich tables with Excel and templates, standard fields and confirmations', () => {
    const ui = read('src/org/PlnPlanningWorkspace.tsx');
    const pf = read('src/org/ProductionFoundation.tsx');
    assert.ok(pf.includes("active==='sop'?<PlnPlanningWorkspace onOpenSetup={()=>changeTab('sopSetup')}/>"));
    assert.ok(pf.includes("useState<Tab>(phase?landingTab(phase):module==='PLN'?'sop':'materialPolicy')"), 'whole-module default still opens S&OP; a submodule opens its own first screen');
    assert.ok(ui.includes("sticky top-0 z-20"), 'action bar stays on top');
    assert.ok(ui.includes("min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain"), 'only the content scrolls');
    for (const id of ['pln.sop.forecast', 'pln.sop.mrp', 'pln.sop.units', 'pln.sop.capacity', 'pln.sop.lines']) assert.ok(ui.includes(`id='${id}'`), id);
    assert.ok(ui.includes('SelectField') && ui.includes('SearchField') && ui.includes('TextArea'));
    assert.ok(ui.includes("reason: { label: 'Reason for the change', minLength: 10 }"), 'setup change needs a reason');
    assert.ok(ui.includes('Fix the highlighted lines.'), 'demand lines verified before saving');
    assert.ok(!ui.includes('window.prompt') && !ui.includes('window.confirm'));
});

test('S&OP setup is its own focused tab; site, year and plan are a menu, not dropdowns', () => {
    const ui = read('src/org/PlnPlanningWorkspace.tsx');
    const pf = read('src/org/ProductionFoundation.tsx');
    assert.ok(pf.includes("{key:'sopSetup',label:'S&OP Setup'"));
    assert.ok(pf.includes(":active==='sopSetup'?<PlnPlanningSetup onOpenBoms={()=>changeTab('boms')}/>"));
    assert.ok(ui.includes('export function PlnPlanningSetup({ onOpenBoms }'));
    assert.ok(!ui.includes("{ key: 'setup', label: 'Setup'"), 'setup is no longer a workspace view');
    assert.ok(!ui.includes("<Select label='Site'") && !ui.includes("<Select label='Plan'"), 'no site or plan dropdown');
    assert.ok(ui.includes("role='menuitemradio'") && ui.includes("title='Site, financial year and plan'"));
    assert.ok(ui.includes("S&OP planning setup") && ui.includes("disabled={!dirty} onClick={save}"), 'pinned save bar, enabled only with changes');
});
