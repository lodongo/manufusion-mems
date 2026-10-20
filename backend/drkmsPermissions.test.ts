import assert from 'node:assert/strict';
import test from 'node:test';
import { ADM_PERMISSIONS, ALL_BUILT_KEYS } from './permissionPolicy';

test('document registry and configuration are separate permissions', () => {
  const keys = ADM_PERMISSIONS.map(p => p.key);
  assert.ok(keys.includes('ADM.document_registry'));
  assert.ok(keys.includes('ADM.document_config'));
  assert.ok(ALL_BUILT_KEYS.has('ADM.document_registry'));
  assert.ok(ALL_BUILT_KEYS.has('ADM.document_config'));
  assert.ok(!keys.includes('DRK.publish'), 'Publication is not yet implemented or grantable');
});
