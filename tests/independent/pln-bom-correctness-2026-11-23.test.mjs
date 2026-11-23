import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
import {isManufacturingCostType} from '../../backend/plnCostCenterCapacity.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const utilityLine={source:'PROCESS_SUPPLY',processSupplyKind:'UTILITY',supplyCostCenterId:'CC_001',
    supplyUtilityCode:'WATER',quantity:100,uom:'L',scrapPct:0,deliveryMode:'INLINE',quantityMethod:'PLANNED'};
const base={id:'BOM_TEST_02',name:'Shared recipe',outputQty:30000,outputUom:'L',
    classificationCode:'PRODUCTION',siteId:'',alternativeCode:'STANDARD'};

test('process-class and all-SKU BOMs accept utility and procurement lines without a parent SKU',()=>{
    const pc=normalizeMaster('boms',{...base,applicability:'PROCESS_CLASS',processClassId:'PRC_00001',components:[utilityLine]});
    assert.equal(pc.applicability,'PROCESS_CLASS');
    const all=normalizeMaster('boms',{...base,applicability:'ALL',components:[utilityLine]});
    assert.equal(all.applicability,'ALL');
});

test('a SKU still cannot consume itself on a single-SKU BOM',()=>{
    assert.throws(()=>normalizeMaster('boms',{...base,applicability:'SKU',parentSkuId:'SKU_001',
        components:[{source:'INTERMEDIATE',skuId:'SKU_001',quantity:1,uom:'EA',scrapPct:0,deliveryMode:'INLINE',quantityMethod:'PLANNED'}]}),
        /cannot consume itself/);
});

test('BOM overwrite audit records the superseded revision and its approval effect',()=>{
    const backend=read('backend/plnMfgFoundation.ts');
    assert.ok(backend.includes("action:'mfg.bom.revision_superseded'"));
    assert.ok(backend.includes("kind==='boms'?'mfg.bom.overwrite'"),'the original overwrite audit stays');
    assert.ok(backend.includes("'The previous approval no longer applies to planning until the new revision is approved.'"));
});

test('manufacturing cost-centre eligibility refuses an MFG entry Finance switched off',()=>{
    assert.equal(isManufacturingCostType('MFG',[]),true,'default before any Finance list exists');
    assert.equal(isManufacturingCostType('MFG',[{code:'PROD',name:'Production',active:true}]),true,
        'a customised list that omits MFG keeps it eligible');
    const configured=[{code:'PROD',name:'Production',active:true},{code:'MFG',name:'Manufacturing',active:false}];
    assert.equal(isManufacturingCostType('MFG',configured),false,'inactive Finance entry must be refused');
    assert.equal(isManufacturingCostType('PROD',configured),true);
    assert.equal(isManufacturingCostType('INV',[]),false);
    assert.equal(isManufacturingCostType('WHS',configured),false);
});
