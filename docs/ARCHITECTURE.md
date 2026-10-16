# Current and proposed MEMS stack

```text
                  ┌─────────────────────────────────┐
                  │  MEMS React/Vite mobile web UI   │
                  │  firebase/auth; HTTP fetch API  │
                  └───────────────┬─────────────────┘
                                  │ /api/* same origin
                  ┌───────────────▼─────────────────┐
                  │  Cloud Run Node HTTP host        │
                  │  MEMS guards, routes, audit      │
                  └─────┬───────────┬───────────────┘
                        │           │
             Google ADC │           │ Cloud Storage SDK
                        │           │
                ┌───────▼───┐   ┌───▼───────────────┐
                │ Firestore │   │ GCS private bucket│
                └───────────┘   └───────────────────┘

          Cloud Scheduler ── authenticated invocation ── FX Cloud Run worker
                                             │
                                         FX snapshots
```

**Tenant isolation:** existing authenticated MEMS guards remain the principal authorization boundary. Backend IAM gives service access to the overall dev database and bucket: test application-level isolation separately and consider restrictive buckets/service identities for higher-risk workloads.

**Storage object migration:** Firebase Firestore metadata points to paths in AppDeploy-managed storage in the live app. Moving the source code does not move objects; metadata must be reconciled with an explicitly authorized object export/import process.

**FX publication:** The worker's `fx_control/latest_USD` is not yet wired to `reference/currencies`, so finance still uses the existing reference workflow. Build a controlled synchronization adapter after all validation, audits and posting-rate rules are approved.

**No vendor lock-in claim:** Firebase, Cloud Run and GCS remain Google-managed dependencies. Containerization and adapter boundaries make the business code more portable but do not make the complete system cloud-agnostic without further work.
