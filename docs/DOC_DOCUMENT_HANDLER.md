# Documents (DOC) — document handler

## Where to start
Organization home → Documentation & Records → **Documents**. The page opens on *My work* with a short "start here" guide (five steps), counters (my drafts, in review, to review, to sign, review due) and the register as a rich table (search, column filters, columns, Excel, saved table templates). Tap a row to open the document.

## Lifecycle (one screen per document)
| Step | Who | What |
| --- | --- | --- |
| 1 Prepare draft | Author (`ADM.document_registry`) | **New document** → choose a template (Policy, Procedure, SOP, Work instruction, Manual, Plan, Standard, Specification, Form, Register, Report, Guideline, Checklist, or Blank) → title, class, location. Download the **Word outline** of the template, write the document, upload the PDF/Word/Excel/PowerPoint/image file(s), add signatories. |
| 2 Independent review | Reviewer at that location (`ADM.document_review`), never the author | Opens the files, then Verify / Return for changes / Reject with comments (≥10 characters). |
| 3 Sign-off | Each assigned signatory | Reads the verified files and signs; the signature is bound to the exact verified content. |
| 4 Publication approval | Author (`ADM.document_publish`) → approvers | **Request approval** creates a chart-of-authority request (Transaction governance, transaction for `drkms.documents.publish`) covering this exact revision; approvers decide in My workflow. |
| 5 Effective | Author | **Publish** once approved: the revision becomes effective and immutable; a predecessor becomes superseded. Effective files open securely or as a QR-signed PDF. **New revision** starts the next draft. |

Each document screen shows the **Next step** for the person looking at it, the lifecycle track and tabs Overview · Files · Sign-off · Review · Publish · History (tabs appear when relevant).

## Malware scanning (MEMS Admin)
MEMS Admin → Modules → DOC → Overview → *Malware scanning of document uploads* (super admin, reason required, audited).
- **Off (default)**: uploads are released immediately after the file-header check, size limit (8 MB), SHA-256 fingerprint and private immutable storage. Files are marked "Not scanned (scanning off)" and the release is audited.
- **On**: uploads stay quarantined until the trusted scanner signs a clean verdict (`docs/DRKMS_SCANNER_INTEGRATION.md`). While on, nothing can be submitted, reviewed, signed or published with unreleased files, and files cannot be released by hand.
- Switching off lets the author release files that were waiting for a scan (audited).
All gates use one rule, `fileReleased()` in `backend/drkmsScanPolicy.ts`.

## Security
- Every route checks the permission, the organizational location (chart of authority) and the person's role on the document (author / reviewer / signatory).
- Unpublished documents and their files are visible only to the author, reviewers (while in review) and signatories; files open through 15-minute private links, each opening audited.
- Submission and verification require at least one released source file (except structured digital RCAs).
- The publication approval link is checked against the exact revision fingerprint; any change needs a new request.
- New audit events: `drkms.file.staged_scan_off`, `drkms.file.released_scan_off`, `drkms.file.removed`, `drkms.file.opened`, `drkms.document.publication_requested`, `drkms.scanning.enabled/disabled`.
- Every DOC route is linked to a DOC transaction placeholder (DRF, SRC, RVW, SGN, PBL, CFG, ENG, SDS, RCA, FRM, KNW).

## Standard roles (security role templates)
- **Document Author** — `ADM.document_registry`, `ADM.document_publish`
- **Document Technical Reviewer** — `ADM.document_registry`, `ADM.document_review`
- **Document Controller** — `ADM.document_registry`, `ADM.document_config`

Publication also needs the organization to configure the publication transaction as approval-required with an independently reviewed chart of authority (Organization admin → Transaction governance).
