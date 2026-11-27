import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    actionStats, cadenceOf, contributionOf, projectionOf, questionHistory, rankOf,
    adoptionProblems, bandOf, bandProblems, cleanEligible, effectiveProfile, nextState, nextWindow, overallOf, profilesFor,
    scoreCard, submitProblems, windowProblems,
} from '../../backend/supplierEvaluationModel.ts';
import { ALL_BUILT_KEYS, sodConflicts } from '../../backend/permissionPolicy.ts';
import { LEVEL_ROLES } from '../../backend/levelRoles.ts';
import { linkRouteToBlueprint } from '../../backend/transactionCatalogue.ts';
import { ADAPTERS } from '../../backend/workflowAdapters.ts';
import { SOURCES } from '../../backend/recordSearch.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const master = JSON.parse(read('backend/supplierRelationshipTemplate.json')).evaluation_profiles;
const MAT = master.find((p) => p.profile_id === 'MAT');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('adopting part of a template redistributes the weights to 100', () => {
    const all = effectiveProfile(MAT, null);
    assert.ok(Math.abs(sum(all.categories.map((c) => c.weight)) - 100) < 1e-9);
    const firstTwo = new Set(MAT.categories.slice(0, 2).flatMap((c) => c.questions.map((q) => q.question_id)));
    const part = effectiveProfile(MAT, firstTwo);
    assert.equal(part.categories.length, 2);
    assert.ok(Math.abs(sum(part.categories.flatMap((c) => c.questions.map((q) => q.weight))) - 100) < 1e-9);
    // Proportions are kept: QT 22 and DL 20 become 22/42 and 20/42 of 100.
    assert.ok(Math.abs(part.categories[0].weight - (22 * 100) / 42) < 1e-9);
    assert.equal(effectiveProfile(MAT, new Set()), null);
    assert.deepEqual(adoptionProblems(master, { MAT: ['MAT-QT-01'] }), []);
    assert.match(adoptionProblems(master, { MAT: ['NOPE'] }).join(' '), /Unknown question/);
    assert.match(adoptionProblems(master, { MAT: [] }).join(' '), /at least one/);
});

test('tapping cycles not assessed, OK, not OK; scores, coverage and supplier/organization/joint scores', () => {
    assert.equal(nextState('unassessed'), 'ok');
    assert.equal(nextState('ok'), 'not_ok');
    assert.equal(nextState('not_ok'), 'unassessed');
    const p = {
        id: 'MAT', name: 'Materials', categories: [
            { id: 'QT', name: 'Quality', weight: 60, questions: [{ id: 'a', accountability: 'SUPPLIER', weight: 40 }, { id: 'b', accountability: 'ORGANIZATION', weight: 20 }] },
            { id: 'DL', name: 'Delivery', weight: 40, questions: [{ id: 'c', accountability: 'BOTH', weight: 40 }] },
        ],
    };
    const empty = scoreCard(p, {});
    assert.equal(empty.score, 0);
    assert.equal(empty.coverage, 0);
    assert.equal(empty.open, 3);
    const s = scoreCard(p, { 'MAT|a': { state: 'ok' }, 'MAT|b': { state: 'not_ok' } });
    assert.equal(s.score, 40);
    assert.equal(s.coverage, 60);
    assert.equal(s.onAssessed, 66.7);
    assert.equal(s.sub.SUPPLIER.pct, 100);
    assert.equal(s.sub.ORGANIZATION.pct, 0);
    assert.equal(s.sub.BOTH.pct, 0);
    assert.equal(s.categories[0].pct, 66.7);
    assert.equal(s.categories[1].pct, null, 'nothing assessed yet');
    const full = scoreCard(p, { 'MAT|a': { state: 'ok' }, 'MAT|b': { state: 'ok' }, 'MAT|c': { state: 'ok' } });
    assert.equal(full.score, 100);
    assert.equal(full.complete, true);
    const o = overallOf([s, full]);
    assert.equal(o.score, 70);
    assert.match(submitProblems([p], { 'MAT|a': { state: 'ok' }, 'MAT|b': { state: 'not_ok', note: 'short' } }).join(' '), /finding.*not yet assessed|not yet assessed/s);
    assert.match(submitProblems([p], { 'MAT|a': { state: 'ok' }, 'MAT|b': { state: 'not_ok', note: 'x' }, 'MAT|c': { state: 'ok' } }).join(' '), /write the finding/);
    assert.deepEqual(submitProblems([p], { 'MAT|a': { state: 'ok' }, 'MAT|b': { state: 'not_ok', note: 'Late delivery in week 3' }, 'MAT|c': { state: 'ok' } }), []);
});

test('bands, windows, eligible suppliers and templates per category kind', () => {
    const b = { improveFrom: 60, passFrom: 75 };
    assert.equal(bandOf(59.99, b), 'fail');
    assert.equal(bandOf(60, b), 'improve');
    assert.equal(bandOf(75, b), 'pass');
    assert.deepEqual(bandProblems(b), []);
    assert.equal(bandProblems({ improveFrom: 80, passFrom: 70 }).length, 1);
    assert.deepEqual(nextWindow('2026-12-31', 'quarterly'), { start: '2027-01-01', end: '2027-03-31' });
    assert.deepEqual(nextWindow('2027-01-31', 'monthly'), { start: '2027-02-01', end: '2027-02-28' });
    assert.deepEqual(nextWindow('2026-12-31', 'annual'), { start: '2027-01-01', end: '2027-12-31' });
    assert.equal(windowProblems('2027-02-01', '2027-01-01').length, 1);
    const vendors = new Map([['VND000001', [{ kind: 'material', categoryCode: 'M1', categoryName: 'Bearings' }, { kind: 'service', categoryCode: 'S1', categoryName: 'Repairs' }]]]);
    const ok = cleanEligible([{ vendorId: 'VND000001', scopes: [{ kind: 'material', categoryCode: 'M1' }] }], vendors);
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.list[0].scopes.map((s) => s.categoryName), ['Bearings']);
    assert.match(cleanEligible([{ vendorId: 'VND000001', scopes: [{ kind: 'asset', categoryCode: 'A9' }] }], vendors).problems.join(' '), /not one the supplier is registered for/);
    assert.match(cleanEligible([{ vendorId: 'VND000099', scopes: [] }], vendors).problems.join(' '), /not an approved supplier/);
    assert.deepEqual(profilesFor([{ kind: 'material' }, { kind: 'service' }]), ['MAT', 'SVC']);
    assert.deepEqual(profilesFor([{ kind: 'asset' }]), ['PRJ']);
});

test('security: rights, separation of duties, templates and level roles', () => {
    for (const k of ['PRC.srm.view', 'PRC.srm.setup', 'PRC.srm.evaluate', 'PRC.srm.approve']) assert.ok(ALL_BUILT_KEYS.has(k), k);
    assert.ok(sodConflicts(['PRC.srm.evaluate', 'PRC.srm.approve']).length > 0);
    assert.ok(sodConflicts(['PRC.srm.setup', 'PRC.srm.approve']).length > 0);
    const policy = read('backend/permissionPolicy.ts');
    for (const t of ['prc_srm_admin', 'prc_srm_evaluator', 'prc_srm_approver']) assert.match(policy, new RegExp(`T\\('${t}'`));
    const by = (n) => LEVEL_ROLES.find((r) => r.name === n).permissions;
    assert.ok(by('Procurement Specialist').includes('PRC.srm.evaluate'));
    assert.ok(by('Procurement Manager').includes('PRC.srm.approve'));
    assert.ok(by('Procurement Administrator').includes('PRC.srm.setup'));
    assert.ok(by('Procurement Viewer').includes('PRC.srm.view'));
    for (const r of LEVEL_ROLES) assert.deepEqual(sodConflicts(r.permissions).filter((c) => /srm/.test(JSON.stringify(c))), [], r.name);
});

test('every route has an explicit permission, a transaction code, and changes are locked and audited', () => {
    const src = read('backend/supplierEvaluation.ts');
    const routes = [...src.matchAll(/'POST (\/api\/org\/procurement\/srm\/[^']+)': \[\s*orgRoute\('([^']+)', '([^']+)'/g)];
    assert.ok(routes.length >= 13, `found ${routes.length}`);
    for (const [, path, name, perm] of routes) {
        assert.match(perm, /^PRC\.srm\.(view|setup|evaluate|approve)$/, path);
        assert.match(name, /^org\.procurement\.srm\./);
        const l = linkRouteToBlueprint({ path });
        assert.ok(l && l.module === 'PRC' && l.area === 'VEV', path);
    }
    assert.match(read('backend/index.ts'), /\.\.\.supplierEvaluationRoutes,/);
    assert.match(src, /await record\(ctx, `org\.procurement\.srm\.\$\{action\}`/);
    assert.match(src, /writeDoc\(path, next, \{ updateTime: fresh\.updateTime \}\)/);
    // Independence, legal entity scope, setup versions, optimistic taps and the supplier SRM score.
    assert.match(src, /evaluators\(d\)\.includes\(ctx\.uid\)/);
    assert.match(src, /You can evaluate suppliers only for the legal entities you work in/);
    assert.match(src, /procurement_srm_versions\/\$\{version\}/);
    assert.match(src, /str\(ctx\.body\.expected\) !== cur/);
    assert.match(src, /srmScore: Math\.round\(score \* 10\) \/ 10/);
    assert.match(src, /srm_evaluation_keys/);
});

test('approval reaches people as workflow actions; screens are wired', () => {
    const a = ADAPTERS.find((x) => x.key === 'prc.srm');
    assert.ok(a && a.link === 'procurement_srm' && a.routes.test('org.procurement.srm.evaluations.approve'));
    assert.ok(SOURCES.some((s) => s.type === 'SRE'));
    assert.match(read('src/org/OrgHomePage.tsx'), /path: 'procurement_srm', permission: 'PRC\.srm\.view'/);
    assert.match(read('src/org/Vendors.tsx'), /<SupplierRelationshipDashboard vendorId=\{v\.id\} \/>/);
    const ui = read('src/org/SupplierEvaluation.tsx');
    assert.match(ui, /usePoll\(\(\) => void load\(\), 4000\)/, 'scorecard refreshes in real time');
    assert.match(ui, /nextState\(cur\)/, 'tap cycles the state');
    const vis = read('src/org/srmVisuals.tsx');
    assert.match(vis, /rgba\(34, 197, 94, 0\.13\)/, 'OK is light green');
    assert.match(vis, /rgba\(239, 68, 68, 0\.12\)/, 'not OK is light red');
    assert.match(vis, /const hue = \(s \/ 100\) \* 125;/, 'red to yellow to green');
});

test('deeper analytics: contribution, projection, cadence, action closure, repeat findings and rank', () => {
    const card = { score: 40, coverage: 60, sub: { SUPPLIER: { earned: 40, weight: 40, assessed: 40 }, ORGANIZATION: { earned: 0, weight: 20, assessed: 20 }, BOTH: { earned: 0, weight: 40, assessed: 0 } } };
    const c = contributionOf([card]);
    assert.deepEqual(c.map((x) => [x.accountability, x.earned, x.lost, x.open]), [['SUPPLIER', 40, 0, 0], ['ORGANIZATION', 0, 20, 0], ['BOTH', 0, 0, 40]]);
    assert.equal(c.reduce((s, x) => s + x.earned, 0), 40, 'earned adds up to the score');
    assert.deepEqual(projectionOf(card), { low: 40, high: 80 });

    const open = cadenceOf({ start: '2026-10-01', end: '2026-12-31' }, 'quarterly', '2026-09-30', '2026-10-05T10:00:00Z', '2026-11-27');
    assert.equal(open.phase, 'open');
    assert.equal(open.daysToClose, 34);
    assert.equal(open.daysSinceLast, 53);
    assert.deepEqual(open.next, { start: '2027-01-01', end: '2027-03-31' });
    const up = cadenceOf({ start: '2027-01-01', end: '2027-03-31' }, 'quarterly', '', '', '2026-11-27');
    assert.equal(up.phase, 'upcoming');
    assert.equal(up.daysToOpen, 35);
    assert.equal(cadenceOf({ start: '2026-07-01', end: '2026-09-30' }, 'quarterly', '', '', '2026-11-27').overdue, true);

    const s = actionStats([
        { status: 'open', dueDate: '2026-11-10', createdAt: '2026-10-01', accountability: 'SUPPLIER' },
        { status: 'open', dueDate: '2026-12-01', createdAt: '2026-11-01', accountability: 'SUPPLIER' },
        { status: 'done', dueDate: '2026-11-30', createdAt: '2026-10-01', doneAt: '2026-10-21', accountability: 'ORGANIZATION' },
        { status: 'verified', dueDate: '2026-10-15', createdAt: '2026-09-01', doneAt: '2026-10-20', verifiedAt: '2026-10-24', accountability: 'BOTH' },
    ], '2026-11-27');
    assert.equal(s.closureRate, 50);
    assert.equal(s.onTimeRate, 50, 'one closed before its due date, one after');
    assert.equal(s.avgDaysToClose, (20 + 49) / 2);
    assert.equal(s.avgDaysToVerify, 4);
    assert.equal(s.overdue, 1);
    assert.equal(s.dueSoon, 1);
    assert.deepEqual(s.aging.map((a) => a.count), [1, 0, 1, 0]);
    assert.deepEqual(s.byAccountability.find((b) => b.accountability === 'SUPPLIER'), { accountability: 'SUPPLIER', open: 2, closed: 0 });

    const h = questionHistory([
        { number: 'A', at: '2026-03-31', answers: { 'MAT|q': { state: 'ok' } } },
        { number: 'B', at: '2026-06-30', answers: { 'MAT|q': { state: 'not_ok', note: 'late' } } },
        { number: 'C', at: '2026-09-30', answers: { 'MAT|q': { state: 'not_ok', note: 'late again' } } },
    ]);
    assert.deepEqual(h['MAT|q'], { assessed: 3, notOk: 2, streak: 2, last: { state: 'not_ok', note: 'late again', at: '2026-09-30', evaluation: 'C' } });

    assert.deepEqual(rankOf(80, [90, 80, 70, 60, 50]), { rank: 2, of: 5, percentile: 75 });
});

test('the screens show the deeper views', () => {
    const ui = read('src/org/SupplierEvaluation.tsx');
    for (const s of ['Where the points come from', 'Can finish between', 'Last time:', "'repeat'", 'Recurring issues', 'Action closure tracker', 'Category heat-map', 'Supplier league table', 'Weakest categories', 'Assessment due in', 'Since last final assessment']) assert.ok(ui.includes(s), s);
    assert.match(read('backend/supplierEvaluation.ts'), /'POST \/api\/org\/procurement\/srm\/insights'/);
});
