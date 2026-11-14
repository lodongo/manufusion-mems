import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backend = readFileSync('backend/maintenance.ts', 'utf8');
const ui = readFileSync('src/org/WorkRequests.tsx', 'utf8');

test('new work requests are Created, reviewer assignment is explicit, and the review has three final outcomes', () => {
    assert.ok(backend.includes("status: 'created'"));
    assert.ok(backend.includes("reviewProcessVersion: 2"));
    assert.ok(backend.includes("case 'assign_review'"));
    assert.ok(backend.includes("case 'close_review'"));
    assert.ok(backend.includes("case 'cancel_review'"));
    assert.ok(backend.includes("case 'to_assessment'"));
    assert.ok(backend.includes("status: 'to_be_assessed'"));
    assert.ok(backend.includes("reviewerUid"));
    assert.ok(!ui.includes('Choose the employee who will review'));
    assert.ok(!ui.includes('ReviewerAssignment'));
    assert.ok(backend.includes('automaticWrReviewer'));
    assert.ok(backend.includes('eligibleReview'));
    assert.ok(backend.includes("reviewAssignmentSource: 'workflow'"));
    assert.ok(ui.includes('Close (no assessment)'));
    assert.ok(ui.includes('Cancel (review)'));
    assert.ok(ui.includes('To Be Assessed'));
});
test('assessment numbering is database-managed and records are separately stored', () => {
    assert.ok(backend.includes("nextOrgCounter(ctx.orgId, 'assessmentSeq')"));
    assert.ok(backend.includes('ASSM_'));
    assert.ok(backend.includes('work_assessments'));
    assert.ok(backend.includes("workRequestCode: doc.id"));
    assert.ok(ui.includes("area === 'assessments' && /^ASSM_"));
});
test('repeat cancellation only links to a request for the same equipment', () => {
    assert.ok(backend.includes("str(other.data.unitId) !== str(doc.data.unitId)"));
    assert.ok(backend.includes("case 'cancel_review'"));
    assert.ok(backend.includes("repeatRequestCode"));
    assert.ok(ui.includes('Search number or description'));
    assert.ok(ui.includes('Not Required'));
});
test('review closure records cause, what was done, closed date and elapsed time', () => {
    assert.ok(backend.includes('durationMinutes'));
    assert.ok(backend.includes('dateClosed: closedDate'));
    assert.ok(backend.includes('failure cause'));
    assert.ok(ui.includes("label='Actual time taken (minutes) *'"));
    assert.ok(ui.includes("label='Date closed *'"));
});
