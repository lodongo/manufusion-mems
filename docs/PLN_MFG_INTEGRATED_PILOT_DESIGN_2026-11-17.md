# MEMS Production Planning & MRP + Manufacturing: Consolidated Design and Pilot Delivery Contract
**Status:** Approved design baseline (Questions 1–25); implementation not yet claimed.  
**Target:** `lodongo/manufusion-mems`, `develop` branch, MEMS development environment only.  
**Pilot:** Fictional Line 11 KHS PET multi-stage manufacturing scenario, in an isolated development/test tenant.  
**Principle:** One industry-neutral platform; all organization-dependent business policies configurable. No additional per-policy A/B/C/D votes.

## 1. Verified repository baseline (17 November 2026)
- React 19 / Vite / TypeScript frontend; organization UI in `src/org`; authenticated Node/TypeScript backend in `backend`; Cloud Run HTTP host, Firebase Auth and Firestore (see `docs/ARCHITECTURE.md` and `backend/platform/server.ts`).
- Existing module catalogue in `backend/catalog.ts` already defines `MFG` (Manufacturing), `PLN` (Production Planning & MRP), `INV`, `PRC`, `WHS`, `QLT`, `CST`, `MNT`, `AST` and `FIN`. **Extend these codes; do not create duplicate modules.**
- Existing warehousing, stock-policy metadata and Procurement replenishment code must be reused. In particular `backend/stockPolicyConfig.ts` and `backend/universalStockMetadata.ts` govern owner/supply status; `backend/replenishment.ts` owns existing replenishment mechanisms.
- Commercial order/forecast operational source is not built. Manufacturing execution is not built. The pilot therefore includes demand entry/import adapters and basic Manufacturing execution within the same delivery.
- Existing authorization, transaction governance and audits remain authoritative; do not bypass them with new custom permission checks or approval engines.

## 2. Approved business decisions
| Q | Final rule |
|---|---|
| 1 | Combined sales forecasts + confirmed orders, with forecast-consumption rules preventing double count |
| 2 | Configurable daily/weekly/monthly and other planning horizons |
| 3 | Forecast at configurable product hierarchy levels; disaggregate to SKUs with controlled rules |
| 4 | Hybrid demand allocation to supply sites, subject to capabilities and approval |
| 5 | MTS/MTO/ATO/ETO/hybrid production strategies configurable |
| 6 | Fixed, days-of-cover and service-level/dynamic inventory policies |
| 7 | Fixed, lot-for-lot, min/max, period-bucket and optimized lot sizing |
| 8 | Rated, historical, rough-cut and finite capacity, with downtime and labour constraints |
| 9 | Hard safety/quality/feasibility constraints, configurable soft scheduling objectives |
| 10 | Versioned single/multi-level BOMs, recipes, substitutions, yield/scrap and effective dating |
| 11 | Multi-location, time-phased MRP netting including reservations, dates, ownership and expiry |
| 12 | Auto/manual/exception replenishment with no duplicate PR or double allocation |
| 13 | Configurable soft allocation, firm reservation, staging, issue and returns |
| 14 | Automatic/manual/readiness-gated production release |
| 15 | Manual, warehouse-issue, backflush and MES/SCADA production confirmations, no duplicate postings |
| 16 | Manual/scheduled/event-driven replanning, time fences, versions and approvals |
| 17 | Stock-based, ATP and CTP customer-delivery promising |
| 18 | Optional costing visibility and cost-aware optimization integrated with FIN/CST |
| 19 | Organization-specific KPIs, thresholds and exceptions are configurable under blanket policy |
| 20 | Sales & Commercial not currently operational; manual entry, Excel and future API adapter |
| 21 | Manufacturing execution not currently implemented; build integrated foundations |
| 22 | End-to-end reusable architecture validated in a focused bottling pilot |
| 23 | Pilot resource: Line 11 (KHS PET) |
| 24 | Fictional demonstration records only, isolated from real stock, purchases and finance |
| 25 | Entire multi-stage chain, including ingredients, intermediate products, blowing, filling, packing and finished-goods receipt |

## 3. Module ownership and user experience
**PLN tabs:** Overview; Demand & S&OP; Production Plans (MPS); Capacity & Scheduling; MRP Runs; Material Readiness & Exceptions; Customer Promising; Planning Performance; Planning Configuration. The product/SKU and BOM screens surfaced here should link to shared masters, not replicate them.
**MFG tabs:** Products & SKUs; BOMs & Recipes; Routings & Resources; Production Orders; Shop-floor Execution; Quality & Yield; Production Reporting & Reconciliation; Manufacturing Setup.

**System of record:**
- MFG owns manufacturing SKU definitions, process versions, BOMs, recipes, routings, work centres, production orders and manufacturing confirmations.
- PLN owns demand snapshots, forecast versions, allocated demand, plans, MRP runs, pegging, schedule proposals, ATP/CTP and planning exceptions.
- INV/WHS own material master identity, stock availability, batch/lot/location, reservations, physical stock issues, transfers, receipts and inventory ledger.
- PRC owns suppliers, procurement requests, POs, inbound supply and existing replenishment rules.
- AST/MNT own equipment and approved maintenance windows; QLT owns release/hold decisions when adopted; FIN/CST own accounting and costing.
- Future Sales & Commercial module owns customer orders and commercial forecasts; PLN ingests versioned demand via adapter without rebuilding commercial order management.

**UI requirements:** Mobile-first tabs, responsive summary cards, drill-down drawers, frozen action bar, lazy-scroll virtualized/limited lists, searchable/filtered/movable/exportable tables, scope chips, clear readiness indicators, and role-appropriate actions. Reuse existing shared MEMS UI patterns.

## 4. Proposed multi-stage bottling model (fictional)
Example manufacturing process graph, with optional operations and parallel stages:
1. Ingredient/water preparation -> recipe batch of prepared beverage (intermediate inventory, traceable lot).
2. Preforms -> bottle blowing -> empty PET bottle intermediate (optional immediate consumption/no-storage).
3. Beverage intermediate + bottle + cap -> filling/capping -> filled bottle intermediate.
4. Filled bottle + label -> labelled bottles.
5. Labelled bottles + secondary packaging -> saleable case/palletized FG -> FG warehouse.
Each stage may use a work centre/resource, capacity and yield; at every stage planner chooses whether intermediate is stocked, directly transferred, batch-tracked or made-to-order. This is a demonstration topology, not a claim about the exact real physical line. Permit variants that omit or combine stages (e.g., purchased empty bottles, on-line blowing) without changing the engine.

Seed only fictional product families, SKU codes, dimensions, BOM versions, standard yields, capacities, calendar, warehouse balances, customer demand, PO lead-time examples and quality statuses, clearly flagged `demo`.

## 5. Logical data contracts (new design, not yet implemented)
Tenant-scoped records under existing `organizations/{orgId}/...` hierarchy, with site/legal-entity fields, audit fields, stable IDs, effective timestamps and approval status:
- Shared material/product master: ID, category/family, sell/produce/base UOM, conversions, specifications, sites, revision/effective range. Intermediates explicitly declare stock-managed (Inventory-linked) or non-stock-managed; metered process inputs select a configured equipment utility instead of Inventory stock. Material records must exist before use as BOM components, while their own upstream BOMs can follow later.
- BOMs have precisely two user-facing classifications: **Flavor/Variant BOM** (formulation/recipe ingredients and bulk/intermediate outputs) and **Packaging BOM** (physical containers, closures, labels, grouped packaging and packed-product inputs). Both retain parent SKU/intermediate, output basis, component inputs/UOM, output yield, loss, revision, site/process applicability, effective date and approval state. Flavor/Variant selection is optional for shared intermediates (simple syrup, treated inputs), but if set must agree with the product identity; Packaging BOMs may also link one or remain flavor-neutral for reusable materials. Historical RECIPE and BOM revisions are presented in the corresponding new categories. The internal `productNames` field remains stable, while the user-facing term becomes **Flavor/Variant**. Approved process BOMs must be selected by explicit category + alternative code + site/effective date before multi-stage MRP explosion, without double-counting inputs. A final Packaging BOM may be drafted or approved as long as referenced material masters exist, regardless of whether every upstream BOM is already defined; complete execution readiness is a separate gate requiring approved upstream versions, identified supplies and routing.
- Routing/resource: ordered and parallel operations, work centre/asset IDs, rates, setup/changeover matrix, calendars, maintenance exclusions, labour/utility requirements.
- Demand: source system, external ID, SKU/hierarchy key, location/market, quantity/UOM, needed date, type forecast vs firm order, customer commitments, version; unique external idempotency key.
- MPS version: demand basis and forecast-consumption policy, FG opening/target stock, lot-sizing mode, candidate production orders, time fences, scenario ID and approvals.
- MRP run: immutable input-snapshot hashes and rules version, requirement lines, pegging to stage/FG demand, time bucket, gross, eligible on-hand, reserved/allocated, eligible receipts, projected stock, safety level, shortage and proposed action.
- Planning action: planned PR/transfer/production action; unique deduplication key (org+site+material+source need+bucket+version), decision, owning downstream transaction ID and status.
- Manufacturing order: approved BOM/routing snapshot, stage dependency graph, SKU, output quantity, resource, dates, state, lot/batch references, reservation links and approvals.
- Production confirmation: stage/order/shift, good quantity, scrap/rework, timestamps, operator/source, lot genealogy and immutable inventory transaction references.
- Planning exceptions: severity, reason, affected dates/orders/customers, owner, mitigation, resolution and audit events.

**Persistence:** Firestore is verified for the current application. Final physical collection names, indexes and transaction boundaries must be fixed during the schema implementation against existing naming conventions. Do not assume Neon/Postgres is an active source of record for these modules without verifying runtime integration. Use bounded transactions and idempotent, resumable background jobs for large BOM/MRP runs. Store scenario/run snapshots as immutable versions so a mid-run stock change cannot silently alter an approved result.

## 6. Critical calculation contracts
1. **Forecast consumption:** For each SKU, supply site/market and configurable planning bucket, allocate confirmed orders against relevant forecast once; unconsumed forecast plus firm orders forms net demand; preserve source links for audit.
2. **FG net requirements:** Gross demand + ending target - projected usable receipts/FG stock, date-by-date, respecting committed orders, safety targets and shelf life. Avoid counting receipt twice in ATP/MPS.
3. **Multi-stage BOM explosion:** Apply the effective approved BOM and routing per manufacturing order date/site/resource; recursively explode component demands with correct UOM, expected yield, scrap and stage timing; detect cyclic BOMs and invalid conversions.
4. **Time-phased inventory netting:** Project eligible stock by material/site/warehouse/batch/time; exclude stock in quality hold, expired/blocked, unauthorized ownership and prior allocations; use confirmed receipts only on actual expected receipt dates and reserve per order exactly once.
5. **Capacity feasibility:** Separate calendar unavailable time (maintenance/holidays/setup) from expected production effectiveness; avoid double-counting downtime or yield factors. Distinguish rough-cut feasibility from finite sequence assignment.
6. **Replenishment:** Suggest internal make, transfer, supplier-managed replenishment or PR based on stocking policy/ownership; group needs under approved lot rules and dedupe against reorder-point auto-PRs and existing pending POs/PRs.
7. **Production consumption:** For each component choose warehouse actual issue, controlled backflush or measured consumption. Reconcile returns/actuals against calculated amounts and post **one** canonical inventory movement per business event.
8. **Commit/replan:** Frozen/firm/forecast time fences, version comparison, planning simulation vs commit; never rewrite completed production or previously posted stock, approvals, customer promises, costs or audit trails.
9. **ATP/CTP:** Available-to-promise subtracts existing firm commitments; CTP additionally checks materials, production capacity, lead times and feasibility and returns a proposal, not an unapproved binding customer commitment.

## 7. Proposed API boundaries (subject to existing route and guard patterns)
- `GET/PUT /api/org/pln/config` (scoped settings)
- `POST /api/org/pln/demand/import`, `GET /api/org/pln/demand`
- `POST /api/org/pln/mps/simulate`, `POST /api/org/pln/mps/{id}/submit`, `POST /api/org/pln/mps/{id}/approve`
- `POST /api/org/pln/mrp/run`, `GET /api/org/pln/mrp/runs/{id}`, `GET /api/org/pln/exceptions`
- `POST /api/org/pln/replenishment/{id}/release` (calls PRC/INV via governed adapter, not duplicate ledger)
- `GET/PUT /api/org/mfg/sku`; `GET/PUT /api/org/mfg/bom`; `GET/PUT /api/org/mfg/routing`
- `POST /api/org/mfg/orders/from-plan`; `POST /api/org/mfg/orders/{id}/release`
- `POST /api/org/mfg/orders/{id}/confirm`, `POST /api/org/mfg/orders/{id}/reconcile`
For implementation, adapt final route paths to current `orgRoute`, guards, transaction registry and module authorization conventions. Mutations must use audit, idempotency and existing approval services.

## 8. Cross-module consistency and security
- Honor `PLN/MFG/INV/PRC` adoption and effective permission scopes; scope controls must be enforced on backend, not only filtered UI.
- Derive permitted stock from existing Procurement/Inventory material dimensions. Non-company stock, consignment, VMI and customer-owned stock cannot be silently converted into standard company purchase requisitions; preserve specialized owner-aware workflows.
- One canonical physical stock movement recorded in INV; planning calculations are projections, not physical stock updates.
- Link every planned purchase action to the PRC-owned requisition and prevent two MRP triggers from creating parallel actions for the same underlying shortage.
- Store snapshot BOM version, run inputs, owner, approvals and resulting events on every committed production order.
- Explicit sandbox isolation: seed fictional data into a dedicated development tenant with import/seed idempotency. Disable external supplier integrations, payment/posting flows and non-test notifications for demonstration records. Do not write demo data into a real tenant, even in a development deployment.
- Keep current maintenance and finance pipelines unaffected; no direct modification to MNT workflows in this pilot.

## 9. Delivery phases and acceptance gates
### Phase 1 — Foundations and demonstrable master data
- Register navigation/screens against the **existing** PLN and MFG module catalogue/permission model.
- Define typed schemas, master-data APIs, organizational configuration inheritance, shared SKU/BOM/routing/recipe UI and audit.
- Seed isolated multi-stage Line 11 fictional materials and at least two FG SKUs; UOM, versions, intermediates and associated test warehouses.
**Pass:** users can traverse both modules, view/edit authorized demo masters, version BOMs, and resolve references without orphan records.

### Phase 2 — Demand, MPS and capacity
- Demand manual entry/Excel import/API adapter; hierarchical demand allocation, forecast consumption and reconciliation; MPS simulation/review/approval/versioning; rough-cut capacity and schedules.
**Pass:** demand imported twice remains single-counted; selected FG requirements trace to sources, and capacity infeasibility is visible.

### Phase 3 — MRP and material readiness
- Versioned multi-level BOM explosion, time-phased planning, stock status/ownership netting, material pegging, shortage dashboard, PRC/INV candidate actions and reservations.
**Pass:** late PO does not satisfy earlier need; blocked/foreign-owned stock excluded; repeated MRP/replenishment cannot duplicate PR or reservation; shortages trace to demand and component stage.

### Phase 4 — Manufacturing execution and reconciliation
- Approved MPS -> governed stage production orders; readiness gates; stage dependencies; warehouse issues, returns, backflush, good output, scrap/rework, intermediate receipts, FG receipts.
**Pass:** one physical issue/receipt per event; order quantities and batch genealogy reconcile; incomplete stages block dependent consumption where applicable.

### Phase 5 — Optimization, integration and acceptance
- Changeover-aware finite sequencing, approved maintenance integration, planned vs actual/cost dashboards, exceptions, events/replanning, ATP/CTP and full user acceptance.
**Pass:** automated end-to-end pilot for at least 2 SKUs and 2 manufacturing runs across all stages, including a material shortage, a delayed supplier receipt, a machine outage and a BOM revision; no live financial or procurement side effects.

**Quality gates for each phase:** `npm run check`; targeted Node tests; access and tenancy tests; existing stock-policy tests; mobile UI review; regression of prior modules; commit/deployment traceability. Do not call deployment complete until the development pipeline confirms completion and the functional acceptance scenarios pass.

## 10. Immediate technical work queue (no additional user decision required)
1. Audit current `src/org/OrgShell.tsx`, `backend/catalog.ts`, `backend/index.ts`, existing masters, `backend/replenishment.ts`, `backend/warehouse.ts`, `backend/stockPolicyConfig.ts` and transaction governance APIs.
2. Implement shared typed domain schemas and seed controls in the development codebase, with documented collection/index choices.
3. Build Phase 1 MFG master-data screens and PLN planning shell, authorization and route integration, then run checks and seed isolated demo records.
4. Move through Phase 2–5 only when the prior acceptance gate is met; use the existing develop branch and development environment only.
5. Maintain this design document as source of truth and add implementation traceability, test links and unresolved technical risks as development proceeds.

## 11. Outstanding *technical validation*, not user configuration questions
- Verify current deployed development tenant and test-mode isolation before inserting any demonstration data.
- Verify existing inventory ledger/reservation API identities and concurrency semantics before connecting MRP.
- Determine current unique-id and approval registration conventions from the running backend to avoid competing transaction types.
- Verify exact frontend module entry points; backend/catalog has module codes even though functional screens are not yet fully implemented.
These are code inspection and QA tasks, not reasons to ask the user to reapprove configurable business rules.
