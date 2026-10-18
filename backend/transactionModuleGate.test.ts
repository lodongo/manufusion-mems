import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleForOrgAction, moduleDisableReason } from './transactionModuleGate';

test('permission keys and route names resolve their correct business module',()=>{
  assert.equal(moduleForOrgAction('org.mnt.wo.close','MNT.WO.close'),'MNT');
  assert.equal(moduleForOrgAction('org.inventory.stock.take','INV_ST_020'),'INV');
  assert.equal(moduleForOrgAction('org.assets.create',null),'AST');
  assert.equal(moduleForOrgAction('org.prc.po.approve','PRC.po.manage'),'PRC');
});
test('explicitly disabled module prevents its protected operations',()=>{
  assert.match(moduleDisableReason('org.mnt.wo.close','MNT.WO.close',{MNT:false})??'',/MNT/);
  assert.equal(moduleDisableReason('org.mnt.wo.close','MNT.WO.close',{MNT:true}),null);
  assert.equal(moduleDisableReason('org.mnt.wo.close','MNT.WO.close',{}),null);
  assert.equal(moduleDisableReason('org.users.manage','ADM.users',{ADM:false}),null);
});
