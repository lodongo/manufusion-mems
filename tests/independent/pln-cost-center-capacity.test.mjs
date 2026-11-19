import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeSkuCapacity,isManufacturingCostType,eligibleManufacturingHierarchy} from '../../backend/plnCostCenterCapacity.ts';
import {normalizePhysicalRating,derivePhysicalCapacity,physicalRatingUnits} from '../../backend/plnPhysicalCapacity.ts';
import {normalizeSkuParameter} from '../../backend/mfgSkuModel.ts';
import {MFG_PRIMARY_CONTAINER_TYPES} from '../../backend/mfgPrimaryContainerMetadata.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const node=(id,level,parentId='',costType='',status='active')=>({id,level,parentId,costType,status,name:id,code:id});
const types=[{code:'MFG',name:'Manufacturing',active:true},{code:'PRD',name:'Production',active:true},
 {code:'ADMIN',name:'Administration',active:true},{code:'DISABLED',name:'Manufacturing',active:false}];
const params=[
 {kind:'productNames',id:'NAME_100',name:'Fanta Orange'},
 {kind:'productionForms',id:'FORM_100',name:'Orange drink',uom:'UOM-04-001'},
 {kind:'containers',id:'CNT_100',name:'PET bottle',categoryCode:'PET',subcategoryCode:'PET-001',
  metadataCode:'PET_001',containerAttributes:{closure:'Screw cap',shape:'Round'}},
 {kind:'containerSizes',id:'SIZE_100',name:'400 mL',quantity:400,uom:'UOM-04-002'},
 {kind:'packages',id:'PKG_100',name:'Case x12',uom:'UOM-20-001',quantity:12,
  containedUnit:'PRIMARY',packagingTypeCode:'BOX-100'},
 {kind:'transportPackages',id:'TLP_100',name:'Pallet x80 cases',uom:'UOM-20-001',
  packagingTypeCode:'PAL-100'},
];
const sku={id:'SKU_100',name:'Fanta Orange 400 mL × 12',uom:'UOM-20-001',
 skuComponents:{productNameId:'NAME_100',productionFormId:'FORM_100',
  containerId:'CNT_100',containerSizeId:'SIZE_100',packageId:'PKG_100',
  transportPackageId:'TLP_100',transportUnitsPerLoad:80}};
const rate={skuId:sku.id,containerId:'CNT_100',containerSizeId:'SIZE_100',
 containerCategoryCode:'PET',containerSubcategoryCode:'PET-001',
 ratingQuantity:24000,ratingUnitCode:'UOM-20-001',periodUnitCode:'UOM-05-005'};
test('Finance adopted cost centres filter manufacturing without changing organization hierarchy',()=>{
 assert.equal(isManufacturingCostType('MFG',types),true);
 assert.equal(isManufacturingCostType('PRD',types),true);
 assert.equal(isManufacturingCostType('ADMIN',types),false);
 assert.equal(isManufacturingCostType('DISABLED',types),false);
 assert.equal(isManufacturingCostType('UNKNOWN',types),false);
 const h=eligibleManufacturingHierarchy([
  node('LE','legal_entity'),node('SITE','site','LE'),node('DEPT','department','SITE'),
  node('CC','cost_center','DEPT','MFG'),node('OTHER','cost_center','DEPT','ADMIN'),
  node('EQ','work_center','CC')
 ],types);
 assert.deepEqual(h.legalEntities.map(x=>x.id),['LE']);
 assert.deepEqual(h.sites.map(x=>x.id),['SITE']);
 assert.deepEqual(h.departments.map(x=>x.id),['DEPT']);
 assert.deepEqual(h.costCenters.map(x=>x.id),['CC']);
 assert.equal(Object.hasOwn(h,'equipment'),false);
 const invalid=eligibleManufacturingHierarchy([
  node('LE','legal_entity'),node('S','site','LE','', 'inactive'),
  node('D','department','S'),node('C','cost_center','D','MFG'),
  node('ORPHAN','cost_center','bad','MFG')
 ],types);
 assert.equal(invalid.costCenters.length,0);
});
test('Physical Containers can define a default Count unit without a parallel UOM master',()=>{
 const pet=MFG_PRIMARY_CONTAINER_TYPES.find(t=>t.code==='PET_001');
 const attrs=Object.fromEntries(pet.attributes.filter(a=>a.required).map(a=>[a.key,a.choices[0]]));
 const adopted=normalizeSkuParameter('containers',{
   metadataCode:'PET_001',containerAttributes:attrs,ratingCountUnitCode:'UOM-20-002',
 },[pet]);
 assert.equal(adopted.ratingCountUnitCode,'UOM-20-002');
 assert.equal(adopted.categoryCode,'PET');
 assert.throws(()=>normalizeSkuParameter('containers',{
   metadataCode:'PET_001',containerAttributes:attrs,ratingCountUnitCode:'UOM-04-001',
 },[pet]),/approved Count rating unit/);
 const ui=read('src/org/MfgSkuSetup.tsx');
 assert.ok(ui.includes('Count unit for commissioned throughput'));
 assert.ok(ui.includes("draft.ratingCountUnitCode||'UOM-20-001'"));
 const planner=read('src/org/PlnCostCenterSkuSetup.tsx');
 assert.ok(planner.includes('chosen?.ratingCountUnitCode'));
});
test('physical rating units use the published Count and Time categories',()=>{
 const units=physicalRatingUnits();
 assert.equal(units.count.find(x=>x.name==='Each')?.code,'UOM-20-001');
 assert.equal(units.count.find(x=>x.name==='Dozen')?.multiplier,12);
 assert.equal(units.time.find(x=>x.name==='Hour')?.code,'UOM-05-005');
 assert.equal(units.time.find(x=>x.name==='Minute')?.code,'UOM-05-004');
 assert.ok(!units.time.some(x=>x.name==='Kilogram'));
 assert.deepEqual(normalizePhysicalRating(rate),rate);
 assert.throws(()=>normalizePhysicalRating({...rate,ratingUnitCode:'UOM-04-001'}),/published Count unit/);
 assert.throws(()=>normalizePhysicalRating({...rate,periodUnitCode:'UOM-20-001'}),/published Time unit/);
 assert.throws(()=>normalizePhysicalRating({...rate,ratingQuantity:0}),/must be positive/);
 assert.throws(()=>normalizePhysicalRating({...rate,ratingQuantity:Infinity}),/must be positive/);
});
test('multi-SKU capacities are unique per cost centre and independently rated',()=>{
 const rows=normalizeSkuCapacity([rate,{...rate,skuId:'SKU_200',ratingQuantity:15000}]);
 assert.equal(rows.length,2);
 assert.equal(rows[1].ratingQuantity,15000);
 assert.throws(()=>normalizeSkuCapacity([]),/between 1 and 100/);
 assert.throws(()=>normalizeSkuCapacity([rate,rate]),/only once/);
});
test('one physical-container rating resolves four outputs under the SAME selected time period',()=>{
 const result=derivePhysicalCapacity(sku,params,rate);
 assert.equal(result.physicalContainers.quantity,24000);
 assert.equal(result.productionForm.quantity,9600); // 24,000 × 0.4 L
 assert.equal(result.finalProduct.quantity,2000); // 12 primary containers per case
 assert.equal(result.commercialPackaging.quantity,2000);
 assert.equal(result.transportLogistics.quantity,25); // 80 commercial packs per pallet
 for(const part of ['physicalContainers','productionForm','finalProduct','commercialPackaging','transportLogistics'])
  assert.ok(result[part].unit.endsWith('/ h')||result[part].unit.endsWith('/h'));
 assert.equal(result.source.containerAttributes.closure,'Screw cap');
 const perMinute=derivePhysicalCapacity(sku,params,{...rate,ratingQuantity:400,periodUnitCode:'UOM-05-004'});
 assert.equal(perMinute.physicalContainers.quantity,400);
 assert.equal(perMinute.productionForm.quantity,160);
 assert.equal(perMinute.commercialPackaging.quantity,Number((400/12).toPrecision(12)));
 assert.equal(perMinute.transportLogistics.quantity,Number((400/960).toPrecision(12)));
 assert.ok(perMinute.productionForm.unit.includes('min'));
 const dozens=derivePhysicalCapacity(sku,params,{...rate,ratingQuantity:2,
  ratingUnitCode:'UOM-20-002',periodUnitCode:'UOM-05-004'});
 assert.equal(dozens.physicalContainers.quantity,24);
 assert.equal(dozens.commercialPackaging.quantity,2);
});
test('mismatched SKU container, size and category never generate false conversion',()=>{
 assert.throws(()=>derivePhysicalCapacity(sku,params,{...rate,containerCategoryCode:'MET'}),/category or subcategory/);
 assert.throws(()=>derivePhysicalCapacity(sku,params,{...rate,containerSizeId:'SIZE_200'}),/physical-container properties and size/);
 assert.throws(()=>derivePhysicalCapacity({...sku,id:'SKU_OTHER'},params,rate),/selected manufactured SKU/);
 const unPacked={...sku,skuComponents:{...sku.skuComponents,packageId:undefined,
  transportPackageId:undefined,transportUnitsPerLoad:undefined}};
 const x=derivePhysicalCapacity(unPacked,params,rate);
 assert.equal(x.productionForm.quantity,9600);
 assert.equal(x.commercialPackaging.quantity,null);
 assert.equal(x.finalProduct.quantity,null);
 assert.equal(x.transportLogistics.quantity,null);
});
test('cost centre mapping validates SKU composition, uses optimistic concurrency, and stays out of Asset Register',()=>{
 const backend=read('backend/plnCostCenterCapacity.ts'),projection=read('backend/plnPhysicalCapacity.ts');
 assert.ok(backend.includes("const ROOT=(org:string)=>'organizations/'+org+'/pln_cost_center_capacity'"));
 assert.ok(backend.includes("const path=ROOT(ctx.orgId)+'/'+id,old=await getDoc(path)"));
 assert.ok(backend.includes('commitChecked([{path,data,precondition:old?{updateTime:old.updateTime}:{exists:false}}])'));
 assert.ok(backend.includes('Number(ctx.body.expectedRevision)!==revision'));
 assert.ok(backend.includes("await skuParametersForOrg(ctx.orgId)"));
 assert.ok(backend.includes("derivePhysicalCapacity(sku,params,line)"));
 assert.ok(backend.includes("'POST /api/org/pln/cost-center/preview'"));
 assert.ok(backend.includes("'POST /api/org/pln/cost-center/get'"));
 assert.ok(backend.includes("'POST /api/org/pln/cost-center/rating'"));
 assert.ok(backend.includes('return {costCenterId:id,skuId,revision:'));
 assert.ok(backend.includes('rating};'));
 assert.ok(backend.includes("Physical Container")||backend.includes("physical-container"));
 assert.ok(projection.includes('calculateSkuConversion(components,parameters)'));
 assert.ok(projection.includes('input.containerId!==str(components.containerId)'));
 assert.ok(projection.includes('input.containerSizeId!==str(components.containerSizeId)'));
 assert.ok(!backend.includes('pln_equipment_capacity'));
 assert.ok(!backend.includes('assetDoc('));
});
test('one editor is shared by the Organization Design gear and Production Planning',()=>{
 const structure=read('src/org/StructurePage.tsx'),pln=read('src/org/ProductionFoundation.tsx');
 const menu=read('src/org/PlnCostCenterSetup.tsx'),ui=read('src/org/PlnCostCenterSkuSetup.tsx');
 const index=read('backend/index.ts');
 assert.ok(structure.includes("'/api/org/pln/cost-center/eligibility'"));
 assert.ok(structure.includes("setMode(result.manufacturing?{type:'planning'}:{type:'edit'})"));
 assert.ok(structure.includes('<PlnCostCenterSkuSetup costCenterId={node.id}'));
 assert.ok(pln.includes('<PlnCostCenterSetup/>'));
 assert.ok(menu.includes('<PlnCostCenterSkuSetup key={cc} costCenterId={cc}/>'));
 assert.ok(ui.includes('Physical container category'));
 assert.ok(ui.includes('Physical container subcategory / type'));
 assert.ok(ui.includes('Configured physical container size'));
 assert.ok(ui.includes('Count unit / physical containers'));
 assert.ok(ui.includes('Time period (used for every result)'));
 assert.ok(ui.includes('Final product form'));
 assert.ok(ui.includes('Commercial packaging'));
 assert.ok(ui.includes('Transport & logistics'));
 assert.ok(ui.includes('line.containerSizeId!==sku.skuComponents.containerSizeId'));
 assert.ok(ui.includes('/api/org/pln/cost-center/save'));
 assert.ok(index.includes('...plnCostCenterCapacityRoutes'));
 assert.ok(!ui.includes('Commissioned throughput / hour'));
});
test('SKU editor visibly reports failures, persists committed revisions and supports later additions',()=>{
 const ui=read('src/org/PlnCostCenterSkuSetup.tsx');
 const backend=read('backend/plnCostCenterCapacity.ts');
 assert.ok(ui.includes('setShowValidation(true)'));
 assert.ok(ui.includes('lineIssues(line,i).map'));
 assert.ok(ui.includes('Cannot save yet. Correct the SKU-specific issues'));
 assert.ok(ui.includes('setRevision(result.mapping.revision)'));
 assert.ok(ui.includes('setLines(result.mapping.skuCapacities)'));
 assert.ok(ui.includes('setData(current=>current?{...current,mapping:result.mapping}:current)'));
 assert.ok(ui.includes('Add another SKU'));
 assert.ok(ui.includes('const next=available[0]'));
 assert.ok(ui.includes('All eligible manufactured SKUs at this site are already mapped'));
 assert.ok(!ui.includes('disabled={!canSave||busy}'));
 assert.ok(backend.includes("SKU '+(i+1)+' ('+line.skuId+'): '"));
});
test('SKU cardinality permits sequential commissioning up to 100 unique records',()=>{
 const rows=Array.from({length:100},(_,i)=>({...rate,skuId:'SKU_'+String(i+1)}));
 assert.equal(normalizeSkuCapacity(rows).length,100);
 assert.throws(()=>normalizeSkuCapacity([...rows,{...rate,skuId:'SKU_101'}]),/between 1 and 100/);
 assert.throws(()=>normalizeSkuCapacity([...rows.slice(0,99),rows[0]]),/only once/);
});
test('saved SKU cards collapse, with one open editor and visible commissioned speed in each cost centre',()=>{
 const ui=read('src/org/PlnCostCenterSkuSetup.tsx');
 assert.ok(ui.includes("const [openSku,setOpenSku]=useState('')"));
 assert.ok(ui.includes("setOpenSku(next.id)"));
 assert.ok(ui.includes("setOpenSku('')"));
 assert.ok(ui.includes("aria-expanded={expanded}"));
 assert.ok(ui.includes("rowKey=line.skuId"));
 assert.ok(ui.includes('Commissioned speed not yet configured'));
 assert.ok(ui.includes("setOpenSku(lines[first].skuId||'draft-'+first)"));
});
test('main manufactured SKU detail returns only scoped, configured manufacturing cost-centre speeds',()=>{
 const api=read('backend/plnCostCenterCapacity.ts');
 const master=read('src/org/ProductionFoundation.tsx');
 const view=read('src/org/PlnSkuCostCenterRatings.tsx');
 assert.ok(api.includes("'POST /api/org/pln/cost-center/sku-mappings'"));
 assert.ok(api.includes("!await authorized(ctx,'read',record.id)"));
 assert.ok(api.includes("sku.siteId!==location.siteId"));
 assert.ok(api.includes('validSavedProjection(ctx,location.siteId,row,params)'));
 assert.ok(api.includes("const perms=permission==='read'?['PLN.view','ADM.structure','MFG.view']"));
 assert.ok(master.includes('View SKU'));
 assert.ok(master.includes("<PlnSkuCostCenterRatings skuId={viewedSku.id}/>"));
 assert.ok(master.includes("<PlnSkuCostCenterRatings skuId={draft.id}/>"));
 assert.ok(view.includes('/api/org/pln/cost-center/sku-mappings'));
 assert.ok(view.includes('Commissioned primary-container speed'));
 assert.ok(view.includes('Equivalent physical containers'));
 assert.ok(view.includes('View container properties and linked output speeds'));
});
test('production tabs follow configuration precedence and retain scoped availability',()=>{
 const page=read('src/org/ProductionFoundation.tsx');
 const expected=['materialPolicy','skuSetup','items','boms','resources','costCenterSku','routings','config','demand'];
 const start=page.indexOf('const tabs:');
 const end=page.indexOf('const emptyRows:',start);
 const table=page.slice(start,end);
 assert.ok(start>0&&end>start);
 const actual=[...table.matchAll(/key:'(materialPolicy|skuSetup|items|boms|resources|costCenterSku|routings|config|demand)'/g)]
    .map(match=>match[1]);
 assert.deepEqual(actual,expected);
 assert.ok(page.includes('const visibleTabs=tabs.filter('));
 assert.ok(page.includes('module===\'PLN\'&&t.key===\'resources\'?false:canViewMasters'));
 assert.ok(page.includes('changeTab(visibleTabs[activeIndex+1].key)'));
});
test('mobile has a single accessible stage selector and desktop has grouped tabs',()=>{
 const page=read('src/org/ProductionFoundation.tsx');
 assert.ok(page.includes("aria-label='Production configuration sequence' className='sm:hidden"));
 assert.ok(page.includes("htmlFor='manufacturing-step-select'"));
 assert.ok(page.includes("id='manufacturing-step-select' value={active}"));
 assert.ok(page.includes('<optgroup'));
 assert.ok(page.includes('Previous</Button>'));
 assert.ok(page.includes('Next step</Button>'));
 assert.ok(page.includes("aria-label='Production configuration stages'"));
 assert.ok(!page.includes("className='flex gap-2 overflow-x-auto pb-1'"));
 assert.ok(page.includes("<details className='rounded-xl border border-line p-3'>"));
});
test('SKU configuration menus and cost-centre scope are compact without losing editing controls',()=>{
 const sku=read('src/org/MfgSkuSetup.tsx');
 const scope=read('src/org/PlnCostCenterSetup.tsx');
 assert.ok(sku.includes('menuGroups.map('));
 assert.ok(sku.includes('defaultOpen={i===0}'));
 assert.ok(sku.includes('group.keys.map(key=>'));
 assert.ok(sku.includes('onClick={()=>open(key)}'));
 assert.ok(scope.includes('showLocation||!cc'));
 assert.ok(scope.includes('Change cost centre'));
 assert.ok(scope.includes('setShowLocation(false)'));
 assert.ok(scope.includes('<PlnCostCenterSkuSetup key={cc} costCenterId={cc}/>'));
});
test('equipment and Asset Register pages remain free of planning configuration additions',()=>{
 const ast=read('src/org/AssetRegister.tsx'),equipment=read('src/org/WorkCenterAsset.tsx');
 assert.ok(!ast.includes('PlnAssetCapacityView'));
 assert.ok(!equipment.includes('PlnAssetCapacityView'));
 assert.ok(!read('backend/index.ts').includes('plnEquipmentCapacityRoutes'));
});
