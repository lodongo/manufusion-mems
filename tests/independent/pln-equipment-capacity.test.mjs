import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCapacityLines,isManufacturingCostType,eligibleManufacturingHierarchy} from '../../backend/plnEquipmentCapacity.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const node=(id,level,parentId='',costType='',status='active')=>({
 id,level,parentId,name:id,code:id,costType,status,
});
const labels=[
 {code:'MFG',name:'Manufacturing',active:true},
 {code:'CSTR',name:'Production and assembly',active:true},
 {code:'ADMIN',name:'General and administration',active:true},
 {code:'WARE',name:'Warehousing',active:true},
 {code:'DORMANT',name:'Production department',active:false},
];

test('cost centre must have adopted manufacturing classification, never just a matching name',()=>{
 assert.equal(isManufacturingCostType('MFG',labels),true);
 assert.equal(isManufacturingCostType('CSTR',labels),true);
 assert.equal(isManufacturingCostType('ADMIN',labels),false);
 assert.equal(isManufacturingCostType('WARE',labels),false);
 assert.equal(isManufacturingCostType('DORMANT',labels),false);
 assert.equal(isManufacturingCostType('UNKNOWN',labels),false);
});
test('cascaded legal-entity/site/manufacturing/department/cost-centre hierarchy',()=>{
 const nodes=[
  node('LE','legal_entity'),
  node('SITE','site','LE'),
  node('DEPT','department','SITE'),
  node('CC_MFG','cost_center','DEPT','MFG'),
  node('CC_ADMIN','cost_center','DEPT','ADMIN'),
  node('EQ1','work_center','CC_MFG'),
  node('OTH','site','MISSING'),
 ];
 const result=eligibleManufacturingHierarchy(nodes,labels);
 assert.deepEqual(result.legalEntities.map(x=>x.id),['LE']);
 assert.deepEqual(result.sites.map(x=>x.id),['SITE']);
 assert.deepEqual(result.departments.map(x=>x.id),['DEPT']);
 assert.deepEqual(result.costCenters.map(x=>x.id),['CC_MFG']);
});
test('closed, inactive, mismatched and orphaned nodes are not eligible',()=>{
 const invalid=eligibleManufacturingHierarchy([
  node('LE','legal_entity'),node('S','site','LE','', 'inactive'),
  node('D','department','S'),node('CC','cost_center','D','MFG'),
  node('CC_ORPHAN','cost_center','missing','MFG')
 ],labels);
 assert.equal(invalid.costCenters.length,0);
 assert.equal(invalid.legalEntities.length,0);
});
test('commissioned throughput is SKU-specific, positive, deduplicated and unit-linked',()=>{
 const lines=normalizeCapacityLines([
  {skuId:'SKU_001',commissionedRatePerHour:28000,rateUom:'EA'},
  {skuId:'SKU_002',commissionedRatePerHour:1320.5,rateUom:'CASE'},
  {skuId:'SKU_003',commissionedRatePerHour:3000,rateUom:'L'},
 ]);
 assert.equal(lines.length,3);
 assert.equal(lines[0].commissionedRatePerHour,28000);
 assert.equal(lines[2].rateUom,'L');
 assert.throws(()=>normalizeCapacityLines([]),/between 1 and 100/);
 assert.throws(()=>normalizeCapacityLines([lines[0],lines[0]]),/once per equipment/);
 assert.throws(()=>normalizeCapacityLines([{...lines[0],commissionedRatePerHour:0}]),/greater than zero/);
 assert.throws(()=>normalizeCapacityLines([{...lines[0],commissionedRatePerHour:Infinity}]),/greater than zero/);
 assert.throws(()=>normalizeCapacityLines([{...lines[0],rateUom:''}]),/Rate unit/);
});
test('one equipment per cost centre is stored by cost centre ID with guarded revision writes',()=>{
 const source=read('backend/plnEquipmentCapacity.ts');
 assert.ok(source.includes("const P=(org:string)=>'organizations/'+org+'/pln_equipment_capacity'"));
 assert.ok(source.includes("const path=P(ctx.orgId)+'/'+costCenterId,old=await getDoc(path)"));
 assert.ok(source.includes('commitChecked([{path,data,precondition:old?{updateTime:old.updateTime}:{exists:false}}])'));
 assert.ok(source.includes('Number(ctx.body.expectedRevision)!==revision'));
 assert.ok(source.includes("str(unit.data.parentId)!==costCenterId"));
 assert.ok(source.includes("str(asset.data.workCenterId)!==unitId"));
 assert.ok(source.includes("str(asset.data.status)!=='active'"));
 assert.ok(source.includes('typeCatalogue()'));
 assert.ok(source.includes("if(str(sku.data.uom)!==row.rateUom)"));
 assert.ok(source.includes("'PLN.configure'"));
 assert.ok(source.includes("'PLN.view'"));
 assert.ok(!source.includes('updateFields('));
});
test('planning can configure, asset can see, and standalone planner resource entry is hidden',()=>{
 const backend=read('backend/index.ts');
 const planning=read('src/org/ProductionFoundation.tsx');
 const asset=read('src/org/AssetRegister.tsx');
 const equipment=read('src/org/WorkCenterAsset.tsx');
 const ui=read('src/org/PlnEquipmentSetup.tsx');
 assert.ok(backend.includes('...plnEquipmentCapacityRoutes'));
 assert.ok(planning.includes("key:'equipmentCapacity',label:'Equipment & SKU Capacity'"));
 assert.ok(planning.includes("module==='PLN'?'equipmentCapacity'"));
 assert.ok(planning.includes("module==='PLN'&&t.key==='resources'?false"));
 assert.ok(ui.includes("Legal entity"));
 assert.ok(ui.includes("Manufacturing department"));
 assert.ok(ui.includes("Manufacturing cost centre"));
 assert.ok(ui.includes("Commissioned output per hour"));
 assert.ok(ui.includes("Save equipment & SKU capacities"));
 assert.ok(ui.includes("Remove planning designation"));
 assert.ok(asset.includes('<PlnAssetCapacityView assetTag={a.tag}/>'));
 assert.ok(equipment.includes('<PlnAssetCapacityView assetTag={a.tag}/>'));
 const view=read('src/org/PlnAssetCapacityView.tsx');
 assert.ok(view.includes('/api/org/pln/equipment/asset-view'));
 assert.ok(view.toLowerCase().includes('read-only'));
});
