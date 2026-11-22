import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

test('Product configuration distinguishes a reusable variant, form and routing class from an SKU',()=>{
 const setup=read('src/org/MfgSkuSetup.tsx');
 assert.ok(setup.includes('export function SkuIdentityGuide'));
 assert.ok(setup.includes('Product/Variant says'));
 assert.ok(setup.includes('Production Form describes'));
 assert.ok(setup.includes('Manufacturing Process Classification says'));
 assert.ok(setup.includes('500 mL PET'));
 assert.ok(setup.includes('1 L PET'));
 assert.ok(setup.includes("identityHints[key]"));
 assert.ok(setup.includes("i===0&&<div className='mt-3'><SkuIdentityGuide"));
 assert.ok(setup.includes("onClick={onOpenSkus}"));
});

test('SKU editor uses the exact same guide and displays selected reusable components in preview',()=>{
 const page=read('src/org/ProductionFoundation.tsx');
 const setup=read('src/org/MfgSkuSetup.tsx');
 assert.ok(page.includes('<SkuIdentityGuide inSkuForm/>'));
 assert.ok(page.includes("onOpenSkus={()=>changeTab('items')}"));
 assert.ok(setup.includes('Your SKU composition preview'));
 assert.ok(setup.includes("Product/Variant: {productRecord?.name"));
 assert.ok(setup.includes('Production Form: {form?'));
 assert.ok(setup.includes('Manufacturing process: {processRecord?.name'));
 assert.ok(setup.includes("processRecord=getParam(setup,'processClasses',processClassId)"));
 assert.ok(page.includes('processClassId={str(draft.processClassId)}'));
});

test('Explanations do not reclassify SKUs or introduce duplicate product/form records',()=>{
 const setup=read('src/org/MfgSkuSetup.tsx');
 const page=read('src/org/ProductionFoundation.tsx');
 const model=read('backend/mfgSkuModel.ts');
 assert.ok(model.includes("const name=get('productNames',values.productNameId,options.requireProductName!==false)"));
 assert.ok(model.includes("const form=get('productionForms',values.productionFormId,true)"));
 assert.ok(setup.includes("value.productionFormId"));
 assert.ok(page.includes("skuComponents"));
 assert.ok(!setup.includes('createSkuFromIdentityGuide'));
});

test('Documentation explains why two pack sizes can share a product identity',()=>{
 const documentation=read('src/org/PlnDocumentation.tsx');
 assert.ok(documentation.includes("Product/Variant, production form and SKU: what is the difference?"));
 assert.ok(documentation.includes("same Product/Variant, Production Form and process group"));
 assert.ok(documentation.includes("A Production Form")||documentation.includes("Production Form describes"));
});
