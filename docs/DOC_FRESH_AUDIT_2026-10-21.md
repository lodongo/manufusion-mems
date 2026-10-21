# Documentation & Records — Fresh Audit (2026-10-21)

## Baseline and deployment
- Previous Milestone B implementation `6cf643e6`: independent validation passed and isolated development Cloud Run deployment succeeded.
- Subsequent audit fixes `cbd61745` / `251c5e64`: recheck latest CI and development deployment before treating them as live.
- Production remains outside this development review.

## Confirmed code properties
- Form templates and records are tenant-path scoped.
- Form record save requires author ownership, matching template and draft status.
- Template location is checked against current organizational scope on create/save.
- Conditional field rules must reference a prior selection/yes-no field; invisible values are discarded during save.
- Partial drafts are permitted; official submission/publication is not yet enabled.
- Signed DOC publication requires technical verification, malware-cleared source, assigned sign-off and CoA evidence.
- PDF signature QR authentication is available for approved single-file PDFs. Multi-file/Office/online-form signing remains incomplete.

## Issues discovered and addressed
1. **Record listing did not recheck revoked/changed organizational access**: fixed to apply current `canAt` scope per result on `develop`.
2. **Date validation accepted nonexistent calendar dates**: fixed with actual UTC calendar parsing, regression tests added.

## Open release and design risks
- Trusted ClamAV scanner **source exists**, but no independently verified private scanner service, event trigger, Secret Manager secret and operational clean/infected test evidence. Milestone A stays paused/open (#36, #37).
- No completed end-to-end real-user UAT across creator, signatory, technical reviewer and CoA approver.
- Form operational references currently store bounded IDs but **do not verify source record existence and access**. They must be treated as unverified.
- Draft form signatory plan is stored and validated but does not yet activate signatures for form records.
- Form templates remain draft-only, with no officially published controlled form records.
- Signature page positioning must be verified against real PDF page dimensions, multiple signers and rendered QR scan on Android before release.
- Signer selection still relies on user IDs; use a searchable directory after entitlement/scope review.
- Scanner and legally significant digital-signature capabilities need an explicit production security/legal gate.

## Recheck before closure
- Current GitHub independent validation, governance validation and matching deployment SHA
- Mobile test of template creation, conditional questions, partial drafts, reopening and watermark draft PDF
- Negative tests for cross-tenant, revoked scope, stale revision, scanner misconfiguration, incorrect signatures, tampered sources
- Formal acceptance evidence linked to issue #38; do not claim Milestone B complete on code verification alone.
