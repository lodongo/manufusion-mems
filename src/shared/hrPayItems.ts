/**
 * Personal pay items and bank details of one employee (HR → Payroll → payslip).
 *
 * "Personal" means it belongs to this employee and not to the grade: check-offs, SACCO, staff loans, salary advances,
 * court orders on the deduction side; acting allowances, bonuses, commission and arrears on the earnings side.
 * Pure rules shared by the server (which is the authority) and the screen (which shows the same messages before saving).
 */

export type PayItemKind = 'earning' | 'deduction';
export type PayItemStatus = 'pending' | 'verified';
/** Which kind of general ledger account a deduction is posted against: money owed to someone else, or money the company is owed. */
export type AccountKind = 'payable' | 'receivable';
export type PayItemType = { code: string; label: string; taxable: boolean; schedule: boolean; account?: AccountKind };

/**
 * `schedule` types may carry a total (the "principal"): the deduction then reduces it instalment by instalment, the payslip shows
 * the instalment and what is still owed, and it stops by itself when the total is repaid.
 * `account` is the kind of ledger account the deduction is posted against. Money withheld for a bank, a SACCO, a union, a court or
 * an insurer is owed to them (a payable). A staff loan or a salary advance is owed BY the employee to the company (a receivable).
 */
export const EARNING_TYPES: PayItemType[] = [
    { code: 'acting', label: 'Acting allowance', taxable: true, schedule: false },
    { code: 'bonus', label: 'Bonus', taxable: true, schedule: false },
    { code: 'commission', label: 'Commission', taxable: true, schedule: false },
    { code: 'arrears', label: 'Arrears', taxable: true, schedule: false },
    { code: 'reimbursement', label: 'Reimbursement', taxable: false, schedule: false },
    { code: 'other', label: 'Other earning', taxable: true, schedule: false },
];
export const DEDUCTION_TYPES: PayItemType[] = [
    { code: 'checkoff', label: 'Check-off', taxable: false, schedule: true, account: 'payable' },
    { code: 'sacco', label: 'SACCO', taxable: false, schedule: true, account: 'payable' },
    { code: 'loan', label: 'Staff loan', taxable: false, schedule: true, account: 'receivable' },
    { code: 'advance', label: 'Salary advance', taxable: false, schedule: true, account: 'receivable' },
    { code: 'court', label: 'Court order', taxable: false, schedule: true, account: 'payable' },
    { code: 'welfare', label: 'Welfare', taxable: false, schedule: false, account: 'payable' },
    { code: 'insurance', label: 'Insurance premium', taxable: false, schedule: false, account: 'payable' },
    { code: 'other', label: 'Other deduction', taxable: false, schedule: true, account: 'payable' },
];
/** The account suggested for each deduction type, taken from the MEMS chart of accounts. Only a suggestion: it is used when the legal entity has adopted it. */
export const SUGGESTED_ACCOUNT: Record<string, string> = {
    checkoff: '20303050', // Employee Loan Repayments Payable to Lenders (a bank check-off)
    sacco: '20303040', // SACCO and Cooperative Deductions Payable
    court: '20303070', // Court Orders and Garnishments Payable
    insurance: '20303060', // Insurance Premium Deductions Payable
    welfare: '20303080', // Other Employee Benefit Deductions Payable
    other: '20303080',
    loan: '10206030', // Staff Loans - Current
    advance: '10206010', // Staff Salary Advances
};
export const accountKindOf = (kind: PayItemKind, type: string): AccountKind | '' => (kind === 'deduction' ? typeOf(kind, type)?.account || '' : '');
export const typesFor = (kind: PayItemKind) => (kind === 'earning' ? EARNING_TYPES : DEDUCTION_TYPES);
export const typeOf = (kind: PayItemKind, code: string) => typesFor(kind).find((t) => t.code === code);

export type PersonalItem = {
    id: string;
    kind: PayItemKind;
    type: string;
    label: string;
    /** Loan number, SACCO member number, court case number... printed on the payslip. */
    reference: string;
    /** Per month. */
    amount: number;
    /** Earnings only. A taxable earning is taxed and counts for the statutory contributions. */
    taxable: boolean;
    /** Deductions that reduce a total (a bank check-off, a loan, a court order...): the total still to deduct. 0 when there is no total. */
    principal: number;
    /** Deductions only: the general ledger account the amount is posted against (a payable, or for loans and advances a receivable). */
    glAccount: string;
    /** First month the item applies, YYYY-MM. */
    startMonth: string;
    /** Last month it applies, YYYY-MM, or empty when it runs until removed. Always empty when there is a total: it ends when the total is repaid. */
    endMonth: string;
    status: PayItemStatus;
    /** Who last changed it and when. A different person has to verify it. */
    changedBy: string;
    changedAt: string;
    verifiedBy: string;
    verifiedAt: string;
};

export type BankDetails = {
    bankId: string;
    bankName: string;
    branch: string;
    accountName: string;
    accountNumber: string;
    status: PayItemStatus;
    changedBy: string;
    changedAt: string;
    verifiedBy: string;
    verifiedAt: string;
};

export const MAX_ITEMS = 30;
export const MAX_AMOUNT = 1e9;
/** The longest a total may take to repay, in months. */
export const MAX_TERM = 120;
export const GL_ACCOUNT = /^[A-Za-z0-9_-]{1,20}$/;
export const MONTH = /^(20\d\d)-(0[1-9]|1[0-2])$/;
export const LABEL = /^[\p{L}\p{N} _.,;:/()#&+'’-]{2,60}$/u;
export const REFERENCE = /^[A-Za-z0-9 _./#-]{0,40}$/;
export const ACCOUNT_NUMBER = /^[A-Z0-9]{4,34}$/;

const r2 = (n: number) => Math.round(n * 100) / 100;
const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6;
export const monthIndex = (m: string) => {
    const x = MONTH.exec(m);
    return x ? Number(x[1]) * 12 + Number(x[2]) - 1 : NaN;
};
export const monthLabel = (m: string) => {
    const x = MONTH.exec(m);
    if (!x) return m;
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(x[2]) - 1] + ' ' + x[1];
};
export const shiftMonth = (m: string, by: number) => {
    const i = monthIndex(m) + by;
    return Number.isNaN(i) ? m : `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/** Monthly deduction that repays `principal` over `months` months (rounded up to the cent; the last instalment is what is left). */
export const instalmentFor = (principal: number, months: number) =>
    Number.isFinite(principal) && principal > 0 && Number.isInteger(months) && months >= 1 ? Math.ceil((principal / months) * 100 - 1e-9) / 100 : NaN;
/** How many instalments repay `principal` at `amount` a month. */
export const termMonths = (principal: number, amount: number) => (principal > 0 && amount > 0 ? Math.ceil(principal / amount - 1e-9) : 0);
/** What the last instalment is when the monthly amount does not divide the total. */
export const lastInstalment = (principal: number, amount: number) => {
    const n = termMonths(principal, amount);
    return n ? r2(principal - amount * (n - 1)) : 0;
};
/** The month the last instalment is taken, or '' when there is no total. */
export const finishMonth = (startMonth: string, principal: number, amount: number) => {
    const n = termMonths(principal, amount);
    return n && MONTH.test(startMonth) ? shiftMonth(startMonth, n - 1) : '';
};

/** Account numbers are stored without spaces or dashes, in capitals. */
export const normalAccountNumber = (v: unknown) => String(v ?? '').replace(/[\s-]+/g, '').toUpperCase();
export const maskAccount = (n: string) => (n.length > 4 ? '••••' + n.slice(-4) : n ? '••••' : '');

/**
 * The problem with an item as typed, or '' when it can be saved.
 * A deduction needs its ledger account unless `needAccount` is false (an item saved before accounts existed and left untouched).
 */
export function itemProblem(
    i: Pick<PersonalItem, 'kind' | 'type' | 'label' | 'reference' | 'amount' | 'taxable' | 'principal' | 'startMonth' | 'endMonth'> & { glAccount?: string },
    opts: { needAccount?: boolean } = {},
): string {
    if (i.kind !== 'earning' && i.kind !== 'deduction') return 'Choose whether this is an earning or a deduction.';
    const t = typeOf(i.kind, i.type);
    if (!t) return 'Choose the type.';
    if (!LABEL.test(String(i.label ?? '').trim())) return 'Give it a name of 2 to 60 letters, numbers or . , ; : / ( ) # & + -';
    if (!REFERENCE.test(String(i.reference ?? ''))) return 'The reference can use letters, numbers, spaces and . _ / # - up to 40 characters.';
    const amount = Number(i.amount);
    if (!Number.isFinite(amount) || amount <= 0) return 'Enter the monthly amount above 0.';
    if (amount > MAX_AMOUNT) return 'That amount is too large.';
    if (!twoDecimals(amount)) return 'Use at most 2 decimals.';
    const principal = Number(i.principal) || 0;
    if (principal !== 0) {
        if (!t.schedule || i.kind !== 'deduction') return 'This type cannot have a total to repay.';
        if (!Number.isFinite(principal) || principal < 0) return 'The total to repay must be above 0.';
        if (principal > MAX_AMOUNT) return 'The total to repay is too large.';
        if (!twoDecimals(principal)) return 'The total to repay can have at most 2 decimals.';
        if (principal < amount) return 'The total to repay cannot be less than one monthly deduction.';
        if (termMonths(principal, amount) > MAX_TERM) return `That takes more than ${MAX_TERM} months to repay. Raise the monthly deduction.`;
        if (i.endMonth) return 'A deduction with a total ends when the total is repaid. Leave the last month empty.';
    }
    const account = String(i.glAccount ?? '').trim();
    if (i.kind === 'earning' && account) return 'An earning has no ledger account here.';
    if (i.kind === 'deduction') {
        if (account && !GL_ACCOUNT.test(account)) return 'That ledger account is not valid.';
        if (!account && opts.needAccount !== false) return t.account === 'receivable' ? 'Choose the receivable account for this loan or advance.' : 'Choose the payable account this deduction is paid into.';
    }
    if (i.kind === 'deduction' && i.taxable) return 'A deduction is not taxable.';
    if (!MONTH.test(String(i.startMonth ?? ''))) return 'Choose the month it starts.';
    if (i.endMonth && !MONTH.test(String(i.endMonth))) return 'Choose a valid last month, or leave it empty.';
    if (i.endMonth && monthIndex(i.endMonth) < monthIndex(i.startMonth)) return 'The last month cannot be before the first month.';
    return '';
}

export type Scheduled = {
    amount: number;
    /** Loans and advances: instalment number, instalments in all, and what is still owed after this payslip. */
    installment?: number;
    installments?: number;
    balance?: number;
};

/** What an item amounts to on the payslip of `month` (YYYY-MM), or null when it does not apply that month. */
export function scheduledFor(i: Pick<PersonalItem, 'amount' | 'principal' | 'startMonth' | 'endMonth'>, month: string): Scheduled | null {
    const at = monthIndex(month), from = monthIndex(i.startMonth);
    if (Number.isNaN(at) || Number.isNaN(from) || at < from) return null;
    if (i.endMonth && at > monthIndex(i.endMonth)) return null;
    const amount = Number(i.amount) || 0;
    if (amount <= 0) return null;
    const principal = Number(i.principal) || 0;
    if (principal <= 0) return { amount: r2(amount) };
    const paidBefore = amount * (at - from);
    const owed = r2(principal - paidBefore);
    if (owed <= 0.004) return null;
    const pay = r2(Math.min(amount, owed));
    return { amount: pay, installment: at - from + 1, installments: Math.ceil(principal / amount - 1e-9), balance: r2(owed - pay) };
}

const money = (n: number) => new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const itemNote = (i: Pick<PersonalItem, 'reference' | 'status'>, s: Scheduled) =>
    [
        i.reference ? 'Ref ' + i.reference : '',
        s.installment ? `Instalment ${s.installment} of ${s.installments}` : '',
        s.balance !== undefined ? `Balance after this payslip ${money(s.balance)}` : '',
        i.status === 'pending' ? 'Awaiting verification' : '',
    ]
        .filter(Boolean)
        .join(' · ');

/** The lines a payslip month takes from the items: earnings and deductions the engine adds. */
export function linesForMonth(items: PersonalItem[], month: string) {
    const earnings: Array<{ code: string; label: string; amount: number; taxable: boolean; note: string }> = [];
    const deductions: Array<{ code: string; label: string; amount: number; note: string }> = [];
    for (const i of items) {
        const s = scheduledFor(i, month);
        if (!s) continue;
        const note = itemNote(i, s);
        if (i.kind === 'earning') earnings.push({ code: 'PE_' + i.id, label: i.label, amount: s.amount, taxable: i.taxable, note });
        else deductions.push({ code: 'PD_' + i.id, label: i.label, amount: s.amount, note });
    }
    return { earnings, deductions, pending: items.filter((i) => i.status === 'pending' && scheduledFor(i, month)).length };
}

export const emptyItem = (kind: PayItemKind, month: string): PersonalItem => ({
    id: '', kind, type: typesFor(kind)[0].code, label: '', reference: '', amount: NaN, taxable: typesFor(kind)[0].taxable, principal: 0, glAccount: '',
    startMonth: month, endMonth: '', status: 'pending', changedBy: '', changedAt: '', verifiedBy: '', verifiedAt: '',
});
