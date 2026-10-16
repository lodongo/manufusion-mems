# MEMS independent exchange-rate service

This is a **separate, small, independent service** originally prepared before the source export. It is included as an example automation worker, not connected to the migrated MEMS app yet.

- `src/rates.mjs`: validates USD-based reference rates and calculates cross rates.
- `src/firestore.mjs`: creates immutable per-date snapshots and updates a current pointer with Firestore transactions.
- `src/jobs.mjs`: fetches a configured HTTPS provider and publishes validated data.
- `src/server.mjs`: exposes internal refresh and read endpoints.
- `test/rates.test.mjs`: pure offline validation and calculation tests.

## Security and integration status

- **Do not expose the worker publicly.** Deploy using Cloud Run requiring authentication and trigger Cloud Scheduler using OIDC with a dedicated service account.
- Use a separate development Firebase/Google Cloud project and attach only a minimal IAM identity. Never upload a private-key JSON file.
- Set `FX_PROVIDER_URL` to a provider authorized for your commercial usage, and `FX_PROVIDER_NAME` to the verified source.
- Job output is stored at `fx_reference_snapshots` and `fx_control`. **The current MEMS currency reference page does not yet consume these collections automatically.** A controlled rate-publication bridge with audit and Finance validation remains to be built.
- Distinguish reference, bank buy/sell, contract, and posting rates; do not retrospectively alter posted financial transactions.

```sh
cd automation
node --test test/*.test.mjs
```

A fail-closed environment guard prevents jobs from using `mems2026` accidentally. Use the explicit `MEMS_FIREBASE_PROJECT_ID` setting of a **separate development project**. Do not set the live override during the pilot.
