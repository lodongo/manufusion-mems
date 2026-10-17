import test from 'node:test';
import assert from 'node:assert/strict';
import {
    identicalAssetEquipmentClass, assetIsAssignable, unitIsAssignable,
} from '../../backend/assetEquipmentRules.ts';

const filler = { classCode: 'AST-C-01-0001', categoryCode: 'AST-C', subcategoryCode: 'AST-C-01' };

test('eligible links require exact category, subcategory and class', () => {
    assert.equal(identicalAssetEquipmentClass(filler, { ...filler }), true);
    assert.equal(identicalAssetEquipmentClass(filler, { ...filler, categoryCode: 'AST-D' }), false);
    assert.equal(identicalAssetEquipmentClass(filler, { ...filler, subcategoryCode: 'AST-C-99' }), false);
    assert.equal(identicalAssetEquipmentClass(filler, { ...filler, classCode: 'AST-C-01-0002' }), false);
    assert.equal(identicalAssetEquipmentClass({ ...filler, classCode: '' }, filler), false);
});

test('asset may never be assigned to a second equipment unit', () => {
    assert.equal(assetIsAssignable({ status: 'active', workCenterId: '' }), true);
    assert.equal(assetIsAssignable({ status: 'draft', workCenterId: '' }), true);
    assert.equal(assetIsAssignable({ status: 'active', workCenterId: 'EQ1' }, 'EQ2'), false);
    assert.equal(assetIsAssignable({ status: 'active', workCenterId: 'EQ1' }, 'EQ1'), true);
    assert.equal(assetIsAssignable({ status: 'disposed', workCenterId: '' }), false);
    assert.equal(assetIsAssignable({ status: 'rejected', workCenterId: '' }), false);
    assert.equal(assetIsAssignable({ status: 'disposal_pending', workCenterId: '' }), false);
});

test('equipment may never be linked to a second asset', () => {
    assert.equal(unitIsAssignable({}), true);
    assert.equal(unitIsAssignable({ assetTag: '' }), true);
    assert.equal(unitIsAssignable({ assetTag: 'AST-000001' }), false);
    assert.equal(unitIsAssignable({ assetTag: 'AST-000001' }, 'AST-000002'), false);
    assert.equal(unitIsAssignable({ assetTag: 'AST-000001' }, 'AST-000001'), true);
});
