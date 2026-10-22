import assert from 'node:assert/strict';
import test from 'node:test';
import { hrSiteOf, managedRoots, underManagedRoot } from './hrHierarchy';

const nodes = new Map([
  ['le',{level:'legal_entity',parentId:'root',status:'active'}],
  ['siteA',{level:'site',parentId:'le',status:'active'}],
  ['siteB',{level:'site',parentId:'le',status:'active'}],
  ['deptA',{level:'department',parentId:'siteA',status:'active',managerUid:'managerA'}],
  ['ccA',{level:'cost_center',parentId:'deptA',status:'active'}],
  ['deptB',{level:'department',parentId:'siteB',status:'active',managerUid:'managerB'}],
  ['closed',{level:'department',parentId:'siteA',status:'inactive',managerUid:'managerA'}],
  ['childClosed',{level:'cost_center',parentId:'closed',status:'active'}],
  ['loopA',{level:'department',parentId:'loopB',status:'active'}],
  ['loopB',{level:'department',parentId:'loopA',status:'active'}],
]);
test('site of a descendant cannot leak across site or through inactive ancestors',()=>{
  assert.equal(hrSiteOf('ccA',nodes),'siteA');
  assert.equal(hrSiteOf('deptB',nodes),'siteB');
  assert.equal(hrSiteOf('childClosed',nodes),'');
  assert.equal(hrSiteOf('loopA',nodes),'');
  assert.equal(hrSiteOf('missing',nodes),'');
});
test('managed hierarchy needs verified primary node and matching manager identity',()=>{
  const a=managedRoots('managerA',['deptA','deptB','closed'],nodes);
  assert.deepEqual([...a],['deptA']);
  assert.equal(underManagedRoot('ccA',a,nodes),true);
  assert.equal(underManagedRoot('deptB',a,nodes),false);
  assert.equal(underManagedRoot('childClosed',a,nodes),false);
  assert.equal(underManagedRoot('loopA',a,nodes),false);
  assert.equal(managedRoots('managerA',['ccA'],nodes).size,0);
});
