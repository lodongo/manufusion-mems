import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { materialApprovalAnalytics, requestEvents } from '../../backend/materialApprovalAnalytics.ts';

const names = new Map([['u1', 'Asha Requester'], ['a1', 'Ben Reviewer'], ['a2', 'Cleo Approver']]);
const returnedThenApproved = {
    name: 'Bearing 6205', createdBy: 'u1', createdAt: '2026-11-01T08:00:00Z', status: 'approved', warehouseId: 'W1', categoryCode: 'MECH',
    workflowRounds: [{ submittedAt: '2026-11-01T09:00:00Z', submittedBy: 'u1', history: [{ decision: 'return', by: 'a1', at: '2026-11-01T13:00:00Z', level: 1, comment: 'Wrong size' }] }],
    submittedAt: '2026-11-02T09:00:00Z', submittedBy: 'u1',
    approvalHistory: [
        { decision: 'approve', action: 'review', by: 'a1', at: '2026-11-02T10:00:00Z', level: 1 },
        { decision: 'approve', action: 'approve', by: 'a2', at: '2026-11-02T15:00:00Z', level: 2 },
    ],
    approvedAt: '2026-11-02T15:00:00Z', approvedBy: 'a2',
};
const rejectedExtension = { materialName: 'Seal kit', createdBy: 'u1', createdAt: '2026-11-03T08:00:00Z', submittedAt: '2026-11-03T08:00:00Z', submittedBy: 'u1', status: 'rejected', warehouseId: 'W2', approvalHistory: [{ decision: 'reject', action: 'approve', by: 'a2', at: '2026-11-03T20:00:00Z', level: 1, comment: 'Not stocked here' }] };
const pending = { name: 'Pump', createdBy: 'u1', createdAt: '2026-11-04T08:00:00Z', submittedAt: '2026-11-04T08:00:00Z', submittedBy: 'u1', status: 'pending_approval', approvalLevel: 1, approvalHistory: [] };

test('every round, return, review and final decision becomes an event with its waiting time', () => {
    const ev = requestEvents('creation', 'NWREQ_000000001', returnedThenApproved, names);
    assert.deepEqual(ev.map((e) => e.event), ['created', 'submitted', 'returned', 'submitted', 'reviewed', 'approved']);
    assert.equal(ev.find((e) => e.event === 'returned').waitHours, 4);
    assert.equal(ev.find((e) => e.event === 'approved').waitHours, 5);
    assert.equal(ev.find((e) => e.event === 'approved').byName, 'Cleo Approver');
});

test('totals, rates, cycle time, people and pending work within the window', () => {
    const r = materialApprovalAnalytics({
        materials: [{ id: 'NWREQ_000000001', data: returnedThenApproved }, { id: 'NWREQ_000000002', data: pending }],
        extensions: [{ id: 'EXREQ_000000001', data: rejectedExtension }],
        names, from: '2026-11-01', to: '2026-11-30', now: '2026-11-05T08:00:00Z',
    });
    assert.equal(r.totals.created, 3);
    assert.equal(r.totals.submitted, 4);
    assert.equal(r.totals.approved, 1);
    assert.equal(r.totals.rejected, 1);
    assert.equal(r.totals.returned, 1);
    assert.equal(r.totals.pendingNow, 1);
    assert.equal(r.totals.approvalRate, 50);
    assert.equal(r.byType.extension.rejected, 1);
    assert.equal(r.cycle.n, 2);
    assert.equal(r.pending[0].waitingHours, 24);
    assert.equal(r.creators[0].name, 'Asha Requester');
    assert.equal(r.creators[0].returnRate, 25);
    assert.deepEqual(r.approvers.map((a) => [a.name, a.decisions]), [['Ben Reviewer', 2], ['Cleo Approver', 2]]);
    assert.equal(r.range.grain, 'day');
});

test('outside the window nothing counts; a person outside management sees only their own work', () => {
    const r = materialApprovalAnalytics({ materials: [{ id: 'N1', data: returnedThenApproved }], extensions: [], names, from: '2026-12-01', to: '2026-12-31', now: '2026-12-05T00:00:00Z' });
    assert.equal(r.totals.submitted, 0);
    const own = materialApprovalAnalytics({ materials: [{ id: 'N1', data: returnedThenApproved }, { id: 'N2', data: { ...pending, createdBy: 'zz', submittedBy: 'zz' } }], extensions: [], names, from: '2026-11-01', to: '2026-11-30', now: '2026-11-05T00:00:00Z', onlyUid: 'a2' });
    assert.deepEqual(own.events.map((e) => e.event), ['approved']);
    assert.equal(own.totals.pendingNow, 0);
    assert.throws(() => materialApprovalAnalytics({ materials: [], extensions: [], names, from: '2026-12-31', to: '2026-12-01', now: '' }), /date range/);
    const src = readFileSync(new URL('../../backend/procurement.ts', import.meta.url), 'utf8');
    assert.match(src, /\.\.\.\(everyone\?\{\}:\{onlyUid:ctx\.uid\}\)/);
});
