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
