import assert from 'node:assert/strict';
import { seed, snapshot } from './maintenance-fixture.ts';
import { storesReleaseRoutes } from '../../backend/storesRelease.ts';
import { storesGate } from '../../backend/purchaseRequirements.ts';
import { supplyIndex } from '../../backend/replenishment.ts';

const org = 'sr_fixture', r = 'organizations/' + org;
const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
seed(r, { status: 'active', currencyCode: 'KES', modules: { PRC: true, INV: true } });
seed(r + '/structure/LE01', { level: 'legal_entity', code: 'LE01', name: 'Entity', parentId: '' });
seed(r + '/structure/WH01', { level: 'cost_center', code: 'WH01', name: 'Main stores', parentId: 'LE01', attributes: { costType: 'INV' } });
seed(r + '/warehouses/WH01', { name: 'Main stores' });
seed(r + '/materials/MAT1', { materialNumber: 'M0001', name: 'Bearing', status: 'approved', warehouseIds: ['WH01'] });
seed(r + '/inventory_material_info/MAT1_WH01', { materialId: 'MAT1', warehouseId: 'WH01', replenishmentStrategy: 'RP01', minimumLevel: 10, maximumLevel: 30 });
seed(r + '/procurement_material_info/MAT1_WH01', { leadTimeDays: 20 });
seed(r + '/material_journal/OPEN', { materialId: 'MAT1', warehouseId: 'WH01', type: 'OPENING', status: 'posted', reconciled: true, balancesDelta: { physicalStock: 8 }, postedAt: '2026-01-01T00:00:00Z' });
seed(r + '/material_journal/RES', { materialId: 'MAT1', warehouseId: 'WH01', type: 'MAINTENANCE_RESERVATION', status: 'posted', reconciled: true, balancesDelta: { reservedStock: 3 }, postedAt: '2026-01-02T00:00:00Z' });
const line = (qty, extra = {}) => ({ no: 10, type: 'material', source: 'warehouse', materialId: 'MAT1', materialNumber: 'M0001', itemName: 'Bearing', warehouseId: 'WH01', warehouseCode: 'WH01', quantity: qty, unit: 'EA', dateRequired: soon, ...extra });
// Automatic request under review: 25.
seed(r + '/procurement_requirements/REQ000000001', { number: 'REQ000000001', status: 'unverified', source: 'replenishment', replenishmentKey: 'MAT1__WH01', lines: [line(25)], history: [] });
// An earlier requirement already on a partly delivered order (10 ordered, 4 received) and also on a quotation and requisition.
seed(r + '/procurement_requirements/REQ000000002', { number: 'REQ000000002', status: 'acknowledged', source: 'user', requesterUid: 'U2', lines: [line(10)], history: [], storesRelease: { status: 'released' } });
seed(r + '/procurement_quotations/QTN000000001', { number: 'QTN000000001', status: 'recommended', requirementId: 'REQ000000002', lines: [{ no: 10, quantity: 10 }] });
seed(r + '/procurement_requisitions/PRQ000000001', { number: 'PRQ000000001', status: 'converted', requirementId: 'REQ000000002', lines: [{ requirementLineNo: 10, quantity: 10 }] });
seed(r + '/procurement_orders/PO00000001-V1', { number: 'PO00000001', status: 'partial', approvedAt: '2026-11-01T00:00:00Z', lines: [{ no: 10, type: 'material', requirementId: 'REQ000000002', requirementLineNo: 10, quantity: 10, receivedQty: 4, leadTimeDays: 10 }], deliveries: [{ id: 'PO00000001-V1_D1', recNo: 'REC_00000001', at: '2026-11-05T08:00:00Z', date: '2026-11-05', lines: [{ no: 10, qty: 4 }] }] });
// A request not yet approved for 5 more counts too.
seed(r + '/procurement_requirements/REQ000000003', { number: 'REQ000000003', status: 'pending_approval', source: 'user', requesterUid: 'U3', requesterName: 'Ann', lines: [line(5)], history: [] });
// A maintenance work order: 4 required, 3 reserved, 1 short, planned soon.
seed(r + '/work_orders/WO00000001', { status: 'scheduled', scheduledStart: soon, title: 'Gearbox overhaul', assessmentTasks: [{ id: 'T1' }], taskPlanning: { T1: { S1: { materialId: 'MAT1', warehouseId: 'WH01', required: 4, reserved: 3, shortage: 1, status: 'shortage' } } } });

const ctx = (uid, body, perms = ['*']) => ({ uid, orgId: org, role: perms.includes('*') ? 'org_super_admin' : 'org_user', org: snapshot(r), me: { id: uid, data: { firstName: uid } }, permissions: perms, directPermissions: perms, grants: [], actor: { uid, email: uid + '@x.test', role: 'org_super_admin', orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: uid + '@x.test' }, bypassed: [] });
const call = (path, uid, body) => storesReleaseRoutes['POST ' + path][0](ctx(uid, body));

// The engine counts each need once: PO open 6 (not the requirement, quotation or requisition again) + pending 5.
const sup = await supplyIndex(org);
assert.equal(sup.get('MAT1__WH01').qty, 11);
assert.equal(sup.get('MAT1__WH01').shortage, 1);

const list = await call('/api/org/inventory/requirements/list', 'SUP', {});
assert.deepEqual(list.rows.filter((x) => x.queue === 'review').map((x) => x.id).sort(), ['REQ000000001', 'REQ000000003']);
const pos = await call('/api/org/inventory/requirements/position', 'SUP', { id: 'REQ000000001' });
const p = pos.positions[0];
assert.equal(p.stock.available, 5);
assert.equal(p.pipeline.qty, 11);
assert.equal(p.shortage, 1);
assert.equal(p.projected, 15); // 5 − 1 + 11
assert.equal(p.verdict.action, 'cancel', 'projected 15 is above the minimum 10: nothing to buy');
assert.match(p.regeneration, /raise this requirement again/);
assert.match(p.regeneration, /RP07 Direct purchase/);
assert.ok(p.guidance.some((g) => /manual/.test(g)), 'manual levels → Stock Control');
assert.equal(p.reservations[0].plannedDate, soon);
assert.deepEqual(p.pipeline.entries.map((e) => `${e.stage}:${e.qty}`).sort(), ['order:6', 'requirement:5']);
// Releasing what is covered needs a written reason; cancelling an automatic one needs the regeneration acknowledged.
await assert.rejects(() => call('/api/org/inventory/requirements/release', 'SUP', { id: 'REQ000000001', reviewed: true }), /reason to release anyway/);
await assert.rejects(() => call('/api/org/inventory/requirements/cancel', 'SUP', { id: 'REQ000000001', reason: 'Covered by PO00000001 and REQ000000003' }), /raise this requirement again/);
const c = await call('/api/org/inventory/requirements/cancel', 'SUP', { id: 'REQ000000001', reason: 'Covered by PO00000001 and REQ000000003', understood: true });
assert.equal(c.regenerates, true);
assert.equal(snapshot(r + '/procurement_requirements/REQ000000001').data.status, 'cancelled');
assert.equal(snapshot(r + '/procurement_requirements/REQ000000001').data.storesRelease.status, 'cancelled');

// A person's requirement: procurement cannot take it until the stores release it.
assert.match(storesGate(snapshot(r + '/procurement_requirements/REQ000000003').data), /not released/);
await assert.rejects(() => call('/api/org/inventory/requirements/release', 'U3', { id: 'REQ000000003', reviewed: true }), /another stores supervisor|reason/);
const pos3 = await call('/api/org/inventory/requirements/position', 'SUP', { id: 'REQ000000003' });
assert.equal(pos3.positions[0].pipeline.qty, 6, 'the cancelled automatic request no longer counts');
assert.equal(pos3.can.cancel, false);
assert.equal(pos3.can.returnToRequester, true);
await call('/api/org/inventory/requirements/release', 'SUP', { id: 'REQ000000003', reviewed: true, overrideReason: 'Gearbox overhaul brought forward; keep the buffer' });
const r3 = snapshot(r + '/procurement_requirements/REQ000000003').data;
assert.equal(r3.storesRelease.status, 'released');
assert.equal(storesGate(r3), '');
// Changing the stock lines after release needs a new release.
assert.match(storesGate({ ...r3, lines: [{ ...r3.lines[0], quantity: 9 }] }), /changed after/);
console.log('stores release scenario passed: strict pipeline counted once, reservations with planned dates, verdict, regeneration warning, cancel, gate, release with override');

// Trace, dashboard and reminders on the same store.
const { requirementAnalyticsRoutes } = await import('../../backend/requirementAnalytics.ts');
const ra = (path, uid, body) => requirementAnalyticsRoutes['POST ' + path][0](ctx(uid, body));
const tr = await ra('/api/org/inventory/requirements/trace', 'SUP', { id: 'REQ000000002' });
assert.equal(tr.trace.outstanding, 6);
assert.equal(tr.trace.stageLabel, 'Partly delivered');
const dash = await ra('/api/org/inventory/requirements/dashboard', 'SUP', {});
assert.ok(dash.rows.some((x) => x.id === 'REQ000000002'));
assert.ok(dash.awaitingMaterials.some((m) => m.outstanding >= 6));
const rem = await ra('/api/org/inventory/requirements/reminder', 'SUP', { action: 'set', requirementId: 'REQ000000002', date: soon, note: 'Chase Krones for the balance' });
await assert.rejects(() => ra('/api/org/inventory/requirements/reminder', 'OTHER', { action: 'done', id: rem.id }), /not found/);
assert.equal((await ra('/api/org/inventory/requirements/trace', 'SUP', { id: 'REQ000000002' })).reminders.length, 1);
console.log('requirement trace scenario passed: trace, dashboard, reminders');
