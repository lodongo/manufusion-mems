import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bomCostCenterRelevance} from '../../backend/costCenterUtilityDistribution.ts';
import {normalizedMaterialFlow} from '../../src/shared/utilityDistributionCapacity.ts';

const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('BOM utility cost centre relevance follows manufactured output classification and taxonomy',()=>{
    assert.equal(bomCostCenterRelevance('INTERMEDIATE','Simple Syrup',
        ['Simple syrup manufacturing']),100);
    assert.equal(bomCostCenterRelevance('INTERMEDIATE','Intermediate batch',
        ['Intermediate and work-in-progress production']),40);
    assert.equal(bomCostCenterRelevance('FINISHED','Bottled beverage',
        ['Filling and dispensing']),40);
    assert.equal(bomCostCenterRelevance('INTERMEDIATE','Simple Syrup',
        ['Human resources']),0);
});
test('BOM process supply choices are scoped to manufacturing cost centres and selected before utility',()=>{
    const server=read('backend/costCenterUtilityDistribution.ts');
    const backend=read('backend/plnMfgFoundation.ts');
    const frontend=read('src/org/ProductionFoundation.tsx');
    assert.ok(server.includes("if(!isManufacturingCostType(costType,costTypes))continue;"));
    assert.ok(server.includes("allowedAt(ctx,['MFG.view',...PERMS.utilitiesView],d.id,'read')"));
    assert.ok(server.includes("costCenterUtilityOptions(ctx,str(ctx.body.outputSkuId))"));
    assert.ok(backend.includes("if(!isManufacturingCostType(str(attrs.costType),types?.data.items))"));
    assert.ok(frontend.includes("title='Supplying cost centre'"));
    assert.ok(frontend.includes("title='Utility supplied by selected cost centre'"));
    assert.ok(frontend.includes("outputSkuId:str(draft.parentSkuId)"));
});
test('Demand recommendations use actual known flow and a separately entered run duration',()=>{
    assert.equal(normalizedMaterialFlow(3,'m³/h','L/h'),3000);
    const frontend=read('src/org/ProductionFoundation.tsx');
    assert.ok(frontend.includes("currentSupply.demand>0&&currentSupply.determinantKey==='flow'"));
    assert.ok(frontend.includes("Estimated production duration (hours)"));
    assert.ok(frontend.includes("Use suggested planned quantity"));
    assert.ok(frontend.includes("Use suggested flow rate"));
    assert.ok(frontend.includes("This is the cost-centre equipment aggregate, not a verified recipe quantity"));
});
test('Editing active BOM maintains original code with internal audit revisions and reapproval',()=>{
    const frontend=read('src/org/ProductionFoundation.tsx');
    const backend=read('backend/plnMfgFoundation.ts');
    assert.ok(frontend.includes("onClick={()=>void openDraft(row)}"));
    assert.ok(!frontend.includes("onClick={()=>str(row.status)==='active'?copyVersion(row):void openDraft(row)}"));
    assert.ok(backend.includes("kind==='boms'?'mfg.bom.overwrite'"));
    assert.ok(backend.includes("path:path+'/revisions/'"));
    // Outside development test mode an edited BOM always returns to draft for reapproval.
    assert.ok(backend.includes("return {...item,status:testBomOverride?'active':'draft',revision"));
    assert.ok(backend.includes("const testBomOverride=kind==='boms'&&ctx.role==='org_super_admin'&&ctx.testMode===true;"));
    assert.ok(backend.includes("if(testBomOverride)ctx.bypassed?.push('mfg.bom.immediate_save_and_approval');"));
});
test('Measurement-system subcategory choices are not shown',()=>{
    const frontend=read('src/org/ProductionFoundation.tsx');
    const skuSetup=read('src/org/MfgSkuSetup.tsx');
    assert.ok(!frontend.includes("Unit subcategory (measurement system)"));
    assert.ok(skuSetup.includes("title='Unit category'"));
});
