# DRKMS Foundation — Implementation Contract (Draft)
Date: 2026-10-20 | Source branch: `develop` | Scope: A01–A06, without production changes.

## Verified codebase baseline
- Frontend: React 19, Vite 6, TypeScript. Shells: `src/admin/AdminShell.tsx` and `src/org/OrgShell.tsx`.
- Backend: `backend/platform/server.ts` delegates `/api/*` to `backend/index` and requires Firebase project/bucket environment variables.
- Admin uses `/api/admin/reference/status` and `meta.*` defaults; use its existing defaults and CRUD infrastructure rather than adding a second master-list service.
- Existing organization navigation includes AST, MNT, PRC, FIN, SAF and governance. New DRKMS pages must use the existing role/scope enforcement and `My Workflow`.
- `docs/MIGRATION_GATES.md` currently identifies independent development/production cutover controls. Do not bypass those gates.
- Config file `config/drkms/document-master.v1.json` is design metadata **only**; not an active runtime seed or security rule.

## Ownership boundaries
| Layer | Authority |
| --- | --- |
| MEMS Admin | Global hierarchy, class/subtype definitions, metadata schema, relationship types, AI processor policy and generic templates |
| Organization Admin | Tenant-adopted classes, numbering, owner assignments, scope, privacy, retention, review frequencies, AI permissions and approval configuration |
| Organization Documents & Knowledge | Actual documents, revisions, files, technical drawings, videos, review evidence, publication, search and user-facing AI drafting |
| Existing AST/MNT/PRC/SAF/HR/CoA | Authoritative assets, tasks, materials, risks, competencies, approvals and governance respectively |

## Proposed logical entities (not yet provisioned)
- `document_registry`: `tenantId, documentId, classCode, subtypeCode, title, ownerRoleId, scope, securityClass, currentEffectiveRevisionId, lifecycleState, createdAt, updatedAt`.
- `document_revisions`: `tenantId, documentId, revisionId, structuredContentRef?, fileIds[], sourceRevisionId?, effectiveFrom?, effectiveTo?, approvalProof?, contentHash, status`.
- `document_files`: `tenantId, fileId, storageObjectKey, sha256, mimeType, byteSize, virusScanStatus, origin, uploadedBy, uploadedAt, immutable`.
- `document_relationships`: `tenantId, fromDocumentId, fromRevisionId?, relationCode, targetKind, targetId, modelConfig?, verifiedBy?, verifiedAt?, validFrom?, validTo?`.
- `document_approval_events`: `tenantId, documentId, revisionId, transactionCode, governanceDecisionId, actorId, action, timestamp`.
- `document_ai_jobs`: `tenantId, jobId, sourceFileIds[], processorVersion, outputDraftRevisionId?, sourceAnchors, discrepancies[], verificationState`.
- `document_retention`: `tenantId, recordId, retentionRuleId, triggerAt, legalHoldIds[], dispositionState`.
- `tenant_document_config`: `tenantId, enabledTypeCodes[], numbering, retention, review, permissions, aiPolicy`.

## Invariants to enforce on server
1. Every read/write resolves authenticated tenant and organizational scope server-side.
2. Global metadata is immutable to tenant users; tenant overrides never mutate the global defaults.
3. File uploads are quarantined, type-checked, malware-screened, hashed and private before publication.
4. Original source files and published revisions are immutable; revisions have separate identities.
5. Exactly one effective revision per document/scope/time; future-approved revisions do not silently replace current ones.
6. AI output begins as candidate content and requires source review; no autonomous publication.
7. Records in legal hold may not be disposed of.
8. Links reference canonical AST and materials IDs, not copies of their master data.
9. Work instruction task resources remain associated with the existing MNT task-centric workflow.
10. Existing governance, SoD and Transaction Manager provide binding and authorization; no second approval framework.

## Document transaction codes (reserved design; not yet registered)
- `DRK.CREATE`, `DRK.UPLOAD`, `DRK.EDIT`, `DRK.SUBMIT`, `DRK.VERIFY`, `DRK.APPROVE`, `DRK.PUBLISH`, `DRK.SUPERSEDE`, `DRK.ARCHIVE`, `DRK.DISPOSE`, `DRK.LINK_ASSET`, `DRK.ACTIVATE_FORM`.
- Before registering, cross-check the actual transaction registry naming conventions and route-to-handler mappings. Never assume codes above have authorization yet.

## Planned user interfaces (reuse shells)
- MEMS Admin > Metadata > Documents & Knowledge: Classification, Attributes, Templates, Technical Types, Link Rules, AI Studio, Verification, Lifecycle, Records, Defaults.
- Organization Admin > Documents & Knowledge: Adoption, Roles, Governance, Retention, AI/verification, Distribution.
- Organization > Documents & Knowledge: Repository, Digital Studio, Upload, Technical Library, Asset Knowledge, Verification, Forms, Records.

## First vertical slice
1. Inspect backend metadata CRUD/defaults, permission gates, governance transaction bindings and AST ID model (A01).
2. Register versioned global taxonomy via existing admin defaults routes (A02–A03).
3. Implement tenant-safe document registry and versioned storage, initially metadata-only (A04).
4. Implement organization adoption/settings with inherited defaults (A05).
5. Enforce the existing CoA transaction workflow for submit/publish and test unauthorized actions (A06).
6. Add document upload and published retrieval; then integrate AST document links, followed by AI.

## Release acceptance
- Automated tests for tenant isolation, immutable revisions, global default override behavior, ACL scope and blocked publication.
- Server denies cross-tenant file URLs and document metadata retrieval, not merely UI hiding.
- Phone-sized screens have no horizontal scrolling and selectors do not auto-focus the keyboard.
- No deployment to production until build/check, governance and isolation tests, and environment gates pass.

## Current status
Completed: verified repository and key integration entry points; created design taxonomy metadata and this implementation contract in a feature branch.
Not completed: runtime metadata registration, persistence, UI, governance handlers, regression tests, Firebase staging or deployment.
