/**
 * Payslip engine (browser- and server-safe, pure, no imports).
 *
 * Turns a job grade plus the legal entity's Compensation & Benefits catalogue into a monthly payslip:
 * earnings, deductions taken before tax, tax and reliefs, other deductions, net pay and employer cost.
 * It is used by the payslip simulator on the Job Grades screen and is the single place where the
 * calculation order lives, so payroll can reuse it later.
 *
 * Order (Kenya reference, see docs claude/hr-job-grades.md):
 *   gross pay -> NSSF / SHIF / Housing Levy and pension (all before tax) -> taxable pay -> PAYE bands
 *   -> less personal and insurance relief -> other deductions -> net pay.
 *
 * Exceptions (configured per statutory item) change one line for people in a given circumstance:
 *   exempt        the line is not charged at all
 *   exempt_first  the first <value> of the line's base is not charged (for example disability exemption)
 *   not_entitled  a relief is not given
 *   reroute       the line is still deducted but paid to another approved scheme (NSSF Tier II contracting out)
 *   rate / cap    replace the rate (fraction) or the monthly maximum
 */

export type ExceptionEffect = 'exempt' | 'exempt_first' | 'not_entitled' | 'reroute' | 'rate' | 'cap';
export const EXCEPTION_EFFECTS: ExceptionEffect[] = ['exempt', 'exempt_first', 'not_entitled', 'reroute', 'rate', 'cap'];

export type PayException = {
    code: string;
    name: string;
    description: string;
    effect: ExceptionEffect;
    /** exempt_first: monthly amount; rate: fraction (0.05 = 5%); cap: monthly maximum; otherwise unused. */
    value: number;
    /** The proof a person must hold before the exception may be applied to their record. */
    evidence: string;
    reference: string;
    enabled: boolean;
};

export type PayslipBand = { upTo: number | null; rate: number };
export type PayslipItem = {
    code: string;
    name: string;
    category: string;
    enabled: boolean;
    mandatory: boolean;
    amount: number;
    rate: number;
    minimum: number;
    maximum: number;
    method: string;
    base: string;
    employerRate: number;
    employerAmount: number;
    payrollTreatment: string;
    taxable: boolean;
    bands: PayslipBand[];
    options: Record<string, string | number | boolean>;
    exceptions?: PayException[];
};

export type GradeValue = { amount?: number; rate?: number };
export type PayslipGrade = {
    code: string;
    title: string;
    minSalary: number;
    payModelCode?: string;
    taxCodes: string[];
    deductionCodes: string[];
    benefitCodes?: string[];
    benefitValues?: Record<string, GradeValue>;
};

export type PayslipInput = {
    basicSalary: number;
    overtimeWeekdayHours?: number;
    overtimeRestHours?: number;
    /** Exception codes in force for the simulated person (the same code can exist on several items). */
    circumstances?: string[];
    /** Monthly amounts the person declares with proof: insurance premiums, mortgage interest, voluntary pension... keyed by item code. */
    declared?: Record<string, number>;
    /** Monthly amounts for optional deductions (SACCO, loans...) keyed by item code. */
    otherDeductions?: Record<string, number>;
    hoursPerMonth?: number;
    /** Earnings that belong to this person alone (acting allowance, bonus, commission...). Taxable ones are taxed and count for contributions; a non-taxable one (a reimbursement) is neither. */
    personalEarnings?: PersonalEarning[];
    /** Deductions that belong to this person alone (check-off, staff loan, court order...). Taken after tax. */
    personalDeductions?: PersonalDeduction[];
};
export type PersonalEarning = { code: string; label: string; amount: number; taxable?: boolean; note?: string };
export type PersonalDeduction = { code: string; label: string; amount: number; note?: string };

export type PayslipSection = 'earnings' | 'noncash' | 'preTax' | 'tax' | 'relief' | 'deductions' | 'employer';
export type PayslipLine = { code: string; label: string; section: PayslipSection; amount: number; note?: string };
export type Payslip = {
    lines: PayslipLine[];
    basic: number;
    grossCash: number;
    taxableGross: number;
    preTaxTotal: number;
    taxablePay: number;
    taxBeforeRelief: number;
    reliefTotal: number;
    tax: number;
    employeeStatutory: number;
    otherDeductionsTotal: number;
    personalEarningsTotal: number;
    personalDeductionsTotal: number;
    net: number;
    employerCost: number;
    totalCostToEmployer: number;
    appliedExceptions: Array<{ item: string; exception: string; effect: ExceptionEffect }>;
    warnings: string[];
    notes: string[];
};

export const DEFAULT_HOURS_PER_MONTH = 225;
/** Employee contributions the Kenya Income Tax Act treats as deductible before PAYE (Tax Laws (Amendment) Act 2024). */
const PRE_TAX_CODES = new Set(['KE_NSSF', 'KE_SHIF', 'KE_AHL']);
/** Employment Act 2007 s.19: total deductions must leave at least one third of pay. */
const MIN_TAKE_HOME_SHARE = 1 / 3;

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const pos = (n: unknown) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? v : 0;
};

export const isPreTax = (item: PayslipItem) => item.options.preTax === true || PRE_TAX_CODES.has(item.code);
const isPension = (item: PayslipItem) => item.code === 'KE_NSSF' || item.options.pension === true;

/** Exceptions that are both switched on in the configuration and in force for this person. */
function inForce(item: PayslipItem, circumstances: Set<string>): PayException[] {
    return (item.exceptions || []).filter((e) => e.enabled && circumstances.has(e.code));
}

/** Monthly value of a selected allowance, incentive or benefit: grade override first, then the catalogue. */
export function benefitValue(item: PayslipItem, grade: PayslipGrade, basic: number): number {
    const override = grade.benefitValues?.[item.code];
    if (override && override.amount !== undefined && override.amount !== null) return r2(pos(override.amount));
    const rate = override && override.rate !== undefined && override.rate !== null ? pos(override.rate) : pos(item.rate);
    if (item.method === 'percent' || (override && override.rate !== undefined && override.rate !== null)) return r2(rate * basic);
    return r2(pos(item.amount));
}

type Money = { employee: number; employer: number; routed: number; routedEmployer: number };

/** Statutory contribution on a base, with tiers (NSSF), minimum and maximum, after exceptions. */
function contribution(item: PayslipItem, base: number, force: PayException[], lines: PayslipLine[], notes: string[]): Money {
    const none: Money = { employee: 0, employer: 0, routed: 0, routedEmployer: 0 };
    if (force.some((e) => e.effect === 'exempt')) return none;
    let b = base;
    for (const e of force) if (e.effect === 'exempt_first') b = Math.max(0, b - pos(e.value));
    let rate = item.rate;
    let employerRate = item.employerRate;
    let maximum = item.maximum;
    for (const e of force) {
        if (e.effect === 'rate') {
            rate = pos(e.value);
            if (employerRate > 0) employerRate = rate;
        }
        if (e.effect === 'cap') maximum = pos(e.value);
    }
    const reroute = force.some((e) => e.effect === 'reroute');
    const upper = Number(item.options.upperEarningsLimit) || 0;
    const lower = Number(item.options.lowerEarningsLimit) || 0;
    const tiered = item.options.tiers === true && upper > 0 && lower >= 0;
    const compute = (r: number) => {
        if (item.method === 'fixed') return { total: pos(item.amount), t1: pos(item.amount), t2: 0 };
        if (!tiered) {
            let v = r * b;
            if (item.minimum > 0 && b > 0 && v < item.minimum) v = item.minimum;
            if (maximum > 0 && v > maximum) v = maximum;
            return { total: r2(v), t1: r2(v), t2: 0 };
        }
        const pensionable = Math.min(b, upper);
        const t1 = r * Math.min(pensionable, lower);
        const t2 = r * Math.max(0, pensionable - lower);
        let total = t1 + t2;
        if (maximum > 0 && total > maximum) total = maximum;
        return { total: r2(total), t1: r2(Math.min(t1, total)), t2: r2(Math.max(0, total - Math.min(t1, total))) };
    };
    const emp = compute(rate);
    const er = employerRate > 0 ? compute(employerRate) : { total: r2(pos(item.employerAmount)), t1: 0, t2: 0 };
    if (reroute && tiered) {
        lines.push({ code: item.code + '_T1', label: item.name + ' – Tier I', section: 'preTax', amount: emp.t1, note: 'Paid to the statutory fund' });
        lines.push({ code: item.code + '_T2', label: item.name + ' – Tier II (contracted-out scheme)', section: 'preTax', amount: emp.t2, note: 'Paid to the approved scheme instead of the fund' });
        notes.push(item.name + ': Tier II is paid to an approved contracted-out scheme; the employee deduction is unchanged.');
        return { employee: emp.total, employer: er.total, routed: emp.t2, routedEmployer: er.t2 };
    }
    lines.push({ code: item.code, label: item.name, section: isPreTax(item) ? 'preTax' : 'deductions', amount: emp.total });
    return { employee: emp.total, employer: er.total, routed: 0, routedEmployer: 0 };
}

/** Progressive tax on a monthly taxable amount (bands carry monthly ceilings). */
export function progressiveTax(taxable: number, bands: PayslipBand[]): number {
    let lower = 0;
    let tax = 0;
    for (const band of bands) {
        const ceiling = band.upTo === null ? Infinity : band.upTo;
        if (taxable > lower) tax += (Math.min(taxable, ceiling) - lower) * band.rate;
        if (taxable <= ceiling) break;
        lower = ceiling;
    }
    return r2(tax);
}

export function computePayslip(grade: PayslipGrade, catalogue: PayslipItem[], input: PayslipInput): Payslip {
    const byCode = new Map(catalogue.map((i) => [i.code, i]));
    const circumstances = new Set(input.circumstances || []);
    const lines: PayslipLine[] = [];
    const warnings: string[] = [];
    const notes: string[] = [];
    const applied: Payslip['appliedExceptions'] = [];
    const get = (code: string, why: string): PayslipItem | null => {
        const item = byCode.get(code);
        if (!item) {
            warnings.push(`${code} is selected for this grade (${why}) but is not in the Benefits catalogue.`);
            return null;
        }
        return item.enabled ? item : null;
    };
    const note = (item: PayslipItem, force: PayException[]) => {
        for (const e of force) applied.push({ item: item.name, exception: e.name, effect: e.effect });
    };

    // ---- Earnings ---------------------------------------------------------------------------------
    const basic = r2(pos(input.basicSalary));
    lines.push({ code: 'BASIC', label: 'Basic salary', section: 'earnings', amount: basic });
    if (basic < pos(grade.minSalary)) warnings.push(`Basic salary is below the grade minimum of ${r2(pos(grade.minSalary)).toLocaleString('en')}.`);
    const hours = pos(input.hoursPerMonth) || DEFAULT_HOURS_PER_MONTH;
    const hourly = basic / hours;
    let cashExtras = 0;
    // Taxable pay differs from gross cash by taxable non-cash benefits (added) and tax-free allowances (taken out).
    let taxableAdjust = 0;
    let noncashValue = 0;
    for (const code of grade.benefitCodes || []) {
        const item = get(code, 'benefit');
        if (!item) continue;
        if (item.category === 'overtime') {
            const worked = code === 'OT_WEEKDAY' ? pos(input.overtimeWeekdayHours) : code === 'OT_REST_HOLIDAY' ? pos(input.overtimeRestHours) : 0;
            const multiplier = pos(item.rate) || 1;
            const pay = r2(worked * hourly * multiplier);
            if (worked > 0) {
                lines.push({ code, label: item.name, section: 'earnings', amount: pay, note: `${worked} h × ${multiplier}×` });
                cashExtras += pay;
            }
            continue;
        }
        const value = benefitValue(item, grade, basic);
        if (item.category === 'benefits' || item.payrollTreatment === 'noncash') {
            lines.push({ code, label: item.name, section: 'noncash', amount: value, note: item.taxable ? 'Taxable benefit' : 'Not taxed' });
            noncashValue += value;
            if (item.taxable) taxableAdjust += value;
        } else if (item.category === 'allowances' || item.category === 'incentives') {
            lines.push({ code, label: item.name, section: 'earnings', amount: value, note: item.taxable ? undefined : 'Not taxed' });
            cashExtras += value;
            if (!item.taxable) taxableAdjust -= value;
        }
    }
    // Earnings that belong to this person alone are paid in cash like an allowance.
    let personalEarningsTotal = 0;
    /** Personal earnings marked not taxable (reimbursements) are outside pay for contributions as well as for tax. */
    let outsideContributions = 0;
    for (const e of input.personalEarnings || []) {
        const value = r2(pos(e.amount));
        if (!value) continue;
        lines.push({ code: e.code, label: e.label, section: 'earnings', amount: value, note: e.note || (e.taxable === false ? 'Not taxed' : undefined) });
        cashExtras += value;
        personalEarningsTotal += value;
        if (e.taxable === false) {
            taxableAdjust -= value;
            outsideContributions += value;
        }
    }
    personalEarningsTotal = r2(personalEarningsTotal);
    const grossCash = r2(basic + cashExtras);
    const taxableGross = r2(Math.max(0, grossCash + taxableAdjust));
    const contributionGross = r2(grossCash - outsideContributions);

    // ---- Statutory contributions and other deductions chosen for the grade -----------------------
    const codes = [...new Set([...(grade.taxCodes || []), ...(grade.deductionCodes || [])])];
    const items = codes.map((c) => get(c, 'tax or deduction')).filter((i): i is PayslipItem => !!i);
    const baseOf = (item: PayslipItem) => {
        switch (item.base) {
            case 'basic':
                return basic;
            case 'taxable':
                return taxableGross;
            case 'net':
                return contributionGross;
            default:
                return contributionGross; // gross, pensionable and anything else contributions are charged on
        }
    };

    let preTaxTotal = 0;
    let pensionPreTax = 0;
    let employeeStatutory = 0;
    let employerStatutory = 0;
    for (const item of items.filter((i) => i.category === 'statutory')) {
        const force = inForce(item, circumstances);
        note(item, force);
        const money = contribution(item, baseOf(item), force, lines, notes);
        if (!money.employee && !money.employer && force.some((e) => e.effect === 'exempt')) {
            lines.push({ code: item.code, label: item.name, section: isPreTax(item) ? 'preTax' : 'deductions', amount: 0, note: 'Exempt: ' + force.map((e) => e.name).join(', ') });
        }
        employeeStatutory += money.employee;
        employerStatutory += money.employer;
        if (isPreTax(item)) {
            preTaxTotal += money.employee;
            if (isPension(item)) pensionPreTax += money.employee;
        }
        if (money.employer > 0) lines.push({ code: item.code + '_ER', label: item.name + ' (employer)', section: 'employer', amount: money.employer });
    }

    // ---- Amounts the person declares with proof (pension, mortgage interest, post-retirement medical) ----
    const declared = input.declared || {};
    let voluntaryPension = 0;
    let declaredDeductions = 0;
    for (const item of items.filter((i) => i.category === 'taxReliefs')) {
        const claim = pos(declared[item.code]);
        if (item.base !== 'eligibleAmount' || item.method !== 'fixed' || !claim) continue;
        const force = inForce(item, circumstances);
        if (force.some((e) => e.effect === 'not_entitled' || e.effect === 'exempt')) continue;
        const cap = item.maximum > 0 ? item.maximum : Infinity;
        if (item.code === 'KE_PENSION_DEDUCTION') {
            voluntaryPension = r2(claim);
            const allowed = Math.max(0, Math.min(claim, cap - pensionPreTax));
            declaredDeductions += allowed;
            if (claim > allowed) warnings.push(`Pension deductible amount is limited to ${cap.toLocaleString('en')} a month together with NSSF.`);
            lines.push({ code: item.code, label: 'Voluntary pension contribution', section: 'deductions', amount: r2(claim), note: 'Deducted from pay; deductible for tax up to the limit' });
        } else {
            const allowed = Math.min(claim, cap);
            declaredDeductions += allowed;
            lines.push({ code: item.code, label: item.name + ' (claimed)', section: 'relief', amount: r2(allowed), note: 'Reduces taxable pay; not deducted from pay' });
            if (claim > cap) warnings.push(`${item.name} is limited to ${cap.toLocaleString('en')} a month.`);
        }
    }
    const taxablePay = r2(Math.max(0, taxableGross - preTaxTotal - declaredDeductions));

    // ---- Tax and reliefs --------------------------------------------------------------------------
    let taxBeforeRelief = 0;
    const taxItems = items.filter((i) => i.category === 'taxes');
    for (const item of taxItems) {
        const force = inForce(item, circumstances);
        note(item, force);
        if (force.some((e) => e.effect === 'exempt')) {
            lines.push({ code: item.code, label: item.name, section: 'tax', amount: 0, note: 'Exempt: ' + force.map((e) => e.name).join(', ') });
            continue;
        }
        let base = taxablePay;
        for (const e of force) if (e.effect === 'exempt_first') base = Math.max(0, base - pos(e.value));
        for (const e of force) if (e.effect === 'exempt_first') notes.push(`${item.name}: the first ${pos(e.value).toLocaleString('en')} is exempt (${e.name}).`);
        let tax = 0;
        if (item.method === 'progressive') tax = progressiveTax(base, item.bands);
        else if (item.method === 'percent') tax = r2(base * pos(item.rate));
        else if (item.method === 'fixed') tax = r2(pos(item.amount));
        taxBeforeRelief += tax;
        lines.push({ code: item.code, label: item.name + ' before relief', section: 'tax', amount: tax });
    }
    let reliefTotal = 0;
    for (const item of items.filter((i) => i.category === 'taxReliefs')) {
        const force = inForce(item, circumstances);
        if (!(item.method === 'fixed' && item.base === 'taxable') && !(item.method === 'percent' && item.base === 'eligibleAmount')) continue;
        note(item, force);
        if (force.some((e) => e.effect === 'not_entitled' || e.effect === 'exempt')) {
            lines.push({ code: item.code, label: item.name, section: 'relief', amount: 0, note: 'Not given: ' + force.map((e) => e.name).join(', ') });
            continue;
        }
        let credit = 0;
        if (item.method === 'fixed') credit = pos(item.amount);
        else credit = pos(declared[item.code]) * pos(item.rate);
        if (item.maximum > 0 && credit > item.maximum) credit = item.maximum;
        credit = r2(credit);
        if (credit > 0 || item.method === 'fixed') lines.push({ code: item.code, label: item.name, section: 'relief', amount: credit });
        reliefTotal += credit;
    }
    const tax = r2(Math.max(0, taxBeforeRelief - reliefTotal));

    // ---- Other deductions the person has agreed (SACCO, loans...) ---------------------------------
    let otherTotal = 0;
    for (const item of items.filter((i) => i.category === 'otherDeductions')) {
        const given = input.otherDeductions ? input.otherDeductions[item.code] : undefined;
        let value = given !== undefined ? pos(given) : item.method === 'percent' ? pos(item.rate) * grossCash : pos(item.amount);
        value = r2(value);
        if (!value) continue;
        lines.push({ code: item.code, label: item.name, section: 'deductions', amount: value });
        otherTotal += value;
    }
    otherTotal = r2(otherTotal);

    // ---- Deductions that belong to this person alone (check-offs, loans, court orders...), taken after tax ----
    let personalTotal = 0;
    for (const d of input.personalDeductions || []) {
        const value = r2(pos(d.amount));
        if (!value) continue;
        lines.push({ code: d.code, label: d.label, section: 'deductions', amount: value, note: d.note || undefined });
        personalTotal += value;
    }
    personalTotal = r2(personalTotal);

    const net = r2(grossCash - employeeStatutory - tax - voluntaryPension - otherTotal - personalTotal);
    if (grossCash > 0 && net < grossCash * MIN_TAKE_HOME_SHARE) warnings.push('Take-home pay is below one third of gross pay. Deductions must leave at least one third (Employment Act 2007, s.19).');
    if (net < 0) warnings.push('Deductions exceed pay; net pay would be negative.');

    // ---- Employer cost ----------------------------------------------------------------------------
    let employerLevies = 0;
    for (const item of catalogue.filter((i) => i.category === 'employerCosts' && i.enabled && i.mandatory)) {
        const value = r2(pos(item.amount));
        if (!value) continue;
        lines.push({ code: item.code, label: item.name, section: 'employer', amount: value });
        employerLevies += value;
    }
    const employerCost = r2(employerStatutory + employerLevies);
    const totalCostToEmployer = r2(grossCash + noncashValue + employerCost);

    lines.push({ code: 'GROSS', label: 'Gross pay', section: 'earnings', amount: grossCash });
    return {
        lines,
        basic,
        grossCash,
        taxableGross,
        preTaxTotal: r2(preTaxTotal),
        taxablePay,
        taxBeforeRelief: r2(taxBeforeRelief),
        reliefTotal: r2(reliefTotal),
        tax,
        employeeStatutory: r2(employeeStatutory),
        otherDeductionsTotal: otherTotal,
        personalEarningsTotal,
        personalDeductionsTotal: personalTotal,
        net,
        employerCost,
        totalCostToEmployer,
        appliedExceptions: applied,
        warnings,
        notes,
    };
}

/** Circumstances a person could be in, taken from the enabled exceptions of the items a grade uses. */
export function availableCircumstances(grade: PayslipGrade, catalogue: PayslipItem[]): Array<{ code: string; name: string; item: string; effect: ExceptionEffect; evidence: string }> {
    const used = new Set([...(grade.taxCodes || []), ...(grade.deductionCodes || [])]);
    const seen = new Set<string>();
    const out: Array<{ code: string; name: string; item: string; effect: ExceptionEffect; evidence: string }> = [];
    for (const item of catalogue) {
        if (!used.has(item.code) || !item.enabled) continue;
        for (const e of item.exceptions || []) {
            if (!e.enabled || seen.has(e.code)) continue;
            seen.add(e.code);
            out.push({ code: e.code, name: e.name, item: item.name, effect: e.effect, evidence: e.evidence });
        }
    }
    return out;
}
