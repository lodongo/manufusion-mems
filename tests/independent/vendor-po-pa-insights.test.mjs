import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    agreementRefs, bandOf, buildPerformance, lineDelivery, matchAgreement, orderVerdict, periodOf, quoteWaits, scorecardOf, stockOf, agreementRfqDays, VERDICT_LABEL,
} from '../../backend/vendorPerformanceModel.ts';
import { converter, dashboardOf, paWindow } from '../../backend/purchaseAgreementModel.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const DAY = '2026-11-28';

// An order sent on 1 Oct with a 14 day lead time: promised for 15 Oct.
const po = (over = {}) => ({
    number: 'PO00000001', status: 'sent', vendorId: 'VND000001', currency: 'KES', total: 1000, baseTotal: 1000, paid: 0,
    sentAt: '2026-10-01T08:00:00Z', approvedAt: '2026-09-30T08:00:00Z', fxRate: 1,
    lines: [{ no: 10, itemCode: 'M-1', itemName: 'Bearing', quantity: 10, unit: 'EA', netUnitPrice: 100, total: 1000, leadTimeDays: 14, receivedQty: 0 }],
    deliveries: [],
    ...over,
});
const delivery = (date, qty, extra = {}) => ({ id: `D${date}`, date, at: `${date}T09:00:00Z`, status: 'posted', lines: [{ no: 10, qty, ...extra }] });

test('a line is judged against the supplier promise: sent date plus quoted lead time', () => {
    const onTime = lineDelivery(po({ deliveries: [delivery('2026-10-14', 10)] }), po().lines[0], DAY);
    assert.equal(onTime.promiseOn, '2026-10-15');
    assert.equal(onTime.verdict, 'on_time');
    assert.equal(onTime.completeOn, '2026-10-14');
    assert.equal(onTime.actualLeadDays, 13);
    const late = lineDelivery(po({ deliveries: [delivery('2026-10-20', 10)] }), po().lines[0], DAY);
    assert.equal(late.verdict, 'late');
    assert.equal(late.daysLate, 5);
    const overdue = lineDelivery(po(), po().lines[0], DAY);
    assert.equal(overdue.verdict, 'overdue');
    assert.equal(overdue.daysLate, dayCount('2026-10-15', DAY));
    const pending = lineDelivery(po({ sentAt: '2026-11-20T08:00:00Z' }), po().lines[0], DAY);
    assert.equal(pending.verdict, 'pending');
});
const dayCount = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

test('only the receipts that still stand count, and partial deliveries complete on the day the quantity is reached', () => {
    const split = po({ deliveries: [delivery('2026-10-10', 4), delivery('2026-10-16', 6)] });
    const l = lineDelivery(split, split.lines[0], DAY);
    assert.equal(l.firstOn, '2026-10-10');
    assert.equal(l.completeOn, '2026-10-16');
    assert.equal(l.verdict, 'late');
    assert.equal(l.daysLate, 1);
    const reversed = po({ deliveries: [{ ...delivery('2026-10-10', 10), status: 'reversed' }] });
    assert.equal(lineDelivery(reversed, reversed.lines[0], DAY).verdict, 'overdue');
    const part = po({ deliveries: [delivery('2026-10-10', 10, { reversedQty: 4 })] });
    const p = lineDelivery(part, part.lines[0], DAY);
    assert.equal(p.received, 6);
    assert.equal(p.outstanding, 4);
    assert.equal(p.complete, false);
});

test('without a lead time the date needed stands in, and without either the line is untimed', () => {
    const needed = lineDelivery(po(), { ...po().lines[0], leadTimeDays: 0, dateRequired: '2026-11-01' }, DAY);
    assert.equal(needed.promiseOn, '2026-11-01');
    assert.equal(needed.verdict, 'overdue');
    const none = lineDelivery(po(), { ...po().lines[0], leadTimeDays: 0 }, DAY);
    assert.equal(none.verdict, 'untimed');
    assert.equal(orderVerdict([none]).verdict, 'untimed');
});

test('an order takes the worst of its lines', () => {
    const mk = (verdict, daysLate = 0) => ({ ordered: 1, verdict, daysLate });
    assert.deepEqual(orderVerdict([mk('on_time'), mk('overdue', 9), mk('late', 3)]), { verdict: 'overdue', daysLate: 9 });
    assert.deepEqual(orderVerdict([mk('on_time'), mk('late', 3), mk('pending')]), { verdict: 'late', daysLate: 3 });
    assert.equal(orderVerdict([mk('on_time'), mk('pending')]).verdict, 'pending');
    assert.equal(orderVerdict([mk('on_time'), mk('untimed')]).verdict, 'on_time');
});

test('periods: last month to all time, with the stretch before for comparison, and bad dates are refused', () => {
    const m = periodOf('30d', '', '', DAY);
    assert.equal(m.from, '2026-10-30');
    assert.equal(m.to, DAY);
    assert.equal(m.prevTo, '2026-10-29');
    assert.equal(m.prevFrom, '2026-09-30');
    assert.equal(periodOf('365d', '', '', DAY).from, '2025-11-29');
    assert.equal(periodOf('ytd', '', '', DAY).from, '2026-01-01');
    assert.equal(periodOf('all', '', '', DAY).prevFrom, '');
    assert.match(periodOf('custom', '2026-05-01', '2026-04-01', DAY).error, /cannot end before/);
    assert.match(periodOf('custom', '2026-05-01', '2026-12-31', DAY).error, /future/);
    assert.match(periodOf('custom', '', '', DAY).error, /first and last day/);
    assert.match(periodOf('century', '', '', DAY).error, /from the list/);
    assert.equal(periodOf('custom', '2026-05-01', '2026-05-31', DAY).from, '2026-05-01');
});

const opts = (over = {}) => ({ from: '', to: '', day: DAY, orgCurrency: 'KES', typeLabel: () => 'Materials', agreementOf: () => null, statusLabel: (s) => s, ...over });

test('performance counts orders, lines, cost and the share of deliveries honoured', () => {
    const orders = [
        { id: 'PO1', data: po({ number: 'PO1', status: 'full', deliveredAt: '2026-10-12T00:00:00Z', paid: 1000, receivedQty: 10, deliveries: [delivery('2026-10-12', 10)], lines: [{ ...po().lines[0], receivedQty: 10 }] }) },
        { id: 'PO2', data: po({ number: 'PO2', status: 'full', deliveries: [delivery('2026-10-25', 10)], lines: [{ ...po().lines[0], receivedQty: 10 }] }) },
        { id: 'PO3', data: po({ number: 'PO3', status: 'partial', deliveries: [delivery('2026-10-10', 4)], lines: [{ ...po().lines[0], receivedQty: 4 }] }) },
        { id: 'PO4', data: po({ number: 'PO4', status: 'sent', sentAt: '2026-11-25T00:00:00Z', approvedAt: '2026-11-25T00:00:00Z' }) },
        { id: 'PO5', data: po({ number: 'PO5', status: 'draft' }) },
    ];
    const r = buildPerformance(orders, opts());
    const s = r.summary;
    assert.equal(s.orders, 4, 'drafts are not orders');
    assert.equal(s.closed, 2);
    assert.equal(s.open, 2);
    assert.equal(s.partial, 1);
    assert.equal(s.overdue, 1, 'PO3 is partly delivered and past its date');
    assert.equal(s.lines, 4);
    assert.equal(s.value, 4000);
    assert.equal(s.paid, 1000);
    assert.equal(s.pending, 3000);
    assert.equal(s.dueOrders, 3);
    assert.equal(s.honouredOrders, 1);
    assert.equal(s.lateOrders, 1);
    assert.equal(s.overdueOrders, 1);
    assert.equal(s.pendingOrders, 1);
    assert.equal(s.honouredPct, 33.3);
    assert.equal(s.band, 'poor');
    assert.equal(s.fillRatePct, 60, '24 of the 40 ordered');
    assert.equal(r.orders.find((x) => x.id === 'PO3').verdict, 'overdue');
    assert.equal(r.lines.length, 4);
    assert.equal(r.lines.find((x) => x.orderId === 'PO2').verdictLabel, VERDICT_LABEL.late);
});

test('the period limits the orders by the day they were placed, and bands follow the share honoured', () => {
    const orders = [
        { id: 'A', data: po({ number: 'A', status: 'full', approvedAt: '2026-01-10T00:00:00Z', sentAt: '2026-01-10T00:00:00Z', deliveries: [delivery('2026-01-20', 10)], lines: [{ ...po().lines[0], receivedQty: 10 }] }) },
        { id: 'B', data: po({ number: 'B', status: 'full', approvedAt: '2026-11-01T00:00:00Z', sentAt: '2026-11-01T00:00:00Z', deliveries: [delivery('2026-11-05', 10)], lines: [{ ...po().lines[0], receivedQty: 10 }] }) },
    ];
    assert.equal(buildPerformance(orders, opts({ from: '2026-10-30', to: DAY })).summary.orders, 1);
    assert.equal(buildPerformance(orders, opts()).summary.orders, 2);
    assert.equal(buildPerformance(orders, opts()).summary.honouredPct, 100);
    assert.deepEqual([bandOf(95), bandOf(80), bandOf(50), bandOf(null)], ['good', 'watch', 'poor', 'none']);
    assert.deepEqual(buildPerformance(orders, opts()).byMonth.map((m) => m.key), ['2026-11', '2026-01']);
});

// ----- Agreements -----

const item = (over = {}) => ({ no: 10, materialId: 'MAT1', warehouseId: 'WH1', materialNumber: 'M-1', name: 'Bearing', expectedQty: 100, applied: true, standard: { unitPrice: 120, currency: 'KES', leadTimeDays: 21 }, quote: { unitPrice: 100, currency: 'KES', leadTimeDays: 14, quotedAt: '2026-03-10T00:00:00Z' }, ...over });
const pa = (over = {}) => ({ number: 'PA00000001', vendorId: 'VND000001', status: 'active', startDate: '2026-04-01', endDate: '2026-12-31', currency: 'KES', activatedAt: '2026-03-20T00:00:00Z', items: [item()], rfq: { sentAt: '2026-03-01T00:00:00Z' }, ...over });

test('an order line is tied to the agreement for its supplier, material, warehouse and date', () => {
    const refs = agreementRefs([{ id: 'PA1', data: pa() }, { id: 'PA2', data: pa({ status: 'draft' }) }]);
    assert.equal(refs.length, 1, 'only agreements that were or are in force');
    assert.equal(matchAgreement(refs, 'VND000001', 'MAT1', 'WH1', '2026-10-01').number, 'PA00000001');
    assert.equal(matchAgreement(refs, 'VND000001', 'MAT1', 'WH1', '2026-03-31'), null, 'before the start');
    assert.equal(matchAgreement(refs, 'VND000001', 'MAT1', 'WH1', '2027-01-01'), null, 'after the end');
    assert.equal(matchAgreement(refs, 'VND000002', 'MAT1', 'WH1', '2026-10-01'), null, 'another supplier');
    assert.equal(matchAgreement(refs, 'VND000001', 'MAT2', 'WH1', '2026-10-01'), null, 'another material');
    const stopped = agreementRefs([{ id: 'PA3', data: pa({ status: 'terminated', terminatedAt: '2026-08-15T10:00:00Z' }) }]);
    assert.equal(stopped[0].end, '2026-08-15');
    assert.equal(matchAgreement(stopped, 'VND000001', 'MAT1', 'WH1', '2026-09-01'), null, 'after it was terminated');
    assert.deepEqual(paWindow(pa({ status: 'terminated', terminatedAt: '2027-02-01T00:00:00Z' })), { start: '2026-04-01', end: '2026-12-31' });
});

test('the material and warehouse of a line come from its requirement, its own fields or its item number', () => {
    const req = new Map([['RQ1|10', { materialId: 'MATR', warehouseId: 'WHR' }]]);
    const byNumber = new Map([['M-1', 'MAT1']]);
    assert.deepEqual(stockOf({ requirementId: 'RQ1', requirementLineNo: 10 }, req, byNumber), { materialId: 'MATR', warehouseId: 'WHR' });
    assert.deepEqual(stockOf({ materialId: 'MATX', warehouseId: 'WHX' }, req, byNumber), { materialId: 'MATX', warehouseId: 'WHX' });
    assert.deepEqual(stockOf({ itemCode: 'M-1', costCenterId: 'WH1' }, req, byNumber), { materialId: 'MAT1', warehouseId: 'WH1' });
    assert.equal(stockOf({ itemCode: 'ZZ', costCenterId: 'WH1' }, req, byNumber), null);
    assert.equal(stockOf({ type: 'service', itemCode: 'M-1', costCenterId: 'WH1' }, req, byNumber), null, 'services are not stock');
});

test('quote waiting time is the supplier turnaround over the last year, from cases and agreement RFQs', () => {
    const cases = [
        { id: 'Q1', data: { invites: [{ vendorId: 'VND000001', invitedAt: '2026-09-01T00:00:00Z' }], quotes: [{ vendorId: 'VND000001', createdAt: '2026-09-05T12:00:00Z' }] } },
        { id: 'Q2', data: { invites: [{ vendorId: 'VND000001', invitedAt: '2024-01-01T00:00:00Z' }], quotes: [{ vendorId: 'VND000001', createdAt: '2024-01-30T00:00:00Z' }] } },
        { id: 'Q3', data: { invites: [{ vendorId: 'VND000002', invitedAt: '2026-09-01T00:00:00Z' }], quotes: [{ vendorId: 'VND000002', createdAt: '2026-09-02T00:00:00Z' }] } },
        { id: 'Q4', data: { invites: [{ vendorId: 'VND000001', invitedAt: '2026-10-01T00:00:00Z' }], quotes: [] } },
    ];
    const w = quoteWaits(cases, [{ id: 'PA1', data: pa({ items: [item({ quote: { unitPrice: 1, quotedAt: '2026-03-07T00:00:00Z' } })] }) }], 'VND000001', DAY);
    assert.equal(w.samples, 2, 'the old request, the other supplier and the unanswered request are left out');
    assert.equal(w.avgDays, 5.3, '4.5 days for the case and 6 for the agreement RFQ');
    assert.equal(w.fromCases, 1);
    assert.equal(w.fromAgreements, 1);
    assert.equal(agreementRfqDays(pa()), 9);
    assert.equal(quoteWaits([], [], 'VND000001', DAY).avgDays, null);
});

const agreementLine = (over = {}) => ({
    orderId: 'PO1', orderNumber: 'PO00000001', vendorId: 'VND000001', status: 'full', date: '2026-06-01', currency: 'KES', materialId: 'MAT1', warehouseId: 'WH1',
    quantity: 40, receivedQty: 40, netUnitPrice: 100, no: 10, promiseOn: '2026-06-15', completeOn: '2026-06-12', verdict: 'on_time', daysLate: 0, quotedLeadDays: 14, actualLeadDays: 11, ...over,
});

test('the agreement scorecard sets intended against actual, to date while it runs and final once it ends', () => {
    const lines = [agreementLine(), agreementLine({ orderId: 'PO2', orderNumber: 'PO00000002', date: '2026-07-01', quantity: 20, receivedQty: 20, netUnitPrice: 110, verdict: 'late', daysLate: 4, actualLeadDays: 18, completeOn: '2026-07-19' })];
    const p = pa();
    const dash = dashboardOf(p, p.items, lines, converter((c) => (c === 'KES' ? 1 : null)), DAY);
    assert.equal(dash.orderedValue, 6200);
    assert.equal(dash.savings, 1200, 'savings use the agreed price against the standard price: 60 bought x 20');
    assert.equal(dash.priceBreaches, 1);
    const sc = scorecardOf({ pa: p, dash, lines, quoteWait: { avgDays: 6, samples: 4 }, day: DAY });
    const row = (k) => sc.rows.find((r) => r.key === k);
    assert.equal(sc.basis, 'to date');
    assert.equal(row('spend').intended, 10000);
    assert.equal(row('spend').actual, 6200);
    assert.ok(row('spend').pace < row('spend').intended, 'the pace is pro rata for the time used');
    assert.equal(row('savings').actual, 1200);
    assert.equal(row('lead').intended, 14);
    assert.equal(row('lead').actual, 14.5);
    assert.equal(row('lead').band, 'watch');
    assert.match(row('lead').note, /21 days.*7 days faster/);
    assert.equal(row('delivery').actual, 50);
    assert.equal(row('delivery').band, 'poor');
    assert.equal(row('price').actual, 50);
    assert.equal(row('tat').actual, 12, '2 orders skipped a 6 day quote cycle');
    assert.equal(row('tat').band, 'none');
    assert.match(row('tat').note, /own RFQ took 9 days, so 3 days net/);
    assert.ok(sc.score > 0 && sc.score <= 100);
    const ended = scorecardOf({ pa: pa({ status: 'expired' }), dash, lines, quoteWait: { avgDays: null, samples: 0 }, day: DAY });
    assert.equal(ended.basis, 'final');
    assert.equal(ended.rows.find((r) => r.key === 'spend').pace, 10000, 'once ended the whole intended figure is the target');
    assert.equal(ended.rows.find((r) => r.key === 'spend').band, 'poor');
    assert.equal(ended.rows.find((r) => r.key === 'tat').actual, null);
    const none = scorecardOf({ pa: p, dash: dashboardOf(p, p.items, [], converter(() => 1), DAY), lines: [], quoteWait: { avgDays: 6, samples: 1 }, day: DAY });
    assert.equal(none.rows.find((r) => r.key === 'delivery').band, 'none', 'nothing has fallen due, so nothing is judged');
    assert.equal(none.rows.find((r) => r.key === 'price').actual, null);
});

// ----- Wiring -----

test('the new routes are guarded, audited, classed as views and registered', () => {
    const src = read('backend/vendorInsights.ts');
    assert.match(src, /orgRoute\('org\.procurement\.vendors\.po\.dashboard', 'PRC\.vendors\.view'/);
    assert.match(src, /orgRoute\('org\.procurement\.vendors\.agreements\.dashboard', 'PRC\.vendors\.view'/);
    assert.match(src, /record\(ctx, 'org\.procurement\.vendor\.po\.dashboard\.view'/);
    assert.match(src, /record\(ctx, 'org\.procurement\.vendor\.agreements\.dashboard\.view'/);
    assert.match(src, /can\(ctx, 'PRC\.po\.view'\)/);
    assert.match(src, /can\(ctx, 'PRC\.agreements\.view'\)/);
    assert.match(read('backend/index.ts'), /\.\.\.vendorInsightRoutes/);
    for (const p of ['vendors/po/dashboard', 'vendors/agreements/dashboard']) {
        assert.deepEqual(linkRouteToBlueprint({ path: `/api/org/procurement/${p}` }), { module: 'PRC', area: 'VEN', action: 'VW' });
    }
});

test('new purchase order lines keep the material and warehouse so agreements can be matched, and the order screen shows the agreement number', () => {
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /materialId: str\(l\.materialId\),\n\s+materialNumber: str\(l\.materialNumber\),\n\s+warehouseId: str\(l\.warehouseId\)/);
    assert.match(po, /agreementNumber: ag\?\.number \?\? ''/);
    assert.match(read('backend/purchaseAgreements.ts'), /agreementLinesOf/);
    const ui = read('src/org/PurchaseOrders.tsx');
    assert.match(ui, /agreementNumber/);
});
