# DRKMS Section 1 — Governance and Documentation Foundation: 100% Acceptance Gate

This checklist defines **operational completion**, not merely committed contracts. The first release cannot be called 100% until all gates pass on the current commit in development with real Firebase/Cloud Run configuration. Keep production unchanged until separately authorized.

| Gate | Required acceptance evidence | Current assessment |
|---|---|---|
| Tenant and org security | Cross-tenant, cross-site, role revocation, draft reviewer and direct API negative tests | PARTIAL: scoped checks written; full integration tests missing |
| Registry and taxonomy | All document classes/subtypes, owner, scope, applicability, controlled lifecycle, review dates | PARTIAL |
| Author/review SoD | Submit, return, reject, independent verification, no self-approval, specialist reviews | PARTIAL |
| CoA workflow | End-to-end My Workflow approval request and atomic one-use publication, revoked approver and stale policy tests | PARTIAL: backend handlers, no full live E2E |
| Immutable revisions | Content hash, versioned storage object generation and retention, manifest, immutable released metadata, supersession | PARTIAL: manifest/snapshot implemented; immutable object storage not proven |
| Ingestion security | Upload quarantine, content type and real archive validation, trusted AV scanning, file/hash verification, blocked malicious samples | BLOCKED: scanner not installed |
| Controlled reading | Temporary signed URL, effective revision only, tenant/site scope, no direct quarantine bypass, evidence audit | PARTIAL: API present, storage rules/integration not validated |
| AI-ready documents | Extract approved PDF/Office text, OCR scans, page/section citations, diagrams, version-aware keyword index | NOT IMPLEMENTED |
| Engineering links | Exact installed equipment and OEM model/serial applicability, BOM/assemblies, approved knowledge only | PARTIAL |
| Industrial source identity | PLC backup vs read-only online capture, firmware/program compatibility, time of capture, historian and utility documentation | PARTIAL: schema and controls only |
| Mobile | No horizontal overflow, safe searchable selections, accessible review and download, user acceptance | PARTIAL |
| Automated CI | Type check, frontend build, DRKMS unit/integration/negative scenarios, security tests, current commit success | PARTIAL |
| Deployment | Green and approved develop environment smoke tests with audit and rollback | NOT DONE |

## Completion policy
- A green CI build does not close a security or live integration gate.
- No invented malware scan clearance, source checksum, evidence approval, PLC read, OCR extraction or AI diagnosis.
- AI access to PLC programs can use an independently approved backup **or** a read-only capture from the connected controller, with source, capture timestamp, running-version compatibility and exact provenance. No AI PLC write privileges.
- Section 1 includes the trust foundation and ingestion controls. Document OCR/indexing is its operational exit dependency because users need to verify that published files can be reliably retrieved and cited.
- Block publication until storage-object immutability and trusted malware scanning are proven.
