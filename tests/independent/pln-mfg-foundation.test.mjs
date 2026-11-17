import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeMaster,detectBomCycle,fictionalLine11Demo} from '../../backend/plnMfgFoundation.ts';
import {selectEffectiveRelease} from '../../backend/plnMfgRelease.ts';
import {fictionalPilotSnapshot,assertPilotSeedAllowed} from '../../backend/plnMfgPilotSeed.ts';

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
 const parallel=[{...o,code:'PREP',dependsOn:[],producesSkuId:'WATER'}, {...o,code:'BLOW',dependsOn:[],producesSkuId:'BOTTLE'}, {...o,code:'FILL',dependsOn:['PREP','BLOW'],producesSkuId:'FILLED'}];
 assert.equal(normalizeMaster('routings',{...base,operations:parallel}).operations.length,3);
 assert.throws(()=>normalizeMaster('routings',{...base,operations:[{...o,dependsOn:['FUTURE']}]}),/earlier stages/);
});

test('fictional pilot includes two FG SKUs, two routing options and full upstream recipe',()=>{
 const d=fictionalLine11Demo();
 assert.equal(d.demo,true);assert.equal(d.persisted,false);assert.equal(d.isolated,true);
 assert.equal(d.items.filter(x=>x.category==='FINISHED').length,2);
 assert.equal(d.routings.length,2);
 assert.deepEqual(d.routings[0].operations.find(x=>x.code==='FILL').dependsOn,['PREP','BLOW']);
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
 assert.match(src,/commitChecked\(/);
 assert.match(src,/\+'\/revisions\/'/);
 assert.match(src,/foundation\/history/);
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

test('approved versions honor effective dates and exclude unapproved drafts',()=>{
 const versions=[
    {id:'BOM-V1',status:'active',effectiveFrom:'2026-01-01',approvedAt:'2026-01-01'},
    {id:'BOM-V2',status:'active',effectiveFrom:'2027-01-01',approvedAt:'2026-12-01'},
    {id:'BOM-V3',status:'draft',effectiveFrom:'2026-02-01',approvedAt:'2026-02-01'},
 ];
 assert.equal(selectEffectiveRelease(versions,'2026-11-17')?.id,'BOM-V1');
 assert.equal(selectEffectiveRelease(versions,'2027-05-01')?.id,'BOM-V2');
 assert.equal(selectEffectiveRelease(versions,'2025-12-01'),null);
 assert.throws(()=>selectEffectiveRelease(versions,'not-a-date'),/Valid planning date/);
});

test('manufacturing release prevents editing of submitted and active versions',()=>{
 const source=read('backend/plnMfgFoundation.ts'),release=read('backend/plnMfgRelease.ts');
 assert.ok(source.includes("['pending_approval','active'].includes"));
 assert.ok(release.includes('Independent maker-checker approval is mandatory'));
 assert.ok(release.includes('ctx.uid===str(doc.data.createdBy)'));
 assert.ok(release.includes('referenceChecks(ctx,kind,doc.data,id)'));
 assert.ok(release.includes("status:'pending_approval'"));
 assert.ok(release.includes('commitChecked('));
 assert.ok(release.includes('effectiveFrom'));
 assert.ok(read('backend/index.ts').includes('...plnMfgReleaseRoutes'));
});

test('master-data reference checks preserve Inventory and Asset authority',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 assert.ok(src.includes("'/materials/'"));
 assert.ok(src.includes("'/assets/'"));
 assert.ok(src.includes('approved, numbered Inventory material'));
 assert.ok(src.includes('same site as the linked asset'));
 assert.ok(src.includes('unit does not match its SKU master'));
});

test('isolated fictional Line 11 seeding is denied outside authorized development test mode',()=>{
 const d=fictionalPilotSnapshot();
 assert.equal(d.persisted,false);
 assert.equal(d.stock.length,8);assert.equal(d.demand.length,2);
 assert.throws(()=>assertPilotSeedAllowed(false,true,true,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,false,true,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,true,false,'SEED FICTIONAL LINE 11'),/restricted/);
 assert.throws(()=>assertPilotSeedAllowed(true,true,true,'anything else'),/exact confirmation/);
 assert.doesNotThrow(()=>assertPilotSeedAllowed(true,true,true,'SEED FICTIONAL LINE 11'));
 const src=read('backend/plnMfgPilotSeed.ts'),index=read('backend/index.ts');
 assert.ok(src.includes('mfg_demo_sandboxes'));
 assert.ok(src.includes('externalPostingEnabled:false'));
 assert.ok(src.includes('commitChecked(writes)'));
 assert.ok(!src.includes('/material_journal/')&&!src.includes('/purchase_orders/')&&!src.includes('/financial_journal/'));
 assert.ok(index.includes('...plnMfgPilotRoutes'));
});

test('effective dates are validated, not merely sliced',()=>{
 const valid={id:'BOM-DATED',name:'Dated BOM',type:'BOM',parentSkuId:'FG-WATER',outputQty:1,outputUom:'CASE',
    components:[{skuId:'CAP-2622',quantity:12,uom:'EA'}]};
 assert.equal(normalizeMaster('boms',{...valid,effectiveFrom:'2027-01-01'}).effectiveFrom,'2027-01-01');
 assert.throws(()=>normalizeMaster('boms',{...valid,effectiveFrom:'2027-02-30'}),/valid YYYY-MM-DD/);
 assert.throws(()=>normalizeMaster('boms',{...valid,effectiveFrom:'2027-13-01'}),/valid YYYY-MM-DD/);
});

test('approval locks unique SKU site and effectivity slot transactionally',()=>{
 const src=read('backend/plnMfgRelease.ts');
 assert.match(src,/mfg_release_slots/);
 assert.match(src,/slotKey/);
 assert.match(src,/precondition:\{exists:false\}/);
 assert.match(src,/ctx\.testMode===true/);
 assert.match(src,/ctx\.bypassed\?\.push\('mfg\.release\.independent_checker'\)/);
});

test('master-data selector lists published Inventory, active Assets and site records',()=>{
 const src=read('backend/plnMfgFoundation.ts');
 assert.match(src,/foundation\/references/);
 assert.match(src,/organizations.*materials|orgRoot\+'\/materials'/);
 assert.match(src,/orgRoot\+'\/assets'/);
 assert.match(src,/status\)==='active'/);
 const ui=read('src/org/ProductionFoundation.tsx');
 assert.match(ui,/Published Inventory Material Master/);
 assert.match(ui,/Active Asset Register equipment/);
 assert.match(ui,/Site applicability/);
});
