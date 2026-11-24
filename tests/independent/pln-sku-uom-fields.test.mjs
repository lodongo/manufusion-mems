import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('retired product family is neither asked for nor stored; manufactured SKUs need a governed process class',()=>{
  // Product family was replaced by the organization-managed process classification on Nov 22.
  const form=read('src/org/ProductionFoundation.tsx');
  const api=read('backend/plnMfgFoundation.ts');
  assert.ok(!form.includes("title='Product family'"));
  assert.ok(!form.includes('Product family is required'));
  assert.ok(api.includes('delete raw.family;'),'stale family values are stripped on save');
  assert.ok(!api.includes("Product family is required."));
  assert.ok(api.includes("if(kind==='items'&&['FINISHED','INTERMEDIATE'].includes(str(raw.category))&&"));
  assert.ok(api.includes("throw new HttpError(400,'Select the manufacturing process classification for this SKU. Configure it in Product Configuration.');"));
});

test('SKU base measurement uses the existing MEMS category and unit picker',()=>{
  const form=read('src/org/ProductionFoundation.tsx');
  const catalogue=read('src/org/MfgSkuSetup.tsx');
  assert.ok(form.includes("<UnitChoice key={draft.id||'new-sku'} title='Unit of measure'"));
  assert.ok(form.includes("setup={skuSetup} onChange={v=>update('uom',v)}"));
  assert.ok(!form.includes("title='Base unit of measure'"));
  assert.ok(form.includes("Choose a unit category and unit of measure from the MEMS unit registry."));
  assert.ok(catalogue.includes("export function UnitChoice"));
  assert.ok(catalogue.includes("title='Unit category'"));
  assert.ok(catalogue.includes("setup.units.filter(u=>u.categoryCode===activeCategory)"));
  assert.ok(catalogue.includes("u.symbol.toLowerCase()===value.toLowerCase()"));
});
