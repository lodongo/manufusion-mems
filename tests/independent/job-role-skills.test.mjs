import test from 'node:test';
import assert from 'node:assert/strict';
import { parentSkillSources, adoptSkillCodes } from '../../src/org/skillAdoption.ts';

const roles = [
    { code: 'ROL_000001', title: 'Plant Engineer', parentCode: '', coreSkills: ['SK_01','SK_02','SK_03'] },
    { code: 'ROL_000002', title: 'Reliability Engineer', parentCode: 'ROL_000001', coreSkills: ['SK_02','SK_04'] },
    { code: 'ROL_000003', title: 'Maintenance Planner', parentCode: 'ROL_000002', coreSkills: [] },
];

test('skills are fully optional and empty role lists remain empty', () => {
    assert.deepEqual(adoptSkillCodes([], [], new Set(['SK_01'])), []);
    assert.deepEqual(adoptSkillCodes(['SK_02'], [], new Set(['SK_02'])), ['SK_02']);
});

test('adopt skills from direct parent and higher reporting roles', () => {
    const sources = parentSkillSources('ROL_000002', roles, 'ROL_000003');
    assert.deepEqual(sources.map((p) => p.code), ['ROL_000002','ROL_000001']);
    const available = new Set(['SK_01','SK_02','SK_03','SK_04']);
    assert.deepEqual(adoptSkillCodes([], sources[0].coreSkills, available), ['SK_02','SK_04']);
    assert.deepEqual(adoptSkillCodes(['SK_02','SK_04'], sources[1].coreSkills, available), ['SK_02','SK_04','SK_01','SK_03']);
});

test('adoption skips duplicate, missing or disabled master skill codes without erasing saved skills', () => {
    const allowed = new Set(['SK_01','SK_02']);
    assert.deepEqual(adoptSkillCodes(['SK_02','LEGACY_01'], ['SK_02','SK_01','DISABLED_01','SK_01'], allowed),
        ['SK_02','LEGACY_01','SK_01']);
});

test('roles can adopt hundreds of unique enabled skills without 20-item cap', () => {
    const skills = Array.from({length: 600}, (_, i) => `HR_SK_${String(i + 1).padStart(4, '0')}`);
    assert.equal(adoptSkillCodes([], skills, new Set(skills)).length, 600);
    assert.equal(adoptSkillCodes(skills, skills, new Set(skills)).length, 600);
});

test('reporting lineage cannot loop, even for corrupt parent links', () => {
    const bad = [
        {code:'A',title:'A',parentCode:'B',coreSkills:[]},
        {code:'B',title:'B',parentCode:'A',coreSkills:[]},
    ];
    assert.deepEqual(parentSkillSources('A',bad,'').map((x)=>x.code), ['A','B']);
    assert.deepEqual(parentSkillSources('A',bad,'A'), []);
});
