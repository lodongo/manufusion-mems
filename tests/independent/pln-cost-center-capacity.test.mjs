import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSkuCapacity,isManufacturingCostType,eligibleManufacturingHierarchy} from '../../backend/plnCostCenterCapacity.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const n=(id,level,parentId='',costType='',status='active')=>({id,level,parentId,costType,status,name:id,code:id});
const types=[
 {code:'MFG',name:'Manufacturing',active:true},
 {code:'PRD',name:'Production',active:true},
 {code:'ADMIN',name:'Administration',active:true},
 {code:'DISABLED',name:'Manufacturing',active:false}
];
test('manufacturing classification comes from adopted cost centre types',()=>{
 assert.equal(isManufacturingCostType('MFG',types),true);
 assert.equal(isManufacturingCostType('PRD',types),true);
 assert.equal(isManufacturingCostType('ADMIN',types),false);
 assert.equal(isManufacturingCostType('DISABLED',types),false);
 assert.equal(isManufacturingCostType('UNKNOWN',types),false);
});
test('hierarchy stops at manufacturing cost centre and omits equipment selection',()=>{
 const hierarchy=eligibleManufacturingHierarchy([
  n('LE','legal_entity'),n('S','site','LE'),n('D','department','S'),
  n('CC','cost_center','D','MFG'),n('OTHER','cost_center','D','ADMIN'),
  n('EQ','work_center','CC')
 ],types);
 assert.deepEqual(hierarchy.legalEntities.map(x=>x.id),['LE']);
 assert.deepEqual(hierarchy.sites.map(x=>x.id),['S']);
 assert.deepEqual(hierarchy.departments.map(x=>x.id),['D']);
 assert.deepEqual(hierarchy.costCenters.map(x=>x.id),['CC']);
 assert.equal(Object.hasOwn(hierarchy,'equipment'),false);
});
test('inactive ancestor and orphaned cost centres are excluded',()=>{
 const h=eligibleManufacturingHierarchy([
  n('LE','legal_entity'),n('S','site','LE','', 'inactive'),
  n('D','department','S'),n('CC','cost_center','D','MFG'),
  n('ORPHAN','cost_center','bad','MFG')
 ],types);
 assert.equal(h.costCenters.length,0);
});
test('each cost centre can map several distinct SKUs with their own throughput',()=>{
 const rows=normalizeSkuCapacity([
  {skuId:'SKU_1000',commissionedRatePerHour:28000,rateUom:'EA'},
  {skuId:'SKU_1001',commissionedRatePerHour:1200.5,rateUom:'CASE'},
  {skuId:'SKU_1002',commissionedRatePerHour:6000,rateUom:'L'}
 ]);
 assert.equal(rows.length,3);
 assert.equal(rows[0].commissionedRatePerHour,28000);
 assert.equal(rows[2].rateUom,'L');
 assert.throws(()=>normalizeSkuCapacity([]),/between 1 and 100/);
 assert.throws(()=>normalizeSkuCapacity([rows[0],rows[0]]),/only once/);
 assert.throws(()=>normalizeSkuCapacity([{...rows[0],commissionedRatePerHour:0}]),/positive/);
 assert.throws(()=>normalizeSkuCapacity([{...rows[0],commissionedRatePerHour:Infinity}]),/positive/);
 assert.throws(()=>normalizeSkuCapacity([{...rows[0],rateUom:'BAD UNIT'}]),/output unit/);
});
test('cost-centre key and optimistic revision prevent competing SKU mappings',()=>{
 const b=read('backend/plnCostCenterCapacity.ts');
 assert.ok(b.includes("const ROOT=(org:string)=>'organizations/'+org+'/pln_cost_center_capacity'"));
 assert.ok(b.includes("const path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path)"));
 assert.ok(b.includes('commitChecked([{path,data,precondition:old?{updateTime:old.updateTime}:{exists:false}}])'));
 assert.ok(b.includes('Number(ctx.body.expectedRevision)!==revision'));
 assert.ok(b.includes("str(item.data.uom)!==row.rateUom"));
 assert.ok(b.includes("str(item.data.siteId)!==siteId"));
 assert.ok(b.includes("ctx,'write',id"));
 assert.ok(!b.includes("pln_equipment_capacity"));
 assert.ok(!b.includes('assetDoc('));
 assert.ok(!b.includes('unitId'));
 assert.ok(!b.includes('assetTag'));
});
test('the same SKU editor opens from the cost-centre gear and PLN hierarchy',()=>{
 const structure=read('src/org/StructurePage.tsx');
 const pln=read('src/org/ProductionFoundation.tsx');
 const menu=read('src/org/PlnCostCenterSetup.tsx');
 const editor=read('src/org/PlnCostCenterSkuSetup.tsx');
 const backendIndex=read('backend/index.ts');
 assert.ok(structure.includes("'/api/org/pln/cost-center/eligibility'"));
 assert.ok(structure.includes("setMode(result.manufacturing?{type:'planning'}:{type:'edit'})"));
 assert.ok(read('backend/plnCostCenterCapacity.ts').includes("'POST /api/org/pln/cost-center/eligibility'"));
 assert.ok(structure.includes('<PlnCostCenterSkuSetup costCenterId={node.id}'));
 assert.ok(structure.includes("label='Edit organizational unit'"));
 assert.ok(pln.includes('<PlnCostCenterSetup/>'));
 assert.ok(menu.includes('<PlnCostCenterSkuSetup key={cc} costCenterId={cc}/>'));
 assert.ok(menu.includes("label='Manufacturing cost centre'"));
 assert.ok(!menu.includes('Equipment unit · Asset Register'));
 assert.ok(editor.includes("Mapped manufactured SKUs"));
 assert.ok(editor.includes("Commissioned throughput / hour"));
 assert.ok(editor.includes('/api/org/pln/cost-center/save'));
 assert.ok(backendIndex.includes('...plnCostCenterCapacityRoutes'));
});
test('original equipment and asset views have no planning configuration remnants',()=>{
 const ast=read('src/org/AssetRegister.tsx');
 const equipment=read('src/org/WorkCenterAsset.tsx');
 const b=read('backend/index.ts');
 assert.ok(!ast.includes('PlnAssetCapacityView'));
 assert.ok(!equipment.includes('PlnAssetCapacityView'));
 assert.ok(!b.includes('plnEquipmentCapacityRoutes'));
 assert.ok(!b.includes('plnEquipmentCapacity'));
 assert.ok(!b.includes('/api/org/pln/equipment/asset-view'));
});
