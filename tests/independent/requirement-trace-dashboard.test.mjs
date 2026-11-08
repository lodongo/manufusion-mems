import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceRequirement, dashboardOf, bucketOf } from '../../backend/requirementTrace.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const req = { id: 'R1', data: { number: 'R1', status: 'acknowledged', createdAt: '2026-10-01T08:00:00Z', approvedAt: '2026-10-03T08:00:00Z', acknowledgedAt: '2026-10-04T08:00:00Z', storesRelease: { status: 'released', at: '2026-10-02T08:00:00Z' }, lines: [{ no: 10, materialId: 'M', warehouseId: 'W', materialNumber: 'M1', itemName: 'Bearing', quantity: 10, unit: 'EA', dateRequired: '2026-10-25' }], history: [] } };
const quotations = [{ id: 'Q1', data: { requirementId: 'R1', status: 'recommended', createdAt: '2026-10-05T08:00:00Z', recommendation: { at: '2026-10-08T08:00:00Z' } } }];
const requisitions = [{ id: 'PRQ1', data: { requirementId: 'R1', status: 'converted', createdAt: '2026-10-08T09:00:00Z', confirmedAt: '2026-10-09T08:00:00Z' } }];
const po = (deliveries) => ({ id: 'PO1-V1', data: { number: 'PO1', status: deliveries.reduce((s, d) => s + d.lines[0].qty, 0) >= 10 ? 'full' : 'partial', vendorName: 'Krones', createdAt: '2026-10-09T10:00:00Z', approvedAt: '2026-10-10T08:00:00Z', sentAt: '2026-10-11T08:00:00Z', lines: [{ no: 10, requirementId: 'R1', requirementLineNo: 10, quantity: 10, leadTimeDays: 10 }], deliveries } });
const D = (id, at, qty) => ({ id, recNo: `REC_${id}`, at, date: at.slice(0, 10), lines: [{ no: 10, qty }] });

test('trace: milestones in order, internal / external / finance, delays against plan and need date', () => {
    const t = traceRequirement({ req, quotations, requisitions, orders: [po([D('D1', '2026-10-20T08:00:00Z', 4), D('D2', '2026-10-27T08:00:00Z', 6)])], invoices: [{ id: 'INV_1', data: { status: 'paid', deliveryIds: ['D1', 'D2'], createdAt: '2026-10-28T08:00:00Z', postedAt: '2026-10-30T08:00:00Z', amount: 100 } }], payments: [{ id: 'PAY_1', data: { status: 'paid', invoices: [{ id: 'INV_1', amount: 100 }], paidAt: '2026-11-05T08:00:00Z' } }], today: '2026-11-08' });
    assert.deepEqual(t.milestones.map((m) => m.key), ['raised', 'released', 'approved', 'acknowledged', 'quotation', 'recommended', 'requisition', 'reqConfirmed', 'poCreated', 'poApproved', 'sent', 'firstDelivery', 'delivered', 'invoiced', 'invoicePosted', 'paid']);
    assert.equal(t.byGroup.internal, 10); // 1 Oct → 11 Oct
    assert.equal(t.byGroup.external, 16); // 11 Oct → 27 Oct
    assert.equal(t.byGroup.finance, 9); // 27 Oct → 5 Nov
    assert.equal(t.expectedDelivery, '2026-10-21');
    assert.equal(t.externalDelay, 6);
    assert.equal(t.plannedSendBy, '2026-10-15');
    assert.equal(t.internalDelay, 0);
    assert.equal(t.overallDelay, 2);
    assert.equal(t.paid, true);
    assert.equal(t.stageLabel, 'Paid');
    assert.equal(bucketOf(t.overallDelay), 'd1_7');
});

test('trace: an open step counts against the next one, partial delivery outstanding, expired delivery date', () => {
    const t = traceRequirement({ req, quotations, requisitions, orders: [po([D('D1', '2026-10-20T08:00:00Z', 4)])], invoices: [], payments: [], today: '2026-11-08' });
    assert.equal(t.outstanding, 6);
    assert.equal(t.delivered, false);
    assert.equal(t.deliveryExpired, true);
    assert.equal(t.stageLabel, 'Partly delivered');
    const open = t.steps.find((s) => s.ongoing);
    assert.equal(open.key, 'delivered');
    assert.equal(open.group, 'external');
    assert.equal(open.days, 18.7);
    assert.equal(t.externalDelay, 18); // expected 21 Oct, still outstanding on 8 Nov
});

test('dashboard: averages, pyramid, split and supplier performance', () => {
    const a = traceRequirement({ req, quotations, requisitions, orders: [po([D('D1', '2026-10-20T08:00:00Z', 10)])], invoices: [], payments: [], today: '2026-11-08' });
    const b = traceRequirement({ req: { ...req, id: 'R2', data: { ...req.data, number: 'R2' } }, quotations: [], requisitions: [], orders: [], invoices: [], payments: [], today: '2026-11-08' });
    const dsh = dashboardOf([a, b], '2026-11-08');
    assert.equal(dsh.counts.traced, 2);
    assert.equal(dsh.counts.delivered, 1);
    assert.equal(dsh.averages.onTimePct, 100);
    assert.equal(dsh.pyramid.find((p) => p.key === 'on_time').count, 1);
    assert.equal(dsh.pyramid.find((p) => p.key === 'd8_14').count, 1, 'not delivered and 14 days past the need date');
    assert.ok(dsh.split.find((s) => s.key === 'external').days > 0);
    assert.equal(dsh.vendors[0].vendor, 'Krones');
});

test('routes are guarded and audited; screens show trace, dashboards, details pop-ups and reminders', () => {
    const r = read('backend/requirementAnalytics.ts');
    for (const x of ['trace', 'dashboard', 'reminder']) assert.match(r, new RegExp(`orgRoute\\('org\\.inventory\\.requirements\\.${x}', 'INV\\.req\\.view'`));
    assert.match(r, /record\(ctx, 'org\.inventory\.requirements\.reminder\.set'/);
    assert.match(r, /str\(doc\.data\.uid\) !== ctx\.uid/, 'a reminder belongs to the person who set it');
    const ui = read('src/org/RequirementInsights.tsx');
    assert.match(ui, /export function DetailSheet/);
    assert.match(ui, /Expired delivery dates/);
    assert.match(ui, /Empty bins awaiting delivery/);
    assert.match(ui, /Delay pyramid/);
    assert.match(read('src/org/InventoryRequirements.tsx'), /value: 'dashboard', label: 'Dashboard'/);
});
