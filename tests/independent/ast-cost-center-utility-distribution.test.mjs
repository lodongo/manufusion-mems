import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AST_UTILITY_ITEMS} from '../../backend/astUtilityDefaults.ts';
import {isInternalUtilitySupply} from '../../backend/utilitySupplyPolicy.ts';
import {reviewUtilityDistribution,normalizedMaterialFlow,utilityDeterminant} from '../../src/shared/utilityDistributionCapacity.ts';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
const read=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const electrical=AST_UTILITY_ITEMS.find(x=>x.code==='UTL-01-002');
const air=AST_UTILITY_ITEMS.find(x=>x.code==='UTL-08-001');
const voltage=electrical.attributes.find(x=>x.key==='voltage');
test('Five equipment loads are additive in current but voltage is a compatibility condition',()=>{
 assert.equal(utilityDeterminant(electrical).key,'current');
 assert.ok(voltage);
 const supplied={voltage:400,frequency:50};
 const consumers=Array.from({length:5},(_,i)=>({equipmentId:'EQ-'+i,
  values:{current:17,voltage:400,frequency:50}}));
 const result=reviewUtilityDistribution(electrical,supplied,100,consumers);
 assert.equal(result.demand,85);
 assert.equal(result.percentage,85);
 assert.equal(result.status,'warning');
 assert.equal(result.remaining,15);
 assert.ok(!result.gaps.some(x=>x.key==='voltage'));
 const mismatch=reviewUtilityDistribution(electrical,supplied,100,[
  {equipmentId:'EQ-6',values:{current:20,voltage:230,frequency:50}},
 ]);
 assert.equal(mismatch.demand,20);
 assert.equal(mismatch.status,'incompatible');
 assert.ok(mismatch.gaps.some(x=>x.key==='voltage'));
});
test('Compressed air uses summed flow while pressure is at-least equipment minimum',()=>{
 const values={pressure:7,dewpoint:-40,particle:'1',water:'1',oil:'1'};
 const loads=[
  {equipmentId:'AIR-A',values:{...values,pressure:6,flow:200}},
  {equipmentId:'AIR-B',values:{...values,pressure:6.5,flow:180}},
 ];
 const within=reviewUtilityDistribution(air,values,400,loads);
 assert.equal(within.demand,380);
 assert.equal(within.percentage,95);
 assert.equal(within.status,'warning');
 const insufficient=reviewUtilityDistribution(air,values,300,loads);
 assert.equal(insufficient.status,'overload');
 const pressure=reviewUtilityDistribution(air,values,400,[
  {equipmentId:'AIR-C',values:{...values,pressure:8,flow:50}},
 ]);
 assert.equal(pressure.status,'incompatible');
 assert.ok(pressure.gaps.some(x=>x.key==='pressure'));
});
test('Missing equipment capacity remains unresolved instead of being treated as zero',()=>{
 const supply={pressure:7,dewpoint:-40,particle:'1',water:'1',oil:'1'};
 const r=reviewUtilityDistribution(air,supply,100,[
  {equipmentId:'A',values:{flow:35,pressure:6,dewpoint:-40,particle:'1',water:'1',oil:'1'}},
  {equipmentId:'B',values:{flow:undefined,pressure:6,dewpoint:-40,particle:'1',water:'1',oil:'1'}},
 ]);
 assert.equal(r.demand,35);
 assert.equal(r.unknown,1);
 assert.equal(r.status,'incomplete');
});
test('Material flow comparisons normalize only compatible quantities',()=>{
 assert.equal(normalizedMaterialFlow(30000,'L','m³/h'),30);
 assert.equal(normalizedMaterialFlow(35,'m³','L/h'),35000);
 assert.equal(normalizedMaterialFlow(40,'Nm³','m³/h'),null);
 assert.equal(normalizedMaterialFlow(1,'KG','Nm³/h'),null);
});
test('External cost-centre supply is not misclassified as equipment-internal generation',()=>{
 assert.equal(isInternalUtilitySupply({supplyLinkRule:3,isInternalSupply:false,sourceAssetTag:''}),false);
 assert.equal(isInternalUtilitySupply({supplyLinkRule:3,isInternalSupply:true}),true);
});
test('BOM accepts utility from cost-centre supply without requiring an equipment-utility reference',()=>{
 const input={id:'BOM-CC-TEST',name:'Processed intermediate',parentSkuId:'SKU-OUT',
  outputQty:1000,outputUom:'L',components:[{source:'PROCESS_SUPPLY',processSupplyKind:'UTILITY',
   supplyCostCenterId:'CC-PLANT',supplyUtilityCode:'UTL-08-001',
   quantity:100,uom:'L',quantityMethod:'METERED',deliveryMode:'INLINE',scrapPct:0,
   requiredFlowPerHour:1000}]};
 const normalized=normalizeMaster('boms',input).components[0];
 assert.equal(normalized.source,'PROCESS_SUPPLY');
 assert.equal(normalized.supplyCostCenterId,'CC-PLANT');
 assert.equal(normalized.supplyUtilityCode,'UTL-08-001');
 assert.equal(normalized.utilityWorkCenterId,'');
 assert.equal(normalized.utilityCode,'');
 assert.equal(normalized.quantity,100);
 const wrong=structuredClone(input);
 wrong.components[0].supplyUtilityCode='';
 assert.throws(()=>normalizeMaster('boms',wrong),/both the cost centre and its configured utility/);
});
test('Cost-centre distribution is permissioned and deployed to organization and manufacturing setup',()=>{
 const api=read('backend/costCenterUtilityDistribution.ts'),ast=read('backend/astUtilities.ts');
 const structure=read('src/org/StructurePage.tsx'),planning=read('src/org/PlnCostCenterSkuSetup.tsx');
 const frontend=read('src/org/EquipmentUtilities.tsx'),bom=read('src/org/ProductionFoundation.tsx');
 assert.ok(api.includes("PERMS.utilitiesEdit"));
 assert.ok(api.includes("cost_center_utility_supplies"));
 assert.ok(api.includes('allocatedCapacity'));
 assert.ok(api.includes('elsewhere+allocated'));
 assert.ok(ast.includes('validateEquipmentUtilityDistribution'));
 assert.ok(ast.includes('distributionWriteRevision'));
 assert.ok(structure.includes('Utility supply &amp; distribution'));
 assert.ok(planning.includes('CostCenterUtilitySupplies'));
 assert.ok(frontend.includes('costCenterSupply'));
 assert.ok(frontend.includes('Configure cost-centre utilities / add supply asset'));
 assert.ok(bom.includes("includesProcess=asComponents(draft.components).some(c=>c.source==='PROCESS_SUPPLY')"));
 assert.ok(bom.includes('Available capability from the cost-centre master'));
 assert.ok(bom.includes('Existing equipment utility demand is not added'));
});
