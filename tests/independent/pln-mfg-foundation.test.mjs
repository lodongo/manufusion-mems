import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster,detectBomCycle,fictionalLine11Demo} from '../../backend/plnMfgFoundation.ts';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');

test('valid SKU and resource masters are normalized without side effects',()=>{
 const sku=normalizeMaster('items',{id:'FG-WATER-500',name:'Water 500 mL',category:'FINISHED',uom:'CASE',packQty:12});
 assert.equal(sku.id,'FG-WATER-500');assert.equal(sku.category,'FINISHED');
 const res=normalizeMaster('resources',{id:'L11',name:'Line 11',type:'LINE',rate:28000,rateUom:'EA',efficiency:80});
 assert.equal(res.rate,28000);assert.equal(res.efficiency,80);
});

test('real raw and packaging materials require an Inventory master reference',()=>{
 for(const category of ['RAW','PACKAGING']){
  assert.throws(()=>normalizeMaster('items',{id:'RAW-WATER',name:'Water',category,uom:'L',packQty:1}),/Inventory material master/);
 }
 assert.equal(normalizeMaster('items',{id:'CAP-2622',name:'Cap',category:'PACKAGING',uom:'EA',packQty:1,inventoryMaterialId:'MAT-2622'}).inventoryMaterialId,'MAT-2622');
});

test('BOM structures reject zero quantities, duplicate components and immediate cycles',()=>{
 const baseline={id:'BOM-01',name:'Water case',type:'BOM',parentSkuId:'FG-WATER',outputQty:1,outputUom:'CASE'};
 const comp={skuId:'CAP-2622',quantity:12,uom:'EA',scrapPct:1};
 assert.equal(normalizeMaster('boms',{...baseline,components:[comp]}).type,'BOM');
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[comp,comp]}),/Duplicate component/);
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[{...comp,quantity:0}]}),/greater than zero/);
 assert.throws(()=>normalizeMaster('boms',{...baseline,components:[{...comp,skuId:'FG-WATER'}]}),/consume itself/);
});

test('detects transitive cycle in multi-level BOM and tolerates a DAG',()=>{
 const boms=[
  {parentSkuId:'FG',components:[{skuId:'FILL'}]},
  {parentSkuId:'FILL',components:[{skuId:'BOTTLE'},{skuId:'BEVERAGE'}]},
  {parentSkuId:'BOTTLE',components:[{skuId:'PREFORM'}]},
 ];
 assert.equal(detectBomCycle(boms,'BEVERAGE',[{skuId:'RAW-WATER'}]),false);
 assert.equal(detectBomCycle(boms,'BEVERAGE',[{skuId:'FG'}]),true);
});

test('routing stages must be unique and refer to a manufacturing resource',()=>{
 const base={id:'ROUTE-01',name:'Line 11',skuId:'FG-WATER'};
 const o={code:'FILL',name:'Filling',resourceId:'L11',setupMinutes:15,runMinutesPerUnit:0.002};
 assert.equal(normalizeMaster('routings',{...base,operations:[o]}).operations.length,1);
 assert.throws(()=>normalizeMaster('routings',{...base,operations:[o,o]}),/Duplicate operation/);
});

test('fictional pilot includes two FG SKUs, two routing options and full upstream recipe',()=>{
 const d=fictionalLine11Demo();
 assert.equal(d.demo,true);assert.equal(d.persisted,false);assert.equal(d.isolated,true);
 assert.equal(d.items.filter(x=>x.category==='FINISHED').length,2);
 assert.equal(d.routings.length,2);
 assert.ok(d.boms.some(x=>x.type==='RECIPE'));
 assert.ok(d.boms.some(x=>x.parentSkuId==='DEMO-PREPARED-WATER'));
 const parents=new Set(d.boms.map(x=>x.parentSkuId));
 assert.ok(parents.has('DEMO-FG-500')&&parents.has('DEMO-FG-1000'));
});

test('Phase 1 routes are tenant-guarded and there are no physical posting endpoints',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 for(const key of ['foundation/list','foundation/save','foundation/config','foundation/demo'])assert.ok(src.includes(key));
 assert.match(src,/orgRoute\('org\.mfg\.foundation\.save','MFG\.master\.edit'/);
 assert.match(src,/updateTime:existing\.updateTime/);
 assert.doesNotMatch(src,/\/api\/org\/(inventory\/issue|procurement\/po\/create)/);
 const gate=read('backend/transactionModuleGate.ts');
 assert.match(gate,/PLN:'PLN'/);
});

test('PLN and MFG have functional organization home and admin navigation',()=>{
 const shell=read('src/org/OrgShell.tsx'),home=read('src/org/OrgHomePage.tsx'),perms=read('backend/permissionPolicy.ts'),index=read('backend/index.ts');
 assert.match(shell,/case 'mfg_foundation'/);assert.match(shell,/case 'pln_foundation'/);
 assert.match(home,/path:'mfg_foundation'/);assert.match(home,/path:'pln_foundation'/);
 assert.match(perms,/MFG\.master\.edit/);assert.match(perms,/PLN\.configure/);
 assert.match(index,/\.\.\.plnMfgFoundationRoutes/);
});
