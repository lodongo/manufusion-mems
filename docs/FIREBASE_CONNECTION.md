# Firebase development connection for Manufusion MEMS

Use only the existing project `manufusion-mems-development` and its registered Web app `Manufusion MES Dev`. Do not create a project or register another Web app. Do not inspect, read, write, or migrate production data in `mems2026`.

## Existing integration

The React frontend uses Firebase Authentication. Protected API requests attach a fresh Firebase ID token. The Node backend verifies signatures, expiry, issuer and audience against `MEMS_FIREBASE_PROJECT_ID`, then accesses Firestore through REST using Google Application Default Credentials. Storage uses the Google Cloud Storage SDK. Preserve these adapters and the existing business modules.

## Local setup

1. Copy `.env.example` to `.env.local` (ignored by Git).
2. Set `MEMS_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_PROJECT_ID` to `manufusion-mems-development`. Set `VITE_FIREBASE_AUTH_DOMAIN` from the registered Web app configuration.
3. Copy the real six public Firebase Web configuration fields from that existing app into the matching `VITE_FIREBASE_*` settings. Do not invent API keys, app IDs or bucket names. Confirm the actual development storage bucket for `MEMS_STORAGE_BUCKET` separately.
4. Use keyless Application Default Credentials for local backend access, restricted to the development project. Never download or store a service-account private key. The deployed backend uses its attached runtime identity.
5. Install dependencies, run `npm run check`, and build the frontend. Start `npm run dev:api` and `npm run dev` in separate terminals. The API development command reads `.env.local`; existing process environment values take precedence. Node 20.6 or later is required for environment-file loading.
6. Open `http://localhost:5173`. Vite proxies `/api` to port 8080. Keep the backend port aligned with that proxy. Keep payment flows in simulation.

## Validation and approvals

Offline CI verifies TypeScript, fixture-configured builds, module retention and isolated HTTP routing. `/healthz` establishes process liveness only. Live development authentication, token validation, tenant isolation, Firestore and storage checks require the real Web app settings, keyless credentials and development-only test accounts. Initial registration and application setup may write development data; use an agreed test plan.

An authorized project owner must verify development Auth providers and authorized domains, the default Firestore database and its region, required APIs, billing, a private storage bucket, narrowly scoped runtime IAM, Artifact Registry, Cloud Run and GitHub Workload Identity Federation. See `DEPLOY_DEVELOPMENT.md`; older descriptions of resources as created are historical notes, not current verification.

Cloud deployment and resource changes require explicit user approval. The deployment workflow is manual, restricted to `develop`, and private by default. A mobile-compatible testing access path needs a separate decision. Do not trigger deployment while reviewing source changes.
