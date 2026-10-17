import { getDoc, isObj, listDocs, str } from './core';
import { orgRoute } from './guards';

export interface SetupProgress {
    ready: boolean;
    phase: 'organization' | 'site' | 'roles' | 'ready';
    nextRoute: string;
    counts: Record<string, number>;
    basicPercent: number;
    extendedPercent: number;
    assetConfigured: boolean;
}

/** Multi-tenant-safe snapshot; never accept an organization identifier from the browser. */
export async function readOrgSetupProgress(orgId: string): Promise<SetupProgress> {
    const [nodes, roles] = await Promise.all([
        listDocs(`organizations/${orgId}/structure`),
        listDocs(`organizations/${orgId}/positions`),
    ]);
    const count = (level: string) => nodes.filter((n) => str(n.data.level) === level && str(n.data.status) !== 'inactive').length;
    const assetConfigured = nodes.some((n) => str(n.data.level) === 'work_center'
        && isObj(n.data.attributes) && Boolean(str(n.data.attributes.assetTag)));
    const counts: Record<string, number> = {
        legalEntities: count('legal_entity'),
        sites: count('site'),
        jobRoles: roles.length,
        departments: count('department'),
        costCenters: count('cost_center'),
        equipmentUnits: count('work_center'),
        assemblies: count('assembly'),
        configuredAssets: assetConfigured ? 1 : 0,
    };
    const phase = !counts.legalEntities ? 'organization' : !counts.sites ? 'site' : !counts.jobRoles ? 'roles' : 'ready';
    const checks = [
        counts.legalEntities > 0, counts.sites > 0, counts.jobRoles > 0,
        counts.departments > 0, counts.costCenters > 0, assetConfigured,
    ];
    return {
        ready: phase === 'ready',
        phase,
        nextRoute: phase === 'roles' ? 'organization_admin/positions' : 'organization_admin/structure',
        counts,
        basicPercent: Math.round(checks.slice(0, 3).filter(Boolean).length / 3 * 100),
        extendedPercent: Math.round(checks.filter(Boolean).length / checks.length * 100),
        assetConfigured,
    };
}

export const setupProgressRoutes = {
    'POST /api/org/setup/progress': [
        orgRoute('org.setup.progress', null, async (ctx) => readOrgSetupProgress(ctx.orgId)),
    ],
};
