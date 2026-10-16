# Deploying MEMS independently — development first

This guide intentionally avoids modifying the current `mems2026` project. First deploy to a **separate** development project using its own Firebase configuration.

## Ownership and environment

- Google Cloud project: a new dedicated development project.
- Firestore: default database, region selected in accordance with cost and residency requirements.
- Auth: Firebase email/password, domain policy and appropriate authorized domains.
- GCS: private uniform-bucket-level access with a unique bucket name.
- Cloud Run: dedicated `mems-dev-runtime` service account; no service-account JSON key in the application.
- Git: commit this source to a **private repository** controlled by you; no secrets tracked.

## Required environment variables

Frontend variables are **build-time public** Firebase web config:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Backend variables are server-only:

```text
MEMS_FIREBASE_PROJECT_ID
MEMS_STORAGE_BUCKET
MEMS_PUBLIC_URL
PORT  # Cloud Run defaults to 8080
```

Backend values must be supplied on Cloud Run, not bundled into the frontend. Optional payment keys are separate Secret Manager bindings; no real payment provider should be enabled until webhook validation and domain migration are verified. Don't set `MEMS_ALLOW_LIVE_DATA` for the development project.

## Local development

```sh
cp .env.example .env.local
# Fill only values from the development Firebase web app.
# Backend env vars can be exported from .env.local in a trusted shell.
npm install
npm run check
npm run build
# Backend uses Google Application Default Credentials from gcloud auth application-default login.
npm run dev:api
# In a second terminal:
npm run dev
```

Visit `http://localhost:5173`. Vite proxies `/api/` to `http://127.0.0.1:8080`; Cloud Run serves both on one origin. A dev startup without the expected environment will fail safely rather than accidentally connect to the live backend.

## Cloud Run build and deployment

For a container build, the Dockerfile requires the six public Firebase variables as `--build-arg` inputs. For example:

```sh
docker build --build-arg VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
  --build-arg VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
  --build-arg VITE_FIREBASE_STORAGE_BUCKET="$VITE_FIREBASE_STORAGE_BUCKET" \
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID="$VITE_FIREBASE_MESSAGING_SENDER_ID" \
  --build-arg VITE_FIREBASE_APP_ID="$VITE_FIREBASE_APP_ID" \
  -t YOUR_REGISTRY/YOUR_PROJECT/mems-dev:dev .
```

Push to Artifact Registry and deploy the image to Cloud Run with server-only env values. Connect the Cloud Run service to the dedicated IAM service account with Firestore access and access to the private GCS bucket. **Do not point it to `mems2026` during development.**

For the signed URLs in `backend/platform/sdk.ts`, the runtime identity needs `storage.objects.get` and the appropriate permission to sign URLs (`iam.serviceAccounts.signBlob`, normally managed through `roles/iam.serviceAccountTokenCreator` scoped to the runtime service identity). Use tightly scoped IAM and test signed URLs across different users.

Cloud Run app frontend requires public HTTPS access; MEMS backend APIs use Firebase ID-token validation and tenant policies. Public setup/registration and auth endpoints still need review before commercial exposure.

## Environment consistency

- Ensure `VITE_FIREBASE_PROJECT_ID` matches `MEMS_FIREBASE_PROJECT_ID` and Cloud Run IAM project.
- Configure Firebase auth authorized domains for localhost and the Cloud Run hostname.
- Keep payment settings in simulation; checkout callbacks and absolute URLs are modified to `MEMS_PUBLIC_URL` but not independently exercised.
- For Chat, periodic refresh is a bridge; implement independent real-time messaging before production.
- Test all file categories, Firestore rules, export/import, race conditions, human approval workflows, backups and disaster recovery before production.

## Stop conditions

Never authorize a production cutover if the reference data diverges, identity scoping fails, any file storage returns cross-tenant content, payments don't verify signatures, or the new server can't meet audit and approval requirements.
