import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWiredRoutes, wiredInventorySummary, wiredTransactionInventory, allSystemTransactions } from './transactionRuntime';

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

test('system automatically binds authenticated self-service and staff handlers without role grants',()=>{
  const self=Object.assign(async()=>null,{governanceMetadata:{
    name:'actions.acknowledge',permission:null,kind:'organization' as const}});
  const staff=Object.assign(async()=>null,{governanceMetadata:{
    name:'admin.transactions.list',permission:'read',kind:'staff' as const}});
  const routes={
    'POST /api/org/actions/acknowledge':[self],
    'POST /api/admin/transactions/list':[staff],
    'POST /api/org/unsafe/new':[async()=>null],
  };
  recordWiredRoutes(routes);
  const all=allSystemTransactions();
  assert.equal(all.length,3);
  const action=all.find(r=>r.path.endsWith('/actions/acknowledge'))!;
  assert.equal(action.bindingStatus,'system_bound');
  assert.equal(action.enforcement,'authenticated_handler');
  assert.match(action.code??'',/^ACT-/);
  assert.equal(action.permission,null);
  const admin=all.find(r=>r.path.endsWith('/transactions/list'))!;
  assert.equal(admin.guard,'staff');
  assert.equal(admin.enforcement,'platform_staff');
  assert.match(admin.code??'',/^PLT-/);
  const unsafe=all.find(r=>r.path==='/api/org/unsafe/new')!;
  assert.equal(unsafe.bindingStatus,'unguarded_org');
  assert.equal(unsafe.enforcement,'unclassified');
  assert.equal(wiredInventorySummary().unclassified,1);
  recordWiredRoutes({...routes});
  assert.deepEqual(allSystemTransactions(),all);
});
