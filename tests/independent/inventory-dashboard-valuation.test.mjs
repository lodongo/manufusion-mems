import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeInventoryDashboard } from '../../backend/inventoryDashboardSummary.ts';

const read=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const item=(changes={})=>({
    id:'a',warehouseId:'w1',uom:'UOM-01-002',stockCurrency:'KES',
    stockStatus:'Within limits',stockLedgerAvailable:true,
    netAvailable:1600,quantityOnHand:1600,netStockValue:80000,
    unitCostLocal:50,maximumLevel:1000,emptyBin:false,hasLinkedBin:true,...changes,
});
const snapshot=(items)=>({
    warehouses:[{id:'w1',name:'Warehouse One',code:'W1'},{id:'w2',name:'Warehouse Two',code:'W2'}],
    currencies:[{code:'KES',rate:130},{code:'USD',rate:1}],items,
});

test('dashboard valuation reuses reconciled local net valuation; procurement purchase prices are NOT multiplied again',()=>{
    const r=summarizeInventoryDashboard(snapshot([item()]));
    assert.equal(r.byCurrency.KES.stockValue,80000); // 1600 kg × KES 50/kg, not 1600 × KES 50000/tonne
    assert.equal(r.byCurrency.KES.overstockValue,30000);
    assert.equal(r.quantities[0].overstockQuantity,600);
    assert.equal(r.emptyBins,0);
    assert.equal(r.linkedBins,1);
});
test('warehouse filter is applied to all monetary, bin and stock metrics, never only the headline',()=>{
    const items=[
        item({id:'a',warehouseId:'w1'}),
        item({id:'b',warehouseId:'w2',netAvailable:50,quantityOnHand:50,netStockValue:500,unitCostLocal:10,maximumLevel:100,stockStatus:'Within limits',emptyBin:true}),
    ];
    const all=summarizeInventoryDashboard(snapshot(items),'all');
    const selected=summarizeInventoryDashboard(snapshot(items),'w2');
    assert.equal(all.byCurrency.KES.stockValue,80500);
    assert.equal(all.emptyBins,1);
    assert.equal(selected.byCurrency.KES.stockValue,500);
    assert.equal(selected.emptyBins,1);
    assert.equal(selected.overstockCount,0);
    assert.equal(selected.totalRows,1);
});
test('multi-currency values stay separated by default and convert to one currency only with configured rates',()=>{
    const s=snapshot([item(),item({id:'b',warehouseId:'w2',stockCurrency:'USD',netStockValue:100,unitCostLocal:1,netAvailable:100,quantityOnHand:100,maximumLevel:200})]);
    const local=summarizeInventoryDashboard(s);
    assert.equal(local.byCurrency.KES.stockValue,80000);
    assert.equal(local.byCurrency.USD.stockValue,100);
    const usd=summarizeInventoryDashboard(s,'all','USD');
    assert.ok(Math.abs(usd.byCurrency.USD.stockValue-(80000/130+100))<1e-4);
    assert.equal(Object.keys(usd.byCurrency).length,1);
    const bad=summarizeInventoryDashboard({...s,currencies:[]},'all','USD');
    assert.equal(bad.unvalued,1);
    assert.equal(bad.missingExchangeRate,1);
    assert.equal(bad.byCurrency.USD.stockValue,100);
});
test('incompatible quantities are never added: group by UoM, even within same currency',()=>{
    const r=summarizeInventoryDashboard(snapshot([
        item({uom:'kg',netAvailable:100,netStockValue:1000,unitCostLocal:10}),
        item({id:'c',uom:'piece',netAvailable:8,quantityOnHand:8,netStockValue:200,unitCostLocal:25,maximumLevel:12}),
    ]));
    assert.equal(r.quantities.length,2);
    assert.equal(r.quantities.find(x=>x.uom==='kg').netAvailable,100);
    assert.equal(r.quantities.find(x=>x.uom==='piece').netAvailable,8);
});
test('unreconciled, untracked, missing-price and missing-max scenarios do not become invented zeros',()=>{
    const r=summarizeInventoryDashboard(snapshot([
        item(),
        item({id:'missing',netStockValue:null,unitCostLocal:null}),
        item({id:'unreconciled',stockLedgerAvailable:false,stockStatus:'Unreconciled',netStockValue:null}),
        item({id:'untracked',stockLedgerAvailable:false,stockStatus:'Not yet tracked',netStockValue:null}),
        item({id:'no-max',maximumLevel:null,netStockValue:500}),
    ]));
    assert.equal(r.valued,2);assert.equal(r.unvalued,1);
    assert.equal(r.unreconciled,1);assert.equal(r.notTracked,1);
    assert.equal(r.withoutMaximum,1);
    assert.equal(r.totalRows,5);
});
test('dashboard and inventory on hand call one shared snapshot; legacy dashboard multiplication is removed',()=>{
    const backend=read('backend/procurement.ts');
    const ui=read('src/org/InventoryDashboard.tsx');
    assert.match(backend,/async function inventoryOnHandSnapshot\(ctx: OrgContext\)/);
    assert.match(backend,/summarizeInventoryDashboard\(snapshot,warehouseId,displayCurrency\)/);
    assert.match(backend,/'POST \/api\/org\/inventory\/on-hand': \[orgRoute\('org.inventory.onhand', null, inventoryOnHandSnapshot\)/);
    assert.doesNotMatch(backend,/c\.stockValue\+=q\*price/);
    assert.match(ui,/id='inv-dashboard-warehouse'/);
    assert.match(ui,/value=\{warehouseId\}/);
    assert.match(ui,/id='inv-dashboard-currency'/);
});
