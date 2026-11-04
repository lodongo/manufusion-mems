/**
 * Minimum level of education for a job role, per legal entity.
 *
 * Education levels belong to a legal entity (each entity ranks its own levels), so the requirement is stored
 * the same way as the job grade: { [legalEntityId]: levelCode }. It is required wherever the role has a job
 * grade, and every level must be an enabled level of that legal entity.
 */
import { HttpError, isObj, str } from './core';

export type EducationLevelRef = { code: string; enabled: boolean };

export async function resolveMinEducation(
    supplied: Record<string, unknown>,
    jobGradeByLegalEntity: Record<string, string>,
    entities: Array<{ id: string; name: string }>,
    levelsOf: (legalEntityId: string) => Promise<EducationLevelRef[]>,
): Promise<Record<string, string>> {
    if (!isObj(supplied)) throw new HttpError(400, 'Minimum education must be mapped by legal entity.');
    const known = new Map(entities.map((e) => [e.id, e.name]));
    const out: Record<string, string> = {};
    for (const [legalEntityId, value] of Object.entries(supplied)) {
        const level = str(value).trim();
        if (!level) continue;
        if (!known.has(legalEntityId)) throw new HttpError(400, 'Unknown legal entity in role minimum education.');
        const levels = await levelsOf(legalEntityId);
        if (!levels.some((l) => l.enabled && l.code === level)) throw new HttpError(400, 'Choose an enabled education level configured for the selected legal entity.');
        out[legalEntityId] = level;
    }
    for (const legalEntityId of Object.keys(jobGradeByLegalEntity)) {
        if (!out[legalEntityId]) throw new HttpError(400, `Choose the minimum level of education for this role in ${known.get(legalEntityId) || legalEntityId}. It is required wherever the role has a job grade.`);
    }
    return out;
}
