import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { apRoutes } from '../../backend/accountsPayable.ts';

// Receiving from Inventory > Pending POs, invoice matching (finance not live keeps it on hold), withdrawal, and an
// approved receipt reversal, on the in-memory store.
const org = 'ap_fixture', r = 'organizations/' + org;
seed(r, { status: 'active', currencyCode: 'KES', modules: { PRC: true, INV: true, FIN: true } });
seed(r + '/structure/LE01', { level: 'legal_entity', code: 'LE01', name: 'Entity', parentId: '' });
seed(r + '/structure/WH01', { level: 'cost_center', code: 'WH01', name: 'Main stores', parentId: 'LE01', attributes: { costType: 'INV' } });
seed(r + '/structure/CC01', { level: 'cost_center', code: 'CC01', name: 'Workshop', parentId: 'LE01' });
seed(r + '/warehouses/WH01', { name: 'Main stores', materialCategoryCodes: ['MEC'] });
seed(r + '/materials/MAT1', { materialNumber: 'M0001', name: 'Bearing', status: 'approved', warehouseIds: ['WH01'], categoryCode: 'MEC' });
seed(r + '/vendors/V1', { name: 'Krones', status: 'approved' });
seed(r + '/procurement_requirements/REQ1', { status: 'approved' });
seed(r + '/procurement_requisitions/PRQ000000001', { status: 'converted' });
seed(r + '/procurement_orders/PO00000001', {
    number: 'PO00000001', status: 'sent', sentAt: '2026-11-01T00:00:00Z', approvedAt: '2026-11-01T00:00:00Z', vendorId: 'V1', vendorName: 'Krones', currency: 'KES', total: 1000, poType: 'material', createdBy: 'BUYER',
    lines: [
        { no: 10, type: 'material', costCenterId: 'WH01', itemCode: 'MAT1', itemName: 'Bearing', quantity: 10, netUnitPrice: 100, total: 1000, unit: 'EA', categoryCode: 'MEC', requisitionId: 'PRQ000000001', requirementId: 'REQ1', dateRequired: '2026-12-01' },
    ],
    charges: [], deliveries: [], history: [],
});
const pdf = { name: 'dn.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' };
const ctx = (uid, body, extra = {}) => ({ uid, orgId: org, role: 'org_super_admin', org: snapshot(r), me: { id: uid, data: { firstName: uid } }, permissions: ['*'], directPermissions: ['*'], grants: [], actor: { uid, email: uid + '@x.test', role: 'org_super_admin', orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: uid + '@x.test' }, bypassed: [], ...extra });
const call = (path, uid, body, extra) => apRoutes['POST ' + path][0](ctx(uid, body, extra));

const pending = await call('/api/org/inventory/receipts/pending', 'STORE', {});
assert.equal(pending.rows.length, 1);
assert.equal(pending.rows[0].pendingLines, 1);
const detail = await call('/api/org/inventory/receipts/po', 'STORE', { poId: 'PO00000001' });
assert.equal(detail.lines[0].kind, 'stock');
assert.ok(!('netUnitPrice' in detail.lines[0]), 'stores see no prices');
await assert.rejects(() => call('/api/org/inventory/receipts/receive', 'STORE', { poId: 'PO00000001', ref: 'DN1', date: '2026-11-05', lines: [{ no: 10, qty: 4 }] }), /delivery note/);
const rec = await call('/api/org/inventory/receipts/receive', 'STORE', { poId: 'PO00000001', ref: 'DN1', date: '2026-11-05', lines: [{ no: 10, qty: 4 }], deliveryNote: { kind: 'delivery_note', ...pdf } });
assert.match(rec.recNo, /^REC_\d{8}$/);
let po = snapshot(r + '/procurement_orders/PO00000001').data;
assert.equal(po.status, 'partial');
assert.equal(po.lines[0].receivedQty, 4);
assert.equal(po.deliveries[0].via, 'inventory');
assert.ok(snapshot(r + '/goods_receipts/' + rec.recNo), 'receipt register written');

// Whole-order invoice needs full delivery.
await assert.rejects(() => call('/api/org/fin/ap/invoices/prepare', 'CLERK', { poId: 'PO00000001', scope: 'order' }), /delivered in full/);
const prep = await call('/api/org/fin/ap/invoices/prepare', 'CLERK', { poId: 'PO00000001', scope: 'receipt', deliveryId: po.deliveries[0].id });
assert.equal(prep.expected.total, 400);
const inv = await call('/api/org/fin/ap/invoices/create', 'CLERK', { poId: 'PO00000001', scope: 'receipt', deliveryId: po.deliveries[0].id, number: 'SUP-77', date: '2026-11-06', amount: 464, taxAmount: 64, varianceReason: '', file: { kind: 'invoice', ...pdf } });
assert.match(inv.id, /^INV_\d{8}$/);
assert.equal(inv.status, 'on_hold', 'finance is not live, so nothing can go to payables');
assert.ok(inv.checks.some((c) => c.code === 'match.finance' && c.result === 'fail'));
assert.ok(inv.checks.some((c) => c.code === 'match.price' && c.result === 'fail'), '464 against 400 expected without a reason');
po = snapshot(r + '/procurement_orders/PO00000001').data;
assert.equal(po.deliveries[0].invoiceId, inv.id);
// A duplicate supplier invoice number is refused.
await assert.rejects(() => call('/api/org/fin/ap/invoices/create', 'CLERK', { poId: 'PO00000001', scope: 'receipt', deliveryId: po.deliveries[0].id, number: 'sup-77', date: '2026-11-06', amount: 400, taxAmount: 0, file: { kind: 'invoice', ...pdf } }), /already/);
// Receipt correction is blocked while the invoice is live.
await assert.rejects(() => call('/api/org/fin/ap/adjust/request', 'SPEC', { poId: 'PO00000001', deliveryId: po.deliveries[0].id, kind: 'reverse', lines: [{ no: 10, qty: 1 }], reason: 'Two bearings were found damaged on unpacking' }, { testMode: true }), /Withdraw or reverse the invoice first/);
await call('/api/org/fin/ap/invoices/withdraw', 'CLERK', { id: inv.id, reason: 'Supplier will reissue the invoice' });
po = snapshot(r + '/procurement_orders/PO00000001').data;
assert.equal(po.deliveries[0].invoiceId, '');
assert.equal(po.lines[0].invoicedQty, 0);

const adj = await call('/api/org/fin/ap/adjust/request', 'SPEC', { poId: 'PO00000001', deliveryId: po.deliveries[0].id, kind: 'reverse', lines: [{ no: 10, qty: 1 }], reason: 'One bearing was found damaged on unpacking' }, { testMode: true });
assert.match(adj.id, /^RAD_\d{8}$/);
await assert.rejects(() => call('/api/org/fin/ap/adjust/decide', 'SPEC', { id: adj.id, action: 'approve' }), /approved by|someone else/i);
const done = await call('/api/org/fin/ap/adjust/decide', 'CONTROLLER', { id: adj.id, action: 'approve' }, { testMode: true });
assert.equal(done.status, 'done');
po = snapshot(r + '/procurement_orders/PO00000001').data;
assert.equal(po.lines[0].receivedQty, 3);
assert.equal(po.deliveries[0].lines[0].reversedQty, 1);
const mj = (await listDocs(r + '/material_journal')).map((d) => d.data.balancesDelta.physicalStock);
assert.deepEqual(mj.sort(), [-1, 4]);
console.log('accounts payable scenario passed: pending POs, warehouse receipt, invoice on hold, duplicate refused, withdraw, approved reversal');
