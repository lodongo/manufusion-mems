import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster,detectBomCycle,fictionalLine11Demo,bomFamily,bomAlternative,materialUnitFactor} from '../../backend/plnMfgFoundation.ts';
import {managedCode,masterPrefix,skuUnitConversion,calculateSkuConversion,composeConfiguredSkuName,composeSkuNameWithSequence,skuNamingValues,normalizeSkuParameter,countUnitTotal,skuUnitCategories,skuUnitsInCategory,packagingPrimaryContainerCount} from '../../backend/mfgSkuModel.ts';
import {DEFAULT_SKU_NAMING_SEQUENCE,validateSkuNamingSequence,composeSkuNameFromSequence} from '../../src/shared/mfgSkuNaming.ts';
import {MFG_PACKAGING_TYPES,validatePackagingLayout,packagingHierarchyRank,normalizePackagingTypes} from '../../backend/mfgPackagingMetadata.ts';
import {selectEffectiveRelease,selectEffectiveForSite} from '../../backend/plnMfgRelease.ts';
import {defaultMfgMaterialPolicy,normalizeMfgMaterialPolicy} from '../../backend/mfgMaterialPolicy.ts';
import {fictionalPilotSnapshot,validateFictionalPilot,assertPilotSeedAllowed,assertPilotViewAllowed} from '../../backend/plnMfgPilotSeed.ts';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

test('valid SKU and resource masters are normalized without side effects',()=>{
 const sku=normalizeMaster('items',{id:'FG-WATER-500',name:'Water 500 mL',category:'FINISHED',uom:'CASE',packQty:12});
 assert.equal(sku.id,'FG-WATER-500');assert.equal(sku.category,'FINISHED');
 const res=normalizeMaster('resources',{id:'L11',name:'Line 11',type:'LINE',rate:28000,rateUom:'EA',efficiency:80});
 assert.equal(res.rate,28000);assert.equal(res.efficiency,80);
});

test('real raw and packaging materials require an Inventory master reference',()=>{
 for(const category of ['RAW','PACKAGING']){
  assert.throws(()=>normalizeMaster('items',{id:'RAW-WATER',name:'Water',category,uom:'L',packQty:1}),/Inventory material reference/);
 }
 assert.equal(normalizeMaster('items',{id:'CAP-2622',name:'Cap',category:'PACKAGING',uom:'EA',packQty:1,inventoryMaterialId:'MAT-2622'}).inventoryMaterialId,'MAT-2622');
});

test('manufacturing material handling policy has no industry labels or preset selectors',()=>{
 const p=defaultMfgMaterialPolicy();
 assert.deepEqual(Object.keys(p).sort(),['allowRawDirect','allowRawUtility','allowPackagingDirect','defaultIntermediateTracking'].sort());
 assert.equal(p.defaultIntermediateTracking,'NON_STOCKED');
 const configured=normalizeMfgMaterialPolicy({allowRawUtility:false,allowRawDirect:true,
  allowPackagingDirect:true,defaultIntermediateTracking:'STOCKED',
  industry:'SECTOR_EXAMPLE',variantLabel:'Obsolete label',manufacturingBomLabel:'Obsolete BOM label'});
 assert.equal(configured.allowRawDirect,true);
 assert.equal(configured.defaultIntermediateTracking,'STOCKED');
 for(const key of ['industry','variantLabel','manufacturingBomLabel','packagingBomLabel'])
    assert.equal(Object.hasOwn(configured,key),false);
 assert.throws(()=>normalizeMfgMaterialPolicy({allowPackagingDirect:'yes'}),/Invalid material handling/);
 assert.throws(()=>normalizeMfgMaterialPolicy({defaultIntermediateTracking:'OTHER'}),/intermediate tracking/);
});
test('universal manufacturing UI contains neither sector suggestions nor embedded pilot screens',()=>{
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.ok(!ui.includes('Optional terminology example'));
 assert.ok(!ui.includes('Industry profile'));
 assert.ok(!ui.includes('industryLabels'));
 assert.ok(!ui.includes('Line 11 Pilot Preview'));
 assert.ok(!ui.includes("active==='demo'"));
 assert.ok(!ui.includes('Earlier RECIPE'));
 assert.ok(ui.includes('Manufacturing material handling'));
 assert.ok(ui.includes("['MANUFACTURING','Manufacturing BOM']"));
 assert.ok(ui.includes('Materials & Products'));
 const home=read('src/org/OrgHomePage.tsx');
 assert.ok(home.includes("Materials, BOMs & routings"));
 assert.ok(!home.includes("Products, BOMs, recipes & routings"));
 assert.ok(!read('src/org/MfgSkuSetup.tsx').includes("recipes:'RCP'"));
 const backend=read('backend/plnMfgFoundation.ts');
 assert.ok(backend.includes('/foundation/material-policy/save'));
 assert.ok(backend.includes('normalizeMaster'));
});
test('raw and packaging direct consumption can be classified without stock ledger items',()=>{
 const label={id:'LBL-01',name:'Shoe label',category:'PACKAGING',sourceMode:'DIRECT',uom:'EA'};
 assert.equal(normalizeMaster('items',label).stockPolicy,'DIRECT');
 assert.equal(normalizeMaster('items',{...label,category:'RAW'}).sourceMode,'DIRECT');
 assert.throws(()=>normalizeMaster('items',{...label,sourceMode:'UTILITY',utilityCode:'WATER',utilityWorkCenterId:'WC-01'}),/Packaging components/);
 assert.equal(normalizeMaster('items',{...label,sourceMode:'INVENTORY',inventoryMaterialId:'MAT-01'}).stockPolicy,'STOCKED');
});
test('BOM supports two new classifications and preserves historical types',()=>{
 const formula={id:'BOM-FLAVOR',name:'Orange base',type:'FLAVOR_VARIANT',flavorVariantId:'NME_000000001',parentSkuId:'BULK',outputQty:1000,outputUom:'L',components:[{skuId:'WATER',quantity:1000,uom:'L'}]};
 const pack={...formula,id:'BOM-PACK',name:'Orange case',type:'PACKAGING',parentSkuId:'FG',components:[{skuId:'BOTTLE',quantity:1,uom:'EA'}]};
 assert.equal(normalizeMaster('boms',formula).type,'MANUFACTURING');
 assert.equal(normalizeMaster('boms',{...formula,type:'MANUFACTURING'}).type,'MANUFACTURING');
 assert.equal(normalizeMaster('boms',pack).type,'PACKAGING');
 assert.equal(normalizeMaster('boms',{...formula,productVariantId:'',flavorVariantId:undefined}).productVariantId,'');
 assert.equal(normalizeMaster('boms',formula).productVariantId,'NME_000000001');
 assert.equal(Object.hasOwn(normalizeMaster('boms',formula),'flavorVariantId'),false);
 assert.equal(normalizeMaster('boms',{...pack,type:'BOM'}).type,'PACKAGING');
 assert.equal(normalizeMaster('boms',{...formula,type:'RECIPE'}).type,'MANUFACTURING');
});
test('Fanta formulation can be flavor-neutral and intermediates can be non-stock or stocked',()=>{
 const base={id:'SIMPLE-SYRUP',name:'Common syrup',category:'INTERMEDIATE',uom:'L',packQty:1};
 assert.equal(normalizeMaster('items',base).stockPolicy,'NON_STOCKED');
 assert.equal(normalizeMaster('items',{...base,stockPolicy:'STOCKED',inventoryMaterialId:'INV-SYRUP'}).stockPolicy,'STOCKED');
 assert.throws(()=>normalizeMaster('items',{...base,stockPolicy:'STOCKED'}),/Inventory material/);
 assert.throws(()=>normalizeMaster('items',{...base,stockPolicy:'INVALID'}),/stock policy/);
 assert.equal(normalizeMaster('boms',{id:'BOM-COMMON',name:'Simple syrup',type:'FLAVOR_VARIANT',
  parentSkuId:'SIMPLE-SYRUP',outputQty:1000,outputUom:'L',
  components:[{skuId:'SUGAR',quantity:500,uom:'KG'}]}).productVariantId,'');
});
test('Metered utility is an auditable input distinct from an Inventory issue',()=>{
 const water={id:'WATER-01',name:'Treated water',category:'RAW',uom:'L',sourceMode:'UTILITY',
   utilityCode:'WATER',utilityWorkCenterId:'WC-SYRUP'};
 assert.equal(normalizeMaster('items',water).stockPolicy,'METERED');
 assert.throws(()=>normalizeMaster('items',{...water,utilityWorkCenterId:''}),/Utility work center/);
 assert.throws(()=>normalizeMaster('items',{...water,inventoryMaterialId:'MAT-WATER'}),/cannot simultaneously/);
 assert.throws(()=>normalizeMaster('items',{...water,sourceMode:'INVENTORY',utilityCode:'',utilityWorkCenterId:''}),/Inventory material/);
});
test('BOM alternatives and one-character material units use validated dimensional conversions',()=>{
 assert.equal(bomAlternative(undefined),'STANDARD');
 assert.equal(bomAlternative('line_a'),'LINE_A');
 assert.equal(bomFamily('RECIPE'),'MANUFACTURING');
 assert.equal(bomFamily('FLAVOR_VARIANT'),'MANUFACTURING');
 assert.equal(bomFamily('MANUFACTURING'),'MANUFACTURING');
 assert.equal(bomFamily('BOM'),'PACKAGING');
 assert.equal(materialUnitFactor('L','L'),1);
 assert.ok(materialUnitFactor('L','mL')>0);
 assert.throws(()=>materialUnitFactor('L','KG'),/Incompatible material units/);
 const row={id:'BOM-RTD',name:'Prepared Fanta',type:'FLAVOR_VARIANT',parentSkuId:'RTD',
    alternativeCode:'line_a',outputQty:1000,outputUom:'L',components:[{skuId:'CONCENTRATE',quantity:100,uom:'L'}]};
 assert.equal(normalizeMaster('boms',row).alternativeCode,'LINE_A');
 assert.equal(normalizeMaster('boms',row).components[0].uom,'L');
});
test('Release selection requires explicit BOM category and alternative to avoid accidental mixing',()=>{
 const release=read('backend/plnMfgRelease.ts');
 assert.ok(release.includes('requiresSelection:options.length>1'));
 assert.ok(release.includes("bomFamily(str(other.data.type))===bomFamily(str(doc.data.type))"));
 assert.ok(release.includes("bomAlternative(doc.data.alternativeCode)"));
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.ok(ui.includes('BOM alternative code'));
 assert.ok(ui.includes('Intermediate tracking'));
 assert.ok(ui.includes('Adopted equipment utility supply'));
 assert.ok(ui.includes('Component unit'));
});

test('BOM graph includes both categories when parent is shared',()=>{
 const boms=[{parentSkuId:'PACKED',components:[{skuId:'BULK'}]},{parentSkuId:'PACKED',components:[{skuId:'CAP'}]},{parentSkuId:'BULK',components:[{skuId:'WATER'}]}];
 assert.equal(detectBomCycle(boms,'WATER',[{skuId:'PACKED'}]),true);
});

test('BOM structures reject zero quantities, duplicate components and immediate cycles',()=>{
 const baseline={id:'BOM-01',name:'Water case',type:'BOM',parentSkuId:'FG-WATER',outputQty:1,outputUom:'CASE'};
 const comp={skuId:'CAP-2622',quantity:12,uom:'EA',scrapPct:1};
 assert.equal(normalizeMaster('boms',{...baseline,components:[comp]}).type,'PACKAGING');
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[comp,comp]}),/Duplicate component/);
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[{...comp,quantity:0}]}),/greater than zero/);
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[{...comp,skuId:'FG-WATER'}]}),/consume itself/);
});

test('detects transitive cycle in multi-level BOM and tolerates a DAG',()=>{
 const boms=[
  {parentSkuId:'FG',components:[{skuId:'FILL'}]},
  {parentSkuId:'FILL',components:[{skuId:'BOTTLE'},{skuId:'BEVERAGE'}]},
  {parentSkuId:'BOTTLE',components:[{skuId:'PREFORM'}]},
 ];
 assert.equal(detectBomCycle(boms,'BEVERAGE',[{skuId:'RAW-WATER'}]),false);
 assert.equal(detectBomCycle(boms,'BEVERAGE',[{skuId:'FG'}]),true);
});

test('routing stages must be unique and refer to a manufacturing resource',()=>{
 const base={id:'ROUTE-01',name:'Line 11',skuId:'FG-WATER'};
 const o={code:'FILL',name:'Filling',resourceId:'L11',setupMinutes:15,runMinutesPerUnit:0.002};
 assert.equal(normalizeMaster('routings',{...base,operations:[o]}).operations.length,1);
 assert.throws(()=>normalizeMaster('routings',{...base,operations:[o,o]}),/Duplicate operation/);
 const parallel=[{...o,code:'PREP',dependsOn:[],producesSkuId:'WATER'}, {...o,code:'BLOW',dependsOn:[],producesSkuId:'BOTTLE'}, {...o,code:'FILL',dependsOn:['PREP','BLOW'],producesSkuId:'FILLED'}];
 assert.equal(normalizeMaster('routings',{...base,operations:parallel}).operations.length,3);
 assert.throws(()=>normalizeMaster('routings',{...base,operations:[{...o,dependsOn:['FUTURE']}]}),/earlier stages/);
});

test('fictional pilot includes two FG SKUs, two routing options and full upstream recipe',()=>{
 const d=fictionalLine11Demo();
 assert.equal(d.demo,true);assert.equal(d.persisted,false);assert.equal(d.isolated,true);
 assert.equal(d.items.filter(x=>x.category==='FINISHED').length,2);
 assert.equal(d.routings.length,2);
 assert.deepEqual(d.routings[0].operations.find(x=>x.code==='FILL').dependsOn,['PREP','BLOW']);
 assert.ok(d.boms.some(x=>x.type==='RECIPE'));
 assert.ok(d.boms.some(x=>x.parentSkuId==='DEMO-PREPARED-WATER'));
 const parents=new Set(d.boms.map(x=>x.parentSkuId));
 assert.ok(parents.has('DEMO-FG-500')&&parents.has('DEMO-FG-1000'));
});

test('Phase 1 routes are tenant-guarded and there are no physical posting endpoints',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 for(const key of ['foundation/list','foundation/save','foundation/config'])assert.ok(src.includes(key));
 assert.ok(!src.includes("foundation/demo':["));
 assert.match(src,/orgRoute\('org\.mfg\.foundation\.save','MFG\.master\.edit'/);
 assert.ok(src.includes('updateTime:old!.updateTime'));
 assert.match(src,/commitChecked\(/);
 assert.match(src,/\+'\/revisions\/'/);
 assert.match(src,/foundation\/history/);
 assert.doesNotMatch(src,/\/api\/org\/(inventory\/issue|procurement\/po\/create)/);
 const gate=read('backend/transactionModuleGate.ts');
 assert.match(gate,/PLN:'PLN'/);
});

test('PLN and MFG have functional organization home and admin navigation',()=>{
 const shell=read('src/org/OrgShell.tsx'),home=read('src/org/OrgHomePage.tsx'),perms=read('backend/permissionPolicy.ts'),index=read('backend/index.ts');
 assert.match(shell,/case 'mfg_foundation'/);assert.match(shell,/case 'pln_foundation'/);
 assert.match(home,/path:'mfg_foundation'/);assert.match(home,/path:'pln_foundation'/);
 assert.match(perms,/MFG\.master\.edit/);assert.match(perms,/PLN\.configure/);
 assert.match(index,/\.\.\.plnMfgFoundationRoutes/);
});

test('approved versions honor effective dates and exclude unapproved drafts',()=>{
 const versions=[
    {id:'BOM-V1',status:'active',effectiveFrom:'2026-01-01',approvedAt:'2026-01-01'},
    {id:'BOM-V2',status:'active',effectiveFrom:'2027-01-01',approvedAt:'2026-12-01'},
    {id:'BOM-V3',status:'draft',effectiveFrom:'2026-02-01',approvedAt:'2026-02-01'},
 ];
 assert.equal(selectEffectiveRelease(versions,'2026-11-17')?.id,'BOM-V1');
 assert.equal(selectEffectiveRelease(versions,'2027-05-01')?.id,'BOM-V2');
 assert.equal(selectEffectiveRelease(versions,'2025-12-01'),null);
 assert.throws(()=>selectEffectiveRelease(versions,'not-a-date'),/Valid planning date/);
});

test('manufacturing release prevents editing of submitted and active versions',()=>{
 const source=read('backend/plnMfgFoundation.ts'),release=read('backend/plnMfgRelease.ts');
 assert.ok(source.includes("['pending_approval','active'].includes"));
 assert.ok(release.includes('Independent maker-checker approval is mandatory'));
 assert.ok(release.includes('ctx.uid===str(doc.data.createdBy)'));
 assert.ok(release.includes('referenceChecks(ctx,kind,doc.data,id)'));
 assert.ok(release.includes("status:'pending_approval'"));
 assert.ok(release.includes('commitChecked('));
 assert.ok(release.includes('effectiveFrom'));
 assert.ok(read('backend/index.ts').includes('...plnMfgReleaseRoutes'));
});

test('master-data reference checks preserve Inventory and Asset authority',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 assert.ok(src.includes("'/materials/'"));
 assert.ok(src.includes("'/assets/'"));
 assert.ok(src.includes('approved, numbered Inventory material'));
 assert.ok(src.includes('same site as the linked asset'));
 assert.ok(src.includes('materialUnitFactor(str(component.uom),str(child.data.uom))'));
});

test('isolated fictional Line 11 seeding is denied outside authorized development test mode',()=>{
 const d=fictionalPilotSnapshot();
 assert.equal(d.persisted,false);
 assert.equal(d.stock.length,8);assert.equal(d.demand.length,2);
 assert.throws(()=>assertPilotSeedAllowed(false,true,true,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,false,true,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,true,false,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,true,true,'anything else'),/exact confirmation/);
 assert.doesNotThrow(()=>assertPilotSeedAllowed(true,true,true,'SEED FICTIONAL LINE 11'));
 const src=read('backend/plnMfgPilotSeed.ts'),index=read('backend/index.ts');
 for(const args of [[false,true,true],[true,false,true],[true,true,false]])
   assert.throws(()=>assertPilotViewAllowed(...args),/restricted/);
 assert.doesNotThrow(()=>assertPilotViewAllowed(true,true,true));
 assert.ok(src.includes('mfg_demo_sandboxes'));
 assert.ok(src.includes('externalPostingEnabled:false'));
 assert.ok(src.includes('commitChecked(writes)'));
 assert.ok(!src.includes('/material_journal/')&&!src.includes('/purchase_orders/')&&!src.includes('/financial_journal/'));
 assert.ok(index.includes('...plnMfgPilotRoutes'));
});

test('effective dates are validated, not merely sliced',()=>{
 const valid={id:'BOM-DATED',name:'Dated BOM',type:'BOM',parentSkuId:'FG-WATER',outputQty:1,outputUom:'CASE',
    components:[{skuId:'CAP-2622',quantity:12,uom:'EA'}]};
 assert.equal(normalizeMaster('boms',{...valid,effectiveFrom:'2027-01-01'}).effectiveFrom,'2027-01-01');
 assert.throws(()=>normalizeMaster('boms',{...valid,effectiveFrom:'2027-02-30'}),/valid YYYY-MM-DD/);
 assert.throws(()=>normalizeMaster('boms',{...valid,effectiveFrom:'2027-13-01'}),/valid YYYY-MM-DD/);
});

test('approval locks unique SKU site and effectivity slot transactionally',()=>{
 const src=read('backend/plnMfgRelease.ts');
 assert.match(src,/mfg_release_slots/);
 assert.match(src,/slotKey/);
 assert.match(src,/precondition:\{exists:false\}/);
 assert.match(src,/ctx\.testMode===true/);
 assert.match(src,/ctx\.bypassed\?\.push\('mfg\.release\.independent_checker'\)/);
});

test('master-data selector lists published Inventory, active Assets and site records',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 assert.match(src,/foundation\/references/);
 assert.match(src,/organizations.*materials|orgRoot\+'\/materials'/);
 assert.match(src,/orgRoot\+'\/assets'/);
 assert.match(src,/status\)==='active'/);
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.match(ui,/Published Inventory Material Master/);
 assert.match(ui,/Active Asset Register equipment/);
 assert.match(ui,/Site applicability/);
});


test('fictional full multi-stage pilot graph is internally consistent',()=>{
 const sample=fictionalPilotSnapshot();
 assert.deepEqual(validateFictionalPilot(sample),[]);
 const broken=structuredClone(sample);
 broken.boms[0].components[0].skuId='MISSING-RAW';
 assert.ok(validateFictionalPilot(broken).some(x=>x.includes('missing component MISSING-RAW')));
 const mismatched=structuredClone(sample);
 mismatched.stock[0].uom='KG';
 assert.ok(validateFictionalPilot(mismatched).some(x=>x.includes('unit mismatch')));
 const badRouting=structuredClone(sample);
 badRouting.routings[0].operations[2].dependsOn=['UNCONFIGURED'];
 assert.ok(validateFictionalPilot(badRouting).some(x=>x.includes('invalid stage dependency')));
});

test('pilot verification reads sandbox documents without modifying operational masters',()=>{
 const backend=read('backend/plnMfgPilotSeed.ts');
 assert.ok(backend.includes('verifySeededFictionalPilot'));
 assert.ok(backend.includes("'/mfg_demo_sandboxes/'"));
 assert.ok(backend.includes('listDocs(root+'));
 assert.ok(backend.includes('isSubset(item,record.data)'));
 assert.ok(backend.includes("foundation/demo/verify"));
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.ok(!ui.includes('Verify stored pilot records'));
 assert.ok(!ui.includes('Pilot acceptance blocked'));
 assert.ok(backend.includes('verifySeededFictionalPilot'));
});


test('site-specific approved BOM selection overrides global only from effective date',()=>{
    const versions=[
        {id:'ORG-01',siteId:'',status:'active',effectiveFrom:'2026-01-01'},
        {id:'SITE-01',siteId:'SITE-11',status:'active',effectiveFrom:'2027-01-01'},
        {id:'SITE-DRAFT',siteId:'SITE-11',status:'draft',effectiveFrom:'2026-09-01'},
        {id:'OTHER-SITE',siteId:'SITE-99',status:'active',effectiveFrom:'2026-01-01'},
    ];
    assert.equal(selectEffectiveForSite(versions,'2026-11-17','SITE-11')?.id,'ORG-01');
    assert.equal(selectEffectiveForSite(versions,'2027-01-01','SITE-11')?.id,'SITE-01');
    assert.equal(selectEffectiveForSite(versions,'2027-01-01','SITE-88')?.id,'ORG-01');
    assert.equal(selectEffectiveForSite(versions,'2027-01-01','')?.id,'ORG-01');
    const source=read('backend/plnMfgRelease.ts');
    assert.ok(source.includes('foundation/effective'));
    assert.ok(source.includes("authorized(ctx,'MFG.view',siteId)"));
});


test('all new manufacturing master and batch prefixes use nine-digit generated codes',()=>{
    assert.equal(managedCode('SKU',1),'SKU_000000001');
    assert.equal(managedCode('BTH',24),'BTH_000000024');
    assert.equal(managedCode('BOM',999999999),'BOM_999999999');
    assert.throws(()=>managedCode('BTH',1000000000),/exhausted/);
    assert.throws(()=>managedCode('XXXX',1),/invalid or exhausted/);
    assert.equal(masterPrefix('items'),'SKU');
    assert.equal(masterPrefix('boms','RECIPE'),'BOM');
    assert.equal(masterPrefix('boms','BOM'),'BOM');
    assert.equal(masterPrefix('resources'),'RSC');
    assert.equal(masterPrefix('routings'),'RTG');
});

const exampleParams=[
    {id:'NME_000000001',kind:'productNames',name:'Fanta'},
    {id:'FRM_000000001',kind:'productionForms',name:'Liquid beverage',uom:'L'},
    {id:'CNT_000000001',kind:'containers',name:'Bottle'},
    {id:'SIZ_000000001',kind:'containerSizes',name:'1000 mL',quantity:1000,uom:'mL'},
    {id:'PKG_000000001',kind:'packages',name:'Case',uom:'CASE'},
    {id:'PCT_000000001',kind:'packageCounts',name:'12',quantity:12},
    {id:'NRM_000000001',kind:'normalizationUnits',name:'Unit case',baseUom:'L',quantityPerUnit:5.678},
];
const exampleSelect={
    productNameId:'NME_000000001',productionFormId:'FRM_000000001',
    containerId:'CNT_000000001',containerSizeId:'SIZ_000000001',
    packageId:'PKG_000000001',packageCountId:'PCT_000000001',
    normalizationUnitId:'NRM_000000001',
};
test('Fanta 1000 mL bottle × 12 case derives liters and configurable unit cases',()=>{
    const result=calculateSkuConversion(exampleSelect,exampleParams);
    assert.equal(result.containerSizeInProductionUom,1);
    assert.equal(result.containersPerPackage,12);
    assert.equal(result.productionQtyPerPackage,12);
    assert.ok(Math.abs(result.conversionFactor-12/5.678)<1e-8);
    assert.ok(Math.abs(result.reverseConversionFactor-5.678/12)<1e-8);
    assert.equal(result.normalizationUom,'Unit case');
    assert.equal(composeConfiguredSkuName(exampleSelect,exampleParams),'Fanta · 1000 mL Bottle · Case x12');
});
test('SKU normalization accepts only organization-defined compatible physical units',()=>{
    assert.equal(skuUnitConversion('mL','L'),0.001);
    assert.equal(skuUnitConversion('kg','g'),1000);
    assert.equal(skuUnitConversion('L','kg'),null);
    assert.equal(skuUnitConversion('INVALID_UOM','INVALID_UOM'),null);
    const broken=exampleParams.map(x=>({...x}));
    broken.find(x=>x.kind==='normalizationUnits').baseUom='kg';
    assert.throws(()=>calculateSkuConversion(exampleSelect,broken),/incompatible|must match the product form dimension/);
    const disabled=exampleParams.map(x=>({...x}));
    disabled.find(x=>x.kind==='packageCounts').enabled=false;
    assert.throws(()=>calculateSkuConversion(exampleSelect,disabled),/active, configured/);
    assert.throws(()=>normalizeSkuParameter('packageCounts',{name:'Ten and half',unitCode:'UOM-20-001',unitCount:10.5}),/whole number/);
});
test('SKU setup and autogenerated numbering use guarded database counters',()=>{
    const src=read('backend/mfgSkuConfiguration.ts');
    assert.ok(src.includes('mfg_code_sequences'));
    assert.ok(src.includes('commitChecked(writes)'));
    assert.ok(src.includes('mfg_batch_identifiers'));
    assert.ok(src.includes("id=>PARAMS(ctx.orgId)+'/'+id"));
    assert.ok(src.includes("orgRoute('org.mfg.sku.setup.save','MFG.sku.configure'"));
    const foundation=read('backend/plnMfgFoundation.ts');
    assert.ok(foundation.includes('commitGeneratedCode(ctx.orgId,prefix'));
    assert.ok(foundation.includes('calculateSkuConversion(selected,configured)'));
    assert.ok(foundation.includes("code:'STG_'+String(i+1).padStart(9,'0')"));
    const ui=read('src/org/ProductionFoundation.tsx');
    assert.ok(ui.includes('SkuConfigurationFields'));
    assert.ok(ui.includes('SkuSetupPanel'));
    assert.ok(ui.includes('SelectField'));
    assert.ok(ui.includes('Must follow these stages'));
    const form=read('src/org/MfgSkuSetup.tsx');
    assert.ok(form.includes('Choice'));
    assert.ok(form.includes('Normalized unit cases per commercial package:'));
});



test('MFG platform primary-container metadata is coded, industry-spanning and has at most five dropdown attributes',async()=>{
 const mod=await import('../../backend/mfgPrimaryContainerMetadata.ts');
 const types=mod.MFG_PRIMARY_CONTAINER_TYPES;
 assert.ok(types.length>=100);
 for(const code of ['GLA','PET','POL','MET','PAP','FLX','COM','CER','WOD','BUL','MED','ELC','TEX','COS'])
     assert.ok(types.some(t=>t.categoryCode===code),code);
 for(const type of types){
     assert.match(type.code,/^[A-Z]{3}_\d{3}$/);
     assert.ok(type.subcategoryCode);
     assert.ok(type.attributes.length<=5);
     for(const attribute of type.attributes)assert.ok(attribute.choices.length>=2);
 }
 const bottle=types.find(t=>t.name==='PET bottle');
 assert.ok(bottle);
 const required=Object.fromEntries(bottle.attributes.filter(a=>a.required).map(a=>[a.key,a.choices[0]]));
 const normalized=normalizeSkuParameter('containers',{metadataCode:bottle.code,containerAttributes:required});
 assert.equal(normalized.name,'PET bottle');assert.equal(normalized.metadataCode,bottle.code);
 assert.equal(normalized.categoryCode,'PET');
 assert.throws(()=>normalizeSkuParameter('containers',{metadataCode:bottle.code,containerAttributes:{}}),/Select/);
 assert.throws(()=>normalizeSkuParameter('containers',{metadataCode:bottle.code,containerAttributes:{closure:'imaginary'}}),/Invalid|Select/);
 assert.throws(()=>normalizeSkuParameter('containers',{metadataCode:'UNKNOWN',containerAttributes:{}}),/published/);
});
test('product / SKU name has manually assigned business code, name and description',()=>{
 const product=normalizeSkuParameter('productNames',{name:'Fanta',productCode:'fan.ta-100',description:'Orange carbonated beverage'});
 assert.equal(product.productCode,'FAN.TA-100');
 assert.equal(product.name,'Fanta');
 assert.equal(product.description,'Orange carbonated beverage');
 assert.throws(()=>normalizeSkuParameter('productNames',{name:'Fanta',productCode:''}),/Product\/Variant code/);
 assert.throws(()=>normalizeSkuParameter('productNames',{name:'Fanta',productCode:'bad code'}),/Product\/Variant code/);
 const source=read('backend/mfgSkuConfiguration.ts');
 assert.ok(source.includes('The Product/Variant code is already in use'));
});
test('container packaging uses MEMS units and numeric packaging sizes need no description',()=>{
 const packageRecord=normalizeSkuParameter('packages',{name:'Case',uom:'UOM-20-001',description:'Secondary packaging unit'});
 assert.equal(packageRecord.uom,'UOM-20-001');
 assert.equal(packageRecord.description,'Secondary packaging unit');
 assert.throws(()=>normalizeSkuParameter('packages',{name:'Case',uom:'CUSTOM_UNIT'}),/MEMS Units master/);
 for(const n of [6,12,24]){
     const size=normalizeSkuParameter('packagingSizes',{quantity:n});
     assert.equal(size.quantity,n);
     assert.equal(size.name,String(n));
     assert.equal(size.description,'');
 }
 assert.throws(()=>normalizeSkuParameter('packagingSizes',{quantity:4.5}),/positive whole number/);
 const params=[...exampleParams.map(p=>({...p,kind:p.kind==='packageCounts'?'packagingSizes':p.kind}))];
 const selections={...exampleSelect,packagingSizeId:'PCT_000000001',packageCountId:''};
 assert.equal(calculateSkuConversion(selections,params).productionQtyPerPackage,12);
});
test('SKU setup has distinct commercial and transport menus with metadata-backed choices',()=>{
 const ui=read('src/org/MfgSkuSetup.tsx');
 assert.ok(ui.includes("title:'Commercial Packaging'"));
 assert.ok(ui.includes("title:'Transport & Logistics Packaging'"));
 assert.ok(ui.includes("title:'Commercial Packaging Sizes'"));
 assert.ok(ui.includes("title:'Physical Containers'"));
 assert.ok(ui.includes('Container subcategory / type'));
 assert.ok(ui.includes('metadataType.attributes.slice(0,5)'));
 assert.ok(ui.includes("active==='packagingSizes'"));
 assert.ok(ui.includes("variantLabel+' code'"));
 assert.ok(ui.includes("variantLabel+' name'"));
 assert.ok(!ui.includes("key:'units'"));
 assert.ok(!ui.includes("title:'Package Containment'"));
 assert.ok(ui.includes('Back to SKU configuration menu'));
 const page=read('src/org/ProductionFoundation.tsx');
 assert.ok(!page.includes('Phase 1 foundation · universal multi-stage production model'));
 assert.ok(page.includes("active!=='skuSetup'"));
 const backend=read('backend/mfgSkuConfiguration.ts');
 assert.ok(backend.includes('primaryContainerMetadata'));
 assert.ok(backend.includes('primaryContainerCatalogueFromAdmin'));
 assert.ok(read('backend/moduleDefaults.ts').includes("key:'primaryContainers'"));
 assert.ok(read('src/admin/ModulesPage.tsx').includes('MfgContainerMetadataBrowser'));
});


test('packaging platform metadata spans retail, pallet, bulk and transport logistics',()=>{
 const cats=new Set(MFG_PACKAGING_TYPES.map(x=>x.category));
 for(const name of ['Secondary / retail packaging','Tertiary / consolidated packaging','Pallets and unit loads','Transport and logistics','Bulk and densified loads','Returnable and reverse logistics'])
     assert.ok(cats.has(name),name);
 assert.ok(MFG_PACKAGING_TYPES.length>=85);
 assert.ok(MFG_PACKAGING_TYPES.some(p=>p.name==='Plastic pallet'));
 assert.ok(MFG_PACKAGING_TYPES.some(p=>p.name==='Roll cage'));
 assert.ok(MFG_PACKAGING_TYPES.some(p=>p.name==='Intermediate bulk container')===false); // IBC is a primary bulk container, not the load
 for(const x of MFG_PACKAGING_TYPES){
     assert.match(x.code,/^[A-Z]{3}_\d{3}$/);
     assert.ok(x.name&&x.category&&x.level);
     assert.ok(['PRIMARY','PACKAGING'].includes(x.containedUnit));
 }
 assert.equal(normalizePackagingTypes(undefined).length,MFG_PACKAGING_TYPES.length);
 assert.ok(read('backend/moduleDefaults.ts').includes("key:'packagingTypes'"));
 assert.ok(read('backend/mfgSkuConfiguration.ts').includes("metadata/packagingTypes"));
});
test('secondary cases derive total from containers per layer and number of layers',()=>{
 const caseType=MFG_PACKAGING_TYPES.find(p=>p.name==='Corrugated case');
 assert.ok(caseType);
 const normalized=normalizeSkuParameter('packages',{name:'12-bottle case',packagingTypeCode:caseType.code,
     description:'12 x 1 L glass bottles',containersPerLayer:6,numberOfLayers:2},undefined,MFG_PACKAGING_TYPES);
 assert.equal(normalized.name,'12-bottle case');
 assert.equal(normalized.quantity,12);
 assert.equal(normalized.containedUnit,'PRIMARY');
 assert.equal(normalized.containersPerLayer,6);
 assert.equal(normalized.numberOfLayers,2);
 assert.equal(normalized.uom,caseType.defaultUnitCode);
 assert.equal(normalized.description,'12 x 1 L glass bottles');
 assert.throws(()=>validatePackagingLayout({packagingTypeCode:caseType.code,containersPerLayer:0,numberOfLayers:2}),/positive whole number/);
 assert.throws(()=>validatePackagingLayout({packagingTypeCode:caseType.code,containersPerLayer:12,numberOfLayers:1.5}),/positive whole number/);
 assert.throws(()=>validatePackagingLayout({packagingTypeCode:'NOPE',containersPerLayer:12,numberOfLayers:1}),/published/);
});
test('pallet of cases and bulk consolidation do not double-count the unit level',()=>{
 const caseType=MFG_PACKAGING_TYPES.find(p=>p.name==='Corrugated case');
 const palletType=MFG_PACKAGING_TYPES.find(p=>p.name==='Wooden pallet');
 const freightType=MFG_PACKAGING_TYPES.find(p=>p.name==='Shipping container unit load');
 const caseRow={id:'PKG_000000101',...normalizeSkuParameter('packages',{
     packagingTypeCode:caseType.code,name:'12-bottle case',containersPerLayer:12,numberOfLayers:1},undefined,MFG_PACKAGING_TYPES)};
 // Historical packaging records created before SKU-level stacking remain readable.
 const palletRow={id:'PKG_000000102',name:'50-case pallet',kind:'packages',...validatePackagingLayout({
     packagingTypeCode:palletType.code,containersPerLayer:10,numberOfLayers:5,
     containedPackagingId:caseRow.id},MFG_PACKAGING_TYPES)};
 const freightRow={id:'PKG_000000103',name:'6-pallet freight load',kind:'packages',...validatePackagingLayout({
     packagingTypeCode:freightType.code,containersPerLayer:3,numberOfLayers:2,
     containedPackagingId:palletRow.id},MFG_PACKAGING_TYPES)};
 const records=[...exampleParams,caseRow,palletRow,freightRow];
 assert.equal(packagingPrimaryContainerCount(caseRow,records),12);
 assert.equal(packagingPrimaryContainerCount(palletRow,records),600);
 assert.equal(packagingPrimaryContainerCount(freightRow,records),3600);
 assert.equal(packagingHierarchyRank(caseType.code),1);
 assert.ok(packagingHierarchyRank(caseType.code)<packagingHierarchyRank(palletType.code));
 assert.ok(packagingHierarchyRank(palletType.code)<packagingHierarchyRank(freightType.code));
 const result=calculateSkuConversion({...exampleSelect,packageId:palletRow.id,
     packagingSizeId:undefined,packageCountId:undefined},records);
 assert.equal(result.containersPerPackage,600);
 assert.equal(result.productionQtyPerPackage,600);
 assert.throws(()=>packagingPrimaryContainerCount({...caseRow,containedUnit:'PACKAGING',
     containedPackagingId:palletRow.id},records),/Circular packaging/);
 assert.throws(()=>validatePackagingLayout({packagingTypeCode:palletType.code,
     containersPerLayer:10,numberOfLayers:5}),/lower-level/);
 const code=read('backend/mfgSkuConfiguration.ts');
 assert.ok(code.includes('packagingHierarchyRank'));
 assert.ok(code.includes('packagingPrimaryContainerCount'));
});
test('commercial and transport master packaging are distinct but use one MEMS catalogue',()=>{
 const caseType=MFG_PACKAGING_TYPES.find(p=>p.name==='Corrugated case');
 const palletType=MFG_PACKAGING_TYPES.find(p=>p.name==='Wooden pallet');
 const commercial=normalizeSkuParameter('packages',{name:'Selling case',description:'Case for customers',
     packagingTypeCode:caseType.code},undefined,MFG_PACKAGING_TYPES);
 const logistics=normalizeSkuParameter('transportPackages',{name:'Transport pallet',description:'Reusable pallet',
     packagingTypeCode:palletType.code},undefined,MFG_PACKAGING_TYPES);
 assert.equal(commercial.quantity,undefined);
 assert.equal(commercial.level,'SECONDARY');
 assert.equal(logistics.quantity,undefined);
 assert.equal(logistics.level,'TRANSPORT');
 assert.equal(logistics.name,'Transport pallet');
 // Commercial and logistics classification is configurable even for identical
 // package types; physical metadata does not dictate the business role.
 assert.equal(normalizeSkuParameter('packages',{name:'Pallet sold as a unit',packagingTypeCode:palletType.code},
     undefined,MFG_PACKAGING_TYPES).level,'TRANSPORT');
 assert.equal(normalizeSkuParameter('transportPackages',{name:'Case used in logistics',packagingTypeCode:caseType.code},
     undefined,MFG_PACKAGING_TYPES).level,'SECONDARY');
 assert.throws(()=>normalizeSkuParameter('transportPackages',{name:'No type'},
     undefined,MFG_PACKAGING_TYPES),/published transport packaging/);
 assert.ok(read('backend/mfgSkuConfiguration.ts').includes("kind==='transportPackages'"));
 assert.ok(read('backend/mfgSkuModel.ts').includes("transportPackages:'TLP'"));
});
test('SKU-specific optional stacking correctly converts cases on pallets without changing commercial conversion',()=>{
 const caseType=MFG_PACKAGING_TYPES.find(p=>p.name==='Corrugated case');
 const palletType=MFG_PACKAGING_TYPES.find(p=>p.name==='Wooden pallet');
 const commerce={id:'PKG_000000201',kind:'packages',...normalizeSkuParameter('packages',{
     name:'Selling case',packagingTypeCode:caseType.code},undefined,MFG_PACKAGING_TYPES)};
 const transport={id:'TLP_000000201',kind:'transportPackages',...normalizeSkuParameter('transportPackages',{
     name:'Shipping pallet',packagingTypeCode:palletType.code},undefined,MFG_PACKAGING_TYPES)};
 const size={id:'PSZ_000000201',kind:'packagingSizes',...normalizeSkuParameter('packagingSizes',{quantity:12})};
 const params=[...exampleParams,commerce,transport,size];
 const basic={...exampleSelect,packageId:commerce.id,packageCountId:'',packagingSizeId:size.id};
 const noTransport=calculateSkuConversion(basic,params);
 assert.equal(noTransport.containersPerPackage,12);
 assert.equal(noTransport.productionQtyPerPackage,12);
 assert.equal(noTransport.commercialPackagesPerTransportUnit,null);
 const withLayers=calculateSkuConversion({...basic,transportPackageId:transport.id,
     transportLayeringEnabled:true,transportPackagesPerLayer:10,transportLayerCount:5},params);
 assert.equal(withLayers.commercialPackagesPerTransportUnit,50);
 assert.equal(withLayers.primaryContainersPerTransportUnit,600);
 assert.equal(withLayers.productionQtyPerTransportUnit,600);
 assert.ok(Math.abs(withLayers.normalizationUnitsPerTransportUnit-600/5.678)<1e-8);
 assert.equal(withLayers.productionQtyPerPackage,12);
 const unlayered=calculateSkuConversion({...basic,transportPackageId:transport.id,
     transportUnitsPerLoad:50},params);
 assert.equal(unlayered.primaryContainersPerTransportUnit,600);
 assert.equal(unlayered.transportLayeringEnabled,false);
 assert.throws(()=>calculateSkuConversion({...basic,transportPackageId:transport.id,
     transportLayeringEnabled:true,transportPackagesPerLayer:10,transportLayerCount:0},params),/Number of layers/);
 assert.throws(()=>calculateSkuConversion({...basic,transportUnitsPerLoad:50},params),/Select a transport packaging/);
 assert.throws(()=>calculateSkuConversion({...basic,transportPackageId:transport.id,transportUnitsPerLoad:1.5},params),/positive whole number/);
});
test('SKU configuration menus separate selling packs and logistics, with layering only at SKU creation',()=>{
 const ui=read('src/org/MfgSkuSetup.tsx');
 for(const label of ['Commercial Packaging','Transport & Logistics Packaging','Commercial Packaging Sizes',
     'Enable layered stacking','Commercial packages per layer','Number of layers',
     'Commercial packages per transport unit','Packaging category','Packaging type'])
     assert.ok(ui.includes(label),label);
 assert.ok(ui.includes("level==='SECONDARY'"));
 assert.ok(ui.includes('transportPackageId'));
 assert.ok(!ui.includes("title='Contained packaging (lower level)'"));
 const backend=read('backend/plnMfgFoundation.ts');
 assert.ok(backend.includes('transportPackagesPerLayer'));
 assert.ok(backend.includes('transportLayerCount'));
 assert.ok(backend.includes('transportUnitsPerLoad'));
});

test('previously saved transport layers under commercial masters remain backward compatible',()=>{
 const old=MFG_PACKAGING_TYPES.find(t=>t.name==='Wooden pallet');
 const saved=normalizeSkuParameter('packages',{
     id:'PKG_000000020',name:'Old pallet master',packagingTypeCode:old.code,
     containersPerLayer:8,numberOfLayers:5,containedPackagingId:'PKG_000000019',
 },undefined,MFG_PACKAGING_TYPES);
 assert.equal(saved.quantity,40);
 assert.equal(saved.containedUnit,'PACKAGING');
 assert.equal(saved.containersPerLayer,8);
});


test('production-volume reference normalized unit case is commercial package volume divided by production-form reference',()=>{
 const params=structuredClone(exampleParams);
 const ref=params.find(p=>p.kind==='normalizationUnits');
 ref.referenceProductionFormId='FRM_000000001';
 const result=calculateSkuConversion(exampleSelect,params);
 assert.equal(result.productionUom,'L');
 assert.equal(result.productionQtyPerPackage,12);
 assert.equal(result.normalizationReferenceUom,'L');
 assert.equal(result.referenceQtyPerNormalizedUnit,5.678);
 assert.ok(Math.abs(result.normalizedUnitsPerCommercialPackage-12/5.678)<1e-10);
 assert.equal(result.normalizedUnitsPerCommercialPackage,result.conversionFactor);
 assert.ok(Math.abs(result.reverseConversionFactor-5.678/12)<1e-10);
 assert.equal(result.normalizationUnitsPerTransportUnit,null);
 // A 24-pack of 500 mL is also 12 L and must normalize identically.
 const smaller=structuredClone(params);
 smaller.find(p=>p.kind==='containerSizes').quantity=500;
 smaller.find(p=>p.kind==='packageCounts').quantity=24;
 const half=calculateSkuConversion(exampleSelect,smaller);
 assert.equal(half.productionQtyPerPackage,12);
 assert.equal(half.normalizedUnitsPerCommercialPackage,result.normalizedUnitsPerCommercialPackage);
});

test('reference production form must exist, be active and share compatible dimension with SKU production form',()=>{
 const configured=structuredClone(exampleParams);
 configured.find(p=>p.kind==='normalizationUnits').referenceProductionFormId='FRM_DOES_NOT_EXIST';
 assert.throws(()=>calculateSkuConversion(exampleSelect,configured),/active, configured/);
 const mismatched=structuredClone(exampleParams);
 mismatched.push({id:'FRM_000000007',kind:'productionForms',name:'Solid mass',uom:'kg'});
 mismatched.find(p=>p.kind==='normalizationUnits').referenceProductionFormId='FRM_000000007';
 mismatched.find(p=>p.kind==='normalizationUnits').baseUom='kg';
 assert.throws(()=>calculateSkuConversion(exampleSelect,mismatched),/Normalization reference must match/);
 const ui=read('src/org/MfgSkuSetup.tsx');
 assert.ok(ui.includes('Reference production form'));
 assert.ok(ui.includes('Reference quantity per normalized unit'));
 assert.ok(ui.includes('Normalized unit cases per commercial package'));
 const api=read('backend/mfgSkuConfiguration.ts');
 assert.ok(api.includes("kind==='normalizationUnits'"));
 assert.ok(api.includes("input.baseUom=refForm.uom"));
 assert.ok(api.includes('Select a production form to define the normalized case reference'));
});

test('SKU reference form, reference quantity and commercial normalization are persisted together',()=>{
 const backend=read('backend/mfgSkuModel.ts');
 assert.ok(backend.includes('referenceProductionFormId'));
 assert.ok(backend.includes('normalizedUnitsPerCommercialPackage:round(factor)'));
 assert.ok(backend.includes('normalizationReferenceUom:normalizedReferenceUom'));
 assert.ok(backend.includes('referenceQtyPerNormalizedUnit:'));
 const foundation=read('backend/plnMfgFoundation.ts');
 assert.ok(foundation.includes('raw.skuConversion=result'));
});


test('normalization operator Divide and Multiply use explicit, equivalent reference definitions',()=>{
 const dividing=structuredClone(exampleParams);
 const normalized=dividing.find(p=>p.kind==='normalizationUnits');
 normalized.referenceProductionFormId='FRM_000000001';
 normalized.normalizationOperator='DIVIDE';normalized.quantityPerUnit=5.678;
 const divided=calculateSkuConversion(exampleSelect,dividing);
 assert.equal(divided.normalizationOperator,'DIVIDE');
 assert.equal(divided.normalizationOperand,5.678);
 assert.equal(divided.referenceQtyPerNormalizedUnit,5.678);
 assert.ok(Math.abs(divided.conversionFactor-12/5.678)<1e-10);
 const multiplying=structuredClone(dividing);
 multiplying.find(p=>p.kind==='normalizationUnits').normalizationOperator='MULTIPLY';
 multiplying.find(p=>p.kind==='normalizationUnits').quantityPerUnit=1/5.678;
 const multiplied=calculateSkuConversion(exampleSelect,multiplying);
 assert.equal(multiplied.normalizationOperator,'MULTIPLY');
 assert.ok(Math.abs(multiplied.referenceQtyPerNormalizedUnit-5.678)<1e-10);
 assert.ok(Math.abs(multiplied.conversionFactor-divided.conversionFactor)<1e-9);
 assert.ok(Math.abs(multiplied.productionQtyPerNormalizationUnit-5.678)<1e-9);
 const parameter=normalizeSkuParameter('normalizationUnits',{
    name:'Unit cases',baseUom:'L',quantityPerUnit:0.18,normalizationOperator:'MULTIPLY',
    referenceProductionFormId:'FRM_000000001',
 });
 assert.equal(parameter.normalizationOperator,'MULTIPLY');
 assert.throws(()=>normalizeSkuParameter('normalizationUnits',{
     name:'Case',baseUom:'L',quantityPerUnit:1,normalizationOperator:'SCALE',
 }),/Divide or Multiply/);
 const form=read('src/org/MfgSkuSetup.tsx');
 assert.ok(form.includes("title='Normalization operator'"));
 assert.ok(form.includes("'DIVIDE','Divide ( ÷ )'"));
 assert.ok(form.includes("'MULTIPLY','Multiply ( × )'"));
 assert.ok(!form.includes('Coca-Cola'));
});

test('SKU naming rule preserves order, approved separators and correct name/code/quantity representation',()=>{
 const params=structuredClone(exampleParams);
 params.find(p=>p.kind==='productNames').productCode='FANTA';
 params.find(p=>p.kind==='containers').metadataCode='PET_001';
 const converted=calculateSkuConversion(exampleSelect,params);
 const config=validateSkuNamingSequence({
     separator:'_',steps:[
         {field:'productName',mode:'CODE',enabled:true},
         {field:'containerSize',mode:'QUANTITY_UNIT',enabled:true},
         {field:'primaryContainer',mode:'CODE',enabled:true},
         {field:'commercialPackSize',mode:'QUANTITY',enabled:true},
         {field:'commercialPackaging',mode:'NAME',enabled:false},
     ],
 });
 assert.equal(composeSkuNameWithSequence(exampleSelect,params,config,converted),'FANTA_1000mL_PET_001_12');
 assert.equal(composeSkuNameFromSequence(config,skuNamingValues(exampleSelect,params,converted)),
     'FANTA_1000mL_PET_001_12');
 assert.equal(composeSkuNameFromSequence({...config,separator:'-'},skuNamingValues(exampleSelect,params,converted)),
     'FANTA-1000mL-PET_001-12');
 assert.throws(()=>validateSkuNamingSequence({...config,separator:'|||'}),/separator/);
 assert.equal(composeSkuNameFromSequence(
     {...config,steps:[config.steps[0],config.steps[0]]},
     skuNamingValues(exampleSelect,params,converted)),'FANTA_FANTA');
 assert.throws(()=>validateSkuNamingSequence({...config,steps:[
     {field:'productName',mode:'QUANTITY',enabled:true},
 ]}),/Name, Code or Quantity/);
 assert.throws(()=>validateSkuNamingSequence({...config,steps:config.steps.map(s=>({...s,enabled:false}))}),/at least one/);
 assert.deepEqual(validateSkuNamingSequence({...config,steps:[
     {field:'containerSize',mode:'NAME',enabled:true},
 ]}).steps,[{field:'containerSize',mode:'NAME',enabled:true}]);
 assert.equal(DEFAULT_SKU_NAMING_SEQUENCE.separator,'_');
});

test('naming rule covers optional transport layers and derived product and normalization quantities',()=>{
 const seq=validateSkuNamingSequence({separator:'/',steps:[
    {field:'productName',mode:'NAME',enabled:true},
    {field:'transportPackagesPerLayer',mode:'QUANTITY',enabled:true},
    {field:'transportLayerCount',mode:'QUANTITY',enabled:true},
    {field:'transportTotalUnits',mode:'QUANTITY',enabled:true},
    {field:'commercialProductQuantity',mode:'QUANTITY_UNIT',enabled:true},
    {field:'normalizedCommercialQuantity',mode:'QUANTITY',enabled:false},
 ]});
 const params=structuredClone(exampleParams);
 params.push({id:'TLP_000000012',kind:'transportPackages',name:'Transport skid'});
 const selections={...exampleSelect,transportPackageId:'TLP_000000012',
    transportLayeringEnabled:true,transportPackagesPerLayer:10,transportLayerCount:5};
 const result=calculateSkuConversion(selections,params);
 assert.equal(composeSkuNameWithSequence(selections,params,seq,result),
     'Fanta/10/5/50/12L');
 const without={...exampleSelect};
 const basic=calculateSkuConversion(without,params);
 assert.equal(composeSkuNameWithSequence(without,params,seq,basic),'Fanta/12L');
});

test('SKU naming configuration is org-versioned with guarded save and existing-SKU opt-in',()=>{
 const api=read('backend/mfgSkuConfiguration.ts');
 assert.ok(api.includes("foundation")===false||api.includes('sku/naming/save'));
 assert.ok(api.includes('mfg_sku_naming/config'));
 assert.ok(api.includes('namingSequenceForOrg'));
 assert.ok(api.includes('commitChecked([{'));
 assert.ok(api.includes("expectedRevision"));
 assert.ok(api.includes("org.mfg.sku.naming.save','MFG.sku.configure'"));
 const foundation=read('backend/plnMfgFoundation.ts');
 assert.ok(foundation.includes('naming.configured&&(creating||applySkuNamingSequence)'));
 assert.ok(foundation.includes('raw.skuNamingSnapshot'));
 assert.ok(foundation.includes('raw.name=str(old.data.name)'));
 const ui=read('src/org/MfgSkuSetup.tsx');
 assert.ok(ui.includes("title:'SKU Naming Sequence'"));
 assert.ok(ui.includes("title='Separator'"));
 assert.ok(ui.includes('SKU_NAME_SEPARATORS'));
 assert.ok(ui.includes('Move '));
 assert.ok(ui.includes('Save naming sequence'));
 assert.ok(ui.includes('Naming sequence preview'));
 assert.ok(read('src/org/ProductionFoundation.tsx').includes('Apply the latest SKU naming sequence'));
});


test('SKU naming starts empty and users add only desired components using +, including custom text',()=>{
 const ui=read('src/org/MfgSkuSetup.tsx');
 assert.ok(ui.includes("setup.namingConfigured?setup.namingSequence.steps"));
 assert.ok(ui.includes("filter(step=>step.enabled)"));
 assert.ok(ui.includes("steps:[]"));
 assert.ok(ui.includes('Add component'));
 assert.ok(ui.includes('Add to sequence'));
 assert.ok(ui.includes('Remove '));
 assert.ok(ui.includes('Clear all'));
 assert.ok(ui.includes("field.key==='literal'?{text:''}"));
 assert.ok(ui.includes("step.field==='literal'"));
 assert.ok(ui.includes("title='Custom text'"));
 assert.ok(ui.includes('setShowNamingPicker'));
 assert.ok(ui.includes("disabled={busy||!namingDraft?.steps.length"));
 const selected=validateSkuNamingSequence({separator:'_',steps:[
     {field:'productName',mode:'CODE',enabled:true},
     {field:'literal',mode:'TEXT',enabled:true,text:'PROMO'},
     {field:'commercialPackSize',mode:'QUANTITY',enabled:true},
 ]});
 const params=structuredClone(exampleParams);
 params.find(p=>p.kind==='productNames').productCode='FANTA';
 const actual=calculateSkuConversion(exampleSelect,params);
 assert.equal(composeSkuNameWithSequence(exampleSelect,params,selected,actual),'FANTA_PROMO_12');
 assert.equal(validateSkuNamingSequence({...selected,steps:[
     {field:'literal',mode:'TEXT',enabled:true,text:'PROMO'},
 ]}).steps.length,1);
 const twice=validateSkuNamingSequence({...selected,steps:[
     {field:'productName',mode:'CODE',enabled:true},
     {field:'productName',mode:'NAME',enabled:true},
 ]});
 assert.equal(composeSkuNameWithSequence(exampleSelect,params,twice,actual),'FANTA_Fanta');
 assert.throws(()=>validateSkuNamingSequence({...selected,steps:[]}),/Add between/);
 assert.throws(()=>validateSkuNamingSequence({...selected,steps:[
     {field:'literal',mode:'TEXT',enabled:true,text:''},
 ]}),/Custom naming text/);
 assert.throws(()=>validateSkuNamingSequence({...selected,steps:[
     {field:'literal',mode:'TEXT',enabled:true,text:'x'.repeat(61)},
 ]}),/Custom naming text/);
 assert.throws(()=>validateSkuNamingSequence({...selected,steps:[
     {field:'literal',mode:'QUANTITY',enabled:true,text:'abc'},
 ]}),/Name, Code or Quantity/);
});
