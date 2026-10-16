# MEMS independent migration candidate

**Source origin:** uploaded AppDeploy source ZIP `mems-a6ztx8-1792143243738-src.zip`.
**Source snapshot:** `1792143243738` (latest successfully deployed MEMS AppDeploy version at export).
**Scope:** All original MEMS frontend/backend source modules are preserved; the working copy contains portable transport, storage, secrets and hosting adapters.
**Status:** Development candidate. **NOT deployed. NOT production-approved.**

## What changed in the project

1. Replaced server `@appdeploy/sdk` imports with `backend/platform/sdk.ts` (small Node HTTP router, GCS object adapter, environment-mounted secrets).
2. Replaced frontend `@appdeploy/client` transport with a same-origin `fetch` client.
3. Added `backend/platform/server.ts` to serve `/api/*` and the Vite-built app from one process.
4. Switched backend Google API access to Application Default Credentials / Workload Identity (`google-auth-library`), retaining existing Firestore REST and Firebase token-verification rules.
5. Made Firebase web config environment-specific, with no live project identifiers or service-account credentials embedded in frontend builds.
6. Changed old AppDeploy return/checkout links to use the `MEMS_PUBLIC_URL` deployment setting.
7. Replaced AppDeploy WebSockets with a **temporary authenticated refresh** every 12 seconds. This is a reduced experience and must be replaced before commercial release.
8. Added Dockerfile, environment template, separate backend typecheck and deployment instructions.
9. Bundled a standalone FX automation service under `automation/`; it writes its own snapshot collections and is not yet wired to existing MEMS Finance UI.

## What did NOT change

- Source business modules, screens, workflows, Firestore collection structure, security guards and user data.
- Existing Firebase project `mems2026` and its Firestore records.
- AppDeploy production deployment or service account secrets.
- Existing AppDeploy object-store binaries; **source export does not include those stored user files.** Objects need a separate transfer process when migration goes live.

## Current validation

- ZIP integrity validated (273 ZIP entries including 8 folders).
- 265 original files inventoried and extracted; 263 TS/TSX/JS source files in migration package parse with TypeScript without syntax diagnostics.
- No direct `@appdeploy/sdk` or `@appdeploy/client` imports remain.
- Offline pure-FX tests passed in previous foundation, and are included here.
- Backend route smoke check passed using mocked Google providers (no Firebase or Cloud networking).
- **Full `npm install`, Vite build, app UI verification, Firestore/GCS integration testing and authenticated multi-user E2E have NOT been run in this offline container.** Run them in CI or a machine with npm access.

## Before starting

1. Create a fresh *development* Firebase project separate from `mems2026`.
2. Configure that project's Firebase Authentication, Firestore and authorized web app domains.
3. Create a dedicated *development* GCS bucket and minimal service account (see `GOOGLE_CLOUD_RUN.md`).
4. Populate the web/build-time `.env.local` values and server-only environment variables. They must refer to the SAME dev project.
5. Use `npm install`, `npm run check`, `npm run build`, and local integration tests.
6. Audit any warnings/errors before deploying even to a private test environment.

**Live Firestore guard:** The independent API blocks all `/api/` requests if the target project is `mems2026`, unless `MEMS_ALLOW_LIVE_DATA=I_ACKNOWLEDGE_THE_RISK` is set explicitly. This guard prevents accidental writes from the migrated development copy.

See `MIGRATION_GATES.md` for the staged acceptance checklist.
