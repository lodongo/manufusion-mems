/**
 * Which general ledger accounts a payroll deduction may be posted against.
 *
 * Pure rules shared by the server (which decides) and the tests. A deduction is money taken from the employee's pay, so the other
 * side of the entry is either
 *  - a PAYABLE: money the company now owes to a bank, a SACCO, a union, a court or an insurer (liabilities, class 2, in the
 *    trade and other payables, payroll and employee liabilities and taxes and statutory payables categories), or
 *  - a RECEIVABLE: for a staff loan or a salary advance the company is the lender, so the deduction repays what the employee
 *    owes the company (staff loan and salary advance accounts in the receivables and long-term loans categories).
 * Only accounts the legal entity has adopted, that are active and can be posted to, and that no system posting is mapped to
 * (goods received not invoiced, tax accounts and so on) can be chosen. Control, clearing, memorandum and statistical accounts cannot.
 */
import type { AccountKind } from './hrPayItems';

export type ChartAccount = {
    code: string;
    name: string;
    classCode: string;
    categoryCode: string;
    groupName?: string;
    accountRole: string;
    status: string;
    postable: boolean;
};
export type PayAccount = { code: string; name: string; group: string };

const PAYABLE_CATEGORIES = new Set(['201', '203', '204']);
const RECEIVABLE_CATEGORIES = new Set(['102', '114']);
const EMPLOYEE_LOAN = /(staff|employee)\s+(salary\s+)?(loans?|advances?)|salary\s+advances?/i;

/** payable, receivable, or '' when the account is not one a deduction may be posted against. */
export function payrollAccountKind(a: ChartAccount): AccountKind | '' {
    if (a.status !== 'active' || !a.postable) return '';
    const role = (a.accountRole || 'standard').toLowerCase();
    if (a.classCode === '2' && PAYABLE_CATEGORIES.has(a.categoryCode) && role === 'standard') return 'payable';
    if (a.classCode === '1' && RECEIVABLE_CATEGORIES.has(a.categoryCode) && (role === 'standard' || role === 'control') && EMPLOYEE_LOAN.test(a.name)) return 'receivable';
    return '';
}

/**
 * The accounts that can be chosen, by kind, sorted by code.
 * `system` are accounts a system posting is mapped to; `allowed` is the legal entity's approved selection when it has one.
 */
export function splitPayrollAccounts(accounts: Iterable<ChartAccount>, system: ReadonlySet<string> = new Set(), allowed: ReadonlySet<string> | null = null) {
    const out: Record<AccountKind, PayAccount[]> = { payable: [], receivable: [] };
    for (const a of accounts) {
        if (system.has(a.code) || (allowed && !allowed.has(a.code))) continue;
        const kind = payrollAccountKind(a);
        if (kind) out[kind].push({ code: a.code, name: a.name, group: a.groupName || '' });
    }
    out.payable.sort((x, y) => x.code.localeCompare(y.code));
    out.receivable.sort((x, y) => x.code.localeCompare(y.code));
    return out;
}
