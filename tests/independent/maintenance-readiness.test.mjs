import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bottlenecks, datesWithin, prioritySort, readinessModel, readinessSnapshot } from '../../backend/maintenanceReadinessModel.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = '2026-11-25T10:00:00.000Z';
const wo = (o = {}) => ({ status: 'planning', createdAt: '2026-11-01T08:00:00.000Z', assessmentReview: { at: '2026-11-24T08:00:00.000Z' }, assessmentTasks: [{ id: 'T1', description: 'Replace bearing', permitCodes: [] }], taskPlanning: {}, scheduledStart: '2026-12-05', scheduledEnd: '2026-12-06', ...o });
const done = (key) => ({ key, done: true, detail: '' });
const open = (key) => ({ key, done: false, detail: '' });
const allChecks = ['people', 'tools', 'equipment', 'schedule', 'risk', 'cost'].map(done);
const sparePO = (o = {}) => ({
    taskId: 'T1', spareId: 'S1', description: 'Bearing 6205', qty: 2, uom: 'EA', status: 'awaiting_procurement', shortage: 2,
    procurement: { requirementId: 'REQ000000001', stage: 'ordered', createdAt: '2026-11-02T08:00:00.000Z', submittedAt: '2026-11-02T08:00:00.000Z', approvedAt: '2026-11-03T08:00:00.000Z',
        quotations: [{ id: 'Q1', number: 'RFQ-1', createdAt: '2026-11-04T08:00:00.000Z' }], requisitions: [{ id: 'R1', number: 'PRQ-1', createdAt: '2026-11-08T08:00:00.000Z', approvedAt: '2026-11-09T08:00:00.000Z' }],
        orders: [{ id: 'PO1', number: 'PO-1', live: true, createdAt: '2026-11-09T10:00:00.000Z', approvedAt: '2026-11-10T08:00:00.000Z', lastReceiptAt: '' }] },
    ...o,
});

test('Spares follow requirement → approval → sourcing → requisition → PO approval → delivery → reserved, with ages', () => {
    const m = readinessModel({ wo: wo(), items: [sparePO()], checklist: allChecks, assessmentApproved: true, now: NOW });
    const spares = m.dimensions.find((d) => d.key === 'spares');
    const steps = spares.items[0].steps;
    assert.deepEqual(steps.map((s) => s.key), ['pr', 'pr_approval', 'sourcing', 'requisition', 'po_approval', 'delivery', 'reserve']);
    assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'waiting', 'waiting']);
    const delivery = steps.find((s) => s.key === 'delivery');
    assert.equal(delivery.ageDays, 15.1, 'waiting for delivery since the PO approval');
    assert.equal(delivery.delayed, true, 'beyond the 14-day delivery target');
    assert.equal(delivery.ref.number, 'PO-1');
    assert.equal(spares.state, 'delayed');
    assert.equal(spares.current, 'Delivered to the warehouse');
    assert.ok(m.delays.some((x) => x.step === 'delivery'));
});

test('A later stage completes the earlier ones; stock reservation is one step; a cancelled requirement blocks', () => {
    const received = readinessModel({ wo: wo(), items: [sparePO({ status: 'reserved', shortage: 0, procurement: { ...sparePO().procurement, stage: 'received', approvedAt: '', requisitions: [] } })], checklist: allChecks, assessmentApproved: true, now: NOW });
    assert.equal(received.dimensions.find((d) => d.key === 'spares').state, 'done');
    const stock = readinessModel({ wo: wo(), items: [{ taskId: 'T1', spareId: 'S2', description: 'Grease', status: 'reserved', shortage: 0, procurement: null }], checklist: allChecks, assessmentApproved: true, now: NOW });
    assert.deepEqual(stock.dimensions.find((d) => d.key === 'spares').items[0].steps.map((s) => s.label), ['Reserved from stock']);
    const closed = readinessModel({ wo: wo(), items: [sparePO({ status: 'supply_closed' })], checklist: allChecks, assessmentApproved: true, now: NOW });
    assert.equal(closed.dimensions.find((d) => d.key === 'spares').state, 'blocked');
});

test('Dimensions are independent: a waiting spare does not stop people, tools or cost showing progress', () => {
    const m = readinessModel({ wo: wo(), items: [sparePO()], checklist: [done('people'), open('tools'), done('equipment'), done('schedule'), open('risk'), done('cost')], assessmentApproved: true, now: NOW });
    const st = Object.fromEntries(m.dimensions.map((d) => [d.key, d.state]));
    assert.equal(st.people, 'done');
    assert.equal(st.tools, 'waiting');
    assert.equal(st.cost, 'done');
    assert.equal(m.fullyReady, false);
    assert.deepEqual(m.waitingOn.map((x) => x.key), ['spares', 'tools', 'risk']);
    assert.ok(m.readinessPct > 0 && m.readinessPct < 100);
});

test('Manual follow-up steps: any order, blocked, not needed, expected date overdue', () => {
    const steps = { specialist: {
        availability: { state: 'done', at: '2026-11-10T08:00:00.000Z', addedAt: '2026-11-05T08:00:00.000Z', doneAt: '2026-11-10T08:00:00.000Z' },
        identified: { state: 'waiting', addedAt: '2026-11-05T08:00:00.000Z', expectedDate: '2026-11-20' },
    }, opportunity: { production_stop: { state: 'not_needed', note: 'Line runs at half load', addedAt: '2026-11-05T08:00:00.000Z' } } };
    const m = readinessModel({ wo: wo({ readinessSteps: steps, assessmentTasks: [{ id: 'T1', description: 'Alignment', externalResource: { type: 'Laser alignment specialist' } }] }), items: [], checklist: allChecks, assessmentApproved: true, now: NOW });
    const sp = m.dimensions.find((d) => d.key === 'specialist');
    const manual = sp.items.find((i) => i.id === 'manual').steps;
    assert.equal(manual.find((s) => s.key === 'availability').state, 'done', 'a later step can be done before an earlier one');
    assert.equal(manual.find((s) => s.key === 'identified').delayed, true, 'expected date passed');
    assert.equal(sp.state, 'delayed');
    assert.equal(sp.items[0].steps.at(-1).label, 'Specialist secured with availability evidence');
    const opp = m.dimensions.find((d) => d.key === 'opportunity');
    assert.ok(opp.items.find((i) => i.id === 'manual').steps.every((s) => s.state === 'not_needed'));
});

test('Full readiness, then the opportunity: planning window mapping', () => {
    const items = [sparePO({ status: 'reserved', shortage: 0, procurement: { ...sparePO().procurement, stage: 'received' } })];
    const ready = readinessModel({ wo: wo({ status: 'released' }), items, checklist: allChecks, assessmentApproved: true, now: NOW });
    assert.equal(ready.fullyReady, true);
    assert.equal(ready.readinessPct, 100);
    assert.equal(ready.phase, 'ready_awaiting_opportunity');
    const mapped = readinessModel({ wo: wo({ status: 'released', planningWindowId: 'PW20261205AB12', planningWindowMappedAt: '2026-11-24T08:00:00.000Z' }), items, checklist: allChecks, assessmentApproved: true, window: { id: 'PW20261205AB12', name: 'December shutdown', start: '2026-12-04', end: '2026-12-08' }, now: NOW });
    assert.equal(mapped.dimensions.find((d) => d.key === 'opportunity').items[0].steps[0].state, 'done');
    assert.equal(mapped.phase, 'ready_awaiting_opportunity', 'mapped but not yet in a maintenance window');
    const permits = readinessModel({ wo: wo({ assessmentTasks: [{ id: 'T1', description: 'Hot work', permitCodes: ['HOT'] }] }), items: [], checklist: allChecks, assessmentApproved: true, now: NOW });
    assert.equal(permits.dimensions.find((d) => d.key === 'permits').state, 'waiting');
    assert.equal(permits.fullyReady, false);
});

test('Dates inside a planning window keep the duration where possible', () => {
    assert.deepEqual(datesWithin({ start: '2026-12-04', end: '2026-12-08' }, { start: '2026-11-28', end: '2026-11-29' }), { start: '2026-12-04', end: '2026-12-05', fits: true, durationDays: 2 });
    assert.deepEqual(datesWithin({ start: '2026-12-04', end: '2026-12-08' }, { start: '2026-11-28', end: '2026-11-30' }, '2026-12-07'), { start: '2026-12-06', end: '2026-12-08', fits: true, durationDays: 3 });
    assert.equal(datesWithin({ start: '2026-12-04', end: '2026-12-05' }, { start: '2026-11-01', end: '2026-11-10' }).fits, false);
    assert.throws(() => datesWithin({ start: '2026-12-04', end: '2026-12-05' }, { start: '', end: '' }, '2026-12-09'), /Choose a start/);
});

test('Priority sequence and cross-order bottlenecks', () => {
    const list = prioritySort([
        { code: 'WO3', priorityRank: 3, severityRank: 1, scheduledStart: '2026-12-01' },
        { code: 'WO1', priorityRank: 1, severityRank: 2, scheduledStart: '2026-12-10' },
        { code: 'WO2', priorityRank: 1, severityRank: 2, scheduledStart: '2026-12-02' },
    ]);
    assert.deepEqual(list.map((x) => x.code), ['WO2', 'WO1', 'WO3']);
    const a = readinessSnapshot(readinessModel({ wo: wo(), items: [sparePO()], checklist: allChecks, assessmentApproved: true, now: NOW }));
    const b = readinessSnapshot(readinessModel({ wo: wo(), items: [sparePO()], checklist: [open('tools'), ...allChecks.filter((c) => c.key !== 'tools')], assessmentApproved: true, now: NOW }));
    const top = bottlenecks([{ code: 'WO1', snapshot: a }, { code: 'WO2', snapshot: b }]);
    assert.equal(top[0].step, 'delivery');
    assert.equal(top[0].open, 2);
    assert.equal(top[0].delayed, 2);
    assert.deepEqual(top[0].workOrders, ['WO1', 'WO2']);
});

test('Server controls: planner role, reasons, window scope, dates through the schedule rules, audit', () => {
    const r = read('backend/maintenanceReadiness.ts');
    assert.match(r, /await deps\.authority\(ctx, wo, 'MNT\.WO\.plan', 'MNT\.WO\.PLAN'\)/);
    assert.match(r, /\['blocked', 'not_needed', 'remove'\]\.includes\(state\) && note\.length < 10/);
    assert.match(r, /does not cover the equipment of this work order/);
    assert.match(r, /mnt\.planning_window\.created/);
    const o = read('backend/maintenanceOperations.ts');
    assert.match(o, /validateCycleDates\(str\(wo\.data\.maintenanceTypeCode\), start, end, cycle, wo\.data\);/);
    assert.match(o, /const back = supersede && str\(wo\.data\.status\) === 'released';/);
    assert.match(o, /readinessPatch\.readinessSnapshot=snap/);
});
