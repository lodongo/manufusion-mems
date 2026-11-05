/**
 * Personal pay items and bank details of one employee (HR → Payroll → payslip).
 *
 * "Personal" means it belongs to this employee and not to the grade: check-offs, SACCO, staff loans, salary advances,
 * court orders on the deduction side; acting allowances, bonuses, commission and arrears on the earnings side.
 * Pure rules shared by the server (which is the authority) and the screen (which shows the same messages before saving).
 */

export type PayItemKind = 'earning' | 'deduction';
export type PayItemStatus = 'pending' | 'verified';
export type PayItemType = { code: string; label: string; taxable: boolean; schedule: boolean };

/** `schedule` types may carry a principal: the payslip then shows the instalment and what is still owed. */
export const EARNING_TYPES: PayItemType[] = [
    { code: 'acting', label: 'Acting allowance', taxable: true, schedule: false },
    { code: 'bonus', label: 'Bonus', taxable: true, schedule: false },
    { code: 'commission', label: 'Commission', taxable: true, schedule: false },
    { code: 'arrears', label: 'Arrears', taxable: true, schedule: false },
    { code: 'reimbursement', label: 'Reimbursement', taxable: false, schedule: false },
    { code: 'other', label: 'Other earning', taxable: true, schedule: false },
];
export const DEDUCTION_TYPES: PayItemType[] = [
    { code: 'checkoff', label: 'Check-off', taxable: false, schedule: false },
    { code: 'sacco', label: 'SACCO', taxable: false, schedule: false },
    { code: 'loan', label: 'Staff loan', taxable: false, schedule: true },
    { code: 'advance', label: 'Salary advance', taxable: false, schedule: true },
    { code: 'court', label: 'Court order', taxable: false, schedule: false },
    { code: 'welfare', label: 'Welfare', taxable: false, schedule: false },
    { code: 'insurance', label: 'Insurance premium', taxable: false, schedule: false },
    { code: 'other', label: 'Other deduction', taxable: false, schedule: false },
];
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
    /** Loans and advances only: what was lent. 0 when there is no schedule. */
    principal: number;
    /** First month the item applies, YYYY-MM. */
    startMonth: string;
    /** Last month it applies, YYYY-MM, or empty when it runs until removed (or until the principal is repaid). */
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

/** Account numbers are stored without spaces or dashes, in capitals. */
export const normalAccountNumber = (v: unknown) => String(v ?? '').replace(/[\s-]+/g, '').toUpperCase();
export const maskAccount = (n: string) => (n.length > 4 ? '••••' + n.slice(-4) : n ? '••••' : '');

/** The problem with an item as typed, or '' when it can be saved. */
export function itemProblem(i: Pick<PersonalItem, 'kind' | 'type' | 'label' | 'reference' | 'amount' | 'taxable' | 'principal' | 'startMonth' | 'endMonth'>): string {
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
        if (!t.schedule || i.kind !== 'deduction') return 'Only a loan or an advance has an amount lent.';
        if (!Number.isFinite(principal) || principal < 0) return 'The amount lent must be above 0.';
        if (principal > MAX_AMOUNT) return 'The amount lent is too large.';
        if (!twoDecimals(principal)) return 'The amount lent can have at most 2 decimals.';
        if (principal < amount) return 'The amount lent cannot be less than one monthly instalment.';
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
    id: '', kind, type: typesFor(kind)[0].code, label: '', reference: '', amount: NaN, taxable: typesFor(kind)[0].taxable, principal: 0,
    startMonth: month, endMonth: '', status: 'pending', changedBy: '', changedAt: '', verifiedBy: '', verifiedAt: '',
});
