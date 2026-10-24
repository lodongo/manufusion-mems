# Manufusion MEMS — P6 Atomic Intercompany GL & Reconciliation
Date: 2026-10-24
Feature: PR #53
Status: Engineering implementation on development feature branch, pending merge/deployment/Finance UAT.

## 1. Implemented technical flows

**Atomic bilateral GL:** `backend/finCore.ts` exports `preparePosting` which performs the full pre-existing legal-entity account, cost-centre, financial-period, transaction, posting-key and balance validation, prepares immutable journal and Firestore precondition writes, and does NOT commit them. Ordinary existing `post` now reuses the prepared writes and continues to commit one legal entity as before. `backend/corporateIntercompanyPosting.ts` prepares **both** distinct legal-entity journals, then commits both journal records, year/account/balance changes, two postkeys, the final Finance approval, the voucher status and the immutable `corp_ic_pairs` receipt **in one Firestore `:commit`**. Failed preconditions rollback the whole transaction. Sequence counters may have gaps after rollback; journal/GL balances may not.

**Bilateral approvals and source:** the P4 legal-entity agreement is separately approved by provider and beneficiary; the voucher is separately approved by both. A third authorized Finance controller must hold `FIN.post.approve` in **both** entities to approve the posting request, and may not be the source maker or either of the earlier final signatories. The final posting FCR itself is marked approved **in the same atomic commit** to avoid orphaned journals if follow-up UI/audit writes fail.

**Accounting classification:** currently only intercompany `SERVICE_RECHARGE` and `COST_REIMBURSEMENT` are enabled in the P6 posting contract, using explicit debit/credit role mappings in each legal-entity chart. Provider and beneficiary P&L cost centres are mandatory. Original source, signed agreement, tax-review reference, source/beneficiary approval refs, functional-currency FX snapshot and pair ID are stored in each GL journal trace.

**Shared cost execution:** `corp.allocation.execute` requires an approved bilateral cost pool and an actual immutable provider P&L debit journal line from its permitted GL source account and source cost centre. `FIXED_PCT` is the only executable driver until dynamic operational driver evidence is independently verified. The approved FCR, per-policy annual ceiling, global source-journal-line claim, internal cost-centre `REALLOC` journal (where required), allocation run register, and generated intercompany service vouchers are committed atomically. These beneficiary vouchers must still be independently matched and approved before their own later dual-entity GL posting; no cash or settlement instruction is issued.

**Reconciliation:** `backend/corporateIntercompanyPostedReport.ts` reads real posted paired journal IDs and source traces from each entity, verifies amounts, post status and accounting balance, and flags missing or mismatched journals. It produces document-currency matched totals and a group-consolidation **working paper only**. The working paper does NOT create eliminations in any entity or group consolidation ledger.

**Finance UI:** voucher creation now identifies the provider and beneficiary cost centres. On approved matched vouchers, eligible Finance staff can submit the separate P6 posting FCR. The reconciliation workspace includes actual posted-pair results and exceptions. The allocation workspace has source-journal verification, draft result and execution-request workflow.

## 2. Important hard release limits

- **Posting is OFF by default.** The runtime requires `MEMS_P6_INTERCOMPANY_POSTING_ENABLED=true` and a clearly named isolated development/test Firebase project; a production-named Firebase project never enables this flag. The normal Cloud Run development deployment workflow does not set it.
- **No money moves.** Loan advance/repayment, equity contribution, on-behalf payments, bank settlement, tax invoicing, creditor payment, withholding and treasury operations remain explicitly nonposting and require separate legal/treasury controls.
- The existing GL uses integer cents. P6 permits only **two-decimal** document and functional currencies, even though MEMS's FX catalogue supports currencies with other exponents.
- The tax-review reference is recorded but is not proof that indirect taxes are calculated or statutory invoices were issued. A jurisdiction-specific tax control/review must approve transactions before development activation.
- Cross-currency journals use each legal entity's documented FX snapshot. Group-currency translation, monetary revaluation gains/losses, realized FX on settlement and true consolidated eliminations remain separate Finance work; the P6 report is explicitly nonposting.
- Dynamic allocation bases (timesheets, FTE, area, revenue, transaction volume, usage) remain preview only until immutable driver source evidence and period crosschecks are implemented.
- A single posted expense line can belong to only one cost-pool execution. Concurrency-safe pool ceiling and source claim prevent recharging the same cost twice.
- Prior P5 operational release gate #51 remains open and separate. No P5 pilot activation is implied by any P6 merge.

## 3. Validation criteria

- Existing TypeScript, build, HR, document, governance, corporate finance and independent suites must pass.
- P6 Firestore Emulator must prove both journals/postkeys/period/balances/pair proof succeed together, invalid beneficiary CAS rolls back the provider, concurrent duplicate pair writes allow one winner, tenants remain in separate trees, and concurrent allocation claims/caps allow one winner.
- Emulator additionally exercises the **actual** Finance journal preparation under synthetic but correctly configured active legal entities, fiscal periods, cost-centre hierarchy and GL account documents.
- Authenticated two-legal-entity Finance/CoA UAT, tax review, service amount evidence and rollback/retry testing in isolated development remain required **before** setting the posting flag.
- Production posting/settlement and tax compliance require a later explicit release; no deployment to production is authorized.

## 4. P6 acceptance / closure

Software can be integrated into isolated development with the posting gate OFF when CI passes. P6 cannot be represented as operational/production-ready until actual authenticated approvals and Finance journal reconciliation under controlled development transactions pass. Any open residual must be tracked as a release gate, not silently marked complete.
