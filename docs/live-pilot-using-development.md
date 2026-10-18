# Manufusion live pilot (development Firebase)

This deployment is an intentionally **public live-test frontend and API** on a separate Cloud Run service, `mems-live`, within the existing **development** Google Cloud project. It reuses the exact, green-validated `mems-dev` container image and existing `development` GitHub environment settings.

- `mems-dev` remains a separate Cloud Run service.
- `mems-live` uses the same development Firebase Authentication and Firestore data; tenants and transactions created on one service are visible on the other.
- Do **not** call the service isolated production or store real customer records until a separate production Firebase project and credentials are configured.
- Endpoints still enforce application authentication and tenant security; only the static homepage is public.
- The deployment verifies `/healthz` and a rejected anonymous request to `/api/org/governance/cutover/status`.
- Future changes to `develop` update both Cloud Run services after a green development validation workflow. This is a pilot release process, **not** the permanent production rollout strategy.

## Roll back pilot

In Google Cloud Run for the development project and region, select the `mems-live` service and redirect traffic to the preceding revision. This does not reverse Firestore data already written to the shared development database.

## Public Cloud Run access

The pilot is created as `mems-live` in `africa-south1`. This project restricts the `allUsers` IAM binding, so the verified deployment uses Google's recommended `--no-invoker-iam-check` setting rather than relying on `--allow-unauthenticated`. That Cloud Run access setting still requires appropriately privileged Google Cloud deployment identity. The release job verifies HTTP `/healthz` and rejects an anonymous business transaction before reporting success.
