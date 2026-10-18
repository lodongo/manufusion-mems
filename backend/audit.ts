import { commitCreates, isObj, nowIso, num, orderDesc, runQuery, str, type Doc, type Fields, type Obj, type RequestMeta } from './core';

// Structured audit trail. Every event is written to the platform-wide
// `audit_events` collection and, when it belongs to a tenant, also to
// `organizations/{orgId}/audit_events` so tenants only ever read their own.

export type Outcome = 'success' | 'failure' | 'denied' | 'blocked';

export interface Actor {
    uid: string;
    email: string;
    role?: string;
    orgId?: string;
}

export interface AuditInput {
    category: string;
    action: string;
    outcome?: Outcome;
    actor?: Actor | null;
    target?: { type?: string; id?: string; label?: string };
    details?: string;
    route?: string;
    orgId?: string;
    meta?: RequestMeta | null;
    client?: Obj | null;
    source?: 'server' | 'client';
    durationMs?: number;
}

export function buildAudit(input: AuditInput): { orgId: string; data: Fields } {
    const orgId = input.orgId || input.actor?.orgId || '';
    const meta = input.meta;
    return {
        orgId,
        data: {
            at: nowIso(),
            category: input.category.slice(0, 40),
            action: input.action.slice(0, 100),
            outcome: input.outcome ?? 'success',
            source: input.source ?? 'server',
            actorUid: input.actor?.uid ?? '',
            actorEmail: input.actor?.email || 'anonymous',
            actorRole: input.actor?.role ?? '',
            orgId,
            targetType: (input.target?.type ?? '').slice(0, 60),
            targetId: (input.target?.id ?? '').slice(0, 120),
            targetLabel: (input.target?.label ?? '').slice(0, 200),
            details: (input.details ?? '').slice(0, 1000),
            route: (input.route ?? '').slice(0, 200),
            durationMs: input.durationMs ?? null,
            ip: meta?.ip ?? '',
            userAgent: meta?.userAgent ?? '',
            country: meta?.country ?? '',
            city: meta?.city ?? '',
            language: meta?.language ?? '',
            client: input.client ?? {},
        },
    };
}

// Categories copied to each user's own activity trail (shown to them in plain language).
const PERSONAL_CATEGORIES = new Set(['auth', 'data', 'registration', 'navigation', 'form', 'admin']);

export async function audit(inputs: AuditInput[]): Promise<void> {
    if (!inputs.length) return;
    try {
        const items: Array<{ collection: string; data: Fields }> = [];
        for (const input of inputs) {
            const built = buildAudit(input);
            items.push({ collection: 'audit_events', data: built.data });
            if (built.orgId) items.push({ collection: `organizations/${built.orgId}/audit_events`, data: built.data });
            const actorUid = str(built.data.actorUid);
            if (actorUid && /^[A-Za-z0-9]{6,128}$/.test(actorUid) && PERSONAL_CATEGORIES.has(input.category)) {
                items.push({ collection: `users/${actorUid}/activity`, data: built.data });
            }
        }
        await commitCreates(items);
    } catch (err) {
        console.error('SECURITY_AUDIT_WRITE_FAILED', JSON.stringify({ actions: inputs.map((i) => i.action).slice(0, 10), count: inputs.length, message: err instanceof Error ? err.message.slice(0, 250) : 'unknown' }));
    }
}

export function auditOut(doc: Doc) {
    const d = doc.data;
    const client = isObj(d.client) ? d.client : {};
    return {
        id: doc.id,
        at: str(d.at),
        category: str(d.category),
        action: str(d.action),
        outcome: str(d.outcome),
        source: str(d.source),
        actorEmail: str(d.actorEmail),
        actorRole: str(d.actorRole),
        orgId: str(d.orgId),
        targetType: str(d.targetType),
        target: str(d.targetLabel),
        details: str(d.details),
        route: str(d.route),
        durationMs: num(d.durationMs),
        ip: str(d.ip),
        country: str(d.country),
        userAgent: str(d.userAgent),
        device: [str(client.platform), str(client.screen), str(client.timezone), str(client.connection)].filter(Boolean).join(' · '),
        sessionId: str(client.sessionId),
    };
}

export async function queryAudit(limit: number, orgId = '') {
    const docs = await runQuery(
        { from: [{ collectionId: 'audit_events' }], orderBy: orderDesc('at'), limit },
        orgId ? `organizations/${orgId}` : ''
    );
    return docs.map(auditOut);
}

/**
 * Paginated historical tenant audit retrieval, bounded for synchronous reports.
 * Firestore offset pagination is intentionally limited; no report may claim full
 * coverage when the cap is reached. Longer reports need async export jobs.
 */
export async function queryAuditPeriod(orgId: string, start: string, endExclusive: string, cap = 10000) {
    const batchSize = 500;
    const events: ReturnType<typeof auditOut>[] = [];
    let exhausted = false;
    for (let offset = 0; offset < cap; offset += batchSize) {
        const docs = await runQuery({
            from: [{ collectionId: 'audit_events' }],
            where: { compositeFilter: { op: 'AND', filters: [
                { fieldFilter: { field: { fieldPath: 'at' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: start } } },
                { fieldFilter: { field: { fieldPath: 'at' }, op: 'LESS_THAN', value: { stringValue: endExclusive } } },
            ] } },
            orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
            limit: batchSize, offset,
        }, `organizations/${orgId}`);
        events.push(...docs.map(auditOut));
        if (docs.length < batchSize) { exhausted = true; break; }
    }
    return { events, completeWithinCap: exhausted, cap };
}
