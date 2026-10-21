# DOC Milestone A — Trusted Malware Scanner Integration

## Current implementation
Quarantined uploads remain unavailable until an **independently provisioned scanner** submits a signed verdict to `POST /api/internal/drkms/scanner-verdict`.

The callback verifies:
1. HMAC-SHA256 signature derived from secret `MEMS_DRKMS_SCANNER_HMAC_SECRET` (minimum 32 characters).
2. Exact tenant ID, document ID, file ID, source SHA-256, scanner engine/version, verdict and scan timestamp.
3. Five-minute attestation freshness.
4. Firestore pending/quarantined state, before any update.
5. The original GCS object bytes against recorded hash and length.
6. Conditional Firestore update using the source update timestamp, preventing races and duplicate release.

Only `clean` allows `availability=verified`. `infected` and `error` stay quarantined and publication remains blocked.

## External service still required
A dedicated scanner worker must be provisioned with access to **read only** the quarantine bucket objects it needs; its service account should not have Firestore write permission. It must use a maintained malware engine, verify scan completion, and only then produce the HMAC verdict.

Store the secret in Google Secret Manager; inject it exclusively into the trusted scanner worker and MEMS Cloud Run service. Do not check secrets into GitHub, log signatures, allow browser callers to generate attestations, or let the document creator mark a file clean.

**The callback alone is not a working scanner.** Milestone A stays open until the scanner is deployed, integrated, monitored and tested (clean/malicious/corrupt/timeouts/service outages), including independent verification that quarantined documents cannot be published.
