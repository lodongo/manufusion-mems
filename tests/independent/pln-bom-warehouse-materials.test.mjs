import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster,detectBomCycle,mappedProcurementMaterialToWarehouse} from '../../backend/plnMfgFoundation.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const base={
    id:'BOM_100',name:'Syrup formulation',parentSkuId:'SKU_SYRUP',
    siteId:'',outputQty:1,outputUom:'UOM-04-001',components:[],
};
const input=(overrides={})=>({source:'WAREHOUSE',warehouseId:'WH_100',materialId:'MAT_100',
    skuId:'',quantity:12,uom:'UOM-01-002',scrapPct:0,...overrides});

test('BOM preserves explicit warehouse/material identity without inventing manufacturing SKU',()=>{
    const bom=normalizeMaster('boms',{...base,components:[input(),
        {source:'INTERMEDIATE',skuId:'SKU_PREMIX',quantity:1,uom:'UOM-04-001',scrapPct:1}]});
    assert.deepEqual(bom.components[0],{
        line:1,source:'WAREHOUSE',skuId:'',warehouseId:'WH_100',materialId:'MAT_100',
        quantity:12,uom:'UOM-01-002',scrapPct:0,
    });
    assert.equal(bom.components[1].source,'INTERMEDIATE');
    assert.equal(bom.components[1].skuId,'SKU_PREMIX');
});

test('Warehouse-material pairs cannot repeat; separate warehouse mappings can be distinct',()=>{
    assert.throws(()=>normalizeMaster('boms',{...base,components:[input(),input({quantity:3})]}),
        /Duplicate material in the same warehouse/);
    const bom=normalizeMaster('boms',{...base,components:[input(),input({warehouseId:'WH_200'})]});
    assert.equal(bom.components.length,2);
    assert.throws(()=>normalizeMaster('boms',{...base,components:[input({materialId:''})]}),/Procurement material/);
});

test('Existing untagged manufacturing BOM components remain valid',()=>{
    const bom=normalizeMaster('boms',{...base,components:[{
        skuId:'SKU_LEGACY',quantity:2,uom:'EA',scrapPct:0,
    }]});
    assert.equal(bom.components[0].skuId,'SKU_LEGACY');
    assert.equal(bom.components[0].source,undefined);
});

test('Warehouse materials do not create phantom manufacturing dependency cycles',()=>{
    assert.equal(detectBomCycle([], 'SKU_A',[{skuId:''},{skuId:'SKU_B'}]),false);
    assert.equal(detectBomCycle([{parentSkuId:'SKU_B',components:[{skuId:'SKU_A'}]}],
        'SKU_A',[{skuId:'SKU_B'}]),true);
});

test('A procurement material is selectable only if actually mapped to the warehouse',()=>{
    const m={warehouseIds:['WH_100']};
    assert.equal(mappedProcurementMaterialToWarehouse('MAT_100',m,'WH_100',[]),true);
    assert.equal(mappedProcurementMaterialToWarehouse('MAT_100',m,'WH_200',[]),false);
    assert.equal(mappedProcurementMaterialToWarehouse('MAT_100',{},'WH_200',[
        {data:{sourceId:'MAT_100',warehouseId:'WH_200',status:'approved'}}]),true);
    assert.equal(mappedProcurementMaterialToWarehouse('MAT_100',{},'WH_200',[
        {data:{sourceId:'MAT_100',warehouseId:'WH_200',status:'draft'}}]),false);
});

test('BOM picker requires source, warehouse, procurement material and keeps inventory permission checks server-side',()=>{
    const ui=read('src/org/ProductionFoundation.tsx');
    const api=read('backend/plnMfgFoundation.ts');
    for(const field of ['Material source','Manufactured intermediate','Warehouse (within your access)',
        'Approved procurement material','WAREHOUSE · PROCUREMENT MATERIAL']){
        assert.ok(ui.includes(field),field);
    }
    assert.ok(ui.includes('warehouseMaterials:[]'));
    assert.ok(api.includes("allowedNodeIds(ctx.orgId,ctx.me,true)"));
    assert.ok(api.includes("mappedProcurementMaterialToWarehouse(materialId,material.data,warehouseId,extensions)"));
    assert.ok(api.includes("The Procurement material is not approved and mapped to the selected warehouse."));
});
