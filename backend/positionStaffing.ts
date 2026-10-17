/** The approved staffing configuration of a job role at each actual organizational unit.
 * A disabled unit has no approved positions; required=0 is permitted before headcount approval.
 * This is establishment planning, not a change to user security rights.
 */
export interface StaffingUnit { id: string; level: string; tier: number; code: string; name: string; status?: string; roleCodes?: string[] }
export interface RoleStaffingRow { nodeId: string; enabled: boolean; required: number }
export interface RoleStaffingCount { nodeId: string; filled: number; temporary: number; employees: Array<{ name: string; type: string }> }
export function matchingRoleNodes(level: string, nodes: StaffingUnit[]): StaffingUnit[] {
    if (!level) return [];
    const upper = /^upper:(\d)$/.exec(level);
    return nodes.filter(n => upper ? n.level === 'group' && n.tier === Number(upper[1]) : n.level === level)
        .sort((a,b) => a.code.localeCompare(b.code));
}
export function staffingSummary(rows: RoleStaffingRow[], counts: RoleStaffingCount[]) {
    const byId = new Map(counts.map(c => [c.nodeId,c]));
    return rows.reduce((acc,row) => {
        if (!row.enabled) return acc;
        const filled = byId.get(row.nodeId)?.filled ?? 0;
        acc.required += row.required;
        acc.filled += filled;
        acc.vacant += Math.max(0,row.required-filled);
        acc.surplus += Math.max(0,filled-row.required);
        acc.enabledUnits++;
        return acc;
    }, { required:0, filled:0, vacant:0, surplus:0, enabledUnits:0 });
}
export function employmentCoverage(assignments: Array<{ positionCode:string;nodeId:string;type:string;startsOn?:string;endsOn?:string }>, roleCode:string, today:string) {
    return assignments.filter((a,i) => a.positionCode === roleCode &&
        (i === 0 || a.type === 'primary' || (['acting','extended_function','secondment'].includes(a.type) &&
        !!a.startsOn && !!a.endsOn && a.startsOn <= today && a.endsOn >= today)));
}
