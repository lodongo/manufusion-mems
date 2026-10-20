/**
 * GL account transactions: the MEMS default (derived from the GL master, adjusted by MEMS administration), the legal
 * entity's approved adjustments, and the transactions a cost center has switched off.
 *
 *   MEMS default ── platform_config/gl_transaction_map            (super admin, reason, audited)
 *        │ adopted automatically by every legal entity (its chart is synced from the MEMS master)
 *   Legal entity ── organizations/{org}/fin_gltxn/{leId}           (FIN.gltxn.manage proposes, FIN.gltxn.approve approves)
 *        │ inherited by every cost center of the legal entity
 *   Cost center ─── organizations/{org}/fin_cc/{ccId}.txnOff       (FIN.cc.manage proposes, FIN.cc.approve approves)
 *
 * Explicit removals and switch-offs are enforced by the posting engine; everything else is the documented default.
 */
import { getDoc, str } from './core';
import { MEMS_GLTXN_DOC, P, chartOf, overridesOf, type Obj } from './finCore';
import { glMaster } from './procurement';
import { transactionCatalogue, type CatalogueRow } from './transactionCatalogue';
import { applyOverrides, defaultHandlers, type AccountOverride, type Handler, type MasterAccount, type Overrides } from './glTransactionMap';

/** Converts a GL master account (as served by glMaster) to the rule engine's shape; properties come from its parameters. */
export function toMasterAccount(a: Obj): MasterAccount {
    const properties: Record<string, string> = {};
    for (const p of Array.isArray(a.params) ? (a.params as Obj[]) : []) {
        const k = str(p.key);
        if (k && !(k in properties)) properties[k] = str(p.value);
    }
    if (a.properties && typeof a.properties === 'object') for (const [k, v] of Object.entries(a.properties as Obj)) properties[k] = str(v);
    return {
        code: str(a.code),
        name: str(a.name),
        classCode: str(a.classCode),
        categoryCode: str(a.categoryCode),
        categoryName: str(a.categoryName),
        groupCode: str(a.groupCode),
        accountRole: str(a.accountRole),
        accountType: str(a.accountType),
        postingMode: str(a.postingMode) || properties.postingMode || '',
        properties,
    };
}

let catalogueCache: { at: number; byCode: Map<string, CatalogueRow> } | null = null;
/** Built-in transaction catalogue by code (route links are compiled at boot, so a short cache is safe). */
export function catalogueByCode(): Map<string, CatalogueRow> {
    if (!catalogueCache || Date.now() - catalogueCache.at > 5 * 60_000) {
        catalogueCache = { at: Date.now(), byCode: new Map(transactionCatalogue([]).filter((r) => r.kind === 'transaction').map((r) => [r.code, r])) };
    }
    return catalogueCache.byCode;
}

export interface MemsMap {
    version: string;
    accounts: MasterAccount[];
    overrides: Overrides;
    overrideVersion: number;
    updateTime: string | null;
    updatedBy: string;
    updatedAt: string;
}
export async function memsMap(): Promise<MemsMap> {
    const [master, doc] = await Promise.all([glMaster().catch(() => null), getDoc(MEMS_GLTXN_DOC)]);
    return {
        version: master ? str(master.version) : '',
        accounts: (master?.accounts ?? []).map(toMasterAccount).filter((a) => a.code),
        overrides: overridesOf(doc?.data.items),
        overrideVersion: Number(doc?.data.version) || 0,
        updateTime: doc?.updateTime ?? null,
        updatedBy: str(doc?.data.updatedByEmail),
        updatedAt: str(doc?.data.updatedAt),
    };
}

/** The MEMS default for one account: derived from the master, then MEMS administration's changes. */
export function memsHandlers(a: MasterAccount, mems: Overrides): Handler[] {
    return applyOverrides(defaultHandlers(a), mems[a.code]);
}

export interface LeRow {
    account: string;
    name: string;
    categoryCode: string;
    categoryName: string;
    statement: 'BS' | 'PL';
    postingMode: string;
    status: string;
    inMaster: boolean;
    memsDefault: Handler[];
    change: AccountOverride | null;
    effective: Handler[];
}
export interface LeMap {
    rows: LeRow[];
    overrides: Overrides;
    version: number;
    updateTime: string | null;
    approvedAt: string;
    masterVersion: string;
}
/** Every account of the legal entity's chart with its MEMS default, the entity's approved change and the result. */
export async function leMap(orgId: string, leId: string, mems?: MemsMap): Promise<LeMap> {
    const [m, chart, doc] = await Promise.all([mems ? Promise.resolve(mems) : memsMap(), chartOf(orgId, leId), getDoc(P(orgId).gltxn(leId))]);
    const byCode = new Map(m.accounts.map((a) => [a.code, a]));
    const overrides = overridesOf(doc?.data.items);
    const rows: LeRow[] = [];
    for (const acc of chart.values()) {
        if (!acc.postable || acc.status === 'removed') continue;
        const master = byCode.get(acc.code);
        const base: MasterAccount = master ?? { code: acc.code, name: acc.name, classCode: acc.classCode, categoryCode: acc.categoryCode, accountRole: acc.accountRole, accountType: acc.accountType, postingMode: acc.postingMode, properties: {} };
        const memsDefault = memsHandlers(base, m.overrides);
        const change = overrides[acc.code] ?? null;
        rows.push({
            account: acc.code,
            name: acc.name,
            categoryCode: acc.categoryCode,
            categoryName: acc.categoryName,
            statement: acc.statement,
            postingMode: acc.postingMode,
            status: acc.status,
            inMaster: !!master,
            memsDefault,
            change,
            effective: applyOverrides(memsDefault, change ?? undefined),
        });
    }
    rows.sort((a, b) => a.account.localeCompare(b.account));
    return { rows, overrides, version: Number(doc?.data.version) || 0, updateTime: doc?.updateTime ?? null, approvedAt: str(doc?.data.approvedAt), masterVersion: m.version };
}

/** Transactions that post to the legal entity's active accounts, for switching off on a cost center. */
export async function ccTransactionChoices(orgId: string, leId: string): Promise<Array<{ code: string; name: string; module: string; state: string; accounts: number }>> {
    const map = await leMap(orgId, leId);
    const count = new Map<string, number>();
    for (const r of map.rows) if (r.status === 'active') for (const h of r.effective) count.set(h.code, (count.get(h.code) ?? 0) + 1);
    const cat = catalogueByCode();
    return [...count.entries()]
        .map(([code, accounts]) => ({ code, accounts, name: cat.get(code)?.name ?? code, module: cat.get(code)?.module ?? code.slice(0, 3), state: cat.get(code)?.state ?? 'reserved' }))
        .sort((a, b) => a.code.localeCompare(b.code));
}
