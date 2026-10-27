import test from 'node:test';
import assert from 'node:assert/strict';
import { INDUSTRY_CATEGORIES, INDUSTRY_SUBCATEGORIES, INDUSTRY_TAXONOMY_VERSION, INDUSTRY_DIVISIONS, INDUSTRY_GROUPS, INDUSTRY_CLASSES, industryAdoptionRecommendation, industrySectionOf, recommendProcurementCategories } from '../../backend/industryCatalog.ts';

test('industry master covers every ISIC Revision 5 economic activity section', () => {
    assert.equal(INDUSTRY_TAXONOMY_VERSION, 'MEMS-IND-2.0');
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
        assert.ok(i.label.trim().length > 3 && i.label.length <= 300, i.code + ': invalid label');
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

test('UN ISIC Rev.5 full hierarchy, with original specialist registration codes preserved',()=>{
 assert.equal(INDUSTRY_DIVISIONS.length,87);assert.equal(INDUSTRY_GROUPS.length,258);assert.equal(INDUSTRY_CLASSES.length,463);
 assert.ok(INDUSTRY_SUBCATEGORIES.some(i=>i.code==='IND-C-001'));
 assert.ok(INDUSTRY_SUBCATEGORIES.some(i=>i.isicClass==='1105'));
 assert.equal(industrySectionOf('ISIC5-1105'),'IND-C');
 assert.equal(industrySectionOf('IND-C-001'),'IND-C');
});
test('Industry-specific catalogue entry is off by default for unmatched registered activity, but still adoptable',()=>{
 const entry={industryScope:'INDUSTRY_SPECIFIC',industryCodes:['IND-R']};
 const unmatched=industryAdoptionRecommendation(entry,'IND-C-001');
 assert.equal(unmatched.enabledByDefault,false);
 assert.equal(unmatched.availableForManualAdoption,true);
 assert.equal(industryAdoptionRecommendation(entry,'IND-R-001').enabledByDefault,true);
 assert.equal(industryAdoptionRecommendation({industryScope:'COMMON',industryCodes:[]},'IND-C-001').enabledByDefault,true);
});

test('procurement category recommendation keeps unrelated sectors visible for manual adoption',()=>{
 const categories=[{code:'SERV',name:'Professional services',subcategories:[
  {code:'SERV-LAB',name:'Laboratory services'},
  {code:'SERV-COM',name:'Common maintenance'}]}];
 const items=[
  {categoryCode:'SERV',subcategoryCode:'SERV-LAB',industryScope:'INDUSTRY_SPECIFIC',industryCodes:['IND-N']},
  {categoryCode:'SERV',subcategoryCode:'SERV-COM',industryScope:'COMMON',industryCodes:[]}];
 const result=recommendProcurementCategories(categories,items,'IND-C-001');
 assert.equal(result.length,1);
 assert.equal(result[0].recommended,true);
 assert.equal(result[0].subcategories[0].recommended,false);
 assert.equal(result[0].subcategories[1].recommended,true);
 assert.equal(result[0].subcategories[0].totalItems,1);
 assert.equal(result[0].subcategories[0].industryMatchedItems,0);
 assert.equal(recommendProcurementCategories(categories,items,'IND-N-001')[0].subcategories[0].recommended,true);
 assert.deepEqual(categories[0].subcategories,[{code:'SERV-LAB',name:'Laboratory services'},{code:'SERV-COM',name:'Common maintenance'}]);
});

test('existing procurement adoption controls never automatically erase a saved selection',async()=>{
 const fs=await import('node:fs');
 const view=fs.readFileSync('src/org/ProcurementSetup.tsx','utf8');
 assert.match(view,/Add recommended/);
 assert.match(view,/setSel\(cur =>/);
 assert.match(view,/Show all available/);
 const finance=fs.readFileSync('src/org/FinEntityAccounts.tsx','utf8');
 assert.match(finance,/Add recommended/);
 assert.match(finance,/Array\.from\(new Set\(\[\.\.\.current/);
});
