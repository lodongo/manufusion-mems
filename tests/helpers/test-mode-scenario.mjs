import assert from 'node:assert/strict';
import { seed, snapshot } from './maintenance-fixture.ts';
import { TEST_MODE_DOC, bypass, clearTestModeCache, overrideActiveFor, readTestMode, testModeEnvironmentAllowed } from '../../backend/testModeCore.ts';
import { requireMaintenanceRole } from '../../backend/maintenanceAccess.ts';
import { approverCheck } from '../../backend/purchaseOrders.ts';

const org = 'test_mode_fixture';
const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();
const state = (over = {}) => ({ enabled: true, orgIds: [org], expiresAt: future, reason: 'Development end-to-end testing', enabledBy: 'S', enabledByEmail: 's@x', enabledAt: '', version: 1, ...over });

// ----- Environment gate: fail closed -----
delete process.env.MEMS_ENVIRONMENT;
delete process.env.MEMS_ALLOW_LIVE_DATA;
assert.equal(testModeEnvironmentAllowed(), false, 'no environment flag: test mode impossible');
assert.equal(overrideActiveFor(state(), org), false, 'a stored override has no effect outside development');
process.env.MEMS_ENVIRONMENT = 'production';
assert.equal(overrideActiveFor(state(), org), false);
process.env.MEMS_ENVIRONMENT = 'development';
assert.equal(overrideActiveFor(state(), org), true);
process.env.MEMS_ALLOW_LIVE_DATA = 'true';
assert.equal(overrideActiveFor(state(), org), false, 'live data flag disables test mode');
delete process.env.MEMS_ALLOW_LIVE_DATA;
assert.equal(overrideActiveFor(state({ expiresAt: past }), org), false, 'expired override is off');
assert.equal(overrideActiveFor(state({ enabled: false }), org), false);
assert.equal(overrideActiveFor(state({ orgIds: ['other_org'] }), org), false, 'only named tenants');
assert.equal(overrideActiveFor(state({ expiresAt: 'not-a-date' }), org), false);

seed(TEST_MODE_DOC, state());
clearTestModeCache();
assert.equal((await readTestMode()).enabled, true);

// ----- bypass(): only with ctx.testMode, records each rule once -----
const plain = { bypassed: [] };
assert.equal(bypass(plain, 'x.rule'), false);
assert.deepEqual(plain.bypassed, []);
const tm = { testMode: true, bypassed: [] };
assert.equal(bypass(tm, 'x.rule'), true);
assert.equal(bypass(tm, 'x.rule'), true);
assert.deepEqual(tm.bypassed, ['x.rule']);

// ----- Maintenance job-role gate: holding is relaxed, configuration is not -----
seed(`organizations/${org}/maintenance_workflow_settings/default`, { version: 3, approverRoles: { 'MNT.WO.TECHNICAL_CLOSE': 'TM' } });
seed('users/ADMIN_01', { orgId: org, status: 'active', assignments: [] });
const admin = (testMode) => ({ uid: 'ADMIN_01', orgId: org, role: 'org_super_admin', me: snapshot('users/ADMIN_01'), permissions: ['*'], directPermissions: ['*'], grants: [], testMode, bypassed: [] });
await assert.rejects(() => requireMaintenanceRole(admin(false), 'MNT.WO.TECHNICAL_CLOSE', ['SITE']), /job role TM is required at this location\. Organization super admins are not exempt/);
const relaxed = admin(true);
const gate = await requireMaintenanceRole(relaxed, 'MNT.WO.TECHNICAL_CLOSE', ['SITE']);
assert.equal(gate.role, 'TM');
assert.deepEqual(relaxed.bypassed, ['mnt.gate.MNT.WO.TECHNICAL_CLOSE']);
await assert.rejects(() => requireMaintenanceRole(admin(true), 'MNT.HANDOVER', ['SITE']), /Configure MNT.HANDOVER/, 'unconfigured gates still block');

// ----- PO chart of authority: identity checks relaxed, status checks kept -----
const po = { status: 'pending_approval', createdBy: 'ADMIN_01', approval: { steps: [{ level: 'L1', title: 'Manager', positionCode: 'MGR', positionTitle: 'Manager', status: 'pending', by: '' }] } };
assert.equal(approverCheck(admin(false), po).ok, false, 'preparer cannot approve without test mode');
const poCtx = admin(true);
const check = approverCheck(poCtx, po);
assert.equal(check.ok, true);
assert.equal(check.testMode, true);
assert.equal(approverCheck(admin(true), { ...po, status: 'open' }).ok, false, 'status is never relaxed');

console.log('test mode scenario passed: fail-closed environment gate, expiry, tenant scope, audited bypass, job-role gates and chart-of-authority identity checks');
