# Manufusion MEMS P5 – Firestore Emulator Transaction Test Report

**Date:** 2026-10-24  
**Pull request:** #50  
**Environment:** GitHub Actions Firestore Emulator; local `127.0.0.1:8083`; ephemeral project `mems-p5-emulator-test`  
**Production and deployed development databases:** Not accessed.

## What was actually exercised

These tests run the real MEMS REST persistence modules against the Firestore Emulator, not an in-memory test double: `backend/core.ts`'s `getDoc` and `writeDoc`, `backend/finCore.ts`'s `commit`, `backend/corporateCommitmentPersistence.ts`'s `prepareCommitmentWrites`, and `backend/corporateServiceBudget.ts`'s `prepareServiceAcceptanceBudget`.

Emulator run [GitHub Actions #40092244875](https://github.com/lodongo/manufusion-mems/actions/runs/40092244875): **6 passed, 0 failed**.

1. **Competing approvals:** prepare two concurrent 70,000 minor-unit reservations against the same 100,000 budget and commit both proposals concurrently. Exactly one wins; only its PO and source record are written.
2. **Atomic rollback:** force an invalid PO document update precondition alongside a valid budget and source change. All fail; budget version and balances remain unchanged and no source/PO is created.
3. **Partial acceptance:** reserve 50,000, accept 20,000; budget actual becomes 20,000 and committed remains 30,000. The PO update and test journal sentinel are included in that same Firestore atomic commit. Duplicate receipt consumption fails.
4. **Full completion:** a further accepted receipt converts only its recognized expense to actual and releases any unused commitment without treating residue as expense.
5. **Concurrent receipt race:** two receipts each consume 35,000 from a 50,000 reservation at the same CAS snapshot. One wins; 35,000 actual and 15,000 committed remain.
6. **Two tenant trees:** identical PO reference in different tenant document paths does not alter the other tenant's budget and cannot create an over-budget commitment.

## Explicit limits – NOT certified by these tests

- The tests use the Firestore Emulator REST persistence layer with **synthetic source PO and journal sentinel documents**; they do not call the complete authenticated PO approval screen or real Finance `post` pipeline.
- The suite verifies tenant **path separation**, not denial of access under real Firebase user tokens, roles, or Firestore security rules.
- No actual deployed-development transaction was created; no development users, cloud credentials, real vendors, customer data or production data were used.
- No real supplier invoicing or statutory tax determination, intercompany dual-ledger transaction, cancellation-after-partial-acceptance, credit note, reversal, amended PO or fiscal carryforward has been certified.
- Browser-based functional and mobile checks, app authentication/SoD under actual tenant accounts, and live Cloud Run API/rules integration remain mandatory before pilot opt-in.
- The legacy repository-wide strict route-inventory audit still has pre-existing classification gaps; this emulator lane does not replace governance review.

## Safety guard

`backend/core.ts` permits the anonymous local emulator only with the **exact** Firebase project ID `mems-p5-emulator-test`, the explicit `MEMS_P5_EMULATOR_TEST=true` test flag, and exact `FIRESTORE_EMULATOR_HOST=127.0.0.1:8083`. Normal development and production Firebase IDs continue to use the original Google Workload Identity HTTPS client.

## Deployment decision

The integration tests themselves can be merged into the development codebase after CI approval. **Do not enable** `MEMS_PO_BUDGET_PILOT_ENABLED` or claim company-wide spend enforcement based on emulator testing alone. Production is out of scope.

**Next release criteria:** provision two test tenant accounts in isolated development with permitted Finance/Procurement roles, run authenticated PO approval/rejection and service acceptance/retry scenarios with a configured legal entity/FY/CoA, check rollback under API errors, then complete AP/tax, amendments and reversal lifecycles.