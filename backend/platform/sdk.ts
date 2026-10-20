/**
 * Portable replacements for the AppDeploy server SDK interfaces used by MEMS.
 *
 * Dependencies: Google Cloud Storage and Node. No AppDeploy runtime is needed.
 * Do not expand these adapters into application-level permissions. Authorization
 * remains in the existing MEMS routes, and storage is server-side only.
 */
import { Storage } from '@google-cloud/storage';
import type { IncomingHttpHeaders } from 'node:http';

export interface LocalEvent {
    rawPath: string;
    httpMethod: string;
    body?: unknown;
    headers?: IncomingHttpHeaders;
    queryStringParameters?: Record<string, string>;
    requestContext?: { http?: { sourceIp?: string; method?: string } };
}
export interface RouterContext {
    body: unknown;
    query: Record<string, string>;
    params: Record<string, string>;
    event: LocalEvent;
}
export interface RouterResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}
type RouteHandler = (ctx: RouterContext) =>
    Promise<RouterResponse | void> | RouterResponse | void;
const response = (value: unknown, statusCode: number): RouterResponse => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(value),
});
export const json = (value: unknown, statusCode = 200): RouterResponse => response(value, statusCode);
export const error = (message: string, statusCode = 500): RouterResponse => response({ error: message }, statusCode);

/** Route definitions are preserved exactly from backend/index.ts and all modules. */
export function router(routes: Record<string, RouteHandler[]>) {
    return async (event: LocalEvent): Promise<RouterResponse> => {
        const method = (event.httpMethod || '').toUpperCase();
        const route = `${method} ${event.rawPath}`;
        const handlers = routes[route];
        if (!handlers) return error('Not found.', 404);
        const ctx: RouterContext = {
            body: event.body ?? {},
            query: event.queryStringParameters ?? {},
            params: {},
            event,
        };
        try {
            for (const middleware of handlers) {
                const result = await middleware(ctx);
                if (result) return result;
            }
            return error('No response from route.', 500);
        } catch (err) {
            // Avoid leaking internal filesystem, credentials or infrastructure details.
            console.error('Unhandled MEMS route exception', route, err instanceof Error ? err.message : 'unknown');
            return error('Something went wrong. Please try again.', 500);
        }
    };
}

const gs = new Storage();
function safeObjectPath(value: string): string {
    if (!value || value.length > 420 || value.startsWith('/') || value.includes('\\') ||
        value.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
        /[\x00-\x1f]/.test(value)) throw new Error('Invalid storage object path.');
    return value;
}
function bucket() {
    const name = process.env.MEMS_STORAGE_BUCKET;
    if (!name) throw new Error('MEMS_STORAGE_BUCKET is not configured.');
    return gs.bucket(name);
}
export const storage = {
    async write(items: Array<{ path: string; content: string; contentType: string }>): Promise<boolean[]> {
        return Promise.all(items.map(async item => {
            try {
                const file = bucket().file(safeObjectPath(item.path));
                await file.save(Buffer.from(item.content, 'base64'), {
                    resumable: false,
                    metadata: { contentType: item.contentType, cacheControl: 'private,no-store' },
                });
                return true;
            } catch (err) {
                console.error('MEMS storage write failed', err instanceof Error ? err.message : 'unknown');
                return false;
            }
        }));
    },
    /** DRKMS originals: cloud object create-only; an existing generation cannot be overwritten. */
    async writeImmutable(items: Array<{path:string;content:string;contentType:string}>): Promise<boolean[]> {
        return Promise.all(items.map(async item => {
            try {
                const file=bucket().file(safeObjectPath(item.path));
                await file.save(Buffer.from(item.content,'base64'), {
                    resumable:false,
                    preconditionOpts:{ifGenerationMatch:0},
                    metadata:{contentType:item.contentType,cacheControl:'private,no-store'},
                });
                return true;
            } catch(err) {
                console.error('MEMS immutable storage write failed',err instanceof Error?err.message:'unknown');
                return false;
            }
        }));
    },
    async url(paths: string[]): Promise<Array<{ path: string; url: string }>> {
        return Promise.all(paths.map(async path => {
            try {
                const [url] = await bucket().file(safeObjectPath(path)).getSignedUrl({
                    version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
                });
                return { path, url };
            } catch (err) {
                console.error('MEMS storage signed URL failed', err instanceof Error ? err.message : 'unknown');
                return { path, url: '' };
            }
        }));
    },
    async delete(paths: string[]): Promise<boolean[]> {
        return Promise.all(paths.map(async path => {
            try {
                await bucket().file(safeObjectPath(path)).delete({ ignoreNotFound: true });
                return true;
            } catch {
                return false;
            }
        }));
    },
};

/** Mount secrets into Cloud Run environment via Secret Manager bindings. */
export const secrets = {
    async readSecret(name: string): Promise<string> {
        if (!/^[A-Z][A-Z0-9_]{2,90}$/.test(name)) throw new Error('Invalid secret identifier.');
        const v = process.env[name];
        if (!v) throw new Error('Required secret not configured: ' + name);
        return v;
    },
    async listSecretNames(): Promise<string[]> {
        // Only return configured application secret names, never their values.
        const allow = new Set((process.env.MEMS_SECRET_NAMES || '').split(',').map(s => s.trim()));
        allow.add('FIREBASE_SERVICE_ACCOUNT');
        return [...allow].filter(name => name && Boolean(process.env[name]));
    },
};

/**
 * AppDeploy connection IDs cannot be reused outside AppDeploy. The frontend
 * uses authenticated refresh while a dedicated independent notification
 * channel is being built. Never claim the payload was delivered.
 */
export const ws = {
    async send(_ids: string[], _payload: unknown): Promise<void> {
        throw new Error('Cloud Run realtime broker not yet configured: chat uses periodic refresh.');
    },
};
