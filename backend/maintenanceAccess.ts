import { HttpError, getDoc, isObj, nowIso, str } from './core';
import { canAt, scopeOf } from './access';
import type { OrgContext } from './guards';
import { object, rows, texts } from './maintenanceDomain';

export async function requireMaintenanceRole(ctx: OrgContext, gate: string, path: string[]) {
    const settings = await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
    const role = str(object(settings?.data.approverRoles)[gate]);
    if (!role) throw new HttpError(409, `Configure ${gate} in Maintenance Workflows before proceeding.`);
    const today = nowIso().slice(0, 10);
    if (
        !rows(ctx.me.data.assignments).some(
            (a) =>
                a.positionCode === role &&
                path.includes(str(a.nodeId)) &&
                (!str(a.startsOn) || str(a.startsOn) <= today) &&
                (!str(a.endsOn) || str(a.endsOn) >= today),
        )
    )
        throw new HttpError(403, `The configured ${gate} organizational job role is required at this location.`);
    return { role, version: Number(settings?.data.version) || 0 };
}
export async function maintenancePermission(ctx: OrgContext, permission: string, path: string[]) {
    if (!isObj(ctx.org.data.modules) || ctx.org.data.modules.MNT !== true)
        throw new HttpError(403, 'Maintenance Management is not enabled.');
    if (!canAt(ctx, permission, path, await scopeOf(ctx))) throw new HttpError(403, `${permission} is required at this location.`);
}
export const maintenancePath = (d: { path?: unknown }) => texts(d.path);
