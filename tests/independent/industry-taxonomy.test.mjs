import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRY_CATEGORIES, INDUSTRY_SUBCATEGORIES, INDUSTRY_TAXONOMY_VERSION } from '../../backend/industryCatalog.ts';

test('industry master covers every ISIC Revision 5 economic activity section', () => {
    assert.equal(INDUSTRY_TAXONOMY_VERSION, 'MEMS-IND-1.0');
    assert.equal(INDUSTRY_CATEGORIES.length, 22);
    assert.deepEqual(INDUSTRY_CATEGORIES.map((c) => c.isicSection), 'ABCDEFGHIJKLMNOPQRSTUV'.split(''));
    assert.ok(INDUSTRY_SUBCATEGORIES.length >= 400, 'Expected a broad specialist industry catalogue');
});

test('every industry subcategory has one stable, valid, enabled parent category', () => {
    const categories = new Set(INDUSTRY_CATEGORIES.map((c) => c.code));
    const codes = new Set();
    for (const i of INDUSTRY_SUBCATEGORIES) {
        assert.match(i.code, /^IND-[A-V]-[0-9]{3}$/);
        assert.ok(categories.has(i.categoryCode), i.code + ': parent missing');
        assert.equal(i.code.startsWith(i.categoryCode + '-'), true, i.code + ': mismatched parent');
        assert.ok(i.label.trim().length > 3 && i.label.length <= 120, i.code + ': invalid label');
        assert.equal(i.active, true);
        assert.ok(!codes.has(i.code), i.code + ': duplicate code');
        codes.add(i.code);
    }
});

test('specialized industries include manufacturing, digital tech, finance, education and healthcare', () => {
    for (const term of ['Beverage bottling', 'Battery', 'Artificial intelligence', 'Mobile money', 'Universities', 'Diagnostics', 'Logistics', 'Solar power']) {
        assert.ok(INDUSTRY_SUBCATEGORIES.some((i) => i.label.toLowerCase().includes(term.toLowerCase())), term + ': missing industry');
    }
});
