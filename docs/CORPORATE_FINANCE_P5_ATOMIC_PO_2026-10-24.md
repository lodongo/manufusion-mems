# Manufusion MEMS — P5 Milestone 1: Atomic Procurement Budget Control
Date: 2026-10-24

## Current development status
- P1–P4 consolidated in develop at 9d354a5816dbeb75b16e1c41dc6a32d58ab38b8a and successfully deployed to the isolated development Cloud Run service (Actions run 40086862207).
- P5 work tracked in PR #48 against develop. Not merged or deployed.
- Governance validation on the P4 integration commit flagged absent explicit route permissions (distinct from the green general CI checks). Security correction isolated in PR #49.

## P5 implementation boundary
Budget reservation is integrated into the final procurement PO approval mutation through a shared Firestore commit. The preconditions cover the source PO document, affected budget plan document(s) and a unique commitment register key. The PO and budget reservation either both commit or neither does. Approved PO cancellation releases its unconsumed reservation through the same atomic source/budget commit.

The pilot is DEFAULT OFF and cannot be activated by merely setting a Boolean; runtime requires an explicitly approved FCR of type corp.po.budget.gate and a matching designated sign-off. That approval flow does not yet exist and cannot be circumvented using the P5 UI. Deliberate inactivity avoids exposing unfinished spending controls.

## Limited pilot scope, when separately enabled
- Non-stock, services-only purchase orders with verified financial legal entity and assigned active cost centres.
- One legal entity per PO; converted to the legal entity functional currency using the existing FX source.
- Approved annual budget with a configured class and a currently open fiscal period.
- Full original PO amount reserved at the final approver's signoff; held in minor currency units.
- Reject overspend, unsupported item categories, mixed-entity purchase orders or unauthorized budget classes.
- Reserve source versions, amendments and cancellations using the P3 commitment evaluator.
- Current P5 code refuses amendments while the pilot is enabled, rather than releasing or duplicating prior commitments unsafely.

## Not yet finished
1. Source transaction budget class and gross/nonrecoverable-tax valuation account determination, especially for materials, inventory purchases and asset expenditure.
2. Actual expense recognition and commitment consumption on service acceptance, invoice or goods receipt (according to transaction recognition rules).
3. Partial receiving, corrections, credit notes, replacement versions, cancellations after receipt and cross-module workflows.
4. Approved tenant activation screen, second-person FCR policy signoff, tenant-scoped rollout and comprehensive Firebase emulator integration tests.
5. Intercompany dual-ledger atomic journals, tax documentation, approved settlements, and bank instructions.
6. Full security/governance validation in the combined develop branch after the permission correction is merged.

## Gates before enabling the pilot
- All automated tests green, plus transaction lifecycle, concurrency, failures and rollback tests in the isolated development environment.
- No budget enforcement for uncovered transaction flows. Do not claim global budget control or company-wide availability until every PR/PO/WO/payroll/expense source is connected.
- Finance owner validates GL actuals against reservation, fiscal periods, FX, exception provenance and reconciliation.
- Deploy and activate only in isolated development with documented tests; production remains untouched.

## P5 service acceptance and actual spending integration (implementation update)
- New `backend/corporateServiceBudget.ts`: receipt-ID-keyed actual expense recognition against the PO source reservation, with partial and final acceptance handling. Strictly maintains `budget actual + outstanding commitment` conservation.
- Service cost is derived from the **same approved service receipt debit lines** used by the existing `SVC_ACCEPT` Finance posting. The recognized cost and released commitment are in legal-entity functional currency minor units. GL expense lines are validated using existing Finance chart, cost-centre and period rules.
- `backend/finCore.ts` now accepts a deferred `extraForJournal(journalId)` callback. For a budget-controlled service receipt, `backend/finOps.ts` passes the PO receipt update and both budget CAS writes into **the very same Firestore commit** as the immutable GL journal, year preconditions, balance updates and posting idempotency key. A failure rejects the entire operation; it does not mark the receipt accepted.
- The PO source receipt records its GL journal ID, cumulative actual minor units and outstanding reserved amount. A receipt cannot be double-consumed. Full service completion releases unused FX/rounding residue; partial acceptance retains the unconsumed reservation.
- Cancelled **purchase orders**, not cancelled purchase requisitions, release the PO reservation using the existing atomic PO mutation. This corrects an earlier location error in the budget pilot hook.
- The pilot is limited to verified P&L expense service GL codes and to currencies with two decimal places because the existing Finance GL journal and balance implementation currently stores cents, not generalized minor units.
- Finance service recognition must occur in the same open fiscal year as the PO reservation until a governed carry-forward facility exists. Cross-year accruals, PO amendments, over-reservation, unsupported currencies and non-expense GL mappings fail closed.
- Strict source-linked GL and PO journaling records include the transaction reference and journal ID atomically. Separate best-effort activity logging failure is logged for reconciliation rather than misleading a user that the completed atomic journal failed.

## Remaining operational release controls
**This code is still a disabled-by-default pilot.** It is not an active spending-control configuration and no tenant can activate it without a verified independent Finance FCR. The tenant approval/activation workflow is not implemented.

Before enabling: authenticated Firestore transaction/concurrency tests across two tenants; reconciliation of existing service invoices and posted Finance expenses; source FX changes; accrued services spanning fiscal periods; service PO amendments/returns; partial cancellations, credit notes, reverse entries; tax-inclusive/nonrecoverable expense determination; accounts-payable invoice lifecycle and supplier duplicate invoice protection; broader material/asset/work-order/payroll commitments.

Source-linked strict service acceptance is implemented only when the approved service PO contains `budgetControlled:true`. Existing unrelated accounting handlers and non-pilot orders are not changed to enforce this budget gate.
