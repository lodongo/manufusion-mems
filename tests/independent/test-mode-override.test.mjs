import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('platform testing override is fail-closed, scoped, expiring and only relaxes identity controls', () => {
    const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/test-mode-scenario.mjs'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 60000, env: { ...process.env, MEMS_ENVIRONMENT: '', MEMS_ALLOW_LIVE_DATA: '' } },
    );
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /test mode scenario passed/);
});

test('only the development deployment can host test mode, and every relaxed control is audited', () => {
    const dev = readFileSync('.github/workflows/deploy-development.yml', 'utf8');
    const prod = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
    assert.match(dev, /MEMS_ENVIRONMENT=development/);
    assert.doesNotMatch(prod, /MEMS_ENVIRONMENT/);
    const guards = readFileSync('backend/guards.ts', 'utf8');
    assert.match(guards, /role === 'org_super_admin' && await testModeActiveFor\(orgId\)/);
    assert.match(guards, /testmode\.controls_bypassed/);
    const routes = readFileSync('backend/testMode.ts', 'utf8');
    assert.match(routes, /staff\('admin\.security\.testing_override\.save', 'super'/);
    assert.match(routes, /TEST_MODE_PHRASE/);
    assert.match(routes, /testmode\.enabled/);
});
