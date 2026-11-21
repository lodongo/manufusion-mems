import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {palletPositionCapacity} from '../../backend/warehouse.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');

test('straight stacking allocates floor footprint and full levels separately',()=>{
  const result=palletPositionCapacity({storageTypeCode:'PAL',stackingEnabled:true,stackingPattern:'STRAIGHT',
    bottomRowPallets:4,bottomRows:3,numberOfStacks:3,count:12},'PAL',100);
  assert.equal(result.size,12);
  assert.equal(result.palletCapacity,36);
  assert.equal(result.numberOfStacks,3);
  assert.equal(result.stackingPattern,'STRAIGHT');
  assert.equal(result.secondLevelPallets,null);
});

test('pyramid stacking has precisely two levels, upper level half of bottom',()=>{
  const result=palletPositionCapacity({storageTypeCode:'PAL',stackingEnabled:true,stackingPattern:'PYRAMID',
    bottomRowPallets:4,bottomRows:3,numberOfStacks:2,count:12},'PAL',100);
  assert.equal(result.size,12);
  assert.equal(result.numberOfStacks,2);
  assert.equal(result.secondLevelPallets,6);
  assert.equal(result.palletCapacity,18);
  assert.equal(result.stackingPattern,'PYRAMID');
});

test('pyramid validation prevents extra levels, fractional pallets and invalid dimensions',()=>{
  const base={storageTypeCode:'PAL',stackingEnabled:true,stackingPattern:'PYRAMID',
    bottomRowPallets:4,bottomRows:3,numberOfStacks:2,count:12};
  assert.throws(()=>palletPositionCapacity({...base,numberOfStacks:3},'PAL',100),/exactly two levels/);
  assert.throws(()=>palletPositionCapacity({...base,bottomRowPallets:3,bottomRows:3,count:9},'PAL',100),/even number/);
  assert.throws(()=>palletPositionCapacity({...base,count:13},'PAL',100),/pallets per bottom row × number of rows/);
  assert.throws(()=>palletPositionCapacity({...base,stackingPattern:'OTHER'},'PAL',100),/straight or pyramid/);
  assert.throws(()=>palletPositionCapacity({...base,bottomRowPallets:2.5},'PAL',100),/Pallets per bottom row/);
  assert.throws(()=>palletPositionCapacity({...base,storageTypeCode:'BIN'},'BIN',100),/only for pallet storage/);
  assert.throws(()=>palletPositionCapacity({...base,count:12},'PAL',10),/number of physical positions/);
});

test('existing configured warehouse and clusters retain legacy row-column stacking settings',()=>{
  const result=palletPositionCapacity({storageTypeCode:'PAL',stackingEnabled:true,stackedRows:3,
    stackedColumns:4,numberOfStacks:3,count:12},'PAL',100);
  assert.equal(result.stackingPattern,'STRAIGHT');
  assert.equal(result.bottomRowPallets,4);
  assert.equal(result.bottomRows,3);
  assert.equal(result.palletCapacity,36);
  assert.equal(palletPositionCapacity({storageTypeCode:'PAL',count:7},'BIN',100).palletCapacity,7);
  assert.equal(palletPositionCapacity({storageTypeCode:'BIN',count:7},'BIN',100).palletCapacity,null);
});

test('warehouse form, cluster creation and backend persist explicit stacking methods',()=>{
  const ui=read('src/org/WarehouseSetup.tsx');
  const api=read('backend/warehouse.ts');
  assert.ok(ui.includes("['positions', 'Positions', null]"));
  assert.ok(ui.includes("['map', 'Storage map']"));
  assert.ok(ui.includes("data-testid='warehouse-pallet-stacking'"));
  assert.ok(ui.includes("data-testid='cluster-pallet-stacking'"));
  assert.ok(ui.includes("2 · Select physical storage type and stacking"));
  assert.ok(ui.includes("label='Pallets per bottom row *'"));
  assert.ok(ui.includes("label='Number of rows *'"));
  assert.ok(ui.includes("label='Stacking arrangement *'"));
  assert.ok(ui.includes("value='PYRAMID'"));
  assert.ok(ui.includes("value='STRAIGHT'"));
  assert.ok(ui.includes("stackingPattern:palletPattern"));
  assert.ok(ui.includes("bottomRowPallets:stackValues[1]"));
  assert.ok(ui.includes("bottomRows:stackValues[0]"));
  assert.ok(api.includes('palletPositionCapacity(b,str(wh.data.storageTypeCode),total)'));
  assert.ok(api.includes('palletStacking: palletStacking as unknown as Plain'));
  assert.ok(api.includes('palletCapacity: clusters.reduce'));
  assert.ok(api.includes("str(palletDefaults.stackingPattern)||'STRAIGHT'"));
});
