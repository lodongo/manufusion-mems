import { createHash } from 'node:crypto';
import { HttpError, getDoc, isObj, listDocs, nowIso, str } from './core';
import { orgRoute } from './guards';
import { queryAuditPeriod } from './audit';
import { discoverTransactionActions } from './transactionRegistry';

/**
 * Read-only, bounded governance audit PREVIEW.
 * Reports MUST show coverage; no claim of exhaustive historical data.
 * Publishing and certification require independently approved immutable snapshots.
 */
function period(body: Record<string, unknown>) {
  const currentYear = new Date().getUTCFullYear();
  const year = Number(body.year ?? currentYear);
  if (!Number.isSafeInteger(year) || year < 2000 || year > currentYear) throw new HttpError(400, 'Invalid audit year.');
  const start = str(body.start) || `${year}-01-01`;
  const end = str(body.end) || `${year}-12-31`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || start > end ||
      start.slice(0, 4) !== String(year) || end.slice(0, 4) !== String(year)) throw new HttpError(400, 'Invalid date range within selected year.');
  return { year, start, end };
}
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export const governanceAuditRoutes = {
  'POST /api/org/governance/reports/preview': [
    orgRoute('org.governance.reports.preview', 'ADM.audit', async (ctx) => {
      const { year, start, end } = period(ctx.body);
      const legalEntityId = str(ctx.body.legalEntityId).trim();
      if (legalEntityId) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(legalEntityId)) throw new HttpError(400, 'Invalid legal entity.');
        const entity = await getDoc(`organizations/${ctx.orgId}/structure/${legalEntityId}`);
        if (!entity || str(entity.data.level) !== 'legal_entity') throw new HttpError(404, 'Legal entity does not exist.');
      }
      const endExclusive = new Date(Date.parse(end + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      const [auditPeriod, documents, positions, roles] = await Promise.all([
        queryAuditPeriod(ctx.orgId, start + 'T00:00:00.000Z', endExclusive + 'T00:00:00.000Z'),
        listDocs(`organizations/${ctx.orgId}/governance_documents`),
        listDocs(`organizations/${ctx.orgId}/positions`),
        listDocs(`organizations/${ctx.orgId}/roles`),
      ]);
      const relevant = auditPeriod.events;
      const byOutcome: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const e of relevant) {
        byOutcome[e.outcome || 'unknown'] = (byOutcome[e.outcome || 'unknown'] || 0) + 1;
        byCategory[e.category || 'unknown'] = (byCategory[e.category || 'unknown'] || 0) + 1;
      }
      const matchedDocuments = documents.filter(d => !legalEntityId || str(d.data.legalEntityId) === legalEntityId);
      const actionInventory = discoverTransactionActions();
      const report = {
        title: 'Transaction governance — configuration and historical activity audit (preview)',
        orgId: ctx.orgId, legalEntityId: legalEntityId || null,
        generatedAt: nowIso(), generatedBy: ctx.uid, period: { year, start, end },
        status: 'draft_unverified', publishable: false,
        configuration: {
          registeredPermissionActions: actionInventory.length,
          verifiedPermissionActions: actionInventory.filter(x => x.verification === 'enforcement_verified').length,
          jobRoles: positions.length, securityRoles: roles.length,
          moduleDocuments: matchedDocuments.map(d => ({ id: d.id, module: str(d.data.moduleCode), version: str(d.data.documentVersion), status: isObj(d.data.identity) ? str(d.data.identity.status) : 'unknown' })),
        },
        historicalActivity: { sampledEvents: relevant.length, outcomes: byOutcome, categories: byCategory, periodQueryComplete: auditPeriod.completeWithinCap, cap: auditPeriod.cap },
        limitations: [
          ...(auditPeriod.completeWithinCap ? [] : ['This time-range audit reached its event cap and is not complete; use an asynchronous comprehensive extract.']),
          'Date-range tenant audit events do not yet reconcile against all source transaction collections; absence of events is NOT proof of no activity.',
          'Legacy audit entries do not necessarily identify legal entity; legal-entity filters apply to documentation only until event-level attribution is migrated.',
          'Registry actions are currently catalogued, not independently verified against every enforcing handler.',
          'Effectiveness findings, compliance scoring and publication need complete data and tested governance policies.',
        ],
      };
      return { report, integrityDigest: digest(report) };
    }),
  ],
};
