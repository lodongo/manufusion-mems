import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLN_SUBMODULES, plnPhaseOfPath, plnPathOfPhase } from '../../src/org/plnSubmodules.ts';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('Production Planning & MRP lists its stages of work as submodules, in set-up order', () => {
    assert.deepEqual(PLN_SUBMODULES.map((s) => s.label), ['Foundation', 'Master data', 'Capacity & process', 'Planning', 'Reference']);
    assert.deepEqual(PLN_SUBMODULES.map((s) => s.phase), ['foundation', 'masters', 'capacity', 'planning', 'guide']);
    assert.equal(new Set(PLN_SUBMODULES.map((s) => s.path)).size, PLN_SUBMODULES.length, 'every submodule has its own path');
    for (const s of PLN_SUBMODULES) assert.match(s.path, /^[a-z_]+$/, 'a path the shortcuts API accepts');
    assert.equal(PLN_SUBMODULES[0].path, 'pln_foundation', 'the old path keeps working for favourites and links');
    assert.equal(plnPhaseOfPath('pln_masters'), 'masters');
    assert.equal(plnPhaseOfPath('mfg_foundation'), undefined);
    assert.equal(plnPathOfPhase('planning'), 'pln_planning');
});

test('each submodule opens only for people who can use at least one of its screens', () => {
    const by = Object.fromEntries(PLN_SUBMODULES.map((s) => [s.phase, s.anyPermission]));
    assert.deepEqual(by.masters, ['MFG.view']);
    assert.deepEqual(by.capacity, ['MFG.view']);
    assert.deepEqual(by.planning, ['PLN.view']);
    assert.deepEqual(by.guide, ['PLN.view']);
    assert.ok(by.foundation.includes('MFG.view') && by.foundation.includes('PLN.view'), 'Foundation holds both manufacturing policies and planning form defaults');
});

test('the side menu and routing use the submodules; the module overview is the list of them', () => {
    const home = read('src/org/OrgHomePage.tsx');
    assert.ok(home.includes('PLN: PLN_SUBMODULES.map('));
    assert.ok(home.includes('link.anyPermission.some('), 'a submodule opens on any of its permissions');
    assert.ok(home.includes("activeMenu?.module.code==='PLN' && plnPhaseOfPath(section)") && home.includes("phase={plnPhaseOfPath(section)}"));
    assert.ok(!home.includes("(section==='module'&&activeModule?.module.code==='PLN')"), 'the module overview lists the submodules rather than opening one screen');
    assert.ok(home.includes("link.hint &&"), 'each overview tile says what its submodule is for');
});

test('a submodule shows only its own screens, keeps the set-up order and can move to another submodule', () => {
    const ui = read('src/org/ProductionFoundation.tsx');
    assert.ok(ui.includes('permitted(t)&&(!phase||t.phase===phase)'));
    assert.ok(ui.includes('{(!phase||visibleTabs.length>1)&&<nav aria-label=\'Production configuration menu\''), 'no tab row for a submodule with one screen');
    assert.ok(ui.includes('{!phase&&<button type=\'button\' aria-haspopup=\'menu\''), 'the all-stages menu is only for the whole module');
    assert.ok(ui.includes('const activeLocked=enforceSetup&&!loading&&prerequisiteNames(active).length>0'), 'opening a stage whose earlier steps are not saved is blocked');
    assert.ok(ui.includes('{activeLocked?null:'), 'a locked stage shows no screens');
    assert.ok(ui.includes("navigate('organization_home/'+plnPathOfPhase(target.phase))") && ui.includes('pendingTab={tab,phase:target.phase}'));
    assert.ok(ui.includes("if(!permitted(target)){setError('You do not have access to '"), 'moving to another submodule respects permissions');
    // The module as a whole (admin shell, MFG) is unchanged.
    assert.ok(read('src/org/OrgShell.tsx').includes("<ProductionFoundation module='PLN' permissions={data.permissions} />"));
});

test('records and workflow links open Planning, where their screens are', () => {
    for (const f of ['backend/workflowAdapters.ts', 'backend/recordSearch.ts']) {
        const src = read(f);
        assert.ok(!/link: 'pln_foundation'/.test(src), `${f} no longer points at Foundation`);
        assert.ok(src.includes("link: 'pln_planning'"), f);
    }
});
