# MEMS exit plan: AppDeploy to owned infrastructure

## Immediate, while deployment credits are unavailable

**Priority 0:** Export versioned source ZIP from AppDeploy. Save SHA-256 and an offline backup.

**Priority 1:** Create an owned private Git repository with branch protection and automated tests. Separate original source from migration changes.

**Priority 2:** Confirm Google Cloud IAM, billing, Firestore database location, backups, and storage ownership (without touching records).

**Priority 3:** Start a development cloud project for Cloud Run and Cloud Storage, physically/logically separated from `mems2026` until APIs and security controls are tested.

**Priority 4:** Inventory SDK dependencies in the actual ZIP (storage, websockets, secrets, routing, cron, push), route-by-route. Produce a migration matrix of API contracts and Firestore data paths.

**Priority 5:** Choose and validate a FX feed, then deploy the independent automation starter into the development environment.

## Incremental production rollout

1. Introduce versioned API contracts and an independent identity-verification middleware using Firebase Authentication Admin SDK.
2. Copy image/document objects into MEMS-owned Cloud Storage; retain old references until integrity is verified.
3. Replace AppDeploy SDK adapters behind existing business-service interfaces, keeping payload shapes stable.
4. Port high-value backend modules first (reference data, currencies, read-only lookups), then workflows, chat/mail realtime, Finance and purchasing transactions.
5. Move frontend hosting to Firebase Hosting / Cloud Run or other owned hosting; update API URL, CORS, CSP, service workers and Firebase authorized domains.
6. Run regression suites and role/tenant access tests, take backups, cut over with rollback, then retire AppDeploy after verification.

## Non-negotiable standards

- No service-account private keys checked into source or sent in chat.
- Do not write to live `mems2026` from development or migration tests.
- Keep source repository, storage bucket, domain, IAM and cloud billing owned by MEMS.
- Use immutable audit logs and idempotency keys for financial/stock/work-order side effects.
- Do not automatically change exchange rates on posted accounting documents.
- Ensure archived/retained records, tenant isolation and signed file download authorization work after cutover.
- Verify all legacy source dependencies and source data paths; no blind 'copy and deploy'.

## Suggested milestone definition

**Milestone A — Source secured:** complete ZIP and Git repository, known commit hash.

**Milestone B — Independent platform running:** private sandbox Cloud Run API, Firestore sandbox, signed health request, logs.

**Milestone C — First automation:** reference rates retrieved, validated, historized, and published idempotently in sandbox.

**Milestone D — Legacy integration:** one existing MEMS screen calling the independent backend through a controlled API, with tests.

**Milestone E — AppDeploy exit:** all business-critical services, storage and hosting independently operated; rollback validated.
