import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProjectConfigured } from '../src/projectGuard.mjs';

test('requires explicit project configuration for FX job', () => {
  assert.throws(() => assertProjectConfigured({}), /MEMS_FIREBASE_PROJECT_ID/);
  assert.equal(assertProjectConfigured({ MEMS_FIREBASE_PROJECT_ID: 'mems-sandbox-26' }), 'mems-sandbox-26');
});
test('refuses live mems2026 without explicit acknowledgement', () => {
  assert.throws(() => assertProjectConfigured({ MEMS_FIREBASE_PROJECT_ID: 'mems2026' }), /Live Firebase/);
});
