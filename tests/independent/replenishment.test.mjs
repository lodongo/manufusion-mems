import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTOMATED_METHODS, METHODS, PARAMS, factorsOf, methodOf, openQuantity, plan, routeFor } from '../../backend/replenishmentPlan.ts';
import { STOCK_META_BY_KEY } from '../../backend/universalStockMetadata.ts';
import { observeFirestoreWrite, withChangeTracking } from '../../backend/changeTracker.ts';
import { mrpSweepDue } from '../../backend/automationEngine.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';
import { BUILT_PERMISSIONS, ROLE_TEMPLATES, SOD_RULES } from '../../backend/permissionPolicy.ts';
import { expandPermissions } from '../../backend/guards.ts';

const P = {
  minimumLevel: null, maximumLevel: null, reorderPoint: null, reorderQuantity: null, safetyStock: null, minimumOrderQuantity: null, orderMultiple: null,
  leadTimeDays: 10, unitPrice: null, annualDemand: null, orderCost: null, holdingCostRate: null, demandLookbackDays: null, coverageDays: null,
  emergencyLevel: null, strategicLevel: null, seasonalFactors: null, rotablesInRepair: null, binQuantity: null, kanbanCardQuantity: null, kanbanCards: null,
  reviewPeriodDays: null, forecastMonthlyDemand: null,
};
const S = { available: 0, openSupply: 0, consumed: 0, consumedDays: 90, arrivalMonth: 0, daysSinceReview: null };
const run = (m, p = {}, s = {}) => plan(m, { ...P, ...p }, { ...S, ...s });

test('every replenishment strategy of the MEMS stock metadata has a defined method; MRP is one of them', () => {
  const codes = STOCK_META_BY_KEY.get('replenishmentStrategies').items.map((i) => i.code);
  assert.deepEqual(Object.keys(METHODS).sort(), codes.sort());
  assert.equal(METHODS.RP06.name, 'MRP-controlled');
  assert.deepEqual(Object.values(METHODS).filter((m) => !m.automated).map((m) => m.code).sort(), ['RP07', 'RP18']);
  for (const m of Object.values(METHODS)) for (const k of [...m.required, ...m.optional]) assert.ok(PARAMS[k], `${m.code} uses unknown parameter ${k}`);
  assert.equal(methodOf('', 'MINMAX'), 'RP01');
  assert.equal(methodOf('', 'REORDER'), 'RP02');
  assert.equal(methodOf('RP14', 'MINMAX'), 'RP14');
  assert.equal(methodOf('', 'STOCK'), '');
});

test('Min-Max, Reorder Point and order-up-to', () => {
  assert.equal(run('RP01', { minimumLevel: 6, maximumLevel: 20 }, { available: 4, openSupply: 2 }).quantity, 14);
  assert.equal(run('RP01', { minimumLevel: 6, maximumLevel: 20 }, { available: 7 }).kind, 'no_need');
  assert.equal(run('RP01', { minimumLevel: 6 }).kind, 'incomplete');
  assert.equal(run('RP02', { reorderPoint: 10, reorderQuantity: 30 }, { available: -40 }).quantity, 60);
  assert.equal(run('RP02', { reorderPoint: 10, maximumLevel: 25 }, { available: 3 }).quantity, 22);
  assert.equal(run('RP16', { maximumLevel: 50 }, { available: 49 }).quantity, 1);
  assert.equal(run('RP16', { maximumLevel: 50, reorderPoint: 20 }, { available: 30 }).kind, 'no_need');
});

test('Economic order quantity from entered or derived annual demand', () => {
  // EOQ = sqrt(2 × 1200 × 50 / (20 × 25%)) = sqrt(24000) ≈ 154.919
  const r = run('RP03', { reorderPoint: 40, orderCost: 50, holdingCostRate: 25, unitPrice: 20, annualDemand: 1200 }, { available: 30 });
  assert.equal(r.kind, 'order');
  assert.ok(Math.abs(r.quantity - 154.919) < 0.01, String(r.quantity));
  const derived = run('RP03', { reorderPoint: 40, orderCost: 50, holdingCostRate: 25, unitPrice: 20 }, { available: 30, consumed: 300, consumedDays: 90 });
  assert.equal(derived.kind, 'order');
  assert.equal(run('RP03', { reorderPoint: 40, orderCost: 50, holdingCostRate: 25 }, { available: 30, consumed: 300 }).kind, 'incomplete');
});

test('Just-in-time orders exactly the uncovered reserved demand; MRP nets requirements against safety stock', () => {
  assert.equal(run('RP04', {}, { available: -12, openSupply: 5 }).quantity, 7);
  assert.equal(run('RP04', {}, { available: -12, openSupply: 5 }).urgency, 'high');
  assert.equal(run('RP04', {}, { available: 0 }).kind, 'no_need');
  assert.equal(run('RP06', { safetyStock: 10 }, { available: 4 }).quantity, 6);
  assert.equal(run('RP06', { safetyStock: 10 }, { available: 10 }).kind, 'no_need');
  assert.match(run('RP06', { safetyStock: 10 }, { available: 4 }).basis, /MRP: net requirement/);
});

test('Demand-driven and forecast-driven levels follow usage', () => {
  // 90 used in 90 days → 1/day; reorder level = 1 × 10 + 5 = 15; target = 15 + 1 × 30 = 45
  const d = run('RP05', { safetyStock: 5 }, { available: 12, consumed: 90, consumedDays: 90 });
  assert.equal(d.trigger, 15);
  assert.equal(d.quantity, 33);
  assert.equal(run('RP05', { safetyStock: 5 }, { available: 20, consumed: 0 }).kind, 'no_need');
  const f = run('RP17', { forecastMonthlyDemand: 304, coverageDays: 20 }, { available: 50 });
  assert.equal(f.trigger, 100);
  assert.equal(f.quantity, 250);
});

test('Emergency, strategic, rotable and seasonal stock', () => {
  const e = run('RP08', { emergencyLevel: 4 }, { available: 1 });
  assert.equal(e.quantity, 3);
  assert.equal(e.urgency, 'high');
  assert.equal(run('RP11', { strategicLevel: 100 }, { available: 70, openSupply: 10 }).quantity, 20);
  assert.equal(run('RP09', { minimumLevel: 2, maximumLevel: 6, rotablesInRepair: 3 }, { available: 0 }).kind, 'no_need');
  assert.equal(run('RP09', { minimumLevel: 2, maximumLevel: 6, rotablesInRepair: 1 }, { available: 0 }).quantity, 5);
  const factors = factorsOf('1,1,1,1,1,1,1,1,1,1,2,2');
  assert.equal(run('RP10', { minimumLevel: 10, maximumLevel: 20, seasonalFactors: factors }, { available: 15, arrivalMonth: 10 }).quantity, 25);
  assert.equal(run('RP10', { minimumLevel: 10, maximumLevel: 20, seasonalFactors: factors }, { available: 15, arrivalMonth: 3 }).kind, 'no_need');
  assert.equal(factorsOf('1,2,3'), null);
  assert.equal(factorsOf('1,1,1,1,1,1,1,1,1,1,1,11'), null);
});

test('Two-bin, kanban and periodic review', () => {
  assert.equal(run('RP13', { binQuantity: 25 }, { available: 20 }).quantity, 25);
  assert.equal(run('RP13', { binQuantity: 25 }, { available: 0 }).quantity, 50);
  assert.equal(run('RP13', { binQuantity: 25 }, { available: 30 }).kind, 'no_need');
  assert.equal(run('RP14', { kanbanCardQuantity: 10, kanbanCards: 5 }, { available: 27 }).quantity, 20);
  assert.equal(run('RP14', { kanbanCardQuantity: 10, kanbanCards: 5 }, { available: 45 }).kind, 'no_need');
  assert.equal(run('RP15', { reviewPeriodDays: 7, maximumLevel: 100 }, { available: 40, daysSinceReview: 3 }).kind, 'not_due');
  assert.equal(run('RP15', { reviewPeriodDays: 7, maximumLevel: 100 }, { available: 40, daysSinceReview: 8 }).quantity, 60);
  assert.equal(run('RP15', { reviewPeriodDays: 7, maximumLevel: 100 }, { available: 40, daysSinceReview: null }).quantity, 60);
});

test('direct purchase and non-stock are never replenished; minimum order quantity and multiple apply to every method', () => {
  assert.equal(run('RP07').kind, 'not_planned');
  assert.equal(run('RP18').kind, 'not_planned');
  assert.equal(run('').kind, 'not_planned');
  assert.equal(run('RP14', { kanbanCardQuantity: 10, kanbanCards: 5, orderMultiple: 12 }, { available: 37 }).quantity, 12);
  assert.equal(run('RP08', { emergencyLevel: 4, minimumOrderQuantity: 10 }, { available: 1 }).quantity, 10);
});

test('who acts: company buying raises a purchase; consignment, VMI and owners get signals; unresolved ownership is blocked', () => {
  assert.equal(routeFor('OW01', 'SA01', 'RP01').kind, 'purchase');
  assert.equal(routeFor('', '', 'RP01').kind, 'purchase');
  assert.equal(routeFor('OW01', 'SA15', 'RP08').urgent, true);
  assert.equal(routeFor('OW01', 'SA01', 'RP12').signal, 'supplier_managed');
  for (const [ow, sa, sig] of [['OW02', 'SA02', 'consignment_calloff'], ['OW01', 'SA03', 'supplier_managed'], ['OW03', 'SA04', 'customer_supply'],
    ['OW01', 'SA05', 'supplier_held_release'], ['OW04', 'SA06', 'third_party_release'], ['OW01', 'SA07', 'subcontract_supply'],
    ['OW05', 'SA08', 'intercompany_transfer'], ['OW01', 'SA09', 'loan_request'], ['OW01', 'SA10', 'returnable_pool'],
    ['OW01', 'SA13', 'shared_pool'], ['OW01', 'SA17', 'exchange_pool'], ['OW07', 'SA01', 'owner_agreement']]) {
    const r = routeFor(ow, sa, 'RP01');
    assert.equal(r.kind, 'signal', `${ow}/${sa}`);
    assert.equal(r.signal, sig, `${ow}/${sa}`);
  }
  assert.equal(routeFor('OW08', 'SA01', 'RP01').kind, 'blocked');
  assert.equal(routeFor('OW01', 'SA12', 'RP01').kind, 'blocked');
});

test('open supply nets receipts; material changes are tracked', async () => {
  assert.equal(openQuantity('po', { quantity: 10, receivedQty: 4 }), 6);
  const BASE = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents';
  const ROOT = 'projects/p/databases/(default)/documents';
  const { changes } = await withChangeTracking(async () => {
    observeFirestoreWrite(`${BASE}/organizations/o/inventory_material_info/M_W`, 'PATCH', { fields: { materialId: { stringValue: 'M' }, warehouseId: { stringValue: 'W' } } }, BASE, ROOT);
  });
  assert.deepEqual(changes.map((c) => `${c.materialId}@${c.warehouseId}`), ['M@W']);
});

test('the scheduled replenishment sweep is due by interval, or at once while unfinished', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 6 }, { lastCompletedAt: '2026-10-20T07:00:00Z' }, now), false);
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 6 }, { lastCompletedAt: '2026-10-20T07:00:00Z', cursor: 'o' }, now), true);
  assert.equal(mrpSweepDue({ enabled: false, intervalHours: 1 }, {}, now), false);
});

test('Replenishment rights, segregation, templates, codes; earlier MRP rights keep working', () => {
  const inv = BUILT_PERMISSIONS.INV.map((p) => p.key);
  for (const k of ['INV.replenishment.view', 'INV.replenishment.run', 'INV.replenishment.verify']) assert.ok(inv.includes(k), k);
  assert.ok(!inv.some((k) => k.startsWith('INV.mrp.')));
  assert.ok(BUILT_PERMISSIONS.INV.find((p) => p.key === 'INV.replenishment.verify').sensitive);
  assert.deepEqual(expandPermissions(['INV.mrp.verify']).sort(), ['INV.mrp.verify', 'INV.replenishment.verify']);
  assert.ok(SOD_RULES.some((r) => r.a === 'INV.replenishment.verify' && r.b === 'PRC.req.acknowledge'));
  assert.ok(SOD_RULES.some((r) => r.a === 'INV.replenishment.verify' && r.b === 'PRC.po.approve'));
  assert.ok(ROLE_TEMPLATES.find((t) => t.id === 'inv_replenishment_planner').permissions.includes('INV.replenishment.verify'));
  for (const [path, code] of [
    ['/api/org/inventory/replenishment/list', 'INV-RPL-VW'], ['/api/org/inventory/replenishment/run', 'INV-RPL-RN'],
    ['/api/org/inventory/replenishment/verify', 'INV-RPL-VF'], ['/api/org/inventory/replenishment/dismiss', 'INV-RPL-RJ'],
    ['/api/org/inventory/replenishment/signal/acknowledge', 'INV-RPL-AK'],
  ]) {
    const l = linkRouteToBlueprint({ path });
    assert.equal(l && `${l.module}-${l.area}-${l.action}`, code, path);
  }
  assert.ok(AUTOMATED_METHODS.length === 16);
});

test('engine and screens: unverified requests are private, verified in scope, audited; tabs save only their own fields', () => {
  const req = fs.readFileSync(new URL('../../backend/purchaseRequirements.ts', import.meta.url), 'utf8');
  assert.match(req, /if \(status === 'unverified'\) return can\(ctx, 'PRC\.req\.viewall'\) \|\| can\(ctx, 'INV\.replenishment\.view'\);/);
  assert.match(req, /requireAt\(ctx, \['INV\.replenishment\.verify'\], w, 'write'/);
  assert.match(req, /await record\(ctx, 'org\.inventory\.replenishment\.verify'/);
  const eng = fs.readFileSync(new URL('../../backend/replenishment.ts', import.meta.url), 'utf8');
  assert.match(eng, /status: 'unverified', source: 'replenishment'/);
  assert.match(eng, /onMaterialChanges\(planChanges\)/);
  assert.match(eng, /await record\(ctx, 'org\.inventory\.replenishment\.signal\.acknowledge'/);
  const ui = fs.readFileSync(new URL('../../src/org/InventoryMaterialDetail.tsx', import.meta.url), 'utf8');
  assert.match(ui, /settingsPayload\(values, fields\)/);
  assert.match(ui, /validateSettings\(section, values, fields\)/);
  const proc = fs.readFileSync(new URL('../../backend/procurement.ts', import.meta.url), 'utf8');
  assert.match(proc, /const route=routeFor\(owner,arrangement,method\);/);
});
