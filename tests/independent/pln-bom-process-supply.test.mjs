import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster,detectBomCycle} from '../../backend/plnMfgFoundation.ts';

const base={id:'BOM-100',name:'Fictional output formula',parentSkuId:'SKU-PRODUCT',outputQty:1000,outputUom:'L',siteId:'',alternativeCode:'STANDARD'};
const process=(data={})=>({source:'PROCESS_SUPPLY',processSupplyKind:'SKU',skuId:'SKU-WATER',
 deliveryMode:'INLINE',quantityMethod:'METERED',quantity:1000,uom:'L',scrapPct:0,
 requiredFlowPerHour:30000,...data});
const normalize=(components)=>normalizeMaster('boms',{...base,components});
const file=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('Metered inline water can be a linked non-warehouse BOM input without invented inventory transactions',()=>{
 const r=normalize([process()]);
 assert.deepEqual(r.components[0],{
  line:1,source:'PROCESS_SUPPLY',processSupplyKind:'SKU',skuId:'SKU-WATER',
  materialId:'',warehouseId:'',utilityWorkCenterId:'',utilityCode:'',
  quantity:1000,uom:'L',scrapPct:0,splitRule:'SPLIT',packSize:null,quantityMethod:'METERED',deliveryMode:'INLINE',
  requiredFlowPerHour:30000,bufferCapacity:null,bufferUsable:null,
 });
 assert.equal(r.outputQty,1000);
 assert.equal(r.components[0].quantity,1000);
});
test('Buffered water and bulk gas keep tank capacity separate from planned consumption',()=>{
 const r=normalize([
  process({deliveryMode:'BUFFERED',bufferCapacity:20000,bufferUsable:2500}),
  process({processSupplyKind:'PROCUREMENT',skuId:'',materialId:'MAT-CO2',
   deliveryMode:'BULK_STORAGE',quantityMethod:'AS_REQUIRED',
   quantity:3,uom:'KG',requiredFlowPerHour:100,
   bufferCapacity:10000,bufferUsable:5000}),
 ]);
 assert.equal(r.components[0].bufferCapacity,20000);
 assert.equal(r.components[0].bufferUsable,2500);
 assert.equal(r.components[0].quantity,1000);
 assert.equal(r.components[1].materialId,'MAT-CO2');
 assert.equal(r.components[1].quantity,3);
 assert.equal(r.components[1].quantityMethod,'AS_REQUIRED');
 assert.equal(r.components[1].bufferCapacity,10000);
});
test('Inline ozone can use a registered equipment utility without manufacturing a fake material SKU',()=>{
 const r=normalize([process({processSupplyKind:'UTILITY',skuId:'',utilityWorkCenterId:'CC-001',
  utilityCode:'OZONE',quantity:12,uom:'g',requiredFlowPerHour:50})]);
 assert.equal(r.components[0].skuId,'');
 assert.equal(r.components[0].utilityCode,'OZONE');
 assert.equal(r.components[0].utilityWorkCenterId,'CC-001');
 assert.equal(r.components[0].requiredFlowPerHour,50);
 assert.equal(detectBomCycle([{parentSkuId:'SKU-X',components:r.components}],
  'SKU-WATER',[{skuId:'SKU-Y'}]),false);
});
test('Existing warehouse and intermediate lines remain unchanged',()=>{
 const r=normalize([
  {source:'WAREHOUSE',warehouseId:'WH-001',materialId:'MAT-CAP',quantity:100,uom:'EA',scrapPct:1},
  {source:'INTERMEDIATE',skuId:'SKU-SYRUP',quantity:40,uom:'L',scrapPct:2},
 ]);
 assert.deepEqual(r.components[0],{line:1,source:'WAREHOUSE',skuId:'',warehouseId:'WH-001',
  materialId:'MAT-CAP',quantity:100,uom:'EA',scrapPct:1,splitRule:'WHOLE',packSize:1});
 assert.equal(r.components[1].source,'INTERMEDIATE');
 assert.equal(r.components[1].skuId,'SKU-SYRUP');
});
test('Continuous supply buffers, hourly quantities and references are validated and cannot silently double count',()=>{
 assert.throws(()=>normalize([process({processSupplyKind:'WRONG'})]),/process supply reference/);
 assert.throws(()=>normalize([process({processSupplyKind:'UTILITY',skuId:'',utilityCode:''})]),/Registered utility location/);
 assert.throws(()=>normalize([process({deliveryMode:'BUFFERED',bufferCapacity:null})]),/Buffer or bulk storage size/);
 assert.throws(()=>normalize([process({deliveryMode:'BUFFERED',bufferCapacity:1000,bufferUsable:1500})]),/cannot exceed/);
 assert.throws(()=>normalize([process({bufferUsable:200})]),/only be specified/);
 assert.throws(()=>normalize([process({requiredFlowPerHour:0})]),/flow per hour/);
 assert.throws(()=>normalize([process({quantity:0})]),/greater than zero/);
 assert.throws(()=>normalize([process(),process({quantity:200})]),/Duplicate process supply/);
 assert.throws(()=>normalize([process(),{source:'INTERMEDIATE',skuId:'SKU-WATER',quantity:200,uom:'L'}]),/Duplicate component SKU/);
});
test('BOM editor offers a third supply type, flow and buffer settings with real references',()=>{
 const ui=file('src/org/ProductionFoundation.tsx');
 const api=file('backend/plnMfgFoundation.ts');
 for(const text of [
  'Process supply · continuous, metered, inline or bulk',
  'Registered metered equipment utility',
  'Approved Procurement material · direct/bulk',
  'Continuous feed with a buffer tank or accumulator',
  'As required · planned estimate',
  'Planned material quantity for BOM output',
  'Optional required continuous flow',
  'Buffer size / physical capacity',
  'Usable quantity currently available',
  'changeComponentUnit',
 ])assert.ok(ui.includes(text),text);
 assert.ok(api.includes("if(str(component.source)==='PROCESS_SUPPLY')"));
 assert.ok(api.includes('publishedProcurementMaterial(material.data)'));
 assert.ok(api.includes("getDoc('organizations/'+ctx.orgId+'/equipment_utilities/'"));
 assert.ok(api.includes("if(!canAt(ctx,'MFG.view',utilityPath,await scopeOf(ctx)))"));
});

test('SKU process supply adopts its master without another cost-centre utility setup',()=>{
 const line=normalize([process({supplyCostCenterId:'CC-STALE',supplyUtilityCode:'WATER',utilityCode:'OLD',utilityWorkCenterId:'WC-OLD'})]).components[0];
 assert.equal(line.skuId,'SKU-WATER');
 assert.equal(line.supplyCostCenterId,undefined);
 assert.equal(line.supplyUtilityCode,undefined);
 assert.equal(line.utilityCode,'');
 assert.equal(line.utilityWorkCenterId,'');
});
test('Direct Procurement process materials do not create duplicate utility source references',()=>{
 const line=normalize([process({processSupplyKind:'PROCUREMENT',skuId:'',materialId:'MAT-WATER',
     supplyCostCenterId:'CC-STALE',supplyUtilityCode:'WATER'})]).components[0];
 assert.equal(line.materialId,'MAT-WATER');
 assert.equal(line.supplyCostCenterId,undefined);
 assert.equal(line.supplyUtilityCode,undefined);
});
test('Direct utility still adopts configured centre and utility and distinguishes duplicate sources',()=>{
 const bom=normalize([
    process({processSupplyKind:'UTILITY',skuId:'',supplyCostCenterId:'CC-001',supplyUtilityCode:'WATER'}),
    process({processSupplyKind:'UTILITY',skuId:'',supplyCostCenterId:'CC-002',supplyUtilityCode:'WATER'}),
 ]).components;
 assert.deepEqual(bom.map(c=>c.supplyCostCenterId),['CC-001','CC-002']);
 assert.throws(()=>normalize([
   process({processSupplyKind:'UTILITY',skuId:'',supplyCostCenterId:'CC-001',supplyUtilityCode:'WATER'}),
   process({processSupplyKind:'UTILITY',skuId:'',supplyCostCenterId:'CC-001',supplyUtilityCode:'WATER'}),
 ]),/Duplicate process supply/);
});
test('SKU picker removes extra utility configuration from its material editor',()=>{
 const ui=file('src/org/ProductionFoundation.tsx'),backend=file('backend/plnMfgFoundation.ts');
 assert.ok(ui.includes("supplyRef==='UTILITY'&&<div className='space-y-2"));
 assert.ok(ui.includes("source==='PROCESS_SUPPLY'&&kind==='UTILITY'&&"));
 assert.ok(ui.includes("c.source==='PROCESS_SUPPLY'&&c.processSupplyKind==='UTILITY'&&"));
 assert.ok(ui.includes('This BOM uses its registered material identity, unit and supply setup directly.'));
 assert.ok(backend.includes("const ccId=reference==='UTILITY'?str(component.supplyCostCenterId):''"));
});

test('BOM save permits new or edited adopted SKU and Procurement process lines without a second utility selection',()=>{
    const api=file('backend/plnMfgFoundation.ts');
    const validation=api.slice(api.indexOf("if(kind==='boms'){",api.indexOf("'POST /api/org/pln-mfg/foundation/save'")),
        api.indexOf("if(kind==='routings'&&creating",api.indexOf("'POST /api/org/pln-mfg/foundation/save'")));
    assert.match(validation,/str\(x\.processSupplyKind\)==='UTILITY'/);
    assert.doesNotMatch(validation,/for\(const c of ARR\(raw\.components\)\.filter\(x=>str\(x\.source\)==='PROCESS_SUPPLY'\)\)/);
    assert.match(validation,/Only direct UTILITY lines require their own distribution reference/);
    assert.match(validation,/SKU and Procurement material lines inherit their registered source/);
    assert.match(api,/if\(reference==='SKU'\)/);
    assert.match(api,/else if\(reference==='PROCUREMENT'\)/);
});
