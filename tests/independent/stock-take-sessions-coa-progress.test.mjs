import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sessionProgress } from '../../backend/stockTakeProgress.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

const line = (expected, counted, posted = false) => ({ expected, counted, posted, verified: counted !== null, recount: false });

test('Progress: stages, completion, accuracy and targets are worked out from the PI documents', () => {
    const session = { status: 'open', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-11T00:00:00.000Z', metrics: { targetPiDocuments: 4, targetLocations: 8, targetAccuracyPct: 75, varianceToleranceValue: 100 } };
    const pis = [
        { status: 'awaiting_print', lines: [line(5, null), line(2, null)] },
        { status: 'verification', lines: [line(5, 5), line(3, 2)] },
        { status: 'reconciled', lines: [line(1, 1, true), line(4, 4, true)], varianceValue: 0 },
        { status: 'pending_post_approval', lines: [line(10, 12)], varianceValue: 150 },
        { status: 'disregarded', lines: [line(1, null)] },
    ];
    const p = sessionProgress(session, pis, '2026-11-06T00:00:00.000Z');
    assert.equal(p.phase, 'in_progress');
    assert.equal(p.piDocuments.total, 5);
    assert.equal(p.piDocuments.live, 4);
    assert.equal(p.piDocuments.disregarded, 1);
    assert.equal(p.completionPct, 25);
    const stage = Object.fromEntries(p.stages.map((x) => [x.key, x.pct]));
    assert.equal(stage.printing, 75);
    assert.equal(stage.counting, 75);
    assert.equal(stage.submitted, 50);
    assert.equal(stage.posting, 25);
    assert.equal(p.locations.planned, 7);
    assert.equal(p.locations.counted, 5);
    assert.equal(p.locations.posted, 2);
    assert.equal(p.accuracy.matched, 3);
    assert.equal(p.accuracy.pct, 60);
    assert.equal(p.targets.accuracyMet, false);
    assert.equal(p.varianceValue, 150);
    assert.equal(p.targets.withinTolerance, false);
    assert.equal(p.timeUsedPct, 50);
});

test('Progress: a session past its end is overdue; recount PIs do not add planned locations', () => {
    const session = { status: 'open', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-02T00:00:00.000Z', metrics: {} };
    const pis = [
        { status: 'recount_pending', lines: [line(1, 1, true), line(2, 3)] },
        { status: 'counting', parentPi: 'PI000000001', lines: [line(2, null)] },
    ];
    const p = sessionProgress(session, pis, '2026-11-05T00:00:00.000Z');
    assert.equal(p.phase, 'overdue');
    assert.equal(p.locations.planned, 2);
    assert.equal(p.piDocuments.recounts, 1);
    assert.equal(p.timeUsedPct, 100);
    assert.equal(sessionProgress({ ...session, status: 'closed' }, [], '2026-11-05T00:00:00.000Z').phase, 'closed');
    assert.equal(sessionProgress({ ...session, startAt: '2026-12-01T00:00:00.000Z', endAt: '' }, [], '2026-11-05T00:00:00.000Z').phase, 'scheduled');
});

test('Sessions come first: a PI is created only inside an open, started session that fixes config and warehouse', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /'POST \/api\/org\/inventory\/stocktake\/count-session\/create'/);
    assert.match(server, /await requireAtWarehouse\(ctx, 'INV_ST_030', warehouseId\);/);
    assert.match(server, /await requireAtWarehouse\(ctx, 'INV_ST_031', str\(doc\.data\.warehouseId\)\);/);
    assert.match(server, /Open a stock take session first; PI documents are created inside a session\./);
    assert.match(server, /const configId = str\(campaign\.data\.configId\);/);
    assert.match(server, /const closedWhy = campaignClosedReason\(campaign\.data, nowIso\(\)\);/);
    assert.match(server, /The start cannot be in the past/);
    assert.match(server, /campaignId: str\(d\.campaignId\)/, 'recount PIs stay in the session');
    assert.match(server, /audited\(ctx, 'inventory\.stocktake\.count_session\.create'/);
    assert.match(server, /audited\(ctx, `inventory\.stocktake\.count_session\.\$\{action\}`/);
    assert.match(server, /Finish or disregard the open PI documents first/);
});

test('Variances follow the Chart of Authority level by level; no posting without a baseline', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /const route = await approvalRoute\(ctx\.orgId, ctx\.me, variance\.value, authority, ctx\.testMode === true\);/);
    assert.match(server, /if \(route\.problems\.length && !bypass\(ctx, 'inv\.stocktake\.coa_route'\)\) throw new HttpError\(409/);
    assert.match(server, /if \(!check\.ok\) throw new HttpError\(403, check\.why/);
    assert.match(server, /You approved an earlier level, so a different person must approve this one\./);
    assert.match(server, /Every Chart of Authority level must approve before posting\./);
    assert.match(server, /no reconciled stock baseline, so/);
    assert.match(server, /no reconciled stock in this warehouse, so/);
    assert.match(server, /if \(action === 'reject_posting'\)/);
    const policy = read('backend/permissionPolicy.ts');
    assert.match(policy, /p\('INV_ST_030', 'Stock take: plan stock take sessions'\)/);
    assert.match(policy, /p\('INV_ST_031', 'Stock take: close or cancel stock take sessions', true\)/);
    assert.match(policy, /id: 'st-plan-approve', a: 'INV_ST_030', b: 'INV_ST_027'/);
});

test('Screen: Active sessions tab first, session panel with PI documents and progress report, verified plan form', () => {
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /useState<'sessions' \| 'process' \| 'config'>\('sessions'\)/);
    assert.match(screen, /\{ value: 'sessions', label: 'Active sessions'/);
    assert.doesNotMatch(screen, /<Plus className='h-4 w-4' \/> New PI\n/, 'no top-level New PI button');
    assert.match(screen, /function CountSessionPanel\(/);
    assert.match(screen, /function ProgressReport\(/);
    assert.match(screen, /function planErrors\(/);
    assert.match(screen, /acknowledge: 'The configuration, warehouse, dates and targets are correct\./);
    assert.match(screen, /callBackend<\{ ok: boolean; id\?: string \}>\(API \+ 'start', \{ sessionId: c\.id/);
    assert.match(screen, /const approveBarred = \(!!you\?\.approveConflict && !testMode\) \|\| coaBarred;/);
});
