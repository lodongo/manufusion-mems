# MEMS Development Operations and FX Automation — secure configuration

**Scope:** project `manufusion-mems-development`, Google Cloud Run `mems-dev`, region `africa-south1`, repository `lodongo/manufusion-mems`, branch `develop`.

This is a guide to complete the one-time cloud authorizations for the MEMS development operations dashboards. It must not be applied to `mems2026` production.

## Already implemented in the repository

- `MEMS Admin → GitHub & Cloud Run`: super-admin-only workflow history, Cloud Run service versions, Cloud Logging, Firebase Authentication and Firestore operational counts.
- On-demand development dispatch and failed-job retry can use short-lived **GitHub App installation tokens**, generated on the backend. They never appear in frontend JavaScript or Firestore.
- `MEMS Admin → FX automation and rates`: full uploaded world currency catalogue with USD base (including USD/KES and KES/USD), selectable provider, refresh, historical snapshots, 1-hour / today / 24-hour / monthly / yearly views, and schedule preferences.
- `/api/internal/automations/heartbeat` verifies a signed Google OIDC token including audience, issuer and the dedicated scheduler identity. It does not accept arbitrary bearer strings or query-string secrets.
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

## 4. One-time shared Automation Center trigger

**Region compatibility:** Your MEMS Cloud Run app continues to run in `africa-south1` (Johannesburg). Google Cloud Scheduler **does not currently support** that region, so the shared scheduler trigger is provisioned in the supported region `me-central1` (Doha). Its target URL continues to invoke the existing Johannesburg MEMS service. Never try to create this scheduler job in `africa-south1`: Google returns HTTP 400 for the unsupported location.


**Do this only once.** All future coded MEMS automation types reuse this single scheduler. Do not create a separate Google Cloud Scheduler job for every module or business process.

1. In Google Cloud Console, confirm project `manufusion-mems-development`, then enable the **Cloud Scheduler API**.
2. Create one dedicated OIDC-only service account:
   `mems-fx-scheduler@manufusion-mems-development.iam.gserviceaccount.com`.
   This account does **not** require Firestore, Firebase or Storage permissions.
3. Temporarily grant the development runtime account
   `mems-dev-runtime@manufusion-mems-development.iam.gserviceaccount.com`
   Cloud Scheduler Admin (`roles/cloudscheduler.admin`) in the development project for initial provisioning, and Service Account User (`roles/iam.serviceAccountUser`) on the dedicated `mems-fx-scheduler` account. This is a privileged, one-time authorization that must be performed by the authorized Google Cloud project owner. Prefer a custom minimal scheduler role if supported.
4. Log in to MEMS as the **platform** super administrator. Open **Automation Center** → **Activate shared scheduler**. Confirm `ACTIVATE AUTOMATIONS`.
5. MEMS creates one Cloud Scheduler job named `mems-automation-heartbeat` in `me-central1` (Doha; Cloud Scheduler is unavailable in Johannesburg) with five-minute ticks, OIDC authentication, audience set to the canonical development Cloud Run URL and a fixed endpoint `/api/internal/automations/heartbeat`. The scheduler calls MEMS only; it cannot execute arbitrary scripts or access Firestore.
6. Select an exchange-rate provider and schedule in **FX automation and rates**, then Save. The application will execute the exchange-rate job when due, without further Google Cloud scheduler changes.
7. Confirm the **Automation Center** shows an enabled shared trigger, a recent verified heartbeat, successful executions, updated currency coverage and historical logs. If a tick fails, inspect the fault details.
8. Once the job is created, remove broad Cloud Scheduler Admin from the runtime service account; retain a scoped **Cloud Scheduler Viewer** permission only if the administration dashboard needs to read job status. With creation rights removed, the existing trigger continues to run and all future MEMS automations still share it.

If the required Cloud Scheduler IAM roles or API are unavailable, MEMS will clearly identify the missing one-time permission. Saving automation preferences alone **does not** mean a heartbeat is active.

Manual **Refresh now** does work independently of Cloud Scheduler; it refreshes all currencies returned by the configured provider and records results. No scheduler connection is needed for this manual action.

### Automation architecture

- Registry: server-coded and allow-listed job IDs, beginning with `fx.world-rates`.
- Scheduling: per-job enable toggle, hourly/3-hourly/6-hourly/daily/weekly, UTC clock and weekday.
- Delivery: one centrally managed authenticated Cloud Scheduler heartbeat, independent of any device or Cloud Shell window.
- Authorization: Google-issued OIDC identity token, validated issuer, audience and dedicated service account.
- Reliability: per-tick Firestore create-only lock, retries on the next eligible tick after failure, append-only run history and audit events.
- Observability: last verified heartbeat, last success, latest failure, provider coverage, job history and connection state in Automation Center.
- Currency history: rate snapshots only when provider content changes; unsupported or obsolete codes are flagged and retain existing recorded values.
- Provider limitations: the free ExchangeRate-API source publishes roughly daily; faster schedule checks do not generate intraday market quotes.

## Security and deployment rules

- `main` retains only the manual dispatch registration workflow and otherwise is not used for deployments.
- Real development builds run from the `develop` branch only, via `development` GitHub Environment.
- Production Firebase/Google Cloud project `mems2026` is not used.
- Firebase Auth and Firestore remain separately protected. Public website access does not grant authenticated business APIs.
- Any new write action on GitHub, Cloud Run, Firebase or Firestore must have a narrow allow-list, server permission check, validation, explicit confirmation and audit event. Do **not** create a generic arbitrary Google Cloud API/URI proxy in the browser.
