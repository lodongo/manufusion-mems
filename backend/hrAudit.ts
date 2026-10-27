/**
 * HR business audit trail (in addition to the per-request API audit written by the route guard).
 * Records tenant, actor, subject employee and action, never personal or pay data: details are restricted to
 * counts, codes, versions and decisions supplied by the caller.
 */
import { audit } from './audit';
import type { OrgContext } from './guards';

const SAFE = /^[A-Za-z0-9 _.:,;/()#=+\-]{0,300}$/;

export async function hrAudit(ctx: OrgContext, action: string, subject: { type: string; id: string }, details = '') {
    const text = SAFE.test(details) ? details : '';
    await audit([
        {
            category: 'hr',
            action: 'hr.' + action,
            actor: ctx.actor,
            meta: ctx.meta,
            orgId: ctx.orgId,
            target: { type: subject.type, id: subject.id.slice(0, 128), label: subject.id.slice(0, 128) },
            details: text,
        },
    ]);
}

/** Reads of another employee's record (self-service reads are covered by the API audit). */
export async function hrAuditRead(ctx: OrgContext, area: string, subjectUid: string, scope: string) {
    if (subjectUid === ctx.uid) return;
    await hrAudit(ctx, 'read.' + area, { type: 'employee', id: subjectUid }, 'scope=' + scope);
}
