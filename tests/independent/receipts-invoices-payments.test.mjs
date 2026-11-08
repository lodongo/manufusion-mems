import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docNo, DOC_NO, receiptValue, receiptLive, expectedFor, matchChecks, apInvoiceLines, apPaymentLines, invoiceAfterPayment, deliveryProgress } from '../../backend/apCore.ts';
import { POSTING_EVENTS } from '../../backend/finPostingCatalogue.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sum = (lines, side) => Math.round(lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0) * 100) / 100;

test('REC_, INV_, PAY_ and RAD_ numbers are eight digits from a database counter', () => {
    assert.equal(docNo('REC', 1), 'REC_00000001');
    assert.equal(docNo('INV', 12345678), 'INV_12345678');
    assert.equal(docNo('PAY', 42), 'PAY_00000042');
    assert.ok(DOC_NO.RAD.test(docNo('RAD', 7)));
    assert.throws(() => docNo('REC', 0));
    assert.throws(() => docNo('REC', 100_000_000));
    const ap = read('backend/accountsPayable.ts');
    assert.match(ap, /nextCounter\(orgId, 'ap_numbers', kind\)/);
});

test('receipt value follows reversals; whole-order invoice only when delivered in full', () => {
    const po = [{ no: 10, netUnitPrice: 50 }, { no: 20, netUnitPrice: 10 }];
    const v = receiptValue({ lines: [{ no: 10, qty: 4, reversedQty: 1 }, { no: 20, qty: 2, reversedQty: 2 }] }, po);
    assert.deepEqual(v, { lines: [{ no: 10, qty: 3, value: 150 }], goods: 150 });
    assert.equal(receiptLive({ lines: [{ no: 1, qty: 2, reversedQty: 2 }] }), false);
    assert.equal(receiptLive({ status: 'reversed', lines: [{ no: 1, qty: 2 }] }), false);
    const e = expectedFor(250, 1000, 400, 160);
    assert.deepEqual(e, { goods: 250, charges: 100, tax: 40, total: 350 });
    assert.match(read('backend/accountsPayable.ts'), /An invoice for the whole order needs the order to be delivered in full/);
});

const base = { requirements: [{ id: 'R1', status: 'approved' }], requisitions: [{ id: 'PRQ1', status: 'converted' }], poStatus: 'partial', poNumber: 'PO1', receipts: [{ id: 'D1', recNo: 'REC_00000001', live: true, otherInvoice: '', date: '2026-11-01' }], linesOver: [], amount: 116, tax: 16, expected: { total: 116, tax: 16 }, tolerancePct: 2, varianceReason: '', duplicateOf: '', vendorStatus: 'approved', invoiceDate: '2026-11-02', legalEntities: 1, financeProblem: '' };

test('due diligence: requirement, requisition, order, receipt, quantity, price, tax, duplicate, supplier, entity, finance', () => {
    const ok = matchChecks(base);
    assert.ok(ok.every((c) => c.result === 'pass'), JSON.stringify(ok.filter((c) => c.result !== 'pass')));
    const r = (over, code) => matchChecks({ ...base, ...over }).find((c) => c.code === code).result;
    assert.equal(r({ amount: 130 }, 'match.price'), 'fail');
    assert.equal(r({ amount: 130, varianceReason: 'Supplier added a fuel surcharge agreed by phone' }, 'match.price'), 'warn');
    assert.equal(r({ duplicateOf: 'INV_00000003' }, 'match.duplicate'), 'fail');
    assert.equal(r({ linesOver: [10] }, 'match.quantity'), 'fail');
    assert.equal(r({ receipts: [{ ...base.receipts[0], otherInvoice: 'INV_00000001' }] }, 'match.receipt'), 'fail');
    assert.equal(r({ receipts: [{ ...base.receipts[0], live: false }] }, 'match.receipt'), 'fail');
    assert.equal(r({ requisitions: [{ id: 'PRQ1', status: 'cancelled' }] }, 'match.requisition'), 'fail');
    assert.equal(r({ requirements: [{ id: 'R1', status: 'rejected' }] }, 'match.requirement'), 'fail');
    assert.equal(r({ poStatus: 'cancelled' }, 'match.order'), 'fail');
    assert.equal(r({ vendorStatus: 'blocked' }, 'match.vendor'), 'fail');
    assert.equal(r({ legalEntities: 2 }, 'match.entity'), 'fail');
    assert.equal(r({ financeProblem: 'Not mapped' }, 'match.finance'), 'fail');
    assert.equal(r({ tax: 30 }, 'match.tax'), 'warn');
    assert.equal(r({ invoiceDate: '2026-10-01' }, 'match.date'), 'warn');
});

test('AP invoice journal balances: Dr GR/IR + input VAT ± variance, Cr supplier payables', () => {
    const accounts = { grir: '2150', vat: '1410', payable: '2100', variance: '5190' };
    const up = apInvoiceLines({ grir: [{ ccId: 'CC1', amount: 1000, docAmount: 1000 }], amount: 1276, tax: 176, rate: 1, varianceCc: 'CC1', accounts, ref: 'INV_00000001' });
    assert.equal(sum(up, 'D'), sum(up, 'C'));
    assert.deepEqual(up.find((l) => l.glCode === '5190'), { side: 'D', glCode: '5190', ccId: 'CC1', amount: 100, docAmount: 100, description: 'Charges and price variance on INV_00000001', ref: 'INV_00000001' });
    const down = apInvoiceLines({ grir: [{ ccId: 'CC1', amount: 1000, docAmount: 1000 }], amount: 1060, tax: 160, rate: 1, varianceCc: 'CC1', accounts, ref: 'X' });
    assert.equal(down.find((l) => l.glCode === '5190').side, 'C');
    assert.equal(sum(down, 'D'), sum(down, 'C'));
    const exact = apInvoiceLines({ grir: [{ ccId: 'CC1', amount: 1000, docAmount: 1000 }], amount: 1160, tax: 160, rate: 1, varianceCc: 'CC1', accounts, ref: 'X' });
    assert.ok(!exact.some((l) => l.glCode === '5190'));
});

test('AP payment journal: Dr payables gross, Cr bank net and withholding tax; invoice paid status', () => {
    const l = apPaymentLines({ gross: 1000, wht: 50, rate: 1, accounts: { payable: '2100', bank: '1010', wht: '2210' }, ref: 'PAY_00000001' });
    assert.equal(sum(l, 'D'), 1000);
    assert.equal(sum(l, 'C'), 1000);
    assert.equal(l.find((x) => x.glCode === '1010').amount, 950);
    assert.deepEqual(invoiceAfterPayment(1000, 400), { paid: 400, outstanding: 600, status: 'part_paid' });
    assert.deepEqual(invoiceAfterPayment(1000, 1000), { paid: 1000, outstanding: 0, status: 'paid' });
    assert.throws(() => invoiceAfterPayment(1000, 1001), /more than the invoice outstanding/);
});

test('delivery progress per line and for the order', () => {
    const p = deliveryProgress([{ no: 10, quantity: 10, receivedQty: 5, itemName: 'Bearing', unit: 'EA' }, { no: 20, quantity: 2, receivedQty: 2, itemName: 'Seal', unit: 'EA' }]);
    assert.equal(p.pct, 58);
    assert.equal(p.pending, true);
    assert.equal(p.rows[0].pending, 5);
});

test('posting only after approval: AP invoice and payment are live and posted only by the decide routes', () => {
    const inv = POSTING_EVENTS.find((e) => e.event === 'AP_INVOICE');
    const pay = POSTING_EVENTS.find((e) => e.event === 'AP_PAYMENT');
    assert.equal(inv.state, 'live');
    assert.ok(inv.via.includes('/api/org/fin/ap/invoices/decide'));
    assert.equal(pay.state, 'live');
    assert.deepEqual(pay.via, ['/api/org/fin/ap/payments/decide']);
    const ap = read('backend/accountsPayable.ts');
    // The AP posting sits only in the final-approval callback and the controlled reversal.
    assert.equal((ap.match(/type: 'AP_INVOICE'/g) || []).length, 2);
    assert.match(ap, /decide\(ctx, `\$\{P\(ctx\.orgId\)\.invoices\}\/\$\{id\}`, 'FIN\.ap\.approve', \(d\) => finalPostInvoice/);
    assert.match(ap, /status = fails\.length \|\| routeFail \? 'on_hold' : 'pending_approval'/);
});

test('routes are guarded by explicit permissions; stores receive with inventory rights only', () => {
    const ap = read('backend/accountsPayable.ts');
    for (const [route, perm] of [
        ['org.inventory.receipts.pending', 'INV.receive'], ['org.inventory.receipts.receive', 'INV.receive'],
        ['org.fin.ap.invoices.create', 'FIN.ap.capture'], ['org.fin.ap.invoices.decide', 'FIN.ap.approve'], ['org.fin.ap.invoices.reverse', 'FIN.ap.approve'],
        ['org.fin.ap.payments.create', 'FIN.ap.pay'], ['org.fin.ap.payments.decide', 'FIN.ap.payapprove'],
        ['org.fin.ap.adjust.request', 'PRC.receipt.adjust'], ['org.fin.ap.adjust.decide', 'FIN.receipt.approve'],
    ]) assert.match(ap, new RegExp(`orgRoute\\('${route.replace(/\./g, '\\.')}', '${perm.replace(/\./g, '\\.')}'`), route);
    assert.match(ap, /recordDelivery\(ctx, doc, ctx\.body, 'inventory', new Set\(mine\.map/);
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /A line is not received through a warehouse you work in/);
    assert.match(po, /costCenterId: via === 'procurement' \?/);
    const perms = read('backend/permissionPolicy.ts');
    for (const [a, b] of [['FIN.ap.capture', 'FIN.ap.approve'], ['FIN.ap.pay', 'FIN.ap.payapprove'], ['PRC.po.receive', 'FIN.ap.capture'], ['INV.receive', 'FIN.ap.capture'], ['PRC.receipt.adjust', 'FIN.receipt.approve']]) assert.ok(perms.includes(`a: '${a}', b: '${b}'`), `${a} / ${b}`);
});

test('receipt corrections: only before payment, never over a live invoice, stock must be available, approved under the chart of authority', () => {
    const ap = read('backend/accountsPayable.ts');
    assert.match(ap, /It cannot be changed after payment/);
    assert.match(ap, /Withdraw or reverse the invoice first/);
    assert.match(ap, /routeApproval\(ctx, base\)/);
    assert.match(ap, /conflictUids: \[str\(dv\.by\)\]/);
    const fin = read('backend/finOps.ts');
    assert.match(fin, /cannot be reversed\./);
    assert.match(fin, /sourceKey: `GRX_\$\{a\.key\}/);
    assert.match(fin, /sourceKey: `GRP_\$\{a\.key\}/);
});

test('the deliveries tab shows received and pending, a + to receive, tap-to-open receipts with invoice scope, and a dashboard tab', () => {
    const ui = read('src/org/PoDeliveries.tsx');
    assert.match(ui, /aria-label='Record a delivery'/);
    assert.match(ui, /This receipt only/);
    assert.match(ui, /only when delivered in full/);
    assert.match(ui, /aria-expanded=\{open\}/);
    assert.match(ui, /export function DeliveryDashboard/);
    assert.match(read('src/org/PurchaseOrders.tsx'), /label: 'Delivery dashboard'/);
    assert.match(read('src/org/OrgHomePage.tsx'), /label: 'Pending POs', path: 'inventory_pending_pos', permission: 'INV.receive'/);
});

import { spawnSync } from 'node:child_process';
for (const [name, file] of [['end to end: pending POs, warehouse receipt, invoice on hold, duplicate refused, withdraw, approved reversal', 'ap-scenario.mjs'], ['end to end with finance live: GR, invoice approved then posted, payment posted with withholding tax, no correction after payment', 'ap-live-scenario.mjs']]) {
    test(name, () => {
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', `./tests/helpers/${file}`], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /scenario passed/);
    });
}
