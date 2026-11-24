import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readRequirementApproval, requirementNeedsApproval } from '../../backend/procurementPolicy.ts';

// Purchase requirements: the immediate manager's step is configurable (approve every one, or review small fully
// budgeted ones). The strict setting is the default, and anything unclear falls back to it.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the stored rule reads as strict unless it is exactly a valid review rule', () => {
    for (const v of [undefined, null, {}, { mode: 'review_below' }, { mode: 'review_below', threshold: 0 }, { mode: 'review_below', threshold: -5 }, { mode: 'review_below', threshold: 'x' }, { mode: 'skip', threshold: 100 }])
        assert.deepEqual(readRequirementApproval(v), { mode: 'approve', threshold: 0 }, JSON.stringify(v));
    assert.deepEqual(readRequirementApproval({ mode: 'review_below', threshold: 1000.005 }), { mode: 'review_below', threshold: 1000.01 });
});

test('only fully budgeted requirements within the limit skip approval', () => {
    const strict = { mode: 'approve', threshold: 0 };
    const review = { mode: 'review_below', threshold: 1000 };
    assert.equal(requirementNeedsApproval(strict, [10]), true, 'strict always needs approval');
    assert.equal(requirementNeedsApproval(review, [400, 600]), false, 'exactly at the limit goes to review');
    assert.equal(requirementNeedsApproval(review, [400, 600.01]), true, 'above the limit');
    assert.equal(requirementNeedsApproval(review, [400, null]), true, 'an unbudgeted item');
    assert.equal(requirementNeedsApproval(review, [400, 0]), true, 'a zero budget is not a budget');
    assert.equal(requirementNeedsApproval(review, [-500, 600]), true, 'negative budgets cannot offset');
    assert.equal(requirementNeedsApproval(review, []), true, 'no items');
});

test('changing the rule needs the chart of authority permission, a reason and a version, and is audited', () => {
    const src = read('backend/procurementPolicy.ts');
    assert.match(src, /approvalChanged && !can\(ctx, 'PRC\.authority\.manage'\)/);
    assert.match(src, /orgRoute\('org\.procurement\.policy\.save', 'PRC\.setup\.manage'/);
    assert.match(src, /expectedVersion\) !== current\.version/);
    assert.match(src, /versions\/\$\{version\}`, \{ \.\.\.data, reason, previous:/);
    assert.match(src, /record\(ctx, 'org\.procurement\.policy\.save'/);
});

test('review mode keeps the manager in the loop and procurement independent', () => {
    const src = read('backend/purchaseRequirements.ts');
    assert.match(src, /requirementNeedsApproval\(policy\.requirementApproval, lines\.map\(\(l\) => numOf\(l\.budget\)\)\)/);
    assert.match(src, /status: 'approved', approvalMode: 'review', approvedBy: ''/, 'no approver is recorded for a reviewed requirement');
    assert.match(src, /returnManager: \(status === 'pending_approval' \|\| underReview\(d\)\) && isManager\(ctx, d\)/, 'the manager can return it while it waits for procurement');
    assert.match(src, /approvals: others\.filter\(\(r\) => \(str\(r\.data\.status\) === 'pending_approval' \|\| underReview\(r\.data\)\)/, 'it appears in the manager\'s inbox');
    assert.match(src, /You are the reviewing manager of this requirement, so another buyer must acknowledge it\./);
    assert.match(src, /status: 'approved', approvalMode: 'approve', approvedBy: ctx\.uid/, 'an explicit approval ends review mode');
    assert.match(src, /status: 'pending_approval', approvalMode: 'approve', approvedBy: ''/, 'sent back to the manager means approval');
});

test('manufacturing master releases and purchase orders keep mandatory independent approval', () => {
    assert.match(read('backend/plnMfgRelease.ts'), /Independent maker-checker approval is mandatory\./);
    assert.match(read('backend/plnMfgRelease.ts'), /status:'pending_approval',submittedAt:at/);
});
