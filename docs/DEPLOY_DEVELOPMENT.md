# MEMS: isolated Google Cloud development deployment

This procedure builds the verified `develop` source on GitHub Actions and deploys a **private** Cloud Run service named `mems-dev`. It does **not** create or touch production resources. All live tenant data, existing AppDeploy service, and Firebase project `mems2026` remain outside scope.

## Prerequisites (owned Google account)

1. Create a **new Google Cloud/Firebase project**. Give the project ID a conspicuous development marker, for example `mems-dev-1234`. Do **not** reuse `mems2026`.
2. Attach a billing account and set a budget alert before provisioning. Cloud services and builds may incur charges.
3. Enable Firebase Authentication (email/password) and create a Firestore database in the new project. Pick the Firestore region deliberately; the location cannot simply be changed later. Register a **Web app** in Firebase; retain the public web configuration values.
4. From the Google Cloud Console or authenticated Cloud Shell, enable Cloud Run, IAM Service Account Credentials, Security Token Service, Artifact Registry and other required APIs. Provision a dedicated private Cloud Storage bucket and two distinct service accounts: `mems-dev-runtime` and `mems-dev-deployer`. Use **Workload Identity Federation**, not downloaded JSON credentials.
5. Make an Artifact Registry Docker repository named `mems-dev` in the selected region. Choose the region deliberately based on residency, service availability and costs.

## Least-privilege starting permissions

- **Runtime service account**: Firestore CRUD within *only the new project* (commonly `roles/datastore.user`), object access to *only the new bucket*, and IAM Credentials signing ability for GCS signed URLs. Review the scope of signing privileges before granting them. No billing-admin or owner roles.
- **Deployer service account**: deployment authority for Cloud Run in the new project, image write permissions to the new Artifact Registry repository, and `roles/iam.serviceAccountUser` *only* on the dedicated runtime service account. No long-lived service account JSON key.
- **GitHub OIDC provider**: restrict issuer to `https://token.actions.githubusercontent.com/`; bind ONLY `lodongo/manufusion-mems`, `refs/heads/develop`, and environment `development`. Bind the provider to the deployer service account using `roles/iam.workloadIdentityUser`. Do not grant this identity access to the live project.

See Google's Workload Identity Federation deployment-pipeline guidance and the official `google-github-actions/auth` README for exact IAM commands.

## GitHub configuration

In the private repository **Settings → Environments**, create environment `development`. Add protection/reviewer requirements if available. Add these **environment variables** (Firebase web settings are public identifiers, not private credentials):

| Variable | Example / description |
| --- | --- |
| `GCP_DEV_PROJECT_ID` | `mems-dev-1234`; must be the new development project |
| `GCP_DEV_REGION` | A supported Cloud Run/Artifact Registry region, e.g. `africa-south1` |
| `GCP_DEV_WIF_PROVIDER` | `projects/123456789/locations/global/workloadIdentityPools/mems-gh/providers/mems-develop` |
| `GCP_DEV_DEPLOYER_SA` | `mems-dev-deployer@mems-dev-1234.iam.gserviceaccount.com` |
| `GCP_DEV_RUNTIME_SA` | `mems-dev-runtime@mems-dev-1234.iam.gserviceaccount.com` |
| `MEMS_STORAGE_BUCKET` | Private dedicated bucket, e.g. `mems-dev-1234-files` |
| `VITE_FIREBASE_API_KEY` | Web API key from **new** Firebase Web app; public identifier |
| `VITE_FIREBASE_AUTH_DOMAIN` | `mems-dev-1234.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Must equal `GCP_DEV_PROJECT_ID` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Web app storageBucket from same dev project |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Web app sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase Web app app ID |

Do not set `MEMS_ALLOW_LIVE_DATA`. Do not place any service-account private keys, payment credentials, or access tokens into GitHub variables or repository files.

## Deployment

Open **GitHub → Actions → Deploy MEMS to isolated development Cloud Run → Run workflow** and choose branch `develop`. This is manual only. The pipeline validates every project reference, authenticates with short-lived GitHub OIDC credentials, builds the container, pushes to Artifact Registry and deploys a **restricted, non-public** `mems-dev` service. It sets `MEMS_PUBLIC_URL` to the actual Cloud Run URL after the first deployment.

The initial service deliberately uses `--no-allow-unauthenticated`. An authorized tester needs Google Cloud Run Invoker access and a suitable authenticated access method (for example `gcloud run services proxy`) to inspect the UI. Granting public access is a **separate**, security-reviewed decision. Add the Cloud Run hostname to Firebase Authentication's authorized domains before login testing.

## Verification and release gates

1. Confirm GitHub **MEMS independent validation** passes on the commit being deployed.
2. Confirm `/healthz` replies over authorized access and `/api/*` is blocked without proper authorization/configuration.
3. Test registration, login, tenant-scoped Firestore operations, GCS uploads, signed URLs, metadata reference lists and log entries in **development-only** accounts.
4. Test payment flows only in simulation/sandbox; separately audit unrestricted public routes, requests and rate limits before opening access.
5. Record results, permissions and any defects. Do not copy live Firestore records, Firebase Auth users or AppDeploy-stored attachments without a separate approved plan.

Cloud deployment cannot be executed from this source repository alone: Google Cloud ownership, billing, a separate Firebase Web app, service accounts and the OIDC trust relationship must first exist. The deployment action does not bootstrap or change a Google Cloud project.

**No deployment is automatically triggered by a Git push. Production cutover is explicitly excluded.**
