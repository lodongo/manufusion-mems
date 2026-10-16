import { getDoc, str } from './core';
import { hasPerm, type OrgContext } from './guards';
import { allowedNodeIds } from './positions';
import { col } from './structure';

// ---------------------------------------------------------------------------
// Access model
//   Job role (ROL_xxx)   who a person is in the organization chart
//   Assignment           where they hold that job role (group, legal entity or site)
//   Security role        what they may do in MEMS (a bundle of activity permissions)
//   Role mapping         job role -> security role(s); holding the job role at a place grants the
//                        security role's permissions there (and below), nowhere else
//   Direct role          a security role given to the person directly (exceptions, optional expiry);
//                        it applies everywhere inside the person's scope
// canAt() is the single check modules use for an activity on a record at a location.
// ---------------------------------------------------------------------------

export type Scope = Set<string> | 'all';

export async function scopeOf(ctx: OrgContext): Promise<Scope> {
    if (ctx.role === 'org_super_admin') return 'all';
    return allowedNodeIds(ctx.orgId, ctx.me);
}

/** Ids from the top of the organization design down to the node (inclusive). */
export async function nodePath(orgId: string, id: string): Promise<string[]> {
    const out: string[] = [];
    let current = id;
    for (let i = 0; i < 14 && current && current !== 'root'; i++) {
        const doc = await getDoc(`${col(orgId)}/${current}`);
        if (!doc) break;
        out.unshift(doc.id);
        current = str(doc.data.parentId);
    }
    return out;
}

/** May the user perform `perm` on a record located at the end of `path`? */
export function canAt(ctx: OrgContext, perm: string, path: string[], scope: Scope): boolean {
    if (ctx.role === 'org_super_admin') return true;
    const target = path[path.length - 1] ?? '';
    if (hasPerm(ctx.directPermissions, perm) && (scope === 'all' || scope.has(target))) return true;
    return ctx.grants.some((g) => hasPerm(g.permissions, perm) && path.includes(g.nodeId));
}

/** Does the user hold `perm` anywhere (for menus and buttons)? */
export const canAnywhere = (ctx: OrgContext, perm: string) => ctx.role === 'org_super_admin' || hasPerm(ctx.permissions, perm);
