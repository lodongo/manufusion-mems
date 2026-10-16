# Firebase connection for the recovered MEMS app (mobile-friendly)

**You do not need the Firebase plugin, a desktop app, or a new production app registration.** The original AppDeploy source contains an existing Firebase **Web app** registration for project `mems2026`. The independent React frontend and Node backend already use Firebase Authentication and Google Cloud Firestore APIs. The new deployment is not yet linked to working Google Cloud credentials; GitHub build success alone is not proof of a live connection.

## What stays the same

- The existing AppDeploy-hosted MEMS and its Firebase project `mems2026` remain untouched while we build the independent host.
- Existing Auth accounts, Firestore documents, and production attachments are not copied, deleted, or reinitialized.
- The Firebase web app config is not a service-account key. Its `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, and `appId` identify a Firebase Web app; do **not** share private service-account JSON or other secrets.

## What still needs to happen, from a phone browser

1. Visit https://console.firebase.google.com/ and select `mems2026`; verify the existing application, Authentication and Firestore are still present. **Do not change** the existing project for this step.
2. A *separate* Google Cloud/Firebase project with an ID containing `dev` or `staging` is recommended for isolated backend testing. This is **not** a replacement for `mems2026`; it is a temporary test database and authentication environment. Reusing the existing Web app within `mems2026` for experimental writes is unsafe.
3. Register a Firebase Web app in that *test project*. You can do so from the browser on your phone. Firebase Project settings → Your apps → Web app config exposes the six public `VITE_FIREBASE_*` values.
4. Those six values become GitHub `development` environment variables, along with the dedicated Google Cloud project ID, region, bucket and Workload Identity Federation identifiers described in [DEPLOY_DEVELOPMENT.md](DEPLOY_DEVELOPMENT.md). Nothing should be pasted into tracked source code.
5. A Google Cloud owner must configure billing, Cloud Run, GCS, Artifact Registry, least-privilege service accounts and GitHub OIDC identity before the **manual** deployment can run. We do not have direct permission to create or configure those cloud resources from this GitHub-only connection.
6. After the independent test environment passes login, tenant isolation, API, Firestore and storage testing, we can plan a *separately authorized* transition to the existing `mems2026` production data. That stage needs a backup, safe read/write verification, and storage object reconciliation. It will **not** require rebuilding the app or replacing existing users.

## What our automatic checks do and do not prove

- GitHub CI compiles the frontend and backend, builds a production bundle with fake isolated Web app settings, and starts the independent Node server. It checks static files, its health endpoint and guard behavior **without contacting Firebase or changing data**.
- A real Firebase connection is verified only after Google Cloud credentials, IAM, the correct Web app registration and isolated Firestore have been configured and an authenticated integration test has succeeded.
- The `/healthz` endpoint is a Node-process liveness check, **not** a Firebase/Firestore connectivity test.

The development deployment is private by default. To test it from a mobile browser, we'll later need an approved mobile-compatible access path (for example an authenticated testing gateway) before enabling public HTTPS for the application. This is distinct from ordinary Firebase email/password sign-in.

**No Firebase plugin needed for the deployed app to connect to Firebase.** The plugin only enables separate administrative operations from within some developer tools.
