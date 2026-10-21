# DOC Milestone A — Suspended Release Handover
Date: 2026-10-21
Status: **PAUSED / NOT ACCEPTED**. Resume from GitHub issue #36 and blocker #37.

## Delivered code
- Controlled DOC register, review, revision, supersession, immutable approval snapshot and historical tracking
- Author-assigned signatures, signature inbox, verified-source review and authentication-bound evidence
- Printable verification sheets, embedded QR stamps for single-file PDFs, in-app verification endpoint
- Secure quarantine upload with fail-closed publication and downloaded source checks
- Signed scanner verdict intake with HMAC, expiry, Firestore preconditions and recomputed original GCS SHA-256
- Independent ClamAV worker source under `scanner/server.ts`, container under `scanner/Dockerfile`

## Verification checkpoint
- Latest scanner worker source commit: `9d824fd4` on `develop`; independent validation **passed**.
- Development deployment of previous worker source commit `74810ae4` **succeeded**; latest `9d824fd4` deployment was in progress at last check.
- No verified scanner worker service running; production untouched.
- The scanner callback code alone does **not** scan incoming uploads.

## Blocking tasks on resumption
1. Fix and harden the scanner container packaging (ensure runtime dependencies and process user can access updated signature databases).
2. Provision private, separate scanner service account and scanning service in development Cloud Run with least privilege.
3. Provision `MEMS_DRKMS_SCANNER_HMAC_SECRET` via Secret Manager, configured only for MEMS backend and scanner worker. Protect internal callback from public misuse.
4. Connect immutable GCS quarantine object creation to scan worker via verified GCP event/queue, with generation locking and retries.
5. Validate real clean/EICAR/malformed/failed/time-out scans and isolate corrupted or suspect documents.
6. Exercise review, signatures, approval, publication, QR PDF print and authenticity scan with different organization users.
7. Test authorization: wrong tenant, scope, bypass, disabled signer, stale hashes, replay, supersession and audit.
8. Only then close issues #37 and #36, with linked run logs and acceptance evidence.

## Important limitations and policy decisions
- Original Office files and executable online forms do not yet have native signature placement; standalone certificate and PDF path are partial.
- No established external trust certificate/eIDAS or Kenya electronic-signature compliance assessment. Avoid claims equivalent to PKI-signed DocuSign documents.
- Preserve strict CoA and independent technical checks; do not relax scanning or mark files clean manually.

## Next parallel workstream
Proceed to **DOC Milestone B: Digital Forms & Operational Records**, beginning with reusable form schema/configuration, revisioned templates, dynamic field rendering, scope/roles, creator-selected sign-off assignment, and safe draft/publish states. Keep live publication gated on Milestone A until scanner is operational.

References:
- https://github.com/lodongo/manufusion-mems/issues/36
- https://github.com/lodongo/manufusion-mems/issues/37
- `docs/DRKMS_SCANNER_INTEGRATION.md`

Resume prompt: "Resume DOC Milestone A using docs/DOC_MILESTONE_A_HANDOVER.md and issues #36/#37; verify current develop and deployment first. Do not touch production."
