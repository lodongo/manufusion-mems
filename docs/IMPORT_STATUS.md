# MEMS source recovery status

- **Recovery source**: AppDeploy snapshot `1792143243738`.
- **Imported source**: 265 AppDeploy application file paths, preserved at the repository root.
- **Branch**: `develop` — source recovery baseline, NOT a production-ready independent deployment.
- **Security**: Do not enter Firebase service account keys, tokens, or production `.env` files into Git.
- **Current caution**: This baseline still uses AppDeploy-specific runtime adapters and the live `mems2026` Firebase web configuration. It should **not** be run or deployed against the live database without explicit safeguards.
- **Independent migration package**: `MEMS_Independent_Source_Migration_2026-10-16.zip` was separately prepared and validated offline. Its changed adapters, automation service, and Cloud Run configuration are **not yet included** in this Git branch.
- **Next work**: Apply the independent migration package on `develop`, run the TypeScript/Vite checks, create an isolated Firebase development project, then test Cloud Run safely.

Production data, Firebase user accounts, AppDeploy-managed attachments and backend secrets are **not** present in this Git repository.
