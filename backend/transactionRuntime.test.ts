import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWiredRoutes, wiredInventorySummary, wiredTransactionInventory } from './transactionRuntime';

test('registered organization handlers receive stable distinct diagnostic codes', () => {
  const a = Object.assign(async () => null, {governanceMetadata:{name:'org.mnt.wr.create',permission:'MNT.WR.create',kind:'organization' as const}});
  const b = Object.assign(async () => null, {governanceMetadata:{name:'org.prc.po.approve',permission:'PRC.po.approve',kind:'organization' as const}});
  const registered = { 'POST /api/org/mnt/wr/create':[a], 'POST /api/org/prc/po/approve':[b] };
  assert.equal(recordWiredRoutes(registered),registered);
  const first=wiredTransactionInventory();
  assert.equal(first.length,2);
  assert.equal(first[0].handlerWired,true);
  assert.ok(first.every(x=>x.code && /^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,8}$/.test(x.code)));
  assert.equal(new Set(first.map(x=>x.code)).size,2);
  assert.equal(first.find(x=>x.module==='MNT')?.area,'WRQ');
  recordWiredRoutes(registered);
  assert.deepEqual(wiredTransactionInventory(),first);
});
test('unclassified routes never masquerade as certified operational transactions', () => {
  recordWiredRoutes({'POST /api/org/unknown/write':[async()=>null]});
  assert.equal(wiredInventorySummary().orgGuardedRoutes,0);
  assert.equal(wiredInventorySummary().unclassified,1);
  assert.equal(wiredInventorySummary().activationCertified,0);
});
