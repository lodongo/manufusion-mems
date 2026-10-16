/** A fail-closed project guard for the standalone FX automation process. */
export function assertProjectConfigured(env = process.env) {
  const project = String(env.MEMS_FIREBASE_PROJECT_ID || '').trim();
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(project))
    throw new Error('MEMS_FIREBASE_PROJECT_ID must identify an explicit Firebase development project.');
  if (project === 'mems2026' && env.MEMS_ALLOW_LIVE_DATA !== 'I_ACKNOWLEDGE_THE_RISK')
    throw new Error('Live Firebase FX writes are blocked without an explicit migration approval.');
  return project;
}
