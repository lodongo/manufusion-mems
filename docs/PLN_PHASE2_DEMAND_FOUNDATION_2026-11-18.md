# MEMS Phase 2 — Demand Management, initial vertical slice
Date: 2026-11-18. Scope: `develop` / isolated development service only.

## Implemented
- One tenant-scoped `pln_demand` register for manual forecast and firm-order demand.
- Site-scoped output material selection from MFG's canonical material/SKU master. No duplicate material catalogue.
- Draft revision with optimistic concurrency, submission, independent approval/rejection and immutable approved records.
- Source reference deduplication for imported/external records, via atomically written `pln_demand_source_keys`.
- Normalized UOM into output material base units; invalid cross-dimensional conversions rejected.
- Monthly preview of approved demand, grouped by output SKU, production site, market and unit.
- Forecast consumption: `net = firm + max(0, forecast - firm)`, i.e. confirmed orders consume forecast once.
- Mobile-first planning UI, including entry, status filtering, approval and consolidated demand display.

## Rules
- A demand line needs an existing produced material (intermediate or finished), active production site, needed date, quantity and unit.
- Site-scoped permissions are enforced on reads and writes. Planning configuration permission governs draft and release operations.
- Confirmed orders entered manually need an external customer/order reference. The input is **not** a commercial order transaction.
- Approved demand is not edited: create a new demand record or follow-up revision rather than rewriting approved history.
- Organization test mode may audit a super-admin maker/checker bypass; normal roles require independent approval.
- Source keys prevent replay of identical external source identifiers. Imported records are stored only as draft.
- S&OP preview counts only approved demand; grouping is initially monthly. No conversion of unlike units into a false total.

## Current limitations / explicit next steps
1. **CSV/Excel import UI:** imported/source-ID records are supported by the server contract, but an XLSX upload-and-preview interface and bounded atomic batch import remain to be added.
2. **S&OP workbench:** reconciliation versions, override/scenario records, forecast consumption policy at weekly/daily buckets, customer-specific rules and approval of a complete consolidated demand plan remain to be implemented.
3. **MPS:** no production proposal, lot-sizing calculation, planning snapshot, commitment or production-order release yet.
4. **Capacity/MRP:** no inventory netting, recursive BOM explosion, procurement interface, production orders or financial postings from this slice.
5. **UAT:** authenticated tenant access, cross-site isolation, independent maker/checker, Firestore concurrency, Android mobile and read-only development demo require manual acceptance.

Do not mark the full Phase 2 complete based on this slice or the unit tests alone.
