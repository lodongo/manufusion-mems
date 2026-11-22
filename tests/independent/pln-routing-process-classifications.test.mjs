import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SKU_PARAMETERS,normalizeSkuParameter} from '../../backend/mfgSkuModel.ts';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const sku={
 id:'SKU-PROCESS-001',name:'Generic manufactured item',category:'INTERMEDIATE',
 family:'Organization family',uom:'L',packQty:1,sourceMode:'INVENTORY',
};
const stage={code:'STG-000000001',name:'Generic processing step',resourceId:'RSC-01',
 producesSkuId:'SKU-PROCESS-001',bomId:'BOM-001',costCenterId:'CC-01',
 stageType:'PRODUCE',capacityBasis:'BATCH_CYCLE',batchSize:100,cycleMinutes:30,
 dependsOn:[],setupMinutes:0,runMinutesPerUnit:0};
test('Manufacturing process classifications are organization-managed, not a fixed industry enumeration',()=>{
 assert.equal(SKU_PARAMETERS.processClasses,'PRC');
 const a=normalizeSkuParameter('processClasses',{name:'Custom process family A',description:'Any shared process'});
 const b=normalizeSkuParameter('processClasses',{name:'Custom process family B',description:'Unrelated manufacturing method'});
 assert.equal(a.kind,'processClasses');
 assert.equal(a.name,'Custom process family A');
 assert.equal(b.name,'Custom process family B');
 assert.throws(()=>normalizeSkuParameter('processClasses',{name:''}),/parameter name/);
});
test('Classification is independent of flavor, site, SKU type and product family',()=>{
 const raw=normalizeMaster('items',{...sku,processClassId:'PRC_000000001',siteId:'SITE-01'});
 assert.equal(raw.processClassId,'PRC_000000001');
 assert.equal(raw.siteId,'');
 assert.equal(raw.family,'Organization family');
 const existing=normalizeMaster('items',sku);
 assert.equal(existing.processClassId,'');
 assert.equal(existing.id,raw.id);
});
test('Routing preserves its process class, stages, site and SKU-specific recipe references',()=>{
 const row=normalizeMaster('routings',{
  id:'RTG-001',name:'Organization process',skuId:sku.id,processClassId:'PRC_000000001',
  siteId:'SITE-01',alternativeCode:'ALTERNATIVE_1',routingModelVersion:2,
  operations:[stage],
  skuMappings:[{skuId:'SKU-PROCESS-002',stages:[
   {code:stage.code,producesSkuId:'SKU-PROCESS-002',bomId:'BOM-002'}]}],
 });
 assert.equal(row.processClassId,'PRC_000000001');
 assert.equal(row.siteId,'SITE-01');
 assert.equal(row.skuId,sku.id);
 assert.equal(row.operations.length,1);
 assert.equal(row.skuMappings[0].skuId,'SKU-PROCESS-002');
});
test('SKU classification drives route choices without rewriting cost-centre capacity or BOM data',()=>{
 const ui=read('src/org/ProductionFoundation.tsx');
 const editor=read('src/org/PlnProcessRoutingEditor.tsx');
 const foundation=read('backend/plnMfgFoundation.ts');
 const config=read('backend/mfgSkuConfiguration.ts');
 assert.ok(ui.includes("p.kind==='processClasses'"));
 assert.ok(ui.includes('Manufacturing Resources → SKU allocation'));
 assert.ok(editor.includes("str(x.processClassId)===str(value.processClassId)"));
 assert.ok(editor.includes("value={str(value.alternativeCode)}"));
 assert.ok(!editor.includes("value={value.alternativeCode||'STANDARD'}"));
 assert.ok(editor.includes('onChange({...value,processClassId})'));
 assert.ok(foundation.includes('does not belong to the routing manufacturing process classification'));
 assert.ok(foundation.includes("raw.siteId='';"));
 assert.ok(config.includes("kind==='processClasses'&&normalized.enabled===false"));
});
