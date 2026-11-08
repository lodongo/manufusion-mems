import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consolidationWindow, specCovers, scopeLinesOf } from '../../backend/purchaseOrders.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('consolidation window: pressed when the most urgent line must be ordered within the window', () => {
    const lines = [
        { no: 10, itemName: 'Lock nut', dateRequired: '2026-12-31', leadTimeDays: 25 },
        { no: 20, itemName: 'Bearing', dateRequired: '2026-12-20', leadTimeDays: 10 },
        { no: 30, itemName: 'Gasket' },
    ];
    const open = consolidationWindow(lines, 7, '2026-11-08');
    assert.equal(open.pressed, false);
    assert.equal(open.latestOrderDate, '2026-12-06'); // line 10: 31 Dec less 25 days
    assert.equal(open.slackDays, 28);
    assert.equal(open.canWaitUntil, '2026-11-29');
    assert.equal(open.undated, 1);
    const pressed = consolidationWindow(lines, 30, '2026-11-08');
    assert.equal(pressed.pressed, true);
    const late = consolidationWindow([{ no: 10, dateRequired: '2026-11-10', leadTimeDays: 25 }], 7, '2026-11-08');
    assert.ok(late.pressed && late.slackDays < 0);
    assert.equal(consolidationWindow(lines, 0, '2026-11-08').enabled, false);
    assert.equal(consolidationWindow([{ no: 10 }], 7, '2026-11-08').known, false);
});

test('specification: categories and whole-category scopes cover requisition keys; empty orders use the spec for buyer groups', () => {
    const spec = [{ kind: 'material', categoryCode: 'MEC', subcategoryCode: 'FAST' }, { kind: 'material', categoryCode: 'ELE', subcategoryCode: '' }];
    assert.equal(specCovers(spec, 'material|MEC|FAST'), true);
    assert.equal(specCovers(spec, 'material|MEC|BEAR'), false);
    assert.equal(specCovers(spec, 'material|ELE|CABLE'), true);
    assert.equal(specCovers(spec, 'service|ELE|CABLE'), false);
    assert.deepEqual(scopeLinesOf({ lines: [], spec: { scopes: spec } })[0], { type: 'material', categoryCode: 'MEC', subcategoryCode: 'FAST' });
});

test('server: open with a specification, attach, aim to consolidate, confirm warning and audit', () => {
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /orgRoute\('org\.procurement\.orders\.create_spec', 'PRC\.po\.manage'/);
    assert.match(po, /is not registered for one of the categories chosen/);
    assert.match(po, /These categories are outside your buyer groups/);
    assert.match(po, /record\(ctx, 'org\.procurement\.order\.create_spec'/);
    assert.match(po, /give the reason for a separate order \(at least 20 characters\)/);
    assert.match(po, /add\('Deliveries', 'consolidation\.window', 'Time to consolidate', 'warn'/);
    assert.match(po, /Releasing it now needs your reason/);
    assert.match(po, /orgRoute\('org\.procurement\.orders\.consolidation', 'PRC\.po\.view'/);
    assert.match(po, /consolidationWindowDays: windowDays/);
});

test('trace: steps with lead time, share of the total and who it waited on', () => {
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /pct: spanHours > 0 \? round\(\(hours \/ spanHours\) \* 100, 1\) : 0/);
    assert.match(po, /steps: stepRows,\n\s+byParty,/);
    assert.match(po, /key: 'waiver', label: 'Fewer-quotes waiver approved'/);
    const ui = read('src/org/PoConsolidation.tsx');
    assert.match(ui, /function Pie\(/);
    assert.match(ui, /By who it waited on/);
    assert.match(read('src/org/PurchaseOrders.tsx'), /<TraceBreakdown steps=/);
});
