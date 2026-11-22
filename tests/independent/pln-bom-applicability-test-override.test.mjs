import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const source={
    id:'BOM_TEST_01',name:'Common material recipe',outputQty:30000,outputUom:'L',
    classificationCode:'PRODUCTION',siteId:'',alternativeCode:'STANDARD',
    components:[{source:'PROCESS_SUPPLY',processSupplyKind:'UTILITY',supplyCostCenterId:'CC_001',
      supplyUtilityCode:'WATER',quantity:100,uom:'L',scrapPct:0,deliveryMode:'INLINE',quantityMethod:'PLANNED'}],
};
test('BOM applicability: exact SKU, manufacturing class and global default',()=>{
    const single=normalizeMaster('boms',{...source,applicability:'SKU',parentSkuId:'SKU_001'});
    assert.equal(single.applicability,'SKU');
    assert.equal(single.parentSkuId,'SKU_001');
    assert.equal(single.processClassId,'');
    const process=normalizeMaster('boms',{...source,applicability:'PROCESS_CLASS',processClassId:'PRC_00001'});
    assert.equal(process.applicability,'PROCESS_CLASS');
    assert.equal(process.parentSkuId,'');
    assert.equal(process.processClassId,'PRC_00001');
    const global=normalizeMaster('boms',{...source,applicability:'ALL'});
    assert.equal(global.applicability,'ALL');
    assert.equal(global.parentSkuId,'');
    assert.equal(global.processClassId,'');
    assert.throws(()=>normalizeMaster('boms',{...source,applicability:'PROCESS_CLASS'}),/classification/i);
    assert.throws(()=>normalizeMaster('boms',{...source,applicability:'SKU'}),/SKU/i);
});
test('BOM editor defaults to Settings and displays the three controlled scope options',()=>{
    const ui=read('src/org/ProductionFoundation.tsx');
    assert.ok(ui.includes("{key:'settings',title:'1. Settings'}"));
    assert.ok(ui.includes("{key:'output',title:'2. Output'}"));
    assert.ok(ui.includes("{key:'materials',title:'3. Materials'}"));
    assert.ok(ui.includes("['SKU','One specific SKU']"));
    assert.ok(ui.includes("['PROCESS_CLASS','All SKUs in a manufacturing process classification']"));
    assert.ok(ui.includes("['ALL','All SKUs']"));
});
test('Only audited, tenant-limited development super-admins may bypass approval on same-ID BOM save',()=>{
    const api=read('backend/plnMfgFoundation.ts'),ui=read('src/org/ProductionFoundation.tsx');
    assert.ok(api.includes("ctx.role==='org_super_admin'&&ctx.testMode===true"));
    assert.ok(api.includes("ctx.bypassed?.push('mfg.bom.immediate_save_and_approval')"));
    assert.ok(api.includes("status:testBomOverride?'active':'draft'"));
    assert.ok(api.includes("precondition:{updateTime:old!.updateTime}"));
    assert.ok(api.includes("snapshotSubcollection:'revisions'"));
    assert.ok(ui.includes("border-2 border-blue-600"));
    assert.ok(ui.includes("Save & apply now"));
    assert.ok(ui.includes("'/api/org/pln-mfg/foundation/test-state'"));
});
test('Release selection supports fallback and existing slots belonging to the same BOM',()=>{
    const release=read('backend/plnMfgRelease.ts');
    assert.ok(release.includes("(['SKU','PROCESS_CLASS','ALL'] as const)"));
    assert.ok(release.includes("str(data.applicability)||'SKU'"));
    assert.ok(release.includes("str(slot.data.masterId)!==id"));
    assert.ok(release.includes("precondition:priorSlots[index]?{updateTime:priorSlots[index]!.updateTime}:{exists:false}"));
});
