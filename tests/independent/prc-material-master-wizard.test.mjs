import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {materialMasterHierarchy} from '../../src/org/materialMasterHierarchy.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const material=(code,family,category,group,industryRecommended=false)=>({
    code,subcategoryCode:family,categoryCode:category,groupCode:group,
    name:code,financial:{industryRecommended},
});
const catalog={
    version:'5.3.0',
    groups:[{code:'MAT-001',name:'Raw Materials'},{code:'MAT-002',name:'Packaging'}],
    categories:[
        {code:'SUB-SUGAR',groupCode:'MAT-001',name:'Sugars'},
        {code:'SUB-RESIN',groupCode:'MAT-001',name:'Resins'},
        {code:'SUB-CAPS',groupCode:'MAT-002',name:'Caps'},
    ],
    subcategories:[
        {code:'FAM-SUGAR',categoryCode:'SUB-SUGAR',name:'Refined Sugar'},
        {code:'FAM-RESIN',categoryCode:'SUB-RESIN',name:'PET Resin'},
        {code:'FAM-CAPS',categoryCode:'SUB-CAPS',name:'Closures'},
    ],
    classes:[
        material('SUGAR-001','FAM-SUGAR','SUB-SUGAR','MAT-001',true),
        material('PET-001','FAM-RESIN','SUB-RESIN','MAT-001',false),
        material('CAP-2622','FAM-CAPS','SUB-CAPS','MAT-002',false),
    ],
};

test('wizard browses ALL active master categories regardless of industry recommendations',()=>{
    const root=materialMasterHierarchy(catalog,'','','','');
    assert.deepEqual(root.categories.map(x=>x.code),['MAT-001','MAT-002']);
    const closure=materialMasterHierarchy(catalog,'MAT-002','SUB-CAPS','FAM-CAPS','CAP-2622');
    assert.equal(closure.complete,true);
    assert.deepEqual(closure.materials.map(x=>x.code),['CAP-2622']);
    assert.equal(closure.materials[0].financial.industryRecommended,false);
});

test('family and material are filtered by their actual master parent references',()=>{
    const sugar=materialMasterHierarchy(catalog,'MAT-001','SUB-SUGAR','FAM-SUGAR','SUGAR-001');
    assert.deepEqual(sugar.subcategories.map(x=>x.code),['SUB-SUGAR','SUB-RESIN']);
    assert.deepEqual(sugar.families.map(x=>x.code),['FAM-SUGAR']);
    assert.deepEqual(sugar.materials.map(x=>x.code),['SUGAR-001']);
    assert.equal(sugar.complete,true);
    const wrong=materialMasterHierarchy(catalog,'MAT-001','SUB-SUGAR','FAM-CAPS','CAP-2622');
    assert.equal(wrong.complete,false);
    assert.match(wrong.selectionIssue,/family/);
});

test('stale catalog and draft selections report a clear selection issue',()=>{
    const missing=materialMasterHierarchy(catalog,'MAT-001','SUB-SUGAR','FAM-SUGAR','OLD-CODE');
    assert.equal(missing.validMaterial,false);
    assert.match(missing.selectionIssue,/material/);
    const staleCat=materialMasterHierarchy(catalog,'OLD-CATEGORY','','','');
    assert.match(staleCat.selectionIssue,/category/);
});

test('wizard refreshes the published PRC catalog, resets new material and loads exact attributes',()=>{
    const wizard=read('src/org/MaterialsMaster.tsx');
    const backend=read('backend/procurement.ts');
    assert.ok(wizard.includes('materialMasterHierarchy(tree,category,subcategory,family,material)'));
    assert.ok(wizard.includes('reloadMaterialMaster()'));
    assert.ok(wizard.includes("setCategory('');setSubcategory('');setFamily('');setMaterial('')"));
    assert.ok(wizard.includes("callBackend<ClassDetail>(itemApi,{kind:'materials',code:material})"));
    assert.ok(wizard.includes("d.code!==material||d.groupCode!==category||d.categoryCode!==subcategory"));
    assert.ok(wizard.includes('Technical attributes from Materials Master'));
    assert.ok(!wizard.includes('showAllIndustryMaterials'));
    assert.ok(backend.includes('await validatePublishedMaterialSelection(d)'));
    assert.ok(backend.includes('const master=await load('+"'materials'"+')'));
    assert.ok(backend.includes('for(const key of strs(item.requiredAttributes))'));
    assert.ok(backend.includes("kind==='multi_select'"));
});
