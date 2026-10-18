import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentationIsStale, newDraftRevision, publishApprovedRevision, visibleToOrganization,
  type DocumentationRevision,
} from './documentationDomain';

const published: DocumentationRevision = {
  id: 'doc-v1', documentId: 'roles', organizationId: 'org-a', title: 'Security',
  category: 'security', moduleId: null, audience: 'organization', version: 1,
  status: 'published', sections: [{ id: 'intro', heading: 'Introduction', markdown: 'Read me', children: [], configurationRefs: [] }],
  configurationFingerprint: 'fingerprint-1', createdBy: 'author', updatedBy: 'author',
  approvedBy: 'reviewer', publishedBy: 'publisher', publishedAt: '2026-10-18',
};
test('published tenant documentation only visible to its own organization', () => {
  assert.equal(visibleToOrganization(published, 'org-a'), true);
  assert.equal(visibleToOrganization(published, 'org-b'), false);
  assert.equal(visibleToOrganization({ ...published, status: 'draft' }, 'org-a'), false);
});
test('published revisions remain unchanged when creating drafts', () => {
  const draft = newDraftRevision(published, 'editor', 'doc-v2');
  draft.sections[0].markdown = 'Changed';
  assert.equal(published.sections[0].markdown, 'Read me');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.version, 2);
  assert.equal(draft.publishedAt, undefined);
});
test('documents require recorded approval before publication', () => {
  assert.throws(() => publishApprovedRevision({ ...published, status: 'draft' }, 'publisher', 'now'));
  const approved = { ...published, status: 'approved' as const };
  assert.equal(publishApprovedRevision(approved, 'publisher', 'now').status, 'published');
});
test('detects snapshot changes without changing publication', () => {
  assert.equal(documentationIsStale(published, 'fingerprint-2'), true);
  assert.equal(documentationIsStale(published, 'fingerprint-1'), false);
  assert.equal(published.status, 'published');
});
