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
test('an edited line that keeps an existing route is not treated as a new route',()=>{
  const diff="-    'POST /api/org/prc/inbox': [orgRoute('org.prc.inbox', null, async ctx => ({a:1}))],\n+    'POST /api/org/prc/inbox': [orgRoute('org.prc.inbox', null, async ctx => ({a:2}))],";
  assert.deepEqual(validateAddedOrgRoutes(diff),[]);
});
test('a genuinely new route on an edited line is still gated',()=>{
  const diff="-    'POST /api/org/prc/inbox': [orgRoute('org.prc.inbox', null, async ctx => ({}))],\n+    'POST /api/org/prc/inbox': [orgRoute('org.prc.inbox', null, async ctx => ({}))],'POST /api/org/prc/new': [orgRoute('org.prc.new', null, async ctx => ({}))],";
  assert.equal(validateAddedOrgRoutes(diff).length,1);
});
