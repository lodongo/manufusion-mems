/** DRKMS publication gate: deliberately independent of the AI authoring engine. */
export type DocumentGateInput = {
  state: string; creatorUid: string; reviewerUid: string;
  hasSourceEvidence: boolean; verificationRequired: boolean; verified: boolean;
  hasApprovalProof: boolean; validScope: boolean; revisionId: string;
};
export function assessPublicationGate(input: DocumentGateInput): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.state !== 'approved') reasons.push('Document must have an independently approved lifecycle state.');
  if (!input.revisionId) reasons.push('An immutable revision identity is required.');
  if (!input.validScope) reasons.push('Applicable organization scope must be valid.');
  if (!input.reviewerUid || input.reviewerUid === input.creatorUid)
    reasons.push('Independent reviewer required; the creator cannot self-verify.');
  if (input.verificationRequired && (!input.verified || !input.hasSourceEvidence))
    reasons.push('AI or converted content requires human verification and source evidence.');
  if (!input.hasApprovalProof) reasons.push('Matching, independently validated CoA approval evidence required.');
  return { ready: reasons.length === 0, reasons };
}
