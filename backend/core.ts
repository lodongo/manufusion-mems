import { createHash, createSign, createVerify, randomBytes } from 'node:crypto';
import { secrets } from '@appdeploy/sdk';
import { PUBLIC_EMAIL_DOMAINS } from './defaults';

// ---------------------------------------------------------------------------
// Configuration and utilities
// ---------------------------------------------------------------------------

export const PROJECT_ID = 'mems2026';
export const STAFF_DOMAIN = 'manufusion.com';
export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
export const DOCUMENT_NAME_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
export const IDENTITY_BASE = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };
export type Fields = Record<string, Plain>;
export type Obj = { [key: string]: Plain };
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

export class HttpError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
export const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const asPlain = (value: unknown): Plain => value as Plain;
export const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
export const nowIso = () => new Date().toISOString();
export const randomId = (bytes = 10) => randomBytes(bytes).toString('hex');

export function emailDomain(email: string): string {
    const at = email.lastIndexOf('@');
    return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

const BUILTIN_PUBLIC_DOMAINS = new Set(PUBLIC_EMAIL_DOMAINS);
const PUBLIC_EMAIL_PREFIXES = ['yahoo.', 'hotmail.', 'outlook.', 'live.', 'gmx.', 'yandex.', 'aol.'];

export function isBuiltinPublicEmail(email: string): boolean {
    const domain = emailDomain(email);
    return BUILTIN_PUBLIC_DOMAINS.has(domain) || PUBLIC_EMAIL_PREFIXES.some((prefix) => domain.startsWith(prefix));
}

export function isStaffDomain(domain: string): boolean {
    return domain === STAFF_DOMAIN || domain.endsWith(`.${STAFF_DOMAIN}`);
}

export function checkPassword(password: string) {
    if (
        password.length < 10 ||
        password.length > 128 ||
        !/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/\d/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
    ) {
        throw new HttpError(400, 'Use at least 10 characters with upper-case and lower-case letters, a number and a symbol.');
    }
}

export function text(body: Record<string, unknown>, key: string, min: number, max: number, message: string): string {
    const value = str(body[key]).trim();
    if (value.length < min || value.length > max) throw new HttpError(400, message);
    return value;
}

export function int(value: unknown, min: number, max: number, message: string): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, message);
    return n;
}

export function phoneE164(value: unknown): string {
    const phone = str(value).replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        throw new HttpError(400, 'Enter the telephone number in international format, e.g. +254712345678.');
    }
    return phone;
}

export const EMAIL_LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await fn();
    } catch {
        return fallback;
    }
}

export function listSecretNames(): Promise<string[]> {
    return secrets.listSecretNames();
}

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------

export interface RequestMeta {
    ip: string;
    userAgent: string;
    language: string;
    country: string;
    city: string;
    referer: string;
}

export function requestMeta(event: unknown): RequestMeta {
    const e = (event ?? {}) as Record<string, any>;
    const raw = (e.headers ?? {}) as Record<string, unknown>;
    const h: Record<string, string> = {};
    for (const key of Object.keys(raw)) h[key.toLowerCase()] = str(raw[key]);
    const ip =
        str(e.requestContext?.http?.sourceIp) ||
        (h['x-forwarded-for'] ?? '').split(',')[0].trim() ||
        str(e.requestContext?.identity?.sourceIp);
    return {
        ip,
        userAgent: (h['user-agent'] ?? '').slice(0, 300),
        language: (h['accept-language'] ?? '').slice(0, 100),
        country: h['cloudfront-viewer-country'] || h['cf-ipcountry'] || h['x-country'] || '',
        city: h['cloudfront-viewer-city'] || '',
        referer: (h['referer'] || h['origin'] || '').slice(0, 200),
    };
}

const CLIENT_KEYS = ['sessionId', 'userAgent', 'platform', 'language', 'timezone', 'screen', 'viewport', 'connection', 'deviceMemory', 'standalone'];

export function clientInfo(raw: unknown): Obj {
    const c = isObj(raw) ? raw : {};
    const out: Obj = {};
    for (const key of CLIENT_KEYS) {
        const v = c[key];
        if (typeof v === 'string') out[key] = v.slice(0, 200);
        else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
        else if (typeof v === 'boolean') out[key] = v;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Firebase ID token verification
// ---------------------------------------------------------------------------

export interface TokenClaims {
    sub: string;
    email: string;
    signInProvider: string;
    iat: number;
    emailVerified: boolean;
}

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

export async function getCerts(force = false): Promise<Record<string, string>> {
    if (!force && certCache && certCache.expiresAt > Date.now()) return certCache.certs;
    const res = await fetch(CERTS_URL);
    if (!res.ok) {
        console.error('Could not load Firebase signing keys', res.status);
        throw new HttpError(503, 'Sign-in service is unavailable. Please try again.');
    }
    const certs = (await res.json()) as Record<string, string>;
    const match = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
    certCache = { certs, expiresAt: Date.now() + (match ? Number(match[1]) * 1000 : 3600000) };
    return certs;
}

function decodeSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export async function verifyIdToken(token: unknown): Promise<TokenClaims> {
    const unauthorized = new HttpError(401, 'Your session has expired. Please log in again.');
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) throw unauthorized;
    const parts = token.split('.');
    if (parts.length !== 3) throw unauthorized;
    const [headerPart, payloadPart, signaturePart] = parts;
    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
        header = decodeSegment(headerPart);
        claims = decodeSegment(payloadPart);
    } catch {
        throw unauthorized;
    }
    const kid = str(header.kid);
    if (header.alg !== 'RS256' || !kid) throw unauthorized;
    let cert = (await getCerts())[kid];
    if (!cert) cert = (await getCerts(true))[kid];
    if (!cert) throw unauthorized;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerPart}.${payloadPart}`);
    verifier.end();
    if (!verifier.verify(cert, Buffer.from(signaturePart, 'base64url'))) throw unauthorized;

    const now = Math.floor(Date.now() / 1000);
    const sub = str(claims.sub);
    const exp = typeof claims.exp === 'number' ? claims.exp : 0;
    const iat = typeof claims.iat === 'number' ? claims.iat : Number.MAX_SAFE_INTEGER;
    const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : iat;
    if (
        claims.aud !== PROJECT_ID ||
        claims.iss !== `https://securetoken.google.com/${PROJECT_ID}` ||
        !sub ||
        sub.length > 128 ||
        exp <= now ||
        iat > now + 300 ||
        authTime > now + 300
    ) {
        throw unauthorized;
    }
    const firebaseClaim = (claims.firebase ?? {}) as Record<string, unknown>;
    return {
        sub,
        email: str(claims.email).toLowerCase(),
        signInProvider: str(firebaseClaim.sign_in_provider),
        iat,
        emailVerified: claims.email_verified === true,
    };
}

// ---------------------------------------------------------------------------
// Service account access token
// ---------------------------------------------------------------------------

interface ServiceAccount {
    client_email: string;
    private_key: string;
}

let serviceAccountCache: ServiceAccount | null = null;
let accessTokenCache: { token: string; expiresAt: number } | null = null;

async function getServiceAccount(): Promise<ServiceAccount> {
    if (serviceAccountCache) return serviceAccountCache;
    let raw: string;
    try {
        raw = await secrets.readSecret('FIREBASE_SERVICE_ACCOUNT');
    } catch {
        console.error('FIREBASE_SERVICE_ACCOUNT secret is missing');
        throw new HttpError(503, 'The server is not configured yet.');
    }
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new HttpError(503, 'The server configuration is invalid.');
    }
    const clientEmail = str(parsed.client_email);
    const privateKey = str(parsed.private_key).replace(/\\n/g, '\n');
    const projectId = str(parsed.project_id);
    if (!clientEmail || !privateKey || (projectId && projectId !== PROJECT_ID)) {
        console.error('FIREBASE_SERVICE_ACCOUNT is incomplete or for a different project');
        throw new HttpError(503, 'The server configuration is invalid.');
    }
    serviceAccountCache = { client_email: clientEmail, private_key: privateKey };
    return serviceAccountCache;
}

export async function getAccessToken(): Promise<string> {
    if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) return accessTokenCache.token;
    const account = await getServiceAccount();
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(account.private_key).toString('base64url');
    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${unsigned}.${signature}`,
        }).toString(),
    });
    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.error('Firebase service account token exchange failed', res.status, detail);
        if (res.status === 429) throw new HttpError(503, 'The database sign-in service is rate limited. Please try again in a minute.');
        if (res.status === 400 || res.status === 401) throw new HttpError(503, `The server could not sign in to the database (service account rejected: ${res.status}). The Firebase service account key may have been revoked or expired.`);
        throw new HttpError(503, `The server could not sign in to the database (token service ${res.status}). Please try again.`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    accessTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
}

export async function googleRequest(url: string, method: string, body?: unknown): Promise<FetchResponse> {
    const token = await getAccessToken();
    try {
        return await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (err) {
        console.error('Database network error', method, err instanceof Error ? err.message : err);
        throw new HttpError(503, 'The server could not connect to the database (network error). Please try again.');
    }
}

export async function fail(res: FetchResponse, operation: string): Promise<never> {
    const detail = (await res.text()).slice(0, 500);
    console.error(`${operation} failed`, res.status, detail);
    let status = '';
    let message = '';
    try {
        const parsed = JSON.parse(detail) as { error?: { status?: unknown; message?: unknown } };
        status = str(parsed.error?.status);
        message = str(parsed.error?.message);
    } catch {
        // not JSON
    }
    if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') {
        throw new HttpError(503, 'The database has reached its usage limit (Firebase quota). Wait for the daily quota to reset or move the Firebase project to a paid plan, then try again.');
    }
    if (res.status === 401 || res.status === 403 || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
        throw new HttpError(503, `The database refused access (${operation}). Check the Firebase service account roles and that the Firestore API and billing are enabled.`);
    }
    if (res.status >= 500 || status === 'UNAVAILABLE' || status === 'DEADLINE_EXCEEDED' || status === 'ABORTED') {
        throw new HttpError(503, `The database is temporarily unavailable (${operation}: ${res.status}). Please try again in a moment.`);
    }
    if (/maximum allowed size|too large|exceeds/i.test(message)) throw new HttpError(413, `The data is too large for the database (${operation}).`);
    throw new HttpError(502, `The database rejected the request (${operation}: ${res.status}${status ? ` ${status}` : ''}).`);
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

export interface Doc {
    id: string;
    data: Fields;
    updateTime: string;
}

export function encodeValue(value: Plain): Record<string, unknown> {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
    return { mapValue: { fields: encodeFields(value) } };
}

export function encodeFields(data: Fields): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
        if (data[key] !== undefined) fields[key] = encodeValue(data[key]);
    }
    return fields;
}

function decodeValue(value: Record<string, any>): Plain {
    if ('stringValue' in value) return value.stringValue as string;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('booleanValue' in value) return Boolean(value.booleanValue);
    if ('timestampValue' in value) return String(value.timestampValue);
    if ('arrayValue' in value) return ((value.arrayValue?.values ?? []) as Array<Record<string, any>>).map(decodeValue);
    if ('mapValue' in value) return decodeFields((value.mapValue?.fields ?? {}) as Record<string, Record<string, any>>);
    return null;
}

function decodeFields(fields: Record<string, Record<string, any>>): Fields {
    const data: Fields = {};
    for (const key of Object.keys(fields)) data[key] = decodeValue(fields[key]);
    return data;
}

export function toDoc(raw: Record<string, any>): Doc {
    return {
        id: str(raw.name).split('/').pop() ?? '',
        data: decodeFields((raw.fields ?? {}) as Record<string, Record<string, any>>),
        updateTime: str(raw.updateTime),
    };
}

export async function getDoc(path: string): Promise<Doc | null> {
    const res = await googleRequest(`${FIRESTORE_BASE}/${path}`, 'GET');
    if (res.status === 404) return null;
    if (!res.ok) await fail(res, 'Firestore read');
    return toDoc((await res.json()) as Record<string, any>);
}

export async function listDocs(collection: string): Promise<Doc[]> {
    const docs: Doc[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
        const qs = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
        const res = await googleRequest(`${FIRESTORE_BASE}/${collection}?${qs}`, 'GET');
        if (!res.ok) await fail(res, 'Firestore list');
        const body = (await res.json()) as { documents?: Array<Record<string, any>>; nextPageToken?: string };
        docs.push(...(body.documents ?? []).map(toDoc));
        if (!body.nextPageToken) break;
        pageToken = body.nextPageToken;
    }
    return docs;
}

export async function createDoc(collection: string, data: Fields): Promise<Doc> {
    const res = await googleRequest(`${FIRESTORE_BASE}/${collection}`, 'POST', { fields: encodeFields(data) });
    if (!res.ok) await fail(res, 'Firestore create');
    return toDoc((await res.json()) as Record<string, any>);
}

function assertDocPath(path: string, operation: string) {
    const segments = path.split('/');
    if (segments.length % 2 !== 0 || segments.some((s) => !s)) {
        console.error(`${operation}: invalid document path`, path);
        throw new HttpError(500, `Internal error: invalid document path (${operation}).`);
    }
}

export async function writeDoc(path: string, data: Fields, precondition?: { exists?: boolean; updateTime?: string }): Promise<boolean> {
    assertDocPath(path, 'Firestore write');
    const query = new URLSearchParams();
    if (precondition?.exists !== undefined) query.set('currentDocument.exists', String(precondition.exists));
    if (precondition?.updateTime) query.set('currentDocument.updateTime', precondition.updateTime);
    const qs = query.toString();
    const res = await googleRequest(`${FIRESTORE_BASE}/${path}${qs ? `?${qs}` : ''}`, 'PATCH', { fields: encodeFields(data) });
    if (!res.ok) {
        if (precondition && (res.status === 400 || res.status === 404 || res.status === 409)) {
            console.warn('Firestore write precondition not met', res.status);
            return false;
        }
        await fail(res, 'Firestore write');
    }
    return true;
}

export async function updateFields(path: string, data: Fields): Promise<void> {
    assertDocPath(path, 'Firestore update');
    const query = new URLSearchParams();
    for (const key of Object.keys(data)) query.append('updateMask.fieldPaths', key);
    const res = await googleRequest(`${FIRESTORE_BASE}/${path}?${query.toString()}`, 'PATCH', { fields: encodeFields(data) });
    if (!res.ok) await fail(res, 'Firestore update');
}

export async function deleteDoc(path: string): Promise<void> {
    const res = await googleRequest(`${FIRESTORE_BASE}/${path}`, 'DELETE');
    if (!res.ok && res.status !== 404) await fail(res, 'Firestore delete');
}

/** Creates many documents in one atomic request (max 500). */
export async function commitCreates(items: Array<{ collection: string; data: Fields }>): Promise<void> {
    for (let i = 0; i < items.length; i += 450) {
        const writes = items.slice(i, i + 450).map((item) => ({
            update: { name: `${DOCUMENT_NAME_ROOT}/${item.collection}/${randomId()}`, fields: encodeFields(item.data) },
            currentDocument: { exists: false },
        }));
        const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', { writes });
        if (!res.ok) await fail(res, 'Firestore commit');
    }
}

export const fieldEq = (field: string, value: Plain) => ({
    fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encodeValue(value) },
});
export const fieldIn = (field: string, values: string[]) => ({
    fieldFilter: { field: { fieldPath: field }, op: 'IN', value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } } },
});
export const orderDesc = (field: string) => [{ field: { fieldPath: field }, direction: 'DESCENDING' }];

export async function runQuery(structuredQuery: Record<string, unknown>, parent = ''): Promise<Doc[]> {
    const res = await googleRequest(`${FIRESTORE_BASE}${parent ? `/${parent}` : ''}:runQuery`, 'POST', { structuredQuery });
    if (!res.ok) await fail(res, 'Firestore query');
    const rows = (await res.json()) as Array<{ document?: Record<string, any> }>;
    return rows.filter((r) => r.document).map((r) => toDoc(r.document as Record<string, any>));
}

export async function countQuery(collectionId: string, where?: Record<string, unknown>): Promise<number> {
    const res = await googleRequest(`${FIRESTORE_BASE}:runAggregationQuery`, 'POST', {
        structuredAggregationQuery: {
            structuredQuery: { from: [{ collectionId }], ...(where ? { where } : {}) },
            aggregations: [{ alias: 'n', count: {} }],
        },
    });
    if (!res.ok) await fail(res, 'Firestore count');
    const rows = (await res.json()) as Array<{ result?: { aggregateFields?: { n?: { integerValue?: string } } } }>;
    return Number(rows[0]?.result?.aggregateFields?.n?.integerValue ?? 0);
}

// ---------------------------------------------------------------------------
// Firebase Authentication admin helpers
// ---------------------------------------------------------------------------

async function identityError(res: FetchResponse): Promise<string> {
    try {
        const body = (await res.json()) as { error?: { message?: string } };
        return str(body.error?.message);
    } catch {
        return '';
    }
}

function mapIdentityError(code: string): HttpError {
    if (code.startsWith('EMAIL_EXISTS')) return new HttpError(409, 'An account with this email already exists.');
    if (code.startsWith('PHONE_NUMBER_EXISTS')) return new HttpError(409, 'This telephone number is already in use.');
    if (code.startsWith('INVALID_PHONE_NUMBER')) return new HttpError(400, 'Enter a valid telephone number.');
    if (code.startsWith('WEAK_PASSWORD')) return new HttpError(400, 'Choose a stronger password.');
    if (code.startsWith('INVALID_EMAIL')) return new HttpError(400, 'Enter a valid email address.');
    return new HttpError(502, 'Firebase Authentication rejected the request. Please try again.');
}

export async function hasAnyAuthUser(): Promise<boolean> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:batchGet?maxResults=1`, 'GET');
    if (!res.ok) await fail(res, 'Firebase Auth user check');
    const data = (await res.json()) as { users?: unknown[] };
    return (data.users?.length ?? 0) > 0;
}

export async function authUserCount(): Promise<number> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:query`, 'POST', { returnUserInfo: false });
    if (!res.ok) await fail(res, 'Firebase Auth count');
    const data = (await res.json()) as { recordsCount?: string };
    return Number(data.recordsCount ?? 0);
}

export async function lookupAuthByEmail(email: string): Promise<{ uid: string; phone: string; disabled: boolean } | null> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:lookup`, 'POST', { email: [email] });
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: Array<{ localId?: string; phoneNumber?: string; disabled?: boolean }> };
    const user = data.users?.[0];
    return user?.localId ? { uid: user.localId, phone: str(user.phoneNumber), disabled: user.disabled === true } : null;
}

/** Firebase's server-side password update time; never trust a client confirmation alone. */
export async function authPasswordUpdatedAt(localId: string): Promise<number | null> {
    const res = await googleRequest(IDENTITY_BASE + '/accounts:lookup', 'POST', { localId: [localId] });
    if (!res.ok) await fail(res, 'Firebase Auth credential verification');
    const data = (await res.json()) as { users?: Array<{ passwordUpdatedAt?: string | number }> };
    const when = Number(data.users?.[0]?.passwordUpdatedAt);
    return Number.isFinite(when) && when > 0 ? when : null;
}

export async function createAuthUser(input: { email: string; password: string; displayName: string; phoneNumber: string }): Promise<string> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts`, 'POST', { ...input, emailVerified: false, disabled: false });
    if (!res.ok) {
        const code = await identityError(res);
        console.error('Firebase Auth create user failed', res.status, code.split(' ')[0]);
        throw mapIdentityError(code);
    }
    const data = (await res.json()) as { localId?: string };
    if (!data.localId) throw new HttpError(502, 'Could not create the account. Please try again.');
    return data.localId;
}

export async function updateAuthUser(localId: string, changes: Record<string, unknown>): Promise<void> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:update`, 'POST', { localId, ...changes });
    if (!res.ok) {
        const code = await identityError(res);
        console.error('Firebase Auth update failed', res.status, code.split(' ')[0]);
        throw mapIdentityError(code);
    }
}

export async function deleteAuthUser(localId: string, strict = false): Promise<void> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:delete`, 'POST', { localId });
    if (!res.ok) {
        const code = await identityError(res);
        console.error('Firebase Auth delete failed', res.status, code.split(' ')[0]);
        if (strict && !code.startsWith('USER_NOT_FOUND')) throw mapIdentityError(code);
    }
}

/** Invalidates all refresh tokens issued before now (forces re-login). */
export async function revokeTokens(localId: string): Promise<void> {
    await updateAuthUser(localId, { validSince: String(Math.floor(Date.now() / 1000)) });
}

// ---------------------------------------------------------------------------
// Strict validation
// ---------------------------------------------------------------------------

/** Strict email check. Keeps domains safe to use inside database paths. */
export function isValidEmail(email: string): boolean {
    return email.length <= 254 && /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(email);
}

// ---------------------------------------------------------------------------
// Atomic counters: sequences and rate limits
// ---------------------------------------------------------------------------

type CommitResult = { writeResults?: Array<{ transformResults?: Array<{ integerValue?: string }> }> };

/** Atomically increments system/counters.{field} and returns the new value. */
export async function nextSequence(field: string): Promise<number> {
    const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', {
        writes: [
            {
                transform: {
                    document: `${DOCUMENT_NAME_ROOT}/system/counters`,
                    fieldTransforms: [{ fieldPath: field, increment: { integerValue: '1' } }],
                },
            },
        ],
    });
    if (!res.ok) await fail(res, 'Sequence increment');
    const data = (await res.json()) as CommitResult;
    const value = Number(data.writeResults?.[0]?.transformResults?.[0]?.integerValue);
    if (!Number.isInteger(value) || value < 1) throw new HttpError(500, 'Could not read the sequence.');
    return value;
}

/** Fixed-window rate limiter. Public account-creation routes fail closed when its storage is unavailable; ordinary operational routes retain their existing behavior. */
export async function rateLimit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<void> {
    const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
    const id = createHash('sha256').update(`${bucket}|${key || 'unknown'}|${windowIndex}`).digest('hex').slice(0, 40);
    const expireAt = new Date((windowIndex + 2) * windowSeconds * 1000).toISOString();
    const strict = bucket === 'setup-register' || bucket === 'application-start' || bucket === 'org-register';
    let count = 0;
    try {
        const res = await googleRequest(`${FIRESTORE_BASE}:commit`, 'POST', {
            writes: [
                {
                    update: {
                        name: `${DOCUMENT_NAME_ROOT}/rate_limits/${id}`,
                        fields: { bucket: { stringValue: bucket }, expireAt: { timestampValue: expireAt } },
                    },
                    updateMask: { fieldPaths: ['bucket', 'expireAt'] },
                    updateTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }],
                },
            ],
        });
        if (!res.ok) {
            console.error('SECURITY_RATE_LIMIT_UNAVAILABLE', bucket, res.status);
            if (strict) throw new HttpError(503, 'Account registration protection is temporarily unavailable. Please retry later.');
            return;
        }
        const data = (await res.json()) as CommitResult;
        count = Number(data.writeResults?.[0]?.transformResults?.[0]?.integerValue ?? 0);
    } catch (err) {
        console.error('SECURITY_RATE_LIMIT_UNAVAILABLE', bucket, err instanceof Error ? err.message : 'unknown');
        if (strict) throw new HttpError(503, 'Account registration protection is temporarily unavailable. Please retry later.');
        return;
    }
    if (count > limit) throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
}

export async function isAuthEmailVerified(localId: string): Promise<boolean> {
    const res = await googleRequest(`${IDENTITY_BASE}/accounts:lookup`, 'POST', { localId: [localId] });
    if (!res.ok) return false;
    const data = (await res.json()) as { users?: Array<{ emailVerified?: boolean }> };
    return data.users?.[0]?.emailVerified === true;
}

// ---------------------------------------------------------------------------
// System settings (system/settings), cached briefly per server instance
// ---------------------------------------------------------------------------

let settingsCache: { requireEmailVerification: boolean; at: number } | null = null;

/** True unless a MEMS super admin has switched email verification off for registrations. */
export async function emailVerificationRequired(): Promise<boolean> {
    if (settingsCache && Date.now() - settingsCache.at < 15000) return settingsCache.requireEmailVerification;
    const doc = await getDoc('system/settings');
    const requireEmailVerification = doc?.data.requireEmailVerification !== false;
    settingsCache = { requireEmailVerification, at: Date.now() };
    return requireEmailVerification;
}

export function clearSettingsCache(): void {
    settingsCache = null;
}
