import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyProductionDeploy } from '../../scripts/prod-preflight.mjs';
const good={
  GCP_PROD_PROJECT_ID:'mems2026',
  GCP_PROD_REGION:'africa-south1',
  GCP_PROD_WIF_PROVIDER:'projects/404189184064/locations/global/workloadIdentityPools/prod/providers/github',
  GCP_PROD_DEPLOYER_SA:'deployer@mems2026.iam.gserviceaccount.com',
  GCP_PROD_RUNTIME_SA:'runtime@mems2026.iam.gserviceaccount.com',
  MEMS_FIREBASE_PROJECT_ID:'mems2026',
  MEMS_STORAGE_BUCKET:'mems2026-assets',
  VITE_FIREBASE_PROJECT_ID:'mems2026',
  VITE_FIREBASE_AUTH_DOMAIN:'mems2026.firebaseapp.com',
  VITE_FIREBASE_API_KEY:'public-test-key',
  VITE_FIREBASE_APP_ID:'1:1234567890:web:test',
  VITE_FIREBASE_MESSAGING_SENDER_ID:'1234567890',
  VITE_FIREBASE_STORAGE_BUCKET:'mems2026.firebasestorage.app',
};
test('production preflight accepts fully isolated production configuration',()=>{
  assert.equal(verifyProductionDeploy(good),'mems2026');
});
test('production preflight rejects any development or mixed database target',()=>{
  assert.throws(()=>verifyProductionDeploy({...good,GCP_PROD_PROJECT_ID:'manufusion-mems-development'}));
  assert.throws(()=>verifyProductionDeploy({...good,VITE_FIREBASE_PROJECT_ID:'manufusion-mems-development'}));
  assert.throws(()=>verifyProductionDeploy({...good,MEMS_FIREBASE_PROJECT_ID:'manufusion-mems-development'}));
  assert.throws(()=>verifyProductionDeploy({...good,GCP_PROD_RUNTIME_SA:'bad@manufusion-mems-development.iam.gserviceaccount.com'}));
});
