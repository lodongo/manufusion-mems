import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {UNIVERSAL_STOCK_METADATA,stockedPolicyToMrp} from '../../backend/universalStockMetadata.ts';
import {MATERIAL_STOCK_DIMENSIONS,isStandardMrpSafe} from '../../backend/stockPolicyConfig.ts';
const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('canonical Procurement metadata masters are codified, unique and detailed',()=>{
 assert.equal(UNIVERSAL_STOCK_METADATA.length,15);
 assert.ok(UNIVERSAL_STOCK_METADATA.reduce((n,g)=>n+g.items.length,0)>=200);
 const keys=new Set();for(const list of UNIVERSAL_STOCK_METADATA){
  assert.ok(!keys.has(list.key));keys.add(list.key);
  assert.ok(list.description.length>40);
  const codes=new Set();for(const item of list.items){
   assert.match(item.code,/^[A-Z]{2}\d{2}$/);assert.ok(!codes.has(item.code));codes.add(item.code);
   assert.ok(item.description.length>35,item.code);
  }
 }
 assert.equal(MATERIAL_STOCK_DIMENSIONS.length,15);
 assert.ok(read('backend/moduleDefaults.ts').includes('...UNIVERSAL_STOCK_METADATA'));
});
test('legacy and new replenishment codes synchronize with existing MRP engine',()=>{
 assert.equal(stockedPolicyToMrp('RP01'),'MINMAX');assert.equal(stockedPolicyToMrp('RP02'),'REORDER');
 assert.equal(stockedPolicyToMrp('MINMAX'),'MINMAX');assert.equal(stockedPolicyToMrp('REORDER'),'REORDER');
 for(const code of ['RP03','RP06','RP12','RP18'])assert.equal(stockedPolicyToMrp(code),null);
 const src=read('backend/procurement.ts');
 assert.match(src,/clean.stockingPolicy=effective\|\|newStrategy/);
 assert.match(src,/const stockDimensions=await Promise.all/);
});
test('supplier consignment and VMI cannot silently create standard MRP purchases',()=>{
 for(const value of [{stockOwnership:'OW02'}, {supplyArrangement:'SA02'}, {supplyArrangement:'SA03'}, {stockOwnership:'OW03'}]){
  assert.equal(isStandardMrpSafe(value).safe,false);
 }
 assert.equal(isStandardMrpSafe({stockOwnership:'OW01',supplyArrangement:'SA01'}).safe,true);
 assert.match(read('backend/mrp.ts'),/isStandardMrpSafe/);
});
test('Procurement and Inventory add tabs without replicating master definitions',()=>{
 const inv=read('src/org/InventoryMaterialDetail.tsx');
 const prc=read('src/org/ProcurementSetup.tsx');
 assert.match(inv,/'Stock Control'/);assert.match(inv,/STOCK_FIELDS/);
 assert.match(prc,/label:'Stock policies'/);
 assert.match(prc,/StockConfigurationCatalogue/);
 assert.match(prc,/callBackend<.*stockDimensions:Dim\[\]/);
});

test('MEMS Admin Procurement editor preserves item descriptions and does not regenerate catalogue codes',()=>{
 const admin=read('src/admin/ModulesPage.tsx');
 assert.match(admin,/isStockMeta/);
 assert.match(admin,/\(isMnt \|\| isStockMeta\) \? mntItems : items/);
 assert.match(admin,/Detailed description/);
 assert.match(admin,/maxLength=\{500\}/);
 assert.match(admin,/code=prefix\+String\(next\)\.padStart\(2,'0'\)/);
});
