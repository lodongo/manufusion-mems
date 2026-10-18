/**
 * Universal transaction access boundary. It is deliberately fail-closed:
 * reserved blueprint entries are never sufficient evidence of implementation.
 * Runtime adapters MUST supply server-verified assertions (not client claims).
 */
export type AccessDecisionInput = {
  code: string;
  moduleEnabled: boolean;
  submoduleEnabled: boolean;
  implementedHandler: boolean;
  registryVerified: boolean;
  actionPermissionGranted: boolean;
  scopeAuthorized: boolean;
  sodPermitted: boolean;
  governanceClass: 'permission_only' | 'approval_required' | 'unconfigured';
  approvedPolicy: boolean;
  approvalSatisfied: boolean;
};
export type AccessDecision = { allowed: boolean; reasons: string[] };
export function evaluateTransactionAccess(input: AccessDecisionInput): AccessDecision {
  const reasons: string[] = [];
  if (!/^[A-Z]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{2,8}$/.test(input.code)) reasons.push('Invalid transaction code');
  if (!input.moduleEnabled) reasons.push('Module disabled');
  if (!input.submoduleEnabled) reasons.push('Submodule disabled');
  if (!input.implementedHandler) reasons.push('Transaction has no implemented backend handler');
  if (!input.registryVerified) reasons.push('Transaction enforcement not verified');
  if (!input.actionPermissionGranted) reasons.push('Action permission denied');
  if (!input.scopeAuthorized) reasons.push('Organization scope denied');
  if (!input.sodPermitted) reasons.push('Segregation of duties denied');
  if (input.governanceClass === 'unconfigured') reasons.push('Governance classification missing');
  if (input.governanceClass === 'approval_required') {
    if (!input.approvedPolicy) reasons.push('Effective approved authority/workflow missing');
    if (!input.approvalSatisfied) reasons.push('Required approval not satisfied');
  }
  return { allowed: reasons.length === 0, reasons };
}
