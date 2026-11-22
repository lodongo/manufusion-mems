import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formDefaultsFor,DEFAULT_FORM_DEFAULTS} from '../../src/org/plnFormDefaults.ts';
import {normalizePlanningFormDefaults} from '../../backend/plnMfgFoundation.ts';
import {COST_CENTER_CATEGORIES,costCenterSubcategories,selectedCostCenterSubcategories} from '../../src/shared/costCenterTaxonomy.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('Resource form defaults now use the Finance cost-centre classification, not a generic resource class',()=>{
 assert.equal(DEFAULT_FORM_DEFAULTS.resourceCostCenterCategory,'MFG');
 assert.equal(DEFAULT_FORM_DEFAULTS.resourceCostCenterSubcategory,'');
 assert.equal(Object.hasOwn(DEFAULT_FORM_DEFAULTS,'resourceType'),false);
 assert.equal(Object.hasOwn(DEFAULT_FORM_DEFAULTS,'resourceRate'),false);
 assert.equal(Object.hasOwn(DEFAULT_FORM_DEFAULTS,'resourceEfficiency'),false);
 const source={resourceType:'LINE',resourceRate:5000,resourceEfficiency:85,
  routingAlternativeCode:'STANDARD',demandLeadDays:4};
 const migrated=formDefaultsFor(source);
 assert.equal(migrated.resourceCostCenterCategory,'MFG');
 assert.equal(migrated.resourceCostCenterSubcategory,'');
 assert.equal(migrated.demandLeadDays,4);
 for(const old of ['resourceType','resourceRate','resourceEfficiency'])
  assert.equal(Object.hasOwn(migrated,old),false);
 const backend=normalizePlanningFormDefaults(source);
 assert.equal(backend.resourceCostCenterCategory,'MFG');
 assert.equal(backend.resourceCostCenterSubcategory,'');
 for(const old of ['resourceType','resourceRate','resourceEfficiency'])
  assert.equal(Object.hasOwn(backend,old),false);
});

test('Category and subcategory defaults reference the existing cost-centre taxonomy',()=>{
 const category=COST_CENTER_CATEGORIES.find(c=>c.code==='MFG');
 assert.ok(category);
 assert.ok(category.subcategories.length>20);
 const sub=costCenterSubcategories('MFG').find(x=>/Water treatment/.test(x.label));
 assert.ok(sub);
 const defaults=normalizePlanningFormDefaults({
  resourceCostCenterCategory:'MFG',resourceCostCenterSubcategory:sub.code,
 });
 assert.equal(defaults.resourceCostCenterCategory,'MFG');
 assert.equal(defaults.resourceCostCenterSubcategory,sub.code);
 assert.throws(()=>normalizePlanningFormDefaults({
  resourceCostCenterCategory:'MFG',
  resourceCostCenterSubcategory:costCenterSubcategories('INV')[0].code,
 }),/subcategory belonging/);
 assert.deepEqual(selectedCostCenterSubcategories({
  costSubcategories:[sub.code,costCenterSubcategories('MFG')[0].code],
 }),[sub.code,costCenterSubcategories('MFG')[0].code]);
});

test('The UI cascades category and subcategory, with filters only in the Add resources flow',()=>{
 const panel=read('src/org/PlnFormDefaultsPanel.tsx');
 const resources=read('src/org/ManufacturingResources.tsx');
 const api=read('backend/plnManufacturingResources.ts');
 const entry=read('src/org/ProductionFoundation.tsx');
 const backend=read('backend/plnMfgFoundation.ts');
 assert.ok(panel.includes("'/api/org/reference/cost-center-types'"));
 assert.ok(panel.includes("title='Default cost-centre category'"));
 assert.ok(panel.includes("title='Default cost-centre subcategory'"));
 assert.ok(!panel.includes("Default resource class"));
 assert.ok(resources.includes("label='Cost-centre category'"));
 assert.ok(resources.includes("label='Cost-centre subcategory'"));
 assert.ok(resources.includes('x.costCenterSubcategories.includes(subcategory)'));
 assert.ok(resources.includes('const configured=all.filter(x=>x.resource?.active)'));
 assert.ok(api.includes('selectedCostCenterSubcategories'));
 assert.ok(api.includes('costCenterCategory:'));
 assert.ok(entry.includes('defaultCategory={formDefaults.resourceCostCenterCategory}'));
 assert.ok(entry.includes('defaultSubcategory={formDefaults.resourceCostCenterSubcategory}'));
 assert.ok(backend.includes('isManufacturingCostType(formDefaults.resourceCostCenterCategory'));
});

test('Existing cost centre, asset and SKU masters are not rewritten on saving defaults',()=>{
 const backend=read('backend/plnMfgFoundation.ts');
 const resources=read('backend/plnManufacturingResources.ts');
 assert.ok(backend.includes("'/pln_config/master'"));
 assert.ok(backend.includes('formDefaultsRevision:revision'));
 assert.ok(resources.includes('costCenterId:ccId'));
 assert.ok(resources.includes("sourceKind:'PRODUCTION_COST_CENTER'"));
 assert.ok(resources.includes('pln_cost_center_capacity'));
});
