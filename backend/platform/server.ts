/** Independent Cloud Run / local HTTP entrypoint for MEMS. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { handler } from '../index';
import { error } from './sdk';

const port = Number(process.env.PORT || 8080);
const staticRoot = resolve(process.cwd(), 'dist');
const maxRequestBytes = 15 * 1024 * 1024;
const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
function sendJson(res: import('node:http').ServerResponse, statusCode: number, body: unknown) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
}
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', 'http://localhost');
        const path = url.pathname;
        if (path === '/healthz') return sendJson(res, 200, { service: 'mems-independent', ok: true });
        if (path.startsWith('/api/')) {
            if (!process.env.MEMS_FIREBASE_PROJECT_ID || !process.env.MEMS_STORAGE_BUCKET) {
                return sendJson(res, 503, { error: 'Independent environment is not configured.' });
            }
            if (process.env.MEMS_FIREBASE_PROJECT_ID === 'mems2026' &&
                process.env.MEMS_ALLOW_LIVE_DATA !== 'I_ACKNOWLEDGE_THE_RISK') {
                return sendJson(res, 503, { error: 'Live Firebase access is blocked until explicitly approved.' });
            }
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                size += (chunk as Buffer).length;
                if (size > maxRequestBytes) return sendJson(res, 413, { error: 'Request body too large.' });
                chunks.push(chunk as Buffer);
            }
            let body: unknown = {};
            if (size > 0) {
                try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                catch { return sendJson(res, 400, { error: 'JSON request expected.' }); }
            }
            const forwardedFor = req.headers['x-forwarded-for'];
            const clientIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : req.socket.remoteAddress || '';
            const response = await handler({
                httpMethod: req.method || 'GET', rawPath: path,
                body, headers: req.headers,
                queryStringParameters: Object.fromEntries(url.searchParams),
                requestContext: { http: { method: req.method, sourceIp: clientIp } },
            });
            res.writeHead(response.statusCode, response.headers);
            return res.end(response.body);
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
        // Serve only published Vite assets. Never expose backend source, secrets or repository files.
        const candidate = resolve(staticRoot, '.' + decodeURIComponent(path));
        if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep)) {
            return sendJson(res, 403, { error: 'Forbidden.' });
        }
        let filePath = candidate;
        let file = await stat(filePath).catch(() => null);
        if (!file?.isFile()) {
            if (extname(candidate) || path.startsWith('/assets/')) return sendJson(res, 404, { error: 'Not found.' });
            filePath = resolve(staticRoot, 'index.html');
            file = await stat(filePath).catch(() => null);
        }
        if (!file?.isFile()) return sendJson(res, 503, { error: 'Frontend has not been built.' });
        const bytes = await readFile(filePath);
        const contentType = mime[extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public,max-age=3600',
        });
        return res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (err) {
        console.error('MEMS server error', err instanceof Error ? err.message : 'unknown');
        const response = error('Internal server error.', 500);
        if (!res.headersSent) res.writeHead(response.statusCode, response.headers);
        return res.end(response.body);
    }
});
server.requestTimeout = 90000;
server.listen(port, '0.0.0.0', () => console.log('Independent MEMS HTTP service listening on :' + port));
