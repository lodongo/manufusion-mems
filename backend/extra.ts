import { AFRICAN_BANKS, BANK_TYPES, COUNTRY_NAMES, bankId, sortBanks } from './banks';
import { HttpError, authPasswordUpdatedAt, checkPassword, getDoc, int, isObj, nowIso, num, revokeTokens, str, text, updateAuthUser, updateFields, writeDoc, type Doc, type Obj } from './core';
import { audit } from './audit';
import { STAFF_ROLES, secure, staff, type StaffContext } from './guards';

export { AFRICAN_BANKS };

const BANKS_PATH = 'reference/banks';
const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const MAX_BANKS = 3000;

function record(ctx: StaffContext, action: string, target: string, details = '') {
    return audit([{ category: 'admin', action, actor: ctx.actor, meta: ctx.meta, target: { label: target }, details }]);
}

function bankItems(doc: Doc | null): Obj[] {
    const value = doc?.data.items;
    return Array.isArray(value) ? value.filter(isObj) : [];
}

function readBank(raw: unknown): Obj {
    const b = (isObj(raw) ? raw : {}) as Record<string, unknown>;
    const countryCode = str(b.countryCode).trim().toUpperCase();
    const countryName = COUNTRY_NAMES.get(countryCode);
    if (!countryName) throw new HttpError(400, 'Choose an African country.');
    const name = text(b, 'name', 2, 120, 'Enter the bank name (2 to 120 characters).');
    const shortName = text(b, 'shortName', 0, 40, 'Short name can be up to 40 characters.');
    const type = str(b.type) || 'commercial';
    if (!BANK_TYPES.includes(type)) throw new HttpError(400, 'Choose a valid bank type.');
    const swiftCode = str(b.swiftCode).trim().toUpperCase();
    if (swiftCode && !SWIFT_RE.test(swiftCode)) throw new HttpError(400, `SWIFT/BIC "${swiftCode}" must be 8 or 11 characters, e.g. KCBLKENX.`);
    const website = str(b.website).trim();
    if (website && (website.length > 200 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(website))) {
        throw new HttpError(400, 'Website must start with https://');
    }
    return { id: bankId(countryCode, name), countryCode, countryName, name, shortName, type, swiftCode, website, active: b.active !== false, verified: b.verified === true };
}

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else quoted = false;
            } else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
            out.push(cur);
            cur = '';
        } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
}

async function saveBanks(doc: Doc, items: Obj[]): Promise<void> {
    if (items.length > MAX_BANKS) throw new HttpError(400, `The bank list can hold up to ${MAX_BANKS} banks.`);
    const sorted = sortBanks(items);
    const ok = await writeDoc(BANKS_PATH, { ...doc.data, items: sorted, count: sorted.length, updatedAt: nowIso() }, { updateTime: doc.updateTime });
    if (!ok) throw new HttpError(409, 'The bank list was changed by someone else. Refresh and try again.');
}

async function requireBanks(): Promise<Doc> {
    const doc = await getDoc(BANKS_PATH);
    if (!doc) throw new HttpError(400, 'Load the default values first.');
    return doc;
}

export const extraRoutes = {
    // ----- African banks -----
    'POST /api/admin/banks/list': [
        staff('admin.banks.list', 'read', async () => {
            const doc = await getDoc(BANKS_PATH);
            return { loaded: !!doc, items: bankItems(doc), loadedAt: str(doc?.data.loadedAt), updatedAt: str(doc?.data.updatedAt), types: BANK_TYPES };
        }),
    ],

    'POST /api/admin/banks/save': [
        staff('admin.banks.save', 'write', async (ctx) => {
            const doc = await requireBanks();
            const items = bankItems(doc);
            const bank = readBank(ctx.body.bank);
            const originalId = str(ctx.body.id);
            const others = items.filter((i) => str(i.id) !== originalId);
            if (originalId && others.length === items.length) throw new HttpError(404, 'Bank not found.');
            if (others.some((i) => str(i.id) === str(bank.id))) throw new HttpError(409, 'This bank already exists in that country.');
            await saveBanks(doc, [...others, { ...bank, updatedAt: nowIso(), updatedBy: ctx.actor.email }]);
            await record(ctx, originalId ? 'bank.update' : 'bank.create', `${str(bank.name)} (${str(bank.countryCode)})`);
            return { id: bank.id };
        }),
    ],

    'POST /api/admin/banks/delete': [
        staff('admin.banks.delete', 'write', async (ctx) => {
            const doc = await requireBanks();
            const id = str(ctx.body.id);
            const items = bankItems(doc);
            const target = items.find((i) => str(i.id) === id);
            if (!target) throw new HttpError(404, 'Bank not found.');
            await saveBanks(doc, items.filter((i) => str(i.id) !== id));
            await record(ctx, 'bank.delete', `${str(target.name)} (${str(target.countryCode)})`);
            return { ok: true };
        }),
    ],

    'POST /api/admin/banks/import': [
        staff('admin.banks.import', 'write', async (ctx) => {
            const doc = await requireBanks();
            const csv = str(ctx.body.csv);
            if (!csv.trim()) throw new HttpError(400, 'Paste CSV rows to import.');
            if (csv.length > 500_000) throw new HttpError(400, 'The CSV is too large. Import in smaller batches.');
            const mode = str(ctx.body.mode) === 'replace' ? 'replace' : 'append';
            const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (lines.length && /^country/i.test(lines[0])) lines.shift();
            if (lines.length > MAX_BANKS) throw new HttpError(400, `Import up to ${MAX_BANKS} rows at a time.`);
            const imported: Obj[] = [];
            const errors: string[] = [];
            lines.forEach((line, index) => {
                const [countryCode = '', name = '', shortName = '', type = '', swiftCode = '', website = ''] = parseCsvLine(line);
                try {
                    imported.push({ ...readBank({ countryCode, name, shortName, type: type.toLowerCase() || 'commercial', swiftCode, website }), updatedAt: nowIso(), updatedBy: ctx.actor.email });
                } catch (err) {
                    errors.push(`Row ${index + 1}: ${err instanceof Error ? err.message : 'invalid'}`);
                }
            });
            if (errors.length) throw new HttpError(400, `Nothing was imported. Fix these rows first: ${errors.slice(0, 8).join(' | ')}${errors.length > 8 ? ` (and ${errors.length - 8} more)` : ''}`);
            const merged = new Map<string, Obj>();
            if (mode === 'append') for (const i of bankItems(doc)) merged.set(str(i.id), i);
            for (const i of imported) merged.set(str(i.id), i);
            await saveBanks(doc, Array.from(merged.values()));
            await record(ctx, 'bank.import', `${imported.length} banks`, `Mode: ${mode}`);
            return { imported: imported.length, total: merged.size };
        }),
    ],

    // ----- Passwords -----
    'POST /api/admin/users/reset-password': [
        staff('admin.users.reset_password', 'super', async (ctx) => {
            const uid = str(ctx.body.uid);
            if (uid === ctx.uid) throw new HttpError(400, 'Use Personal details to change your own password.');
            const target = /^[A-Za-z0-9]{6,128}$/.test(uid) ? await getDoc(`users/${uid}`) : null;
            if (!target || !STAFF_ROLES.includes(str(target.data.role))) throw new HttpError(404, 'User not found.');
            const password = str(ctx.body.password);
            checkPassword(password);
            await updateAuthUser(uid, { password });
            await revokeTokens(uid);
            await updateFields(`users/${uid}`, { mustChangePassword: true, tokensValidAfter: nowIso(), passwordChangeRequiredAt: nowIso() });
            await record(ctx, 'staff.reset_password', str(target.data.email));
            return { ok: true };
        }),
    ],

    'POST /api/profile/password-changed': [
        secure('profile.password_changed', async (ctx) => {
            const me = await getDoc(`users/${ctx.uid}`);
            if (!me) throw new HttpError(404, 'Profile not found.');
            if (me.data.mustChangePassword === true) {
                const requiredAt = Date.parse(str(me.data.passwordChangeRequiredAt) || str(me.data.tokensValidAfter) || str(me.data.createdAt));
                const changedAt = await authPasswordUpdatedAt(ctx.uid);
                if (!changedAt || !Number.isFinite(requiredAt) || changedAt <= requiredAt) {
                    throw new HttpError(409, 'Firebase has not verified a new password yet. Sign in again after changing it.');
                }
            }
            await updateFields(`users/${ctx.uid}`, { mustChangePassword: false, passwordChangedAt: nowIso(), passwordChangeRequiredAt: '' });
            await audit([
                {
                    category: 'auth',
                    action: 'auth.password_changed',
                    actor: ctx.actor,
                    meta: ctx.meta,
                    orgId: str(me.data.orgId),
                    target: { type: 'account', label: ctx.actor.email },
                },
            ]);
            return { ok: true };
        }),
    ],

    // ----- Database sequences -----
    'POST /api/admin/sequences': [
        staff('admin.sequences', 'read', async () => {
            const doc = await getDoc('system/counters');
            const current = num(doc?.data.orgSeq) ?? 0;
            return { orgSeq: current, nextOrgCode: `ORG_${String(current + 1).padStart(7, '0')}` };
        }),
    ],

    'POST /api/admin/sequences/set': [
        staff('admin.sequences.set', 'super', async (ctx) => {
            const next = int(ctx.body.next, 1, 9_999_999, 'Enter a number between 1 and 9999999.');
            const doc = await getDoc('system/counters');
            const current = num(doc?.data.orgSeq) ?? 0;
            if (next <= current) throw new HttpError(400, `The next number must be greater than ${current} so codes are never reused.`);
            await updateFields('system/counters', { orgSeq: next - 1 });
            await audit([{ category: 'admin', action: 'sequence.set', actor: ctx.actor, meta: ctx.meta, target: { label: 'Organization codes' }, details: `Next code ORG_${String(next).padStart(7, '0')}` }]);
            return { orgSeq: next - 1, nextOrgCode: `ORG_${String(next).padStart(7, '0')}` };
        }),
    ],
};
