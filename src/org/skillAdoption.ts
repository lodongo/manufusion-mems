/** Job-role skill inheritance is an explicit one-time adoption, not an implicit
 * change to other roles when a manager's skill list is edited later.
 * Job roles contain skill codes, never security permissions.
 */
export interface SkillSourceRole {
    code: string;
    title: string;
    parentCode: string;
    coreSkills?: string[];
}

/** Identify direct parent first and then the reporting ancestors.
 * Defensive visited-set handles stale/corrupt hierarchy data without looping.
 */
export function parentSkillSources(parentCode: string, roles: SkillSourceRole[], excludeCode = ''): SkillSourceRole[] {
    const byCode = new Map(roles.map((role) => [role.code, role]));
    const sources: SkillSourceRole[] = [];
    const visited = new Set<string>([excludeCode]);
    let cursor = parentCode;
    while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const found = byCode.get(cursor);
        if (!found) break;
        sources.push(found);
        cursor = found.parentCode;
    }
    return sources;
}

export function adoptSkillCodes(existing: string[], proposed: string[], availableCodes: ReadonlySet<string>): string[] {
    const result = new Set(existing);
    for (const code of proposed) {
        if (code && availableCodes.has(code)) result.add(code);
    }
    return [...result];
}
