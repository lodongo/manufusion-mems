import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACTORS, defaultSetup, readSetup, scoreCriticality, movementFromData, onDemand } from '../../backend/criticalityModel.ts';
import { plan } from '../../backend/replenishmentPlan.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const only = (codes, extra = {}) => ({ ...defaultSetup(), factors: Object.fromEntries(FACTORS.map((f) => [f.code, { enabled: codes.includes(f.code), weight: 1 }])), ...extra });

test('Factor catalogue covers consequence and supply risk with three described levels each', () => {
    assert.ok(FACTORS.length >= 20);
    for (const code of ['SAF', 'FSQ', 'ENV', 'REG', 'PRD', 'RED', 'PRE', 'SUP', 'LDT', 'SUB', 'OBS', 'REP']) assert.ok(FACTORS.some((f) => f.code === code), code);
    for (const f of FACTORS) assert.equal(f.levels.length, 3, f.code);
    assert.deepEqual(FACTORS.filter((f) => f.hse).map((f) => f.code), ['SAF', 'FSQ', 'ENV', 'REG']);
});

test('Score is scaled 1-4 between the lowest and highest possible score and rounded to a class', () => {
    const s = only(['PRD', 'RED', 'SUP', 'LDT'], { hseOverride: true });
    assert.equal(scoreCriticality(s, { PRD: 1, RED: 1, SUP: 1, LDT: 1 }).criticalityClass, 'D');
    assert.equal(scoreCriticality(s, { PRD: 3, RED: 3, SUP: 3, LDT: 3 }).criticalityClass, 'A');
    const mid = scoreCriticality(s, { PRD: 2, RED: 2, SUP: 2, LDT: 2 });
    assert.equal(mid.scaled, 2.5);
    assert.equal(mid.level, 3, '2.5 rounds up');
    assert.equal(scoreCriticality(s, { PRD: 2, RED: 1, SUP: 1, LDT: 2 }).criticalityClass, 'C');
    // Weights count: a heavy production factor pulls the class up.
    const w = { ...s, factors: { ...s.factors, PRD: { enabled: true, weight: 3 } } };
    assert.equal(scoreCriticality(w, { PRD: 3, RED: 1, SUP: 1, LDT: 1 }).criticalityClass, 'B');
    assert.equal(scoreCriticality(s, { PRD: 2 }).complete, false);
});

test('High-consequence override: a very significant safety rating makes the material A (unless switched off)', () => {
    const s = only(['SAF', 'PRD', 'RED', 'SUP']);
    const r = scoreCriticality(s, { SAF: 3, PRD: 1, RED: 1, SUP: 1 });
    assert.equal(r.criticalityClass, 'A');
    assert.deepEqual(r.overrideBy, ['Personal safety']);
    assert.equal(scoreCriticality({ ...s, hseOverride: false }, { SAF: 3, PRD: 1, RED: 1, SUP: 1 }).criticalityClass, 'C');
});

test('Movement: months with issues per year, not one-off quantity; manual when history is short', () => {
    const s = defaultSetup();
    const months = (q) => q.map((quantity, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, quantity }));
    assert.equal(movementFromData(s, { months: months([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]), historyMonths: 30 }).level, 4);
    const oneOff = movementFromData(s, { months: months([0, 0, 0, 0, 0, 900, 0, 0, 0, 0, 0, 0]), historyMonths: 30 });
    assert.equal(oneOff.level, 1, 'a single large purchase is very slow moving');
    assert.equal(oneOff.concentrationPct, 100);
    assert.equal(movementFromData(s, { months: months([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]), historyMonths: 14 }).level, 3);
    assert.equal(movementFromData(s, { months: months([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]), historyMonths: 4 }).level, null, 'under six months: chosen by hand');
    const eight = movementFromData(s, { months: months([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1]), historyMonths: 8 });
    assert.equal(eight.monthsWithIssuesPerYear, 12, 'scaled to a year over the history that exists');
});

test('Cutoff: cells at or below it (class and movement) are bought on demand; setup validation', () => {
    for (const c of ['C1', 'C2', 'D1', 'D2']) assert.equal(onDemand(c, 'C2'), true, c);
    for (const c of ['C3', 'B2', 'B1', 'A4', 'D3']) assert.equal(onDemand(c, 'C2'), false, c);
    assert.throws(() => readSetup({ ...defaultSetup(), cutoff: 'E5' }), /cutoff/);
    assert.throws(() => readSetup({ ...defaultSetup(), thresholds: { m4: 6, m3: 6, m2: 2 } }), /decrease/);
    assert.throws(() => readSetup({ ...defaultSetup(), minHistoryMonths: 3 }), /6 to 24/);
    assert.throws(() => readSetup(only(['SAF', 'PRD'])), /at least three/);
});

test('RP07 (on demand) never plans automatically', () => {
    const r = plan('RP07', { leadTimeDays: 0 }, { available: 0, openSupply: 0, consumed: 100, consumedDays: 30 });
    assert.equal(r.kind, 'not_planned');
    assert.match(r.reason, /never runs/);
});

test('Workflow, approval, strategy lock, permissions and screens', () => {
    const server = read('backend/criticality.ts');
    assert.match(server, /An assessment must be approved by someone other than the person who made it\./);
    assert.match(server, /bypass\(ctx, 'inv\.criticality\.approve_independence'\)/);
    assert.match(server, /patch\.replenishmentStrategy = ON_DEMAND_STRATEGY;/);
    assert.match(server, /patch\.strategySource = 'manual';/, 'above the cutoff again the strategy is manual');
    assert.match(server, /Give a reason of at least 10 characters for the change/);
    assert.match(server, /audited\(ctx, 'inventory\.criticality\.approve'/);
    assert.match(server, /audited\(ctx, 'inventory\.criticality\.setup\.save'/);
    const proc = read('backend/procurement.ts');
    assert.match(proc, /const lock=await strategyLockedByCriticality\(ctx\.orgId,before\);/);
    assert.match(proc, /The criticality class comes from the criticality assessment/);
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /id: 'criticality-assess-approve', a: 'INV\.criticality\.assess', b: 'INV\.criticality\.approve'/);
    assert.match(policy, /T\('inv_criticality_approver'/);
    const ui = read('src/org/CriticalityAnalysis.tsx');
    assert.match(ui, /export function MaterialCriticality\(/);
    assert.match(ui, /export function CriticalityGrid\(/);
    assert.match(ui, /export default function InventorySetup\(/);
    assert.match(read('src/org/OrgHomePage.tsx'), /'Alerts','Setup'\]/);
    assert.match(read('src/org/InventoryMaterialDetail.tsx'), /<MaterialCriticality materialId=\{id\} warehouseId=\{warehouseId\} onChanged=\{reload\} \/>/);
});
