/**
 * Payroll → the ledger accounts a deduction can be posted against, for one legal entity.
 *
 * Read from the legal entity's own adopted chart of accounts (Finance), so a deduction can only point at an account Finance
 * has approved for that entity. The rules for what qualifies are in src/shared/hrPayAccounts.ts. Nothing is posted from here:
 * the account is recorded on the deduction (and verified by a second person with the rest of the item) for the day a payroll run
 * posts the withholdings.
 */
import { str } from './core';
import { chartOf, entityOf, mappingOf, systemAccounts } from './finCore';
import { splitPayrollAccounts, type ChartAccount } from '../src/shared/hrPayAccounts';
import type { AccountKind } from '../src/shared/hrPayItems';

export async function payrollAccounts(org: string, entityId: string) {
    const [chart, mapping, entity] = await Promise.all([chartOf(org, entityId), mappingOf(org, entityId), entityOf(org, entityId)]);
    const scoped = entity.doc?.data.glScopeConfigured === true;
    const allowed = scoped ? new Set(Array.isArray(entity.doc?.data.allowedGl) ? (entity.doc!.data.allowedGl as unknown[]).map(str) : []) : null;
    const accounts: ChartAccount[] = [...chart.values()].map((a) => ({
        code: a.code, name: a.name, classCode: a.classCode, categoryCode: a.categoryCode, groupName: a.groupName, accountRole: a.accountRole, status: a.status, postable: a.postable,
    }));
    return splitPayrollAccounts(accounts, systemAccounts(mapping), allowed);
}

/** Whether `code` is an account of the kind the deduction type needs, for this legal entity. */
export async function accountAllowed(org: string, entityId: string, kind: AccountKind, code: string, cache?: { value?: Awaited<ReturnType<typeof payrollAccounts>> }) {
    const set = cache?.value ?? (await payrollAccounts(org, entityId));
    if (cache) cache.value = set;
    return set[kind].some((a) => a.code === code);
}
