import { HttpError } from './core';
import { hasPerm, type OrgContext } from './guards';
import { canAt, nodePath } from './access';
import { allowedNodeIds } from './positions';
import { record } from './structure';

// ---------------------------------------------------------------------------
// Location-bound permission checks (chart of authority) and change audits.
//
// A permission only counts where it applies:
//   job role     -> at the node where the job role is held and everything below it
//   direct role  -> within the person's own scope (assignments; view-only extra scopes count for reads only)
// Organization super administrators pass every check.
// ---------------------------------------------------------------------------

/** Activities used by the safety, asset-utility and maintenance-activity screens. */
export const PERMS = {
    riskView: ['SAF.risk.view', 'SAF.risk.assess', 'SAF.view'],
    riskAssess: ['SAF.risk.assess', 'SAF.edit'],
    utilitiesView: ['AST.utilities.view', 'AST.utilities.edit', 'AST.view'],
    utilitiesEdit: ['AST.utilities.edit', 'AST.edit'],
    activitiesView: ['MNT.activities.view', 'MNT.activities.edit', 'MNT.view'],
    activitiesEdit: ['MNT.activities.edit', 'MNT.admin'],
    matrixView: ['SAF.view', 'SAF.risk.view', 'SAF.risk.assess', 'SAF.configure', 'SAF.admin'],
    matrixConfigure: ['SAF.configure', 'SAF.admin'],
};

export type AccessMode = 'read' | 'write';

/** True when the user holds one of `perms` at the node `nodeId`. */
export async function allowedAt(ctx: OrgContext, perms: string[], nodeId: string, mode: AccessMode): Promise<boolean> {
    if (ctx.role === 'org_super_admin') return true;
    if (!nodeId) return false;
    const path = await nodePath(ctx.orgId, nodeId);
    if (!path.length || path[path.length - 1] !== nodeId) return false;
    const scope = await allowedNodeIds(ctx.orgId, ctx.me, mode === 'read');
    return perms.some((perm) => canAt(ctx, perm, path, scope));
}

/** Throws 403 unless the user holds one of `perms` at the node `nodeId`. */
export async function requireAt(ctx: OrgContext, perms: string[], nodeId: string, mode: AccessMode, message: string): Promise<void> {
    if (!(await allowedAt(ctx, perms, nodeId, mode))) throw new HttpError(403, message);
}

/** True when the user holds one of `perms` anywhere (job or direct role). */
export function holdsAnywhere(ctx: OrgContext, perms: string[]): boolean {
    return ctx.role === 'org_super_admin' || perms.some((perm) => hasPerm(ctx.permissions, perm));
}

/** Organization-wide configuration: only rights from the person's own direct security role count. */
export function holdsDirect(ctx: OrgContext, perms: string[]): boolean {
    return ctx.role === 'org_super_admin' || perms.some((perm) => hasPerm(ctx.directPermissions, perm));
}

/** Change audit (category "data") with a bounded details text. */
export function audited(ctx: OrgContext, action: string, target: string, details: string | Record<string, unknown>) {
    const text = typeof details === 'string' ? details : JSON.stringify(details);
    return record(ctx, action, target, text.length > 4000 ? `${text.slice(0, 3990)}…` : text);
}

/** JSON with object keys sorted, so stored and submitted records compare equal regardless of field order. */
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** Codes added, removed and changed between two keyed lists, for audit details. */
export function diffByKey<T>(before: T[], after: T[], key: (item: T) => string) {
    const b = new Map(before.map((x) => [key(x), stableJson(x)]));
    const a = new Map(after.map((x) => [key(x), stableJson(x)]));
    return {
        added: [...a.keys()].filter((k) => !b.has(k)),
        removed: [...b.keys()].filter((k) => !a.has(k)),
        changed: [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k)),
    };
}
