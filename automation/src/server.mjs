import http from 'node:http';
import { refreshDailyFx } from './jobs.mjs';
import { latestRates } from './firestore.mjs';

const port = Number(process.env.PORT || '8080');
// SECURITY: Cloud Run must require authenticated invocations and a dedicated
// scheduler identity must have roles/run.invoker. Do not deploy publicly.
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/healthz')
      return send(res, 200, { ok: true, service: 'mems-automation', version: '0.1.0' });
    if (req.method === 'GET' && path === '/internal/fx/latest') {
      const latest = await latestRates();
      return send(res, latest ? 200 : 404, latest || { error: 'No rates published yet' });
    }
    if (req.method === 'POST' && path === '/internal/jobs/fx-refresh') {
      const result = await refreshDailyFx();
      return send(res, 200, result);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', job: 'fx-refresh',
      message: error instanceof Error ? error.message : 'Unknown error',
      at: new Date().toISOString() }));
    return send(res, 503, { error: 'Automation failed; check logs. No new FX rates published.' });
  }
});
server.listen(port, '0.0.0.0', () => console.log('MEMS automation listening on ' + port));
