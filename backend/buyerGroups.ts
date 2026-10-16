import { HttpError, getDoc, isObj, listDocs, nowIso, str, writeDoc, type Doc } from './core';
import { orgRoute, type OrgContext } from './guards';
import { orgUsers, record } from './org';
import { nextOrgCounter } from './positions';
import { KIND_LABEL, LINE_KINDS, adopted, can, isSuper, requireProcurement, type LineKind } from './procurementSetup';

// ---------------------------------------------------------------------------
// Buyer groups (BGR + 4 digits). A buyer group owns procurement subcategories and has members. Requirements, quotations
// (and later requisitions and purchase orders) of those subcategories are handled by the members of the group.
//
//   organizations/{org}/procurement_setup/buyer_groups     the switch: buyer groups on or off (off by default)
//   organizations/{org}/buyer_groups/{BGR0001}             one group: name, subcategories, members
//
// A subcategory can belong to one active group only, so a subcategory taken by one group is not offered to another.
// With the switch off, anyone who holds the procurement permission handles every requirement. With it on, a person
// handles only what is in the groups they belong to; holders of PRC.buyers.manage see everything so they can fix gaps.
// Everything is versioned where it matters, needs a reason, and is audited.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const ID = /^BGR\d{4}$/;
const MAX_GROUPS = 40;
const MAX_MEMBERS = 30;
const MAX_SCOPES = 400;

const settingPath = (orgId: string) => `organizations/${orgId}/procurement_setup/buyer_groups`;
const groupsPath = (orgId: string) => `organizations/${orgId}/buyer_groups`;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const nameOfUser = (u: Doc | null | undefined) => (u ? [str(u.data.firstName), str(u.data.lastName)].filter(Boolean).join(' ') || str(u.data.email) : '');
const oneLine = (v: unknown, max: number) => str(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const scopeKey = (kind: string, categoryCode: string, subcategoryCode: string) => `${kind}|${categoryCode}|${subcategoryCode}`;
/** The key of the subcategory a requirement item belongs to. */
export const lineKeyOf = (l: Obj) => scopeKey(str(l.type), str(l.categoryCode), str(l.subcategoryCode));

export interface DeskScope {
    /** Buyer groups are switched on. */
    enabled: boolean;
    /** The person handles everything (groups off, or an administrator). */
    all: boolean;
    keys: Set<string>;
    groupIds: string[];
}

async function enabledOf(orgId: string): Promise<{ enabled: boolean; version: number; updatedAt: string }> {
    const doc = await getDoc(settingPath(orgId));
    return { enabled: doc?.data.enabled === true, version: Number(doc?.data.version) || 0, updatedAt: str(doc?.data.updatedAt) };
}

/** What this person may handle as a buyer. */
export async function deskScope(ctx: OrgContext): Promise<DeskScope> {
    const setting = await enabledOf(ctx.orgId);
    if (!setting.enabled || isSuper(ctx) || can(ctx, 'PRC.buyers.manage')) return { enabled: setting.enabled, all: true, keys: new Set(), groupIds: [] };
    const mine = (await listDocs(groupsPath(ctx.orgId))).filter((g) => g.data.active !== false && objs(g.data.members).some((m) => str(m.uid) === ctx.uid));
    const keys = new Set<string>();
    for (const g of mine) for (const s of objs(g.data.scopes)) keys.add(scopeKey(str(s.kind), str(s.categoryCode), str(s.subcategoryCode)));
    return { enabled: true, all: false, keys, groupIds: mine.map((g) => g.id) };
}

/** Does any of these items fall in the person's groups? */
export const covers = (s: DeskScope, lines: Obj[]) => s.all || lines.some((l) => s.keys.has(lineKeyOf(l)));
/** The items of a list that the person may handle. */
export const inScope = (s: DeskScope, lines: Obj[]) => (s.all ? lines : lines.filter((l) => s.keys.has(lineKeyOf(l))));

/** Which active group owns each subcategory. */
export async function ownersOf(orgId: string): Promise<Map<string, { id: string; number: string; name: string }>> {
    const out = new Map<string, { id: string; number: string; name: string }>();
    for (const g of await listDocs(groupsPath(orgId))) {
        if (g.data.active === false) continue;
        for (const s of objs(g.data.scopes)) out.set(scopeKey(str(s.kind), str(s.categoryCode), str(s.subcategoryCode)), { id: g.id, number: str(g.data.number) || g.id, name: str(g.data.name) });
    }
    return out;
}

const reasonOf = (b: Obj) => {
    const r = str(b.reason).trim();
    if (r.length < 10 || r.length > 300) throw new HttpError(400, 'Give a reason of 10 to 300 characters.');
    return r;
};

function requireView(ctx: OrgContext) {
    requireProcurement(ctx);
    if (!(can(ctx, 'PRC.buyers.manage') || can(ctx, 'PRC.setup.view') || can(ctx, 'PRC.setup.manage') || can(ctx, 'PRC.req.acknowledge') || can(ctx, 'PRC.quotes.view') || can(ctx, 'PRC.quotes.manage')))
        throw new HttpError(403, 'You do not have permission to view buyer groups.');
}

async function catalogue(orgId: string) {
    return Promise.all(LINE_KINDS.map(async (k) => ({ kind: k, label: KIND_LABEL[k], categories: (await adopted(orgId, k)).categories })));
}
type Catalogue = Awaited<ReturnType<typeof catalogue>>;

function namesOf(cat: Catalogue, kind: string, categoryCode: string, subcategoryCode: string) {
    const c = cat.find((k) => k.kind === kind)?.categories.find((x) => x.code === categoryCode);
    return { categoryName: c?.name ?? categoryCode, subcategoryName: c?.subcategories.find((s) => s.code === subcategoryCode)?.name ?? subcategoryCode };
}

export const buyerGroupRoutes = {
    // Groups, their share of the adopted subcategories, what is not yet assigned, and the people who can be added.
    'POST /api/org/procurement/buyers/overview': [
        orgRoute('org.procurement.buyers.overview', null, async (ctx) => {
            requireView(ctx);
            const [setting, groups, cat] = await Promise.all([enabledOf(ctx.orgId), listDocs(groupsPath(ctx.orgId)), catalogue(ctx.orgId)]);
            const manage = can(ctx, 'PRC.buyers.manage');
            const total = cat.reduce((n, k) => n + k.categories.reduce((m, c) => m + c.subcategories.length, 0), 0);
            const active = groups.filter((g) => g.data.active !== false);
            const owners = await ownersOf(ctx.orgId);
            const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
            const perKind = cat.map((k) => {
                const all = k.categories.flatMap((c) => c.subcategories.map((s) => ({ categoryCode: c.code, categoryName: c.name, subcategoryCode: s.code, subcategoryName: s.name })));
                const free = all.filter((s) => !owners.has(scopeKey(k.kind, s.categoryCode, s.subcategoryCode)));
                return { kind: k.kind, label: k.label, total: all.length, assigned: all.length - free.length, pct: pct(all.length - free.length, all.length), unassigned: free.slice(0, 200) };
            });
            const assigned = perKind.reduce((n, k) => n + k.assigned, 0);
            const rows = groups
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((g) => {
                    const scopes = objs(g.data.scopes);
                    return {
                        id: g.id,
                        number: str(g.data.number) || g.id,
                        name: str(g.data.name),
                        description: str(g.data.description),
                        active: g.data.active !== false,
                        version: Number(g.data.version) || 1,
                        members: objs(g.data.members).map((m) => ({ uid: str(m.uid), name: str(m.name), lead: m.lead === true })),
                        scopeCount: scopes.length,
                        share: pct(scopes.length, total),
                        byKind: LINE_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], count: scopes.filter((s) => str(s.kind) === k).length })),
                        scopes: scopes.map((s) => ({ kind: str(s.kind), categoryCode: str(s.categoryCode), subcategoryCode: str(s.subcategoryCode), ...namesOf(cat, str(s.kind), str(s.categoryCode), str(s.subcategoryCode)) })),
                        updatedAt: str(g.data.updatedAt),
                    };
                });
            const users = manage ? (await orgUsers(ctx.orgId)).filter((u) => str(u.data.status) !== 'disabled').map((u) => ({ uid: u.id, name: nameOfUser(u), email: str(u.data.email) })) : [];
            return {
                enabled: setting.enabled,
                version: setting.version,
                updatedAt: setting.updatedAt,
                canManage: manage,
                groups: rows,
                activeGroups: active.length,
                coverage: { total, assigned, pct: pct(assigned, total), perKind },
                users: users.sort((a, b) => a.name.localeCompare(b.name)),
                mine: rows.filter((g) => g.active && g.members.some((m) => m.uid === ctx.uid)).map((g) => g.id),
            };
        }),
    ],

    // Subcategories a group may still take: those free, plus those the group already holds. Another group's subcategories are not shown.
    'POST /api/org/procurement/buyers/available': [
        orgRoute('org.procurement.buyers.available', 'PRC.buyers.manage', async (ctx) => {
            requireProcurement(ctx);
            const id = str(ctx.body.id);
            const [cat, owners] = await Promise.all([catalogue(ctx.orgId), ownersOf(ctx.orgId)]);
            return {
                kinds: cat.map((k) => ({
                    kind: k.kind,
                    label: k.label,
                    categories: k.categories
                        .map((c) => ({ code: c.code, name: c.name, subcategories: c.subcategories.filter((s) => { const o = owners.get(scopeKey(k.kind, c.code, s.code)); return !o || o.id === id; }) }))
                        .filter((c) => c.subcategories.length),
                })),
            };
        }),
    ],

    'POST /api/org/procurement/buyers/save': [
        orgRoute('org.procurement.buyers.save', 'PRC.buyers.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            const name = oneLine(ctx.body.name, 60);
            if (name.length < 3) throw new HttpError(400, 'Give the buyer group a name of at least 3 characters.');
            const description = oneLine(ctx.body.description, 300);
            const [cat, groups, users] = await Promise.all([catalogue(ctx.orgId), listDocs(groupsPath(ctx.orgId)), orgUsers(ctx.orgId)]);
            const id = str(ctx.body.id);
            const existing = id ? groups.find((g) => g.id === id) : undefined;
            if (id && (!ID.test(id) || !existing)) throw new HttpError(404, 'Buyer group not found.');
            if (existing && Number(ctx.body.expectedVersion) !== (Number(existing.data.version) || 1)) throw new HttpError(409, 'Someone else changed this buyer group. Reload and apply your changes again.');
            if (groups.some((g) => g.id !== id && g.data.active !== false && str(g.data.name).toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'Another active buyer group already has that name.');

            // Subcategories: adopted, no repeats, and none held by another active group.
            const owners = await ownersOf(ctx.orgId);
            const seen = new Set<string>();
            const scopes = objs(ctx.body.scopes).map((s) => {
                const kind = str(s.kind) as LineKind;
                const key = scopeKey(kind, str(s.categoryCode), str(s.subcategoryCode));
                const ok = LINE_KINDS.includes(kind) && cat.find((k) => k.kind === kind)?.categories.find((c) => c.code === str(s.categoryCode))?.subcategories.some((x) => x.code === str(s.subcategoryCode));
                if (!ok) throw new HttpError(400, 'A chosen subcategory is not adopted by your organization.');
                if (seen.has(key)) throw new HttpError(400, 'A subcategory is listed twice.');
                seen.add(key);
                const owner = owners.get(key);
                if (owner && owner.id !== id) throw new HttpError(409, `${namesOf(cat, kind, str(s.categoryCode), str(s.subcategoryCode)).subcategoryName} already belongs to ${owner.name}. A subcategory can belong to one buyer group only.`);
                return { kind, categoryCode: str(s.categoryCode), subcategoryCode: str(s.subcategoryCode) };
            });
            if (scopes.length > MAX_SCOPES) throw new HttpError(400, `A buyer group can hold up to ${MAX_SCOPES} subcategories.`);

            // Members: active people of this organization, no repeats, one optional lead.
            const byUid = new Map(users.map((u): [string, Doc] => [u.id, u]));
            const given = Array.isArray(ctx.body.members) ? (ctx.body.members as unknown[]).filter(isObj) : [];
            if (given.length > MAX_MEMBERS) throw new HttpError(400, `A buyer group can have up to ${MAX_MEMBERS} members.`);
            const uids = new Set<string>();
            const members = given.map((m) => {
                const u = byUid.get(str(m.uid));
                if (!u || str(u.data.status) === 'disabled') throw new HttpError(400, 'A chosen member is not an active person of your organization.');
                if (uids.has(u.id)) throw new HttpError(400, 'A member is listed twice.');
                uids.add(u.id);
                return { uid: u.id, name: nameOfUser(u), lead: m.lead === true };
            });
            if (members.filter((m) => m.lead).length > 1) throw new HttpError(400, 'Choose one lead at most.');

            let number = str(existing?.data.number);
            let key = id;
            if (!existing) {
                if (groups.length >= MAX_GROUPS) throw new HttpError(409, `Up to ${MAX_GROUPS} buyer groups can be created.`);
                const n = await nextOrgCounter(ctx.orgId, 'buyerGroupSeq');
                if (n > 9999) throw new HttpError(500, 'The buyer group number range is exhausted.');
                number = `BGR${String(n).padStart(4, '0')}`;
                key = number;
            }
            const at = nowIso();
            const version = (Number(existing?.data.version) || 0) + 1;
            const data = { ...(existing?.data ?? {}), number, name, description, active: existing ? existing.data.active !== false : true, scopes, members, version, updatedAt: at, updatedBy: ctx.uid, ...(existing ? {} : { createdAt: at, createdBy: ctx.uid }) };
            if (existing) await writeDoc(`${groupsPath(ctx.orgId)}/${key}`, data);
            else if (!(await writeDoc(`${groupsPath(ctx.orgId)}/${key}`, data, { exists: false }))) throw new HttpError(409, 'That buyer group number is already in use. Please try again.');
            await record(ctx, existing ? 'org.procurement.buyers.update' : 'org.procurement.buyers.create', number, `${name}: ${scopes.length} subcategories, ${members.length} member(s). Reason: ${reason}`.slice(0, 400));
            return { ok: true, id: key, number };
        }),
    ],

    // Switches a group off: its subcategories become unassigned. Nothing is deleted. Switching it on again needs the subcategories to still be free.
    'POST /api/org/procurement/buyers/active': [
        orgRoute('org.procurement.buyers.active', 'PRC.buyers.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            const id = str(ctx.body.id);
            const g = ID.test(id) ? await getDoc(`${groupsPath(ctx.orgId)}/${id}`) : null;
            if (!g) throw new HttpError(404, 'Buyer group not found.');
            const on = ctx.body.active === true;
            if (on === (g.data.active !== false)) throw new HttpError(400, 'Nothing has changed.');
            if (on) {
                const owners = await ownersOf(ctx.orgId);
                for (const s of objs(g.data.scopes)) {
                    const o = owners.get(scopeKey(str(s.kind), str(s.categoryCode), str(s.subcategoryCode)));
                    if (o && o.id !== id) throw new HttpError(409, `A subcategory of this group now belongs to ${o.name}. Remove it from that group first.`);
                }
            }
            await writeDoc(`${groupsPath(ctx.orgId)}/${id}`, { ...g.data, active: on, version: (Number(g.data.version) || 1) + 1, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.procurement.buyers.active', str(g.data.number) || id, `${on ? 'Switched on' : 'Switched off'}. Reason: ${reason}`);
            return { ok: true };
        }),
    ],

    // The master switch. Off: anyone with the procurement permission handles every requirement.
    'POST /api/org/procurement/buyers/toggle': [
        orgRoute('org.procurement.buyers.toggle', 'PRC.buyers.manage', async (ctx) => {
            requireProcurement(ctx);
            const reason = reasonOf(ctx.body);
            if (typeof ctx.body.enabled !== 'boolean') throw new HttpError(400, 'Choose on or off.');
            const current = await enabledOf(ctx.orgId);
            if (Number(ctx.body.expectedVersion) !== current.version) throw new HttpError(409, 'Someone else changed this setting. Reload and try again.');
            if (ctx.body.enabled === current.enabled) throw new HttpError(400, 'Nothing has changed.');
            if (ctx.body.enabled) {
                const groups = (await listDocs(groupsPath(ctx.orgId))).filter((g) => g.data.active !== false && objs(g.data.members).length > 0 && objs(g.data.scopes).length > 0);
                if (!groups.length) throw new HttpError(409, 'Create at least one buyer group with members and subcategories before switching buyer groups on.');
            }
            const version = current.version + 1;
            await writeDoc(`${settingPath(ctx.orgId)}/versions/${version}`, { enabled: ctx.body.enabled, reason, at: nowIso(), by: ctx.uid }, { exists: false });
            await writeDoc(settingPath(ctx.orgId), { enabled: ctx.body.enabled, version, updatedAt: nowIso(), updatedBy: ctx.uid });
            await record(ctx, 'org.procurement.buyers.toggle', 'Buyer groups', `${ctx.body.enabled ? 'Switched on' : 'Switched off: anyone with procurement authority handles every requirement'}. Reason: ${reason}`);
            return { ok: true, version };
        }),
    ],
};
