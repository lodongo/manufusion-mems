import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditMaterial, levelImpact } from '../../backend/materialAuditModel.ts';
import { readControl } from '../../backend/materialAudit.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = '2026-11-08T09:00:00Z';
const L = (min, max, roq, ss, rop) => ({ minimumLevel: min, maximumLevel: max, reorderQuantity: roq, safetyStock: ss, reorderPoint: rop });
const base = (o = {}) => ({
    now: NOW,
    strategy: 'RP01',
    automated: true,
    strategySource: 'manual',
    levels: L(40, 100, 60, 10, 40),
    criticality: { assessed: true, status: 'approved', cell: 'B3', cls: 'B', reviewDue: '2027-06-01', strategyMode: 'criticality', cutoff: 'C2', onDemandCell: false },
    forecast: { levelSource: 'forecast', levelMode: 'forecast', appliedAt: '2026-10-01T00:00:00Z', appliedSimulated: false, historyMonths: 12, minHistoryMonths: 6, demandPerMonth: 30, recommended: L(40, 100, 60, 10, 40), trend: 'stable', leadDays: 30, leadSource: 'actual', onDemand: false },
    stock: { physical: 60, available: 60, openSupply: 0 },
    unitCost: 10,
    holdingPct: 20,
    adjustments: [],
    lastIssueAt: '2026-11-01T00:00:00Z',
    annualIssues: 360,
    tolerancePct: 25,
    ...o,
});

test('a material in line with its analysis and forecast scores 100', () => {
    const r = auditMaterial(base());
    assert.equal(r.score, 100);
    assert.equal(r.rating, 'good');
    assert.deepEqual(Object.values(r.done), [true, true, true, true, true]);
});

test('reports what has not been done: criticality, forecast levels, lead time', () => {
    const r = auditMaterial(base({ criticality: { ...base().criticality, assessed: false, cell: '' }, forecast: { ...base().forecast, appliedAt: '', leadDays: 0 } }));
    const codes = r.findings.map((f) => f.code);
    for (const c of ['CRIT_MISSING', 'FC_NOT_APPLIED', 'LT_MISSING']) assert.ok(codes.includes(c), c);
    assert.equal(r.done.criticality, false);
    assert.equal(r.done.forecast, false);
    assert.ok(r.score < 70);
});

test('strategy and levels against the criticality analysis and the forecast', () => {
    const below = auditMaterial(base({ criticality: { ...base().criticality, cell: 'C2', cls: 'C', onDemandCell: true } }));
    assert.ok(below.findings.some((f) => f.code === 'STRAT_SHOULD_BE_ON_DEMAND' && f.severity === 'high'));
    const critOnDemand = auditMaterial(base({ strategy: 'RP07', automated: false, criticality: { ...base().criticality, cls: 'A', cell: 'A4' } }));
    assert.ok(critOnDemand.findings.some((f) => f.code === 'STRAT_CRITICAL_ON_DEMAND' && f.severity === 'high'));
    const off = auditMaterial(base({ levels: L(10, 300, 60, 10, 10) }));
    assert.ok(off.findings.some((f) => f.code === 'LVL_OFF_FORECAST'));
    assert.equal(off.done.levelsAligned, false);
    assert.ok(auditMaterial(base({ levels: L(120, 100, 60, 10, 40) })).findings.some((f) => f.code === 'LVL_MIN_ABOVE_MAX'));
});

test('count adjustments: repeated, one-directional and large against usage', () => {
    const adj = [-5, -8, -6, -40].map((q, i) => ({ at: `2026-0${i + 3}-10T00:00:00Z`, qty: q, reference: `PI${i}` }));
    const r = auditMaterial(base({ adjustments: adj, annualIssues: 200 }));
    const codes = r.findings.map((f) => f.code);
    assert.ok(codes.includes('ADJ_REPEATED') && codes.includes('ADJ_LOSS_BIAS') && codes.includes('ADJ_LARGE_SHARE'));
    assert.equal(r.adjustments.netQty, -59);
    assert.equal(r.adjustments.grossValue, 590);
});

test('risk and opportunity in stock holding: excess, dead stock, stock-out exposure', () => {
    const excess = auditMaterial(base({ stock: { physical: 400, available: 400, openSupply: 0 } }));
    assert.equal(excess.holding.excessQty, 300);
    assert.equal(excess.holding.excessValue, 3000);
    assert.equal(excess.holding.opportunityYear, 600);
    const dead = auditMaterial(base({ lastIssueAt: '2025-01-01T00:00:00Z', stock: { physical: 50, available: 50, openSupply: 0 } }));
    assert.ok(dead.findings.some((f) => f.code === 'STK_DEAD' && f.severity === 'high'));
    const short = auditMaterial(base({ stock: { physical: 5, available: 5, openSupply: 10 } }));
    assert.equal(short.holding.shortfallQty, 25);
    assert.equal(short.holding.riskValue, 250);
    assert.ok(short.findings.some((f) => f.code === 'STK_BELOW_ROP') && short.findings.some((f) => f.code === 'STK_BELOW_SS'));
});

test('impact of accepted levels on stock holding', () => {
    const i = levelImpact(L(20, 60, 40, 5, 20), L(40, 100, 60, 10, 40), { available: 30, openSupply: 0, demandPerMonth: 30, unitCost: 10, holdingPct: 20 });
    assert.equal(i.averageStockBefore, 25);
    assert.equal(i.averageStockAfter, 40);
    assert.equal(i.averageValueChange, 150);
    assert.equal(i.holdingCostChangeYear, 30);
    assert.equal(i.maxValueChange, 400);
    assert.equal(i.orderNowQty, 70);
    assert.equal(i.direction, 'more stock');
});

test('change control: setup, server enforcement, logging and audit routes', () => {
    assert.deepEqual(readControl({ manual: { stockControl: false }, tolerancePct: 30 }), { manual: { stockControl: false, replenishment: true, procurement: true }, tolerancePct: 30 });
    assert.throws(() => readControl({ manual: {}, tolerancePct: 0 }), /Tolerance/);
    const proc = read('backend/procurement.ts');
    assert.match(proc, /manualChangeBlocked\(ctx\.orgId,section,changed/);
    assert.match(proc, /logLevelChange\(ctx\.orgId,id,warehouseId,old\?\.data\?\?null,clean,\{source:'manual'/);
    assert.match(read('backend/forecasting.ts'), /logLevelChange\(ctx\.orgId, materialId, warehouseId, info, patch, \{ source: 'forecast'/);
    const server = read('backend/materialAudit.ts');
    assert.match(server, /audited\(ctx, 'inventory\.controls\.save'/);
    assert.match(server, /audited\(ctx, 'inventory\.audit\.run'/);
    assert.match(server, /material_audits\/\$\{materialId\}_\$\{warehouseId\}_\$\{day\}/, 'one saved report per day for the trend');
    assert.doesNotMatch(server, /orgRoute\('[^']+', null/);
    assert.match(read('backend/index.ts'), /\.\.\.materialAuditRoutes/);
    assert.match(read('backend/permissionPolicy.ts'), /T\('inv_stock_auditor'/);
});

test('UI: Technical Data after Current Status, Audit tab last, setup tabs for change control and audits', () => {
    const detail = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(detail, /const TABS = \['Overview', 'Current Status', 'Technical Data', 'Inventory Information'/);
    assert.match(detail, /'Forecasting', 'Audit'\] as const/);
    assert.match(detail, /manualBlocked/);
    const setup = read('src/org/CriticalityAnalysis.tsx');
    assert.match(setup, /label: 'Change control'/);
    assert.match(setup, /label: 'Material audits'/);
});
