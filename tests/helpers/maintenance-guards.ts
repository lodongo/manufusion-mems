export * from '../../backend/guards.ts?actual';
import { hasPerm } from '../../backend/guards.ts?actual';
import { HttpError } from './maintenance-fixture';
/** Exercise business handlers after authentication; the normal guard has its own regression suite. */
export function orgRoute(name: string, permission: string | null, fn: (ctx: any) => Promise<any>) {
    return async (ctx: any) => {
        if (permission && ctx.role !== 'org_super_admin' && !hasPerm(ctx.permissions, permission))
            throw new HttpError(403, 'Fixture permission denied');
        return fn(ctx);
    };
}
