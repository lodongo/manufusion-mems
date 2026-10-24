# Manufusion MEMS — P3 Shared Cost Allocation and Commitment Gate Foundation
Date: 2026-10-24

## Scope
This feature is based on P2 (#45) and P1 (#44) and must be integrated in that order. It preserves existing group/legal entity/site/department/cost-centre hierarchy and uses the existing Finance approval workflow and legal-entity GL.

## Implemented: Policy and simulation
- Corporate Governance → Cost Allocation: configure provider entity, provider cost centre, cost class, function, source GL references, beneficiaries, agreements, evidence, period, ceiling and pricing policy.
- Fixed percentage (must equal 100%), timesheets, headcount, FTE, transactions, revenue, utility/service usage, floor area and direct attribution driver types.
- Policy approval through existing FIN.setup.manage → Finance FCR maker/checker approval under FIN.setup.approve and CoA bands.
- Cross-entity beneficiaries must have service agreement/evidence and separately approve via beneficiary legal-entity FCR request. Provider approver may not also approve beneficiary confirmation. Policy becomes approved_policy only after all confirmations.
- Shareholder-only costs may not be cross-charged; mixed shareholder/service pools require separated, evidenced pools.
- Pure deterministic largest-remainder distribution in provider functional currency: every minor currency unit reconciles to the supplied cost. Cross-entity lines are flagged for future intercompany processing.
- Planning preview accepts user-entered driver values and totals, and does not read verified actual period source costs or drivers. It cannot post GL, invoice or settle balances.

## Implemented: Budget source transition preparation
- backend/corporateCommitment.ts computes checked reservation/release/revision against approved budget lines in currency minor units, including source-specific exception proof, caps and expiry.
- backend/corporateCommitmentPersistence.ts loads Firestore budget/source/exception snapshots and prepares optimistic-lock writes. It does not persist reservations independently.
- The caller must add the PO/PR/WO source-document mutation into the same Firestore commit as these CAS budget writes. This requirement must not be relaxed.
- Purchase-order mutate currently writes the order separately and cannot safely enable the adapter without a shared commit. No live-budget gate is switched on by this branch.

## Collections
- organizations/{tenant}/corp_allocation_policies/{policyId} — versioned, approval-referenced policy and legal-entity confirmations.
- organizations/{tenant}/corp_budget_commitments/{hash(sourceKind|sourceKey)} — reserved source amount, updated only with a verified source transaction (future integration).
- organizations/{tenant}/corp_budgets/{leId}_{fy} — existing approved budget, CAS updates prepared by adapter (not yet executed).

## Next integration gates
1. Refactor procurement final PO approval mutate to commit the PO plus all affected budgets and source reservations atomically. Cancels, returns, revisions, supersessions, receipts and service acceptance must all reconcile.
2. Derive budget classification from approved cost-centre/GL mappings, resolve source currency valuation and record one exchange-rate snapshot per transaction. Never trust frontend values alone.
3. Derive actual costs from posted/verified fin_journal events, atomically release matching commitments, with idempotent source references, and apply equivalent rules to all applicable PR/WO/payroll/direct expense sources.
4. Activate block-unless-approved-exception only once every applicable transaction pathway passes full lifecycle, concurrency, tenant-isolation and accounting tests.
5. Derive actual shared-service cost pools and drivers from immutable payroll/GL/operations evidence; same-entity reallocation must use existing approved REALLOC and avoid double posting.
6. Cross-company services/recharges, tax, invoicing, loan/equity/cash-pool events, settlement and consolidation belong to P4+. No automatic postings from policy approval.

## Validation
Run npm run check, npm run build, npm run test:corporate, and existing HR, DRKMS, independent and automation tests. Live Firestore validation is still required before switching on any spending gate.
