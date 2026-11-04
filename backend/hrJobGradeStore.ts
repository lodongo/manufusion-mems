/**
 * Job grade storage and read path (leaf module: depends only on core, so education, compensation,
 * positions and the Job Grades routes can all use it without import cycles).
 *
 * Two documents per legal entity:
 *  - DRAFT   organizations/{org}/hr_job_grades/{entity}         edited freely, never read for live decisions
 *  - ACTIVE  organizations/{org}/hr_job_grades_active/{entity}  written only by an approved activation
 *            organizations/{org}/hr_job_grades_active/{entity}/history/vNNNNNN  immutable history
 *
 * Until a legal entity has an ACTIVE policy, readers fall back to the older grade list kept in the
 * education configuration (or the shipped defaults), so nothing stops working at rollout.
 */
import { getDoc, isObj, str } from './core';

/** The part of a grade other modules need (leave eligibility, role mapping, compensation applicability). */
export type LegacyJobGrade = { code: string; rank: number; title: string; description: string; enabled: boolean };

/** A governed job grade. Salary is a monthly basic amount in the legal entity currency. */
export type JobGradeDef = LegacyJobGrade & {
    minSalary: number;
    taxCodes: string[];
    deductionCodes: string[];
};

export const DEFAULT_JOB_GRADES: LegacyJobGrade[] = (
    [
        [1, 'Unskilled / casual', 'Entry-grade manual or casual work (illustrative; contractual classification is configured separately)'],
        [2, 'Semi-skilled', 'Work requiring initial practical training'],
        [3, 'Skilled / operator', 'Qualified operators and skilled trades'],
        [4, 'Technician / associate', 'Technical and professional associate roles'],
        [5, 'Specialist / professional', 'Experienced specialists and professionals'],
        [6, 'Supervisor / team leader', 'Frontline responsibility for teams'],
        [7, 'Manager', 'Departmental or functional management'],
        [8, 'Senior manager / head', 'Senior organizational leadership'],
        [9, 'Executive', 'Executive accountability'],
    ] as Array<[number, string, string]>
).map(([rank, title, description]) => ({ code: 'JG' + String(rank).padStart(2, '0'), rank, title, description, enabled: true }));

export const gradeDraftPath = (org: string, entity: string) => `organizations/${org}/hr_job_grades/${entity}`;
export const gradeActivePath = (org: string, entity: string) => `organizations/${org}/hr_job_grades_active/${entity}`;
export const gradeHistoryPath = (org: string, entity: string, version: number) => `${gradeActivePath(org, entity)}/history/v${String(version).padStart(6, '0')}`;
const educationPath = (org: string, entity: string) => `organizations/${org}/hr_education_config/${entity}`;

const clean = (x: unknown, n: number) => str(x).trim().slice(0, n);

/** Grades kept in the older education configuration, or the shipped defaults when none were saved. */
export async function legacyJobGrades(org: string, entity: string): Promise<LegacyJobGrade[]> {
    const doc = await getDoc(educationPath(org, entity));
    const rows = doc && Array.isArray(doc.data.jobGrades) ? doc.data.jobGrades.filter(isObj) : null;
    if (!rows) return DEFAULT_JOB_GRADES.map((g) => ({ ...g }));
    return rows
        .map((x, i) => ({
            code: clean(x.code, 64),
            rank: Number.isInteger(x.rank) && Number(x.rank) > 0 ? Number(x.rank) : i + 1,
            title: clean(x.title, 150),
            description: clean(x.description, 350),
            enabled: x.enabled !== false,
        }))
        .sort((a, b) => a.rank - b.rank);
}

/** Read a stored governed grade list defensively (drafts and active policies share the shape). */
export function readGrades(raw: unknown): JobGradeDef[] {
    if (!Array.isArray(raw)) return [];
    const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => clean(x, 72)).filter(Boolean) : []);
    return raw
        .filter(isObj)
        .map((x, i) => ({
            code: clean(x.code, 64),
            rank: Number.isInteger(x.rank) && Number(x.rank) > 0 ? Number(x.rank) : i + 1,
            title: clean(x.title, 150),
            description: clean(x.description, 350),
            enabled: x.enabled !== false,
            minSalary: Number.isFinite(Number(x.minSalary)) && Number(x.minSalary) >= 0 ? Number(x.minSalary) : 0,
            taxCodes: strs(x.taxCodes),
            deductionCodes: strs(x.deductionCodes),
        }))
        .sort((a, b) => a.rank - b.rank);
}

/** The ACTIVE governed grades for a legal entity, or null when none were ever approved. */
export async function activeJobGrades(org: string, entity: string): Promise<JobGradeDef[] | null> {
    const doc = await getDoc(gradeActivePath(org, entity));
    if (!doc) return null;
    const grades = readGrades(doc.data.grades);
    return grades.length ? grades : null;
}

export const toLegacy = (g: LegacyJobGrade): LegacyJobGrade => ({ code: g.code, rank: g.rank, title: g.title, description: g.description, enabled: g.enabled });
