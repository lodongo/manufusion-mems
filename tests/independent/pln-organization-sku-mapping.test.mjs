import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster} from '../../backend/plnMfgFoundation.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('manufactured SKU master is organization-wide even if a legacy siteId is supplied',()=>{
 const item={id:'FG-MULTI-SITE',name:'Shared product',category:'FINISHED',
  uom:'EA',packQty:1,siteId:'SITE-OLD'};
 const result=normalizeMaster('items',item);
 assert.equal(result.siteId,'');
 assert.equal(result.id,item.id);
 assert.equal(result.name,item.name);
 const intermediate=normalizeMaster('items',{...item,id:'WIP-SHARED',category:'INTERMEDIATE'});
 assert.equal(intermediate.siteId,'');
 const resource=normalizeMaster('resources',{id:'LINE-A',name:'Line A',type:'LINE',
  rate:100,rateUom:'EA',efficiency:80,siteId:'SITE-A'});
 assert.equal(resource.siteId,'SITE-A','equipment/resource ownership remains site-specific');
});

test('SKU form cannot assign site while BOM, resource and routing retain site fields',()=>{
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.match(ui,/tab!=='items'&&<Choice title='Site applicability'/);
 assert.match(ui,/if\(tab==='items'\)return \{id:'',name:'',category:defaults\.skuCategory[^\n]*siteId:''/);
 assert.match(ui,/Manufacturing Cost Centre &amp; SKUs/);
 assert.match(ui,/siteId:str\(draft\.siteId\),productVariantId:''/);
 const backend=read('backend/plnMfgFoundation.ts');
 assert.match(backend,/if\(kind==='items'\)\{\s*raw\.siteId=''/);
 assert.match(read('backend/plnManufacturingResources.ts'),/costCenterId:ccId/);
 assert.match(backend,/const siteId=kind==='items'\?'':str\(raw\.siteId\)\.trim\(\)/);
 assert.match(backend,/const siteId=kind==='items'\?'':str\(record\.data\.siteId\)/);
 assert.match(backend,/kind==='items'\?'':str\(master\.data\.siteId\)/);
 assert.match(backend,/if\(str\(resource\.data\.siteId\)&&str\(resource\.data\.siteId\)!==str\(item\.siteId\)\)/);
 assert.doesNotMatch(backend,/BOM output belongs to another production site/);
 assert.doesNotMatch(backend,/Component .* belongs to another production site/);
 assert.doesNotMatch(backend,/Routing SKU is assigned to another site/);
});

test('legacy site IDs do not constrain cost centre commissioning, routing or demand SKU selection',()=>{
 const cost=read('backend/plnCostCenterCapacity.ts');
 assert.match(cost,/const manufacturedSku=async\(ctx:OrgContext,skuId:string\)=>/);
 assert.match(cost,/const outputs=rows\.filter\(d=>\['FINISHED','INTERMEDIATE'\]\.includes\(str\(d\.data\.category\)\)\)\.map\(asOutput\)/);
 assert.match(cost,/const outputs=allSku\.filter\(d=>\['FINISHED','INTERMEDIATE'\]\.includes\(str\(d\.data\.category\)\)\)/);
 assert.doesNotMatch(cost,/sku\.siteId&&sku\.siteId!==location\.siteId/);
 assert.match(cost,/if\(!await authorized\(ctx,'read',id\)\)/);
 assert.match(cost,/if\(!siteId\|\|location\.siteId!==siteId\)/);
 const routing=read('backend/mfgRoutingReadiness.ts');
 assert.doesNotMatch(routing,/Output SKU belongs to a different production site/);
 assert.doesNotMatch(routing,/Stage output belongs to another site/);
 const routingUI=read('src/org/PlnProcessRoutingEditor.tsx');
 assert.match(routingUI,/\['FINISHED','INTERMEDIATE'\]\.includes\(str\(x\.category\)\)\),\[items\]/);
 assert.doesNotMatch(routingUI,/skuId:availableOutputs\.some/);
 assert.doesNotMatch(routingUI,/siteId:chosen&&str\(chosen\.siteId\)/);
 const demand=read('backend/plnDemand.ts');
 assert.doesNotMatch(demand,/Output material is not available at this production site/);
 assert.match(demand,/const outputs=skus\.filter\(x=>\['FINISHED','INTERMEDIATE'\]\.includes\(str\(x\.data\.category\)\)\)/);
 const demandUI=read('src/org/PlnDemand.tsx');
 assert.match(demandUI,/const availableSites=sites/);
 assert.match(demandUI,/siteId:preferredSiteId\(x\.siteId\|\|defaults\.defaultSiteId,sites\)/);
});
