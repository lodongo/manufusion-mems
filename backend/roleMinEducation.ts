/**
 * Minimum level of education for a job role. One universal level per role, the same in every legal entity.
 *
 * Each legal entity keeps its own list of education levels, so a universal requirement is stored as a level
 * code and may only be one that is enabled in every legal entity. It is required whenever the role has a job
 * grade in any legal entity.
 *
 * Roles saved before this was universal carry `minEducationByLegalEntity`. That map is read only as a fallback
 * and only when every legal entity agreed on the same level.
 */
import { HttpError, isObj, str } from './core';

export type EducationLevelRef = { code: string; enabled: boolean };
export type EducationLevelOption = { code: string; name: string; rank: number | null };

/** The level a stored role carries: the universal field, or the old per-entity map when all entities agreed. */
export function universalMinEducation(data: Record<string, unknown>): string {
    if (typeof data.minEducation === 'string') return data.minEducation.trim();
    if (!isObj(data.minEducationByLegalEntity)) return '';
    const values = Object.values(data.minEducationByLegalEntity).map((v) => str(v).trim()).filter(Boolean);
    return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : '';
}

/**
 * Levels that are enabled in every legal entity, in rank order. Name comes from the first entity. The rank is
 * shown only when every entity ranks the level the same way.
 */
export function commonEducationLevels(perEntity: Array<Array<{ code: string; name: string; rank: number; enabled: boolean }>>): EducationLevelOption[] {
    if (!perEntity.length) return [];
    const enabled = perEntity.map((levels) => new Map(levels.filter((l) => l.enabled).map((l) => [l.code, l])));
    const out: Array<EducationLevelOption & { order: number }> = [];
    for (const [code, first] of enabled[0]) {
        const all = enabled.map((m) => m.get(code));
        if (all.some((l) => !l)) continue;
        const ranks = all.map((l) => (l as { rank: number }).rank);
        out.push({ code, name: first.name, rank: ranks.every((r) => r === ranks[0]) ? ranks[0] : null, order: Math.min(...ranks) });
    }
    return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map(({ code, name, rank }) => ({ code, name, rank }));
}

/**
 * Validates the minimum education supplied for a role.
 * `supplied` undefined keeps `previous` (older clients that do not send the field).
 */
export async function resolveMinEducation(
    supplied: unknown,
    previous: string,
    hasJobGrade: boolean,
    entities: Array<{ id: string; name: string }>,
    levelsOf: (legalEntityId: string) => Promise<EducationLevelRef[]>,
): Promise<string> {
    if (supplied !== undefined && supplied !== null && typeof supplied !== 'string') throw new HttpError(400, 'Choose one minimum level of education for the role.');
    const level = (typeof supplied === 'string' ? supplied : previous).trim();
    if (!level) {
        if (hasJobGrade) throw new HttpError(400, 'Choose the minimum level of education for this role. It is required when the role has a job grade.');
        return '';
    }
    for (const entity of entities) {
        const levels = await levelsOf(entity.id);
        if (!levels.some((l) => l.enabled && l.code === level)) {
            throw new HttpError(400, `The education level ${level} is not enabled in ${entity.name || entity.id}. Choose a level that is configured in every legal entity.`);
        }
    }
    return level;
}
