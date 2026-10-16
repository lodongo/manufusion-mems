# Import the independent MEMS migration package

**Current GitHub status:** the 265-file original AppDeploy source is recovered on `develop`. The independent migration ZIP has not yet been applied.

To apply the independently adapted source, upload the exact file `MEMS_Independent_Source_Migration_2026-10-16.zip` (size ~1.3 MB) to the **`imports/` folder on the `develop` branch**. Do not extract the ZIP in your browser and do not upload it to `main`.

GitHub Actions will verify the archive SHA-256, check all 297 source files, reject unsafe paths, unpack the archive over the recovery baseline, and commit the result back to `develop`. The uploaded ZIP is removed from Git after successful import. The expected SHA-256 is `94ca4a83a62570fb68f6aadaac5ec6b6034aa711592e1f6246fe753274a36d5d`.

Watch **Actions → Import MEMS independent migration ZIP** for the outcome. If GitHub Actions is disabled or the job fails, report the error without manually modifying Firebase.

**No production deployment:** successful source import is not a passing build or cloud deployment. Next validate `npm install`, `npm run check`, `npm run build`, isolated Firebase development project, Cloud Storage, authentication, payment callbacks, and real-time messaging before a test deployment.

The live Firebase project `mems2026` must not be used for development tests.
