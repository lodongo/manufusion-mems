import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openQuantity, plan } from '../../backend/mrpPlan.ts';
import { observeFirestoreWrite, withChangeTracking } from '../../backend/changeTracker.ts';
import { mrpSweepDue } from '../../backend/automationEngine.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';
import { BUILT_PERMISSIONS, ROLE_TEMPLATES, SOD_RULES } from '../../backend/permissionPolicy.ts';

const base = { available: 0, openSupply: 0, minimumLevel: null, maximumLevel: null, reorderPoint: null, reorderQuantity: null, safetyStock: null, minimumOrderQuantity: null, orderMultiple: null };

test('Min/max: order up to the maximum when projected stock is at or below the minimum', () => {
  const r = plan({ ...base, policy: 'MINMAX', available: 4, openSupply: 2, minimumLevel: 6, maximumLevel: 20, safetyStock: 2 });
  assert.equal(r.kind, 'order');
  assert.equal(r.quantity, 14);
  assert.equal(r.projected, 6);
  assert.equal(r.urgency, 'medium');
  assert.equal(plan({ ...base, policy: 'MINMAX', available: 7, minimumLevel: 6, maximumLevel: 20 }).kind, 'no_need');
  // Open supply already covers it.
  assert.equal(plan({ ...base, policy: 'MINMAX', available: 1, openSupply: 10, minimumLevel: 6, maximumLevel: 20 }).kind, 'no_need');
  assert.equal(plan({ ...base, policy: 'MINMAX', available: 1, minimumLevel: 6 }).kind, 'incomplete');
  assert.equal(plan({ ...base, policy: 'MINMAX', available: 1, minimumLevel: 30, maximumLevel: 20 }).kind, 'incomplete');
});

test('Reorder point: reorder quantity as many times as needed, or up to the maximum', () => {
  const once = plan({ ...base, policy: 'REORDER', available: 5, reorderPoint: 10, reorderQuantity: 50 });
  assert.equal(once.kind, 'order');
  assert.equal(once.quantity, 50);
  const twice = plan({ ...base, policy: 'reorder', available: -40, reorderPoint: 10, reorderQuantity: 30 });
  assert.equal(twice.quantity, 60);
  assert.equal(twice.urgency, 'high');
  const upTo = plan({ ...base, policy: 'REORDER', available: 3, reorderPoint: 10, maximumLevel: 25 });
  assert.equal(upTo.quantity, 22);
  assert.equal(plan({ ...base, policy: 'REORDER', available: 3, reorderPoint: 10 }).kind, 'incomplete');
  assert.equal(plan({ ...base, policy: 'REORDER', available: 11, reorderPoint: 10, reorderQuantity: 5 }).kind, 'no_need');
});

test('minimum order quantity and order multiple; urgency from safety stock; other policies are not planned', () => {
  const moq = plan({ ...base, policy: 'MINMAX', available: 9, minimumLevel: 10, maximumLevel: 12, minimumOrderQuantity: 25 });
  assert.equal(moq.quantity, 25);
  const mult = plan({ ...base, policy: 'MINMAX', available: 9, minimumLevel: 10, maximumLevel: 22, orderMultiple: 5 });
  assert.equal(mult.quantity, 15);
  assert.match(mult.basis, /multiple of 5/);
  assert.equal(plan({ ...base, policy: 'MINMAX', available: 2, minimumLevel: 10, maximumLevel: 20, safetyStock: 2 }).urgency, 'high');
  for (const p of ['STOCK', 'NONSTOCK', 'ONDEMAND', 'JIT', '']) assert.equal(plan({ ...base, policy: p, available: 0 }).kind, 'not_planned');
});

test('open supply: requirement and requisition quantities, purchase orders minus what was received', () => {
  assert.equal(openQuantity('req', { quantity: 5 }), 5);
  assert.equal(openQuantity('prq', { quantity: '7' }), 7);
  assert.equal(openQuantity('po', { quantity: 10, receivedQty: 4 }), 6);
  assert.equal(openQuantity('po', { quantity: 10, receivedQty: 12 }), 0);
});

const BASE = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents';
const ROOT = 'projects/p/databases/(default)/documents';
const s = (v) => ({ stringValue: v });

test('any write to a material, its settings, extensions or stock journal is tracked for MRP', async () => {
  const { changes, unresolved } = await withChangeTracking(async () => {
    observeFirestoreWrite(`${BASE}/organizations/org1/materials/MAT1`, 'PATCH', { fields: { name: s('Bearing') } }, BASE, ROOT);
    observeFirestoreWrite(`${BASE}/organizations/org1/inventory_material_info/MAT2_WH1`, 'PATCH', { fields: { materialId: s('MAT2'), warehouseId: s('WH1'), minimumLevel: { integerValue: '4' } } }, BASE, ROOT);
    observeFirestoreWrite(`${BASE}:commit`, 'POST', { writes: [
      { update: { name: `${ROOT}/organizations/org1/material_journal/J1`, fields: { materialId: s('MAT3'), warehouseId: s('WH2') } } },
      { update: { name: `${ROOT}/organizations/org1/material_journal/J2`, fields: { status: s('posted') } }, updateMask: { fieldPaths: ['status'] } },
      { update: { name: `${ROOT}/organizations/org1/procurement_requirements/REQ1`, fields: { materialId: s('MAT9') } } },
    ] }, BASE, ROOT);
    observeFirestoreWrite(`${BASE}/organizations/org1/material_extensions/E1`, 'PATCH', { fields: { sourceId: s('MAT4'), warehouseId: s('WH3') } }, BASE, ROOT);
    observeFirestoreWrite(`${BASE}/organizations/org1/materials/MAT5`, 'GET', undefined, BASE, ROOT);
    observeFirestoreWrite(`${BASE}/organizations/org1/materials/MAT6`, 'DELETE', undefined, BASE, ROOT);
  });
  const keys = changes.map((c) => `${c.materialId}@${c.warehouseId || '*'}`).sort();
  assert.deepEqual(keys, ['MAT1@*', 'MAT2@WH1', 'MAT3@WH2', 'MAT4@WH3']);
  assert.deepEqual(unresolved, ['organizations/org1/material_journal/J2']);
});

test('nothing is tracked outside an organization request', async () => {
  observeFirestoreWrite(`${BASE}/organizations/org1/materials/MAT1`, 'PATCH', { fields: {} }, BASE, ROOT);
  const { changes } = await withChangeTracking(async () => undefined);
  assert.equal(changes.length, 0);
});

test('the scheduled MRP sweep is due by interval, or at once while an earlier sweep is unfinished', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 6 }, { lastCompletedAt: '2026-10-20T07:00:00Z' }, now), false);
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 6 }, { lastCompletedAt: '2026-10-20T05:59:00Z' }, now), true);
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 6 }, { lastCompletedAt: '2026-10-20T11:00:00Z', cursor: 'org5' }, now), true);
  assert.equal(mrpSweepDue({ enabled: false, intervalHours: 1 }, { cursor: 'org5' }, now), false);
  assert.equal(mrpSweepDue({ enabled: true, intervalHours: 1 }, {}, now), true);
});

test('MRP Replenishment Requests: rights, segregation, role templates and transaction codes', () => {
  const inv = BUILT_PERMISSIONS.INV.map((p) => p.key);
  for (const k of ['INV.mrp.view', 'INV.mrp.run', 'INV.mrp.verify']) assert.ok(inv.includes(k), k);
  assert.ok(BUILT_PERMISSIONS.INV.find((p) => p.key === 'INV.mrp.verify').sensitive);
  assert.ok(SOD_RULES.some((r) => r.a === 'INV.mrp.verify' && r.b === 'PRC.req.acknowledge'));
  assert.ok(SOD_RULES.some((r) => r.a === 'INV.mrp.verify' && r.b === 'PRC.po.approve'));
  const planner = ROLE_TEMPLATES.find((t) => t.id === 'inv_mrp_planner');
  assert.ok(planner && planner.permissions.includes('INV.mrp.verify') && !planner.permissions.includes('PRC.req.acknowledge'));
  for (const [path, code] of [
    ['/api/org/inventory/mrp/list', 'INV-RPL-VW'], ['/api/org/inventory/mrp/run', 'INV-RPL-RN'],
    ['/api/org/inventory/mrp/verify', 'INV-RPL-VF'], ['/api/org/inventory/mrp/dismiss', 'INV-RPL-RJ'],
  ]) {
    const l = linkRouteToBlueprint({ path });
    assert.equal(l && `${l.module}-${l.area}-${l.action}`, code, path);
  }
});

test('unverified MRP requirements are private to planners, verified by scope, audited; orgRoute tracks changes', () => {
  const req = fs.readFileSync(new URL('../../backend/purchaseRequirements.ts', import.meta.url), 'utf8');
  assert.match(req, /if \(status === 'unverified'\) return can\(ctx, 'PRC\.req\.viewall'\) \|\| can\(ctx, 'INV\.mrp\.view'\);/);
  assert.match(req, /orgRoute\('org\.inventory\.mrp\.verify', 'INV\.mrp\.verify'/);
  assert.match(req, /requireAt\(ctx, \['INV\.mrp\.verify'\], w, 'write'/);
  assert.match(req, /await record\(ctx, 'org\.inventory\.mrp\.verify'/);
  assert.match(req, /await record\(ctx, 'org\.inventory\.mrp\.dismiss'/);
  const mrp = fs.readFileSync(new URL('../../backend/mrp.ts', import.meta.url), 'utf8');
  assert.match(mrp, /status: 'unverified'/);
  assert.match(mrp, /orgRoute\('org\.inventory\.mrp\.run', 'INV\.mrp\.run'/);
  assert.match(mrp, /onMaterialChanges\(planChanges\)/);
  const guards = fs.readFileSync(new URL('../../backend/guards.ts', import.meta.url), 'utf8');
  assert.match(guards, /withChangeTracking\(\(\) => fn\(/);
  assert.match(guards, /await notifyMaterialChanges\(/);
});
