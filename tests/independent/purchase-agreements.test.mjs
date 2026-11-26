import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    agreementLock, agreementValue, applyToInfo, checkQuote, converter, dashboardOf, periodProblems, restoreInfo,
    settleAction, submitProblems, MAX_PDF_BYTES,
} from '../../backend/purchaseAgreementModel.ts';
import { ALL_BUILT_KEYS, sodConflicts } from '../../backend/permissionPolicy.ts';
import { LEVEL_ROLES } from '../../backend/levelRoles.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';
import { ADAPTERS } from '../../backend/workflowAdapters.ts';
import { SOURCES } from '../../backend/recordSearch.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const material = { uom: 'EA', categoryCode: 'C1', subcategoryCode: 'S1' };
const currencies = new Set(['KES', 'USD']);
const lists = { paymentTerms: new Set(['NET30', 'COD']), incoterms: new Set(['DAP', 'EXW']) };
const good = { unitPrice: '1200', currency: 'KES', uom: 'EA', leadTimeDays: '14', paymentTerms: 'NET30', incoterms: 'DAP' };

test('quotes are checked against the material procurement setup', () => {
    const ok = checkQuote(good, { info: {}, material, enabledCurrencies: currencies, lists, label: 'Item 10' });
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.quote.unitPrice, 1200);
    assert.equal(ok.quote.uom, 'EA');
    // Purchase unit from Procurement Information wins over the registered unit, and must match.
    const box = checkQuote({ ...good, uom: 'EA' }, { info: { purchaseUom: 'BOX' }, material, enabledCurrencies: currencies, lists, label: 'Item 10' });
    assert.match(box.problems.join(' '), /purchase unit \(BOX\)/);
    const bad = checkQuote({ unitPrice: '0', currency: 'XYZ', leadTimeDays: '2.5', incoterms: 'FREE' }, { info: {}, material, enabledCurrencies: currencies, lists, label: 'Item 10' });
    const text = bad.problems.join(' ');
    for (const w of ['unit price above zero', 'enabled currency', 'whole days', 'choose the payment terms', 'incoterms from the list']) assert.match(text, new RegExp(w));
    assert.match(checkQuote({ ...good, paymentTerms: '30 days' }, { info: {}, material, enabledCurrencies: currencies, lists, label: 'Item 10' }).problems.join(' '), /payment terms from the list/);
    // Minimum order, order multiple and part number are not quoted: the material's own values are kept.
    assert.deepEqual(Object.keys(ok.quote).sort(), ['currency', 'incoterms', 'leadTimeDays', 'paymentTerms', 'unitPrice', 'uom']);
});

test('period rules: dates, order, not past, at most five years', () => {
    assert.deepEqual(periodProblems('2027-01-01', '2027-12-31', '2026-11-26'), []);
    assert.match(periodProblems('2027-02-01', '2027-01-01', '2026-11-26').join(' '), /on or after/);
    assert.match(periodProblems('2025-01-01', '2025-12-31', '2026-11-26').join(' '), /already passed/);
    assert.match(periodProblems('2027-01-01', '2033-01-01', '2026-11-26').join(' '), /at most 5 years/);
    assert.match(periodProblems('2027-02-30', '2027-03-01', '2026-11-26').join(' '), /start date/);
});

test('activation keeps the material own values and the standard price; ending restores them', () => {
    const info = { unitPrice: 1500, priceCurrency: 'KES', purchaseUom: 'EA', leadTimeDays: 30, minimumOrderQuantity: 1, orderMultiple: 1, vendorPartNumber: 'OLD', preferredVendor: 'VND000009', preferredVendorName: 'VND000009 · Old' };
    const pa = { number: 'PA00000001', vendorId: 'VND000001', vendorNumber: 'VND000001', vendorName: 'Acme', startDate: '2026-11-01', endDate: '2027-10-31' };
    const item = { no: 10, quote: { unitPrice: 1200, currency: 'KES', uom: 'EA', leadTimeDays: 14, paymentTerms: '', incoterms: 'DAP' } };
    const on = applyToInfo(info, pa, 'PA00000001', item, 't', 'u');
    assert.equal(on.leadTimeDays, 14);
    assert.equal(on.preferredVendor, 'VND000001');
    assert.equal(on.unitPrice, 1500, 'standard price is never changed');
    assert.equal(on.priceCurrency, 'KES');
    assert.equal(on.paymentTerms, undefined, 'a blank quote field leaves the material value');
    assert.equal(on.minimumOrderQuantity, 1, 'minimum order stays the material value');
    assert.equal(on.vendorPartNumber, 'OLD', 'part number stays the material value');
    assert.equal(on.incoterms, 'DAP');
    assert.equal(on.agreement.unitPrice, 1200);
    assert.equal(on.agreementBaseline.leadTimeDays, 30);
    // Re-applying never overwrites the kept values with agreement values.
    const again = applyToInfo(on, pa, 'PA00000001', item, 't2', 'u');
    assert.equal(again.agreementBaseline.leadTimeDays, 30);
    // Another agreement cannot take a held material.
    assert.equal(applyToInfo(on, { ...pa, number: 'PA00000002' }, 'PA00000002', item, 't', 'u'), null);
    const off = restoreInfo(again, 'PA00000001');
    assert.equal(off.leadTimeDays, 30);
    assert.equal(off.incoterms, '', 'back to the material (which had none)');
    assert.equal(off.preferredVendor, 'VND000009');
    assert.equal(off.agreement, undefined);
    assert.equal(off.agreementBaseline, undefined);
    assert.equal(restoreInfo(off, 'PA00000001'), null);
});

test('manual edits of agreement fields are refused only while it is in date', () => {
    const info = { agreement: { id: 'PA00000001', number: 'PA00000001', startDate: '2026-11-01', endDate: '2027-10-31', fields: ['leadTimeDays', 'preferredVendor'] } };
    assert.match(agreementLock(info, ['leadTimeDays'], '2026-12-01'), /PA00000001/);
    assert.equal(agreementLock(info, ['unitPrice', 'remarks'], '2026-12-01'), '', 'standard price stays editable');
    assert.equal(agreementLock(info, ['leadTimeDays'], '2027-11-01'), '', 'past the end it no longer locks');
    assert.equal(agreementLock({}, ['leadTimeDays']), '');
});

test('value for the chart of authority and the dashboard savings use the standard price', () => {
    const rate = (c) => ({ KES: 1, USD: 130 })[c] ?? null;
    const items = [
        { no: 10, materialId: 'M1', warehouseId: 'W1', expectedQty: 100, quote: { unitPrice: 1200, currency: 'KES' }, standard: { unitPrice: 1500, currency: 'KES' }, applied: true },
        { no: 20, materialId: 'M2', warehouseId: 'W1', expectedQty: 10, quote: { unitPrice: 10, currency: 'USD' }, standard: { unitPrice: '', currency: '' } },
    ];
    assert.deepEqual(agreementValue(items, rate), { value: 133000, missing: [] });
    assert.deepEqual(agreementValue([{ expectedQty: 1, quote: { unitPrice: 1, currency: 'EUR' } }], rate).missing, ['EUR']);
    const pa = { status: 'active', vendorId: 'V', startDate: '2026-11-01', endDate: '2026-11-30', currency: 'KES' };
    const lines = [
        { orderId: 'PO1', vendorId: 'V', date: '2026-11-05', currency: 'KES', materialId: 'M1', warehouseId: 'W1', quantity: 20, receivedQty: 5, netUnitPrice: 1200 },
        { orderId: 'PO2', vendorId: 'V', date: '2026-11-06', currency: 'KES', materialId: 'M1', warehouseId: 'W1', quantity: 2, receivedQty: 0, netUnitPrice: 1300 },
        { orderId: 'PO3', vendorId: 'OTHER', date: '2026-11-06', currency: 'KES', materialId: 'M1', warehouseId: 'W1', quantity: 50, receivedQty: 0, netUnitPrice: 1000 },
        { orderId: 'PO4', vendorId: 'V', date: '2026-10-06', currency: 'KES', materialId: 'M1', warehouseId: 'W1', quantity: 50, receivedQty: 0, netUnitPrice: 1000 },
    ];
    const d = dashboardOf(pa, items, lines, converter(rate), '2026-11-11');
    assert.equal(d.active, true);
    assert.equal(d.daysRemaining, 19);
    assert.equal(d.totalDays, 30);
    assert.equal(d.items[0].orderedQty, 22, 'only this supplier, these materials, inside the dates');
    assert.equal(d.savings, 22 * 300);
    assert.equal(d.priceBreaches, 1);
    assert.equal(d.materialsPurchased, 1);
    assert.equal(d.noStandardPrice, 1);
    assert.equal(d.items[1].savings, null);
});

test('dates start and end agreements; submission needs materials, quotes and a PDF', () => {
    assert.equal(settleAction({ status: 'scheduled', startDate: '2026-11-01', endDate: '2026-12-01' }, '2026-11-26'), 'start');
    assert.equal(settleAction({ status: 'scheduled', startDate: '2026-12-01', endDate: '2027-01-01' }, '2026-11-26'), '');
    assert.equal(settleAction({ status: 'active', startDate: '2026-01-01', endDate: '2026-11-25' }, '2026-11-26'), 'expire');
    assert.equal(settleAction({ status: 'approved', startDate: '2026-01-01', endDate: '2026-11-25' }, '2026-11-26'), '');
    const p = submitProblems({ startDate: '2026-12-01', endDate: '2027-01-01' }, [{ no: 10, expectedQty: 0 }], [], '2026-11-26').join(' ');
    assert.match(p, /expected quantity/);
    assert.match(p, /record the supplier's quote/);
    assert.match(p, /PDF/);
    assert.deepEqual(submitProblems({ startDate: '2026-12-01', endDate: '2027-01-01' }, [{ no: 10, expectedQty: 5, quote: { unitPrice: 1 } }], [{ mime: 'application/pdf' }], '2026-11-26'), []);
    assert.equal(MAX_PDF_BYTES, 10 * 1024 * 1024);
});

test('security: rights, separation of duties, templates and level roles', () => {
    for (const k of ['PRC.agreements.view', 'PRC.agreements.manage', 'PRC.agreements.approve']) assert.ok(ALL_BUILT_KEYS.has(k), k);
    assert.ok(sodConflicts(['PRC.agreements.manage', 'PRC.agreements.approve']).length > 0);
    assert.ok(sodConflicts(['PRC.authority.manage', 'PRC.agreements.approve']).length > 0);
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /T\('prc_pa_officer'[^\n]*'PRC\.agreements\.manage'/);
    assert.match(policy, /T\('prc_pa_approver'[^\n]*'PRC\.agreements\.approve'/);
    const by = (n) => LEVEL_ROLES.find((r) => r.name === n).permissions;
    assert.ok(by('Procurement Buyer').includes('PRC.agreements.manage') && !by('Procurement Buyer').includes('PRC.agreements.approve'));
    assert.ok(by('Procurement Manager').includes('PRC.agreements.approve') && !by('Procurement Manager').includes('PRC.agreements.manage'));
    assert.ok(by('Procurement Viewer').includes('PRC.agreements.view'));
});

test('every agreement route has an explicit permission, is wired, audited and linked to a transaction code', () => {
    const src = read('backend/purchaseAgreements.ts');
    const routes = [...src.matchAll(/'POST (\/api\/org\/procurement\/agreements\/[^']+)': \[\s*orgRoute\('([^']+)', '([^']+)'/g)];
    assert.ok(routes.length >= 20, `found ${routes.length}`);
    for (const [, path, name, perm] of routes) {
        assert.match(perm, /^PRC\.agreements\.(view|manage|approve)$/, path);
        assert.match(name, /^org\.procurement\.agreements\./);
        const link = linkRouteToBlueprint({ path });
        assert.ok(link && link.module === 'PRC' && link.area === 'FWA', path);
    }
    assert.equal(linkRouteToBlueprint({ path: '/api/org/procurement/agreements/approve' }).action, 'AP');
    assert.equal(linkRouteToBlueprint({ path: '/api/org/procurement/agreements/activate' }).action, 'AV');
    assert.equal(linkRouteToBlueprint({ path: '/api/org/procurement/agreements/terminate' }).action, 'TR');
    assert.match(read('backend/index.ts'), /\.\.\.purchaseAgreementRoutes,/);
    // Changes run under the lock, are versioned, kept in history and audited.
    assert.match(src, /await record\(ctx, `org\.procurement\.agreement\.\$\{action\}`/);
    assert.match(src, /writeDoc\(path, next, \{ updateTime: fresh\.updateTime \}\)/);
    // Chart of authority on the value, approver independence and the test-mode bypass is recorded.
    assert.match(src, /approvalRoute\(ctx\.orgId, owner, value\.value, authority/);
    assert.match(src, /quoters\(d\)\.includes\(ctx\.uid\)/);
    assert.match(src, /bypass\(ctx, 'prc\.agreement\.approver_authority'\)/);
    // PDF attachments are header-checked, hashed and stored immutably.
    assert.match(src, /'%PDF-'/);
    assert.match(src, /storage\.writeImmutable/);
});

test('approval steps reach people through workflow actions and records can be linked', () => {
    const a = ADAPTERS.find((x) => x.key === 'prc.agreement');
    assert.ok(a && a.link === 'procurement_agreements');
    assert.ok(a.routes.test('org.procurement.agreements.approve'));
    assert.ok(SOURCES.some((s) => s.type === 'PA' && s.link === 'procurement_agreements'));
});

test('materials using an agreement show in blue and its fields are locked on the material', () => {
    const detail = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(detail, /export function activeAgreement\(/);
    assert.match(detail, /border-blue-500\/70 bg-blue-500\/10/);
    assert.match(detail, /fields\.map\(\(k\) => paLock\(k\) \? \(/);
    assert.match(read('backend/procurement.ts'), /agreementLock\(old\?\.data,changed\)/);
    const screen = read('src/org/PurchaseAgreements.tsx');
    assert.match(screen, /rowClassName=\{\(i\) => \(i\.applied \? blueRow : ''\)\}/);
    assert.match(screen, /Savings vs standard price/);
    assert.match(screen, /Days remaining/);
    // Lists are dropdowns; minimum order, multiple and part number are not asked for.
    assert.match(screen, /<SelectField label='Payment terms'/);
    assert.match(screen, /<SelectField label='Incoterms \(optional\)'/);
    assert.doesNotMatch(screen, /label='Minimum order quantity'|label='Order multiple'|label='Supplier part number'/);
    // Units are shown by name, never as a registry code, and every quote field shows the material's current standard value.
    assert.match(screen, /label=\{`Unit price per \$\{unitOf\(item\)\}`\}/);
    assert.doesNotMatch(screen, /value=\{item\.purchaseUom\}/);
    for (const h of ['Standard: ${stdPrice}', "Standard: ${own('currency')}", 'Standard: ${stdTerms}', 'Standard: ${stdInco}']) assert.ok(screen.includes(h), h);
    const back = read('backend/purchaseAgreements.ts');
    assert.match(back, /purchaseUomName: unitName\(names, str\(i\.purchaseUom\)\), current: standardNow\(/);
    assert.match(read('src/org/OrgHomePage.tsx'), /path: 'procurement_agreements', permission: 'PRC\.agreements\.view'/);
    assert.match(read('backend/automationEngine.ts'), /const PA_JOB_ID = 'prc\.agreements-daily';/);
});
