/**
 * MEMS documentation domain contracts.
 * Intentionally contains no database reads or generated permissions:
 * configuration snapshots must come from an authenticated tenant-scoped
 * server service, never from AI text.
 */
export type DocumentationStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
export type DocumentationAudience = 'mems_admin' | 'organization';
export interface DocumentSection {
  id: string;
  heading: string;
  markdown: string;
  children: DocumentSection[];
  configurationRefs: string[];
}
export interface DocumentationRevision {
  id: string;
  documentId: string;
  organizationId: string | null;
  title: string;
  category: string;
  moduleId: string | null;
  audience: DocumentationAudience;
  version: number;
  status: DocumentationStatus;
  sections: DocumentSection[];
  configurationFingerprint: string | null;
  createdBy: string;
  updatedBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  publishedBy?: string;
  publishedAt?: string;
}
export interface ConfigurationEvidence {
  organizationId: string;
  capturedAt: string;
  fingerprint: string;
  entries: Array<{ key: string; label: string; value: unknown }>;
}
export function visibleToOrganization(revision: DocumentationRevision, organizationId: string): boolean {
  return revision.status === 'published' &&
    revision.audience === 'organization' &&
    (revision.organizationId === null || revision.organizationId === organizationId);
}
export function documentationIsStale(revision: DocumentationRevision, currentFingerprint: string): boolean {
  return revision.configurationFingerprint !== null &&
    revision.configurationFingerprint !== currentFingerprint;
}
/**
 * Changes to a published revision create a new draft.
 * The previously published object must be retained unchanged.
 */
export function newDraftRevision(source: DocumentationRevision, editorId: string, id: string): DocumentationRevision {
  if (!editorId || !id || id === source.id) throw new Error('New revision requires a distinct ID and editor');
  return {
    ...source,
    id,
    version: source.version + 1,
    status: 'draft',
    sections: structuredClone(source.sections),
    createdBy: editorId,
    updatedBy: editorId,
    reviewedBy: undefined,
    approvedBy: undefined,
    publishedBy: undefined,
    publishedAt: undefined,
  };
}
/**
 * Publication requires an independent recorded approval;
 * callers must also enforce tenant and permission checks at the API boundary.
 */
export function publishApprovedRevision(revision: DocumentationRevision, publisher: string, now: string): DocumentationRevision {
  if (revision.status !== 'approved' || !revision.approvedBy) throw new Error('Approval required before publication');
  if (!publisher || !now) throw new Error('Publisher and publication timestamp required');
  return { ...revision, status: 'published', publishedBy: publisher, publishedAt: now };
}
