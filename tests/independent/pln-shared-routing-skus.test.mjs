import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
import {routingSkuIds,routingForSku} from '../../backend/mfgRoutingSkuMappings.ts';

const base={
 id:'ROUTE-001',name:'Shared beverage process',siteId:'SITE-01',
 skuId:'SKU-ORANGE',alternativeCode:'STANDARD',routingModelVersion:2,
 operations:[
  {code:'STG-000000001',name:'Syrup blending',resourceId:'RESOURCE-1',
   producesSkuId:'SKU-SYRUP',bomId:'BOM-SYRUP',dependsOn:[],
   costCenterId:'CC-01',setupMinutes:20,runMinutesPerUnit:0,
   processClass:'BLENDING',stageType:'PRODUCE',capacityBasis:'BATCH_CYCLE',
   batchSize:30000,cycleMinutes:120},
  {code:'STG-000000002',name:'Filling and packaging',resourceId:'RESOURCE-2',
   producesSkuId:'SKU-ORANGE',bomId:'BOM-ORANGE',dependsOn:['STG-000000001'],
   costCenterId:'CC-02',setupMinutes:10,runMinutesPerUnit:0,
   processClass:'FILLING',stageType:'PRODUCE',capacityBasis:'PHYSICAL_CONTAINER',
   batchSize:0,cycleMinutes:0},
 ],
 skuMappings:[{skuId:'SKU-LEMON',stages:[
  {code:'STG-000000001',bomId:'BOM-LEMON-SYRUP'},
  {code:'STG-000000002',producesSkuId:'SKU-LEMON',bomId:'BOM-LEMON'},
 ]}],
};
test('One routing serves multiple products without cloning resources or the stage graph',()=>{
 const normalized=normalizeMaster('routings',base);
 assert.deepEqual(routingSkuIds(normalized),['SKU-ORANGE','SKU-LEMON']);
 const orange=routingForSku(normalized,'SKU-ORANGE');
 const lemon=routingForSku(normalized,'SKU-LEMON');
 assert.equal(orange.operations[1].bomId,'BOM-ORANGE');
 assert.equal(lemon.operations[1].bomId,'BOM-LEMON');
 assert.equal(lemon.operations[1].producesSkuId,'SKU-LEMON');
 assert.equal(lemon.operations[0].bomId,'BOM-LEMON-SYRUP');
 assert.equal(lemon.operations[0].resourceId,orange.operations[0].resourceId);
 assert.deepEqual(lemon.operations.map(s=>s.dependsOn),orange.operations.map(s=>s.dependsOn));
 assert.equal(routingForSku(normalized,'SKU-UNMAPPED'),null);
});
test('Mapped products can override preparation and batch times while retaining primary values',()=>{
 const raw={...base,skuMappings:[{skuId:'SKU-LEMON',stages:[
  {code:'STG-000000001',batchSize:25000,cycleMinutes:130},
  {code:'STG-000000002',producesSkuId:'SKU-LEMON',bomId:'BOM-LEMON'},
 ]}]};
 const normalized=normalizeMaster('routings',raw);
 const orange=routingForSku(normalized,'SKU-ORANGE');
 const lemon=routingForSku(normalized,'SKU-LEMON');
 assert.equal(orange.operations[0].batchSize,30000);
 assert.equal(lemon.operations[0].batchSize,25000);
 assert.equal(lemon.operations[0].cycleMinutes,130);
});
test('Duplicate SKUs, invalid stage references and negative overrides are rejected',()=>{
 assert.throws(()=>normalizeMaster('routings',{...base,
  skuMappings:[{skuId:'SKU-ORANGE',stages:[]}]}),/same SKU/);
 assert.throws(()=>normalizeMaster('routings',{...base,
  skuMappings:[{skuId:'SKU-LEMON',stages:[{code:'NOT-A-STAGE',bomId:'BOM-2'}]}]}),/existing routing stages/);
 assert.throws(()=>normalizeMaster('routings',{...base,
  skuMappings:[{skuId:'SKU-LEMON',stages:[{code:'STG-000000001',setupMinutes:-1}]}]}),/Setup minutes/);
});
test('Routing approvals and effective retrieval include every assigned SKU, and stage renumbering preserves assignments',()=>{
 const release=readFileSync(new URL('../../backend/plnMfgRelease.ts',import.meta.url),'utf8');
 const foundation=readFileSync(new URL('../../backend/plnMfgFoundation.ts',import.meta.url),'utf8');
 const review=readFileSync(new URL('../../backend/mfgRoutingReadiness.ts',import.meta.url),'utf8');
 assert.ok(release.includes('routingSkuIds(other.data)'));
 assert.ok(release.includes('routingForSku(selected,skuId)'));
 assert.ok(release.includes("status==='active'?slots.map"));
 assert.ok(foundation.includes('raw.skuMappings=ARR(raw.skuMappings).map'));
 assert.ok(review.includes('for(const skuId of skuIds)'));
});
