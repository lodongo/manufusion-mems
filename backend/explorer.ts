import { FIRESTORE_BASE, HttpError, IDENTITY_BASE, emailDomain, fail, googleRequest, isObj, listDocs, nowIso, STAFF_DOMAIN, str, toDoc, writeDoc, type Plain } from './core';
import { audit } from './audit';
import { STAFF_ROLES, staff, type StaffContext } from './guards';

// Read-only Firestore explorer (MEMS super admin only) and repair of staff
// login accounts that have no MEMS profile.

const SEGMENT = /^[^/\s]{1,300}$/;

function parsePath(raw: unknown, kind: 'collection' | 'document' | 'rootOrDocument'): string {
    const path = str(raw).trim().replace(/^\/+|\/+$/g, '');
    if (!path) {
        if (kind === 'rootOrDocument') return '';
        throw new HttpError(400, 'Choose a collection or document.');
    }
    const parts = path.split('/');
    if (parts.length > 20 || parts.some((p) => !SEGMENT.test(p) || p === '.' || p === '..' || /^__.*__$/.test(p))) {
        throw new HttpError(400, 'Invalid database path.');
    }
    if (kind === 'collection' && parts.length % 2 !== 1) throw new HttpError(400, 'That path is not a collection.');
    if (kind !== 'collection' && parts.length % 2 !== 0) throw new HttpError(400, 'That path is not a document.');
    return parts.map(encodeURIComponent).join('/');
}

function shrink(value: Plain, depth = 0): Plain {
    if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}… (${value.length} characters)` : value;
    if (Array.isArray(value)) {
        const items = value.slice(0, 50).map((v) => shrink(v, depth + 1));
        if (value.length > 50) items.push(`… ${value.length - 50} more items`);
        return items;
    }
    if (isObj(value)) {
        if (depth > 6) return '{…}';
        const out: { [key: string]: Plain } = {};
        for (const key of Object.keys(value).sort()) out[key] = shrink(value[key], depth + 1);
        return out;
    }
    return value;
}

async function collectionIds(docPath: string): Promise<string[]> {
    const url = docPath ? `${FIRESTORE_BASE}/${docPath}:listCollectionIds` : `${FIRESTORE_BASE}:listCollectionIds`;
    const ids: string[] = [];
    let pageToken = '';
    for (let page = 0; page < 5; page++) {
        const res = await googleRequest(url, 'POST', { pageSize: 300, ...(pageToken ? { pageToken } : {}) });
        if (!res.ok) await fail(res, 'Firestore list collections');
        const body = (await res.json()) as { collectionIds?: string[]; nextPageToken?: string };
        ids.push(...(body.collectionIds ?? []));
        if (!body.nextPageToken) break;
        pageToken = body.nextPageToken;
    }
    return ids.sort((a, b) => a.localeCompare(b));
}

const LABEL_FIELDS = ['name', 'email', 'title', 'label', 'action', 'code', 'status'];

function record(ctx: StaffContext, action: string, target: string, details = '') {
    return audit([{ category: 'admin', action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details }]);
}

interface AuthAccount {
    localId?: string;
    email?: string;
    displayName?: string;
    phoneNumber?: string;
    disabled?: boolean;
    createdAt?: string;
    lastLoginAt?: string;
}

async function allAuthAccounts(): Promise<AuthAccount[]> {
    const out: AuthAccount[] = [];
    let nextPageToken = '';
    for (let page = 0; page < 20; page++) {
        const qs = `maxResults=500${nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : ''}`;
        const res = await googleRequest(`${IDENTITY_BASE}/accounts:batchGet?${qs}`, 'GET');
        if (!res.ok) await fail(res, 'Firebase Auth list');
        const body = (await res.json()) as { users?: AuthAccount[]; nextPageToken?: string };
        out.push(...(body.users ?? []));
        if (!body.nextPageToken || !(body.users ?? []).length) break;
        nextPageToken = body.nextPageToken;
    }
    return out;
}

export const explorerRoutes = {
    'POST /api/admin/explorer/collections': [
        staff('admin.explorer.collections', 'super', async (ctx) => {
            const path = parsePath(ctx.body.path, 'rootOrDocument');
            return { collections: await collectionIds(path) };
        }),
    ],

    'POST /api/admin/explorer/documents': [
        staff('admin.explorer.documents', 'super', async (ctx) => {
            const path = parsePath(ctx.body.path, 'collection');
            const pageToken = str(ctx.body.pageToken);
            if (pageToken && (pageToken.length > 2000 || !/^[A-Za-z0-9_\-=+/.]+$/.test(pageToken))) throw new HttpError(400, 'Invalid page.');
            const qs = `pageSize=50&showMissing=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
            const res = await googleRequest(`${FIRESTORE_BASE}/${path}?${qs}`, 'GET');
            if (!res.ok) await fail(res, 'Firestore list documents');
            const body = (await res.json()) as { documents?: Array<Record<string, any>>; nextPageToken?: string };
            const documents = (body.documents ?? []).map((raw) => {
                const doc = toDoc(raw);
                const labelKey = LABEL_FIELDS.find((k) => typeof doc.data[k] === 'string' && doc.data[k]);
                return {
                    id: doc.id,
                    exists: !!raw.createTime,
                    fieldCount: Object.keys(doc.data).length,
                    label: labelKey ? str(doc.data[labelKey]).slice(0, 80) : '',
                    updateTime: str(raw.updateTime),
                };
            });
            return { documents, nextPageToken: body.nextPageToken ?? '' };
        }),
    ],

    'POST /api/admin/explorer/document': [
        staff('admin.explorer.document', 'super', async (ctx) => {
            const path = parsePath(ctx.body.path, 'document');
            const res = await googleRequest(`${FIRESTORE_BASE}/${path}`, 'GET');
            let exists = false;
            let fields: Plain = {};
            let createTime = '';
            let updateTime = '';
            if (res.status !== 404) {
                if (!res.ok) await fail(res, 'Firestore read');
                const raw = (await res.json()) as Record<string, any>;
                const doc = toDoc(raw);
                exists = true;
                fields = shrink(doc.data);
                createTime = str(raw.createTime);
                updateTime = str(raw.updateTime);
            }
            const subcollections = await collectionIds(path);
            await record(ctx, 'explorer.view', decodeURIComponent(path));
            return { exists, fields, createTime, updateTime, subcollections };
        }),
    ],

    // Staff login accounts (@manufusion.com) that exist in Firebase Authentication but have no MEMS profile.
    'POST /api/admin/users/orphans': [
        staff('admin.users.orphans', 'super', async () => {
            const [accounts, users] = await Promise.all([allAuthAccounts(), listDocs('users')]);
            const profiles = new Set(users.map((u) => u.id));
            const orphans = accounts
                .filter((a) => a.localId && !profiles.has(a.localId) && emailDomain(str(a.email)) === STAFF_DOMAIN)
                .map((a) => ({
                    uid: str(a.localId),
                    email: str(a.email),
                    displayName: str(a.displayName),
                    phone: str(a.phoneNumber),
                    disabled: a.disabled === true,
                    createdAt: a.createdAt ? new Date(Number(a.createdAt)).toISOString() : '',
                }));
            return { orphans };
        }),
    ],

    'POST /api/admin/users/repair': [
        staff('admin.users.repair', 'super', async (ctx) => {
            const uid = str(ctx.body.uid);
            const role = str(ctx.body.role);
            if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) throw new HttpError(400, 'Invalid account.');
            if (!STAFF_ROLES.includes(role)) throw new HttpError(400, 'Choose a role from the list.');
            const res = await googleRequest(`${IDENTITY_BASE}/accounts:lookup`, 'POST', { localId: [uid] });
            if (!res.ok) await fail(res, 'Firebase Auth lookup');
            const account = ((await res.json()) as { users?: AuthAccount[] }).users?.[0];
            if (!account) throw new HttpError(404, 'Login account not found.');
            const email = str(account.email).toLowerCase();
            if (emailDomain(email) !== STAFF_DOMAIN) throw new HttpError(400, `Only @${STAFF_DOMAIN} accounts can be MEMS users.`);
            const [firstName = '', ...rest] = str(account.displayName).trim().split(/\s+/);
            const created = await writeDoc(
                `users/${uid}`,
                {
                    uid,
                    email,
                    firstName: firstName || email.split('@')[0],
                    lastName: rest.join(' '),
                    phone: str(account.phoneNumber),
                    role,
                    status: account.disabled === true ? 'disabled' : 'active',
                    createdAt: nowIso(),
                    createdBy: ctx.uid,
                    repairedAt: nowIso(),
                    lastLoginAt: '',
                },
                { exists: false }
            );
            if (!created) throw new HttpError(409, 'This account already has a MEMS profile.');
            await record(ctx, 'staff.repair', email, `Profile created with role ${role}`);
            return { ok: true };
        }),
    ],
};
