# MEMS verified architecture and limits

Source checked by AppDeploy read-only source tools, 16 October 2026.

## Existing app

- App ID: `mems-a6ztx8`
- Latest successfully deployed source snapshot: `1792143243738`
- Live location: `https://mems-a6ztx8.v2.appdeploy.ai/` (availability depends on AppDeploy capacity)
- Verified repository snapshot listing: **265 files** across `backend/`, `src/`, build configuration, and tests.
- Frontend: React 19 + TypeScript + Vite 6, Tailwind CSS.
- Backend: AppDeploy-hosted TypeScript routes, relying on AppDeploy SDK for router, storage, secrets, and real-time messaging.
- Business data: Firebase Cloud Firestore via Google REST API, project **`mems2026`**.
- Authentication: Firebase Authentication from project **`mems2026`**.
- Uploaded photos and documents: AppDeploy-managed object storage (`@appdeploy/sdk` `storage` interface).
- Secrets: AppDeploy-managed secret `FIREBASE_SERVICE_ACCOUNT` (the **value has NOT been fetched or copied**).
- Local-only items: some unsaved drafts and UI preferences in browser local/session storage.

## Examples of existing modules

Backend files include `backend/finCore.ts`, `finLedger.ts`, `procurement.ts`, `purchaseOrders.ts`, `maintenance.ts`, `quickGemba.ts`, `chatMessages.ts`, `mail.ts`, `actionHub.ts`, `noteFiles.ts`, and `workflowTrace.ts`. The frontend includes `src/org/QuickActions.tsx`, `MailCalendar.tsx`, `QuickPersonal.tsx`, `MaterialsMaster.tsx`, and `WorkRequests.tsx`.

## AppDeploy-specific dependencies to replace

| Existing dependency | Future portable replacement |
|---|---|
| `@appdeploy/sdk` route helpers | Standard Node API framework or native HTTP service |
| AppDeploy file storage | Google Cloud Storage bucket controlled by MEMS |
| AppDeploy secret retrieval | Google Secret Manager / workload identity |
| AppDeploy WebSocket messages | Managed pub/sub or explicit realtime gateway |
| AppDeploy cron jobs | Cloud Scheduler + Cloud Tasks |
| AppDeploy backend deployment | Cloud Run, independent CI/CD |
| AppDeploy staging/QA | Independent test runs and automated CI |
| AppDeploy-source snapshots | Owned private Git repository and artifact archive |

## Platform risk

Published AppDeploy documentation indicates daily, weekly, and monthly account-wide limits, including hosting/usage, may interrupt apps when all available credits are exhausted. Restoring daily credits alone does not necessarily reset weekly or monthly limits. Check the AppDeploy billing dashboard for the actual account state.

## What this package does NOT contain

It does not include the application's actual 265 source files or an AppDeploy ZIP export. The source is retrievable through AppDeploy's source tools and its documented ZIP export, but that ZIP must still be obtained. This package does not contain credentials, databases, uploaded documents, or operational data.
