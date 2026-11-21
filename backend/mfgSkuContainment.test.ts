import assert from 'node:assert/strict';
import test from 'node:test';
import {PROCUREMENT_UNITS} from './procurementUnits';
import {calculateSkuConversion,type SkuComponents,type SkuParameter} from './mfgSkuModel';
import {MFG_PRIMARY_CONTAINER_TYPES,primaryContainerCatalogueFromAdmin} from './mfgPrimaryContainerMetadata';
import {skuContainmentNeeds,BULK_STORAGE_CONTAINER_CATEGORY} from '../src/shared/skuContainmentPolicy';

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
    assert.throws(()=>calculateSkuConversion({...common,containmentScope:'BULK_STORAGE'},params),/physical container and size/);
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
