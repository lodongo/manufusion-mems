/**
 * Fail-closed configuration gate for the isolated development environment.
 * Firebase web fields are public identifiers, NOT server credentials.
 * Do not reuse this guard as an authorization check for business API calls.
 */
const required = (env, name) => {
  const value = String(env[name] || '').trim();
  if (!value || /^(YOUR_|REPLACE_|TODO|undefined|null)/i.test(value)) {
    throw new Error(name + ' must be configured for an isolated MEMS development project.');
  }
  return value;
};
const denyLive = (value, name) => {
  if (/mems2026/i.test(value)) throw new Error(name + ' contains the production Firebase project ID.');
};
const safeProject = (value) => {
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(value) || !/(^|[-])(dev|development|test|testing|staging|sandbox)([-]|$)/.test(value)) {
    throw new Error('GCP_DEV_PROJECT_ID must be an explicit, clearly named non-production project (e.g. mems-dev-1234).');
  }
  denyLive(value, 'GCP_DEV_PROJECT_ID');
  return value;
};
export function verifyDevBuild(env = process.env) {
  if (env.MEMS_ALLOW_LIVE_DATA) throw new Error('Live data override is forbidden in the development deployment.');
  const project = safeProject(required(env, 'GCP_DEV_PROJECT_ID'));
  const webProject = required(env, 'VITE_FIREBASE_PROJECT_ID');
  if (project !== webProject) throw new Error('Firebase web project must equal the dedicated GCP_DEV_PROJECT_ID.');
  for (const name of [
    'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
  ]) denyLive(required(env, name), name);
  const domain = required(env, 'VITE_FIREBASE_AUTH_DOMAIN').toLowerCase();
  if (domain !== project + '.firebaseapp.com' && domain !== project + '.web.app') {
    throw new Error('Firebase authDomain must be assigned to the separate development project.');
  }
  const firebaseBucket = required(env, 'VITE_FIREBASE_STORAGE_BUCKET');
  if (!firebaseBucket.startsWith(project + '.') && !firebaseBucket.startsWith(project + '-')) {
    throw new Error('Firebase Storage bucket must belong to the separate development project.');
  }
  if (!/^\d{5,20}$/.test(required(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'))) {
    throw new Error('VITE_FIREBASE_MESSAGING_SENDER_ID must be numeric.');
  }
  return project;
}
export function verifyDevDeploy(env = process.env) {
  const project = verifyDevBuild(env);
  const backendProject = required(env, 'MEMS_FIREBASE_PROJECT_ID');
  if (backendProject !== project) throw new Error('Backend and frontend Firebase projects do not match.');
  const bucket = required(env, 'MEMS_STORAGE_BUCKET');
  denyLive(bucket, 'MEMS_STORAGE_BUCKET');
  if (!bucket.startsWith(project + '-') && !bucket.startsWith(project + '.')) {
    throw new Error('MEMS_STORAGE_BUCKET must be dedicated to the development project.');
  }
  const region = required(env, 'GCP_DEV_REGION');
  if (!/^[a-z]+(?:-[a-z]+\d+)+$/.test(region)) throw new Error('Unexpected Google Cloud region format.');
  for (const name of ['GCP_DEV_DEPLOYER_SA', 'GCP_DEV_RUNTIME_SA']) {
    if (!required(env, name).endsWith('@' + project + '.iam.gserviceaccount.com')) {
      throw new Error(name + ' must belong to the development project.');
    }
  }
  if (!/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(required(env,'GCP_DEV_WIF_PROVIDER'))) {
    throw new Error('GCP_DEV_WIF_PROVIDER must contain the full Workload Identity provider resource name.');
  }
  return project;
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    const mode = process.argv[2];
    if (mode === 'build') verifyDevBuild();
    else if (mode === 'deploy') verifyDevDeploy();
    else throw new Error('Specify build or deploy.');
    console.log('Isolated MEMS development configuration verified (' + mode + ').');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Configuration invalid.');
    process.exitCode = 1;
  }
}
