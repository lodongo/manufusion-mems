# MEMS AppDeploy exit gates

## Gate 0 — recovered source (done)

- [x] Uploaded full AppDeploy source ZIP verified for integrity
- [x] Confirmed source version `1792143243738`
- [x] Identified AppDeploy coupling: API transport, backend router, storage, secrets, WS
- [x] Preserved original business modules and original source ZIP
- [x] Constructed an independent development candidate with adapter boundaries
- [x] Static syntax parsing passed for all project JS/TS/TSX files

## Gate 1 — isolated environment (not started)

- [ ] Create nonproduction Firebase/Google Cloud project (do not use `mems2026`)
- [ ] Enable Auth, Firestore, IAM, Artifact Registry, Cloud Run, GCS
- [ ] Configure GCS bucket and a narrowly privileged Cloud Run identity
- [ ] Configure separate public Firebase web settings and Cloud Run backend variables
- [ ] Run `npm install && npm run check && npm run build` with dependency access
- [ ] Run Node HTTP service locally and verify health/API routing without live Firestore writes
- [ ] Setup dev seed/master metadata (deliberately from approved sources)

## Gate 2 — integrated pilot (not started)

- [ ] Confirm dev registration/login, Firebase ID token issuer/audience and tenant isolation
- [ ] Verify all Firestore REST CRUD and audit event routes
- [ ] Verify large responses, operations needing transactions, counters and permissions
- [ ] Verify upload/download/delete of each file type on GCS; check signed URL expiry
- [ ] Convert existing AppDeploy-stored photos/files if they exist; source ZIP does not include them
- [ ] Verify mobile layouts, rich table templates, PWA/caching and documents
- [ ] Re-run existing 41 regression scenarios including authenticated multiuser tests

## Gate 3 — platform independence (not started)

- [ ] Implement robust real-time chat using an independent broker (not polling)
- [ ] Review rate limiting, abuse controls, CSRF and public origin policies
- [ ] Review employee personal records privacy, logs, access retention and Kenya data-protection obligations
- [ ] Verify payment simulations then sandbox callbacks with provider
- [ ] Migrate DNS and official email callback addresses under MEMS control
- [ ] Establish automated backup, restore, monitoring, alerts and recovery drills
- [ ] Operate external automation scheduler and integrate approved FX rates through controlled Finance publication

## Gate 4 — production cutover (requires explicit approval)

- [ ] Confirm operating owner, billing, domain, branch protection, secrets and backups
- [ ] Perform final data reconciliation in dry-run
- [ ] Freeze production writes before any data/storage cutover if necessary
- [ ] Switch DNS with rollback plan; verify all key modules and permissions
- [ ] Monitor exceptions and confirm safe AppDeploy decommission window

**No live data changes have been made through this migration package.**
