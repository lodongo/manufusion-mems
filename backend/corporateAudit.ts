import { audit } from './audit';
import type { OrgContext } from './guards';

/** Audit trail for corporate governance, financial-home and structure policy changes. */
export async function corporateAudit(ctx: OrgContext, action: string, version: number, details = '') {
    await audit([{ category: 'governance', action: 'corporate.' + action, actor: ctx.actor, meta: ctx.meta, orgId: ctx.orgId,
        target: { type: 'corporate_policy', id: action.split('.')[0], label: action.split('.')[0] },
        details: ('version=' + version + (details ? ' ' + details : '')).slice(0, 300) }]);
}
