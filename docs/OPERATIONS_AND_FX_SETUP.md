# MEMS Development Operations and FX Automation — secure configuration

**Scope:** project `manufusion-mems-development`, Google Cloud Run `mems-dev`, region `africa-south1`, repository `lodongo/manufusion-mems`, branch `develop`.

This is a guide to complete the one-time cloud authorizations for the MEMS development operations dashboards. It must not be applied to `mems2026` production.

## Already implemented in the repository

- `MEMS Admin → GitHub & Cloud Run`: super-admin-only workflow history, Cloud Run service versions, Cloud Logging, Firebase Authentication and Firestore operational counts.
- On-demand development dispatch and failed-job retry can use short-lived **GitHub App installation tokens**, generated on the backend. They never appear in frontend JavaScript or Firestore.
- `MEMS Admin → FX automation and rates`: USD/KES, KES/USD, selectable provider, refresh, historical snapshots, 1-hour / today / 24-hour / monthly / yearly views, and schedule preferences.
- `/api/internal/fx/scheduled-refresh` verifies a signed Google OIDC token including audience, issuer and the dedicated scheduler identity. It does not accept arbitrary bearer strings or query-string secrets.
- GitHub `develop` pushes run TypeScript checks, production build and automated tests. The final **green, current** commit dispatches the existing `workflow_dispatch` development deployment. The WIF provider remains restricted to that named workflow and environment. No production deployment.
- Cloud Run deploy uses `--update-env-vars` to preserve externally configured Secret Manager bindings.

## 1. Grant minimum development observability IAM

In Google Cloud IAM for the *development* project, grant the **runtime service account**:

`mems-dev-runtime@manufusion-mems-development.iam.gserviceaccount.com`

- `roles/run.viewer` (read Cloud Run services and revisions)
- `roles/logging.viewer` (read Cloud Logging events)
- `roles/monitoring.viewer` (only if using Google Monitoring dashboards)

Do not give these roles to a tenant account. MEMS itself exposes the operations API only to the server-verified MEMS **platform** `super_admin` role, which requires a `@manufusion.com` staff account.

## 2. GitHub App for in-MEMS private repository read/write

The GitHub App integration is **optional for automatic green-CI deployment**, but required for in-MEMS private repository operations.

Create/install a GitHub App restricted to the single repository `lodongo/manufusion-mems`. Prefer permissions:
- Repository metadata: Read
- Contents: Read
- Actions: Read and write (run history, workflow_dispatch, retry failed jobs)

Give no organization admin, secrets, or repo administration scopes. Keep code modifications in normal GitHub PR review; this operations page does not support unrestricted source editing.

Collect the GitHub App ID and installation ID. Create a Google Cloud **Secret Manager** secret for the App PEM private key **inside the development project**. Grant `roles/secretmanager.secretAccessor` for that secret only to the runtime service account. Bind this secret to the Cloud Run `mems-dev` environment variable `MEMS_GITHUB_PRIVATE_KEY` through Cloud Run's **Secrets** settings; separately set `MEMS_GITHUB_APP_ID` and `MEMS_GITHUB_INSTALLATION_ID` as ordinary environment variables. Do not paste the key into ChatGPT, GitHub environment variables, Firestore or browser-based administration.

After updating Cloud Run, visit MEMS Admin → GitHub & Cloud Run. Its connection badge will show when the backend can retrieve the private repository.

## 3. Currency provider

The default source `open_er_api` publishes **daily** USD-based reference rates. It requires no API key. Higher polling frequency is allowed but does not imply a market-live quote. Historical charts never invent observations.

Optional provider types:
- `currencyapi`: requires a key and offers an update frequency dictated by the commercial subscription.
- `exchange_rate_api` (paid): requires a key, update cadence depends on service plan.

For a keyed provider, store the key as a separate development Secret Manager secret, grant the runtime account accessor on that secret only, and bind it to `MEMS_FX_PROVIDER_API_KEY` on Cloud Run. Never enter it into MEMS frontend forms.

## 4. Activate reliable timed exchange-rate updates

Simply saving `enabled=true` inside MEMS does **not** create a cloud scheduled job. For unattended execution configure **Google Cloud Scheduler** once:

1. Enable the Cloud Scheduler API in `manufusion-mems-development`.
2. Create the service account `mems-fx-scheduler@manufusion-mems-development.iam.gserviceaccount.com`. It does not need Firestore, Firebase Auth or storage permissions.
3. Create a **single** HTTP Cloud Scheduler job with:
   - Name: `mems-fx-refresh`
   - Region: `africa-south1`
   - Schedule: `*/5 * * * *`
   - Time zone: `Etc/UTC`
   - Method: `POST`
   - URL: `https://mems-dev-c2hjaqiaqq-bq.a.run.app/api/internal/fx/scheduled-refresh`
   - Header: `Content-Type: application/json`
   - Body: `{}`
   - Auth: **OIDC token**
   - OIDC service account: `mems-fx-scheduler@manufusion-mems-development.iam.gserviceaccount.com`
   - OIDC audience: `https://mems-dev-c2hjaqiaqq-bq.a.run.app/` (including the trailing slash; must exactly match `MEMS_PUBLIC_URL`)
4. The project Cloud Scheduler service agent must retain its standard Cloud Scheduler service-agent role. The principal creating/editing the job must be authorized to use the scheduler service account.
5. In MEMS Admin → FX automation and rates, choose provider, frequency and UTC time, tick enabled, and **Save**.
6. Run the Cloud Scheduler job once using the Console's `Run now`. Verify `oidc_schedule_connected` and the last-received/last-completed timestamps in the MEMS dashboard; consult error logs if the job fails.

The 5-minute tick does not fetch FX data every 5 minutes. MEMS checks the saved frequency/UTC schedule, and only requests provider data when due. This offers an approximately 5-minute execution window. Cloud Scheduler and Cloud Run invocation costs can apply.

## Security and deployment rules

- `main` retains only the manual dispatch registration workflow and otherwise is not used for deployments.
- Real development builds run from the `develop` branch only, via `development` GitHub Environment.
- Production Firebase/Google Cloud project `mems2026` is not used.
- Firebase Auth and Firestore remain separately protected. Public website access does not grant authenticated business APIs.
- Any new write action on GitHub, Cloud Run, Firebase or Firestore must have a narrow allow-list, server permission check, validation, explicit confirmation and audit event. Do **not** create a generic arbitrary Google Cloud API/URI proxy in the browser.
