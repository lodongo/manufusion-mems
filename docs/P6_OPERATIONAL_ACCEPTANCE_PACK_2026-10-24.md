# Manufusion MEMS — P6 Operational Completion & Acceptance Pack

Date: 2026-10-24  
Status: **P6 engineering completed and deployed; operational release NOT yet signed off**.  
Feature PR: #57. Engineering PR: #53, merged.  
Required live acceptance: [GitHub issue #54](https://github.com/lodongo/manufusion-mems/issues/54).

## Release classification

Engineering: complete for opt-in bilateral service recharge and cost reimbursement posting, approved fixed-share allocations, source-linked GL evidence, dual-entity Firestore atomic commits, posted-pair reconciliation and a nonposting consolidation working paper.

Database emulator: verified single atomic commit, rollback on one-side failure, duplicate-source conflict, source allocation ceiling/claim and separate tenant document paths. These are server/persistence tests, NOT Firebase-authenticated user sessions.

Application readiness: a new **read-only per-voucher preflight** checks both legal-entity Finance charts, signed policy, open posting periods, currency, exact provider/beneficiary FCR links, source duplicate status and explicit isolated development posting flag. Technical green means only ready for **authenticated application testing**, never operational approval.

## Acceptance setup — performed ONLY inside isolated development

| Setup | Expected evidence | Sign-off |
|---|---|---|
| Two active legal entities A and B with configured KES functional currency | Independent Finance profile/period/GL mappings for each | Finance controller |
| P&L cost centres A and B, approved service recovery/expense GL plus reciprocal BS receivable/payable | Four active posting GL codes in approved legal-entity scopes | Entity finance leads |
| Independently approved service agreement with value ceiling, dates and settlement rules | Agreement FCR and counterparty FCR IDs | Legal/Finance |
| Source documents, VAT/tax treatment and transfer-pricing analysis checked | Actual signed reviewed tax evidence, not a typed reference alone | Tax controller |
| Provider maker, provider independent approver, beneficiary independent matcher and final controller with authority in both entities | Authenticated login/session and authorization decisions | Security/governance |

## Mandatory end-to-end transaction UAT

1. In development, initiate an approved service recharge **KES 500,000**, date inside both entities' open fiscal periods, unique source document and reviewed tax treatment.
2. Independently authorize the provider transaction through the existing Finance CoA; beneficiary approver reviews the exact same source and confirms matching.
3. Finance controller, distinct from both parties and maker, opens **Finance → Corporate Budgets & Allocation → Intercompany & Treasury → Matching → Review P6 release readiness**. Confirm technical checks, both entity rights and tax sign-off outside the preflight.
4. Only after written Finance/Tax release authorization, opt in the isolated development posting flag. The final Finance controller independently approves the FCR.
5. Provider must post: **Dr Intercompany Receivable KES 500,000; Cr Service Recovery KES 500,000**. Beneficiary must post: **Dr Service Expense KES 500,000; Cr Intercompany Payable KES 500,000**, assuming the reviewed invoice terms, exemptions and GL mappings justify this exact treatment. Taxable transactions require additional tax journal logic; do NOT treat this example as a universal tax calculation.
6. Verify a single Firestore commit creates **both** immutable journal IDs, both entity balance changes, both source idempotency keys, voucher `posted` status, paired posting record and the final Finance request decision. The reconciliation workspace must show no exception.
7. Attempt repeated final approval, same source submitted by another operator and concurrent duplicate submission. They must never create an additional journal.
8. Force invalid beneficiary account/closed period, stale account version and unexpected backend failure before commit. Ensure **neither** party's GL, pair record nor final request advances. On retries, do not create orphaned approvals.
9. Verify a separately authorized expense source allocation from actual posted provider P&L, fixed percentage with independently approved beneficiaries, policy annual ceiling and immutable source-claim. Check intra-entity GL allocation, generated cross-entity beneficiary vouchers and their subsequent independent approvals.
10. Attempt a user authorized for Entity A only to view Entity B's preflight or approve its FCR, and attempt another tenant's voucher ID. Access must be denied and no record disclosed.
11. Reconcile same document currency KES as well as functional currencies, confirm accounting period, GL/cost-centre totals and supported FX snapshots. Group eliminations must remain working-paper suggestions, not posted consolidation journals.
12. Confirm **no bank movement, invoice issue, loan, equity, on-behalf cash payment, realized FX or cash clearing** occurs as a side effect.

## Negative release gates

- **Do not activate production posting or treasury settlement.** Runtime protection must remain off outside isolated development.
- The current app records a tax-review reference but cannot itself validate VAT/withholding obligations or generate jurisdiction-specific statutory invoices. Tax owners must approve real source evidence, and transactions requiring additional tax journal lines must stay blocked.
- Loans/equity/treasury cash, dynamic allocation drivers, FX revaluation and actual group elimination posting are outside P6 restricted scope; move them to separately authorized milestones, not hidden completion claims.
- P5 authenticated budget-pilot gate remains independent and open at issue #51.

## Formal acceptance decision

| Gate | Current disposition | Evidence required to close |
|---|---|---|
| P6 code, governance and Firestore regression | PASSED | CI links, merged commit and deployment revision |
| Read-only readiness preflight | PENDING latest PR CI | Passing checks and development deployment |
| Actual authenticated cross-entity UAT | OPEN | Screen-recorded/traceable test execution and denial results |
| Tax/transfer-pricing verification | OPEN | Signed review for the concrete transactions and treatment |
| Finance approver and segregation of duties sign-off | OPEN | Independent approver, recorded decision and date |
| Pilot activation | OFF | Explicit isolated-development approval only |
| Production authorization | NOT GRANTED | Separate executive/security/Finance release |

**This document is a release runbook, not a signed certificate.** Blank human approval evidence cannot be filled from an automated test or fabricated by ChatGPT.