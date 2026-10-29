import { HttpError, getDoc, isObj, nowIso, str } from './core';
import { canAt, scopeOf } from './access';
import type { OrgContext } from './guards';
import { object, rows, texts } from './maintenanceDomain';
import { bypass } from './testModeCore';

export async function requireMaintenanceRole(ctx: OrgContext, gate: string, path: string[]) {
    const settings = await getDoc(`organizations/${ctx.orgId}/maintenance_workflow_settings/default`);
    const role = str(object(settings?.data.approverRoles)[gate]);
    // Configuration is never relaxed. The platform testing override only relaxes HOLDING the configured job role.
    if (!role) throw new HttpError(409, `Configure ${gate} in Maintenance Workflows before proceeding.`);
    const today = nowIso().slice(0, 10);
    if (
        !rows(ctx.me.data.assignments).some(
            (a) =>
                a.positionCode === role &&
                path.includes(str(a.nodeId)) &&
                (!str(a.startsOn) || str(a.startsOn) <= today) &&
                (!str(a.endsOn) || str(a.endsOn) >= today),
        ) &&
        !bypass(ctx, `mnt.gate.${gate}`)
    )
    {
        // Name the job role so the person knows what to ask for. Super admins are not exempt (maker-checker).
        const position = await getDoc(`organizations/${ctx.orgId}/positions/${role}`);
        const title = str(position?.data.title) || str(position?.data.name);
        const label = title ? `${title} (${role})` : role;
        const admin = ctx.role === 'org_super_admin'
            ? ' Organization super admins are not exempt: assign yourself this job role at the equipment\'s location (Users › Job roles and scope), or use the platform testing override in development.'
            : '';
        throw new HttpError(403, `The configured ${gate} organizational job role ${label} is required at this location.${admin}`);
    }
    return { role, version: Number(settings?.data.version) || 0 };
}
export async function maintenancePermission(ctx: OrgContext, permission: string, path: string[]) {
    if (!isObj(ctx.org.data.modules) || ctx.org.data.modules.MNT !== true)
        throw new HttpError(403, 'Maintenance Management is not enabled.');
    if (!canAt(ctx, permission, path, await scopeOf(ctx))) throw new HttpError(403, `${permission} is required at this location.`);
}
export const maintenancePath = (d: { path?: unknown }) => texts(d.path);
