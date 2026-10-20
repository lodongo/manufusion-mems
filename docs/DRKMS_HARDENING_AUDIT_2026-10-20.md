# DRKMS Hardening Audit — 2026-10-20

## What code is present (not a claim of production certification)
- Universal document metadata, tenant draft registry, organizational scope checks, registration and classification settings
- Separate registry/configuration permissions, read-only publication readiness diagnostic
- Quarantined original uploads with checksums; **no malware scanner or approved download handler**
- Draft submission, but no actual independent reviewer decision and no immutable approved release
- Engineering classification, links to AST asset/equipment/assemblies and conditional model inheritance, asset dossier metadata
- SHEQ-owned SDS metadata and manufacturer URL register; no automatic freshness detection or external HTTP retrieval
- Digitally structured RCA **creation**; no investigation editor or controlled approval-to-staging yet
- AI/OCR candidate contract; no real OCR worker, vision model invocation, form execution engine or AI verification workflow

## Highest-severity gaps to address before launch
1. **Governance:** wire document review and approval to My Workflow/CoA using verified approval evidence, mandatory SoD and immutable publication snapshots. Block all direct status mutation.
2. **SDS:** SHEQ role/ownership permissions, chemical-material catalogue FK, legal entity/site applicability and download-safe verified latest issuer revisions; manufacturer URL is advisory until verified. Preserve historical copies and re-review on changes.
3. **Storage:** server-side AV scanning, signed read access only for authorized viewer and status, revision-immutable object keys, private storage policies, file counts/quotas and quarantine expiration.
4. **Technical dossier:** replace O(N documents × links) scans with a tenant-scoped reverse index and a secured pagination layer; prevent stale approved metadata and cross-site leakage.
5. **Model compatibility:** distinguish category/class from OEM model, manufacturer, serial range and retrofit; do not release safety-critical instructions by class alone.
6. **RCA:** structured evidence, event timeline, 5 Why/fishbone, verified causes, countermeasures, accountable owners, effectiveness validation, independent technical approval and stage to exactly authorized asset/task/assembly.
7. **AI:** isolate OCR extraction from truth; return citations, confidence, bounding regions, proposed typed fields, field validation, explicit user acceptance, versioned form schema, document evidence and zero autonomous publication.
8. **Mobile:** split the existing lengthy registry page into tabs, offer location breadcrumbs and preselected authorized employee context, do not autofocus searchable dropdowns.
9. **Tests:** run new drkms-specific test files, CI TypeScript/build, tenant isolation and proof-bound governance integration tests; verify deployed Firebase rules.

## Future-ready solution model
- One DRKMS core: immutable documents and revisions, attachments, relations, governing policy and audit.
- SDS/MSDS is a SHEQ-governed instance of external safety documentation, searchable by chemical/material, legal entity/site, storage zone, hazard category and latest verified revision, with emergency read access appropriately controlled.
- Digital RCAs are structured investigations, not free-text PDF uploads. Only approved immutable versions are published; their evidence and actions remain linked to work orders, failure events and equipment dossiers.
- Dynamic forms use schema-driven field types (asset/material references, inspections, photos, risk, signoff), conditional logic, mobile capture and human-reviewed OCR/AI proposals.
- AI outputs always carry source references, revision/version, extraction confidence, human validation and controlled publication via existing CoA.
