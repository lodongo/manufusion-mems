import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { LEVEL_ROLES, suggestLevel } from '../../backend/levelRoles.ts';
import { ALL_BUILT_KEYS, sodConflicts } from '../../backend/permissionPolicy.ts';

test('every module has a level ladder from Viewer to Administrator that keeps maker-checker', () => {
    const modules = new Map();
    for (const r of LEVEL_ROLES) modules.set(r.module, [...(modules.get(r.module) ?? []), r]);
    for (const m of ['ADM', 'PRC', 'MNT', 'INV', 'WHS', 'AST', 'SAF', 'FIN', 'HRM', 'DOC']) assert.ok(modules.has(m), m + ' has levels');
    for (const [m, list] of modules) {
        const names = list.sort((a, b) => a.rank - b.rank).map((r) => r.level);
        if (m !== 'DOC') assert.equal(names[0], 'Viewer', m + ' starts with Viewer');
        assert.equal(names[names.length - 1], 'Administrator', m + ' ends with Administrator');
    }
    assert.deepEqual(modules.get('PRC').map((r) => r.level), ['Viewer', 'Buyer', 'Specialist', 'Manager', 'Administrator']);
    assert.deepEqual(modules.get('MNT').map((r) => r.level), ['Viewer', 'Clerk', 'Artisan', 'Specialist', 'Planner', 'Supervisor', 'Manager', 'Administrator']);
    for (const r of LEVEL_ROLES) {
        assert.equal(sodConflicts(r.permissions).length, 0, r.name + ' keeps duties apart');
        assert.ok(r.permissions.every((k) => ALL_BUILT_KEYS.has(k)), r.name + ' only real rights');
        assert.match(r.id, /^lvl_[a-z]{3}_[a-z_]+$/);
    }
    assert.equal(new Set(LEVEL_ROLES.map((r) => r.id)).size, LEVEL_ROLES.length);
    const by = (n) => LEVEL_ROLES.find((r) => r.name === n).permissions;
    assert.ok(by('Procurement Buyer').includes('PRC.po.manage') && !by('Procurement Buyer').includes('PRC.po.approve'));
    assert.ok(by('Procurement Manager').includes('PRC.po.approve') && !by('Procurement Manager').includes('PRC.po.manage'));
    assert.ok(!by('Procurement Administrator').includes('PRC.po.approve'), 'limits setter never approves against them');
    assert.ok(by('Maintenance Planner').includes('MNT.WO.plan') && !by('Maintenance Planner').includes('MNT.WO.release'));
    assert.ok(by('Maintenance Supervisor').includes('MNT.WO.release') && !by('Maintenance Supervisor').includes('MNT.WO.plan'));
});

test('older roles are matched to the lowest level of their module that covers them', () => {
    const s = suggestLevel(['PRC.view', 'PRC.po.view', 'PRC.po.approve'], LEVEL_ROLES);
    assert.equal(s.target.name, 'Procurement Manager');
    assert.deepEqual(s.lost, []);
    const t = suggestLevel(['MNT.view', 'MNT.WO.execute'], LEVEL_ROLES);
    assert.equal(t.target.name, 'Maintenance Artisan');
});

test('level roles install with their rules and consolidation never merges duties that must stay apart', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/level-roles-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /level roles scenario passed/);
});

test('employee numbers follow registration order and are unique', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/helpers/maintenance-register.mjs', './tests/helpers/hr-employee-number-scenario.mjs'], { cwd: process.cwd(), encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /employee number scenario passed/);
});

test('users are added only in HR, with an employee number', () => {
    const org = readFileSync('backend/org.ts', 'utf8');
    assert.doesNotMatch(org, /'POST \/api\/org\/users\/create'/);
    const hr = readFileSync('backend/hrEmployeeAdmin.ts', 'utf8');
    assert.match(hr, /orgRoute\('hr\.employees\.create', 'HRM\.employees\.manage'/);
    assert.match(hr, /EMP_\$\{String\(n\)\.padStart\(5, '0'\)\}/);
    assert.match(hr, /exists: false/);
});
