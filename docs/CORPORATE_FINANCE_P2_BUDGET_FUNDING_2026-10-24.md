# MEMS Corporate Finance P2 — Funding and Budget Foundation

**Status:** Feature-branch implementation, pending PR review. **Deployment:** None.
**Dependency:** Corporate operating models & independent homes, PR #44 (P1).
**P2 PR:** #45, target develop. No financial posting is enabled here.

## Navigation
Organization Admin → Corporate Governance → Budgets & Funding
(Tabs: Annual Budget; Transfers; Exceptions; Funding).

## Current code capabilities
- Set yearly legal-entity budgets by active cost centre × codified class; approve in existing Finance Requests using independent maker/checker and existing position-based Finance CoA bands (valued).
- Keep one immutable opening appropriation per legal entity/year; store later transfers/revisions in independently approved, audit-referenced budget records.
- Intra-entity budget transfers conserve approved aggregate appropriation and cannot overdraw currently uncommitted funds.
- Budget revisions may add/increase lines and may reduce only currently uncommitted, unspent lines; require separate approval.
- Record source-document-specific budget exception approvals with expiry, cap, legal entity, financial year and cost centre.
- Provide a **non-authoritative budget simulation**; it does not reserve commitments or consume exceptions.
- Record funding-policy agreements for central/entity/reimbursement/loan/equity/pooling/hybrid configurations with agreement ID, tenor, method, ceiling, currency and settlement policy.
- Require a separate request and approval from the beneficiary legal entity before marking bilateral funding policies approved.
- Source all budget years/currency and legal-entity membership from existing Finance/organization configuration. Policy records never themselves post GL or move cash.
- Use ISO currency minor units via ICU/Intl (e.g. KES=2, JPY=0, KWD=3), retain monetary values as integer minor units.
- Reuse orgRoute tenant isolation and FIN permissions, request conflict scope, maker/checker segregation and FCR request authority.

## Data collections
| Collection | Description |
|---|---|
| organizations/{tenant}/corp_budgets/{legalEntityId}_{fy} | Approved initial plan and current line availability |
| organizations/{tenant}/corp_budget_moves/{FCR_ID} | Atomic, approved same-entity budget transfer |
| organizations/{tenant}/corp_budget_revisions/{FCR_ID} | Approved supplementary budget appropriation |
| organizations/{tenant}/corp_budget_exceptions/{FCR_ID} | Exception authorization for an identified source document |
| organizations/{tenant}/corp_funding_agreements/{hashKey} | Approved or pending-counterparty funding policy |
| organizations/{tenant}/fin_requests/{FCR_ID} | Existing request/approval system; used, not duplicated |

## Master codes
- Budget classes: OPEX, CAPEX, PAYROLL, PROJECT, SHARED, OTHER.
- Funding methods: COR, ENT, REI, LOAN, EQU, CPOOL, HYB.
- Settlement policies: IMMEDIATE, MONTHLY, QUARTERLY, ON_DEMAND, PER_AGREEMENT.
- Enforcement design preference: BLOCK_UNLESS_EXCEPTION_APPROVED. Not applied at spend handlers yet.

## Integration still required
1. Existing PR/PO, maintenance, HR/payroll and direct expense handlers must call an **authoritative atomic commitment/exception-consumption adapter**. P2's simulated available funds are not authoritative and do not block live spend.
2. Actual GL budget usage must be synchronized from verified posted expense events, with idempotency keys, fiscal periods and cost classification. Currently opening plan starts at zero; therefore status is planning, not actual-to-budget reporting.
3. A funding policy is not a transfer. Cross-entity loans, equity contributions, service recharges and cash pooling require separate contracts, tax assessment, bilateral matched accounting and treasury settlement in P4.
4. Legal entities' rules for transfer pricing, withholding taxes, FX settlement, and account determination need approved effective policies and operational handlers. No placeholder can post.
5. Automatic budget carryforward, supplementary funding checks, forecasting, multi-period budget phasing, multi-step hierarchical workflow policy overrides and budget release notification need further milestones.
6. Existing Corporate Financial Home mapping remains draft-only until activation governance is designed.

## Release gates
- npm run check, npm run build, npm run test:corporate, existing independent/HR/document tests must pass.
- Test tenant isolation and role-based access using dev Firebase with two tenants.
- Confirm a proposal cannot be approved by its maker and authority bands resolve as configured.
- Validate existing FY/cost centres and controlled migration; no mutation to live GL, HR, payroll, PR/PO.
- Do not merge/deploy until end-to-end review. PR #44 should be merged before P2.
