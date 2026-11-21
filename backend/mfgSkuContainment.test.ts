import assert from 'node:assert/strict';
import test from 'node:test';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {calculateSkuConversion,type SkuComponents,type SkuParameter} from './mfgSkuModel';
import {MFG_PRIMARY_CONTAINER_TYPES,primaryContainerCatalogueFromAdmin} from './mfgPrimaryContainerMetadata';
import {skuContainmentNeeds,BULK_STORAGE_CONTAINER_CATEGORY} from '../src/shared/skuContainmentPolicy';
import {skuRatingReadiness} from '../src/shared/plnSkuRatingReadiness';
import {derivePhysicalCapacity,normalizePhysicalRating,physicalRatingUnits} from './plnPhysicalCapacity';

const volume=PROCUREMENT_UNITS.find(u=>u.active&&u.selectable&&u.category==='Volume');
if(!volume)throw new Error('Volume unit absent from approved MEMS UoM master');
const params:SkuParameter[]=[
    {id:'NME_01',kind:'productNames',name:'Syrup'},
    {id:'FRM_01',kind:'productionForms',name:'Liquid',uom:volume.code},
    {id:'CNT_BST',kind:'containers',name:'Bulk syrup tank',
        categoryCode:'BST',metadataCode:'BST_001'},
    {id:'CNT_PET',kind:'containers',name:'PET bottle',
        categoryCode:'PET',metadataCode:'PET_001'},
    {id:'SIZ_01',kind:'containerSizes',name:'1000',uom:volume.code,quantity:1000},
    {id:'SIZ_02',kind:'containerSizes',name:'1',uom:volume.code,quantity:1},
    {id:'PKG_01',kind:'packages',name:'Case'},
    {id:'PSZ_01',kind:'packagingSizes',name:'6',quantity:6},
    {id:'TLP_01',kind:'transportPackages',name:'Pallet'},
    {id:'NRM_01',kind:'normalizationUnits',name:'Reference unit',
        baseUom:volume.code,quantityPerUnit:10,normalizationOperator:'DIVIDE'},
];
const common={productNameId:'NME_01',productionFormId:'FRM_01'};

test('bulk tank SKU needs no commercial or transport packaging',()=>{
    const chosen:SkuComponents={...common,containmentScope:'BULK_STORAGE',containerId:'CNT_BST',
        containerSizeId:'SIZ_01',requiresCommercialPackaging:false,requiresTransportPackaging:false,
        normalizationUnitId:'NRM_01'};
    const x=calculateSkuConversion(chosen,params);
    assert.equal(x.containmentScope,'BULK_STORAGE');
    assert.equal(x.productionQtyPerPhysicalContainer,1000);
    assert.equal(x.productionQtyPerPackage,null);
    assert.equal(x.containersPerPackage,null);
    assert.equal(x.primaryContainersPerTransportUnit,null);
    assert.equal(x.normalizedUnitsPerPhysicalContainer,100);
});

test('transport handling without commercial packaging counts physical units directly',()=>{
    const chosen:SkuComponents={...common,containmentScope:'PRIMARY_CONTAINER',
        containerId:'CNT_PET',containerSizeId:'SIZ_02',
        requiresCommercialPackaging:false,requiresTransportPackaging:true,
        transportPackageId:'TLP_01',transportUnitsPerLoad:5};
    const x=calculateSkuConversion(chosen,params);
    assert.equal(x.productionQtyPerPackage,null);
    assert.equal(x.primaryContainersPerTransportUnit,5);
    assert.equal(x.productionQtyPerTransportUnit,5);
});

test('legacy packaged SKUs infer true requirements and keep prior conversions',()=>{
    const chosen:SkuComponents={...common,containerId:'CNT_PET',containerSizeId:'SIZ_02',
        packageId:'PKG_01',packagingSizeId:'PSZ_01',
        transportPackageId:'TLP_01',transportUnitsPerLoad:5};
    assert.deepEqual(skuContainmentNeeds(chosen),{
        containmentScope:'PRIMARY_CONTAINER',requiresCommercialPackaging:true,requiresTransportPackaging:true,
    });
    const x=calculateSkuConversion(chosen,params);
    assert.equal(x.containersPerPackage,6);
    assert.equal(x.primaryContainersPerTransportUnit,30);
    assert.equal(x.productionQtyPerTransportUnit,30);
});

test('direct process-flow SKUs can be uncontained without fake packaging',()=>{
    const x=calculateSkuConversion({...common,containmentScope:'NONE',
        requiresCommercialPackaging:false,requiresTransportPackaging:false},params);
    assert.equal(x.containerSizeInProductionUom,null);
    assert.equal(x.productionQtyPerPackage,null);
});

test('disallowed or incomplete packaging and bulk selections are rejected',()=>{
    const base:SkuComponents={...common,containmentScope:'BULK_STORAGE',
        containerId:'CNT_BST',containerSizeId:'SIZ_01'};
    assert.throws(()=>calculateSkuConversion({...base,packageId:'PKG_01',
        requiresCommercialPackaging:false},params),/not required/);
    assert.throws(()=>calculateSkuConversion({...base,requiresCommercialPackaging:true},params),/Select commercial packaging/);
    assert.throws(()=>calculateSkuConversion({...base,requiresTransportPackaging:true},params),/Choose transport packaging/);
    assert.throws(()=>calculateSkuConversion({...base,containerId:'CNT_PET'},params),/Bulk storage/);
    assert.throws(()=>calculateSkuConversion({...base,containmentScope:'PRIMARY_CONTAINER'},params),/Choose Bulk storage/);
    assert.throws(()=>calculateSkuConversion({...common,containmentScope:'BULK_STORAGE'},params),/Choose a physical container/);
    assert.throws(()=>calculateSkuConversion({...base,requiresTransportPackaging:'yes' as unknown as boolean},params),/Yes or No/);
});

test('forty bulk storage options are available even with older published container metadata',()=>{
    const added=MFG_PRIMARY_CONTAINER_TYPES.filter(p=>p.categoryCode===BULK_STORAGE_CONTAINER_CATEGORY);
    assert.ok(added.length>=40);
    for(const label of ['Food-grade syrup storage tank','Sugar silo','Conical discharge hopper','Jacketed process tank'])
        assert.ok(added.some(t=>t.name===label),label);
    const legacy=MFG_PRIMARY_CONTAINER_TYPES.find(t=>t.categoryCode==='PET')!;
    const source=[{code:legacy.code,label:legacy.name,category:legacy.category,
        categoryCode:legacy.categoryCode,subcategoryCode:legacy.subcategoryCode,
        subcategory:legacy.subcategory,attributes:legacy.attributes,active:true,selectable:true}];
    const expanded=primaryContainerCatalogueFromAdmin(source);
    assert.ok(expanded.some(t=>t.code===legacy.code));
    assert.equal(expanded.filter(t=>t.categoryCode==='BST').length,added.length);
    const disabled=[...source,{code:'BST_001',active:false}];
    assert.ok(!primaryContainerCatalogueFromAdmin(disabled).some(t=>t.code==='BST_001'));
});


test('intermediate SKU is allocation-only regardless of physical containment completeness',()=>{
    const sku={id:'SKU_000000099',name:'Bulk concentrate',category:'INTERMEDIATE',skuComponents:{}};
    const result=skuRatingReadiness(sku,{containerId:'CNT_BST',containerSizeId:'SIZ_01'});
    assert.equal(result.status,'INTERMEDIATE_NO_SPEED');
    assert.match(result.message,/without commissioned-speed calculations/);
});

test('saved intermediate bulk SKU can be rated without a product variant or packaging',()=>{
    const components:SkuComponents={
        containmentScope:'BULK_STORAGE',productionFormId:'FRM_01',
        containerId:'CNT_BST',containerSizeId:'SIZ_01',
        requiresCommercialPackaging:false,requiresTransportPackaging:false,
    };
    assert.throws(()=>calculateSkuConversion(components,params),/productNames/);
    const conversion=calculateSkuConversion(components,params,{requireProductName:false});
    assert.equal(conversion.productionQtyPerPhysicalContainer,1000);
    assert.equal(conversion.containersPerPackage,null);
    assert.equal(skuRatingReadiness({id:'SKU_000000099',name:'Bulk concentrate',
        category:'INTERMEDIATE',skuComponents:components},
        {containerId:'CNT_BST',containerSizeId:'SIZ_01'}).status,'INTERMEDIATE_NO_SPEED');
});

test('rating setup guidance distinguishes mismatched and non-container SKUs',()=>{
    const sku={id:'SKU_000000099',name:'Bulk concentrate',category:'INTERMEDIATE',
        skuComponents:{containmentScope:'BULK_STORAGE',productionFormId:'FRM_01',
            containerId:'CNT_BST',containerSizeId:'SIZ_01'}};
    assert.equal(skuRatingReadiness({...sku,category:'FINISHED'},
        {containerId:'CNT_PET',containerSizeId:'SIZ_02'}).status,'APPLY_SKU_SETUP');
    assert.equal(skuRatingReadiness({...sku,skuComponents:{containmentScope:'NONE'}},
        {}).status,'INTERMEDIATE_NO_SPEED');
    assert.equal(skuRatingReadiness({...sku,category:'FINISHED',skuComponents:{containmentScope:'NONE'}},
        {}).status,'NOT_CONTAINER_RATED');
    assert.equal(skuRatingReadiness(undefined,{}).status,'MISSING_SKU');
});


test('primary-container capacity must be entered manually with a registered unit',()=>{
    const manual:SkuComponents={...common,containmentScope:'BULK_STORAGE',containerId:'CNT_BST',
        containerCapacityQuantity:75,containerCapacityUom:volume.code,
        requiresCommercialPackaging:false,requiresTransportPackaging:false};
    const x=calculateSkuConversion(manual,params);
    assert.equal(x.productionQtyPerPhysicalContainer,75);
    assert.equal(x.containerSizeInProductionUom,75);
    assert.equal(x.containersPerPackage,null);
    assert.equal(skuRatingReadiness({id:'SKU_000000075',name:'Concentrate finished bulk',category:'FINISHED',
        skuComponents:manual},{containerId:'CNT_BST',containerSizeId:''}).status,'READY');
    assert.throws(()=>calculateSkuConversion({...manual,containerCapacityQuantity:0},params),/positive primary-container capacity/);
    assert.throws(()=>calculateSkuConversion({...manual,containerCapacityUom:'BAD_UNIT'},params),/MEMS units registry/);
    assert.throws(()=>calculateSkuConversion({...manual,containerCapacityUom:''},params),/MEMS units registry/);
    assert.throws(()=>calculateSkuConversion({...common,containerId:'CNT_BST',containmentScope:'BULK_STORAGE'},params),
        /Enter the primary container capacity/);
});

test('manual capacity, not a legacy container-size preset, drives finished SKU rated projections',()=>{
    const units=physicalRatingUnits();
    const count=units.count.find(u=>u.multiplier===1)??units.count[0];
    const time=units.time.find(u=>u.name==='Hour')??units.time[0];
    assert.ok(count&&time);
    const manual:SkuComponents={...common,containmentScope:'BULK_STORAGE',containerId:'CNT_BST',
        containerCapacityQuantity:75,containerCapacityUom:volume.code,
        requiresCommercialPackaging:false,requiresTransportPackaging:false};
    const resolvedParams=params.map(p=>p.id==='CNT_BST'?{...p,subcategoryCode:'BST_001'}:p);
    const input=normalizePhysicalRating({skuId:'SKU_000000075',containerId:'CNT_BST',containerSizeId:'',
        containerCategoryCode:'BST',containerSubcategoryCode:'BST_001',
        ratingQuantity:10,ratingUnitCode:count.code,periodUnitCode:time.code,
        ratingOutputCode:'PRIMARY_CONTAINER'});
    assert.equal(input.containerSizeId,'');
    const sku={id:'SKU_000000075',name:'Bulk concentrate final',category:'FINISHED',
        uom:volume.code,skuComponents:manual};
    const projection=derivePhysicalCapacity(sku,resolvedParams,input);
    assert.match(projection.source.sizeName,/75/);
    assert.equal(projection.source.physicalContainers,10*count.multiplier);
    assert.equal(projection.productionForm.quantity,750*count.multiplier);
    assert.throws(()=>derivePhysicalCapacity({...sku,category:'INTERMEDIATE'},resolvedParams,input),
        /do not use commissioned speeds/);
});

test('manual capacity cannot silently fall back to legacy sizes when partially entered',()=>{
    const old:SkuComponents={...common,containerId:'CNT_PET',containerSizeId:'SIZ_02'};
    assert.equal(calculateSkuConversion(old,params).productionQtyPerPhysicalContainer,1);
    assert.throws(()=>calculateSkuConversion({...old,containerCapacityQuantity:30},params),
        /Choose the primary container capacity unit/);
    assert.throws(()=>calculateSkuConversion({...old,containerCapacityUom:volume.code},params),
        /Enter a positive primary-container capacity/);
});
