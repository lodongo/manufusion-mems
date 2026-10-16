import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDevBuild, verifyDevDeploy } from '../../scripts/dev-preflight.mjs';

function env(overrides = {}) {
  return {
    GCP_DEV_PROJECT_ID: 'mems-dev-example1',
    MEMS_FIREBASE_PROJECT_ID: 'mems-dev-example1',
    MEMS_STORAGE_BUCKET: 'mems-dev-example1-files',
    GCP_DEV_REGION: 'africa-south1',
    GCP_DEV_DEPLOYER_SA: 'mems-dev-deployer@mems-dev-example1.iam.gserviceaccount.com',
    GCP_DEV_RUNTIME_SA: 'mems-dev-runtime@mems-dev-example1.iam.gserviceaccount.com',
    GCP_DEV_WIF_PROVIDER: 'projects/123456789/locations/global/workloadIdentityPools/mems-gh/providers/mems-develop',
    VITE_FIREBASE_API_KEY: 'dev-public-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'mems-dev-example1.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'mems-dev-example1',
    VITE_FIREBASE_STORAGE_BUCKET: 'mems-dev-example1.firebasestorage.app',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789012',
    VITE_FIREBASE_APP_ID: '1:123456789012:web:abcdef',
    ...overrides,
  };
}
test('accepts a matching isolated development project', () => {
  assert.equal(verifyDevBuild(env()), 'mems-dev-example1');
  assert.equal(verifyDevDeploy(env()), 'mems-dev-example1');
});
test('rejects live project even with an explicit override', () => {
  assert.throws(() => verifyDevBuild(env({GCP_DEV_PROJECT_ID: 'mems2026', VITE_FIREBASE_PROJECT_ID: 'mems2026'})), /non-production|production/);
  assert.throws(() => verifyDevDeploy(env({MEMS_ALLOW_LIVE_DATA:'I_ACKNOWLEDGE_THE_RISK'})), /override/);
});
test('rejects frontend/backend project mismatch', () => {
  assert.throws(() => verifyDevBuild(env({VITE_FIREBASE_PROJECT_ID:'other-dev-app'})), /must equal/);
  assert.throws(() => verifyDevDeploy(env({MEMS_FIREBASE_PROJECT_ID:'other-dev-app'})), /do not match/);
});
test('rejects cross-project storage buckets', () => {
  assert.throws(() => verifyDevDeploy(env({MEMS_STORAGE_BUCKET:'some-other-project-files'})), /dedicated/);
  assert.throws(() => verifyDevBuild(env({VITE_FIREBASE_STORAGE_BUCKET:'mems2026.appspot.com'})), /production/);
});
test('rejects other-project service accounts and invalid WIF providers', () => {
  assert.throws(() => verifyDevDeploy(env({GCP_DEV_RUNTIME_SA:'other@mems2026.iam.gserviceaccount.com'})), /development/);
  assert.throws(() => verifyDevDeploy(env({GCP_DEV_WIF_PROVIDER:'not-configured'})), /provider/);
});
test('rejects placeholders and invalid Firebase auth domains', () => {
  assert.throws(() => verifyDevBuild(env({VITE_FIREBASE_API_KEY:'YOUR_API_KEY'})), /configured/);
  assert.throws(() => verifyDevBuild(env({VITE_FIREBASE_AUTH_DOMAIN:'mems2026.firebaseapp.com'})), /production/);
});
