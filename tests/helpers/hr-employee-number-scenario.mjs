import assert from 'node:assert/strict';
import { seed, snapshot, listDocs } from './maintenance-fixture.ts';
import { hrEmployeeAdminRoutes, EMP_RE } from '../../backend/hrEmployeeAdmin.ts';

const org = 'emp_fixture';
seed('organizations/' + org, { status: 'active', modules: { HRM: true } });
const people = [
    ['U_LATE_00001', '2026-05-01T08:00:00Z', ''],
    ['U_FIRST_0001', '2026-01-01T08:00:00Z', ''],
    ['U_MID_000001', '2026-03-01T08:00:00Z', 'HR-17'],
    ['U_HAS_000001', '2026-02-01T08:00:00Z', 'EMP_00002'],
    ['U_APPLICANT1', '2025-12-01T08:00:00Z', ''],
];
for (const [uid, createdAt, employeeNumber] of people)
    seed('users/' + uid, { orgId: org, status: 'active', email: uid.toLowerCase() + '@x.test', firstName: uid, lastName: 'T', createdAt, employeeNumber, role: uid === 'U_APPLICANT1' ? 'applicant' : 'org_user' });
seed('users/OTHER_ORG_01', { orgId: 'another', status: 'active', email: 'o@y.test', createdAt: '2020-01-01T00:00:00Z', role: 'org_user' });
const ctx = (body) => ({ uid: 'ADMIN_01', orgId: org, role: 'org_super_admin', org: snapshot('organizations/' + org), me: { id: 'ADMIN_01', data: {} }, permissions: ['*'], directPermissions: ['*'], grants: [], actor: { uid: 'ADMIN_01', email: 'a@x.test', role: 'org_super_admin', orgId: org }, meta: { ip: 't', userAgent: 't' }, body, claims: { email: 'a@x.test' } });
const call = (path, body = {}) => hrEmployeeAdminRoutes['POST ' + path][0](ctx(body));

const before = await call('/api/org/hr/employees/numbers');
assert.equal(before.count, 3, 'applicants, other tenants and people with an EMP_ number are excluded');
assert.deepEqual(before.missing.map((m) => m.uid), ['U_FIRST_0001', 'U_MID_000001', 'U_LATE_00001'], 'oldest registration first');
await assert.rejects(() => call('/api/org/hr/employees/numbers/assign', { confirm: true, reason: 'short' }), /reason/);
await assert.rejects(() => call('/api/org/hr/employees/numbers/assign', { reason: 'Initial employee numbering' }), /Confirm/);
const r = await call('/api/org/hr/employees/numbers/assign', { confirm: true, reason: 'Initial employee numbering' });
assert.equal(r.assigned, 3);
const num = (uid) => snapshot('users/' + uid).data.employeeNumber;
assert.equal(num('U_FIRST_0001'), 'EMP_00001');
assert.equal(num('U_MID_000001'), 'EMP_00003', 'EMP_00002 is already held, so it is skipped');
assert.equal(num('U_LATE_00001'), 'EMP_00004');
assert.equal(num('U_HAS_000001'), 'EMP_00002', 'an existing number never changes');
assert.equal(snapshot('users/U_MID_000001').data.legacyEmployeeNumber, 'HR-17', 'a non-standard number is kept as legacy');
assert.equal(num('U_APPLICANT1'), '');
assert.ok(EMP_RE.test(num('U_LATE_00001')));
const reserved = (await listDocs('organizations/' + org + '/employee_numbers')).map((d) => d.id).sort();
assert.deepEqual(reserved, ['EMP_00001', 'EMP_00003', 'EMP_00004'], 'every assigned number is reserved create-only');
const again = await call('/api/org/hr/employees/numbers/assign', { confirm: true, reason: 'Second run changes nothing' });
assert.equal(again.assigned, 0);
assert.equal((await call('/api/org/hr/employees/numbers')).count, 0);
await assert.rejects(() => call('/api/org/hr/employees/create', { emailLocal: 'x' }), /Confirm/);
console.log('employee number scenario passed: registration order, EMP_ format, uniqueness, existing kept, idempotent');
