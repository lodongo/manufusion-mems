# MEMS Security Configuration and Documentation — implementation contract

## Agreed scope
- **User Role** (organizational/job role) creation and updates must automatically include the `MEMS Standard User` **security role**, including existing User Roles via an idempotent repair/backfill. Do not confuse this with per-user assignment.
- Standard security roles must ship with actual module-specific permission rules. An organization may install missing rules without overwriting its existing customized rules. Never make 100% transaction coverage mandatory.
- Existing missing-rule warnings disappear only where actual rule records exist. Do not manufacture a warning-free status.
- Role baseline is self-service only; no administrator, verifier or approval authority. Keep segregation-of-duties boundaries.

## Documentation Management Centre
**MEMS Admin** maintains the centrally approved master documents. The organization's **Help & Documentation** reads only published documents relevant to enabled modules, plus tenant's own published revisions. Documents contain a searchable nested table of contents, scrollable sections, accessible permission tables, version and effective-date labels, section deep links, and contextual Help links.

### Document lifecycle
Draft -> In review -> Approved -> Published -> Archived. Editing a published document creates a new draft revision; published copies remain immutable. Store approver and timestamp in an append-only audit history. Only explicit authenticated, authorized publishing may change live documentation.

### Configuration-generated manuals
A server-authorized, tenant-scoped read captures role definitions, memberships, rule assignments, module enablement and configuration version. The snapshot is factual evidence. A deterministic formatter prepares tables and references. Optional AI may propose prose only, with citations to snapshot keys. AI must never invent or apply privileges, silently publish, or receive secrets or unrelated tenant data. Snapshot changes mark published documentation *potentially stale*, without silently rewriting it.

### Organization signoff
Generate accessible PDF from a specific immutable published revision, with document ID, version, captured-configuration fingerprint, effective date and signoff area. Upload signed scanned copies as protected attachments linked to that exact revision, with retention policy and audit trail. Signed copies are not treated as changes to the approved content.

## Acceptance checks before merging
1. New and existing User Roles gain precisely one MEMS Standard User assignment; reruns are idempotent and preserve all other role assignments.
2. Standard templates generate their intended actual permission rules; organizations' custom records are not overwritten.
3. Changes made to a published revision do not modify the published document; organization viewers never see drafts.
4. Tenant A cannot read or sign tenant B's documents or snapshots. Enforce authorization on server, not only UI.
5. Approval, permission checks, version history, and publication audit records are independently tested.
6. Verify both desktop/mobile section navigation, search, PDF export, and signed-attachment access.
7. Run `npm run check`, `npm run build`, governance tests and the MEMS development deployment workflow.
8. Deploy **only** existing `develop` -> `mems-dev` Cloud Run service and verify authenticated experience before reporting completed.

## Rollout safety
No production change and no alternate development instance. Never issue broad default privileges simply to remove “Missing” labels. If live configuration differs from template, flag it as a suggested update requiring organization action.
