import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MCL_TO_RESTRICTION, SEGREGATED_RESTRICTIONS, binningBlock, effectiveRestriction, locationBlock, restrictionColor } from '../../backend/restrictionRules.ts';
import { STOCK_META_BY_KEY } from '../../backend/universalStockMetadata.ts';
import { activeAssignments, computeAutoTeams } from '../../backend/autoTeamRules.ts';
import { deliver, ruleMatches } from '../../backend/mailRules.ts';
import { inlineNoteFileIds, sanitizedNoteHtml } from '../../backend/noteFiles.ts';
import { waitLocal, waiterCount } from '../../backend/chatSignals.ts';
import { chatSettingsOf } from '../../backend/chatLive.ts';

const MASTER = STOCK_META_BY_KEY.get('warehouseRestrictions').items.map((i) => ({ code: i.code, label: i.label, active: true }));

test('warehouse restrictions: one master for materials and storage locations, with general storage', () => {
    const codes = MASTER.map((m) => m.code);
    assert.ok(codes.includes('RS15'), 'general storage restriction shipped');
    assert.equal(codes.length, 15);
    // Every old material classification suggests a restriction that exists in the master.
    for (let i = 1; i <= 16; i++) assert.ok(codes.includes(MCL_TO_RESTRICTION['MCL-' + String(i).padStart(3, '0')]), 'MCL-' + i);
    for (const c of SEGREGATED_RESTRICTIONS) assert.ok(codes.includes(c));
    assert.notEqual(restrictionColor('RS02', '#2563EB'), '#2563EB', 'generic master colour is replaced by the restriction palette');
    assert.equal(restrictionColor('RS02', '#123456'), '#123456', 'an administrator colour wins');
});

test('binning is blocked until the location and the material carry the same enabled restriction', () => {
    assert.match(binningBlock('RS15', '', MASTER, 'SL-01 Spares'), /not set/);
    assert.match(binningBlock('RS15', 'RS99', MASTER), /not in the warehouse restriction master/);
    const disabled = MASTER.map((m) => (m.code === 'RS02' ? { ...m, active: false } : m));
    assert.match(binningBlock('RS02', 'RS02', disabled), /disabled/);
    assert.match(binningBlock('', 'RS15', MASTER), /no warehouse restriction/);
    assert.match(binningBlock('RS02', 'RS15', MASTER), /mismatch/i);
    assert.equal(binningBlock('RS15', 'RS15', MASTER), '');
    assert.equal(locationBlock('RS15', MASTER), '');
    assert.match(locationBlock('', MASTER), /not set/);
});

test('material restriction: Stock Control per warehouse overrides the material master default', () => {
    assert.equal(effectiveRestriction({ warehouseRestriction: 'RS02' }, { warehouseRestriction: 'RS15' }), 'RS02');
    assert.equal(effectiveRestriction({ warehouseRestriction: '' }, { warehouseRestriction: 'RS15' }), 'RS15');
    assert.equal(effectiveRestriction(null, null), '');
});

test('binning routes and cluster creation enforce the restriction master server-side', () => {
    const proc = fs.readFileSync('backend/procurement.ts', 'utf8');
    const wh = fs.readFileSync('backend/warehouse.ts', 'utf8');
    assert.match(proc, /binningBlock\(classification,str\(bin\.restrictionCode\)/, 'bin link checks restrictions');
    assert.match(proc, /inventory\.bin\.link\.blocked/, 'blocked attempts are audited');
    assert.match(proc, /locationBlock\(binRestriction/, 'bin candidates check the location');
    assert.match(proc, /Delink the bin before changing the warehouse restriction/);
    assert.match(proc, /Choose an enabled warehouse restriction \(Stage 3\)/, 'material registration uses the restriction master');
    assert.match(wh, /is not aligned to the warehouse restriction master/, 'clusters need an aligned location');
    assert.match(wh, /Delink them before changing the restriction/, 'retagging a location with binned stock is blocked');
});

test('automatic teams: reportees, peers under the same manager and extended team from reporting lines', () => {
    const parentOfRole = new Map([['GM', ''], ['MM', 'GM'], ['EM', 'GM'], ['TECH', 'MM'], ['APP', 'TECH']]);
    const parentOfNode = new Map([['SITE_A', ''], ['SITE_B', ''], ['A_MAINT', 'SITE_A']]);
    const a = (role, node) => ({ role, node });
    const roster = [
        { uid: 'gm', assignments: [a('GM', 'SITE_A')] },
        { uid: 'me', assignments: [a('MM', 'SITE_A')] },
        { uid: 'eng', assignments: [a('EM', 'SITE_A')] },
        { uid: 't1', assignments: [a('TECH', 'A_MAINT')] },
        { uid: 't2', assignments: [a('TECH', 'SITE_A')] },
        { uid: 'ap', assignments: [a('APP', 'A_MAINT')] },
        { uid: 'tB', assignments: [a('TECH', 'SITE_B')] },
        { uid: 'mmB', assignments: [a('MM', 'SITE_B')] },
        { uid: 'gmB', assignments: [a('GM', 'SITE_B')] },
    ];
    const me = computeAutoTeams('me', roster, parentOfRole, parentOfNode);
    assert.deepEqual(me.reportees, ['t1', 't2']);
    assert.deepEqual(me.team, ['ap', 't1', 't2']);
    assert.deepEqual(me.peers, ['eng'], 'peers report to the same person; the other site has its own manager');
    assert.deepEqual(me.managers, ['gm']);
    const tech = computeAutoTeams('t1', roster, parentOfRole, parentOfNode);
    assert.deepEqual(tech.peers, ['t2']);
    assert.deepEqual(tech.reportees, ['ap']);
    const today = '2026-10-20';
    assert.equal(activeAssignments([{ positionCode: 'MM', nodeId: 'X', endsOn: '2026-01-01' }, { positionCode: 'TECH', nodeId: 'Y', startsOn: '2026-10-01' }], today).length, 1);
});

test('mail delivery: junk, safe senders, rules in order and Focused / Other', () => {
    const base = { fromEmail: 'peter@acme.co', subject: 'Line 2 shutdown', excerpt: 'Plan attached', hasAttachment: true, priority: 'normal', to: ['me@acme.co'], cc: [], recipient: 'me@acme.co' };
    const rule = (extra) => ({ id: 'r_1', name: 'r', enabled: true, from: '', subjectContains: '', bodyContains: '', hasAttachment: false, highImportance: false, sentOnlyToMe: false, moveTo: '', markRead: false, flag: false, category: '', focus: '', stop: false, ...extra });
    const exists = (f) => ['inbox', 'archive', 'junk', 'deleted', 'f_projects'].includes(f);
    assert.equal(deliver(base, { blockedSenders: ['peter@acme.co'], safeSenders: [], rules: [], focusedInbox: true }, exists).folder, 'junk');
    assert.equal(deliver(base, { blockedSenders: ['peter@acme.co'], safeSenders: ['peter@acme.co'], rules: [], focusedInbox: true }, exists).folder, 'inbox');
    const out = deliver(base, { blockedSenders: [], safeSenders: [], rules: [rule({ subjectContains: 'SHUTDOWN', moveTo: 'f_projects', flag: true, category: 'Maintenance', stop: true }), rule({ id: 'r_2', from: 'peter@acme.co', markRead: true })], focusedInbox: true }, exists);
    assert.deepEqual([out.folder, out.flagged, out.category, out.read, out.rules], ['f_projects', true, 'Maintenance', false, ['r_1']]);
    assert.equal(deliver(base, { blockedSenders: [], safeSenders: [], rules: [rule({ hasAttachment: true, moveTo: 'f_gone' })], focusedInbox: true }, exists).folder, 'inbox', 'a deleted folder never loses mail');
    assert.equal(deliver(base, { blockedSenders: [], safeSenders: [], rules: [rule({ from: 'peter@acme.co', focus: 'other' })], focusedInbox: true }, exists).focus, false);
    assert.equal(deliver({ ...base, priority: 'high' }, { blockedSenders: [], safeSenders: [], rules: [rule({ from: 'peter@acme.co', focus: 'other' })], focusedInbox: true }, exists).focus, true);
    assert.equal(ruleMatches(rule({}), base), false, 'a rule without conditions never matches');
    assert.equal(ruleMatches(rule({ sentOnlyToMe: true }), { ...base, cc: ['x@acme.co'] }), false);
});

test('notes: inline photos and drawings are stored only as references to the note’s own files', () => {
    const html = sanitizedNoteHtml('<p>x</p><img src="https://evil.example/a.png" onerror="alert(1)" data-note-file="n_abcdefghijkl" data-width="50"><img src="https://x/y.png"><script>alert(1)</script>');
    assert.equal(html, '<p>x</p><img data-note-file="n_abcdefghijkl" data-width="50" alt="">alert(1)');
    assert.deepEqual(inlineNoteFileIds(html), ['n_abcdefghijkl']);
    assert.equal(sanitizedNoteHtml('<img data-note-file="../../etc">'), '');
    assert.match(fs.readFileSync('backend/quickPersonal.ts', 'utf8'), /An inline photo is not one of this note/);
});

test('live chat: long-poll waiters resolve and clean up; settings default like WhatsApp', async () => {
    const started = Date.now();
    await waitLocal('org', ['room_x'], 30);
    assert.ok(Date.now() - started >= 25);
    assert.equal(waiterCount(), 0);
    const s = chatSettingsOf({ fontSize: 'huge', wallpaper: 'nope', readReceipts: false });
    assert.deepEqual([s.fontSize, s.wallpaper, s.readReceipts, s.lastSeen, s.appearance], ['medium', 'default', false, true, 'system']);
    const common = fs.readFileSync('backend/chatCommon.ts', 'utf8');
    assert.match(common, /bumpSignal\(/, 'every chat change bumps the live signal');
    assert.doesNotMatch(common, /ws\.send/, 'the dead WebSocket path is gone');
    const rooms = fs.readFileSync('backend/chatRooms.ts', 'utf8');
    assert.match(rooms, /'POST \/api\/org\/quick\/chat\/subscribe': \[orgRoute\('chat\.subscribe', null, async \(ctx\) => waitForChanges\(ctx\)\)\]/);
    assert.doesNotMatch(fs.readFileSync('src/org/QuickChat.tsx', 'utf8'), /12 seconds/);
});

test('integration: warehouse alignment and binning, live chat, mail rules, note photos and automatic teams through the route handlers', async () => {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/quicklinks-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr.split('\n').filter((l) => !/SECURITY_RATE_LIMIT_UNAVAILABLE|CHAT_SIGNAL_WRITE_FAILED|^\s+at |status: 404|^\}/.test(l)).join('\n'));
    for (const stage of ['restrictions ok', 'chat ok', 'mail ok', 'notes ok', 'teams ok', 'quick links scenario passed']) assert.match(result.stdout, new RegExp(stage));
});
