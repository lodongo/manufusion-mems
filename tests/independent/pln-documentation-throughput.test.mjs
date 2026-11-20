import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {THROUGHPUT_OUTPUTS,throughputOutput,throughputOutputGroups} from '../../src/shared/throughputOutput.ts';
import {normalizeSkuParameter} from '../../backend/mfgSkuModel.ts';
import {MFG_PRIMARY_CONTAINER_TYPES} from '../../backend/mfgPrimaryContainerMetadata.ts';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

test('rated outputs are explicitly distinguishable from Each/Dozen count multipliers',()=>{
 for(const key of ['BOTTLE','CASE','PALLET','PIECE','COMPONENT','KILOGRAM','LITRE',
  'METRE','SQUARE_METRE','CUBIC_METRE','BATCH','ROLL','CUSTOM_OUTPUT']){
  assert.ok(throughputOutput(key),key);
 }
 assert.equal(throughputOutput('BOTTLE').kind,'PRIMARY');
 assert.equal(throughputOutput('CASE').kind,'COMMERCIAL');
 assert.equal(throughputOutput('PALLET').kind,'LOGISTICS');
 assert.equal(throughputOutput('KILOGRAM').kind,'MEASURE');
 assert.equal(throughputOutput('CUSTOM_OUTPUT').kind,'CUSTOM');
 assert.ok(throughputOutputGroups().length>=4);
 assert.equal(THROUGHPUT_OUTPUTS.length,new Set(THROUGHPUT_OUTPUTS.map(x=>x.code)).size);
 assert.equal(throughputOutput('NOT_A_UNIT'),undefined);
});
test('primary-container master records explicit, registry-backed throughput output type',()=>{
 const type=MFG_PRIMARY_CONTAINER_TYPES.find(x=>x.code==='PET_001');
 const attrs=Object.fromEntries(type.attributes.filter(x=>x.required).map(x=>[x.key,x.choices[0]]));
 const configured=normalizeSkuParameter('containers',{
  metadataCode:'PET_001',containerAttributes:attrs,
  ratingCountUnitCode:'UOM-20-001',ratingOutputCode:'CASE'
 },[type]);
 assert.equal(configured.ratingOutputCode,'CASE');
 assert.equal(normalizeSkuParameter('containers',{
  metadataCode:'PET_001',containerAttributes:attrs,
  ratingCountUnitCode:'UOM-20-001'
 },[type]).ratingOutputCode,'PRIMARY_CONTAINER');
 assert.throws(()=>normalizeSkuParameter('containers',{
  metadataCode:'PET_001',containerAttributes:attrs,
  ratingOutputCode:'UNKNOWN'
 },[type]),/published manufacturing throughput output type/);
});
test('editing rated output does not mutate SKU, Asset Register or equipment masters',()=>{
 const sku=read('src/org/MfgSkuSetup.tsx');
 const cost=read('src/org/PlnCostCenterSkuSetup.tsx');
 const backend=read('backend/plnCostCenterCapacity.ts');
 const calculation=read('backend/plnPhysicalCapacity.ts');
 const routing=read('backend/mfgRoutingReadiness.ts');
 assert.ok(sku.includes('Output type used for line speed'));
 assert.ok(sku.includes('THROUGHPUT_OUTPUTS'));
 assert.ok(sku.includes('ratingOutputCode'));
 assert.ok(cost.includes('Output unit used to express line speed'));
 assert.ok(cost.includes('primaryContainersPerRatedOutput'));
 assert.ok(cost.includes('ratingOutputCode,primaryContainersPerRatedOutput'));
 assert.ok(backend.includes('ratingOutputCode:str(x.ratingOutputCode)'));
 assert.ok(calculation.includes("str(x.ratingOutputCode)||'PRIMARY_CONTAINER'"));
 assert.ok(calculation.includes("if(output.kind==='COMMERCIAL')perOutput=perPack"));
 assert.ok(calculation.includes("else if(output.kind==='LOGISTICS')perOutput=perTransport"));
 assert.ok(calculation.includes("else if(output.kind==='MEASURE')"));
 assert.ok(calculation.includes("else if(output.kind==='CUSTOM')"));
 assert.ok(routing.includes('finite(source.physicalContainers)'));
 assert.ok(!backend.includes('pln_equipment_capacity'));
});
test('PLN Documentation is navigable, scrollable, searchable and honestly labels fictional diagrams',()=>{
 const guide=read('src/org/PlnDocumentation.tsx');
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.ok(ui.includes("key:'documentation',label:'Documentation & Setup Guide'"));
 assert.ok(ui.includes("active==='documentation'?<PlnDocumentation"));
 assert.ok(ui.includes("onNavigate={value=>changeTab(value as Tab)}"));
 assert.ok(guide.includes('Production Planning & MRP · Documentation'));
 assert.ok(guide.includes('Search topics, examples and errors'));
 assert.ok(guide.includes('Documentation topics'));
 assert.ok(guide.includes('lg:overflow-y-auto'));
 assert.ok(guide.includes('Previous topic'));
 assert.ok(guide.includes('Next topic'));
 assert.ok(guide.includes('Illustrative screen layout · not a captured screenshot'));
 assert.ok(guide.includes('Fictional example'));
 for(const key of ['Manufacturing Setup','Physical Containers','SKU Naming Sequence',
  'Materials & Products','Bills of Materials','Manufacturing Resources',
  'Manufacturing Cost Centre & SKUs','Process Routings','Planning Configuration','Demand & S&OP']){
  assert.ok(guide.includes(key),key);
 }
 assert.ok(guide.includes('target capabilities')||guide.includes('target capabilities;'));
});
