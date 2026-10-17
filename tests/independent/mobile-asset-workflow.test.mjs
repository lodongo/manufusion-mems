import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

test('search is optional in both global and shared mobile dropdown sheets', () => {
    for (const p of ['src/components/SearchableSelect.tsx', 'src/components/GlobalSelectEnhancer.tsx']) {
        const contents = source(p);
        assert.ok(contents.includes('searchVisible'), p);
        assert.ok(contents.includes('Search (optional)'), p);
        assert.ok(!contents.includes('autoFocus'), p + ' must not summon phone keyboard');
    }
});

test('equipment form submits selected eligible asset to backend for one-to-one mapping', () => {
    const org = source('src/org/StructurePage.tsx');
    assert.match(org, /existingAssetTag/);
    assert.match(org, /level === 'work_center' \? \{ existingAssetTag \}/);
    assert.match(org, /equipmentCategory/);
    assert.match(org, /equipmentSubcategory/);
});

test('technical attributes are only opened and edited from Asset Management', () => {
    const mapping = source('src/org/WorkCenterAsset.tsx');
    assert.ok(!mapping.includes('<AssetForm'));
    assert.ok(!mapping.includes('<AssetDetail'));
    assert.ok(mapping.includes("navigate('organization_admin/assets/new')"));
    assert.ok(mapping.includes('organization_admin/assets/${a.tag}'));
    assert.ok(mapping.includes('mems.assetCreationEquipment'));
});

test('equipment classification includes server-derived category, subcategory and immutable linked class', () => {
    const backend = source('backend/structure.ts');
    assert.ok(backend.includes('attributes.equipmentCategory = unitClass.categoryCode'));
    assert.ok(backend.includes('attributes.equipmentSubcategory = unitClass.subcategoryCode'));
    assert.ok(backend.includes('previousTag && newClass !=='));
    assert.ok(!backend.includes('if (createClass) await createUnitAsset'));
});
