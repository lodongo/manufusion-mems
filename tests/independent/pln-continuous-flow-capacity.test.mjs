import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFlowCapacity,capacityUnitFactor} from '../../src/shared/mfgFlowCapacity.ts';
import {normalizeMaterialSupplyProfile} from '../../backend/mfgMaterialSupplyProfile.ts';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';
import {readFileSync} from 'node:fs';
const units=[
 {code:'L',baseUnit:'L',categoryCode:'VOLUME',multiplier:1},
 {code:'M3',baseUnit:'L',categoryCode:'VOLUME',multiplier:1000},
 {code:'KG',baseUnit:'KG',categoryCode:'MASS',multiplier:1},
];
const mixer={code:'MIX',name:'Inline mixing',dependsOn:[],ratePerHour:30000,unitCode:'L'};
const filler={code:'FILL',name:'Continuous filling',dependsOn:['MIX'],ratePerHour:35000,unitCode:'L'};
test('35k downstream vs 30k upstream: 14.29% deficit and 5000 units lost in one hour',()=>{
 const result=analyzeFlowCapacity([mixer,filler],units);
 assert.equal(result.limitedLinks,1);
 const risk=result.opportunities[0];
 assert.ok(Math.abs(risk.shortagePercent-14.2857142857)<0.0001);
 assert.equal(risk.shortagePerHour,5000);
 assert.equal(risk.oneHourShortage,5000);
 assert.ok(Math.abs(risk.supplyCoveragePercent-85.7142857143)<0.0001);
 assert.equal(risk.minutesToDepletion,null);
 assert.equal(risk.riskWithinHour,null);
});
test('Usable buffer supports a 30-minute estimate; adequate buffer covers a full hour',()=>{
 const short=analyzeFlowCapacity([{...mixer,bufferAvailable:2500},filler],units).opportunities[0];
 assert.equal(short.minutesToDepletion,30);
 assert.equal(short.riskWithinHour,true);
 const protectedLink=analyzeFlowCapacity([{...mixer,bufferAvailable:5000},filler],units).opportunities[0];
 assert.equal(protectedLink.status,'buffered');
 assert.equal(protectedLink.minutesToDepletion,60);
 assert.equal(protectedLink.riskWithinHour,false);
});
test('Compatible volume units convert; unlike units are never compared',()=>{
 assert.equal(capacityUnitFactor('M3','L',units),1000);
 const converted=analyzeFlowCapacity([{...mixer,unitCode:'M3',ratePerHour:30},filler],units);
 assert.equal(converted.opportunities[0].shortagePerHour,5000);
 const incompatible=analyzeFlowCapacity([{...mixer,unitCode:'KG'},filler],units);
 assert.equal(incompatible.opportunities.length,0);
 assert.equal(incompatible.unresolved.length,1);
});
test('Multi-feed processes do not add independent rates without ratios',()=>{
 const branches=analyzeFlowCapacity([mixer,{...mixer,code:'SECOND'},
  {...filler,dependsOn:['MIX','SECOND']}],units);
 assert.equal(branches.opportunities.length,0);
 assert.equal(branches.unresolved.length,1);
});
test('A material may be continuously produced with independent named supply tariffs',()=>{
 const material=normalizeMaterialSupplyProfile({
  productionMode:'CONTINUOUS',handlingMode:'BUFFERED_BULK',
  sources:[
   {id:'SRC_0001',name:'Source one',type:'PURCHASED',rateUom:'L',currency:'KES',unitCost:0.5,meterReference:'MTR-1'},
   {id:'SRC_0002',name:'Source two',type:'EXTRACTED',rateUom:'L',currency:'KES',unitCost:0.3,meterReference:'MTR-2'},
  ]},'L');
 assert.equal(material.productionMode,'CONTINUOUS');
 assert.equal(material.sources.length,2);
 assert.equal(material.sources[0].unitCost,0.5);
 assert.equal(material.sources[1].meterReference,'MTR-2');
 assert.throws(()=>normalizeMaterialSupplyProfile({sources:[{id:'SRC_01',name:'One',type:'PURCHASED',currency:'XX',unitCost:1}]},'L'),/currency/);
 assert.throws(()=>normalizeMaterialSupplyProfile({sources:[{id:'SRC_01',name:'One'},{id:'SRC_01',name:'Two'}]},'L'),/Duplicate/);
});
test('Continuous flow stages preserve hourly rate without requiring batch size',()=>{
 const raw={id:'RTG_000000001',name:'Process',siteId:'SITE_001',skuId:'',processClassId:'PRC_000000001',
  alternativeCode:'STANDARD',routingModelVersion:2,
  operations:[{code:'STG_000000001',name:'Stage',resourceId:'',costCenterId:'',
   stageType:'PRODUCE',capacityBasis:'CONTINUOUS_FLOW',
   flowRatePerHour:30000,flowRateUom:'L',flowInputFactor:1,
   flowBufferAvailable:0,dependsOn:[]}]};
 const normalized=normalizeMaster('routings',raw);
 assert.equal(normalized.operations[0].capacityBasis,'CONTINUOUS_FLOW');
 assert.equal(normalized.operations[0].flowRatePerHour,30000);
 assert.equal(normalized.operations[0].flowBufferAvailable,0);
});
test('Capacity overview keeps read-only permission and site boundary',()=>{
 const source=readFileSync(new URL('../../backend/plnMfgFoundation.ts',import.meta.url),'utf8');
 assert.ok(source.includes("orgRoute('org.mfg.routing.capacity.overview','MFG.view'"));
 assert.ok(source.includes("recordAccess(ctx,'MFG.view',str(doc.data.siteId))"));
 assert.ok(source.includes('reviewManufacturingRouting(ctx,doc.data)'));
});
