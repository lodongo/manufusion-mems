import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
// Maintenance addendum acceptance tests: selection hierarchy, external services, procurement sync and readiness.
test('maintenance sourcing follows the warehouse → catalogue → free-text hierarchy and the procurement process', () => {
    const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/maintenance-sourcing-scenario.mjs'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 90000 },
    );
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /maintenance sourcing scenario passed/);
});
