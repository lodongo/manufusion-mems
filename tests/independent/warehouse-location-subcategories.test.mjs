import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const ui=read('src/org/WarehouseSetup.tsx');
const backend=read('backend/warehouse.ts');

test('storage locations carry a category, selected multiple subcategories and an independent storage location type',()=>{
    assert.ok(ui.includes('materialSubcategoryCodes:string[]'));
    assert.ok(ui.includes("materialSubcategoryCodes:[]"));
    assert.ok(ui.includes("label='Material catalog category (storage location) *'"));
    assert.ok(ui.includes('Material subcategories * · select multiple'));
    assert.ok(ui.includes("label='Storage location type *'"));
    assert.ok(ui.includes('shownSubcategories.map(sc=>'));
    assert.ok(ui.includes("typeCode:l.typeCode,materialCategoryCode:l.materialCategoryCode,"));
    assert.ok(ui.includes('materialSubcategoryCodes:l.materialSubcategoryCodes,active:l.active'));
    assert.ok(backend.includes('materialSubcategoryCodes: string[];'));
    assert.ok(backend.includes('materialSubcategoryCodes,'));
});

test('subcategory choices are drawn only from the selected material catalog category',()=>{
    assert.ok(ui.includes('const selectedCategory=data.categories.find(cat=>cat.code===l.materialCategoryCode)'));
    assert.ok(ui.includes("const availableSubcategories=selectedCategory?.subcategories||[]"));
    assert.ok(ui.includes('materialSubcategoryCodes:l.materialSubcategoryCodes.filter(sc=>'));
    assert.ok(ui.includes('selected?.subcategories.some(x=>x.code===sc)'));
    assert.ok(backend.includes('const category=catalog.find(c=>c.code===materialCategoryCode)'));
    assert.ok(backend.includes('const allowed=new Set(category?.subcategories.map(sub=>sub.code)||[])'));
    assert.ok(backend.includes('subcategories \${invalid.join('));
});

test('location selections restrict new and edited cluster classification at both frontend and backend',()=>{
    assert.ok(ui.includes('chosen.materialSubcategoryCodes?.includes(x.code)'));
    assert.ok(ui.includes('parentLocation.materialSubcategoryCodes?.includes(sc.code)'));
    assert.ok(backend.includes('!location.materialSubcategoryCodes.includes(code)'));
    assert.ok(backend.includes('!location.materialSubcategoryCodes.includes(requestedSubcategory.code)'));
    assert.ok(backend.includes('Edit the location and select it first'));
});

test('existing clusters cannot be unlinked by shrinking their parent location subcategory list',()=>{
    assert.ok(backend.includes('const inheritedSubcategories=held.flatMap(cl=>cl.subcategories'));
    assert.ok(backend.includes('const inUse=inheritedSubcategories.filter(code=>!materialSubcategoryCodes.includes(code))'));
    assert.ok(backend.includes('Retain them or move those clusters before changing the location.'));
    assert.ok(ui.includes("disabled={selected&&used}"));
    assert.ok(ui.includes("used in cluster"));
    assert.ok(ui.includes('subcategories in use by existing clusters must remain selected'));
    assert.ok(ui.includes('data.clusters.filter(cl=>cl.locationCode===l.code)'));
});

test('new locations need a category, at least one subcategory and an explicitly selected type',()=>{
    assert.ok(backend.includes('if(!before&&!materialCategoryCode)'));
    assert.ok(backend.includes('if(!materialSubcategoryCodes.length)'));
    assert.ok(backend.includes("if (!type || (!type.active && before?.typeCode !== type.code))"));
    assert.ok(ui.includes('select at least one material subcategory'));
    assert.ok(ui.includes("if (!data.locationTypes.some((t) => t.code === l.typeCode))"));
});
