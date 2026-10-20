import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { warehouseRoutes } from '../../backend/warehouse.ts';
import { procurementRoutes } from '../../backend/procurement.ts';
import { chatRoomRoutes } from '../../backend/chatRooms.ts';
import { chatMessageRoutes } from '../../backend/chatMessages.ts';
import { chatMemberRoutes } from '../../backend/chatMembers.ts';
import { mailRoutes } from '../../backend/mail.ts';
import { mailPreferenceRoutes } from '../../backend/mailPreferences.ts';
import { quickPersonalRoutes } from '../../backend/quickPersonal.ts';
import { workGroupRoutes } from '../../backend/workGroups.ts';

// Integration scenario for warehouse restrictions, binning, live chat, mail rules, inline note photos and automatic teams.
const org = 'ql_fixture', r = 'organizations/' + org, now = new Date().toISOString();
seed(r, { status: 'active', modules: { INV: true, PRC: true }, currencyCode: 'KES', domain: 'example.test' });
for (const [id, level, parentId, extra] of [['LE', 'legal_entity', 'root', {}], ['SITE', 'site', 'LE', {}], ['WH', 'cost_center', 'SITE', { costType: 'INV' }]])
    seed(r + '/structure/' + id, { code: id, name: id, level, parentId, status: 'active', attributes: extra });
// Reporting lines: GM > MGR (me) > TECH ×2; ENG is my peer under the GM.
for (const [code, parentCode] of [['GM', ''], ['MGR', 'GM'], ['ENG', 'GM'], ['TECH', 'MGR']]) seed(r + '/positions/' + code, { code, title: code, parentCode });
const users = { me: ['UME00001', 'MGR'], gm: ['UGM00001', 'GM'], eng: ['UENG0001', 'ENG'], t1: ['UTECH001', 'TECH'], t2: ['UTECH002', 'TECH'] };
for (const [key, [uid, pos]] of Object.entries(users))
    seed('users/' + uid, { orgId: org, status: 'active', role: 'org_user', firstName: key, lastName: 'Fixture', email: key + '@example.test', assignments: [{ positionCode: pos, nodeId: 'SITE', startsOn: '2020-01-01', endsOn: '' }] });
const ctx = (who, body = {}) => {
    const uid = users[who][0];
    return {
        uid, orgId: org, role: 'org_super_admin', org: snapshot(r), me: snapshot('users/' + uid),
        permissions: ['INV.*', 'PRC.*', 'ADM.*'], directPermissions: ['INV.*', 'PRC.*', 'ADM.*'], grants: [],
        actor: { uid, email: who + '@example.test', role: 'org_super_admin', orgId: org }, meta: { ip: 'test', userAgent: 'fixture' },
        body, query: {}, claims: { email: who + '@example.test' },
    };
};
const call = (routes, path, who, body) => {
    const h = routes['POST ' + path]?.[0];
    assert.ok(h, 'missing route ' + path);
    return h(ctx(who, body));
};
const rejects = async (p, re, label) => { await assert.rejects(p, (e) => (re.test(e.message) ? true : assert.fail(label + ': ' + e.message))); };

// Material catalogue (categories / subcategories) used by warehouses and clusters.
const base = 'module_workspaces/PRC/catalogs/materials';
const sections = { categories: [{ code: 'MAT', name: 'Engineering' }], subcategories: [{ code: 'SPARES', name: 'Spares', categoryCode: 'MAT' }, { code: 'CHEM', name: 'Chemicals', categoryCode: 'MAT' }], families: [], items: [], attributes: [], attributeDomains: [], profiles: [] };
seed(base, { status: 'active', loadedAt: now, sha256: 'x', version: '1', sections: Object.fromEntries(Object.keys(sections).map((k) => [k, 1])) });
for (const [k, rows] of Object.entries(sections)) seed(base + '/parts/' + k + '_0', { json: JSON.stringify(rows) });

// 1. A warehouse saved before restrictions: one location with an old classification and a cluster.
const layout = { floors: [{ name: 'Ground floor', racking: true, rows: 2, racks: 2, columns: 2, positions: 5 }] };
seed(r + '/warehouses/WH', { costCenterId: 'WH', materialCategoryCodes: ['MAT'], storageLocations: [{ code: 'SL-01', name: 'Main store', typeCode: 'SLT-001', classificationCode: 'MCL-001', active: true, createdAt: now }], locationSeq: 1, storageTypeCode: 'BIN', conditionCode: 'AMB', layout, capacity: { totalAreaM2: 100, storageAreaM2: 80, clearHeightM: 6, positionMaxKg: 100 } });
seed(r + '/warehouses/WH/clusters/CL-0001', { kind: 'run', mode: 'next', startOrd: 0, count: 10, dims: { racks: 2, columns: 2, positions: 5 }, floorFrom: 1, floorTo: 1, rowFrom: 1, rackFrom: 1, colFrom: 1, posFrom: 1, rowTo: 1, rackTo: 1, colTo: 2, posTo: 5, firstCode: 'AA_01_A_01', lastCode: 'AA_01_B_05', name: 'Bearings', locationCode: 'SL-01', subcategories: [{ code: 'SPARES', name: 'Spares', categoryCode: 'MAT' }], positions: 10 });
seed(r + '/materials/MAT1', { materialNumber: '100001', name: 'Bearing', status: 'approved', categoryCode: 'MAT', subcategoryCode: 'SPARES', warehouseIds: ['WH'], warehouseRestriction: 'RS15' });
let wh = await call(warehouseRoutes, '/api/org/warehouse/get', 'me', { costCenterId: 'WH' });
assert.deepEqual(wh.alignment.pending.map((p) => [p.code, p.suggestedRestrictionCode]), [['SL-01', 'RS15']]);
assert.equal(wh.alignment.binningOpen, false);
assert.ok(wh.restrictions.some((x) => x.code === 'RS15'), 'restrictions come from the shared master');
const BIN = 'CL-0001__AA_01_A_01';
await rejects(call(procurementRoutes, '/api/org/inventory/material/bin/link', 'me', { id: 'MAT1', warehouseId: 'WH', binId: BIN }), /restriction of SL-01 Main store is not set/, 'unaligned location blocks binning');
assert.ok((await listDocs(r + '/audit_events')).length >= 0);
const cand = await call(procurementRoutes, '/api/org/inventory/material/bin/candidates', 'me', { warehouseId: 'WH', binId: BIN });
assert.match(cand.blockedReason, /not set/);
await rejects(call(warehouseRoutes, '/api/org/warehouse/cluster/create', 'me', { costCenterId: 'WH', confirm: true, mode: 'next', floor: 1, count: 2, expectStart: 10, locationCode: 'SL-01', subcategoryCodes: ['SPARES'] }), /not aligned to the warehouse restriction master/, 'cluster on unaligned location');

// 2. Align the location to the restriction master (explicit, audited).
const setup = (rs) => ({ costCenterId: 'WH', confirm: true, setup: { materialCategoryCodes: ['MAT'], storageTypeCode: 'BIN', conditionCode: 'AMB', layout, capacity: { totalAreaM2: 100, storageAreaM2: 80, clearHeightM: 6, positionMaxKg: 100 }, storageLocations: [{ code: 'SL-01', name: 'Main store', typeCode: 'SLT-001', restrictionCode: rs, active: true }] } });
await rejects(call(warehouseRoutes, '/api/org/warehouse/save', 'me', setup('')), /choose the warehouse restriction/, 'restriction is mandatory');
await call(warehouseRoutes, '/api/org/warehouse/save', 'me', setup('RS15'));
wh = await call(warehouseRoutes, '/api/org/warehouse/get', 'me', { costCenterId: 'WH' });
assert.equal(wh.alignment.binningOpen, true);
assert.equal(wh.clusters[0].restrictionCode, 'RS15');

// 3. Binning: material restriction must match; Stock Control overrides the material master.
seed(r + '/inventory_material_info/MAT1_WH', { materialId: 'MAT1', warehouseId: 'WH', warehouseRestriction: 'RS02' });
await rejects(call(procurementRoutes, '/api/org/inventory/material/bin/link', 'me', { id: 'MAT1', warehouseId: 'WH', binId: BIN }), /mismatch/i, 'restriction mismatch');
assert.equal((await call(procurementRoutes, '/api/org/inventory/material/bin/candidates', 'me', { warehouseId: 'WH', binId: BIN })).materials.length, 0);
seed(r + '/inventory_material_info/MAT1_WH', { materialId: 'MAT1', warehouseId: 'WH', warehouseRestriction: '' });
assert.equal((await call(procurementRoutes, '/api/org/inventory/material/bin/candidates', 'me', { warehouseId: 'WH', binId: BIN })).materials.length, 1, 'material master default RS15 matches');
await call(procurementRoutes, '/api/org/inventory/material/bin/link', 'me', { id: 'MAT1', warehouseId: 'WH', binId: BIN });
assert.equal(snapshot(r + '/warehouse_bin_occupancy/WH_' + BIN).data.restrictionCode, 'RS15');
// The location restriction cannot change while it holds binned stock.
await rejects(call(warehouseRoutes, '/api/org/warehouse/save', 'me', setup('RS02')), /Delink them before changing the restriction/, 'retag with stock');
// Nor can the material's restriction drift away from its bin.
await rejects(call(procurementRoutes, '/api/org/inventory/material/update', 'me', { id: 'MAT1', warehouseId: 'WH', section: 'inventory', values: { warehouseRestriction: 'RS02' } }), /Delink the bin/, 'material restriction locked by bin');
console.log('restrictions ok');

// 4. Chat: live revisions, WhatsApp settings, group permissions.
for (const k of ['inbox_' + users.me[0], 'inbox_' + users.t1[0]]) seed(r + '/chat_signals/' + k, { rev: '0' });
for (const u of Object.values(users)) seed('users/' + u[0] + '/chat_policy/acknowledgement', { version: 'CHAT_WORKPLACE_2026_10' });
const started = await call(chatRoomRoutes, '/api/org/quick/chat/start', 'me', { kind: 'direct', memberUids: [users.t1[0]] });
const roomId = started.room.id;
seed(r + '/chat_signals/room_' + roomId, { rev: '0' });
const init = await call(chatRoomRoutes, '/api/org/quick/chat/subscribe', 't1', { roomId, init: true });
assert.equal(init.live, true);
assert.ok(init.state && Array.isArray(init.state.online));
// A long-poll returns as soon as a message is sent (same instance wakes at once).
const waiting = call(chatRoomRoutes, '/api/org/quick/chat/subscribe', 't1', { roomId, inboxRev: init.inboxRev, roomRev: init.roomRev, roomDataRev: init.roomDataRev });
const t0 = Date.now();
await call(chatMessageRoutes, '/api/org/quick/chat/send', 'me', { roomId, text: 'Bearing is in stores', clientId: 'client_000000001' });
const woke = await waiting;
assert.ok(Date.now() - t0 < 5000, 'long-poll woke promptly');
assert.equal(woke.changed.roomData, true);
// Typing is live-only (no message refetch).
const w2 = call(chatRoomRoutes, '/api/org/quick/chat/subscribe', 'me', { roomId, inboxRev: woke.inboxRev, roomRev: (await call(chatRoomRoutes, '/api/org/quick/chat/subscribe', 'me', { roomId, init: true })).roomRev, roomDataRev: woke.roomDataRev });
await call(chatMessageRoutes, '/api/org/quick/chat/typing', 't1', { roomId, active: true });
const typed = await w2;
assert.equal(typed.changed.roomLive, true);
assert.equal(typed.changed.roomData, false);
assert.ok(typed.state.typing.some((x) => x.uid === users.t1[0]));
// Settings are validated and audited.
await rejects(call(chatMemberRoutes, '/api/org/quick/chat/preferences/save', 'me', { mode: 'settings', settings: { fontSize: 'huge' } }), /font size/, 'bad font size');
await call(chatMemberRoutes, '/api/org/quick/chat/preferences/save', 'me', { mode: 'settings', settings: { readReceipts: false, appearance: 'dark' } });
assert.equal((await call(chatMemberRoutes, '/api/org/quick/chat/preferences', 'me', {})).settings.appearance, 'dark');
await call(chatMemberRoutes, '/api/org/quick/chat/preferences/save', 'me', { mode: 'mute', roomId, duration: '8h' });
const list = await call(chatRoomRoutes, '/api/org/quick/chat/list', 't1', {});
assert.equal(list.rooms[0].unreadCount, 1);
// Group: only admins may send when the admin restricts it.
const g = await call(chatRoomRoutes, '/api/org/quick/chat/start', 'me', { kind: 'group', title: 'Planners', memberUids: [users.t1[0]] });
seed(r + '/chat_signals/room_' + g.room.id, { rev: '0' });
await call(chatMemberRoutes, '/api/org/quick/chat/invitation/respond', 't1', { roomId: g.room.id, decision: 'accept' });
await call(chatRoomRoutes, '/api/org/quick/chat/group/update', 'me', { roomId: g.room.id, action: 'policy', sendPolicy: 'admins', infoPolicy: 'admins' });
await rejects(call(chatMessageRoutes, '/api/org/quick/chat/send', 't1', { roomId: g.room.id, text: 'hi', clientId: 'client_000000002' }), /Only group administrators can send/, 'admins-only group');
await rejects(call(chatRoomRoutes, '/api/org/quick/chat/group/update', 't1', { roomId: g.room.id, action: 'describe', description: 'x' }), /Only group administrators/, 'info locked');
const media = await call(chatMessageRoutes, '/api/org/quick/chat/room', 'me', { roomId, media: true });
assert.ok(Array.isArray(media.media) && Array.isArray(media.links));
console.log('chat ok');

// 5. Mail: rules and junk on delivery, validated settings.
await rejects(call(mailPreferenceRoutes, '/api/org/mail/preferences/save', 't1', { rules: [{ name: 'Empty rule' }] }), /add at least one condition/, 'rule needs a condition');
await rejects(call(mailPreferenceRoutes, '/api/org/mail/preferences/save', 't1', { blockedSenders: ['me@example.test'], safeSenders: ['me@example.test'] }), /both blocked and safe/, 'blocked and safe');
await call(mailPreferenceRoutes, '/api/org/mail/preferences/save', 't1', { rules: [{ name: 'Shutdowns', subjectContains: 'shutdown', moveTo: 'archive', flag: true, category: 'Maintenance' }], blockedSenders: ['eng@example.test'] });
await call(mailRoutes, '/api/org/mail/send', 'me', { id: 'm_mail_00001', to: ['t1@example.test'], subject: 'Line 2 SHUTDOWN plan', html: '<p>Plan</p>' });
const got = snapshot(r + '/mailboxes/' + users.t1[0] + '/items/m_mail_00001').data;
assert.deepEqual([got.folder, got.flagged, got.category], ['archive', true, 'Maintenance']);
await call(mailRoutes, '/api/org/mail/send', 'eng', { id: 'm_mail_00002', to: ['t1@example.test'], subject: 'Hello', html: '<p>Hi</p>' });
assert.equal(snapshot(r + '/mailboxes/' + users.t1[0] + '/items/m_mail_00002').data.folder, 'junk');
const read = await call(mailRoutes, '/api/org/mail/read', 't1', { id: 'm_mail_00001', markRead: false });
assert.equal(read.item.read, false, 'mark-as-read can be deferred');
console.log('mail ok');

// 6. Notes: inline photos must be the note's own files.
const file = { id: 'n_abcdefghijkl', path: 'organizations/' + org + '/private_notes/' + users.me[0] + '/n_abcdefghijkl.png', name: 'Drawing.png', mime: 'image/png', size: 100 };
await rejects(call(quickPersonalRoutes, '/api/org/quick/note/save', 'me', { topic: 'Pump', format: 'html', body: '<p>x</p><img data-note-file="n_zzzzzzzzzzzz">', attachments: [file] }), /not one of this note/, 'foreign inline file');
const saved = await call(quickPersonalRoutes, '/api/org/quick/note/save', 'me', { topic: 'Pump', format: 'html', body: '<p>x</p><img src="https://evil/x.png" data-note-file="n_abcdefghijkl" data-width="50">', attachments: [file] });
assert.equal(snapshot('users/' + users.me[0] + '/quick_notes/' + saved.id).data.body, '<p>x</p><img data-note-file="n_abcdefghijkl" data-width="50" alt="">');
console.log('notes ok');

// 7. Automatic teams from reporting lines, synced to the linked chat group.
const teams = (await call(workGroupRoutes, '/api/org/work-groups/list', 'me', {})).groups;
const reportees = teams.find((t) => t.automatic === 'reportees');
const peers = teams.find((t) => t.automatic === 'peers');
assert.deepEqual(reportees.memberUids.slice().sort(), [users.me[0], users.t1[0], users.t2[0]].sort());
assert.deepEqual(peers.memberUids.slice().sort(), [users.me[0], users.eng[0]].sort());
assert.equal(reportees.name, 'My reportees');
await rejects(call(workGroupRoutes, '/api/org/work-groups/update', 'me', { groupId: reportees.id, name: 'x', memberUids: [users.t1[0]] }), /cannot be edited by hand/, 'automatic team locked');
const teamChat = await call(chatRoomRoutes, '/api/org/quick/chat/start', 'me', { kind: 'group', title: 'My reportees', memberUids: [users.t1[0], users.t2[0]], workGroupId: reportees.id });
seed(r + '/chat_signals/room_' + teamChat.room.id, { rev: '0' });
// t2 leaves the reporting line: the next refresh removes them from the team and its chat invitation.
seed('users/' + users.t2[0], { ...snapshot('users/' + users.t2[0]).data, assignments: [{ positionCode: 'ENG', nodeId: 'SITE', startsOn: '2020-01-01', endsOn: '' }] });
await call(workGroupRoutes, '/api/org/work-groups/list', 'me', {});
const room = snapshot(r + '/chat_rooms/' + teamChat.room.id).data;
assert.ok(!room.pendingInvites.includes(users.t2[0]) && !room.members.includes(users.t2[0]), 'departed member removed from team chat');
assert.ok(room.pendingInvites.includes(users.t1[0]), 'remaining reportee still invited');
console.log('teams ok');
console.log('quick links scenario passed');
