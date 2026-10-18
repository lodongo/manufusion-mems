# Governance audits, reporting, and controlled publication

Status: DESIGN BASELINE / PARTIAL IMPLEMENTATION — do not present previews as certified reports.

## Report families

1. **Effective configuration audit (current state):** legal entity, module and tenant setup, effective inherited/overridden CoA rules, currency policies, active permissions, roles, staffed/vacant approval positions, workflow streams/SLAs, SoD incompatibilities, missing configuration, unpublished changes, approved exceptions. Findings must distinguish verified, warning, failure and not-assessable, with supporting source references.
2. **Historical transaction and control audit (period-specific):** date range (custom, current year, fiscal year, prior year), legal entity, site, cost center, module, transaction and user capacity; transaction lifecycle, value, CoA at decision time, actual workflow route, delay, SLA breaches, approval/rejection history, denied actions, delegation, amendments, re-evaluation and SoD exceptions. Include original transaction links and source-evidence IDs. Never treat lack of audit events as proof of compliance.
3. **Published governance documentation:** versioned legal-entity module description, approved effective setup and before/after differences, approved change justification, superseded versions, platform registry mapping and migration evidence.
4. **Governance performance dashboard:** counts and denominators, approval turnaround distribution, overdue percentages, configuration coverage, routing failures, control exceptions and follow-up ownership.

## Data contract and completeness

- Historical reports MUST use indexed date-range query pagination, not the latest-N event query.
- Reconcile audit events against canonical transaction records and decision ledgers, and compute evidence coverage by source, collection, period and legal entity.
- Older legacy records without organization attribution are recorded as *unknown legal entity*, never guessed.
- Separate event date, action effective date, reporting period, and as-of configuration date.
- Display calculation definitions, numerator/denominator, exclusions, missing records and confidence/completeness.
- Where material gaps persist, mark *unverified/incomplete* and block certified publication.
- Record template version, generated timestamp, author, tenant, legal entity, module, selected period, configuration digest and evidence hashes.

## Publishable report lifecycle

Draft generation -> evidence reconciliation -> reviewer validation -> redaction -> independent approval -> immutable publication snapshot -> controlled distribution -> archived/superseded.

Published artifacts are legal-entity and tenant scoped. Links must be access-controlled, revocable, expire where configured, and must never expose unrelated users or transactions. Permissions for *prepare*, *review*, *approve publication*, *share*, *revoke* and *view published* must be separate and checked server-side. Publishing cannot confer transaction approval authority.

Report formats: secure in-app view, PDF (controlled report), XLSX (auditable data appendix), DOCX (governance documentation), and CSV/JSON evidence extracts for authorized auditors. Export and publication must record access and recipient audit events.

## Current implementation boundaries

The initial `/api/org/governance/reports/preview` endpoint samples only the newest 500 tenant audit entries and returns explicitly labelled incomplete coverage. UI can download an unverified JSON preview. This endpoint is not the complete historical audit and is not publishable.

## Single deployment gate

Do not deploy partial preview as if operational. Complete indexed full-history extraction, source reconciliation, coverage assessment, policy evaluation, publication review, approval workflow, immutable snapshots, evidence manifests, revocable sharing, accessible responsive UI, PDF/XLSX/DOCX generation and comprehensive end-to-end tenant-isolation tests before production cutover.
