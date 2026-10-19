/**
 * Dependency-aware, network-isolated smoke test. No Firebase/Firestore request
 * is ever made: all API requests are either blocked at the safety guard or
 * resolved by the unknown-route handler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createSocketServer } from 'node:net';
import { once } from 'node:events';
import { existsSync } from 'node:fs';

async function freePort() {
  const server = createSocketServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  return port;
}
async function runServer(overrides, fn) {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const env = {
    ...process.env,
    PORT: String(port),
    MEMS_FIREBASE_PROJECT_ID: '',
    MEMS_STORAGE_BUCKET: '',
    MEMS_ALLOW_LIVE_DATA: '',
    ...overrides,
  };
  const child = spawn(process.execPath, ['--import', 'tsx', 'backend/platform/server.ts'], {
    cwd: process.cwd(), env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput += String(chunk).slice(0, 1200); });
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Server exited early: ' + errorOutput);
      try {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(500) });
        if (response.ok) break;
      } catch { /* Server still booting. */ }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    const check = await fetch(base + '/health', { signal: AbortSignal.timeout(1500) });
    assert.equal(check.status, 200, errorOutput);
    await fn(base);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
test('MEMS independent server serves the built frontend without exposing code', { timeout: 30000 }, async () => {
  assert.ok(existsSync('dist/index.html'), 'Run npm run build before the runtime smoke test.');
  await runServer({ MEMS_DEPLOY_SHA: 'smoke-test-revision' }, async base => {
    const health = await fetch(base + '/health');
    assert.deepEqual(await health.json(), { service: 'mems-independent', ok: true, revision: 'smoke-test-revision' });
    const compatibility = await fetch(base + '/healthz');
    assert.equal(compatibility.status, 200);
    assert.equal((await compatibility.json()).revision, 'smoke-test-revision');
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /id="root"/);
    const source = await fetch(base + '/backend/core.ts');
    assert.equal(source.status, 404);
    const api = await fetch(base + '/api/not-a-route');
    assert.equal(api.status, 503);
    assert.match((await api.json()).error, /not configured/i);
  });
});
test('MEMS independent API refuses the existing live Firebase database', { timeout: 30000 }, async () => {
  await runServer({ MEMS_FIREBASE_PROJECT_ID: 'mems2026', MEMS_STORAGE_BUCKET: 'mems2026-bucket' }, async base => {
    const response = await fetch(base + '/api/not-a-route');
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /live Firebase access is blocked/i);
  });
});
test('MEMS independent API routes isolated dev requests without touching Firestore', { timeout: 30000 }, async () => {
  await runServer({ MEMS_FIREBASE_PROJECT_ID: 'mems-dev-sample', MEMS_STORAGE_BUCKET: 'mems-dev-sample-files' }, async base => {
    const absentRoute = await fetch(base + '/api/not-a-route');
    assert.equal(absentRoute.status, 404);
    assert.match((await absentRoute.json()).error, /not found/i);
  });
});

