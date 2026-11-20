import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeDemand,consolidateDemand,demandSourceKey} from '../../backend/plnDemand.ts';

const base={
 skuId:'SKU_000000012',siteId:'SITE_000000002',needDate:'2026-12-02',
 type:'FORECAST',quantity:100,uom:'EA',source:'MANUAL',
 externalId:'',market:'LOCAL',customerReference:'',notes:''
};
const approved=(id,type,quantity,overrides={})=>({...base,id,type,quantity,status:'approved',...overrides});
const source=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('demand validation is industry-independent and requires a site, quantity, date and known type',()=>{
 const row=normalizeDemand(base);
 assert.deepEqual(row,base);
 assert.equal(normalizeDemand({...base,uom:'L'}).uom,'L'); // one-character unit is valid
 assert.throws(()=>normalizeDemand({...base,uom:''}),/demand unit/);
 for(const date of ['2026-02-30','2026-13-01','2026-11-31','foo','2026-1-2'])
  assert.throws(()=>normalizeDemand({...base,needDate:date}),/date/);
 assert.throws(()=>normalizeDemand({...base,quantity:0}),/quantity/);
 assert.throws(()=>normalizeDemand({...base,quantity:-1}),/quantity/);
 assert.throws(()=>normalizeDemand({...base,quantity:Infinity}),/quantity/);
 assert.throws(()=>normalizeDemand({...base,siteId:''}),/site/);
 assert.throws(()=>normalizeDemand({...base,type:'SHIPMENT'}),/forecast or firm order/);
 assert.throws(()=>normalizeDemand({...base,type:'FIRM_ORDER'}),/customer\/order reference/);
 assert.ok(normalizeDemand({...base,type:'FIRM_ORDER',customerReference:'PO-001'}));
});

test('imported demand requires a stable external reference for idempotency',()=>{
 assert.throws(()=>normalizeDemand({...base,source:'CSV_IMPORT',externalId:''}),/source reference/);
 assert.throws(()=>normalizeDemand({...base,source:'EXTERNAL',externalId:''}),/source reference/);
 const imported=normalizeDemand({...base,source:'EXTERNAL',externalId:'SYSTEM-ORDER-12'});
 assert.equal(demandSourceKey(imported).length,40);
 assert.equal(demandSourceKey(imported),demandSourceKey({...imported,quantity:999}));
 assert.notEqual(demandSourceKey(imported),demandSourceKey({...imported,externalId:'SYSTEM-ORDER-13'}));
 assert.notEqual(demandSourceKey(imported),demandSourceKey({...imported,source:'CSV_IMPORT'}));
 assert.equal(demandSourceKey(base),'');
});

test('firm demand consumes forecast once without adding full forecast twice',()=>{
 const lines=[
  approved('F-1','FORECAST',100),
  approved('O-1','FIRM_ORDER',35,{customerReference:'C-1'}),
  approved('O-2','FIRM_ORDER',25,{customerReference:'C-2'}),
 ];
 const rows=consolidateDemand(lines);
 assert.equal(rows.length,1);
 assert.deepEqual([rows[0].forecast,rows[0].firmOrders,rows[0].forecastConsumed,
  rows[0].remainingForecast,rows[0].totalDemand],[100,60,60,40,100]);
 assert.deepEqual(rows[0].sourceIds,['F-1','O-1','O-2']);
 const excess=consolidateDemand([...lines,approved('O-3','FIRM_ORDER',65)]);
 assert.equal(excess[0].forecastConsumed,100);
 assert.equal(excess[0].remainingForecast,0);
 assert.equal(excess[0].totalDemand,125);
});

test('monthly buckets, product, site, market and unit remain separate; no draft leakage',()=>{
 const lines=[
  approved('F1','FORECAST',90),
  approved('O1','FIRM_ORDER',30),
  approved('F2','FORECAST',50,{market:'EXPORT'}),
  approved('O2','FIRM_ORDER',20,{siteId:'SITE_000000003'}),
  approved('O3','FIRM_ORDER',10,{needDate:'2027-01-03'}),
  approved('O4','FIRM_ORDER',15,{skuId:'SKU_000000013'}),
  approved('O5','FIRM_ORDER',55,{uom:'L'}),
  approved('BAD','FIRM_ORDER',999,{status:'draft'}),
  approved('UNAPPROVED','FIRM_ORDER',999,{status:'pending_approval'}),
  approved('INVALID','FORECAST',-200),
 ];
 const result=consolidateDemand(lines);
 assert.equal(result.length,6);
 const local=result.find(x=>x.skuId===base.skuId&&x.siteId===base.siteId&&x.market==='LOCAL'&&x.period==='2026-12'&&x.uom==='EA');
 assert.equal(local?.totalDemand,90);
 assert.equal(result.find(x=>x.market==='EXPORT')?.totalDemand,50);
 assert.equal(result.find(x=>x.siteId==='SITE_000000003')?.totalDemand,20);
 assert.equal(result.find(x=>x.period==='2027-01')?.totalDemand,10);
 assert.equal(result.find(x=>x.skuId==='SKU_000000013')?.totalDemand,15);
 assert.equal(result.find(x=>x.uom==='L')?.totalDemand,55);
});

test('planning screen and protected routes exist, with no inventory or procurement postings',()=>{
 const backend=source('backend/plnDemand.ts'),ui=source('src/org/PlnDemand.tsx');
 const index=source('backend/index.ts'),main=source('src/org/ProductionFoundation.tsx');
 for(const route of ['references','list','save','submit','decide','summary'])
  assert.ok(backend.includes('/api/org/pln/demand/'+route),route);
 assert.ok(index.includes('...plnDemandRoutes'));
 assert.ok(main.includes("key:'demand',label:'Demand & S&OP'"));
 assert.ok(main.includes('<PlnDemand permissions={permissions} formDefaults={formDefaults}/>'));
 assert.ok(ui.includes('Add demand'));
 assert.ok(ui.includes('Submit for approval'));
 assert.ok(ui.includes('Approved demand consolidation'));
 assert.ok(ui.includes("['Approved forecasts',counts.forecasts]"));
 assert.ok(backend.includes('commitChecked('));
 assert.ok(backend.includes("Demand requires an independent reviewer."));
 assert.ok(backend.includes("SOURCE_KEYS(ctx.orgId)"));
 assert.ok(backend.includes("row.data.status)==='approved'"));
 for(const forbidden of ['createPurchaseRequisition(', 'postStockMovement(', 'createProductionOrder('])
  assert.ok(!backend.includes(forbidden));
});
