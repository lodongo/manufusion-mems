import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { levelRoleRoutes } from '../../backend/levelRoleRoutes.ts';

const org = 'lvl_fixture', r = 'organizations/' + org;
seed(r, { status: 'active', modules: { PRC: true } });
seed('modules/PRC', { name: 'Procurement', enabled: true, sortOrder: 1 });
seed(r + '/roles/org_super_admin', { name: 'Organization super admin', permissions: ['*'], system: true });
seed(r + '/roles/org_user', { name: 'MEMS Standard User', permissions: [], system: true });
seed(r + '/roles/role_old_approver', { name: 'Purchase Order Approver', permissions: ['PRC.view', 'PRC.po.view', 'PRC.po.approve'], system: false });
seed(r + '/roles/role_old_ack', { name: 'Procurement Officer', permissions: ['PRC.view', 'PRC.req.acknowledge'], system: false });
seed(r + '/roles/role_old_viewer', { name: 'Procurement Viewer', permissions: ['PRC.view', 'PRC.journal.view'], system: false });
seed(r + '/positions/ROL_000001', { title: 'Procurement manager', securityRoles: ['role_old_approver'] });
seed(r + '/positions/ROL_000002', { title: 'Mixed desk', securityRoles: ['role_old_approver', 'role_old_ack'] });
seed('users/USER_A_0001', { orgId: org, status: 'active', email: 'a@x.test', role: 'role_old_viewer' });
const ctx = (body, role = 'org_super_admin') => ({ uid: 'ADMIN_01', orgId: org, role, org: snapshot(r), me: { id: 'ADMIN_01', data: {} }, permissions: ['*'], directPermissions: ['*'], grants: [], actor: { uid: 'ADMIN_01', email: 'a@x.test', role, orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: 'a@x.test' } });
const call = (path, body = {}, role) => levelRoleRoutes['POST ' + path][0](ctx(body, role));

const list = await call('/api/org/roles/levels');
assert.ok(list.levels.some((l) => l.id === 'lvl_prc_manager' && l.available && !l.installed));
const inst = await call('/api/org/roles/levels/install', { ids: ['lvl_prc_viewer', 'lvl_prc_manager', 'lvl_prc_buyer'] });
assert.deepEqual(inst.created.sort(), ['Procurement Buyer', 'Procurement Manager', 'Procurement Viewer']);
assert.equal(snapshot(r + '/roles/role_old_viewer').data.name, 'Procurement Viewer (previous)', 'a clashing older role is renamed, not overwritten');
assert.deepEqual(snapshot(r + '/roles/role_old_viewer').data.permissions, ['PRC.view', 'PRC.journal.view']);
assert.ok(snapshot(r + '/role_docs/lvl_prc_manager').data.never.length > 10, 'level rules are written');
assert.equal((await call('/api/org/roles/levels/install', { ids: ['lvl_prc_manager'] })).skipped[0].reason, 'Already installed.');

const plan = await call('/api/org/roles/levels');
assert.equal(plan.existing.find((e) => e.id === 'role_old_approver').target.id, 'lvl_prc_manager');
assert.equal(plan.existing.find((e) => e.id === 'role_old_viewer').target.id, 'lvl_prc_viewer');
await assert.rejects(() => call('/api/org/roles/levels/consolidate', { moves: [{ from: 'role_old_viewer', to: 'lvl_prc_viewer' }], reason: 'Consolidating into standard level roles', confirmation: 'CONSOLIDATE' }, 'org_user'), /super admin/);
await assert.rejects(() => call('/api/org/roles/levels/consolidate', { moves: [{ from: 'role_old_viewer', to: 'lvl_prc_viewer' }], reason: 'too short', confirmation: 'CONSOLIDATE' }), /reason/);
await assert.rejects(() => call('/api/org/roles/levels/consolidate', { moves: [{ from: 'role_old_viewer', to: 'lvl_prc_viewer' }], reason: 'Consolidating into standard level roles', confirmation: 'yes' }), /CONSOLIDATE/);

const out = await call('/api/org/roles/levels/consolidate', {
    moves: [{ from: 'role_old_viewer', to: 'lvl_prc_viewer' }, { from: 'role_old_approver', to: 'lvl_prc_manager' }],
    reason: 'Consolidating into standard level roles', confirmation: 'CONSOLIDATE',
});
assert.deepEqual(out.done.map((d) => d.to), ['Procurement Viewer']);
assert.ok(out.skipped.some((s) => s.id === 'role_old_approver' && /ROL_000002/.test(s.reason)), 'a move that would put approve and acknowledge on one job role is refused');
assert.equal(snapshot('users/USER_A_0001').data.role, 'lvl_prc_viewer');
assert.ok(!(await listDocs(r + '/roles')).some((d) => d.id === 'role_old_viewer'), 'the older role is removed');
assert.deepEqual(snapshot(r + '/positions/ROL_000001').data.securityRoles, ['role_old_approver'], 'refused moves change nothing');
console.log('level roles scenario passed: install with rules, rename on clash, suggestion, super-admin consolidation, SoD refusal');
