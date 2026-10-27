# MEMS — GL Transaction Registry and MRO Finance Integration Audit
**Date:** 2026-10-27 · **Target:** `develop` · **Status:** reference audit and configuration UX implemented, financial activation pending

## Baseline and verified classification
Finance `finCore.TXNS` explicitly implements **11 live events** and reserves **2 future events** (AP_INVOICE, AR_INVOICE). `finPostingCatalogue.POSTING_EVENTS` defines **36 posting scenarios: 11 live and 25 planned**. An installed route or a transaction placeholder does not by itself prove a GL posting.

The four universal files hold 8,294 detailed records: 1,804 GL accounts (1,799 legacy + five proposed additions), 3,545 Materials, 1,002 Services and 1,943 Assets. None of these records may be deleted or automatically made postable on account of an event alias.

There are **35 distinct catalogue event names** not identical to runtime posting IDs (13 Materials, 10 Services, 12 Assets). The new `backend/cataloguePostingCrosswalk.ts` explicitly maps every known event without changing source codes, GL amounts or historical postings:
- **4 direct live** template event families (owned stock goods receipt, non-stock goods receipt, service acceptance and asset receipt clearing).
- **4 conditional live** template event families (WO vs cost centre issue, service expense routing, direct service cost and staged asset acquisition).
- **16 planned** template event families that refer to reserved Finance handlers.
- **11 genuine review gaps** for scenarios where no equivalent verified posting is available.

The 439 flagged Materials entries remain unresolved accounting exceptions and five proposed GL additions remain unapproved. All other catalogue routes are still *reference proposed*, not authorized ledger postings. The linked ZIP is therefore an audited DRAFT, not a released legal-entity GL chart.

## What stays

Keep all 11 working posting events and their existing source handlers:
`GR_STOCK`, `GR_DIRECT`, `GR_ASSET`, `SVC_ACCEPT`, `GI_CC`, `GI_WO`, `ST_ADJ`, `STK_OPEN`, `INV_RECON`, `REALLOC`, `YE_CLOSE`.

Keep distinct GL coding stages, even when one workflow shares an operational source:
- Purchase order is normally a commitment, not a journal liability.
- Received stock debits inventory and credits GRIR; supplier invoice clearing is separate.
- Direct goods and service acceptance debit the approved PO line GL, not arbitrary accounts derived from the catalogue name.
- WO material issue and original-account reversal are separate sides of the same `GI_WO` posting class.
- All adoption and cost-center transaction restrictions continue to apply.

## What needs reassignment or normalization

| Current reference / placeholder | Decision | Evidence / action |
|---|---|---|
| `STOCK_ISSUE` on a Materials template | **Split by context** | `GI_CC` for ordinary cost-centre consumption or `GI_WO` for an assessed WO/task. Do not duplicate the bearing master. |
| `ASSET_ACQUISITION` | **Split by accounting stage** | `GR_ASSET` receipt clearing is live; `AST_CAPITALIZE` is a planned separate asset accounting event. |
| `FUNCTIONAL_SERVICE_EXPENSE`, `CUSTOMER_DIRECT_SERVICE_COST` | **Validate cost object** | Live `SVC_ACCEPT` accepts the approved PO line; expense, CIP and cost-centre beneficiary cannot be substituted at acceptance. |
| `MNT-WOR-PS` GL default relationship | **Review future placeholder** | Actual MRO inventory consumption is `INV-GIS-PS` / `GI_WO`; do not mark a work-order approval as an independent second GL debit. |
| `PRC-SVC-PS` versus `PRC-SVC-AC` | **Review alias vs handler** | Actual acceptance routes already debit/credit once; do not post a second service expense for a reserved placeholder. |
| `INV-ADJ-PS` versus `INV-CNT-PS` | **Keep distinct pending evidence** | Live stock-take differences are not automatically equivalent to future inventory corrections, write-downs, or provision movements. |

No stored transaction code is silently rewritten. Any eventual reassignment requires owner assessment, migration crosswalk and Finance approval.

## What should be added

Prioritize missing real posting handlers rather than creating placeholder IDs that appear live:
1. Supplier invoice, GRIR clearing, supplier payment, AR invoice and collection.
2. Consignment ownership/recognition, transfer-in-transit, supplier return and price variance.
3. Inventory allowance/write-down versus physical scrap and stock-count differences.
4. Service prepayment, service accrual and amortization of capitalized contract costs.
5. Asset capitalization/CIP, depreciation, impairment, lease commencement and disposal.
6. Customer fulfilment/COGS, service revenue and project WIP settlement.
7. Automated pre-PO GL selection for maintenance external services after reviewed cost nature, strategy and CIP policies.

Every new handler must have a source transaction, legal entity scope, approval authority, accounting role, debit/credit template, reversal, reporting dimensions, transaction identifier, and automated journal/budget tests before being marked live.

## What should be removed or retired

**No built-in transaction code or catalogue record is recommended for automatic deletion.** Codes already used in permissions, saved configurations, journals or audit history remain immutable.

An administrator-added, never-executable placeholder may be retired only after its owning module confirms it has no needed links; retain the retired code permanently to prevent reuse. Removing a redundant `MNT-WOR-PS` *association* is different from deleting the work-order transaction itself.

## Breakdown Maintenance — MAI-006

Retain all 15 existing `MAI-001` through `MAI-015` maintenance classifications and treat:
- `MAI-002`: Corrective Maintenance
- `MAI-006`: **Breakdown Maintenance**
- `MAI-007`: Emergency Maintenance

as **three distinct reporting and account-determination dimensions**. None creates a second inventory issue event. Breakdown WO/task consumption still uses `GI_WO`; its debit expense account is resolved by a specifically approved `MAI-006` rule when provided. In the absence of a specific breakdown mapping, the established approved generic maintenance expense fallback applies; this fallback must remain visible in audit data. A standalone breakdown expense GL can be configured later if the legal entity adopts it.

The new Finance GL configuration includes **Create maintenance strategy defaults**, which drafts rule entries for all enabled MAI codes using only adopted P&L accounts. It prefers the existing approved preventive/corrective reference accounts where present; Breakdown gets its own rule even if that rule currently routes to the same corrective GL. Submitting the draft still requires the existing `FIN.mapping.approve` checker.

## One-click Finance approvals

Finance Approvals now offers **Approve eligible mappings**, restricted to `mapping.save` and `gltxn.save` (maximum 40 per action):
- requires explicit confirmation and a recorded reason;
- excludes self-proposed, value-bearing and otherwise unauthorized requests;
- each FCR continues to call the original `/api/org/fin/requests/decide`, so it checks Finance authority, SoD, legal-entity chart, mapping validity and the audit;
- refuses conflicting simultaneous pending requests of the same type for the same legal entity, both in the UI and on the server;
- does not approve the four draft catalogue imports, ledger postings, payments, year-end close, or transactions with unresolved Finance exceptions.

## Verification and future controls

Implemented: read-only Transactions Manager audit tab, crosswalk registry, existing live-posting classification checks, maintenance strategy defaults and batch approval selection/regression tests. Complete GitHub CI and the isolated development deployment must pass for the final branch.

Remaining: actual customer Finance decision on the 439 Material exceptions and five GL additions; controlled activation of the four cross-mapped files; end-to-end Firestore emulator posting and reversal scenarios including cost-centre, supplier-owned/consignment and GL period restrictions; Phase 2 operational posting handlers for planned/gap items; financial dashboard by MAI strategy and cost nature.

**Nothing in this audit authorizes an unapproved account or changes production.**
