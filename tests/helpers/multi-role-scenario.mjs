import assert from 'node:assert/strict';
import { seed, snapshot } from './maintenance-fixture.ts';
import { orgRoutes, cleanAdditionalRoles } from '../../backend/org.ts';
import { effectiveAccess, additionalRoleIds } from '../../backend/guards.ts?actual';

const org = 'multi_fixture', r = 'organizations/' + org;
seed(r, { status: 'active', modules: { AST: true, PRC: true } });
seed(r + '/roles/org_super_admin', { name: 'Organization super admin', permissions: ['*'], system: true });
seed(r + '/roles/org_user', { name: 'MEMS Standard User', permissions: [], system: true });
seed(r + '/roles/lvl_ast_clerk', { name: 'Asset Clerk', permissions: ['AST.view', 'AST.create', 'AST.edit'] });
seed(r + '/roles/lvl_doc_author', { name: 'Document Author', permissions: ['ADM.document_registry', 'ADM.document_publish'] });
seed(r + '/roles/vendor_clerk', { name: 'Vendor Clerk', permissions: ['PRC.view', 'PRC.vendors.manage'] });
seed(r + '/roles/vendor_approver', { name: 'Vendor Approver', permissions: ['PRC.view', 'PRC.vendors.approve'] });
seed('users/USERART001', { orgId: org, status: 'active', email: 'art@x.test', role: 'org_user', additionalRoles: ['lvl_ast_clerk', 'lvl_doc_author', 'org_super_admin', 'nope!'] });
const ctx = (body, role = 'org_super_admin', direct = ['*']) => ({ uid: 'ADMIN_01', orgId: org, role, org: snapshot(r), me: { id: 'ADMIN_01', data: {} }, permissions: direct, directPermissions: direct, grants: [], actor: { uid: 'ADMIN_01', email: 'a@x.test', role, orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: 'a@x.test' }, domain: 'x.test' });

// Rights add up across direct roles; system roles and junk are never additional roles.
const user = snapshot('users/USERART001');
assert.deepEqual(additionalRoleIds(user), ['lvl_ast_clerk', 'lvl_doc_author']);
const access = await effectiveAccess(org, 'org_user', user);
for (const p of ['AST.create', 'ADM.document_registry', 'ADM.document_publish']) assert.ok(access.directPermissions.includes(p), p);
assert.match(access.roleName, /Asset Clerk/);

// Live check: no conflict for Asset Clerk + Document Author; a conflict for Vendor Clerk + Vendor Approver.
const check = (body, c = ctx(body)) => orgRoutes['POST /api/org/users/access-check'][0](c);
const ok = await check({ uid: 'USERART001', role: 'org_user', additionalRoles: ['lvl_ast_clerk', 'lvl_doc_author'] });
assert.equal(ok.conflicts.length, 0);
assert.ok(ok.permissions >= 5);
const bad = await check({ role: 'vendor_clerk', additionalRoles: ['vendor_approver'] });
assert.equal(bad.conflicts[0].id, 'vendor-create-approve');
assert.deepEqual(bad.conflicts[0].fromA, ['Vendor Clerk']);
assert.deepEqual(bad.conflicts[0].fromB, ['Vendor Approver']);

// Validation on save.
const c = ctx({});
assert.deepEqual((await cleanAdditionalRoles(c, 'org_user', ['lvl_ast_clerk', 'lvl_doc_author', 'lvl_ast_clerk'], [])).list, ['lvl_ast_clerk', 'lvl_doc_author']);
await assert.rejects(() => cleanAdditionalRoles(c, 'org_user', ['org_super_admin'], []), /from the list/);
await assert.rejects(() => cleanAdditionalRoles(c, 'org_user', ['missing_role'], []), /from the list/);
await assert.rejects(() => cleanAdditionalRoles(c, 'org_user', Array.from({ length: 13 }, (_, i) => 'r' + i), []), /up to 12/);
assert.deepEqual((await cleanAdditionalRoles(c, 'org_super_admin', ['lvl_ast_clerk'], ['lvl_doc_author'])).list, []);
const limited = ctx({}, 'org_user', ['AST.view', 'AST.create', 'AST.edit']);
assert.deepEqual((await cleanAdditionalRoles(limited, 'org_user', ['lvl_ast_clerk'], [])).added, ['lvl_ast_clerk']);
await assert.rejects(() => cleanAdditionalRoles(limited, 'org_user', ['lvl_doc_author'], []), /do not hold yourself/);
await assert.rejects(() => cleanAdditionalRoles(limited, 'org_user', [], ['lvl_doc_author']), /cannot remove/);
console.log('multi role scenario passed: rights add up, live conflicts with sources, validation and grant limits');
