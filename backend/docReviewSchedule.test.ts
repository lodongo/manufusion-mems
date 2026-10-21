import test from 'node:test';
import assert from 'node:assert/strict';
import {nextReviewDate,reviewState} from './docReviewSchedule';
test('review scheduling clamps calendar month end and leap years',()=>{
 assert.equal(nextReviewDate('2024-01-31T10:00:00Z',1),'2024-02-29');
 assert.equal(nextReviewDate('2025-01-31T10:00:00Z',1),'2025-02-28');
 assert.equal(nextReviewDate('2025-10-21T08:00:00Z',12),'2026-10-21');
});
test('due schedule is explicit and invalid inputs stay unscheduled',()=>{
 assert.equal(reviewState('2026-10-20','2026-10-21'),'overdue');
 assert.equal(reviewState('2026-11-01','2026-10-21'),'due_soon');
 assert.equal(reviewState('2027-11-01','2026-10-21'),'current');
 assert.equal(nextReviewDate('invalid',12),null);
});
