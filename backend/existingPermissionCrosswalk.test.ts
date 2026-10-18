import assert from 'node:assert/strict';
import test from 'node:test';
import { existingPermissionCrosswalk, existingPermissionMappingSummary } from './existingPermissionCrosswalk';
import { plannedTransactionBlueprints } from './transactionBlueprints';

test('all existing permissions have exactly one crosswalk row without changing stored keys', () => {
  const rows=existingPermissionCrosswalk();
  assert.ok(rows.length>0);
  assert.equal(new Set(rows.map(r=>r.existingPermission)).size,rows.length);
  assert.ok(rows.every(r=>r.mappingCertified===false));
});

test('proposals only refer to actual transaction blueprints; ambiguous mergers are not accepted', () => {
  const codes=new Set(plannedTransactionBlueprints().filter(b=>b.kind==='transaction').map(b=>b.code));
  const rows=existingPermissionCrosswalk();
  const uses=new Map<string,number>();
  for(const row of rows) {
    if(!row.suggestedCode) {assert.equal(row.status,'manual_mapping_required');continue;}
    assert.ok(codes.has(row.suggestedCode));
    uses.set(row.suggestedCode,(uses.get(row.suggestedCode)??0)+1);
  }
  for(const row of rows) if(row.suggestedCode) assert.equal(row.status,
    uses.get(row.suggestedCode)!>1?'collision_review_required':'proposed_mapping');
  const summary=existingPermissionMappingSummary();
  assert.equal(summary.total,summary.proposed+summary.collisions+summary.manualReview);
  assert.equal(summary.certified,0);
});
