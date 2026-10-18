import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAddedOrgRoutes } from '../../scripts/future-route-check.mjs';
test('allows new routes with explicit nonempty permission guard',()=>{
  const diff="+    'POST /api/org/mnt/new': [\n+      orgRoute('org.mnt.new','MNT.WO.create',async ctx => ({})),";
  assert.deepEqual(validateAddedOrgRoutes(diff),[]);
});
test('rejects new routes without a route-level action permission',()=>{
  for(const wrapper of ["publicRoute(async () => ({}))","orgRoute('org.mnt.new',null,async ctx => ({}))"]){
    const diff="+    'POST /api/org/mnt/new': [\n+      "+wrapper+",";
    assert.equal(validateAddedOrgRoutes(diff).length,1);
  }
});
