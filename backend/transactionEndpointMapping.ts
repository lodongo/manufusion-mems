/**
 * Transaction endpoint mapping contract. A source-code match is evidence of
 * a route declaration only, NEVER evidence that an endpoint is authorized.
 * This file is safe to consume from diagnostics but not from permission guards.
 */
export type EndpointClassification =
  | 'unclassified'
  | 'permission_only'
  | 'approval_required'
  | 'non_transaction';
export type EndpointVerification =
  | 'route_discovered'
  | 'review_required'
  | 'enforcement_verified';

export interface TransactionEndpointMapping {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  route: string;
  sourceFile: string;
  canonicalCode: string | null;
  legacyPermission: string | null;
  classification: EndpointClassification;
  verification: EndpointVerification;
  verifiedHandlerEvidenceId?: string;
  permissionEvidenceId?: string;
  scopeEvidenceId?: string;
  sodEvidenceId?: string;
  reviewer?: string;
  reviewedAt?: string;
}

/** A mapping may be certified only from separately collected evidence. */
export function validateEndpointMapping(mapping: TransactionEndpointMapping): string[] {
  const errors: string[] = [];
  if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(mapping.method)) errors.push('Invalid HTTP method');
  if (!/^\/api\//.test(mapping.route)) errors.push('Endpoint route required');
  if (!mapping.sourceFile.startsWith('backend/')) errors.push('Backend source required');
  if (mapping.classification === 'unclassified') errors.push('Endpoint is unclassified');
  if (mapping.classification !== 'non_transaction') {
    if (!mapping.canonicalCode || !/^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,4}$/.test(mapping.canonicalCode)) errors.push('Canonical transaction code missing');
    if (!mapping.legacyPermission) errors.push('Permission binding missing');
  }
  if (mapping.verification !== 'enforcement_verified') errors.push('Enforcement verification missing');
  if (!mapping.verifiedHandlerEvidenceId || !mapping.permissionEvidenceId || !mapping.scopeEvidenceId || !mapping.sodEvidenceId) errors.push('Independent guard evidence incomplete');
  if (!mapping.reviewer || !mapping.reviewedAt || Number.isNaN(Date.parse(mapping.reviewedAt))) errors.push('Review attestation missing');
  return errors;
}

/** Resolved activation is always false if any verification criterion fails. */
export const canActivateEndpoint = (mapping: TransactionEndpointMapping) => validateEndpointMapping(mapping).length === 0;
