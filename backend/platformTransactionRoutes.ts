/**
 * MEMS platform Transactions Manager.
 *  - list:   every transaction code with its state (live, reserved, live but not yet linked, added, retired)
 *  - add:    MEMS staff with write access reserve a new placeholder code (never executable; audited)
 *  - retire: withdraw a code MEMS staff added (the code is kept so it is never reused; audited)
 * Route bindings are compiled from the actual server router on every boot. Listing or reserving a code NEVER assigns
 * access to an employee or changes a route's authentication, ownership, role, site or business workflow checks.
 */
import { HttpError, getDoc, listDocs, nowIso, str, writeDoc } from './core';
import { audit } from './audit';
import { staff, type StaffContext } from './guards';
import { allSystemTransactions } from './transactionRuntime';
import { ACTION_NAMES, EXTRA_MODULES, areaDefinitions, plannedTransactionBlueprints } from './transactionBlueprints';
import { POSTING_EVENTS, postingRoles, suggestRoleAccounts, type ChartAccount } from './finPostingCatalogue';
import { glMaster } from './procurement';
import { postableOf, statementOf } from './finCore';
import { transactionCatalogue, type CustomCode } from './transactionCatalogue';
import {auditFinanceTransactions} from './financeTransactionAudit';
import {DEFAULT_MODULE_METADATA} from './moduleDefaults';
import { DEFAULT_MODULES } from './catalog';

const CODES = 'transaction_codes';
const MODULE_RE = /^[A-Z]{2,4}$/;
const AREA_RE = /^[A-Z0-9]{3,4}$/;
const ACTION_RE = /^[A-Z0-9]{2,4}$/;

function record(ctx: StaffContext, action: string, target: string, details: string) {
    return audit([{ category: 'admin', action, actor: ctx.actor, meta: ctx.meta, target: { type: 'transaction_code', label: target }, details }]);
}

async function customCodes(): Promise<CustomCode[]> {
    return (await listDocs(CODES)).map((d) => ({
        code: d.id,
        module: str(d.data.module),
        area: str(d.data.area),
        areaName: str(d.data.areaName),
        action: str(d.data.action),
        actionName: str(d.data.actionName),
        name: str(d.data.name),
        status: str(d.data.status) === 'retired' ? 'retired' : 'reserved',
        addedBy: str(d.data.addedByEmail) || str(d.data.addedBy),
        addedAt: str(d.data.addedAt),
        reason: str(d.data.reason),
    }));
}

function moduleNames(): Map<string, string> {
    const names = new Map(DEFAULT_MODULES.map((m) => [m.code, m.name]));
    for (const m of EXTRA_MODULES) names.set(m.code, m.name);
    return names;
}

/** Default GL account per accounting role, drawn from the MEMS GL master (tenants adopt and approve their own mapping). */
async function glDefaults() {
    let master: Awaited<ReturnType<typeof glMaster>> = null;
    try { master = await glMaster(); } catch { master = null; }
    const accounts: ChartAccount[] = (master?.accounts ?? []).map((a) => ({
        code: str(a.code), name: str(a.name), statement: statementOf(a), accountRole: str(a.accountRole),
        accountType: str(a.accountType), postable: postableOf(a),
    })).filter((a) => a.code);
    const roles = postingRoles();
    const suggested = suggestRoleAccounts(accounts, roles);
    return {
        masterVersion: master ? str(master.version) : '',
        masterAccounts: accounts.length,
        roles: roles.map((r) => ({ ...r, default: suggested[r.code] ?? null })),
        events: POSTING_EVENTS.map(({ via, ...e }) => ({ ...e, routes: via ?? [] })),
    };
}

export const platformTransactionRoutes = {
    'POST /api/admin/transactions/list': [
        staff('admin.transactions.list', 'read', async () => {
            const rows = transactionCatalogue(await customCodes());
            const byState: Record<string, number> = {};
            for (const r of rows) byState[r.state] = (byState[r.state] ?? 0) + 1;
            const names = moduleNames();
            const modules = [...new Set(rows.map((r) => r.module))].sort().map((code) => ({ code, name: names.get(code) ?? code }));
            const routes = allSystemTransactions();
            return {
                items: rows,
                totals: {
                    codes: rows.length,
                    live: byState.live ?? 0,
                    reserved: byState.reserved ?? 0,
                    liveUnlinked: byState.live_unlinked ?? 0,
                    added: byState.added_reserved ?? 0,
                    retired: byState.retired ?? 0,
                    installedRoutes: routes.length,
                    linkedRoutes: new Set(rows.filter((r) => r.state === 'live').flatMap((r) => r.routes)).size,
                },
                modules,
                areas: areaDefinitions(),
                actions: Object.entries(ACTION_NAMES).map(([code, name]) => ({ code, name })),
                gl: await glDefaults(),
            };
        }),
    ],

    'POST /api/admin/transactions/audit': [
        staff('admin.transactions.audit', 'read', async () => {
            const [storedTypes, custom] = await Promise.all([
                getDoc('module_workspaces/MNT/metadata/maintenanceTypes'),customCodes()
            ]);
            const fallback = DEFAULT_MODULE_METADATA.MNT.find(x=>x.key==='maintenanceTypes')?.items ?? [];
            const types:unknown[] = Array.isArray(storedTypes?.data.items)?storedTypes.data.items:fallback;
            const maintenanceTypes=types.filter((x):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x))
                .filter(x=>x.active!==false&&x.selectable!==false).map(x=>({code:str(x.code),label:str(x.label)}))
                .filter(x=>!!x.code);
            const rows=transactionCatalogue(custom);
            return auditFinanceTransactions({
                rows,installedRoutes:allSystemTransactions(),maintenanceTypes,
            });
        }),
    ],

    'POST /api/admin/transactions/code/add': [
        staff('admin.transactions.code.add', 'write', async (ctx) => {
            const module = str(ctx.body.module).trim().toUpperCase();
            const area = str(ctx.body.area).trim().toUpperCase();
            const action = str(ctx.body.action).trim().toUpperCase();
            const name = str(ctx.body.name).trim();
            const reason = str(ctx.body.reason).trim();
            if (!MODULE_RE.test(module) || !moduleNames().has(module)) throw new HttpError(400, 'Choose a MEMS module.');
            if (!AREA_RE.test(area) || area === 'MOD' || area === 'LEG') throw new HttpError(400, 'The submodule code is 3 or 4 capital letters or digits (MOD and LEG are reserved).');
            if (!ACTION_RE.test(action) || action === 'LG') throw new HttpError(400, 'The action code is 2 to 4 capital letters or digits.');
            if (name.length < 3 || name.length > 80) throw new HttpError(400, 'Describe the transaction in 3 to 80 characters.');
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for reserving this code (10 to 300 characters).');
            const known = areaDefinitions().find((d) => d.module === module && d.area === area);
            const areaName = known?.name ?? str(ctx.body.areaName).trim();
            if (!known && (areaName.length < 3 || areaName.length > 60)) throw new HttpError(400, 'Name the new submodule (3 to 60 characters).');
            const actionName = ACTION_NAMES[action] ?? str(ctx.body.actionName).trim();
            if (!ACTION_NAMES[action] && (actionName.length < 3 || actionName.length > 40)) throw new HttpError(400, 'Name the new action (3 to 40 characters).');
            const code = `${module}-${area}-${action}`;
            if (plannedTransactionBlueprints().some((b) => b.code === code) || allSystemTransactions().some((r) => r.code === code)) {
                throw new HttpError(409, `${code} already exists in the MEMS catalogue.`);
            }
            const now = nowIso();
            const created = await writeDoc(`${CODES}/${code}`, {
                code, module, area, areaName, action, actionName, name, reason, status: 'reserved', executable: false,
                addedBy: ctx.uid, addedByEmail: ctx.actor.email, addedAt: now, updatedAt: now,
            }, { exists: false });
            if (!created) throw new HttpError(409, `${code} was already reserved. Codes are never reused.`);
            await record(ctx, 'transactions.code.add', code, `${name} (${areaName} · ${actionName}). Reason: ${reason}`);
            return { code };
        }),
    ],

    'POST /api/admin/transactions/code/retire': [
        staff('admin.transactions.code.retire', 'write', async (ctx) => {
            const code = str(ctx.body.code).trim().toUpperCase();
            const reason = str(ctx.body.reason).trim();
            if (!/^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/.test(code)) throw new HttpError(400, 'Choose a code.');
            if (reason.length < 10 || reason.length > 300) throw new HttpError(400, 'Give the reason for retiring this code (10 to 300 characters).');
            const doc = await getDoc(`${CODES}/${code}`);
            if (!doc) throw new HttpError(404, 'Only codes added by MEMS administration can be retired. Built-in codes are permanent.');
            if (str(doc.data.status) === 'retired') throw new HttpError(409, `${code} is already retired.`);
            const saved = await writeDoc(`${CODES}/${code}`, { ...doc.data, status: 'retired', retiredBy: ctx.uid, retiredByEmail: ctx.actor.email, retiredAt: nowIso(), retireReason: reason, updatedAt: nowIso() }, { updateTime: doc.updateTime });
            if (!saved) throw new HttpError(409, 'The code changed while you were retiring it. Refresh and try again.');
            await record(ctx, 'transactions.code.retire', code, `Reason: ${reason}`);
            return { code, status: 'retired' };
        }),
    ],
};
