# MEMS — Independent development candidate

This recovered source is from the user-provided AppDeploy ZIP `mems-a6ztx8-1792143243738-src.zip`, with business modules preserved and AppDeploy-specific platform interfaces replaced by portable adapters.

**Current stage: source migration prepared, not built or deployed.** No live Firebase data has been changed.

Start at **[docs/README_FIRST.md](docs/README_FIRST.md)**, then read **[docs/GOOGLE_CLOUD_RUN.md](docs/GOOGLE_CLOUD_RUN.md)** and **[docs/MIGRATION_GATES.md](docs/MIGRATION_GATES.md)**.

## Offline checks

```sh
node --test automation/test/*.test.mjs tests/independent/*.test.mjs
```

## Online development checks (with Node/npm and a separate Firebase dev project)

```sh
cp .env.example .env.local
# Fill in your separate dev Firebase web config and server vars.
npm install
npm run check
npm run build
npm run dev:api
# In another terminal: npm run dev
```

The independent API guards against connecting to `mems2026` by default. This is an intentional safety control, not a deployment error.

Do not use this working copy for production until security, data, storage, payment and real-time messaging migration gates pass.
