# Separate Google Cloud development deployment — no live changes

## Prerequisites

- Google Cloud CLI installed, `gcloud auth login` completed with authorized MEMS owner credentials.
- A **separate** development project selected (not `mems2026`), with billing enabled.
- Cloud Run, Cloud Build, Scheduler, Firestore APIs enabled; create the development Firestore database before the first job.
- A reviewed, approved USD-based HTTPS FX provider endpoint that supplies effective dates and ISO 4217 rates including KES and EUR. Review licensing, permitted usage, exchange-rate conventions, and attribution before deployment.
- A source repository with review controls; no secrets in code.

## Test locally, no cloud/credentials

```bash
cd service
npm test
node --check src/server.mjs
```

The `rates` unit tests do not call Google Cloud and do not contact the FX provider. Backend connectivity has NOT been tested.

## Preview optional deployment steps

The `deploy/deploy-dev.sh` script is **not executed automatically**. It refuses the live `mems2026` project and requires explicit cost acknowledgement. Run it only after reviewing it and selecting the development project:

```bash
export GOOGLE_CLOUD_PROJECT='your-separate-dev-project'
export FX_PROVIDER_URL='https://your-approved-provider.example/latest/USD'
export FX_PROVIDER_NAME='your-approved-provider'
export REGION='europe-west1' # Choose region after reviewing residency and costs
export I_ACCEPT_CLOUD_COSTS='yes'
export ENABLE_FX_SCHEDULE='no' # Do not enable automation until the provider is approved
bash deploy/deploy-dev.sh
```

**Avoid putting an API key in `FX_PROVIDER_URL`**. If a provider requires credentials, implement secure Google Secret Manager injection before enabling the schedule.

## Access control

The script creates separate worker and scheduler service accounts, grants the worker Firestore read/write access in the **development project**, and grants the scheduler the Cloud Run Invoker role. Cloud Run blocks anonymous requests. Cloud Scheduler supplies an OIDC identity. Never expose `/internal/*` routes through an unauthenticated proxy.

The sample worker's project-level Firestore IAM permission is broad: use a dedicated development project, then tighten IAM, data scope and workload identity design before a production deployment. Tenant-aware operations must verify the organization identity in the service layer; this starter does NOT expose any tenant CRUD endpoint.

## Production readiness work remaining

- Contracted, validated FX provider and historical rate feed selection.
- Tenant-specific rate policies, per-legal-entity rate types, approvals, and manual override workflow.
- Intraday/daily publication cutoffs and exchange-rate effective-date handling.
- Stronger source-change anomaly detection compared with prior accepted days.
- Cloud Tasks queue for multiple jobs, retries, idempotency and dead-letter handling.
- IAM least privilege, private service networking or ingress restrictions where applicable.
- Secrets, immutable audit, alerting, budget caps, retention and backups.
- Automated end-to-end tests in an isolated sandbox.
- A separate production deployment plan only after the application-source migration is complete.
