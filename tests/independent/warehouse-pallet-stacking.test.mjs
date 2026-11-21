import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {palletPositionCapacity} from '../../backend/warehouse.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('pallet stacking counts floor footprint separately from vertical pallet capacity',()=>{
  const data={storageTypeCode:'PAL',stackingEnabled:true,stackedRows:3,stackedColumns:4,
    numberOfStacks:3,count:12};
  const result=palletPositionCapacity(data,'PAL',100);
  assert.equal(result.size,12);
  assert.equal(result.palletCapacity,36);
  assert.equal(result.stackingEnabled,true);
  assert.equal(result.numberOfStacks,3);
});

test('single-level pallets and non-pallet storage preserve physical capacity',()=>{
  const pallets=palletPositionCapacity({storageTypeCode:'PAL',count:7},'BIN',100);
  assert.equal(pallets.palletCapacity,7);
  assert.equal(pallets.stackingEnabled,false);
  assert.equal(palletPositionCapacity({storageTypeCode:'BIN',count:7},'BIN',100).palletCapacity,null);
});

test('invalid pallet geometries cannot allocate overlapping or phantom floor positions',()=>{
  const base={storageTypeCode:'PAL',stackingEnabled:true,stackedRows:3,stackedColumns:4,
    numberOfStacks:2,count:12};
  assert.throws(()=>palletPositionCapacity({...base,count:13},'PAL',100),/rows × stacked columns/);
  assert.throws(()=>palletPositionCapacity({...base,count:12},'PAL',10),/number of physical positions/);
  assert.throws(()=>palletPositionCapacity({...base,numberOfStacks:0},'PAL',100),/Number of stacks/);
  assert.throws(()=>palletPositionCapacity({...base,stackedRows:2.5},'PAL',100),/Stacked rows/);
  assert.throws(()=>palletPositionCapacity({...base,storageTypeCode:'BIN'},'BIN',100),/only for pallet storage/);
});

test('warehouse location page is storage-type-neutral with pallet controls and summary',()=>{
  const ui=read('src/org/WarehouseSetup.tsx');
  const api=read('backend/warehouse.ts');
  assert.ok(ui.includes("['positions', 'Positions', null]"));
  assert.ok(!ui.includes("['positions', 'Bins', null]"));
  assert.ok(ui.includes("['map', 'Storage map']"));
  assert.ok(ui.includes("label='Stacked rows *'"));
  assert.ok(ui.includes("label='Stacked columns *'"));
  assert.ok(ui.includes("label='Number of stacks (pallets high) *'"));
  assert.ok(ui.includes("Pallet stacking setup"));
  assert.ok(ui.includes("data-testid='warehouse-pallet-stacking'"));
  assert.ok(ui.includes("data-testid='cluster-pallet-stacking'"));
  assert.ok(ui.includes("2 · Select physical storage type and stacking"));
  assert.ok(ui.includes("6 · Name and identification"));
  assert.ok(api.includes("palletStacking: palletStacking as unknown as Plain"));
  assert.ok(api.includes("stackedRows:stackingEnabled?int(stackingRaw.stackedRows"));
  assert.ok(ui.includes("Pallet capacity"));
  assert.ok(api.includes('palletPositionCapacity(b,str(wh.data.storageTypeCode),total)'));
  assert.ok(api.includes('palletCapacity: clusters.reduce'));
});

test('warehouse pallet stacking defaults travel from setup into new clusters',()=>{
  const ui=read('src/org/WarehouseSetup.tsx');
  const api=read('backend/warehouse.ts');
  assert.ok(ui.includes("s?.palletStacking?.enabled??false"));
  assert.ok(ui.includes("setup.palletStacking?.enabled===true"));
  assert.ok(ui.includes("palletStacking:{enabled:storageType==='PAL'&&palletEnabled"));
  assert.ok(api.includes("palletStacking:{"));
  assert.ok(api.includes("palletDefaults.enabled===true"));
  assert.ok(ui.indexOf("2 · Select physical storage type and stacking")<
    ui.indexOf("3 · Allocate physical positions"));
});
