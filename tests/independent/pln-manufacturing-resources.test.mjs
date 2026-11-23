import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resourceCoreRecord} from '../../backend/plnManufacturingResources.ts';
import {PROCUREMENT_UNITS} from '../../backend/procurementUnits.ts';
import {isManufacturingCostType,normalizeAllocatedSkuIds} from '../../backend/plnCostCenterCapacity.ts';

const source=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const unit=PROCUREMENT_UNITS.find(u=>u.active&&u.selectable&&u.label==='Each') ||
    PROCUREMENT_UNITS.find(u=>u.active&&u.selectable);

test('manufacturing resource core has only shared name, UoM and notes fields; no commissioned rating',()=>{
    assert.ok(unit);
    const a=resourceCoreRecord({name:'Bottling Line 3',rateUom:unit.code,notes:'PET production line'},
        'CC_003','SITE_001','U_TEST');
    assert.equal(a.name,'Bottling Line 3');
    assert.equal(a.rateUom,unit.code);
    assert.equal(a.notes,'PET production line');
    assert.equal(a.rate,0);
    assert.equal(a.costCenterId,'CC_003');
    assert.equal(a.sourceKind,'PRODUCTION_COST_CENTER');
    assert.equal(a.revision,1);
    for(const key of ['ratingQuantity','ratingUnitCode','periodUnitCode','skuCapacities','containerId','containerSizeId']){
        assert.equal(key in a,false,'resource stores SKU-specific '+key);
    }
    const b=resourceCoreRecord({name:'Line 3',rateUom:unit.code,notes:'Updated'},
        'CC_003','SITE_001','U_TEST',{...a,id:'RSC_000000001',revision:1});
    assert.equal(b.revision,2);
    assert.equal(b.id,'RSC_000000001');
    assert.equal(b.rate,0);
    assert.throws(()=>resourceCoreRecord({name:'X',rateUom:unit.code,notes:''},
        'CC_003','SITE_001','U_TEST'),/Resource name/);
    assert.throws(()=>resourceCoreRecord({name:'Line 3',rateUom:'NON_EXISTENT_UOM',notes:''},
        'CC_003','SITE_001','U_TEST'),/UoM master/);
});
test('only Finance-configured manufacturing/production cost centres are eligible',()=>{
    const codes=[{code:'PROD',name:'Production',active:true},
        {code:'OFF',name:'Administration',active:true},
        {code:'MFG',name:'Manufacturing',active:false}];
    assert.equal(isManufacturingCostType('PROD',codes),true);
    assert.equal(isManufacturingCostType('OFF',codes),false);
    assert.equal(isManufacturingCostType('MFG',codes),false);
});
test('resource selection enforces permitted hierarchy, unique cost-centre link and scoped save',()=>{
    const backend=source('backend/plnManufacturingResources.ts');
    const index=source('backend/index.ts');
    for(const route of ['list','get','save','remove','asset-context']){
        assert.ok(backend.includes('/api/org/pln/resource/'+route),route);
    }
    assert.ok(index.includes('...plnManufacturingResourceRoutes'));
    assert.ok(backend.includes("nodePath(ctx.orgId,ccId)"));
    assert.ok(backend.includes('canAt(ctx,p,path,scope)'));
    assert.ok(backend.includes('isManufacturingCostType'));
    assert.ok(backend.includes("mfg_resource_cost_centers/"));
    assert.ok(backend.includes('precondition:{exists:false}'));
    assert.ok(backend.includes("mfg_code_sequences/RSC"));
    assert.ok(backend.includes('expectedRevision'));
    assert.ok(backend.includes('mfg_routings'));
});
test('Products, Asset Management and Manufacturing Resources invoke the same SKU editor and store',()=>{
    const shared=source('src/org/ManufacturingResources.tsx');
    const product=source('src/org/PlnSkuCostCenterRatings.tsx');
    const asset=source('src/org/AssetRegister.tsx');
    const editor=source('src/org/PlnCostCenterSkuSetup.tsx');
    const pln=source('backend/plnCostCenterCapacity.ts');
    const foundation=source('src/org/ProductionFoundation.tsx');
    assert.ok(shared.includes('<PlnCostCenterSkuSetup'));
    assert.ok(shared.includes('Core information'));
    assert.ok(shared.includes('SKU allocation'));
    assert.ok(shared.includes('highestPermittedScope'));
    assert.ok(shared.includes('Add selected resources'));
    assert.ok(shared.includes('available=filtered.filter(x=>!x.resource?.active)'));
    assert.ok(product.includes('<ManufacturingResourceDetail'));
    assert.ok(product.includes('Allocate SKU'));
    assert.ok(asset.includes('<AssetManufacturingSkuAllocation'));
    assert.ok(asset.includes('<ManufacturingResourceDetail'));
    assert.ok(foundation.includes("active==='resources'?<ManufacturingResources/>"));
    assert.ok(editor.includes('SKU list'));
    assert.ok(editor.includes("initialSkuId=''"));
    assert.ok(editor.includes("'/api/org/pln/cost-center/save'"));
    assert.ok(pln.includes("const ROOT=(org:string)=>'organizations/'+org+'/pln_cost_center_capacity'"));
});

test('pending SKU allocations are saved independently of commissioned ratings in one canonical cost-centre record',()=>{
 assert.deepEqual(normalizeAllocatedSkuIds(['SKU_001','SKU_002']),['SKU_001','SKU_002']);
 assert.deepEqual(normalizeAllocatedSkuIds([]),[]);
 assert.throws(()=>normalizeAllocatedSkuIds(['SKU_001','SKU_001']),/only once/i);
 assert.throws(()=>normalizeAllocatedSkuIds(Array.from({length:101},(_,i)=>'SKU_'+i)),/100/);
 assert.throws(()=>normalizeAllocatedSkuIds(['BAD SKU']),/valid manufactured SKU/);
 const backend=source('backend/plnCostCenterCapacity.ts');
 const editor=source('src/org/PlnCostCenterSkuSetup.tsx');
 assert.ok(backend.includes("'POST /api/org/pln/cost-center/allocate'"));
 assert.ok(backend.includes("allocatedSkuIds:skuIds"));
 assert.ok(backend.includes("skuCapacities:commissioned"));
 assert.ok(backend.includes("allocatedSkuIds:allocatedOf(row.data)"));
 assert.ok(backend.includes("validSavedProjection(ctx,location.siteId,row,params)"));
 assert.ok(backend.includes("Mapped, awaiting commissioned rating."));
 assert.ok(backend.includes("'POST /api/org/pln/cost-center/rating'"));
 assert.ok(editor.includes("'/api/org/pln/cost-center/allocate'"));
 assert.ok(editor.includes("Save SKU allocations"));
 assert.ok(editor.includes("skuCapacities:ratedLines.map"));
 assert.ok(editor.includes("setLines(previous=>previous.map"));
 assert.ok(editor.includes("allocatedSkuIds:lines.map"));
});
