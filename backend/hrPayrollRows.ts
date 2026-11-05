/**
 * Payroll rows: every employee of one legal entity with the job role they hold and the grade that role has in that
 * legal entity. Pure (no I/O) so the rules can be tested on their own.
 *
 * employee -> primary job role (positionCode) -> role.jobGradeByLegalEntity[legalEntity] -> grade
 * The grade then carries the pay package (pay model, allowances, benefits, taxes, deductions, minimum salary).
 */
import { isObj, str } from './core';
import { legalEntitiesOf } from './hrEducationConfig';

export type PayrollProblem = '' | 'no_role' | 'several_roles' | 'role_missing' | 'no_grade' | 'grade_missing' | 'grade_disabled';
export const PROBLEM_TEXT: Record<Exclude<PayrollProblem, ''>, string> = {
    no_role: 'No primary job role',
    several_roles: 'Several primary job roles',
    role_missing: 'Job role no longer exists',
    no_grade: 'The job role has no grade in this legal entity',
    grade_missing: 'The grade no longer exists',
    grade_disabled: 'The grade is switched off',
};
export type PayrollGrade = { code: string; title: string; enabled: boolean; minSalary: number };
export type PayrollRow = {
    uid: string;
    name: string;
    employeeNumber: string;
    status: string;
    roleCode: string;
    roleTitle: string;
    gradeCode: string;
    gradeTitle: string;
    minSalary: number;
    /** The draft basic monthly salary entered for the employee, or null when none was entered yet. */
    basic: number | null;
    problem: PayrollProblem;
};
export type Unplaced = { uid: string; name: string; employeeNumber: string; reason: 'no_entity' | 'several_entities' };
type Doc = { id: string; data: Record<string, unknown> };

const nameOf = (d: Record<string, unknown>) => [str(d.firstName), str(d.lastName)].filter(Boolean).join(' ').trim();

/** Applicants and disabled accounts are not employees on payroll. */
export const onPayroll = (data: Record<string, unknown>) => str(data.role) !== 'applicant' && str(data.status) !== 'disabled';

export function buildPayrollRows(input: {
    entityId: string;
    users: Doc[];
    nodes: Map<string, Record<string, unknown>>;
    positions: Map<string, Record<string, unknown>>;
    grades: PayrollGrade[];
    salaries: Record<string, unknown>;
}): { rows: PayrollRow[]; unplaced: Unplaced[] } {
    const grades = new Map(input.grades.map((g) => [g.code, g]));
    const rows: PayrollRow[] = [];
    const unplaced: Unplaced[] = [];
    for (const u of input.users) {
        if (!onPayroll(u.data)) continue;
        const found = legalEntitiesOf(input.nodes, u.data);
        const who = { uid: u.id, name: nameOf(u.data) || str(u.data.employeeNumber) || 'Unnamed employee', employeeNumber: str(u.data.employeeNumber) };
        if (found.size === 0) {
            unplaced.push({ ...who, reason: 'no_entity' });
            continue;
        }
        if (found.size > 1) {
            unplaced.push({ ...who, reason: 'several_entities' });
            continue;
        }
        if (!found.has(input.entityId)) continue; // belongs to another legal entity

        const primaries = (Array.isArray(u.data.assignments) ? u.data.assignments.filter(isObj) : []).filter((a) => str(a.type) === 'primary' && str(a.positionCode));
        const codes = [...new Set(primaries.map((a) => str(a.positionCode)))];
        let problem: PayrollProblem = '';
        let roleCode = '';
        let roleTitle = '';
        let gradeCode = '';
        if (codes.length === 0) problem = 'no_role';
        else if (codes.length > 1) problem = 'several_roles';
        else {
            roleCode = codes[0];
            const role = input.positions.get(roleCode);
            if (!role) problem = 'role_missing';
            else {
                roleTitle = str(role.title) || roleCode;
                const map = isObj(role.jobGradeByLegalEntity) ? role.jobGradeByLegalEntity : {};
                gradeCode = str(map[input.entityId]);
                if (!gradeCode) problem = 'no_grade';
                else if (!grades.has(gradeCode)) problem = 'grade_missing';
                else if (!grades.get(gradeCode)!.enabled) problem = 'grade_disabled';
            }
        }
        const grade = grades.get(gradeCode);
        const entered = input.salaries[u.id];
        rows.push({
            ...who,
            status: str(u.data.status) || 'active',
            roleCode,
            roleTitle,
            gradeCode: grade ? gradeCode : '',
            gradeTitle: grade?.title || '',
            minSalary: grade?.minSalary || 0,
            basic: typeof entered === 'number' && Number.isFinite(entered) && entered >= 0 ? entered : null,
            problem,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.employeeNumber.localeCompare(b.employeeNumber));
    unplaced.sort((a, b) => a.name.localeCompare(b.name));
    return { rows, unplaced };
}

/** A salary below the grade minimum. Not flagged when the grade has no minimum set (nothing to compare with). */
export const belowMinimum = (basic: number | null, minimum: number) => basic !== null && minimum > 0 && basic < minimum;
