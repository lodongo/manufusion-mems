# MEMS — Step 3: Process Routings Structure and Configuration Rules
Date: 2026-11-20
Status: **DESIGN FOR REVIEW — not implemented by this document**
Branch: `develop` only

## Purpose and ownership
A routing is an approved, versioned **process path** for producing a manufactured SKU, with serial and parallel stages. The **Manufacturing Cost Centre & SKUs** configuration is the single owner of commissioned **physical primary-container throughput per selected time period**. Product Configuration owns container sizes and pack conversions; the universal BOM master owns consumption quantities. Routings must reference these masters, not duplicate or overwrite them. Physical equipment and its Asset Register mapping remain unchanged. Future MRP, scheduling, and production orders read approved routing/BOM snapshots; this design itself makes no production, procurement, stock, or finance postings.

## What currently exists (verified in develop)
- `backend/plnMfgFoundation.ts`: `mfg_routings` records hold `skuId`, `siteId`, `effectiveFrom`, and 1–60 operations. An operation currently contains code, sequence, name, `resourceId`, optional `producesSkuId`, earlier-stage `dependsOn`, `setupMinutes` and `runMinutesPerUnit`.
- Backend validates referenced SKU, resource, site, and stage output; rejects duplicate or forward dependency references. Save regenerates `STG_#########` stage IDs.
- Existing draft, independent submit/approve, revision history, and activation workflow is already provided by MFG foundation routes.
- The current UI is a broad routing form: output SKU, resource, produced intermediate, prior-stage dependencies, setup and run minutes. It **does not yet explicitly tie each stage to a manufacturing cost centre, BOM selection, or rated capacity basis**.
- `docs/PLN_MFG_INTEGRATED_PILOT_DESIGN_2026-11-17.md` specifies multi-stage and parallel-stage processing and the isolated fictional Line 11 pilot; `docs/PLN_COST_CENTER_SKU_CAPACITY_2026-11-18.md` defines authoritative cost-centre/SKU physical-container rating.

## Proposed identity and hierarchy
### Routing header (one route version)
- Generated routing ID, name, main produced SKU (`skuId`), output classification, applicable legal entity and site (from organization structure), optional alternative code `STANDARD`/named alternative, effective-from date, version, status, description.
- Do **not** force one manufacturing cost centre at routing header level: preparation, blowing, filling and packaging may occur in different cost centres at the **same authorized site**.
- A single end-to-end routing groups the stages for one selected output SKU. Reusable upstream intermediate routings may exist independently; a reference to them must not silently create duplicate demand.
- Avoid cross-site process steps in one execution routing initially: where the output is transferred between sites, model a separate approved route per site plus a later governed inter-site transfer.
- Keep creator, reviewer, approval, audit, effective-date and scope behaviour from the existing MFG foundation (maker-checker, no in-place modification of approved route).

### Routing overview and edit flow (mobile-first)
1. **Setup:** output SKU, site, alternative/version and concise high-level path summary; show configuration/readiness state.
2. **Stages:** compact chronological stage list; collapsed cards display stage number, name, cost centre, output, rate basis and dependency state. Only the selected card expands to edit. Add, duplicate and reorder actions preserve dependency integrity.
3. **Stage details:** task/process class, cost centre, selected configured manufacturing resource, output SKU or service-only/no-output step, optional approved stage BOM, batch/flow basis, predecessor stages, setup/run duration and applicable rate source.
4. **Review & validation:** stage graph and parallel branches, resolved BOM inputs, intermediate SKU handoffs, throughput bottleneck, stage timings, incomplete references, release readiness.
5. **Submit/approve:** keep existing route governance and permissions. Save incomplete **drafts** with explicit warnings; reject incomplete routes from activation, not from editing when possible.

## Stage schema to add (additively)
Use existing `code`, `sequence`, `name`, `resourceId`, `producesSkuId`, `dependsOn`, `setupMinutes` and `runMinutesPerUnit` unchanged for compatibility, then add:
- `costCenterId` — manufacturing cost centre selected from the authorized site’s eligible Finance-classified cost centres; separate for each stage.
- `processClass` — configurable process/activity taxonomy (e.g., material preparation, blending, bottle blowing, filling/capping, inspection, labelling, grouping, case packing, palletization, transfer, QC/hold). Do not hard-code all industries to bottling.
- `bomId` (optional in draft) — explicit selected approved/effective BOM whose **parentSkuId matches the stage output**. Stage consumption is displayed from this BOM; no separate duplicate material quantities in the route.
- `capacityBasis` — either `PHYSICAL_CONTAINER`, `RESOURCE_RATE`, `BATCH_CYCLE`, or `TIME_PER_UNIT`. The choice depends on the stage's nature, not a universal bottle assumption.
- `requiredResourceIds` optional list for later multiresource planning; keep existing `resourceId` as primary in first migration.
- `stageType` output-producing vs inspection/transfer/non-transforming, so a no-output stage does not fabricate an intermediate SKU.
- Optional yield/standard loss, batch size and time qualifiers, only when the source is owned by the applicable BOM/process standard; do not apply the same scrap or loss again in routing and planning.

## Linking rules and reference priorities
| Relationship | Source of truth | Routing behaviour |
| --- | --- | --- |
| Manufactured SKU and primary physical container | Materials & Products / Product Configuration | Read-only SKU and conversions |
| Physical-container commissioned capacity | `pln_cost_center_capacity/{costCenterId}`, per SKU | Read authorized rate, count unit and selected time period |
| Manufacturing cost centre classification | Finance + Organization Design | Select authorized manufacturing cost centres at routing stage |
| BOM/recipe quantity and unit conversion | Approved BOM master, selected alternative/effective date | Reference one applicable BOM per transforming stage output; do not duplicate inputs |
| Resource identity/asset link | MFG Resources and existing Asset Register | Read-only references; no planning writes to equipment or assets |
| Stage sequence and parallel dependencies | The routing | Directed acyclic graph, no self/forward/circular dependencies |
| Calendar, availability, changeover, breakdown, labour | Future capacity/scheduling layer | Keep separate from commissioned rate and operation definition |

### Commissioned capacity precedence
1. For a **physical-container** stage, the selected **stage cost centre + stage manufactured SKU** must have a valid commissioned primary-container rating. Only the central cost-centre record supplies the physical count speed.
2. Convert that speed to form, finished pack and logistics units **only** with the SKU’s configured container size and packaging ratios. Preserve the original rated time denominator in each result (a minute rating remains per minute).
3. For bulk recipe, utilities, inspection, batch, or other stages with no relevant primary container, do not force a bottle speed. Use the configured resource rate, batch size and cycle time, or validated time-per-unit basis as appropriate.
4. In capacity evaluation, convert **compatible** stage outputs to a common planning basis, include stage-specific constraints, and identify limiting capacity. Never take the minimum of unlike units without a valid conversion. Do not count physical-container speed and resource speed twice.
5. Historical/persisted stock-UOM ratings are **not** silently treated as physical-container ratings; visibly report the missing configuration.

## Validation gates
**Draft save:** check field types and IDs, duplicate stage identifiers, basic site access, and well-formed dependency graph. Permit staged authoring and identify missing material, BOM, cost-centre or rate references.
**Ready for approval:** require final output match, at least one valid manufacturing stage, all mandatory stage resource and authorized cost-centre assignments, applicable approved BOM for every material-transforming stage, stage output SKU existence, no broken dependencies or disconnected required paths, compatible rate basis and UOM, and no cross-site references. Do not silently approve a missing speed.
**Activation:** existing MFG routing independent maker-checker, site scope, immutable approved version and effective-date checks, with audit. Route alternatives may coexist; order planning must select a single effective approved alternative for each relevant stage/order.
**Legacy routes:** continue reading and displaying existing routes; request explicit cost-centre/stage-BOM enrichment for planning readiness rather than deleting or fabricating mappings.

## Isolated fictional Line 11 exercise
Demonstrate a parallel process graph:
- Branch A: ingredient/water preparation → prepared bulk intermediate (bulk resource/batch basis).
- Branch B: preform → bottle blowing → empty PET bottle intermediate (container/resource count).
- Merge: filling/capping → filled bottle intermediate.
- Finish: inspection/quality check → labelling → case packing → palletization → finished SKU receipt readiness (actual stock receipt remains out of scope).
- Variants: purchased bottle, no separate blow stage, different packaging sizes, optional inspection and concurrent branches.
- At least two distinct fictional finished SKUs, differentiated physical-container sizes and rates. Test shortages and outages only in an **isolated demo** later, without live purchase/stock/accounting actions.

## Suggested build sequence (after design review)
1. Additive typed routing stage schema and migration-safe normalization + validation tests (no data deletion).
2. Scoped stage cost-centre and stage BOM reference endpoints; read cost-centre rates/units on demand. Confirm no equipment planning writes.
3. Mobile-first header + collapsible stage list + guarded stage editor. Existing stage IDs and dependency linking retained.
4. Cross-stage review (DAG, BOM lineage, unit-safe capacity, bottleneck and missing requirement report).
5. Separate draft validation from release readiness; preserve existing MFG workflow. Run full regression checks and deploy on `develop` only.
6. Exercise fictional Line 11 paths with approved test masters; verify no real posting side effects.

## Acceptance criteria
- A site-scoped user cannot see or assign a foreign site or unauthorized cost centre.
- One route contains sequential and parallel stages; cyclic/disconnected illegal dependencies are rejected with stage-specific messages.
- Stage cost centres and SKU commissioned primary-container rates synchronize with the authoritative master, including selected count/time units.
- Bulk preparation is not forced to use a physical-container rating; bottleneck calculations never compare unlike units.
- Stage input requirements reference BOM versions and do not introduce duplicate consumption or double count intermediates.
- Existing approved routing versions and approvals remain usable and immutable; legacy routes remain readable.
- Mobile screens remain navigable without a horizontally overflowing long stage form.
- Asset Register/equipment remains unchanged; no inventory, finance, supplier, or actual production posting is emitted by routing configuration.

## Review boundary
This document defines the recommended structure and rules only. **No routing APIs, Firestore schema or React routing editor are changed by this design commit.** Implementation follows the review of the above behaviour.
