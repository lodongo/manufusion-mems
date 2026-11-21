import assert from 'node:assert/strict';
import test from 'node:test';
import {
    COST_CENTER_CATEGORIES, costCenterCategoryLabel,
    costCenterSubcategories, costCenterSubcategoryLabel,
    selectedCostCenterSubcategories, costCenterSubcategoriesLabel,
    validateCostCenterSubcategorySelection, validateEquipmentCostCenterSubcategory,
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

test('multiple selections are accepted in the same category and preserved in order', () => {
    const available = costCenterSubcategories('MFG');
    const codes = [available[0].code, available[3].code, available[8].code];
    assert.deepEqual(validateCostCenterSubcategorySelection('MFG', codes, codes[0], true), codes);
    const attributes = { costType: 'MFG', costSubcategory: codes[0], costSubcategories: codes };
    assert.deepEqual(selectedCostCenterSubcategories(attributes), codes);
    assert.equal(costCenterSubcategoriesLabel('MFG', attributes),
        codes.map((code) => costCenterSubcategoryLabel('MFG', code)).join(' · '));
    assert.equal(isManufacturingCostType(attributes.costType, []), true);
});

test('singular legacy records remain readable and can be migrated without changing type', () => {
    const subcategory = costCenterSubcategories('INV')[0].code;
    assert.deepEqual(selectedCostCenterSubcategories({ costSubcategory: subcategory }), [subcategory]);
    assert.deepEqual(validateCostCenterSubcategorySelection('INV', undefined, subcategory, false), [subcategory]);
    assert.deepEqual(validateCostCenterSubcategorySelection('INV', [], subcategory, false), []);
    assert.deepEqual(validateCostCenterSubcategorySelection('INV', undefined, '', false), []);
});

test('the API rejects duplicate, mismatched and malformed subcategory selections', () => {
    const manufacturing = costCenterSubcategories('MFG')[0].code;
    const inventory = costCenterSubcategories('INV')[0].code;
    assert.throws(() => validateCostCenterSubcategorySelection('MFG', [manufacturing, manufacturing], '', true), /once/);
    assert.throws(() => validateCostCenterSubcategorySelection('MFG', [manufacturing, inventory], '', true), /belong/);
    assert.throws(() => validateCostCenterSubcategorySelection('MFG', manufacturing, '', true), /list/);
    assert.throws(() => validateCostCenterSubcategorySelection('MFG', [12], '', true), /valid/);
    assert.throws(() => validateCostCenterSubcategorySelection('MFG', [], '', true), /at least one/);
});

test('every inventory and warehousing subcategory retains its category-level operational permission', () => {
    for (const code of ['INV', 'WHS']) {
        const subcategoryCodes = costCenterSubcategories(code).slice(0, 3).map((item) => item.code);
        assert.equal(validateCostCenterSubcategorySelection(code, subcategoryCodes, subcategoryCodes[0], true).length, 3);
        assert.equal(isManufacturingCostType(code, []), false);
    }
});

test('equipment unit selects exactly one of the parent cost center activities', () => {
    const production = costCenterSubcategories('MFG');
    const parent = { costSubcategories: [production[3].code, production[14].code] };
    assert.equal(validateEquipmentCostCenterSubcategory(parent, production[14].code, true),
        production[14].code);
    assert.equal(validateEquipmentCostCenterSubcategory(
        { costSubcategory: production[3].code }, production[3].code, true,
    ), production[3].code, 'Legacy single-selection parent is supported');
    assert.throws(() => validateEquipmentCostCenterSubcategory(parent, production[2].code, true),
        /must be one of/);
    assert.throws(() => validateEquipmentCostCenterSubcategory(parent,
        costCenterSubcategories('INV')[0].code, true), /must be one of/);
    assert.throws(() => validateEquipmentCostCenterSubcategory(parent, '', true), /Choose an equipment/);
    assert.throws(() => validateEquipmentCostCenterSubcategory(parent, [production[3].code], true),
        /Choose an equipment/);
});

test('unclassified legacy parent cannot receive new equipment and legacy edits remain possible', () => {
    assert.throws(() => validateEquipmentCostCenterSubcategory({}, '', true),
        /Configure at least one/);
    assert.equal(validateEquipmentCostCenterSubcategory({}, '', false), '');
    assert.throws(() => validateEquipmentCostCenterSubcategory({}, 'MFG-004', false),
        /no assigned subcategories/);
});
