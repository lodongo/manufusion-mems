import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCharges, rescaleCharges, chargesTotal, taxesTotal, CHARGE_TYPES } from '../../src/shared/procurementCharges.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('taxes and charges: each entered separately, percent on the discounted price, validated', () => {
    const c = readCharges([{ code: 'VAT', basis: 'percent', value: 16 }, { code: 'FREIGHT', basis: 'amount', value: 2500 }, { code: 'OTHER_CHARGE', basis: 'amount', value: 300, note: 'Courier of documents' }], 10000, false);
    assert.deepEqual(c.map((x) => x.amount), [1600, 2500, 300]);
    assert.equal(chargesTotal(c), 4400);
    assert.equal(taxesTotal(c), 1600);
    assert.equal(c[2].label, 'Courier of documents');
    assert.throws(() => readCharges([{ code: 'VAT', basis: 'percent', value: 16 }], 100, true), /already include VAT/);
    assert.throws(() => readCharges([{ code: 'FREIGHT', value: 1 }, { code: 'FREIGHT', value: 2 }], 100, false), /once/);
    assert.throws(() => readCharges([{ code: 'OTHER_TAX', value: 5 }], 100, false), /say what it is/);
    assert.throws(() => readCharges([{ code: 'CLEARING', basis: 'percent', value: 120 }], 100, false), /up to 100/);
    assert.throws(() => readCharges([{ code: 'NOPE', value: 1 }], 100, false), /type/);
    assert.throws(() => readCharges(Array.from({ length: 16 }, () => ({ code: 'OTHER_CHARGE', value: 1, note: 'misc' })), 100, false), /15/);
    for (const k of ['VAT', 'IMPORT_DUTY', 'FREIGHT', 'CLEARING', 'INSURANCE', 'PORT']) assert.ok(CHARGE_TYPES.some((t) => t.code === k));
});

test('charges follow the goods: shared out between requisitions, kept on revision', () => {
    const c = readCharges([{ code: 'VAT', basis: 'percent', value: 16 }, { code: 'FREIGHT', basis: 'amount', value: 1000 }], 10000, false);
    const part = rescaleCharges(c, 4000, 0.4);
    assert.deepEqual(part.map((x) => x.amount), [640, 400]);
    const revised = rescaleCharges(part, 3000);
    assert.deepEqual(revised.map((x) => x.amount), [480, 400]);
});

test('chart of authority on the discounted amount plus overheads; one category per order', () => {
    const q = read('backend/quotations.ts');
    assert.match(q, /const total = money2\(goods \+ overheads\)/);
    assert.match(q, /readCharges\(body\.charges, goodsNet/);
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /baseTotal[^\n]*grandTotal/);
    assert.match(po, /'type\.category'/);
    assert.match(po, /An order holds one category/);
    assert.match(po, /caseLines\.map\(\(l\) => `\$\{str\(l\.type\)\}\|\$\{str\(l\.categoryCode\)\}`\)/);
});

test('receipt: delivery note required, optional invoice validated, posting aligned with permission and reason', () => {
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /Attach the supplier's delivery note/);
    assert.match(po, /cleanFile\(\{ \.\.\.o\(ctx\.body\.deliveryNote\), kind: 'delivery_note' \}, \['delivery_note'\]\)/);
    assert.match(po, /'POST \/api\/org\/procurement\/orders\/invoice': \[\s*orgRoute\('org\.procurement\.orders\.invoice', 'PRC\.po\.receive'/);
    assert.match(po, /is already recorded on/);
    assert.match(po, /matchTolerancePct/);
    assert.match(po, /Give the reason in at least 20 characters/);
    assert.match(po, /can\(ctx, 'PRC\.po\.receive_posting'\)/);
    assert.match(po, /same legal entity/);
    assert.match(po, /checkChosenGl\(ctx\.orgId, cc, gl/);
    assert.match(po, /goes into warehouse stock/);
    assert.match(po, /invoiceStatusOf\(lines\)/);
    const perms = read('backend/permissionPolicy.ts');
    assert.match(perms, /p\('PRC\.po\.receive_posting'/);
    assert.match(perms, /a: 'PRC\.po\.manage', b: 'PRC\.po\.receive_posting'/);
    const fin = read('backend/finOps.ts');
    assert.match(fin, /costCenterId\?: string;[\s\S]{0,40}glCode\?: string/);
    const ui = read('src/org/PurchaseOrders.tsx');
    assert.match(ui, /Delivery note document \*/);
    assert.match(ui, /The supplier’s invoice came with this delivery/);
    assert.match(ui, /Align the cost center or GL account/);
    assert.match(ui, /function InvoiceLater/);
    const qf = read('src/org/Quotations.tsx');
    assert.match(qf, /Taxes, freight and other charges/);
    const spec = read('src/org/PoConsolidation.tsx');
    assert.match(spec, /one per order/);
});
