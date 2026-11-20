import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('SKU product family is mandatory on the form and server',()=>{
  const form=read('src/org/ProductionFoundation.tsx');
  const api=read('backend/plnMfgFoundation.ts');
  assert.ok(form.includes("<Field title='Product family' value={str(draft.family)} required"));
  assert.ok(!form.includes("Product family (optional)"));
  assert.ok(form.includes("Product family is required before saving this SKU."));
  assert.ok(api.includes("if(!str(raw.family).trim())throw new HttpError(400,'Product family is required.');"));
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
