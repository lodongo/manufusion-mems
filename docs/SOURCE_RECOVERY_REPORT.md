# MEMS independent migration — source recovery report

**AppDeploy snapshot:** `1792143243738`  
**Original source files:** 265  
**Preserved original file paths:** 265 of 265  
**Original files modified in candidate:** 27  
**New independent infrastructure and documentation files:** 30 (before manifest/report)  
**Missing original files:** 0  
**Current status:** Offline development candidate; NOT yet deployed to Cloud Run.

## Direct AppDeploy dependencies removed

- Backend Node router, SDK response wrappers and Google Cloud Storage API replacing the AppDeploy SDK
- Frontend REST transport using `fetch` instead of AppDeploy client
- Environment-based server secrets and Google Workload Identity credentials
- AppDeploy websocket dependency replaced with explicit 12-second authenticated chat refresh during migration
- AppDeploy payment return URL replaced with configurable `MEMS_PUBLIC_URL`
- Original AppDeploy admin hosting shortcuts updated to Google Cloud Run guidance

## Source safeguard

Every original file path is retained. **The uploaded source ZIP is not the same as a data export:** Firestore records, authentication users, live storage objects and billing/secrets are not contained in it. Those require explicit separate export/backup workflows.

## Validation done

- The uploaded ZIP has a clean CRC check.
- All original files are available in the original extracted source.
- Candidate source parses without TypeScript syntax diagnostics.
- 11 offline tests passed for migration structure and currency-rate validation.
- Backend router loaded all modules under mocked Google dependencies; `/api/_healthcheck` returned HTTP 200 and unknown API paths HTTP 404 without network or live credentials.

## Remaining gating work

- Resolve dependencies and run Vite build/typecheck in an environment with access to npm.
- Configure separate Firebase development project and Cloud Storage bucket.
- Independently deploy/inspect service and test authenticated end-to-end flows.
- Validate GCS IAM signing, Chat real-time parity, outbound payment/IntaSend callbacks, domain routing, admin actions, logging, backup and restore.
- Implement controlled FX synchronization into current MEMS reference records after Finance review.

See `docs/README_FIRST.md` and `docs/MIGRATION_GATES.md` before using this project.
