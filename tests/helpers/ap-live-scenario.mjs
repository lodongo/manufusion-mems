import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { apRoutes } from '../../backend/accountsPayable.ts';

// Finance live: a warehouse receipt posts GR/IR, the invoice is matched, approved under the chart of authority (test
// mode) and only then posted to payables; the payment is approved and posts Dr payables, Cr bank and withholding tax.
const org = 'ap_live', r = 'organizations/' + org;
const now = new Date().toISOString().slice(0, 10);
const fy = Number(now.slice(0, 4));
seed(r, { status: 'active', currencyCode: 'KES', modules: { PRC: true, INV: true, FIN: true } });
seed(r + '/structure/LE01', { level: 'legal_entity', code: 'LE01', name: 'Entity', parentId: '', attributes: { currencyCode: 'KES' } });
seed(r + '/structure/WH01', { level: 'cost_center', code: 'WH01', name: 'Main stores', parentId: 'LE01', attributes: { costType: 'INV' } });
seed(r + '/warehouses/WH01', { name: 'Main stores', materialCategoryCodes: ['MEC'] });
seed(r + '/materials/MAT1', { materialNumber: 'M0001', name: 'Bearing', status: 'approved', warehouseIds: ['WH01'], categoryCode: 'MEC' });
seed(r + '/vendors/V1', { name: 'Krones', status: 'approved' });
seed(r + '/procurement_requirements/REQ1', { status: 'approved' });
seed(r + '/procurement_requisitions/PRQ000000001', { status: 'converted' });
seed(r + '/fin_entities/LE01', { status: 'active', functionalCurrency: 'KES' });
seed(r + '/fin_years/LE01_' + fy, { leId: 'LE01', fy, label: 'FY' + fy, start: fy + '-01-01', end: fy + '-12-31', status: 'active', periods: [{ no: 1, name: 'Year', start: fy + '-01-01', end: fy + '-12-31', status: 'open' }] });
const acct = (code, name, statement) => seed(r + '/fin_accounts/LE01__' + code, { leId: 'LE01', code, name, statement, status: 'active', postable: true });
acct('1100', 'Inventory', 'BS'); acct('2150', 'GR/IR', 'BS'); acct('1410', 'Input VAT', 'BS'); acct('2100', 'Trade payables', 'BS'); acct('5190', 'Purchase variance', 'PL'); acct('1010', 'Bank', 'BS'); acct('2210', 'WHT payable', 'BS');
seed(r + '/fin_mapping/LE01', { roles: { INVENTORY: '1100', GRIR: '2150', VAT_INPUT: '1410', SUPPLIER_PAYABLE: '2100', PRICE_VARIANCE: '5190', BANK: '1010', WHT_PAYABLE: '2210' }, version: 1 });
seed(r + '/procurement_orders/PO00000001', {
    number: 'PO00000001', status: 'sent', sentAt: '2026-01-02T00:00:00Z', approvedAt: fy + '-01-02T00:00:00Z', vendorId: 'V1', vendorName: 'Krones', currency: 'KES', total: 1000, poType: 'material', createdBy: 'BUYER', paymentTermsLabel: 'Net 30 days',
    lines: [{ no: 10, type: 'material', costCenterId: 'WH01', itemCode: 'MAT1', itemName: 'Bearing', quantity: 10, netUnitPrice: 100, total: 1000, unit: 'EA', categoryCode: 'MEC', requisitionId: 'PRQ000000001', requirementId: 'REQ1' }],
    charges: [{ code: 'VAT', label: 'VAT', kind: 'tax', basis: 'percent', value: 16, amount: 160, requisitionId: 'PRQ000000001' }], deliveries: [], history: [],
});
const pdf = { name: 'x.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' };
const ctx = (uid, body) => ({ uid, orgId: org, role: 'org_super_admin', testMode: true, org: snapshot(r), me: { id: uid, data: { firstName: uid } }, permissions: ['*'], directPermissions: ['*'], grants: [], actor: { uid, email: uid + '@x.test', role: 'org_super_admin', orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: uid + '@x.test' }, bypassed: [] });
const call = (path, uid, body) => apRoutes['POST ' + path][0](ctx(uid, body));
const journals = async () => (await listDocs(r + '/fin_journal')).map((d) => d.data);

const rec = await call('/api/org/inventory/receipts/receive', 'STORE', { poId: 'PO00000001', ref: 'DN1', date: now, lines: [{ no: 10, qty: 10, materialId: 'MAT1' }], deliveryNote: { kind: 'delivery_note', ...pdf } });
assert.equal(rec.journals.length, 1, 'goods receipt posted');
const po = snapshot(r + '/procurement_orders/PO00000001').data;
assert.equal(po.status, 'full');
const inv = await call('/api/org/fin/ap/invoices/create', 'CLERK', { poId: 'PO00000001', scope: 'order', number: 'SUP-1', date: now, amount: 1160, taxAmount: 160, file: { kind: 'invoice', ...pdf } });
assert.equal(inv.status, 'pending_approval', JSON.stringify(inv.checks.filter((c) => c.result !== 'pass')));
assert.equal((await journals()).filter((j) => j.type === 'AP_INVOICE').length, 0, 'nothing posts to payables before approval');
let d;
const steps = snapshot(r + '/ap_invoices/' + inv.id).data.approval.steps;
for (let i = 0; i < Math.max(1, steps.length); i++) await call('/api/org/fin/ap/invoices/decide', 'APPROVER' + i, { id: inv.id, action: 'approve' });
d = snapshot(r + '/ap_invoices/' + inv.id).data;
assert.equal(d.status, 'posted');
assert.ok(d.dueDate > d.date, 'due date from payment terms');
const apj = (await journals()).find((j) => j.type === 'AP_INVOICE');
assert.ok(apj, 'AP journal posted on final approval');
const sides = (j) => j.lines.map((l) => `${l.side}${l.glCode}:${l.amount}`).sort().join(' ');
assert.equal(sides(apj), 'C2100:1160 D1410:160 D2150:1000');
const pay = await call('/api/org/fin/ap/payments/create', 'PAYOFFICER', { invoices: [{ id: inv.id, amount: 1160 }], date: now, method: 'bank_transfer', reference: 'EFT1', whtAmount: 30, whtNote: 'WHT 3% on goods' });
await assert.rejects(() => call('/api/org/fin/ap/payments/create', 'PAYOFFICER', { invoices: [{ id: inv.id, amount: 1 }], date: now, method: 'bank_transfer' }), /open for payment/);
const ps = snapshot(r + '/ap_payments/' + pay.id).data.approval.steps;
for (let i = 0; i < Math.max(1, ps.length); i++) await call('/api/org/fin/ap/payments/decide', 'PAYAPPROVER' + i, { id: pay.id, action: 'approve' });
assert.equal(snapshot(r + '/ap_payments/' + pay.id).data.status, 'paid');
d = snapshot(r + '/ap_invoices/' + inv.id).data;
assert.equal(d.status, 'paid');
assert.equal(d.outstanding, 0);
const pj = (await journals()).find((j) => j.type === 'AP_PAYMENT');
assert.equal(sides(pj), 'C1010:1130 C2210:30 D2100:1160');
await assert.rejects(() => call('/api/org/fin/ap/adjust/request', 'SPEC', { poId: 'PO00000001', deliveryId: po.deliveries[0].id, kind: 'reverse', lines: [{ no: 10, qty: 1 }], reason: 'Damaged on arrival, found later' }), /after payment/);
console.log('accounts payable live scenario passed: GR posted, invoice approved then posted, payment approved and posted, no correction after payment');
