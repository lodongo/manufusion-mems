# MEMS MRO GL determination — development integration (2026-10-27)

## Architecture and coverage

This extends the EXISTING Finance-approved account-determination engine, not a second accounting subsystem. There is no new live accounting approval process, no extra journal handler, and no bulk activation of Finance-review catalogue masters.

At an approved maintenance work assessment, the Work Request records a `maintenanceTypeCode` (for example `MAI-001` for preventive, `MAI-002` for corrective). The Work Order inherits that code. An individual assessed task can optionally select an override from the existing active MNT maintenance-types reference registry; overrides remain subject to the existing assessment review, and planned tasks cannot be silently edited.

Finance > GL Accounts > Account Determination > Transaction-specific rules now supports:
- event `GI_WO`, role `MAINT_CONSUMPTION`
- material technical category (optional)
- beneficiary cost center (optional)
- controlled maintenance type code (optional)
- Stores cost-nature class code (optional, e.g. ESP / LUB / MCS)
- eligible expense GL from the adopted legal-entity chart.

There are no automatic account assignments solely based on English account names, the word "maintenance," the item's technical name, or the original MRO template. A Finance proposal must still pass the existing `FIN.mapping.approve` maker-checker procedure. The accounting rule only takes effect when approved and the underlying account satisfies GL-scope and posting checks. Existing generic approved mappings remain the fallback when no strategy-specific rule matches.

## Goods issue and returns

During `POST /api/org/inv/issue/post`, the already-live `GI_WO` transaction resolves its debit `MAINT_CONSUMPTION` account using the approved strategy + cost-nature context, and credits inventory as before. The journal uses the same Finance posting, balanced journal and stock valuation lock.

For each issued material the goods-issue record preserves:
- `expenseGlCode`, `inventoryGlCode`
- `maintenanceTypeCode`, `maintenanceTypeLabel`, `maintenanceTypeSource`
- `storesCostNatureCode`
- `accountDeterminationRuleId` (when a matching rule exists)
- material identity and quantity/value, WO/task and benefiting cost center.

These classifications are also in the journal source `trace.mroLines`, enabling analysis by strategy, nature, work order, equipment/cost center and GL.

Maintenance returns reverse **the original recorded expense and inventory accounts**, even when a different Finance mapping has subsequently been approved. Older goods-issue records that predate this field continue through the legacy mapped account path and remain explicitly distinguishable. Historical journals are not reclassified retroactively.

## Category classification behavior

When a new organization material is created from a universal material template with a configured `accounting.catalogueClassification.storesClassCode`, the approved Stores class is copied into the tenant material record. If the active catalogue has no such classification, no artificial code is generated and general approved mappings continue.

Existing material numbers are not changed. No procurement, consignment, vendor, warehouse or MRP workflows were duplicated.

## What remains outside this milestone

- Finance-review draft catalogues must still be approved and published under controlled release; proposed GLs must not be posted until approved.
- External maintenance services continue through existing Purchase Requirement, PO and Service Acceptance. Where a PO line has an originating maintenance requirement linked to a WO/task, service acceptance now captures that WO/task's maintenance strategy, service cost nature and the **approved PO expense account** on the immutable journal trace. The service debit account is NOT reselected at acceptance. Automated pre-PO strategy-specific service GL determination and any reallocation remain unimplemented pending a separately reviewed Finance/Procurement contract.
- Capitalization of an eligible overhaul is subject to a separate reviewed CAPEX/CIP posting policy, not automatically mapped to a maintenance expense account.
- Historical (pre-release) material issues cannot reliably be attributed to a strategy if their journal lacks a strategy reference; no retrospective guesswork.
- End-to-end Firestore emulator tests for posting and returns should be completed against a populated legal entity and approved chart before production consideration.

## Verification

Run `node --import tsx --test tests/independent/mro-gl-determination.test.mjs`, `npm run check`, `npm run build`, and the full independent validation suite. Deploy only from the verified `develop` branch into the isolated development Cloud Run service.
