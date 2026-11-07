import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accuracyCounts, metricsOf, overallStatistics, plannedPis, sessionProgress } from '../../backend/stockTakeProgress.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

const line = (expected, counted, posted = false, binId = 'B1', materialId = 'M1') => ({ expected, counted, posted, binId, materialId, verified: counted !== null, recount: false });

test('Progress: PI documents are planned from materials to count and materials per PI', () => {
    assert.equal(plannedPis(100, 30), 4);
    assert.equal(plannedPis(90, 30), 3);
    const session = { status: 'open', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-11T00:00:00.000Z', metrics: { targetMaterials: 10, materialsPerPi: 4, targetCountAccuracyPct: 95, targetStockAccuracyPct: 80, varianceToleranceValue: 100 } };
    const pis = [
        { piNumber: 'PI_00000001', status: 'reconciled', lines: [line(1, 1, true, 'B1', 'M1'), line(4, 3, true, 'B2', 'M2')], varianceValue: 20 },
        { piNumber: 'PI_00000002', status: 'awaiting_print', lines: [line(5, null, false, 'B3', 'M3')] },
        { piNumber: 'PI_00000003', status: 'disregarded', lines: [line(1, null, false, 'B4', 'M4')] },
    ];
    const p = sessionProgress(session, pis, '2026-11-06T00:00:00.000Z');
    assert.equal(p.phase, 'in_progress');
    assert.equal(p.piDocuments.planned, 3);
    assert.equal(p.piDocuments.originals, 2);
    assert.equal(p.materials.onPis, 3);
    assert.equal(p.materials.counted, 2);
    assert.equal(p.completionPct, 50);
    assert.equal(p.stockAccuracy.errors, 1, 'one posted line differed from the system quantity');
    assert.equal(p.stockAccuracy.pct, 50);
    assert.equal(p.timeUsedPct, 50);
});

test('Count accuracy comes from recounts; stock accuracy from errors posted (100 counted, 10 recount errors -> 90 %)', () => {
    const original = { piNumber: 'PI_00000001', status: 'recount_pending', recountNumber: 0, lines: [] };
    const recount = { piNumber: 'PI_00000001_1', parentPi: 'PI_00000001', status: 'reconciled', recountNumber: 1, lines: [] };
    for (let i = 0; i < 100; i++) {
        const bin = `B${i}`;
        const mat = `M${i}`;
        if (i < 10) {
            original.lines.push({ ...line(5, 7, false, bin, mat), recount: true });
            recount.lines.push(line(5, 5, true, bin, mat)); // the recount found the first count wrong; stock was right
        } else if (i < 20) {
            original.lines.push({ ...line(5, 4, false, bin, mat), recount: true });
            recount.lines.push(line(5, 4, true, bin, mat)); // the recount confirmed the first count; a real stock error
        } else original.lines.push(line(5, 5, true, bin, mat));
    }
    const a = accuracyCounts([original, recount]);
    assert.deepEqual([a.counted, a.countErrors, a.stockErrors], [100, 10, 10]);
    const p = sessionProgress({ status: 'open', startAt: '2026-01-01T00:00:00.000Z', metrics: { targetMaterials: 100, materialsPerPi: 100 } }, [original, recount], '2026-02-01T00:00:00.000Z');
    assert.equal(p.countAccuracy.pct, 90);
    assert.equal(p.countAccuracy.errorPct, 10);
    assert.equal(p.stockAccuracy.pct, 90);
    assert.equal(p.materials.counted, 100, 'recounts do not add counted materials');
});

test('Older sessions (target PI documents, one accuracy target) still read', () => {
    const m = metricsOf({ documentSize: 4, metrics: { targetPiDocuments: 5, targetLocations: 20, targetAccuracyPct: 98 } });
    assert.deepEqual([m.targetMaterials, m.materialsPerPi, m.targetCountAccuracyPct, m.targetStockAccuracyPct], [20, 4, 98, 98]);
});

test('Statistics: sessions in the period by start date, KPIs from summed counts, by month', () => {
    const mk = (id, startAt, counted, wrong) => ({ id, session: { name: id, status: 'closed', startAt, metrics: { targetMaterials: counted, materialsPerPi: counted } }, pis: [{ piNumber: `PI_${id}`, status: 'reconciled', lines: Array.from({ length: counted }, (_, i) => line(1, i < wrong ? 2 : 1, true, `B${i}`, `M${i}`)) }] });
    const st = overallStatistics([mk('A', '2026-01-10T08:00:00.000Z', 10, 1), mk('B', '2026-02-03T08:00:00.000Z', 30, 3), mk('C', '2025-12-20T08:00:00.000Z', 10, 10)], '2026-01-01', '2026-11-07', '2026-11-07T00:00:00.000Z');
    assert.equal(st.totals.sessions, 2);
    assert.equal(st.totals.counted, 40);
    assert.equal(st.totals.stockErrors, 4);
    assert.equal(st.totals.stockAccuracyPct, 90);
    assert.deepEqual(st.months.map((m) => m.month), ['2026-01', '2026-02']);
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
    assert.match(server, /const id = `CNT_SES_\$\{String\(n\)\.padStart\(8, '0'\)\}`;/);
    assert.match(server, /const id = `PI_\$\{String\(n\)\.padStart\(8, '0'\)\}`;/);
    assert.match(server, /nextOrgCounter\(ctx\.orgId, 'stockTakeSessionSeq'\)/);
    assert.match(server, /nextOrgCounter\(ctx\.orgId, 'stockTakePiSeq'\)/);
    assert.match(server, /planned PI documents of this session are created/);
    assert.match(server, /'POST \/api\/org\/inventory\/stocktake\/statistics'/);
    assert.match(server, /audited\(ctx, 'inventory\.stocktake\.statistics\.view'/);
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

test('Screen: no PI documents tab; sessions, statistics and configuration; PI PDF on print', () => {
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /useState<'sessions' \| 'stats' \| 'config'>\('sessions'\)/);
    assert.match(screen, /\{ value: 'sessions', label: 'Active sessions'/);
    assert.match(screen, /\{ value: 'stats', label: 'Statistics' \}/);
    assert.doesNotMatch(screen, /value: 'process'/, 'the PI documents tab is gone');
    assert.match(screen, /function CountSessionPanel\(/);
    assert.match(screen, /function ProgressReport\(/);
    assert.match(screen, /function Statistics\(/);
    assert.match(screen, /function LegacyPanel\(/);
    assert.match(screen, /function planErrors\(/);
    assert.match(screen, /label='Materials per PI \*'/);
    assert.doesNotMatch(screen, /Target PI documents/);
    assert.match(screen, /await downloadPiPdf\(s, warehouse\);/);
    assert.match(screen, /callBackend<\{ ok: boolean; id\?: string \}>\(API \+ 'start', \{ sessionId: c\.id/);
    assert.match(screen, /const approveBarred = \(!!you\?\.approveConflict && !testMode\) \|\| coaBarred;/);
});

test('Configuration: criticality classes, duration for every type, automatic or manual sessions; no PI size', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /Choose at least one criticality class \(A, B, C or D\)/);
    assert.match(server, /Choose whether sessions are created automatically or manually/);
    assert.match(server, /Choose the warehouse automatic sessions are created for/);
    assert.match(server, /if \(!cycle && \(!Number\.isInteger\(duration\) \|\| duration < 1 \|\| duration > 3650\)\) throw new HttpError\(400, 'Duration must be 1–3650 days'\);/);
    assert.doesNotMatch(server, /PI document size must be 1–1000 physical locations/);
    assert.match(server, /return new Date\(startMs \+ days \* 86_400_000\)\.toISOString\(\);/, 'session end comes from the configuration duration');
    assert.match(server, /eligible = eligible\.filter\(\(x\) => classes\.includes\(str\(x\.info\?\.criticalityClass\)\)\);/);
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /label='Sessions are created \*'/);
    assert.match(screen, /set\(\{ type: e\.target\.value, \.\.\.\(e\.target\.value === 'Cycle Count' \? \{ periodic: true \} : \{\}\), \.\.\.\(nameEdited/, 'the name follows the type until edited; a cycle count turns periodic on');
    assert.doesNotMatch(screen, /PI document size \(physical locations\)/);
    const detail = read('src/org/InventoryMaterialDetail.tsx');
    assert.match(detail, /'leadTimeDays', 'criticalityClass', 'remarks'/);
    assert.match(read('backend/procurement.ts'), /Criticality class must be A, B, C or D\./);
});

test('Automation: midnight session creation per configuration, one-time setup before PIs, automatic closing only', async () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /export async function stockTakeAutomationForOrg\(orgId: string, deadline: number\)/);
    assert.match(server, /stock_take_auto_keys\/\$\{c\.id\}_\$\{today\}`, \{ configId: c\.id, day: today, createdAt: nowIso\(\) \}, \{ exists: false \}/, 'one session per configuration and day');
    assert.match(server, /lastSessionCreatedAt: now, lastSessionId: id, nextSessionDueOn: next/);
    assert.match(server, /setupRequired: true,/);
    assert.match(server, /Complete the session setup \(materials to count, materials per PI and targets\) before creating PI documents\./);
    assert.match(server, /This session is already set up; its plan cannot be changed\./);
    assert.match(server, /if \(action !== 'cancel'\) throw new HttpError\(400, 'A session closes automatically/);
    assert.match(server, /await autoCloseSession\(ctx\.orgId, str\(d\.campaignId\), ctx\.uid\);/);
    assert.match(read('backend/automationEngine.ts'), /id: ST_JOB_ID,[\s\S]*executeStockTakeSessions\(mode, deadline\)/);
    const { stockTakeAutomationDue, addPeriod } = await import('../../backend/stockTake.ts');
    assert.equal(stockTakeAutomationDue('2026-11-07T20:00:00.000Z', new Date('2026-11-07T20:30:00.000Z')), false, '23:30 Nairobi: same day');
    assert.equal(stockTakeAutomationDue('2026-11-07T20:00:00.000Z', new Date('2026-11-07T21:05:00.000Z')), true, '00:05 Nairobi: next day');
    assert.equal(addPeriod('2026-01-31', 'Monthly'), '2026-02-28');
    assert.equal(addPeriod('2026-11-07', 'Weekly'), '2026-11-14');
    assert.equal(addPeriod('2026-11-07', 'Quarterly'), '2027-02-07');
    const screen = read('src/org/StockTake.tsx');
    assert.doesNotMatch(screen, /Close session/);
    assert.match(screen, /The session closes automatically once all its PI documents are posted/);
    assert.match(screen, /function SetupSessionPanel\(/);
});

test('Session plan: no accuracy or tolerance targets; All materials counted by the server; per-warehouse automation notice', () => {
    const server = read('backend/stockTake.ts');
    assert.doesNotMatch(server, /Target count accuracy|Target stock accuracy|Variance value tolerance must be/);
    assert.match(server, /targetMaterials: countAll \? \(allCount as number\) : whole\(m\.targetMaterials/, 'with All the count comes from the server');
    assert.match(server, /'POST \/api\/org\/inventory\/stocktake\/material-count'/);
    assert.match(server, /async function selectableLocations\(root: string, warehouseId: string, config: Obj\)/);
    const screen = read('src/org/StockTake.tsx');
    assert.doesNotMatch(screen, /label='Count accuracy % \*'|label='Stock accuracy % \*'|label='Variance tolerance \*'/);
    assert.match(screen, /function MaterialsToCount\(/);
    assert.match(screen, /<span className='text-sm text-soft'>All materials\{locked \? ' \(required by the configuration\)' : ''\}<\/span>/);
    assert.match(screen, /Automatic sessions are created for one warehouse only\. Create a separate configuration for each warehouse/);
});

test('Cycle count: always periodic, full-scope question, cycle runs to the period end; cluster: warehouse first, several clusters', async () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /if \(cycle\) b = \{ \.\.\.b, periodic: true \};/);
    assert.match(server, /Say whether the full scope of materials must be counted within each session/);
    assert.match(server, /if \(config\.data\.fullScope === true\) b\.metrics = \{ \.\.\.\(isObj\(b\.metrics\) \? b\.metrics : \{\}\), countAll: true \};/);
    assert.match(server, /return nairobiMidnight\(periodEnd\(nairobiDay\(startMs\), str\(config\.period\)\)\);/);
    assert.match(server, /if \(cycle\) next = periodEnd\(today, str\(d\.period\)\);/);
    assert.match(server, /Choose the warehouse first; its clusters are then listed/);
    assert.match(server, /'POST \/api\/org\/inventory\/stocktake\/clusters'/);
    assert.match(server, /does not exist in this warehouse/);
    const { periodEnd } = await import('../../backend/stockTake.ts');
    assert.equal(periodEnd('2026-11-07', 'Monthly'), '2026-12-01');
    assert.equal(periodEnd('2026-11-07', 'Quarterly'), '2027-01-01');
    assert.equal(periodEnd('2026-11-07', 'Weekly'), '2026-11-09', 'Saturday -> Monday');
    assert.equal(periodEnd('2026-11-09', 'Weekly'), '2026-11-16', 'a Monday runs to the next Monday');
    assert.equal(periodEnd('2026-11-07', 'Annually'), '2027-01-01');
    assert.equal(periodEnd('2026-11-07', 'Daily'), '2026-11-08');
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /label='Complete the full scope of materials within each session\? \*'/);
    assert.match(screen, /\(always on for a cycle count\)/);
    assert.match(screen, /callBackend<\{ clusters: Array/);
    assert.match(screen, /\{clusterType && warehouseField\}/);
    assert.match(screen, /locked=\{cfg\?\.fullScope === true\}/);
});

test('Automatic PI documents and independent count sheets (_A, _B) with a mandatory recount where they differ', () => {
    const server = read('backend/stockTake.ts');
    assert.match(server, /Choose whether PI documents are created automatically or manually/);
    assert.match(server, /export async function generateSessionPis\(orgId: string, campaignId: string, by: string\)/);
    assert.match(server, /return \{ ok: true, id, \.\.\.\(await autoGenerate\(ctx\.orgId, id, config\.data, ctx\.uid\)\) \};/, 'manual session: generated at creation');
    assert.match(server, /return \{ ok: true, \.\.\.\(await autoGenerate\(ctx\.orgId, id, config\?\.data, ctx\.uid\)\) \};/, 'automatic session: generated at setup');
    assert.match(server, /'POST \/api\/org\/inventory\/stocktake\/count-session\/generate'/);
    assert.match(server, /piCopies: whole\(m\.piCopies \?\? 1, 'PI documents printed per PI', 1, MAX_COPIES\)/);
    assert.match(server, /Each count sheet must be counted by a different person/);
    assert.match(server, /line\.copyMismatch = seen\.some\(\(v\) => v !== seen\[0\]\);/);
    assert.match(server, /must be recounted\./);
    assert.match(server, /copyMismatch: false,\s+copyCounts: null,/, 'recount PIs start clean');
    assert.match(server, /This session has not started yet, so its PI documents cannot be issued for counting\./);
    assert.match(server, /const counted = countersOf\(data\)\.includes\(ctx\.uid\);/);
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /label='PI documents are created \*'/);
    assert.match(screen, /label='PI documents printed per PI \*'/);
    assert.match(screen, /for \(const c of sheets\) await downloadPiSheet\(s, warehouse, `\$\{s\.piNumber\}_\$\{c\}`\);/);
    assert.match(screen, /Sheets differ: recount/);
    assert.match(screen, /key='generate'/);
});

test('Sessions close themselves once posting is complete; automatic PI problems are kept and retried', async () => {
    const { sessionComplete } = await import('../../backend/stockTake.ts');
    const now = '2026-11-20T00:00:00.000Z';
    const s = (extra = {}) => ({ status: 'open', startAt: '2026-11-07T00:00:00.000Z', endAt: '2026-11-30T00:00:00.000Z', metrics: { targetMaterials: 4, materialsPerPi: 2 }, ...extra });
    const pi = (status, parentPi = '') => ({ status, parentPi, lines: [] });
    assert.equal(sessionComplete(s(), [pi('reconciled'), pi('reconciled')], now), true, 'all planned PIs posted');
    assert.equal(sessionComplete(s(), [pi('reconciled'), pi('counting')], now), false, 'a PI is still open');
    assert.equal(sessionComplete(s(), [pi('reconciled')], now), false, 'a planned PI is still to come');
    assert.equal(sessionComplete(s({ endAt: '2026-11-10T00:00:00.000Z' }), [pi('reconciled')], now), true, 'past the end no more PIs can come');
    assert.equal(sessionComplete(s({ locationsExhausted: true }), [pi('closed_posted')], now), true);
    assert.equal(sessionComplete(s(), [], now), false, 'nothing posted, nothing to close');
    assert.equal(sessionComplete(s({ setupRequired: true }), [pi('reconciled'), pi('reconciled')], now), false);
    const server = read('backend/stockTake.ts');
    assert.match(server, /countSessions: \(await closeCompleted\(ctx, campaigns, sessions, now\)\)/, 'closed as soon as Stock take is opened');
    assert.match(server, /await recordGeneration\(orgId, campaignId, out\.generateError\);/);
    assert.match(server, /out\.generated \+= \(await autoGenerate\(orgId, s\.id, cfg, 'automation'\)\)\.generated;/, 'the nightly run retries');
    const screen = read('src/org/StockTake.tsx');
    assert.match(screen, /The PI documents could not be generated/);
    assert.match(screen, /They are generated automatically; tap Create PI documents to generate them now\./);
});
