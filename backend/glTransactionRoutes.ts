/**
 * GL account transactions — routes.
 *
 * MEMS administration (super admin only, reason required, audited):
 *   POST /api/admin/fin/gltxn/list     every MEMS GL master account with its derived handlers, MEMS changes and result
 *   POST /api/admin/fin/gltxn/save     change the MEMS default of one account (adopted by every organization)
 *
 * Organization finance (maker-checker per legal entity):
 *   POST /api/org/fin/gltxn/get        (FIN.view + finance access in the legal entity) the legal entity's accounts with the MEMS default, its approved change and result
 *   POST /api/org/fin/gltxn/propose    propose changes (FIN.gltxn.manage); a different person approves (FIN.gltxn.approve)
 *
 * Organization security (transaction access, ready to configure):
 *   POST /api/org/transactions/access/list   (ADM.roles) every transaction with its state, permission, granting roles and
 *                                             the security roles pre-assigned to reserved transactions
 *   POST /api/org/transactions/access/save   pre-assign security roles to a reserved transaction (ADM.roles, audited)
 *
 * Cost center switch-offs are part of the cost center finance settings (fin/cc/propose, FIN.cc.approve).
 */
import { HttpError, deleteDoc, getDoc, listDocs, nowIso, str, writeDoc, type Fields } from './core';
import { audit } from './audit';
import { hasPerm, orgRoute, staff, type OrgContext, type StaffContext } from './guards';
import { enabledModules, record } from './org';
import { ALL_FIN } from './finRoutes';
import {
    MEMS_GLTXN_DOC,
    P,
    createRequest,
    nameOf,
    needEntity,
    o,
    objs,
    overridesOf,
    overridesToItems,
    permAt,
    reasonOf,
    registerHandler,
    requireFinance,
    scopeOf,
    syncDefaultChart,
    unitsOf,
    type Obj,
} from './finCore';
import { catalogueByCode, leMap, memsHandlers, memsMap } from './glTransactionService';
import { applyOverrides, defaultHandlers, validateOverrides, type AccountOverride, type Handler, type Overrides } from './glTransactionMap';
import { EXTRA_MODULES } from './transactionBlueprints';
import { DEFAULT_MODULES } from './catalog';

const knownCodes = () => new Set(catalogueByCode().keys());
const label = (h: Handler[]) => h.map((x) => `${x.code} ${x.side}`).join(', ');

/**
 * Keeps only real differences from the base: removals of codes the base has, and additions that are new or change the
 * side. An account with no remaining difference is dropped (back to the default).
 */
export function normalise(changes: Overrides, baseOf: (account: string) => Handler[]): Overrides {
    const out: Overrides = {};
    for (const [account, ch] of Object.entries(changes)) {
        const base = baseOf(account);
        const remove = ch.remove.filter((c) => base.some((b) => b.code === c) && !ch.add.some((a) => a.code === c));
        const add = ch.add.filter((a) => !base.some((b) => b.code === a.code && b.side === a.side));
        if (add.length || remove.length) out[account] = { add, remove };
    }
    return out;
}

function describe(changes: Overrides, previous: Overrides): string {
    return Object.entries(changes)
        .map(([acc, v]) => {
            const parts = [v.add.length ? `add ${label(v.add)}` : '', v.remove.length ? `remove ${v.remove.join(', ')}` : ''].filter(Boolean);
            return `${acc}: ${parts.join('; ') || 'back to default'}${previous[acc] ? ' (replaces earlier change)' : ''}`;
        })
        .join(' | ');
}

/** Reads {account, add, remove}[] from a request body. */
function readChanges(raw: unknown): Overrides {
    const map: Record<string, unknown> = {};
    for (const x of objs(raw).slice(0, 2500)) map[str(x.account)] = { add: x.add, remove: x.remove };
    return map as unknown as Overrides;
}

// ----- Legal entity maker-checker -----

registerHandler('gltxn.save', {
    label: 'GL account transactions',
    approvePerm: 'FIN.gltxn.approve',
    apply: async (ctx, req) => {
        const leId = str(req.leId);
        const map = await leMap(ctx.orgId, leId);
        const rows = new Map(map.rows.map((r) => [r.account, r]));
        const requested = validateOverrides(readChanges(o(req.payload).changes), knownCodes(), new Set(rows.keys()));
        const accounts = Object.keys(o(o(req.payload).accounts)).length ? Object.keys(o(o(req.payload).accounts)) : Object.keys(requested);
        const next: Overrides = { ...map.overrides };
        const normalised = normalise(requested, (acc) => rows.get(acc)?.memsDefault ?? []);
        for (const acc of accounts) {
            if (normalised[acc]) next[acc] = normalised[acc];
            else delete next[acc];
        }
        for (const [acc, v] of Object.entries(next)) {
            const r = rows.get(acc);
            if (r && !applyOverrides(r.memsDefault, v).length) throw new HttpError(409, `${acc} would be left with no transaction. Keep at least one, or block the account in the chart of accounts instead.`);
        }
        const path = P(ctx.orgId).gltxn(leId);
        const version = map.version + 1;
        const ok = await writeDoc(path, { leId, items: overridesToItems(next) as unknown as Fields[keyof Fields], version, approvedBy: ctx.uid, approvedAt: nowIso(), proposedBy: str(req.makerUid) } as unknown as Fields, map.updateTime ? { updateTime: map.updateTime } : { exists: false });
        if (!ok) throw new HttpError(409, 'The GL account transactions changed while this was being approved. Refresh and try again.');
        return { version, changedAccounts: accounts.length };
    },
});

async function leEnv(ctx: OrgContext, leId: unknown) {
    const [units, scope] = await Promise.all([unitsOf(ctx.orgId), scopeOf(ctx)]);
    const le = needEntity(units, scope, str(leId));
    await syncDefaultChart(ctx.orgId, le.id, ctx);
    const may = (perm: string) => permAt(ctx, perm, le.id, units, scope);
    return { units, scope, le, may };
}

// ----- Organization transaction access -----

const ACCESS = (orgId: string) => `organizations/${orgId}/transaction_access`;

export const glTransactionRoutes = {
    // ===== MEMS administration =====

    'POST /api/admin/fin/gltxn/list': [
        staff('admin.fin.gltxn.list', 'read', async () => {
            const m = await memsMap();
            const accounts = m.accounts.map((a) => {
                const derived = defaultHandlers(a);
                const change = m.overrides[a.code] ?? null;
                const p = a.properties ?? {};
                return {
                    code: a.code, name: a.name, classCode: a.classCode, categoryCode: a.categoryCode, categoryName: a.categoryName ?? '',
                    accountRole: a.accountRole ?? '', postingMode: a.postingMode ?? '',
                    reconciledTo: p['Reconciled to'] ?? '', costObject: p['Cost object'] ?? '', taxRelevance: p['Tax relevance'] ?? '',
                    derived, change, effective: applyOverrides(derived, change ?? undefined),
                };
            });
            const cat = catalogueByCode();
            const used = new Map<string, number>();
            for (const a of accounts) for (const h of a.effective) used.set(h.code, (used.get(h.code) ?? 0) + 1);
            return {
                masterVersion: m.version,
                accounts,
                codes: [...cat.values()].map((r) => ({ code: r.code, name: r.name, module: r.module, areaName: r.areaName, actionName: r.actionName, state: r.state, accounts: used.get(r.code) ?? 0 })),
                version: m.overrideVersion,
                updatedBy: m.updatedBy,
                updatedAt: m.updatedAt,
                totals: { accounts: accounts.length, changed: Object.keys(m.overrides).length, transactions: used.size, uncovered: accounts.filter((a) => !a.effective.length).length },
            };
        }),
    ],

    'POST /api/admin/fin/gltxn/save': [
        staff('admin.fin.gltxn.save', 'super', async (ctx: StaffContext) => {
            const reason = str(ctx.body.reason).trim();
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for this change (10 to 300 characters).');
            const m = await memsMap();
            if (!m.accounts.length) throw new HttpError(409, 'The MEMS GL account master is not loaded. Upload it first (Finance catalogue).');
            const byCode = new Map(m.accounts.map((a) => [a.code, a]));
            const requested = validateOverrides(readChanges(ctx.body.changes), knownCodes(), new Set(byCode.keys()));
            const accounts = objs(ctx.body.changes).map((x) => str(x.account)).filter((a) => byCode.has(a));
            if (!accounts.length) throw new HttpError(400, 'Choose at least one account.');
            const normalised = normalise(requested, (acc) => defaultHandlers(byCode.get(acc)!));
            const next: Overrides = { ...m.overrides };
            for (const acc of accounts) {
                if (normalised[acc]) next[acc] = normalised[acc];
                else delete next[acc];
                if (!applyOverrides(defaultHandlers(byCode.get(acc)!), next[acc]).length) throw new HttpError(400, `${acc} would be left with no transaction.`);
            }
            const version = m.overrideVersion + 1;
            const ok = await writeDoc(MEMS_GLTXN_DOC, { items: overridesToItems(next) as unknown as Fields[keyof Fields], version, updatedBy: ctx.uid, updatedByEmail: ctx.actor.email, updatedAt: nowIso(), reason } as unknown as Fields, m.updateTime ? { updateTime: m.updateTime } : { exists: false });
            if (!ok) throw new HttpError(409, 'The MEMS GL account transactions changed while you were saving. Refresh and try again.');
            const pick: Overrides = Object.fromEntries(accounts.map((a) => [a, normalised[a] ?? { add: [], remove: [] }]));
            await audit([{ category: 'admin', action: 'fin.gltxn.mems.save', actor: ctx.actor, meta: ctx.meta, target: { type: 'gl_transaction_map', label: `MEMS default v${version}` }, details: `${describe(pick, m.overrides)}. Reason: ${reason}`.slice(0, 1500) }]);
            return { version, changedAccounts: accounts.length };
        }),
    ],

    // ===== Legal entity =====

    'POST /api/org/fin/gltxn/get': [
        orgRoute('org.fin.gltxn.get', 'FIN.view', async (ctx) => {
            await requireFinance(ctx);
            const e = await leEnv(ctx, ctx.body.leId);
            if (!ALL_FIN.some((p) => e.may(p))) throw new HttpError(403, `You have no finance access in ${e.le.code} ${e.le.name}.`);
            const map = await leMap(ctx.orgId, e.le.id);
            const cat = catalogueByCode();
            const pending = (await listDocs(P(ctx.orgId).requests))
                .filter((d) => str(d.data.status) === 'pending' && str(d.data.type) === 'gltxn.save' && str(d.data.leId) === e.le.id)
                .map((d) => ({ id: d.id, title: str(d.data.title), makerName: str(d.data.makerName), createdAt: str(d.data.createdAt) }));
            const used = new Set(map.rows.flatMap((r) => [...r.effective, ...r.memsDefault].map((h) => h.code)));
            return {
                le: { id: e.le.id, code: e.le.code, name: e.le.name },
                masterVersion: map.masterVersion,
                version: map.version,
                approvedAt: map.approvedAt,
                rows: map.rows,
                codes: [...cat.values()].filter((r) => r.module !== 'PLT' && r.module !== 'SYS').map((r) => ({ code: r.code, name: r.name, module: r.module, areaName: r.areaName, actionName: r.actionName, state: r.state, used: used.has(r.code) })),
                pending,
                can: { manage: e.may('FIN.gltxn.manage'), approve: e.may('FIN.gltxn.approve') },
            };
        }),
    ],

    'POST /api/org/fin/gltxn/propose': [
        orgRoute('org.fin.gltxn.propose', 'FIN.gltxn.manage', async (ctx) => {
            await requireFinance(ctx);
            const e = await leEnv(ctx, ctx.body.leId);
            if (!e.may('FIN.gltxn.manage')) throw new HttpError(403, `Changing GL account transactions needs FIN.gltxn.manage for ${e.le.code} ${e.le.name}.`);
            const reason = reasonOf(ctx.body);
            const map = await leMap(ctx.orgId, e.le.id);
            const rows = new Map(map.rows.map((r) => [r.account, r]));
            const requested = validateOverrides(readChanges(ctx.body.changes), knownCodes(), new Set(rows.keys()));
            const accounts = Array.from(new Set(objs(ctx.body.changes).map((x) => str(x.account)).filter((a) => rows.has(a))));
            if (!accounts.length) throw new HttpError(400, 'Choose at least one account of this legal entity.');
            if (accounts.length > 500) throw new HttpError(400, 'Propose at most 500 accounts at a time.');
            const normalised = normalise(requested, (acc) => rows.get(acc)!.memsDefault);
            const changed = accounts.filter((acc) => JSON.stringify(normalised[acc] ?? null) !== JSON.stringify(map.overrides[acc] ?? null));
            if (!changed.length) throw new HttpError(400, 'Nothing has changed.');
            for (const acc of changed) if (!applyOverrides(rows.get(acc)!.memsDefault, normalised[acc]).length) throw new HttpError(400, `${acc} would be left with no transaction. Keep at least one, or block the account in the chart of accounts instead.`);
            const pick: Overrides = Object.fromEntries(changed.map((a) => [a, normalised[a] ?? { add: [], remove: [] }]));
            return createRequest(ctx, {
                leId: e.le.id,
                type: 'gltxn.save',
                title: `${e.le.code}: GL account transactions (${changed.length} account${changed.length === 1 ? '' : 's'})`,
                summary: describe(pick, map.overrides),
                payload: { changes: overridesToItems(pick) as unknown as Obj, accounts: Object.fromEntries(changed.map((a) => [a, true])) as Obj, baseVersion: map.version },
                reason,
                // One open proposal per account (or per legal entity for a multi-account change).
                scopeKey: changed.length === 1 ? `gltxn_${e.le.id}_${changed[0]}` : `gltxn_${e.le.id}`,
            });
        }),
    ],

    // ===== Organization transaction access =====

    'POST /api/org/transactions/access/list': [
        orgRoute('org.transactions.access.list', 'ADM.roles', async (ctx) => {
            const [roles, saved, modules, mems] = await Promise.all([listDocs(`organizations/${ctx.orgId}/roles`), listDocs(ACCESS(ctx.orgId)), enabledModules(ctx.org), memsMap().catch(() => null)]);
            const adopted = new Set([...modules.map((m) => m.code), 'ADM', 'ORG', 'USR', 'WSP', 'SYS']);
            const names = new Map<string, string>([...DEFAULT_MODULES.map((m) => [m.code, m.name] as [string, string]), ...EXTRA_MODULES.map((m) => [m.code, m.name] as [string, string])]);
            const roleList = roles.map((r) => ({ id: r.id, name: str(r.data.name) || r.id, permissions: Array.isArray(r.data.permissions) ? (r.data.permissions as unknown[]).map(str) : [] }));
            const pre = new Map(saved.map((d) => [d.id, d.data]));
            const glCount = new Map<string, number>();
            for (const a of mems?.accounts ?? []) for (const h of memsHandlers(a, mems!.overrides)) glCount.set(h.code, (glCount.get(h.code) ?? 0) + 1);
            const items = [...catalogueByCode().values()]
                .filter((r) => r.module !== 'PLT')
                .map((r) => {
                    const p = pre.get(r.code);
                    const granting = r.permissions.length ? roleList.filter((x) => r.permissions.some((perm) => hasPerm(x.permissions, perm))).map((x) => ({ id: x.id, name: x.name })) : [];
                    const preIds = Array.isArray(p?.roleIds) ? (p!.roleIds as unknown[]).map(str) : [];
                    return {
                        code: r.code, module: r.module, moduleName: names.get(r.module) ?? r.module, area: r.area, areaName: r.areaName, action: r.action, actionName: r.actionName, name: r.name,
                        state: r.state, adopted: adopted.has(r.module), permissions: r.permissions, routes: r.routes.length,
                        granting, preassigned: preIds.map((id) => ({ id, name: roleList.find((x) => x.id === id)?.name ?? `${id} (deleted)` })),
                        preassignedAt: str(p?.updatedAt), preassignedBy: str(p?.updatedByName),
                        glAccounts: glCount.get(r.code) ?? 0, postings: r.postings,
                    };
                });
            return {
                items,
                roles: roleList.map(({ id, name }) => ({ id, name })),
                can: { assign: ctx.role === 'org_super_admin' || hasPerm(ctx.directPermissions, 'ADM.roles') },
                totals: { codes: items.length, live: items.filter((i) => i.state === 'live').length, adopted: items.filter((i) => i.adopted).length, preassigned: items.filter((i) => i.preassigned.length).length },
            };
        }),
    ],

    'POST /api/org/transactions/access/save': [
        orgRoute('org.transactions.access.save', 'ADM.roles', async (ctx) => {
            const code = str(ctx.body.code).trim().toUpperCase();
            const reason = reasonOf(ctx.body);
            const row = catalogueByCode().get(code);
            if (!row || row.module === 'PLT') throw new HttpError(404, 'Transaction not found.');
            if (row.state === 'live') throw new HttpError(409, `${code} is live: access follows ${row.permissions.join(', ') || 'its own rules'}. Change it on Security roles.`);
            const roleIds = Array.from(new Set(Array.isArray(ctx.body.roleIds) ? (ctx.body.roleIds as unknown[]).map(str).filter(Boolean) : [])).slice(0, 30);
            const roles = new Map((await listDocs(`organizations/${ctx.orgId}/roles`)).map((r) => [r.id, str(r.data.name) || r.id]));
            for (const id of roleIds) if (!roles.has(id)) throw new HttpError(400, `Security role ${id} does not exist.`);
            const path = `${ACCESS(ctx.orgId)}/${code}`;
            const cur = await getDoc(path);
            const before = Array.isArray(cur?.data.roleIds) ? (cur!.data.roleIds as unknown[]).map(str) : [];
            if (JSON.stringify([...before].sort()) === JSON.stringify([...roleIds].sort())) throw new HttpError(400, 'Nothing has changed.');
            if (!roleIds.length) await deleteDoc(path);
            else {
                const ok = await writeDoc(path, { code, roleIds, reason, version: (Number(cur?.data.version) || 0) + 1, updatedBy: ctx.uid, updatedByName: nameOf(ctx.me), updatedAt: nowIso() }, cur ? { updateTime: cur.updateTime } : { exists: false });
                if (!ok) throw new HttpError(409, 'Someone changed this transaction at the same time. Refresh and try again.');
            }
            await record(ctx, 'org.transactions.access.preassign', code, `${row.name}: ${before.map((i) => roles.get(i) ?? i).join(', ') || 'none'} → ${roleIds.map((i) => roles.get(i)).join(', ') || 'none'}. Reason: ${reason}`.slice(0, 600));
            return { code, roleIds };
        }),
    ],
};

export type { AccountOverride };
