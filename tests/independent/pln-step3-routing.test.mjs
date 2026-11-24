import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const stage=(code,patch={})=>({code,name:'Stage '+code,resourceId:'RSC-01',
 producesSkuId:'SKU-01',dependsOn:[],setupMinutes:0,runMinutesPerUnit:0,
 costCenterId:'CC-MFG-01',bomId:'BOM-01',stageType:'PRODUCE',
 processClass:'GENERAL',capacityBasis:'PHYSICAL_CONTAINER',batchSize:0,cycleMinutes:0,...patch});
const route=operations=>({id:'RTG-01',name:'Main route',skuId:'SKU-01',
 siteId:'SITE-01',routingModelVersion:2,alternativeCode:'ALTERNATIVE_A',
 effectiveFrom:'2026-11-20',operations});

test('Step 3 schema stores per-stage cost centre, BOM, stage class and source-specific capacity',()=>{
 const result=normalizeMaster('routings',route([stage('PREP',{capacityBasis:'BATCH_CYCLE',
  batchSize:1000,cycleMinutes:45,processClass:'MATERIAL_PREPARATION'})]));
 assert.equal(result.routingModelVersion,2);
 assert.equal(result.alternativeCode,'ALTERNATIVE_A');
 assert.equal(result.operations[0].costCenterId,'CC-MFG-01');
 assert.equal(result.operations[0].bomId,'BOM-01');
 assert.equal(result.operations[0].processClass,'MATERIAL_PREPARATION');
 assert.equal(result.operations[0].batchSize,1000);
 assert.equal(result.operations[0].cycleMinutes,45);
});
test('Draft can hold incomplete stage fields; schema validates identifiers and rate bases',()=>{
 const incomplete=normalizeMaster('routings',route([stage('DRAFT',{name:'',
  resourceId:'',costCenterId:'',bomId:'',producesSkuId:''})]));
 assert.equal(incomplete.operations[0].name,'');
 assert.equal(incomplete.operations[0].resourceId,'');
 assert.throws(()=>normalizeMaster('routings',route([stage('BAD',{costCenterId:'bad id'})])),/Manufacturing cost centre/);
 assert.throws(()=>normalizeMaster('routings',route([stage('BAD',{capacityBasis:'INVENTORY_RATE'})])),/capacity basis/);
 assert.throws(()=>normalizeMaster('routings',route([stage('BAD',{stageType:'UNKNOWN'})])),/stage type/);
 assert.throws(()=>normalizeMaster('routings',route([stage('BAD',{batchSize:-1})])),/Batch size/);
 assert.throws(()=>normalizeMaster('routings',route([stage('BAD',{processClass:'not valid label'})])),/process class/);
});
test('Routing sequence accepts convergent parallel stages and rejects future or duplicate dependencies',()=>{
 const steps=[stage('PREP',{producesSkuId:'SKU-PREP',dependsOn:[]}),
  stage('BLOW',{producesSkuId:'SKU-BOTTLE',dependsOn:[]}),
  stage('FILL',{producesSkuId:'SKU-01',dependsOn:['PREP','BLOW']})];
 assert.deepEqual(normalizeMaster('routings',route(steps)).operations[2].dependsOn,['PREP','BLOW']);
 assert.throws(()=>normalizeMaster('routings',route([
  stage('PREP',{dependsOn:['FILL']}),steps[1],steps[2]])),/earlier stages/);
 assert.throws(()=>normalizeMaster('routings',route([
  steps[0],steps[1],stage('FILL',{dependsOn:['PREP','PREP']})])),/earlier stages/);
});
test('Old approved routing shape remains normalized without a mandatory cost-centre migration',()=>{
 const legacy=normalizeMaster('routings',{id:'RTG-OLD',name:'Legacy routing',
  skuId:'SKU-01',operations:[{code:'FILL',name:'Filling',resourceId:'RSC-01',
   setupMinutes:20,runMinutesPerUnit:0.2}]});
 assert.equal(legacy.routingModelVersion,1);
 assert.equal(legacy.operations[0].costCenterId,undefined);
 assert.equal(legacy.operations[0].resourceId,'RSC-01');
});
test('Routing review is scoped, uses referenced cost-centre speed and rejects unrelated units',()=>{
 const backend=read('backend/mfgRoutingReadiness.ts');
 const capacity=read('backend/plnCostCenterCapacity.ts');
 const foundation=read('backend/plnMfgFoundation.ts');
 assert.ok(backend.includes('routingManufacturingCostCenter(ctx,costCenterId,siteId)'));
 assert.ok(backend.includes('routingCommissionedCapacity(ctx,costCenterId,siteId,producesSkuId)'));
 assert.ok(backend.includes("Stage BOM must be approved and active before routing release."));
 assert.ok(backend.includes('This stage is disconnected from the final processing chain.'));
 assert.ok(backend.includes('compatible=new Map'));
 assert.ok(backend.includes("stage.capacityBasis!=='PHYSICAL_CONTAINER'"));
 assert.ok(backend.includes("key=stage.producesSkuId"));
 assert.ok(capacity.includes("if(!await authorized(ctx,'read',id))"));
 assert.ok(capacity.includes('location.siteId!==siteId'));
 assert.ok(foundation.includes("'POST /api/org/pln-mfg/foundation/routing-references'"));
 assert.ok(foundation.includes("'POST /api/org/pln-mfg/foundation/routing-review'"));
 assert.ok(foundation.includes('routingModelVersion=raw.routingModelVersion===2?2:1'));
 assert.ok(!backend.includes('writeDoc('));
 assert.ok(!backend.includes('commitChecked('));
});
test('Routing submit and independent approval require current stage readiness',()=>{
 const release=read('backend/plnMfgRelease.ts');
 assert.ok(release.includes("if(kind==='routings'&&doc.data.routingModelVersion===2)"));
 assert.ok(release.includes('reviewManufacturingRouting(ctx,doc.data)'));
 assert.ok(release.includes('Routing is not ready for approval'));
 assert.ok(release.includes('Routing release readiness changed'));
 assert.ok(release.includes('Independent maker-checker approval is mandatory'));
 assert.ok(release.includes('Choose an explicit approved routing alternative'));
 assert.ok(release.includes('bomAlternative(other.data.alternativeCode)'));
});
test('Step 3 stage UI is compact, preserves governance and shows validated capacity sources',()=>{
 const ui=read('src/org/PlnProcessRoutingEditor.tsx');
 const parent=read('src/org/ProductionFoundation.tsx');
 assert.ok(ui.includes("aria-label='Routing configuration sections'"));
 assert.ok(ui.includes("aria-expanded={expanded}"));
 assert.ok(ui.includes('Manufacturing cost centre'));
 assert.ok(ui.includes("Choice label='Common stage BOM (optional)'"));
 assert.ok(ui.includes('Commissioned physical-container speed'));
 assert.ok(ui.includes('Stage BOM components (read only)'));
 assert.ok(ui.includes('Required predecessor stages'));
 assert.ok(ui.includes('Cannot move this stage across one of its predecessors'));
 assert.ok(ui.includes("'/api/org/pln-mfg/foundation/routing-review'"));
 assert.ok(ui.includes('Save stores a manufacturing routing draft only'));
 assert.ok(parent.includes("if(tab==='routings')return <PlnProcessRoutingEditor"));
 assert.ok(parent.includes("routingModelVersion:2"));
 assert.ok(parent.includes("releaseScope+'.approve'"));
});
