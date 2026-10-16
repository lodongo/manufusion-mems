/** Portable MEMS HTTP transport replacing @appdeploy/client. */
export interface HttpClientResponse<T = unknown> { data: T }
const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
async function request<T>(method: string, path: string, value?: unknown): Promise<HttpClientResponse<T>> {
    if (!path.startsWith('/api/')) throw new Error('Invalid MEMS API route.');
    const response = await fetch(base + path, {
        method,
        headers: { Accept: 'application/json', ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(value ?? {}),
        credentials: 'same-origin',
    });
    let data: unknown;
    try { data = await response.json(); } catch { data = { error: 'Invalid server response.' }; }
    if (!response.ok) {
        const info = data as { error?: string; message?: string };
        const err = new Error(info?.error || info?.message || 'Server request failed.');
        Object.assign(err, { response: { data, status: response.status } });
        throw err;
    }
    return { data: data as T };
}
export const api = {
    get: <T = unknown>(path: string) => request<T>('GET', path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T = unknown>(path: string, body?: unknown) => request<T>('PUT', path, body),
    delete: <T = unknown>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
