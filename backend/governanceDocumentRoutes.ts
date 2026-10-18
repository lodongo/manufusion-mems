import { HttpError, getDoc, listDocs, nowIso, str, writeDoc, isObj } from './core';
import { orgRoute } from './guards';
import { validateGovernanceDocument, type GovernanceDocumentRecord } from './governanceDocumentation';

/**
 * Draft-only tenant/legal-entity governance documentation.
 * These records DO NOT authorize transactions or activate governance policies.
 */
const ROOT = (org: string) => `organizations/${org}/governance_documents`;
const KEY = /^[A-Z0-9_]{2,20}$/;
const NODE = /^[a-zA-Z0-9_-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export const governanceDocumentRoutes = {
  'POST /api/org/governance/documents/list': [
    orgRoute('org.governance.documents.list', 'ADM.workflows', async (ctx) => {
      const legalEntityId = str(ctx.body.legalEntityId).trim();
      if (!NODE.test(legalEntityId)) throw new HttpError(400, 'Select a legal entity.');
      const entity = await getDoc(`organizations/${ctx.orgId}/structure/${legalEntityId}`);
      if (!entity || str(entity.data.level) !== 'legal_entity') throw new HttpError(404, 'Legal entity not found.');
      const documents = (await listDocs(ROOT(ctx.orgId))).filter((d) => str(d.data.legalEntityId) === legalEntityId);
      return { items: documents.map(d => ({ id: d.id, ...d.data })) };
    }),
  ],
  'POST /api/org/governance/documents/draft': [
    orgRoute('org.governance.documents.draft', 'ADM.workflows', async (ctx) => {
      const legalEntityId = str(ctx.body.legalEntityId).trim();
      const moduleCode = str(ctx.body.moduleCode).trim().toUpperCase();
      const documentVersion = str(ctx.body.documentVersion).trim();
      if (!NODE.test(legalEntityId) || !KEY.test(moduleCode) || !VERSION.test(documentVersion)) throw new HttpError(400, 'Invalid legal entity, module or version.');
      const entity = await getDoc(`organizations/${ctx.orgId}/structure/${legalEntityId}`);
      if (!entity || str(entity.data.level) !== 'legal_entity') throw new HttpError(404, 'Legal entity not found.');
      const modules = isObj(ctx.org.data.modules) ? ctx.org.data.modules : {};
      if (modules[moduleCode] !== true) throw new HttpError(409, 'Module must be enabled for this organization.');
      const id = `${legalEntityId}__${moduleCode}__${documentVersion.replace(/\./g, '_')}`;
      const existing = await getDoc(`${ROOT(ctx.orgId)}/${id}`);
      if (existing) throw new HttpError(409, 'This legal-entity module document version already exists.');
      const record: GovernanceDocumentRecord = {
        identity: {
          tenantId: ctx.orgId, legalEntityId, moduleCode, documentVersion,
          platformRegistryVersion: 'DISCOVERY-1', configurationVersion: 'UNCONFIGURED',
          configurationDigest: 'UNCONFIGURED', jurisdiction: 'PENDING',
          functionalCurrency: 'XXX', status: 'draft',
        },
        inheritedConfigurationIds: [], overrides: [], transactionActionIds: [],
        coaRuleIds: [], workflowIds: [], securityRoleIds: [], sodRuleIds: [], changes: [],
      };
      const warnings = validateGovernanceDocument(record);
      // The system intentionally allows incomplete DRAFT documents, not activation.
      await writeDoc(`${ROOT(ctx.orgId)}/${id}`, {
        ...record, legalEntityId, moduleCode, documentVersion,
        createdAt: nowIso(), createdBy: ctx.uid, warnings,
      }, { exists: false });
      return { id, status: 'draft', warnings };
    }),
  ],
};
