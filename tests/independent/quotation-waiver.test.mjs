import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waiverBlock } from '../../backend/purchaseOrders.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('fewer quotes: the requisition and order wait for an approved waiver', () => {
    assert.equal(waiverBlock({ recommendation: { shortfallReason: '' } }), '', 'enough quotes: nothing to wait for');
    assert.match(waiverBlock({ recommendation: { shortfallReason: 'Only one OEM supplier in the region for this part' } }), /request the waiver/);
    assert.match(waiverBlock({ recommendation: { shortfallReason: 'Only one OEM supplier', waiver: { status: 'pending' } } }), /waiting for approval/);
    assert.equal(waiverBlock({ recommendation: { shortfallReason: 'Only one OEM supplier', waiver: { status: 'approved' } } }), '');
});

test('server: waiver on recommend, chart of authority route, independence, rejection reopens, gates', () => {
    const q = read('backend/quotations.ts');
    assert.match(q, /const waiver = received < minQuotes \? await buildWaiver\(/);
    assert.match(q, /approvalRoute\(ctx\.orgId, ctx\.me, value, authority, ctx\.testMode === true\)/);
    assert.match(q, /You recommended this quotation, so someone else must approve the waiver/);
    assert.match(q, /a different person must approve this one/);
    assert.match(q, /orgRoute\('org\.procurement\.quotes\.waiver\.decide', 'PRC\.quotes\.waiver'/);
    assert.match(q, /status: 'sourcing', recommendation: null, rev: \(Number\(d\.rev\) \|\| 0\) \+ 1, lastWaiver/);
    const po = read('backend/purchaseOrders.ts');
    assert.match(po, /const blocked = waiverBlock\(d\);\n\s+if \(blocked\) throw new HttpError\(409, blocked\);/);
    assert.match(po, /!waiverBlock\(c\.data\)/);
    assert.match(po, /add\('Cost', 'cost\.waiver', 'Fewer quotes approved', 'fail'/);
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /p\('PRC\.quotes\.waiver'/);
    assert.match(policy, /id: 'quote-recommend-waiver', a: 'PRC\.quotes\.manage', b: 'PRC\.quotes\.waiver'/);
    assert.match(read('backend/levelRoles.ts'), /'PRC\.po\.approve', 'PRC\.quotes\.waiver'/);
});

test('UI: waiver card with approve/reject and the step to make requisitions', () => {
    const ui = read('src/org/Quotations.tsx');
    assert.match(ui, /function WaiverCard/);
    assert.match(ui, /Request waiver approval/);
    assert.match(ui, /I accept the risk of buying with less competition/);
    assert.match(ui, /requisitions\/create', \{ quotationId: c\.id \}/);
});
