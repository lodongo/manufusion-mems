/**
 * Legal-entity module governance documentation contracts.
 * Documentation reflects approved effective policy; it NEVER confers authority
 * or activates a module. Platform schema and legal-entity adoption are separate.
 */
export type DocumentationStatus = 'draft' | 'in_review' | 'approved' | 'active' | 'superseded' | 'archived';

export interface GovernanceDocumentIdentity {
  tenantId: string;
  legalEntityId: string;
  moduleCode: string;
  documentVersion: string;
  platformRegistryVersion: string;
  configurationVersion: string;
  configurationDigest: string;
  jurisdiction: string;
  functionalCurrency: string;
  status: DocumentationStatus;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface GovernanceDocumentChange {
  changeId: string;
  section: string;
  ruleIds: string[];
  before: string;
  after: string;
  reason: string;
  risk: string;
  affectedTransactionIds: string[];
  pendingImpactEvidenceId: string;
  simulationEvidenceId: string;
  proposalBy: string;
  approvedBy: string;
  approvedAt?: string;
}

export interface GovernanceDocumentRecord {
  identity: GovernanceDocumentIdentity;
  inheritedConfigurationIds: string[];
  overrides: Array<{ parentRuleId: string; overrideRuleId: string; approvalEvidenceId: string }>;
  transactionActionIds: string[];
  coaRuleIds: string[];
  workflowIds: string[];
  securityRoleIds: string[];
  sodRuleIds: string[];
  changes: GovernanceDocumentChange[];
  platformCertificationId?: string;
  legalEntityAcceptanceId?: string;
  migrationEvidenceId?: string;
  recoveryCheckpointId?: string;
}

const nonempty = (value: string) => typeof value === 'string' && value.trim().length > 0;
const versionPattern = /^\d+\.\d+\.\d+$/;

/** Structural gate only; runtime CoA and permission enforcement is separate. */
export function validateGovernanceDocument(document: GovernanceDocumentRecord): string[] {
  const { identity, changes } = document;
  const errors: string[] = [];
  for (const field of ['tenantId', 'legalEntityId', 'moduleCode', 'platformRegistryVersion', 'configurationVersion', 'configurationDigest', 'jurisdiction'] as const) {
    if (!nonempty(identity[field])) errors.push('Missing document identity: ' + field);
  }
  if (!versionPattern.test(identity.documentVersion)) errors.push('Document version must use major.minor.patch');
  if (!/^[A-Z]{3}$/.test(identity.functionalCurrency)) errors.push('Functional currency must be ISO-4217-style three-letter code');
  if (identity.effectiveFrom && Number.isNaN(Date.parse(identity.effectiveFrom))) errors.push('Invalid effectiveFrom');
  if (identity.effectiveTo && (!identity.effectiveFrom || Date.parse(identity.effectiveTo) <= Date.parse(identity.effectiveFrom))) errors.push('Invalid effective window');
  const ids = new Set<string>();
  for (const change of changes) {
    if (!nonempty(change.changeId) || ids.has(change.changeId)) errors.push('Missing or duplicate change ID');
    ids.add(change.changeId);
    if (!nonempty(change.before) || !nonempty(change.after) || !nonempty(change.reason)) errors.push('Missing before, after or reason for change ' + change.changeId);
    if (change.proposalBy && change.approvedBy && change.proposalBy === change.approvedBy) errors.push('Governance changes require independent approval: ' + change.changeId);
  }
  if (identity.status === 'active') {
    if (!identity.effectiveFrom) errors.push('Active documents need an effective start');
    if (!document.platformCertificationId || !document.legalEntityAcceptanceId) errors.push('Active governance requires platform certification and legal-entity acceptance');
    if (!document.migrationEvidenceId || !document.recoveryCheckpointId) errors.push('Active governance requires migration and recovery evidence');
    if (changes.some(x => !x.approvedBy || !x.approvedAt || !x.simulationEvidenceId)) errors.push('Active document has an unapproved or unsimulated change');
  }
  return errors;
}
