import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {restrictionCodesOf, locationBlock, binningBlock} from '../../backend/restrictionRules.ts';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const master=[
  {code:'RS01',label:'Temperature controlled',active:true},
  {code:'RS03',label:'Restricted access',active:true},
  {code:'RS15',label:'General',active:true},
  {code:'RS08',label:'Flammable',active:false},
];

test('cluster selection accepts multiple distinct restrictions and legacy single code',()=>{
  assert.deepEqual(restrictionCodesOf(['RS03','RS15','RS03']),['RS03','RS15']);
  assert.deepEqual(restrictionCodesOf(undefined,'RS03'),['RS03']);
  assert.deepEqual(restrictionCodesOf([]),[]);
});

test('material is permitted when its effective restriction matches any enabled cluster selection',()=>{
  assert.equal(locationBlock(['RS03','RS15'],master,'CL-0001'),'');
  assert.equal(binningBlock('RS15',['RS03','RS15'],master,'CL-0001'),'');
  assert.equal(binningBlock('RS03',['RS03','RS15'],master,'CL-0001'),'');
  assert.match(binningBlock('RS01',['RS03','RS15'],master,'CL-0001'),/Restriction mismatch/);
});

test('unconfigured or disabled cluster restrictions are blocked',()=>{
  assert.match(locationBlock([],master,'CL-0001'),/at least one/);
  assert.match(locationBlock(['RS99'],master,'CL-0001'),/unknown/);
  assert.match(locationBlock(['RS03','RS08'],master,'CL-0001'),/disabled/);
  assert.match(binningBlock('RS08',['RS03','RS15'],master,'CL-0001'),/disabled/);
  assert.match(binningBlock('', ['RS03'],master,'CL-0001'),/no warehouse restriction/);
});

test('warehouse restrictions and pallet stacking are configured exclusively on clusters',()=>{
  const ui=read('src/org/WarehouseSetup.tsx');
  const server=read('backend/warehouse.ts');
  assert.ok(ui.includes('5 · Warehouse restrictions *'));
  assert.ok(ui.includes('Select all applicable restrictions'));
  assert.ok(ui.includes('const [restrictionCodes,setRestrictionCodes]=useState<string[]>([])'));
  assert.ok(ui.includes("data.restrictions.map(r=><label"));
  assert.ok(ui.includes("'POST /api/org/warehouse/cluster/update'")===false); // path sent to API, not endpoint registered in the UI
  assert.ok(ui.includes("callBackend('/api/org/warehouse/cluster/update'"));
  assert.ok(!ui.includes('id={\`loc-rs-'));
  assert.ok(!ui.includes("data-testid='warehouse-pallet-stacking'"));
  assert.ok(ui.includes("data-testid='cluster-pallet-stacking'"));
  assert.ok(ui.includes("id='cl-condition'"));
  assert.ok(server.includes("'POST /api/org/warehouse/cluster/update'"));
  assert.ok(server.includes('restrictionCodes: restrictionCodes as unknown as Plain'));
});

test('Stock Control and bin occupancy use the new multiple-restriction cluster identity',()=>{
  const server=read('backend/warehouse.ts');
  const inventory=read('backend/procurement.ts');
  assert.ok(server.includes("str(x.data.binId).startsWith(code+'__')"));
  assert.ok(server.includes('Linked material '));
  assert.ok(server.includes('clusterRestrictionCodes:codes as unknown as Plain'));
  assert.ok(inventory.includes('clusterRestrictions.includes(effectiveRestriction('));
  assert.ok(inventory.includes('restrictionCodesOf(cluster.data.restrictionCodes'));
  assert.ok(inventory.includes('binningBlock(nextRestriction,codes'));
  assert.ok(inventory.includes('clusterRestrictionCodes:restrictionCodesOf(bin.restrictionCodes'));
  assert.ok(server.includes('Delink them before deleting its physical positions.'));
});
