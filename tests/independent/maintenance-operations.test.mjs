import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('maintenance handlers execute the conveyor workflow and reject unauthorized or premature transitions', () => {
    const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/maintenance-scenario.mjs'],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /maintenance scenario passed/);
});
