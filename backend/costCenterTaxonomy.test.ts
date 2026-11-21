import assert from 'node:assert/strict';
import test from 'node:test';
import {
    COST_CENTER_CATEGORIES, costCenterCategoryLabel,
    costCenterSubcategories, costCenterSubcategoryLabel,
} from '../src/shared/costCenterTaxonomy';
import { isManufacturingCostType } from './plnCostCenterCapacity';

test('legacy financial categories and operational routing codes remain stable', () => {
    const codes = COST_CENTER_CATEGORIES.map((category) => category.code);
    for (const code of ['MFG', 'INV', 'WHS', 'FIN', 'MNT', 'UTL', 'PRC', 'LOG']) {
        assert.ok(codes.includes(code), 'Lost legacy category ' + code);
    }
    assert.equal(new Set(codes).size, codes.length, 'Category codes must be unique');
    assert.equal(costCenterCategoryLabel('MFG'), 'Manufacturing');
    assert.equal(costCenterCategoryLabel('INV'), 'Inventory');
    assert.equal(isManufacturingCostType('MFG', []), true);
    assert.equal(isManufacturingCostType('INV', []), false);
    assert.equal(isManufacturingCostType('WHS', []), false);
});

test('every category has unique, nonempty and category-bound subcategories', () => {
    assert.ok(COST_CENTER_CATEGORIES.length >= 22);
    let subcategoryCount = 0;
    for (const category of COST_CENTER_CATEGORIES) {
        assert.ok(category.subcategories.length >= 5, category.code);
        const codes = category.subcategories.map((subcategory) => subcategory.code);
        assert.equal(codes.length, new Set(codes).size, category.code);
        for (const subcategory of category.subcategories) {
            assert.ok(subcategory.label.length > 3);
            assert.ok(subcategory.code.startsWith(category.code + '-'));
            assert.equal(costCenterSubcategoryLabel(category.code, subcategory.code), subcategory.label);
            assert.ok(costCenterSubcategories(category.code).some((item) => item.code === subcategory.code));
            subcategoryCount++;
        }
    }
    assert.ok(subcategoryCount >= 300);
});

test('manufacturing stages and inventory control areas remain separately classified', () => {
    const manufacturing = costCenterSubcategories('MFG').map((subcategory) => subcategory.label);
    const inventory = costCenterSubcategories('INV').map((subcategory) => subcategory.label);
    for (const value of ['Simple syrup manufacturing', 'Filling and dispensing', 'Palletizing and stretch wrapping'])
        assert.ok(manufacturing.includes(value));
    for (const value of ['Raw material inventory', 'Maintenance spare parts inventory', 'Finished goods inventory'])
        assert.ok(inventory.includes(value));
    assert.ok(!inventory.includes('Simple syrup manufacturing'));
});

test('custom legacy category codes still have a safe general subcategory', () => {
    assert.deepEqual(costCenterSubcategories('CUS'), [{ code: 'GENERAL', label: 'General / other' }]);
});
